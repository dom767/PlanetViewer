import {
  createQuadBuffer,
  createFocusPlanetPipeline,
  MAP_PLANET_LIT_WGSL,
  BLEND_PREMULTIPLIED,
  packLitPlanetInstances,
  writeInstanceBuffer,
} from "./gpu.js";
import {
  applyKeplerFrame,
  keplerReferenceFrame,
  planetOffsetAu,
} from "../astro/orbits.js";

/** Notional outer orbit radius on the galactic map (parsecs). */
export const MAP_ORBIT_RADIUS_PC = 0.45;

export class MapPlanetsPass {
  /**
   * @param {{device: GPUDevice, format: GPUTextureFormat}} gpu
   * @param {GPUBuffer} frameBuffer
   */
  constructor(gpu, frameBuffer) {
    this.device = gpu.device;
    this.quad = createQuadBuffer(gpu.device);
    this.pipeline = createFocusPlanetPipeline(
      gpu.device,
      gpu.format,
      MAP_PLANET_LIT_WGSL,
      BLEND_PREMULTIPLIED
    );
    this.bindGroup = gpu.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: frameBuffer } }],
    });
    this.instanceBuffer = null;
    this.capacity = { value: 0 };
    this.count = 0;
    /** @type {Array<{system: object, auToPc: number, planets: object[]}>} */
    this.entries = [];
  }

  /** @param {import('../catalog/Catalog.js').Catalog} catalog */
  upload(catalog) {
    this.entries = [];
    for (const system of catalog.systems) {
      const planets = (system.planets || []).filter((p) => p.a && p.a > 0);
      if (!planets.length) continue;
      let maxA = 0;
      for (const p of planets) if (p.a > maxA) maxA = p.a;
      maxA = Math.max(maxA, 0.05);
      this.entries.push({
        system,
        auToPc: MAP_ORBIT_RADIUS_PC / maxA,
        planets,
      });
    }
  }

  /**
   * @param {number} tDays
   * @param {{x:number,y:number,z:number}} cameraPos
   * @param {object|null} focused
   * @param {number} [maxDistPc]
   * @param {Float32Array} [viewMatrix]
   */
  update(tDays, cameraPos, focused, maxDistPc = 120, viewMatrix = null) {
    const items = [];
    const maxDist2 = maxDistPc * maxDistPc;
    const focusedId = focused?.id;

    const camRight = viewMatrix
      ? { x: viewMatrix[0], y: viewMatrix[4], z: viewMatrix[8] }
      : { x: 1, y: 0, z: 0 };
    const camUp = viewMatrix
      ? { x: viewMatrix[1], y: viewMatrix[5], z: viewMatrix[9] }
      : { x: 0, y: 1, z: 0 };
    const camToward = viewMatrix
      ? { x: viewMatrix[2], y: viewMatrix[6], z: viewMatrix[10] }
      : { x: 0, y: 0, z: 1 };

    for (const entry of this.entries) {
      const s = entry.system;
      if (focusedId != null && s.id === focusedId) continue;

      const dx = s.x - cameraPos.x;
      const dy = s.y - cameraPos.y;
      const dz = s.z - cameraPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxDist2) continue;

      const dist = Math.sqrt(d2);
      const maxPlanets = dist < 40 ? 99 : dist < 80 ? 4 : 2;

      const frame = keplerReferenceFrame(s);
      let n = 0;
      for (const planet of entry.planets) {
        if (n >= maxPlanets) break;
        const periodDays =
          planet.periodDays && planet.periodDays > 0
            ? planet.periodDays
            : Math.sqrt(planet.a * planet.a * planet.a) * 365.25;
        const off = planetOffsetAu({ ...planet, periodDays }, tDays);
        if (!off) continue;
        const w = applyKeplerFrame(frame, {
          x: off.x * entry.auToPc,
          y: off.y * entry.auToPc,
          z: off.z * entry.auToPc,
        });
        const px = s.x + w.x;
        const py = s.y + w.y;
        const pz = s.z + w.z;
        let lx = s.x - px;
        let ly = s.y - py;
        let lz = s.z - pz;
        const llen = Math.hypot(lx, ly, lz) || 1;
        lx /= llen;
        ly /= llen;
        lz /= llen;
        const r =
          planet.radiusEarth || (planet.radiusJupiter ? planet.radiusJupiter * 11 : 2);
        items.push({
          x: px,
          y: py,
          z: pz,
          color: planet.color || [0.6, 0.75, 1.0],
          size: 2.2 + Math.min(3.5, Math.log10(r + 1) * 1.8),
          brightness: 1,
          lightDir: {
            x: lx * camRight.x + ly * camRight.y + lz * camRight.z,
            y: lx * camUp.x + ly * camUp.y + lz * camUp.z,
            z: lx * camToward.x + ly * camToward.y + lz * camToward.z,
          },
        });
        n++;
      }
    }

    this.count = items.length;
    if (!this.count) return;
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
    if (!this.count || !this.instanceBuffer) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.quad);
    pass.setVertexBuffer(1, this.instanceBuffer);
    pass.draw(6, this.count);
  }
}
