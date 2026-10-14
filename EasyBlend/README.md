# EasyBlend 🎨🧊

**EasyBlend** è un'applicazione web 3D completamente client-side (nessun backend, nessun database) per la scultura organica rapida e la modellazione parametrica direttamente nel browser. Combina l'intuitività e la fluidità della **Sculpt Mode di Blender** con la precisione del **disegno 2D e del taglio booleano CAD in stile Autodesk Fusion 360**.

---

## 🚀 Funzionalità Principali

### 🖌️ Scultura Organica (Ispirata a Blender)
* **Ampia gamma di pennelli**: *Draw, Draw Sharp, Clay, Layer, Inflate, Blob, Crease, Smooth, Flatten, Scrape, Fill, Pinch, Grab, Snake Hook, Nudge, Rotate, Mask* e *Clear Mask*.
* **Simmetria X**: Specchiatura automatica e dinamica dei tratti lungo l'asse X.
* **Manipolazione Vertici in Tempo Reale**: Ricalcolo istantaneo delle normali e dell'illuminazione per una superficie fluida.

### 📐 Schizzo 2D Parametrico & Taglio CAD (Ispirato a Fusion 360)
* **Schizzi Compositi Complessi**: Disegna profili chiusi combinando Linee, Archi e Cerchi nello stesso tracciato vettoriale.
* **Selezione del Piano di Lavoro (Work Plane)**: Scegli di disegnare sui piani cartesiani (XY, XZ, YZ) o direttamente su una faccia piana di una mesh 3D esistente.
* **Snap Automatico & Input Numerici**: Aggancio visivo ai vertici finali (*endpoint*) e immissione precisa di dimensioni (mm) e angoli (°).
* **Estrusione & Taglio Booleano (Cut)**: Estrudi uno schizzo per creare un nuovo corpo 3D oppure esegui uno scavo/taglio trapassante attraverso la mesh intercettata.

### 📦 Primitive Parametriche & Trasformazioni
* **Generatore di Primitive**: Cubo, Cilindro, Cono, Toro, UV Sphere e IcoSphere con dimensioni espresse in millimetri reali.
* **Gizmo 3D & Campi Contestuali**: Traslazione, Rotazione (in gradi °) e Scalatura (con opzione proporzionale) con sincronizzazione bidirezionale in tempo reale.

### 🌐 Interfaccia, Privacy & Localizzazione
* **100% Client-Side & Privacy**: Nessun server esterno o tracciamento. I file e i dati rimangono interamente all'interno del browser dell'utente.
* **Sistema Multilingua (i18n)**: Cambio lingua dinamico istantaneo tra Inglese (predefinito), Italiano, Spagnolo e Francese.
* **Import / Esportazione 3D**: Supporto in importazione per `.GLB`, `.gTF` e `.STL`. Esportazione diretta per la stampa 3D nei formati `.STL` (binario) e `.OBJ`, oltre alla cattura di screenshot PNG.
* **UI Dark Mode Ispirata a Blender**: Layout pulito con barra di navigazione fluttuante per la visuale, pannelli laterali organizzati a sezioni ed estetica professionale.

---

## 🛠️ Architettura Tecnica & Dipendenze

* **Linguaggi**: HTML5, CSS3, Vanilla JavaScript (ES6+).
* **Libreria Grafica**: [Three.js (v0.147.0)](https://threejs.org/) caricata tramite CDN.
* **Moduli Three.js usati**: `OrbitControls`, `TransformControls`, `GLTFLoader`, `STLLoader`, `BufferGeometryUtils`.
* **Deployment**: Hosting di file statici (es. Cloudflare Pages, GitHub Pages, Vercel).

---

## 📂 Struttura della Repository

```text
easyblend/
├── assets/
│   └── logo.jpg         # Logo principale e Favicon dell'applicazione
├── index.html           # Struttura DOM, layout, pannelli e modali (Help, Legal, Donate)
├── style.css            # Layout CSS Grid, variabili colore tema scuro e responsività
├── script.js           # Motore 3D Three.js, logica pennelli, schizzi CAD, i18n e UI
└── README.md            # Documentazione del progetto
