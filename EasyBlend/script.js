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
  en: { mode: 'Move / Transform', undo: 'Undo', redo: 'Redo', radius: 'Radius (mm)', strength: 'Strength', sym: 'X Symmetry',
    draw: 'Draw', smooth: 'Smooth', grab: 'Grab', flatten: 'Flatten', inflate: 'Inflate', pinch: 'Pinch', mask: 'Mask',
    objects: 'Objects', import: 'Import…', reset: 'Reset scene', vis: 'Show / hide', del: 'Delete',
    newPrim: 'New primitive (mm)', box: 'Cube / Box', cylinder: 'Cylinder', cone: 'Cone', torus: 'Torus', uvsphere: 'UV Sphere', icosphere: 'IcoSphere', create: 'Create',
    active: 'Active object', move: 'Move', rotate: 'Rotate', scale: 'Scale', prop: 'Proportional scale', clearMask: 'Clear mask',
    grid: 'Grid', showGrid: 'Show grid', snap: 'Snap to grid', cell: 'Cell (mm)',
    view: 'View', clay: 'Matte clay', metal: 'Metallic (MatCap)', wax: 'Red wax (MatCap)', wire: 'Wireframe', focus: 'Focus on object',
    frameAll: 'Frame all', resetCam: 'Reset camera', shot: 'Screenshot (PNG)', export: 'Export (visible meshes, mm)',
    shortcuts: 'Keyboard shortcuts', close: 'Close', keyMode: 'Sculpt / Transform mode', keyInvert: 'Invert brush (hold)', keyDel: 'Delete object',
    errFormat: 'Unsupported format: use .glb, .gltf or .stl', errEmpty: 'No mesh found in the file.', errGltf: 'glTF error: ' },
  it: { mode: 'Sposta / Trasforma', undo: 'Annulla', redo: 'Ripristina', radius: 'Raggio (mm)', strength: 'Intensità', sym: 'Simmetria X',
    draw: 'Disegna', smooth: 'Leviga', grab: 'Sposta', flatten: 'Appiattisci', inflate: 'Gonfia', pinch: 'Pizzica', mask: 'Maschera',
    objects: 'Oggetti', import: 'Importa…', reset: 'Reset scena', vis: 'Mostra / nascondi', del: 'Elimina',
    newPrim: 'Nuova primitiva (mm)', box: 'Cubo / Parallelepipedo', cylinder: 'Cilindro', cone: 'Cono', torus: 'Toro', create: 'Crea',
    active: 'Oggetto attivo', move: 'Sposta', rotate: 'Ruota', scale: 'Scala', prop: 'Scala proporzionale', clearMask: 'Cancella maschera',
    grid: 'Griglia', showGrid: 'Mostra griglia', snap: 'Snap alla griglia', cell: 'Cella (mm)',
    view: 'Vista', clay: 'Argilla opaca', metal: 'Metallico (MatCap)', wax: 'Cera rossa (MatCap)', wire: 'Wireframe', focus: "Focus sull'oggetto",
    frameAll: 'Inquadra tutto', resetCam: 'Reimposta fotocamera', shot: 'Screenshot (PNG)', export: 'Esporta (mesh visibili, mm)',
    shortcuts: 'Scorciatoie da tastiera', close: 'Chiudi', keyMode: 'Modalità Scultura / Trasforma', keyInvert: 'Inverti pennello (tieni premuto)', keyDel: 'Elimina oggetto',
    errFormat: 'Formato non supportato: usa .glb, .gltf o .stl', errEmpty: 'Nessuna mesh trovata nel file.', errGltf: 'Errore glTF: ' },
  es: { mode: 'Mover / Transformar', undo: 'Deshacer', redo: 'Rehacer', radius: 'Radio (mm)', strength: 'Intensidad', sym: 'Simetría X',
    draw: 'Dibujar', smooth: 'Suavizar', grab: 'Mover', flatten: 'Aplanar', inflate: 'Inflar', pinch: 'Pellizcar', mask: 'Máscara',
    objects: 'Objetos', import: 'Importar…', reset: 'Reiniciar escena', vis: 'Mostrar / ocultar', del: 'Eliminar',
    newPrim: 'Nueva primitiva (mm)', box: 'Cubo / Prisma', cylinder: 'Cilindro', cone: 'Cono', torus: 'Toro', create: 'Crear',
    active: 'Objeto activo', move: 'Mover', rotate: 'Rotar', scale: 'Escalar', prop: 'Escala proporcional', clearMask: 'Borrar máscara',
    grid: 'Cuadrícula', showGrid: 'Mostrar cuadrícula', snap: 'Ajustar a la cuadrícula', cell: 'Celda (mm)',
    view: 'Vista', clay: 'Arcilla mate', metal: 'Metálico (MatCap)', wax: 'Cera roja (MatCap)', wire: 'Estructura alámbrica', focus: 'Enfocar objeto',
    frameAll: 'Encuadrar todo', resetCam: 'Restablecer cámara', shot: 'Captura (PNG)', export: 'Exportar (mallas visibles, mm)',
    shortcuts: 'Atajos de teclado', close: 'Cerrar', keyMode: 'Modo Escultura / Transformar', keyInvert: 'Invertir pincel (mantener)', keyDel: 'Eliminar objeto',
    errFormat: 'Formato no compatible: usa .glb, .gltf o .stl', errEmpty: 'No se encontró ninguna malla en el archivo.', errGltf: 'Error de glTF: ' },
  fr: { mode: 'Déplacer / Transformer', undo: 'Annuler', redo: 'Rétablir', radius: 'Rayon (mm)', strength: 'Intensité', sym: 'Symétrie X',
    draw: 'Dessiner', smooth: 'Lisser', grab: 'Déplacer', flatten: 'Aplatir', inflate: 'Gonfler', pinch: 'Pincer', mask: 'Masque',
    objects: 'Objets', import: 'Importer…', reset: 'Réinitialiser la scène', vis: 'Afficher / masquer', del: 'Supprimer',
    newPrim: 'Nouvelle primitive (mm)', box: 'Cube / Pavé', cylinder: 'Cylindre', cone: 'Cône', torus: 'Tore', create: 'Créer',
    active: 'Objet actif', move: 'Déplacer', rotate: 'Pivoter', scale: 'Échelle', prop: 'Échelle proportionnelle', clearMask: 'Effacer le masque',
    grid: 'Grille', showGrid: 'Afficher la grille', snap: 'Aimanter à la grille', cell: 'Cellule (mm)',
    view: 'Vue', clay: 'Argile mate', metal: 'Métallique (MatCap)', wax: 'Cire rouge (MatCap)', wire: 'Fil de fer', focus: "Cadrer l'objet",
    frameAll: 'Tout cadrer', resetCam: 'Réinitialiser la caméra', shot: 'Capture (PNG)', export: 'Exporter (maillages visibles, mm)',
    shortcuts: 'Raccourcis clavier', close: 'Fermer', keyMode: 'Mode Sculpture / Transformation', keyInvert: 'Inverser le pinceau (maintenir)', keyDel: "Supprimer l'objet",
    errFormat: 'Format non pris en charge : utilisez .glb, .gltf ou .stl', errEmpty: 'Aucun maillage trouvé dans le fichier.', errGltf: 'Erreur glTF : ' }
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
function spawn(items, dims) {
  const gs = items.map(o => prep(o.geo));
  if (dims) {
    gs[0].computeBoundingBox();
    const s = gs[0].boundingBox.getSize(new THREE.Vector3());
    gs[0].scale(dims[0] / (s.x || 1), dims[1] / (s.y || 1), dims[2] / (s.z || 1));
    gs[0].computeVertexNormals();
  }
  placeGeos(gs);
  gs.forEach((geo, k) => {
    const n = geo.attributes.position.count, col = new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3);
    col.setUsage(THREE.DynamicDrawUsage);                          // colori = maschera
    geo.setAttribute('color', col);
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);      // buffer aggiornati di continuo
    geo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    const mesh = new THREE.Mesh(geo, material); scene.add(mesh);
    recs.push({ name: items[k].name, mesh, geo, mask: new Float32Array(n), nb: null });
  });
  markDirty(); setActive(recs[recs.length - 1]);
}

// "Cuoce" posizione/rotazione/scala dentro i vertici → mesh con matrice identità (serve alla scultura)
function bake(rec) {
  const m = rec.mesh; m.updateMatrix();
  if (m.matrix.equals(I)) return;
  rec.geo.applyMatrix4(m.matrix);
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
  rec.geo.translate(-c.x, -c.y, -c.z); m.position.copy(c); rec.geo.computeBoundingSphere(); clearHistory();
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

/* Dimensioni reali dell'oggetto attivo (bounding box allineato agli assi del mondo) */
function syncDims() {
  const ids = ['ax', 'ay', 'az'];
  if (!active) return ids.forEach(id => $(id).value = '');
  const s = new THREE.Box3().setFromObject(active.mesh).getSize(new THREE.Vector3());
  [s.x, s.y, s.z].forEach((v, i) => $(ids[i]).value = v.toFixed(1));
}
function applyDims(e) {
  if (!active) return;
  const ids = ['ax', 'ay', 'az'], want = ids.map(id => +$(id).value);
  if (want.some(v => !(v > 0))) return syncDims();
  bake(active);                                           // lavora in coordinate mondo
  const g = active.geo; g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3()), s = g.boundingBox.getSize(new THREE.Vector3());
  let k = [want[0] / s.x, want[1] / s.y, want[2] / s.z];
  if (state.uniform && e) { const f = k[ids.indexOf(e.target.id)]; k = [f, f, f]; }   // proporzionale: il campo modificato guida gli altri due
  g.translate(-c.x, -c.y, -c.z); g.scale(k[0], k[1], k[2]); g.translate(c.x, c.y, c.z);
  g.computeVertexNormals(); g.computeBoundingSphere(); clearHistory(); markDirty();
  if (state.mode === 'transform') recenter(active);
  refreshSel(); syncDims();
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
function commit(rec) {                                      // aggiorna buffer, normali (luce) e bounding sphere (raycast)
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
function gather(centers, useMask = true) {
  const P = active.geo.attributes.position.array, M = active.mask, r2 = state.radius ** 2, set = { idx: [], w: [], c: [] };
  for (let i = 0, n = P.length / 3; i < n; i++) {
    const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
    let best = 0, bk = -1;
    for (let k = 0; k < centers.length; k++) {
      const dx = x - centers[k].x, dy = y - centers[k].y, dz = z - centers[k].z;
      const t = 1 - (dx * dx + dy * dy + dz * dz) / r2;
      if (t > 0 && t * t > best) { best = t * t; bk = k; }
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

/* Ogni pennello: (set, ctx) con ctx = { area, centers, invert (Alt) }; modifica i buffer della mesh attiva */
const BRUSHES = {
  draw(set, { area, invert }) {                             // Draw/Clay: lungo la normale media
    const P = active.geo.attributes.position.array, a = state.radius * CONFIG.drawFactor * state.strength * (invert ? -1 : 1);
    set.idx.forEach((i, j) => { const n = area.N[set.c[j]], f = a * set.w[j];
      P[3 * i] += n.x * f; P[3 * i + 1] += n.y * f; P[3 * i + 2] += n.z * f; });
  },
  inflate(set, { invert }) {                                // Inflate: lungo la normale di OGNI vertice
    const P = active.geo.attributes.position.array, N = active.geo.attributes.normal.array;
    const a = state.radius * CONFIG.drawFactor * state.strength * (invert ? -1 : 1);
    set.idx.forEach((i, j) => { const f = a * set.w[j];
      P[3 * i] += N[3 * i] * f; P[3 * i + 1] += N[3 * i + 1] * f; P[3 * i + 2] += N[3 * i + 2] * f; });
  },
  smooth(set) {                                             // Smooth: verso la media dei vicini (prima leggo tutto, poi scrivo)
    const P = active.geo.attributes.position.array, nb = neighbors(active), tmp = new Float32Array(set.idx.length * 3);
    set.idx.forEach((i, j) => {
      let x = 0, y = 0, z = 0; const l = nb[i];
      for (let m = 0; m < l.length; m++) { x += P[3 * l[m]]; y += P[3 * l[m] + 1]; z += P[3 * l[m] + 2]; }
      tmp[3 * j] = x / l.length; tmp[3 * j + 1] = y / l.length; tmp[3 * j + 2] = z / l.length;
    });
    set.idx.forEach((i, j) => { const f = set.w[j] * state.strength * CONFIG.smoothFactor;
      for (let a = 0; a < 3; a++) P[3 * i + a] += (tmp[3 * j + a] - P[3 * i + a]) * f; });
  },
  flatten(set, { area }) {                                  // Flatten: verso il piano medio
    const P = active.geo.attributes.position.array;
    set.idx.forEach((i, j) => {
      const k = set.c[j], n = area.N[k], p = area.A[k];
      const d = (P[3 * i] - p.x) * n.x + (P[3 * i + 1] - p.y) * n.y + (P[3 * i + 2] - p.z) * n.z;
      const f = d * set.w[j] * state.strength * CONFIG.flattenFactor;
      P[3 * i] -= n.x * f; P[3 * i + 1] -= n.y * f; P[3 * i + 2] -= n.z * f;
    });
  },
  pinch(set, { area, centers, invert }) {                   // Pinch/Crease: tira verso il centro (sul piano tangente) + leggero solco
    const P = active.geo.attributes.position.array, sg = invert ? -1 : 1;
    set.idx.forEach((i, j) => {
      const k = set.c[j], n = area.N[k], c = centers[k], w = set.w[j];
      const dx = c.x - P[3 * i], dy = c.y - P[3 * i + 1], dz = c.z - P[3 * i + 2], dn = dx * n.x + dy * n.y + dz * n.z;
      const t = state.strength * CONFIG.pinchFactor * w * sg, cr = state.radius * 0.03 * state.strength * w * sg;
      P[3 * i] += (dx - n.x * dn) * t - n.x * cr;
      P[3 * i + 1] += (dy - n.y * dn) * t - n.y * cr;
      P[3 * i + 2] += (dz - n.z * dn) * t - n.z * cr;
    });
  },
  mask(set, { invert }) {                                   // Mask: accumula (Alt = cancella) e scurisce il colore vertice
    const a = state.strength * CONFIG.maskFactor * (invert ? -1 : 1);
    set.idx.forEach((i, j) => { active.mask[i] = Math.min(1, Math.max(0, active.mask[i] + a * set.w[j])); setColor(active, i); });
    active.geo.attributes.color.needsUpdate = true;
  }
};

/* Grab: insieme di vertici "congelato" all'inizio del trascinamento; ogni vertice segue il mouse × il suo peso */
let grab = null;
const grabPlane = new THREE.Plane(), grabPoint = new THREE.Vector3();
function startGrab(hitPoint) {
  const set = gather(makeCenters(hitPoint)), P = active.geo.attributes.position.array, orig = new Float32Array(set.idx.length * 3);
  set.idx.forEach((i, j) => orig.set([P[3 * i], P[3 * i + 1], P[3 * i + 2]], 3 * j));
  touch(set);
  grabPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), hitPoint);  // piano parallelo allo schermo
  grab = { set, orig, start: hitPoint.clone() };
}
function updateGrab() {
  if (!raycaster.ray.intersectPlane(grabPlane, grabPoint)) return;
  const d = grabPoint.sub(grab.start), P = active.geo.attributes.position.array, { set, orig } = grab;
  set.idx.forEach((i, j) => {
    const w = set.w[j], sx = set.c[j] === 1 ? -1 : 1;       // lato specchiato: delta X invertito
    P[3 * i] = orig[3 * j] + d.x * sx * w; P[3 * i + 1] = orig[3 * j + 1] + d.y * w; P[3 * i + 2] = orig[3 * j + 2] + d.z * w;
  });
}
function sculptAt(point, invert) {
  const centers = makeCenters(point), set = gather(centers, state.tool !== 'mask');
  if (!set.idx.length) return;
  touch(set);
  BRUSHES[state.tool](set, { area: areaData(set, centers.length), centers, invert });
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
  if (e.button !== 0 || state.mode !== 'sculpt' || !active || !active.mesh.visible) return;
  setPointer(e);
  const hit = raycaster.intersectObject(active.mesh)[0];
  if (!hit) return;
  controls.enabled = false; canvas.setPointerCapture(e.pointerId);
  stroke = { invert: e.altKey, rec: active, saved: new Map() };
  if (state.tool === 'grab') startGrab(hit.point);
  dirty = true;
});
canvas.addEventListener('pointermove', e => { setPointer(e); if (stroke) stroke.invert = e.altKey; dirty = true; });
function endStroke() {
  if (!stroke) return;
  pushHistory(); markDirty(); stroke = null; grab = null; controls.enabled = true; refreshSel(); syncDims();
}
canvas.addEventListener('pointerup', e => {
  endStroke();
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
  if (stroke && state.tool === 'grab') { updateGrab(); commit(stroke.rec); return; }
  const hit = raycaster.intersectObject(active.mesh)[0];
  updateCursor(hit);
  if (stroke && hit) { sculptAt(hit.point, stroke.invert); commit(active); }
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
  if (active) m === 'sculpt' ? bake(active) : recenter(active);   // sculpt: identità · trasforma: pivot al centro
  document.body.dataset.mode = m; $('btn-mode').classList.toggle('active', m === 'transform');
  cursor.visible = false; attachGizmo(); syncDims();
}
function setGizmo(g) {
  state.gizmo = g; document.querySelectorAll('[data-gizmo]').forEach(b => b.classList.toggle('active', b.dataset.gizmo === g));
  if (state.mode !== 'transform') setMode('transform'); else attachGizmo();
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
const toolBtns = document.querySelectorAll('[data-tool]');
function setTool(tool) {
  state.tool = tool; toolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  $('tool-label').textContent = t(tool);
}
toolBtns.forEach(b => b.addEventListener('click', () => { setTool(b.dataset.tool); if (state.mode !== 'sculpt') setMode('sculpt'); }));
document.querySelectorAll('[data-gizmo]').forEach(b => b.addEventListener('click', () => setGizmo(b.dataset.gizmo)));

function bindSlider(id, key, cfg) {
  const el = $(id), out = $(id + '-val');
  el.min = cfg.min; el.max = cfg.max; el.value = cfg.value; out.textContent = (+cfg.value).toFixed(cfg.dec);
  el.addEventListener('input', () => { state[key] = +el.value; out.textContent = (+el.value).toFixed(cfg.dec); });
}
bindSlider('radius', 'radius', CONFIG.radius); bindSlider('strength', 'strength', CONFIG.strength);

/* --- i18n: ogni elemento con data-i18n / data-i18n-title viene tradotto senza ricaricare la pagina --- */
const SHORTCUTS = [['Tab', 'keyMode'], ['D', 'draw'], ['S', 'smooth'], ['G', 'grab'], ['L', 'flatten'], ['I', 'inflate'], ['P', 'pinch'],
  ['M', 'mask'], ['Alt', 'keyInvert'], ['X', 'sym'], ['W', 'move'], ['E', 'rotate'], ['R', 'scale'], ['F', 'focus'], ['Home', 'frameAll'],
  ['Del', 'keyDel'], ['Ctrl+Z', 'undo'], ['Ctrl+Y', 'redo'], ['?', 'shortcuts']];
function buildHelp() {
  $('help-body').innerHTML = SHORTCUTS.map(([k, l]) => `<tr><td><kbd>${k}</kbd></td><td>${t(l)}</td></tr>`).join('');
}
function applyLang(l) {
  lang = I18N[l] ? l : 'en'; document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
  document.querySelectorAll('[data-i18n-title]').forEach(el => el.title = t(el.dataset.i18nTitle));
  $('tool-label').textContent = t(state.tool);
  refreshList(); buildHelp();
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
$('btn-mode').addEventListener('click', () => setMode(state.mode === 'sculpt' ? 'transform' : 'sculpt'));
$('btn-undo').addEventListener('click', undo); $('btn-redo').addEventListener('click', redo);
$('btn-reset').addEventListener('click', resetScene);
$('btn-focus').addEventListener('click', focusActive);
$('btn-frame').addEventListener('click', frameAll);
$('btn-cam').addEventListener('click', resetCamera);
$('btn-help').addEventListener('click', () => $('help').showModal());
$('btn-create').addEventListener('click', () => {
  const dims = ['px', 'py', 'pz'].map(id => Math.max(1, +$(id).value || 1)), type = $('prim-type').value;
  spawn([{ geo: makePrimitive(type), name: $('prim-type').selectedOptions[0].text }], dims); focusActive();
});
['ax', 'ay', 'az'].forEach(id => $(id).addEventListener('change', applyDims));
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
  if ($('help').open || ['number', 'select-one'].includes(e.target.type)) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tools = { d: 'draw', s: 'smooth', g: 'grab', l: 'flatten', i: 'inflate', p: 'pinch', m: 'mask' };
  const gizmos = { w: 'translate', e: 'rotate', r: 'scale' };
  if (e.key === 'Tab') { e.preventDefault(); setMode(state.mode === 'sculpt' ? 'transform' : 'sculpt'); }
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
