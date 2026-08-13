import {
  createQuadBuffer,
  createSoftParticlePipeline,
  HIGHLIGHT_WGSL,
  BLEND_PREMULTIPLIED,
  packInstances,
  writeInstanceBuffer,
} from "./gpu.js";

/** Amber halo — matches --accent-amber, distinct from cyan focus/hover. */
const NOTABLE_COLOR = [1.0, 0.72, 0.3];

/**
 * Screen-space amber rings marking curated “notable” host stars.
 */
export class NotablePass {
  /**
   * @param {{device: GPUDevice, format: GPUTextureFormat}} gpu
   * @param {GPUBuffer} frameBuffer
   */
  constructor(gpu, frameBuffer) {
    this.device = gpu.device;
    this.quad = createQuadBuffer(gpu.device);
    this.pipeline = createSoftParticlePipeline(
      gpu.device,
      gpu.format,
      HIGHLIGHT_WGSL,
      BLEND_PREMULTIPLIED
    );
    this.bindGroup = gpu.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: frameBuffer } }],
    });
    this.instanceBuffer = null;
    this.capacity = { value: 0 };
    /** @type {object[]} */
    this.systems = [];
    this.count = 0;
    this.width = 1;
  }

  /** @param {object[]} systems notable host systems */
  setSystems(systems) {
    this.systems = systems || [];
  }

  prepare(viewProj, width) {
    this.width = width;
    this.count = 0;
    if (!this.systems.length) return;

    const instances = [];
    for (const t of this.systems) {
      const clipW =
        viewProj[3] * t.x + viewProj[7] * t.y + viewProj[11] * t.z + viewProj[15];
      if (clipW <= 0.02) continue;
      // Rough frustum cull in clip space before packing.
      const clipX =
        viewProj[0] * t.x + viewProj[4] * t.y + viewProj[8] * t.z + viewProj[12];
      const clipY =
        viewProj[1] * t.x + viewProj[5] * t.y + viewProj[9] * t.z + viewProj[13];
      const ndcX = clipX / clipW;
      const ndcY = clipY / clipW;
      if (ndcX < -1.35 || ndcX > 1.35 || ndcY < -1.35 || ndcY > 1.35) continue;

      const dist = Math.max(clipW, 0.05);
      const size = Math.min(72, Math.max(22, (36 * (width / 1280)) * (8 / dist)));
      instances.push({
        x: t.x,
        y: t.y,
        z: t.z,
        color: NOTABLE_COLOR,
        size,
        brightness: 0.85,
      });
    }

    this.count = instances.length;
    if (!this.count) return;

    const data = packInstances(instances);
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
