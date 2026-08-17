/**
 * Centralized host-name alias expansion for image-source matching.
 */

import { constellationGenitive, pressLabel } from "./star-label.mjs";

/** @typedef {{ prefix: string, raKey: string, decKey: string, decSign: number }} CoordDesignation */

const COORD_PREFIX_RE =
  /^(VHS|WISEP?|CWISEP?|2MASS|2M|ULAS|SDSS|SOHO|TYC|Oph|Cha|USco|CT|ISO|CFHTWIR)\s+/i;

const ASSOCIATION_COORD_IN_TEXT_RE =
  /\b(Oph|Cha|USco|CT|ISO|CFHTWIR)\s+(\d{6})[\d.-]*([+\-−–—])(\d{4,6})/gi;

function normalizeDash(s) {
  return String(s)
    .replace(/\u2212/g, "-")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/−/g, "-");
}

function normalizeCoordPrefix(raw) {
  let p = String(raw).toLowerCase();
  if (p === "2m") return "2mass";
  if (p === "wisep" || p.startsWith("cwise")) return "wise";
  if (p === "cfhtwir") return "cfhtwir";
  return p;
}

const GENITIVE_TO_ABBREV = buildGenitiveToAbbrevMap();

function buildGenitiveToAbbrevMap() {
  const map = new Map();
  for (const abbrev of [
    "and", "ant", "aps", "aql", "aqr", "ara", "ari", "aur", "boo", "cae", "cam", "cap", "car",
    "cas", "cen", "cep", "cet", "cha", "cir", "cma", "cmi", "cnc", "col", "com", "cra", "crb",
    "crt", "crv", "cru", "cvn", "cyg", "del", "dor", "dra", "equ", "eri", "for", "gem", "gru",
    "her", "hor", "hya", "hyi", "ind", "lac", "leo", "lep", "lib", "lmi", "lup", "lyn", "lyr",
    "men", "mic", "mon", "mus", "nor", "oct", "oph", "ori", "pav", "peg", "per", "phe", "pic",
    "psa", "psc", "pup", "pyx", "ret", "sge", "sgr", "sco", "scl", "sct", "ser", "sex", "tau",
    "tel", "tra", "tri", "tuc", "uma", "umi", "vel", "vir", "vol", "vul",
  ]) {
    const gen = constellationGenitive(abbrev);
    if (gen) map.set(gen.toLowerCase(), abbrev);
  }
  return map;
}

function abbrevFromGenitive(word) {
  return GENITIVE_TO_ABBREV.get(String(word).toLowerCase()) || null;
}

function formatAbbrev(abbrev) {
  const key = String(abbrev).toLowerCase();
  if (key.length <= 3) return key.charAt(0).toUpperCase() + key.slice(1);
  return key.toUpperCase();
}

/** @returns {string[]} */
export function associationSerialAliases(name) {
  const raw = String(name).trim();
  const out = [];

  const serial = raw.match(/^([A-Za-z]{2,4})\s+(\d+)$/);
  if (serial) {
    const gen = constellationGenitive(serial[1]);
    if (gen) out.push(`${gen} ${serial[2]}`);
  }

  const genitive = raw.match(/^([A-Za-z]+)\s+(\d+)$/);
  if (genitive) {
    const abbrev = abbrevFromGenitive(genitive[1]);
    if (abbrev) out.push(`${formatAbbrev(abbrev)} ${genitive[2]}`);
  }

  return out;
}

/**
 * Parse survey- and association-style coordinate designations.
 * e.g. VHS J125601.92-125723.9, Oph 162225-240515, Oph 1622-2405
 * @returns {CoordDesignation|null}
 */
export function parseCoordinateDesignation(raw) {
  let s = normalizeDash(raw).trim();
  const prefixMatch = s.match(COORD_PREFIX_RE);
  const prefix = prefixMatch ? normalizeCoordPrefix(prefixMatch[1]) : "";
  if (prefixMatch) s = s.slice(prefixMatch[0].length).trim();
  s = s.replace(/^J(?=\d)/i, "");

  let m = s.match(/^(\d{4})\s*([+\-])\s*(\d{4})/);
  if (m) {
    return {
      prefix: prefix || "coord",
      raKey: m[1],
      decKey: m[3],
      decSign: m[2] === "-" ? -1 : 1,
    };
  }

  m = s.match(/^(\d{2})(\d{2})(\d{2})[\d.]*([+\-])(\d{1,2})(\d{2})[\d.]*/);
  if (m) {
    return {
      prefix: prefix || "coord",
      raKey: m[1] + m[2],
      decKey: String(m[5]).padStart(2, "0") + m[6],
      decSign: m[4] === "-" ? -1 : 1,
    };
  }

  m = s.match(/^(\d{2})(\d{2})(\d{2})[\d.]*([+\-])(\d{2})(\d{2})(\d{2})[\d.]*/);
  if (m) {
    return {
      prefix: prefix || "coord",
      raKey: m[1] + m[2],
      decKey: m[5] + m[6],
      decSign: m[4] === "-" ? -1 : 1,
    };
  }

  m = s.match(/^(\d{4})[\d.-]*([+\-])(\d{4})/);
  if (m && prefix) {
    return {
      prefix,
      raKey: m[1],
      decKey: m[3],
      decSign: m[2] === "-" ? -1 : 1,
    };
  }

  m = s.match(/^(\d{4})$/);
  if (m && prefix) {
    return {
      prefix,
      raKey: m[1],
      decKey: "",
      decSign: 1,
    };
  }

  return null;
}

function coordFingerprint(c) {
  return `${c.prefix}:${c.raKey}:${c.decKey}`;
}

/** @returns {Set<string>} */
export function coordinateKeys(raw) {
  const keys = new Set();
  const parsed = parseCoordinateDesignation(raw);
  if (parsed) keys.add(coordFingerprint(parsed));
  return keys;
}

export function coordinateKeysMatch(a, b) {
  const ka = coordinateKeys(a);
  const kb = coordinateKeys(b);
  if (!ka.size || !kb.size) return false;
  for (const x of ka) {
    if (kb.has(x)) return true;
  }
  return false;
}

function prefixLabel(prefix) {
  if (!prefix || prefix === "coord") return "";
  if (prefix === "2mass") return "2MASS";
  if (prefix === "wise") return "WISE";
  if (prefix === "cfhtwir") return "CFHTWIR";
  if (prefix === "usco") return "USco";
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

/** Human-readable coordinate aliases for search and metadata matching. */
export function coordinateSearchAliases(raw) {
  const parsed = parseCoordinateDesignation(raw);
  if (!parsed) return [];
  const label = prefixLabel(parsed.prefix);
  const sign = parsed.decSign < 0 ? "-" : "+";
  const ra = parsed.raKey;
  const dec = parsed.decKey;
  const withPrefix = (body) => (label ? `${label} ${body}` : body);
  const aliases = [
    withPrefix(`J${ra}${sign}${dec}`),
    withPrefix(`${ra}${sign}${dec}`),
    withPrefix(`J${ra}-${dec}`),
    withPrefix(`${ra}-${dec}`),
  ];
  if (label && ra && /^(Oph|Cha|USco|CT|ISO|CFHTWIR)$/i.test(label)) {
    aliases.push(withPrefix(ra));
    if (dec) aliases.push(withPrefix(`${ra}-${dec}`));
  }
  return [...new Set(aliases.filter(Boolean))];
}

function coordinateSubstringsInText(text) {
  const found = [];
  const blob = normalizeDash(String(text || ""));
  let m;
  ASSOCIATION_COORD_IN_TEXT_RE.lastIndex = 0;
  while ((m = ASSOCIATION_COORD_IN_TEXT_RE.exec(blob))) {
    found.push(`${m[1]} ${m[2]}${m[3]}${m[4]}`);
  }
  return found;
}

/**
 * All alternate host names useful for image-source search and verification.
 * @param {string} name
 * @returns {string[]}
 */
export function expandHostAliases(name) {
  const raw = String(name).trim();
  if (!raw) return [];

  const terms = new Set([raw]);
  const pressed = pressLabel(raw);
  if (pressed !== raw) terms.add(pressed);

  for (const alias of associationSerialAliases(raw)) {
    terms.add(alias);
    const aliasPressed = pressLabel(alias);
    if (aliasPressed !== alias) terms.add(aliasPressed);
  }

  for (const alias of coordinateSearchAliases(raw)) {
    terms.add(alias);
  }

  const stripped = raw.replace(/\s+(A|B|AB|C)$/i, "").trim();
  if (stripped !== raw && stripped.length >= 3) {
    terms.add(stripped);
    terms.add(pressLabel(stripped));
    for (const alias of associationSerialAliases(stripped)) terms.add(alias);
    for (const alias of coordinateSearchAliases(stripped)) terms.add(alias);
  }

  return [...terms].filter((t) => String(t).trim().length >= 3);
}

function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/[\s._-]+/g, "")
    .replace(/[^\w+]/g, "");
}

function matchHostToStarCore(host, star) {
  const h = norm(host);
  const s = norm(star);
  if (!h || !s) return false;
  if (h === s || h.includes(s) || s.includes(h)) return true;
  const hs = h.replace(/a$/, "");
  if (hs === s || s.includes(hs) || hs.includes(s)) return true;
  if (coordinateKeysMatch(host, star)) return true;
  const gscHost = h.match(/^gsc0*(\d+0*)/);
  const gscStar = s.match(/^gsc0*(\d+0*)/);
  if (gscHost && gscStar && gscHost[1] === gscStar[1]) return true;
  return false;
}

/** Match two host labels using all expanded alias forms. */
export function matchHostToStar(host, star) {
  if (!host || !star) return false;
  const left = expandHostAliases(host);
  const right = [String(star).trim(), ...expandHostAliases(star)];
  for (const h of left) {
    for (const s of right) {
      if (matchHostToStarCore(h, s)) return true;
    }
  }
  return false;
}

function mentionsHostCore(text, name) {
  if (!text) return false;
  const h = text.toLowerCase();
  const n = String(name).toLowerCase().trim();
  if (h.includes(n)) return true;
  const compact = n.replace(/[\s._-]+/g, "");
  const hCompact = h.replace(/[\s._-]+/g, "");
  if (compact.length >= 5 && hCompact.includes(compact)) return true;
  if (coordinateKeysMatch(text, name)) return true;
  for (const fragment of coordinateSubstringsInText(text)) {
    if (coordinateKeysMatch(fragment, name)) return true;
    if (matchHostToStarCore(fragment, name)) return true;
  }
  return false;
}

export function mentionsHost(text, name) {
  return expandHostAliases(name).some((alias) => mentionsHostCore(text, alias));
}

export function mentionsHostInFields(fields, name, aliases = []) {
  const names = [...new Set([name, ...aliases])];
  const blob = fields.filter(Boolean).join(" \n ");
  if (names.some((n) => mentionsHost(blob, n))) return true;
  for (const field of fields) {
    if (!field) continue;
    for (const n of names) {
      if (matchHostToStar(n, field)) return true;
    }
  }
  return false;
}

function matchPlanetToFile(planetOrAlias, file) {
  if (coordinateKeysMatch(planetOrAlias, file)) return true;
  const p = norm(planetOrAlias);
  const f = norm(String(file).replace(/^File:/i, "").replace(/\.[^.]+$/, ""));
  if (!p || !f || p.length < 4) return false;
  return f.includes(p) || p.includes(f);
}

export function matchHostToFile(name, file, aliases = []) {
  const names = [...new Set([name, ...aliases])];
  return names.some((n) => matchPlanetToFile(n, file) || matchHostToStar(n, file));
}
