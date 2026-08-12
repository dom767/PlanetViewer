/** Spectral type / Teff → RGB and visual sizing helpers. */

const SPECTRAL_COLORS = {
  O: [0.6, 0.72, 1.0],
  B: [0.7, 0.8, 1.0],
  A: [0.85, 0.9, 1.0],
  F: [1.0, 0.98, 0.9],
  G: [1.0, 0.95, 0.75],
  K: [1.0, 0.78, 0.5],
  M: [1.0, 0.5, 0.35],
  L: [0.9, 0.4, 0.25],
  T: [0.7, 0.35, 0.4],
  Y: [0.55, 0.3, 0.45],
};

/**
 * Approximate blackbody chromaticity (simplified).
 * @param {number} teff Kelvin
 * @returns {[number, number, number]}
 */
export function teffToRgb(teff) {
  const t = Math.max(1000, Math.min(40000, teff)) / 100;
  let r;
  let g;
  let b;

  if (t <= 66) {
    r = 1;
    g = Math.max(0, Math.min(1, (99.4708025861 * Math.log(t) - 161.1195681661) / 255));
  } else {
    r = Math.max(0, Math.min(1, (329.698727446 * Math.pow(t - 60, -0.1332047592)) / 255));
    g = Math.max(0, Math.min(1, (288.1221695283 * Math.pow(t - 60, -0.0755148492)) / 255));
  }

  if (t >= 66) {
    b = 1;
  } else if (t <= 19) {
    b = 0;
  } else {
    b = Math.max(0, Math.min(1, (138.5177312231 * Math.log(t - 10) - 305.0447927307) / 255));
  }

  return [r, g, b];
}

/**
 * @param {string|null|undefined} spectype
 * @returns {[number, number, number]|null}
 */
export function spectralTypeToRgb(spectype) {
  if (!spectype || typeof spectype !== "string") return null;
  const letter = spectype.trim().charAt(0).toUpperCase();
  return SPECTRAL_COLORS[letter] ? [...SPECTRAL_COLORS[letter]] : null;
}

/**
 * @param {{teff?: number|null, spectype?: string|null}} star
 * @returns {[number, number, number]}
 */
export function starColor(star) {
  if (star.teff && star.teff > 0) return teffToRgb(star.teff);
  const fromType = spectralTypeToRgb(star.spectype);
  if (fromType) return fromType;
  return [1, 0.95, 0.8];
}

/**
 * Relative point size from stellar radius (R_sun) and brightness.
 * @param {{radius?: number|null, luminosity?: number|null, vmag?: number|null, distPc?: number|null}} star
 */
export function starPointSize(star) {
  const rad = star.radius && star.radius > 0 ? star.radius : 1;
  let size = 4 + Math.min(28, Math.sqrt(rad) * 4);

  if (star.luminosity && star.luminosity > 0) {
    size *= 0.85 + Math.min(0.6, Math.log10(star.luminosity + 1) * 0.15);
  } else if (star.vmag != null && star.distPc) {
    // Absolute-ish brightness cue from apparent mag + distance
    const absHint = star.vmag - 5 * Math.log10(Math.max(star.distPc, 0.1) / 10);
    size *= Math.max(0.7, Math.min(1.4, 1.2 - absHint * 0.02));
  }

  return size;
}

/**
 * Alpha / intensity factor from luminosity or Vmag.
 */
export function starBrightness(star) {
  if (star.luminosity && star.luminosity > 0) {
    return Math.max(0.35, Math.min(1.4, 0.55 + Math.log10(star.luminosity + 1) * 0.25));
  }
  if (star.vmag != null) {
    return Math.max(0.35, Math.min(1.3, 1.1 - star.vmag * 0.04));
  }
  return 0.85;
}
