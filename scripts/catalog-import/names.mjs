import { matchHostToStar } from "../host-aliases.mjs";
import { str } from "./util.mjs";

export function stripComponent(name) {
  return String(name || "")
    .replace(/\*+\s*$/, "")
    .replace(/\s+(AB|BC|AC|[A-D])$/i, "")
    .trim();
}

export function compactName(name) {
  return stripComponent(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function extractHd(name) {
  const m = String(name || "").match(/\bHD\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

export function extractHip(name) {
  const m = String(name || "").match(/\bHIP\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

export function extractGaia(id) {
  if (id == null || id === "" || id === "0") return null;
  const s = String(id).replace(/[^0-9]/g, "");
  return s.length >= 5 ? s : null;
}

function addIndex(map, key, value) {
  if (key == null || key === "") return;
  const k = typeof key === "number" ? key : String(key);
  if (!map.has(k)) map.set(k, []);
  const list = map.get(k);
  if (!list.includes(value)) list.push(value);
}

export class SystemIndex {
  /** @param {object[]} systems */
  constructor(systems) {
    this.systems = systems;
    this.byExact = new Map();
    this.byCompact = new Map();
    this.byHd = new Map();
    this.byHip = new Map();
    this.byGaia = new Map();
    for (const s of systems) {
      this.byExact.set(s.name, s);
      addIndex(this.byCompact, compactName(s.name), s);
      addIndex(this.byCompact, compactName(s.label), s);
      const hd = s.hdName != null ? Number(s.hdName) : extractHd(s.name);
      const hip = s.hipName != null ? Number(s.hipName) : extractHip(s.name);
      if (Number.isFinite(hd)) addIndex(this.byHd, hd, s);
      if (Number.isFinite(hip)) addIndex(this.byHip, hip, s);
      const gaia = extractGaia(s.gaiaId) || extractGaia(s.stars?.[0]?.gaiaId);
      if (gaia) addIndex(this.byGaia, gaia, s);
      for (const star of s.stars || []) {
        const g = extractGaia(star.gaiaId);
        if (g) addIndex(this.byGaia, g, s);
        const shd = extractHd(star.hostname);
        if (shd) addIndex(this.byHd, shd, s);
      }
    }
  }

  /**
   * @param {string|null} name
   * @param {{ hd?: number|null, hip?: number|null, gaia?: string|null, alt?: string|null, loose?: boolean }} ids
   */
  find(name, ids = {}) {
    const { hd, hip, gaia, alt, loose } = ids;
    const g = extractGaia(gaia);
    if (g && this.byGaia.has(g)) return this.byGaia.get(g)[0];

    const hdN = hd != null ? Number(hd) : extractHd(name) || extractHd(alt);
    if (Number.isFinite(hdN) && this.byHd.has(hdN)) return this.byHd.get(hdN)[0];

    const hipN = hip != null ? Number(hip) : extractHip(name) || extractHip(alt);
    if (Number.isFinite(hipN) && this.byHip.has(hipN)) return this.byHip.get(hipN)[0];

    for (const n of [name, alt]) {
      if (!n) continue;
      const exact = this.byExact.get(n) || this.byExact.get(str(n));
      if (exact) return exact;
      const c = compactName(n);
      if (c && this.byCompact.has(c)) return this.byCompact.get(c)[0];
    }

    if (loose) {
      for (const n of [name, alt].filter(Boolean)) {
        for (const s of this.systems) {
          if (matchHostToStar(n, s.name) || (s.label && matchHostToStar(n, s.label))) return s;
        }
      }
    }
    return null;
  }
}
