/**
 * Curated telescope images of planetary systems (where a public photo exists).
 * Keys must match system.name exactly.
 *
 * Images are local 300×300 crops. Credit must stay visible (ESO CC BY 4.0).
 *
 * @typedef {{ src: string, alt: string, credit: string, sourceUrl: string, license: string }} SystemImage
 * @type {Record<string, SystemImage>}
 */
export const SYSTEM_IMAGES = {
  "PDS 70": {
    src: "images/systems/pds-70.jpg",
    alt: "SPHERE / VLT image of PDS 70: a protoplanetary disk with planet b as a bright point to the right of the coronagraph",
    credit: "ESO/A. Müller et al.",
    sourceUrl: "https://www.eso.org/public/images/eso1821a/",
    license: "CC BY 4.0",
  },
};

/**
 * @param {string} name
 * @returns {SystemImage|null}
 */
export function getSystemImage(name) {
  return SYSTEM_IMAGES[name] ?? null;
}
