import { Agent, fetch as undiciFetch } from "undici";
import { num } from "./util.mjs";

/** 30 pc ⇒ parallax ≥ 1000/30 mas */
const MIN_PARALLAX_MAS = 1000 / 30;
const TAP_BASE = "https://gea.esac.esa.int/tap-server/tap";
const MAX_ATTEMPTS = 3;
const POLL_MS = 4000;
const MAX_POLL_MS = 25 * 60_000;

const dispatcher = new Agent({
  connectTimeout: 60_000,
  headersTimeout: 10 * 60_000,
  bodyTimeout: 20 * 60_000,
});

const query = `
SELECT source_id, ra, dec, parallax, phot_g_mean_mag, bp_rp
FROM gaiadr3.gaia_source
WHERE parallax >= ${MIN_PARALLAX_MAS}
  AND parallax_over_error > 10
  AND ruwe < 1.4
  AND phot_g_mean_mag IS NOT NULL
`.replace(/\s+/g, " ").trim();

async function tapFetch(url, init = {}) {
  return undiciFetch(url, { ...init, dispatcher });
}

function parseTapJson(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.data)) {
    const cols = (raw.metadata || []).map((m) => m.name);
    if (cols.length && Array.isArray(raw.data[0])) {
      return raw.data.map((arr) => {
        const o = {};
        for (let i = 0; i < cols.length; i++) o[cols[i]] = arr[i];
        return o;
      });
    }
    return raw.data;
  }
  throw new Error("Unexpected Gaia TAP JSON shape: " + Object.keys(raw).join(","));
}

async function readJobPhase(jobUrl) {
  const res = await tapFetch(`${jobUrl}/phase`);
  if (!res.ok) {
    throw new Error(`Gaia job phase failed: ${res.status} ${res.statusText}`);
  }
  return (await res.text()).trim();
}

async function fetchGaiaRowsAsync(log) {
  const body = new URLSearchParams({
    PHASE: "run",
    LANG: "ADQL",
    FORMAT: "json",
    MAXREC: "100000",
    QUERY: query,
  });

  const submit = await tapFetch(`${TAP_BASE}/async`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });

  let resolvedJobUrl =
    submit.headers.get("location") ||
    submit.headers.get("Location") ||
    submit.headers.get("content-location");

  if (!resolvedJobUrl && submit.status >= 200 && submit.status < 300) {
    const text = await submit.text();
    const href = text.match(/https?:\/\/[^\s"'<>]+\/async\/[^\s"'<>]+/);
    if (href) resolvedJobUrl = href[0].replace(/\/$/, "");
  }

  if (!resolvedJobUrl) {
    const text = await (submit.bodyUsed ? Promise.resolve("") : submit.text());
    throw new Error(
      `Gaia async submit failed: ${submit.status} ${submit.statusText}\n${text.slice(0, 500)}`
    );
  }

  log?.(`Gaia async job: ${resolvedJobUrl}`);

  const started = Date.now();
  let phase = await readJobPhase(resolvedJobUrl);
  while (phase === "QUEUED" || phase === "EXECUTING" || phase === "PENDING") {
    if (Date.now() - started > MAX_POLL_MS) {
      throw new Error(`Gaia async job timed out after ${MAX_POLL_MS / 1000}s (phase=${phase})`);
    }
    log?.(`  job phase: ${phase}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
    phase = await readJobPhase(resolvedJobUrl);
  }

  if (phase !== "COMPLETED") {
    let detail = "";
    try {
      const errRes = await tapFetch(`${resolvedJobUrl}/error`);
      detail = (await errRes.text()).slice(0, 500);
    } catch {
      /* ignore */
    }
    throw new Error(`Gaia async job ended with phase ${phase}${detail ? `\n${detail}` : ""}`);
  }

  const resultRes = await tapFetch(`${resolvedJobUrl}/results/result`);
  if (!resultRes.ok) {
    const text = await resultRes.text();
    throw new Error(
      `Gaia result fetch failed: ${resultRes.status} ${resultRes.statusText}\n${text.slice(0, 500)}`
    );
  }
  return parseTapJson(await resultRes.json());
}

export async function fetchGaiaNearbyRows(log) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      log?.(
        `Fetching Gaia DR3 stars within 30 pc via async TAP… (attempt ${attempt}/${MAX_ATTEMPTS})`
      );
      return await fetchGaiaRowsAsync(log);
    } catch (err) {
      lastErr = err;
      log?.(`Gaia fetch attempt ${attempt} failed: ${err.message || err}`);
      if (attempt < MAX_ATTEMPTS) {
        const waitMs = attempt * 5000;
        log?.(`Retrying in ${waitMs / 1000}s…`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  throw lastErr;
}

export function buildNearbyStars(rows) {
  const stars = [];
  for (const row of rows) {
    const ra = num(row.ra);
    const dec = num(row.dec);
    const plx = num(row.parallax);
    if (ra == null || dec == null || plx == null || plx <= 0) continue;
    const distPc = 1000 / plx;
    if (distPc > 30) continue;
    stars.push({
      sourceId: String(row.source_id ?? ""),
      ra,
      dec,
      distPc,
      gMag: num(row.phot_g_mean_mag),
      bpRp: num(row.bp_rp),
    });
  }
  stars.sort((a, b) => a.distPc - b.distPc);
  return stars;
}

export async function importNearbyStarCatalog(log) {
  const rows = await fetchGaiaNearbyRows(log);
  const stars = buildNearbyStars(rows);
  if (stars.length < 1000) {
    log?.(
      `Warning: only ${stars.length} stars after filters (expected ~6000+). Check Gaia TAP response.`
    );
  }
  return stars;
}
