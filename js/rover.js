import { slopeAspect, terrainContext } from "./dem.js";

export const MARS_GRAVITY = 3.72076; // m/s²

export const ROVER_PROFILES = {
  perseverance: {
    id: "perseverance",
    variant: "perseverance",
    name: "Perseverance (Mars 2020)",
    short: "Perseverance",
    massKg: 1025,
    nominalRateMPerSol: 200,
    driveWindowH: 4.0,
    hotelPowerW: 95,
    safeSlopeDeg: 15,
    criticalSlopeDeg: 25,
  },
  curiosity: {
    id: "curiosity",
    variant: "curiosity",
    name: "Curiosity (MSL Clásico)",
    short: "Curiosity · MSL",
    massKg: 899,
    nominalRateMPerSol: 140,
    driveWindowH: 3.5,
    hotelPowerW: 100,
    safeSlopeDeg: 15,
    criticalSlopeDeg: 22,
  },
  "curiosity-gold": {
    id: "curiosity-gold",
    variant: "curiosity-gold",
    name: "Curiosity · Oro Kapton (variante ficticia)",
    short: "Curiosity · Oro (ficticio)",
    fictional: true,
    massKg: 912,
    nominalRateMPerSol: 148,
    driveWindowH: 3.6,
    hotelPowerW: 96,
    safeSlopeDeg: 16,
    criticalSlopeDeg: 23,
  },
  "curiosity-night": {
    id: "curiosity-night",
    variant: "curiosity-night",
    name: "Curiosity · Nocturno LED (variante ficticia)",
    short: "Curiosity · Nocturno (ficticio)",
    fictional: true,
    massKg: 906,
    nominalRateMPerSol: 144,
    driveWindowH: 3.8,
    hotelPowerW: 104,
    safeSlopeDeg: 16,
    criticalSlopeDeg: 23,
  },
};

export function regolithAt(lon, lat) {
  const ctx = terrainContext(lon, lat);
  const unit = ctx.unit || "";
  if (unit.includes("Séítah")) {
    return { label: "Dunas / regolito arenoso", crr: 0.22, slipBase: 0.16 };
  }
  if (unit.includes("Borde")) {
    return { label: "Talud rocoso suelto", crr: 0.24, slipBase: 0.18 };
  }
  if (unit.includes("valle")) {
    return { label: "Aluvión suelto de valle", crr: 0.20, slipBase: 0.14 };
  }
  if (unit.includes("deltaico")) {
    return { label: "Sedimento deltaico compacto", crr: 0.16, slipBase: 0.09 };
  }
  if (unit.includes("Fondo")) {
    return { label: "Lecho basáltico y polvo", crr: 0.14, slipBase: 0.07 };
  }
  return { label: "Regolito mixto marciano", crr: 0.17, slipBase: 0.11 };
}

export function headingBetween(lon1, lat1, lon2, lat2) {
  const latRad = (((lat1 + lat2) / 2) * Math.PI) / 180;
  const dx = (lon2 - lon1) * Math.cos(latRad);
  const dy = lat2 - lat1;
  if (Math.hypot(dx, dy) < 1e-10) return 0;
  return Math.atan2(dx, dy);
}

export function wrapAngle(rad) {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

export function compassLabel(headingRad) {
  const deg = (((headingRad * 180) / Math.PI) % 360 + 360) % 360;
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  return {
    deg: Math.round(deg),
    cardinal: dirs[Math.round(deg / 22.5) % 16],
  };
}

const ASPECT_AZIMUTH_RAD = {
  N: 0,
  NE: Math.PI / 4,
  E: Math.PI / 2,
  SE: (3 * Math.PI) / 4,
  S: Math.PI,
  SO: -(3 * Math.PI) / 4,
  O: -Math.PI / 2,
  NO: -Math.PI / 4,
};

function segmentPhysics(rover, slopeDeg, sinClimb, regolith, userThreshold) {
  const grade = Math.max(0, slopeDeg);
  const slip = Math.min(0.68, regolith.slipBase + 0.013 * grade + (sinClimb > 0 ? 0.12 * sinClimb : 0));
  const slopePenalty = Math.max(
    0.22,
    1 - grade / 38 - (sinClimb > 0 ? 0.34 * sinClimb : -0.07 * Math.abs(sinClimb)),
  );
  const speedMPerSol = Math.max(
    22,
    Math.min(rover.nominalRateMPerSol * 1.12, rover.nominalRateMPerSol * slopePenalty * (1 - slip)),
  );
  const speedMs = speedMPerSol / (rover.driveWindowH * 3600);

  const cosTheta = Math.cos((Math.min(grade, 45) * Math.PI) / 180);
  const resistFactor = Math.max(0.04, regolith.crr * cosTheta + sinClimb);
  const tractiveForceN = rover.massKg * MARS_GRAVITY * resistFactor;
  const drivetrainEff = 0.62;
  const drivePowerW = Math.max(18, (tractiveForceN * speedMs) / drivetrainEff);
  const totalPowerW = rover.hotelPowerW + drivePowerW;
  const whPerMeter = totalPowerW / (Math.max(speedMs, 0.001) * 3600);

  const warnLimit = Math.min(userThreshold, rover.safeSlopeDeg);
  let alertLevel = "ok";
  let alertText = `Operación nominal · ${regolith.label}`;
  if (grade >= rover.criticalSlopeDeg) {
    alertLevel = "critical";
    alertText = `ALERTA CRÍTICA: Pendiente ${grade.toFixed(1)}° supera límite (${rover.criticalSlopeDeg}°)`;
  } else if (grade >= warnLimit) {
    alertLevel = "warn";
    alertText = `PRECAUCIÓN: Pendiente ${grade.toFixed(1)}° excede umbral (${warnLimit}°)`;
  }

  return {
    speedMPerSol,
    speedMs,
    slipPct: slip * 100,
    drivePowerW,
    totalPowerW,
    whPerMeter,
    alertLevel,
    alertText,
  };
}

/** Precalcula la física acumulada, inclinación en pendientes y curvatura de giro en la ruta. */
export function buildRoverPlan(profile, roverId = "perseverance", userThreshold = 15) {
  const rover = ROVER_PROFILES[roverId] ?? ROVER_PROFILES.perseverance;
  const samples = profile?.samples ?? [];
  if (samples.length < 2) return null;

  const nodes = [];
  let cumSols = 0;
  let cumWh = 0;
  let alertCount = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const cur = samples[i];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    const prev = samples[Math.max(0, i - 1)];
    const refA = i < samples.length - 1 ? cur : prev;
    const refB = i < samples.length - 1 ? next : cur;

    const ds = Math.max(0, cur.step ?? 0);
    const dz = i > 0 && prev.elevation != null && cur.elevation != null
      ? cur.elevation - prev.elevation
      : 0;
    const sinClimb = ds > 0 ? dz / Math.hypot(ds, dz) : 0;
    const headingRad = headingBetween(refA.lon, refA.lat, refB.lon, refB.lat);

    // Pitch signed along path + lateral cross-slope roll from DEM aspect.
    const routePitchRad = ds > 0
      ? Math.atan2(dz, ds)
      : i < samples.length - 1 && cur.elevation != null && next.elevation != null
        ? Math.atan2(next.elevation - cur.elevation, Math.max(1, next.step ?? 1))
        : 0;
    const clampedPitchRad = Math.max(-0.62, Math.min(0.62, routePitchRad));

    const sa = slopeAspect(cur.lon, cur.lat);
    let rollRad = 0;
    if (sa && sa.slope > 0.2) {
      const upslopeAz = ASPECT_AZIMUTH_RAD[sa.aspect] ?? 0;
      const slopeRad = (Math.min(35, sa.slope) * Math.PI) / 180;
      rollRad = Math.sin(upslopeAz - headingRad) * slopeRad;
    }

    const regolith = regolithAt(cur.lon, cur.lat);
    const phys = segmentPhysics(rover, cur.slope ?? 0, sinClimb, regolith, userThreshold);

    if (i > 0) {
      cumSols += ds / phys.speedMPerSol;
      cumWh += ds * phys.whPerMeter;
    }
    if (phys.alertLevel !== "ok") alertCount += 1;

    nodes.push({
      lon: cur.lon,
      lat: cur.lat,
      distance: cur.distance,
      elevation: cur.elevation,
      slope: cur.slope ?? 0,
      headingRad,
      pitchRad: clampedPitchRad,
      rollRad,
      steerAngleRad: 0,
      regolith,
      ...phys,
      cumSols,
      cumWh,
    });
  }

  // Smooth steering angles from curve change across neighboring segments.
  for (let i = 0; i < nodes.length; i += 1) {
    const prevNode = nodes[Math.max(0, i - 1)];
    const nextNode = nodes[Math.min(nodes.length - 1, i + 1)];
    const spanDist = Math.max(8, nextNode.distance - prevNode.distance);
    const dHeading = wrapAngle(nextNode.headingRad - prevNode.headingRad);
    const rawSteer = (dHeading / spanDist) * 42;
    nodes[i].steerAngleRad = Math.max(-0.5, Math.min(0.5, rawSteer));
  }

  // Two-pass box smooth on pitch, roll, and steer so transitions feel fluid.
  for (let pass = 0; pass < 2; pass += 1) {
    const pitches = nodes.map((n) => n.pitchRad);
    const rolls = nodes.map((n) => n.rollRad);
    const steers = nodes.map((n) => n.steerAngleRad);
    for (let i = 0; i < nodes.length; i += 1) {
      const i0 = Math.max(0, i - 1);
      const i2 = Math.min(nodes.length - 1, i + 1);
      nodes[i].pitchRad = (pitches[i0] + pitches[i] * 2 + pitches[i2]) / 4;
      nodes[i].rollRad = (rolls[i0] + rolls[i] * 2 + rolls[i2]) / 4;
      nodes[i].steerAngleRad = (steers[i0] + steers[i] * 2 + steers[i2]) / 4;
    }
  }

  return {
    rover,
    userThreshold,
    totalDistance: profile.distance,
    totalSols: cumSols,
    totalWh: cumWh,
    alertCount,
    nodes,
  };
}

function sampleRawAt(nodes, totalDistance, distanceM) {
  const clamped = Math.max(0, Math.min(totalDistance, distanceM));
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid].distance <= clamped) lo = mid;
    else hi = mid;
  }
  const a = nodes[lo];
  const b = nodes[Math.min(nodes.length - 1, lo + 1)];
  const span = Math.max(1e-6, b.distance - a.distance);
  const t = lo === nodes.length - 1 ? 0 : Math.max(0, Math.min(1, (clamped - a.distance) / span));
  return { a, b, t, clamped };
}

/** Evalúa el estado interpolado del rover (con suavizado en curvas y pendientes) a una distancia (m). */
export function sampleRoverAt(plan, distanceM) {
  if (!plan?.nodes?.length) return null;
  const nodes = plan.nodes;
  const { a, b, t, clamped } = sampleRawAt(nodes, plan.totalDistance, distanceM);

  const lerp = (v1, v2) => v1 + (v2 - v1) * t;
  const lon = lerp(a.lon, b.lon);
  const lat = lerp(a.lat, b.lat);
  const elevation = a.elevation != null && b.elevation != null
    ? lerp(a.elevation, b.elevation)
    : (a.elevation ?? b.elevation);
  const slope = lerp(a.slope, b.slope);
  const speedMPerSol = lerp(a.speedMPerSol, b.speedMPerSol);
  const speedMs = lerp(a.speedMs, b.speedMs);
  const totalPowerW = lerp(a.totalPowerW, b.totalPowerW);
  const cumSols = lerp(a.cumSols, b.cumSols);
  const cumWh = lerp(a.cumWh, b.cumWh);
  const remainingDistance = Math.max(0, plan.totalDistance - clamped);
  const etaSols = Math.max(0, plan.totalSols - cumSols);
  const etaHours = etaSols * plan.rover.driveWindowH;
  const active = t < 0.5 ? a : b;

  // Look-ahead heading across curves so the rover glides smoothly around bends.
  const lookHalf = Math.min(30, Math.max(6, plan.totalDistance * 0.02));
  const back = sampleRawAt(nodes, plan.totalDistance, clamped - lookHalf);
  const ahead = sampleRawAt(nodes, plan.totalDistance, clamped + lookHalf);
  const backLon = back.a.lon + (back.b.lon - back.a.lon) * back.t;
  const backLat = back.a.lat + (back.b.lat - back.a.lat) * back.t;
  const aheadLon = ahead.a.lon + (ahead.b.lon - ahead.a.lon) * ahead.t;
  const aheadLat = ahead.a.lat + (ahead.b.lat - ahead.a.lat) * ahead.t;

  const rawHeading = b.distance > a.distance ? headingBetween(a.lon, a.lat, b.lon, b.lat) : a.headingRad;
  const curveHeading = Math.hypot(aheadLon - backLon, aheadLat - backLat) > 1e-8
    ? headingBetween(backLon, backLat, aheadLon, aheadLat)
    : rawHeading;
  const headingRad = lerpAngle(rawHeading, curveHeading, 0.72);

  // Instantaneous steering angle from tangent change over look-ahead window.
  const midBackHeading = back.a.headingRad;
  const midAheadHeading = ahead.b.headingRad;
  const localCurveDelta = wrapAngle(midAheadHeading - midBackHeading);
  const steerFromCurve = Math.max(-0.5, Math.min(0.5, (localCurveDelta / Math.max(8, lookHalf * 2)) * 46));
  const steerAngleRad = lerp(lerp(a.steerAngleRad, b.steerAngleRad, t), steerFromCurve, 0.6);

  const pitchRad = lerp(a.pitchRad, b.pitchRad, t);
  const rollRad = lerp(a.rollRad, b.rollRad, t);
  const climbDeg = (pitchRad * 180) / Math.PI;
  const wheelPhaseRad = clamped / 0.26;

  return {
    rover: plan.rover,
    lon,
    lat,
    distance: clamped,
    progress: plan.totalDistance > 0 ? clamped / plan.totalDistance : 1,
    remainingDistance,
    elevation,
    slope,
    pitchRad,
    rollRad,
    climbDeg,
    steerAngleRad,
    wheelPhaseRad,
    headingRad,
    compass: compassLabel(headingRad),
    regolith: active.regolith,
    slipPct: lerp(a.slipPct, b.slipPct),
    speedMPerSol,
    speedCmPerSec: speedMs * 100,
    totalPowerW,
    cumWh,
    totalWh: plan.totalWh,
    etaSols,
    etaHours,
    alertLevel: active.alertLevel,
    alertText: active.alertText,
  };
}

const DESIGN_PALETTES = {
  perseverance: {
    aura: "#29c6ff",
    hull: "#edf2f7",
    hullStroke: "#263c50",
    deck: "#d4a44a",
    rtg: "#465564",
    mast: "#ffffff",
    optic: "#29c6ff",
    wheel: "#1e2730",
    wheelRim: "#7fd0f0",
    arm: null,
    beam: "rgba(41, 198, 255, 0.42)",
    isCuriosity: false,
  },
  curiosity: {
    aura: "#48d8af",
    hull: "#e6dfd3",
    hullStroke: "#3e352c",
    deck: "#b88a44",
    rtg: "#373c42",
    mast: "#f7f3eb",
    optic: "#ff724c",
    wheel: "#242220",
    wheelRim: "#d0b58a",
    arm: "#b5bcc4",
    beam: "rgba(255, 114, 76, 0.36)",
    isCuriosity: true,
  },
  "curiosity-gold": {
    aura: "#ffd166",
    hull: "#f3c753",
    hullStroke: "#6b470c",
    deck: "#c77424",
    rtg: "#4d3926",
    mast: "#ffe596",
    optic: "#ff3b5c",
    wheel: "#241d15",
    wheelRim: "#ffd166",
    arm: "#e3b34c",
    beam: "rgba(255, 59, 92, 0.48)",
    isCuriosity: true,
  },
  "curiosity-night": {
    aura: "#54cfff",
    hull: "#1c2633",
    hullStroke: "#54cfff",
    deck: "#12364b",
    rtg: "#151d26",
    mast: "#28394c",
    optic: "#66f2ff",
    wheel: "#0d131a",
    wheelRim: "#54cfff",
    arm: "#6e88a1",
    beam: "rgba(102, 242, 255, 0.56)",
    isCuriosity: true,
  },
};

/** Dibuja en Canvas 2D el rover animado en tiempo real (ruedas orientables en curvas, giro de banda, pendiente y diseños Curiosity). */
export function renderRover2DCanvas(cur, targetCanvas, isMoving = false) {
  const size = 96;
  const canvas = targetCanvas || document.createElement("canvas");
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  const variant = cur?.rover?.variant ?? "perseverance";
  const palette = DESIGN_PALETTES[variant] ?? DESIGN_PALETTES.perseverance;
  const alertColor =
    cur?.alertLevel === "critical" ? "#e15b4c"
      : cur?.alertLevel === "warn" ? "#f0c14a"
        : palette.aura;

  const steer = Math.max(-0.5, Math.min(0.5, cur?.steerAngleRad ?? 0));
  const pitch = Math.max(-0.55, Math.min(0.55, cur?.pitchRad ?? 0));
  const roll = Math.max(-0.45, Math.min(0.45, cur?.rollRad ?? 0));
  const wheelPhase = cur?.wheelPhaseRad ?? 0;

  ctx.save();
  ctx.translate(size / 2, size / 2 + 2);

  // Dust wake behind wheels when driving or climbing steep terrain.
  if (isMoving || Math.abs(pitch) > 0.14) {
    const dustAlpha = Math.min(0.48, 0.18 + Math.abs(pitch) * 0.45);
    const dustGrad = ctx.createRadialGradient(0, 24, 2, 0, 29, 18);
    dustGrad.addColorStop(0, `rgba(218, 138, 86, ${dustAlpha})`);
    dustGrad.addColorStop(1, "rgba(218, 138, 86, 0)");
    ctx.fillStyle = dustGrad;
    ctx.beginPath();
    ctx.ellipse(0, 28, 15, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Forward scanner / headlight cone (shifts with steering on curves).
  ctx.save();
  ctx.rotate(steer * 0.45);
  const beamGrad = ctx.createLinearGradient(0, -14, 0, -44);
  beamGrad.addColorStop(0, palette.beam);
  beamGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = beamGrad;
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(-16, -42);
  ctx.lineTo(16, -42);
  ctx.closePath();
  ctx.fill();

  if (variant === "curiosity-night") {
    // Dual night floodlight cones
    ctx.fillStyle = "rgba(180, 248, 255, 0.25)";
    [-7, 7].forEach((lx) => {
      ctx.beginPath();
      ctx.moveTo(lx, -16);
      ctx.lineTo(lx - 6, -38);
      ctx.lineTo(lx + 6, -38);
      ctx.closePath();
      ctx.fill();
    });
  }
  ctx.restore();

  // Protective telemetry halo ring.
  ctx.beginPath();
  ctx.arc(0, 2, 23, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(10, 20, 31, 0.72)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = alertColor;
  ctx.stroke();

  // Apply subtle slope foreshortening & downhill shadow offset.
  const slopeScaleY = 1 - Math.abs(pitch) * 0.22;
  const lateralShift = Math.sin(roll) * 2.4;
  const pitchShift = -Math.sin(pitch) * 2.5;
  ctx.translate(lateralShift, pitchShift);
  ctx.scale(1, slopeScaleY);

  // Rocker-bogie suspension struts.
  ctx.strokeStyle = palette.arm ?? "#7e93a8";
  ctx.lineWidth = 2.2;
  [-13, 13].forEach((sx) => {
    ctx.beginPath();
    ctx.moveTo(sx * 0.65, 0);
    ctx.lineTo(sx * 1.15, -11);
    ctx.moveTo(sx * 0.65, 0);
    ctx.lineTo(sx * 1.15, 11);
    ctx.moveTo(sx * 0.65, 0);
    ctx.lineTo(sx * 1.2, 0);
    ctx.stroke();
  });

  // 6 articulated wheels: front wheels steer with curve, rear wheels counter-steer.
  const wheels = [
    { x: -16, y: -11, a: steer },
    { x: 16, y: -11, a: steer },
    { x: -17, y: 0, a: 0 },
    { x: 17, y: 0, a: 0 },
    { x: -16, y: 11, a: -steer * 0.85 },
    { x: 16, y: 11, a: -steer * 0.85 },
  ];
  const treadOffset = ((wheelPhase / (Math.PI * 2)) * 6) % 3;
  wheels.forEach(({ x, y, a }) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = palette.wheel;
    ctx.strokeStyle = palette.wheelRim;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(-3, -5, 6, 10, 1.8);
    ctx.fill();
    ctx.stroke();
    // Moving chevron tread ticks
    ctx.strokeStyle = palette.wheelRim;
    ctx.lineWidth = 0.85;
    for (let ty = -3.5 + treadOffset; ty <= 3.5; ty += 3) {
      ctx.beginPath();
      ctx.moveTo(-2.2, ty);
      ctx.lineTo(2.2, ty);
      ctx.stroke();
    }
    ctx.restore();
  });

  // Main chassis hull.
  ctx.fillStyle = palette.hull;
  ctx.strokeStyle = palette.hullStroke;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(-10, -12, 20, 24, 3.5);
  ctx.fill();
  ctx.stroke();

  // Upper thermal / equipment deck.
  ctx.fillStyle = palette.deck;
  ctx.beginPath();
  ctx.roundRect(-7, -5, 14, 12, 2);
  ctx.fill();

  // Extra gold foil ribbing on Curiosity Gold or LED rail on Curiosity Night.
  if (variant === "curiosity-gold") {
    ctx.strokeStyle = "#fff2b2";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-6, -1);
    ctx.lineTo(6, -1);
    ctx.moveTo(-6, 3);
    ctx.lineTo(6, 3);
    ctx.stroke();
  } else if (variant === "curiosity-night") {
    ctx.strokeStyle = "#54cfff";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-8, -9, 16, 18);
  }

  // Rear MMRTG nuclear power source with fins.
  ctx.fillStyle = palette.rtg;
  ctx.beginPath();
  ctx.roundRect(-5, 11, 10, 6.5, 1.8);
  ctx.fill();

  // Curiosity robotic sample arm & turret on front-right.
  if (palette.isCuriosity) {
    ctx.strokeStyle = palette.arm;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(5, -10);
    ctx.lineTo(9, -16);
    ctx.lineTo(3, -19);
    ctx.stroke();
    ctx.fillStyle = palette.optic;
    ctx.beginPath();
    ctx.arc(3, -19, 2.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mast head & primary camera optic.
  ctx.fillStyle = palette.mast;
  ctx.strokeStyle = palette.hullStroke;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.roundRect(-4.5, -16, 9, 5.5, 1.5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.optic;
  ctx.beginPath();
  ctx.arc(0, -13.4, 1.7, 0, Math.PI * 2);
  ctx.fill();

  // Forward heading pointer.
  ctx.fillStyle = alertColor;
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.lineTo(4.5, -21);
  ctx.lineTo(-4.5, -21);
  ctx.closePath();
  ctx.fill();

  // Slope climb / descent chevron badge near tail.
  if (Math.abs(pitch) > 0.06) {
    ctx.fillStyle = pitch > 0 ? "#79dfbb" : "#ffd166";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(pitch > 0 ? "▲" : "▼", 0, 32);
  }

  ctx.restore();
  return canvas;
}

/** Icono cenital SVG del rover orientado hacia el norte (0 rad) para compatibilidad. */
export const ROVER_MARKER_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <radialGradient id="beam" cx="50%" cy="22%" r="55%">
      <stop offset="0%" stop-color="#29c6ff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#29c6ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <path d="M32 2 L48 26 L16 26 Z" fill="url(#beam)"/>
  <circle cx="32" cy="34" r="18" fill="#0d1b2a" fill-opacity="0.72" stroke="#29c6ff" stroke-width="2"/>
  <rect x="15" y="21" width="5" height="8" rx="1.5" fill="#1e2730" stroke="#7fd0f0" stroke-width="1"/>
  <rect x="44" y="21" width="5" height="8" rx="1.5" fill="#1e2730" stroke="#7fd0f0" stroke-width="1"/>
  <rect x="14" y="31" width="5" height="8" rx="1.5" fill="#1e2730" stroke="#7fd0f0" stroke-width="1"/>
  <rect x="45" y="31" width="5" height="8" rx="1.5" fill="#1e2730" stroke="#7fd0f0" stroke-width="1"/>
  <rect x="15" y="41" width="5" height="8" rx="1.5" fill="#1e2730" stroke="#7fd0f0" stroke-width="1"/>
  <rect x="44" y="41" width="5" height="8" rx="1.5" fill="#1e2730" stroke="#7fd0f0" stroke-width="1"/>
  <rect x="22" y="22" width="20" height="24" rx="3" fill="#e9eff5" stroke="#263c50" stroke-width="1.5"/>
  <rect x="25" y="29" width="14" height="12" rx="1.5" fill="#d4a44a"/>
  <rect x="27" y="45" width="10" height="6" rx="1.5" fill="#465564"/>
  <rect x="28" y="18" width="8" height="5" rx="1.2" fill="#ffffff" stroke="#182a3c" stroke-width="1"/>
  <circle cx="32" cy="20.5" r="1.4" fill="#29c6ff"/>
  <path d="M32 6 L37 14 L27 14 Z" fill="#29c6ff"/>
</svg>
`)}`;
