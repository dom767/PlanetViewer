import { daysSinceJ2000, formatUtcDate, j2000DaysToDate } from "../astro/epoch.js";
import { getSystemImage } from "../content/systemImages.js";

export class Hud {
  constructor(els) {
    this.selection = els.selection;
    this.photo = els.photo;
    this.distance = els.distance;
    this.note = els.note;
    this.noteBlock = els.noteBlock;
    this.noteNext = els.noteNext;
    this.tourMeta = els.tourMeta;
    this.changeTour = els.changeTour;
    this.timeSpeed = els.timeSpeed;
    this.simClock = els.simClock;
    this.exposureInput = els.exposure;
    this.exposureValue = els.exposureValue;
    this.trailLengthInput = els.trailLength;
    this.trailLengthValue = els.trailLengthValue;
    this.cameraSpeedInput = els.cameraSpeed;
    this.cameraSpeedValue = els.cameraSpeedValue;
    /** Days since J2000.0 — Sol planets use this as ephemeris time. */
    this.simDays = daysSinceJ2000(new Date());
    this.speed = Number(this.timeSpeed.value);
    this.exposure = Number(this.exposureInput?.value ?? 1);
    this.trailLengthScale = Number(this.trailLengthInput?.value ?? 1);
    this.cameraSpeed = Number(this.cameraSpeedInput?.value ?? 1);
    this._tourActive = false;
    /** @type {((v: number) => void) | null} */
    this.onExposureChange = null;
    /** @type {((v: number) => void) | null} */
    this.onTrailLengthChange = null;
    /** @type {((v: number) => void) | null} */
    this.onCameraSpeedChange = null;
    /** @type {(() => void) | null} */
    this.onNextNotable = null;
    /** @type {(() => void) | null} */
    this.onChangeTour = null;

    this.timeSpeed.addEventListener("change", () => {
      this.speed = Number(this.timeSpeed.value);
    });
    this.noteNext?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onNextNotable?.();
    });
    this.changeTour?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onChangeTour?.();
    });
    this.photo?.addEventListener("error", () => {
      this.photo.classList.add("hidden");
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

    const syncCameraSpeed = () => {
      this.cameraSpeed = Number(this.cameraSpeedInput.value);
      if (this.cameraSpeedValue) {
        this.cameraSpeedValue.textContent = `${this.cameraSpeed.toFixed(2)}×`;
      }
      this.onCameraSpeedChange?.(this.cameraSpeed);
    };
    this.cameraSpeedInput?.addEventListener("input", syncCameraSpeed);
    syncCameraSpeed();
  }

  /**
   * @param {string} name
   * @param {number|null|undefined} distPc
   * @param {boolean} focused
   * @param {string|null|undefined} [noteText]
   * @param {string|null|undefined} [catalogName] system.name for image lookup
   */
  setSelection(name, distPc, focused, noteText = null, catalogName = null) {
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
    this.setPhoto(focused ? catalogName : null);
  }

  /** @param {string|null|undefined} catalogName */
  setPhoto(catalogName) {
    if (!this.photo) return;
    const img = catalogName ? getSystemImage(catalogName) : null;
    if (!img?.src) {
      this.photo.classList.add("hidden");
      this.photo.removeAttribute("src");
      this.photo.alt = "";
      return;
    }
    if (this.photo.getAttribute("src") !== img.src) {
      this.photo.src = img.src;
    }
    this.photo.alt = img.alt || "";
    this.photo.classList.remove("hidden");
  }

  /**
   * @param {{ active: boolean, title?: string, index?: number, total?: number }} state
   */
  setTourState(state) {
    this._tourActive = !!state?.active;
    const title = state?.title || "";
    const total = Number(state?.total) || 0;
    const index = Number(state?.index) || 0;
    if (this.tourMeta) {
      if (this._tourActive && title && total > 0) {
        this.tourMeta.textContent = `${title} · ${index + 1} / ${total}`;
        this.tourMeta.classList.remove("hidden");
      } else {
        this.tourMeta.textContent = "";
        this.tourMeta.classList.add("hidden");
      }
    }
    if (this.noteNext) {
      this.noteNext.setAttribute(
        "aria-label",
        title ? `Next stop on ${title} tour` : "Next tour stop"
      );
    }
    this.syncNoteBlock();
  }

  /** @param {string|null|undefined} text */
  setNote(text) {
    const body = text && String(text).trim();
    if (this.note) {
      this.note.textContent = body || "";
      this.note.classList.toggle("hidden", !body);
    }
    this.syncNoteBlock();
  }

  syncNoteBlock() {
    const hasNote = !!(this.note?.textContent && this.note.textContent.trim());
    this.noteBlock?.classList.toggle("hidden", !this._tourActive && !hasNote);
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
