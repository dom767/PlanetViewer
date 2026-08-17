/**
 * Expand NASA PSCompPars hostname abbreviations to press-style star names.
 * Used at fetch time when writing data/exoplanets.json.
 */

/** @type {Record<string, string>} */
export const OVERRIDES = {
  "51 Eri": "51 Eridani",
  "bet Pic": "Beta Pictoris",
  "kap And": "Kappa Andromedae",
  "AB Pic": "AB Pictoris",
  "HN Peg": "HN Pegasi",
  "GU Psc": "GU Piscium",
  "PZ Tel": "PZ Telescopii",
  "AF Lep": "AF Leporis",
  "b Cen A": "b Centauri A",
  "GQ Lup": "GQ Lupi",
};

/** IAU 3-letter abbreviations → Latin genitive (Bayer/Flamsteed form). */
const CONSTELLATION_GENITIVE = {
  and: "Andromedae",
  ant: "Antliae",
  aps: "Apodis",
  aql: "Aquilae",
  aqr: "Aquarii",
  ara: "Arae",
  ari: "Arietis",
  aur: "Aurigae",
  boo: "Bootis",
  cae: "Caeli",
  cam: "Camelopardalis",
  cap: "Capricorni",
  car: "Carinae",
  cas: "Cassiopeiae",
  cen: "Centauri",
  cep: "Cephei",
  cet: "Ceti",
  cha: "Chamaeleontis",
  cir: "Circini",
  cma: "Canis Majoris",
  cmi: "Canis Minoris",
  cnc: "Cancri",
  col: "Columbae",
  com: "Comae Berenices",
  cra: "Coronae Australis",
  crb: "Coronae Borealis",
  crt: "Crateris",
  crv: "Corvi",
  cru: "Crucis",
  cvn: "Canum Venaticorum",
  cyg: "Cygni",
  del: "Delphini",
  dor: "Doradus",
  dra: "Draconis",
  equ: "Equulei",
  eri: "Eridani",
  for: "Fornacis",
  gem: "Geminorum",
  gru: "Gruis",
  her: "Herculis",
  hor: "Horologii",
  hya: "Hydrae",
  hyi: "Hydri",
  ind: "Indi",
  lac: "Lacertae",
  leo: "Leonis",
  lep: "Leporis",
  lib: "Librae",
  lmi: "Leonis Minoris",
  lup: "Lupi",
  lyn: "Lyncis",
  lyr: "Lyrae",
  men: "Mensae",
  mic: "Microscopii",
  mon: "Monocerotis",
  mus: "Muscae",
  nor: "Normae",
  oct: "Octantis",
  oph: "Ophiuchi",
  ori: "Orionis",
  pav: "Pavonis",
  peg: "Pegasi",
  per: "Persei",
  phe: "Phoenicis",
  pic: "Pictoris",
  psa: "Piscis Austrini",
  psc: "Piscium",
  pup: "Puppis",
  pyx: "Pyxidis",
  ret: "Reticuli",
  sge: "Sagittae",
  sgr: "Sagittarii",
  sco: "Scorpii",
  scl: "Sculptoris",
  sct: "Scuti",
  ser: "Serpentis",
  sex: "Sextantis",
  tau: "Tauri",
  tel: "Telescopii",
  tra: "Trianguli Australis",
  tri: "Trianguli",
  tuc: "Tucanae",
  uma: "Ursae Majoris",
  umi: "Ursae Minoris",
  vel: "Velorum",
  vir: "Virginis",
  vol: "Volantis",
  vul: "Vulpeculae",
};

const GREEK_ABBREV = {
  alf: "Alpha",
  bet: "Beta",
  gam: "Gamma",
  del: "Delta",
  eps: "Epsilon",
  zet: "Zeta",
  eta: "Eta",
  tet: "Theta",
  the: "Theta",
  iot: "Iota",
  kap: "Kappa",
  lam: "Lambda",
  mu: "Mu",
  nu: "Nu",
  ksi: "Xi",
  omi: "Omicron",
  pi: "Pi",
  rho: "Rho",
  sig: "Sigma",
  tau: "Tau",
  ups: "Upsilon",
  phi: "Phi",
  chi: "Chi",
  psi: "Psi",
  omg: "Omega",
};

/** Hostnames that should not be expanded (catalog / survey / prose names). */
const CATALOG_PREFIX_RE =
  /^(HD|HIP|GJ|Gliese|Kepler|TRAPPIST|2MASS|WISE|WISER|WISep|TYC|PSR|K2|TOI|HAT|WASP|XO|CoRoT|OGLE|MOA|SWEEPS|COCONUTS|LTT|LHS|Ross|Wolf|Kapteyn|G\s|L\s|V\s|BD-|CD-|CPD|NLTT|GSC|TWO|UCAC|USNO|SCR|DENIS|2M|1RXS|CHXR|CFBDSIR|Cfbdsir|ISO|MWC|SR\s|DH\s|CT\s|HR\s|HIP\s|TWA|WASP-|HATS-|KELT-|EPIC\s|Gaia\s)/i;

const PROSE_NAMES = new Set([
  "Barnard's star",
  "Teegarden's Star",
  "Kapteyn's Star",
]);

const COMPONENT_SUFFIX_RE = /^(.*?)(?:\s+(A|B|AB|C))$/i;

/**
 * @param {string} abbrev
 * @returns {string|null}
 */
export function constellationGenitive(abbrev) {
  if (!abbrev) return null;
  const key = abbrev.toLowerCase();
  if (CONSTELLATION_GENITIVE[key]) return CONSTELLATION_GENITIVE[key];
  // Mixed-case IAU forms: CrB, UMa, CMa, PsA, TrA, CrA, LMi, CVn
  const compact = key.replace(/[^a-z]/g, "");
  if (CONSTELLATION_GENITIVE[compact]) return CONSTELLATION_GENITIVE[compact];
  return null;
}

/**
 * @param {string} name
 */
function isCatalogId(name) {
  if (PROSE_NAMES.has(name)) return true;
  if (CATALOG_PREFIX_RE.test(name)) return true;
  return false;
}

/**
 * @param {string} greekKey e.g. "psi1", "omi02"
 * @returns {string|null}
 */
function expandGreek(greekKey) {
  const m = greekKey.toLowerCase().match(/^([a-z]+)(\d*)$/);
  if (!m) return null;
  const base = GREEK_ABBREV[m[1]];
  if (!base) return null;
  return m[2] ? `${base}${m[2]}` : base;
}

/**
 * @param {string} body Host part without component suffix.
 * @returns {string|null}
 */
function expandBody(body) {
  // Bayer + constellation: bet Pic, ups And, psi1 Dra
  const bayer = body.match(/^([a-z]+(?:\d*))\s+([A-Za-z]{2,4})$/i);
  if (bayer) {
    const greek = expandGreek(bayer[1]);
    const gen = constellationGenitive(bayer[2]);
    if (greek && gen) return `${greek} ${gen}`;
  }

  // Flamsteed + constellation: 51 Eri, 55 Cnc
  const flam = body.match(/^(\d+)\s+([A-Za-z]{2,4})$/);
  if (flam) {
    const gen = constellationGenitive(flam[2]);
    if (gen) return `${flam[1]} ${gen}`;
  }

  // Association serial: Oph 11, Cha 110913 (constellation abbrev + number)
  const assocSerial = body.match(/^([A-Za-z]{2,4})\s+(\d+)$/);
  if (assocSerial) {
    const gen = constellationGenitive(assocSerial[1]);
    if (gen) return `${gen} ${assocSerial[2]}`;
  }

  // Letter designation or word + constellation: HN Peg, YZ Cet, Proxima Cen, AU Mic
  const trailing = body.match(/^(.+?)\s+([A-Za-z]{2,4})$/);
  if (trailing) {
    const gen = constellationGenitive(trailing[2]);
    if (gen) return `${trailing[1]} ${gen}`;
  }

  return null;
}

/**
 * Expand a NASA hostname to a press-style label.
 * @param {string|null|undefined} hostname
 * @returns {string}
 */
export function pressLabel(hostname) {
  if (hostname == null || hostname === "") return String(hostname ?? "");

  if (OVERRIDES[hostname]) return OVERRIDES[hostname];

  let name = String(hostname).trim();

  // Gl → Gliese (minor normalization before catalog check).
  if (/^Gl\s/i.test(name)) {
    name = name.replace(/^Gl\s/i, "Gliese ");
  }

  if (isCatalogId(name)) return name;

  const compMatch = name.match(COMPONENT_SUFFIX_RE);
  const body = compMatch ? compMatch[1].trim() : name;
  const component = compMatch ? compMatch[2].toUpperCase() : null;

  const expanded = expandBody(body);
  if (!expanded) return name;

  return component ? `${expanded} ${component}` : expanded;
}
