/**
 * Earth's solar system (Sol + 8 planets).
 * Keplerian elements ≈ JPL “Keplerian Elements for Approximate Positions”
 * at epoch J2000.0 (ecliptic / equinox), sufficient for a schematic viewer.
 *
 * ω = ϖ − Ω,  M0 = L − ϖ  (degrees, normalized).
 */

import { GOLDILOCKS_COLOR } from "./habitable.js";
import { starBrightness } from "./spectrum.js";

const PLANET_COLORS = {
  Mercury: [0.72, 0.68, 0.62],
  Venus: [0.92, 0.82, 0.55],
  Earth: [0.35, 0.55, 0.95],
  Mars: [0.9, 0.45, 0.3],
  Jupiter: [0.88, 0.72, 0.5],
  Saturn: [0.9, 0.8, 0.55],
  Uranus: [0.55, 0.85, 0.9],
  Neptune: [0.35, 0.5, 0.95],
};

function norm360(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * @param {string} name
 * @param {{ a:number, e:number, i:number, L:number, longPeri:number, longNode:number, periodDays:number, radiusEarth:number, massEarth:number }} el
 */
function planetFromElements(name, el) {
  const omega = norm360(el.longPeri - el.longNode); // ω
  const meanAnomaly0 = norm360(el.L - el.longPeri); // M at J2000
  return {
    name,
    a: el.a,
    periodDays: el.periodDays,
    e: el.e,
    inclDeg: el.i,
    omegaDeg: omega,
    nodeDeg: norm360(el.longNode),
    meanAnomaly0Deg: meanAnomaly0,
    /** Positions use days-since-J2000 as simulation time. */
    epoch: "J2000",
    radiusEarth: el.radiusEarth,
    massEarth: el.massEarth,
    color: PLANET_COLORS[name],
  };
}

/** @returns {object} catalog-ready Sol system at the origin */
export function createSolSystem() {
  // Sidereal orbital periods (days). Elements from JPL approx. table (J2000).
  const planets = [
    planetFromElements("Mercury", {
      a: 0.38709927,
      e: 0.20563593,
      i: 7.00497902,
      L: 252.2503235,
      longPeri: 77.45779628,
      longNode: 48.33076593,
      periodDays: 87.969,
      radiusEarth: 0.383,
      massEarth: 0.055,
    }),
    planetFromElements("Venus", {
      a: 0.72333566,
      e: 0.00677672,
      i: 3.39467605,
      L: 181.9790995,
      longPeri: 131.60246718,
      longNode: 76.67984255,
      periodDays: 224.701,
      radiusEarth: 0.949,
      massEarth: 0.815,
    }),
    planetFromElements("Earth", {
      a: 1.00000261,
      e: 0.01671123,
      i: 0.00001531,
      L: 100.46457166,
      longPeri: 102.93768193,
      longNode: 0.0,
      periodDays: 365.256,
      radiusEarth: 1,
      massEarth: 1,
    }),
    planetFromElements("Mars", {
      a: 1.52371034,
      e: 0.0933941,
      i: 1.84969142,
      L: -4.55343205,
      longPeri: -23.94362959,
      longNode: 49.55953891,
      periodDays: 686.98,
      radiusEarth: 0.532,
      massEarth: 0.107,
    }),
    planetFromElements("Jupiter", {
      a: 5.202887,
      e: 0.04838624,
      i: 1.30439695,
      L: 34.39644051,
      longPeri: 14.72847983,
      longNode: 100.47390909,
      periodDays: 4332.589,
      radiusEarth: 11.21,
      massEarth: 317.8,
    }),
    planetFromElements("Saturn", {
      a: 9.53667594,
      e: 0.05386179,
      i: 2.48599187,
      L: 49.95424423,
      longPeri: 92.59887831,
      longNode: 113.66242448,
      periodDays: 10759.22,
      radiusEarth: 9.45,
      massEarth: 95.2,
    }),
    planetFromElements("Uranus", {
      a: 19.18916464,
      e: 0.04725744,
      i: 0.77263783,
      L: 313.23810451,
      longPeri: 170.9542763,
      longNode: 74.01692503,
      periodDays: 30685.4,
      radiusEarth: 4.01,
      massEarth: 14.5,
    }),
    planetFromElements("Neptune", {
      a: 30.06992276,
      e: 0.00859048,
      i: 1.77004347,
      L: -55.12002969,
      longPeri: 44.96476227,
      longNode: 131.78405702,
      periodDays: 60189.0,
      radiusEarth: 3.88,
      massEarth: 17.1,
    }),
  ];

  // Earth is in the Goldilocks zone; color applied again by catalog, but set here too
  for (const p of planets) {
    if (p.name === "Earth" || p.name === "Mars") {
      p.color = [...GOLDILOCKS_COLOR];
      p.habitableZone = true;
    }
  }

  return {
    id: -1,
    name: "Sol",
    label: "Sol",
    isSol: true,
    ra: 0,
    dec: 0,
    distPc: 0,
    spectype: "G2V",
    teff: 5772,
    radius: 1,
    luminosity: 1,
    vmag: -26.74,
    mass: 1,
    snum: 1,
    pnum: 8,
    x: 0,
    y: 0,
    z: 0,
    color: [1, 0.95, 0.7],
    pointSize: 18,
    brightness: starBrightness({ luminosity: 1 }),
    planets,
  };
}
