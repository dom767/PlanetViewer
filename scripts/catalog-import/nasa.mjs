import { pressLabel } from "../star-label.mjs";
import {
  fetchJson,
  letterFromHostname,
  luminosityFromLog10,
  num,
  scoreStarRow,
  str,
} from "./util.mjs";

const NASA_TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync";

const PLANET_COLUMNS = [
  "hostname",
  "pl_name",
  "sy_snum",
  "sy_pnum",
  "cb_flag",
  "ra",
  "dec",
  "sy_dist",
  "st_spectype",
  "st_teff",
  "st_rad",
  "st_lum",
  "st_mass",
  "sy_vmag",
  "pl_orbsmax",
  "pl_orbper",
  "pl_orbeccen",
  "pl_orbincl",
  "pl_orblper",
  "pl_rade",
  "pl_radj",
  "pl_bmasse",
  "discoverymethod",
  "disc_year",
  "disc_facility",
].join(",");

const HOST_COLUMNS = [
  "sy_name",
  "hostname",
  "sy_snum",
  "hd_name",
  "hip_name",
  "gaia_dr3_id",
  "ra",
  "dec",
  "st_spectype",
  "st_teff",
  "st_rad",
  "st_mass",
  "st_lum",
].join(",");

function tapUrl(query) {
  return `${NASA_TAP}?query=${encodeURIComponent(query)}&format=json`;
}

export async function fetchPsCompPars(log) {
  const query = `select ${PLANET_COLUMNS} from pscomppars where sy_dist is not null and ra is not null and dec is not null`;
  log?.("Fetching PSCompPars from NASA Exoplanet Archive…");
  const rows = await fetchJson(tapUrl(query));
  log?.(`Received ${rows.length} planet rows`);
  return rows;
}

export async function fetchStellarHosts(log) {
  const query = `select ${HOST_COLUMNS} from stellarhosts where sy_snum >= 2`;
  log?.("Fetching stellarhosts (sy_snum ≥ 2)…");
  try {
    const rows = await fetchJson(tapUrl(query));
    log?.(`Received ${rows.length} stellarhosts rows`);
    return rows;
  } catch (err) {
    log?.(`stellarhosts TAP with HD/HIP/Gaia failed (${err.message}); retrying slim query`);
    const slim = `select sy_name,hostname,sy_snum,ra,dec,st_spectype,st_teff,st_rad,st_mass,st_lum from stellarhosts where sy_snum >= 2`;
    const rows = await fetchJson(tapUrl(slim));
    log?.(`Received ${rows.length} stellarhosts rows`);
    return rows;
  }
}

function starFromHostRow(row, letterFallback) {
  return {
    letter: letterFromHostname(row.hostname) || letterFallback,
    hostname: str(row.hostname),
    teff: num(row.st_teff),
    radius: num(row.st_rad),
    mass: num(row.st_mass),
    spectype: str(row.st_spectype),
    luminosity: luminosityFromLog10(row.st_lum),
    gaiaId: str(row.gaia_dr3_id) || str(row.gaia_id),
    ra: num(row.ra),
    dec: num(row.dec),
  };
}

/**
 * Best TAP row per hostname.
 * @param {object[]} rows
 */
export function bestRowsByHostname(rows) {
  /** @type {Map<string, object>} */
  const best = new Map();
  for (const row of rows) {
    const host = str(row.hostname);
    if (!host) continue;
    const prev = best.get(host);
    if (!prev || scoreStarRow(row) > scoreStarRow(prev)) best.set(host, row);
  }
  return best;
}

function groupHostsBySystem(rows) {
  /** @type {Map<string, object[]>} */
  const bySy = new Map();
  const best = bestRowsByHostname(rows);
  for (const row of best.values()) {
    const sy = str(row.sy_name) || str(row.hostname);
    if (!sy) continue;
    if (!bySy.has(sy)) bySy.set(sy, []);
    bySy.get(sy).push(starFromHostRow(row, null));
  }
  for (const stars of bySy.values()) {
    stars.sort((a, b) => (a.letter || "Z").localeCompare(b.letter || "Z"));
    let i = 0;
    for (const s of stars) {
      if (!s.letter) s.letter = String.fromCharCode(65 + i);
      i++;
    }
  }
  return bySy;
}

export function buildSystemsFromPsCompPars(rows) {
  /** @type {Map<string, object>} */
  const byHost = new Map();

  for (const row of rows) {
    const name = str(row.hostname);
    if (!name) continue;
    const distPc = num(row.sy_dist);
    const ra = num(row.ra);
    const dec = num(row.dec);
    if (distPc == null || distPc <= 0 || ra == null || dec == null) continue;

    let system = byHost.get(name);
    if (!system) {
      system = {
        name,
        label: pressLabel(name),
        ra,
        dec,
        distPc,
        spectype: str(row.st_spectype),
        teff: num(row.st_teff),
        radius: num(row.st_rad),
        luminosity: luminosityFromLog10(row.st_lum),
        mass: num(row.st_mass),
        vmag: num(row.sy_vmag),
        snum: num(row.sy_snum),
        pnum: num(row.sy_pnum),
        planets: [],
      };
      byHost.set(name, system);
    } else {
      if (!system.spectype && row.st_spectype) system.spectype = str(row.st_spectype);
      if (system.teff == null && row.st_teff != null) system.teff = num(row.st_teff);
      if (system.radius == null && row.st_rad != null) system.radius = num(row.st_rad);
      if (system.luminosity == null && row.st_lum != null) {
        system.luminosity = luminosityFromLog10(row.st_lum);
      }
      if (system.mass == null && row.st_mass != null) system.mass = num(row.st_mass);
      if (system.vmag == null && row.sy_vmag != null) system.vmag = num(row.sy_vmag);
    }

    const planetName = str(row.pl_name);
    if (!planetName) continue;
    if (system.planets.some((p) => p.name === planetName)) continue;

    system.planets.push({
      name: planetName,
      a: num(row.pl_orbsmax),
      periodDays: num(row.pl_orbper),
      e: num(row.pl_orbeccen),
      inclDeg: num(row.pl_orbincl),
      omegaDeg: num(row.pl_orblper),
      nodeDeg: num(row.pl_orbnode ?? row.pl_orblong ?? null),
      radiusEarth: num(row.pl_rade),
      radiusJupiter: num(row.pl_radj),
      massEarth: num(row.pl_bmasse),
      discoveryMethod: str(row.discoverymethod),
      discoveryYear: num(row.disc_year),
      discoveryFacility: str(row.disc_facility),
      cbFlag: num(row.cb_flag) === 1,
    });
  }

  return [...byHost.values()].sort((a, b) => a.distPc - b.distPc);
}

export function attachStarsToSystems(systems, hostRows) {
  const bySy = groupHostsBySystem(hostRows);
  const byHost = new Map();
  for (const [sy, stars] of bySy) {
    byHost.set(sy.toLowerCase(), { sy, stars });
    for (const s of stars) {
      if (s.hostname) byHost.set(s.hostname.toLowerCase(), { sy, stars });
    }
  }

  let attached = 0;
  for (const system of systems) {
    const hit =
      byHost.get(system.name.toLowerCase()) ||
      byHost.get(system.name.replace(/\s+[A-D]$/i, "").toLowerCase());
    if (!hit) continue;

    const stars = hit.stars.map((s) => ({ ...s }));
    const hostStar = stars.find(
      (s) => s.hostname && s.hostname.toLowerCase() === system.name.toLowerCase()
    );
    if (hostStar && !hostStar.letter) hostStar.letter = "A";
    if (stars.length) {
      if (!stars.some((s) => s.letter === "A")) {
        const first = hostStar || stars[0];
        first.letter = "A";
      }
      system.stars = stars;
      attached++;
    }

    const gaia = hostStar?.gaiaId || stars[0]?.gaiaId;
    if (gaia) system.gaiaId = gaia;
    const hdRow = hostRows.find(
      (r) => str(r.hostname)?.toLowerCase() === system.name.toLowerCase()
    );
    if (hdRow) {
      const hd = str(hdRow.hd_name);
      const hip = str(hdRow.hip_name);
      if (hd) system.hdName = hd.replace(/^HD\s*/i, "");
      if (hip) system.hipName = hip.replace(/^HIP\s*/i, "");
    }
  }
  return attached;
}

export async function importExoplanetSystems(log) {
  const planetRows = await fetchPsCompPars(log);
  const systems = buildSystemsFromPsCompPars(planetRows);
  log?.(`${systems.filter((s) => s.label !== s.name).length} of ${systems.length} hosts have press labels`);

  let hostRows = [];
  try {
    hostRows = await fetchStellarHosts(log);
  } catch (err) {
    log?.(`stellarhosts TAP unavailable (${err.message}); continuing without companion-star TAP rows`);
  }
  const attached = attachStarsToSystems(systems, hostRows);
  log?.(`Attached stellarhosts components to ${attached} systems`);

  return {
    systems,
    stellarHostRows: hostRows,
    planetRowCount: planetRows.length,
  };
}
