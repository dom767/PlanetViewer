/**
 * Merge curated CBP orbits with ORB6, SB9, Thebault, and Gaia projected
 * separations; inline multiplicity into data/exoplanets.json.
 *
 * Usage: node scripts/fetch-close-binaries.mjs
 */

import { importBinaries } from "./catalog-import/run.mjs";

await importBinaries();
