import { ol } from "./ol-local.js";
import { resolveNasaTileUrl } from "./nasa-source.js";
import { setupPWA } from "./pwa.js";
import { POIS } from "./pois.js";
import { setupPanels } from "./panels.js";
import { setupGuide } from "./guide.js";
import {
  MARS_RADIUS,
  elevation,
  ensureCoverage,
  formatCoord,
  preloadJezero,
  slopeAspect,
  terrainContext,
  dataQuality,
  dataNote,
  RELIEF,
} from "./dem.js";
import { DATA_SOURCES, NASA_DISCLAIMER, POI_NOTE, renderSourcesPanel } from "./sources.js";
import { avoidPath, buildProfile, directPath } from "./route.js";
import { buildGpx, buildKml, exportPdfReport, exportProfilePng } from "./export.js";
import { buildRoverPlan, renderRover2DCanvas, sampleRoverAt } from "./rover.js";

const RESOLUTIONS = Array.from({ length: 18 }, (_, level) => 0.703125 / 2 ** level);

const BASES = [
  ["mola", "MOLA relieve", "Color y sombreado, 463 m", "Mars_MGS_MOLA_ClrShade_merge_global_463m", "jpg", 7],
  ["hrsc", "MOLA + HRSC", "Relieve combinado, ~200 m", "Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw", "jpg", 8],
  ["viking", "Viking MDIM", "Mosaico de color global", "Mars_Viking_MDIM21_ClrMosaic_global_232m", "jpg", 7],
  ["moc", "MOC atlas", "Mosaico de contexto", "msss_atlas_simp_clon", "png", 6],
  ["themis-day", "THEMIS día", "Infrarrojo diurno", "Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12_clon0_ly", "png", 8],
  ["themis-night", "THEMIS noche", "Infrarrojo nocturno", "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018", "png", 9],
];

const state = {
  tool: "info",
  base: "hrsc",
  hirise: false,
  overlayOpacity: 0.9,
  a: null,
  b: null,
  profile: null,
  directProfile: null,
  mode: "avoid",
  threshold: 15,
  selectedPoi: null,
};

const baseLayers = new Map();
const overlay = {};

function trekSource(id, ext, maxZoom) {
  const resolutions = RESOLUTIONS.slice(0, maxZoom + 1);
  return new ol.source.XYZ({
    projection: "EPSG:4326",
    tileGrid: new ol.tilegrid.TileGrid({
      extent: [-180, -90, 180, 90],
      origin: [-180, 90],
      resolutions,
      tileSize: 256,
    }),
    attributions: "NASA Solar System Treks · SSERVI / JPL",
    wrapX: false,
    crossOrigin: "anonymous",
    tileUrlFunction: (coord) => {
      if (!coord) return undefined;
      const [z, x, y] = coord;
      if (z > maxZoom || x < 0 || y < 0) return undefined;
      return resolveNasaTileUrl(id, z, y, x, ext);
    },
  });
}

function tileLayer(id, ext, maxZoom, options = {}) {
  return new ol.layer.Tile({
    source: trekSource(id, ext, maxZoom),
    visible: options.visible ?? false,
    opacity: options.opacity ?? 1,
    extent: options.extent,
    preload: 2,
  });
}

function ctxSource(maxZoom) {
  const resolutions = RESOLUTIONS.slice(1, maxZoom + 2);
  return new ol.source.XYZ({
    projection: "EPSG:4326",
    tileGrid: new ol.tilegrid.TileGrid({
      extent: [-180, -90, 180, 90],
      origin: [-180, 90],
      resolutions,
      tileSize: 512,
    }),
    attributions: "USGS / Caltech MRO CTX 5 m · NASA Treks",
    wrapX: false,
    crossOrigin: "anonymous",
    tileUrlFunction: (coord) => {
      if (!coord) return undefined;
      const [z, x, y] = coord;
      if (z === 1 || z > maxZoom || x < 0 || y < 0) return undefined;
      return resolveNasaTileUrl("OnMars_CTX", z, y, x, "png");
    },
  });
}

const slopeCanvas = new ol.source.ImageCanvas({
  projection: "EPSG:4326",
  ratio: 1,
  canvasFunction: (extent, resolution, pixelRatio, size) => {
    const canvas = document.createElement("canvas");
    canvas.width = size[0];
    canvas.height = size[1];
    paintSlope(canvas, extent);
    return canvas;
  },
});

const map = new ol.Map({
  target: "map",
  layers: [],
  view: new ol.View({
    projection: "EPSG:4326",
    center: [77.42, 18.45],
    zoom: 10,
    resolutions: RESOLUTIONS,
    extent: [-180, -90, 180, 90],
    constrainOnlyCenter: true,
  }),
});

BASES.forEach(([key, , , id, ext, maxZoom]) => {
  const layer = tileLayer(id, ext, maxZoom, { visible: key === state.base });
  baseLayers.set(key, layer);
  map.addLayer(layer);
});

const HIRISE_EXTENT = [77.2229331, 18.3067994, 77.583964, 18.669315];
overlay.hiriseContextLow = tileLayer(
  "Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12_clon0_ly",
  "png",
  8,
  { visible: state.hirise, opacity: 1 },
);
overlay.hiriseContext = new ol.layer.Tile({
  source: ctxSource(12),
  visible: state.hirise,
  opacity: 1,
  preload: 2,
});
overlay.hiriseContext.setMinZoom(3);
overlay.hirise = tileLayer(
  "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd",
  "png",
  17,
  { visible: state.hirise, opacity: state.overlayOpacity, extent: HIRISE_EXTENT },
);
overlay.hirise.setMinZoom(6);
overlay.albedo = tileLayer("Mars_MGS_TES_Albedo_mosaic_global_7410m", "png", 1, { opacity: state.overlayOpacity * 0.7 });
overlay.slope = new ol.layer.Image({ source: slopeCanvas, visible: false, opacity: state.overlayOpacity * 0.85 });

const poiSource = new ol.source.Vector();
POIS.forEach((poi) => {
  poiSource.addFeature(new ol.Feature({
    geometry: new ol.geom.Point([poi.lon, poi.lat]),
    poi,
  }));
});
overlay.pois = new ol.layer.Vector({
  source: poiSource,
  visible: true,
  style: (feature) => poiStyle(feature.get("poi"), feature.get("poi").id === state.selectedPoi),
});

const routeSource = new ol.source.Vector();
const routeLayer = new ol.layer.Vector({ source: routeSource, style: routeStyle });
const markerSource = new ol.source.Vector();
const markerLayer = new ol.layer.Vector({ source: markerSource });
const roverSource = new ol.source.Vector();
const roverCanvases = [document.createElement("canvas"), document.createElement("canvas")];
let roverCanvasParity = 0;
const roverLayer = new ol.layer.Vector({
  source: roverSource,
  style: (feature) => {
    const curState = feature.get("roverState");
    roverCanvasParity ^= 1;
    const canvas = renderRover2DCanvas(curState, roverCanvases[roverCanvasParity], Boolean(feature.get("isPlaying")));
    return new ol.style.Style({
      image: new ol.style.Icon({
        img: canvas,
        scale: 0.52,
        rotation: feature.get("heading") ?? 0,
        rotateWithView: true,
        anchor: [0.5, 0.5],
      }),
    });
  },
});
const roverPopupOverlay = new ol.Overlay({
  element: document.getElementById("rover-popup"),
  positioning: "bottom-center",
  offset: [0, -24],
  stopEvent: true,
});

map.addLayer(overlay.albedo);
map.addLayer(overlay.hiriseContextLow);
map.addLayer(overlay.hiriseContext);
map.addLayer(overlay.hirise);
map.addLayer(overlay.slope);
map.addLayer(new ol.layer.Graticule({
  strokeStyle: new ol.style.Stroke({ color: "rgba(243,236,228,0.18)", width: 1 }),
  showLabels: true,
  lonLabelStyle: new ol.style.Text({
    font: "12px Aptos, Segoe UI, sans-serif",
    fill: new ol.style.Fill({ color: "#f0d3b0" }),
    stroke: new ol.style.Stroke({ color: "#14110e", width: 3 }),
  }),
  latLabelStyle: new ol.style.Text({
    font: "12px Aptos, Segoe UI, sans-serif",
    fill: new ol.style.Fill({ color: "#f0d3b0" }),
    stroke: new ol.style.Stroke({ color: "#14110e", width: 3 }),
  }),
  wrapX: false,
}));
map.addLayer(routeLayer);
map.addLayer(overlay.pois);
map.addLayer(markerLayer);
map.addLayer(roverLayer);
map.addOverlay(roverPopupOverlay);

map.addInteraction(new ol.interaction.Translate({
  layers: [markerLayer],
  hitTolerance: 8,
}));

function poiStyle(poi, active) {
  const zoom = map.getView().getZoom();
  return new ol.style.Style({
    image: new ol.style.Circle({
      radius: active ? 8 : 6,
      fill: new ol.style.Fill({ color: active ? "#b9eeff" : "#123a50" }),
      stroke: new ol.style.Stroke({ color: "#29c6ff", width: 2 }),
    }),
    text: zoom >= 7 ? new ol.style.Text({
      text: poi.name,
      offsetY: -14,
      font: "12px Aptos, Segoe UI, sans-serif",
      fill: new ol.style.Fill({ color: "#fff8f2" }),
      stroke: new ol.style.Stroke({ color: "#140f0c", width: 3 }),
    }) : undefined,
  });
}

function routeStyle(feature) {
  const high = feature.get("high");
  const kind = feature.get("kind");
  if (kind === "direct") {
    return new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: "rgba(243,236,228,0.45)",
        width: 2,
        lineDash: [6, 6],
      }),
    });
  }
  return [
    new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "rgba(12,10,8,0.85)", width: 7 }),
    }),
    new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: high ? "#e15b4c" : "#f0c14a",
        width: 4,
      }),
    }),
  ];
}

function paintSlope(canvas, extent) {
  const [west, south, east, north] = extent;
  const widthDeg = east - west;
  if (widthDeg > 6 || canvas.width < 2 || canvas.height < 2) return;
  const context = canvas.getContext("2d");
  const step = widthDeg > 2 ? 8 : widthDeg > 0.7 ? 5 : 3;
  const threshold = state.threshold;
  for (let y = 0; y < canvas.height; y += step) {
    const lat = north - ((y + step / 2) / canvas.height) * (north - south);
    for (let x = 0; x < canvas.width; x += step) {
      const lon = west + ((x + step / 2) / canvas.width) * (east - west);
      const sample = slopeAspect(lon, lat);
      if (!sample || sample.slope < 6) continue;
      const t = Math.min(1, sample.slope / 28);
      const color = slopeColor(t, sample.slope >= threshold);
      context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.62)`;
      context.fillRect(x, y, step, step);
    }
  }
}

function slopeColor(t, high) {
  if (high) return [225, 91, 76];
  if (t < 0.35) return [127, 208, 195];
  if (t < 0.6) return [240, 193, 74];
  return [224, 122, 76];
}

function getLayerSnapshot() {
  return {
    base: state.base,
    hirise: overlay.hirise.getVisible(),
    overlayOpacity: state.overlayOpacity,
    slopeVisible: overlay.slope.getVisible(),
    slopeThreshold: state.threshold,
    poisVisible: overlay.pois.getVisible(),
  };
}

function syncLayersUI(syncThree = true) {
  const hiriseOn = overlay.hirise.getVisible();
  state.hirise = hiriseOn;
  const contextOpacity = state.overlayOpacity >= 0.85 ? 1 : state.overlayOpacity;
  overlay.hiriseContextLow.setVisible(hiriseOn);
  overlay.hiriseContext.setVisible(hiriseOn);
  overlay.hiriseContextLow.setOpacity(contextOpacity);
  overlay.hiriseContext.setOpacity(contextOpacity);
  document.querySelectorAll("input[name=base]").forEach((input) => {
    input.checked = input.value === state.base;
  });
  document.querySelectorAll("#overlay-list input[data-layer]").forEach((input) => {
    input.checked = overlay[input.dataset.layer].getVisible();
  });
  document.getElementById("slope-legend").hidden = !overlay.slope.getVisible();
  const opacityInput = document.getElementById("overlay-opacity");
  if (opacityInput) opacityInput.value = String(state.overlayOpacity);
  overlay.hirise.setOpacity(state.overlayOpacity);
  overlay.albedo.setOpacity(state.overlayOpacity * 0.7);
  overlay.slope.setOpacity(state.overlayOpacity * 0.85);
  const texSelect = document.getElementById("terrain3d-texture");
  if (texSelect) {
    texSelect.value = state.hirise ? "hirise" : state.base;
  }
  syncLayerButtons();
  if (syncThree && view3d.terrain) {
    view3d.terrain.syncLayers(getLayerSnapshot(), updateHiriseHint);
  }
}

function setBase(key, syncThree = true) {
  state.base = key;
  baseLayers.forEach((layer, name) => layer.setVisible(name === key));
  syncLayersUI(syncThree);
}

function setTool(tool) {
  state.tool = tool;
  document.getElementById("btn-set-a").setAttribute("aria-pressed", String(tool === "A"));
  document.getElementById("btn-set-b").setAttribute("aria-pressed", String(tool === "B"));
  document.getElementById("map-note").textContent = tool === "A"
    ? "Siguiente clic: origen A."
    : tool === "B"
      ? "Siguiente clic: destino B."
      : "Clic en el mapa: información del terreno. Los marcadores se pueden arrastrar.";
}

function markerFeature(kind, coord) {
  const feature = new ol.Feature({
    geometry: new ol.geom.Point(coord),
    kind,
  });
  feature.setStyle(new ol.style.Style({
    image: new ol.style.Circle({
      radius: 11,
      fill: new ol.style.Fill({ color: kind === "A" ? "#f0c14a" : "#7fd0c3" }),
      stroke: new ol.style.Stroke({ color: "#29c6ff", width: 2 }),
    }),
    text: new ol.style.Text({
      text: kind,
      font: "700 13px Aptos, Segoe UI, sans-serif",
      fill: new ol.style.Fill({ color: "#1a120e" }),
    }),
  }));
  return feature;
}

function endpointLabel(point) {
  return point ? formatCoord(point.lon, point.lat) : "Sin definir";
}

function syncMarkers() {
  markerSource.clear();
  if (state.a) markerSource.addFeature(markerFeature("A", [state.a.lon, state.a.lat]));
  if (state.b) markerSource.addFeature(markerFeature("B", [state.b.lon, state.b.lat]));
  document.getElementById("label-a").textContent = endpointLabel(state.a);
  document.getElementById("label-b").textContent = endpointLabel(state.b);
  const shareBtn = document.getElementById("exp-share");
  if (shareBtn) shareBtn.disabled = !(state.a && state.b);
  sync3d();
}

function setEndpoint(kind, lon, lat) {
  state[kind === "A" ? "a" : "b"] = { lon, lat };
  state.profile = null;
  clearRouteDrawing();
  syncMarkers();
  showTerrain(lon, lat);
  setTool("info");
  document.getElementById("route-status").textContent = state.a && state.b
    ? "Origen y destino listos. Genera la ruta preliminar."
    : "Falta el otro extremo de la ruta.";
}

function clearRouteDrawing() {
  routeSource.clear();
  stopRoverSimulation(true);
  sync3d();
  document.getElementById("stats").hidden = true;
  document.getElementById("profile-wrap").hidden = true;
  document.getElementById("sectors").innerHTML = "";
  document.querySelectorAll("[id^='exp-']").forEach((button) => {
    button.disabled = button.id === "exp-share" ? !(state.a && state.b) : true;
  });
  const shareBox = document.getElementById("share-box");
  if (shareBox) shareBox.hidden = true;
}

function fly(center, zoom) {
  map.getView().animate({ center, zoom, duration: 700 });
  if (view3d.active) view3d.terrain?.focus(center[0], center[1]);
}

// Vista 3D opcional del terreno (Three.js + DEM MOLA de NASA). Se carga bajo demanda.
const view3d = { active: false, terrain: null, loading: null, syncCamera: false };

function sync3d() {
  view3d.terrain?.setRoute(routeSource.getFeatures().length ? state.profile : null, state.a, state.b);
}

function handleMapPick(lon, lat) {
  if (state.tool === "A" || state.tool === "B") setEndpoint(state.tool, lon, lat);
  else showTerrain(lon, lat);
}

async function setView(mode) {
  const is3d = mode === "3d";
  view3d.active = is3d;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.view === mode));
  });
  const container = document.getElementById("terrain3d");
  const status = document.getElementById("terrain3d-status");
  container.hidden = !is3d;
  document.querySelector(".map-wrap").classList.toggle("is-3d", is3d);
  if (!is3d) {
    const center3d = view3d.terrain?.getCenter?.();
    view3d.terrain?.stop();
    map.updateSize();
    if (center3d && (map.getView().getZoom() ?? 0) >= 7) {
      map.getView().setCenter([center3d.lon, center3d.lat]);
    }
    if (overlay.slope.getVisible()) slopeCanvas.changed();
    syncLayersUI(false);
    renderRoverFrame();
    return;
  }
  if (!view3d.terrain) {
    status.hidden = false;
    status.textContent = "Cargando relieve MOLA de NASA…";
    view3d.loading ??= import("./terrain3d.js").then(({ createTerrain3D }) => createTerrain3D(container, {
      pois: POIS,
      initialLayers: getLayerSnapshot(),
      onPick: handleMapPick,
      onHover: (lon, lat) => { document.getElementById("cursor-readout").textContent = formatCoord(lon, lat); },
      onHiriseStatus: updateHiriseHint,
      onCameraSyncChange: updateCameraSyncUI,
    }));
    try {
      view3d.terrain = await view3d.loading;
    } catch (error) {
      view3d.loading = null;
      status.textContent = "No se pudo iniciar la vista 3D (WebGL o conexión no disponibles).";
      console.error(error);
      return;
    }
    status.hidden = true;
    document.getElementById("terrain3d-controls").hidden = false;
    view3d.terrain.setCameraSync(view3d.syncCamera);
    sync3d();
  }
  if (view3d.active) {
    syncLayersUI(true);
    const center = map.getView().getCenter();
    if (center && Math.hypot(center[0] - 77.42, center[1] - 18.45) > 0.12) {
      view3d.terrain.focus(center[0], center[1]);
    }
    view3d.terrain.start();
    renderRoverFrame();
  }
}

function updateHiriseHint(status) {
  const hint = document.getElementById("terrain3d-hirise-hint");
  if (!hint) return;
  if (status === "loading") {
    hint.textContent = "Cargando ortomosaico HiRISE 25 cm…";
    hint.hidden = false;
  } else if (status === "error") {
    hint.textContent = "Sin conexión al mosaico HiRISE";
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
}

function showTerrain(lon, lat, extra = "") {
  const card = document.getElementById("terrain-card");
  const sample = slopeAspect(lon, lat);
  if (!sample) {
    document.getElementById("sector-elevation").textContent = "— m";
    document.getElementById("sector-slope").textContent = "—°";
    document.getElementById("sector-risk").textContent = "SIN COBERTURA MOLA";
    card.className = "terrain-card empty";
    card.textContent = "Todavía no hay cota MOLA en este punto. Espera a que cargue el mosaico o acerca la vista a una zona ya cubierta.";
    return;
  }
  document.getElementById("sector-elevation").textContent = `${Math.round(sample.elevation).toLocaleString("es")} m`;
  document.getElementById("sector-slope").textContent = `${sample.slope.toFixed(1)}°`;
  document.getElementById("sector-risk").textContent = sample.slope >= state.threshold ? `RIESGO >${state.threshold}°` : "PENDIENTE MODERADA";
  const context = terrainContext(lon, lat);
  const quality = dataQuality(lon, lat);
  const high = sample.slope >= state.threshold;
  card.className = "terrain-card";
  card.innerHTML = `
    ${extra}
    <span class="badge ${high ? "warn" : "ok"}">${high ? "Pendiente elevada" : "Pendiente moderada"}</span>
    <dl>
      <dt>Posición</dt><dd>${formatCoord(lon, lat)}</dd>
      <dt>Cota</dt><dd>${sample.elevation.toFixed(0)} m</dd>
      <dt>MOLA</dt><dd>${sample.mola.toFixed(0)} m</dd>
      <dt>Ajuste sintético</dt><dd>${sample.relief >= 0 ? "+" : ""}${sample.relief.toFixed(0)} m</dd>
      <dt>Pendiente</dt><dd>${sample.slope.toFixed(1)}°</dd>
      <dt>Orientación</dt><dd>Hacia el ${sample.aspect}</dd>
      <dt>Zona</dt><dd>${context.zone}</dd>
      <dt>Unidad</dt><dd>${context.unit}</dd>
      <dt>Calidad</dt><dd>${quality.label}</dd>
    </dl>
    <p class="hint">${quality.detail}</p>`;
}

async function generateRoute() {
  if (!state.a || !state.b) {
    document.getElementById("route-status").textContent = "Define el origen A y el destino B antes de trazar.";
    return;
  }
  const status = document.getElementById("route-status");
  status.textContent = "Calculando cobertura topográfica y la ruta…";
  const west = Math.min(state.a.lon, state.b.lon) - 0.35;
  const east = Math.max(state.a.lon, state.b.lon) + 0.35;
  const south = Math.min(state.a.lat, state.b.lat) - 0.28;
  const north = Math.max(state.a.lat, state.b.lat) + 0.28;
  await ensureCoverage([west, south, east, north]);
  if (elevation(state.a.lon, state.a.lat) == null || elevation(state.b.lon, state.b.lat) == null) {
    status.textContent = "No hay modelo de elevación en uno de los extremos. Elige puntos dentro de la cobertura MOLA.";
    return;
  }
  const spacing = 240;
  const guided = state.mode === "avoid"
    ? avoidPath(state.a, state.b, state.threshold)
    : directPath(state.a, state.b, spacing);
  const straight = directPath(state.a, state.b, spacing);
  state.profile = buildProfile(guided, state.threshold);
  state.directProfile = buildProfile(straight, state.threshold);
  drawRoute(state.profile, state.directProfile);
  sync3d();
  renderResults();
  initRoverSimulation();
  const geometry = new ol.geom.LineString(guided.map((point) => [point.lon, point.lat]));
  map.getView().fit(geometry.getExtent(), { padding: [48, 48, 48, 48], duration: 500, maxZoom: 11 });
  status.textContent = state.mode === "avoid"
    ? "Ruta de menor coste lista. En rojo, los tramos que siguen por encima del umbral."
    : "Ruta directa lista. El trazado discontinuo compara el coste de evitar pendientes.";
}

function drawRoute(profile, direct) {
  routeSource.clear();
  if (state.mode === "avoid") {
    routeSource.addFeature(new ol.Feature({
      geometry: new ol.geom.LineString(direct.samples.map((sample) => [sample.lon, sample.lat])),
      kind: "direct",
    }));
  }
  for (let i = 1; i < profile.samples.length; i += 1) {
    const prev = profile.samples[i - 1];
    const next = profile.samples[i];
    routeSource.addFeature(new ol.Feature({
      geometry: new ol.geom.LineString([[prev.lon, prev.lat], [next.lon, next.lat]]),
      high: next.high,
      kind: "route",
      index: i,
    }));
  }
  if (overlay.slope.getVisible()) slopeCanvas.changed();
}

function km(meters) {
  return `${(meters / 1000).toFixed(2)} km`;
}

function renderResults() {
  const profile = state.profile;
  const direct = state.directProfile;
  const stats = document.getElementById("stats");
  stats.hidden = false;
  const items = [
    [km(profile.distance), "Distancia de la ruta"],
    [km(profile.straight), "Distancia en línea recta"],
    [`${profile.climb.toFixed(0)} m`, "Desnivel de subida"],
    [`${profile.drop.toFixed(0)} m`, "Desnivel de bajada"],
    [profile.min == null ? "—" : `${profile.min.toFixed(0)} m`, "Cota mínima"],
    [profile.max == null ? "—" : `${profile.max.toFixed(0)} m`, "Cota máxima"],
    [`${profile.maxSlope.toFixed(1)}°`, "Pendiente máxima"],
    [km(profile.highLength), `Longitud sobre ${profile.threshold}°`],
  ];
  stats.innerHTML = items.map(([value, label]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`).join("");
  if (state.mode === "avoid") {
    stats.innerHTML += `<div class="stat"><b>${km(direct.highLength)}</b><span>Pendiente elevada en la línea directa</span></div>`;
    stats.innerHTML += `<div class="stat"><b>${Math.max(1, Math.round(profile.distance / 150))}</b><span>Soles de referencia a 150 m/sol</span></div>`;
  }
  document.getElementById("profile-wrap").hidden = false;
  drawProfile(profile);
  const sectors = document.getElementById("sectors");
  if (!profile.sectors.length) {
    sectors.innerHTML = `<p class="sector quiet">Ningún sector supera ${profile.threshold}°. La ruta preliminar evita el umbral o el terreno es suave a esta resolución.</p>`;
  } else {
    sectors.innerHTML = profile.sectors.map((sector, index) => `
      <button type="button" class="sector" data-sector="${index}">
        Sector ${index + 1}: km ${(sector.from / 1000).toFixed(2)} – ${(sector.to / 1000).toFixed(2)}
        · máxima ${sector.max.toFixed(1)}° · media ${sector.mean.toFixed(1)}°
      </button>`).join("");
  }
  document.querySelectorAll("[id^='exp-']").forEach((button) => {
    button.disabled = false;
  });
}

function drawProfile(profile, hoverIndex = -1) {
  const canvas = document.getElementById("profile");
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  const known = profile.samples.filter((sample) => sample.elevation != null);
  if (known.length < 2) return;
  const minZ = Math.min(...known.map((sample) => sample.elevation)) - 30;
  const maxZ = Math.max(...known.map((sample) => sample.elevation)) + 30;
  const pad = { l: 46, r: 12, t: 12, b: 26 };
  const xOf = (distance) => pad.l + (distance / profile.distance) * (width - pad.l - pad.r);
  const yOf = (z) => pad.t + (1 - (z - minZ) / (maxZ - minZ)) * (height - pad.t - pad.b);
  context.strokeStyle = "rgba(243,236,228,0.16)";
  context.fillStyle = "#b3a79c";
  context.font = "11px Aptos, Segoe UI, sans-serif";
  for (let i = 0; i <= 4; i += 1) {
    const z = minZ + ((maxZ - minZ) * i) / 4;
    const y = yOf(z);
    context.beginPath();
    context.moveTo(pad.l, y);
    context.lineTo(width - pad.r, y);
    context.stroke();
    context.fillText(`${z.toFixed(0)}`, 4, y + 4);
  }
  context.fillText("km", width - 28, height - 8);
  for (let i = 1; i < profile.samples.length; i += 1) {
    const prev = profile.samples[i - 1];
    const next = profile.samples[i];
    if (prev.elevation == null || next.elevation == null) continue;
    context.beginPath();
    context.moveTo(xOf(prev.distance), yOf(prev.elevation));
    context.lineTo(xOf(next.distance), yOf(next.elevation));
    context.strokeStyle = next.high ? "#e15b4c" : "#f0c14a";
    context.lineWidth = 2;
    context.stroke();
  }
  if (hoverIndex >= 0) {
    const sample = profile.samples[hoverIndex];
    if (sample?.elevation != null) {
      context.fillStyle = "#f3ece4";
      context.beginPath();
      context.arc(xOf(sample.distance), yOf(sample.elevation), 3.5, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function profileIndexAt(offsetX) {
  const canvas = document.getElementById("profile");
  const profile = state.profile;
  if (!profile) return -1;
  const padL = 46;
  const padR = 12;
  const ratio = (offsetX * (canvas.width / canvas.clientWidth) - padL) / (canvas.width - padL - padR);
  if (ratio < 0 || ratio > 1) return -1;
  const target = ratio * profile.distance;
  let best = 0;
  let bestDelta = Infinity;
  profile.samples.forEach((sample, index) => {
    const delta = Math.abs(sample.distance - target);
    if (delta < bestDelta) {
      best = index;
      bestDelta = delta;
    }
  });
  return best;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportGeoJSON() {
  const profile = state.profile;
  const features = profile.samples.slice(1).map((sample, index) => ({
    type: "Feature",
    properties: {
      segment: index + 1,
      distance_m: Number(sample.distance.toFixed(1)),
      elevation_m: sample.elevation == null ? null : Number(sample.elevation.toFixed(1)),
      slope_deg: Number(sample.slope.toFixed(2)),
      high_slope: sample.high,
    },
    geometry: {
      type: "LineString",
      coordinates: [
        [profile.samples[index].lon, profile.samples[index].lat, profile.samples[index].elevation],
        [sample.lon, sample.lat, sample.elevation],
      ],
    },
  }));
  features.push(
    pointFeature("A", state.a),
    pointFeature("B", state.b),
  );
  const collection = {
    type: "FeatureCollection",
    name: "ObsidIAn Navigator",
    properties: reportMeta(),
    features,
  };
  download("obsidian-ruta.geojson", JSON.stringify(collection, null, 2), "application/geo+json");
}

function pointFeature(role, point) {
  const sample = slopeAspect(point.lon, point.lat);
  return {
    type: "Feature",
    properties: { role, elevation_m: sample ? Number(sample.elevation.toFixed(1)) : null },
    geometry: { type: "Point", coordinates: [point.lon, point.lat] },
  };
}

function exportCsv() {
  const rows = ["distancia_m;longitud;latitud;elevacion_m;pendiente_grados;pendiente_elevada"];
  state.profile.samples.forEach((sample) => {
    rows.push([
      sample.distance.toFixed(1),
      sample.lon.toFixed(6),
      sample.lat.toFixed(6),
      sample.elevation == null ? "" : sample.elevation.toFixed(1),
      sample.slope.toFixed(2),
      sample.high ? "si" : "no",
    ].join(";"));
  });
  download("obsidian-perfil.csv", `\uFEFF${rows.join("\n")}`, "text/csv;charset=utf-8");
}

function reportMeta() {
  return {
    aplicacion: "ObsidIAn Navigator",
    generado: new Date().toISOString(),
    criterio: state.mode === "avoid" ? "menor coste evitando pendientes" : "linea directa",
    umbral_grados: state.threshold,
    radio_marte_m: MARS_RADIUS,
    elevacion: dataNote(),
    aviso_fuentes: NASA_DISCLAIMER,
    fuentes: DATA_SOURCES.map(({ name, kind, host }) => ({ name, kind, host })),
  };
}

function exportReport() {
  const profile = state.profile;
  const lines = [
    "ObsidIAn Navigator — informe de planificación preliminar",
    `Generado: ${new Date().toLocaleString("es")}`,
    "",
    `Origen A: ${formatCoord(state.a.lon, state.a.lat)}`,
    `Destino B: ${formatCoord(state.b.lon, state.b.lat)}`,
    `Criterio: ${state.mode === "avoid" ? "menor coste, penalizando la pendiente" : "línea directa"}`,
    `Umbral de pendiente elevada: ${state.threshold}°`,
    "",
    `Distancia de la ruta: ${km(profile.distance)}`,
    `Distancia en línea recta: ${km(profile.straight)}`,
    `Desnivel de subida: ${profile.climb.toFixed(0)} m`,
    `Desnivel de bajada: ${profile.drop.toFixed(0)} m`,
    `Cota mínima / máxima: ${profile.min?.toFixed(0) ?? "—"} m / ${profile.max?.toFixed(0) ?? "—"} m`,
    `Pendiente máxima: ${profile.maxSlope.toFixed(1)}°`,
    `Pendiente media: ${profile.meanSlope.toFixed(1)}°`,
    `Longitud en pendiente elevada: ${km(profile.highLength)}`,
    "",
    "Sectores con pendiente elevada:",
  ];
  if (!profile.sectors.length) lines.push("Ninguno por encima del umbral.");
  profile.sectors.forEach((sector, index) => {
    lines.push(
      `${index + 1}. km ${(sector.from / 1000).toFixed(2)} a ${(sector.to / 1000).toFixed(2)}, máxima ${sector.max.toFixed(1)}°, media ${sector.mean.toFixed(1)}°`,
    );
  });
  lines.push(
    "",
    NASA_DISCLAIMER,
    dataNote(),
    "Este informe no sustituye un modelo digital de misión ni un análisis de traficabilidad.",
  );
  download("obsidian-informe.txt", lines.join("\n"), "text/plain;charset=utf-8");
}

function exportGpx() {
  if (!state.profile) return;
  download("obsidian-ruta.gpx", buildGpx({ ...state, formatCoord }), "application/gpx+xml;charset=utf-8");
}

function exportKml() {
  if (!state.profile) return;
  download("obsidian-ruta.kml", buildKml({ ...state, formatCoord }), "application/vnd.google-earth.kml+xml;charset=utf-8");
}

function exportPng() {
  if (!state.profile) return;
  exportProfilePng(state.profile, { ...state, formatCoord });
}

function exportPdf() {
  if (!state.profile) return;
  exportPdfReport(state.profile, { ...state, formatCoord });
}

function buildShareUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (state.a) url.searchParams.set("a", `${state.a.lon.toFixed(6)},${state.a.lat.toFixed(6)}`);
  if (state.b) url.searchParams.set("b", `${state.b.lon.toFixed(6)},${state.b.lat.toFixed(6)}`);
  url.searchParams.set("mode", state.mode);
  url.searchParams.set("thr", String(state.threshold));
  if (!RELIEF.synthetic) url.searchParams.set("relieve", "mola");
  return url.toString();
}

async function shareRoute() {
  if (!state.a || !state.b) return;
  const shareUrl = buildShareUrl();
  try { window.history.replaceState(null, "", shareUrl); } catch { /* ignore history restrictions */ }

  const shareBox = document.getElementById("share-box");
  const shareInput = document.getElementById("share-url");
  const shareFeedback = document.getElementById("share-feedback");
  shareInput.value = shareUrl;
  shareBox.hidden = false;

  const summary = state.profile
    ? `Ruta en Jezero (${km(state.profile.distance)}) · A: ${formatCoord(state.a.lon, state.a.lat)} → B: ${formatCoord(state.b.lon, state.b.lat)}`
    : `Puntos A y B en Jezero · A: ${formatCoord(state.a.lon, state.a.lat)} → B: ${formatCoord(state.b.lon, state.b.lat)}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: "ObsidIAn Navigator · Ruta en Marte", text: summary, url: shareUrl });
      shareFeedback.textContent = "Enlace compartido.";
      return;
    } catch (err) {
      if (err?.name === "AbortError") {
        shareFeedback.textContent = "Enlace listo para copiar:";
        return;
      }
    }
  }

  let copied = false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(shareUrl);
      copied = true;
    } catch { /* fallback below */ }
  }
  if (!copied) {
    shareInput.select();
    shareInput.setSelectionRange(0, shareUrl.length);
    try { copied = document.execCommand("copy"); } catch { copied = false; }
  }
  shareFeedback.textContent = copied
    ? "Enlace copiado al portapapeles (incluye puntos A/B y parámetros de ruta):"
    : "Copia este enlace para compartir los puntos A/B y la ruta:";
}

function parsePointParam(raw) {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lon, lat] = parts;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return { lon, lat };
}

async function restoreSharedRoute() {
  const params = new URLSearchParams(window.location.search);
  const a = parsePointParam(params.get("a"));
  const b = parsePointParam(params.get("b"));
  const mode = params.get("mode");
  const thr = Number(params.get("thr"));

  if (mode === "avoid" || mode === "direct") {
    state.mode = mode;
    document.getElementById("route-mode").value = mode;
  }
  if ([10, 15, 20, 25].includes(thr)) {
    state.threshold = thr;
    document.getElementById("slope-threshold").value = String(thr);
    document.getElementById("toggle-slope").textContent = `△ Pendiente >${thr}°`;
  }
  if (!a && !b) return false;
  if (a) state.a = a;
  if (b) state.b = b;
  syncMarkers();
  if (a && b) {
    await generateRoute();
    showTerrain(a.lon, a.lat);
  } else {
    const pt = a ?? b;
    fly([pt.lon, pt.lat], 11);
    showTerrain(pt.lon, pt.lat);
  }
  return true;
}

function renderBaseList() {
  const host = document.getElementById("base-list");
  host.innerHTML = BASES.map(([key, title, detail]) => `
    <label class="choice">
      <input type="radio" name="base" value="${key}" ${key === state.base ? "checked" : ""} />
      <span>${title}<small>${detail}</small></span>
    </label>`).join("");
  host.addEventListener("change", (event) => {
    if (event.target.name === "base") {
      overlay.hirise.setVisible(false);
      setBase(event.target.value);
    }
  });
}

function renderOverlays() {
  const items = [
    ["hirise", "HiRISE Jezero", "25 cm en Jezero con mosaico orbital CTX 5 m en todo el mapa"],
    ["albedo", "Albedo TES", "Brillo superficial de baja resolución"],
    ["slope", "Pendiente", "Calculada del modelo de elevación"],
    ["pois", "Puntos de interés", "Lugares científicos de Jezero"],
  ];
  const host = document.getElementById("overlay-list");
  host.innerHTML = items.map(([key, title, detail]) => `
    <label class="check">
      <input type="checkbox" data-layer="${key}" ${overlay[key].getVisible() ? "checked" : ""} />
      <span>${title}<small>${detail}</small></span>
    </label>`).join("");
  host.addEventListener("change", (event) => {
    const key = event.target.dataset.layer;
    if (!key) return;
    overlay[key].setVisible(event.target.checked);
    if (key === "slope" && overlay.slope.getVisible()) slopeCanvas.changed();
    syncLayersUI();
  });
}

function renderPois() {
  const list = document.getElementById("poi-list");
  list.innerHTML = POIS.map((poi) => `
    <li><button type="button" data-poi="${poi.id}">
      <em>${poi.kind}</em>
      <strong>${poi.name}</strong>
    </button></li>`).join("");
  list.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    focusPoi(button.dataset.poi);
  });
}

function focusPoi(id) {
  const poi = POIS.find((item) => item.id === id);
  state.selectedPoi = id;
  overlay.pois.changed();
  document.querySelectorAll("#poi-list button").forEach((button) => {
    button.classList.toggle("active", button.dataset.poi === id);
  });
  fly([poi.lon, poi.lat], 11);
  showTerrain(poi.lon, poi.lat, `<p>${poi.summary}</p>
    <p class="hint">${POI_NOTE}</p>
    <div class="export-row">
      <button type="button" id="poi-as-a" class="tool">Usar como A</button>
      <button type="button" id="poi-as-b" class="tool">Usar como B</button>
    </div>`);
  if (!document.getElementById("poi-as-a")) return;
  document.getElementById("poi-as-a").onclick = () => setEndpoint("A", poi.lon, poi.lat);
  document.getElementById("poi-as-b").onclick = () => setEndpoint("B", poi.lon, poi.lat);
}

function updateScale() {
  const view = map.getView();
  const resolution = view.getResolution();
  const lat = (view.getCenter()?.[1] ?? 0) * Math.PI / 180;
  const metersPerPixel = resolution * (Math.PI / 180) * MARS_RADIUS * Math.cos(lat);
  const target = 120 * metersPerPixel;
  const pow = 10 ** Math.floor(Math.log10(target));
  const nice = [1, 2, 5, 10].map((factor) => factor * pow).find((value) => value > target * 0.6) ?? pow;
  const px = nice / metersPerPixel;
  document.getElementById("scale-bar").style.width = `${px}px`;
  document.getElementById("scale-label").textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice.toFixed(0)} m`;
}

function wire() {
  renderBaseList();
  renderOverlays();
  renderPois();
  setTool("info");
  document.getElementById("btn-mars").onclick = () => fly([0, 0], 1);
  document.getElementById("btn-jezero").onclick = () => {
    overlay.hirise.setVisible(true);
    overlay.pois.setVisible(true);
    overlay.slope.setVisible(true);
    setBase("hrsc");
    fly([77.45, 18.45], 9);
    slopeCanvas.changed();
  };
  document.getElementById("btn-set-a").onclick = () => setTool(state.tool === "A" ? "info" : "A");
  document.getElementById("btn-set-b").onclick = () => setTool(state.tool === "B" ? "info" : "B");
  document.getElementById("btn-example").onclick = async () => {
    setEndpoint("A", 77.16, 18.53);
    setEndpoint("B", 77.4508, 18.4446);
    document.getElementById("route-mode").value = "avoid";
    state.mode = "avoid";
    fly([77.35, 18.48], 9);
    await generateRoute();
  };
  document.getElementById("btn-clear").onclick = () => {
    state.a = null;
    state.b = null;
    state.profile = null;
    state.selectedPoi = null;
    syncMarkers();
    clearRouteDrawing();
    setTool("info");
    document.getElementById("route-status").textContent = "Plan limpio. Vuelve a marcar A y B.";
    overlay.pois.changed();
    try { window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`); } catch { /* ignore */ }
  };
  document.getElementById("btn-route").onclick = () => generateRoute();
  document.getElementById("route-mode").onchange = (event) => {
    state.mode = event.target.value;
  };
  document.getElementById("slope-threshold").onchange = (event) => {
    state.threshold = Number(event.target.value);
    if (overlay.slope.getVisible()) slopeCanvas.changed();
    syncLayersUI();
    if (state.profile) generateRoute();
  };
  document.getElementById("overlay-opacity").oninput = (event) => {
    state.overlayOpacity = Number(event.target.value);
    syncLayersUI();
  };
  document.getElementById("exp-geojson").onclick = exportGeoJSON;
  document.getElementById("exp-gpx").onclick = exportGpx;
  document.getElementById("exp-kml").onclick = exportKml;
  document.getElementById("exp-png").onclick = exportPng;
  document.getElementById("exp-csv").onclick = exportCsv;
  document.getElementById("exp-pdf").onclick = exportPdf;
  document.getElementById("exp-report").onclick = exportReport;
  document.getElementById("exp-share").onclick = shareRoute;
  document.getElementById("sectors").onclick = (event) => {
    const button = event.target.closest("[data-sector]");
    if (!button || !state.profile) return;
    const sector = state.profile.sectors[Number(button.dataset.sector)];
    const sample = state.profile.samples[sector.startIndex];
    fly([sample.lon, sample.lat], 12);
  };
  const canvas = document.getElementById("profile");
  canvas.onmousemove = (event) => {
    if (!state.profile) return;
    const index = profileIndexAt(event.offsetX);
    drawProfile(state.profile, index);
    const sample = state.profile.samples[index];
    document.getElementById("profile-hover").textContent = sample?.elevation == null
      ? "Sin cota en este tramo."
      : `${(sample.distance / 1000).toFixed(2)} km · ${sample.elevation.toFixed(0)} m · pendiente ${sample.slope.toFixed(1)}°`;
  };
  map.on("pointermove", (event) => {
    const [lon, lat] = event.coordinate;
    if (lon) document.getElementById("cursor-readout").textContent = formatCoord(lon, lat);
    if (!event.dragging && roverSim.plan && !view3d.active) {
      const hovering = Boolean(map.forEachFeatureAtPixel(event.pixel, (feature) => feature, {
        layerFilter: (layer) => layer === roverLayer,
        hitTolerance: 10,
      }));
      map.getTargetElement().style.cursor = hovering ? "pointer" : "";
      if (hovering !== roverSim.popupHover) {
        roverSim.popupHover = hovering;
        renderRoverFrame();
      }
    }
  });
  map.on("singleclick", (event) => {
    const roverHit = map.forEachFeatureAtPixel(event.pixel, (feature) => feature, {
      layerFilter: (layer) => layer === roverLayer,
      hitTolerance: 10,
    });
    if (roverHit) {
      roverSim.popupPinned = !roverSim.popupPinned;
      if (!roverSim.popupPinned) roverSim.popupHover = false;
      renderRoverFrame();
      return;
    }
    const hit = map.forEachFeatureAtPixel(event.pixel, (feature) => feature, {
      layerFilter: (layer) => layer === overlay.pois,
    });
    if (hit?.get("poi") && state.tool === "info") {
      focusPoi(hit.get("poi").id);
      return;
    }
    const [lon, lat] = event.coordinate;
    handleMapPick(lon, lat);
  });
  map.on("moveend", () => {
    updateScale();
    overlay.pois.changed();
    if (!overlay.slope.getVisible()) return;
    const extent = map.getView().calculateExtent(map.getSize());
    if (extent[2] - extent[0] > 6) return;
    ensureCoverage(extent).then(() => slopeCanvas.changed());
  });
  const translate = map.getInteractions().getArray().find((item) => item instanceof ol.interaction.Translate);
  translate.on("translateend", (event) => {
    const feature = event.features.item(0);
    const kind = feature?.get("kind");
    if (!kind) return;
    const [lon, lat] = feature.getGeometry().getCoordinates();
    state[kind === "A" ? "a" : "b"] = { lon, lat };
    document.getElementById(kind === "A" ? "label-a" : "label-b").textContent = endpointLabel(state[kind === "A" ? "a" : "b"]);
    clearRouteDrawing();
    showTerrain(lon, lat);
    document.getElementById("route-status").textContent = "Moviste un extremo. Genera de nuevo la ruta.";
  });
}

wire();
updateScale();
preloadJezero().then(() => {
  if (overlay.slope.getVisible()) slopeCanvas.changed();
});

// Controls shared by the compact visor and the detailed mission panels.
let activeFilter = "all";
function filterPois() {
  const query = document.getElementById("poi-search").value.trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let count = 0;
  document.querySelectorAll("#poi-list li").forEach((item, index) => {
    const poi = POIS[index];
    const text = `${poi.name} ${poi.kind} ${poi.summary}`.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    item.hidden = !(text.includes(query) && (activeFilter === "all" || activeFilter.split(",").includes(poi.kind)));
    if (!item.hidden) count++;
  });
  document.getElementById("poi-count").textContent = count ? `${count} objetivos` : "Sin resultados";
}
document.getElementById("poi-search").addEventListener("input", filterPois);
document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(item => {
    item.classList.toggle("active", item === button);
    item.setAttribute("aria-pressed", String(item === button));
  });
  filterPois();
}));
function syncLayerButtons() {
  const hiriseOn = overlay.hirise.getVisible();
  document.getElementById("toggle-hirise")?.setAttribute("aria-pressed", String(hiriseOn));
  document.getElementById("toggle-dem")?.setAttribute("aria-pressed", String(!hiriseOn && (state.base === "mola" || state.base === "hrsc")));
  document.getElementById("toggle-slope")?.setAttribute("aria-pressed", String(overlay.slope.getVisible()));
}
document.getElementById("toggle-hirise").onclick = () => {
  overlay.hirise.setVisible(!overlay.hirise.getVisible());
  syncLayersUI();
};
document.getElementById("toggle-dem").onclick = () => {
  if (overlay.hirise.getVisible()) {
    overlay.hirise.setVisible(false);
    setBase("hrsc");
    return;
  }
  setBase(state.base === "mola" || state.base === "hrsc" ? "viking" : "hrsc");
};
document.getElementById("toggle-slope").onclick = () => {
  overlay.slope.setVisible(!overlay.slope.getVisible());
  if (overlay.slope.getVisible()) slopeCanvas.changed();
  syncLayersUI();
};
document.getElementById("slope-threshold").addEventListener("change", () => {
  document.getElementById("toggle-slope").textContent = `△ Pendiente >${state.threshold}°`;
});
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
document.getElementById("terrain3d-exag").addEventListener("input", (event) => {
  const value = Number(event.target.value);
  document.getElementById("terrain3d-exag-out").textContent = `${value}×`;
  view3d.terrain?.setExaggeration(value);
});
document.getElementById("terrain3d-texture").addEventListener("change", (event) => {
  const value = event.target.value;
  if (value === "hirise") {
    overlay.hirise.setVisible(true);
    syncLayersUI();
  } else {
    overlay.hirise.setVisible(false);
    setBase(value);
  }
});
const controls3d = document.getElementById("terrain3d-controls");
const toggle3d = document.getElementById("terrain3d-toggle");
const body3d = document.getElementById("terrain3d-controls-body");
const syncCam3dBtn = document.getElementById("terrain3d-sync-camera");
function updateCameraSyncUI(active) {
  view3d.syncCamera = Boolean(active);
  if (syncCam3dBtn) {
    syncCam3dBtn.setAttribute("aria-pressed", String(view3d.syncCamera));
    syncCam3dBtn.textContent = view3d.syncCamera ? "◎ Cámara sincronizada" : "◎ Sincronizar cámara";
  }
}
syncCam3dBtn?.addEventListener("click", () => {
  const next = !view3d.syncCamera;
  updateCameraSyncUI(next);
  view3d.terrain?.setCameraSync(next);
});
toggle3d.addEventListener("click", () => {
  const collapsed = controls3d.classList.toggle("collapsed");
  body3d.hidden = collapsed;
  toggle3d.setAttribute("aria-expanded", String(!collapsed));
});
const recenter = () => { if (view3d.active) view3d.terrain?.resetCamera(); fly([77.42, 18.45], 10); document.getElementById("visor").scrollIntoView({ behavior:"smooth" }); };
document.getElementById("recenter").onclick = recenter;
document.getElementById("map-reset").onclick = recenter;
syncLayersUI(false);
// Simulación de trayecto en tiempo real del rover marciano.
const roverSim = {
  plan: null,
  distance: 0,
  playing: false,
  speed: 4,
  model: "perseverance",
  follow: false,
  popupPinned: false,
  popupHover: false,
  popupCardHover: false,
  raf: 0,
  lastTs: 0,
  feature: null,
};

function isRoverPopupVisible() {
  return roverSim.popupPinned || roverSim.popupHover || roverSim.popupCardHover;
}

function stopRoverSimulation(clearAll = false) {
  roverSim.playing = false;
  if (roverSim.raf) {
    cancelAnimationFrame(roverSim.raf);
    roverSim.raf = 0;
  }
  const playBtn = document.getElementById("rover-play");
  if (playBtn) playBtn.textContent = "▶ Simular";
  if (clearAll) {
    roverSim.plan = null;
    roverSim.distance = 0;
    roverSim.feature = null;
    roverSim.popupPinned = false;
    roverSim.popupHover = false;
    roverSim.popupCardHover = false;
    roverSource.clear();
    roverPopupOverlay.setPosition(undefined);
    document.getElementById("rover-popup").hidden = true;
    document.getElementById("rover-bar").hidden = true;
    map.getTargetElement().style.cursor = "";
    view3d.terrain?.setRover(null);
  }
}

function initRoverSimulation() {
  stopRoverSimulation(false);
  if (!state.profile) return;
  roverSim.plan = buildRoverPlan(state.profile, roverSim.model, state.threshold);
  roverSim.distance = 0;
  roverSim.popupPinned = false;
  roverSim.popupHover = false;
  roverSim.popupCardHover = false;
  if (!roverSim.plan) return;
  document.getElementById("rover-bar").hidden = false;
  document.getElementById("rover-scrub").value = "0";
  renderRoverFrame();
}

function nearestProfileIndex(distanceM) {
  if (!state.profile?.samples?.length) return -1;
  let best = 0;
  let bestDelta = Infinity;
  state.profile.samples.forEach((s, i) => {
    const d = Math.abs(s.distance - distanceM);
    if (d < bestDelta) {
      best = i;
      bestDelta = d;
    }
  });
  return best;
}

const ROVER_SLOPE_SAFETY_DEG = 20;
const ROVER_POWER_WARN_W = 132;
const ROVER_POWER_CRITICAL_W = 155;

function evaluateRoverAlert(cur) {
  const slope = cur.slope;
  const power = cur.totalPowerW;
  const warnSlope = Math.min(state.threshold, ROVER_SLOPE_SAFETY_DEG);
  const slopeCritical = slope >= ROVER_SLOPE_SAFETY_DEG;
  const powerCritical = power >= ROVER_POWER_CRITICAL_W;
  const slopeWarn = slope >= warnSlope;
  const powerWarn = power >= ROVER_POWER_WARN_W;

  if (slopeCritical || powerCritical) {
    const reasons = [];
    if (slopeCritical) reasons.push(`Pendiente ${slope.toFixed(1)}° ≥ ${ROVER_SLOPE_SAFETY_DEG}°`);
    if (powerCritical) reasons.push(`Consumo ${power.toFixed(0)} W`);
    return {
      level: "critical",
      text: `CRÍTICA: ${reasons.join(" · ")}`,
      badge: `⚠ CRÍTICA · ${slope.toFixed(1)}° · ${power.toFixed(0)} W`,
    };
  }
  if (slopeWarn || powerWarn) {
    const reasons = [];
    if (slopeWarn) reasons.push(`Pendiente ${slope.toFixed(1)}° ≥ ${warnSlope}°`);
    if (powerWarn) reasons.push(`Consumo ${power.toFixed(0)} W`);
    return {
      level: "warn",
      text: `PRECAUCIÓN: ${reasons.join(" · ")}`,
      badge: `⚠ ${slopeWarn ? `${slope.toFixed(1)}°` : `${power.toFixed(0)} W`}`,
    };
  }
  return {
    level: "ok",
    text: `Operación nominal · ${cur.regolith.label}`,
    badge: `${(cur.progress * 100).toFixed(0)}% · Nominal`,
  };
}

function renderRoverFrame() {
  if (!roverSim.plan) return;
  const cur = sampleRoverAt(roverSim.plan, roverSim.distance);
  if (!cur) return;

  const alert = evaluateRoverAlert(cur);

  if (!roverSim.feature) {
    roverSim.feature = new ol.Feature({
      geometry: new ol.geom.Point([cur.lon, cur.lat]),
      heading: cur.headingRad,
      roverState: cur,
      isPlaying: roverSim.playing,
    });
    roverSource.clear();
    roverSource.addFeature(roverSim.feature);
  } else {
    roverSim.feature.getGeometry().setCoordinates([cur.lon, cur.lat]);
    roverSim.feature.set("heading", cur.headingRad);
    roverSim.feature.set("roverState", cur);
    roverSim.feature.set("isPlaying", roverSim.playing);
  }
  roverSource.changed();

  view3d.terrain?.setRover({ ...cur, alertLevel: alert.level, isPlaying: roverSim.playing });

  if (roverSim.follow) {
    if (view3d.active) view3d.terrain?.focus(cur.lon, cur.lat);
    else map.getView().setCenter([cur.lon, cur.lat]);
  }

  const popupEl = document.getElementById("rover-popup");
  if (isRoverPopupVisible() && !view3d.active) {
    popupEl.hidden = false;
    roverPopupOverlay.setPosition([cur.lon, cur.lat]);
  } else {
    popupEl.hidden = true;
    roverPopupOverlay.setPosition(undefined);
  }

  const etaStr = cur.remainingDistance <= 1
    ? "Llegada (0 soles)"
    : cur.etaSols < 1
      ? `${cur.etaHours.toFixed(1)} h (${cur.etaSols.toFixed(2)} sol)`
      : `${cur.etaSols.toFixed(1)} soles (~${cur.etaHours.toFixed(0)} h)`;

  document.getElementById("rover-pop-name").textContent = cur.rover.short;
  document.getElementById("rover-pop-heading").textContent = `${cur.compass.cardinal} · ${String(cur.compass.deg).padStart(3, "0")}°`;
  const popAlert = document.getElementById("rover-pop-alert");
  popAlert.textContent = alert.text;
  popAlert.classList.remove("warn", "critical");
  if (alert.level !== "ok") popAlert.classList.add(alert.level);

  const climbIcon = Math.abs(cur.climbDeg ?? 0) < 1.5 ? "→" : cur.climbDeg > 0 ? "↗" : "↘";
  document.getElementById("rover-pop-speed").textContent = `${cur.speedMPerSol.toFixed(0)} m/sol (${cur.speedCmPerSec.toFixed(1)} cm/s)`;
  document.getElementById("rover-pop-power").textContent = `${cur.totalPowerW.toFixed(0)} W (Crr ${cur.regolith.crr.toFixed(2)})`;
  document.getElementById("rover-pop-energy").textContent = `${cur.cumWh.toFixed(0)} / ${cur.totalWh.toFixed(0)} Wh`;
  document.getElementById("rover-pop-eta").textContent = etaStr;
  document.getElementById("rover-pop-slope").textContent = `${climbIcon} ${cur.slope.toFixed(1)}° · ${cur.elevation == null ? "—" : `${cur.elevation.toFixed(0)} m`}`;
  document.getElementById("rover-pop-soil").textContent = cur.regolith.label;
  document.getElementById("rover-pop-progress").style.width = `${(cur.progress * 100).toFixed(1)}%`;

  document.getElementById("rover-bar-speed").textContent = `${cur.speedMPerSol.toFixed(0)} m/sol`;
  document.getElementById("rover-bar-energy").textContent = `${cur.cumWh.toFixed(0)} Wh · ${cur.totalPowerW.toFixed(0)} W`;
  document.getElementById("rover-bar-eta").textContent = `ETA ${cur.etaSols.toFixed(1)} sol`;
  const barAlert = document.getElementById("rover-bar-alert");
  barAlert.textContent = alert.badge;
  barAlert.classList.remove("warn", "critical");
  if (alert.level !== "ok") barAlert.classList.add(alert.level);

  document.getElementById("rover-scrub").value = String(Math.round(cur.progress * 1000));
  if (state.profile) drawProfile(state.profile, nearestProfileIndex(roverSim.distance));
}

function tickRover(now) {
  if (!roverSim.playing || !roverSim.plan) return;
  const dt = Math.min(0.1, (now - roverSim.lastTs) / 1000);
  roverSim.lastTs = now;
  const cur = sampleRoverAt(roverSim.plan, roverSim.distance);
  const stepMeters = (cur?.speedMPerSol ?? 150) * (dt / 2.5) * roverSim.speed;
  roverSim.distance += stepMeters;
  if (roverSim.distance >= roverSim.plan.totalDistance) {
    roverSim.distance = roverSim.plan.totalDistance;
    renderRoverFrame();
    stopRoverSimulation(false);
    return;
  }
  renderRoverFrame();
  roverSim.raf = requestAnimationFrame(tickRover);
}

function toggleRoverPlay() {
  if (!roverSim.plan) return;
  if (roverSim.playing) {
    stopRoverSimulation(false);
    return;
  }
  if (roverSim.distance >= roverSim.plan.totalDistance) {
    roverSim.distance = 0;
  }
  roverSim.playing = true;
  roverSim.lastTs = performance.now();
  document.getElementById("rover-play").textContent = "⏸ Pausar";
  roverSim.raf = requestAnimationFrame(tickRover);
}

document.getElementById("rover-play").addEventListener("click", toggleRoverPlay);
document.getElementById("rover-reset").addEventListener("click", () => {
  stopRoverSimulation(false);
  roverSim.distance = 0;
  renderRoverFrame();
});
document.getElementById("rover-model").addEventListener("change", (event) => {
  roverSim.model = event.target.value;
  if (!state.profile) return;
  const ratio = roverSim.plan?.totalDistance ? roverSim.distance / roverSim.plan.totalDistance : 0;
  roverSim.plan = buildRoverPlan(state.profile, roverSim.model, state.threshold);
  roverSim.distance = (roverSim.plan?.totalDistance ?? 0) * ratio;
  renderRoverFrame();
});
document.getElementById("rover-speed").addEventListener("change", (event) => {
  roverSim.speed = Number(event.target.value) || 4;
});
document.getElementById("rover-follow").addEventListener("click", (event) => {
  roverSim.follow = !roverSim.follow;
  event.currentTarget.setAttribute("aria-pressed", String(roverSim.follow));
  renderRoverFrame();
});
document.getElementById("rover-scrub").addEventListener("input", (event) => {
  if (!roverSim.plan) return;
  stopRoverSimulation(false);
  roverSim.distance = (Number(event.target.value) / 1000) * roverSim.plan.totalDistance;
  renderRoverFrame();
});
const roverPopupEl = document.getElementById("rover-popup");
roverPopupEl.addEventListener("mouseenter", () => {
  roverSim.popupCardHover = true;
  renderRoverFrame();
});
roverPopupEl.addEventListener("mouseleave", () => {
  roverSim.popupCardHover = false;
  renderRoverFrame();
});
document.getElementById("rover-popup-close").addEventListener("click", () => {
  roverSim.popupPinned = false;
  roverSim.popupHover = false;
  roverSim.popupCardHover = false;
  renderRoverFrame();
});

setupPanels(() => { map.updateSize(); updateScale(); });
setupGuide();
setupPWA();
renderSourcesPanel(document.getElementById("sources-body"), dataNote());
{
  const footer = document.getElementById("data-disclaimer");
  if (footer) footer.textContent = `${NASA_DISCLAIMER} ${dataNote()}`;
}
filterPois();
preloadJezero().then(async () => {
  const restored = await restoreSharedRoute();
  if (!restored) showTerrain(77.42, 18.45);
});
