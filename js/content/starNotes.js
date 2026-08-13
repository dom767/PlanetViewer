/**
 * Curated blurbs for historically notable exoplanet hosts.
 * Keys must match NASA PSCompPars hostname exactly (system.name).
 *
 * To add a fact: look up the host in Search, then add an entry here.
 *
 * @typedef {{ text: string }} StarNote
 * @type {Record<string, StarNote>}
 */
export const STAR_NOTES = {
  "51 Peg": {
    text: "Host of 51 Pegasi b (1995), the first confirmed exoplanet around a Sun-like star.",
  },
  "PSR B1257+12": {
    text: "The first confirmed exoplanets were found here in 1992 — three worlds orbiting a pulsar.",
  },
  "HD 209458": {
    text: "Home to the first exoplanet seen in transit, and the first with a detected atmosphere.",
  },
  "TRAPPIST-1": {
    text: "An ultra-cool dwarf with seven Earth-sized planets, several in or near the habitable zone.",
  },
  "Proxima Cen": {
    text: "Our nearest stellar neighbour — and host to the closest known exoplanet, Proxima Centauri b.",
  },
  "Kepler-186": {
    text: "Host of Kepler-186f, among the first Earth-sized planets found in a star's habitable zone.",
  },
};

/**
 * @param {string} name
 * @returns {StarNote|null}
 */
export function getStarNote(name) {
  return STAR_NOTES[name] ?? null;
}
