# Live AR Studio Layout — design & build spec

> Captured per request. To be implemented **after the offline‑polish pass is complete** and
> **before** the online live‑portal work. This document is the source of truth for the feature.

## Goal
Let a teacher blend **live webcam + real‑time 3D/AR math simulations + blackboard drawings** into a
single full‑screen `<canvas>` that can be **screen‑shared cleanly via Google Meet / Zoom**.

## Architecture note (important): vanilla, not React
The original brief requested a React/TypeScript structure (`StudioManager.ts`,
`MathObjectFactory.ts`, `LiveStudioView.tsx`). **MathBoard's golden rule is vanilla ES modules with
no build step**, and the whole app already follows that. To stay consistent (and keep the offline,
single‑folder, `python3 -m http.server` deployability), we implement the **same decoupled
architecture as vanilla ES modules**, with the identical responsibilities:

| Brief (React/TS) | MathBoard (vanilla ES module) | Responsibility |
|---|---|---|
| `StudioManager.ts` | `js/studio/studioManager.js` | MediaStream init, Three.js `WebGLRenderer`, the 60 fps render/composite loop, layer toggles, error handling |
| `MathObjectFactory.ts` | `js/studio/mathObjectFactory.js` | Parse a text string → inject a 3D object (helix, vector field, parametric surface, rotating solid, 3D function plot) into the live scene |
| `LiveStudioView.tsx` | `js/studio/liveStudioView.js` (+ a `#studio` overlay in `index.html`) | Distraction‑free **Presentation Window Mode**: hide all chrome; show only the studio canvas |

Three.js is **vendored locally** (`vendor/three.min.js`) like every other lib. MediaPipe Selfie
Segmentation is an **optional enhancement** loaded best‑effort (it needs WASM + a model); the studio
must fully work without it via a **pass‑through / chroma‑key** background mode so the core stays
offline‑capable.

## The four layers (compositing pipeline)
A single output canvas `#studio-output-canvas` at **60 fps** via `requestAnimationFrame`:

1. **Layer 1 — Video source:** `navigator.mediaDevices.getUserMedia({ video, audio:false })` → a
   hidden `<video>` element; latest frame pulled each tick.
2. **Layer 2 — AR background effect:** MediaPipe **Selfie Segmentation** (if available) to
   key out / replace the background; otherwise **pass‑through** or **chroma‑key** mode.
3. **Layer 3 — 3D engine:** a **Three.js** scene rendered into the **same WebGL context** as the
   output. The processed webcam frame is drawn as a **background texture** (full‑screen quad behind
   the camera) so 3D math objects sit *on top of* the physical scene (AR look).
4. **Layer 4 — 2D annotations:** pen/marker strokes composited last (drawn into the same canvas via
   the 2D pass, or a transparent 2D canvas stacked and copied in once per frame).

### Compositing order each frame
```
rAF tick →
  grab webcam frame (Layer 1)
  → segment/replace background if enabled (Layer 2)
  → upload as Three.js background texture; render 3D scene (Layer 3) into #studio-output-canvas
  → draw 2D annotation strokes on top (Layer 4)
```

## Performance & UX constraints (from brief)
- **Minimize latency**: render directly into the WebGL context; avoid offscreen canvas cloning;
  reuse a single `THREE.Texture` (`needsUpdate = true`) for the webcam frame rather than re‑allocating.
- **Toggle: "Chroma Key / Transparent Backing" vs "Normal Camera Background"** (one switch).
- **Explicit error handling** for: camera permission denial (`NotAllowedError`/`NotFoundError`),
  no WebGL / `webglcontextlost` (listen and attempt restore + user message), MediaPipe load failure
  (fall back to pass‑through).
- **Presentation Window Mode**: `requestFullscreen()` on the studio container; hide every toolbar /
  panel / strip so a Zoom/Meet screen‑share shows only the high‑fidelity feed.

## MathObjectFactory — dynamic 3D from text
`create(spec: string)` parses simple specs and returns a `THREE.Object3D`, e.g.:
- `helix r=1 turns=4` → parametric helix line
- `vector 1,2,3` → arrow (`THREE.ArrowHelper`) for a 3D vector / field sample
- `plane z = x^2 - y^2` or `surface sin(x)*cos(y)` → parametric/triangulated surface mesh (eval via
  the already‑vendored **mathjs**)
- `rotate cube` / `rotate sphere` → spinning solid (animated in the loop)
- `grid` → 3D coordinate grid + axes
Reuses `window.math` for safe expression evaluation; objects get an `update(t)` hook for animation.

## Integration with MathBoard
- New top‑bar / Panels entry **"AR Studio"** opens the `#studio` overlay (its own full‑screen layer
  above the editor; does not disturb the notebook).
- The Layer‑4 annotations can reuse the existing pen/colour/size state for consistency.
- It is **session‑only** (live teaching aid), not persisted into the notebook document.
- Camera/3D are heavy: the studio initialises lazily on open and tears down (stops tracks, disposes
  renderer/geometries/textures) on close to free GPU/camera.

## Acceptance checklist
- [ ] Opens to a clean full‑screen canvas; camera prompt handled; denial shows a friendly message.
- [ ] Webcam visible as background; 3D math object(s) render on top at ~60 fps.
- [ ] Toggle swaps Normal background ↔ Chroma/transparent (segmentation if available, else key).
- [ ] `MathObjectFactory` injects at least helix, 3D vector, parametric surface, rotating solid, grid.
- [ ] 2D pen annotations composite on top and appear in a Zoom/Meet screen‑share of the window.
- [ ] WebGL context‑loss and camera errors handled without crashing the app.
- [ ] Vendored Three.js; core works offline (segmentation optional).
