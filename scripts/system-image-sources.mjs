/**
 * Shared image-source probes for system-image fetch + probe dashboard.
 */

import {
  coordinateKeysMatch,
  coordinateSearchAliases,
  expandHostAliases,
  matchHostToFile,
  matchHostToStar,
  mentionsHost,
  mentionsHostInFields,
  parseCoordinateDesignation,
} from "./host-aliases.mjs";

export {
  coordinateSearchAliases,
  matchHostToStar,
  mentionsHost,
  mentionsHostInFields,
  parseCoordinateDesignation,
} from "./host-aliases.mjs";

export const SOURCE_KEYS = [
  "esoTitle",
  "commons",
  "nasa",
  "wikiList",
  "oec",
];

export const UA =
  "PlanetViewer/1.0 (https://github.com/dom767/PlanetViewer; system-image pipeline)";

export const MIN_SCORE = 4;
export const GOOD_SCORE = 10;
export const DELAY_MS = 400;

const REJECT_RE =
  /illustrat|artist'?s?\s+concept|artist concept|artist'?s?\s+impression|artist impression|artist'?s?\s+visuali[sz]ation|artistic conception|infographic|portrait of|dual portrait|wide[- ]?field|sky around|comparison|schematic|cartoon|diagram(?! of the)|location of\b|constellation of|star chart|starmap|star map|sky chart|iau\.svg|lightcurve|light curve|emission spectrum|spectrum of\b|panoramio|country trail|golf course/i;
const INSTITUTION_RE =
  /\beso\b|nasa|stsci|noirlab|gemini|jwst|\bwebb\b|hubble|\besa\b|sphere|\bgpi\b|nircam|nirc2|vlt|keck|subaru|alma|spitzer|charis|naco|miri/i;
const PREFER_RE =
  /sphere|gpi|naco|nirc2|miri|coronagraph|protoplanetary|protoplanet|directly imaged|direct imaging|newborn planet|exoplanet|gemini planet imager|jwst|nircam|webb|hubble|multi-planet|planet-hosting|sun-like star/i;

export const SEARCH_ALIASES = {
  "bet Pic": ["Beta Pictoris"],
  "kap And": ["Kappa Andromedae"],
  "AB Pic": ["AB Pictoris"],
  "HN Peg": ["HN Pegasi"],
  "GU Psc": ["GU Piscium"],
  "PZ Tel": ["PZ Telescopii"],
  "AF Lep": ["AF Leporis"],
  "51 Eri": ["51 Eridani"],
  "b Cen A": ["b Centauri"],
  "GQ Lup": ["GQ Lupi"],
};

let wikiTableCache = null;

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchRes(url, options = {}) {
  const { method, headers = {} } = options;
  let delay = 2000;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, {
      method: method || "GET",
      headers: { "User-Agent": UA, ...headers },
    });
    if (res.status === 429 || res.status === 503) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay;
      await sleep(wait);
      delay = Math.min(delay * 2, 30000);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res;
  }
  throw new Error(`429 ${url}`);
}

export async function fetchText(url) {
  const res = await fetchRes(url);
  return res.text();
}

export async function fetchJson(url) {
  const res = await fetchRes(url, { headers: { Accept: "application/json" } });
  return res.json();
}

export async function fetchBuffer(url) {
  const res = await fetchRes(url);
  return Buffer.from(await res.arrayBuffer());
}

export function slugFromName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "system";
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function stripHtml(s) {
  return decodeEntities(String(s))
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&uuml;/g, "ü")
    .replace(/&ouml;/g, "ö")
    .replace(/&auml;/g, "ä")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/[\s._-]+/g, "")
    .replace(/[^\w+]/g, "");
}

export function searchTerms(name, planetNames = []) {
  const extra = SEARCH_ALIASES[name] || [];
  const terms = expandHostAliases(name);
  for (const alias of extra) {
    terms.push(alias);
    for (const expanded of expandHostAliases(alias)) terms.push(expanded);
  }
  for (const planet of planetNames) {
    if (!planet) continue;
    for (const alias of expandHostAliases(planet)) terms.push(alias);
    const compact = String(planet).replace(/\s+(?=[a-z]\b)/i, "").trim();
    if (compact !== planet) {
      for (const alias of expandHostAliases(compact)) terms.push(alias);
    }
    const stem = String(planet).replace(/\s+[a-z]\b$/i, "").trim();
    if (stem !== planet && stem.length >= 4) {
      for (const alias of expandHostAliases(stem)) terms.push(alias);
    }
  }
  return [...new Set(terms.filter((t) => String(t).trim().length >= 3))];
}

function matchPlanetToFile(planetOrAlias, file) {
  if (coordinateKeysMatch(planetOrAlias, file)) return true;
  const p = norm(planetOrAlias);
  const f = norm(String(file).replace(/^File:/i, "").replace(/\.[^.]+$/, ""));
  if (!p || !f || p.length < 4) return false;
  return f.includes(p) || p.includes(f);
}

export function scoreTitle(title, extra = "") {
  const t = `${title} ${extra}`;
  if (REJECT_RE.test(t)) return -100;
  let s = 1;
  if (PREFER_RE.test(t)) s += 8;
  if (/sphere/i.test(t)) s += 6;
  if (/\bplanet/i.test(t)) s += 3;
  if (/alma/i.test(t)) s += 2;
  if (/gemini/i.test(t)) s += 3;
  return s;
}

function better(a, b) {
  if (!b) return a;
  if (!a) return b;
  return b.score > a.score ? b : a;
}

function parseEsoImagesScript(html) {
  const m = html.match(/var images = (\[[\s\S]*?]);/);
  if (!m) return [];
  const body = m[1];
  const out = [];
  const re =
    /id:\s*'([^']+)'[\s\S]*?title:\s*'((?:\\'|[^'])*)'[\s\S]*?width:\s*(\d+)[\s\S]*?height:\s*(\d+)[\s\S]*?url:\s*'([^']+)'/g;
  let hit;
  while ((hit = re.exec(body))) {
    out.push({
      id: hit[1],
      title: decodeEntities(hit[2].replace(/\\'/g, "'")),
      width: Number(hit[3]),
      height: Number(hit[4]),
      pageUrl: `https://www.eso.org${hit[5]}`,
    });
  }
  return out;
}

async function esoCredit(pageUrl) {
  const html = await fetchText(pageUrl);
  const m = html.match(/<div class="credit">([\s\S]*?)<\/div>/i);
  if (m) return stripHtml(m[1]) || "ESO";
  return "ESO";
}

function esoHit(img, score) {
  return {
    source: "eso",
    title: img.title,
    credit: img.credit || "ESO",
    sourceUrl: img.pageUrl,
    license: "CC BY 4.0",
    downloadUrl: `https://cdn.eso.org/images/large/${img.id}.jpg`,
    alt: img.title,
    score,
  };
}

async function searchEsoTitle(query) {
  const url =
    "https://www.eso.org/public/images/archive/search/?title=" +
    encodeURIComponent(query);
  const html = await fetchText(url);
  return parseEsoImagesScript(html);
}

export async function probeEsoTitle(name, aliases, { delay = DELAY_MS } = {}) {
  let best = null;
  for (const q of aliases) {
    if (delay) await sleep(delay);
    let list = [];
    try {
      list = await searchEsoTitle(q);
    } catch (err) {
      if (!best) best = { error: err.message };
      continue;
    }
    for (const img of list) {
      if (!mentionsHostInFields([img.title], name, aliases)) continue;
      const sc = scoreTitle(img.title);
      if (sc < 0) continue;
      if (!best || !best.score || sc > best.score) best = { ...img, score: sc };
    }
    if (best?.score >= GOOD_SCORE) break;
  }
  if (!best?.score || best.score < MIN_SCORE) return best?.error ? { error: best.error } : null;
  if (delay) await sleep(delay);
  best.credit = await esoCredit(best.pageUrl);
  return esoHit(best, best.score);
}

function nasaCredit(meta) {
  const who = meta.photographer || meta.secondary_creator;
  const center = meta.center;
  if (who && center) return `NASA/${center} / ${who}`;
  if (center) return `NASA/${center}`;
  if (who) return `NASA / ${who}`;
  return "NASA";
}

async function searchNasa(query) {
  const url =
    "https://images-api.nasa.gov/search?media_type=image&q=" +
    encodeURIComponent(query);
  const data = await fetchJson(url);
  return data.collection?.items || [];
}

function nasaDownloadUrl(item) {
  const links = item.links || [];
  const orig = links.find((l) => /~orig\./i.test(l.href || ""));
  const large = links.find((l) => /~large\./i.test(l.href || ""));
  const medium = links.find((l) => /~medium\./i.test(l.href || ""));
  return orig?.href || large?.href || medium?.href || links[0]?.href || null;
}

export async function probeNasa(name, aliases, { delay = DELAY_MS } = {}) {
  const queries = [`${name} exoplanet`, ...aliases];
  let best = null;
  for (const q of queries) {
    if (delay) await sleep(delay);
    let items = [];
    try {
      items = await searchNasa(q);
    } catch (err) {
      if (!best) best = { error: err.message };
      continue;
    }
    for (const item of items) {
      const meta = item.data?.[0] || {};
      const title = meta.title || "";
      const desc = meta.description || "";
      const keys = (meta.keywords || []).join(" ");
      if (!mentionsHostInFields([title, desc, keys], name, aliases)) continue;
      const sc = scoreTitle(title, `${desc} ${keys}`);
      if (sc < 0) continue;
      const downloadUrl = nasaDownloadUrl(item);
      if (!downloadUrl) continue;
      if (!best || !best.score || sc > best.score) {
        best = {
          source: "nasa",
          score: sc,
          title,
          credit: nasaCredit(meta),
          sourceUrl: `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id || "")}`,
          license: "NASA public domain",
          downloadUrl,
          alt: title,
        };
      }
    }
    if (best?.score >= GOOD_SCORE) break;
  }
  if (!best?.score || best.score < MIN_SCORE) return best?.error ? { error: best.error } : null;
  return best;
}

export function commonsLicenseOk(shortName, usage) {
  const t = `${shortName || ""} ${usage || ""}`.toLowerCase();
  if (/\bnc\b/.test(t)) return false;
  return /cc by|public domain|cc0|\bpd[- ]|nasa/i.test(t);
}

function commonsCaption(fileTitle, desc) {
  const name = fileTitle.replace(/^File:/i, "").replace(/\.(jpe?g|png)$/i, "");
  if (!desc) return name;
  if (
    desc.length > 220 ||
    /kicked things off|university of|entitled “/i.test(desc)
  ) {
    return name;
  }
  return desc.slice(0, 180);
}

async function commonsImageInfo(title) {
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&maxlag=5&prop=imageinfo" +
    "&iiprop=url|mime|size|extmetadata&iiurlwidth=1600&titles=" +
    encodeURIComponent(title);
  const data = await fetchJson(url);
  const page = Object.values(data.query?.pages || {})[0];
  return page?.imageinfo?.[0] || null;
}

export async function probeCommons(name, aliases, { delay = DELAY_MS } = {}) {
  let best = null;
  for (const q of aliases) {
    if (delay) await sleep(delay);
    let hits = [];
    try {
      const data = await fetchJson(
        "https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&format=json&maxlag=5&srlimit=8&srsearch=" +
          encodeURIComponent(`"${q}"`)
      );
      hits = data.query?.search || [];
    } catch (err) {
      if (!best) best = { error: err.message };
      continue;
    }
    hits.sort((a, b) => {
      const rank = (t) => (/\.jpe?g$/i.test(t) ? 0 : /\.png$/i.test(t) ? 1 : 2);
      return rank(a.title) - rank(b.title);
    });
    for (const hit of hits) {
      const fileTitle = hit.title || "";
      if (/\.(gif|tiff?|svg|pdf|djvu|webp)$/i.test(fileTitle)) continue;
      if (!/\.(jpe?g|png)$/i.test(fileTitle)) continue;
      const preview = `${fileTitle} ${hit.snippet || ""}`;
      if (REJECT_RE.test(preview)) continue;
      const titleMatch = mentionsHostInFields([fileTitle], name, aliases);
      if (!titleMatch && !INSTITUTION_RE.test(preview) && !PREFER_RE.test(preview)) continue;
      if (delay) await sleep(delay);
      let info;
      try {
        info = await commonsImageInfo(fileTitle);
      } catch (err) {
        continue;
      }
      if (!info) continue;
      const mime = info.mime || "";
      if (mime !== "image/jpeg" && mime !== "image/png") continue;
      const meta = info.extmetadata || {};
      const license = meta.LicenseShortName?.value || meta.License?.value || "";
      const usage = meta.UsageTerms?.value || "";
      if (!commonsLicenseOk(license, usage)) continue;
      const desc = stripHtml(meta.ImageDescription?.value || "");
      const artist = stripHtml(meta.Artist?.value || meta.Credit?.value || "");
      const blob = `${fileTitle} ${hit.snippet || ""} ${desc} ${artist}`;
      if (!mentionsHostInFields([fileTitle, hit.snippet || "", desc], name, aliases)) {
        if (!matchHostToFile(name, fileTitle, aliases)) continue;
      }
      if (!titleMatch && !INSTITUTION_RE.test(blob) && !PREFER_RE.test(blob)) continue;
      let sc = scoreTitle(fileTitle, `${hit.snippet || ""} ${desc}`);
      if (titleMatch) sc = Math.max(sc, MIN_SCORE + 1);
      if (sc < MIN_SCORE) continue;
      const downloadUrl = info.thumburl || info.url;
      if (!downloadUrl) continue;
      if (!best || !best.score || sc > best.score) {
        best = {
          source: "commons",
          score: sc,
          title: commonsCaption(fileTitle, desc),
          credit: artist || "Wikimedia Commons",
          sourceUrl: `https://commons.wikimedia.org/wiki/${fileTitle.replace(/ /g, "_")}`,
          license: stripHtml(license) || "see source",
          downloadUrl,
          alt: commonsCaption(fileTitle, desc),
        };
      }
    }
    if (best?.score >= GOOD_SCORE) break;
  }
  if (!best?.score || best.score < MIN_SCORE) return best?.error ? { error: best.error } : null;
  return best;
}

function parseWikiTableHtml(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(html))) {
    const row = tr[1];
    const file = row.match(/href="\/wiki\/File:([^"]+)"/i);
    if (!file) continue;
    const starLink = [...row.matchAll(/href="\/wiki\/([^"#]+)"[^>]*>([^<]+)<\/a>/g)]
      .map((m) => ({
        href: decodeURIComponent(m[1].replace(/_/g, " ")),
        text: m[2],
      }))
      .filter(
        (x) =>
          !x.href.startsWith("File:") &&
          !x.href.startsWith("Help:") &&
          !x.href.startsWith("Category:")
      );
    const star = starLink[0]?.text || starLink[0]?.href || "";
    rows.push({
      star,
      file: decodeURIComponent(file[1].replace(/_/g, " ")),
    });
  }
  return rows;
}

export async function loadWikiTable(cachePath) {
  if (wikiTableCache) return wikiTableCache;
  const { readFile, writeFile, access } = await import("node:fs/promises");
  const maxAgeMs = 24 * 60 * 60 * 1000;
  if (cachePath) {
    try {
      await access(cachePath);
      const raw = JSON.parse(await readFile(cachePath, "utf8"));
      if (raw.fetchedAt && Date.now() - new Date(raw.fetchedAt).getTime() < maxAgeMs) {
        wikiTableCache = raw.rows;
        return wikiTableCache;
      }
    } catch {
      /* refresh */
    }
  }
  const data = await fetchJson(
    "https://en.wikipedia.org/w/api.php?action=parse&page=List_of_directly_imaged_exoplanets&prop=text&format=json&formatversion=2"
  );
  const rows = parseWikiTableHtml(data.parse.text);
  wikiTableCache = rows;
  if (cachePath) {
    await writeFile(
      cachePath,
      JSON.stringify({ fetchedAt: new Date().toISOString(), rows }, null, 2) + "\n"
    );
  }
  return rows;
}

export async function probeWikiList(name, aliases, wikiTable, { delay = DELAY_MS, planetNames = [] } = {}) {
  if (!wikiTable?.length) return null;
  const row = wikiTable.find(
    (r) =>
      matchHostToStar(name, r.star) ||
      aliases.some((a) => matchHostToStar(a, r.star)) ||
      planetNames.some((p) => matchPlanetToFile(p, r.file)) ||
      aliases.some((a) => matchPlanetToFile(a, r.file))
  );
  if (!row) return null;
  const fileTitle = row.file.startsWith("File:") ? row.file : `File:${row.file}`;
  if (REJECT_RE.test(fileTitle)) return null;
  if (delay) await sleep(delay);
  try {
    const info = await commonsImageInfo(fileTitle);
    if (!info) return null;
    const mime = info.mime || "";
    if (mime !== "image/jpeg" && mime !== "image/png") return null;
    const meta = info.extmetadata || {};
    const license = meta.LicenseShortName?.value || meta.License?.value || "";
    const usage = meta.UsageTerms?.value || "";
    if (!commonsLicenseOk(license, usage)) return null;
    const desc = stripHtml(meta.ImageDescription?.value || "");
    const artist = stripHtml(meta.Artist?.value || meta.Credit?.value || "");
    let sc = scoreTitle(fileTitle, desc);
    // Curated directly-imaged list: trust the row once host/file matching succeeded.
    if (sc < MIN_SCORE) sc = MIN_SCORE + 2;
    const downloadUrl = info.thumburl || info.url;
    if (!downloadUrl) return null;
    return {
      source: "wikiList",
      score: sc,
      title: commonsCaption(fileTitle, desc),
      credit: artist || "Wikimedia Commons",
      sourceUrl: `https://commons.wikimedia.org/wiki/${fileTitle.replace(/ /g, "_")}`,
      license: stripHtml(license) || "see source",
      downloadUrl,
      alt: commonsCaption(fileTitle, desc),
    };
  } catch (err) {
    return { error: err.message };
  }
}

function oecLicenseFromDescription(desc) {
  const t = String(desc).toLowerCase();
  if (/cc\s*by|creative commons|public domain|nasa|eso/i.test(t)) {
    if (/cc\s*by-nc|non-commercial/i.test(t)) return null;
    if (/cc\s*by/i.test(t)) return "CC BY (see source)";
    if (/public domain|nasa/i.test(t)) return "Public domain / NASA";
    return "see source";
  }
  return "see source";
}

export async function probeOec(name, aliases, { delay = DELAY_MS } = {}) {
  const terms = searchTerms(name);
  for (const term of terms) {
    const xmlUrl =
      "https://raw.githubusercontent.com/OpenExoplanetCatalogue/open_exoplanet_catalogue/master/systems/" +
      encodeURIComponent(term) + ".xml";
    try {
      const xml = await fetchText(xmlUrl);
      const imgM = xml.match(/<image>([^<]+)<\/image>/i);
      if (!imgM) continue;
      const stem = imgM[1].trim();
      const descM = xml.match(/<imagedescription>([\s\S]*?)<\/imagedescription>/i);
      const desc = descM ? stripHtml(descM[1]) : "";
      const downloadUrl =
        `https://raw.githubusercontent.com/hannorein/oec_outreach/master/images/` +
        encodeURIComponent(stem) + ".jpg";
      const head = await fetchRes(downloadUrl, { method: "HEAD" });
      if (!head.ok) continue;
      const creditMatch = desc.match(/Credit:\s*([^.]+)/i);
      const credit = creditMatch ? stripHtml(creditMatch[1]) : desc.slice(0, 120) || "OEC";
      const license = oecLicenseFromDescription(desc);
      const sc = scoreTitle(stem, desc);
      if (sc < MIN_SCORE && !/eso|nasa|gemini|sphere|vlt/i.test(desc)) continue;
      return {
        source: "oec",
        score: Math.max(sc, MIN_SCORE),
        title: desc.split(".").slice(0, 1)[0]?.slice(0, 180) || stem,
        credit,
        sourceUrl: `https://www.openexoplanetcatalogue.com/planet/${encodeURIComponent(term + " b")}/`,
        license,
        downloadUrl,
        alt: stem,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export function attributionOk(hit) {
  if (!hit || hit.error) return false;
  const credit = String(hit.credit || "").trim();
  if (!credit || credit === "Wikimedia Commons") return false;
  const license = String(hit.license || "").toLowerCase();
  if (/\bnc\b|non-commercial|see source/i.test(license)) return false;
  if (/cc by|public domain|cc0|nasa|eso/i.test(license)) return true;
  if (hit.source === "eso") return true;
  if (hit.source === "nasa") return true;
  if (hit.source === "commons" || hit.source === "wikiList") {
    return commonsLicenseOk(hit.license, hit.license);
  }
  return false;
}

export function pickBestFromHits(hits) {
  let best = null;
  for (const key of ["esoTitle", "commons", "nasa", "wikiList", "oec"]) {
    const h = hits[key];
    if (h && !h.error && h.score >= MIN_SCORE) best = better(best, h);
  }
  return best;
}

/** Cascade used by fetch-system-images (ESO → Commons → NASA, early exit on good score). */
export async function pickBest(name, aliases, { delay = DELAY_MS } = {}) {
  let best = await probeEsoTitle(name, aliases, { delay });
  if (!best || best.score < GOOD_SCORE) {
    best = better(best, await probeCommons(name, aliases, { delay }));
  }
  if (!best || best.score < GOOD_SCORE) {
    best = better(best, await probeNasa(name, aliases, { delay }));
  }
  return best;
}

const PROBE_FNS = {
  esoTitle: probeEsoTitle,
  commons: probeCommons,
  nasa: probeNasa,
  wikiList: null,
  oec: probeOec,
};

export async function probeHost(name, options = {}) {
  const {
    sources = SOURCE_KEYS,
    delay = DELAY_MS,
    wikiTable = null,
    wikiCachePath = null,
    onProgress = null,
    planetNames = [],
  } = options;
  const aliases = searchTerms(name, planetNames);
  let table = wikiTable;
  if (sources.includes("wikiList") && !table) {
    onProgress?.({ phase: "wiki-table", name, status: "loading" });
    table = await loadWikiTable(wikiCachePath);
    onProgress?.({ phase: "wiki-table", name, status: "ready" });
  }
  const out = { name, aliases, sources: {}, winner: null };
  for (let i = 0; i < sources.length; i++) {
    const key = sources[i];
    onProgress?.({
      phase: "source-start",
      name,
      sourceKey: key,
      sourceIndex: i + 1,
      sourceTotal: sources.length,
    });
    let hit = null;
    try {
      if (key === "wikiList") {
        hit = await probeWikiList(name, aliases, table, { delay, planetNames });
      } else if (PROBE_FNS[key]) {
        hit = await PROBE_FNS[key](name, aliases, { delay });
      }
    } catch (err) {
      hit = { error: err.message };
    }
    out.sources[key] = hit;
    onProgress?.({
      phase: "source-done",
      name,
      sourceKey: key,
      sourceIndex: i + 1,
      sourceTotal: sources.length,
      hit,
    });
  }
  out.winner = pickBestFromHits(out.sources);
  onProgress?.({ phase: "host-probe-done", name, result: out });
  return out;
}

export function imagingHostEntries(catalog) {
  const systems = Array.isArray(catalog) ? catalog : catalog.systems || [];
  const entries = [];
  for (const s of systems) {
    if (!(s.planets || []).some((p) => /imaging/i.test(p.discoveryMethod || ""))) {
      continue;
    }
    entries.push({
      name: s.name,
      planetNames: (s.planets || []).map((p) => p.name).filter(Boolean),
    });
  }
  return entries;
}

export function imagingHosts(catalog) {
  return imagingHostEntries(catalog).map((e) => e.name);
}

export function sourceResultToCell(hit) {
  if (!hit) return { ok: false };
  if (hit.error) return { ok: false, error: hit.error };
  if (!hit.score || hit.score < MIN_SCORE) return { ok: false, title: hit.title, score: hit.score };
  return {
    ok: true,
    title: hit.title,
    credit: hit.credit,
    license: hit.license,
    sourceUrl: hit.sourceUrl,
    score: hit.score,
    downloadUrl: hit.downloadUrl,
  };
}
