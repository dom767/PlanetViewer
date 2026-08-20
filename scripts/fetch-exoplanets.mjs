/**
 * Fetch NASA Exoplanet Archive PSCompPars via TAP and write data/exoplanets.json.
 *
 * Usage: node scripts/fetch-exoplanets.mjs
 */

import { importExoplanets } from "./catalog-import/run.mjs";

await importExoplanets();
