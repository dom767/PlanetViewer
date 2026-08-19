import { getSystemImage } from "../content/systemImages.js";

function fmt(v, digits = 2, unit = "") {
  if (v == null || Number.isNaN(v)) return "—";
  const n = typeof v === "number" ? v.toFixed(digits) : String(v);
  return unit ? `${n} ${unit}` : n;
}

export class InfoPanel {
  constructor(root, contentEl, closeBtn) {
    this.root = root;
    this.content = contentEl;
    /** @type {object|null} */
    this._system = null;
    /** Called only on explicit close (reset), not on dismiss/toggle. */
    this.onClose = null;
    /** Called when panel is hidden via dismiss (X button, nav toggle). */
    this.onDismiss = null;
    closeBtn.addEventListener("click", () => {
      this.dismiss();
      this.onDismiss?.();
    });
  }

  open(system) {
    this._system = system;
    this.root.classList.remove("hidden");
    this.content.innerHTML = renderSystem(system);
  }

  /** Hide panel without clearing camera focus. */
  dismiss() {
    this.root.classList.add("hidden");
  }

  toggle(system) {
    if (this.isOpen()) {
      this.dismiss();
      return false;
    }
    if (system) {
      this.open(system);
      return true;
    }
    if (this._system) {
      this.open(this._system);
      return true;
    }
    return false;
  }

  /** Full close: clear content and fire onClose if set. */
  close() {
    this.dismiss();
    this.content.innerHTML = "";
    this._system = null;
    this.onClose?.();
  }

  isOpen() {
    return !this.root.classList.contains("hidden");
  }

  getSystem() {
    return this._system;
  }
}

function renderSystem(s) {
  const subtitle = s.isSol
    ? "G2V · Our solar system (origin)"
    : `${s.spectype ? escapeHtml(s.spectype) : "Spectral type unknown"} · ${fmt(s.distPc, 2, "pc")} from Sol`;
  const photo = renderSystemImage(s.name);
  const anyEstimated = (s.planets || []).some((p) => p.radiusEstimated);

  const planets = (s.planets || [])
    .map((p) => {
      const orbit = p.a != null ? fmt(p.a, 3, "AU") : "—";
      const size = planetSizeSols(p);
      const mass = planetMassSols(p);
      const sizeMass =
        size && mass ? `${size} · ${mass}` : size || mass || "—";
      const period =
        p.periodDays != null ? fmt(p.periodDays, 1, "days") : "—";
      const kind = p.planetTypeLabel
        ? `<div>${escapeHtml(p.planetTypeLabel)}</div>`
        : "";
      const hz = p.habitableZone
        ? `<div class="hz-tag">Goldilocks zone</div>`
        : "";
      const discovery = planetDiscovery(p);
      return `<li class="${p.habitableZone ? "planet-hz" : ""}">
        <div class="name">${escapeHtml(p.name)}</div>
        ${hz}
        <div class="meta">
          ${kind}
          <div>Orbit ${orbit}</div>
          <div>${sizeMass}</div>
          <div>Period ${period}</div>
        </div>
        ${discovery ? `<div class="discovery">${discovery}</div>` : ""}
      </li>`;
    })
    .join("");

  return `
    <h2>${escapeHtml(s.label ?? s.name)}</h2>
    <div class="subtitle">${subtitle}</div>
    ${photo}
    <dl>
      <dt>Effective temperature</dt><dd>${fmt(s.teff, 0, "K")}</dd>
      <dt>Radius</dt><dd>${fmt(s.radius, 2, "R☉")}</dd>
      <dt>Luminosity</dt><dd>${fmt(s.luminosity, 3, "L☉")}</dd>
      <dt>V magnitude</dt><dd>${fmt(s.vmag, 2)}</dd>
      <dt>Stellar mass</dt><dd>${fmt(s.mass, 2, "M☉")}</dd>
      ${s.isSol ? "" : `<dt>RA / Dec</dt><dd>${fmt(s.ra, 3)}° / ${fmt(s.dec, 3)}°</dd>`}
      <dt>Planets</dt><dd>${s.planets?.length ?? 0}${s.pnum != null && !s.isSol && s.pnum > 0 ? ` (archive: ${s.pnum})` : ""}</dd>
      ${discoverySummary(s.planets)}
    </dl>
    <h3>Planets</h3>
    <ul class="planet-list">${planets || "<li><div class='meta'>No confirmed exoplanets</div></li>"}</ul>
    ${anyEstimated ? `<p class="est-note">* Radius estimated from mass</p>` : ""}
  `;
}

/** @param {string} name */
function renderSystemImage(name) {
  const img = getSystemImage(name);
  if (!img) return "";
  return `<figure class="system-photo">
      <img src="${escapeHtml(img.src)}" width="300" height="300" alt="${escapeHtml(img.alt)}" />
      <figcaption>
        <a href="${escapeHtml(img.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(img.credit)}</a>
        · ${escapeHtml(img.license)}
      </figcaption>
    </figure>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Size in Earth units (Sol-system reference). Asterisk = mass-based estimate. */
function planetSizeSols(p) {
  let r = null;
  if (p.radiusEarth != null) r = p.radiusEarth;
  else if (p.radiusJupiter != null) r = p.radiusJupiter * 11.209;
  if (r == null) return null;
  const mark = p.radiusEstimated ? "*" : "";
  const text = `${fmt(r, 2, "R⊕")}${mark}`;
  if (p.radiusEstimated) {
    return `<span title="Estimated from mass">${text}</span>`;
  }
  return text;
}

/** Mass in Earth units (Sol-system reference). */
function planetMassSols(p) {
  if (p.massEarth != null) return fmt(p.massEarth, 2, "M⊕");
  return null;
}

/** "Transit · 2016 · La Silla Observatory", or null when the archive has nothing. */
function planetDiscovery(p) {
  const parts = [];
  if (p.discoveryMethod) parts.push(escapeHtml(p.discoveryMethod));
  if (p.discoveryYear != null) parts.push(String(p.discoveryYear));
  if (p.discoveryFacility) parts.push(escapeHtml(p.discoveryFacility));
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Systems can mix methods and span years, so collapse to a range plus method
 * count rather than repeating every planet's entry.
 */
function discoverySummary(planets) {
  const known = (planets || []).filter(
    (p) => p.discoveryMethod || p.discoveryYear != null
  );
  if (!known.length) return "";

  const years = known.map((p) => p.discoveryYear).filter((y) => y != null);
  const methods = [...new Set(known.map((p) => p.discoveryMethod).filter(Boolean))];

  const bits = [];
  if (methods.length === 1) bits.push(escapeHtml(methods[0]));
  else if (methods.length > 1) bits.push(`${methods.length} methods`);
  if (years.length) {
    const lo = Math.min(...years);
    const hi = Math.max(...years);
    bits.push(lo === hi ? `${lo}` : `${lo}–${hi}`);
  }
  return `<dt>Discovery</dt><dd>${bits.join(" · ")}</dd>`;
}
