// studio/studioManager.js — webcam + Three.js composite loop

import { createMathObject } from './mathObjectFactory.js';

let THREE = null;
let renderer = null;
let scene = null;
let camera = null;
let video = null;
let stream = null;
let raf = null;
let bgTex = null;
let bgMesh = null;
let objects = [];
let chroma = false;
let annotCv = null;
let annotCtx = null;
let strokes = [];
let drawing = null;
let errEl = null;
let resizeOut = null;

const CAMERA_TIMEOUT_MS = 10000;
// True once the studio has been (or is being) torn down. Guards against a getUserMedia
// promise resolving AFTER the timeout/teardown already lost the race — that stream is
// live but unreferenced, so without this the camera light stays on forever.
let disposed = false;

function getCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('Camera unavailable (requires HTTPS or localhost).'));
  }
  const media = navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  // Always capture the real stream when it arrives. If we already gave up (timeout won the
  // race, or the panel was closed while the prompt was pending), stop it immediately so the
  // camera is released; otherwise hand it to teardownStudio via the module-level `stream`.
  media.then((s) => {
    stream = s;
    if (disposed) { s.getTracks().forEach((t) => t.stop()); stream = null; }
  }).catch(() => {});
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Camera permission timed out — please try again.')), CAMERA_TIMEOUT_MS);
  });
  return Promise.race([media, timeout]);
}

function cameraErrMsg(e) {
  if (e?.name === 'NotAllowedError') return 'Camera permission denied.';
  if (e?.name === 'NotFoundError') return 'No camera found.';
  if (e?.message?.includes('timed out')) return e.message;
  if (!navigator.mediaDevices?.getUserMedia) return 'Camera unavailable (requires HTTPS or localhost).';
  return e?.message || 'Could not access camera.';
}

export async function initStudio(container) {
  disposed = false;
  errEl = container.querySelector('.studio-err');
  if (!window.THREE) throw new Error('Three.js not loaded.');
  THREE = window.THREE;
  video = container.querySelector('video');
  annotCv = container.querySelector('#studio-annot');
  annotCtx = annotCv?.getContext('2d');
  const out = container.querySelector('#studio-output-canvas');
  if (!out) throw new Error('Studio canvas missing.');

  // Camera is OPTIONAL. iOS Home-Screen PWAs block getUserMedia and many
  // classrooms have no camera, so a failure must not kill the studio — we
  // fall back to a clean 3D-only viewer (still fully usable for 3D maths).
  let cameraOn = false;
  try {
    stream = await getCameraStream();
    video.srcObject = stream;
    await video.play();
    cameraOn = true;
  } catch (e) {
    showErr(cameraErrMsg(e) + ' Showing 3D only.');
  }

  renderer = new THREE.WebGLRenderer({ canvas: out, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  resizeOut = out;
  resizeRenderer(out);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, out.clientWidth / out.clientHeight, 0.1, 100);
  camera.position.set(0, 1.2, 4);
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(2, 4, 3);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x666666));

  if (cameraOn) {
    bgTex = new THREE.VideoTexture(video);
    bgTex.minFilter = THREE.LinearFilter;
    const bgGeo = new THREE.PlaneGeometry(16, 9);
    const bgMat = new THREE.MeshBasicMaterial({ map: bgTex, side: THREE.DoubleSide });
    bgMesh = new THREE.Mesh(bgGeo, bgMat);
    bgMesh.position.z = -4;
    scene.add(bgMesh);
  } else {
    // No camera → solid dark backdrop so the 3D scene reads clearly.
    scene.background = new THREE.Color(0x0b1020);
  }

  addObject('grid');
  if (annotCv) bindAnnot(annotCv);
  loop();
  window.addEventListener('resize', onResize);
  out.addEventListener('webglcontextlost', (e) => { e.preventDefault(); showErr('WebGL lost — close and reopen studio.'); });
}

function onResize() {
  if (resizeOut) resizeRenderer(resizeOut);
}

function resizeRenderer(out) {
  if (!renderer) return;
  const w = out.clientWidth, h = out.clientHeight;
  renderer.setSize(w, h, false);
  if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  if (annotCv) { annotCv.width = w; annotCv.height = h; }
}

function showErr(msg) {
  if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
}

export function addObject(spec) {
  if (!scene || !THREE) return;
  const obj = createMathObject(spec, THREE, window.math);
  obj.position.set(0, 0, 0);
  scene.add(obj);
  objects.push(obj);
}

export function setChroma(on) {
  chroma = !!on;
  if (bgMesh?.material) bgMesh.material.opacity = chroma ? 0.85 : 1;
}

export function clearAnnotations() {
  strokes = [];
  if (annotCtx && annotCv) annotCtx.clearRect(0, 0, annotCv.width, annotCv.height);
}

function bindAnnot(out) {
  const pen = (e) => {
    const r = out.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  out.addEventListener('pointerdown', (e) => {
    drawing = { points: [pen(e)], color: '#ff4444', width: 3 };
  });
  out.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    drawing.points.push(pen(e));
    drawAnnot();
  });
  out.addEventListener('pointerup', () => {
    if (drawing) { strokes.push(drawing); drawing = null; }
  });
}

function drawAnnot() {
  if (!annotCtx) return;
  annotCtx.clearRect(0, 0, annotCv.width, annotCv.height);
  const all = drawing ? [...strokes, drawing] : strokes;
  for (const s of all) {
    annotCtx.strokeStyle = s.color; annotCtx.lineWidth = s.width; annotCtx.lineCap = 'round';
    annotCtx.beginPath();
    s.points.forEach((p, i) => (i ? annotCtx.lineTo(p.x, p.y) : annotCtx.moveTo(p.x, p.y)));
    annotCtx.stroke();
  }
}

function loop() {
  const t = performance.now() / 5000;
  if (bgTex) bgTex.needsUpdate = true;
  for (const o of objects) o.userData.update?.(t);
  if (renderer && scene && camera) renderer.render(scene, camera);
  raf = requestAnimationFrame(loop);
}

export function teardownStudio() {
  disposed = true;
  cancelAnimationFrame(raf);
  raf = null;
  if (stream) stream.getTracks().forEach((tr) => tr.stop());
  stream = null;
  if (video) video.srcObject = null;
  window.removeEventListener('resize', onResize);
  for (const o of objects) {
    scene?.remove(o);
    o.traverse?.((c) => { c.geometry?.dispose?.(); c.material?.dispose?.(); });
  }
  objects = [];
  bgTex?.dispose?.();
  renderer?.dispose?.();
  renderer = scene = camera = bgTex = bgMesh = video = resizeOut = null;
  strokes = []; drawing = null;
  if (errEl) errEl.classList.add('hidden');
}
