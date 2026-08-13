import { equatorialToCartesian, projectToNdc, ndcToScreen } from "../astro/coords.js";
import { starBrightness, starColor, starPointSize } from "../astro/spectrum.js";
import { estimateSemiMajorAxis } from "../astro/orbits.js";
import { createSolSystem } from "../astro/sol.js";
import { applyGoldilocksColors } from "../astro/habitable.js";
import { STAR_NOTES, getStarNote } from "../content/starNotes.js";
import {
  notableBookmarkSize,
  notableBookmarkHitbox,
  distanceToBookmark,
} from "../render/bookmarkLayout.js";

/**
 * In-memory catalog of host systems.
 */
export class Catalog {
  constructor() {
    /** @type {SystemRecord[]} */
    this.systems = [];
    /** @type {Map<string, SystemRecord>} */
    this.byName = new Map();
    /** @type {SystemRecord|null} */
    this.sol = null;
    /** @type {SystemRecord[]} */
    this.notableSystems = [];
  }

  /** @param {object[]} rawSystems from loader */
  load(rawSystems) {
    this.systems = [];
    this.byName.clear();
    this.notableSystems = [];

    // Older snapshots stored NASA st_lum as log10(L/L☉). Convert if needed.
    const systemsIn = convertLogLuminositiesIfNeeded(rawSystems);

    this.sol = createSolSystem();
    this.sol.id = 0;
    applyGoldilocksColors(this.sol);
    attachStarNote(this.sol);
    this.systems.push(this.sol);
    this.byName.set(this.sol.name, this.sol);

    for (const raw of systemsIn) {
      if (raw.distPc == null || !(raw.distPc > 0)) continue;
      if (raw.ra == null || raw.dec == null) continue;

      const pos = equatorialToCartesian(raw.ra, raw.dec, raw.distPc);
      const starMeta = {
        teff: raw.teff,
        spectype: raw.spectype,
        radius: raw.radius,
        luminosity: raw.luminosity,
        vmag: raw.vmag,
        distPc: raw.distPc,
      };

      const planets = (raw.planets || []).map((p, idx) => normalizePlanet(p, raw.mass, idx));
      // PSCompPars has no Ω; share a stable per-host node so coplanarity is system-local.
      const hostNode = hashAngleDeg(raw.name || "Unknown");
      for (const p of planets) {
        if (p.nodeDeg == null) p.nodeDeg = hostNode;
      }

      const system = {
        id: this.systems.length,
        name: raw.name || "Unknown",
        ra: raw.ra,
        dec: raw.dec,
        distPc: raw.distPc,
        spectype: raw.spectype || null,
        teff: raw.teff ?? null,
        radius: raw.radius ?? null,
        luminosity: raw.luminosity ?? null,
        vmag: raw.vmag ?? null,
        mass: raw.mass ?? null,
        snum: raw.snum ?? null,
        pnum: raw.pnum ?? planets.length,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        color: starColor(starMeta),
        pointSize: starPointSize(starMeta),
        brightness: starBrightness(starMeta),
        planets,
      };

      applyGoldilocksColors(system);
      attachStarNote(system);

      this.systems.push(system);
      this.byName.set(system.name, system);
    }

    this.notableSystems = this.systems.filter((s) => s.notable);
    warnUnmatchedStarNotes(this.byName);

    return this;
  }

  /**
   * Nearest system to a screen click (buffer pixels).
   */
  pickNearest(screenX, screenY, viewProj, width, height, maxPx = 18) {
    let best = null;
    let bestScore = maxPx;

    for (const s of this.systems) {
      const ndc = projectToNdc(s, viewProj);
      if (!ndc || ndc.z < -1 || ndc.z > 1) continue;
      if (ndc.x < -1.2 || ndc.x > 1.2 || ndc.y < -1.2 || ndc.y > 1.2) continue;
      const scr = ndcToScreen(ndc, width, height);
      let d = Math.hypot(scr.x - screenX, scr.y - screenY);
      if (s.notable) {
        const clipW =
          viewProj[3] * s.x + viewProj[7] * s.y + viewProj[11] * s.z + viewProj[15];
        const box = notableBookmarkHitbox(scr, notableBookmarkSize(clipW, width));
        d = Math.min(d, distanceToBookmark(screenX, screenY, box));
      }
      // Prefer notables (and slightly Sol) so bookmarks are easy to land on.
      const score = s.notable ? d * 0.55 : s.isSol ? d * 0.85 : d;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }
}

function normalizePlanet(p, starMass, idx) {
  let a = p.a ?? null;
  const periodDays = p.periodDays ?? null;
  if ((a == null || a <= 0) && periodDays) {
    a = estimateSemiMajorAxis(periodDays, starMass ?? 1);
  }

  const palette = [
    [0.55, 0.75, 1.0],
    [0.9, 0.7, 0.45],
    [0.6, 0.9, 0.7],
    [0.85, 0.55, 0.85],
    [0.95, 0.85, 0.5],
  ];

  return {
    name: p.name || `Planet ${idx + 1}`,
    a,
    periodDays,
    e: clamp(p.e ?? 0, 0, 0.95),
    // Missing i: transit-like prior (~90°) instead of 60° (which coplanarized systems).
    inclDeg: p.inclDeg != null ? p.inclDeg : 90,
    omegaDeg: p.omegaDeg ?? 0,
    nodeDeg: p.nodeDeg ?? null,
    radiusEarth: p.radiusEarth ?? null,
    radiusJupiter: p.radiusJupiter ?? null,
    massEarth: p.massEarth ?? null,
    discoveryMethod: p.discoveryMethod ?? null,
    discoveryYear: p.discoveryYear ?? null,
    discoveryFacility: p.discoveryFacility ?? null,
    color: palette[idx % palette.length],
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Deterministic 0–360° from host name (stand-in Ω when catalog has none). */
function hashAngleDeg(name) {
  let h = 2166136261;
  const s = String(name);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 36000) / 100;
}

/**
 * NASA PSCompPars st_lum is log10(L/L☉). Older snapshots stored that raw.
 * If any host has luminosity < 0, treat the whole list as log10 and convert.
 * @param {object[]} systems
 */
function convertLogLuminositiesIfNeeded(systems) {
  const needsConvert = systems.some(
    (s) => s.luminosity != null && s.luminosity < 0
  );
  if (!needsConvert) return systems;
  return systems.map((s) => {
    if (s.luminosity == null) return s;
    return { ...s, luminosity: 10 ** s.luminosity };
  });
}

/**
 * @param {SystemRecord} system
 */
function attachStarNote(system) {
  const note = getStarNote(system.name);
  if (note) {
    system.note = note;
    system.notable = true;
  } else {
    system.note = null;
    system.notable = false;
  }
}

/**
 * @param {Map<string, SystemRecord>} byName
 */
function warnUnmatchedStarNotes(byName) {
  for (const key of Object.keys(STAR_NOTES)) {
    if (!byName.has(key)) {
      console.warn(`[starNotes] No catalog system matched hostname "${key}"`);
    }
  }
}

/**
 * @typedef {object} SystemRecord
 * @property {number} id
 * @property {string} name
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} distPc
 * @property {[number,number,number]} color
 * @property {number} pointSize
 * @property {number} brightness
 * @property {object[]} planets
 * @property {{text: string}|null} [note]
 * @property {boolean} [notable]
 */
