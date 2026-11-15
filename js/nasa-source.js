import LOCAL_TILES from "./nasa-tiles-index.json";

export const REMOTE_TREK_BASE = "https://trek.nasa.gov/tiles/Mars/EQ";
export const REMOTE_ONMARS_CTX = "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile";

const LOCAL_SET = new Set(LOCAL_TILES);
export const LOCAL_TILE_COUNT = LOCAL_TILES.length;

export function localTileUrl(layer, z, y, x, ext) {
  const key = `${layer}/${z}/${y}/${x}.${ext}`;
  return LOCAL_SET.has(key) ? `./nasa-tiles/${key}` : null;
}

export function remoteTileUrl(layer, z, y, x, ext) {
  if (layer === "OnMars_CTX") {
    return `${REMOTE_ONMARS_CTX}/${z}/${y}/${x}`;
  }
  return `${REMOTE_TREK_BASE}/${layer}/1.0.0/default/default028mm/${z}/${y}/${x}.${ext}`;
}

export function resolveNasaTileUrl(layer, z, y, x, ext) {
  return localTileUrl(layer, z, y, x, ext) ?? remoteTileUrl(layer, z, y, x, ext);
}
