import {
  createQuadBuffer,
  createFocusPlanetPipeline,
  FOCUS_PLANET_PARTICLE_WGSL,
  LINE_WGSL,
  BLEND_PREMULTIPLIED,
  packLitPlanetInstances,
  writeInstanceBuffer,
} from "./gpu.js";
import {
  applyKeplerFrame,
  binaryStarOffsetsAu,
  keplerReferenceFrame,
  planetOffsetAu,
  planetaryOrbitBasis,
  sampleOrbitPath,
} from "../astro/orbits.js";
import { cross3, length3, normalize3, sub3 } from "../astro/coords.js";
import { planetRadiusEarth } from "../astro/planetType.js";

/** Dual-scale: AU orbits mapped into a local focus radius around the star (parsecs). */
export const FOCUS_ORBIT_RADIUS_PC = 0.85;

/**
 * Focused-planet billboard size from R / R⊕. Near-proportional so a gas giant
 * reads roughly an order of magnitude wider than a terrestrial; the small
 * exponent above 1 keeps that contrast from washing out under the screen clamp.
 */
const PLANET_SIZE_UNIT = 1.73;
const PLANET_SIZE_EXP = 1.1;
const PLANET_SIZE_MIN = 0.9;

/**
 * Compact systems have their orbits stretched hard by auToPc, which would leave
 * their planets as specks. Boost size by a heavily compressed function of that
 * stretch: enough to feel inhabited, small enough that absolute radius still
 * says "gas giant" or "rocky" at a glance.
 */
const SIZE_BOOST_REFERENCE_AU = 30.07;
const SIZE_BOOST_EXP = 0.25;
const SIZE_BOOST_MAX = 4.5;

/** @param {{ radiusEarth?: number|null, radiusJupiter?: number|null }} planet */
function planetSizeFromRadius(planet) {
  const rEarth = planetRadiusEarth(planet) ?? 1;
  const r = Math.max(rEarth, 0.15);
  return PLANET_SIZE_UNIT * Math.pow(r, PLANET_SIZE_EXP);
}

/** @param {number} maxA outermost semi-major axis (AU) */
function orbitStretchBoost(maxA) {
  const stretch = SIZE_BOOST_REFERENCE_AU / Math.max(maxA, 1e-4);
  if (stretch <= 1) return 1;
  return Math.min(SIZE_BOOST_MAX, Math.pow(stretch, SIZE_BOOST_EXP));
}

/** Billboard size from R / R☉ so A and B stay larger than planets and distinct. */
function starDiscSize(radiusSolar, sizeBoost) {
  const r = Math.max(radiusSolar || 1, 0.08);
  return (12 + 22 * Math.sqrt(r)) * Math.max(sizeBoost, 1);
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
    this.planetPipeline = createFocusPlanetPipeline(
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
    this.sizeBoost = 1;
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
      this.sizeBoost = 1;
      return;
    }

    let maxA = 0;
    for (const p of system.planets) {
      if (p.a && p.a > maxA) maxA = p.a;
    }
    if (system.binary?.a) maxA = Math.max(maxA, system.binary.a);
    maxA = Math.max(maxA, 0.05);
    this.auToPc = FOCUS_ORBIT_RADIUS_PC / maxA;
    this.sizeBoost = orbitStretchBoost(maxA);

    for (const planet of system.planets) {
      if (!planet.a) continue;
      this._pushOrbit(sampleOrbitPath(planet, 160), {
        originKey: planet.around === "A" ? "A" : "bary",
        scale: 1,
      });
    }

    const binary = system.binary;
    if (binary?.a) {
      const m1 = binary.stars[0]?.mass > 0 ? binary.stars[0].mass : 1;
      const m2 = binary.stars[1]?.mass > 0 ? binary.stars[1].mass : 0.5;
      const q = m2 / (m1 + m2);
      const path = sampleOrbitPath(binary, 160);
      this._pushOrbit(path, { originKey: "bary", scale: -q });
      this._pushOrbit(path, { originKey: "bary", scale: 1 - q });
    }
  }

  /**
   * @param {Float32Array} path
   * @param {{originKey: string, scale: number}} opts
   */
  _pushOrbit(path, opts) {
    if (!path.length) return;
    const local = new Float32Array(path.length + 3);
    local.set(path);
    local[path.length] = path[0];
    local[path.length + 1] = path[1];
    local[path.length + 2] = path[2];
    const buffer = this.device.createBuffer({
      size: local.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.orbits.push({
      buffer,
      local,
      count: local.length / 3,
      originKey: opts.originKey,
      scale: opts.scale,
    });
  }

  _writeOpacity() {
    this._opacityData[0] = this._opacity;
    this.device.queue.writeBuffer(this.opacityBuffer, 0, this._opacityData);
  }

  /**
   * @param {number} tDays
   * @param {{x:number,y:number,z:number}} _cameraPos
   * @param {{ orbitSettled?: boolean, revealOrbits?: boolean, dt?: number, viewMatrix?: Float32Array }} [opts]
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

    const starOff = system.binary
      ? binaryStarOffsetsAu(system.binary, tDays)
      : null;

    for (const orbit of this.orbits) {
      let ox = 0;
      let oy = 0;
      let oz = 0;
      if (orbit.originKey === "A" && starOff) {
        ox = starOff.A.x;
        oy = starOff.A.y;
        oz = starOff.A.z;
      }
      const sc = orbit.scale ?? 1;
      const world = new Float32Array(orbit.local.length);
      for (let i = 0; i < orbit.local.length; i += 3) {
        const w = applyKeplerFrame(frame, {
          x: (orbit.local[i] * sc + ox) * this.auToPc,
          y: (orbit.local[i + 1] * sc + oy) * this.auToPc,
          z: (orbit.local[i + 2] * sc + oz) * this.auToPc,
        });
        world[i] = system.x + w.x;
        world[i + 1] = system.y + w.y;
        world[i + 2] = system.z + w.z;
      }
      this.device.queue.writeBuffer(orbit.buffer, 0, world);
    }

    // Camera axes from view matrix (see lookAt): right, up, toward-camera.
    const vm = opts.viewMatrix;
    const camRight = vm
      ? { x: vm[0], y: vm[4], z: vm[8] }
      : { x: 1, y: 0, z: 0 };
    const camUp = vm
      ? { x: vm[1], y: vm[5], z: vm[9] }
      : { x: 0, y: 1, z: 0 };
    const camToward = vm
      ? { x: vm[2], y: vm[6], z: vm[10] }
      : { x: 0, y: 0, z: 1 };

    const items = [];
    const bright = this._opacity;

    const toWorld = (offAu) => {
      const w = applyKeplerFrame(frame, {
        x: offAu.x * this.auToPc,
        y: offAu.y * this.auToPc,
        z: offAu.z * this.auToPc,
      });
      return { x: system.x + w.x, y: system.y + w.y, z: system.z + w.z };
    };

    const posA = starOff ? toWorld(starOff.A) : { x: system.x, y: system.y, z: system.z };
    const posB = starOff ? toWorld(starOff.B) : null;

    if (starOff && system.binary?.stars) {
      const pair = [system.binary.stars[0], system.binary.stars[1]];
      const pos = [posA, posB];
      for (let i = 0; i < 2; i++) {
        const star = pair[i];
        const p = pos[i];
        if (!star || !p) continue;
        items.push({
          x: p.x,
          y: p.y,
          z: p.z,
          color: star.color || [1, 0.95, 0.8],
          size: starDiscSize(star.radius, this.sizeBoost),
          brightness: bright,
          lightDir: { x: 0, y: 0, z: 1 },
        });
      }
    }

    for (const planet of system.planets) {
      const off = planetOffsetAu(planet, tDays);
      if (!off) continue;
      const origin =
        planet.around === "A" && starOff ? starOff.A : { x: 0, y: 0, z: 0 };
      const wpos = toWorld({
        x: origin.x + off.x,
        y: origin.y + off.y,
        z: origin.z + off.z,
      });
      const px = wpos.x;
      const py = wpos.y;
      const pz = wpos.z;
      const light =
        planet.around === "A" && starOff ? posA : { x: system.x, y: system.y, z: system.z };
      let lx = light.x - px;
      let ly = light.y - py;
      let lz = light.z - pz;
      const llen = Math.hypot(lx, ly, lz) || 1;
      lx /= llen;
      ly /= llen;
      lz /= llen;
      items.push({
        x: px,
        y: py,
        z: pz,
        color: planet.color || [0.55, 0.75, 1.0],
        size: Math.max(
          PLANET_SIZE_MIN,
          planetSizeFromRadius(planet) * this.sizeBoost
        ),
        brightness: bright,
        lightDir: {
          x: lx * camRight.x + ly * camRight.y + lz * camRight.z,
          y: lx * camUp.x + ly * camUp.y + lz * camUp.z,
          z: lx * camToward.x + ly * camToward.y + lz * camToward.z,
        },
      });
    }

    this.planetCount = items.length;
    if (!this.planetCount) return;
    const data = packLitPlanetInstances(items);
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
