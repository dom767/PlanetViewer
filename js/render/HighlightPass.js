import {
  createQuadBuffer,
  createSoftParticlePipeline,
  HIGHLIGHT_WGSL,
  BLEND_PREMULTIPLIED,
  packInstances,
  writeInstanceBuffer,
} from "./gpu.js";

/**
 * Screen-space highlight ring on the hovered host star.
 */
export class HighlightPass {
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
    this.target = null;
    this.width = 1;
  }

  setTarget(system) {
    this.target = system;
  }

  prepare(viewProj, width) {
    this.width = width;
    if (!this.target) return;
    const t = this.target;
    const clipW =
      viewProj[3] * t.x + viewProj[7] * t.y + viewProj[11] * t.z + viewProj[15];
    const dist = Math.max(clipW, 0.05);
    const size = Math.min(96, Math.max(28, (48 * (width / 1280)) * (8 / dist)));
    const data = packInstances([
      {
        x: t.x,
        y: t.y,
        z: t.z,
        color: [0.55, 0.85, 1],
        size,
        brightness: 1,
      },
    ]);
    this.instanceBuffer = writeInstanceBuffer(
      this.device,
      this.instanceBuffer,
      data,
      this.capacity
    );
  }

  /** @param {GPURenderPassEncoder} pass */
  draw(pass) {
    if (!this.target || !this.instanceBuffer) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.quad);
    pass.setVertexBuffer(1, this.instanceBuffer);
    pass.draw(6, 1);
  }
}
