const MIN_W = 320;
const MIN_H = 240;
const MAX_W = 4096;
const MAX_H = 4096;

/**
 * Width / height fields for the WebGPU canvas; Change resizes the browser window.
 */
export class CanvasSizeSettings {
  /**
   * @param {{ canvas: HTMLCanvasElement, widthInput: HTMLInputElement, heightInput: HTMLInputElement, applyBtn: HTMLButtonElement, hintEl?: HTMLElement|null }} opts
   */
  constructor({ canvas, widthInput, heightInput, applyBtn, hintEl = null }) {
    this.canvas = canvas;
    this.widthInput = widthInput;
    this.heightInput = heightInput;
    this.applyBtn = applyBtn;
    this.hintEl = hintEl;
    this.appliedW = 0;
    this.appliedH = 0;
  }

  init() {
    this.appliedW = this.canvas.clientWidth;
    this.appliedH = this.canvas.clientHeight;
    this.widthInput.value = String(this.appliedW);
    this.heightInput.value = String(this.appliedH);

    const onInput = () => this.syncButton();
    this.widthInput.addEventListener("input", onInput);
    this.heightInput.addEventListener("change", onInput);
    this.heightInput.addEventListener("input", onInput);
    this.widthInput.addEventListener("change", onInput);
    this.applyBtn.addEventListener("click", () => this.apply());

    window.addEventListener("resize", () => {
      this.appliedW = this.canvas.clientWidth;
      this.appliedH = this.canvas.clientHeight;
      this.syncButton();
    });

    this.syncButton();
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

    const chromeW = Math.max(0, window.outerWidth - window.innerWidth);
    const chromeH = Math.max(0, window.outerHeight - window.innerHeight);
    const nextOuterW = target.w + chromeW;
    const nextOuterH = target.h + chromeH;

    try {
      window.resizeTo(nextOuterW, nextOuterH);
    } catch {
      this._setHint("This browser blocked window resize.");
      return;
    }

    requestAnimationFrame(() => {
      const gotW = this.canvas.clientWidth;
      const gotH = this.canvas.clientHeight;
      if (
        Math.abs(gotW - target.w) > 2 ||
        Math.abs(gotH - target.h) > 2
      ) {
        this._setHint(
          "Window resize was blocked or clamped — try a popup window."
        );
      } else {
        this._setHint(null);
      }
      this.appliedW = gotW;
      this.appliedH = gotH;
      this.syncButton();
    });
  }

  /** @param {string|null} text */
  _setHint(text) {
    if (!this.hintEl) return;
    if (text) {
      this.hintEl.textContent = text;
      this.hintEl.classList.remove("hidden");
    } else {
      this.hintEl.textContent = "";
      this.hintEl.classList.add("hidden");
    }
  }
}
