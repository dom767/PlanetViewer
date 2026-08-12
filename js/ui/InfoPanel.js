function fmt(v, digits = 2, unit = "") {
  if (v == null || Number.isNaN(v)) return "—";
  const n = typeof v === "number" ? v.toFixed(digits) : String(v);
  return unit ? `${n} ${unit}` : n;
}

export class InfoPanel {
  constructor(root, contentEl, closeBtn) {
    this.root = root;
    this.content = contentEl;
    this.onClose = null;
    closeBtn.addEventListener("click", () => this.close());
  }

  open(system) {
    this.root.classList.remove("hidden");
    this.content.innerHTML = renderSystem(system);
  }

  close() {
    this.root.classList.add("hidden");
    this.content.innerHTML = "";
    this.onClose?.();
  }

  isOpen() {
    return !this.root.classList.contains("hidden");
  }
}

function renderSystem(s) {
  const subtitle = s.isSol
    ? "G2V · Our solar system (origin)"
    : `${s.spectype ? escapeHtml(s.spectype) : "Spectral type unknown"} · ${fmt(s.distPc, 2, "pc")} from Sol`;

  const planets = (s.planets || [])
    .map((p) => {
      const orbit = p.a != null ? fmt(p.a, 3, "AU") : "—";
      const size = planetSizeSols(p);
      const mass = planetMassSols(p);
      const sizeMass =
        size && mass ? `${size} · ${mass}` : size || mass || "—";
      const period =
        p.periodDays != null ? fmt(p.periodDays, 1, "days") : "—";
      const hz = p.habitableZone
        ? `<div class="hz-tag">Goldilocks zone</div>`
        : "";
      return `<li class="${p.habitableZone ? "planet-hz" : ""}">
        <div class="name">${escapeHtml(p.name)}</div>
        ${hz}
        <div class="meta">
          <div>Orbit ${orbit}</div>
          <div>${sizeMass}</div>
          <div>Period ${period}</div>
        </div>
      </li>`;
    })
    .join("");

  return `
    <h2>${escapeHtml(s.name)}</h2>
    <div class="subtitle">${subtitle}</div>
    <dl>
      <dt>Effective temperature</dt><dd>${fmt(s.teff, 0, "K")}</dd>
      <dt>Radius</dt><dd>${fmt(s.radius, 2, "R☉")}</dd>
      <dt>Luminosity</dt><dd>${fmt(s.luminosity, 3, "L☉")}</dd>
      <dt>V magnitude</dt><dd>${fmt(s.vmag, 2)}</dd>
      <dt>Stellar mass</dt><dd>${fmt(s.mass, 2, "M☉")}</dd>
      ${s.isSol ? "" : `<dt>RA / Dec</dt><dd>${fmt(s.ra, 3)}° / ${fmt(s.dec, 3)}°</dd>`}
      <dt>Planets</dt><dd>${s.planets?.length ?? 0}${s.pnum != null && !s.isSol ? ` (archive: ${s.pnum})` : ""}</dd>
    </dl>
    <h3>Planets</h3>
    <ul class="planet-list">${planets || "<li><div class='meta'>No planets with usable parameters</div></li>"}</ul>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Size in Earth units (Sol-system reference). */
function planetSizeSols(p) {
  if (p.radiusEarth != null) return fmt(p.radiusEarth, 2, "R⊕");
  if (p.radiusJupiter != null) return fmt(p.radiusJupiter * 11.209, 2, "R⊕");
  return null;
}

/** Mass in Earth units (Sol-system reference). */
function planetMassSols(p) {
  if (p.massEarth != null) return fmt(p.massEarth, 2, "M⊕");
  return null;
}
