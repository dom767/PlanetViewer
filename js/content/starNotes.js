/**
 * Curated blurbs for notable hosts (NASA names, plus a few injected landmarks).
 * Keys must match system.name exactly.
 *
 * To add a fact: look up the host in Search, then add an entry here.
 *
 * @typedef {{ text: string }} StarNote
 * @type {Record<string, StarNote>}
 */
export const STAR_NOTES = {
  "Sol": {
    text: "Origin — Earth's solar system.",
  },
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
    text: "Our nearest stellar neighbour, and host to the closest known exoplanet. It's the faint third star of Alpha Centauri — the real triple system behind Avatar's Pandora and The Three-Body Problem's Trisolaris.",
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
  "tau Cet": {
    text: "A nearby Sun-like star with several super-Earths — and the destination of Project Hail Mary. In the story, Tau Ceti is where Grace meets Rocky and hunts a cure for astrophage.",
  },
  "eps Eri": {
    text: "One of the nearest Sun-like stars with a confirmed Jupiter analog (eps Eri b). Babylon 5 is set here, orbiting the fictional world Epsilon III.",
  },
  "Kepler-22": {
    text: "Host of Kepler-22 b, the first Kepler planet found in a habitable zone — and the colony world in Ridley Scott's Raised by Wolves.",
  },
  "40 Eri A": {
    text: "Rocky’s home star in Project Hail Mary, and Vulcan in Star Trek. No exoplanet is confirmed — a 2018 candidate was stellar activity, not a world.",
  },
  "zet 2 Ret": {
    text: "Zeta 2 Reticuli, the real star behind Alien’s LV-426. There are no confirmed exoplanets here; the xenomorph moon is fiction.",
  },
};

/**
 * @param {string} name
 * @returns {StarNote|null}
 */
export function getStarNote(name) {
  return STAR_NOTES[name] ?? null;
}
