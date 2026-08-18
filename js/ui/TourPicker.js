/**
 * Full-screen tour chooser. Blocking on first load; dismissible when reopened.
 */
export class TourPicker {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.overlay
   * @param {HTMLElement} opts.list
   * @param {HTMLElement|null} opts.closeBtn
   * @param {HTMLElement|null} opts.titleEl
   * @param {import("../content/tours.js").Tour[]} opts.tours
   * @param {(id: string) => void} opts.onChoose
   * @param {(() => void)|null} [opts.onDismiss]
   */
  constructor({ overlay, list, closeBtn, titleEl, tours, onChoose, onDismiss }) {
    this.overlay = overlay;
    this.list = list;
    this.closeBtn = closeBtn;
    this.titleEl = titleEl;
    this.tours = tours;
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
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tour-card";
      btn.dataset.tourId = tour.id;

      const eyebrow = document.createElement("span");
      eyebrow.className = "tour-card-eyebrow";
      eyebrow.textContent = `${tour.stops.length} stops`;

      const title = document.createElement("span");
      title.className = "tour-card-title";
      title.textContent = tour.title;

      const blurb = document.createElement("span");
      blurb.className = "tour-card-blurb";
      blurb.textContent = tour.blurb;

      btn.append(eyebrow, title, blurb);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.choose(tour.id);
      });
      this.list.appendChild(btn);
    }
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
    if (this.titleEl) {
      this.titleEl.textContent = blocking ? "Choose a tour" : "Change tour";
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
