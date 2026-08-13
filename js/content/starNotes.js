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
  "HD 100546": {
    text: "Home to HD 100546 b, the largest planet in this catalog — a bloated young giant about seven times Jupiter's radius, still gathering gas from its star's disk.",
  },
  "Kepler-37": {
    text: "Host of Kepler-37 b, the smallest known exoplanet — a rocky world only a little larger than the Moon.",
  },
  "SWEEPS-11": {
    text: "Host of one of the most distant known transiting exoplanets: a hot Jupiter in the Galactic bulge, about 8,500 parsecs from Sol.",
  },
  "PSR J1719-1438": {
    text: "This millisecond pulsar has the shortest known planetary year — its companion races around in just over two hours, and may be a stripped, carbon-rich remnant.",
  },
  "COCONUTS-2 A": {
    text: "Home to COCONUTS-2 b, a Jupiter-sized world on a vast orbit: a single year here lasts around a million Earth years.",
  },
};

/**
 * @param {string} name
 * @returns {StarNote|null}
 */
export function getStarNote(name) {
  return STAR_NOTES[name] ?? null;
}
