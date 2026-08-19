const MIN_W = 320;
const MIN_H = 240;
const MAX_W = 4096;
const MAX_H = 4096;
/** Browsers apply window.resizeTo asynchronously; wait before measuring. */
const RESIZE_SETTLE_MS = 220;

/**
 * Width / height fields for the WebGPU canvas.
 *
 * Browsers only honour window.resizeTo for windows opened by script, so when the
 * window will not move the view is letterboxed to the requested size instead.
 */
export class CanvasSizeSettings {
  /**
   * @param {{ canvas: HTMLCanvasElement, root: HTMLElement, widthInput: HTMLInputElement, heightInput: HTMLInputElement, applyBtn: HTMLButtonElement, popOutBtn?: HTMLButtonElement|null, hintEl?: HTMLElement|null }} opts
   */
  constructor({
    canvas,
    root,
    widthInput,
    heightInput,
    applyBtn,
    popOutBtn = null,
    hintEl = null,
  }) {
    this.canvas = canvas;
    this.root = root;
    this.widthInput = widthInput;
    this.heightInput = heightInput;
    this.applyBtn = applyBtn;
    this.popOutBtn = popOutBtn;
    this.hintEl = hintEl;
    this.appliedW = 0;
    this.appliedH = 0;
  }

  init() {
    this._measure();
    this.widthInput.value = String(this.appliedW);
    this.heightInput.value = String(this.appliedH);

    for (const input of [this.widthInput, this.heightInput]) {
      input.addEventListener("input", () => this.syncButton());
      input.addEventListener("change", () => this.syncButton());
    }
    this.applyBtn.addEventListener("click", () => this.apply());
    this.popOutBtn?.addEventListener("click", () => this.popOut());

    window.addEventListener("resize", () => {
      this._measure();
      this.syncButton();
    });

    this.syncButton();
  }

  _measure() {
    this.appliedW = this.canvas.clientWidth;
    this.appliedH = this.canvas.clientHeight;
  }

  /** @returns {{ w: number, h: number } | null} */
  _readTarget() {
    const w = Number.parseInt(this.widthInput.value, 10);
    const h = Number.parseInt(this.heightInput.value, 10);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    if (w < MIN_W || w > MAX_W || h < MIN_H || h > MAX_H) return null;
    return { w, h };
  }

  syncButton() {
    const target = this._readTarget();
    const dirty =
      target != null &&
      (target.w !== this.appliedW || target.h !== this.appliedH);
    this.applyBtn.disabled = !dirty;
  }

  apply() {
    const target = this._readTarget();
    if (!target) return;
    this._setHint(null);

    // Full-viewport request: drop any letterbox so the canvas fills the window.
    if (target.w >= window.innerWidth && target.h >= window.innerHeight) {
      this._clearLetterbox();
    }

    try {
      window.resizeTo(
        target.w + Math.max(0, window.outerWidth - window.innerWidth),
        target.h + Math.max(0, window.outerHeight - window.innerHeight)
      );
    } catch {
      /* Blocked outside script-opened windows; the letterbox below covers it. */
    }

    window.setTimeout(() => {
      if (!this._matches(target)) this._letterbox(target);
      requestAnimationFrame(() => {
        this._measure();
        this.syncButton();
        this._reportResult(target);
      });
    }, RESIZE_SETTLE_MS);
  }

  /** Opens a script-owned window, the only kind browsers let us size directly. */
  popOut() {
    const target = this._readTarget() ?? {
      w: this.appliedW,
      h: this.appliedH,
    };
    const opened = window.open(
      window.location.href,
      "exoplanet-viewer-view",
      `popup=yes,width=${target.w},height=${target.h}`
    );
    if (!opened) this._setHint("Pop-up blocked — allow pop-ups for this site.");
  }

  /** @param {{ w: number, h: number }} target */
  _matches({ w, h }) {
    return (
      Math.abs(this.canvas.clientWidth - w) <= 2 &&
      Math.abs(this.canvas.clientHeight - h) <= 2
    );
  }

  /** @param {{ w: number, h: number }} target */
  _letterbox({ w, h }) {
    this.root.style.setProperty("--view-w", `${w}px`);
    this.root.style.setProperty("--view-h", `${h}px`);
    this.root.classList.add("view-fixed");
  }

  /** Drop letterboxing so the canvas fills the current window (e.g. fullscreen). */
  fillWindow() {
    this._clearLetterbox();
  }

  _clearLetterbox() {
    this.root.classList.remove("view-fixed");
    this.root.style.removeProperty("--view-w");
    this.root.style.removeProperty("--view-h");
  }

  /** @param {{ w: number, h: number }} target */
  _reportResult(target) {
    if (!this._matches(target)) {
      this._setHint(
        `Window is too small — view clamped to ${this.appliedW}×${this.appliedH}.`
      );
    } else if (this.root.classList.contains("view-fixed")) {
      this._setHint(
        "This browser only resizes windows it opened, so the view is letterboxed. Use Pop out for a real window of this size."
      );
    } else {
      this._setHint(null);
    }
  }

  /** @param {string|null} text */
  _setHint(text) {
    if (!this.hintEl) return;
    this.hintEl.textContent = text ?? "";
    this.hintEl.classList.toggle("hidden", !text);
  }
}
