// Vista 3D del cráter Jezero: malla de relieve construida a partir del DEM MOLA
// (NASA Solar System Treks) y texturizada con mosaicos orbitales de NASA.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MARS_RADIUS, elevation, ensureCoverage, slopeAspect } from "./dem.js";
import { resolveNasaTileUrl } from "./nasa-source.js";

export const EXTENT_3D = [76.95, 17.95, 78.45, 18.85];
const [WEST, SOUTH, EAST, NORTH] = EXTENT_3D;
const LON0 = (WEST + EAST) / 2;
const LAT0 = (SOUTH + NORTH) / 2;
const KM_LAT = (Math.PI / 180) * MARS_RADIUS / 1000;
const KM_LON = KM_LAT * Math.cos((LAT0 * Math.PI) / 180);
const COLS = 300;
const ROWS = Math.round(COLS * ((NORTH - SOUTH) * KM_LAT) / ((EAST - WEST) * KM_LON));

export const HIRISE_EXTENT = [77.2229331, 18.3067994, 77.583964, 18.669315];
const HIRISE_ID = "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd";

export const TEXTURES = {
  hrsc: { label: "MOLA + HRSC", id: "Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw", ext: "jpg", zoom: 8 },
  mola: { label: "MOLA relieve", id: "Mars_MGS_MOLA_ClrShade_merge_global_463m", ext: "jpg", zoom: 7 },
  ctx: { label: "MRO CTX 5m", id: "OnMars_CTX", ext: "png", zoom: 9, tileSize: 512 },
  "themis-day": { label: "THEMIS IR día", id: "Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12_clon0_ly", ext: "png", zoom: 9 },
  "themis-night": { label: "THEMIS IR noche", id: "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018", ext: "png", zoom: 9 },
  viking: { label: "Viking color", id: "Mars_Viking_MDIM21_ClrMosaic_global_232m", ext: "jpg", zoom: 7 },
  moc: { label: "MOC atlas", id: "msss_atlas_simp_clon", ext: "png", zoom: 6 },
};

const toX = (lon) => (lon - LON0) * KM_LON;
const toZ = (lat) => -(lat - LAT0) * KM_LAT;
const toLon = (x) => LON0 + x / KM_LON;
const toLat = (z) => LAT0 - z / KM_LAT;

function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function slopeColorRgb(t, high) {
  if (high) return [225, 91, 76];
  if (t < 0.35) return [127, 208, 195];
  if (t < 0.6) return [240, 193, 74];
  return [224, 122, 76];
}

function buildSlopeTexture(threshold) {
  const canvas = document.createElement("canvas");
  canvas.width = COLS;
  canvas.height = ROWS;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(COLS, ROWS);
  const data = img.data;
  for (let r = 0; r < ROWS; r += 1) {
    const lat = NORTH - (r / (ROWS - 1)) * (NORTH - SOUTH);
    for (let c = 0; c < COLS; c += 1) {
      const lon = WEST + (c / (COLS - 1)) * (EAST - WEST);
      const sample = slopeAspect(lon, lat);
      if (!sample || sample.slope < 6) continue;
      const t = Math.min(1, sample.slope / 28);
      const rgb = slopeColorRgb(t, sample.slope >= threshold);
      const idx = (r * COLS + c) * 4;
      data[idx] = rgb[0];
      data[idx + 1] = rgb[1];
      data[idx + 2] = rgb[2];
      data[idx + 3] = 175;
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/** Une las teselas NASA Trek / USGS OnMars que cubren la extensión 3D en un único lienzo. */
async function buildTexture({ id, ext, zoom, tileSize = 256 }) {
  const tileDeg = 180 / 2 ** zoom;
  const pxPerDeg = tileSize / tileDeg;
  const x0 = Math.floor((WEST + 180) / tileDeg);
  const x1 = Math.floor((EAST + 180) / tileDeg);
  const y0 = Math.floor((90 - NORTH) / tileDeg);
  const y1 = Math.floor((90 - SOUTH) / tileDeg);
  const rawW = (EAST - WEST) * pxPerDeg;
  const rawH = (NORTH - SOUTH) * pxPerDeg;
  const scale = Math.min(1, 2048 / Math.max(rawW, rawH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rawW * scale));
  canvas.height = Math.max(1, Math.round(rawH * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = id === "OnMars_CTX" ? "#454648" : "#6b4a36";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const drawSize = tileSize * scale;
  const jobs = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      const url = resolveNasaTileUrl(id, zoom, y, x, ext);
      jobs.push(loadImage(url).then((image) => {
        if (!image) return;
        const left = (x * tileDeg - 180 - WEST) * pxPerDeg * scale;
        const top = (NORTH - (90 - y * tileDeg)) * pxPerDeg * scale;
        ctx.drawImage(image, left, top, drawSize, drawSize);
      }));
    }
  }
  await Promise.all(jobs);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Une las teselas HiRISE (25 cm) de NASA Trek sobre la extensión del delta y aterrizaje. */
async function buildHiRiseTexture(zoom, maxAnisotropy = 8) {
  const [hWest, hSouth, hEast, hNorth] = HIRISE_EXTENT;
  const tileDeg = 180 / 2 ** zoom;
  const pxPerDeg = 256 / tileDeg;
  const x0 = Math.floor((hWest + 180) / tileDeg);
  const x1 = Math.floor((hEast + 180) / tileDeg);
  const y0 = Math.floor((90 - hNorth) / tileDeg);
  const y1 = Math.floor((90 - hSouth) / tileDeg);
  const rawW = (hEast - hWest) * pxPerDeg;
  const rawH = (hNorth - hSouth) * pxPerDeg;
  const scale = Math.min(1, 2048 / Math.max(rawW, rawH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rawW * scale));
  canvas.height = Math.max(1, Math.round(rawH * scale));
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let loaded = 0;
  const jobs = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      const url = resolveNasaTileUrl(HIRISE_ID, zoom, y, x, "png");
      jobs.push(loadImage(url).then((image) => {
        if (!image) return;
        loaded += 1;
        const left = (x * tileDeg - 180 - hWest) * pxPerDeg * scale;
        const top = (hNorth - (90 - y * tileDeg)) * pxPerDeg * scale;
        const size = 256 * scale;
        ctx.drawImage(image, left, top, size, size);
      }));
    }
  }
  await Promise.all(jobs);
  if (!loaded) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

export async function createTerrain3D(container, { pois, initialLayers, onPick, onHover, onHiriseStatus, onCameraSyncChange }) {
  await ensureCoverage([WEST - 0.05, SOUTH - 0.05, EAST + 0.05, NORTH + 0.05]);

  const isSoftwareGl = (() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  })();

  const renderer = new THREE.WebGLRenderer({ antialias: !isSoftwareGl, powerPreference: "high-performance" });
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = "terrain3d-labels";
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1a1210");
  scene.fog = new THREE.Fog("#1a1210", 120, 260);
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  pmremGenerator.dispose();

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 800);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !isSoftwareGl;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 4;
  controls.maxDistance = 180;

  scene.add(new THREE.HemisphereLight("#f3dcc8", "#3a2418", 0.95));
  const sun = new THREE.DirectionalLight("#fff1e0", 2.2);
  sun.position.set(-60, 45, -30);
  scene.add(sun);

  // Malla de relieve: alturas en km relativas a la cota media, multiplicadas por la exageración.
  const heights = new Float32Array(COLS * ROWS);
  let sum = 0;
  let known = 0;
  for (let r = 0; r < ROWS; r += 1) {
    const lat = NORTH - (r / (ROWS - 1)) * (NORTH - SOUTH);
    for (let c = 0; c < COLS; c += 1) {
      const lon = WEST + (c / (COLS - 1)) * (EAST - WEST);
      const z = elevation(lon, lat);
      heights[r * COLS + c] = z ?? NaN;
      if (z != null) { sum += z; known += 1; }
    }
  }
  const datum = known ? sum / known : 0;
  for (let i = 0; i < heights.length; i += 1) {
    heights[i] = Number.isNaN(heights[i]) ? 0 : (heights[i] - datum) / 1000;
  }

  const positions = new Float32Array(COLS * ROWS * 3);
  const uvs = new Float32Array(COLS * ROWS * 2);
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const i = r * COLS + c;
      const lon = WEST + (c / (COLS - 1)) * (EAST - WEST);
      const lat = NORTH - (r / (ROWS - 1)) * (NORTH - SOUTH);
      positions[i * 3] = toX(lon);
      positions[i * 3 + 2] = toZ(lat);
      uvs[i * 2] = c / (COLS - 1);
      uvs[i * 2 + 1] = 1 - r / (ROWS - 1);
    }
  }
  const index = [];
  for (let r = 0; r < ROWS - 1; r += 1) {
    for (let c = 0; c < COLS - 1; c += 1) {
      const a = r * COLS + c;
      const b = a + 1;
      const d = a + COLS;
      index.push(a, d, b, b, d, d + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);

  const emptyOverlay = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  emptyOverlay.needsUpdate = true;
  const [hWest, hSouth, hEast, hNorth] = HIRISE_EXTENT;
  const hiriseUniforms = {
    uHiriseMap: { value: emptyOverlay },
    uHiriseBounds: {
      value: new THREE.Vector4(
        (hWest - WEST) / (EAST - WEST),
        (hSouth - SOUTH) / (NORTH - SOUTH),
        (hEast - WEST) / (EAST - WEST),
        (hNorth - SOUTH) / (NORTH - SOUTH),
      ),
    },
    uHiriseOpacity: { value: 0 },
  };
  const slopeUniforms = {
    uSlopeMap: { value: emptyOverlay },
    uSlopeOpacity: { value: 0 },
  };

  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, metalness: 0 });
  material.customProgramCacheKey = () => "terrain-hirise-slope-v2";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHiriseMap = hiriseUniforms.uHiriseMap;
    shader.uniforms.uHiriseBounds = hiriseUniforms.uHiriseBounds;
    shader.uniforms.uHiriseOpacity = hiriseUniforms.uHiriseOpacity;
    shader.uniforms.uSlopeMap = slopeUniforms.uSlopeMap;
    shader.uniforms.uSlopeOpacity = slopeUniforms.uSlopeOpacity;
    shader.vertexShader = `varying vec2 vTerrainUv;\n${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvTerrainUv = uv;",
    );
    shader.fragmentShader = `varying vec2 vTerrainUv;\nuniform sampler2D uHiriseMap;\nuniform vec4 uHiriseBounds;\nuniform float uHiriseOpacity;\nuniform sampler2D uSlopeMap;\nuniform float uSlopeOpacity;\n${shader.fragmentShader}`.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      if (uHiriseOpacity > 0.001) {
        vec2 hUv = (vTerrainUv - uHiriseBounds.xy) / (uHiriseBounds.zw - uHiriseBounds.xy);
        if (hUv.x >= 0.0 && hUv.x <= 1.0 && hUv.y >= 0.0 && hUv.y <= 1.0) {
          vec4 hTex = texture2D(uHiriseMap, hUv);
          diffuseColor.rgb = mix(diffuseColor.rgb, hTex.rgb, hTex.a * uHiriseOpacity);
        }
      }
      if (uSlopeOpacity > 0.001) {
        vec4 sTex = texture2D(uSlopeMap, vTerrainUv);
        diffuseColor.rgb = mix(diffuseColor.rgb, sTex.rgb, sTex.a * uSlopeOpacity);
      }`,
    );
  };
  const terrain = new THREE.Mesh(geometry, material);
  scene.add(terrain);

  let exaggeration = 3;
  function heightAt(lon, lat) {
    const z = elevation(lon, lat);
    return z == null ? 0 : ((z - datum) / 1000) * exaggeration;
  }

  // Marcadores: POI, extremos A/B y ruta.
  const markers = new THREE.Group();
  scene.add(markers);
  const routeGroup = new THREE.Group();
  scene.add(routeGroup);
  const poiItems = pois.map((poi) => {
    const el = document.createElement("div");
    el.className = "terrain3d-label";
    el.textContent = poi.name;
    const label = new CSS2DObject(el);
    const pin = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 8),
      new THREE.MeshBasicMaterial({ color: "#7fd0f0" }),
    );
    const item = new THREE.Group();
    item.add(pin, label);
    label.position.set(0, 0.9, 0);
    markers.add(item);
    return { poi, item };
  });

  let routeState = { profile: null, a: null, b: null };
  let roverState = null;
  let activeVariant = "";

  // Articulated 6-wheel Rocker-Bogie Rover Rig with Perseverance & Curiosity variants.
  const roverGroup = new THREE.Group();
  roverGroup.visible = false;
  const suspensionGroup = new THREE.Group();
  roverGroup.add(suspensionGroup);

  const chassisMat = new THREE.MeshStandardMaterial({ color: "#e9edf2", roughness: 0.45, metalness: 0.35 });
  const deckMat = new THREE.MeshStandardMaterial({ color: "#d4a84f", roughness: 0.3, metalness: 0.7 });
  const rtgMat = new THREE.MeshStandardMaterial({ color: "#3b4652", roughness: 0.5, metalness: 0.65 });
  const mastMat = new THREE.MeshStandardMaterial({ color: "#f2f5f8", roughness: 0.38, metalness: 0.35 });
  const opticMat = new THREE.MeshBasicMaterial({ color: "#29c6ff" });
  const strutMat = new THREE.MeshStandardMaterial({ color: "#8c9aa8", roughness: 0.38, metalness: 0.72 });
  const tireMat = new THREE.MeshStandardMaterial({ color: "#232830", roughness: 0.82, metalness: 0.25 });
  const rimMat = new THREE.MeshStandardMaterial({ color: "#9eb2c4", roughness: 0.28, metalness: 0.85 });
  const beamMat = new THREE.MeshBasicMaterial({
    color: "#29c6ff",
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.2, 0.82), chassisMat);
  chassis.position.y = 0.25;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.045, 0.54), deckMat);
  deck.position.set(0, 0.365, 0.02);

  // Rear MMRTG + radiator fins
  const mmrtgGroup = new THREE.Group();
  mmrtgGroup.position.set(0, 0.28, 0.48);
  mmrtgGroup.rotation.x = Math.PI * 0.34;
  const mmrtgCore = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.3, 12), rtgMat);
  mmrtgGroup.add(mmrtgCore);
  for (let f = 0; f < 4; f += 1) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 0.018), rtgMat);
    fin.rotation.y = (f * Math.PI) / 4;
    mmrtgGroup.add(fin);
  }

  // High-gain parabolic dish antenna
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.03, 0.05, 16), rimMat);
  dish.position.set(-0.14, 0.44, 0.16);
  dish.rotation.x = -0.35;

  // Pan-tilt camera mast + laser scanner beam
  const mastPivot = new THREE.Group();
  mastPivot.position.set(0.06, 0.38, -0.25);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.042, 0.34, 10), mastMat);
  mast.position.y = 0.16;
  const mastHead = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.15), mastMat);
  mastHead.position.set(0, 0.34, -0.01);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.04, 12), opticMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0.34, -0.095);
  const scanCone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.35, 16, 1, true), beamMat);
  scanCone.rotation.x = -Math.PI * 0.42;
  scanCone.position.set(0, 0.16, -0.74);
  mastPivot.add(mast, mastHead, lens, scanCone);

  // Curiosity 5-DOF robotic sample arm + drill turret
  const armGroup = new THREE.Group();
  armGroup.position.set(0.16, 0.24, -0.4);
  const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.26), strutMat);
  upperArm.position.set(0.05, 0.03, -0.11);
  upperArm.rotation.y = -0.3;
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.048, 0.22), strutMat);
  forearm.position.set(0.03, -0.01, -0.28);
  forearm.rotation.y = 0.35;
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 10), deckMat);
  turret.rotation.z = Math.PI / 2;
  turret.position.set(-0.02, -0.02, -0.37);
  armGroup.add(upperArm, forearm, turret);

  // Extra design accents for Curiosity Gold (Kapton foil ribs + twin comms)
  const goldExtraGroup = new THREE.Group();
  [-0.14, 0, 0.14].forEach((gz) => {
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.03, 0.05),
      new THREE.MeshStandardMaterial({ color: "#ffd166", roughness: 0.18, metalness: 0.94 }),
    );
    rib.position.set(0, 0.39, gz);
    goldExtraGroup.add(rib);
  });
  const twinAntenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.32, 6), rimMat);
  twinAntenna.position.set(0.18, 0.52, 0.2);
  goldExtraGroup.add(twinAntenna);
  goldExtraGroup.visible = false;

  // Extra design accents for Curiosity Night (LED rails + dual floodlights + glowing wheel rings)
  const nightExtraGroup = new THREE.Group();
  const nightLedMat = new THREE.MeshBasicMaterial({ color: "#66f2ff" });
  [-0.29, 0.29].forEach((nx) => {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.76), nightLedMat);
    strip.position.set(nx, 0.24, 0);
    nightExtraGroup.add(strip);
  });
  [-0.15, 0.15].forEach((lx) => {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.045, 0.04), nightLedMat);
    lamp.position.set(lx, 0.26, -0.43);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 1.4, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: "#9ef6ff",
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    cone.rotation.x = -Math.PI * 0.46;
    cone.position.set(lx, 0.16, -1.1);
    nightExtraGroup.add(lamp, cone);
  });
  nightExtraGroup.visible = false;

  suspensionGroup.add(chassis, deck, mmrtgGroup, dish, mastPivot, armGroup, goldExtraGroup, nightExtraGroup);

  // Rocker-bogie side arms & 6 steerable/spinning wheels with visible tread ribs
  const leftRocker = new THREE.Group();
  const rightRocker = new THREE.Group();
  leftRocker.position.set(-0.29, 0.24, 0);
  rightRocker.position.set(0.29, 0.24, 0);
  suspensionGroup.add(leftRocker, rightRocker);

  const wheelGeo = new THREE.CylinderGeometry(0.105, 0.105, 0.09, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.062, 0.062, 0.096, 12);
  rimGeo.rotateZ(Math.PI / 2);
  const treadGeo = new THREE.BoxGeometry(0.098, 0.022, 0.22);

  const wheelKnuckles = [];
  const wheelSpinners = [];
  [-1, 1].forEach((side) => {
    const rocker = side < 0 ? leftRocker : rightRocker;
    const beamF = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.34), strutMat);
    beamF.position.set(side * 0.04, -0.05, -0.15);
    beamF.rotation.x = 0.28;
    const beamR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.34), strutMat);
    beamR.position.set(side * 0.04, -0.05, 0.15);
    beamR.rotation.x = -0.28;
    rocker.add(beamF, beamR);

    [-0.31, 0, 0.31].forEach((wz) => {
      const knuckle = new THREE.Group();
      knuckle.position.set(side * 0.08, -0.13, wz);
      const spinner = new THREE.Group();
      const tire = new THREE.Mesh(wheelGeo, tireMat);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      const treadA = new THREE.Mesh(treadGeo, rimMat);
      const treadB = new THREE.Mesh(treadGeo, rimMat);
      treadB.rotation.x = Math.PI / 2;
      spinner.add(tire, rim, treadA, treadB);
      knuckle.add(spinner);
      rocker.add(knuckle);
      wheelKnuckles.push({ knuckle, z: wz });
      wheelSpinners.push(spinner);
    });
  });

  const roverRingMat = new THREE.MeshBasicMaterial({ color: "#29c6ff", side: THREE.DoubleSide });
  const roverRing = new THREE.Mesh(new THREE.RingGeometry(0.68, 0.84, 28), roverRingMat);
  roverRing.rotation.x = -Math.PI / 2;
  roverRing.position.y = 0.02;
  roverGroup.add(roverRing);

  roverGroup.scale.setScalar(1.05);
  scene.add(roverGroup);

  // Martian dust wake puffs behind rover wheels when traversing slopes/curves.
  const DUST_COUNT = 18;
  const dustGeo = new THREE.DodecahedronGeometry(0.11, 0);
  const dustMat = new THREE.MeshBasicMaterial({
    color: "#cf8b5e",
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const dustMesh = new THREE.InstancedMesh(dustGeo, dustMat, DUST_COUNT);
  dustMesh.frustumCulled = false;
  dustMesh.visible = false;
  scene.add(dustMesh);
  const dustPuffs = Array.from({ length: DUST_COUNT }, (_, idx) => ({
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    age: 1 + (idx / DUST_COUNT),
    life: 0.75,
    scale: 0.5,
  }));
  let dustSpawnIdx = 0;
  let lastRoverDist = -1;

  function applyRoverVariant(variant) {
    if (activeVariant === variant) return;
    activeVariant = variant;
    const isCuriosity = variant.startsWith("curiosity");
    armGroup.visible = isCuriosity;
    goldExtraGroup.visible = variant === "curiosity-gold";
    nightExtraGroup.visible = variant === "curiosity-night";

    if (variant === "curiosity") {
      chassisMat.setValues({ color: "#e6dfd3", roughness: 0.44, metalness: 0.35 });
      deckMat.setValues({ color: "#b88a44", roughness: 0.32, metalness: 0.68 });
      mastMat.setValues({ color: "#f6f1e7", roughness: 0.36, metalness: 0.32 });
      rimMat.setValues({ color: "#d0b58a", roughness: 0.3, metalness: 0.82 });
      opticMat.color.set("#ff724c");
      beamMat.color.set("#ff724c");
    } else if (variant === "curiosity-gold") {
      chassisMat.setValues({ color: "#f4c84c", roughness: 0.2, metalness: 0.92 });
      deckMat.setValues({ color: "#c97422", roughness: 0.24, metalness: 0.88 });
      mastMat.setValues({ color: "#ffe596", roughness: 0.25, metalness: 0.82 });
      rimMat.setValues({ color: "#ffd166", roughness: 0.18, metalness: 0.94 });
      opticMat.color.set("#ff3b5c");
      beamMat.color.set("#ff3b5c");
    } else if (variant === "curiosity-night") {
      chassisMat.setValues({ color: "#1c2633", roughness: 0.58, metalness: 0.55 });
      deckMat.setValues({ color: "#12364b", roughness: 0.35, metalness: 0.75 });
      mastMat.setValues({ color: "#27384b", roughness: 0.4, metalness: 0.6 });
      rimMat.setValues({ color: "#54cfff", roughness: 0.22, metalness: 0.88 });
      opticMat.color.set("#66f2ff");
      beamMat.color.set("#66f2ff");
    } else {
      chassisMat.setValues({ color: "#e9edf2", roughness: 0.45, metalness: 0.3 });
      deckMat.setValues({ color: "#d4a84f", roughness: 0.35, metalness: 0.6 });
      mastMat.setValues({ color: "#f2f5f8", roughness: 0.4, metalness: 0.3 });
      rimMat.setValues({ color: "#9eb2c4", roughness: 0.28, metalness: 0.82 });
      opticMat.color.set("#29c6ff");
      beamMat.color.set("#29c6ff");
    }
  }

  // Reusable math objects (zero allocations in per-frame tick).
  const _targetPos = new THREE.Vector3();
  const _targetQuat = new THREE.Quaternion();
  const _basisMat = new THREE.Matrix4();
  const _pE = new THREE.Vector3();
  const _pW = new THREE.Vector3();
  const _pN = new THREE.Vector3();
  const _pS = new THREE.Vector3();
  const _vX = new THREE.Vector3();
  const _vZ = new THREE.Vector3();
  const _normal = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _back = new THREE.Vector3();
  const _dustDummy = new THREE.Object3D();
  const _rearOffset = new THREE.Vector3();
  const _camFwd = new THREE.Vector3();
  const _camUp = new THREE.Vector3();
  const _camTarget = new THREE.Vector3();
  const _camPos = new THREE.Vector3();
  const _worldUp = new THREE.Vector3(0, 1, 0);

  let cameraSyncEnabled = false;
  let cameraSyncSnap = false;

  function setCameraSync(enabled) {
    const next = Boolean(enabled);
    if (cameraSyncEnabled === next) return;
    cameraSyncEnabled = next;
    if (next) cameraSyncSnap = true;
    onCameraSyncChange?.(cameraSyncEnabled);
  }

  controls.addEventListener("start", () => {
    if (cameraSyncEnabled) setCameraSync(false);
  });

  function computeRoverPose(state, outPos, outQuat) {
    const { lon, lat, headingRad } = state;
    const dLon = 0.0009;
    const dLat = 0.0009;
    const xC = toX(lon);
    const zC = toZ(lat);
    const yC = heightAt(lon, lat);

    _pE.set(toX(lon + dLon), heightAt(lon + dLon, lat), zC);
    _pW.set(toX(lon - dLon), heightAt(lon - dLon, lat), zC);
    _pN.set(xC, heightAt(lon, lat + dLat), toZ(lat + dLat));
    _pS.set(xC, heightAt(lon, lat - dLat), toZ(lat - dLat));

    _vX.subVectors(_pE, _pW);
    _vZ.subVectors(_pS, _pN);
    _normal.crossVectors(_vZ, _vX).normalize();
    if (_normal.y < 0) _normal.negate();

    // Forward direction in XZ from azimuth (0 = North = -Z, +PI/2 = East = +X), projected onto slope plane.
    _fwd.set(Math.sin(headingRad), 0, -Math.cos(headingRad));
    _fwd.addScaledVector(_normal, -_fwd.dot(_normal));
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();

    _right.crossVectors(_fwd, _normal).normalize();
    _fwd.crossVectors(_normal, _right).normalize();
    _back.copy(_fwd).negate();

    _basisMat.makeBasis(_right, _normal, _back);
    outQuat.setFromRotationMatrix(_basisMat);
    outPos.set(xC, yC + 0.04, zC);
  }

  let hasSnappedRover = false;

  function placeRover(immediate = false) {
    if (!roverState) {
      roverGroup.visible = false;
      dustMesh.visible = false;
      hasSnappedRover = false;
      lastRoverDist = -1;
      return;
    }
    const { lon, lat, alertLevel } = roverState;
    if (lon < WEST || lon > EAST || lat < SOUTH || lat > NORTH) {
      roverGroup.visible = false;
      dustMesh.visible = false;
      return;
    }
    applyRoverVariant(roverState.rover?.variant ?? "perseverance");
    roverGroup.visible = true;
    computeRoverPose(roverState, _targetPos, _targetQuat);

    if (immediate || !hasSnappedRover) {
      roverGroup.position.copy(_targetPos);
      roverGroup.quaternion.copy(_targetQuat);
      hasSnappedRover = true;
    }

    roverRingMat.color.set(
      alertLevel === "critical" ? "#e15b4c" : alertLevel === "warn" ? "#f0c14a" : "#29c6ff",
    );
  }

  function placeMarkers() {
    poiItems.forEach(({ poi, item }) => {
      const inside = poi.lon >= WEST && poi.lon <= EAST && poi.lat >= SOUTH && poi.lat <= NORTH;
      item.visible = inside;
      item.position.set(toX(poi.lon), heightAt(poi.lon, poi.lat) + 0.35, toZ(poi.lat));
    });
  }

  function disposeGroup(group) {
    group.children.slice().forEach((child) => {
      child.traverse((node) => {
        node.geometry?.dispose();
        node.material?.dispose();
        if (node.isCSS2DObject) node.element.remove();
      });
      group.remove(child);
    });
  }

  function endpoint(kind, point, color) {
    const group = new THREE.Group();
    const pin = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.4, 16), new THREE.MeshBasicMaterial({ color }));
    pin.rotation.x = Math.PI;
    pin.position.y = 0.9;
    const el = document.createElement("div");
    el.className = `terrain3d-tag tag-${kind.toLowerCase()}`;
    el.textContent = kind;
    const label = new CSS2DObject(el);
    label.position.y = 2.1;
    group.add(pin, label);
    group.position.set(toX(point.lon), heightAt(point.lon, point.lat), toZ(point.lat));
    routeGroup.add(group);
  }

  function placeRoute() {
    disposeGroup(routeGroup);
    const { profile, a, b } = routeState;
    if (profile?.samples?.length > 1) {
      const points = profile.samples.map((s) => new THREE.Vector3(toX(s.lon), heightAt(s.lon, s.lat) + 0.18, toZ(s.lat)));
      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.min(points.length * 3, 1500), 0.14, 6, false),
        new THREE.MeshBasicMaterial({ color: "#ff8a4c" }),
      );
      routeGroup.add(tube);
    }
    if (a) endpoint("A", a, "#29c6ff");
    if (b) endpoint("B", b, "#f0c14a");
  }

  function applyExaggeration(value) {
    exaggeration = value;
    for (let i = 0; i < heights.length; i += 1) positions[i * 3 + 1] = heights[i] * exaggeration;
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    placeMarkers();
    placeRoute();
    placeRover(true);
  }

  const baseTextureCache = new Map();
  let currentBaseKey = null;
  let currentUserBaseKey = "hrsc";

  function normalizeBaseKey(key) {
    if (key === "themis") return "themis-day";
    return TEXTURES[key] ? key : "hrsc";
  }

  async function applyBaseTexture(key) {
    const targetKey = normalizeBaseKey(key);
    if (currentBaseKey === targetKey && material.map) return;
    currentBaseKey = targetKey;
    let texture = baseTextureCache.get(targetKey);
    if (!texture) {
      texture = await buildTexture(TEXTURES[targetKey]);
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      baseTextureCache.set(targetKey, texture);
    }
    if (currentBaseKey !== targetKey) return;
    material.map = texture;
    material.needsUpdate = true;
  }

  let hiriseEnabled = false;
  let hiriseOpacity = 0.9;
  let hiriseTexture = null;
  let hiriseZoom = 0;
  let hirisePromise = null;

  function setHiRiseOpacity(opacity) {
    const next = Math.max(0.1, Math.min(1, Number(opacity) || 0.9));
    hiriseOpacity = next;
    if (hiriseEnabled && hiriseTexture) {
      hiriseUniforms.uHiriseOpacity.value = hiriseOpacity;
    }
  }

  async function setHiRise(enabled, onStatus) {
    hiriseEnabled = Boolean(enabled);
    if (!hiriseEnabled) {
      hiriseUniforms.uHiriseOpacity.value = 0;
      onStatus?.("idle");
      return;
    }
    if (hiriseTexture && hiriseZoom >= 12) {
      hiriseUniforms.uHiriseMap.value = hiriseTexture;
      hiriseUniforms.uHiriseOpacity.value = hiriseOpacity;
      onStatus?.("ready");
      return;
    }
    if (hiriseTexture) {
      hiriseUniforms.uHiriseMap.value = hiriseTexture;
      hiriseUniforms.uHiriseOpacity.value = hiriseOpacity;
    }
    onStatus?.("loading");
    if (!hirisePromise) {
      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      hirisePromise = (async () => {
        if (hiriseZoom < 11) {
          const preview = await buildHiRiseTexture(11, maxAniso);
          if (preview) {
            hiriseTexture?.dispose();
            hiriseTexture = preview;
            hiriseZoom = 11;
            if (hiriseEnabled) {
              hiriseUniforms.uHiriseMap.value = preview;
              hiriseUniforms.uHiriseOpacity.value = hiriseOpacity;
            }
          }
        }
        const hi = await buildHiRiseTexture(12, maxAniso);
        if (hi) {
          hiriseTexture?.dispose();
          hiriseTexture = hi;
          hiriseZoom = 12;
          if (hiriseEnabled) {
            hiriseUniforms.uHiriseMap.value = hi;
            hiriseUniforms.uHiriseOpacity.value = hiriseOpacity;
          }
        }
      })().finally(() => {
        hirisePromise = null;
      });
    }
    await hirisePromise;
    if (!hiriseEnabled) {
      hiriseUniforms.uHiriseOpacity.value = 0;
      onStatus?.("idle");
    } else if (hiriseTexture) {
      onStatus?.("ready");
    } else {
      onStatus?.("error");
    }
  }

  let slopeTexture = null;
  let slopeThresholdCache = null;

  function setSlopeOverlay({ visible, threshold = 15, opacity = 0.72 } = {}) {
    if (!visible) {
      slopeUniforms.uSlopeOpacity.value = 0;
      return;
    }
    if (!slopeTexture || slopeThresholdCache !== threshold) {
      slopeTexture?.dispose();
      slopeTexture = buildSlopeTexture(threshold);
      slopeThresholdCache = threshold;
      slopeUniforms.uSlopeMap.value = slopeTexture;
    }
    slopeUniforms.uSlopeOpacity.value = Math.max(0.1, Math.min(1, Number(opacity) || 0.72));
  }

  function setPoisVisible(visible) {
    markers.visible = Boolean(visible);
    labels.domElement.classList.toggle("hide-pois", !markers.visible);
  }

  async function syncLayers(layers = {}, onStatus) {
    currentUserBaseKey = normalizeBaseKey(layers.base ?? currentUserBaseKey);
    const wantHirise = layers.hirise ?? hiriseEnabled;
    const opacity = layers.overlayOpacity ?? hiriseOpacity;
    const effectiveBase = wantHirise && opacity >= 0.85 ? "ctx" : currentUserBaseKey;
    setHiRiseOpacity(opacity);
    setSlopeOverlay({
      visible: Boolean(layers.slopeVisible),
      threshold: layers.slopeThreshold ?? 15,
      opacity: opacity * 0.85,
    });
    if (layers.poisVisible !== undefined) setPoisVisible(layers.poisVisible);
    await Promise.all([
      applyBaseTexture(effectiveBase),
      setHiRise(wantHirise, onStatus),
    ]);
  }

  async function setTexture(key, onStatus) {
    if (key === "hirise") {
      await Promise.all([
        applyBaseTexture(hiriseOpacity >= 0.85 ? "ctx" : currentUserBaseKey),
        setHiRise(true, onStatus),
      ]);
      return;
    }
    currentUserBaseKey = normalizeBaseKey(key);
    await setHiRise(false, onStatus);
    await applyBaseTexture(currentUserBaseKey);
  }

  function resetCamera() {
    if (cameraSyncEnabled) setCameraSync(false);
    controls.target.set(toX(77.45), 0, toZ(18.42));
    camera.position.set(toX(77.45) + 8, 38, toZ(18.42) + 52);
    controls.update();
  }

  function focus(lon, lat) {
    if (cameraSyncEnabled) return;
    if (lon < WEST || lon > EAST || lat < SOUTH || lat > NORTH) return;
    const target = new THREE.Vector3(toX(lon), heightAt(lon, lat), toZ(lat));
    const offset = camera.position.clone().sub(controls.target).setLength(18);
    controls.target.copy(target);
    camera.position.copy(target).add(offset);
    controls.update();
  }

  function getCenter() {
    return { lon: toLon(controls.target.x), lat: toLat(controls.target.z) };
  }

  // Interacción: clic sin arrastre para leer el terreno; movimiento para coordenadas.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pickAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(terrain, false)[0];
    return hit ? { lon: toLon(hit.point.x), lat: toLat(hit.point.z) } : null;
  }
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (event) => { down = [event.clientX, event.clientY]; });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
    const hit = pickAt(event);
    if (hit) onPick(hit.lon, hit.lat);
  });
  let hoverFrame = 0;
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const hit = pickAt(event);
      if (hit) onHover(hit.lon, hit.lat);
    });
  });

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);

  const clock = new THREE.Clock();
  let smoothSteer = 0;
  let smoothRoll = 0;
  let smoothWheelPhase = 0;

  function updateRoverAnimation(dt, elapsed) {
    if (!roverGroup.visible || !roverState) return;
    const dampAlpha = 1 - Math.exp(-14 * dt);
    roverGroup.position.lerp(_targetPos, dampAlpha);
    roverGroup.quaternion.slerp(_targetQuat, dampAlpha);

    const targetSteer = roverState.steerAngleRad ?? 0;
    const targetRoll = roverState.rollRad ?? 0;
    const targetWheel = roverState.wheelPhaseRad ?? 0;
    smoothSteer = THREE.MathUtils.damp(smoothSteer, targetSteer, 12, dt);
    smoothRoll = THREE.MathUtils.damp(smoothRoll, targetRoll, 10, dt);

    const moving = Boolean(roverState.isPlaying) || (lastRoverDist >= 0 && Math.abs((roverState.distance ?? 0) - lastRoverDist) > 0.05);
    if (moving) smoothWheelPhase = THREE.MathUtils.damp(smoothWheelPhase, targetWheel, 16, dt);
    else smoothWheelPhase = targetWheel;

    // Curve banking & rocker-bogie counter-articulation over uneven terrain slopes.
    const cornerLean = -smoothSteer * (moving ? 0.14 : 0.04);
    const bounce = roverState.isPlaying ? Math.sin(elapsed * 14) * 0.012 : 0;
    suspensionGroup.position.y = bounce;
    suspensionGroup.rotation.z = cornerLean;
    leftRocker.rotation.x = THREE.MathUtils.clamp(smoothRoll * 0.45 + Math.sin(elapsed * 5) * (roverState.isPlaying ? 0.04 : 0), -0.22, 0.22);
    rightRocker.rotation.x = -leftRocker.rotation.x;

    // Ackermann wheel steering on curves + continuous wheel spin.
    for (let i = 0; i < wheelKnuckles.length; i += 1) {
      const wk = wheelKnuckles[i];
      if (wk.z < -0.1) wk.knuckle.rotation.y = -smoothSteer;
      else if (wk.z > 0.1) wk.knuckle.rotation.y = smoothSteer * 0.85;
      else wk.knuckle.rotation.y = 0;
      wheelSpinners[i].rotation.x = -smoothWheelPhase;
    }

    // Subtle pan-tilt mast scan during navigation.
    mastPivot.rotation.y = Math.sin(elapsed * 1.4) * 0.18 - smoothSteer * 0.5;
    if (armGroup.visible) {
      armGroup.rotation.x = Math.sin(elapsed * 2.1) * (roverState.isPlaying ? 0.04 : 0.015);
    }

    // Spawn dust puffs behind rear wheels when moving or climbing slopes.
    if (roverState.isPlaying && (roverState.distance ?? 0) !== lastRoverDist) {
      const puff = dustPuffs[dustSpawnIdx % DUST_COUNT];
      dustSpawnIdx += 1;
      const side = (dustSpawnIdx % 2 === 0 ? 1 : -1) * 0.34;
      _rearOffset.set(side, 0.06, 0.36).applyQuaternion(roverGroup.quaternion);
      puff.pos.copy(roverGroup.position).add(_rearOffset);
      puff.vel.set((Math.random() - 0.5) * 0.12, 0.14 + Math.random() * 0.12, (Math.random() - 0.5) * 0.12);
      puff.age = 0;
      puff.life = 0.55 + Math.min(0.4, (roverState.slope ?? 0) * 0.015);
      puff.scale = 0.7 + Math.min(0.8, (roverState.slope ?? 0) * 0.03);
    }
    lastRoverDist = roverState.distance ?? 0;

    let anyDust = false;
    for (let i = 0; i < DUST_COUNT; i += 1) {
      const p = dustPuffs[i];
      p.age += dt;
      if (p.age < p.life) {
        anyDust = true;
        p.pos.addScaledVector(p.vel, dt);
        const s = p.scale * (1 - p.age / p.life);
        _dustDummy.position.copy(p.pos);
        _dustDummy.scale.setScalar(Math.max(0.01, s));
        _dustDummy.rotation.set(p.age * 2, p.age * 1.5, 0);
      } else {
        _dustDummy.scale.setScalar(0);
      }
      _dustDummy.updateMatrix();
      dustMesh.setMatrixAt(i, _dustDummy.matrix);
    }
    dustMesh.visible = anyDust;
    if (anyDust) dustMesh.instanceMatrix.needsUpdate = true;

    // Align 3D camera behind and oriented with the rover when camera sync is active.
    if (cameraSyncEnabled) {
      _camFwd.set(0, 0, -1).applyQuaternion(roverGroup.quaternion).normalize();
      _camUp.set(0, 1, 0).applyQuaternion(roverGroup.quaternion).lerp(_worldUp, 0.35).normalize();
      _camTarget.copy(roverGroup.position).addScaledVector(_camFwd, 1.5).addScaledVector(_camUp, 0.55);
      _camPos.copy(roverGroup.position).addScaledVector(_camFwd, -4.8).addScaledVector(_camUp, 2.35);
      const camTerrainY = heightAt(toLon(_camPos.x), toLat(_camPos.z));
      if (_camPos.y < camTerrainY + 0.75) _camPos.y = camTerrainY + 0.75;
      const camAlpha = cameraSyncSnap ? 1 - Math.exp(-12 * dt) : 1 - Math.exp(-6.5 * dt);
      controls.target.lerp(_camTarget, camAlpha);
      camera.position.lerp(_camPos, camAlpha);
      if (cameraSyncSnap && camera.position.distanceTo(_camPos) < 0.15) {
        cameraSyncSnap = false;
      }
    }
  }

  function frame() {
    const dt = Math.min(0.05, clock.getDelta() || 0.016);
    const elapsed = clock.getElapsedTime();
    updateRoverAnimation(dt, elapsed);
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  applyExaggeration(exaggeration);
  resetCamera();
  resize();
  await syncLayers(initialLayers ?? { base: "hrsc", hirise: false, overlayOpacity: 0.9 }, onHiriseStatus);

  return {
    start() { resize(); renderer.setAnimationLoop(frame); },
    stop() { renderer.setAnimationLoop(null); },
    setExaggeration: applyExaggeration,
    setTexture,
    setHiRise,
    setHiRiseOpacity,
    setSlopeOverlay,
    setPoisVisible,
    syncLayers,
    setRoute(profile, a, b) { routeState = { profile, a, b }; placeRoute(); },
    setRover(nextState) { roverState = nextState; placeRover(); },
    setCameraSync,
    resetCamera,
    focus,
    getCenter,
  };
}
