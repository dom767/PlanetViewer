/**
 * Time helpers. Simulation time `tDays` is days since J2000.0 (JD 2451545.0).
 */

export const J2000_JD = 2451545.0;

/** Julian Date for a JS Date (UTC). */
export function dateToJulianDay(date = new Date()) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Days since J2000.0 for a JS Date. */
export function daysSinceJ2000(date = new Date()) {
  return dateToJulianDay(date) - J2000_JD;
}

/** Approximate UTC Date from days since J2000. */
export function j2000DaysToDate(tDays) {
  const jd = J2000_JD + tDays;
  return new Date((jd - 2440587.5) * 86400000);
}

export function formatUtcDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d} UTC`;
}
