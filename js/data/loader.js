/**
 * Load catalog JSON with optional __PLANETVIEWER_ASSET_VERSION__ cache bust.
 * Production exports ship gzipped snapshots (*.json.gz); local dev uses plain JSON.
 */

function withAssetVersion(url) {
  const v = globalThis.__PLANETVIEWER_ASSET_VERSION__;
  if (!v) return url;
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}v=${encodeURIComponent(v)}`;
}

function useGzippedCatalogs() {
  return !!globalThis.__PLANETVIEWER_ASSET_VERSION__;
}

async function fetchJson(url) {
  const versioned = withAssetVersion(url);
  const res = await fetch(versioned);
  if (!res.ok) {
    throw new Error(`Failed to load ${versioned} (${res.status})`);
  }
  return res.json();
}

/**
 * Fetch a gzip file and parse as JSON via DecompressionStream.
 * Do not set Content-Encoding: gzip on the object — the body must stay compressed.
 */
async function fetchGzippedJson(url) {
  const versioned = withAssetVersion(url);
  const res = await fetch(versioned);
  if (!res.ok) {
    throw new Error(`Failed to load ${versioned} (${res.status})`);
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is required for gzipped catalogs");
  }
  const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text);
}

async function loadCatalogPayload(plainUrl) {
  if (useGzippedCatalogs()) {
    return fetchGzippedJson(`${plainUrl}.gz`);
  }
  return fetchJson(plainUrl);
}

/**
 * Load bundled exoplanet catalog JSON.
 * @returns {Promise<object[]>}
 */
export async function loadExoplanetCatalog(url = "data/exoplanets.json") {
  const data = await loadCatalogPayload(url);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.systems)) return data.systems;
  throw new Error("Catalog JSON must be an array or { systems: [] }");
}

/**
 * Load nearby field-star snapshot (Gaia within 30 pc).
 * @returns {Promise<object[]>}
 */
export async function loadNearbyStars(url = "data/nearby-stars.json") {
  const data = await loadCatalogPayload(url);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.stars)) return data.stars;
  throw new Error("Nearby-stars JSON must be an array or { stars: [] }");
}
