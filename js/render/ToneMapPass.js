import { createQuadBuffer } from "./gpu.js";

const TONEMAP_WGSL = /* wgsl */ `
struct Params {
  exposure : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
}

@group(0) @binding(0) var hdrTex : texture_2d<f32>;
@group(0) @binding(1) var hdrSamp : sampler;
@group(0) @binding(2) var<uniform> params : Params;

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
}

@vertex
fn vs_main(@location(0) corner : vec2f) -> VSOut {
  var out : VSOut;
  out.position = vec4f(corner, 0.0, 1.0);
  out.uv = corner * 0.5 + vec2f(0.5);
  // WebGPU NDC y-up; texture sample y often needs flip for render targets
  out.uv.y = 1.0 - out.uv.y;
  return out;
}

fn acesFilmic(x : vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

fn linearToSrgb(c : vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  let hdr = textureSampleLevel(hdrTex, hdrSamp, in.uv, 0.0).rgb;
  let exposed = max(hdr, vec3f(0.0)) * params.exposure;
  let mapped = acesFilmic(exposed);
  return vec4f(linearToSrgb(mapped), 1.0);
}
`;

/**
 * Fullscreen tonemap: HDR float colour → swapchain with exposure.
 */
export class ToneMapPass {
  /**
   * @param {{device: GPUDevice, format: GPUTextureFormat}} gpu
   */
  constructor(gpu) {
    this.device = gpu.device;
    this.quad = createQuadBuffer(gpu.device);
    this.exposure = 1;
    this._hdrView = null;

    this.paramsBuffer = gpu.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._params = new Float32Array(4);
    this._params[0] = 1;

    this.sampler = gpu.device.createSampler({
      magFilter: "nearest",
      minFilter: "nearest",
    });

    const module = gpu.device.createShaderModule({ code: TONEMAP_WGSL });
    this.pipeline = gpu.device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: 8,
            stepMode: "vertex",
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{ format: gpu.format, writeMask: 0xf }],
      },
      primitive: { topology: "triangle-list" },
    });

    this.bindGroup = null;
  }

  setExposure(value) {
    this.exposure = Math.max(0.05, Math.min(8, Number(value) || 1));
  }

  /** @param {GPUTextureView} hdrView */
  setHdrView(hdrView) {
    if (this._hdrView === hdrView && this.bindGroup) return;
    this._hdrView = hdrView;
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: hdrView },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.paramsBuffer } },
      ],
    });
  }

  /**
   * @param {GPUCommandEncoder} encoder
   * @param {GPUTextureView} swapView
   */
  draw(encoder, swapView) {
    if (!this.bindGroup) return;
    this._params[0] = this.exposure;
    this.device.queue.writeBuffer(this.paramsBuffer, 0, this._params);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: swapView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.quad);
    pass.draw(6);
    pass.end();
  }
}
