import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { applyOrbitCascade, binariesArtifact } from "./cascade.mjs";
import { importNearbyStarCatalog } from "./gaia.mjs";
import { attachStarsToSystems, fetchStellarHosts, importExoplanetSystems } from "./nasa.mjs";
import { fetchOrb6 } from "./orb6.mjs";
import { fetchSb9 } from "./sb9.mjs";
import { fetchThebaultCatalogs } from "./thebault.mjs";
import {
  CLOSE_BINARIES_PATH,
  EXOPLANETS_PATH,
  NEARBY_PATH,
  STATS_PATH,
  createLogger,
} from "./util.mjs";

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const pretty = path.endsWith("close-binaries.json") || path.endsWith("catalog-import-stats.json");
  await writeFile(path, JSON.stringify(payload, pretty ? null : undefined, pretty ? 2 : 0) + (pretty ? "\n" : ""));
}

export async function importExoplanets({ onLog } = {}) {
  const log = createLogger(onLog);
  const { systems, planetRowCount } = await importExoplanetSystems(log);
  const payload = {
    source: "NASA Exoplanet Archive PSCompPars + stellarhosts",
    fetchedAt: new Date().toISOString(),
    luminosityUnit: "Lsun",
    systemCount: systems.length,
    planetCount: systems.reduce((n, s) => n + s.planets.length, 0),
    systems,
  };
  await writeJson(EXOPLANETS_PATH, payload);
  log(`Wrote ${systems.length} systems → ${EXOPLANETS_PATH}`);
  return {
    fetchedAt: payload.fetchedAt,
    systemCount: payload.systemCount,
    planetCount: payload.planetCount,
    planetRowCount,
  };
}

export async function importNearbyStars({ onLog } = {}) {
  const log = createLogger(onLog);
  const stars = await importNearbyStarCatalog(log);
  const payload = {
    source: "Gaia DR3 (TAP async) — stars with parallax ≥ 33.33 mas (~30 pc)",
    radiusPc: 30,
    diameterPc: 60,
    fetchedAt: new Date().toISOString(),
    starCount: stars.length,
    stars,
  };
  await writeJson(NEARBY_PATH, payload);
  log(`Wrote ${stars.length} nearby stars → ${NEARBY_PATH}`);
  return { fetchedAt: payload.fetchedAt, starCount: stars.length };
}

async function loadExoplanetPayload() {
  const text = await readFile(EXOPLANETS_PATH, "utf8");
  const data = JSON.parse(text);
  if (!Array.isArray(data.systems)) {
    throw new Error("data/exoplanets.json is missing systems[]; run Refresh exoplanets first");
  }
  return data;
}

export async function importBinaries({ onLog } = {}) {
  const log = createLogger(onLog);
  const payload = await loadExoplanetPayload();
  log(`Loaded ${payload.systems.length} systems from exoplanets.json`);

  try {
    const hostRows = await fetchStellarHosts(log);
    const n = attachStarsToSystems(payload.systems, hostRows);
    log(`Attached stellarhosts components to ${n} systems`);
  } catch (err) {
    log(`stellarhosts TAP unavailable (${err.message}); cascade will use catalog masses`);
  }

  const [orb6, sb9, thebault] = await Promise.all([
    fetchOrb6(log).catch((err) => {
      log(`ORB6 unavailable (${err.message})`);
      return [];
    }),
    fetchSb9(log).catch((err) => {
      log(`SB9 unavailable (${err.message})`);
      return [];
    }),
    fetchThebaultCatalogs(log).catch((err) => {
      log(`Thebault unavailable (${err.message})`);
      return { sType: [], pType: [] };
    }),
  ]);

  const { stats } = await applyOrbitCascade(payload.systems, { orb6, sb9, thebault }, log);

  payload.source = "NASA Exoplanet Archive PSCompPars + stellarhosts + binary orbit cascade";
  payload.binaryFetchedAt = new Date().toISOString();
  payload.multiplicity = {
    multiples: stats.multiples,
    drawn: stats.drawn,
    infoOnly: stats.infoOnly,
    circumbinary: stats.circumbinary,
    byQuality: stats.byQuality,
    bySource: stats.bySource,
  };
  await writeJson(EXOPLANETS_PATH, payload);
  log(`Updated exoplanets.json with inlined multiplicity`);

  const binaries = binariesArtifact(payload.systems);
  const artifact = {
    source: "binary orbit cascade (curated CBP → ORB6 → SB9 → Thebault → Gaia sep)",
    fetchedAt: payload.binaryFetchedAt,
    binaryCount: binaries.length,
    drawnCount: binaries.filter((b) => b.drawn).length,
    binaries,
  };
  await writeJson(CLOSE_BINARIES_PATH, artifact);
  log(`Wrote ${binaries.length} binaries artifact → ${CLOSE_BINARIES_PATH}`);

  const summary = {
    fetchedAt: payload.binaryFetchedAt,
    exoplanetFetchedAt: payload.fetchedAt,
    systemCount: payload.systemCount,
    planetCount: payload.planetCount,
    ...stats,
  };
  await writeJson(STATS_PATH, summary);
  return summary;
}

export async function importAll({ onLog, skipNearby = false } = {}) {
  const exo = await importExoplanets({ onLog });
  const bin = await importBinaries({ onLog });
  let nearby = null;
  if (!skipNearby) nearby = await importNearbyStars({ onLog });
  return { exoplanets: exo, binaries: bin, nearby };
}
