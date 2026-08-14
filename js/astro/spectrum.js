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

/** Sun absolute V magnitude — used when converting vmag + distance → L/L☉. */
const SUN_ABS_VMAG = 4.83;

/**
 * Estimate luminosity in L☉ from catalog fields.
 * @param {{luminosity?: number|null, vmag?: number|null, distPc?: number|null}} star
 * @returns {number|null}
 */
function luminositySolar(star) {
  if (star.luminosity && star.luminosity > 0) return star.luminosity;
  if (star.vmag == null || !Number.isFinite(star.vmag)) return null;
  if (star.distPc != null && star.distPc > 0) {
    const absMag =
      star.vmag - 5 * Math.log10(Math.max(star.distPc, 0.01) / 10);
    return Math.pow(10, -0.4 * (absMag - SUN_ABS_VMAG));
  }
  // Apparent mag alone is a weak stand-in; still better than a flat default.
  return Math.pow(10, -0.4 * (star.vmag - SUN_ABS_VMAG));
}

/**
 * Billboard intensity from intrinsic luminosity (L/L☉).
 * Log-scaled and centered on the Sun (L=1 → 1.0) so dim M dwarfs and
 * luminous hosts stay clearly different; the star shader twinkles around this.
 */
export function starBrightness(star) {
  const lum = luminositySolar(star);
  if (lum == null) return 0.75;
  const x = Math.log10(Math.max(lum, 1e-8));
  return Math.max(0.22, Math.min(2.0, 1.0 + x * 0.28));
}
