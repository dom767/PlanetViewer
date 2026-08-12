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

/** Flight-sim tuning (parsecs / seconds, radians). */
const THRUST_ACCEL = 28;
const VMAX_MIN = 14;
const VMAX_MAX = 160;
const VMAX_FRAC = 0.38;
const TURN_GAIN = 1.15;
const MAX_TURN_RATE = 1.1;
const MAX_BANK = 0.85;
const BANK_RATE = 2.4;
const AERO_ALIGN = 1.6;
const CLIMB_OUT_PC = 8;
const INSERT_START_FRAC = 0.22;
const INSERT_START_MIN = 5;
const SIDE_JET_ACCEL = 22;
const INSERT_BRAKE = 32;
const ATTITUDE_RATE = 2.2;
const MATCH_POS_FRAC = 0.45;
const MATCH_SPEED_ERR = 2.5;
const MATCH_HEADING = 0.55;
const MATCH_HOLD_SEC = 0.35;
const ORBIT_RADIAL_GAIN = 4.5;
const ORBIT_SIDE_GAIN = 8;
const LEAVE_BOOST = 12;
const WORLD_UP = { x: 0, y: 0, z: 1 };

/**
 * Free-fly camera with atmospheric flight-sim travel between systems.
 *
 * Guided hops use persistent velocity + banked orientation (aileron turns),
 * then side-jet into a 35° overlook orbit maintained by the same physics.
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
    /** @type {null | GuideState} */
    this._guide = null;
    /** @type {'free'|'guided'|'orbit'} */
    this._flightMode = "free";
    /** Soft phase label for HUD / orbit reveal. */
    /** @type {'depart'|'cruise'|'arrive'|'orbit'} */
    this._phase = "orbit";

    /** Ship velocity (pc/s) — preserved across focus handoffs. */
    this._velocity = { x: 0, y: 0, z: 0 };
    /** Aircraft forward (nose). */
    this._fwd = { x: 1, y: 0, z: 0 };
    /** Aircraft up (banks with ailerons). */
    this._upBody = { ...WORLD_UP };
    /** Current bank angle about forward (radians, signed). */
    this._bank = 0;

    this.autoOrbitResumeDelay = 5.5;
    this._reattachCooldown = 0;
    this.autoOrbitSpeed = (Math.PI * 2) / 90;
    this._orbitSpinBlend = 0;

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
    return this._flightMode === "guided" && !!this._guide;
  }

  /** True once orbits should be shown (insert / physics orbit). */
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
      this._bank = 0;
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
    const prevSlot = this._slot;
    const prevFwd = { ...this._fwd };
    const prevUp = { ...this._upBody };
    const prevBank = this._bank;

    // Seed from current overlook orbit tangent when leaving a host
    if (prevSlot?.basis) {
      this._velocity = orbitTangentVelocity(prevSlot, this.autoOrbitSpeed);
      if (length3(this._velocity) > 0.05) {
        this._fwd = normalize3(this._velocity);
      }
    } else if (length3(this._velocity) < 0.2) {
      this._fwd = this.forwardFromYawPitch();
      this._velocity = scale3(this._fwd, 2.5);
    } else {
      this._fwd = length3(this._velocity) > 0.05
        ? normalize3(this._velocity)
        : prevFwd;
    }

    // Keep departure bank / up — no snap to destination plane
    this._upBody = orthonormalizeUp(this._fwd, prevUp);
    this._bank = prevBank;

    this._guide = null;
    this._flightMode = "free";

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
    this._orbitSpinBlend = 0;

    const source = fromStar
      ? { x: fromStar.x, y: fromStar.y, z: fromStar.z }
      : prevAnchor
        ? prevAnchor
        : null;

    this._anchorStar = dest;

    const end = orbitPosition(this._slot);
    const hop = Math.max(length3(sub3(end, this.position)), 1);
    const vmax = clamp(hop * VMAX_FRAC, VMAX_MIN, VMAX_MAX);

    this._guide = {
      fromStar: source,
      dest,
      arrivalUp: { ...basis.ey },
      hopDist: hop,
      vmax,
      upBlend: 0,
      matchHold: 0,
    };

    this._flightMode = "guided";
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
    if (this._flightMode === "guided") {
      this._guide = null;
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
    this._guide = null;
    this._reattachCooldown = 0;
    this._orbitSpinBlend = 0;
    this._flightMode = "free";
    this._phase = "orbit";
    this._bank = 0;
    this._upBody = { ...WORLD_UP };
    this._fwd = this.forwardFromYawPitch();
  }

  /** Resume physics-maintained overlook orbit after drag / zoom pause. */
  attachSpring() {
    if (!this._slot) return;
    this._slot.elevation = ARRIVAL_ELEVATION;
    this._guide = null;
    this._flightMode = "orbit";
    this._phase = "orbit";
    this._reattachCooldown = 0;
    this._orbitSpinBlend = 0;
    this._seedTangentFromSlot();
    const look = normalize3(sub3(this._slot.target, this.position));
    this._fwd = look;
    this._upBody = orthonormalizeUp(this._fwd, this._slot.basis.ey);
    this._bank = 0;
    this._syncYawPitchFromDir(this._fwd);
  }

  detachSpring() {
    this._guide = null;
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
    this._upBody = orthonormalizeUp(
      dir,
      this._slot.basis?.ey || WORLD_UP
    );
    this._bank = 0;
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
    if (this._flightMode === "guided" || this._flightMode === "orbit") {
      return this._fwd;
    }
    return this.forwardFromYawPitch();
  }

  right() {
    return normalize3(cross3(this.forward(), this._viewUp()));
  }

  _viewUp() {
    if (this._flightMode === "guided" || this._flightMode === "orbit") {
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

    if (this._flightMode === "guided" && this._guide && this._slot) {
      this._updateGuidedFlight(dtClamped);
      return;
    }

    if (!this._slot) return;
    if (this._orbitDragging) return;

    if (this._flightMode === "orbit" && this._reattachCooldown <= 0) {
      this._updatePhysicsOrbit(dtClamped);
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
   * Continuous guided hop: climb-out → cruise (aileron turn + thrust) → insert.
   */
  _updateGuidedFlight(dt) {
    const g = this._guide;
    const slot = this._slot;
    if (!g || !slot) return;

    const slotPos = orbitPosition(slot);
    const toSlot = sub3(slotPos, this.position);
    const distSlot = length3(toSlot);
    const toSlotDir =
      distSlot > 1e-5 ? scale3(toSlot, 1 / distSlot) : this._fwd;

    const insertDist = Math.max(INSERT_START_MIN, g.hopDist * INSERT_START_FRAC);
    const insertMix = smoothstep(
      clamp(1 - distSlot / insertDist, 0, 1)
    );

    let climbMix = 0;
    if (g.fromStar) {
      const dHost = length3(sub3(this.position, g.fromStar));
      climbMix = 1 - smoothstep(clamp(dHost / CLIMB_OUT_PC, 0, 1));
    }

    if (insertMix > 0.55) this._phase = "arrive";
    else if (climbMix > 0.35) this._phase = "depart";
    else this._phase = "cruise";

    g.upBlend = Math.min(1, g.upBlend + insertMix * dt * 0.9);

    // --- Desired cruise heading (toward slot), blended through climb-out ---
    let desiredCruise = toSlotDir;
    if (climbMix > 0 && g.fromStar) {
      let leave = sub3(this.position, g.fromStar);
      if (length3(leave) < 1e-4) leave = this._fwd;
      else leave = normalize3(leave);
      desiredCruise = normalize3(lerp3(toSlotDir, leave, climbMix * 0.65));
    }

    // Insert: look at star; cruise: track desired cruise heading
    const lookStar = normalize3(sub3(slot.target, this.position));
    const desiredFwd = normalize3(
      lerp3(desiredCruise, lookStar, insertMix)
    );

    // --- Aileron turn: rate ∝ heading error (tapers as we align) ---
    const headingErr = angleBetween(this._fwd, desiredFwd);
    const turnRate = Math.min(MAX_TURN_RATE, TURN_GAIN * headingErr);
    // Signed bank from turn axis
    const turnAxis = cross3(this._fwd, desiredFwd);
    const axisLen = length3(turnAxis);
    let signedErr = headingErr;
    if (axisLen > 1e-6) {
      signedErr = Math.sign(dot3(turnAxis, this._upBody)) * headingErr;
      if (signedErr === 0) signedErr = headingErr;
    }
    const cruiseBankScale = 1 - insertMix;
    const targetBank = clamp(
      signedErr * 1.1 * cruiseBankScale,
      -MAX_BANK,
      MAX_BANK
    );
    this._bank = approach(this._bank, targetBank, BANK_RATE * dt);

    this._fwd = rotateToward(this._fwd, desiredFwd, turnRate * dt);
    // Apply bank relative to destination plane / world
    const levelUp = orthonormalizeUp(
      this._fwd,
      lerp3(
        WORLD_UP,
        g.arrivalUp,
        lerp(0, g.upBlend, insertMix)
      )
    );
    this._upBody = applyBank(this._fwd, levelUp, this._bank);

    // --- Forces ---
    let accel = { x: 0, y: 0, z: 0 };

    // Climb-out radial boost
    if (climbMix > 0 && g.fromStar) {
      let leave = sub3(this.position, g.fromStar);
      if (length3(leave) > 1e-4) {
        accel = add3(accel, scale3(normalize3(leave), LEAVE_BOOST * climbMix));
      }
    }

    // Forward thrust toward vmax (cruise); brake in insert
    const spd = length3(this._velocity);
    const thrustScale = (1 - insertMix) * (spd < g.vmax ? 1 : 0);
    accel = add3(accel, scale3(this._fwd, THRUST_ACCEL * thrustScale));

    if (insertMix > 0.05) {
      // Drag / reverse thrust as we enter the cone
      if (spd > 0.1) {
        accel = add3(
          accel,
          scale3(normalize3(this._velocity), -INSERT_BRAKE * insertMix)
        );
      }

      // Side jet → circular overlook velocity at current azimuth
      this._syncSlotAzimuthFromPos();
      slot.elevation = ARRIVAL_ELEVATION;
      const desiredOrbitVel = orbitTangentVelocity(slot, this.autoOrbitSpeed);
      const desiredOrbitPos = orbitPosition(slot);
      const velErr = sub3(desiredOrbitVel, this._velocity);
      accel = add3(accel, scale3(velErr, SIDE_JET_ACCEL * insertMix));
      const posErr = sub3(desiredOrbitPos, this.position);
      accel = add3(
        accel,
        scale3(posErr, ORBIT_RADIAL_GAIN * insertMix)
      );
    }

    this._velocity = add3(this._velocity, scale3(accel, dt));

    // Mild aero alignment (atmosphere): bleed velocity toward nose
    const aero = AERO_ALIGN * (1 - insertMix * 0.7) * dt;
    if (aero > 0 && spd > 0.05) {
      const along = scale3(this._fwd, spd);
      this._velocity = lerp3(this._velocity, along, clamp(aero, 0, 1));
    }

    // Soft speed ceiling (no hard zeroing)
    const softMax = lerp(g.vmax, length3(orbitTangentVelocity(slot, this.autoOrbitSpeed)) * 1.4, insertMix);
    const spd2 = length3(this._velocity);
    if (spd2 > softMax * 1.15) {
      this._velocity = scale3(this._velocity, (softMax * 1.15) / spd2);
    }

    this.position = add3(this.position, scale3(this._velocity, dt));
    this._syncYawPitchFromDir(this._fwd);

    // Match → physics orbit
    this._syncSlotAzimuthFromPos();
    const matchPos = Math.max(slot.distance * MATCH_POS_FRAC, 0.4);
    const lookErr = angleBetween(this._fwd, lookStar);
    const orbitVel = orbitTangentVelocity(slot, this.autoOrbitSpeed);
    const velMatch = length3(sub3(this._velocity, orbitVel));
    const near =
      insertMix > 0.7 &&
      distSlot < matchPos &&
      lookErr < MATCH_HEADING &&
      velMatch < MATCH_SPEED_ERR;
    if (near) {
      g.matchHold += dt;
      if (g.matchHold >= MATCH_HOLD_SEC) this._beginPhysicsOrbit();
    } else {
      g.matchHold = Math.max(0, g.matchHold - dt * 0.5);
    }
  }

  _beginPhysicsOrbit() {
    this._guide = null;
    this._flightMode = "orbit";
    this._phase = "orbit";
    this._orbitSpinBlend = 0;
    if (this._slot) {
      this._slot.elevation = ARRIVAL_ELEVATION;
      this._syncSlotAzimuthFromPos();
    }
    this._bank = approach(this._bank, 0, 1);
  }

  /** Side-jet circular overlook; nose at star; up = plane normal. */
  _updatePhysicsOrbit(dt) {
    const slot = this._slot;
    if (!slot?.basis) return;

    this._orbitSpinBlend = Math.min(1, this._orbitSpinBlend + dt * 0.4);
    slot.elevation = ARRIVAL_ELEVATION;

    // Advance nominal azimuth; physics tracks it
    slot.azimuth += this.autoOrbitSpeed * dt * this._orbitSpinBlend;

    const desiredPos = orbitPosition(slot);
    const desiredVel = orbitTangentVelocity(slot, this.autoOrbitSpeed);
    const lookStar = normalize3(sub3(slot.target, this.position));

    let accel = scale3(sub3(desiredVel, this._velocity), ORBIT_SIDE_GAIN);
    accel = add3(accel, scale3(sub3(desiredPos, this.position), ORBIT_RADIAL_GAIN));

    this._velocity = add3(this._velocity, scale3(accel, dt));
    this.position = add3(this.position, scale3(this._velocity, dt));

    this._fwd = rotateToward(this._fwd, lookStar, ATTITUDE_RATE * dt);
    this._bank = approach(this._bank, 0, BANK_RATE * dt);
    const levelUp = orthonormalizeUp(this._fwd, slot.basis.ey);
    this._upBody = applyBank(this._fwd, levelUp, this._bank);
    this._syncYawPitchFromDir(this._fwd);
    this._syncSlotAzimuthFromPos();
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
      // Keep commanded focus distance / elevation for guidance targets
    }
  }

  viewMatrix() {
    if (this._flightMode === "guided" || this._flightMode === "orbit") {
      const look = add3(this.position, this._fwd);
      let up = this._upBody;
      const back = normalize3(sub3(this.position, look));
      if (Math.abs(dot3(up, back)) > 0.98) up = WORLD_UP;
      return lookAt(this.position, look, up);
    }
    if (this._slot && !this._orbitDragging && this._reattachCooldown > 0) {
      // Manual look while waiting to reattach
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
 * @typedef {object} GuideState
 * @property {{x:number,y:number,z:number}|null} fromStar
 * @property {{x:number,y:number,z:number}} dest
 * @property {{x:number,y:number,z:number}} arrivalUp
 * @property {number} hopDist
 * @property {number} vmax
 * @property {number} upBlend
 * @property {number} matchHold
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

/**
 * Tangential velocity on the overlook cone: ω × r_hat * distance.
 * Direction: ∂orbitPosition/∂azimuth * ω.
 */
function orbitTangentVelocity(slot, omega) {
  const { distance, azimuth, elevation, basis } = slot;
  const cp = Math.cos(elevation);
  // d(ca,sa)/d(az) = (-sa, ca)
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

/** Roll `levelUp` around `forward` by `bank` radians. */
function applyBank(forward, levelUp, bank) {
  if (Math.abs(bank) < 1e-5) return levelUp;
  const f = normalize3(forward);
  const right = normalize3(cross3(f, levelUp));
  const up = normalize3(cross3(right, f));
  const c = Math.cos(bank);
  const s = Math.sin(bank);
  return normalize3({
    x: up.x * c + right.x * s,
    y: up.y * c + right.y * s,
    z: up.z * c + right.z * s,
  });
}

function angleBetween(a, b) {
  return Math.acos(clamp(dot3(normalize3(a), normalize3(b)), -1, 1));
}

function rotateToward(from, to, maxRadians) {
  const a = normalize3(from);
  const b = normalize3(to);
  const ang = angleBetween(a, b);
  if (ang < 1e-6 || maxRadians <= 0) return a;
  if (ang <= maxRadians) return b;
  return slerpDir(a, b, maxRadians / ang);
}

function slerpDir(a, b, t) {
  const cosA = clamp(dot3(a, b), -1, 1);
  if (cosA < -0.999) {
    let axis = cross3(a, { x: 0, y: 0, z: 1 });
    if (length3(axis) < 1e-5) axis = cross3(a, { x: 1, y: 0, z: 0 });
    axis = normalize3(axis);
    const ang = Math.PI * t;
    const s = Math.sin(ang);
    const c = Math.cos(ang);
    return normalize3({
      x: a.x * c + axis.x * s,
      y: a.y * c + axis.y * s,
      z: a.z * c + axis.z * s,
    });
  }
  if (cosA > 0.9995) {
    return normalize3(lerp3(a, b, t));
  }
  const ang = Math.acos(cosA);
  const s0 = Math.sin((1 - t) * ang);
  const s1 = Math.sin(t * ang);
  const inv = 1 / Math.sin(ang);
  return normalize3({
    x: (a.x * s0 + b.x * s1) * inv,
    y: (a.y * s0 + b.y * s1) * inv,
    z: (a.z * s0 + b.z * s1) * inv,
  });
}

function lerp3(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function approach(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
