/**
 * Curated blurbs for notable hosts (NASA names, plus a few injected landmarks).
 * Keys must match system.name exactly.
 * Tour order lives in tours.js — this file is copy only.
 *
 * To add a fact: look up the host in Search, then add an entry here.
 * Optional `tours[tourId]` overrides `text` while that guided tour is active.
 *
 * @typedef {{ text: string, tours?: Record<string, string> }} StarNote
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
    tours: {
      goldilocks:
        "TRAPPIST-1 e is this system's best Earth analog: about 0.92 Earth radii and 0.69 Earth masses, with ~0.65× Earth's sunlight. Several siblings sit in or near the Goldilocks zone too.",
    },
  },
  "Proxima Cen": {
    text: "Humanity’s nearest stellar neighbour, and the alien home system in The Three-Body Problem.",
    tours: {
      goldilocks:
        "Proxima b is the closest known exoplanet: ~1.02 Earth radii and ~1.05 Earth masses, with about 0.6× Earth's sunlight. It sits on the cool edge of the habitable zone around our nearest star.",
    },
  },
  "KOI-351": {
    text: "Kepler-90 (KOI-351), the extrasolar system with the most confirmed planets in this catalog: eight worlds, matching Sol, packed inside about one Earth’s orbit.",
  },
  "Kepler-186": {
    text: "Host of Kepler-186f, among the first Earth-sized planets found in a star's habitable zone.",
    tours: {
      goldilocks:
        "Kepler-186 f was among the first Earth-sized planets found in a habitable zone (~1.17 Earth radii). It gets only ~0.22× Earth's sunlight, so it is a cooler, longer-year cousin rather than a twin.",
    },
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
    tours: {
      binaries:
        "Kepler-16: a K dwarf and a much fainter M companion, 0.22 AU apart (41-day binary). Planet b orbits both suns every 229 days — the first transiting circumbinary world.",
    },
  },
  "Kepler-47": {
    text: "A close G+M binary with three circumbinary planets — the first known multi-planet system around two suns.",
    tours: {
      binaries:
        "Kepler-47: the tightest pair on this tour (0.08 AU, 7.4 days) and three planets around both stars. The inner world would see suns that swap places in a week.",
    },
  },
  "Kepler-38": {
    text: "A G-type primary and an M-dwarf companion with a circumbinary Neptune-sized planet.",
    tours: {
      binaries:
        "Kepler-38: a G star with a dim M companion at 0.15 AU. The planet sits outside both suns; the secondary is the faint red spark next to the primary.",
    },
  },
  "Kepler-413": {
    text: "A K+M eclipsing binary whose circumbinary planet's orbit precesses rapidly, so transits come and go.",
    tours: {
      binaries:
        "Kepler-413: K and M stars 0.10 AU apart. The planet's orbit tilts and precesses in about a decade, so transits vanish for years, then return.",
    },
  },
  "Kepler-453": {
    text: "A G+M binary with a circumbinary planet near the habitable zone of the pair.",
    tours: {
      binaries:
        "Kepler-453: a Sun-like star and a small M dwarf, 0.19 AU apart. Planet b's year is long enough to sit near the binary's habitable zone.",
    },
  },
  "Kepler-35": {
    text: "Two similar G stars with a Saturn-sized world on a circumbinary orbit.",
    tours: {
      binaries:
        "Kepler-35: two G stars of nearly equal mass, 0.18 AU apart. Unlike Kepler-16, both suns should look comparably bright.",
    },
  },
  "Kepler-34": {
    text: "Twin G stars on a highly eccentric 28-day orbit, with a circumbinary Saturn analog.",
    tours: {
      binaries:
        "Kepler-34: two G stars on a very eccentric orbit (e ≈ 0.52). Watch the pair's separation breathe in and out over the 28-day binary period.",
    },
  },
  "Kepler-1647": {
    text: "An F+G binary whose circumbinary planet has a three-year orbit — among the longest of the Kepler two-sun worlds.",
    tours: {
      binaries:
        "Kepler-1647: an F star with a G companion, 0.13 AU apart. Planet b takes about three Earth years to circle both suns, far outside the pair.",
    },
  },
  "TOI-1338 A": {
    text: "TESS's first transiting circumbinary planet: an F8 primary, an M dwarf, and a Saturn-sized world around both.",
    tours: {
      binaries:
        "TOI-1338: the first TESS circumbinary system. An F8 star and an M companion (0.13 AU, 15 days) with a Saturn-sized planet around both.",
    },
  },
  "TIC 172900988 Aa": {
    text: "Two similar F/G stars on an eccentric 20-day orbit, with a circumbinary giant found by TESS.",
    tours: {
      binaries:
        "TIC 172900988: two nearly twin F/G stars, eccentric like Kepler-34 (e ≈ 0.45). A good check that equal-mass suns read as two map-star glows.",
    },
  },
  "gam Cep": {
    text: "Gamma Cephei: a nearby orange giant with an M-dwarf companion, and a gas giant that orbits only the bright star.",
    tours: {
      binaries:
        "Gamma Cephei switches the architecture: planet b circles the K giant alone, with an M dwarf as the second sun. One of the first S-type planets — a world with two suns that does not orbit both.",
    },
  },
  "DMPP-3 A": {
    text: "A K dwarf with a close-in planet and a faint L-dwarf companion just over 1 AU away — the planet orbits only the K star.",
    tours: {
      binaries:
        "DMPP-3: the planet hugs the K star at 0.06 AU while an L-dwarf companion orbits at 1.22 AU. Watch the planet stay with the bright star; it never circles both.",
    },
  },
  "HIP 90988": {
    text: "A K giant with a gas giant at 1.4 AU and a low-mass stellar companion at 7.5 AU — the planet's orbit is a large fraction of the binary's.",
    tours: {
      binaries:
        "HIP 90988: planet b at 1.4 AU around the K giant, companion star at 7.5 AU. The planetary orbit is ~18% of the binary's — among the tightest S-type ratios on this tour.",
    },
  },
  "TOI-1736": {
    text: "Two planets around a Sun-like star whose binary companion sits about 8 AU out.",
    tours: {
      binaries:
        "TOI-1736: two planets orbit the primary only — a hot inner world and a giant at 1.4 AU — while the second star sits at 8 AU. A compact planetary system inside a wider pair.",
    },
  },
  "TOI-2267 A": {
    text: "A nearby pair of M dwarfs with two transiting planets around the primary only.",
    tours: {
      binaries:
        "TOI-2267: two faint M dwarfs, extremely close. Both transiting planets stay with star A. Two red suns, but the worlds still have a single host.",
    },
  },
  "HD 110067": {
    text: "A K dwarf with six sub-Neptunes locked in a resonant chain, and a near-equal companion star only ~4.7 AU away.",
    tours: {
      binaries:
        "HD 110067: six planets orbit the K star alone, packed inside 0.26 AU, while a second star of similar mass sits at 4.7 AU. A whole compact system that never circles both suns.",
    },
  },
  "LHS 1678": {
    text: "A nearby M dwarf with three small planets and a stellar companion well inside 1 AU.",
    tours: {
      binaries:
        "LHS 1678: three rocky worlds hug the M dwarf (the innermost year is under a day) while the second star sits at 0.73 AU. Watch the planets stay with A; they never orbit both.",
    },
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
  "2MASS J12073346-3932539": {
    text: "2M1207, home to the first exoplanet ever photographed (2004): a giant world orbiting a brown dwarf, seen directly instead of inferred from a wobble or a transit.",
  },
  "AF Lep": {
    text: "AF Leporis b, a nearby Jupiter analog on a roughly 9 AU orbit, imaged in 2023 — one of the closest twins yet to a solar-system giant caught on camera.",
  },
  "VHS J125601.92-125723.9": {
    text: "VHS 1256 b, a nearby imaged giant that JWST has studied in detail: a cloudy, variable atmosphere only about 13 parsecs from Sol.",
  },
  "HD 106906": {
    text: "HD 106906 b sits on a vast ~650 AU orbit, photographed by Hubble and GPI far outside its star’s debris disk.",
  },
  "kap And": {
    text: "Kappa Andromedae b, a classic directly imaged giant from 2013, a massive companion seen in infrared light about 50 parsecs away.",
  },
  "HD 95086": {
    text: "HD 95086 b, a textbook GPI/SPHERE imaged planet: a young giant in a dusty disk, photographed well outside its star.",
  },
  "Teegarden's Star": {
    text: "Teegarden's Star b is among the closest Earth twins here: about 1.05 Earth radii and 1.16 Earth masses, with roughly Earth's sunlight on a 5-day orbit around this tiny red dwarf.",
  },
  "TOI-700": {
    text: "TOI-700 d is an Earth-sized world (~1.07 Earth radii) in the habitable zone; inner neighbour e (~0.95 Earth radii) is a bit warmer. Both match Earth closely in size and sunlight.",
  },
  "Kepler-1649": {
    text: "Kepler-1649 c is about 1.06 Earth radii and 1.2 Earth masses, with ~1.2× Earth's sunlight — one of Kepler's closest rocky habitable-zone matches.",
  },
  "GJ 1002": {
    text: "GJ 1002 b is essentially Earth-sized (~1.03 Earth radii, ~1.08 Earth masses) around a nearby red dwarf, with about two-thirds Earth's sunlight — a slightly cooler cousin.",
  },
  "Ross 128": {
    text: "Ross 128 b is a nearby Earth-sized world (~1.11 Earth radii, ~1.4 Earth masses) around a quiet red dwarf, receiving about 1.5× Earth's sunlight — a little warmer, but similar in bulk.",
  },
  "Kepler-452": {
    text: "Kepler-452 b orbits a Sun-like star with a ~385-day year and Earth-like sunlight, but it is larger (~1.6 Earth radii) — a super-Earth on an Earth-like orbit, not a true twin.",
  },
};

/**
 * @param {string} name
 * @param {string|null|undefined} [tourId]
 * @returns {StarNote|null}
 */
export function getStarNote(name, tourId) {
  const note = STAR_NOTES[name];
  if (!note) return null;
  const tourText = tourId ? note.tours?.[tourId] : null;
  const text = tourText || note.text;
  return text ? { text } : null;
}
