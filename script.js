// Connexion à Supabase
const SUPABASE_URL = 'https://ljqpbrljxnpgrarhpnej.supabase.co';
const SUPABASE_KEY = 'sb_publishable_w7-8WW-umjzeWiW-WU_fHg_bHj3stZl';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let appData = { foyer: {}, invariables: [], recettes: [] };
let currentPlanning = [];

// Chargement initial des recettes et invariables depuis Supabase
async function loadData() {
    const [rec, inv] = await Promise.all([
        sb.from('recettes')
          .select('id, nom, recette_ingredients(nom, quantite, unite, rayon)')
          .order('nom'),
        sb.from('invariables').select('nom, quantite, unite, rayon').order('id')
    ]);

    const err = rec.error || inv.error;
    if (err) {
        console.error(err);
        alert("Erreur Supabase : " + err.message);
        return;
    }

    appData = {
        foyer: { nombre_personnes: 4 },
        invariables: inv.data,
        recettes: rec.data.map(r => ({ id: r.id, nom: r.nom, ingredients: r.recette_ingredients }))
    };
    
    renderDatabaseView();

    // Initialiser avec la date du jour
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('start-date').value = today;
    await loadPlanningForWeek();
}

// Obtenir la liste exacte des 7 jours (avec les vrais noms de jours adaptés à la date)
function getWeekDates(startDateStr) {
    let start = new Date(startDateStr);
    let dates = [];
    const dayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });

    for (let i = 0; i < 7; i++) {
        let d = new Date(start);
        d.setDate(start.getDate() + i);
        let dateIso = d.toISOString().split('T')[0];
        let dayName = dayFormatter.format(d);
        // Mettre la première lettre en majuscule
        dayName = dayName.charAt(0).toUpperCase() + dayName.slice(1);
        
        dates.push({ date: dateIso, name: dayName });
    }
    return dates;
}

// Charger le planning enregistré dans Supabase pour la semaine choisie
async function loadPlanningForWeek() {
    const startDateStr = document.getElementById('start-date').value;
    if (!startDateStr) return;

    const weekDates = getWeekDates(startDateStr);
    const dateStrings = weekDates.map(w => w.date);

    const { data, error } = await sb
        .from('planning')
        .select(`
            date,
            midi:repas_midi_id(id, nom, recette_ingredients(nom, quantite, unite, rayon)),
            soir:repas_soir_id(id, nom, recette_ingredients(nom, quantite, unite, rayon))
        `)
        .in('date', dateStrings);

    if (error) {
        console.error("Erreur lors du chargement du planning :", error);
        return;
    }

    const planningMap = {};
    if (data) {
        data.forEach(row => {
            planningMap[row.date] = { lunch: row.midi, dinner: row.soir };
        });
    }

    currentPlanning = [];

    weekDates.forEach(w => {
        let savedDay = planningMap[w.date];

        let lunch = (savedDay && savedDay.lunch) ? savedDay.lunch : (appData.recettes[0] || { id: null, nom: "Non planifié", ingredients: [] });
        let dinner = (savedDay && savedDay.dinner) ? savedDay.dinner : (appData.recettes[0] || { id: null, nom: "Non planifié", ingredients: [] });

        currentPlanning.push({ day: w.name, date: w.date, lunch, dinner });
    });

    renderPlanningUI();
    generateShoppingList();
}

// 1. Générer aléatoirement un planning en local (sans enregistrer en base)
function generateRandomMenuLocally() {
    const recipes = [...appData.recettes];
    if (recipes.length === 0) {
        alert("Aucune recette disponible !");
        return;
    }

    const startDateStr = document.getElementById('start-date').value;
    if (!startDateStr) {
        alert("Veuillez choisir une date.");
        return;
    }

    const weekDates = getWeekDates(startDateStr);
    currentPlanning = [];

    weekDates.forEach(w => {
        const lunch = recipes[Math.floor(Math.random() * recipes.length)];
        const dinner = recipes[Math.floor(Math.random() * recipes.length)];

        currentPlanning.push({ day: w.name, date: w.date, lunch, dinner });
    });

    renderPlanningUI();
    generateShoppingList();
}

// Afficher le planning et les sélecteurs d'édition à la volée
function renderPlanningUI() {
    const planningContainer = document.getElementById('planning-container');
    planningContainer.innerHTML = '';

    currentPlanning.forEach((slot, index) => {
        const dayEl = document.createElement('div');
        dayEl.className = 'day-item';

        // Options du menu déroulant pour le midi et le soir
        const recipeOptions = appData.recettes.map(r => 
            `<option value="${r.id}" ${slot.lunch && slot.lunch.id === r.id ? 'selected' : ''}>${r.nom}</option>`
        ).join('');

        const recipeOptionsDinner = appData.recettes.map(r => 
            `<option value="${r.id}" ${slot.dinner && slot.dinner.id === r.id ? 'selected' : ''}>${r.nom}</option>`
        ).join('');

        dayEl.innerHTML = `
            <div class="day-name">${slot.day} <span style="font-weight:normal; font-size:0.75rem; color:var(--text-muted);">(${slot.date})</span></div>
            <div class="meal-slot">
                <div class="meal-info">
                    <span class="meal-tag">MIDI</span>
                    <select class="recipe-select" onchange="updateMeal(${index}, 'lunch', this.value)">
                        ${recipeOptions}
                    </select>
                </div>
            </div>
            <div class="meal-slot">
                <div class="meal-info">
                    <span class="meal-tag">SOIR</span>
                    <select class="recipe-select" onchange="updateMeal(${index}, 'dinner', this.value)">
                        ${recipeOptionsDinner}
                    </select>
                </div>
            </div>
        `;
        planningContainer.appendChild(dayEl);
    });
}

// Changer un plat à la volée via la liste déroulante
function updateMeal(dayIndex, slotType, recipeId) {
    const selectedRecipe = appData.recettes.find(r => r.id == recipeId);
    if (selectedRecipe) {
        currentPlanning[dayIndex][slotType] = selectedRecipe;
        generateShoppingList(); // Recalcule les courses en direct
    }
}

// 2. Enregistrer le planning actuel dans Supabase
async function saveCurrentMenuToSupabase() {
    if (currentPlanning.length === 0) {
        alert("Rien à enregistrer. Générez d'abord un planning.");
        return;
    }

    let upsertData = currentPlanning.map(slot => ({
        date: slot.date,
        repas_midi_id: slot.lunch.id,
        repas_soir_id: slot.dinner.id
    }));

    const { error } = await sb.from('planning').upsert(upsertData, { onConflict: 'date' });
    if (error) {
        alert("Erreur enregistrement Supabase : " + error.message);
        return;
    }

    alert("Planning enregistré avec succès pour toute la famille !");
}

// Ajouter une nouvelle recette
async function addRecipe() {
    const nom = document.getElementById('new-recipe-name').value.trim();
    const lines = document.getElementById('new-recipe-ingredients').value
        .split('\n').map(l => l.trim()).filter(Boolean);

    if (!nom || lines.length === 0) {
        alert("Il faut un nom et au moins un ingrédient.");
        return;
    }

    const ingredients = [];
    for (const line of lines) {
        const [n, q, u, r] = line.split(';').map(s => s.trim());
        const quantite = parseFloat((q || '').replace(',', '.'));
        if (!n || isNaN(quantite)) {
            alert("Ligne invalide : " + line);
            return;
        }
        ingredients.push({ nom: n, quantite, unite: u || 'pièces', rayon: r || 'Divers' });
    }

    const { data: created, error } = await sb.from('recettes')
        .insert({ nom }).select('id').single();

    if (error) {
        alert("Erreur : " + error.message);
        return;
    }

    const { error: err2 } = await sb.from('recette_ingredients')
        .insert(ingredients.map(i => ({ ...i, recette_id: created.id })));

    if (err2) {
        alert("Erreur sur les ingrédients : " + err2.message);
        return;
    }

    document.getElementById('new-recipe-name').value = '';
    document.getElementById('new-recipe-ingredients').value = '';
    await loadData();
    alert("Recette ajoutée avec succès !");
}

// Changer d'onglet
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('nav button').forEach(el => el.classList.remove('active'));
    
    document.getElementById('tab-' + tabName).classList.add('active');
    document.getElementById('tab-' + tabName + '-btn').classList.add('active');
}

// Générer la liste de courses consolidée par rayon
function generateShoppingList() {
    const coursesContainer = document.getElementById('courses-container');
    coursesContainer.innerHTML = '';

    if (currentPlanning.length === 0) return;

    const listMap = {};

    // 1. Invariables
    appData.invariables.forEach(item => {
        const key = item.nom.toLowerCase();
        listMap[key] = {
            nom: item.nom,
            quantite: item.quantite,
            unite: item.unite,
            rayon: item.rayon || "Divers"
        };
    });

    // 2. Ingrédients des repas
    currentPlanning.forEach(slot => {
        [slot.lunch, slot.dinner].forEach(recipe => {
            if (recipe && recipe.ingredients) {
                recipe.ingredients.forEach(ing => {
                    const key = ing.nom.toLowerCase();
                    if (listMap[key]) {
                        if (listMap[key].unite === ing.unite) {
                            listMap[key].quantite += ing.quantite;
                        }
                    } else {
                        listMap[key] = {
                            nom: ing.nom,
                            quantite: ing.quantite,
                            unite: ing.unite,
                            rayon: ing.rayon || "Divers"
                        };
                    }
                });
            }
        });
    });

    // Groupement par Rayon
    const rayonedMap = {};
    Object.values(listMap).forEach(item => {
        if (!rayonedMap[item.rayon]) {
            rayonedMap[item.rayon] = [];
        }
        rayonedMap[item.rayon].push(item);
    });

    let totalItems = 0;

    for (const [rayon, items] of Object.entries(rayonedMap)) {
        const rayonGroup = document.createElement('div');
        rayonGroup.className = 'rayon-group';
        
        let rayonHTML = `<div class="rayon-title">📍 ${rayon}</div>`;
        
        items.forEach(item => {
            totalItems++;
            const itemId = 'item-' + Math.random().toString(36).substr(2, 9);
            rayonHTML += `
                <div class="shopping-item" onclick="toggleCheck('${itemId}')">
                    <input type="checkbox" id="${itemId}">
                    <label for="${itemId}">${item.nom} - <strong>${item.quantite} ${item.unite}</strong></label>
                </div>
            `;
        });

        rayonGroup.innerHTML = rayonHTML;
        coursesContainer.appendChild(rayonGroup);
    }

    document.getElementById('courses-count').innerText = `(${totalItems} articles)`;
}

// Cocher / Décocher un article de la liste
function toggleCheck(id) {
    const checkbox = document.getElementById(id);
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        const parent = checkbox.closest('.shopping-item');
        if (checkbox.checked) {
            parent.classList.add('checked');
        } else {
            parent.classList.remove('checked');
        }
    }
}

// Afficher les données dans l'onglet Recettes
function renderDatabaseView() {
    document.getElementById('recipes-count').innerText = appData.recettes.length;
    document.getElementById('invariables-count').innerText = appData.invariables.length;

    const recipesList = document.getElementById('recipes-list');
    recipesList.innerHTML = appData.recettes.map(r => `
        <div class="db-item">
            <strong>${r.nom}</strong>
            <span>${r.ingredients ? r.ingredients.length : 0} ingrédients</span>
        </div>
    `).join('');

    const invariablesList = document.getElementById('invariables-list');
    invariablesList.innerHTML = appData.invariables.map(i => `
        <div class="db-item">
            <strong>${i.nom}</strong>
            <span>${i.quantite} ${i.unite} (${i.rayon})</span>
        </div>
    `).join('');
}

// Initialisation au chargement de la page
loadData();