/** Approximate habitable (Goldilocks) zone helpers. Distances in AU. */

/** Distinct gold for HZ planets in the renderer. */
export const GOLDILOCKS_COLOR = [1.0, 0.82, 0.28];

/**
 * Stellar luminosity in linear L☉ from catalog fields.
 * Catalog stores linear solar units (NASA st_lum is converted from log10 on fetch).
 */
export function stellarLuminositySolar(star) {
  if (star.luminosity != null && star.luminosity > 0) return star.luminosity;
  // Stefan–Boltzmann: L/Lsun ≈ (R/Rsun)^2 (T/Tsun)^4
  if (star.radius != null && star.radius > 0 && star.teff != null && star.teff > 0) {
    const t = star.teff / 5772;
    return star.radius * star.radius * t * t * t * t;
  }
  if (star.mass != null && star.mass > 0) {
    // Mass-luminosity rough main-sequence estimate
    const m = star.mass;
    if (m < 0.43) return 0.23 * Math.pow(m, 2.3);
    if (m < 2) return Math.pow(m, 4);
    return 1.5 * Math.pow(m, 3.5);
  }
  return 1;
}

/**
 * Conservative HZ bounds (AU), scaled by sqrt(L/L☉).
 * Inner ≈ recent-Venus; outer ≈ early-Mars (order-of-magnitude).
 */
export function habitableZoneAu(luminositySolar) {
  const s = Math.sqrt(Math.max(luminositySolar, 1e-6));
  return {
    inner: 0.75 * s,
    outer: 1.8 * s,
  };
}

/**
 * True if semi-major axis falls in the star's Goldilocks zone.
 */
export function isInGoldilocksZone(semiMajorAu, star) {
  if (semiMajorAu == null || !(semiMajorAu > 0)) return false;
  const { inner, outer } = habitableZoneAu(stellarLuminositySolar(star));
  return semiMajorAu >= inner && semiMajorAu <= outer;
}

/**
 * Tag planets with habitableZone and gold color when inside the HZ.
 */
export function applyGoldilocksColors(system) {
  for (const p of system.planets || []) {
    const hz = isInGoldilocksZone(p.a, system);
    p.habitableZone = hz;
    if (hz) p.color = [...GOLDILOCKS_COLOR];
  }
  return system;
}
