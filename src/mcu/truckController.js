/**
 * Truck MCU (Motion Control Unit)
 * ───────────────────────────────
 * Pure, frame-rate-independent controller. Given the current login phase and a
 * mutable motion-state object, it integrates target values toward the phase's
 * "set points" using delta-time critically-damped smoothing.
 *
 * This is deliberately framework-agnostic (no React, no three.js imports) so it
 * is unit-testable and reusable. The R3F layer owns the meshes; the MCU owns the
 * numbers that drive them.
 *
 * All motion is state-driven — there is no random animation anywhere.
 */
import { PHASES } from '../state/loginScene'

/** Per-phase target set points the MCU servos toward. */
const SET_POINTS = {
  [PHASES.IDLE]: {
    speed: 0, // forward velocity (world units / s)
    floatAmp: 0.06, // vertical bob amplitude
    floatFreq: 0.9,
    yawAmp: 0.05, // gentle heading sway
    vibration: 0,
    shake: 0,
    drumSpin: 0.5, // mixer drum angular velocity
    brightness: 1,
    cameraDolly: 0, // camera push toward truck along its travel
    cameraLift: 0,
  },
  [PHASES.TYPING]: {
    speed: 0,
    floatAmp: 0.045,
    floatFreq: 1.1,
    yawAmp: 0.03,
    vibration: 0.012, // micro vibration
    shake: 0,
    drumSpin: 0.7,
    brightness: 1.05,
    cameraDolly: 0,
    cameraLift: 0,
  },
  [PHASES.LOADING]: {
    speed: 2.2, // forward motion begins
    floatAmp: 0.03,
    floatFreq: 1.4,
    yawAmp: 0.02,
    vibration: 0.02,
    shake: 0,
    drumSpin: 1.6,
    brightness: 1.12,
    cameraDolly: 0.6, // slight camera follow
    cameraLift: 0.1,
  },
  [PHASES.SUCCESS]: {
    speed: 7.5, // accelerate forward
    floatAmp: 0.02,
    floatFreq: 1.6,
    yawAmp: 0.012,
    vibration: 0.015,
    shake: 0,
    drumSpin: 2.6,
    brightness: 1.55, // brightness up
    cameraDolly: 1.4, // camera chase
    cameraLift: 0.25,
  },
  [PHASES.ERROR]: {
    speed: 0, // stop
    floatAmp: 0.02,
    floatFreq: 1,
    yawAmp: 0,
    vibration: 0,
    shake: 0.16, // shake
    drumSpin: 0.2,
    brightness: 0.85,
    cameraDolly: 0,
    cameraLift: 0,
  },
  [PHASES.TRANSITION]: {
    speed: 16, // accelerate hard
    floatAmp: 0.01,
    floatFreq: 1.6,
    yawAmp: 0,
    vibration: 0.01,
    shake: 0,
    drumSpin: 3.4,
    brightness: 2.1,
    cameraDolly: 3.2, // camera zoom-through
    cameraLift: 0.15,
  },
}

/** How fast each channel converges (per-second smoothing rates). */
const RATES = {
  speed: 2.4,
  floatAmp: 3,
  floatFreq: 3,
  yawAmp: 3,
  vibration: 8,
  shake: 6,
  drumSpin: 2,
  brightness: 2.5,
  cameraDolly: 2.2,
  cameraLift: 2.2,
}

export function createTruckMotion() {
  return {
    // servo'd channels
    speed: 0,
    floatAmp: 0.06,
    floatFreq: 0.9,
    yawAmp: 0.05,
    vibration: 0,
    shake: 0,
    drumSpin: 0.5,
    brightness: 1,
    cameraDolly: 0,
    cameraLift: 0,
    // integrators
    distance: 0, // total forward distance traveled (drives wheel roll)
    wheelAngle: 0,
    drumAngle: 0,
    clock: 0, // local time accumulator (delta-summed, never Date.now)
  }
}

/** Critically-damped exponential approach: frame-rate independent. */
function approach(current, target, rate, dt) {
  const t = 1 - Math.exp(-rate * dt)
  return current + (target - current) * t
}

/**
 * Advance the motion state by `dt` seconds for the given `phase`.
 * `reducedMotion` flattens all oscillatory channels for accessibility.
 * Returns the same mutated object for convenience.
 */
export function stepTruckMotion(motion, phase, dt, reducedMotion = false) {
  const sp = SET_POINTS[phase] || SET_POINTS[PHASES.IDLE]
  // clamp dt so a tab-switch stall can't fling the truck across the scene
  const d = Math.min(dt, 0.05)
  motion.clock += d

  for (const key of Object.keys(RATES)) {
    let target = sp[key]
    if (
      reducedMotion &&
      (key === 'floatAmp' || key === 'vibration' || key === 'shake' || key === 'yawAmp')
    ) {
      target = 0
    }
    motion[key] = approach(motion[key], target, RATES[key], d)
  }

  // Integrate travel + rotations.
  motion.distance += motion.speed * d
  motion.wheelAngle += motion.speed * d * WHEEL_ANGULAR_PER_UNIT
  motion.drumAngle += motion.drumSpin * d

  return motion
}

// Wheel radius ~0.55 → angular = distance / radius.
const WHEEL_ANGULAR_PER_UNIT = 1 / 0.55

export { SET_POINTS }
