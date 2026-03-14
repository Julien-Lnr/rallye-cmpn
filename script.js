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
let tempImportData = null;
let editingRowIndex = -1;

const defaultConfig = { 
    pied: 30, cone: 5, atelier: 50, chute: 300, cp: 250, regu: 10, regu_f: 600, tir: 30, tir_retard: 1, 
    t_ideal: 30, region: 'paca', nb_bases: 2, o_dist_ideal: 100, o_tol_dist: 2, o_pen_dist: 100, pen_non_passage: 20000,
    tenue: 500, briefing: 2000, v_l: 20, v_f: 50, mhe_points: 100000,
    jury_president: '', jury_secretaire: '', jury_nb: 0, jury_noms: [], base_distances: []
};
let config = Object.assign({}, defaultConfig, JSON.parse(localStorage.getItem('rallyeConfig_2025')) || {});
if (!Array.isArray(config.jury_noms)) config.jury_noms = [];
if (!Array.isArray(config.base_distances)) config.base_distances = [];
config.jury_nb = Math.max(0, parseInt(config.jury_nb || 0, 10) || 0);

window.onload = () => { chargerConfigVisual(); updateUI(); refreshRuleLabels(); };

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

// === 5. IMPORTATION UNIVERSELLE (ODS, XLSX, CSV) ===
function importerInscriptions(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        tempImportData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        afficherSelecteurColonnes(tempImportData[0]);
    };
    reader.readAsArrayBuffer(file);
}

function afficherSelecteurColonnes(headers) {
    const container = document.getElementById('mappingContainer');
    container.innerHTML = `
        <div class="card" style="border: 2px solid var(--police-blue); padding:15px;">
            <h3>🔗 Correspondance des colonnes</h3>
            <div class="grid">
                <div><label>NOM :</label><select id="mapNom">${headers.map((h, i) => `<option value="${i}">${h}</option>`)}</select></div>
                <div><label>PRÉNOM :</label><select id="mapPrenom">${headers.map((h, i) => `<option value="${i}">${h}</option>`)}</select></div>
                <div><label>CATÉGORIE :</label><select id="mapSpec">${headers.map((h, i) => `<option value="${i}">${h}</option>`)}</select></div>
            </div>
            <button class="btn-green" style="margin-top:15px;" onclick="finaliserImportation()">Confirmer</button>
        </div>`;
    container.style.display = "block";
}

function finaliserImportation() {
    const idxNom = document.getElementById('mapNom').value, idxPrenom = document.getElementById('mapPrenom').value, idxSpec = document.getElementById('mapSpec').value;
    for (let i = 1; i < tempImportData.length; i++) {
        const row = tempImportData[i];
        if (row[idxNom]) {
            let cat = row[idxSpec] ? row[idxSpec].toString().toLowerCase() : "civil";
            cat = (cat.includes('pol') || cat.includes('titul')) ? "Police" : "Civil";
            concurrents.push(creerPilote(row[idxNom].toString().toUpperCase(), row[idxPrenom].toString(), cat));
        }
    }
    tempImportData = null; document.getElementById('mappingContainer').style.display = "none";
    save(); updateUI(); alert("Importation réussie !");
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
    const isPolice = document.getElementById('filtre_police').checked;
    let liste = isPolice ? concurrents.filter(c => c.spec === 'Police') : [...concurrents];

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

    document.getElementById('headerClassement').innerHTML = "<th>Rang</th><th>Dossard</th><th>Concurrent</th><th>Cat.</th><th>Points</th><th>Chrono Mani</th>";
    document.getElementById('bodyClassementSpecifique').innerHTML = liste.map((c, i) => `<tr><td>${i+1}</td><td>${c.dossard || '-'}</td><td>${c.nom} ${c.prenom}</td><td>${c.spec}</td><td><strong>${c.mhe ? `MHE (${getClassementPoints(c)})` : getClassementPoints(c)}</strong></td><td>${formatChrono(c.chrono)}</td></tr>`).join('');
    const classementLabel = type === 'Regul' ? 'Bases Chrono' : type;
    document.getElementById('titre_pdf').innerText = `Classement ${classementLabel} - ${isPolice ? 'POLICE' : 'SCRATCH'}`;
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

function exportFinalCSV() {
    XLSX.writeFile(XLSX.utils.table_to_book(document.getElementById("tableClassementSpecifique")), "Classement_Rallye.xlsx");
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
    config.base_distances = Array.from({ length: config.nb_bases }, (_, idx) => {
        const i = idx + 1;
        const inputValue = document.getElementById(`base_cfg_dist_${i}`)?.value;
        const fallback = Number(config.base_distances?.[idx] ?? 0);
        const parsed = parseFloat(inputValue ?? `${fallback}`);
        return Number.isFinite(parsed) ? parsed : 0;
    });
    save();
    genererChampsBases();
    refreshRuleLabels();
}

function chargerConfigVisual() {
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    };

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
    setValue('choix_region', config.region);
    setValue('jury_president', config.jury_president || '');
    setValue('jury_secretaire', config.jury_secretaire || '');
    setValue('jury_nb', config.jury_nb || 0);

    const img = document.getElementById('logo_region');
    if (img) img.src = `logo_${config.region}.png`;
    genererChampsBases();
    renderJuryInputs();
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
                            <select id="edit_spec_${i}">
                                <option value="Police" ${c.spec === 'Police' ? 'selected' : ''}>Police</option>
                                <option value="Civil" ${c.spec === 'Civil' ? 'selected' : ''}>Civil</option>
                            </select>
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
        btnTirage.disabled = concurrents.length === 0;
        btnTirage.style.opacity = concurrents.length === 0 ? '0.6' : '1';
        btnTirage.style.cursor = concurrents.length === 0 ? 'not-allowed' : 'pointer';
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
    const specNet = document.getElementById(`edit_spec_${index}`)?.value || 'Civil';

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
    if(concurrents.some(c=>c.dossard) && !confirm("Recommencer ?")) return;
    let nums = Array.from({length: concurrents.length}, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    concurrents.forEach((c, i) => c.dossard = nums[i]);
    save(); updateUI();
}

function ajouterPilote() {
    const nom = (document.getElementById('nom')?.value || '').trim().toUpperCase();
    const prenom = (document.getElementById('prenom')?.value || '').trim();
    const spec = document.getElementById('spec')?.value || 'Civil';
    if (!nom || !prenom) {
        alert('Veuillez renseigner le nom et le prénom.');
        return;
    }
    concurrents.push(creerPilote(nom, prenom, spec));
    document.getElementById('nom').value = '';
    document.getElementById('prenom').value = '';
    save();
    updateUI();
}

function exportInscriptions() {
    const lignes = [['Nom', 'Prénom', 'Catégorie']];
    concurrents.forEach(c => lignes.push([c.nom, c.prenom, c.spec]));
    const csv = lignes
        .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
        .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inscriptions_rallye.csv';
    a.click();
    URL.revokeObjectURL(url);
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