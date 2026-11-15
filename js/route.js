import { elevation, metersBetween, slopeAspect } from "./dem.js";

function heapPush(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].f <= heap[i].f) break;
    [heap[parent], heap[i]] = [heap[i], heap[parent]];
    i = parent;
  }
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length && last) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < heap.length && heap[left].f < heap[smallest].f) smallest = left;
      if (right < heap.length && heap[right].f < heap[smallest].f) smallest = right;
      if (smallest === i) break;
      [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
      i = smallest;
    }
  }
  return top;
}

function project(lon, lat, originLon, originLat) {
  const lat0 = (originLat * Math.PI) / 180;
  const mLon = (Math.PI / 180) * 3_396_190 * Math.cos(lat0);
  const mLat = (Math.PI / 180) * 3_396_190;
  return [(lon - originLon) * mLon, (lat - originLat) * mLat];
}

function unproject(x, y, originLon, originLat) {
  const lat0 = (originLat * Math.PI) / 180;
  const mLon = (Math.PI / 180) * 3_396_190 * Math.cos(lat0);
  const mLat = (Math.PI / 180) * 3_396_190;
  return [originLon + x / mLon, originLat + y / mLat];
}

function segmentSlope(lon1, lat1, lon2, lat2) {
  const z1 = elevation(lon1, lat1);
  const z2 = elevation(lon2, lat2);
  const distance = Math.max(1, metersBetween(lon1, lat1, lon2, lat2));
  if (z1 == null || z2 == null) return { slope: 0, known: false, z1, z2, distance };
  const along = (Math.atan(Math.abs(z2 - z1) / distance) * 180) / Math.PI;
  const mid = slopeAspect((lon1 + lon2) / 2, (lat1 + lat2) / 2);
  const local = mid ? mid.slope : 0;
  return { slope: Math.max(along, local), known: true, z1, z2, distance };
}

export function directPath(a, b, spacing) {
  const distance = metersBetween(a.lon, a.lat, b.lon, b.lat);
  const steps = Math.max(2, Math.round(distance / spacing));
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push({
      lon: a.lon + (b.lon - a.lon) * t,
      lat: a.lat + (b.lat - a.lat) * t,
    });
  }
  return points;
}

export function avoidPath(a, b, threshold) {
  const straight = metersBetween(a.lon, a.lat, b.lon, b.lat);
  const spacing = straight > 180_000 ? 1600 : straight > 60_000 ? 700 : 280;
  const buffer = Math.max(6000, straight * 0.28);
  const [ax, ay] = project(a.lon, a.lat, a.lon, a.lat);
  const [bx, by] = project(b.lon, b.lat, a.lon, a.lat);
  const minX = Math.min(ax, bx) - buffer;
  const maxX = Math.max(ax, bx) + buffer;
  const minY = Math.min(ay, by) - buffer;
  const maxY = Math.max(ay, by) + buffer;
  const cols = Math.ceil((maxX - minX) / spacing);
  const rows = Math.ceil((maxY - minY) / spacing);
  if (cols * rows > 180_000) return directPath(a, b, spacing);

  const index = (c, r) => r * (cols + 1) + c;
  const toLonLat = (c, r) => unproject(minX + c * spacing, minY + r * spacing, a.lon, a.lat);
  const startC = Math.max(0, Math.min(cols, Math.round((ax - minX) / spacing)));
  const startR = Math.max(0, Math.min(rows, Math.round((ay - minY) / spacing)));
  const goalC = Math.max(0, Math.min(cols, Math.round((bx - minX) / spacing)));
  const goalR = Math.max(0, Math.min(rows, Math.round((by - minY) / spacing)));

  const open = [];
  const gScore = new Map();
  const came = new Map();
  const startKey = index(startC, startR);
  const goalKey = index(goalC, goalR);
  gScore.set(startKey, 0);
  heapPush(open, { f: 0, key: startKey });
  const neighbors = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  let guard = 0;
  while (open.length && guard < 250_000) {
    guard += 1;
    const current = heapPop(open);
    if (current.key === goalKey) break;
    const c = current.key % (cols + 1);
    const r = Math.floor(current.key / (cols + 1));
    const [lon1, lat1] = toLonLat(c, r);
    for (const [dc, dr] of neighbors) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc > cols || nr > rows) continue;
      const [lon2, lat2] = toLonLat(nc, nr);
      const move = segmentSlope(lon1, lat1, lon2, lat2);
      const excess = Math.max(0, move.slope - threshold);
      const penalty = 1 + 0.08 * move.slope ** 2 + excess ** 2 * 1.4;
      const stepCost = move.distance * penalty;
      const nextKey = index(nc, nr);
      const nextG = gScore.get(current.key) + stepCost;
      if (nextG >= (gScore.get(nextKey) ?? Infinity)) continue;
      came.set(nextKey, current.key);
      gScore.set(nextKey, nextG);
      const remain = Math.hypot((goalC - nc) * spacing, (goalR - nr) * spacing);
      heapPush(open, { f: nextG + remain, key: nextKey });
    }
  }

  if (!came.has(goalKey) && startKey !== goalKey) return directPath(a, b, spacing);
  const keys = [goalKey];
  let cursor = goalKey;
  while (cursor !== startKey) {
    cursor = came.get(cursor);
    if (cursor == null) return directPath(a, b, spacing);
    keys.push(cursor);
  }
  keys.reverse();
  const points = keys.map((key) => {
    const c = key % (cols + 1);
    const r = Math.floor(key / (cols + 1));
    const [lon, lat] = toLonLat(c, r);
    return { lon, lat };
  });
  points[0] = { lon: a.lon, lat: a.lat };
  points[points.length - 1] = { lon: b.lon, lat: b.lat };
  return points;
}

export function buildProfile(points, threshold) {
  const samples = [];
  let distance = 0;
  let climb = 0;
  let drop = 0;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const z = elevation(point.lon, point.lat);
    let step = 0;
    let slope = 0;
    if (i > 0) {
      const prev = samples[i - 1];
      step = metersBetween(prev.lon, prev.lat, point.lon, point.lat);
      distance += step;
      if (prev.elevation != null && z != null) {
        const delta = z - prev.elevation;
        if (delta > 0) climb += delta;
        else drop -= delta;
        slope = (Math.atan(Math.abs(delta) / Math.max(step, 1)) * 180) / Math.PI;
      }
    }
    const local = slopeAspect(point.lon, point.lat);
    const grade = Math.max(slope, local ? local.slope : 0);
    samples.push({
      lon: point.lon,
      lat: point.lat,
      distance,
      step,
      elevation: z,
      slope: grade,
      high: grade >= threshold,
    });
  }

  const known = samples.filter((sample) => sample.elevation != null);
  const slopes = known.map((sample) => sample.slope);
  const highLength = samples.reduce((sum, sample) => sum + (sample.high ? sample.step : 0), 0);
  const sectors = [];
  let open = null;
  samples.forEach((sample, index) => {
    if (sample.high && !open) open = { start: index, max: sample.slope, sum: 0, length: 0 };
    if (sample.high && open) {
      open.max = Math.max(open.max, sample.slope);
      open.sum += sample.slope * sample.step;
      open.length += sample.step;
      open.end = index;
    }
    if ((!sample.high || index === samples.length - 1) && open) {
      sectors.push({
        from: samples[open.start].distance,
        to: samples[open.end].distance,
        max: open.max,
        mean: open.length ? open.sum / open.length : open.max,
        startIndex: open.start,
        endIndex: open.end,
      });
      open = null;
    }
  });

  return {
    samples,
    distance,
    straight: points.length > 1
      ? metersBetween(points[0].lon, points[0].lat, points.at(-1).lon, points.at(-1).lat)
      : 0,
    climb,
    drop,
    min: known.length ? Math.min(...known.map((sample) => sample.elevation)) : null,
    max: known.length ? Math.max(...known.map((sample) => sample.elevation)) : null,
    maxSlope: slopes.length ? Math.max(...slopes) : 0,
    meanSlope: slopes.length ? slopes.reduce((sum, value) => sum + value, 0) / slopes.length : 0,
    highLength,
    sectors,
    threshold,
  };
}
