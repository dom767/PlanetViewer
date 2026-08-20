import { fetchText, num, str } from "./util.mjs";

const STYPE_URLS = [
  "https://lira.obspm.fr/perso/philippe-thebault/plan_allbinallg.txt",
  "https://lesia.obspm.fr/perso/philippe-thebault/plan_allbinallg.txt",
];
const PTYPE_URLS = [
  "https://lira.obspm.fr/perso/philippe-thebault/plan_circall.txt",
  "https://lesia.obspm.fr/perso/philippe-thebault/plan_circall.txt",
];

function isHeaderLine(line) {
  const t = line.trim();
  if (!t) return true;
  return (
    t.startsWith("=") ||
    t.startsWith("-") ||
    t.startsWith("Byte") ||
    t.startsWith("Bytes") ||
    t.startsWith("Note") ||
    t.startsWith("*If") ||
    t.startsWith("Format") ||
    t.startsWith("Units") ||
    t.startsWith("column") ||
    t.startsWith("The format")
  );
}

function parseSTypeLine(line) {
  if (line.length < 90) return null;
  const name = str(line.slice(0, 15));
  if (!name) return null;
  const gaiaRaw = str(line.slice(25, 46));
  return {
    name,
    alt: str(line.slice(15, 25)),
    gaia: gaiaRaw && gaiaRaw !== "0" ? gaiaRaw : null,
    mass1: num(line.slice(46, 52)),
    mass2: num(line.slice(52, 58)),
    distPc: num(line.slice(58, 66)),
    a: num(line.slice(68, 79)),
    e: num(line.slice(79, 86)),
    nPlanets: num(line.slice(86, 88)),
    aPlanet: num(line.slice(88, 96)),
    circumbinary: false,
  };
}

function parsePTypeLine(line) {
  if (line.length < 54) return null;
  const name = str(line.slice(0, 15));
  if (!name) return null;
  return {
    name,
    alt: str(line.slice(15, 25)),
    gaia: null,
    mass1: num(line.slice(25, 31)),
    mass2: num(line.slice(31, 37)),
    distPc: num(line.slice(37, 45)),
    a: num(line.slice(47, 54)),
    e: num(line.slice(54, 61)),
    nPlanets: num(line.slice(61, 63)),
    aPlanet: num(line.slice(63, 73)),
    circumbinary: true,
  };
}

function parseTable(text, parseLine) {
  const systems = [];
  for (const raw of text.split(/\r?\n/)) {
    if (isHeaderLine(raw)) continue;
    const rec = parseLine(raw);
    if (rec?.name && rec.a != null && rec.a > 0) systems.push(rec);
  }
  return systems;
}

async function fetchFirst(urls, log, label) {
  let lastErr;
  for (const url of urls) {
    try {
      log?.(`Fetching Thebault ${label}: ${url}`);
      const text = await fetchText(url);
      if (text.length < 500) throw new Error("response too short");
      return text;
    } catch (err) {
      lastErr = err;
      log?.(`  failed: ${err.message}`);
    }
  }
  throw lastErr;
}

export async function fetchThebaultCatalogs(log) {
  const sText = await fetchFirst(STYPE_URLS, log, "S-type");
  const pText = await fetchFirst(PTYPE_URLS, log, "P-type");
  const sType = parseTable(sText, parseSTypeLine);
  const pType = parseTable(pText, parsePTypeLine);
  log?.(`Thebault S-type ${sType.length} · P-type ${pType.length}`);
  return { sType, pType };
}
