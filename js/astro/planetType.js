/**
 * NASA catalog-style planet classes: size (or mass), plus a hot-Jupiter tint
 * for close-in gas giants. Not measured surface colour.
 *
 * Radius bins follow the Archive's count tables:
 *   ≤1.25 R⊕ terrestrial, ≤2 super-Earth, ≤6 Neptune-like, else gas giant.
 */

const RJUP_TO_REARTH = 11.209;

/** Close-in gas giant: typical hot-Jupiter cut (a ≲ 0.1 AU or P ≲ 10 d). */
const HOT_JUPITER_AU = 0.1;
const HOT_JUPITER_DAYS = 10;

/** @typedef {'terrestrial'|'superEarth'|'neptune'|'gasGiant'|'hotJupiter'|'unknown'} PlanetType */

/** RGB 0–1, lit by the planet shader. */
export const PLANET_TYPE_COLORS = {
  terrestrial: [0.66, 0.58, 0.50],
  superEarth: [0.78, 0.50, 0.32],
  neptune: [0.38, 0.68, 0.88],
  gasGiant: [0.88, 0.64, 0.38],
  hotJupiter: [0.32, 0.36, 0.72],
  unknown: [0.55, 0.55, 0.58],
};

export const PLANET_TYPE_LABELS = {
  terrestrial: "Terrestrial",
  superEarth: "Super-Earth",
  neptune: "Neptune-like",
  gasGiant: "Gas giant",
  hotJupiter: "Hot Jupiter",
  unknown: "Unknown type",
};

/**
 * @param {{ radiusEarth?: number|null, radiusJupiter?: number|null }} planet
 * @returns {number|null}
 */
export function planetRadiusEarth(planet) {
  if (planet.radiusEarth != null && planet.radiusEarth > 0) return planet.radiusEarth;
  if (planet.radiusJupiter != null && planet.radiusJupiter > 0) {
    return planet.radiusJupiter * RJUP_TO_REARTH;
  }
  return null;
}

/**
 * @param {{ massEarth?: number|null }} planet
 * @returns {number|null}
 */
function planetMassEarth(planet) {
  if (planet.massEarth != null && planet.massEarth > 0) return planet.massEarth;
  return null;
}

/**
 * @param {object} planet
 * @returns {PlanetType}
 */
export function classifyPlanet(planet) {
  const r = planetRadiusEarth(planet);
  if (r != null) {
    if (r <= 1.25) return "terrestrial";
    if (r <= 2) return "superEarth";
    if (r <= 6) return "neptune";
    return isHotJupiterOrbit(planet) ? "hotJupiter" : "gasGiant";
  }

  const m = planetMassEarth(planet);
  if (m != null) {
    if (m <= 2) return "terrestrial";
    if (m <= 10) return "superEarth";
    if (m <= 50) return "neptune";
    return isHotJupiterOrbit(planet) ? "hotJupiter" : "gasGiant";
  }

  return "unknown";
}

function isHotJupiterOrbit(planet) {
  const a = planet.a;
  if (a != null && a > 0 && a <= HOT_JUPITER_AU) return true;
  const p = planet.periodDays;
  if (p != null && p > 0 && p <= HOT_JUPITER_DAYS) return true;
  return false;
}

/**
 * @param {object} planet
 * @returns {{ type: PlanetType, color: [number, number, number], label: string }}
 */
export function planetAppearance(planet) {
  const type = classifyPlanet(planet);
  return {
    type,
    color: [...PLANET_TYPE_COLORS[type]],
    label: PLANET_TYPE_LABELS[type],
  };
}

/**
 * Colour exoplanets by NASA size class. Sol keeps its named planet colours.
 * @param {object} system
 */
export function applyPlanetColors(system) {
  for (const p of system.planets || []) {
    const look = planetAppearance(p);
    p.planetType = look.type;
    p.planetTypeLabel = look.label;
    if (!system.isSol) p.color = look.color;
  }
  return system;
}
