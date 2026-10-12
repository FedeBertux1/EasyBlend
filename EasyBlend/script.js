'use strict';
/* =====================================================================
   SCULPT LITE v2 – scultura 3D in Three.js r147, tutto in locale.
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
                symmetry: true, gizmo: 'translate', snap: false, gridStep: CONFIG.gridStep };
const $ = id => document.getElementById(id);
const I = new THREE.Matrix4();                       // matrice identità di confronto

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
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);

// Griglia in mm sul piano Y=0 (la cella si cambia dal pannello)
let grid;
function buildGrid() {
  if (grid) { scene.remove(grid); grid.geometry.dispose(); }
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
// vertexColors: true → la maschera (vertici più scuri) è visibile con ogni materiale
const MATERIALS = {
  clay:  new THREE.MeshStandardMaterial({ color: CONFIG.clayColor, roughness: 0.9, metalness: 0, vertexColors: true }),
  metal: new THREE.MeshMatcapMaterial({ matcap: matcap(['#ffffff', '#c9ced6', '#6b7078', '#1c1e22']), vertexColors: true }),
  wax:   new THREE.MeshMatcapMaterial({ matcap: matcap(['#ffb3a7', '#d6453a', '#8e1f18', '#3a0805']), vertexColors: true })
};
let material = MATERIALS.clay;

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
  g = THREE.BufferGeometryUtils.mergeVertices(g, 1e-4);
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
  setActive(recs[recs.length - 1]);
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
  scene.remove(rec.mesh); rec.geo.dispose(); recs.splice(recs.indexOf(rec), 1);
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
function applyDims() {
  if (!active) return;
  const t = ['ax', 'ay', 'az'].map(id => +$(id).value);
  if (t.some(v => !(v > 0))) return syncDims();
  bake(active);                                           // lavora in coordinate mondo
  const g = active.geo; g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3()), s = g.boundingBox.getSize(new THREE.Vector3());
  g.translate(-c.x, -c.y, -c.z); g.scale(t[0] / s.x, t[1] / s.y, t[2] / s.z); g.translate(c.x, c.y, c.z);
  g.computeVertexNormals(); g.computeBoundingSphere(); clearHistory();
  if (state.mode === 'transform') recenter(active);
  refreshSel(); syncDims();
}

function focusActive() {                                   // centra e inquadra l'oggetto attivo
  if (!active) return;
  const b = new THREE.Box3().setFromObject(active.mesh), c = b.getCenter(new THREE.Vector3());
  const r = b.getSize(new THREE.Vector3()).length() / 2 || 1;
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1);
  controls.update();
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
  pushHistory(); stroke = null; grab = null; controls.enabled = true; refreshSel(); syncDims();
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
transform.addEventListener('objectChange', () => { refreshSel(); syncDims(); });
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
      if (items.length) { spawn(items); focusActive(); } else alert('Nessuna mesh trovata nel file.');
    }, err => alert('Errore glTF: ' + (err.message || err)));
  } else alert('Formato non supportato: usa .glb, .gltf o .stl');
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

/* ---------- 9. INTERFACCIA ---------- */
const toolBtns = document.querySelectorAll('[data-tool]');
const TOOL_NAMES = { draw: 'Draw', smooth: 'Smooth', grab: 'Grab', flatten: 'Flatten', inflate: 'Inflate', pinch: 'Pinch', mask: 'Mask' };
function setTool(t) {
  state.tool = t; toolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === t)); $('tool-label').textContent = TOOL_NAMES[t];
}
toolBtns.forEach(b => b.addEventListener('click', () => { setTool(b.dataset.tool); if (state.mode !== 'sculpt') setMode('sculpt'); }));
document.querySelectorAll('[data-gizmo]').forEach(b => b.addEventListener('click', () => setGizmo(b.dataset.gizmo)));

function bindSlider(id, key, cfg) {
  const el = $(id), out = $(id + '-val');
  el.min = cfg.min; el.max = cfg.max; el.value = cfg.value; out.textContent = (+cfg.value).toFixed(cfg.dec);
  el.addEventListener('input', () => { state[key] = +el.value; out.textContent = (+el.value).toFixed(cfg.dec); });
}
bindSlider('radius', 'radius', CONFIG.radius); bindSlider('strength', 'strength', CONFIG.strength);

function refreshList() {                                    // lista mesh: seleziona · mostra/nascondi · elimina
  const ul = $('mesh-list'); ul.innerHTML = '';
  recs.forEach(r => {
    const li = document.createElement('li'); li.className = r === active ? 'sel' : '';
    li.innerHTML = '<span class="nm"></span><button title="Mostra/Nascondi"></button><button title="Elimina">✕</button>';
    const [nm, eye, del] = li.children;
    nm.textContent = r.name; eye.textContent = r.mesh.visible ? '◉' : '○';
    nm.onclick = () => setActive(r);
    eye.onclick = () => { r.mesh.visible = !r.mesh.visible; attachGizmo(); refreshSel(); refreshList(); };
    del.onclick = () => removeMesh(r);
    ul.appendChild(li);
  });
}

$('symmetry').addEventListener('change', e => state.symmetry = e.target.checked);
$('wireframe').addEventListener('change', e => Object.values(MATERIALS).forEach(m => m.wireframe = e.target.checked));
$('material').addEventListener('change', e => {
  material = MATERIALS[e.target.value]; recs.forEach(r => r.mesh.material = material);
});
$('grid-vis').addEventListener('change', e => grid.visible = e.target.checked);
$('grid-step').addEventListener('change', e => {
  state.gridStep = Math.max(1, +e.target.value || CONFIG.gridStep); e.target.value = state.gridStep; buildGrid(); applySnap();
});
$('snap').addEventListener('change', e => { state.snap = e.target.checked; applySnap(); });
$('btn-mode').addEventListener('click', () => setMode(state.mode === 'sculpt' ? 'transform' : 'sculpt'));
$('btn-undo').addEventListener('click', undo); $('btn-redo').addEventListener('click', redo);
$('btn-reset').addEventListener('click', resetScene);
$('btn-focus').addEventListener('click', focusActive);
$('btn-create').addEventListener('click', () => {
  const dims = ['px', 'py', 'pz'].map(id => Math.max(1, +$(id).value || 1)), type = $('prim-type').value;
  spawn([{ geo: makePrimitive(type), name: $('prim-type').selectedOptions[0].text }], dims); focusActive();
});
['ax', 'ay', 'az'].forEach(id => $(id).addEventListener('change', applyDims));
$('btn-mask-clear').addEventListener('click', () => {
  if (!active) return;
  active.mask.fill(0); for (let i = 0; i < active.mask.length; i++) setColor(active, i);
  active.geo.attributes.color.needsUpdate = true;
});
$('btn-import').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', e => { [...e.target.files].forEach(importFile); e.target.value = ''; });
// Drag-and-drop sulla viewport
viewport.addEventListener('dragover', e => { e.preventDefault(); viewport.classList.add('drop'); });
viewport.addEventListener('dragleave', () => viewport.classList.remove('drop'));
viewport.addEventListener('drop', e => { e.preventDefault(); viewport.classList.remove('drop'); [...e.dataTransfer.files].forEach(importFile); });

// Scorciatoie
window.addEventListener('keydown', e => {
  if (['number', 'select-one'].includes(e.target.type)) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tools = { d: 'draw', s: 'smooth', g: 'grab', l: 'flatten', i: 'inflate', p: 'pinch', m: 'mask' };
  const gizmos = { w: 'translate', e: 'rotate', r: 'scale' };
  if (e.key === 'Tab') { e.preventDefault(); setMode(state.mode === 'sculpt' ? 'transform' : 'sculpt'); }
  else if (e.key === 'Delete' && active) removeMesh(active);
  else if (k === 'f') focusActive();
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
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportOBJ() {
  const out = ['# Sculpt Lite (mm)']; let off = 0;
  collect().forEach(({ name, p, idx }) => {
    out.push('o ' + name.replace(/\s+/g, '_'));
    for (let i = 0; i < p.length; i += 3) out.push(`v ${p[i].toFixed(4)} ${p[i + 1].toFixed(4)} ${p[i + 2].toFixed(4)}`);
    for (let i = 0; i < idx.length; i += 3) out.push(`f ${off + idx[i] + 1} ${off + idx[i + 1] + 1} ${off + idx[i + 2] + 1}`);  // OBJ conta da 1
    off += p.length / 3;
  });
  if (off) download(new Blob([out.join('\n')], { type: 'text/plain' }), 'sculpt.obj');
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
  download(new Blob([dv.buffer], { type: 'model/stl' }), 'sculpt.stl');
}
$('btn-stl').addEventListener('click', exportSTL); $('btn-obj').addEventListener('click', exportOBJ);

/* ---------- 11. AVVIO E LOOP ---------- */
buildGrid(); resize(); applySnap(); resetScene();
(function loop() {
  requestAnimationFrame(loop);
  processInput();
  controls.update();                                        // necessario con enableDamping
  renderer.render(scene, camera);
})();
