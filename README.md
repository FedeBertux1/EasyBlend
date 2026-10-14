# EasyBlend 🎨🧊

> **High-Performance, Client-Side 3D Sculpting and CAD Modeling in Your Browser.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-r147-black?logo=three.js)](https://threejs.org/)
[![WebGL](https://img.shields.io/badge/WebGL-2.0-blue?logo=webgl)](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API)
[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-orange?logo=ko-fi)](https://ko-fi.com/tuonome)

---

START USING EASYBLEND NOW: https://easyblend.pages.dev/

---

## 📖 Overview

**EasyBlend** is a modern, lightweight, 100% client-side 3D web application designed for fast organic sculpting and parametric CAD modeling. Running entirely in the browser without backend dependencies, EasyBlend bridges the gap between the intuitive, fluid workflow of **Blender’s Sculpt Mode** and the precision of **Autodesk Fusion 360’s 2D sketching & boolean operations**.

---

## ✨ Key Features

### 🖌️ Blender-Inspired Organic Sculpting
* **Comprehensive Brush Suite**: Includes *Draw*, *Draw Sharp*, *Clay*, *Clay Strips*, *Layer*, *Inflate*, *Blob*, *Crease*, *Smooth*, *Flatten*, *Scrape*, *Fill*, *Pinch*, *Grab*, *Snake Hook*, *Nudge*, *Rotate*, *Mask*, and *Clear Mask*.
* **X-Axis Dynamic Symmetry**: Real-time mirrored brush strokes across the X-axis for rapid character and creature creation.
* **Real-Time Mesh Updates**: On-the-fly recalculation of vertex normals and bounding volumes to ensure smooth shading and responsive raycasting.

### 📐 Fusion 360-Inspired 2D Sketching & CSG Boolean Operations
* **Composite Vector Sketching**: Draw complex closed profiles using a combination of straight lines, arcs, and circles within a single sketch session.
* **Selectable Work Planes**: Project 2D sketches onto standard Cartesian planes (XY, XZ, YZ) or directly onto planar faces of existing 3D meshes.
* **Endpoint & Vertex Snapping**: Automatic visual snapping indicators for precise geometry closure.
* **Extrude & Boolean Cut**: Convert 2D profiles into extruded 3D geometry or perform boolean subtractive cuts directly through intersecting target meshes.

### 📦 Parametric Primitives & Precise Transformations
* **Primitive Mesh Generator**: Create customizable Box, Cylinder, Cone, Torus, UV Sphere, and IcoSphere meshes with real-world dimensions in millimeters ($mm$).
* **Interactive 3D Gizmo**: Translate, rotate (in degrees °), and scale (with uniform/proportional toggle) with two-way binding between UI input fields and 3D objects.

### 🖥️ Modern UI/UX & Localization
* **Blender Dark Theme**: Optimized dark interface with categorized toolbars, collapsible panels, and a bottom-center camera viewport navigation bar.
* **100% Private & Client-Side**: No server communication, no user tracking, and no external data storage. All processing occurs locally in the client browser.
* **Multi-Language Support (i18n)**: Seamless dynamic language switching between **English (default)**, **Italian**, **Spanish**, and **French**.
* **Export & Capture**: One-click binary `.STL` export (ready for 3D printer slicers), `.OBJ` export, and high-resolution PNG viewport screenshots.

---

## 🛠️ Tech Stack & Architecture

| Component | Technology |
| :--- | :--- |
| **Core Engine** | [Three.js (v0.147.0)](https://threejs.org/) via CDN |
| **Controls & Utilities** | `OrbitControls`, `TransformControls`, `GLTFLoader`, `STLLoader`, `BufferGeometryUtils` |
| **Frontend Stack** | HTML5, CSS3 (CSS Grid / Custom Properties), Vanilla JavaScript (ES6+) |
| **Deployment** | Static Web Hosting (Cloudflare Pages / GitHub Pages) |

---

## 📁 Repository Structure

```text
easyblend/
├── assets/
│   └── logo.png         # Main application logo and browser favicon
├── index.html           # Application DOM layout, control panels, and native modals
├── style.css            # Dark theme styles, CSS Grid layout, and UI components
├── script.js           # Three.js 3D engine, sculpt algorithms, CAD sketching & i18n
├── LICENSE              # Open-source license file
└── README.md            # Project documentation
