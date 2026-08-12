import {
  add3,
  cross3,
  lookAt,
  length3,
  normalize3,
  scale3,
  sub3,
  dot3,
} from "../astro/coords.js";
import {
  cameraAlignedOrbitBasis,
  planetaryOrbitBasis,
  SYSTEM_VIEW_ELEVATION,
} from "../render/PlanetPass.js";

/** Overlook elevation above the system plane (matches PlanetPass). */
const ARRIVAL_ELEVATION = SYSTEM_VIEW_ELEVATION;
const WORLD_UP = { x: 0, y: 0, z: 1 };

/**
 * Heading spring: accel = −k·θ − c·ω along the shortest arc.
 * Critically damped so rate falls as remaining heading error shrinks.
 */
const LOOK_SPRING_STIFF = 9;
const LOOK_SPRING_DAMP = 2 * Math.sqrt(LOOK_SPRING_STIFF);

/** Fixed Bezier hop duration (seconds), independent of distance. */
const TRAVEL_DURATION = 6;
/** Reveal system orbits near the end of the hop. */
const ARRIVE_REVEAL_U = 0.72;

/**
 * Free-fly camera with Bezier travel between systems.
 *
 * Travel orientation uses an orthonormal basis (not yaw/pitch): a critically
 * damped spring drives shortest-arc rotation toward the destination so turn
 * rate falls as heading error shrinks. Position follows a fixed-duration cubic
 * Bezier that matches start/end velocity for a seamless overlook handoff.
 */
export class FlyCamera {
  constructor() {
    this.position = { x: 0, y: -25, z: 8 };
    this.yaw = Math.PI / 2;
    this.pitch = -0.25;
    this.moveSpeed = 15;
    this.lookSensitivity = 0.005;
    this.orbitSensitivity = 0.005;
    this.up = { ...WORLD_UP };

    /** @type {null | OrbitSlot} */
    this._slot = null;
    /** @type {null | TravelState} */
    this._travel = null;
    /** @type {'free'|'travel'|'orbit'} */
    this._flightMode = "free";
    /** @type {'free'|'depart'|'cruise'|'arrive'|'orbit'} */
    this._phase = "orbit";

    /** Camera basis (travel / orbit). Free look uses yaw/pitch. */
    this._fwd = this.forwardFromYawPitch();
    this._upBody = { ...WORLD_UP };
    this._velocity = { x: 0, y: 0, z: 0 };
    /** Angular velocity (rad/s) of the heading spring along the look arc. */
    this._lookAngVel = 0;

    this.autoOrbitResumeDelay = 5.5;
    this._reattachCooldown = 0;
    this.autoOrbitSpeed = (Math.PI * 2) / 90;

    this._anchorStar = null;

    this._keys = new Set();
    this._dragging = false;
    this._orbitDragging = false;
    this._pendingOrbitTarget = null;
    this._dragMoved = false;
    this._dragStart = null;
    /** @type {null | (() => object|null)} */
    this.resolveOrbitTarget = null;
  }

  didDrag() {
    return this._dragMoved;
  }

  isFocused() {
    return !!this._slot;
  }

  isTravelling() {
    return this._flightMode === "travel" && !!this._travel;
  }

  /** True once orbits should be shown (late travel / overlook). */
  shouldRevealOrbits() {
    return this._phase === "arrive" || this._phase === "orbit";
  }

  /** @returns {'free'|'depart'|'cruise'|'arrive'|'orbit'} */
  getFocusPhase() {
    if (this._flightMode === "free" && !this._slot) return "free";
    return this._phase;
  }

  attach(canvas) {
    window.addEventListener("keydown", (e) => {
      this._keys.add(e.code);
      if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "Space"].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this._keys.delete(e.code));

    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this._dragging = true;
      this._dragMoved = false;
      this._orbitDragging = false;
      this._dragStart = { x: e.clientX, y: e.clientY };
      this._pendingOrbitTarget = this.resolveOrbitTarget?.() || null;
      canvas.setPointerCapture?.(e.pointerId);
    });

    const endDrag = (e) => {
      if (e.button !== 0 && e.type !== "pointercancel") return;
      if (this._orbitDragging && this._slot) {
        this._reattachCooldown = this.autoOrbitResumeDelay;
        this._seedTangentFromSlot();
      }
      this._dragging = false;
      this._orbitDragging = false;
      this._pendingOrbitTarget = null;
      try {
        canvas.releasePointerCapture?.(e.pointerId);
      } catch {
        /* already released */
      }
    };

    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("lostpointercapture", () => {
      if (this._orbitDragging && this._slot) {
        this._reattachCooldown = this.autoOrbitResumeDelay;
        this._seedTangentFromSlot();
      }
      this._dragging = false;
      this._orbitDragging = false;
      this._pendingOrbitTarget = null;
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!this._dragging) return;

      if (this._dragStart) {
        const dx0 = e.clientX - this._dragStart.x;
        const dy0 = e.clientY - this._dragStart.y;
        if (dx0 * dx0 + dy0 * dy0 > 16) this._dragMoved = true;
      }
      if (!this._dragMoved) return;

      if (this._pendingOrbitTarget && !this._orbitDragging) {
        this.cancelTravel();
        this._ensureSlot(this._pendingOrbitTarget);
        this._flightMode = "orbit";
        this._phase = "orbit";
        this._syncSlotFromCamera();
        this._orbitDragging = true;
      }

      if (this._orbitDragging && this._slot) {
        this._slot.azimuth -= e.movementX * this.orbitSensitivity;
        this._slot.elevation += e.movementY * this.orbitSensitivity;
        const lim = Math.PI / 2 - 0.05;
        this._slot.elevation = Math.max(-lim, Math.min(lim, this._slot.elevation));
        this.applyOrbitPose();
        return;
      }

      this.cancelTravel();
      if (this._slot) {
        this._reattachCooldown = this.autoOrbitResumeDelay;
        this._flightMode = "orbit";
        this._phase = "orbit";
      } else {
        this._flightMode = "free";
      }
      this.yaw += e.movementX * this.lookSensitivity;
      this.pitch -= e.movementY * this.lookSensitivity;
      const lim = Math.PI / 2 - 0.05;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
      this._fwd = this.forwardFromYawPitch();
      this._upBody = { ...WORLD_UP };
    });

    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (this.isTravelling()) return;
        const zoomIn = e.deltaY < 0;
        const factor = zoomIn ? 0.85 : 1.15;

        if (this._slot) {
          this._slot.distance = clamp(this._slot.distance * factor, 0.15, 2000);
          this.applyOrbitPose();
          return;
        }

        const step = this.moveSpeed * 0.08 * (zoomIn ? 1 : -1);
        this.position = add3(this.position, scale3(this.forward(), step));
      },
      { passive: false }
    );
  }

  /** System-plane basis used for overlook orbit (shared with PlanetPass). */
  getOrbitBasis() {
    return this._slot?.basis ?? null;
  }

  /**
   * @param {{x:number,y:number,z:number,name?:string,planets?:object[]}} target
   * @param {number} distance
   * @param {{x:number,y:number,z:number}|null} [fromStar]
   */
  focusOn(target, distance = 2.5, fromStar = null) {
    // Carry basis from free look or prior mode
    if (this._flightMode === "free") {
      this._fwd = this.forwardFromYawPitch();
      this._upBody = { ...WORLD_UP };
    }

    const dest = { x: target.x, y: target.y, z: target.z };
    const basis =
      target.planets?.length > 0
        ? planetaryOrbitBasis(target, this.position)
        : cameraAlignedOrbitBasis(dest, this.position, ARRIVAL_ELEVATION);
    const azimuth = nearestOverlookAzimuth(this.position, dest, basis, this.yaw);
    const prevAnchor = this._anchorStar ? { ...this._anchorStar } : null;

    this._slot = {
      target: dest,
      distance,
      azimuth,
      elevation: ARRIVAL_ELEVATION,
      name: target.name,
      basis,
    };
    this._reattachCooldown = 0;
    this._anchorStar = dest;

    const source = fromStar
      ? { x: fromStar.x, y: fromStar.y, z: fromStar.z }
      : prevAnchor;

    const p0 = { ...this.position };
    const p3 = orbitPosition(this._slot);
    const hop = Math.max(length3(sub3(p3, p0)), 0.5);
    const duration = TRAVEL_DURATION;

    // Start velocity: keep motion if already moving, else leave host / nose
    let v0 = { ...this._velocity };
    if (length3(v0) < 0.5) {
      let leave = this._fwd;
      if (source && length3(sub3(p0, source)) > 1e-4) {
        leave = normalize3(sub3(p0, source));
      }
      const toward = normalize3(sub3(p3, p0));
      const startDir = normalize3(add3(scale3(leave, 0.45), scale3(toward, 0.55)));
      v0 = scale3(startDir, hop / duration);
    } else {
      // Softly bias existing velocity toward the destination
      const toward = normalize3(sub3(p3, p0));
      const spd = length3(v0);
      v0 = scale3(
        normalize3(add3(normalize3(v0), scale3(toward, 0.35))),
        Math.max(spd, hop / duration * 0.55)
      );
    }

    // End velocity matches overlook tangent — C1 handoff into orbit
    const v1 = orbitTangentVelocity(this._slot, this.autoOrbitSpeed);

    // Cubic Bezier with Hermite end velocities: B'(0)=3(P1−P0), B'(1)=3(P3−P2)
    // Parameter u ∈ [0,1] over fixed duration ⇒ world vel = (dB/du)/duration
    const p1 = add3(p0, scale3(v0, duration / 3));
    const p2 = sub3(p3, scale3(v1, duration / 3));

    this._lookAngVel = 0;
    this._travel = {
      p0,
      p1,
      p2,
      p3,
      vEnd: v1,
      duration,
      elapsed: 0,
      dest,
      arrivalUp: { ...basis.ey },
    };

    this._flightMode = "travel";
    this._phase = source ? "depart" : "cruise";
    this._syncYawPitchFromDir(this._fwd);
  }

  _ensureSlot(target, preferredDistance) {
    const t = { x: target.x, y: target.y, z: target.z };
    if (
      this._slot &&
      this._slot.target.x === t.x &&
      this._slot.target.y === t.y &&
      this._slot.target.z === t.z
    ) {
      if (preferredDistance != null) this._slot.distance = preferredDistance;
      return;
    }

    const basis =
      target.planets?.length > 0
        ? planetaryOrbitBasis(target, this.position)
        : cameraAlignedOrbitBasis(t, this.position, ARRIVAL_ELEVATION);
    const spherical = cameraToSlotSpherical(this.position, t, basis);
    let distance = spherical.distance;
    if (distance < 1e-4) distance = preferredDistance ?? 2.5;
    else if (preferredDistance != null) distance = preferredDistance;

    this._slot = {
      target: t,
      distance,
      azimuth: spherical.azimuth,
      elevation: Number.isFinite(spherical.elevation)
        ? spherical.elevation
        : ARRIVAL_ELEVATION,
      name: target.name,
      basis,
    };
  }

  _syncSlotFromCamera() {
    if (!this._slot?.basis) return;
    const s = cameraToSlotSpherical(
      this.position,
      this._slot.target,
      this._slot.basis
    );
    if (s.distance < 1e-4) return;
    this._slot.distance = s.distance;
    this._slot.azimuth = s.azimuth;
    this._slot.elevation = s.elevation;
  }

  cancelTravel() {
    if (this._flightMode === "travel") {
      this._travel = null;
      this._lookAngVel = 0;
      if (this._slot) {
        this._flightMode = "orbit";
        this._phase = "orbit";
      } else {
        this._flightMode = "free";
      }
    }
  }

  clearOrbit() {
    this._slot = null;
    this._travel = null;
    this._reattachCooldown = 0;
    this._flightMode = "free";
    this._phase = "orbit";
    this._upBody = { ...WORLD_UP };
    this._fwd = this.forwardFromYawPitch();
    this._velocity = { x: 0, y: 0, z: 0 };
    this._lookAngVel = 0;
  }

  /** Resume overlook orbit after drag / zoom pause. */
  attachSpring() {
    if (!this._slot) return;
    this._slot.elevation = ARRIVAL_ELEVATION;
    this._travel = null;
    this._flightMode = "orbit";
    this._phase = "orbit";
    this._reattachCooldown = 0;
    this._seedTangentFromSlot();
    const look = normalize3(sub3(this._slot.target, this.position));
    this._fwd = look;
    this._upBody = orthonormalizeUp(this._fwd, this._slot.basis.ey);
    this._syncYawPitchFromDir(this._fwd);
  }

  detachSpring() {
    this._travel = null;
    if (this._slot) {
      this._flightMode = "orbit";
      this._phase = "orbit";
    }
  }

  applyOrbitPose() {
    if (!this._slot) return;
    this.position = { ...orbitPosition(this._slot) };
    const dir = normalize3(sub3(this._slot.target, this.position));
    this._fwd = dir;
    this._upBody = orthonormalizeUp(dir, this._slot.basis?.ey || WORLD_UP);
    this._seedTangentFromSlot();
    this._syncYawPitchFromDir(dir);
  }

  _seedTangentFromSlot() {
    if (!this._slot?.basis) {
      this._velocity = { x: 0, y: 0, z: 0 };
      return;
    }
    this._velocity = orbitTangentVelocity(this._slot, this.autoOrbitSpeed);
  }

  forwardFromYawPitch() {
    const cp = Math.cos(this.pitch);
    return {
      x: Math.cos(this.yaw) * cp,
      y: Math.sin(this.yaw) * cp,
      z: Math.sin(this.pitch),
    };
  }

  forward() {
    if (this._flightMode === "travel" || this._flightMode === "orbit") {
      return this._fwd;
    }
    return this.forwardFromYawPitch();
  }

  right() {
    return normalize3(cross3(this.forward(), this._viewUp()));
  }

  _viewUp() {
    if (this._flightMode === "travel" || this._flightMode === "orbit") {
      return this._upBody;
    }
    return this.up;
  }

  _syncYawPitchFromDir(dir) {
    const d = normalize3(dir);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, d.z)));
    this.yaw = Math.atan2(d.y, d.x);
  }

  update(dt) {
    const dtClamped = Math.min(dt, 0.05);

    let speed = this.moveSpeed;
    if (this._keys.has("ShiftLeft")) speed *= 3;
    if (this._keys.has("Space")) speed *= 0.35;

    const f = this.forward();
    const r = this.right();
    let move = { x: 0, y: 0, z: 0 };

    if (this._keys.has("KeyW")) move = add3(move, f);
    if (this._keys.has("KeyS")) move = add3(move, scale3(f, -1));
    if (this._keys.has("KeyD")) move = add3(move, r);
    if (this._keys.has("KeyA")) move = add3(move, scale3(r, -1));
    if (this._keys.has("KeyE")) move = add3(move, this.up);
    if (this._keys.has("KeyQ")) move = add3(move, scale3(this.up, -1));

    const len = Math.hypot(move.x, move.y, move.z);
    if (len > 0) {
      this.clearOrbit();
      this._velocity = { x: 0, y: 0, z: 0 };
      move = scale3(move, (speed * dtClamped) / len);
      this.position = add3(this.position, move);
      return;
    }

    if (this._flightMode === "travel" && this._travel && this._slot) {
      this._updateTravel(dtClamped);
      return;
    }

    if (!this._slot) return;
    if (this._orbitDragging) return;

    if (this._flightMode === "orbit" && this._reattachCooldown <= 0) {
      this._updateOrbit(dtClamped);
      return;
    }

    if (this._reattachCooldown > 0) {
      this._reattachCooldown = Math.max(0, this._reattachCooldown - dtClamped);
      if (this._reattachCooldown <= 0) {
        this.attachSpring();
      }
    }
  }

  /**
   * Bezier position + spring-driven shortest-arc rotation toward the star.
   */
  _updateTravel(dt) {
    const tr = this._travel;
    const slot = this._slot;
    if (!tr || !slot) return;

    tr.elapsed = Math.min(tr.duration, tr.elapsed + dt);
    const u = tr.elapsed / tr.duration;

    if (u < 0.12) this._phase = "depart";
    else if (u < ARRIVE_REVEAL_U) this._phase = "cruise";
    else this._phase = "arrive";

    this.position = cubicBezier3(tr.p0, tr.p1, tr.p2, tr.p3, u);
    this._velocity = scale3(
      cubicBezierDerivative3(tr.p0, tr.p1, tr.p2, tr.p3, u),
      1 / tr.duration
    );

    // Target facing: look at destination star (shortest arc on the sphere)
    const toStar = sub3(tr.dest, this.position);
    const targetFwd =
      length3(toStar) > 1e-6 ? normalize3(toStar) : this._fwd;

    const look = springRotateToward(
      this._fwd,
      targetFwd,
      this._lookAngVel,
      dt
    );
    this._fwd = look.dir;
    this._lookAngVel = look.angVel;
    // Blend camera up toward the planetary plane normal along the hop
    const upMix = smoothstep(clamp((u - 0.35) / 0.5, 0, 1));
    const desiredUp = normalize3(lerp3(WORLD_UP, tr.arrivalUp, upMix));
    this._upBody = orthonormalizeUp(this._fwd, desiredUp);
    this._syncYawPitchFromDir(this._fwd);

    if (u >= 1 - 1e-6) {
      this._beginOrbit();
    }
  }

  _beginOrbit() {
    const tr = this._travel;
    const slot = this._slot;
    if (slot) {
      slot.elevation = ARRIVAL_ELEVATION;
      this.position = { ...orbitPosition(slot) };
      this._syncSlotAzimuthFromPos();
      if (tr) {
        this._velocity = { ...tr.vEnd };
      } else {
        this._seedTangentFromSlot();
      }
      const look = normalize3(sub3(slot.target, this.position));
      this._fwd = look;
      this._upBody = orthonormalizeUp(look, slot.basis.ey);
      this._syncYawPitchFromDir(look);
    }
    this._lookAngVel = 0;
    this._travel = null;
    this._flightMode = "orbit";
    this._phase = "orbit";
  }

  /** Continuous overlook: advance azimuth, keep nose on star, up = plane normal. */
  _updateOrbit(dt) {
    const slot = this._slot;
    if (!slot?.basis) return;

    slot.elevation = ARRIVAL_ELEVATION;
    slot.azimuth += this.autoOrbitSpeed * dt;

    const desiredPos = orbitPosition(slot);
    const desiredVel = orbitTangentVelocity(slot, this.autoOrbitSpeed);

    // Soft track so Bezier handoff never pops even if numerical drift
    this.position = lerp3(this.position, desiredPos, clamp(6 * dt, 0, 1));
    this._velocity = lerp3(this._velocity, desiredVel, clamp(6 * dt, 0, 1));

    const lookStar = normalize3(sub3(slot.target, this.position));
    const look = springRotateToward(
      this._fwd,
      lookStar,
      this._lookAngVel,
      dt
    );
    this._fwd = look.dir;
    this._lookAngVel = look.angVel;
    this._upBody = orthonormalizeUp(this._fwd, slot.basis.ey);
    this._syncYawPitchFromDir(this._fwd);
  }

  _syncSlotAzimuthFromPos() {
    if (!this._slot?.basis) return;
    const s = cameraToSlotSpherical(
      this.position,
      this._slot.target,
      this._slot.basis
    );
    if (s.distance > 1e-4) {
      this._slot.azimuth = s.azimuth;
    }
  }

  viewMatrix() {
    if (this._flightMode === "travel" || this._flightMode === "orbit") {
      const look = add3(this.position, this._fwd);
      let up = this._upBody;
      const back = normalize3(sub3(this.position, look));
      if (Math.abs(dot3(up, back)) > 0.98) up = WORLD_UP;
      return lookAt(this.position, look, up);
    }
    if (this._slot && !this._orbitDragging && this._reattachCooldown > 0) {
      const target = add3(this.position, this.forwardFromYawPitch());
      return lookAt(this.position, target, WORLD_UP);
    }
    if (this._slot) {
      const look = this._slot.target;
      const up = this._slot.basis?.ey || WORLD_UP;
      return lookAt(this.position, look, up);
    }
    const target = add3(this.position, this.forwardFromYawPitch());
    return lookAt(this.position, target, this.up);
  }
}

/**
 * @typedef {object} OrbitBasis
 * @property {{x:number,y:number,z:number}} ex
 * @property {{x:number,y:number,z:number}} ey
 * @property {{x:number,y:number,z:number}} ez
 */

/**
 * @typedef {object} OrbitSlot
 * @property {{x:number,y:number,z:number}} target
 * @property {number} distance
 * @property {number} azimuth
 * @property {number} elevation
 * @property {OrbitBasis} basis
 * @property {string} [name]
 */

/**
 * @typedef {object} TravelState
 * @property {{x:number,y:number,z:number}} p0
 * @property {{x:number,y:number,z:number}} p1
 * @property {{x:number,y:number,z:number}} p2
 * @property {{x:number,y:number,z:number}} p3
 * @property {{x:number,y:number,z:number}} vEnd
 * @property {number} duration
 * @property {number} elapsed
 * @property {{x:number,y:number,z:number}} dest
 * @property {{x:number,y:number,z:number}} arrivalUp
 */

function orbitPosition(slot) {
  const { target, distance, azimuth, elevation, basis } = slot;
  const cp = Math.cos(elevation);
  const sp = Math.sin(elevation);
  const ca = Math.cos(azimuth);
  const sa = Math.sin(azimuth);
  const rx = basis.ex.x * ca + basis.ez.x * sa;
  const ry = basis.ex.y * ca + basis.ez.y * sa;
  const rz = basis.ex.z * ca + basis.ez.z * sa;
  return {
    x: target.x + distance * (cp * rx + sp * basis.ey.x),
    y: target.y + distance * (cp * ry + sp * basis.ey.y),
    z: target.z + distance * (cp * rz + sp * basis.ey.z),
  };
}

/** Tangential velocity on the overlook cone: ∂orbitPosition/∂azimuth · ω. */
function orbitTangentVelocity(slot, omega) {
  const { distance, azimuth, elevation, basis } = slot;
  const cp = Math.cos(elevation);
  const dca = -Math.sin(azimuth);
  const dsa = Math.cos(azimuth);
  const drx = basis.ex.x * dca + basis.ez.x * dsa;
  const dry = basis.ex.y * dca + basis.ez.y * dsa;
  const drz = basis.ex.z * dca + basis.ez.z * dsa;
  return {
    x: distance * cp * drx * omega,
    y: distance * cp * dry * omega,
    z: distance * cp * drz * omega,
  };
}

function nearestOverlookAzimuth(cameraPos, starPos, basis, yawFallback) {
  const offset = sub3(cameraPos, starPos);
  const alongN = dot3(offset, basis.ey);
  const proj = {
    x: offset.x - basis.ey.x * alongN,
    y: offset.y - basis.ey.y * alongN,
    z: offset.z - basis.ey.z * alongN,
  };
  if (length3(proj) < 1e-5) {
    return yawFallback;
  }
  return Math.atan2(dot3(proj, basis.ez), dot3(proj, basis.ex));
}

function cameraToSlotSpherical(cameraPos, starPos, basis) {
  const offset = sub3(cameraPos, starPos);
  const distance = length3(offset);
  if (distance < 1e-6) {
    return { distance: 0, azimuth: 0, elevation: ARRIVAL_ELEVATION };
  }
  const dir = scale3(offset, 1 / distance);
  const elevation = Math.asin(
    Math.max(-1, Math.min(1, dot3(dir, basis.ey)))
  );
  const alongN = dot3(offset, basis.ey);
  const proj = {
    x: offset.x - basis.ey.x * alongN,
    y: offset.y - basis.ey.y * alongN,
    z: offset.z - basis.ey.z * alongN,
  };
  let azimuth = 0;
  if (length3(proj) > 1e-6) {
    azimuth = Math.atan2(dot3(proj, basis.ez), dot3(proj, basis.ex));
  }
  return { distance, azimuth, elevation };
}

function orthonormalizeUp(forward, approxUp) {
  const f = normalize3(forward);
  let up = approxUp;
  if (length3(up) < 1e-6) up = WORLD_UP;
  let r = cross3(f, up);
  if (length3(r) < 1e-6) {
    r = cross3(f, WORLD_UP);
    if (length3(r) < 1e-6) r = cross3(f, { x: 1, y: 0, z: 0 });
  }
  r = normalize3(r);
  return normalize3(cross3(r, f));
}

/**
 * Critically damped spring along the shortest arc from `from` toward `to`.
 * Error θ = acos(dot); accel = −k·θ − c·ω so |ω| falls as heading converges.
 * @returns {{dir:{x:number,y:number,z:number}, angVel:number}}
 */
function springRotateToward(from, to, angVel, dt) {
  const a = normalize3(from);
  const b = normalize3(to);
  const d = clamp(dot3(a, b), -1, 1);
  if (d > 0.999999) {
    return { dir: b, angVel: 0 };
  }

  const error = Math.acos(d);
  let ω = angVel;
  const accel = -LOOK_SPRING_STIFF * error - LOOK_SPRING_DAMP * ω;
  ω += accel * dt;

  // Integrate along the arc; clamp so we never overshoot the target heading
  let step = ω * dt;
  if (step <= 0) {
    // Spring pulled the wrong way (rare with semi-implicit); nudge toward target
    ω = Math.max(ω, 0);
    step = Math.max(0, ω * dt);
  }
  if (step >= error) {
    return { dir: b, angVel: 0 };
  }
  if (step < 1e-10) {
    return { dir: a, angVel: ω };
  }

  let axis = cross3(a, b);
  if (length3(axis) < 1e-8) {
    axis = cross3(a, WORLD_UP);
    if (length3(axis) < 1e-8) axis = cross3(a, { x: 1, y: 0, z: 0 });
  }
  axis = normalize3(axis);
  return { dir: rotateAroundAxis(a, axis, step), angVel: ω };
}

function rotateAroundAxis(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot3(axis, v);
  return normalize3({
    x: v.x * c + (axis.y * v.z - axis.z * v.y) * s + axis.x * d * (1 - c),
    y: v.y * c + (axis.z * v.x - axis.x * v.z) * s + axis.y * d * (1 - c),
    z: v.z * c + (axis.x * v.y - axis.y * v.x) * s + axis.z * d * (1 - c),
  });
}

function cubicBezier3(p0, p1, p2, p3, u) {
  const t = clamp(u, 0, 1);
  const o = 1 - t;
  const o2 = o * o;
  const o3 = o2 * o;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: o3 * p0.x + 3 * o2 * t * p1.x + 3 * o * t2 * p2.x + t3 * p3.x,
    y: o3 * p0.y + 3 * o2 * t * p1.y + 3 * o * t2 * p2.y + t3 * p3.y,
    z: o3 * p0.z + 3 * o2 * t * p1.z + 3 * o * t2 * p2.z + t3 * p3.z,
  };
}

/** dB/du for a cubic Bezier (scale by 1/duration for world velocity). */
function cubicBezierDerivative3(p0, p1, p2, p3, u) {
  const t = clamp(u, 0, 1);
  const o = 1 - t;
  return {
    x: 3 * o * o * (p1.x - p0.x) + 6 * o * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * o * o * (p1.y - p0.y) + 6 * o * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
    z: 3 * o * o * (p1.z - p0.z) + 6 * o * t * (p2.z - p1.z) + 3 * t * t * (p3.z - p2.z),
  };
}

function lerp3(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
