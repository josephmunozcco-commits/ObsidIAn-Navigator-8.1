import { jsPDF } from "jspdf";
import { dataNote } from "./dem.js";
import { NASA_DISCLAIMER } from "./sources.js";

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fmtEle(ele) {
  return ele == null || Number.isNaN(ele) ? null : ele.toFixed(1);
}

/** Genera un archivo GPX 1.1 con los puntos A/B y el trazado completo. */
export function buildGpx({ a, b, profile, mode, threshold, formatCoord }) {
  const created = new Date().toISOString();
  const modeLabel = mode === "avoid" ? "menor coste evitando pendientes" : "linea directa";
  const wpt = (name, pt) => {
    const sample = pt === a ? profile.samples[0] : profile.samples[profile.samples.length - 1];
    const ele = fmtEle(sample?.elevation);
    const eleTag = ele == null ? "" : `<ele>${ele}</ele>`;
    return `  <wpt lat="${pt.lat.toFixed(6)}" lon="${pt.lon.toFixed(6)}">${eleTag}<name>${xmlEscape(name)}</name><desc>${xmlEscape(formatCoord(pt.lon, pt.lat))}</desc></wpt>`;
  };
  const trkpts = profile.samples.map((s) => {
    const ele = fmtEle(s.elevation);
    const eleTag = ele == null ? "" : `<ele>${ele}</ele>`;
    return `      <trkpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}">${eleTag}</trkpt>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ObsidIAn Navigator" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>ObsidIAn Navigator — Ruta preliminar en Marte (Jezero)</name>
    <desc>Criterio: ${xmlEscape(modeLabel)} · Umbral: ${threshold}° · ${xmlEscape(dataNote())}</desc>
    <time>${created}</time>
  </metadata>
${wpt("Origen A", a)}
${wpt("Destino B", b)}
  <trk>
    <name>Ruta ObsidIAn Navigator (${(profile.distance / 1000).toFixed(2)} km)</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Genera un archivo KML 2.2 con marcadores A/B y la ruta coloreada por pendiente. */
export function buildKml({ a, b, profile, mode, threshold, formatCoord }) {
  const coordStr = (lon, lat, ele) => {
    const z = ele == null || Number.isNaN(ele) ? 0 : ele.toFixed(1);
    return `${lon.toFixed(6)},${lat.toFixed(6)},${z}`;
  };
  const firstEle = profile.samples[0]?.elevation;
  const lastEle = profile.samples[profile.samples.length - 1]?.elevation;
  const lineCoords = profile.samples.map((s) => coordStr(s.lon, s.lat, s.elevation)).join(" ");

  const highSegments = [];
  for (let i = 1; i < profile.samples.length; i += 1) {
    const prev = profile.samples[i - 1];
    const next = profile.samples[i];
    if (!next.high) continue;
    highSegments.push(`    <Placemark>
      <name>Tramo pendiente elevada (&gt;${threshold}°)</name>
      <styleUrl>#highSlopeStyle</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>${coordStr(prev.lon, prev.lat, prev.elevation)} ${coordStr(next.lon, next.lat, next.elevation)}</coordinates>
      </LineString>
    </Placemark>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>ObsidIAn Navigator — Ruta preliminar en Jezero</name>
    <description>Criterio: ${xmlEscape(mode === "avoid" ? "menor coste evitando pendientes" : "línea directa")} · Umbral ${threshold}° · ${xmlEscape(dataNote())}</description>
    <Style id="routeStyle">
      <LineStyle><color>ff4ac1f0</color><width>4</width></LineStyle>
    </Style>
    <Style id="highSlopeStyle">
      <LineStyle><color>ff4c5be1</color><width>5</width></LineStyle>
    </Style>
    <Style id="pointAStyle">
      <IconStyle><color>ff4ac1f0</color><scale>1.1</scale></IconStyle>
    </Style>
    <Style id="pointBStyle">
      <IconStyle><color>ffc3d07f</color><scale>1.1</scale></IconStyle>
    </Style>
    <Placemark>
      <name>Origen A</name>
      <description>${xmlEscape(formatCoord(a.lon, a.lat))}</description>
      <styleUrl>#pointAStyle</styleUrl>
      <Point><coordinates>${coordStr(a.lon, a.lat, firstEle)}</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Destino B</name>
      <description>${xmlEscape(formatCoord(b.lon, b.lat))}</description>
      <styleUrl>#pointBStyle</styleUrl>
      <Point><coordinates>${coordStr(b.lon, b.lat, lastEle)}</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Ruta preliminar (${(profile.distance / 1000).toFixed(2)} km)</name>
      <styleUrl>#routeStyle</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>${lineCoords}</coordinates>
      </LineString>
    </Placemark>
${highSegments.join("\n")}
  </Document>
</kml>
`;
}

/** Dibuja un perfil de elevación de alta resolución para PNG y PDF. */
export function renderProfilePngCanvas(profile, { a, b, threshold, formatCoord }) {
  const width = 1360;
  const height = 520;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0c1520";
  ctx.fillRect(0, 0, width, height);

  // Encabezado
  ctx.fillStyle = "#122030";
  ctx.fillRect(0, 0, width, 74);
  ctx.strokeStyle = "#2b4258";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 74);
  ctx.lineTo(width, 74);
  ctx.stroke();

  ctx.fillStyle = "#edf3fa";
  ctx.font = "600 22px Segoe UI, sans-serif";
  ctx.fillText("ObsidIAn Navigator · Perfil de elevación — Cráter Jezero", 32, 34);

  ctx.fillStyle = "#9fb4c8";
  ctx.font = "14px Segoe UI, sans-serif";
  const subtitle = `A: ${formatCoord(a.lon, a.lat)}   →   B: ${formatCoord(b.lon, b.lat)}   ·   Distancia ${(profile.distance / 1000).toFixed(2)} km   ·   Umbral ${threshold}°`;
  ctx.fillText(subtitle, 32, 58);

  const known = profile.samples.filter((s) => s.elevation != null);
  if (known.length < 2) return canvas;

  const minZ = Math.min(...known.map((s) => s.elevation)) - 30;
  const maxZ = Math.max(...known.map((s) => s.elevation)) + 30;
  const pad = { l: 86, r: 42, t: 104, b: 64 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const xOf = (d) => pad.l + (d / (profile.distance || 1)) * plotW;
  const yOf = (z) => pad.t + (1 - (z - minZ) / (maxZ - minZ || 1)) * plotH;

  // Cuadrícula de cota
  ctx.font = "13px monospace";
  for (let i = 0; i <= 5; i += 1) {
    const z = minZ + ((maxZ - minZ) * i) / 5;
    const y = yOf(z);
    ctx.strokeStyle = "rgba(180, 206, 232, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(width - pad.r, y);
    ctx.stroke();
    ctx.fillStyle = "#9fb4c8";
    ctx.textAlign = "right";
    ctx.fillText(`${z.toFixed(0)} m`, pad.l - 12, y + 4);
  }

  // Marcas de distancia
  const totalKm = profile.distance / 1000;
  for (let i = 0; i <= 5; i += 1) {
    const d = (profile.distance * i) / 5;
    const x = xOf(d);
    ctx.strokeStyle = "rgba(180, 206, 232, 0.08)";
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + plotH);
    ctx.stroke();
    ctx.fillStyle = "#9fb4c8";
    ctx.textAlign = "center";
    ctx.fillText(`${((totalKm * i) / 5).toFixed(2)} km`, x, height - 28);
  }

  // Relleno bajo la curva
  const firstKnown = known[0];
  const lastKnown = known[known.length - 1];
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
  grad.addColorStop(0, "rgba(240, 193, 74, 0.28)");
  grad.addColorStop(1, "rgba(240, 193, 74, 0.02)");
  ctx.beginPath();
  ctx.moveTo(xOf(firstKnown.distance), pad.t + plotH);
  profile.samples.forEach((s) => {
    if (s.elevation != null) ctx.lineTo(xOf(s.distance), yOf(s.elevation));
  });
  ctx.lineTo(xOf(lastKnown.distance), pad.t + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Trazado coloreado por pendiente
  ctx.lineCap = "round";
  ctx.lineWidth = 3.5;
  for (let i = 1; i < profile.samples.length; i += 1) {
    const prev = profile.samples[i - 1];
    const next = profile.samples[i];
    if (prev.elevation == null || next.elevation == null) continue;
    ctx.beginPath();
    ctx.moveTo(xOf(prev.distance), yOf(prev.elevation));
    ctx.lineTo(xOf(next.distance), yOf(next.elevation));
    ctx.strokeStyle = next.high ? "#e15b4c" : "#f0c14a";
    ctx.stroke();
  }

  // Marcadores A y B
  const drawEnd = (sample, label, color) => {
    if (!sample || sample.elevation == null) return;
    const x = xOf(sample.distance);
    const y = yOf(sample.elevation);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#08121c";
    ctx.font = "700 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x, y + 4);
  };
  drawEnd(firstKnown, "A", "#29c6ff");
  drawEnd(lastKnown, "B", "#7fd0c3");

  // Leyenda inferior
  ctx.textAlign = "left";
  ctx.font = "13px Segoe UI, sans-serif";
  ctx.fillStyle = "#f0c14a";
  ctx.fillRect(pad.l, height - 16, 16, 4);
  ctx.fillStyle = "#cfe0ef";
  ctx.fillText(`Pendiente ≤ ${threshold}°`, pad.l + 24, height - 10);

  ctx.fillStyle = "#e15b4c";
  ctx.fillRect(pad.l + 185, height - 16, 16, 4);
  ctx.fillStyle = "#cfe0ef";
  ctx.fillText(`Pendiente > ${threshold}°`, pad.l + 209, height - 10);

  return canvas;
}

/** Exporta el perfil de elevación como imagen PNG descargable. */
export function exportProfilePng(profile, context) {
  const canvas = renderProfilePngCanvas(profile, context);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "obsidian-perfil.png";
    link.click();
    URL.revokeObjectURL(link.href);
  }, "image/png");
}

/** Genera y descarga un informe PDF sencillo con métricas, sectores y gráfica del perfil. */
export function exportPdfReport(profile, context) {
  const { a, b, mode, threshold, formatCoord } = context;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;

  // Cabecera
  doc.setFillColor(16, 26, 38);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(237, 243, 250);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("ObsidIAn Navigator — Informe preliminar de ruta", margin, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(166, 183, 201);
  doc.text(`Cráter Jezero, Marte · Generado: ${new Date().toLocaleString("es")}`, margin, 21);

  // Datos generales
  let y = 37;
  doc.setTextColor(20, 32, 46);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Parámetros de la ruta", margin, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const rows = [
    ["Origen A", formatCoord(a.lon, a.lat)],
    ["Destino B", formatCoord(b.lon, b.lat)],
    ["Criterio", mode === "avoid" ? "Menor coste evitando pendientes" : "Línea directa"],
    ["Umbral de pendiente", `${threshold}°`],
  ];
  rows.forEach(([k, v]) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${k}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(v, margin + 42, y);
    y += 5.5;
  });

  // Resumen métrico
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Resumen métrico", margin, y);
  y += 5;

  const km = (m) => `${(m / 1000).toFixed(2)} km`;
  const metrics = [
    ["Distancia de la ruta", km(profile.distance)],
    ["Distancia en línea recta", km(profile.straight)],
    ["Desnivel de subida", `${profile.climb.toFixed(0)} m`],
    ["Desnivel de bajada", `${profile.drop.toFixed(0)} m`],
    ["Cota mínima / máxima", `${profile.min?.toFixed(0) ?? "—"} m / ${profile.max?.toFixed(0) ?? "—"} m`],
    ["Pendiente máxima / media", `${profile.maxSlope.toFixed(1)}° / ${profile.meanSlope.toFixed(1)}°`],
    ["Tramo sobre umbral", km(profile.highLength)],
    ["Soles ref. (150 m/sol)", `${Math.max(1, Math.round(profile.distance / 150))}`],
  ];

  const colW = (pageW - margin * 2 - 4) / 2;
  metrics.forEach(([label, value], idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = margin + col * (colW + 4);
    const boxY = y + row * 12;
    doc.setFillColor(242, 246, 250);
    doc.setDrawColor(210, 220, 230);
    doc.roundedRect(x, boxY, colW, 10, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(90, 108, 126);
    doc.text(label, x + 3, boxY + 4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(20, 32, 46);
    doc.text(value, x + 3, boxY + 8.3);
  });
  y += Math.ceil(metrics.length / 2) * 12 + 5;

  // Gráfica del perfil de elevación
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 32, 46);
  doc.text("Perfil de elevación", margin, y);
  y += 4;
  const chartCanvas = renderProfilePngCanvas(profile, context);
  const chartImg = chartCanvas.toDataURL("image/png");
  const imgW = pageW - margin * 2;
  const imgH = (chartCanvas.height / chartCanvas.width) * imgW;
  doc.addImage(chartImg, "PNG", margin, y, imgW, imgH);
  y += imgH + 8;

  // Sectores con pendiente elevada
  if (y > pageH - 38) {
    doc.addPage();
    y = 18;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 32, 46);
  doc.text(`Sectores con pendiente > ${threshold}°`, margin, y);
  y += 5.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (!profile.sectors.length) {
    doc.text("Ningún sector supera el umbral configurado.", margin, y);
    y += 6;
  } else {
    profile.sectors.forEach((sector, index) => {
      if (y > pageH - 22) {
        doc.addPage();
        y = 18;
      }
      doc.text(
        `${index + 1}. km ${(sector.from / 1000).toFixed(2)} – ${(sector.to / 1000).toFixed(2)} · máxima ${sector.max.toFixed(1)}° · media ${sector.mean.toFixed(1)}°`,
        margin,
        y,
      );
      y += 5;
    });
  }

  // Nota al pie
  if (y > pageH - 48) {
    doc.addPage();
    y = 18;
  }
  y += 4;
  doc.setFontSize(8);
  doc.setTextColor(100, 115, 130);
  const disclaimer = `${NASA_DISCLAIMER} ${dataNote()}`;
  const wrapped = doc.splitTextToSize(disclaimer, pageW - margin * 2);
  doc.text(wrapped, margin, y);

  const blob = doc.output("blob");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "obsidian-informe.pdf";
  link.click();
  URL.revokeObjectURL(link.href);
}
