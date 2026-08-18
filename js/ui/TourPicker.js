/**
 * Full-screen tour chooser. Blocking on first load; dismissible when reopened.
 */
export class TourPicker {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.overlay
   * @param {HTMLElement} opts.list
   * @param {HTMLElement|null} opts.closeBtn
   * @param {HTMLElement|null} [opts.eyebrowEl]
   * @param {HTMLElement|null} opts.titleEl
   * @param {HTMLElement|null} [opts.leadEl]
   * @param {import("../content/tours.js").Tour[]} opts.tours
   * @param {{ id: string, title: string, blurb: string }|null} [opts.freeFlight]
   * @param {(id: string) => void} opts.onChoose
   * @param {(() => void)|null} [opts.onDismiss]
   */
  constructor({ overlay, list, closeBtn, eyebrowEl, titleEl, leadEl, tours, freeFlight, onChoose, onDismiss }) {
    this.overlay = overlay;
    this.list = list;
    this.closeBtn = closeBtn;
    this.eyebrowEl = eyebrowEl ?? null;
    this.titleEl = titleEl;
    this.leadEl = leadEl ?? null;
    this.tours = tours;
    this.freeFlight = freeFlight ?? null;
    this.onChoose = onChoose;
    this.onDismiss = onDismiss ?? null;
    this._blocking = true;

    this.closeBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dismiss();
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.classList.contains("tour-picker-backdrop")) {
        this.dismiss();
      }
    });
    overlay.addEventListener("pointerdown", (e) => e.stopPropagation());

    this.render();
  }

  render() {
    this.list.replaceChildren();
    for (const tour of this.tours) {
      this.list.appendChild(
        this.makeCard({
          id: tour.id,
          title: tour.title,
          blurb: tour.blurb,
          eyebrow: `${tour.stops.length} stops`,
        })
      );
    }
    if (this.freeFlight) {
      this.list.appendChild(
        this.makeCard({
          id: this.freeFlight.id,
          title: this.freeFlight.title,
          blurb: this.freeFlight.blurb,
          eyebrow: "No route",
          freeFlight: true,
        })
      );
    }
  }

  /**
   * @param {{ id: string, title: string, blurb: string, eyebrow: string, freeFlight?: boolean }} opts
   */
  makeCard({ id, title, blurb, eyebrow, freeFlight = false }) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = freeFlight ? "tour-card is-free-flight" : "tour-card";
    btn.dataset.tourId = id;

    const eyebrowEl = document.createElement("span");
    eyebrowEl.className = "tour-card-eyebrow";
    eyebrowEl.textContent = eyebrow;

    const titleEl = document.createElement("span");
    titleEl.className = "tour-card-title";
    titleEl.textContent = title;

    const blurbEl = document.createElement("span");
    blurbEl.className = "tour-card-blurb";
    blurbEl.textContent = blurb;

    btn.append(eyebrowEl, titleEl, blurbEl);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      this.choose(id);
    });
    return btn;
  }

  /**
   * @param {{ blocking?: boolean, activeId?: string|null }} [opts]
   */
  open({ blocking = false, activeId = null } = {}) {
    this._blocking = blocking;
    this.overlay.classList.remove("hidden");
    this.overlay.setAttribute("aria-hidden", "false");
    this.overlay.classList.toggle("is-blocking", blocking);
    this.closeBtn?.classList.toggle("hidden", blocking);
    this.eyebrowEl?.classList.toggle("hidden", blocking);
    if (this.titleEl) {
      this.titleEl.textContent = blocking
        ? "Welcome to the Exoplanet Viewer"
        : "Change tour";
    }
    if (this.leadEl) {
      this.leadEl.textContent =
        "Take a tour of some notable exoplanets, or explore the galaxy for yourself in free flight.";
    }
    for (const btn of this.list.querySelectorAll(".tour-card")) {
      const active = btn.dataset.tourId === activeId;
      btn.classList.toggle("is-active", active);
      if (active) btn.setAttribute("aria-current", "true");
      else btn.removeAttribute("aria-current");
    }
    const focusTarget =
      this.list.querySelector(".tour-card.is-active") ||
      this.list.querySelector(".tour-card");
    focusTarget?.focus();
  }

  close() {
    this.overlay.classList.add("hidden");
    this.overlay.setAttribute("aria-hidden", "true");
    this._blocking = false;
  }

  isOpen() {
    return !this.overlay.classList.contains("hidden");
  }

  isBlocking() {
    return this.isOpen() && this._blocking;
  }

  dismiss() {
    if (this._blocking) return;
    this.close();
    this.onDismiss?.();
  }

  /** @param {string} id */
  choose(id) {
    this.close();
    this.onChoose?.(id);
  }
}
