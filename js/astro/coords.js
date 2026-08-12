/** Equatorial RA/Dec + distance → Cartesian (Sol at origin). Units: parsecs. */

const DEG2RAD = Math.PI / 180;

/**
 * @param {number} raDeg right ascension in degrees
 * @param {number} decDeg declination in degrees
 * @param {number} distPc distance in parsecs
 * @returns {{x:number,y:number,z:number}}
 */
export function equatorialToCartesian(raDeg, decDeg, distPc) {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cosDec = Math.cos(dec);
  return {
    x: distPc * cosDec * Math.cos(ra),
    y: distPc * cosDec * Math.sin(ra),
    z: distPc * Math.sin(dec),
  };
}

export function length3(v) {
  return Math.hypot(v.x, v.y, v.z);
}

export function sub3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add3(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale3(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function normalize3(v) {
  const len = length3(v) || 1;
  return scale3(v, 1 / len);
}

export function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Perspective projection matrix (column-major). */
export function perspective(fovyRad, aspect, near, far) {
  const f = 1 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

/** Look-at view matrix (column-major). */
export function lookAt(eye, target, up) {
  const z = normalize3(sub3(eye, target));
  let x = cross3(up, z);
  if (length3(x) < 1e-6) {
    // up ≈ view axis — pick a stable alternate
    const alt = Math.abs(z.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    x = cross3(alt, z);
  }
  x = normalize3(x);
  const y = cross3(z, x);
  const out = new Float32Array(16);
  out[0] = x.x;
  out[1] = y.x;
  out[2] = z.x;
  out[3] = 0;
  out[4] = x.y;
  out[5] = y.y;
  out[6] = z.y;
  out[7] = 0;
  out[8] = x.z;
  out[9] = y.z;
  out[10] = z.z;
  out[11] = 0;
  out[12] = -dot3(x, eye);
  out[13] = -dot3(y, eye);
  out[14] = -dot3(z, eye);
  out[15] = 1;
  return out;
}

export function multiply4(a, b) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    const ai0 = a[i];
    const ai1 = a[i + 4];
    const ai2 = a[i + 8];
    const ai3 = a[i + 12];
    out[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
    out[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
    out[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
    out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
  }
  return out;
}

/** Project world point to NDC. Returns null if behind camera. */
export function projectToNdc(world, viewProj) {
  const x = world.x;
  const y = world.y;
  const z = world.z;
  const clipX = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12];
  const clipY = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13];
  const clipZ = viewProj[2] * x + viewProj[6] * y + viewProj[10] * z + viewProj[14];
  const clipW = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
  if (clipW <= 0) return null;
  return {
    x: clipX / clipW,
    y: clipY / clipW,
    z: clipZ / clipW,
  };
}

export function ndcToScreen(ndc, width, height) {
  return {
    x: (ndc.x * 0.5 + 0.5) * width,
    y: (1 - (ndc.y * 0.5 + 0.5)) * height,
  };
}
