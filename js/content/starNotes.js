/**
 * Curated blurbs for notable hosts (NASA names, plus a few injected landmarks).
 * Keys must match system.name exactly.
 * Tour order lives in tours.js — this file is copy only.
 *
 * To add a fact: look up the host in Search, then add an entry here.
 *
 * @typedef {{ text: string }} StarNote
 * @type {Record<string, StarNote>}
 */
export const STAR_NOTES = {
  "Sol": {
    text: "Sol, our home star. Eight planets, with Earth and Mars in the Goldilocks zone.",
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
    text: "Humanity’s nearest stellar neighbour, and the alien home system in The Three-Body Problem.",
  },
  "KOI-351": {
    text: "Kepler-90 (KOI-351), the extrasolar system with the most confirmed planets in this catalog: eight worlds, matching Sol, packed inside about one Earth’s orbit.",
  },
  "Kepler-186": {
    text: "Host of Kepler-186f, among the first Earth-sized planets found in a star's habitable zone.",
  },
  "HD 100546": {
    text: "Home to HD 100546 b, the largest planet in this catalog, a bloated young giant about seven times Jupiter's radius, still gathering gas from its star's disk.",
  },
  "Kepler-37": {
    text: "Host of Kepler-37 b, the smallest known exoplanet, a rocky world only a little larger than the Moon.",
  },
  "SWEEPS-11": {
    text: "Host of one of the most distant known transiting exoplanets: a hot Jupiter in the Galactic bulge, about 8,500 parsecs from Sol.",
  },
  "PSR J1719-1438": {
    text: "This millisecond pulsar has the shortest known planetary year, its companion races around in just over two hours, and may be a stripped, carbon-rich remnant.",
  },
  "COCONUTS-2 A": {
    text: "Home to COCONUTS-2 b, a Jupiter-sized world on a vast orbit: a single year here lasts around a million Earth years.",
  },
  "tau Cet": {
    text: "A nearby Sun-like star with several super-Earths, and a science-fiction favourite: Project Hail Mary, Barbarella, and Kim Stanley Robinson’s Aurora all send stories here.",
  },
  "eps Eri": {
    text: "Home to Reach in Halo, and the Babylon 5 station orbiting the fictional world Epsilon III. In our sky it is one of the nearest Sun-like stars with a confirmed Jupiter analog.",
  },
  "Kepler-22": {
    text: "Host of Kepler-22 b, the first Kepler planet found in a habitable zone — and humanity’s new home in Ridley Scott’s Raised by Wolves.",
  },
  "40 Eri A": {
    text: "Vulcan in Star Trek, and Erid, home of Rocky in Project Hail Mary. No exoplanet is confirmed; a 2018 candidate was stellar activity, not a world.",
  },
  "zet 2 Ret": {
    text: "Zeta Reticuli, the Alien system: LV-426 and LV-223, settings for Alien, Aliens, and Prometheus. There are no confirmed exoplanets here.",
  },
  "Barnard's star": {
    text: "Destination of humanity’s first interstellar expedition in Robert L. Forward’s Rocheworld. A nearby red dwarf, now with four known planets.",
  },
  "GJ 581": {
    text: "A real multi-planet red dwarf, and the system humanity signals in the alien-invasion film Battleship.",
  },
  "HD 69830": {
    text: "In Halo, real exoplanet HD 69830 d is orbited by Eayn, homeworld of the Kig-Yar. The star actually hosts a compact system of Neptune-mass worlds and a debris disk.",
  },
  "47 UMa": {
    text: "Setting for Allen Steele’s Coyote, where colonists settle a habitable moon of a giant planet. 47 Ursae Majoris is a nearby Sun-like star with several confirmed giants.",
  },
  "Kepler-16": {
    text: "A binary star with a circumbinary planet, Kepler-16b: a real Tatooine-style world that orbits both suns.",
  },
  "HR 8799": {
    text: "The first system with multiple planets photographed directly: four giant worlds, imaged over years as they moved around their young star.",
  },
  "bet Pic": {
    text: "Beta Pictoris, a young star with a dusty debris disk and a giant planet, bet Pic b, one of the first worlds seen in a photograph.",
  },
  "PDS 70": {
    text: "A still-forming planetary system: two gas giants sit in a gap in the disk, with PDS 70 b even showing signs of its own circumplanetary disk.",
  },
  "51 Eri": {
    text: "51 Eridani b, a young Jupiter analog imaged by Gemini — one of the closest twins to our own giant planets yet photographed.",
  },
  "HIP 65426": {
    text: "HIP 65426 b was among the first exoplanets imaged by JWST, a young giant already seen in infrared light far from its star.",
  },
  "AB Aur": {
    text: "AB Aurigae, a young star whose swirling disk has revealed a forming protoplanet, AB Aur b, still gathering material.",
  },
  "TYC 8998-760-1": {
    text: "A young Sun-like star with two giant planets photographed by ESO's SPHERE, one of the rare multi-planet images.",
  },
  "GJ 504": {
    text: "GJ 504 b, a massive companion imaged in the near-infrared — a pinkish giant several times Jupiter's mass.",
  },
  "GQ Lup": {
    text: "GQ Lupi b, one of the first imaged planetary-mass companions, a young world still glowing from its formation.",
  },
};

/**
 * @param {string} name
 * @returns {StarNote|null}
 */
export function getStarNote(name) {
  return STAR_NOTES[name] ?? null;
}
