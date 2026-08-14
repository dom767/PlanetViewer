import {
  createQuadBuffer,
  createSoftParticlePipeline,
  FOCUS_PLANET_PARTICLE_WGSL,
  LINE_WGSL,
  BLEND_PREMULTIPLIED,
  packInstances,
  writeInstanceBuffer,
} from "./gpu.js";
import {
  applyKeplerFrame,
  keplerReferenceFrame,
  planetOffsetAu,
  planetaryOrbitBasis,
  sampleOrbitPath,
} from "../astro/orbits.js";
import { cross3, length3, normalize3, sub3 } from "../astro/coords.js";

/** Dual-scale: AU orbits mapped into a local focus radius around the star (parsecs). */
export const FOCUS_ORBIT_RADIUS_PC = 0.85;

/**
 * Focused-planet billboard size from R / R⊕. Near-proportional so a gas giant
 * reads roughly an order of magnitude wider than a terrestrial; the small
 * exponent above 1 keeps that contrast from washing out under the screen clamp.
 */
const PLANET_SIZE_UNIT = 1.73;
const PLANET_SIZE_EXP = 1.1;
const RJUP_TO_REARTH = 11.209;

/** @param {{ radiusEarth?: number|null, radiusJupiter?: number|null }} planet */
function planetSizeFromRadius(planet) {
  const rEarth =
    planet.radiusEarth ??
    (planet.radiusJupiter != null
      ? planet.radiusJupiter * RJUP_TO_REARTH
      : 1);
  const r = Math.max(rEarth, 0.15);
  return PLANET_SIZE_UNIT * Math.pow(r, PLANET_SIZE_EXP);
}

/** Arrival overlook elevation above the system's mean planetary plane. */
export const SYSTEM_VIEW_ELEVATION = (35 * Math.PI) / 180;

/** Short crossfade when switching focused systems (seconds each phase). */
const ORBIT_FADE_SEC = 0.18;

const WORLD_UP = { x: 0, y: 0, z: 1 };

export { planetaryOrbitBasis };

/**
 * Focused-system planets/orbits in true Kepler orientation (sky/ecliptic frame).
 * Camera overlook uses planetaryOrbitBasis() so it rides parallel to that plane.
 */
export class PlanetPass {
  /**
   * @param {{device: GPUDevice, format: GPUTextureFormat}} gpu
   * @param {GPUBuffer} frameBuffer
   */
  constructor(gpu, frameBuffer) {
    this.device = gpu.device;
    this.frameBuffer = frameBuffer;
    this.quad = createQuadBuffer(gpu.device);
    this.planetPipeline = createSoftParticlePipeline(
      gpu.device,
      gpu.format,
      FOCUS_PLANET_PARTICLE_WGSL,
      BLEND_PREMULTIPLIED
    );
    this.planetBindGroup = gpu.device.createBindGroup({
      layout: this.planetPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: frameBuffer } }],
    });

    // WGSL uniform OrbitStyle { f32, vec3f } aligns to 32 bytes
    this.opacityBuffer = gpu.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._opacity = 1;
    this._opacityData = new Float32Array(8);

    const lineModule = gpu.device.createShaderModule({ code: LINE_WGSL });
    this.linePipeline = gpu.device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: lineModule,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: 12,
            stepMode: "vertex",
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
          },
        ],
      },
      fragment: {
        module: lineModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: gpu.format,
            blend: BLEND_PREMULTIPLIED,
            writeMask: 0xf,
          },
        ],
      },
      primitive: { topology: "line-strip" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "less-equal",
      },
    });
    this.lineBindGroup = gpu.device.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: frameBuffer } },
        { binding: 1, resource: { buffer: this.opacityBuffer } },
      ],
    });

    this.instanceBuffer = null;
    this.capacity = { value: 0 };
    /** @type {Array<{ buffer: GPUBuffer, local: Float32Array, count: number }>} */
    this.orbits = [];
    this.planetCount = 0;
    this.system = null;
    this.auToPc = 1;
    this._refFrame = null;

    /** @type {null | 'out' | 'hold' | 'in'} */
    this._fadePhase = null;
    this._fadeT = 0;
    /** @type {object|null} */
    this._pendingSystem = null;
  }

  /**
   * @param {object|null} system
   * @param {{ex:object,ey:object,ez:object}|null} [_orbitBasis] unused; camera owns overlook basis
   */
  setFocusedSystem(system, _orbitBasis = null) {
    const next = system && system.planets?.length ? system : null;
    const curId = this.system?.id ?? this.system?.name ?? null;
    const nextId = next?.id ?? next?.name ?? null;

    if (curId != null && nextId != null && curId === nextId) {
      return;
    }

    // Already fading toward this target
    if (
      this._pendingSystem &&
      (this._pendingSystem.id ?? this._pendingSystem.name) === nextId
    ) {
      return;
    }

    this._pendingSystem = next;

    if (this.system && this.orbits.length && this._opacity > 0.004) {
      // Fade current orbits out, then swap; fade-in waits for camera arrive/orbit
      this._fadePhase = "out";
      this._fadeT = 0;
    } else {
      this._destroyOrbits();
      this._loadSystem(next);
      this._fadePhase = next ? "hold" : null;
      this._fadeT = 0;
      this._opacity = next ? 0 : 1;
      this._pendingSystem = null;
    }
  }

  _destroyOrbits() {
    for (const o of this.orbits) o.buffer.destroy();
    this.orbits = [];
    this.planetCount = 0;
  }

  /** @param {object|null} system */
  _loadSystem(system) {
    this._destroyOrbits();
    this.system = system;
    this._refFrame = system ? keplerReferenceFrame(system) : null;
    if (!system) {
      this.auToPc = 1;
      return;
    }

    let maxA = 0;
    for (const p of system.planets) {
      if (p.a && p.a > maxA) maxA = p.a;
    }
    maxA = Math.max(maxA, 0.05);
    this.auToPc = FOCUS_ORBIT_RADIUS_PC / maxA;

    for (const planet of system.planets) {
      if (!planet.a) continue;
      const path = sampleOrbitPath(planet, 160);
      const local = new Float32Array(path.length + 3);
      local.set(path);
      local[path.length] = path[0];
      local[path.length + 1] = path[1];
      local[path.length + 2] = path[2];

      const buffer = this.device.createBuffer({
        size: local.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.orbits.push({ buffer, local, count: local.length / 3 });
    }
  }

  _writeOpacity() {
    this._opacityData[0] = this._opacity;
    this.device.queue.writeBuffer(this.opacityBuffer, 0, this._opacityData);
  }

  /**
   * @param {number} tDays
   * @param {{x:number,y:number,z:number}} _cameraPos
   * @param {{ orbitSettled?: boolean, revealOrbits?: boolean, dt?: number }} [opts]
   */
  update(tDays, _cameraPos, opts = {}) {
    const dt = Math.min(opts.dt ?? 1 / 60, 0.05);
    const reveal =
      opts.revealOrbits != null ? !!opts.revealOrbits : !!opts.orbitSettled;

    if (this._fadePhase === "out") {
      this._fadeT += dt;
      const u = Math.min(1, this._fadeT / ORBIT_FADE_SEC);
      this._opacity = 1 - u;
      if (u >= 1) {
        this._loadSystem(this._pendingSystem);
        this._pendingSystem = null;
        if (this.system) {
          this._fadePhase = "hold";
          this._fadeT = 0;
          this._opacity = 0;
        } else {
          this._fadePhase = null;
          this._opacity = 1;
        }
      }
    } else if (this._fadePhase === "hold") {
      this._opacity = 0;
      if (reveal) {
        this._fadePhase = "in";
        this._fadeT = 0;
      }
    } else if (this._fadePhase === "in") {
      this._fadeT += dt;
      const u = Math.min(1, this._fadeT / ORBIT_FADE_SEC);
      this._opacity = u;
      if (u >= 1) {
        this._fadePhase = null;
        this._opacity = 1;
      }
    }

    this._writeOpacity();

    const system = this.system;
    const frame = this._refFrame;
    if (!system || !frame) {
      this.planetCount = 0;
      return;
    }

    for (const orbit of this.orbits) {
      const world = new Float32Array(orbit.local.length);
      for (let i = 0; i < orbit.local.length; i += 3) {
        const w = applyKeplerFrame(frame, {
          x: orbit.local[i] * this.auToPc,
          y: orbit.local[i + 1] * this.auToPc,
          z: orbit.local[i + 2] * this.auToPc,
        });
        world[i] = system.x + w.x;
        world[i + 1] = system.y + w.y;
        world[i + 2] = system.z + w.z;
      }
      this.device.queue.writeBuffer(orbit.buffer, 0, world);
    }

    const items = [];
    const bright = this._opacity;
    for (const planet of system.planets) {
      const off = planetOffsetAu(planet, tDays);
      if (!off) continue;
      const w = applyKeplerFrame(frame, {
        x: off.x * this.auToPc,
        y: off.y * this.auToPc,
        z: off.z * this.auToPc,
      });
      items.push({
        x: system.x + w.x,
        y: system.y + w.y,
        z: system.z + w.z,
        color: planet.color || [0.55, 0.75, 1.0],
        size: planetSizeFromRadius(planet),
        brightness: bright,
      });
    }

    this.planetCount = items.length;
    if (!this.planetCount) return;
    const data = packInstances(items);
    this.instanceBuffer = writeInstanceBuffer(
      this.device,
      this.instanceBuffer,
      data,
      this.capacity
    );
  }

  /** @param {GPURenderPassEncoder} pass */
  draw(pass) {
    if (!this.system && !this.orbits.length) return;
    if (this._opacity < 0.004 && this._fadePhase !== "out") return;

    if (this.orbits.length) {
      pass.setPipeline(this.linePipeline);
      pass.setBindGroup(0, this.lineBindGroup);
      for (const orbit of this.orbits) {
        pass.setVertexBuffer(0, orbit.buffer);
        pass.draw(orbit.count);
      }
    }

    if (this.planetCount && this.instanceBuffer && this._opacity > 0.004) {
      pass.setPipeline(this.planetPipeline);
      pass.setBindGroup(0, this.planetBindGroup);
      pass.setVertexBuffer(0, this.quad);
      pass.setVertexBuffer(1, this.instanceBuffer);
      pass.draw(6, this.planetCount);
    }
  }
}

/**
 * Fallback when a target has no planet elements: tip a plane under the approach view.
 */
export function cameraAlignedOrbitBasis(star, cameraPos, elevation = SYSTEM_VIEW_ELEVATION) {
  const forward = normalize3(sub3(star, cameraPos));
  let right = cross3(forward, WORLD_UP);
  if (length3(right) < 1e-5) {
    right = cross3(forward, { x: 1, y: 0, z: 0 });
  }
  right = normalize3(right);
  const camUp = normalize3(cross3(right, forward));
  const s = Math.sin(elevation);
  const c = Math.cos(elevation);
  const ey = normalize3({
    x: -forward.x * s + camUp.x * c,
    y: -forward.y * s + camUp.y * c,
    z: -forward.z * s + camUp.z * c,
  });
  let ez = cross3(right, ey);
  if (length3(ez) < 1e-5) {
    ez = normalize3(cross3(right, WORLD_UP));
  } else {
    ez = normalize3(ez);
  }
  const exOrtho = normalize3(cross3(ey, ez));
  return { ex: exOrtho, ey, ez };
}
