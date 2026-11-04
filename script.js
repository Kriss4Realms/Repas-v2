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

// Obtenir la liste des 7 jours à partir de la date sélectionnée
function getWeekDates(startDateStr) {
    let start = new Date(startDateStr);
    let dates = [];
    for (let i = 0; i < 7; i++) {
        let d = new Date(start);
        d.setDate(start.getDate() + i);
        dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
}

// Charger le planning enregistré dans Supabase pour la semaine choisie
async function loadPlanningForWeek() {
    const startDateStr = document.getElementById('start-date').value;
    if (!startDateStr) return;

    const weekDates = getWeekDates(startDateStr);

    const { data, error } = await sb
        .from('planning')
        .select(`
            date,
            midi:repas_midi_id(id, nom, recette_ingredients(nom, quantite, unite, rayon)),
            soir:repas_soir_id(id, nom, recette_ingredients(nom, quantite, unite, rayon))
        `)
        .in('date', weekDates);

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

    const dayNames = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
    currentPlanning = [];
    const planningContainer = document.getElementById('planning-container');
    planningContainer.innerHTML = '';

    weekDates.forEach((dateStr, index) => {
        let dayName = dayNames[index];
        let savedDay = planningMap[dateStr];

        let lunch = (savedDay && savedDay.lunch) ? savedDay.lunch : { id: null, nom: "Non planifié", ingredients: [] };
        let dinner = (savedDay && savedDay.dinner) ? savedDay.dinner : { id: null, nom: "Non planifié", ingredients: [] };

        currentPlanning.push({ day: dayName, date: dateStr, lunch, dinner });

        const dayEl = document.createElement('div');
        dayEl.className = 'day-item';
        dayEl.innerHTML = `
            <div class="day-name">${dayName} <span style="font-weight:normal; font-size:0.75rem; color:var(--text-muted);">(${dateStr})</span></div>
            <div class="meal-slot"><span class="meal-tag">MIDI</span> ${lunch.nom}</div>
            <div class="meal-slot"><span class="meal-tag">SOIR</span> ${dinner.nom}</div>
        `;
        planningContainer.appendChild(dayEl);
    });

    generateShoppingList();
}

// Générer un nouveau planning et le sauvegarder dans Supabase
async function generateAndSaveMenu() {
    const startDateStr = document.getElementById('start-date').value;
    if (!startDateStr) {
        alert("Veuillez choisir une date.");
        return;
    }

    const recipes = [...appData.recettes];
    if (recipes.length === 0) {
        alert("Aucune recette disponible !");
        return;
    }

    const weekDates = getWeekDates(startDateStr);
    const dayNames = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
    
    currentPlanning = [];
    let upsertData = [];

    weekDates.forEach((dateStr, index) => {
        const lunch = recipes[Math.floor(Math.random() * recipes.length)];
        const dinner = recipes[Math.floor(Math.random() * recipes.length)];

        currentPlanning.push({ day: dayNames[index], date: dateStr, lunch, dinner });

        upsertData.push({
            date: dateStr,
            repas_midi_id: lunch.id,
            repas_soir_id: dinner.id
        });
    });

    // Enregistrement dans Supabase
    const { error } = await sb.from('planning').upsert(upsertData, { onConflict: 'date' });
    if (error) {
        alert("Erreur enregistrement Supabase : " + error.message);
        return;
    }

    await loadPlanningForWeek();
    alert("Planning généré et synchronisé pour toute la famille !");
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