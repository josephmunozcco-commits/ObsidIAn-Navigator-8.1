import { resolveNasaTileUrl } from "./nasa-source.js";
import { buildDataNote } from "./sources.js";

/** Radio medio de Marte, en metros. */
export const MARS_RADIUS = 3_396_190;

const MOLA_LAYER = "Mars_MGS_MOLA_DEM_mosaic_global_463m_8";
const MOLA_MIN = -8200;
const MOLA_MAX = 21249;
const MOLA_Z = 5;
const MOLA_FALLBACK_Z = 2;
const TILE = 256;

/** Resolución real de la base MOLA usada para la cota (nivel de zoom MOLA_Z) y paso de cuantización de 8 bits. */
export const MOLA_PIXEL_KM = ((0.703125 / 2 ** MOLA_Z) * (Math.PI / 180) * MARS_RADIUS) / 1000;
export const MOLA_STEP_M = (MOLA_MAX - MOLA_MIN) / 255;

/**
 * El ajuste morfológico de Jezero es un modelo geométrico propio (no es dato NASA).
 * Se mantiene activo por defecto; añade ?relieve=mola a la URL para usar solo MOLA.
 */
function readReliefParam() {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").get("relieve") !== "mola";
  } catch {
    return true;
  }
}
export const RELIEF = { synthetic: readReliefParam() };

export function dataNote() {
  return buildDataNote({ pixelKm: MOLA_PIXEL_KM, stepM: MOLA_STEP_M, synthetic: RELIEF.synthetic });
}

const JEZERO = { lon: 77.69, lat: 18.39, rimKm: 24.5 };

const tileCache = new Map();
const pending = new Map();

function tileIndexAt(lon, lat, z) {
  const res = 0.703125 / 2 ** z;
  const tileDeg = TILE * res;
  const maxX = 2 ** (z + 1) - 1;
  const maxY = 2 ** z - 1;
  const x = Math.max(0, Math.min(maxX, Math.floor((lon + 180) / tileDeg)));
  const y = Math.max(0, Math.min(maxY, Math.floor((90 - lat) / tileDeg)));
  return [z, x, y, res];
}

function tileKey(z, x, y) {
  return `${z}/${y}/${x}`;
}

function loadTile(z, x, y) {
  const key = tileKey(z, x, y);
  if (tileCache.has(key)) return Promise.resolve(tileCache.get(key));
  if (pending.has(key)) return pending.get(key);
  const url = resolveNasaTileUrl(MOLA_LAYER, z, y, x, "png");
  const task = new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const record = { pixels, width: canvas.width, height: canvas.height };
      tileCache.set(key, record);
      pending.delete(key);
      resolve(record);
    };
    image.onerror = () => {
      tileCache.set(key, null);
      pending.delete(key);
      resolve(null);
    };
    image.src = url;
  });
  pending.set(key, task);
  return task;
}

export function preloadJezero() {
  return ensureCoverage([76.7, 17.85, 78.7, 18.95]);
}

export async function ensureCoverage(extent) {
  const [west, south, east, north] = extent;
  const jobs = [];
  for (const z of [MOLA_Z, MOLA_FALLBACK_Z]) {
    const [, x0, y1] = tileIndexAt(west, south, z);
    const [, x1, y0] = tileIndexAt(east, north, z);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) jobs.push(loadTile(z, x, y));
    }
  }
  await Promise.all(jobs);
}

function sampleZoom(lon, lat, z) {
  const [, tx, ty, res] = tileIndexAt(lon, lat, z);
  const tile = tileCache.get(tileKey(z, tx, ty));
  if (!tile) return null;
  const fx = (lon + 180) / res - tx * TILE;
  const fy = (90 - lat) / res - ty * TILE;
  const x0 = Math.max(0, Math.min(tile.width - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(tile.height - 1, Math.floor(fy)));
  const x1 = Math.min(tile.width - 1, x0 + 1);
  const y1 = Math.min(tile.height - 1, y0 + 1);
  const dx = Math.min(1, Math.max(0, fx - x0));
  const dy = Math.min(1, Math.max(0, fy - y0));
  const sample = (x, y) => tile.pixels[(y * tile.width + x) * 4];
  const v00 = sample(x0, y0);
  const v10 = sample(x1, y0);
  const v01 = sample(x0, y1);
  const v11 = sample(x1, y1);
  return v00 * (1 - dx) * (1 - dy) + v10 * dx * (1 - dy) + v01 * (1 - dx) * dy + v11 * dx * dy;
}

function dnAt(lon, lat) {
  const hi = sampleZoom(lon, lat, MOLA_Z);
  if (hi != null) return hi;
  return sampleZoom(lon, lat, MOLA_FALLBACK_Z);
}

export function molaElevation(lon, lat) {
  const dn = dnAt(lon, lat);
  if (dn == null) return null;
  return MOLA_MIN + (dn / 255) * (MOLA_MAX - MOLA_MIN);
}

function localKm(lon, lat) {
  const latRad = (JEZERO.lat * Math.PI) / 180;
  const mLon = ((Math.PI / 180) * MARS_RADIUS * Math.cos(latRad)) / 1000;
  const mLat = ((Math.PI / 180) * MARS_RADIUS) / 1000;
  return {
    x: (lon - JEZERO.lon) * mLon,
    y: (lat - JEZERO.lat) * mLat,
  };
}

function gauss(dx, dy, sx, sy) {
  return Math.exp(-0.5 * ((dx / sx) ** 2 + (dy / sy) ** 2));
}

/**
 * Relieve de escala fina que el mosaico global de ~1,3 km/píxel suaviza:
 * cresta del borde, abanico deltaico y los valles Neretva y Pliva.
 * Se anula fuera del entorno de Jezero.
 */
export function jezeroRelief(lon, lat) {
  const { x, y } = localKm(lon, lat);
  const r = Math.hypot(x, y);
  if (r > 48) return 0;
  const fade = Math.exp(-((Math.max(0, r - 36) / 7) ** 2));
  const rim = 640 * Math.exp(-0.5 * ((r - JEZERO.rimKm) / 2.15) ** 2);
  const neretva = gauss(x + 23.2, y - 7.2, 3.4, 2.3) + 0.65 * gauss(x + 16, y - 5.6, 4.2, 2.4);
  const pliva = gauss(x - 25.2, y + 0.4, 3.3, 2.5);
  let z = rim * (1 - 0.82 * Math.min(1, neretva)) * (1 - 0.78 * Math.min(1, pliva));
  z -= 560 * Math.min(1, neretva);
  z -= 500 * Math.min(1, pliva);

  const inFan = x < -14.8 && x > -27 && y > 0.5 && y < 12;
  if (inFan) {
    const axis = 6.4 + (x + 22) * 0.08;
    const half = 2.4 + (x + 26) * 0.28;
    const ny = (y - axis) / half;
    if (Math.abs(ny) < 1) z += 95 * (1 - ny * ny) * Math.min(1, (x + 27) / 5);
  }

  z += 78 * gauss(x + 15.6, y + 2.6, 0.85, 0.7);
  z += 62 * gauss(x + 4.6, y - 6.4, 0.9, 0.75);
  z += 22 * gauss(x + 13.6, y - 2.4, 1.7, 1.5);
  return z * fade;
}

export function elevation(lon, lat) {
  const base = molaElevation(lon, lat);
  if (base == null) return null;
  return RELIEF.synthetic ? base + jezeroRelief(lon, lat) : base;
}

export function metersBetween(lon1, lat1, lon2, lat2) {
  const lat = (((lat1 + lat2) / 2) * Math.PI) / 180;
  const mLon = (Math.PI / 180) * MARS_RADIUS * Math.cos(lat);
  const mLat = (Math.PI / 180) * MARS_RADIUS;
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.hypot(dx, dy);
}

export function slopeAspect(lon, lat) {
  const step = 0.0016;
  const zc = elevation(lon, lat);
  const ze = elevation(lon + step, lat);
  const zw = elevation(lon - step, lat);
  const zn = elevation(lon, lat + step);
  const zs = elevation(lon, lat - step);
  if ([zc, ze, zw, zn, zs].some((value) => value == null)) return null;
  const dx = metersBetween(lon - step, lat, lon + step, lat);
  const dy = metersBetween(lon, lat - step, lon, lat + step);
  const dzdx = (ze - zw) / dx;
  const dzdy = (zn - zs) / dy;
  const slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  const aspectRad = Math.atan2(dzdx, dzdy);
  const names = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  const aspect = names[Math.round((((aspectRad * 180) / Math.PI + 360) % 360) / 45) % 8];
  return { elevation: zc, slope, aspect, mola: molaElevation(lon, lat), relief: RELIEF.synthetic ? jezeroRelief(lon, lat) : 0 };
}

export function terrainContext(lon, lat) {
  const { x, y } = localKm(lon, lat);
  const r = Math.hypot(x, y);
  const neretva = gauss(x + 23.2, y - 7.2, 4.2, 2.8);
  const pliva = gauss(x - 25.2, y + 0.4, 4, 3);
  if (r > 55) {
    return {
      zone: "Superficie de Marte",
      unit: "Terreno regional, solo mosaico MOLA",
      detail: false,
    };
  }
  if (neretva > 0.35) {
    return { zone: "Jezero", unit: "Neretva Vallis, valle de entrada", detail: true };
  }
  if (pliva > 0.35) {
    return { zone: "Jezero", unit: "Pliva Vallis, valle de salida", detail: true };
  }
  if (x < -14.8 && x > -27 && y > 0.5 && y < 12 && r < JEZERO.rimKm) {
    return { zone: "Jezero", unit: "Abanico deltaico occidental", detail: true };
  }
  if (Math.hypot(x + 13.6, y - 2.4) < 2.2) {
    return { zone: "Jezero", unit: "Fondo fracturado, entorno de Séítah", detail: true };
  }
  if (Math.abs(r - JEZERO.rimKm) < 3.2) {
    return { zone: "Jezero", unit: "Borde del cráter", detail: true };
  }
  if (r < JEZERO.rimKm - 3) {
    return { zone: "Jezero", unit: "Fondo del cráter", detail: true };
  }
  return { zone: "Entorno de Jezero", unit: "Meseta exterior al borde", detail: true };
}

/** Etiqueta honesta de la calidad del dato en un punto (para tarjetas y avisos). */
export function dataQuality(lon, lat) {
  const ctx = terrainContext(lon, lat);
  const modelled = ctx.detail && RELIEF.synthetic;
  const km = MOLA_PIXEL_KM.toFixed(1).replace(".", ",");
  return {
    modelled,
    label: modelled ? "Modelada (MOLA + ajuste sintético)" : "Regional (solo MOLA)",
    detail: modelled
      ? `Aquí la cota mezcla MOLA (≈${km} km/píxel, ≈${Math.round(MOLA_STEP_M)} m por nivel) con un ajuste sintético propio de la app. La pendiente es orientativa y no proviene de un modelo de elevación de NASA.`
      : `Cota de MOLA (≈${km} km/píxel, ≈${Math.round(MOLA_STEP_M)} m por nivel). La pendiente es orientativa y no resuelve rocas ni escalones menores de varios kilómetros.`,
  };
}

export function formatCoord(lon, lat) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "O";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}
