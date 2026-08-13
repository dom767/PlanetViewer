/**
 * Prefix-only system name search (2+ characters, case-insensitive, spaces ignored).
 */
export class SystemSearch {
  /**
   * @param {object} opts
   * @param {HTMLInputElement} opts.input
   * @param {HTMLElement} opts.results
   * @param {{ system: object, normName: string }[]} opts.index
   * @param {(system: object) => void} opts.onSelect
   * @param {() => void} [opts.onEscape]
   */
  constructor({ input, results, index, onSelect, onEscape }) {
    this.input = input;
    this.results = results;
    this.index = index;
    this.onSelect = onSelect;
    this.onEscape = onEscape;
    this.activeIndex = -1;
    this.currentMatches = [];

    this.input.addEventListener("input", (e) => {
      e.stopPropagation();
      this.updateMatches();
    });
    this.input.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.results.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.input.addEventListener("keydown", (e) => {
      const action = this.onKeyDown(e);
      if (action === "escape") this.onEscape?.();
    });
  }

  isOpen() {
    return !this.input.closest(".hidden");
  }

  open() {
    const sheet = this.input.closest("#search-sheet");
    sheet?.classList.remove("hidden");
    this.input.value = "";
    this.hideResults();
    requestAnimationFrame(() => this.input.focus());
  }

  close() {
    this.hideResults();
    this.input.value = "";
    this.input.blur();
  }

  hideResults() {
    this.results.classList.add("hidden");
    this.results.innerHTML = "";
    this.activeIndex = -1;
    this.currentMatches = [];
  }

  normalizeQuery(q) {
    return String(q).toUpperCase().trim().replace(/\s+/g, "");
  }

  updateMatches() {
    const q = this.normalizeQuery(this.input.value);
    if (q.length < 2) {
      this.hideResults();
      return;
    }

    const matches = [];
    const seen = new Set();
    for (const it of this.index) {
      if (!it.normName.startsWith(q)) continue;
      if (seen.has(it.system.id)) continue;
      seen.add(it.system.id);
      matches.push(it);
    }
    matches.sort(
      (a, b) =>
        (a.system.distPc ?? Infinity) - (b.system.distPc ?? Infinity) ||
        a.system.name.localeCompare(b.system.name)
    );
    this.renderResults(matches.slice(0, 12));
  }

  renderResults(matches) {
    this.results.innerHTML = "";
    this.currentMatches = matches;
    this.activeIndex = matches.length ? 0 : -1;

    if (!matches.length) {
      this.results.classList.add("hidden");
      return;
    }
    this.results.classList.remove("hidden");

    for (let i = 0; i < matches.length; i++) {
      const { system } = matches[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "system-search-item";
      if (i === 0) btn.classList.add("active");
      btn.textContent = system.name;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onSelect(system);
      });
      this.results.appendChild(btn);
    }
  }

  onKeyDown(e) {
    if (e.code === "Escape") {
      e.preventDefault();
      return "escape";
    }

    if (this.results.classList.contains("hidden")) return;

    const items = [...this.results.querySelectorAll(".system-search-item")];
    if (!items.length) return;

    if (e.code === "ArrowDown") {
      e.preventDefault();
      this.activeIndex = Math.min(items.length - 1, this.activeIndex + 1);
    } else if (e.code === "ArrowUp") {
      e.preventDefault();
      this.activeIndex = Math.max(0, this.activeIndex - 1);
    } else if (e.code === "Enter") {
      e.preventDefault();
      const chosen = this.currentMatches[this.activeIndex];
      if (chosen) this.onSelect(chosen.system);
      return;
    } else {
      return;
    }

    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle("active", i === this.activeIndex);
    }
    items[this.activeIndex]?.scrollIntoView({ block: "nearest" });
  }
}
