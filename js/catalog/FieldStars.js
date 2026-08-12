import { equatorialToCartesian } from "../astro/coords.js";

/** Goldilocks-free field stars (no known planets), within radius of Sol. */
export const FIELD_STAR_RADIUS_PC = 30;

/**
 * Approximate RGB from Gaia BP−RP colour index.
 * @param {number|null} bpRp
 * @returns {[number, number, number]}
 */
export function bpRpToRgb(bpRp) {
  if (bpRp == null || !Number.isFinite(bpRp)) return [0.85, 0.88, 0.95];
  // Rough OBAFGKM mapping
  if (bpRp < 0.0) return [0.65, 0.75, 1.0];
  if (bpRp < 0.4) return [0.8, 0.86, 1.0];
  if (bpRp < 0.8) return [0.95, 0.95, 0.98];
  if (bpRp < 1.2) return [1.0, 0.95, 0.8];
  if (bpRp < 1.8) return [1.0, 0.82, 0.55];
  if (bpRp < 2.5) return [1.0, 0.6, 0.4];
  return [0.95, 0.45, 0.3];
}

/**
 * Build renderable field-star list, excluding positions near known exoplanet hosts.
 * @param {object[]} rawStars from nearby-stars.json
 * @param {import('./Catalog.js').Catalog} catalog
 * @param {number} [radiusPc]
 */
export function buildFieldStars(rawStars, catalog, radiusPc = FIELD_STAR_RADIUS_PC) {
  const hosts = (catalog.systems || []).filter(
    (s) => !s.isSol && s.distPc != null && s.distPc <= radiusPc + 2
  );

  const out = [];
  for (const raw of rawStars) {
    if (raw.distPc == null || raw.distPc > radiusPc) continue;
    if (raw.ra == null || raw.dec == null) continue;

    const pos = equatorialToCartesian(raw.ra, raw.dec, raw.distPc);

    // Skip if near a known planet-host system
    let nearHost = false;
    for (const h of hosts) {
      const dx = pos.x - h.x;
      const dy = pos.y - h.y;
      const dz = pos.z - h.z;
      if (dx * dx + dy * dy + dz * dz < 0.12 * 0.12) {
        nearHost = true;
        break;
      }
    }
    if (nearHost) continue;

    const gMag = raw.gMag ?? 10;
    // Dimmer, smaller than planet-host markers
    const size = Math.max(1.2, Math.min(5.5, 7.5 - gMag * 0.35));
    const brightness = Math.max(0.2, Math.min(0.7, 1.1 - gMag * 0.05));

    out.push({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      color: bpRpToRgb(raw.bpRp),
      size,
      brightness,
      distPc: raw.distPc,
      gMag,
    });
  }
  return out;
}
