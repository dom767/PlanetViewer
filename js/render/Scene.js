import { perspective, multiply4, length3, sub3 } from "../astro/coords.js";
import { createFrameUniforms, TRAIL_HISTORY_FRAMES, BASE_TRAIL_FRAMES } from "./gpu.js";
import { StarPass } from "./StarPass.js";
import { PlanetPass } from "./PlanetPass.js";
import { MapPlanetsPass } from "./MapPlanetsPass.js";
import { HighlightPass } from "./HighlightPass.js";
import { NotablePass } from "./NotablePass.js";
import { ToneMapPass } from "./ToneMapPass.js";

/**
 * WebGPU scene: HDR particle colour → tonemap/exposure → swapchain.
 */
export class Scene {
  /**
   * @param {import('./gpu.js').createGPU extends Function ? Awaited<ReturnType<typeof import('./gpu.js').createGPU>> : any} gpu
   */
  constructor(gpu) {
    this.gpu = gpu;
    this.frameUniforms = createFrameUniforms(gpu.device);
    const sceneGpu = { ...gpu, format: gpu.hdrFormat };
    this.starPass = new StarPass(sceneGpu, this.frameUniforms.buffer);
    this.fieldStarPass = new StarPass(sceneGpu, this.frameUniforms.buffer);
    this.planetPass = new PlanetPass(sceneGpu, this.frameUniforms.buffer);
    this.mapPlanetsPass = new MapPlanetsPass(sceneGpu, this.frameUniforms.buffer);
    this.notablePass = new NotablePass(sceneGpu, this.frameUniforms.buffer);
    this.highlightPass = new HighlightPass(sceneGpu, this.frameUniforms.buffer);
    this.toneMapPass = new ToneMapPass(gpu);
    this.viewProj = new Float32Array(16);
    /** Ring of recent viewProj matrices — reconstructs each star's last N screen positions. */
    this._viewHistory = [];
    this._trailHistoryFrames = TRAIL_HISTORY_FRAMES;
    this._lastCamPos = null;
    this.fovy = (60 * Math.PI) / 180;
    this.near = 0.05;
    this.far = 5000;
    this.hoverTarget = null;
    this.focusedSystem = null;
    this.showFieldStars = false;
    this.exposure = 1;
    /** Multiplier on default trail length (0.1–2); 1 = original 16-frame look. */
    this.trailLengthScale = 1;
  }

  setExposure(value) {
    this.exposure = value;
    this.toneMapPass.setExposure(value);
  }

  /** @param {number} scale */
  setTrailLengthScale(scale) {
    const n = Number(scale);
    this.trailLengthScale = Number.isFinite(n)
      ? Math.max(0.1, Math.min(2, n))
      : 1;
  }

  /** @param {import('../catalog/Catalog.js').Catalog} catalog */
  uploadStars(catalog) {
    const stars = catalog.systems.map((s) => ({
      x: s.x,
      y: s.y,
      z: s.z,
      color: s.color,
      size: s.pointSize,
      brightness: s.brightness,
    }));
    this.starPass.upload(stars);
    this.mapPlanetsPass.upload(catalog);
    this.setNotableSystems(catalog.notableSystems);
    this._applyFocusStarSuppress();
  }

  /** @param {object[]|null|undefined} systems */
  setNotableSystems(systems) {
    this.notablePass.setSystems(systems || []);
  }

  /** @param {Array<{x:number,y:number,z:number,color:number[],size:number,brightness:number}>} stars */
  uploadFieldStars(stars) {
    this.fieldStarPass.upload(stars);
  }

  setShowFieldStars(on) {
    this.showFieldStars = !!on;
  }

  /**
   * @param {object|null} system
   * @param {{ex:object,ey:object,ez:object}|null} [orbitBasis] from FlyCamera.getOrbitBasis()
   */
  setFocusedSystem(system, orbitBasis = null) {
    this.focusedSystem = system || null;
    this.planetPass.setFocusedSystem(system, orbitBasis);
    this._applyFocusStarSuppress();
    this._syncHighlight();
  }

  _applyFocusStarSuppress() {
    const s = this.focusedSystem;
    const hide = !!(s && s.binary && !s.isSol);
    this.starPass.setSuppressedIndex(hide ? s.id : null);
  }

  setHoverTarget(system) {
    this.hoverTarget = system || null;
    this._syncHighlight();
  }

  _syncHighlight() {
    this.highlightPass.setTarget(this.hoverTarget || this.focusedSystem);
  }

  /** Call after canvas resize / teleports so trails don't spike. */
  invalidateTrailHistory() {
    this._viewHistory = [];
  }

  /**
   * @param {{viewMatrix: Float32Array, width: number, height: number, tDays: number, cameraPos: {x:number,y:number,z:number}, dt?: number}} frame
   */
  drawFrame(frame) {
    const { device, context, depthView, hdrView } = this.gpu;
    const aspect = frame.width / Math.max(frame.height, 1);
    const proj = perspective(this.fovy, aspect, this.near, this.far);
    this.viewProj = multiply4(proj, frame.viewMatrix);

    const trailStrength = this._updateTrailStrength(frame);
    const trailHistory = this._trailHistoryForUpload();

    this.mapPlanetsPass.update(
      frame.tDays,
      frame.cameraPos,
      this.focusedSystem,
      120,
      frame.viewMatrix
    );
    this.planetPass.update(frame.tDays, frame.cameraPos, {
      orbitSettled: !!frame.orbitSettled,
      revealOrbits: frame.revealOrbits != null
        ? !!frame.revealOrbits
        : !!frame.orbitSettled,
      dt: frame.dt ?? 1 / 60,
      viewMatrix: frame.viewMatrix,
    });
    const highlightTarget = this.hoverTarget || this.focusedSystem;
    const skipFocusRing =
      !!this.focusedSystem?.binary &&
      highlightTarget === this.focusedSystem;
    const highlightingFocus =
      !!highlightTarget &&
      !!this.focusedSystem &&
      highlightTarget === this.focusedSystem;
    const highlightOpacity = skipFocusRing
      ? 0
      : highlightingFocus
        ? Math.max(0, Math.min(1, frame.focusHighlightOpacity ?? 1))
        : 1;
    this.highlightPass.prepare(this.viewProj, frame.width, highlightOpacity);
    this.notablePass.prepare(this.viewProj, frame.width);

    this.frameUniforms.write(
      device.queue,
      this.viewProj,
      trailHistory,
      frame.width,
      frame.height,
      performance.now() * 0.001,
      trailStrength,
      this.trailLengthScale
    );

    this.toneMapPass.setHdrView(hdrView);
    this.toneMapPass.setExposure(this.exposure);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: hdrView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    if (this.showFieldStars) this.fieldStarPass.draw(pass);
    this.starPass.draw(pass);
    this.mapPlanetsPass.draw(pass);
    this.planetPass.draw(pass);
    this.notablePass.draw(pass);
    this.highlightPass.draw(pass);

    pass.end();

    this.toneMapPass.draw(encoder, context.getCurrentTexture().createView());
    device.queue.submit([encoder.finish()]);

    this._pushViewHistory(this.viewProj);

    return this.viewProj;
  }

  /** Oldest→newest list of length TRAIL_HISTORY_FRAMES (pads with current if warming up). */
  _trailHistoryForUpload() {
    const n = this._trailHistoryFrames;
    const out = new Array(n);
    const hist = this._viewHistory;
    for (let i = 0; i < n; i++) {
      if (hist.length >= n) {
        out[i] = hist[i];
      } else if (hist.length > 0) {
        // Warm-up: repeat oldest available so segments collapse harmlessly
        out[i] = hist[Math.min(i, hist.length - 1)];
      } else {
        out[i] = this.viewProj;
      }
    }
    return out;
  }

  /** @param {Float32Array} viewProj */
  _pushViewHistory(viewProj) {
    const copy = new Float32Array(16);
    copy.set(viewProj);
    this._viewHistory.push(copy);
    while (this._viewHistory.length > this._trailHistoryFrames) {
      this._viewHistory.shift();
    }
  }

  /** @param {{cameraPos: {x:number,y:number,z:number}}} frame */
  _updateTrailStrength(frame) {
    const pos = frame.cameraPos;
    // Enough history for the default trail; longer scales fill in as the ring grows.
    let ok = this._viewHistory.length >= BASE_TRAIL_FRAMES;
    if (this._lastCamPos) {
      const jump = length3(sub3(pos, this._lastCamPos));
      if (jump > 120) {
        ok = false;
        this.invalidateTrailHistory();
      }
    }
    this._lastCamPos = { x: pos.x, y: pos.y, z: pos.z };
    return ok ? 1 : 0;
  }
}
