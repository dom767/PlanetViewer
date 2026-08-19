/**
 * Settings checkbox for the Fullscreen API.
 * Hidden when the browser cannot fullscreen a page (typical on iPhone Safari).
 */
export class FullscreenSettings {
  /**
   * @param {{ wrap: HTMLElement, input: HTMLInputElement, target?: Element, onEnter?: (() => void)|null }} opts
   */
  constructor({ wrap, input, target = document.documentElement, onEnter = null }) {
    this.wrap = wrap;
    this.input = input;
    this.target = target;
    this.onEnter = onEnter;
  }

  init() {
    if (!this._enabled()) {
      this.wrap.classList.add("hidden");
      return;
    }

    this.input.addEventListener("change", () => {
      void this._apply(this.input.checked);
    });
    document.addEventListener("fullscreenchange", () => this._sync());
    document.addEventListener("webkitfullscreenchange", () => this._sync());
    this._sync();
  }

  _enabled() {
    return Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  }

  _element() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  _sync() {
    this.input.checked = this._element() != null;
  }

  /**
   * @param {boolean} want
   */
  async _apply(want) {
    try {
      if (want) {
        if (this._element()) return;
        this.onEnter?.();
        const el = this.target;
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      } else if (this._element()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      }
    } catch {
      /* User dismissed the prompt, or the browser refused. */
    }
    this._sync();
  }
}
