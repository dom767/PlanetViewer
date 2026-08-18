/**
 * Guided tours: ordered NASA hostnames (`system.name`).
 * Notes live in starNotes.js; this file is playlist + picker copy only.
 *
 * @typedef {{ id: string, title: string, blurb: string, stops: string[] }} Tour
 */

/** @type {Tour[]} */
export const TOURS = [
  {
    id: "scifi",
    title: "Science fiction",
    blurb: "Real stars behind famous stories — Vulcan, LV-426, Pandora, and more.",
    stops: [
      "Sol",
      "Proxima Cen",
      "Barnard's star",
      "tau Cet",
      "eps Eri",
      "40 Eri A",
      "zet 2 Ret",
      "Kepler-22",
      "Kepler-16",
      "TRAPPIST-1",
    ],
  },
  {
    id: "imaged",
    title: "Directly imaged",
    blurb: "Worlds caught on camera — disks, forming planets, and photographed giants.",
    stops: [
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
    ],
  },
  {
    id: "standout",
    title: "Record holders",
    blurb: "Firsts and extremes: smallest, largest, farthest, fastest.",
    stops: [
      "Sol",
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
