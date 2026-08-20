/**
 * Fetch Gaia DR3 stars within 30 pc and write data/nearby-stars.json.
 *
 * Usage: node scripts/fetch-nearby-stars.mjs
 */

import { importNearbyStars } from "./catalog-import/run.mjs";

await importNearbyStars();
