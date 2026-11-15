// Registro único de procedencia de los datos de ObsidIAn Navigator.
// Pantalla, informes (TXT/PDF/GeoJSON/GPX/KML) y README leen de aquí,
// así todos dicen lo mismo sobre qué es dato NASA y qué es cálculo propio.
//
// kind: "nasa" | "third-party" | "derived" | "simulated"

export const KIND_LABEL = {
  nasa: "Datos NASA",
  "third-party": "Misión NASA · servidor de terceros",
  derived: "Derivado / aproximado",
  simulated: "Simulación",
};

export const DATA_SOURCES = [
  { id: "mola", name: "MOLA · Mars Global Surveyor", kind: "nasa", host: "trek.nasa.gov",
    use: "Elevación base y relieve sombreado (463 m en la capa visual)." },
  { id: "hrsc", name: "MOLA + HRSC", kind: "nasa", host: "trek.nasa.gov",
    use: "Relieve combinado ~200 m.",
    note: "HRSC es de ESA/DLR (Mars Express); la mezcla se distribuye en NASA Trek." },
  { id: "viking", name: "Viking MDIM 2.1", kind: "nasa", host: "trek.nasa.gov",
    use: "Mosaico de color global, 232 m." },
  { id: "moc", name: "MOC · Mars Global Surveyor", kind: "nasa", host: "trek.nasa.gov",
    use: "Mosaico de contexto." },
  { id: "themis", name: "THEMIS día/noche · Mars Odyssey", kind: "nasa", host: "trek.nasa.gov",
    use: "Infrarrojo, 100 m.",
    note: "Mosaicos producidos por ASU/USGS con datos de NASA." },
  { id: "tes", name: "TES Albedo · Mars Global Surveyor", kind: "nasa", host: "trek.nasa.gov",
    use: "Albedo global." },
  { id: "hirise", name: "HiRISE · Mars Reconnaissance Orbiter", kind: "nasa", host: "trek.nasa.gov",
    use: "Ortomosaico de 25 cm solo en la zona de Jezero.",
    note: "Cámara operada por la Univ. de Arizona. Sin conexión solo hay teselas parciales." },
  { id: "ctx", name: "CTX 5 m · Mars Reconnaissance Orbiter", kind: "third-party",
    host: "astro.arcgis.com (Esri)",
    use: "Contexto de 5 m.",
    note: "Datos de la cámara CTX de NASA, pero el mosaico es de Dickson et al. (2018) y lo sirve Esri, no NASA." },
  { id: "relief", name: "Ajuste morfológico de Jezero", kind: "derived", host: "local",
    use: "Borde, delta, Neretva y Pliva.",
    note: "Modelo geométrico propio de esta app. NO es un modelo de elevación de NASA." },
  { id: "rover", name: "Perfiles y física del rover", kind: "simulated", host: "local",
    use: "Velocidad, energía y deslizamiento.",
    note: "Simulación con parámetros estimados. No es telemetría real de NASA." },
  { id: "pois", name: "Puntos de interés", kind: "derived", host: "local",
    use: "Lugares de la misión Mars 2020.",
    note: "Coordenadas transcritas a mano, sin verificar frente a la fuente oficial." },
];

export const NASA_DISCLAIMER =
  "Imágenes y elevación base: datos de misiones de NASA (Mars Global Surveyor, Mars Odyssey, " +
  "Mars Reconnaissance Orbiter, Viking) servidos por NASA Solar System Treks. HRSC es de ESA/DLR " +
  "y la capa CTX 5 m proviene de un servidor de Esri. El relieve fino de Jezero, los perfiles de " +
  "rover y las rutas son cálculos de esta aplicación, no datos oficiales de NASA.";

/** Nota de calidad de la elevación; los números llegan desde dem.js para no duplicarlos. */
export function buildDataNote({ pixelKm, stepM, synthetic }) {
  const km = pixelKm.toFixed(1).replace(".", ",");
  const base =
    `Elevación: mosaico MOLA de 8 bits (≈${km} km por píxel, ≈${Math.round(stepM)} m por nivel de gris)`;
  const relief = synthetic
    ? " más un ajuste morfológico sintético en Jezero (borde, delta, Neretva y Pliva) que NO es un modelo de elevación de NASA."
    : ", sin ajuste local.";
  return (
    `${base}${relief} Las pendientes son orientativas y no sirven para decidir el tránsito de un vehículo real. ` +
    "Planificación preliminar, no un producto de navegación."
  );
}

export const POI_NOTE =
  "Coordenadas aproximadas, transcritas a mano y sin verificar frente a la fuente oficial de la misión.";

export const ROVER_NOTE =
  "Simulación con parámetros estimados; no es telemetría real de NASA.";

/** Pinta la lista de fuentes dentro de un contenedor (desplegable del panel de capas). */
export function renderSourcesPanel(container, dataNote) {
  if (!container) return;
  const items = DATA_SOURCES.map((s) => `
    <li class="src-${s.kind}">
      <strong>${s.name}</strong>
      <span class="src-tag">${KIND_LABEL[s.kind]}</span>
      <small>${s.host} · ${s.note ?? s.use}</small>
    </li>`).join("");
  container.innerHTML = `
    <p class="hint">${NASA_DISCLAIMER}</p>
    <p class="hint">${dataNote}</p>
    <ul class="sources-list">${items}</ul>`;
}
