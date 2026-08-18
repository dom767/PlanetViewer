/**
 * Guided tours: ordered NASA hostnames (`system.name`).
 * Notes live in starNotes.js; this file is playlist + picker copy only.
 *
 * @typedef {{ id: string, title: string, blurb: string, stops: string[] }} Tour
 */

export const FREE_FLIGHT_ID = "freeflight";

export const FREE_FLIGHT = {
  id: FREE_FLIGHT_ID,
  title: "Free flight",
  blurb: "Wander the catalogue with no guided route. Pick a tour later anytime.",
};

/** @type {Tour[]} */
export const TOURS = [
  {
    id: "scifi",
    title: "Science fiction",
    blurb: "Real stars behind famous stories — Vulcan, LV-426, Reach, and more.",
    stops: [
      "40 Eri A",
      "zet 2 Ret",
      "tau Cet",
      "Proxima Cen",
      "eps Eri",
      "Barnard's star",
      "GJ 581",
      "HD 69830",
      "Kepler-22",
      "Kepler-16",
      "47 UMa",
    ],
  },
  {
    id: "imaged",
    title: "Directly imaged",
    blurb: "Worlds caught on camera — disks, forming planets, and photographed giants.",
    stops: [
      "2MASS J12073346-3932539",
      "HR 8799",
      "bet Pic",
      "PDS 70",
      "51 Eri",
      "HIP 65426",
      "AB Aur",
      "HD 100546",
      "TYC 8998-760-1",
      "GJ 504",
      "GQ Lup",
      "AF Lep",
      "VHS J125601.92-125723.9",
      "HD 106906",
      "kap And",
      "HD 95086",
    ],
  },
  {
    id: "standout",
    title: "Record holders",
    blurb: "Firsts and extremes: most planets, smallest, largest, farthest, fastest.",
    stops: [
      "Sol",
      "KOI-351",
      "TRAPPIST-1",
      "PSR B1257+12",
      "51 Peg",
      "HD 209458",
      "Kepler-186",
      "Kepler-37",
      "HD 100546",
      "SWEEPS-11",
      "PSR J1719-1438",
      "COCONUTS-2 A",
    ],
  },
  {
    id: "goldilocks",
    title: "Goldilocks",
    blurb: "Worlds closest to Earth in size, mass, and sunlight — and why they made the cut.",
    stops: [
      "Teegarden's Star",
      "TOI-700",
      "Kepler-1649",
      "GJ 1002",
      "Proxima Cen",
      "TRAPPIST-1",
      "Ross 128",
      "Kepler-186",
      "Kepler-452",
    ],
  },
];

/**
 * @param {string|null|undefined} id
 * @returns {Tour|null}
 */
export function getTour(id) {
  if (!id) return null;
  return TOURS.find((t) => t.id === id) ?? null;
}

/** Hostnames that appear on any tour. */
export function allTourStopNames() {
  const names = new Set();
  for (const tour of TOURS) {
    for (const name of tour.stops) names.add(name);
  }
  return names;
}
