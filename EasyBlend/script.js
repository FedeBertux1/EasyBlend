'use strict';
/* =====================================================================
   EASYBLEND v3 – scultura 3D in Three.js r147, tutto lato client (nessun backend).
   Indice: 1 Config · 2 Scena · 3 Oggetti · 4 Undo/Maschera · 5 Pennelli
           6 Input scultura · 7 Trasformazione · 8 Import/Primitive
           9 UI · 10 Esportazione · 11 Loop
   UNITÀ: 1 unità di scena = 1 mm.
   CONCETTO CHIAVE: in modalità Scultura la mesh attiva ha matrice identità (le trasformazioni
   vengono "cotte" nei vertici, vedi bake()), quindi raycast, pennelli e simmetria lavorano
   in coordinate mondo (simmetria = piano X=0). In modalità Trasforma la mesh viene ricentrata
   (recenter) per avere il gizmo al centro dell'oggetto.
   ===================================================================== */

/* ---------- 1. CONFIGURAZIONE (valori da ritoccare) ---------- */
const CONFIG = {
  radius:   { min: 2, max: 80, value: 12, dec: 1 },   // raggio pennello in mm
  strength: { min: 0.01, max: 1, value: 0.5, dec: 2 },
  drawFactor: 0.06,     // Draw/Inflate: spostamento max per pennellata (× raggio × intensità)
  smoothFactor: 0.6, flattenFactor: 0.5, pinchFactor: 0.3,
  maskFactor: 0.35,     // velocità con cui la maschera si accumula
  maskDarkness: 0.7,    // quanto scuriscono i vertici mascherati (0-1)
  gridSize: 400, gridStep: 10,      // lato griglia e cella in mm
  startSize: 80,        // diametro della mesh iniziale in mm
  historyMax: 50,       // passi di undo
  gltfScale: 1000,      // glTF è in metri → ×1000 per avere mm (STL si assume già in mm)
  stlZUp: true,         // esporta STL con asse Z verso l'alto (slicer)
  kofiUrl: 'https://ko-fi.com/YOUR_NAME',   // ← metti qui il TUO link Ko-fi (pulsante "Sostieni il progetto")
  clayColor: 0xb5a79a, bgColor: 0x282828, accent: 0xE87D0D
};
const state = { mode: 'sculpt', tool: 'draw', radius: CONFIG.radius.value, strength: CONFIG.strength.value,
                symmetry: true, gizmo: 'translate', snap: false, gridStep: CONFIG.gridStep, uniform: true };
const $ = id => document.getElementById(id);
const I = new THREE.Matrix4();                       // matrice identità di confronto

/* ---------- UTILITÀ DI PERFORMANCE ---------- */
const debounce = (fn, ms) => { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; };   // esegue dopo una pausa
const rafThrottle = fn => { let busy = false; return (...a) => { if (busy) return; busy = true; requestAnimationFrame(() => { busy = false; fn(...a); }); }; };  // max 1 volta per frame
// Render on demand: si disegna solo per 1 s dopo ogni interazione (a riposo CPU/GPU/batteria ≈ 0)
let renderUntil = 0, dirtyWork = false;                  // dirtyWork: lavoro non esportato → avviso in uscita
const wake = () => { renderUntil = performance.now() + 1000; };
const markDirty = () => { dirtyWork = true; wake(); };
['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'input', 'change', 'click', 'drop']
  .forEach(ev => window.addEventListener(ev, wake, { passive: true, capture: true }));

/* ---------- i18n: dizionario (EN predefinito; chiavi mancanti → EN) ---------- */
const I18N = {
  en: { fMove: 'Position (mm)', fRotate: 'Rotation (°)', fScale: 'Size (mm)', mode: 'Move / Transform', undo: 'Undo', redo: 'Redo', radius: 'Radius (mm)', strength: 'Strength', sym: 'X Symmetry',
    draw: 'Draw', smooth: 'Smooth', grab: 'Grab', flatten: 'Flatten', inflate: 'Inflate', pinch: 'Pinch', mask: 'Mask',
    objects: 'Objects', import: 'Import…', reset: 'Reset scene', vis: 'Show / hide', del: 'Delete',
    newPrim: 'New primitive (mm)', box: 'Cube / Box', cylinder: 'Cylinder', cone: 'Cone', torus: 'Torus', uvsphere: 'UV Sphere', icosphere: 'IcoSphere', create: 'Create',
    active: 'Active object', move: 'Move', rotate: 'Rotate', scale: 'Scale', prop: 'Proportional scale', clearMask: 'Clear mask',
    grid: 'Grid', showGrid: 'Show grid', snap: 'Snap to grid', cell: 'Cell (mm)',
    view: 'View', clay: 'Matte clay', metal: 'Metallic (MatCap)', wax: 'Red wax (MatCap)', wire: 'Wireframe', focus: 'Focus on object',
    frameAll: 'Frame all', resetCam: 'Reset camera', shot: 'Screenshot (PNG)', export: 'Export (visible meshes, mm)',
    shortcuts: 'Keyboard shortcuts', close: 'Close', keyMode: 'Sculpt / Transform mode', keyInvert: 'Invert brush (hold)', keyDel: 'Delete object',
    errFormat: 'Unsupported format: use .glb, .gltf or .stl', errEmpty: 'No mesh found in the file.', errGltf: 'glTF error: ',
    skLine: 'Line', skArc: 'Arc (3 points)', skFace: 'Face', skPlane: 'Work plane', skLen: 'Length (mm)', skAng: 'Angle (°)', skDia: 'Diameter (mm)',
    skHint2: 'Pick a plane (or Face, then click a mesh face). Line: click points, close on the first point. Arc: start, middle, end. Circle: center, then edge. Tab = type exact values, Enter = confirm, Esc = cancel.',
    objects: 'Objects & scene', newPrim: 'Primitives & 2D sketch', active: 'Transform & size', grid: 'Environment & grid', view: 'View & materials',
    donate: 'Support the project', legalBtn: 'Info & Terms', legalTitle: 'Info, Terms & Privacy',
    lg1h: 'Privacy & data', lg1: `EasyBlend runs entirely in your browser (client side). The app itself does not collect, track or send any personal data, profiling cookies or 3D models to external servers. Your preferences (e.g. language) are stored only in your browser. The optional Ko-fi donation link opens a third-party site with its own policies.`,
    lg2h: 'Disclaimer (AS IS)', lg2: `The application is provided free of charge “AS IS”, without warranties of any kind. The developer is not liable for browser crashes, incompatibilities or loss of unsaved data. Please export your work often.`,
    lg3h: 'Intellectual property', lg3: `All 3D models you create, edit and export with EasyBlend belong 100% to you, for any personal or commercial use.`,
    tBuild: 'Build', tDeform: 'Deform', tDetail: 'Detail', tMask: 'Mask',
    drawSharp: 'Draw Sharp', clayB: 'Clay', clayStrips: 'Clay Strips', layer: 'Layer', blob: 'Blob', crease: 'Crease', scrape: 'Scrape', fill: 'Fill', deepen: 'Deepen', snake: 'Snake Hook', nudge: 'Nudge', twist: 'Rotate',
    sketch: '2D Sketch', skRect: 'Rectangle', skCircle: 'Circle', skPoly: 'Polygon', skThick: 'Thickness (mm)', skExtrude: 'Extrude new body', skCut: 'Cut (pocket)',
    skHint: 'Click a face (or the grid) and draw. Polygon: click points, Enter or double-click to close. Cut digs a pocket in the active mesh.' },
  it: { fMove: 'Posizione (mm)', fRotate: 'Rotazione (°)', fScale: 'Dimensioni (mm)', mode: 'Sposta / Trasforma', undo: 'Annulla', redo: 'Ripristina', radius: 'Raggio (mm)', strength: 'Intensità', sym: 'Simmetria X',
    draw: 'Disegna', smooth: 'Leviga', grab: 'Sposta', flatten: 'Appiattisci', inflate: 'Gonfia', pinch: 'Pizzica', mask: 'Maschera',
    objects: 'Oggetti', import: 'Importa…', reset: 'Reset scena', vis: 'Mostra / nascondi', del: 'Elimina',
    newPrim: 'Nuova primitiva (mm)', box: 'Cubo / Parallelepipedo', cylinder: 'Cilindro', cone: 'Cono', torus: 'Toro', create: 'Crea',
    active: 'Oggetto attivo', move: 'Sposta', rotate: 'Ruota', scale: 'Scala', prop: 'Scala proporzionale', clearMask: 'Cancella maschera',
    grid: 'Griglia', showGrid: 'Mostra griglia', snap: 'Snap alla griglia', cell: 'Cella (mm)',
    view: 'Vista', clay: 'Argilla opaca', metal: 'Metallico (MatCap)', wax: 'Cera rossa (MatCap)', wire: 'Wireframe', focus: "Focus sull'oggetto",
    frameAll: 'Inquadra tutto', resetCam: 'Reimposta fotocamera', shot: 'Screenshot (PNG)', export: 'Esporta (mesh visibili, mm)',
    shortcuts: 'Scorciatoie da tastiera', close: 'Chiudi', keyMode: 'Modalità Scultura / Trasforma', keyInvert: 'Inverti pennello (tieni premuto)', keyDel: 'Elimina oggetto',
    errFormat: 'Formato non supportato: usa .glb, .gltf o .stl', errEmpty: 'Nessuna mesh trovata nel file.', errGltf: 'Errore glTF: ',
    skLine: 'Linea', skArc: 'Arco (3 punti)', skFace: 'Faccia', skPlane: 'Piano di lavoro', skLen: 'Lunghezza (mm)', skAng: 'Angolo (°)', skDia: 'Diametro (mm)',
    skHint2: 'Scegli un piano (o Faccia, poi clicca su una faccia della mesh). Linea: clic sui punti, chiudi sul primo punto. Arco: inizio, punto intermedio, fine. Cerchio: centro, poi bordo. Tab = valori esatti, Invio = conferma, Esc = annulla.',
    objects: 'Oggetti e scena', newPrim: 'Primitive e schizzi 2D', active: 'Trasformazioni e dimensioni', grid: 'Ambiente e griglia', view: 'Vista e materiali',
    donate: 'Sostieni il progetto', legalBtn: 'Info e Termini', legalTitle: 'Info, Termini e Privacy',
    lg1h: 'Privacy e dati', lg1: `EasyBlend funziona interamente nel tuo browser (lato client). L'app stessa non raccoglie, traccia né invia a server esterni dati personali, cookie di profilazione o modelli 3D. Le preferenze (ad es. la lingua) restano solo nel tuo browser. Il link di donazione Ko-fi, facoltativo, apre un sito di terzi con le proprie politiche.`,
    lg2h: 'Esclusione di responsabilità (AS IS)', lg2: `L'applicazione è fornita gratuitamente “così com'è”, senza garanzie di alcun tipo. Lo sviluppatore non è responsabile di arresti anomali del browser, incompatibilità o perdite di dati non salvati. Esporta spesso i tuoi lavori.`,
    lg3h: 'Proprietà intellettuale', lg3: `Tutti i modelli 3D creati, modificati ed esportati con EasyBlend appartengono al 100% a te, per qualsiasi uso personale o commerciale.`,
    tBuild: 'Crea', tDeform: 'Deforma', tDetail: 'Dettaglio', tMask: 'Maschera',
    drawSharp: 'Disegna netto', clayB: 'Argilla', clayStrips: 'Strisce argilla', layer: 'Strato', blob: 'Blob', crease: 'Piega', scrape: 'Raschia', fill: 'Riempi', deepen: 'Scava', snake: 'Gancio', nudge: 'Spingi', twist: 'Ruota',
    sketch: 'Schizzo 2D', skRect: 'Rettangolo', skCircle: 'Cerchio', skPoly: 'Poligono', skThick: 'Spessore (mm)', skExtrude: 'Estrudi nuovo corpo', skCut: 'Taglia (scavo)',
    skHint: 'Clicca su una faccia (o sulla griglia) e disegna. Poligono: clic sui punti, Invio o doppio clic per chiudere. Il taglio scava una tasca nella mesh attiva.' },
  es: { fMove: 'Posición (mm)', fRotate: 'Rotación (°)', fScale: 'Tamaño (mm)', mode: 'Mover / Transformar', undo: 'Deshacer', redo: 'Rehacer', radius: 'Radio (mm)', strength: 'Intensidad', sym: 'Simetría X',
    draw: 'Dibujar', smooth: 'Suavizar', grab: 'Mover', flatten: 'Aplanar', inflate: 'Inflar', pinch: 'Pellizcar', mask: 'Máscara',
    objects: 'Objetos', import: 'Importar…', reset: 'Reiniciar escena', vis: 'Mostrar / ocultar', del: 'Eliminar',
    newPrim: 'Nueva primitiva (mm)', box: 'Cubo / Prisma', cylinder: 'Cilindro', cone: 'Cono', torus: 'Toro', create: 'Crear',
    active: 'Objeto activo', move: 'Mover', rotate: 'Rotar', scale: 'Escalar', prop: 'Escala proporcional', clearMask: 'Borrar máscara',
    grid: 'Cuadrícula', showGrid: 'Mostrar cuadrícula', snap: 'Ajustar a la cuadrícula', cell: 'Celda (mm)',
    view: 'Vista', clay: 'Arcilla mate', metal: 'Metálico (MatCap)', wax: 'Cera roja (MatCap)', wire: 'Estructura alámbrica', focus: 'Enfocar objeto',
    frameAll: 'Encuadrar todo', resetCam: 'Restablecer cámara', shot: 'Captura (PNG)', export: 'Exportar (mallas visibles, mm)',
    shortcuts: 'Atajos de teclado', close: 'Cerrar', keyMode: 'Modo Escultura / Transformar', keyInvert: 'Invertir pincel (mantener)', keyDel: 'Eliminar objeto',
    errFormat: 'Formato no compatible: usa .glb, .gltf o .stl', errEmpty: 'No se encontró ninguna malla en el archivo.', errGltf: 'Error de glTF: ',
    skLine: 'Línea', skArc: 'Arco (3 puntos)', skFace: 'Cara', skPlane: 'Plano de trabajo', skLen: 'Longitud (mm)', skAng: 'Ángulo (°)', skDia: 'Diámetro (mm)',
    skHint2: 'Elige un plano (o Cara y haz clic en una cara de la malla). Línea: clic en los puntos, cierra en el primero. Arco: inicio, punto medio, fin. Círculo: centro y luego borde. Tab = valores exactos, Intro = confirmar, Esc = cancelar.',
    objects: 'Objetos y escena', newPrim: 'Primitivas y bocetos 2D', active: 'Transformación y tamaño', grid: 'Entorno y cuadrícula', view: 'Vista y materiales',
    donate: 'Apoya el proyecto', legalBtn: 'Info y Términos', legalTitle: 'Info, Términos y Privacidad',
    lg1h: 'Privacidad y datos', lg1: `EasyBlend funciona íntegramente en tu navegador (lado cliente). La aplicación no recopila, rastrea ni envía a servidores externos datos personales, cookies de perfilado ni modelos 3D. Las preferencias (p. ej. el idioma) solo se guardan en tu navegador. El enlace opcional de donación de Ko-fi abre un sitio de terceros con sus propias políticas.`,
    lg2h: 'Exención de responsabilidad (AS IS)', lg2: `La aplicación se ofrece gratuitamente «tal cual», sin garantías de ningún tipo. El desarrollador no se responsabiliza de cierres del navegador, incompatibilidades ni pérdida de datos no guardados. Exporta tu trabajo con frecuencia.`,
    lg3h: 'Propiedad intelectual', lg3: `Todos los modelos 3D que crees, edites y exportes con EasyBlend son 100 % tuyos, para cualquier uso personal o comercial.`,
    tBuild: 'Crear', tDeform: 'Deformar', tDetail: 'Detalle', tMask: 'Máscara',
    drawSharp: 'Dibujo nítido', clayB: 'Arcilla', clayStrips: 'Tiras de arcilla', layer: 'Capa', blob: 'Blob', crease: 'Pliegue', scrape: 'Raspar', fill: 'Rellenar', deepen: 'Ahondar', snake: 'Gancho', nudge: 'Empujar', twist: 'Rotar',
    sketch: 'Boceto 2D', skRect: 'Rectángulo', skCircle: 'Círculo', skPoly: 'Polígono', skThick: 'Grosor (mm)', skExtrude: 'Extruir nuevo cuerpo', skCut: 'Cortar (vaciado)',
    skHint: 'Haz clic en una cara (o en la cuadrícula) y dibuja. Polígono: clic en los puntos, Intro o doble clic para cerrar. El corte vacía una cavidad en la malla activa.' },
  fr: { fMove: 'Position (mm)', fRotate: 'Rotation (°)', fScale: 'Taille (mm)', mode: 'Déplacer / Transformer', undo: 'Annuler', redo: 'Rétablir', radius: 'Rayon (mm)', strength: 'Intensité', sym: 'Symétrie X',
    draw: 'Dessiner', smooth: 'Lisser', grab: 'Déplacer', flatten: 'Aplatir', inflate: 'Gonfler', pinch: 'Pincer', mask: 'Masque',
    objects: 'Objets', import: 'Importer…', reset: 'Réinitialiser la scène', vis: 'Afficher / masquer', del: 'Supprimer',
    newPrim: 'Nouvelle primitive (mm)', box: 'Cube / Pavé', cylinder: 'Cylindre', cone: 'Cône', torus: 'Tore', create: 'Créer',
    active: 'Objet actif', move: 'Déplacer', rotate: 'Pivoter', scale: 'Échelle', prop: 'Échelle proportionnelle', clearMask: 'Effacer le masque',
    grid: 'Grille', showGrid: 'Afficher la grille', snap: 'Aimanter à la grille', cell: 'Cellule (mm)',
    view: 'Vue', clay: 'Argile mate', metal: 'Métallique (MatCap)', wax: 'Cire rouge (MatCap)', wire: 'Fil de fer', focus: "Cadrer l'objet",
    frameAll: 'Tout cadrer', resetCam: 'Réinitialiser la caméra', shot: 'Capture (PNG)', export: 'Exporter (maillages visibles, mm)',
    shortcuts: 'Raccourcis clavier', close: 'Fermer', keyMode: 'Mode Sculpture / Transformation', keyInvert: 'Inverser le pinceau (maintenir)', keyDel: "Supprimer l'objet",
    errFormat: 'Format non pris en charge : utilisez .glb, .gltf ou .stl', errEmpty: 'Aucun maillage trouvé dans le fichier.', errGltf: 'Erreur glTF : ',
    skLine: 'Ligne', skArc: 'Arc (3 points)', skFace: 'Face', skPlane: 'Plan de travail', skLen: 'Longueur (mm)', skAng: 'Angle (°)', skDia: 'Diamètre (mm)',
    skHint2: 'Choisissez un plan (ou Face, puis cliquez sur une face du maillage). Ligne : cliquez les points, fermez sur le premier. Arc : début, milieu, fin. Cercle : centre puis bord. Tab = valeurs exactes, Entrée = valider, Échap = annuler.',
    objects: 'Objets et scène', newPrim: 'Primitives et croquis 2D', active: 'Transformation et dimensions', grid: 'Environnement et grille', view: 'Vue et matériaux',
    donate: 'Soutenir le projet', legalBtn: 'Infos et Conditions', legalTitle: 'Infos, Conditions et Confidentialité',
    lg1h: 'Confidentialité et données', lg1: `EasyBlend fonctionne entièrement dans votre navigateur (côté client). L'application ne collecte, ne suit ni n'envoie à des serveurs externes de données personnelles, de cookies de profilage ou de modèles 3D. Les préférences (p. ex. la langue) restent uniquement dans votre navigateur. Le lien de don Ko-fi, facultatif, ouvre un site tiers avec ses propres politiques.`,
    lg2h: 'Exclusion de responsabilité (AS IS)', lg2: `L'application est fournie gratuitement « en l'état », sans garantie d'aucune sorte. Le développeur n'est pas responsable des plantages du navigateur, des incompatibilités ni de la perte de données non enregistrées. Exportez régulièrement votre travail.`,
    lg3h: 'Propriété intellectuelle', lg3: `Tous les modèles 3D que vous créez, modifiez et exportez avec EasyBlend vous appartiennent à 100 %, pour tout usage personnel ou commercial.`,
    tBuild: 'Créer', tDeform: 'Déformer', tDetail: 'Détail', tMask: 'Masque',
    drawSharp: 'Dessin net', clayB: 'Argile', clayStrips: `Bandes d'argile`, layer: 'Couche', blob: 'Blob', crease: 'Pli', scrape: 'Racler', fill: 'Remplir', deepen: 'Creuser', snake: 'Crochet', nudge: 'Pousser', twist: 'Pivoter',
    sketch: 'Croquis 2D', skRect: 'Rectangle', skCircle: 'Cercle', skPoly: 'Polygone', skThick: 'Épaisseur (mm)', skExtrude: 'Extruder un nouveau corps', skCut: 'Couper (évidement)',
    skHint: 'Cliquez sur une face (ou la grille) et dessinez. Polygone : cliquez les points, Entrée ou double-clic pour fermer. La coupe creuse une cavité dans le maillage actif.' }
};
let lang = 'en';
const t = k => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;

/* ---------- 2. SCENA, CAMERA, LUCI, GRIGLIA, MATERIALI ---------- */
const viewport = $('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.bgColor);
const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
camera.position.set(0, 130, 260);
scene.add(camera);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);
const canvas = renderer.domElement;

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);   // figlia della camera: l'ombra segue la vista
keyLight.position.set(1, 1.5, 2);
camera.add(keyLight);

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); wake();
}
new ResizeObserver(rafThrottle(resize)).observe(viewport);   // throttling: un resize per frame

// Griglia in mm sul piano Y=0 (la cella si cambia dal pannello)
let grid;
function buildGrid() {
  if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }   // niente GPU leak a ogni cambio cella
  grid = new THREE.GridHelper(CONFIG.gridSize, Math.round(CONFIG.gridSize / state.gridStep), 0x666666, 0x3c3c3c);
  grid.visible = $('grid-vis').checked;
  scene.add(grid);
}

// MatCap procedurale: gradiente radiale disegnato su canvas (nessun file esterno)
function matcap(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(48, 44, 4, 64, 64, 64);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
// Materiali creati solo quando servono e rilasciati con dispose() quando si cambia (anche la texture MatCap).
// vertexColors: true → la maschera (vertici più scuri) è visibile con ogni materiale
const MAT_DEFS = {
  clay:  () => new THREE.MeshStandardMaterial({ color: CONFIG.clayColor, roughness: 0.9, metalness: 0, vertexColors: true }),
  metal: () => new THREE.MeshMatcapMaterial({ matcap: matcap(['#ffffff', '#c9ced6', '#6b7078', '#1c1e22']), vertexColors: true }),
  wax:   () => new THREE.MeshMatcapMaterial({ matcap: matcap(['#ffb3a7', '#d6453a', '#8e1f18', '#3a0805']), vertexColors: true })
};
let material = MAT_DEFS.clay();
function setMaterial(key) {
  const old = material;
  material = MAT_DEFS[key](); material.wireframe = $('wireframe').checked;
  recs.forEach(r => r.mesh.material = material);
  if (old.matcap) old.matcap.dispose();
  old.dispose();
}

// Cursore del pennello (anello) e riquadro di selezione dell'oggetto attivo
const cursor = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64),
  new THREE.MeshBasicMaterial({ color: CONFIG.accent, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
cursor.renderOrder = 10; cursor.visible = false; scene.add(cursor);
const selBox = new THREE.Box3Helper(new THREE.Box3(), CONFIG.accent); selBox.visible = false; scene.add(selBox);
function refreshSel() {
  selBox.visible = !!active && active.mesh.visible;
  if (selBox.visible) selBox.box.setFromObject(active.mesh);
}

/* ---------- 3. OGGETTI (multi-mesh) ---------- */
const recs = [];          // ogni record: { name, mesh, geo, mask (Float32 per vertice), nb (adiacenze, lazy) }
let active = null;

// Rende una geometria "scolpibile": solo posizioni, vertici fusi (indicizzata), normali ricalcolate
function prep(g) {
  Object.keys(g.attributes).forEach(k => k !== 'position' && g.deleteAttribute(k));
  g.morphAttributes = {};
  const src = g;
  g = THREE.BufferGeometryUtils.mergeVertices(g, 1e-4);
  src.dispose();                                          // libera la geometria sorgente (STL/glTF/primitiva)
  g.computeVertexNormals();
  return g;
}

// Posiziona un gruppo di geometrie sul piano griglia (min Y = 0), a destra degli oggetti esistenti
function placeGeos(gs) {
  const b = new THREE.Box3(), all = new THREE.Box3();
  gs.forEach(g => { g.computeBoundingBox(); b.union(g.boundingBox); });
  recs.forEach(r => all.expandByObject(r.mesh));
  const c = b.getCenter(new THREE.Vector3()), x = recs.length ? all.max.x + 10 + (b.max.x - b.min.x) / 2 : 0;
  gs.forEach(g => g.translate(x - c.x, -b.min.y, -c.z));
}

// items: [{geo, name}], dims: [x,y,z] mm opzionale (scala la prima geometria alle dimensioni reali)
function spawn(items, dims, keep) {   // keep=true: non riposizionare sulla griglia (usato dall'estrusione degli schizzi)
  const gs = items.map(o => prep(o.geo));
  if (dims) {
    gs[0].computeBoundingBox();
    const s = gs[0].boundingBox.getSize(new THREE.Vector3());
    gs[0].scale(dims[0] / (s.x || 1), dims[1] / (s.y || 1), dims[2] / (s.z || 1));
    gs[0].computeVertexNormals();
  }
  if (!keep) placeGeos(gs);
  gs.forEach((geo, k) => {
    const n = geo.attributes.position.count, col = new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3);
    col.setUsage(THREE.DynamicDrawUsage);                          // colori = maschera
    geo.setAttribute('color', col);
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);      // buffer aggiornati di continuo
    geo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    const mesh = new THREE.Mesh(geo, material); scene.add(mesh);
    mesh.rotation.order = 'YZX';                           // = Euler XYZ di Blender nel sistema Z-up (vedi UI_AXIS); va impostato a rotazione zero
    recs.push({ name: items[k].name, mesh, geo, mask: new Float32Array(n), nb: null });
  });
  markDirty(); setActive(recs[recs.length - 1]);
}

// "Cuoce" posizione/rotazione/scala dentro i vertici → mesh con matrice identità (serve alla scultura)
function bake(rec) {
  const m = rec.mesh; m.updateMatrix();
  if (m.matrix.equals(I)) return;
  rec.geo.applyMatrix4(m.matrix); rec.bb = null;
  m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
  rec.geo.computeBoundingSphere(); clearHistory();
}
// Sposta l'origine al centro del bounding box (gizmo centrato sull'oggetto)
function recenter(rec) {
  const m = rec.mesh; m.updateMatrix();
  if (!m.matrix.equals(I)) return;
  rec.geo.computeBoundingBox();
  const c = rec.geo.boundingBox.getCenter(new THREE.Vector3());
  if (c.lengthSq() < 1e-12) return;
  rec.geo.translate(-c.x, -c.y, -c.z); m.position.copy(c); rec.bb = null; rec.geo.computeBoundingSphere(); clearHistory();
}

function setActive(rec) {
  active = rec || null;
  if (active) state.mode === 'sculpt' ? bake(active) : recenter(active);
  attachGizmo(); refreshSel(); refreshList(); syncDims();
}
function removeMesh(rec) {
  scene.remove(rec.mesh); rec.geo.dispose(); recs.splice(recs.indexOf(rec), 1);   // il materiale è condiviso: non va eliminato qui
  [undoStack, redoStack].forEach(st => { for (let i = st.length - 1; i >= 0; i--) if (st[i].rec === rec) st.splice(i, 1); });   // libera i buffer di undo
  markDirty();
  if (active === rec) setActive(recs[recs.length - 1]); else refreshList();
}
function resetScene() {
  [...recs].forEach(removeMesh); clearHistory();
  spawn([{ geo: new THREE.IcosahedronGeometry(0.5, 40), name: 'IcoSphere' }], Array(3).fill(CONFIG.startSize));
  focusActive();
}

/* ---------- Campi X/Y/Z contestuali: cambiano significato col gizmo attivo ----------
   Sposta  → posizione del centro dell'oggetto (mm, coordinate mondo)
   Ruota   → rotazione Euler XYZ in GRADI (JS converte da/verso radianti)
   Scala   → dimensioni vere in mm (geometria × scala; l'unica modalità che cambia le proporzioni)
   Binding bidirezionale: UI → mesh (applyField, evento 'input') e mesh → UI (syncDims, chiamata anche dal gizmo). */
const FIELD_IDS = ['ax', 'ay', 'az'], DEG = 180 / Math.PI;
/* Assi dell'INTERFACCIA = Z verso l'alto, Y in profondità sul piano (come Blender, slicer e l'export STL).
   Three.js invece ha Y verso l'alto. Campo UI i → asse Three.js UI_AXIS[i], con segno UI_SIGN[i] per posizione e rotazione:
   X→x · Y→z (segno -) · Z→y. Le dimensioni (scala) non hanno segno: scambio puro di assi. */
const UI_AXIS = ['x', 'z', 'y'], UI_SIGN = [1, -1, 1];
function geoBox(rec) {                                      // box locale della geometria (in cache)
  if (!rec.bb) { rec.geo.computeBoundingBox(); rec.bb = rec.geo.boundingBox.clone(); }
  return rec.bb;
}
const worldCenter = rec => { rec.mesh.updateWorldMatrix(true, false); return geoBox(rec).getCenter(new THREE.Vector3()).applyMatrix4(rec.mesh.matrixWorld); };
function objSize(rec) {                                     // dimensioni locali × |scala|: la rotazione non le falsa
  const k = rec.mesh.scale;
  return geoBox(rec).getSize(new THREE.Vector3()).multiply(new THREE.Vector3(Math.abs(k.x), Math.abs(k.y), Math.abs(k.z)));
}
function fieldValues() {                                    // valori da mostrare per il gizmo attivo (mesh → UI)
  const g = state.gizmo, src = g === 'rotate' ? active.mesh.rotation : g === 'scale' ? objSize(active) : worldCenter(active);
  return UI_AXIS.map((a, i) => src[a] * (g === 'scale' ? 1 : UI_SIGN[i]) * (g === 'rotate' ? DEG : 1));   // rotazione: radianti → gradi
}
function syncDims() {                                       // mesh → UI (non tocca il campo in cui si sta digitando)
  const v = active ? fieldValues() : null;
  FIELD_IDS.forEach((id, i) => {
    const el = $(id); el.disabled = !active;
    if (!active) el.value = '';
    else if (document.activeElement !== el) el.value = String(+v[i].toFixed(2));
  });
}
function updateFieldMeta() {                                // titolo, passo e vincoli dei campi secondo il gizmo
  const g = state.gizmo;
  $('field-title').textContent = t({ translate: 'fMove', rotate: 'fRotate', scale: 'fScale' }[g]);
  FIELD_IDS.forEach(id => {
    const el = $(id); el.step = g === 'rotate' ? 1 : 0.1;
    if (g === 'scale') el.min = 0.1; else el.removeAttribute('min');   // le dimensioni devono essere > 0
  });
  $('uniform').closest('label').hidden = g !== 'scale';     // "proporzionale" ha senso solo in Scala
}
function applyField(i, value) {                             // UI → mesh
  if (!active || !Number.isFinite(value)) return;           // campo vuoto / non valido: ignora
  if (state.mode !== 'transform') setMode('transform');     // editare un campo = passare alla modalità Trasforma
  const m = active.mesh, a = UI_AXIS[i], sg = UI_SIGN[i];     // a = asse Three.js corrispondente al campo UI
  if (state.gizmo === 'translate') m.position[a] += value * sg - worldCenter(active)[a];
  else if (state.gizmo === 'rotate') m.rotation[a] = sg * value / DEG;     // gradi → radianti
  else {
    const g = geoBox(active).getSize(new THREE.Vector3());
    if (!(value > 0) || !(g[a] > 1e-9)) return;
    if (state.uniform) m.scale.multiplyScalar(value / objSize(active)[a]); // proporzioni mantenute
    else m.scale[a] = Math.sign(m.scale[a] || 1) * value / g[a];
  }
  m.updateMatrixWorld(); refreshSel(); syncDims(); markDirty();
}

// Inquadra un Box3 mantenendo la direzione di vista corrente
function frameBox(b) {
  if (b.isEmpty()) return;
  const c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2 || 1;
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1);
  controls.update(); wake();
}
const focusActive = () => active && frameBox(new THREE.Box3().setFromObject(active.mesh));   // tasto F
function frameAll() {                                       // tasto Home: tutte le mesh visibili
  const b = new THREE.Box3(); recs.forEach(r => r.mesh.visible && b.expandByObject(r.mesh)); frameBox(b);
}
function resetCamera() {                                    // posa iniziale della fotocamera
  camera.position.set(0, 130, 260); controls.target.set(0, 40, 0); controls.update(); wake();
}

/* ---------- 4. UNDO/REDO E MASCHERA ---------- */
// Ogni pennellata salva i vertici toccati (prima/dopo): leggero, niente copie dell'intera mesh
const undoStack = [], redoStack = [];
function clearHistory() { undoStack.length = redoStack.length = 0; }

function touch(set) {                                       // salva lo stato "prima" dei vertici nuovi della pennellata
  const P = active.geo.attributes.position.array, s = stroke.saved;
  for (const i of set.idx) if (!s.has(i)) s.set(i, [P[3 * i], P[3 * i + 1], P[3 * i + 2], active.mask[i]]);
}
function pushHistory() {
  const s = stroke.saved, rec = stroke.rec;
  if (!s.size) return;
  const idx = [...s.keys()], P = rec.geo.attributes.position.array;
  const before = new Float32Array(idx.length * 4), after = new Float32Array(idx.length * 4);
  idx.forEach((i, j) => {
    before.set(s.get(i), 4 * j); after.set([P[3 * i], P[3 * i + 1], P[3 * i + 2], rec.mask[i]], 4 * j);
  });
  undoStack.push({ rec, idx, before, after }); redoStack.length = 0;
  if (undoStack.length > CONFIG.historyMax) undoStack.shift();
}
function stepHistory(from, to, key) {
  const e = from.pop();
  if (!e) return;
  if (!recs.includes(e.rec)) return stepHistory(from, to, key);   // mesh eliminata: salta
  const d = e[key], P = e.rec.geo.attributes.position.array;
  e.idx.forEach((i, j) => { P.set([d[4 * j], d[4 * j + 1], d[4 * j + 2]], 3 * i); e.rec.mask[i] = d[4 * j + 3]; setColor(e.rec, i); });
  e.rec.geo.attributes.color.needsUpdate = true; commit(e.rec); to.push(e); refreshSel(); syncDims();
}
const undo = () => stepHistory(undoStack, redoStack, 'before');
const redo = () => stepHistory(redoStack, undoStack, 'after');

function setColor(rec, i) {                                 // vertice mascherato = grigio più scuro
  const v = 1 - CONFIG.maskDarkness * rec.mask[i];
  rec.geo.attributes.color.setXYZ(i, v, v, v);
}
function commit(rec) {
  rec.bb = null;                                            // cache del box locale non più valida                                      // aggiorna buffer, normali (luce) e bounding sphere (raycast)
  rec.geo.attributes.position.needsUpdate = true;
  rec.geo.computeVertexNormals();                           // O(facce): per mesh >100k facce conviene limitarlo alla zona toccata
  rec.geo.computeBoundingSphere();
}

/* ---------- 5. PENNELLI ---------- */
function makeCenters(p) {                                   // con simmetria: punto colpito + specchio rispetto a X=0
  const c = [p.clone()];
  if (state.symmetry) c.push(new THREE.Vector3(-p.x, p.y, p.z));
  return c;
}
/* Vertici nel raggio con falloff morbido (1 - d²/r²)². Ogni vertice va al centro che lo influenza di più
   (mai toccato due volte vicino al piano di simmetria). La maschera riduce il peso (useMask=false per il pennello Mask). */
function gather(centers, useMask = true, exp = 2) {   // exp: durezza del falloff (più alto = bordo più netto)
  const P = active.geo.attributes.position.array, M = active.mask, r2 = state.radius ** 2, set = { idx: [], w: [], c: [] };
  for (let i = 0, n = P.length / 3; i < n; i++) {
    const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
    let best = 0, bk = -1;
    for (let k = 0; k < centers.length; k++) {
      const dx = x - centers[k].x, dy = y - centers[k].y, dz = z - centers[k].z;
      const t = 1 - (dx * dx + dy * dy + dz * dz) / r2;
      if (t > 0 && t ** exp > best) { best = t ** exp; bk = k; }
    }
    const w = useMask ? best * (1 - M[i]) : best;
    if (bk >= 0 && w > 0) { set.idx.push(i); set.w.push(w); set.c.push(bk); }
  }
  return set;
}
function areaData(set, nC) {                                // normale e posizione media pesate, per centro
  const Nr = active.geo.attributes.normal.array, P = active.geo.attributes.position.array;
  const N = [], A = [], W = new Array(nC).fill(0);
  for (let k = 0; k < nC; k++) { N.push(new THREE.Vector3()); A.push(new THREE.Vector3()); }
  set.idx.forEach((i, j) => {
    const k = set.c[j], w = set.w[j];
    N[k].x += Nr[3 * i] * w; N[k].y += Nr[3 * i + 1] * w; N[k].z += Nr[3 * i + 2] * w;
    A[k].x += P[3 * i] * w;  A[k].y += P[3 * i + 1] * w;  A[k].z += P[3 * i + 2] * w; W[k] += w;
  });
  for (let k = 0; k < nC; k++) { N[k].normalize(); if (W[k] > 0) A[k].divideScalar(W[k]); }
  return { N, A };
}
function neighbors(rec) {                                   // adiacenze costruite al primo uso di Smooth
  if (rec.nb) return rec.nb;
  const idx = rec.geo.index.array, sets = Array.from({ length: rec.geo.attributes.position.count }, () => new Set());
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b);
  }
  return rec.nb = sets.map(s => Int32Array.from(s));
}

/* Falloff per pennello (default 2) e pennelli "a trascinamento" (set di vertici legato al movimento del mouse) */
const BRUSH_EXP = { drawSharp: 4, clayStrips: 1, crease: 3, deepen: 3, scrape: 1.5, fill: 1.5 };
const DRAG_TOOLS = ['grab', 'snake'];
const pos = () => active.geo.attributes.position.array, nrm = () => active.geo.attributes.normal.array;
const amt = () => state.radius * CONFIG.drawFactor * state.strength;            // spostamento base per pennellata
const addTo = (P, i, v, f) => { P[3 * i] += v.x * f; P[3 * i + 1] += v.y * f; P[3 * i + 2] += v.z * f; };

function push(set, { area }, k) {                           // lungo la normale media: Draw, Draw Sharp, Deepen
  const P = pos(); set.idx.forEach((i, j) => addTo(P, i, area.N[set.c[j]], amt() * k * set.w[j]));
}
function infl(set, { invert }, k) {                         // lungo la normale di OGNI vertice: Inflate/Deflate, Blob
  const P = pos(), N = nrm(), a = amt() * k * (invert ? -1 : 1);
  set.idx.forEach((i, j) => { const f = a * set.w[j]; P[3 * i] += N[3 * i] * f; P[3 * i + 1] += N[3 * i + 1] * f; P[3 * i + 2] += N[3 * i + 2] * f; });
}
function sweep(set, { area }, mode, h = 0) {                // verso il piano medio (+h): both=Flatten · above=Scrape · below=Fill · lift=Clay (solo ciò che sta sotto quota h)
  const P = pos();
  set.idx.forEach((i, j) => {
    const k = set.c[j], n = area.N[k], p = area.A[k];
    const d = (P[3 * i] - p.x) * n.x + (P[3 * i + 1] - p.y) * n.y + (P[3 * i + 2] - p.z) * n.z - h;
    if ((mode === 'above' && d < 0) || (mode === 'below' && d > 0) || (mode === 'lift' && d > 0)) return;
    addTo(P, i, n, -d * set.w[j] * state.strength * CONFIG.flattenFactor);
  });
}
function pull(set, { area, centers, invert }, tang, deep) {   // verso il centro (piano tangente) + solco: Pinch, Crease, Blob
  const P = pos(), sg = invert ? -1 : 1;
  set.idx.forEach((i, j) => {
    const k = set.c[j], n = area.N[k], c = centers[k], w = set.w[j];
    const dx = c.x - P[3 * i], dy = c.y - P[3 * i + 1], dz = c.z - P[3 * i + 2], dn = dx * n.x + dy * n.y + dz * n.z;
    const t = state.strength * CONFIG.pinchFactor * w * sg * tang, cr = state.radius * 0.03 * state.strength * w * sg * deep;
    P[3 * i] += (dx - n.x * dn) * t - n.x * cr; P[3 * i + 1] += (dy - n.y * dn) * t - n.y * cr; P[3 * i + 2] += (dz - n.z * dn) * t - n.z * cr;
  });
}

/* Ogni pennello: (set, ctx) con ctx = { area, centers, invert (Alt), delta (spostamento del punto colpito), twist (rad) } */
const BRUSHES = {
  draw:       (s, c) => push(s, c, c.invert ? -1 : 1),
  drawSharp:  (s, c) => push(s, c, c.invert ? -1.5 : 1.5),            // falloff stretto → creste/solchi netti
  deepen:     (s, c) => push(s, c, c.invert ? 1.5 : -1.5),
  clayB:      (s, c) => c.invert ? push(s, c, -1) : sweep(s, c, 'lift', state.radius * 0.05 * state.strength),       // deposita strati piatti
  clayStrips: (s, c) => c.invert ? push(s, c, -1) : sweep(s, c, 'lift', state.radius * 0.08 * state.strength),
  layer(set, { invert }) {                                  // spessore uniforme rispetto alla superficie ORIGINALE della pennellata (tetto = h)
    const P = pos(), N = nrm(), h = state.radius * 0.12 * state.strength * (invert ? -1 : 1);
    set.idx.forEach((i, j) => { const o = stroke.saved.get(i), f = set.w[j] * 0.5;
      for (let a = 0; a < 3; a++) P[3 * i + a] += (o[a] + N[3 * i + a] * h - P[3 * i + a]) * f; });
  },
  inflate: (s, c) => infl(s, c, 1),
  blob:    (s, c) => { infl(s, c, 1.6); pull(s, c, 0.35, 0); },    // gonfia + raccoglie verso il centro = protuberanza sferica
  crease:  (s, c) => pull(s, c, 0.5, 2.5),
  pinch:   (s, c) => pull(s, c, 1, 1),
  flatten: (s, c) => sweep(s, c, 'both'),
  scrape:  (s, c) => sweep(s, c, 'above'),                   // toglie solo ciò che sta sopra il piano → spigoli vivi
  fill:    (s, c) => sweep(s, c, 'below'),                   // riempie solo gli avvallamenti
  smooth(set) {                                             // verso la media dei vicini (prima leggo tutto, poi scrivo)
    const P = pos(), nb = neighbors(active), tmp = new Float32Array(set.idx.length * 3);
    set.idx.forEach((i, j) => {
      let x = 0, y = 0, z = 0; const l = nb[i];
      for (let m = 0; m < l.length; m++) { x += P[3 * l[m]]; y += P[3 * l[m] + 1]; z += P[3 * l[m] + 2]; }
      tmp[3 * j] = x / l.length; tmp[3 * j + 1] = y / l.length; tmp[3 * j + 2] = z / l.length;
    });
    set.idx.forEach((i, j) => { const f = set.w[j] * state.strength * CONFIG.smoothFactor;
      for (let a = 0; a < 3; a++) P[3 * i + a] += (tmp[3 * j + a] - P[3 * i + a]) * f; });
  },
  nudge(set, { area, delta }) {                             // sposta la superficie PARALLELAMENTE al pennello (componente tangente del movimento)
    if (!delta) return;
    const P = pos();
    set.idx.forEach((i, j) => {
      const k = set.c[j], n = area.N[k], dx = k ? -delta.x : delta.x, dn = dx * n.x + delta.y * n.y + delta.z * n.z, f = set.w[j] * state.strength * 1.5;
      P[3 * i] += (dx - n.x * dn) * f; P[3 * i + 1] += (delta.y - n.y * dn) * f; P[3 * i + 2] += (delta.z - n.z * dn) * f;
    });
  },
  twist(set, { area, centers, twist }) {                    // ruota i vertici attorno all'asse (normale) passante per il centro del pennello (Rodrigues)
    if (!twist) return;
    const P = pos();
    set.idx.forEach((i, j) => {
      const k = set.c[j], n = area.N[k], c = centers[k], a = twist * set.w[j] * (k ? -1 : 1), cs = Math.cos(a), sn = Math.sin(a);
      const vx = P[3 * i] - c.x, vy = P[3 * i + 1] - c.y, vz = P[3 * i + 2] - c.z, d = vx * n.x + vy * n.y + vz * n.z;
      P[3 * i] = c.x + vx * cs + (n.y * vz - n.z * vy) * sn + n.x * d * (1 - cs);
      P[3 * i + 1] = c.y + vy * cs + (n.z * vx - n.x * vz) * sn + n.y * d * (1 - cs);
      P[3 * i + 2] = c.z + vz * cs + (n.x * vy - n.y * vx) * sn + n.z * d * (1 - cs);
    });
  },
  mask(set, { invert }) {                                   // accumula (Alt = cancella) e scurisce il colore vertice
    const a = state.strength * CONFIG.maskFactor * (invert ? -1 : 1);
    set.idx.forEach((i, j) => { active.mask[i] = Math.min(1, Math.max(0, active.mask[i] + a * set.w[j])); setColor(active, i); });
    active.geo.attributes.color.needsUpdate = true;
  }
};

/* Grab e Snake Hook: seguono il mouse su un piano parallelo allo schermo.
   Grab = insieme di vertici "congelato" all'inizio (volume controllato). Snake Hook = il pennello si sposta col mouse e trascina i vertici
   che incontra ad ogni frame → la geometria si allunga in corna/code. */
let grab = null;
const grabPlane = new THREE.Plane(), grabPoint = new THREE.Vector3();
function startDrag(hitPoint, tool) {
  const set = tool === 'grab' ? gather(makeCenters(hitPoint)) : { idx: [], w: [], c: [] }, P = pos(), orig = new Float32Array(set.idx.length * 3);
  set.idx.forEach((i, j) => orig.set([P[3 * i], P[3 * i + 1], P[3 * i + 2]], 3 * j));
  touch(set);
  grabPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), hitPoint);
  grab = { tool, set, orig, start: hitPoint.clone(), last: hitPoint.clone() };
}
function updateDrag() {
  if (!raycaster.ray.intersectPlane(grabPlane, grabPoint)) return;
  const P = pos();
  if (grab.tool === 'snake') {
    const d = grabPoint.clone().sub(grab.last), set = gather(makeCenters(grab.last));
    touch(set);
    set.idx.forEach((i, j) => { const sx = set.c[j] === 1 ? -1 : 1, w = set.w[j]; P[3 * i] += d.x * sx * w; P[3 * i + 1] += d.y * w; P[3 * i + 2] += d.z * w; });
    grab.last.copy(grabPoint); return;
  }
  const d = grabPoint.clone().sub(grab.start), { set, orig } = grab;
  set.idx.forEach((i, j) => {
    const w = set.w[j], sx = set.c[j] === 1 ? -1 : 1;       // lato specchiato: delta X invertito
    P[3 * i] = orig[3 * j] + d.x * sx * w; P[3 * i + 1] = orig[3 * j + 1] + d.y * w; P[3 * i + 2] = orig[3 * j + 2] + d.z * w;
  });
}
function sculptAt(point, invert, extra) {
  const tool = stroke.tool, centers = makeCenters(point), set = gather(centers, tool !== 'mask', BRUSH_EXP[tool] || 2);
  if (!set.idx.length) return;
  touch(set);
  BRUSHES[tool](set, { area: areaData(set, centers.length), centers, invert, ...extra });
}

/* ---------- 6. INPUT DI SCULTURA ---------- */
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
let stroke = null, dirty = false, downXY = null, controls, transform;

function setPointer(e) {
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}
// Registrati PRIMA di OrbitControls: così possiamo disabilitarlo prima che veda l'evento.
// Scultura: clic sulla mesh attiva = pennellata; clic nel vuoto = orbita. Trasforma: clic = seleziona.
canvas.addEventListener('pointerdown', e => {
  downXY = [e.clientX, e.clientY];
  if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();   // così i campi si aggiornano durante il drag
  if (state.mode === 'sketch') return sketchDown(e);
  if (e.button !== 0 || state.mode !== 'sculpt' || !active || !active.mesh.visible) return;
  setPointer(e);
  const hit = raycaster.intersectObject(active.mesh)[0];
  if (!hit) return;
  controls.enabled = false; canvas.setPointerCapture(e.pointerId);
  const tool = e.shiftKey && state.tool !== 'mask' ? 'smooth' : state.tool;   // Shift = Smooth temporaneo con qualsiasi pennello
  stroke = { invert: e.altKey, rec: active, saved: new Map(), tool, px: pointer.x, last: null };
  if (DRAG_TOOLS.includes(tool)) startDrag(hit.point, tool);
  dirty = true;
});
canvas.addEventListener('pointermove', e => { if (state.mode === 'sketch') sketchMove(e); setPointer(e); if (stroke) stroke.invert = e.altKey; dirty = true; });
function endStroke() {
  if (!stroke) return;
  pushHistory(); markDirty(); stroke = null; grab = null; controls.enabled = true; refreshSel(); syncDims();
}
canvas.addEventListener('pointerup', e => {
  endStroke(); if (state.mode === 'sketch') sketchUp();
  if (state.mode === 'transform' && e.button === 0 && downXY && !transform.axis && Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) < 4) {
    setPointer(e);                                          // clic senza trascinamento (e non sul gizmo) → selezione
    const hit = raycaster.intersectObjects(recs.filter(r => r.mesh.visible).map(r => r.mesh))[0];
    if (hit) setActive(recs.find(r => r.mesh === hit.object));
  }
});
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('contextmenu', e => e.preventDefault());

controls = new THREE.OrbitControls(camera, canvas);         // rotazione / pan (destro) / zoom (rotella)
controls.enableDamping = true; controls.target.set(0, 40, 0);

function updateCursor(hit) {
  cursor.visible = !!hit;
  if (!hit) return;
  const n = hit.face.normal;                                // mesh con matrice identità → spazio locale = mondo
  cursor.position.copy(hit.point).addScaledVector(n, state.radius * 0.02);
  cursor.lookAt(hit.point.clone().add(n)); cursor.scale.setScalar(state.radius);
}
function processInput() {                                   // una sola elaborazione per frame
  if (!dirty) return;
  dirty = false;
  if (state.mode !== 'sculpt' || !active || !active.mesh.visible) { cursor.visible = false; return; }
  if (stroke && DRAG_TOOLS.includes(stroke.tool)) { updateDrag(); commit(stroke.rec); return; }
  const hit = raycaster.intersectObject(active.mesh)[0];
  updateCursor(hit);
  if (stroke && hit) {
    const delta = stroke.last ? hit.point.clone().sub(stroke.last) : null;               // per Nudge
    sculptAt(hit.point, stroke.invert, { delta, twist: (pointer.x - stroke.px) * 4 * state.strength });   // twist: movimento orizzontale del mouse
    stroke.last = hit.point.clone(); stroke.px = pointer.x; commit(active);
  }
}

/* ---------- 7. TRASFORMAZIONE (gizmo) E MODALITÀ ---------- */
transform = new THREE.TransformControls(camera, canvas);
transform.addEventListener('dragging-changed', e => controls.enabled = !e.value);   // niente orbita mentre si trascina il gizmo
// Scala proporzionale: trascinando una maniglia di scala, tutte le componenti seguono il fattore dell'asse trascinato
const scaleStart = new THREE.Vector3();
transform.addEventListener('mouseDown', () => { if (active) scaleStart.copy(active.mesh.scale); });
const updateInfo = rafThrottle(() => { refreshSel(); syncDims(); });   // throttling: max 1 aggiornamento del DOM per frame
transform.addEventListener('objectChange', () => {
  if (state.gizmo === 'scale' && state.uniform && active) {
    const sc = active.mesh.scale, dev = r => Math.abs(Math.log(Math.max(r, 1e-6)));
    const f = [sc.x / scaleStart.x, sc.y / scaleStart.y, sc.z / scaleStart.z].reduce((a, b) => dev(b) > dev(a) ? b : a);
    sc.copy(scaleStart).multiplyScalar(f);
  }
  updateInfo(); markDirty();
});
scene.add(transform);

// Colori del gizmo come in Blender: Z (alto = asse Y di Three.js) blu, Y (profondità = asse Z di Three.js) verde.
// TransformControls li disegna con i colori di Three.js, quindi scambio verde ↔ blu nei suoi materiali
// (frecce, anelli di rotazione, maniglie di scala). Ogni materiale è condiviso fra più maniglie: il Set evita doppi scambi.
const swapped = new Set();
transform.traverse(o => [].concat(o.material || []).forEach(m => {
  const c = m.color;
  if (!c || swapped.has(m)) return;
  if (c.g > 0.9 && c.r < 0.1 && c.b < 0.1) { c.setRGB(0, 0, 1); swapped.add(m); }       // verde → blu
  else if (c.b > 0.9 && c.r < 0.1 && c.g < 0.1) { c.setRGB(0, 1, 0); swapped.add(m); } // blu → verde
}));

function attachGizmo() {
  if (state.mode === 'transform' && active && active.mesh.visible) { transform.attach(active.mesh); transform.setMode(state.gizmo); }
  else transform.detach();
}
function applySnap() {                                      // snap alla griglia: traslazione = cella, rotazione 15°, scala 0.1
  const s = state.snap;
  transform.setTranslationSnap(s ? state.gridStep : null);
  transform.setRotationSnap(s ? Math.PI / 12 : null);
  transform.setScaleSnap(s ? 0.1 : null);
}
function setMode(m) {
  state.mode = m;
  if (m !== 'sketch') sketchReset();
  controls.mouseButtons = m === 'sketch' ? { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }   // schizzo: sinistro = disegna, destro = orbita
                                         : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  if (active) m === 'transform' ? recenter(active) : bake(active);   // sculpt: identità · trasforma: pivot al centro
  document.body.dataset.mode = m; $('btn-mode').classList.toggle('active', m === 'transform');
  cursor.visible = false; attachGizmo(); syncDims();
}
function setGizmo(g) {
  state.gizmo = g; document.querySelectorAll('[data-gizmo]').forEach(b => b.classList.toggle('active', b.dataset.gizmo === g));
  updateFieldMeta();
  if (state.mode !== 'transform') setMode('transform'); else attachGizmo();
  syncDims();
}

/* ---------- 7b. SCHIZZO CAD 2D (ispirato a Fusion 360) ----------
   1) Piano di lavoro: XY / XZ / YZ (assi UI, Z in alto) oppure "Faccia" (il primo clic su una mesh definisce il piano).
   2) Strumenti (click-click): Linea (catena, si chiude sul primo punto), Rettangolo, Cerchio (centro + bordo), Arco per 3 punti.
   3) HUD numerico: dopo il primo punto, Tab sposta il focus sui campi (Lunghezza/Angolo o Diametro); Invio (o Tab sull'ultimo campo) conferma.
   4) Snap a estremi, centri e origine con quadratino verde.
   Ogni entità è una polilinea di punti 2D (u, v) sul piano; il profilo = concatenazione ordinata, chiuso se ultimo = primo punto. */
const sk = { tool: 'line', planeKey: 'xy', plane: null, o: new THREE.Vector3(), u: new THREE.Vector3(), v: new THREE.Vector3(), n: new THREE.Vector3(),
             ents: [], snapPts: [[0, 0]], clicks: [], cur: null, pts: [], done: false };
const PLANES = { xy: [[1, 0, 0], [0, 0, -1]], xz: [[1, 0, 0], [0, 1, 0]], yz: [[0, 0, -1], [0, 1, 0]] };   // [u, v] in coordinate Three.js; n = u × v
const to3 = p => sk.o.clone().addScaledVector(sk.u, p[0]).addScaledVector(sk.v, p[1]);                    // 2D piano → mondo

// Griglia + assi del piano di lavoro, anteprima, marcatore di snap
const skGrid = new THREE.Group(); skGrid.add(new THREE.GridHelper(200, 20, 0x777777, 0x4a4a4a));
const axG = new THREE.BufferGeometry().setFromPoints([[0, 0, 0], [100, 0, 0], [0, 0, 0], [0, 0, -100]].map(p => new THREE.Vector3(...p)));
axG.setAttribute('color', new THREE.Float32BufferAttribute([.9, .4, .37, .9, .4, .37, .48, .79, .36, .48, .79, .36], 3));   // origine: asse u rosso, asse v verde
skGrid.add(new THREE.LineSegments(axG, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false })));
skGrid.matrixAutoUpdate = false; skGrid.visible = false; scene.add(skGrid);
const skLine = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: CONFIG.accent, depthTest: false }));
skLine.renderOrder = 11; skLine.frustumCulled = false; skLine.visible = false; scene.add(skLine);
const skMarker = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
  new THREE.PointsMaterial({ color: 0x5fd35f, size: 11, sizeAttenuation: false, depthTest: false }));
skMarker.renderOrder = 12; skMarker.frustumCulled = false; skMarker.visible = false; scene.add(skMarker);

function skMarkUI() {                                       // evidenzia strumento e piano attivi
  const on = state.mode === 'sketch';
  document.querySelectorAll('[data-sk]').forEach(b => b.classList.toggle('active', on && b.dataset.sk === sk.tool));
  document.querySelectorAll('[data-plane]').forEach(b => b.classList.toggle('active', on && b.dataset.plane === sk.planeKey));
}
function skReady() { $('sk-extrude').disabled = !sk.done; $('sk-cut').disabled = !(sk.done && active); }
function skPlaneReady() {
  sk.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(sk.n, sk.o);
  skGrid.matrix.makeBasis(sk.u, sk.n, sk.v.clone().negate()).setPosition(sk.o); skGrid.matrixWorldNeedsUpdate = true;
  skGrid.visible = state.mode === 'sketch'; sk.snapPts = [[0, 0]]; wake();
}
function skSetPlane(key) {
  sk.planeKey = key; sk.plane = null;
  if (key !== 'face') { const [u, v] = PLANES[key]; sk.o.set(0, 0, 0); sk.u.set(...u); sk.v.set(...v); sk.n.crossVectors(sk.u, sk.v); skPlaneReady(); }
  sketchReset();
}
function sketchReset() {
  sk.ents = []; sk.snapPts = [[0, 0]]; sk.clicks = []; sk.pts = []; sk.done = false; sk.cur = null; skMarker.visible = false;
  if (sk.planeKey === 'face') sk.plane = null;               // "Faccia": va scelta di nuovo ad ogni schizzo
  skGrid.visible = state.mode === 'sketch' && !!sk.plane;
  skDraw(); skMarkUI(); skReady();
}

// Geometria 2D
const circlePts = (c, r) => Array.from({ length: 49 }, (_, i) => [c[0] + r * Math.cos(i / 48 * 2 * Math.PI), c[1] + r * Math.sin(i / 48 * 2 * Math.PI)]);
function arc3(a, m, b) {                                    // arco per 3 punti: circonferenza per a, m, b, campionata da a a b passando per m
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-9) return [a, b];                    // punti allineati → segmento
  const A = a[0] ** 2 + a[1] ** 2, B = m[0] ** 2 + m[1] ** 2, C = b[0] ** 2 + b[1] ** 2;
  const ux = (A * (m[1] - b[1]) + B * (b[1] - a[1]) + C * (a[1] - m[1])) / d, uy = (A * (b[0] - m[0]) + B * (a[0] - b[0]) + C * (m[0] - a[0])) / d;
  const r = Math.hypot(a[0] - ux, a[1] - uy), ang = p => Math.atan2(p[1] - uy, p[0] - ux), TAU = 2 * Math.PI, norm = x => ((x % TAU) + TAU) % TAU;
  const a0 = ang(a), sweep = norm(ang(m) - a0) < norm(ang(b) - a0) ? norm(ang(b) - a0) : -norm(a0 - ang(b));   // verso orario/antiorario dato da m
  const pts = Array.from({ length: 25 }, (_, i) => [ux + r * Math.cos(a0 + sweep * i / 24), uy + r * Math.sin(a0 + sweep * i / 24)]);
  pts[0] = a; pts[24] = b; return pts;                      // estremi esatti (servono allo snap/chiusura)
}
function skAdd(poly, extraSnap) { sk.ents.push(poly); sk.snapPts.push(poly[0], poly[poly.length - 1]); if (extraSnap) sk.snapPts.push(extraSnap); }
function skProfile() {                                      // contorno = polilinee concatenate; chiuso se ultimo punto = primo
  const pts = []; sk.ents.forEach(e => e.forEach((p, i) => { if (i || !pts.length) pts.push(p); }));
  const closed = pts.length >= 4 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-6;
  sk.pts = closed ? pts.slice(0, -1) : pts; sk.done = closed; skReady();
}
function skClose() { sk.clicks = []; skProfile(); skDraw(); }   // Invio / doppio clic: termina la catena

function skPlace(p) {                                       // aggiunge un punto al tool corrente (da clic o da HUD)
  if (sk.done) { sk.ents = []; sk.snapPts = [[0, 0]]; sk.done = false; sk.clicks = []; }   // nuovo profilo (uno alla volta)
  const c = sk.clicks, last = sk.ents.length ? sk.ents.at(-1).at(-1) : null;
  if (sk.tool === 'line') {
    if (!c.length) c.push(last || p);                       // la catena continua dall'ultimo punto
    if (c[0][0] !== p[0] || c[0][1] !== p[1]) { skAdd([c[0], p]); sk.clicks = [p]; }
  } else if (sk.tool === 'arc') {
    if (!c.length) { c.push(last || p); if (!last) return skDraw(); }   // senza catena: il primo clic è l'inizio
    c.push(p);
    if (c.length === 3) { skAdd(arc3(c[0], c[1], c[2])); sk.clicks = []; }
  } else {                                                  // cerchio e rettangolo: centro/angolo + secondo punto
    if (!c.length) c.push(p);
    else {
      const a = c[0]; sk.ents = []; sk.snapPts = [[0, 0]];
      if (sk.tool === 'circle') skAdd(circlePts(a, Math.hypot(p[0] - a[0], p[1] - a[1])), a);
      else [[a, [p[0], a[1]]], [[p[0], a[1]], p], [p, [a[0], p[1]]], [[a[0], p[1]], a]].forEach(sg => skAdd(sg));
      sk.clicks = [];
    }
  }
  skProfile(); if (sk.done) sk.clicks = []; skDraw();
}

function skDraw() {                                         // anteprima: entità + elemento in corso fino al cursore
  const polys = [...sk.ents], c = sk.clicks, cur = sk.cur;
  if (cur && c.length) {
    if (sk.tool === 'line') polys.push([c[0], cur]);
    else if (sk.tool === 'rect') polys.push([c[0], [cur[0], c[0][1]], cur, [c[0][0], cur[1]], c[0]]);
    else if (sk.tool === 'circle') polys.push(circlePts(c[0], Math.hypot(cur[0] - c[0][0], cur[1] - c[0][1])));
    else polys.push(c.length === 1 ? [c[0], cur] : arc3(c[0], c[1], cur));
  }
  const v = []; polys.forEach(pl => { for (let i = 1; i < pl.length; i++) v.push(to3(pl[i - 1]), to3(pl[i])); });
  skLine.geometry.dispose(); skLine.geometry = new THREE.BufferGeometry().setFromPoints(v); skLine.visible = v.length > 0;
  skHud(); wake();
}
function skHud() {                                          // campi numerici sovrapposti (Lunghezza/Angolo, Diametro)
  const c = sk.clicks[0], tl = sk.tool, show = state.mode === 'sketch' && c && sk.cur && (tl === 'line' || tl === 'circle');
  $('sk-hud').hidden = !show;
  if (!show) return;
  const dx = sk.cur[0] - c[0], dy = sk.cur[1] - c[1];
  $('hud-la').textContent = t(tl === 'line' ? 'skLen' : 'skDia'); $('hud-lb').hidden = tl !== 'line';
  if (document.activeElement !== $('hud-a')) $('hud-a').value = (Math.hypot(dx, dy) * (tl === 'line' ? 1 : 2)).toFixed(2);
  if (document.activeElement !== $('hud-b')) $('hud-b').value = ((Math.atan2(dy, dx) * DEG + 360) % 360).toFixed(1);
}
function hudConfirm() {                                     // valori digitati → punto esatto
  const c = sk.clicks[0], a = $('hud-a').valueAsNumber, b = $('hud-b').valueAsNumber;
  if (!c || !(a > 0)) return;
  if (sk.tool === 'circle') skPlace([c[0] + a / 2, c[1]]);   // diametro → punto sul bordo
  else if (sk.tool === 'line' && Number.isFinite(b)) skPlace([c[0] + a * Math.cos(b / DEG), c[1] + a * Math.sin(b / DEG)]);   // angolo in gradi → radianti
  document.activeElement.blur(); sk.cur = sk.clicks[0] || sk.cur; skDraw();
}

function skPoint(e) {                                       // mouse → coordinate 2D sul piano di lavoro
  setPointer(e);
  if (!sk.plane) {                                          // modalità "Faccia": il primo clic su una mesh definisce il piano
    if (e.type !== 'pointerdown') return null;
    const hit = raycaster.intersectObjects(recs.filter(r => r.mesh.visible).map(r => r.mesh))[0];
    if (!hit) return null;
    sk.n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld); sk.o.copy(hit.point);
    sk.u.crossVectors(sk.n, Math.abs(sk.n.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    sk.v.crossVectors(sk.n, sk.u); skPlaneReady(); skMarkUI(); return null;
  }
  const p = raycaster.ray.intersectPlane(sk.plane, new THREE.Vector3());
  return p ? (p.sub(sk.o), [p.dot(sk.u), p.dot(sk.v)]) : null;
}
function skSnap(p) {                                        // aggancio a estremi/centri/origine entro 12 px dal cursore
  let best = null, bd = 12; const W = canvas.clientWidth, H = canvas.clientHeight;
  for (const q of sk.snapPts) {
    const v = to3(q).project(camera), d = Math.hypot((v.x - pointer.x) * W / 2, (v.y - pointer.y) * H / 2);
    if (d < bd) { bd = d; best = q; }
  }
  skMarker.visible = !!best; if (best) skMarker.position.copy(to3(best));
  return best || p;
}
function sketchDown(e) {
  if (e.button !== 0) return;
  if (e.detail === 2 && sk.tool === 'line') return skClose();
  const p = skPoint(e);
  if (p) skPlace(skSnap(p));
}
const sketchMove = rafThrottle(e => { const p = skPoint(e); if (p) { sk.cur = skSnap(p); skDraw(); } });   // throttling: 1 aggiornamento per frame
const sketchUp = () => {};

function skExtrude() {                                      // nuovo corpo: schizzo estruso di "spessore" mm lungo la normale del piano
  if (!sk.done) return;
  const depth = Math.max(0.1, +$('sk-depth').value || 10);
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(sk.pts.map(p => new THREE.Vector2(p[0], p[1]))), { depth, bevelEnabled: false, curveSegments: 32 });
  g.applyMatrix4(new THREE.Matrix4().makeBasis(sk.u, sk.v, sk.n).setPosition(sk.o));   // piano locale (u, v, n) → mondo
  spawn([{ geo: g, name: t('sketch') }], null, true);
  setMode('sculpt');
}
function skCut() {                                          // scavo: i vertici frontali dentro il prisma (h ∈ [-spessore, 0]) vengono portati sul fondo
  if (!sk.done || !active) return;
  const depth = Math.max(0.1, +$('sk-depth').value || 10), P = pos(), N = nrm(), w = new THREE.Vector3(), idx = [], poly = sk.pts;
  const inside = (x, y) => {                                // punto-in-poligono (ray casting)
    let r = false;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++)
      if ((poly[a][1] > y) !== (poly[b][1] > y) && x < (poly[b][0] - poly[a][0]) * (y - poly[a][1]) / (poly[b][1] - poly[a][1]) + poly[a][0]) r = !r;
    return r;
  };
  for (let i = 0; i < P.length / 3; i++) {
    w.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]).sub(sk.o);
    const h = w.dot(sk.n);
    if (h > -depth && h < 1 && N[3 * i] * sk.n.x + N[3 * i + 1] * sk.n.y + N[3 * i + 2] * sk.n.z > 0 && inside(w.dot(sk.u), w.dot(sk.v))) idx.push(i);
  }
  if (!idx.length) return;
  stroke = { saved: new Map(), rec: active }; touch({ idx });    // registra lo "prima" per l'undo
  idx.forEach(i => {
    w.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]).sub(sk.o);
    const q = sk.o.clone().addScaledVector(sk.u, w.dot(sk.u)).addScaledVector(sk.v, w.dot(sk.v)).addScaledVector(sk.n, -depth);
    P[3 * i] = q.x; P[3 * i + 1] = q.y; P[3 * i + 2] = q.z;
  });
  pushHistory(); stroke = null; commit(active); markDirty(); setMode('sculpt');
}

/* ---------- 8. IMPORT E PRIMITIVE ---------- */
async function importFile(file) {
  const ext = file.name.split('.').pop().toLowerCase(), base = file.name.replace(/\.[^.]+$/, ''), buf = await file.arrayBuffer();
  if (ext === 'stl') {                                      // STL: mesh grezza, già in mm
    spawn([{ geo: new THREE.STLLoader().parse(buf), name: base }]); focusActive();
  } else if (ext === 'glb' || ext === 'gltf') {             // glTF: una mesh scolpibile per ogni Mesh della gerarchia
    new THREE.GLTFLoader().parse(ext === 'glb' ? buf : new TextDecoder().decode(buf), '', gltf => {
      gltf.scene.updateMatrixWorld(true);                   // trasformazioni della gerarchia incluse nei vertici
      const items = [], s = CONFIG.gltfScale;
      gltf.scene.traverse(o => { if (o.isMesh && !o.isSkinnedMesh)
        items.push({ geo: o.geometry.clone().applyMatrix4(o.matrixWorld).scale(s, s, s), name: o.name || base }); });
      if (items.length) { spawn(items); focusActive(); } else alert(t('errEmpty'));
      disposeGltf(gltf.scene);                              // le copie sono già nella scena: rilascio gli originali
    }, err => alert(t('errGltf') + (err.message || err)));
  } else alert(t('errFormat'));
}
function disposeGltf(root) {                              // geometrie, materiali e texture del file glTF
  root.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    [].concat(o.material).forEach(m => { Object.values(m).forEach(v => v && v.isTexture && v.dispose()); m.dispose(); });
  });
}
// Primitive a dimensione 1 (poi scalate in mm da spawn); molte suddivisioni per poterle scolpire
function makePrimitive(type) {
  switch (type) {
    case 'box':      return new THREE.BoxGeometry(1, 1, 1, 24, 24, 24);
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 64, 32);
    case 'cone':     return new THREE.CylinderGeometry(0, 0.5, 1, 64, 32);
    case 'torus':    return new THREE.TorusGeometry(0.5, 0.2, 32, 64);
    case 'uvsphere': return new THREE.SphereGeometry(0.5, 64, 48);
    default:         return new THREE.IcosahedronGeometry(0.5, 24);
  }
}

/* ---------- 9. INTERFACCIA E i18n ---------- */
/* Toolbar a categorie (schede): data-driven, per aggiungere un pennello basta una riga qui + BRUSHES + la chiave i18n con lo stesso id */
const TOOL_TABS = {
  tBuild:  [['draw', '●'], ['drawSharp', '◆'], ['clayB', '▰'], ['clayStrips', '≡'], ['layer', '▤'], ['inflate', '◐'], ['blob', '◍']],
  tDeform: [['grab', '✥'], ['snake', '∿'], ['nudge', '⇉'], ['twist', '↻']],
  tDetail: [['smooth', '≈'], ['flatten', '▬'], ['scrape', '⌐'], ['fill', '▼'], ['deepen', '▽'], ['crease', '⌄'], ['pinch', '⋈']],
  tMask:   [['mask', '◼']]
};
const TAB_ICONS = { tBuild: '▲', tDeform: '⤧', tDetail: '✦', tMask: '◼' };
const tabsEl = $('tabs'), toolsEl = $('tools');
Object.entries(TOOL_TABS).forEach(([tab, list]) => {
  const tb = document.createElement('button'); tb.dataset.tab = tab; tb.innerHTML = `<span>${TAB_ICONS[tab]}</span><i data-i18n="${tab}"></i>`; tabsEl.appendChild(tb);
  const pane = document.createElement('div'); pane.className = 'pane'; pane.dataset.pane = tab;
  list.forEach(([id, icon]) => {
    const b = document.createElement('button'); b.dataset.tool = id; b.dataset.i18nTitle = id;   // tooltip = nome tradotto
    b.innerHTML = `<span>${icon}</span><i data-i18n="${id}"></i>`; pane.appendChild(b);
  });
  toolsEl.appendChild(pane);
});
function showTab(tab) {
  tabsEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  toolsEl.querySelectorAll('.pane').forEach(p => p.hidden = p.dataset.pane !== tab);
}
function setTool(tool) {
  state.tool = tool; $('tool-label').textContent = t(tool);
  toolsEl.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  showTab(Object.keys(TOOL_TABS).find(k => TOOL_TABS[k].some(([id]) => id === tool)));
}
tabsEl.addEventListener('click', e => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); });
toolsEl.addEventListener('click', e => {
  const b = e.target.closest('[data-tool]');
  if (b) { setTool(b.dataset.tool); if (state.mode !== 'sculpt') setMode('sculpt'); }
});
setTool(state.tool);                                        // evidenzia il pennello iniziale e mostra la sua scheda
document.querySelectorAll('[data-gizmo]').forEach(b => b.addEventListener('click', () => setGizmo(b.dataset.gizmo)));

function bindSlider(id, key, cfg) {
  const el = $(id), out = $(id + '-val');
  el.min = cfg.min; el.max = cfg.max; el.value = cfg.value; out.textContent = (+cfg.value).toFixed(cfg.dec);
  el.addEventListener('input', () => { state[key] = +el.value; out.textContent = (+el.value).toFixed(cfg.dec); });
}
bindSlider('radius', 'radius', CONFIG.radius); bindSlider('strength', 'strength', CONFIG.strength);

/* --- i18n: ogni elemento con data-i18n / data-i18n-title viene tradotto senza ricaricare la pagina --- */
const SHORTCUTS = [['Tab', 'keyMode'], ['D', 'draw'], ['S', 'smooth'], ['G', 'grab'], ['L', 'flatten'], ['I', 'inflate'], ['P', 'pinch'],
  ['M', 'mask'], ['C', 'clayB'], ['B', 'blob'], ['K', 'snake'], ['N', 'nudge'], ['Shift', 'smooth'], ['Alt', 'keyInvert'], ['X', 'sym'], ['W', 'move'], ['E', 'rotate'], ['R', 'scale'], ['F', 'focus'], ['Home', 'frameAll'],
  ['Del', 'keyDel'], ['Ctrl+Z', 'undo'], ['Ctrl+Y', 'redo'], ['?', 'shortcuts']];
function buildHelp() {
  $('help-body').innerHTML = SHORTCUTS.map(([k, l]) => `<tr><td><kbd>${k}</kbd></td><td>${t(l)}</td></tr>`).join('');
}
function applyLang(l) {
  lang = I18N[l] ? l : 'en'; document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
  document.querySelectorAll('[data-i18n-title]').forEach(el => el.title = t(el.dataset.i18nTitle));
  $('tool-label').textContent = t(state.tool);
  refreshList(); buildHelp(); buildLegal(); updateFieldMeta();
  try { localStorage.setItem('lang', lang); } catch (e) { /* storage bloccato: la scelta vale solo per la sessione */ }
}
$('lang').addEventListener('change', e => applyLang(e.target.value));

/* --- Lista oggetti: un DocumentFragment + UN solo listener delegato (niente handler per riga) --- */
function refreshList() {
  const frag = document.createDocumentFragment();
  recs.forEach((r, i) => {
    const li = document.createElement('li'); li.dataset.i = i; if (r === active) li.className = 'sel';
    li.innerHTML = `<span class="nm" data-act="sel"></span><button data-act="eye" title="${t('vis')}">${r.mesh.visible ? '◉' : '○'}</button><button data-act="del" title="${t('del')}">✕</button>`;
    li.firstChild.textContent = r.name;                     // textContent: i nomi dei file non sono HTML fidato
    frag.appendChild(li);
  });
  $('mesh-list').replaceChildren(frag);
}
$('mesh-list').addEventListener('click', e => {
  const act = e.target.dataset.act, li = e.target.closest('li');
  if (!act || !li) return;
  const r = recs[+li.dataset.i];
  if (act === 'sel') setActive(r);
  else if (act === 'del') removeMesh(r);
  else { r.mesh.visible = !r.mesh.visible; attachGizmo(); refreshSel(); refreshList(); }
});

/* --- Controlli del pannello --- */
$('symmetry').addEventListener('change', e => state.symmetry = e.target.checked);
$('uniform').addEventListener('change', e => state.uniform = e.target.checked);
$('wireframe').addEventListener('change', e => material.wireframe = e.target.checked);
$('material').addEventListener('change', e => setMaterial(e.target.value));
$('grid-vis').addEventListener('change', e => grid.visible = e.target.checked);
// debounce: la griglia si ricostruisce solo quando l'utente smette di digitare
$('grid-step').addEventListener('input', debounce(e => {
  state.gridStep = Math.max(1, +e.target.value || CONFIG.gridStep); buildGrid(); applySnap(); wake();
}, 300));
$('snap').addEventListener('change', e => { state.snap = e.target.checked; applySnap(); });
$('btn-mode').addEventListener('click', () => setMode(state.mode === 'transform' ? 'sculpt' : 'transform'));
$('btn-undo').addEventListener('click', undo); $('btn-redo').addEventListener('click', redo);
$('btn-reset').addEventListener('click', resetScene);
$('btn-focus').addEventListener('click', focusActive);
$('btn-frame').addEventListener('click', frameAll);
$('btn-cam').addEventListener('click', resetCamera);
$('btn-help').addEventListener('click', () => $('help').showModal());
$('btn-create').addEventListener('click', () => {
  // ordine Three.js [x, y (altezza), z] = campi UI [X, Z, Y]: nell'interfaccia Z è l'altezza
  const dims = ['px', 'pz', 'py'].map(id => Math.max(1, +$(id).value || 1)), type = $('prim-type').value;
  spawn([{ geo: makePrimitive(type), name: $('prim-type').selectedOptions[0].text }], dims); focusActive();
});
// UI → mesh: ogni tasto digitato aggiorna subito la mesh; al blur il valore viene riformattato
FIELD_IDS.forEach((id, i) => {
  $(id).addEventListener('input', e => applyField(i, e.target.valueAsNumber));
  $(id).addEventListener('blur', syncDims);
});
$('btn-mask-clear').addEventListener('click', () => {
  if (!active) return;
  active.mask.fill(0); for (let i = 0; i < active.mask.length; i++) setColor(active, i);
  active.geo.attributes.color.needsUpdate = true; wake();
});
$('btn-import').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', e => { [...e.target.files].forEach(importFile); e.target.value = ''; });
viewport.addEventListener('dragover', e => { e.preventDefault(); viewport.classList.add('drop'); });
viewport.addEventListener('dragleave', () => viewport.classList.remove('drop'));
viewport.addEventListener('drop', e => { e.preventDefault(); viewport.classList.remove('drop'); [...e.dataTransfer.files].forEach(importFile); });

/* --- Donazioni (Ko-fi), modale legale e comandi dello schizzo --- */
$('donate').href = CONFIG.kofiUrl;                          // rel="noopener noreferrer" e target="_blank" sono già nell'HTML
function buildLegal() {                                     // 3 punti: privacy, disclaimer AS IS, proprietà intellettuale (testi in I18N)
  $('legal-title').textContent = t('legalTitle');
  $('legal-body').innerHTML = [1, 2, 3].map(n => `<h3>${t('lg' + n + 'h')}</h3><p>${t('lg' + n)}</p>`).join('');
}
$('btn-legal').addEventListener('click', () => $('legal').showModal());
document.querySelectorAll('[data-sk]').forEach(b => b.addEventListener('click', () => {
  const entering = state.mode !== 'sketch';
  setMode('sketch');
  if (entering) { if (!sk.plane && sk.planeKey !== 'face') skSetPlane(sk.planeKey); else sketchReset(); }   // il cambio strumento NON cancella il disegno
  sk.tool = b.dataset.sk; sk.clicks = []; skMarkUI(); skDraw();
}));
document.querySelectorAll('[data-plane]').forEach(b => b.addEventListener('click', () => { setMode('sketch'); skSetPlane(b.dataset.plane); }));
['hud-a', 'hud-b'].forEach(id => $(id).addEventListener('keydown', e => {
  if (e.key === 'Enter' || (e.key === 'Tab' && (id === 'hud-b' || sk.tool === 'circle'))) { e.preventDefault(); hudConfirm(); }   // Invio o Tab sull'ultimo campo
  else if (e.key === 'Escape') e.target.blur();
}));
$('sk-extrude').addEventListener('click', skExtrude); $('sk-cut').addEventListener('click', skCut);

/* --- Screenshot PNG (senza gizmo/cursore): render e copia nello stesso tick, niente preserveDrawingBuffer --- */
function screenshot() {
  const hide = [cursor, selBox, transform], was = hide.map(o => o.visible);
  hide.forEach(o => o.visible = false);
  renderer.render(scene, camera);
  canvas.toBlob(b => b && download(b, 'easyblend.png'));
  hide.forEach((o, i) => o.visible = was[i]); wake();
}
$('btn-shot').addEventListener('click', screenshot);

/* --- Scorciatoie da tastiera --- */
window.addEventListener('keydown', e => {
  if ($('help').open || $('legal').open || ['number', 'select-one'].includes(e.target.type)) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tools = { d: 'draw', s: 'smooth', g: 'grab', l: 'flatten', i: 'inflate', p: 'pinch', m: 'mask', c: 'clayB', b: 'blob', k: 'snake', n: 'nudge' };
  const gizmos = { w: 'translate', e: 'rotate', r: 'scale' };
  if (e.key === 'Enter' && state.mode === 'sketch') skClose();
  else if (e.key === 'Escape' && state.mode === 'sketch') { if (sk.clicks.length) { sk.clicks = []; skDraw(); } else setMode('sculpt'); }
  else if (e.key === 'Tab' && state.mode === 'sketch' && !$('sk-hud').hidden) { e.preventDefault(); $('hud-a').focus(); $('hud-a').select(); }   // Tab → HUD numerico
  else if (e.key === 'Tab') { e.preventDefault(); setMode(state.mode === 'transform' ? 'sculpt' : 'transform'); }
  else if (e.key === 'Delete' && active) removeMesh(active);
  else if (k === 'f') focusActive();
  else if (k === 'home') frameAll();
  else if (k === '?') $('help').showModal();
  else if (k === 'x') { const s = $('symmetry'); s.checked = !s.checked; state.symmetry = s.checked; }
  else if (tools[k]) setTool(tools[k]);
  else if (gizmos[k] && state.mode === 'transform') setGizmo(gizmos[k]);
});

/* ---------- 10. ESPORTAZIONE (mesh visibili, coordinate mondo, mm) ---------- */
function collect() {                                        // posizioni già trasformate in mondo + indici
  return recs.filter(r => r.mesh.visible).map(r => {
    r.mesh.updateMatrixWorld(true);
    const src = r.geo.attributes.position, p = new Float32Array(src.count * 3), v = new THREE.Vector3();
    for (let i = 0; i < src.count; i++) { v.fromBufferAttribute(src, i).applyMatrix4(r.mesh.matrixWorld); p.set([v.x, v.y, v.z], 3 * i); }
    return { name: r.name, p, idx: r.geo.index.array };
  });
}
function download(blob, name) {
  if (/\.(stl|obj)$/.test(name)) dirtyWork = false;        // lavoro esportato → niente avviso in uscita
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportOBJ() {
  const out = ['# EasyBlend (mm)']; let off = 0;
  collect().forEach(({ name, p, idx }) => {
    out.push('o ' + name.replace(/\s+/g, '_'));
    for (let i = 0; i < p.length; i += 3) out.push(`v ${p[i].toFixed(4)} ${p[i + 1].toFixed(4)} ${p[i + 2].toFixed(4)}`);
    for (let i = 0; i < idx.length; i += 3) out.push(`f ${off + idx[i] + 1} ${off + idx[i + 1] + 1} ${off + idx[i + 2] + 1}`);  // OBJ conta da 1
    off += p.length / 3;
  });
  if (off) download(new Blob([out.join('\n')], { type: 'text/plain' }), 'easyblend.obj');
}
function exportSTL() {                                      // STL binario: header 80 B + n. triangoli + 50 B per triangolo
  const parts = collect(), tris = parts.reduce((s, q) => s + q.idx.length / 3, 0);
  if (!tris) return;
  const dv = new DataView(new ArrayBuffer(84 + tris * 50)); dv.setUint32(80, tris, true);
  let o = 84;
  parts.forEach(({ p, idx }) => {
    const v = i => CONFIG.stlZUp ? [p[3 * i], -p[3 * i + 2], p[3 * i + 1]] : [p[3 * i], p[3 * i + 1], p[3 * i + 2]];   // Y-up → Z-up
    for (let t = 0; t < idx.length; t += 3) {
      const a = v(idx[t]), b = v(idx[t + 1]), c = v(idx[t + 2]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n) || 1;
      [n[0] / l, n[1] / l, n[2] / l, ...a, ...b, ...c].forEach(f => { dv.setFloat32(o, f, true); o += 4; });
      o += 2;                                               // attributo (2 byte) inutilizzato
    }
  });
  download(new Blob([dv.buffer], { type: 'model/stl' }), 'easyblend.stl');
}
$('btn-stl').addEventListener('click', exportSTL); $('btn-obj').addEventListener('click', exportOBJ);

/* ---------- 11. AVVIO, LOOP E SALVAGUARDIE DI PRODUZIONE ---------- */
controls.addEventListener('change', wake);                  // l'inerzia dell'orbita tiene sveglio il render
canvas.addEventListener('webglcontextlost', e => e.preventDefault());   // consente il ripristino automatico del contesto
canvas.addEventListener('webglcontextrestored', wake);
window.addEventListener('beforeunload', e => { if (dirtyWork) { e.preventDefault(); e.returnValue = ''; } });   // avviso se si perde lavoro non esportato

let startLang = 'en';                                       // EN predefinito; la scelta dell'utente è ricordata
try { startLang = localStorage.getItem('lang') || 'en'; } catch (e) { /* storage bloccato */ }
if (!I18N[startLang]) startLang = 'en';
$('lang').value = startLang; applyLang(startLang);

buildGrid(); resize(); applySnap(); resetScene(); dirtyWork = false;
(function loop(now) {
  requestAnimationFrame(loop);
  processInput(); controls.update();                        // update serve per l'inerzia (enableDamping)
  if (now < renderUntil) renderer.render(scene, camera);    // render on demand
})(performance.now());
