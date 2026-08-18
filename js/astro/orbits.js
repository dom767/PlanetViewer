/** Keplerian orbit helpers. Angles in radians unless noted. */

import {
  add3,
  cross3,
  dot3,
  length3,
  normalize3,
  scale3,
  sub3,
} from "./coords.js";

const TWO_PI = Math.PI * 2;
const DAY = 1; // simulation time unit = days
const DEG2RAD = Math.PI / 180;
const WORLD_UP = { x: 0, y: 0, z: 1 };

/**
 * Estimate semi-major axis (AU) from period (days) and stellar mass (M_sun).
 * Kepler's 3rd: a^3 / P^2 = M (P in years).
 */
export function estimateSemiMajorAxis(periodDays, starMassSolar = 1) {
  if (!periodDays || periodDays <= 0) return null;
  const pYears = periodDays / 365.25;
  const m = starMassSolar > 0 ? starMassSolar : 1;
  return Math.cbrt(m * pYears * pYears);
}

/**
 * Inverse of estimateSemiMajorAxis. Used when imaging detections publish
 * a (AU) but not an orbital period.
 */
export function estimateOrbitalPeriodDays(aAu, starMassSolar = 1) {
  if (!aAu || aAu <= 0) return null;
  const m = starMassSolar > 0 ? starMassSolar : 1;
  const pYears = Math.sqrt((aAu * aAu * aAu) / m);
  return pYears * 365.25;
}

/**
 * Solve Kepler's equation for eccentric anomaly.
 */
export function eccentricAnomaly(M, e, iterations = 8) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < iterations; i++) {
    E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }
  return E;
}

/**
 * Position in orbital plane (periapsis along +x), AU.
 */
export function positionInOrbit(a, e, trueAnomaly) {
  const r = (a * (1 - e * e)) / (1 + e * Math.cos(trueAnomaly));
  return {
    x: r * Math.cos(trueAnomaly),
    y: r * Math.sin(trueAnomaly),
    z: 0,
  };
}

/**
 * Rotate from orbital plane to reference frame using i, ω, Ω.
 */
export function orbitToWorld(pos, i, omega, Omega = 0) {
  const cosO = Math.cos(Omega);
  const sinO = Math.sin(Omega);
  const cosi = Math.cos(i);
  const sini = Math.sin(i);
  const cosw = Math.cos(omega);
  const sinw = Math.sin(omega);

  const x1 = pos.x * cosw - pos.y * sinw;
  const y1 = pos.x * sinw + pos.y * cosw;
  const z1 = pos.z;

  const x2 = x1;
  const y2 = y1 * cosi - z1 * sini;
  const z2 = y1 * sini + z1 * cosi;

  return {
    x: x2 * cosO - y2 * sinO,
    y: x2 * sinO + y2 * cosO,
    z: z2,
  };
}

function wrapTwoPi(a) {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Mean anomaly at simulation time.
 * If `meanAnomaly0Deg` is set (Sol), `tDays` is days since J2000 and M0 is at epoch.
 * Otherwise M = n * tDays (schematic exoplanets).
 */
export function meanAnomalyAt(planet, tDays) {
  const period = planet.periodDays;
  if (!period || period <= 0) return 0;
  const n = TWO_PI / period;
  if (planet.meanAnomaly0Deg != null) {
    const M0 = planet.meanAnomaly0Deg * DEG2RAD;
    return wrapTwoPi(M0 + n * tDays);
  }
  return wrapTwoPi(n * tDays);
}

/**
 * Planet offset (AU) in the Kepler reference frame at simulation time tDays.
 */
export function planetOffsetAu(planet, tDays) {
  const a = planet.a;
  const e = planet.e ?? 0;
  if (!a || a <= 0) return null;

  const period = planet.periodDays;
  const M = period && period > 0 ? meanAnomalyAt(planet, tDays) : 0;
  const E = eccentricAnomaly(M, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const trueAnomaly = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e);

  const i = ((planet.inclDeg ?? 90) * Math.PI) / 180;
  const omega = ((planet.omegaDeg ?? 0) * Math.PI) / 180;
  const Omega = ((planet.nodeDeg ?? 0) * Math.PI) / 180;

  const plane = positionInOrbit(a, e, trueAnomaly);
  return orbitToWorld(plane, i, omega, Omega);
}

/**
 * Sample elliptical orbit path in AU (oriented with i, ω, Ω).
 * @returns {Float32Array} xyz triplets
 */
export function sampleOrbitPath(planet, samples = 128) {
  const a = planet.a;
  const e = planet.e ?? 0;
  if (!a || a <= 0) return new Float32Array(0);

  const i = ((planet.inclDeg ?? 90) * Math.PI) / 180;
  const omega = ((planet.omegaDeg ?? 0) * Math.PI) / 180;
  const Omega = ((planet.nodeDeg ?? 0) * Math.PI) / 180;
  const out = new Float32Array(samples * 3);

  for (let s = 0; s < samples; s++) {
    const nu = (s / samples) * TWO_PI;
    const plane = positionInOrbit(a, e, nu);
    const w = orbitToWorld(plane, i, omega, Omega);
    out[s * 3] = w.x;
    out[s * 3 + 1] = w.y;
    out[s * 3 + 2] = w.z;
  }
  return out;
}

/**
 * Reference frame for Kepler elements → world.
 * - Sol: world/ecliptic axes (elements are ecliptic-relative)
 * - Exoplanets: sky plane at the star (ez = line of sight from Sol; i is to that plane)
 */
export function keplerReferenceFrame(system) {
  if (system?.isSol) {
    return {
      ex: { x: 1, y: 0, z: 0 },
      ey: { x: 0, y: 1, z: 0 },
      ez: { x: 0, y: 0, z: 1 },
    };
  }
  const r = length3(system);
  const ez =
    r > 1e-6
      ? scale3(system, 1 / r)
      : { x: 0, y: 0, z: 1 };
  let ex = cross3(WORLD_UP, ez);
  if (length3(ex) < 1e-6) ex = cross3({ x: 1, y: 0, z: 0 }, ez);
  ex = normalize3(ex);
  const ey = normalize3(cross3(ez, ex));
  return { ex, ey, ez };
}

/** Map a Kepler-frame vector into world space (orientation only). */
export function applyKeplerFrame(frame, v) {
  return {
    x: frame.ex.x * v.x + frame.ey.x * v.y + frame.ez.x * v.z,
    y: frame.ex.y * v.x + frame.ey.y * v.y + frame.ez.y * v.z,
    z: frame.ex.z * v.x + frame.ey.z * v.y + frame.ez.z * v.z,
  };
}

/**
 * Orbital-plane normal in the Kepler reference frame (matches orbitToWorld).
 */
export function orbitalPlaneNormalLocal(planet) {
  const i = ((planet.inclDeg ?? 90) * Math.PI) / 180;
  const Omega = ((planet.nodeDeg ?? 0) * Math.PI) / 180;
  return {
    x: Math.sin(i) * Math.sin(Omega),
    y: -Math.sin(i) * Math.cos(Omega),
    z: Math.cos(i),
  };
}

/**
 * Camera orbit basis whose plane matches the system's mean planetary plane.
 * - ey: mean orbital normal (flipped toward cameraPos)
 * - ex, ez: orthonormal axes in that plane
 */
export function planetaryOrbitBasis(system, cameraPos) {
  const ref = keplerReferenceFrame(system);
  const planets = (system.planets || []).filter((p) => p.a && p.a > 0);

  let N = { x: 0, y: 0, z: 0 };
  if (planets.length) {
    for (const p of planets) {
      N = add3(N, applyKeplerFrame(ref, orbitalPlaneNormalLocal(p)));
    }
    if (length3(N) < 1e-8) {
      N = applyKeplerFrame(ref, { x: 0, y: 0, z: 1 });
    } else {
      N = normalize3(N);
    }
  } else {
    N = applyKeplerFrame(ref, { x: 0, y: 0, z: 1 });
  }

  const star = { x: system.x, y: system.y, z: system.z };
  if (dot3(sub3(cameraPos, star), N) < 0) {
    N = scale3(N, -1);
  }

  let ex = cross3(WORLD_UP, N);
  if (length3(ex) < 1e-6) ex = cross3({ x: 1, y: 0, z: 0 }, N);
  ex = normalize3(ex);
  const ez = normalize3(cross3(N, ex));
  // Re-orthogonalize ex in the plane (match prior handedness)
  ex = normalize3(cross3(ez, N));

  return { ex, ey: N, ez };
}

export { DAY, TWO_PI };
