/**
 * Named nearby stars with no confirmed exoplanets, injected for bookmarks
 * (fiction landmarks). Do not invent planets here.
 *
 * @typedef {{
 *   name: string,
 *   label: string,
 *   aliases: string[],
 *   ra: number,
 *   dec: number,
 *   distPc: number,
 *   spectype: string,
 *   teff: number,
 *   radius: number,
 *   luminosity: number,
 *   mass: number,
 *   vmag: number,
 *   snum: number,
 *   pnum: number,
 *   planets: object[],
 * }} LandmarkStar
 */

/** @type {LandmarkStar[]} */
export const LANDMARK_STARS = [
  {
    name: "40 Eri A",
    label: "40 Eridani A",
    aliases: [
      "40 Eridani",
      "40 Eri",
      "Erid",
      "Vulcan",
      "Keid",
      "HD 26965",
      "omi02 Eri",
    ],
    // SIMBAD ICRS J2000 (HD 26965 / Keid)
    ra: 63.817998,
    dec: -7.65287,
    distPc: 5.04,
    spectype: "K0.5V",
    teff: 5151,
    radius: 0.81,
    luminosity: 0.44,
    mass: 0.78,
    vmag: 4.43,
    snum: 3,
    pnum: 0,
    planets: [],
    stars: [
      { letter: "A", teff: 5151, radius: 0.81, mass: 0.78, spectype: "K0.5V", luminosity: 0.44 },
      { letter: "B", teff: 16500, radius: 0.014, mass: 0.57, spectype: "DA4" },
      { letter: "C", teff: 3125, radius: 0.31, mass: 0.20, spectype: "M4.5Ve" },
    ],
    multiplicity: {
      snum: 3,
      kind: "triple",
      orbitQuality: "projected",
      circumbinary: false,
      a: 400,
      periodDays: null,
      source: "landmark",
      drawn: false,
    },
  },
  {
    name: "zet 2 Ret",
    label: "Zeta 2 Reticuli",
    aliases: [
      "zet02 Ret",
      "Zeta 2 Reticuli",
      "Zeta Reticuli",
      "LV-426",
      "Acheron",
      "HD 20807",
    ],
    // SIMBAD ICRS J2000 (HD 20807 / ζ² Ret)
    ra: 49.553412,
    dec: -62.506362,
    distPc: 12.05,
    spectype: "G1V",
    teff: 5850,
    radius: 0.99,
    luminosity: 0.97,
    mass: 0.96,
    vmag: 5.24,
    snum: 2,
    pnum: 0,
    planets: [],
    stars: [
      { letter: "A", teff: 5850, radius: 0.99, mass: 0.96, spectype: "G1V", luminosity: 0.97 },
      { letter: "B", teff: 5795, radius: 0.92, mass: 0.99, spectype: "G2.5V", luminosity: 0.93 },
    ],
    multiplicity: {
      snum: 2,
      kind: "binary",
      orbitQuality: "projected",
      circumbinary: false,
      a: 3700,
      periodDays: null,
      source: "landmark",
      drawn: false,
    },
  },
];
