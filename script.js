// === 1. CONFIGURATION & SÉCURITÉ PDF ===
const stylePDF = document.createElement('style');
stylePDF.innerHTML = `
    @media print { tr { page-break-inside: avoid !important; } thead { display: table-header-group !important; } }
    #tableClassementSpecifique th { background-color: #003366 !important; color: white !important; padding: 10px; border: 1px solid #000; font-size: 12px; }
    #tableClassementSpecifique td { border: 1px solid #ccc; text-align: center; padding: 8px; font-size: 11px; }
`;
document.head.appendChild(stylePDF);

// === 2. VARIABLES GLOBALES ===
let concurrents = JSON.parse(localStorage.getItem('rallyeData_2025')) || [];
let currentClassementType = 'General';
let editingRowIndex = -1;
let pendingImportHeaders = null;
let pendingImportRows = null;

const defaultConfig = { 
    pied: 30, cone: 5, atelier: 50, chute: 300, cp: 250, regu: 10, regu_f: 600, tir: 30, tir_retard: 1, 
    t_ideal: 30, region: 'paca', nb_bases: 2, o_dist_ideal: 100, o_tol_dist: 2, o_pen_dist: 100, pen_non_passage: 20000,
    tenue: 500, briefing: 2000, v_l: 20, v_f: 50, mhe_points: 100000,
    jury_president: '', jury_secretaire: '', jury_nb: 0, jury_noms: [], base_distances: [],
    participant_categories: ['Police', 'Civil'], classement_categories: []
};
let config = Object.assign({}, defaultConfig, JSON.parse(localStorage.getItem('rallyeConfig_2025')) || {});
if (!Array.isArray(config.jury_noms)) config.jury_noms = [];
if (!Array.isArray(config.base_distances)) config.base_distances = [];
if (!Array.isArray(config.participant_categories)) config.participant_categories = [];
if (!Array.isArray(config.classement_categories)) config.classement_categories = [];
config.jury_nb = Math.max(0, parseInt(config.jury_nb || 0, 10) || 0);
config.participant_categories = normalizeCategoryList(config.participant_categories);
config.classement_categories = normalizeCategoryList(config.classement_categories);
if (!config.participant_categories.length) config.participant_categories = [...defaultConfig.participant_categories];
if (!config.classement_categories.length) config.classement_categories = [...config.participant_categories];

window.onload = () => { chargerConfigVisual(); updateUI(); renderClassementCategoryFilters(); refreshRuleLabels(); };

// === 3. AUTO-FORMATTAGE CHRONOS ===
document.addEventListener('input', function(e) {
    if (e.target.classList && e.target.classList.contains('time-mask-hms')) {
        let val = e.target.value.replace(/\D/g, '');
        if (val.length > 6) val = val.substring(0, 6);
        if (val.length > 4) e.target.value = val.substring(0, 2) + ':' + val.substring(2, 4) + ':' + val.substring(4);
        else if (val.length > 2) e.target.value = val.substring(0, 2) + ':' + val.substring(2);
        else e.target.value = val;
    }
    if (e.target.classList && e.target.classList.contains('time-mask')) {
        let val = e.target.value.replace(/\D/g, ''); 
        if (val.length > 4) val = val.substring(0, 4); 
        if (val.length > 2) e.target.value = val.substring(0, 2) + ':' + val.substring(2);
        else e.target.value = val;
    }
});

// === 4. NAVIGATION ===
function openTab(name) {
    document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.nav-tabs > .tab-link').forEach(l => l.classList.remove('active'));
    const target = document.getElementById(name);
    if(target) target.style.display = 'block';
    const mainTabBtn = document.querySelector(`.nav-tabs > .tab-link[onclick*="openTab('${name}')"]`);
    if (mainTabBtn) mainTabBtn.classList.add('active');
    if(name === 'Classement') filtrerClassement(currentClassementType);
}

function save() { 
    localStorage.setItem('rallyeData_2025', JSON.stringify(concurrents));
    localStorage.setItem('rallyeConfig_2025', JSON.stringify(config));
}

function hasAnyAssignedDossard() {
    return concurrents.some(c => Number.isFinite(c.dossard));
}

function getNextDossardNumber() {
    const maxDossard = concurrents.reduce((max, c) => {
        return Number.isFinite(c.dossard) ? Math.max(max, c.dossard) : max;
    }, 0);
    return maxDossard + 1;
}

function isPointsEntryStarted() {
    return concurrents.some(c => {
        if (!c || !c.det) return false;
        if ((c.pointsAdmin || 0) > 0 || (c.pointsMani || 0) > 0 || (c.pointsTir || 0) > 0 || (c.pointsRoute || 0) > 0 || (c.pointsRegu || 0) > 0) {
            return true;
        }
        if (c.manualMhe || c.mhe || (c.mheCount || 0) > 0) return true;

        const d = c.det;
        if ((d.c_tenue || 0) > 0 || d.c_briefing || d.c_admin_ko || d.c_moto_ko || d.r_v_mhe) return true;
        if ((d.m_cones || 0) > 0 || (d.m_pieds || 0) > 0 || (d.m_atels || 0) > 0 || (d.m_chute || 0) > 0 || (d.t_rates || 0) > 0) return true;
        if ((d.r_cp || 0) > 0 || (d.r_v_l || 0) > 0 || (d.r_v_f || 0) > 0) return true;
        if ((d.o_km_dep || 0) > 0 || (d.o_km_arr || 0) > 0) return true;
        if ((d.m_chrono || '').trim() !== '' || (d.t_temps || '').trim() !== '' || (d.o_h_dep || '').trim() !== '' || (d.o_h_arr || '').trim() !== '') return true;

        for (let i = 1; i <= config.nb_bases; i++) {
            if ((d[`reg${i}_dep`] || '').trim() !== '' || (d[`reg${i}_arr`] || '').trim() !== '' || (d[`reg${i}_f`] || 0) > 0) {
                return true;
            }
        }
        return false;
    });
}

// === 5. IMPORT / EXPORT DONNEES (XLS, XLSX, ODS) ===
function exporterConcurrentsSeuls() {
    const lignes = [
        ['Dossard', 'Nom', 'Prenom', 'Categorie'],
        ...concurrents.map(c => [c.dossard || '', c.nom || '', c.prenom || '', c.spec || 'Civil'])
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(lignes);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Concurrents');
    XLSX.writeFile(workbook, `concurrents_${new Date().toISOString().slice(0, 10)}.xls`, { bookType: 'biff8' });
}

function exporterConcurrentsAvecPoints() {
    const lignes = [
        ['Dossard', 'Nom', 'Prenom', 'Categorie', 'PointsTotal', 'PointsAdmin', 'PointsMani', 'PointsTir', 'PointsRoute', 'PointsRegu', 'ChronoManiSec', 'MHE'],
        ...concurrents.map(c => [
            c.dossard || '',
            c.nom || '',
            c.prenom || '',
            c.spec || 'Civil',
            Number(c.points || 0),
            Number(c.pointsAdmin || 0),
            Number(c.pointsMani || 0),
            Number(c.pointsTir || 0),
            Number(c.pointsRoute || 0),
            Number(c.pointsRegu || 0),
            Number(c.chrono || 0),
            c.mhe ? 1 : 0
        ])
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(lignes);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ConcurrentsPoints');
    XLSX.writeFile(workbook, `concurrents_points_${new Date().toISOString().slice(0, 10)}.ods`, { bookType: 'ods' });
}

function normaliserEntete(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

function trouverColonne(headers, aliases) {
    const normalizedHeaders = headers.map(normaliserEntete);
    for (const alias of aliases) {
        const idx = normalizedHeaders.indexOf(normaliserEntete(alias));
        if (idx >= 0) return idx;
    }
    return -1;
}

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function toBool(value) {
    const txt = String(value || '').trim().toLowerCase();
    return txt === '1' || txt === 'true' || txt === 'oui' || txt === 'yes';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeCategoryLabel(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeCategoryList(value) {
    const raw = Array.isArray(value) ? value : String(value ?? '').split(/[\n,;|]+/);
    const categories = [];
    raw.map(normalizeCategoryLabel).filter(Boolean).forEach(category => {
        if (!categories.some(existing => existing.toLowerCase() === category.toLowerCase())) {
            categories.push(category);
        }
    });
    return categories;
}

function getConfiguredCategories() {
    return normalizeCategoryList(config.participant_categories);
}

function getDefaultCategory() {
    return getConfiguredCategories()[0] || 'Civil';
}

function normalizeSpec(value) {
    const label = normalizeCategoryLabel(value);
    if (!label) return getDefaultCategory();
    const match = getConfiguredCategories().find(category => category.toLowerCase() === label.toLowerCase());
    return match || label;
}

function buildCategoryOptions(selectedValue) {
    const categories = getConfiguredCategories();
    const selectedLabel = normalizeCategoryLabel(selectedValue) || getDefaultCategory();
    const optionValues = categories.some(category => category.toLowerCase() === selectedLabel.toLowerCase())
        ? categories
        : [selectedLabel, ...categories];

    return optionValues.map(category => {
        const isSelected = category.toLowerCase() === selectedLabel.toLowerCase();
        return `<option value="${escapeHtml(category)}" ${isSelected ? 'selected' : ''}>${escapeHtml(category)}</option>`;
    }).join('');
}

function refreshCategorySelectors() {
    const specSelect = document.getElementById('spec');
    if (!specSelect) return;
    const currentSpec = specSelect.value;
    specSelect.innerHTML = buildCategoryOptions(currentSpec);
}

function renderClassementCategoryFilters() {
    const container = document.getElementById('classement_categories_container');
    if (!container) return;

    const categories = getConfiguredCategories();
    const selected = normalizeCategoryList(config.classement_categories);
    const selection = new Set((selected.length ? selected : categories).map(category => category.toLowerCase()));

    container.innerHTML = categories.map(category => `
        <label style="display:inline-flex; align-items:center; gap:6px; padding:6px 10px; background:#fff; border:1px solid #cfd8e3; border-radius:999px;">
            <input type="checkbox" class="classement-category-checkbox" value="${escapeHtml(category)}" ${selection.has(category.toLowerCase()) ? 'checked' : ''} onchange="saveClassementCategories()">
            <span>${escapeHtml(category)}</span>
        </label>
    `).join('');
}

function saveClassementCategories() {
    const categories = getConfiguredCategories();
    const selected = Array.from(document.querySelectorAll('.classement-category-checkbox'))
        .filter(input => input.checked)
        .map(input => normalizeCategoryLabel(input.value));
    const nextSelection = categories.filter(category => selected.some(value => value.toLowerCase() === category.toLowerCase()));
    config.classement_categories = nextSelection.length ? nextSelection : [...categories];
    save();
    filtrerClassement(currentClassementType);
}

function isRowNonEmpty(row) {
    return Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== '');
}

function getHeadersAndDataRows(rows) {
    const nonEmptyIndexes = [];
    for (let i = 0; i < rows.length; i++) {
        if (isRowNonEmpty(rows[i])) nonEmptyIndexes.push(i);
        if (nonEmptyIndexes.length >= 20) break;
    }

    if (!nonEmptyIndexes.length) {
        throw new Error('Le fichier est vide.');
    }

    let headerIndex = nonEmptyIndexes.find(idx => {
        const candidateHeaders = rows[idx].map(h => String(h || '').trim());
        return trouverColonne(candidateHeaders, ['Nom']) >= 0;
    });

    if (headerIndex === undefined) headerIndex = nonEmptyIndexes[0];

    return {
        headers: rows[headerIndex].map(h => String(h || '').trim()),
        dataRows: rows.slice(headerIndex + 1)
    };
}

function buildMappingOptions(headers, selectedIndex, required = false) {
    const safeSelected = Number.isInteger(selectedIndex) && selectedIndex >= 0 ? selectedIndex : (required ? 0 : -1);
    const ignoreOption = `<option value="-1" ${safeSelected === -1 ? 'selected' : ''}>(Ignorer)</option>`;
    const headerOptions = headers.map((h, i) => `<option value="${i}" ${safeSelected === i ? 'selected' : ''}>${h || `Colonne ${i + 1}`}</option>`).join('');
    return `${ignoreOption}${headerOptions}`;
}

function afficherSelecteurColonnesImport(headers) {
    const container = document.getElementById('mappingContainer');
    if (!container) return;

    const pre = {
        nom: trouverColonne(headers, ['Nom']),
        prenom: trouverColonne(headers, ['Prenom', 'Prénom']),
        spec: trouverColonne(headers, ['Categorie', 'Catégorie', 'Spec', 'Specialite']),
        dossard: trouverColonne(headers, ['Dossard', 'Numero', 'No']),
        points: trouverColonne(headers, ['PointsTotal', 'Points']),
        pointsAdmin: trouverColonne(headers, ['PointsAdmin']),
        pointsMani: trouverColonne(headers, ['PointsMani', 'PointsManiabilite']),
        pointsTir: trouverColonne(headers, ['PointsTir']),
        pointsRoute: trouverColonne(headers, ['PointsRoute']),
        pointsRegu: trouverColonne(headers, ['PointsRegu', 'PointsRegul']),
        chrono: trouverColonne(headers, ['ChronoManiSec', 'Chrono']),
        mhe: trouverColonne(headers, ['MHE', 'Mhe'])
    };

    container.innerHTML = `
        <div class="card" style="border: 2px solid var(--police-blue); padding: 15px; margin-bottom: 0;">
            <h3 style="margin-top: 0;">🔗 Correspondance des colonnes d'import</h3>
            <p style="margin-top: 0; color: #555;">La colonne NOM n'a pas ete detectee automatiquement. Associez les colonnes puis confirmez.</p>
            <div class="grid">
                <div><label>NOM (obligatoire) :</label><select id="map_nom">${buildMappingOptions(headers, pre.nom, true)}</select></div>
                <div><label>Prenom :</label><select id="map_prenom">${buildMappingOptions(headers, pre.prenom)}</select></div>
                <div><label>Categorie :</label><select id="map_spec">${buildMappingOptions(headers, pre.spec)}</select></div>
                <div><label>Dossard :</label><select id="map_dossard">${buildMappingOptions(headers, pre.dossard)}</select></div>
                <div><label>Points total :</label><select id="map_points">${buildMappingOptions(headers, pre.points)}</select></div>
                <div><label>Points admin :</label><select id="map_pointsAdmin">${buildMappingOptions(headers, pre.pointsAdmin)}</select></div>
                <div><label>Points mani :</label><select id="map_pointsMani">${buildMappingOptions(headers, pre.pointsMani)}</select></div>
                <div><label>Points tir :</label><select id="map_pointsTir">${buildMappingOptions(headers, pre.pointsTir)}</select></div>
                <div><label>Points route :</label><select id="map_pointsRoute">${buildMappingOptions(headers, pre.pointsRoute)}</select></div>
                <div><label>Points bases chrono :</label><select id="map_pointsRegu">${buildMappingOptions(headers, pre.pointsRegu)}</select></div>
                <div><label>Chrono mani (sec) :</label><select id="map_chrono">${buildMappingOptions(headers, pre.chrono)}</select></div>
                <div><label>MHE :</label><select id="map_mhe">${buildMappingOptions(headers, pre.mhe)}</select></div>
            </div>
            <div style="margin-top: 12px; display: flex; gap: 10px; flex-wrap: wrap;">
                <button class="btn-green" onclick="finaliserImportMapping()">Confirmer l'import</button>
                <button class="btn-red" onclick="annulerImportMapping()">Annuler</button>
            </div>
        </div>`;
    container.style.display = 'block';
    openTab('Points');
}

function annulerImportMapping() {
    pendingImportHeaders = null;
    pendingImportRows = null;
    const container = document.getElementById('mappingContainer');
    if (container) {
        container.innerHTML = '';
        container.style.display = 'none';
    }
}

function readMappedColumn(row, idx) {
    return idx >= 0 ? row[idx] : '';
}

function importerAvecMapping(dataRows, mapping) {
    const imported = [];
    for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const nom = String(readMappedColumn(row, mapping.nom) || '').trim().toUpperCase();
        if (!nom) continue;

        const prenom = String(readMappedColumn(row, mapping.prenom) || '').trim();
        const spec = mapping.spec >= 0 ? normalizeSpec(readMappedColumn(row, mapping.spec)) : getDefaultCategory();
        const pilote = creerPilote(nom, prenom, spec);

        if (mapping.dossard >= 0) {
            const d = toNumber(readMappedColumn(row, mapping.dossard), NaN);
            pilote.dossard = Number.isFinite(d) ? Math.trunc(d) : null;
        }

        pilote.pointsAdmin = mapping.pointsAdmin >= 0 ? toNumber(readMappedColumn(row, mapping.pointsAdmin), 0) : 0;
        pilote.pointsMani = mapping.pointsMani >= 0 ? toNumber(readMappedColumn(row, mapping.pointsMani), 0) : 0;
        pilote.pointsTir = mapping.pointsTir >= 0 ? toNumber(readMappedColumn(row, mapping.pointsTir), 0) : 0;
        pilote.pointsRoute = mapping.pointsRoute >= 0 ? toNumber(readMappedColumn(row, mapping.pointsRoute), 0) : 0;
        pilote.pointsRegu = mapping.pointsRegu >= 0 ? toNumber(readMappedColumn(row, mapping.pointsRegu), 0) : 0;
        pilote.pointsRegul = pilote.pointsRegu;
        pilote.pointsManiabilite = pilote.pointsMani;
        pilote.chrono = mapping.chrono >= 0 ? toNumber(readMappedColumn(row, mapping.chrono), 0) : 0;
        pilote.manualMhe = mapping.mhe >= 0 ? toBool(readMappedColumn(row, mapping.mhe)) : false;

        const hasDetail = mapping.pointsAdmin >= 0 || mapping.pointsMani >= 0 || mapping.pointsTir >= 0 || mapping.pointsRoute >= 0 || mapping.pointsRegu >= 0;
        if (hasDetail) {
            recalculerPointsConcurrent(pilote);
        } else {
            pilote.points = mapping.points >= 0 ? toNumber(readMappedColumn(row, mapping.points), 0) : 0;
            pilote.mhe = pilote.manualMhe;
            pilote.mheCount = pilote.manualMhe ? 1 : 0;
        }

        imported.push(pilote);
    }
    return imported;
}

function finaliserImportMapping() {
    if (!pendingImportHeaders || !pendingImportRows) {
        alert('Aucun import en attente.');
        return;
    }

    const mapping = {
        nom: parseInt(document.getElementById('map_nom')?.value || '-1', 10),
        prenom: parseInt(document.getElementById('map_prenom')?.value || '-1', 10),
        spec: parseInt(document.getElementById('map_spec')?.value || '-1', 10),
        dossard: parseInt(document.getElementById('map_dossard')?.value || '-1', 10),
        points: parseInt(document.getElementById('map_points')?.value || '-1', 10),
        pointsAdmin: parseInt(document.getElementById('map_pointsAdmin')?.value || '-1', 10),
        pointsMani: parseInt(document.getElementById('map_pointsMani')?.value || '-1', 10),
        pointsTir: parseInt(document.getElementById('map_pointsTir')?.value || '-1', 10),
        pointsRoute: parseInt(document.getElementById('map_pointsRoute')?.value || '-1', 10),
        pointsRegu: parseInt(document.getElementById('map_pointsRegu')?.value || '-1', 10),
        chrono: parseInt(document.getElementById('map_chrono')?.value || '-1', 10),
        mhe: parseInt(document.getElementById('map_mhe')?.value || '-1', 10)
    };

    if (mapping.nom < 0) {
        alert('La colonne NOM est obligatoire.');
        return;
    }

    const imported = importerAvecMapping(pendingImportRows, mapping);
    if (!imported.length) {
        alert('Aucun concurrent valide trouve avec ce mapping.');
        return;
    }

    concurrents = imported;
    annulerImportMapping();
    editingRowIndex = -1;
    save();
    chargerConfigVisual();
    updateUI();
    renderClassementCategoryFilters();
    refreshRuleLabels();
    alert('Import termine avec succes.');
}

function importerDepuisSauvegardeWorkbook(workbook) {
    const configSheet = workbook.Sheets.config;
    const concurrentsSheet = workbook.Sheets.concurrents;
    if (!configSheet || !concurrentsSheet) return false;

    const configRows = XLSX.utils.sheet_to_json(configSheet, { header: 1, defval: '' });
    const concurrentRows = XLSX.utils.sheet_to_json(concurrentsSheet, { header: 1, defval: '' });
    const configPayload = String(configRows?.[1]?.[0] || '').trim();
    if (!configPayload) throw new Error('Configuration absente de la sauvegarde.');

    const parsedConfig = JSON.parse(configPayload);
    const parsedConcurrents = concurrentRows
        .slice(1)
        .map(row => {
            const payloadCell = String(row?.[1] || '').trim();
            return payloadCell ? JSON.parse(payloadCell) : null;
        })
        .filter(Boolean);

    concurrents = parsedConcurrents.map(c => {
        const pilote = creerPilote(
            String(c.nom || '').toUpperCase(),
            String(c.prenom || ''),
            normalizeSpec(c.spec)
        );
        pilote.dossard = Number.isFinite(c.dossard) ? c.dossard : null;
        pilote.det = (c.det && typeof c.det === 'object') ? c.det : {};
        pilote.points = Number(c.points || 0);
        pilote.pointsAdmin = Number(c.pointsAdmin || 0);
        pilote.pointsMani = Number(c.pointsMani || 0);
        pilote.pointsTir = Number(c.pointsTir || 0);
        pilote.pointsRoute = Number(c.pointsRoute || 0);
        pilote.pointsRegu = Number(c.pointsRegu || 0);
        pilote.pointsRegul = Number(c.pointsRegul || pilote.pointsRegu || 0);
        pilote.pointsManiabilite = Number(c.pointsManiabilite || pilote.pointsMani || 0);
        pilote.chrono = Number(c.chrono || 0);
        pilote.manualMhe = !!c.manualMhe;
        pilote.mhe = !!c.mhe;
        pilote.mheCount = Number(c.mheCount || 0);
        return pilote;
    });

    config = Object.assign({}, defaultConfig, parsedConfig);
    if (!Array.isArray(config.jury_noms)) config.jury_noms = [];
    if (!Array.isArray(config.base_distances)) config.base_distances = [];
    if (!Array.isArray(config.participant_categories)) config.participant_categories = [];
    if (!Array.isArray(config.classement_categories)) config.classement_categories = [];
    config.jury_nb = Math.max(0, parseInt(config.jury_nb || 0, 10) || 0);
    config.nb_bases = Math.max(1, parseInt(config.nb_bases || defaultConfig.nb_bases, 10) || defaultConfig.nb_bases);
    config.participant_categories = normalizeCategoryList(config.participant_categories);
    config.classement_categories = normalizeCategoryList(config.classement_categories);
    if (!config.participant_categories.length) config.participant_categories = [...defaultConfig.participant_categories];
    config.classement_categories = config.classement_categories.filter(category =>
        config.participant_categories.some(available => available.toLowerCase() === category.toLowerCase())
    );
    if (!config.classement_categories.length) config.classement_categories = [...config.participant_categories];
    concurrents.forEach(recalculerPointsConcurrent);
    return true;
}

function importerDepuisTableau(workbook) {
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    const { headers, dataRows } = getHeadersAndDataRows(rows);

    const mapping = {
        nom: trouverColonne(headers, ['Nom']),
        prenom: trouverColonne(headers, ['Prenom', 'Prénom']),
        spec: trouverColonne(headers, ['Categorie', 'Catégorie', 'Spec', 'Specialite']),
        dossard: trouverColonne(headers, ['Dossard', 'Numero', 'No']),
        points: trouverColonne(headers, ['PointsTotal', 'Points']),
        pointsAdmin: trouverColonne(headers, ['PointsAdmin']),
        pointsMani: trouverColonne(headers, ['PointsMani', 'PointsManiabilite']),
        pointsTir: trouverColonne(headers, ['PointsTir']),
        pointsRoute: trouverColonne(headers, ['PointsRoute']),
        pointsRegu: trouverColonne(headers, ['PointsRegu', 'PointsRegul']),
        chrono: trouverColonne(headers, ['ChronoManiSec', 'Chrono']),
        mhe: trouverColonne(headers, ['MHE', 'Mhe'])
    };

    if (mapping.nom < 0) {
        pendingImportHeaders = headers;
        pendingImportRows = dataRows;
        afficherSelecteurColonnesImport(headers);
        return { pendingMapping: true };
    }

    const imported = importerAvecMapping(dataRows, mapping);

    if (!imported.length) {
        throw new Error('Aucun concurrent valide trouve dans le fichier.');
    }

    concurrents = imported;
    return { pendingMapping: false };
}

function importerDonnees(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            if (!confirm('Importer ce fichier va remplacer les données actuelles. Continuer ?')) return;

            if (!importerDepuisSauvegardeWorkbook(workbook)) {
                const result = importerDepuisTableau(workbook);
                if (result && result.pendingMapping) {
                    alert('Import en attente: mappez les colonnes puis confirmez.');
                    return;
                }
            }

            editingRowIndex = -1;
            save();
            chargerConfigVisual();
            updateUI();
            refreshRuleLabels();
            alert('Import termine avec succes.');
        } catch (err) {
            alert(`Import impossible: ${err.message || 'fichier non valide'}`);
        }
    };
    reader.readAsArrayBuffer(file);
}

// === 6. BASES CHRONO DYNAMIQUES ===
function genererChampsBases(pilote = null) {
    const cfgContainer = document.getElementById('container_bases_config');
    const saisiContainer = document.getElementById('container_bases_chrono');

    if (cfgContainer) cfgContainer.innerHTML = "";
    if (saisiContainer) saisiContainer.innerHTML = "";

    const getDist = (i) => {
        const val = Number(config.base_distances?.[i - 1] ?? 0);
        return Number.isFinite(val) ? val : 0;
    };

    for (let i = 1; i <= config.nb_bases; i++) {
        const valDep = (pilote && pilote.det[`reg${i}_dep`]) ? pilote.det[`reg${i}_dep`] : "";
        const valArr = (pilote && pilote.det[`reg${i}_arr`]) ? pilote.det[`reg${i}_arr`] : "";
        const valF = (pilote && pilote.det[`reg${i}_f`]) ? pilote.det[`reg${i}_f`] : 0;
        const dist = getDist(i);
        const idealSec = Math.round((Math.max(0, dist) / 50) * 3600);

        if (cfgContainer) {
            cfgContainer.innerHTML += `
                <div style="margin-bottom: 10px; padding: 10px; border-bottom: 1px dashed #cce5ff;">
                    <strong>Base ${i}</strong>
                    <div class="grid" style="margin-top:8px;">
                        <div>
                            <label>Distance base (km) :</label>
                            <input type="number" id="base_cfg_dist_${i}" min="0" step="0.1" value="${dist}" onchange="saveConfig()">
                        </div>
                        <div>
                            <label>Temps idéal (50 km/h) :</label>
                            <div id="base_cfg_ideal_${i}" style="padding:12px; border:2px solid #cce5ff; border-radius:6px; background:#fff; font-weight:bold; color:var(--police-blue);">${formatHMS(idealSec)}</div>
                        </div>
                    </div>
                </div>`;
        }

        if (saisiContainer) {
            saisiContainer.innerHTML += `
                <div style="margin-bottom: 10px; padding: 10px; border-bottom: 1px dashed #ccc;">
                    <strong>Base ${i}</strong>
                    <div class="grid" style="margin-top:8px;">
                        <div>
                                <label>Heure de départ (HH:MM:SS) :</label>
                                <input type="text" id="reg${i}_dep" class="time-mask-hms" maxlength="8" placeholder="HH:MM:SS" value="${valDep}">
                            </div>
                            <div>
                                <label>Heure d'arrivée (HH:MM:SS) :</label>
                                <input type="text" id="reg${i}_arr" class="time-mask-hms" maxlength="8" placeholder="HH:MM:SS" value="${valArr}">
                        </div>
                        <div>
                            <label>Pied/Arrêt en zone :</label>
                            <input type="number" id="reg${i}_f" min="0" value="${valF}">
                        </div>
                    </div>
                    <div id="reg${i}_calc" style="margin-top:6px; font-size:0.9em; color: var(--police-blue); font-weight:bold;">Temps idéal (50 km/h) : ${formatHMS(idealSec)} — Écart : 00:00:00</div>
                </div>`;
        }
    }
}

// === 7. CALCULS & SAISIE ===
function chargerPilote(onglet) {
    const input = document.querySelector(`#${onglet} .input-dossard`);
    if(!input || !input.value) return;
    const doss = parseInt(input.value);
    const p = concurrents.find(x => x.dossard === doss);
    const form = document.getElementById(`form${onglet}`);
    const verif = document.getElementById(`verif${onglet}`);
    if(p) {
        verif.innerHTML = `<div class="status-alert alert-ok">👤 ${p.nom} ${p.prenom} (${p.spec})</div>`;
        form.style.display = "block";
        if(onglet === 'Controles') {
            document.getElementById('c_tenue').value = p.det.c_tenue || 0;
            document.getElementById('c_briefing').value = p.det.c_briefing ? 1 : 0;
            document.getElementById('c_admin_ko').checked = p.det.c_admin_ko || false;
            document.getElementById('c_moto_ko').checked = p.det.c_moto_ko || false;
        }
        if(onglet === 'Maniabilite') {
            document.getElementById('m_cones').value = p.det.m_cones || 0;
            document.getElementById('m_pieds').value = p.det.m_pieds || 0;
            document.getElementById('m_atels').value = p.det.m_atels || 0;
            document.getElementById('m_chute').value = p.det.m_chute || 0;
            document.getElementById('m_chrono').value = p.det.m_chrono || "";
            document.getElementById('t_rates').value = p.det.t_rates || 0;
            document.getElementById('t_temps').value = p.det.t_temps || "";
        }
        if(onglet === 'Orientation') {
            document.getElementById('r_cp').value = p.det.r_cp || 0;
            document.getElementById('o_km_dep').value = p.det.o_km_dep || 0;
            document.getElementById('o_km_arr').value = p.det.o_km_arr || 0;
            document.getElementById('o_h_dep').value = p.det.o_h_dep || "";
            document.getElementById('o_h_arr').value = p.det.o_h_arr || "";
            document.getElementById('r_v_l').value = p.det.r_v_l || 0;
            document.getElementById('r_v_f').value = p.det.r_v_f || 0;
            document.getElementById('r_v_mhe').checked = p.det.r_v_mhe || false;
            genererChampsBases(p);
        }
        calculDirect(onglet);
    } else {
        if(verif) verif.innerHTML = ""; if(form) form.style.display = "none";
    }
}

function calculDirect(onglet) {
    if (onglet === 'Controles') {
        const tenueKo = parseInt(document.getElementById('c_tenue').value || '0', 10) === 1;
        const briefing = parseInt(document.getElementById('c_briefing').value || '0', 10) === 1;
        const pointsTenue = tenueKo ? config.tenue : 0;
        const pointsBriefing = briefing ? config.briefing : 0;
        const totalAdmin = pointsTenue + pointsBriefing;
        document.getElementById('titre_controles').innerText = `Pénalités Administratives : ${totalAdmin} pt(s)`;
        return;
    }

    if (onglet === 'Maniabilite') {
        const cones = parseInt(document.getElementById('m_cones').value || '0', 10);
        const pieds = parseInt(document.getElementById('m_pieds').value || '0', 10);
        const ateliers = parseInt(document.getElementById('m_atels').value || '0', 10);
        const chutes = parseInt(document.getElementById('m_chute').value || '0', 10);

        const pointsMani = (cones * config.cone) + (pieds * config.pied) + (ateliers * config.atelier) + (chutes * config.chute);
        document.getElementById('titre_maniabilite').innerText = `Maniabilité : ${pointsMani} pt(s)`;

        const tirsRates = parseInt(document.getElementById('t_rates').value || '0', 10);
        const tempsTir = parseChrono(document.getElementById('t_temps').value);
        const tempsIdeal = parseChrono(secondsToChrono(config.t_ideal));
        const retardDixiemes = Math.max(0, Math.round((tempsTir - tempsIdeal) * 10));
        const pointsTir = (tirsRates * config.tir) + (retardDixiemes * config.tir_retard);
        document.getElementById('titre_tir').innerText = `Tir Laser : ${pointsTir} pt(s)`;
        return;
    }

    if (onglet === 'Orientation') {
        const hDep = parseHHMM(document.getElementById('o_h_dep').value);
        const hArr = parseHHMM(document.getElementById('o_h_arr').value);
        let duree = (hArr >= hDep) ? (hArr - hDep) : (1440 - hDep + hArr);
        document.getElementById('calc_temps').innerText = `Durée : ${formatHHMM(duree)}`;
        
        const dist = Math.max(0, (parseFloat(document.getElementById('o_km_arr').value)||0) - (parseFloat(document.getElementById('o_km_dep').value)||0));
        const penD = Math.round(Math.max(0, Math.abs(dist - config.o_dist_ideal) - (config.o_dist_ideal * config.o_tol_dist / 100)) * config.o_pen_dist);
        document.getElementById('calc_dist').innerText = `Distance : ${dist.toFixed(1)} km`;

        const v_l = Math.min(20, parseInt(document.getElementById('r_v_l').value)||0);
        const v_f = parseInt(document.getElementById('r_v_f').value)||0;
        let r_pts = (parseInt(document.getElementById('r_cp').value)||0)*config.cp + (v_l * config.v_l) + (v_f * config.v_f) + penD;
        document.getElementById('titre_routier').innerText = `Routier & Vitesse : ${r_pts} pt(s)`;

        let totalReg = 0;
        for(let i=1; i<=config.nb_bases; i++){
            const distBase = Number(config.base_distances?.[i - 1] ?? 0);
            const idealSec = Math.round((Math.max(0, distBase) / 50) * 3600);
            const depSec = parseHMS(document.getElementById(`reg${i}_dep`)?.value);
            const arrSec = parseHMS(document.getElementById(`reg${i}_arr`)?.value);
            const realSec = calculerDureeHms(depSec, arrSec);
            const ecartSec = Math.abs(realSec - idealSec);
            totalReg += ecartSec * config.regu;

            const calcEl = document.getElementById(`reg${i}_calc`);
            if (calcEl) calcEl.innerText = `Temps idéal (50 km/h) : ${formatHMS(idealSec)} — Écart : ${formatHMS(ecartSec)}`;

            const baseF = parseInt(document.getElementById(`reg${i}_f`)?.value || '0', 10);
            totalReg += (baseF * config.regu_f);
        }
        document.getElementById('titre_regu').innerText = `Bases Chrono : ${Math.round(totalReg)} pt(s)`;
    }
}

// === 8. CLASSEMENTS & EXPORTS ===
function filtrerClassement(type) {
    currentClassementType = type;
    document.querySelectorAll('.sub-tab').forEach(btn => btn.classList.toggle('active', btn.getAttribute('onclick').includes(type)));
    const selectedCategories = normalizeCategoryList(config.classement_categories);
    const availableCategories = getConfiguredCategories();
    const activeCategories = selectedCategories.length ? selectedCategories : availableCategories;
    let liste = concurrents.filter(c => activeCategories.some(category => normalizeSpec(c.spec).toLowerCase() === category.toLowerCase()));

    const getClassementPoints = (concurrent) => {
        const raw = type === 'General' ? concurrent.points : concurrent[`points${type}`];
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    
    liste.sort((a, b) => {
        if (a.mhe !== b.mhe) return a.mhe ? 1 : -1;
        const pA = getClassementPoints(a);
        const pB = getClassementPoints(b);
        return pA - pB || (a.chrono || 0) - (b.chrono || 0);
    });

    let headerHTML = "<th>Rang</th><th>Dossard</th><th>Nom</th><th>Prenom</th><th>Cat.</th><th>Points</th>";
    let bodyHTML = '';

    if (type === 'General') {
        // Classement Général: pas de Chrono Mani
        bodyHTML = liste.map((c, i) => `<tr><td>${i+1}</td><td>${c.dossard || '-'}</td><td>${c.nom || ''}</td><td>${c.prenom || ''}</td><td>${c.spec || ''}</td><td><strong>${c.mhe ? `MHE (${getClassementPoints(c)})` : getClassementPoints(c)}</strong></td></tr>`).join('');
    } else if (type === 'Maniabilite') {
        // Classement Maniabilité: Cônes, Pieds, Ateliers, Chutes, Chrono
        headerHTML = "<th>Rang</th><th>Dossard</th><th>Nom</th><th>Prenom</th><th>Cat.</th><th>Cônes/Piquets</th><th>Pieds à terre</th><th>Ateliers ratés</th><th>Chutes</th><th>Chrono (MM:SS)</th><th>Points</th>";
        bodyHTML = liste.map((c, i) => {
            const cones = c.det?.m_cones || 0;
            const pieds = c.det?.m_pieds || 0;
            const ateliers = c.det?.m_atels || 0;
            const chutes = c.det?.m_chute || 0;
            const chrono = formatChrono(c.chrono);
            return `<tr><td>${i+1}</td><td>${c.dossard || '-'}</td><td>${c.nom || ''}</td><td>${c.prenom || ''}</td><td>${c.spec || ''}</td><td>${cones}</td><td>${pieds}</td><td>${ateliers}</td><td>${chutes}</td><td>${chrono}</td><td><strong>${c.mhe ? `MHE (${getClassementPoints(c)})` : getClassementPoints(c)}</strong></td></tr>`;
        }).join('');
    } else if (type === 'Regul') {
        // Classement Bases Chrono: afficher les chrono de chaque base
        const nbBases = config.nb_bases || 1;
        headerHTML = "<th>Rang</th><th>Dossard</th><th>Nom</th><th>Prenom</th><th>Cat.</th>";
        for (let i = 1; i <= nbBases; i++) {
            const distBase = Number(config.base_distances?.[i - 1] ?? 0);
            const idealSec = Math.round((Math.max(0, distBase) / 50) * 3600);
            const baseLabel = `Base ${i} (${formatHMS(idealSec)})`;
            headerHTML += `<th>${baseLabel}</th>`;
        }
        headerHTML += "<th>Pied/Arrêt en zone</th><th>Points</th>";
        bodyHTML = liste.map((c, idx) => {
            let row = `<tr><td>${idx+1}</td><td>${c.dossard || '-'}</td><td>${c.nom || ''}</td><td>${c.prenom || ''}</td><td>${c.spec || ''}</td>`;
            let totalPiedsArretsZone = 0;
            for (let i = 1; i <= nbBases; i++) {
                const dep = c.det?.[`reg${i}_dep`] || '';
                const arr = c.det?.[`reg${i}_arr`] || '';
                const depSec = parseHMS(dep);
                const arrSec = parseHMS(arr);
                const chronoSec = calculerDureeHms(depSec, arrSec);
                const chrono = (depSec > 0 && arrSec > 0) ? formatHMS(chronoSec) : '-';
                totalPiedsArretsZone += parseInt(c.det?.[`reg${i}_f`] || '0', 10) || 0;
                row += `<td>${chrono}</td>`;
            }
            row += `<td>${totalPiedsArretsZone}</td><td><strong>${c.mhe ? `MHE (${getClassementPoints(c)})` : getClassementPoints(c)}</strong></td></tr>`;
            return row;
        }).join('');
    } else if (type === 'Tir') {
        // Classement Tir: Tirs manqués, Temps concurrent
        headerHTML = "<th>Rang</th><th>Dossard</th><th>Nom</th><th>Prenom</th><th>Cat.</th><th>Tirs manqués</th><th>Temps (MM:SS)</th><th>Points</th>";
        bodyHTML = liste.map((c, i) => {
            const tirsManques = c.det?.t_rates || 0;
            const temps = formatChrono(parseChrono(c.det?.t_temps || ""));
            return `<tr><td>${i+1}</td><td>${c.dossard || '-'}</td><td>${c.nom || ''}</td><td>${c.prenom || ''}</td><td>${c.spec || ''}</td><td>${tirsManques}</td><td>${temps}</td><td><strong>${c.mhe ? `MHE (${getClassementPoints(c)})` : getClassementPoints(c)}</strong></td></tr>`;
        }).join('');
    }

    document.getElementById('headerClassement').innerHTML = headerHTML;
    document.getElementById('bodyClassementSpecifique').innerHTML = bodyHTML;
    const classementLabel = type === 'Regul' ? 'Bases Chrono' : type === 'Maniabilite' ? 'Maniabilité' : type === 'Tir' ? 'Tir Laser' : type;
    const categoriesLabel = activeCategories.length === availableCategories.length
        ? 'SCRATCH'
        : activeCategories.join(' / ');
    document.getElementById('titre_pdf').innerText = `Classement ${classementLabel} - ${categoriesLabel}`;
    refreshJuryPdf();
}

function exportFinalPDF() {
    const scrollPos = window.scrollY; window.scrollTo(0, 0);
    const maintenant = new Date();
    document.getElementById('date_heure_pdf').innerText = `Édité le ${maintenant.toLocaleDateString()} à ${maintenant.toLocaleTimeString()}`;
    document.getElementById('logo_region_pdf').src = document.getElementById('logo_region').src;
    refreshJuryPdf();
    const opt = { margin: 10, filename: `${document.getElementById('titre_pdf').innerText}.pdf`, image: { type: 'jpeg', quality: 1 }, html2canvas: { scale: 2, useCORS: true, scrollY: 0 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
    html2pdf().set(opt).from(document.getElementById("zone_export_pdf")).save().then(() => window.scrollTo(0, scrollPos));
}

function imprimerFeuilleBaseChrono() {
    const nbBases = Math.max(1, parseInt(config.nb_bases || 1, 10) || 1);
    const liste = [...concurrents].sort((a, b) => {
        const dA = Number.isFinite(a.dossard) ? a.dossard : Number.MAX_SAFE_INTEGER;
        const dB = Number.isFinite(b.dossard) ? b.dossard : Number.MAX_SAFE_INTEGER;
        if (dA !== dB) return dA - dB;
        const nomA = (a.nom || '').toString();
        const nomB = (b.nom || '').toString();
        return nomA.localeCompare(nomB, 'fr', { sensitivity: 'base' });
    });

    if (!liste.length) {
        alert('Aucun concurrent à imprimer.');
        return;
    }

    const dossardWidth = 10;
    const nomWidth = 15;
    const prenomWidth = 13;
    const piedsWidth = 8;
    const heureWidth = (100 - dossardWidth - nomWidth - prenomWidth - piedsWidth) / (nbBases * 2);

    const baseHeaders = Array.from({ length: nbBases }, (_, i) => {
        const sepClass = i < nbBases - 1 ? ' class="base-end"' : '';
        return `<th>Départ B${i + 1}</th><th${sepClass}>Arrivée B${i + 1}</th>`;
    }).join('');
    const baseCols = Array.from({ length: nbBases * 2 }, () => `<col style="width: ${heureWidth}%">`).join('');

    const rows = liste.map(c => `
        <tr>
            <td>${Number.isFinite(c.dossard) ? c.dossard : '-'}</td>
            <td>${escapeHtml(c.nom || '')}</td>
            <td>${escapeHtml(c.prenom || '')}</td>
            ${Array.from({ length: nbBases }, (_, i) => {
                const sepClass = i < nbBases - 1 ? ' class="base-end"' : '';
                return `<td>&nbsp;</td><td${sepClass}>&nbsp;</td>`;
            }).join('')}
            <td>&nbsp;</td>
        </tr>
    `).join('');

    const title = 'Feuille Base Chrono';
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Impossible d ouvrir la fenêtre d impression.');
        return;
    }

    printWindow.document.write(`
        <!doctype html>
        <html lang="fr">
        <head>
            <meta charset="utf-8">
            <title>${title}</title>
            <style>
                @page { size: A4 portrait; margin: 12mm; }
                body { font-family: Arial, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                h1 { margin: 0 0 4mm 0; font-size: 20px; }
                table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                table, th, td { border: 1.6px solid #000; }
                th, td { padding: 8px; font-size: 13px; box-sizing: border-box; overflow: hidden; }
                th { background: #f1f1f1; text-align: left; }
                td { height: 28px; }
                tbody tr:nth-child(odd) { background: #ffffff; }
                tbody tr:nth-child(even) { background: #f3f3f3; }
                th:nth-child(1), td:nth-child(1) { text-align: center; }
                th:nth-child(1) { font-size: 12px; white-space: nowrap; }
                th, td { word-break: break-word; overflow-wrap: anywhere; }
                th:nth-child(n+4), td:nth-child(n+4) { text-align: center; }
                th.base-end, td.base-end { border-right: 2.4px solid #000 !important; }
                @media print {
                    table, th, td { border: 1.6px solid #000 !important; }
                    tbody tr:nth-child(odd) { background: #ffffff !important; }
                    tbody tr:nth-child(even) { background: #f3f3f3 !important; }
                    th.base-end, td.base-end { border-right: 2.4px solid #000 !important; }
                }
            </style>
        </head>
        <body>
            <h1>${title}</h1>
            <table>
                <colgroup>
                    <col style="width: ${dossardWidth}%">
                    <col style="width: ${nomWidth}%">
                    <col style="width: ${prenomWidth}%">
                    ${baseCols}
                    <col style="width: ${piedsWidth}%">
                </colgroup>
                <thead>
                    <tr>
                        <th>Dossard</th>
                        <th>NOM</th>
                        <th>Prénom</th>
                        ${baseHeaders}
                        <th>Pieds à terre</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
}

function imprimerFeuilleManiabiliteTir() {
    const liste = [...concurrents].sort((a, b) => {
        const dA = Number.isFinite(a.dossard) ? a.dossard : Number.MAX_SAFE_INTEGER;
        const dB = Number.isFinite(b.dossard) ? b.dossard : Number.MAX_SAFE_INTEGER;
        if (dA !== dB) return dA - dB;
        const nomA = (a.nom || '').toString();
        const nomB = (b.nom || '').toString();
        return nomA.localeCompare(nomB, 'fr', { sensitivity: 'base' });
    });

    if (!liste.length) {
        alert('Aucun concurrent à imprimer.');
        return;
    }

    const title = 'Feuille Maniabilité et Tir';
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Impossible d ouvrir la fenêtre d impression.');
        return;
    }

    const pages = liste.map(c => `
        <section class="page">
            <h1>${title}</h1>
            <div class="pilot-id">
                <span><strong>Dossard :</strong> ${Number.isFinite(c.dossard) ? c.dossard : '-'}</span>
                <span><strong>Nom :</strong> ${escapeHtml(c.nom || '')}</span>
                <span><strong>Prénom :</strong> ${escapeHtml(c.prenom || '')}</span>
            </div>
            <table>
                <colgroup>
                    <col style="width: 7%">
                    <col style="width: 12%">
                    <col style="width: 12%">
                    <col style="width: 9%">
                    <col style="width: 9%">
                    <col style="width: 10%">
                    <col style="width: 8%">
                    <col style="width: 12%">
                    <col style="width: 9%">
                    <col style="width: 12%">
                </colgroup>
                <thead>
                    <tr>
                        <th>Dossard</th>
                        <th>NOM</th>
                        <th>Prénom</th>
                        <th>Cônes/Piquets :</th>
                        <th>Pied à terre :</th>
                        <th>Ateliers ratés :</th>
                        <th>Chutes :</th>
                        <th>Chrono Mani (MM:SS) :</th>
                        <th>Tirs manqués :</th>
                        <th>Temps du tir (MM:SS) :</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>${Number.isFinite(c.dossard) ? c.dossard : '-'}</td>
                        <td>${escapeHtml(c.nom || '')}</td>
                        <td>${escapeHtml(c.prenom || '')}</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                    </tr>
                </tbody>
            </table>
        </section>
    `).join('');

    printWindow.document.write(`
        <!doctype html>
        <html lang="fr">
        <head>
            <meta charset="utf-8">
            <title>${title}</title>
            <style>
                @page { size: A4 landscape; margin: 10mm; }
                body { font-family: Arial, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .page {
                    page-break-after: always;
                    break-after: page;
                }
                .page:last-child {
                    page-break-after: auto;
                    break-after: auto;
                }
                h1 { margin: 0 0 4mm 0; font-size: 20px; }
                .pilot-id {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 8px;
                    margin-bottom: 4mm;
                    padding: 8px;
                    border: 1.4px solid #000;
                    background: #fafafa;
                    font-size: 13px;
                }
                table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                table, th, td { border: 1.4px solid #000; }
                th, td { padding: 6px; font-size: 12px; box-sizing: border-box; overflow: hidden; }
                th { background: #f1f1f1; text-align: center; vertical-align: middle; }
                td { height: 48px; text-align: center; }
                td:nth-child(2), td:nth-child(3) { text-align: left; }
                @media print {
                    table, th, td { border: 1.4px solid #000 !important; }
                    .page { page-break-inside: avoid; break-inside: avoid; }
                }
            </style>
        </head>
        <body>
            ${pages}
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
}

function imprimerFeuilleControles() {
    const liste = [...concurrents].sort((a, b) => {
        const dA = Number.isFinite(a.dossard) ? a.dossard : Number.MAX_SAFE_INTEGER;
        const dB = Number.isFinite(b.dossard) ? b.dossard : Number.MAX_SAFE_INTEGER;
        if (dA !== dB) return dA - dB;
        const nomA = (a.nom || '').toString();
        const nomB = (b.nom || '').toString();
        return nomA.localeCompare(nomB, 'fr', { sensitivity: 'base' });
    });

    if (!liste.length) {
        alert('Aucun concurrent à imprimer.');
        return;
    }

    const rows = liste.map(c => `
        <tr>
            <td>${Number.isFinite(c.dossard) ? c.dossard : '-'}</td>
            <td>${escapeHtml(c.nom || '')}</td>
            <td>${escapeHtml(c.prenom || '')}</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
        </tr>
    `).join('');

    const title = 'Feuille Contrôles Techniques et Administratifs';
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Impossible d ouvrir la fenêtre d impression.');
        return;
    }

    printWindow.document.write(`
        <!doctype html>
        <html lang="fr">
        <head>
            <meta charset="utf-8">
            <title>${title}</title>
            <style>
                @page { size: A4 landscape; margin: 10mm; }
                body { font-family: Arial, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                h1 { margin: 0 0 4mm 0; font-size: 20px; }
                table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                table, th, td { border: 1.4px solid #000; }
                th, td { padding: 6px; font-size: 12px; box-sizing: border-box; overflow: hidden; }
                th { background: #f1f1f1; text-align: center; vertical-align: middle; }
                td { height: 28px; text-align: center; }
                td:nth-child(2), td:nth-child(3) { text-align: left; }
                @media print {
                    table, th, td { border: 1.4px solid #000 !important; }
                }
            </style>
        </head>
        <body>
            <h1>${title}</h1>
            <table>
                <colgroup>
                    <col style="width: 8%">
                    <col style="width: 13%">
                    <col style="width: 13%">
                    <col style="width: 16%">
                    <col style="width: 14%">
                    <col style="width: 18%">
                    <col style="width: 18%">
                </colgroup>
                <thead>
                    <tr>
                        <th>Dossard</th>
                        <th>NOM</th>
                        <th>Prénom</th>
                        <th>Tenue non réglementaire</th>
                        <th>Briefing manqué</th>
                        <th>Papiers/Assurance/CT manquants</th>
                        <th>Moto non conforme Code Route</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
}

function imprimerFicheControleAdministratif() {
    const liste = [...concurrents]
        .filter(c => Number.isFinite(c?.dossard))
        .sort((a, b) => a.dossard - b.dossard);

    if (!liste.length) {
        alert('Aucun concurrent avec dossard à imprimer.');
        return;
    }

    const title = 'Contrôle Administratif';
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Impossible d ouvrir la fenêtre d impression.');
        return;
    }

    printWindow.document.write(`
        <!doctype html>
        <html lang="fr">
        <head>
            <meta charset="utf-8">
            <title>${title}</title>
            <style>
                @page { size: A4 portrait; margin: 6mm; }
                body { font-family: 'Times New Roman', serif; color: #111; margin: 0; }
                .page {
                    page-break-after: always;
                    break-after: page;
                    page-break-inside: avoid;
                    break-inside: avoid;
                }
                .page:last-child {
                    page-break-after: auto;
                    break-after: auto;
                }
                .top-band {
                    margin: 0 auto 3mm auto;
                    width: 95%;
                    border: 1.6px solid #000;
                    text-align: center;
                    font-weight: bold;
                    font-size: 11px;
                    padding: 2px 0;
                    letter-spacing: 0.5px;
                }
                .sheet {
                    border: 1.6px solid #000;
                    padding: 7mm 5mm 4mm 5mm;
                    box-sizing: border-box;
                    min-height: calc(297mm - 28mm);
                    display: flex;
                    flex-direction: column;
                    page-break-inside: avoid;
                    break-inside: avoid;
                }
                h1 {
                    margin: 0 0 3mm 0;
                    text-align: center;
                    font-size: 31px;
                    letter-spacing: 0.6px;
                }
                .title-row {
                    display: block;
                    margin: 2mm 0 3mm 0;
                    text-align: center;
                }
                .controleur-label {
                    font-size: 14px;
                    font-weight: bold;
                    text-align: left;
                    margin-top: 2mm;
                }
                .title-row h1 {
                    margin: 0;
                }
                .controleur-write-line {
                    display: inline-block;
                    width: 270px;
                    border-bottom: 1px solid #000;
                    height: 14px;
                    vertical-align: middle;
                    margin-left: 6px;
                }
                .grid2 {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 6mm;
                }
                .section-title {
                    margin: 0 0 1mm 0;
                    font-size: 18px;
                    font-weight: bold;
                }
                .line {
                    margin: 0 0 1.6mm 0;
                    font-size: 14px;
                }
                .empty-line {
                    display: inline-block;
                    min-width: 150px;
                    border-bottom: 1px solid #000;
                    height: 14px;
                    vertical-align: middle;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 4mm;
                    table-layout: fixed;
                    border: 2.2px solid #000;
                }
                table, th, td { border: 2px solid #000; }
                th, td {
                    font-size: 13px;
                    padding: 4px 5px;
                    text-align: center;
                    color: #000;
                }
                th { font-weight: bold; }
                th:nth-child(3), td:nth-child(3) { border-right-width: 2.6px; }
                th:nth-child(4), td:nth-child(4) { border-left-width: 2.6px; }
                td.item {
                    text-align: left;
                    font-weight: bold;
                }
                td.mark {
                    width: 17%;
                    height: 27px;
                }
                .footer {
                    margin-top: 6mm;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 5mm;
                }
                .moto-wrap {
                    margin-top: 5mm;
                    text-align: center;
                }
                .moto-wrap img {
                    width: 96%;
                    height: auto;
                    max-height: 170px;
                }
                .box {
                    border: 1.6px solid #000;
                    min-height: 64px;
                    padding: 5px 7px;
                    font-size: 15px;
                }
                .box-title {
                    font-weight: bold;
                    margin-bottom: 2px;
                }
                @media print {
                    html, body { width: 100%; height: auto; }
                    table, th, td { border: 2px solid #000 !important; border-color: #000 !important; }
                    table { border: 2.2px solid #000 !important; }
                    th:nth-child(3), td:nth-child(3) { border-right-width: 2.6px !important; }
                    th:nth-child(4), td:nth-child(4) { border-left-width: 2.6px !important; }
                    .sheet { page-break-inside: avoid; break-inside: avoid; }
                }
            </style>
        </head>
        <body>
            ${liste.map(c => {
                const nom = escapeHtml(c.nom || '');
                const prenom = escapeHtml(c.prenom || '');
                const dos = escapeHtml(c.dossard);
                return `
                <div class="page">
                    <div class="top-band">ANNEXE 3 : LE CONTRÔLE ADMINISTRATIF</div>
                    <div class="sheet">
                        <div class="title-row">
                            <h1>CONTROLE ADMINISTRATIF</h1>
                            <div class="controleur-label">Nom du controleur : <span class="controleur-write-line"></span></div>
                        </div>

                        <div class="grid2">
                            <div>
                                <p class="section-title">PILOTE</p>
                                <p class="line">Nom : <strong>${nom}</strong></p>
                                <p class="line">Prénom : <strong>${prenom}</strong></p>
                                <p class="line">Dossard : <strong>${dos}</strong></p>
                                <p class="line">Affectation : <span class="empty-line"></span></p>
                            </div>
                            <div>
                                <p class="section-title">PAPIERS <span style="font-size:15px;">(oui/non/absent)</span></p>
                                <p class="line">Permis de conduire : <span class="empty-line"></span></p>
                                <p class="line">Certificat d'immatriculation : <span class="empty-line"></span></p>
                                <p class="line">Mémo assurance : <span class="empty-line"></span></p>
                                <p class="line">Attestation de prêt : <span class="empty-line"></span></p>
                                <p class="line">Contrôle technique : <span class="empty-line"></span></p>
                            </div>
                        </div>

                        <table>
                            <thead>
                                <tr>
                                    <th>ORGANE / EQUIPEMENT</th>
                                    <th>OK</th>
                                    <th>DEFAUTS</th>
                                    <th>ORGANE / EQUIPEMENT</th>
                                    <th>OK</th>
                                    <th>DEFAUTS</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr><td class="item">Freins</td><td class="mark"></td><td class="mark"></td><td class="item">Casque</td><td class="mark"></td><td class="mark"></td></tr>
                                <tr><td class="item">Eclairage</td><td class="mark"></td><td class="mark"></td><td class="item">Gants</td><td class="mark"></td><td class="mark"></td></tr>
                                <tr><td class="item">Rétro</td><td class="mark"></td><td class="mark"></td><td class="item">Blouson</td><td class="mark"></td><td class="mark"></td></tr>
                                <tr><td class="item">Echappement</td><td class="mark"></td><td class="mark"></td><td class="item">Air Bag</td><td class="mark"></td><td class="mark"></td></tr>
                                <tr><td class="item">Pneus</td><td class="mark"></td><td class="mark"></td><td class="item">Dorsale</td><td class="mark"></td><td class="mark"></td></tr>
                                <tr><td class="item">Plaque</td><td class="mark"></td><td class="mark"></td><td class="item">Pantalon</td><td class="mark"></td><td class="mark"></td></tr>
                                <tr><td class="item">Clignotants</td><td class="mark"></td><td class="mark"></td><td class="item">Chaussures</td><td class="mark"></td><td class="mark"></td></tr>
                            </tbody>
                        </table>

                        <div class="moto-wrap">
                            <img src="motos_controle.png" alt="Illustration motos" onerror="this.style.display='none'">
                        </div>

                        <div class="footer">
                            <div class="box">
                                <div class="box-title">Légende</div>
                                <div>O = choc</div>
                                <div>---- = rayure</div>
                                <div>X = cassé ou manquant</div>
                            </div>
                            <div class="box">
                                <div class="box-title">ETAT au RETOUR :</div>
                            </div>
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </body>
        </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
}

// === 9. FONCTIONS DE BASE ===
function validerSaisie(onglet) {
    const doss = parseInt(document.querySelector(`#${onglet} .input-dossard`).value);
    const p = concurrents.find(x => x.dossard === doss);
    if(!p) return;

    if(onglet === 'Controles') {
        p.det.c_tenue = parseInt(document.getElementById('c_tenue').value || '0', 10);
        p.det.c_briefing = parseInt(document.getElementById('c_briefing').value || '0', 10) === 1;
        p.det.c_admin_ko = document.getElementById('c_admin_ko').checked;
        p.det.c_moto_ko = document.getElementById('c_moto_ko').checked;

        const pointsTenue = p.det.c_tenue === 1 ? config.tenue : 0;
        const pointsBriefing = p.det.c_briefing ? config.briefing : 0;
        p.pointsAdmin = pointsTenue + pointsBriefing;

    }

    if(onglet === 'Maniabilite') {
        p.det.m_cones = parseInt(document.getElementById('m_cones').value || '0', 10);
        p.det.m_pieds = parseInt(document.getElementById('m_pieds').value || '0', 10);
        p.det.m_atels = parseInt(document.getElementById('m_atels').value || '0', 10);
        p.det.m_chute = parseInt(document.getElementById('m_chute').value || '0', 10);
        p.det.m_chrono = document.getElementById('m_chrono').value || "";
        p.det.t_rates = parseInt(document.getElementById('t_rates').value || '0', 10);
        p.det.t_temps = document.getElementById('t_temps').value || "";

        p.pointsMani = (p.det.m_cones * config.cone) + (p.det.m_pieds * config.pied) + (p.det.m_atels * config.atelier) + (p.det.m_chute * config.chute);

        const tempsTir = parseChrono(p.det.t_temps);
        const tempsIdeal = parseChrono(secondsToChrono(config.t_ideal));
        const retardDixiemes = Math.max(0, Math.round((tempsTir - tempsIdeal) * 10));
        p.pointsTir = (p.det.t_rates * config.tir) + (retardDixiemes * config.tir_retard);

        p.chrono = parseChrono(p.det.m_chrono);
        p.pointsManiabilite = p.pointsMani;
    }

    if(onglet === 'Orientation') {
        p.det.r_cp = parseInt(document.getElementById('r_cp').value || '0', 10);
        p.det.o_km_dep = parseFloat(document.getElementById('o_km_dep').value || '0');
        p.det.o_km_arr = parseFloat(document.getElementById('o_km_arr').value || '0');
        p.det.o_h_dep = document.getElementById('o_h_dep').value || "";
        p.det.o_h_arr = document.getElementById('o_h_arr').value || "";
        p.det.r_v_l = parseInt(document.getElementById('r_v_l').value || '0', 10);
        p.det.r_v_f = parseInt(document.getElementById('r_v_f').value || '0', 10);
        p.det.r_v_mhe = document.getElementById('r_v_mhe').checked;

        for(let i=1; i<=config.nb_bases; i++) {
            p.det[`reg${i}_dep`] = document.getElementById(`reg${i}_dep`).value;
            p.det[`reg${i}_arr`] = document.getElementById(`reg${i}_arr`).value;
            p.det[`reg${i}_f`] = parseInt(document.getElementById(`reg${i}_f`).value || '0', 10);
        }
        p.pointsRoute = parseInt(document.getElementById('titre_routier').innerText.match(/\d+/)[0]);
        p.pointsRegu = parseInt(document.getElementById('titre_regu').innerText.match(/\d+/)[0]);
        p.pointsRegul = p.pointsRegu;
    }
    recalculerPointsConcurrent(p);
    save(); alert("Enregistré !"); chargerPilote(onglet);
}

function getMheCount(concurrent) {
    if (!concurrent) return 0;
    let count = 0;
    if (concurrent.det?.c_admin_ko) count += 1;
    if (concurrent.det?.c_moto_ko) count += 1;
    if (concurrent.det?.r_v_mhe) count += 1;
    if (concurrent.manualMhe) count += 1;
    return count;
}

function recalculerPointsConcurrent(concurrent) {
    const basePoints = (concurrent.pointsAdmin||0) + (concurrent.pointsMani||0) + (concurrent.pointsTir||0) + (concurrent.pointsRoute||0) + (concurrent.pointsRegu||0);
    const mheCount = getMheCount(concurrent);
    concurrent.mhe = mheCount > 0;
    concurrent.mheCount = mheCount;
    concurrent.points = basePoints + (mheCount * config.mhe_points);
}

function creerPilote(n,p,s) { return { nom:n, prenom:p, spec:s, dossard:null, points:0, det:{} }; }
function saveConfig() {
    config.pied = parseInt(document.getElementById('p_pied')?.value || config.pied, 10);
    config.cone = parseInt(document.getElementById('p_cone')?.value || config.cone, 10);
    config.atelier = parseInt(document.getElementById('p_atelier')?.value || config.atelier, 10);
    config.chute = parseInt(document.getElementById('p_chute')?.value || config.chute, 10);
    config.tir = parseInt(document.getElementById('p_tir')?.value || config.tir, 10);
    config.tir_retard = parseInt(document.getElementById('p_tir_retard')?.value || config.tir_retard, 10);
    config.cp = parseInt(document.getElementById('p_cp')?.value || config.cp, 10);
    config.regu = parseInt(document.getElementById('p_regu')?.value || config.regu, 10);
    config.regu_f = parseInt(document.getElementById('p_regu_f')?.value || config.regu_f, 10);
    config.o_tol_dist = parseFloat(document.getElementById('o_tol_dist')?.value || config.o_tol_dist);
    config.o_pen_dist = parseInt(document.getElementById('o_pen_dist')?.value || config.o_pen_dist, 10);
    config.pen_non_passage = parseInt(document.getElementById('p_non_passage')?.value || config.pen_non_passage, 10);
    config.v_l = parseInt(document.getElementById('p_v_l')?.value || config.v_l, 10);
    config.v_f = parseInt(document.getElementById('p_v_f')?.value || config.v_f, 10);
    config.mhe_points = parseInt(document.getElementById('p_mhe')?.value || config.mhe_points, 10);
    config.tenue = parseInt(document.getElementById('p_tenue')?.value || config.tenue, 10);
    config.briefing = parseInt(document.getElementById('p_briefing')?.value || config.briefing, 10);
    config.t_ideal = parseChrono(document.getElementById('t_ideal')?.value || secondsToChrono(config.t_ideal));
    config.o_dist_ideal = parseFloat(document.getElementById('o_dist_ideal')?.value || config.o_dist_ideal);
    config.nb_bases = parseInt(document.getElementById('p_nb_bases')?.value || config.nb_bases, 10);
    config.participant_categories = normalizeCategoryList(document.getElementById('categories_spec')?.value || config.participant_categories);
    if (!config.participant_categories.length) config.participant_categories = [...defaultConfig.participant_categories];
    config.classement_categories = normalizeCategoryList(config.classement_categories).filter(category =>
        config.participant_categories.some(available => available.toLowerCase() === category.toLowerCase())
    );
    if (!config.classement_categories.length) config.classement_categories = [...config.participant_categories];
    config.base_distances = Array.from({ length: config.nb_bases }, (_, idx) => {
        const i = idx + 1;
        const inputValue = document.getElementById(`base_cfg_dist_${i}`)?.value;
        const fallback = Number(config.base_distances?.[idx] ?? 0);
        const parsed = parseFloat(inputValue ?? `${fallback}`);
        return Number.isFinite(parsed) ? parsed : 0;
    });
    save();
    genererChampsBases();
    refreshCategorySelectors();
    renderClassementCategoryFilters();
    updateUI();
    refreshRuleLabels();
}

function chargerConfigVisual() {
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    };

    refreshCategorySelectors();

    setValue('p_pied', config.pied);
    setValue('p_cone', config.cone);
    setValue('p_atelier', config.atelier);
    setValue('p_chute', config.chute);
    setValue('p_tir', config.tir);
    setValue('p_tir_retard', config.tir_retard);
    setValue('p_cp', config.cp);
    setValue('p_regu', config.regu);
    setValue('p_regu_f', config.regu_f);
    setValue('o_tol_dist', config.o_tol_dist);
    setValue('o_pen_dist', config.o_pen_dist);
    setValue('p_non_passage', config.pen_non_passage);
    setValue('p_v_l', config.v_l);
    setValue('p_v_f', config.v_f);
    setValue('p_mhe', config.mhe_points);
    setValue('p_tenue', config.tenue);
    setValue('p_briefing', config.briefing);
    setValue('t_ideal', secondsToChrono(config.t_ideal));
    setValue('o_dist_ideal', config.o_dist_ideal);
    setValue('p_nb_bases', config.nb_bases);
    setValue('categories_spec', getConfiguredCategories().join('\n'));
    setValue('choix_region', config.region);
    setValue('jury_president', config.jury_president || '');
    setValue('jury_secretaire', config.jury_secretaire || '');
    setValue('jury_nb', config.jury_nb || 0);

    const img = document.getElementById('logo_region');
    if (img) img.src = `logo_${config.region}.png`;
    genererChampsBases();
    renderJuryInputs();
    renderClassementCategoryFilters();
    refreshJuryPdf();
    refreshRuleLabels();
}

function renderJuryInputs() {
    const container = document.getElementById('jury_noms_container');
    if (!container) return;
    const nb = Math.max(0, parseInt(document.getElementById('jury_nb')?.value || config.jury_nb || 0, 10) || 0);
    container.innerHTML = '';
    for (let i = 0; i < nb; i++) {
        const value = (config.jury_noms && config.jury_noms[i]) ? config.jury_noms[i] : '';
        container.innerHTML += `
            <div>
                <label>Nom du juré ${i + 1} :</label>
                <input type="text" id="jury_nom_${i}" value="${value}" placeholder="Nom du juré ${i + 1}" oninput="saveJuryConfig()">
            </div>`;
    }
}

function saveJuryConfig() {
    const president = (document.getElementById('jury_president')?.value || '').trim();
    const secretaire = (document.getElementById('jury_secretaire')?.value || '').trim();
    const nb = Math.max(0, parseInt(document.getElementById('jury_nb')?.value || '0', 10) || 0);
    const currentInputCount = document.querySelectorAll('#jury_noms_container input[id^="jury_nom_"]').length;

    config.jury_president = president;
    config.jury_secretaire = secretaire;
    config.jury_nb = nb;

    if (currentInputCount !== nb) {
        renderJuryInputs();
    }

    const noms = [];
    for (let i = 0; i < nb; i++) {
        noms.push((document.getElementById(`jury_nom_${i}`)?.value || '').trim());
    }
    config.jury_noms = noms;

    save();
    refreshJuryPdf();
}

function refreshJuryPdf() {
    const president = (config.jury_president || '').trim();
    const secretaire = (config.jury_secretaire || '').trim();
    const nb = Math.max(0, parseInt(config.jury_nb || 0, 10) || 0);
    const noms = Array.from({ length: nb }, (_, i) => (config.jury_noms?.[i] || '').trim());
    const grid = document.getElementById('pdf_jury_grid');
    if (!grid) return;

    const colonnes = [
        { titre: 'Président', valeur: president || '-' },
        { titre: 'Secrétaire', valeur: secretaire || '-' },
        ...noms.map((nom, index) => ({ titre: `Juré ${index + 1}`, valeur: nom || '-' }))
    ];

    const maxCols = 5;
    const blocs = [];
    for (let start = 0; start < colonnes.length; start += maxCols) {
        blocs.push(colonnes.slice(start, start + maxCols));
    }

    grid.innerHTML = blocs.map((bloc, blocIndex) => {
        const cols = Math.max(bloc.length, 2);
        const titres = bloc.map(col => `<div style="font-weight: bold; color: #003366; padding: 2px 4px;">${col.titre}</div>`).join('');
        const valeurs = bloc.map(col => `
            <div style="background: white; border: 1px solid #d9e3f0; border-radius: 4px; padding: 6px; min-height: 100px; display:flex; flex-direction:column; justify-content:space-between;">
                <div>${col.valeur}</div>
                <div style="border-top: 1px solid #bfcfe6; margin-top: 28px;"></div>
            </div>
        `).join('');

        return `
            <div style="margin-bottom: ${blocIndex < blocs.length - 1 ? '12px' : '0'};">
                <div style="display:grid; grid-template-columns: repeat(${cols}, minmax(120px, 1fr)); gap: 10px; text-align:center; margin-bottom: 8px; width:100%;">${titres}</div>
                <div style="display:grid; grid-template-columns: repeat(${cols}, minmax(120px, 1fr)); gap: 10px; text-align:center; width:100%;">${valeurs}</div>
            </div>
        `;
    }).join('');
}

function enregistrerJury() {
    const btn = document.getElementById('btnEnregistrerJury');
    if (!btn) return;

    btn.classList.remove('is-saving');
    void btn.offsetWidth;
    btn.classList.add('is-saving');

    const originalText = btn.textContent;
    btn.textContent = '✅ Enregistré';
    window.setTimeout(() => {
        btn.classList.remove('is-saving');
        btn.textContent = originalText;
    }, 900);
}

function refreshRuleLabels() {
    const setTxt = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    };
    setTxt('lbl_p_tenue', config.tenue);
    setTxt('lbl_p_briefing', config.briefing);
    setTxt('lbl_p_v_l', config.v_l);
    setTxt('lbl_p_v_f', config.v_f);
}
function updateUI() {
    const ins = document.querySelector('#tableInscrits tbody');
    if(ins) {
        ins.innerHTML = concurrents.map((c, i) => {
            if (editingRowIndex === i) {
                return `
                    <tr>
                        <td><input type="text" id="edit_nom_${i}" value="${c.nom}"></td>
                        <td><input type="text" id="edit_prenom_${i}" value="${c.prenom}"></td>
                        <td>
                            <select id="edit_spec_${i}">${buildCategoryOptions(c.spec)}</select>
                        </td>
                        <td class="cell-actions">
                            <button class="btn-green" onclick="enregistrerModificationConcurrent(${i})">Enregistrer</button>
                            <button class="btn-blue" onclick="annulerModificationConcurrent()">Annuler</button>
                        </td>
                    </tr>
                `;
            }

            return `<tr><td>${c.nom}</td><td>${c.prenom}</td><td>${c.spec}</td><td class="cell-actions"><button class="btn-blue" onclick="modifierConcurrent(${i})">Modifier</button><button class="btn-red" onclick="supprimerConcurrent(${i})">X</button></td></tr>`;
        }).join('');
    }
    const dos = document.querySelector('#tableDossards tbody');
    if(dos) dos.innerHTML = concurrents.map(c => `<tr><td>${c.nom} ${c.prenom}</td><td>${c.dossard||'-'}</td></tr>`).join('');

    const alerte = document.getElementById('alerteDossard');
    const btnTirage = document.getElementById('btnTirage');
    if (alerte) {
        const nbInscrits = concurrents.length;
        const nbDossards = concurrents.filter(c => Number.isFinite(c.dossard)).length;

        if (nbInscrits === 0) {
            alerte.textContent = 'Aucun inscrit';
            alerte.className = 'status-alert alert-wait';
        } else if (nbDossards === nbInscrits) {
            alerte.textContent = `Tirage effectué (${nbInscrits} dossards attribués)`;
            alerte.className = 'status-alert alert-ok';
        } else {
            alerte.textContent = `${nbInscrits} inscrit(s) - tirage en attente`;
            alerte.className = 'status-alert alert-wait';
        }
    }

    if (btnTirage) {
        const locked = isPointsEntryStarted();
        btnTirage.disabled = concurrents.length === 0 || locked;
        btnTirage.style.opacity = (concurrents.length === 0 || locked) ? '0.6' : '1';
        btnTirage.style.cursor = (concurrents.length === 0 || locked) ? 'not-allowed' : 'pointer';
        btnTirage.title = locked ? 'Tirage verrouillé: la saisie des points a déjà commencé.' : '';
    }

    if (alerte && isPointsEntryStarted()) {
        alerte.textContent = 'Tirage verrouillé: saisie des points déjà commencée.';
        alerte.className = 'status-alert alert-ko';
    }
}

function modifierConcurrent(index) {
    editingRowIndex = index;
    updateUI();
}

function enregistrerModificationConcurrent(index) {
    const concurrent = concurrents[index];
    if (!concurrent) return;

    const nomNet = (document.getElementById(`edit_nom_${index}`)?.value || '').trim().toUpperCase();
    const prenomNet = (document.getElementById(`edit_prenom_${index}`)?.value || '').trim();
    const specNet = normalizeSpec(document.getElementById(`edit_spec_${index}`)?.value || getDefaultCategory());

    if (!nomNet || !prenomNet) {
        alert('Nom et prénom obligatoires.');
        return;
    }

    concurrent.nom = nomNet;
    concurrent.prenom = prenomNet;
    concurrent.spec = specNet;
    editingRowIndex = -1;
    save();
    updateUI();
}

function annulerModificationConcurrent() {
    editingRowIndex = -1;
    updateUI();
}

function supprimerConcurrent(index) {
    const concurrent = concurrents[index];
    if (!concurrent) return;
    const ok = confirm(`Confirmer la suppression du concurrent : ${concurrent.nom} ${concurrent.prenom} ?`);
    if (!ok) return;
    concurrents.splice(index, 1);
    save();
    updateUI();
}

function attribuerDossards() {
    if (concurrents.length === 0) {
        alert('Aucun inscrit pour effectuer le tirage.');
        return;
    }
    if (isPointsEntryStarted()) {
        alert('Tirage aléatoire bloqué: des points ont déjà été saisis.');
        return;
    }
    if(concurrents.some(c=>c.dossard) && !confirm("Recommencer ?")) return;
    let nums = Array.from({length: concurrents.length}, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    concurrents.forEach((c, i) => c.dossard = nums[i]);
    save(); updateUI();
}

function ajouterPilote() {
    const nom = (document.getElementById('nom')?.value || '').trim().toUpperCase();
    const prenom = (document.getElementById('prenom')?.value || '').trim();
    const spec = normalizeSpec(document.getElementById('spec')?.value || getDefaultCategory());
    if (!nom || !prenom) {
        alert('Veuillez renseigner le nom et le prénom.');
        return;
    }
    const pilote = creerPilote(nom, prenom, spec);
    if (isPointsEntryStarted() && hasAnyAssignedDossard()) {
        pilote.dossard = getNextDossardNumber();
    }
    concurrents.push(pilote);
    document.getElementById('nom').value = '';
    document.getElementById('prenom').value = '';
    save();
    updateUI();

    if (pilote.dossard) {
        alert(`Concurrent ajouté avec le dossard n°${pilote.dossard}.`);
    }
}

function boutonMHE() {
    const doss = parseInt(document.querySelector('#Orientation .input-dossard')?.value || '0', 10);
    const p = concurrents.find(x => x.dossard === doss);
    if (!p) {
        alert('Aucun concurrent trouvé pour ce dossard.');
        return;
    }
    p.manualMhe = true;
    recalculerPointsConcurrent(p);
    save();
    alert(`Concurrent ${p.nom} ${p.prenom} mis hors épreuve.`);
    updateUI();
    chargerPilote('Orientation');
}

function parseChrono(t){ if(!t || !t.includes(':')) return 0; let p=t.split(':'); return (parseInt(p[0])*60)+parseFloat(p[1]); }
function parseHMS(t){
    if(!t || !t.includes(':')) return 0;
    const p = t.split(':').map(x => parseInt(x, 10) || 0);
    if (p.length === 3) return (p[0] * 3600) + (p[1] * 60) + p[2];
    if (p.length === 2) return (p[0] * 60) + p[1];
    return 0;
}
function calculerDureeHms(departSec, arriveeSec){
    if (departSec <= 0 || arriveeSec <= 0) return 0;
    return arriveeSec >= departSec ? (arriveeSec - departSec) : ((24 * 3600) - departSec + arriveeSec);
}
function formatHMS(totalSec){
    const sec = Math.max(0, Math.round(totalSec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}
function formatChrono(s){ if(!s) return "00:00"; let m=Math.floor(s/60), sec=Math.floor(s%60); return `${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`; }
function secondsToChrono(sec){ const s=Math.max(0, parseInt(sec||0,10)); const m=Math.floor(s/60), r=s%60; return `${m.toString().padStart(2,'0')}:${r.toString().padStart(2,'0')}`; }
function parseHHMM(t){ if(!t || !t.includes(':')) return 0; let p=t.split(':'); return (parseInt(p[0])*60)+parseInt(p[1]); }
function formatHHMM(m){ let h=Math.floor(m/60), min=m%60; return `${h.toString().padStart(2,'0')}:${min.toString().padStart(2,'0')}`; }
function changerRegion() { config.region = document.getElementById('choix_region').value; const img = document.getElementById('logo_region'); img.src = `logo_${config.region}.png`; save(); }
function resetApp(){ if(confirm("🚨 RESET ?")) { localStorage.clear(); location.reload(); } }