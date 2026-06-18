// Instanced three-fenestra example: a whole facade of windows — hundreds of
// them — drawn from ONE InstancedMesh sharing ONE material, in a single draw
// call. Per-window identity (which room, lit or dark, warm or cool) lives in
// instanced attributes, not in per-window uniforms.
//
// This is the v0.3.0 `instanced: true` path. The pieces:
//   - geometry carries `instanceWindowId` (vec3), `instanceLod` (float) and
//     `instanceFade` (float) as InstancedBufferAttributes
//   - the matrix of each instance places one window on the grid
//   - `emissiveVariation` turns windowId into a lit/unlit, warm/cool look on
//     the GPU, so each window differs with zero per-instance CPU work
//
// Uses the starter atlas that ships with the package.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { InteriorMappingMaterial } from 'three-fenestra';
import roomsUrl from 'three-fenestra/starter/rooms.webp';

// ─── Grid dimensions ──────────────────────────────────────────────────────────
const COLS = 32;
const ROWS = 20;
const COUNT = COLS * ROWS;
const WIN_W = 1.0;   // window width (world units)
const WIN_H = 1.4;   // window height
const GAP_X = 0.5;   // mullion gap between windows
const GAP_Y = 0.6;
const CELL_W = WIN_W + GAP_X;
const CELL_H = WIN_H + GAP_Y;

// ─── Renderer / scene / camera ──────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06080c);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(COLS * CELL_W * 0.18, ROWS * CELL_H * 0.5, COLS * CELL_W * 0.62);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, ROWS * CELL_H * 0.5, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.25));
const sun = new THREE.DirectionalLight(0x9ab4ff, 0.4);
sun.position.set(3, 5, 4);
scene.add(sun);

// ─── Back atlas (4×4 starter) ─────────────────────────────────────────────────
const atlas = new THREE.TextureLoader().load(roomsUrl);
atlas.colorSpace = THREE.SRGBColorSpace;
atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
atlas.minFilter = THREE.LinearMipmapLinearFilter;
atlas.magFilter = THREE.LinearFilter;
atlas.anisotropy = 8;

// ─── One material, one mesh, COUNT windows ────────────────────────────────────
const material = new InteriorMappingMaterial({
  backAtlas: atlas,
  backAtlasCols: 4,
  backAtlasRows: 4,
  depth: 0.9,
  backScale: 0.6,
  planeSize: new THREE.Vector2(WIN_W, WIN_H),
  // No `windowId` — in instanced mode the per-window seed comes from the
  // `instanceWindowId` attribute below.
  instanced: true,
  // Night look: ~half the windows lit, warm/cool mix, the rest near-black.
  emissiveVariation: {
    litRatio: 0.5,
    warm: new THREE.Color(1.7, 1.35, 0.95),
    cool: new THREE.Color(0.9, 1.15, 1.5),
    coolChance: 0.25,
    brightMin: 0.7, brightRange: 1.6,
    dim: new THREE.Color(0.03, 0.04, 0.06),
  },
  roughness: 0.12,
  metalness: 0.0,
});

const geom = new THREE.PlaneGeometry(WIN_W, WIN_H);

// Per-instance attributes consumed by the instanced shader path.
const ids   = new Float32Array(COUNT * 3);
const lods  = new Float32Array(COUNT);
const fades = new Float32Array(COUNT);

const mesh = new THREE.InstancedMesh(geom, material, COUNT);
mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion(); // identity — windows face +Z
const _s = new THREE.Vector3(1, 1, 1);

const originX = -((COLS - 1) * CELL_W) / 2;

let i = 0;
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    _p.set(originX + col * CELL_W, WIN_H / 2 + row * CELL_H, 0);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);

    // Window seed — any stable per-window vec3 works; grid coords are simplest.
    // The same id fed to the same hash seeds reproduces this window anywhere
    // (e.g. a far-LOD impostor), which is the point of the public seed contract.
    ids[i * 3 + 0] = col * 0.137;
    ids[i * 3 + 1] = row * 0.137;
    ids[i * 3 + 2] = 0;

    lods[i]  = 1.0; // full interior mapping; drive by distance for real LOD
    fades[i] = 1.0; // per-instance alpha (used for LOD crossfades)
    i++;
  }
}

geom.setAttribute('instanceWindowId', new THREE.InstancedBufferAttribute(ids, 3));
geom.setAttribute('instanceLod',      new THREE.InstancedBufferAttribute(lods, 1));
geom.setAttribute('instanceFade',     new THREE.InstancedBufferAttribute(fades, 1));
mesh.instanceMatrix.needsUpdate = true;

scene.add(mesh);

// A dark slab behind the glass grid so the gaps read as mullions, not void.
const backWall = new THREE.Mesh(
  new THREE.PlaneGeometry(COLS * CELL_W + 4, ROWS * CELL_H + 4),
  new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.9, metalness: 0 }),
);
backWall.position.set(0, ROWS * CELL_H * 0.5, -0.2);
scene.add(backWall);

// ─── Post (bloom so lit windows glow) ─────────────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.5, 0.7,
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const hud = document.getElementById('hud')!;
hud.textContent = `${COUNT} windows · 1 InstancedMesh · 1 draw call`;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
});

let _warm = 0;
renderer.setAnimationLoop(() => {
  controls.update();
  composer.render();
  if (++_warm === 8) (window as any).__demoReady = true;
});
