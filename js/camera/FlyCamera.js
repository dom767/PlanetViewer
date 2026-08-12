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
 * Attitude spring (critically damped) acting on the rotation vector between
 * the current and desired camera basis. Angular velocity carries across
 * frames, so rate rises with misalignment and decays as the basis converges.
 */
const ATTITUDE_STIFFNESS = 7;
const ATTITUDE_DAMPING = 2 * Math.sqrt(ATTITUDE_STIFFNESS);
const MAX_ANGULAR_SPEED = 2.0;

/**
 * Hop duration grows with the log of the distance: a short trip inside
 * {@link TRAVEL_NEAR_PC} takes {@link TRAVEL_NEAR_SECONDS}, and each further
 * decade adds {@link TRAVEL_SECONDS_PER_DECADE} — so 10 pc ≈ 2 s, 100 pc ≈ 5 s,
 * 1000 pc ≈ 8 s — up to a hard ceiling.
 */
const TRAVEL_NEAR_PC = 10;
const TRAVEL_NEAR_SECONDS = 2;
const TRAVEL_SECONDS_PER_DECADE = 3;
const TRAVEL_MAX_SECONDS = 9;
/**
 * Spool up to cruise over this long, but never more than a quarter of the hop
 * so brief trips keep a recognisable accelerate / cruise / brake shape.
 */
const DEPART_ACCEL_SECONDS = 1.4;
const DEPART_ACCEL_FRACTION = 0.25;
/**
 * Burn off cruise speed over this long, settling onto the orbit tangent. Far
 * hops cruise faster and so need longer to shed it: the brake grows with the
 * log of the path length, which keeps peak deceleration roughly in check
 * without letting the brake eat the whole hop.
 */
const ARRIVAL_BRAKE_SECONDS = 1.5;
const ARRIVAL_BRAKE_MAX_SECONDS = 3.2;
const ARRIVAL_BRAKE_GROWTH = 0.45;
const ARRIVAL_BRAKE_REFERENCE_PC = 12;
const ARRIVAL_BRAKE_FRACTION = 0.45;
/**
 * Weights the brake towards its tail. Raising a ramp to this power sheds speed
 * early and then creeps in, so the closing rate measured against the remaining
 * distance stays roughly constant — what stops a far arrival from ballooning
 * in the last moment. 1 would be a plain symmetric ramp.
 */
const BRAKE_TAIL_POWER = 2.6;
/** Samples used to integrate the speed profile into a distance-vs-time table. */
const TIMING_SAMPLES = 512;
/**
 * Fallback clock warp, used only when a hop is too short to fit the
 * accelerate / cruise / brake schedule. Endpoint rates stay exactly 1, so the
 * curve's start and end velocities are untouched.
 */
const TRAVEL_EASE_BIAS = 6;
/** Cap on each Hermite tangent, as a fraction of the hop, to curb overshoot. */
const MAX_TANGENT_FRAC = 0.4;
/** Arc-length samples used to convert distance travelled into a curve param. */
const ARC_SAMPLES = 128;

/**
 * Free-fly camera with Bezier travel between systems.
 *
 * Orientation is an orthonormal basis (no yaw/pitch integration): each frame
 * the shortest rotation from the current basis to the desired one is fed to a
 * critically damped angular spring, so turning accelerates while misaligned
 * and eases off as it converges — with no snap at any hand-off.
 *
 * Position follows a cubic Bezier whose end tangents are the camera's current
 * velocity and the parking orbit's tangent velocity, giving C1 continuity into
 * and out of every hop.
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

    /** Camera basis (travel / orbit). Free look drives it from yaw/pitch. */
    this._fwd = this.forwardFromYawPitch();
    this._upBody = orthonormalizeUp(this._fwd, WORLD_UP);
    /** World-space angular velocity (rad/s) of the attitude spring. */
    this._angVel = { x: 0, y: 0, z: 0 };
    /** Previous desired basis, used to feed the target's own rotation rate. */
    this._prevTargetBasis = null;
    /** World-space linear velocity (pc/s), continuous across hops. */
    this._velocity = { x: 0, y: 0, z: 0 };

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
      const active = globalThis.document?.activeElement;
      const inSheet =
        active instanceof HTMLElement &&
        (active.closest(".app-sheet") != null ||
          active.closest("#info-panel") != null);
      const moveCodes = [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "KeyQ",
        "KeyE",
        "ShiftLeft",
        "Space",
      ];

      // Don't steal keys while typing in search/settings/info — and do not
      // preventDefault, or letters like E (camera-up) never reach the input.
      if (inSheet) return;

      this._keys.add(e.code);
      if (moveCodes.includes(e.code)) e.preventDefault();
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
      this._setBasisFromDir(this.forwardFromYawPitch(), WORLD_UP);
      this._angVel = { x: 0, y: 0, z: 0 };
      this._prevTargetBasis = null;
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
   * Begin a hop to `target`. Start pose, heading and velocity are all carried
   * into the new curve, so re-targeting mid-flight stays smooth.
   *
   * @param {{x:number,y:number,z:number,name?:string,planets?:object[]}} target
   * @param {number} distance
   * @param {{x:number,y:number,z:number}|null} [fromStar]
   */
  focusOn(target, distance = 2.5, fromStar = null) {
    if (this._flightMode === "free") {
      // Free look tracks yaw/pitch; adopt it as the basis we spring away from
      this._setBasisFromDir(this.forwardFromYawPitch(), WORLD_UP);
    }
    // New destination: the desired basis jumps, so drop the drift estimate
    this._prevTargetBasis = null;

    const dest = { x: target.x, y: target.y, z: target.z };
    const basis =
      target.planets?.length > 0
        ? planetaryOrbitBasis(target, this.position)
        : cameraAlignedOrbitBasis(dest, this.position, ARRIVAL_ELEVATION);
    const prevAnchor = this._anchorStar ? { ...this._anchorStar } : null;

    this._slot = {
      target: dest,
      distance,
      azimuth: nearestOverlookAzimuth(this.position, dest, basis, this.yaw),
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
    const duration = travelDurationFor(length3(sub3(dest, p0)));

    // Hermite tangents: leave along current velocity, arrive along the orbit
    // tangent. A near-zero start tangent eases out of rest naturally.
    const v0 = { ...this._velocity };
    const v1 = orbitTangentVelocity(this._slot, this.autoOrbitSpeed);
    const tangentLimit = MAX_TANGENT_FRAC * Math.max(length3(sub3(p3, p0)), 1e-3);
    const p1 = add3(p0, clampLength(scale3(v0, duration / 3), tangentLimit));
    const p2 = sub3(p3, clampLength(scale3(v1, duration / 3), tangentLimit));

    // Timing is driven along the path itself, so the brake lasts a set number
    // of seconds no matter how the curve is shaped.
    const arc = buildArcTable(p0, p1, p2, p3);
    const schedule = buildSpeedSchedule(
      arc.length,
      length3(v0),
      length3(v1),
      duration
    );

    this._travel = {
      p0,
      p1,
      p2,
      p3,
      arc,
      schedule,
      vEnd: v1,
      duration,
      elapsed: 0,
      dest,
      departUp: { ...this._upBody },
      arrivalUp: { ...basis.ey },
    };

    this._flightMode = "travel";
    this._phase = source ? "depart" : "cruise";
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
      if (this._slot) {
        this._flightMode = "orbit";
        this._phase = "orbit";
      } else {
        this._flightMode = "free";
        this._velocity = { x: 0, y: 0, z: 0 };
      }
    }
  }

  clearOrbit() {
    this._slot = null;
    this._travel = null;
    this._reattachCooldown = 0;
    this._flightMode = "free";
    this._phase = "orbit";
    this._setBasisFromDir(this.forwardFromYawPitch(), WORLD_UP);
    this._angVel = { x: 0, y: 0, z: 0 };
    this._prevTargetBasis = null;
    this._velocity = { x: 0, y: 0, z: 0 };
  }

  /** Resume the overlook orbit after a drag / zoom pause. */
  attachSpring() {
    if (!this._slot) return;
    this._slot.elevation = ARRIVAL_ELEVATION;
    this._travel = null;
    this._flightMode = "orbit";
    this._phase = "orbit";
    this._reattachCooldown = 0;
    this._seedTangentFromSlot();
  }

  detachSpring() {
    this._travel = null;
    if (this._slot) {
      this._flightMode = "orbit";
      this._phase = "orbit";
    }
  }

  /** Snap to the slot pose — used by direct manipulation (orbit drag, zoom). */
  applyOrbitPose() {
    if (!this._slot) return;
    this.position = { ...orbitPosition(this._slot) };
    const dir = normalize3(sub3(this._slot.target, this.position));
    this._setBasisFromDir(dir, this._slot.basis?.ey || WORLD_UP);
    this._angVel = { x: 0, y: 0, z: 0 };
    this._prevTargetBasis = null;
    this._seedTangentFromSlot();
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

  /** Set the basis directly and keep yaw/pitch in sync for free-look handoff. */
  _setBasisFromDir(dir, approxUp) {
    this._fwd = normalize3(dir);
    this._upBody = orthonormalizeUp(this._fwd, approxUp);
    this._syncYawPitchFromDir(this._fwd);
  }

  _syncYawPitchFromDir(dir) {
    const d = normalize3(dir);
    this.pitch = Math.asin(clamp(d.z, -1, 1));
    this.yaw = Math.atan2(d.y, d.x);
  }

  /**
   * Drive the camera basis toward (`targetFwd`, `targetUp`) with a critically
   * damped angular spring. Uses the shortest rotation between the two bases,
   * so heading and roll converge together without yaw/pitch coupling.
   */
  _springAttitude(targetFwd, targetUp, dt) {
    const desiredFwd = normalize3(targetFwd);
    const desiredUp = orthonormalizeUp(desiredFwd, targetUp);

    // Rotation vector (axis × angle) taking the current basis to the target
    const rotVec = rotationVectorBetweenBases(
      this._fwd,
      this._upBody,
      desiredFwd,
      desiredUp
    );

    // Rate at which the target itself is turning; damping is measured against
    // it so a moving target is tracked without a standing heading error.
    let feedForward = { x: 0, y: 0, z: 0 };
    const prev = this._prevTargetBasis;
    if (prev && dt > 1e-6) {
      const drift = rotationVectorBetweenBases(
        prev.fwd,
        prev.up,
        desiredFwd,
        desiredUp
      );
      feedForward = scale3(drift, 1 / dt);
      const ffSpin = length3(feedForward);
      if (ffSpin > MAX_ANGULAR_SPEED) {
        feedForward = scale3(feedForward, MAX_ANGULAR_SPEED / ffSpin);
      }
    }
    this._prevTargetBasis = { fwd: desiredFwd, up: desiredUp };

    // ω̇ = k·θ − c·(ω − ω_target)  (semi-implicit: integrate ω, then the basis)
    this._angVel = add3(
      this._angVel,
      scale3(
        sub3(
          scale3(rotVec, ATTITUDE_STIFFNESS),
          scale3(sub3(this._angVel, feedForward), ATTITUDE_DAMPING)
        ),
        dt
      )
    );

    const spin = length3(this._angVel);
    if (spin > MAX_ANGULAR_SPEED) {
      this._angVel = scale3(this._angVel, MAX_ANGULAR_SPEED / spin);
    }

    const angle = length3(this._angVel) * dt;
    if (angle > 1e-9) {
      const axis = normalize3(this._angVel);
      this._fwd = rotateAroundAxis(this._fwd, axis, angle);
      this._upBody = rotateAroundAxis(this._upBody, axis, angle);
    }
    this._upBody = orthonormalizeUp(this._fwd, this._upBody);
    this._syncYawPitchFromDir(this._fwd);
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

  /** Bezier position along the hop; attitude springs toward the target star. */
  _updateTravel(dt) {
    const tr = this._travel;
    if (!tr) return;

    tr.elapsed = Math.min(tr.duration, tr.elapsed + dt);
    const t = tr.elapsed;
    const s = t / tr.duration;
    const sched = tr.schedule;

    if (sched) {
      this._phase =
        t < sched.accelSeconds
          ? "depart"
          : t < tr.duration - sched.brakeSeconds
            ? "cruise"
            : "arrive";
    } else {
      this._phase = s < 0.15 ? "depart" : s < 0.7 ? "cruise" : "arrive";
    }

    let u;
    let speed = null;
    if (sched) {
      u = uAtDistance(tr.arc, scheduledDistance(sched, t));
      speed = scheduledSpeed(sched, t);
    } else {
      u = travelEase(s);
    }

    const bezierPos = cubicBezier3(tr.p0, tr.p1, tr.p2, tr.p3, u);
    const tangent = cubicBezierDerivative3(tr.p0, tr.p1, tr.p2, tr.p3, u);
    if (speed !== null) {
      // Direction from the curve, magnitude straight from the schedule
      this._velocity =
        length3(tangent) > 1e-9
          ? scale3(normalize3(tangent), speed)
          : { ...tr.vEnd };
    } else {
      this._velocity = scale3(tangent, travelEaseRate(s) / tr.duration);
    }

    // During the brake phase, ease onto the live overlook ring and advance
    // azimuth so the look-at target is already rotating before orbit mode.
    const slot = this._slot;
    if (slot?.basis && this._phase === "arrive") {
      slot.elevation = ARRIVAL_ELEVATION;
      slot.azimuth += this.autoOrbitSpeed * dt;

      let arriveBlend;
      if (sched) {
        const arriveStart = tr.duration - sched.brakeSeconds;
        arriveBlend = smootherstep(
          clamp((t - arriveStart) / Math.max(sched.brakeSeconds, 1e-6), 0, 1)
        );
      } else {
        arriveBlend = smootherstep(clamp((u - 0.7) / 0.3, 0, 1));
      }

      const orbitPos = orbitPosition(slot);
      this.position = lerp3(bezierPos, orbitPos, arriveBlend);
      if (arriveBlend > 0) {
        const orbitVel = orbitTangentVelocity(slot, this.autoOrbitSpeed);
        this._velocity = lerp3(this._velocity, orbitVel, arriveBlend);
      }
    } else {
      this.position = bezierPos;
    }

    // Face the destination star; roll from the hop's starting up toward the
    // planetary plane. Starting from current up (not world-up) avoids a
    // 180° there-and-back when already parked in the opposite hemisphere.
    const toStar = sub3(tr.dest, this.position);
    const targetFwd = length3(toStar) > 1e-6 ? normalize3(toStar) : this._fwd;
    const upMix = smoothstep(clamp((u - 0.25) / 0.55, 0, 1));
    const fromUp = tr.departUp || WORLD_UP;
    const targetUp = normalize3(lerp3(fromUp, tr.arrivalUp, upMix));
    this._springAttitude(targetFwd, targetUp, dt);

    if (s >= 1 - 1e-6) this._beginOrbit();
  }

  /**
   * Hand off to the overlook orbit. Position and velocity already match the
   * curve endpoint, and attitude keeps springing, so nothing snaps here.
   */
  _beginOrbit() {
    if (this._slot) {
      this._slot.elevation = ARRIVAL_ELEVATION;
      this._syncSlotAzimuthFromPos();
    }
    this._travel = null;
    this._flightMode = "orbit";
    this._phase = "orbit";
  }

  /** Continuous overlook: advance azimuth, nose on star, up = plane normal. */
  _updateOrbit(dt) {
    const slot = this._slot;
    if (!slot?.basis) return;

    slot.elevation = ARRIVAL_ELEVATION;
    slot.azimuth += this.autoOrbitSpeed * dt;

    // Carry the camera along the ring tangent (so arrival speed is preserved
    // exactly), then bleed off any residual offset from a hop or drag.
    const tangent = orbitTangentVelocity(slot, this.autoOrbitSpeed);
    const carried = add3(this.position, scale3(tangent, dt));
    const nextPos = lerp3(carried, orbitPosition(slot), clamp(3 * dt, 0, 1));
    this._velocity = scale3(sub3(nextPos, this.position), 1 / Math.max(dt, 1e-6));
    this.position = nextPos;

    const lookStar = sub3(slot.target, this.position);
    const targetFwd = length3(lookStar) > 1e-6 ? normalize3(lookStar) : this._fwd;
    this._springAttitude(targetFwd, slot.basis.ey, dt);
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
      return lookAt(this.position, add3(this.position, this._fwd), this._upBody);
    }
    if (this._slot && !this._orbitDragging && this._reattachCooldown > 0) {
      const target = add3(this.position, this.forwardFromYawPitch());
      return lookAt(this.position, target, WORLD_UP);
    }
    if (this._slot) {
      return lookAt(this.position, this._slot.target, this._slot.basis?.ey || WORLD_UP);
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
 * @property {{x:number,y:number,z:number}} departUp
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
  if (length3(proj) < 1e-5) return yawFallback;
  return Math.atan2(dot3(proj, basis.ez), dot3(proj, basis.ex));
}

function cameraToSlotSpherical(cameraPos, starPos, basis) {
  const offset = sub3(cameraPos, starPos);
  const distance = length3(offset);
  if (distance < 1e-6) {
    return { distance: 0, azimuth: 0, elevation: ARRIVAL_ELEVATION };
  }
  const dir = scale3(offset, 1 / distance);
  const elevation = Math.asin(clamp(dot3(dir, basis.ey), -1, 1));
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

/** Component of `approxUp` perpendicular to `forward`, normalised. */
function orthonormalizeUp(forward, approxUp) {
  const f = normalize3(forward);
  let up = approxUp;
  if (!up || length3(up) < 1e-6) up = WORLD_UP;
  let r = cross3(up, f);
  if (length3(r) < 1e-6) {
    r = cross3(WORLD_UP, f);
    if (length3(r) < 1e-6) r = cross3({ x: 1, y: 0, z: 0 }, f);
  }
  r = normalize3(r);
  return normalize3(cross3(f, r));
}

/**
 * Shortest rotation taking basis A to basis B, as an axis × angle vector.
 * Both bases are given as (forward, up); right is derived as up × forward.
 */
function rotationVectorBetweenBases(fwdA, upA, fwdB, upB) {
  const fA = normalize3(fwdA);
  const uA = orthonormalizeUp(fA, upA);
  const rA = cross3(uA, fA);
  const fB = normalize3(fwdB);
  const uB = orthonormalizeUp(fB, upB);
  const rB = cross3(uB, fB);

  // D = B · Aᵀ, where each basis is the matrix with columns (right, up, fwd)
  const d = (bi, aj) => bi.r * aj.r + bi.u * aj.u + bi.f * aj.f;
  const row = (i) => ({
    r: component(rB, i),
    u: component(uB, i),
    f: component(fB, i),
  });
  const col = (j) => ({
    r: component(rA, j),
    u: component(uA, j),
    f: component(fA, j),
  });
  const b0 = row(0);
  const b1 = row(1);
  const b2 = row(2);
  const a0 = col(0);
  const a1 = col(1);
  const a2 = col(2);

  const m00 = d(b0, a0);
  const m11 = d(b1, a1);
  const m22 = d(b2, a2);
  const trace = m00 + m11 + m22;
  const angle = Math.acos(clamp((trace - 1) / 2, -1, 1));
  if (angle < 1e-7) return { x: 0, y: 0, z: 0 };

  const sin = Math.sin(angle);
  if (sin > 1e-6) {
    const k = angle / (2 * sin);
    return {
      x: (d(b2, a1) - d(b1, a2)) * k,
      y: (d(b0, a2) - d(b2, a0)) * k,
      z: (d(b1, a0) - d(b0, a1)) * k,
    };
  }

  // Near 180°: axis from the dominant diagonal of (D + I) / 2
  const xx = (m00 + 1) / 2;
  const yy = (m11 + 1) / 2;
  const zz = (m22 + 1) / 2;
  const xy = (d(b0, a1) + d(b1, a0)) / 4;
  const xz = (d(b0, a2) + d(b2, a0)) / 4;
  const yz = (d(b1, a2) + d(b2, a1)) / 4;
  let axis;
  if (xx >= yy && xx >= zz) {
    const x = Math.sqrt(Math.max(xx, 0)) || 1e-6;
    axis = { x, y: xy / x, z: xz / x };
  } else if (yy >= zz) {
    const y = Math.sqrt(Math.max(yy, 0)) || 1e-6;
    axis = { x: xy / y, y, z: yz / y };
  } else {
    const z = Math.sqrt(Math.max(zz, 0)) || 1e-6;
    axis = { x: xz / z, y: yz / z, z };
  }
  return scale3(normalize3(axis), angle);
}

function component(v, i) {
  return i === 0 ? v.x : i === 1 ? v.y : v.z;
}

/** Rodrigues rotation of `v` about a unit `axis`. */
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

/**
 * Seconds to spend crossing `distancePc`, on a log scale between a floor for
 * anything nearby and a hard ceiling for the far side of the catalog.
 */
function travelDurationFor(distancePc) {
  if (!(distancePc > TRAVEL_NEAR_PC)) return TRAVEL_NEAR_SECONDS;
  const decades = Math.log10(distancePc / TRAVEL_NEAR_PC);
  return Math.min(
    TRAVEL_MAX_SECONDS,
    TRAVEL_NEAR_SECONDS + TRAVEL_SECONDS_PER_DECADE * decades
  );
}

/**
 * Sample the curve into a distance → parameter table. Driving the hop by
 * distance (rather than by the raw Bezier parameter) is what lets the brake
 * last a fixed number of seconds instead of a fixed slice of the curve.
 */
function buildArcTable(p0, p1, p2, p3) {
  const us = new Float64Array(ARC_SAMPLES + 1);
  const ds = new Float64Array(ARC_SAMPLES + 1);
  let prev = p0;
  let acc = 0;
  for (let i = 1; i <= ARC_SAMPLES; i++) {
    const u = i / ARC_SAMPLES;
    const pt = cubicBezier3(p0, p1, p2, p3, u);
    acc += length3(sub3(pt, prev));
    prev = pt;
    us[i] = u;
    ds[i] = acc;
  }
  return { us, ds, length: acc };
}

function uAtDistance(arc, distance) {
  const { us, ds } = arc;
  const n = ds.length - 1;
  if (distance <= 0) return 0;
  if (distance >= ds[n]) return 1;
  let lo = 0;
  let hi = n;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (ds[mid] <= distance) lo = mid;
    else hi = mid;
  }
  const span = ds[hi] - ds[lo];
  const f = span > 1e-12 ? (distance - ds[lo]) / span : 0;
  return us[lo] + (us[hi] - us[lo]) * f;
}

/**
 * Fraction of cruise speed still carried, `x` of the way through the brake.
 * Falls to zero with zero slope and curvature at both ends, so the
 * deceleration fades in and out instead of switching on.
 */
function brakeShape(x) {
  // Guard the base: the quintic can round a hair above 1 near the end, and a
  // negative base would make the fractional power NaN.
  return Math.pow(Math.max(0, 1 - smootherstep(clamp(x, 0, 1))), BRAKE_TAIL_POWER);
}

/**
 * The speed profile is affine in cruise speed: `base(t) + gain(t)·cruise`.
 * Splitting it this way lets the cruise speed be solved exactly, rather than
 * searched for, whatever shape the ramps take.
 */
function profileBase(sched, t) {
  const { accelSeconds, brakeSeconds, duration } = sched;
  if (t < accelSeconds) {
    return sched.startSpeed * (1 - smootherstep(t / accelSeconds));
  }
  const brakeStart = duration - brakeSeconds;
  if (t < brakeStart) return 0;
  const x = clamp((t - brakeStart) / brakeSeconds, 0, 1);
  return sched.endSpeed * (1 - brakeShape(x));
}

function profileGain(sched, t) {
  const { accelSeconds, brakeSeconds, duration } = sched;
  if (t < accelSeconds) return smootherstep(t / accelSeconds);
  const brakeStart = duration - brakeSeconds;
  if (t < brakeStart) return 1;
  return brakeShape(clamp((t - brakeStart) / brakeSeconds, 0, 1));
}

/** Composite Simpson over [0, duration]. Exact for the cubics involved. */
function integrateProfile(sched, f) {
  const h = sched.duration / TIMING_SAMPLES;
  let acc = 0;
  for (let i = 0; i < TIMING_SAMPLES; i++) {
    const t0 = i * h;
    acc +=
      (h / 6) *
      (f(sched, t0) + 4 * f(sched, t0 + h / 2) + f(sched, t0 + h));
  }
  return acc;
}

/**
 * Accelerate → cruise → brake, with the cruise speed solved so the three
 * phases cover exactly `length` in exactly `duration`. Returns null when the
 * hop is too short to hold a cruise faster than the orbit it ends on.
 */
function buildSpeedSchedule(length, startSpeed, endSpeed, duration) {
  const accelSeconds = Math.min(
    DEPART_ACCEL_SECONDS,
    duration * DEPART_ACCEL_FRACTION
  );
  const brakeSeconds = Math.min(
    ARRIVAL_BRAKE_MAX_SECONDS,
    duration * ARRIVAL_BRAKE_FRACTION,
    ARRIVAL_BRAKE_SECONDS +
      ARRIVAL_BRAKE_GROWTH * Math.log1p(Math.max(length, 0) / ARRIVAL_BRAKE_REFERENCE_PC)
  );
  const cruiseSeconds = duration - accelSeconds - brakeSeconds;
  if (cruiseSeconds <= 0 || length <= 0) return null;

  const sched = {
    accelSeconds,
    brakeSeconds,
    cruiseSeconds,
    startSpeed,
    endSpeed,
    cruiseSpeed: 0,
    duration,
    table: null,
  };

  const baseDistance = integrateProfile(sched, profileBase);
  const gainDistance = integrateProfile(sched, profileGain);
  if (!(gainDistance > 1e-9)) return null;

  sched.cruiseSpeed = (length - baseDistance) / gainDistance;
  if (!(sched.cruiseSpeed > endSpeed) || !(sched.cruiseSpeed > 1e-4)) return null;

  // Built with the same quadrature, so the table ends on exactly `length`
  sched.table = buildDistanceTable(sched);
  return sched;
}

function buildDistanceTable(sched) {
  const h = sched.duration / TIMING_SAMPLES;
  const table = new Float64Array(TIMING_SAMPLES + 1);
  let acc = 0;
  for (let i = 0; i < TIMING_SAMPLES; i++) {
    const t0 = i * h;
    acc +=
      (h / 6) *
      (scheduledSpeed(sched, t0) +
        4 * scheduledSpeed(sched, t0 + h / 2) +
        scheduledSpeed(sched, t0 + h));
    table[i + 1] = acc;
  }
  return table;
}

function scheduledSpeed(sched, t) {
  return profileBase(sched, t) + profileGain(sched, t) * sched.cruiseSpeed;
}

/** Distance covered by time `t`: tabulated whole cells plus an exact partial. */
function scheduledDistance(sched, t) {
  const table = sched.table;
  if (t <= 0) return 0;
  if (t >= sched.duration) return table[TIMING_SAMPLES];
  const h = sched.duration / TIMING_SAMPLES;
  const i = Math.min(TIMING_SAMPLES - 1, Math.floor(t / h));
  const t0 = i * h;
  const dt = t - t0;
  return (
    table[i] +
    (dt / 6) *
      (scheduledSpeed(sched, t0) +
        4 * scheduledSpeed(sched, t0 + dt / 2) +
        scheduledSpeed(sched, t))
  );
}

/**
 * Time warp for the hop: u = s + (bias/2)·s²(1−s)².
 * The added term vanishes with zero slope at both ends, so u′(0) = u′(1) = 1
 * and the Bezier's endpoint velocities survive intact, while the interior is
 * pushed forward — quick departure, unhurried arrival.
 */
function travelEase(s) {
  const w = s * (1 - s);
  return s + (TRAVEL_EASE_BIAS / 2) * w * w;
}

/** du/ds for {@link travelEase}. */
function travelEaseRate(s) {
  return 1 + TRAVEL_EASE_BIAS * s * (1 - s) * (1 - 2 * s);
}

function clampLength(v, maxLen) {
  const l = length3(v);
  return l > maxLen && l > 1e-9 ? scale3(v, maxLen / l) : v;
}

function cubicBezier3(p0, p1, p2, p3, u) {
  const t = clamp(u, 0, 1);
  const o = 1 - t;
  const o2 = o * o;
  const t2 = t * t;
  return {
    x: o2 * o * p0.x + 3 * o2 * t * p1.x + 3 * o * t2 * p2.x + t2 * t * p3.x,
    y: o2 * o * p0.y + 3 * o2 * t * p1.y + 3 * o * t2 * p2.y + t2 * t * p3.y,
    z: o2 * o * p0.z + 3 * o2 * t * p1.z + 3 * o * t2 * p2.z + t2 * t * p3.z,
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

/**
 * Quintic ease. Unlike {@link smoothstep} its second derivative also vanishes
 * at both ends, so a speed ramp built on it starts and stops with no jerk —
 * the deceleration fades in and out rather than switching on.
 */
function smootherstep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
