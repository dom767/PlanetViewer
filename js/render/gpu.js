/**
 * WebGPU device bootstrap and shared helpers (billboard quads, frame uniforms).
 */

/**
 * Previous viewProj samples for star motion trails.
 * Default trail length (scale=1) uses the newest BASE_TRAIL_FRAMES of these;
 * scale=2 can use the full buffer.
 */
export const BASE_TRAIL_FRAMES = 16;
export const TRAIL_HISTORY_FRAMES = 32;
/** Ribbon segments drawn per star (culled in-shader when below trail length scale). */
export const TRAIL_SEGMENTS = TRAIL_HISTORY_FRAMES;
// viewProj + 32×trailHistory + resolution/time/strength/lengthScale (+ pad to 16)
const FRAME_UNIFORM_SIZE = 2144;

export async function createGPU(canvas) {
  if (!navigator.gpu) {
    throw new Error("WebGPU is not supported in this browser");
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("No WebGPU adapter available");

  const device = await adapter.requestDevice({
    requiredFeatures: [],
  });
  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("Failed to get WebGPU canvas context");

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "opaque",
  });

  // Scene colour target (HDR). rgba16float is widely supported for blend + render.
  const hdrFormat = "rgba16float";

  const gpu = {
    device,
    context,
    format,
    hdrFormat,
    depthFormat: "depth24plus",
    depthTexture: null,
    depthView: null,
    hdrTexture: null,
    hdrView: null,
    width: 0,
    height: 0,
  };

  resizeGPU(canvas, gpu);
  return gpu;
}

export function resizeGPU(canvas, gpu) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (
    canvas.width === w &&
    canvas.height === h &&
    gpu.depthTexture &&
    gpu.hdrTexture
  ) {
    return false;
  }

  canvas.width = w;
  canvas.height = h;
  gpu.width = w;
  gpu.height = h;

  if (gpu.depthTexture) gpu.depthTexture.destroy();
  gpu.depthTexture = gpu.device.createTexture({
    size: { width: w, height: h },
    format: gpu.depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  gpu.depthView = gpu.depthTexture.createView();

  if (gpu.hdrTexture) gpu.hdrTexture.destroy();
  gpu.hdrTexture = gpu.device.createTexture({
    size: { width: w, height: h },
    format: gpu.hdrFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  gpu.hdrView = gpu.hdrTexture.createView();
  return true;
}

/** Unit quad corners as 2 triangles (6 verts). */
export const QUAD_CORNERS = new Float32Array([
  -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
]);

export function createQuadBuffer(device) {
  const buffer = device.createBuffer({
    size: QUAD_CORNERS.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(buffer.getMappedRange()).set(QUAD_CORNERS);
  buffer.unmap();
  return buffer;
}

export function createFrameUniforms(device) {
  const buffer = device.createBuffer({
    size: FRAME_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const data = new ArrayBuffer(FRAME_UNIFORM_SIZE);
  return {
    buffer,
    data,
    f32: new Float32Array(data),
    /**
     * @param {GPUQueue} queue
     * @param {Float32Array} viewProj
     * @param {Float32Array[]} trailHistory length TRAIL_HISTORY_FRAMES, oldest→newest
     * @param {number} width
     * @param {number} height
     * @param {number} [time]
     * @param {number} [trailStrength]
     * @param {number} [trailLengthScale]
     */
    write(
      queue,
      viewProj,
      trailHistory,
      width,
      height,
      time = 0,
      trailStrength = 0,
      trailLengthScale = 1
    ) {
      this.f32.set(viewProj, 0);
      for (let i = 0; i < TRAIL_HISTORY_FRAMES; i++) {
        const m = trailHistory[i] || viewProj;
        this.f32.set(m, 16 + i * 16);
      }
      const base = 16 + TRAIL_HISTORY_FRAMES * 16;
      this.f32[base] = width;
      this.f32[base + 1] = height;
      this.f32[base + 2] = time;
      this.f32[base + 3] = trailStrength;
      this.f32[base + 4] = trailLengthScale;
      queue.writeBuffer(this.buffer, 0, this.data);
    },
  };
}

export const FRAME_WGSL = /* wgsl */ `
struct Frame {
  viewProj : mat4x4f,
  /** Oldest → newest previous view-proj. Newest BASE_TRAIL_FRAMES used at scale 1. */
  trailHistory : array<mat4x4f, 32>,
  resolution : vec2f,
  time : f32,
  trailStrength : f32,
  trailLengthScale : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
}
@group(0) @binding(0) var<uniform> frame : Frame;
`;

/**
 * Circular star billboards (core + spikes). Trails are a separate pass.
 */
export const STAR_WGSL = /* wgsl */ `
${FRAME_WGSL}

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec3f,
  @location(1) bright : f32,
  @location(2) uv : vec2f,
  @location(3) spikeAmt : f32,
}

fn hash31(p : vec3f) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@vertex
fn vs_main(
  @location(0) corner : vec2f,
  @location(1) worldPos : vec3f,
  @location(2) color : vec3f,
  @location(3) sizeBright : vec2f,
) -> VSOut {
  var out : VSOut;
  let clip = frame.viewProj * vec4f(worldPos, 1.0);
  let dist = max(clip.w, 0.05);

  let phase = hash31(color + vec3(sizeBright.x, sizeBright.y, 0.0)) * 6.2831853;
  let t = frame.time;
  // Oscillate around 1 so intensity tracks catalog brightness, not a dimmed mean.
  let twinkle =
    1.0 +
    0.14 * sin(t * 2.3 + phase) +
    0.07 * sin(t * 5.1 + phase * 1.7) +
    0.04 * sin(t * 11.0 + phase * 2.3);
  let glint = pow(max(0.0, sin(t * 1.4 + phase * 3.1)), 24.0) * 0.28;
  let sparkle = clamp(twinkle + glint, 0.72, 1.4);

  let px = clamp(sizeBright.x * 195.0 / dist * (0.9 + 0.12 * sparkle), 3.5, 126.0);

  var positioned = clip;
  positioned.x += corner.x * (px / frame.resolution.x) * clip.w;
  positioned.y += corner.y * (px / frame.resolution.y) * clip.w;
  out.position = positioned;
  out.color = color;
  out.bright = sizeBright.y * sparkle;
  out.uv = corner;
  out.spikeAmt = smoothstep(0.24, 0.9, sizeBright.y) * (0.65 + 0.5 * sparkle);
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  let uv = in.uv;
  let r2 = dot(uv, uv);
  if (r2 > 1.0) {
    discard;
  }

  // Slightly tighter glow than before; spikes a bit stronger
  let core = exp(-r2 * 22.0);
  let halo = exp(-r2 * 3.4) * 0.16;

  let ax = abs(uv.x);
  let ay = abs(uv.y);
  let armH = exp(-ay * 36.0) * exp(-ax * 1.55) * (1.0 - smoothstep(0.12, 1.0, ax));
  let armV = exp(-ax * 36.0) * exp(-ay * 1.55) * (1.0 - smoothstep(0.12, 1.0, ay));
  let u45 = abs(uv.x + uv.y) * 0.70710678;
  let v45 = abs(uv.x - uv.y) * 0.70710678;
  let armD1 = exp(-v45 * 40.0) * exp(-u45 * 1.8) * (1.0 - smoothstep(0.16, 1.0, u45));
  let armD2 = exp(-u45 * 40.0) * exp(-v45 * 1.8) * (1.0 - smoothstep(0.16, 1.0, v45));
  let spikes = (armH + armV + 0.45 * (armD1 + armD2)) * in.spikeAmt * 1.4;

  let a = (core * 1.15 + halo + spikes) * in.bright;
  let rgb = in.color * (0.45 + 0.75 * core + 0.55 * spikes) * a;
  return vec4f(rgb, a);
}
`;

/**
 * Multi-segment motion ribbon from recent view-proj samples.
 * Vertex layout: only instance buffer; corners/segments from vertex_index.
 * draw(6 * TRAIL_SEGMENTS, starCount).
 *
 * Trail length scale (0.1–2): uses round(16 * scale) of the newest history
 * samples (capped at 32), so 1.0 matches the original 16-frame look.
 *
 * Energy scales with path area (length × width) so thin distant-star streaks
 * and long bright ones keep a similar additive budget; head is gapped so the
 * trail doesn't stack under the star core.
 */
export const STAR_TRAIL_WGSL = /* wgsl */ `
${FRAME_WGSL}

const TRAIL_N : u32 = 32u;
const TRAIL_BASE : f32 = 16.0;

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec3f,
  @location(1) bright : f32,
  @location(2) uv : vec2f,
  @location(3) age : f32,
}

fn cornerFromLocal(local : u32) -> vec2f {
  // Matches QUAD_CORNERS triangle list
  switch local {
    case 0u: { return vec2f(-1.0, -1.0); }
    case 1u: { return vec2f( 1.0, -1.0); }
    case 2u: { return vec2f(-1.0,  1.0); }
    case 3u: { return vec2f(-1.0,  1.0); }
    case 4u: { return vec2f( 1.0, -1.0); }
    default: { return vec2f( 1.0,  1.0); }
  }
}

/** Screen-pixel offset from current star centre for a clip-space sample. */
fn toOffsetPx(clip : vec4f, clipNow : vec4f) -> vec2f {
  let ndc = clip.xy / max(clip.w, 1e-4);
  let ndcNow = clipNow.xy / max(clipNow.w, 1e-4);
  return (ndc - ndcNow) * frame.resolution * 0.5;
}

fn sampleOffset(i : u32, worldPos : vec3f, clipNow : vec4f) -> vec2f {
  // i=0 → current (zero offset); i=1..N → newest past … older
  if (i == 0u) {
    return vec2f(0.0, 0.0);
  }
  // trailHistory: [0]=oldest … [31]=newest past → map i=1 → hist[31]
  let histIdx = TRAIL_N - i;
  let clip = frame.trailHistory[histIdx] * vec4f(worldPos, 1.0);
  var off = toOffsetPx(clip, clipNow);
  // Reject wild reprojections (teleports / behind camera flips)
  if (length(off) > 2200.0) {
    off = vec2f(0.0, 0.0);
  }
  return off;
}

@vertex
fn vs_main(
  @builtin(vertex_index) vid : u32,
  @location(0) worldPos : vec3f,
  @location(1) color : vec3f,
  @location(2) sizeBright : vec2f,
) -> VSOut {
  var out : VSOut;
  let seg = vid / 6u;
  let local = vid % 6u;
  let corner = cornerFromLocal(local);

  let clipNow = frame.viewProj * vec4f(worldPos, 1.0);
  let lenScale = clamp(frame.trailLengthScale, 0.1, 2.0);
  let maxSeg = u32(clamp(round(TRAIL_BASE * lenScale), 1.0, f32(TRAIL_N)));

  if (frame.trailStrength < 0.02 || seg >= maxSeg) {
    out.position = vec4f(2.0, 2.0, 0.0, 1.0);
    out.color = color;
    out.bright = 0.0;
    out.uv = corner;
    out.age = 1.0;
    return out;
  }

  var pts : array<vec2f, 33>;
  var totalLen = 0.0;
  pts[0] = sampleOffset(0u, worldPos, clipNow);
  for (var i = 1u; i <= maxSeg; i++) {
    pts[i] = sampleOffset(i, worldPos, clipNow);
    totalLen += length(pts[i] - pts[i - 1u]);
  }

  if (totalLen < 4.0) {
    out.position = vec4f(2.0, 2.0, 0.0, 1.0);
    out.color = color;
    out.bright = 0.0;
    out.uv = corner;
    out.age = 1.0;
    return out;
  }
  totalLen = min(totalLen, 2400.0);

  let p0 = pts[seg];
  let p1 = pts[seg + 1u];
  var delta = p1 - p0;
  var segLen = length(delta);
  if (segLen < 0.35) {
    out.position = vec4f(2.0, 2.0, 0.0, 1.0);
    out.color = color;
    out.bright = 0.0;
    out.uv = corner;
    out.age = 1.0;
    return out;
  }
  let dir = delta / segLen;
  let perp = vec2f(-dir.y, dir.x);

  let along = corner.x * 0.5 + 0.5; // 0 at newer end of segment, 1 at older
  let age = (f32(seg) + along) / f32(maxSeg);

  // Match star billboard screen size (catalog size alone ignores distance)
  let dist = max(clipNow.w, 0.05);
  let starPx = clamp(sizeBright.x * 195.0 / dist, 2.0, 90.0);
  let motion = smoothstep(8.0, 140.0, totalLen);

  let baseHalfW = clamp(starPx * 0.28, 0.8, 4.5) * mix(1.0, 1.35, motion);
  let halfW = baseHalfW * mix(1.0, 0.35, age);

  let headGap = min(starPx * 0.35, totalLen * 0.08);
  var offsetPx = mix(p0, p1, along) + perp * corner.y * halfW;
  if (length(offsetPx) > 1e-4) {
    let pathDir = normalize(offsetPx);
    offsetPx = offsetPx + pathDir * headGap * max(0.0, 1.0 - age * 3.0);
  }

  let area = max(totalLen * baseHalfW * 2.0, 1.0);
  let dens = 220.0 / area;
  let sizeGate = smoothstep(1.5, 6.0, starPx);
  let travelGain = mix(0.8, 4.5, motion);
  var peak = sizeBright.y * travelGain * dens * sizeGate;
  peak = min(peak, sizeBright.y * mix(1.2, 3.5, motion));

  var positioned = clipNow;
  positioned.x += (offsetPx.x / frame.resolution.x) * clipNow.w;
  positioned.y += (offsetPx.y / frame.resolution.y) * clipNow.w;
  out.position = positioned;
  out.color = color;
  out.bright = peak;
  out.uv = corner;
  out.age = age;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  if (in.bright < 0.001) {
    discard;
  }
  let softY = 1.0 - abs(in.uv.y);
  if (softY < 0.0) {
    discard;
  }
  let edge = smoothstep(0.0, 0.4, softY);
  let headGate = smoothstep(0.0, 0.08, in.age);
  let tail = pow(max(0.0, 1.0 - in.age), 0.85);
  let fade = headGate * tail * 2.8;
  let a = edge * fade * in.bright;
  if (a < 0.001) {
    discard;
  }
  let rgb = in.color * a;
  return vec4f(rgb, a);
}
`;

/** Soft circular particle billboards (planets / legacy). */
export const SOFT_PARTICLE_WGSL = /* wgsl */ `
${FRAME_WGSL}

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec3f,
  @location(1) bright : f32,
  @location(2) uv : vec2f,
}

fn hash31(p : vec3f) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@vertex
fn vs_main(
  @location(0) corner : vec2f,
  @location(1) worldPos : vec3f,
  @location(2) color : vec3f,
  @location(3) sizeBright : vec2f,
) -> VSOut {
  var out : VSOut;
  let clip = frame.viewProj * vec4f(worldPos, 1.0);
  let dist = max(clip.w, 0.05);

  let phase = hash31(worldPos) * 6.2831853;
  let t = frame.time;
  let twinkle =
    1.0 +
    0.14 * sin(t * 2.3 + phase) +
    0.07 * sin(t * 5.1 + phase * 1.7) +
    0.04 * sin(t * 11.0 + phase * 2.3);
  let glint = pow(max(0.0, sin(t * 1.4 + phase * 3.1)), 24.0) * 0.25;

  let sparkle = clamp(twinkle + glint, 0.72, 1.4);
  let px = clamp(sizeBright.x * 120.0 / dist * (0.92 + 0.10 * sparkle), 2.0, 72.0);

  var positioned = clip;
  positioned.x += corner.x * (px / frame.resolution.x) * clip.w;
  positioned.y += corner.y * (px / frame.resolution.y) * clip.w;
  out.position = positioned;
  out.color = color;
  out.bright = sizeBright.y * sparkle;
  out.uv = corner;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) {
    discard;
  }
  let core = exp(-r2 * 3.5);
  let halo = exp(-r2 * 1.2) * 0.35;
  let a = (core + halo) * in.bright;
  let rgb = in.color * (0.65 + 0.55 * core) * a;
  return vec4f(rgb, a);
}
`;

export const PLANET_PARTICLE_WGSL = /* wgsl */ `
${FRAME_WGSL}

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec3f,
  @location(1) uv : vec2f,
}

@vertex
fn vs_main(
  @location(0) corner : vec2f,
  @location(1) worldPos : vec3f,
  @location(2) color : vec3f,
  @location(3) sizeBright : vec2f,
) -> VSOut {
  var out : VSOut;
  let clip = frame.viewProj * vec4f(worldPos, 1.0);
  let dist = max(clip.w, 0.08);
  // Smaller than stars; sizeBright.x is a notional radius cue
  let px = clamp(sizeBright.x * 48.0 / dist, 2.0, 14.0);
  var positioned = clip;
  positioned.x += corner.x * (px / frame.resolution.x) * clip.w;
  positioned.y += corner.y * (px / frame.resolution.y) * clip.w;
  out.position = positioned;
  out.color = color;
  out.uv = corner;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  let r = length(in.uv);
  // Hard disc with a thin AA rim — no soft glow like stars
  let a = 1.0 - smoothstep(0.82, 0.98, r);
  if (a < 0.01) {
    discard;
  }
  // Slight limb darkening toward the edge, still opaque-looking
  let shade = 0.88 + 0.12 * (1.0 - smoothstep(0.0, 0.85, r));
  let rgb = in.color * shade * a;
  return vec4f(rgb, a);
}
`;

/** Galactic-map planets: map sizing + host-star sphere lighting. */
export const MAP_PLANET_LIT_WGSL = /* wgsl */ `
${FRAME_WGSL}

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec3f,
  @location(1) uv : vec2f,
  @location(2) lightDir : vec3f,
  @location(3) bright : f32,
}

@vertex
fn vs_main(
  @location(0) corner : vec2f,
  @location(1) worldPos : vec3f,
  @location(2) color : vec3f,
  @location(3) sizeBright : vec2f,
  @location(4) lightDir : vec3f,
) -> VSOut {
  var out : VSOut;
  let clip = frame.viewProj * vec4f(worldPos, 1.0);
  let dist = max(clip.w, 0.08);
  let px = clamp(sizeBright.x * 48.0 / dist, 2.0, 14.0);
  var positioned = clip;
  positioned.x += corner.x * (px / frame.resolution.x) * clip.w;
  positioned.y += corner.y * (px / frame.resolution.y) * clip.w;
  out.position = positioned;
  out.color = color;
  out.uv = corner;
  out.lightDir = lightDir;
  out.bright = sizeBright.y;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let a = 1.0 - smoothstep(0.82, 0.98, r);
  if (a < 0.01) {
    discard;
  }
  let nz = sqrt(max(1e-4, 1.0 - r * r));
  let n = normalize(vec3f(in.uv.x, in.uv.y, nz));
  let L = normalize(in.lightDir);
  let ndotl = max(dot(n, L), 0.0);
  let lit = 0.12 + 0.88 * smoothstep(0.0, 0.12, ndotl) * ndotl;
  let limb = 0.85 + 0.15 * nz;
  let rgb = in.color * lit * limb * a * clamp(in.bright, 0.0, 1.0);
  return vec4f(rgb, a * clamp(in.bright, 0.0, 1.0));
}
`;

/** Focused-system planets: sizeBright.x ∝ (R/R⊕)^n; lit from host star. */
export const FOCUS_PLANET_PARTICLE_WGSL = /* wgsl */ `
${FRAME_WGSL}

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec3f,
  @location(1) uv : vec2f,
  @location(2) lightDir : vec3f,
  @location(3) bright : f32,
}

@vertex
fn vs_main(
  @location(0) corner : vec2f,
  @location(1) worldPos : vec3f,
  @location(2) color : vec3f,
  @location(3) sizeBright : vec2f,
  @location(4) lightDir : vec3f,
) -> VSOut {
  var out : VSOut;
  let clip = frame.viewProj * vec4f(worldPos, 1.0);
  let dist = max(clip.w, 0.08);
  let px = clamp(sizeBright.x * 4.0 / dist, 1.8, 96.0);
  var positioned = clip;
  positioned.x += corner.x * (px / frame.resolution.x) * clip.w;
  positioned.y += corner.y * (px / frame.resolution.y) * clip.w;
  out.position = positioned;
  out.color = color;
  out.uv = corner;
  out.lightDir = lightDir;
  out.bright = sizeBright.y;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let a = 1.0 - smoothstep(0.82, 0.98, r);
  if (a < 0.01) {
    discard;
  }
  // Disc → unit sphere; +Z faces the camera (billboard).
  let nz = sqrt(max(1e-4, 1.0 - r * r));
  let n = normalize(vec3f(in.uv.x, in.uv.y, nz));
  let L = normalize(in.lightDir);
  let ndotl = max(dot(n, L), 0.0);
  // Soft terminator + small ambient so the night side stays readable
  let lit = 0.1 + 0.9 * smoothstep(0.0, 0.12, ndotl) * ndotl;
  let limb = 0.82 + 0.18 * nz;
  let rgb = in.color * lit * limb * a * clamp(in.bright, 0.0, 1.0);
  return vec4f(rgb, a * clamp(in.bright, 0.0, 1.0));
}
`;

export const HIGHLIGHT_WGSL = /* wgsl */ `
${FRAME_WGSL}

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
  @location(1) color : vec3f,
  @location(2) brightness : f32,
}

@vertex
fn vs_main(
  @location(0) corner : vec2f,
  @location(1) worldPos : vec3f,
  @location(2) color : vec3f,
  @location(3) sizeBright : vec2f,
) -> VSOut {
  var out : VSOut;
  let clip = frame.viewProj * vec4f(worldPos, 1.0);
  let dist = max(clip.w, 0.05);
  let px = clamp(sizeBright.x, 22.0, 120.0);
  var positioned = clip;
  positioned.x += corner.x * (px / frame.resolution.x) * clip.w;
  positioned.y += corner.y * (px / frame.resolution.y) * clip.w;
  out.position = positioned;
  out.uv = corner;
  out.color = color;
  out.brightness = sizeBright.y;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let ring = smoothstep(0.55, 0.68, r) * (1.0 - smoothstep(0.82, 0.98, r));
  let pulse = 0.75 + 0.25 * sin(frame.time * 4.0);
  let a = ring * pulse * clamp(in.brightness, 0.0, 1.5);
  if (a < 0.02) {
    discard;
  }
  let rgb = in.color * a;
  return vec4f(rgb, a);
}
`;

/**
 * Screen-space bookmark ribbon hovering above a notable host.
 * Quad is lifted above the star; the V-notch points down at it.
 */
export const BOOKMARK_WGSL = /* wgsl */ `
${FRAME_WGSL}

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
  @location(1) color : vec3f,
  @location(2) brightness : f32,
}

fn sdBox(p: vec2f, b: vec2f) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

fn sdTriangle(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> f32 {
  let e0 = b - a;
  let e1 = c - b;
  let e2 = a - c;
  let v0 = p - a;
  let v1 = p - b;
  let v2 = p - c;
  let pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  let pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  let pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  let s = sign(e0.x * e2.y - e0.y * e2.x);
  let d = min(
    min(
      vec2f(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
      vec2f(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))
    ),
    vec2f(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x))
  );
  return -sqrt(d.x) * sign(d.y);
}

@vertex
fn vs_main(
  @location(0) corner : vec2f,
  @location(1) worldPos : vec3f,
  @location(2) color : vec3f,
  @location(3) sizeBright : vec2f,
) -> VSOut {
  var out : VSOut;
  let clip = frame.viewProj * vec4f(worldPos, 1.0);
  let px = clamp(sizeBright.x, 14.0, 48.0);
  let halfW = px * 1.14;
  let halfH = px * 1.44;
  let phase = fract(sin(dot(worldPos.xz, vec2f(12.9898, 78.233))) * 43758.5453);
  let bob = sin(frame.time * 2.3 + phase * 6.28318) * (px * 0.08);
  let lift = px * 1.84 + bob;
  var positioned = clip;
  positioned.x += corner.x * (halfW / frame.resolution.x) * clip.w;
  positioned.y += (corner.y * halfH + lift) / frame.resolution.y * clip.w;
  out.position = positioned;
  out.uv = corner;
  out.color = color;
  out.brightness = sizeBright.y;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  let p = in.uv;
  // Ribbon body + downward V — a hanging bookmark pointing at the star.
  let body = sdBox(p - vec2f(0.0, 0.32), vec2f(0.58, 0.54));
  let tip = sdTriangle(
    p,
    vec2f(-0.58, -0.22),
    vec2f(0.58, -0.22),
    vec2f(0.0, -0.96)
  );
  let d = min(body, tip);

  let fill = 1.0 - smoothstep(-0.02, 0.04, d);
  let glow = exp(-5.0 * max(d, 0.0)) * 0.32;
  if (fill + glow < 0.04) {
    discard;
  }

  let shade = mix(1.16, 0.74, smoothstep(-0.55, 0.62, p.x));
  let a = clamp(fill + glow, 0.0, 1.0) * clamp(in.brightness, 0.0, 1.5);
  let rgb = in.color * shade * a;
  return vec4f(rgb, a);
}
`;

export const LINE_WGSL = /* wgsl */ `
${FRAME_WGSL}

struct OrbitStyle {
  opacity : f32,
  _pad : vec3f,
}
@group(0) @binding(1) var<uniform> orbitStyle : OrbitStyle;

struct VSOut {
  @builtin(position) position : vec4f,
}

@vertex
fn vs_main(@location(0) worldPos : vec3f) -> VSOut {
  var out : VSOut;
  out.position = frame.viewProj * vec4f(worldPos, 1.0);
  return out;
}

@fragment
fn fs_main() -> @location(0) vec4f {
  let a = 0.45 * orbitStyle.opacity;
  if (a < 0.004) {
    discard;
  }
  let rgb = vec3f(0.35, 0.55, 0.85) * a;
  return vec4f(rgb, a);
}
`;

export function createSoftParticlePipeline(device, format, shaderCode, blend) {
  const module = device.createShaderModule({ code: shaderCode });
  return device.createRenderPipeline({
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
        {
          arrayStride: 32,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 1, offset: 0, format: "float32x3" },
            { shaderLocation: 2, offset: 12, format: "float32x3" },
            { shaderLocation: 3, offset: 24, format: "float32x2" },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "fs_main",
      targets: [
        {
          format,
          blend,
          writeMask: 0xf,
        },
      ],
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
  });
}

/** Focused planets: pos, color, sizeBright, lightDir (billboard space). */
export function createFocusPlanetPipeline(device, format, shaderCode, blend) {
  const module = device.createShaderModule({ code: shaderCode });
  return device.createRenderPipeline({
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
        {
          arrayStride: 48,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 1, offset: 0, format: "float32x3" },
            { shaderLocation: 2, offset: 12, format: "float32x3" },
            { shaderLocation: 3, offset: 24, format: "float32x2" },
            { shaderLocation: 4, offset: 32, format: "float32x3" },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "fs_main",
      targets: [
        {
          format,
          blend,
          writeMask: 0xf,
        },
      ],
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
  });
}

/** Trail ribbon: instance data only; segment quads from vertex_index. */
export function createTrailParticlePipeline(device, format, shaderCode, blend) {
  const module = device.createShaderModule({ code: shaderCode });
  return device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: 32,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
            { shaderLocation: 2, offset: 24, format: "float32x2" },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "fs_main",
      targets: [
        {
          format,
          blend,
          writeMask: 0xf,
        },
      ],
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
  });
}

/** Premultiplied alpha over. */
export const BLEND_PREMULTIPLIED = {
  color: {
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
  alpha: {
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
};

/** Additive glow (stars). */
export const BLEND_ADDITIVE = {
  color: {
    srcFactor: "one",
    dstFactor: "one",
    operation: "add",
  },
  alpha: {
    srcFactor: "one",
    dstFactor: "one",
    operation: "add",
  },
};

/**
 * Interleaved instance buffer: pos.xyz, color.rgb, size, bright (8 floats).
 */
export function packInstances(items) {
  const n = items.length;
  const data = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    const s = items[i];
    const o = i * 8;
    data[o] = s.x;
    data[o + 1] = s.y;
    data[o + 2] = s.z;
    data[o + 3] = s.color[0];
    data[o + 4] = s.color[1];
    data[o + 5] = s.color[2];
    data[o + 6] = s.size;
    data[o + 7] = s.brightness ?? 1;
  }
  return data;
}

/**
 * Focused planets: pos, color, sizeBright, lightDir (+ pad) = 12 floats.
 * @param {Array<{x:number,y:number,z:number,color:number[],size:number,brightness?:number,lightDir:{x:number,y:number,z:number}}>} items
 */
export function packLitPlanetInstances(items) {
  const n = items.length;
  const data = new Float32Array(n * 12);
  for (let i = 0; i < n; i++) {
    const s = items[i];
    const o = i * 12;
    data[o] = s.x;
    data[o + 1] = s.y;
    data[o + 2] = s.z;
    data[o + 3] = s.color[0];
    data[o + 4] = s.color[1];
    data[o + 5] = s.color[2];
    data[o + 6] = s.size;
    data[o + 7] = s.brightness ?? 1;
    data[o + 8] = s.lightDir.x;
    data[o + 9] = s.lightDir.y;
    data[o + 10] = s.lightDir.z;
  }
  return data;
}

export function writeInstanceBuffer(device, buffer, data, capacityRef) {
  const bytes = data.byteLength;
  if (!buffer || bytes > capacityRef.value) {
    if (buffer) buffer.destroy();
    buffer = device.createBuffer({
      size: Math.max(bytes, 256),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    capacityRef.value = buffer.size;
  }
  if (bytes > 0) device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}
