import {
  createQuadBuffer,
  createSoftParticlePipeline,
  createTrailParticlePipeline,
  STAR_WGSL,
  STAR_TRAIL_WGSL,
  TRAIL_SEGMENTS,
  BLEND_ADDITIVE,
  packInstances,
  writeInstanceBuffer,
} from "./gpu.js";

export class StarPass {
  /**
   * @param {{device: GPUDevice, format: GPUTextureFormat}} gpu
   * @param {GPUBuffer} frameBuffer
   */
  constructor(gpu, frameBuffer) {
    this.device = gpu.device;
    this.quad = createQuadBuffer(gpu.device);

    this.starPipeline = createSoftParticlePipeline(
      gpu.device,
      gpu.format,
      STAR_WGSL,
      BLEND_ADDITIVE
    );
    this.trailPipeline = createTrailParticlePipeline(
      gpu.device,
      gpu.format,
      STAR_TRAIL_WGSL,
      BLEND_ADDITIVE
    );

    this.starBindGroup = gpu.device.createBindGroup({
      layout: this.starPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: frameBuffer } }],
    });
    this.trailBindGroup = gpu.device.createBindGroup({
      layout: this.trailPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: frameBuffer } }],
    });

    this.instanceBuffer = null;
    this.capacity = { value: 0 };
    this.count = 0;
    /** Packed instance data so a focused close-binary can zero one host. */
    this._packed = null;
    /** @type {number|null} */
    this._suppressedIndex = null;
  }

  /**
   * @param {Array<{x:number,y:number,z:number,color:[number,number,number],size:number,brightness:number}>} stars
   */
  upload(stars) {
    this.count = stars.length;
    this._packed = packInstances(stars);
    this._suppressedIndex = null;
    this.instanceBuffer = writeInstanceBuffer(
      this.device,
      this.instanceBuffer,
      this._packed,
      this.capacity
    );
  }

  /**
   * Hide one map star (focused close binary) without rebuilding the catalog GPU buffer.
   * @param {number|null} index
   */
  setSuppressedIndex(index) {
    if (!this._packed || this.count <= 0) {
      this._suppressedIndex = null;
      return;
    }
    const next = index != null && index >= 0 && index < this.count ? index : null;
    if (next === this._suppressedIndex) return;
    this._suppressedIndex = next;
    const data = this._packed.slice();
    if (next != null) {
      const o = next * 8;
      data[o + 6] = 0;
      data[o + 7] = 0;
    }
    this.instanceBuffer = writeInstanceBuffer(
      this.device,
      this.instanceBuffer,
      data,
      this.capacity
    );
  }

  /**
   * Trails first (under), then circular stars on top at the true position.
   * @param {GPURenderPassEncoder} pass
   */
  draw(pass) {
    if (!this.count || !this.instanceBuffer) return;

    pass.setPipeline(this.trailPipeline);
    pass.setBindGroup(0, this.trailBindGroup);
    pass.setVertexBuffer(0, this.instanceBuffer);
    pass.draw(6 * TRAIL_SEGMENTS, this.count);

    pass.setPipeline(this.starPipeline);
    pass.setBindGroup(0, this.starBindGroup);
    pass.setVertexBuffer(0, this.quad);
    pass.setVertexBuffer(1, this.instanceBuffer);
    pass.draw(6, this.count);
  }
}
