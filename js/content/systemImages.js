/**
 * Telescope stills for catalog hosts. Map is filled at startup from
 * data/system-images.json (see loadSystemImages / fetch-system-images.mjs).
 *
 * @typedef {{ src: string, alt: string, credit: string, sourceUrl: string, license: string }} SystemImage
 */

/** @type {Record<string, SystemImage>} */
let images = {};

/** @param {Record<string, SystemImage>|null|undefined} map */
export function setSystemImages(map) {
  images = map && typeof map === "object" ? map : {};
}

/**
 * @param {string} name
 * @returns {SystemImage|null}
 */
export function getSystemImage(name) {
  return images[name] ?? null;
}
