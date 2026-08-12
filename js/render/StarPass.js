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
  }

  /**
   * @param {Array<{x:number,y:number,z:number,color:[number,number,number],size:number,brightness:number}>} stars
   */
  upload(stars) {
    this.count = stars.length;
    const data = packInstances(stars);
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
