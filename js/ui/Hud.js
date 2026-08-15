import { daysSinceJ2000, formatUtcDate, j2000DaysToDate } from "../astro/epoch.js";

export class Hud {
  constructor(els) {
    this.selection = els.selection;
    this.distance = els.distance;
    this.note = els.note;
    this.noteBlock = els.noteBlock;
    this.noteNext = els.noteNext;
    this.timeSpeed = els.timeSpeed;
    this.simClock = els.simClock;
    this.exposureInput = els.exposure;
    this.exposureValue = els.exposureValue;
    this.trailLengthInput = els.trailLength;
    this.trailLengthValue = els.trailLengthValue;
    /** Days since J2000.0 — Sol planets use this as ephemeris time. */
    this.simDays = daysSinceJ2000(new Date());
    this.speed = Number(this.timeSpeed.value);
    this.exposure = Number(this.exposureInput?.value ?? 1);
    this.trailLengthScale = Number(this.trailLengthInput?.value ?? 1);
    /** @type {((v: number) => void) | null} */
    this.onExposureChange = null;
    /** @type {((v: number) => void) | null} */
    this.onTrailLengthChange = null;
    /** @type {(() => void) | null} */
    this.onNextNotable = null;

    this.timeSpeed.addEventListener("change", () => {
      this.speed = Number(this.timeSpeed.value);
    });
    this.noteNext?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onNextNotable?.();
    });

    const syncExposure = () => {
      this.exposure = Number(this.exposureInput.value);
      if (this.exposureValue) {
        this.exposureValue.textContent = `${this.exposure.toFixed(2)}×`;
      }
      this.onExposureChange?.(this.exposure);
    };
    this.exposureInput?.addEventListener("input", syncExposure);
    syncExposure();

    const syncTrailLength = () => {
      this.trailLengthScale = Number(this.trailLengthInput.value);
      if (this.trailLengthValue) {
        this.trailLengthValue.textContent = `${this.trailLengthScale.toFixed(2)}×`;
      }
      this.onTrailLengthChange?.(this.trailLengthScale);
    };
    this.trailLengthInput?.addEventListener("input", syncTrailLength);
    syncTrailLength();
  }

  /**
   * @param {string} name
   * @param {number|null|undefined} distPc
   * @param {boolean} focused
   * @param {string|null|undefined} [noteText]
   */
  setSelection(name, distPc, focused, noteText = null) {
    this.selection.textContent = name;
    if (name === "Sol") {
      this.distance.textContent = "";
    } else if (distPc != null && name !== "Free flight") {
      this.distance.textContent = `${distPc.toFixed(2)} pc from Sol`;
    } else if (name === "Free flight") {
      this.distance.textContent = distPc != null ? `${distPc.toFixed(2)} pc from origin` : "";
    } else {
      this.distance.textContent = "";
    }
    this.setNote(focused ? noteText : null);
  }

  /** @param {string|null|undefined} text */
  setNote(text) {
    const body = text && String(text).trim();
    if (this.note) this.note.textContent = body || "";
    this.noteBlock?.classList.toggle("hidden", !body);
  }

  tick(dtSec) {
    this.simDays += this.speed * dtSec;
    if (this.simClock) {
      const date = j2000DaysToDate(this.simDays);
      this.simClock.textContent = formatUtcDate(date);
    }
    return this.simDays;
  }
}
