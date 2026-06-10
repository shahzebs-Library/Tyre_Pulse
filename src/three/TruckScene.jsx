/**
 * TruckScene — the composed 3D login experience.
 * ──────────────────────────────────────────────
 * UI → State (Zustand) → MCU → Environment → 3D → Camera, assembled here.
 *
 * Responsibilities:
 *  - Resolve the time-of-day environment profile once on mount.
 *  - Own the single shared `motion` ref the MCU integrates and every subsystem
 *    (truck, camera, lights, road) reads from — one allocation, no per-frame GC.
 *  - Run an adaptive-quality governor: sample FPS, downgrade shadows/DPR or
 *    disable the canvas entirely on weak devices (< 30 FPS) per the perf spec.
 *  - Degrade gracefully: no WebGL / quality 'off' → render nothing (the page's
 *    CSS background remains), never a broken canvas.
 */
import { Suspense, useMemo, useRef, lazy } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useLoginScene } from '../state/loginScene'
import { resolveEnvironment } from './environmentEngine'
import { createTruckMotion } from '../mcu/truckController'
import Truck from './Truck'
import CameraRig from './CameraRig'
import SceneEnvironment from './SceneEnvironment'

/** Detect WebGL once (module scope) to decide whether to mount the canvas. */
function hasWebGL() {
  if (typeof window === 'undefined') return false
  try {
    const c = document.createElement('canvas')
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext('webgl') || c.getContext('experimental-webgl'))
    )
  } catch {
    return false
  }
}

/** FPS governor — runs inside the canvas, mutates store quality. */
function QualityGovernor() {
  const acc = useRef({ frames: 0, time: 0, low: 0 })
  const setQuality = useLoginScene((s) => s.setQuality)
  const reportFps = useLoginScene((s) => s.reportFps)
  const quality = useLoginScene((s) => s.quality)

  useFrame((_, dt) => {
    const a = acc.current
    a.frames += 1
    a.time += dt
    if (a.time >= 1) {
      const fps = a.frames / a.time
      reportFps(Math.round(fps))
      if (fps < 30) {
        a.low += 1
        if (a.low >= 2 && quality === 'high') setQuality('low')
        if (a.low >= 4 && quality === 'low') setQuality('off')
      } else {
        a.low = 0
      }
      a.frames = 0
      a.time = 0
    }
  })
  return null
}

function SceneContents({ env }) {
  const phase = useLoginScene((s) => s.phase)
  const reducedMotion = useLoginScene((s) => s.reducedMotion)
  const motionRef = useRef(createTruckMotion())
  const glowRef = useRef(null)

  return (
    <>
      <SceneEnvironment env={env} motionRef={motionRef} />
      <Truck
        phase={phase}
        reducedMotion={reducedMotion}
        motionRef={motionRef}
        glowRef={glowRef}
      />
      <CameraRig motionRef={motionRef} />
      <QualityGovernor />
    </>
  )
}

export default function TruckScene({ hour }) {
  const quality = useLoginScene((s) => s.quality)
  const webgl = useMemo(hasWebGL, [])

  // Environment resolved from the provided hour (caller passes Date — keeps this
  // component pure/deterministic for testing).
  const env = useMemo(() => resolveEnvironment(hour), [hour])

  if (!webgl || quality === 'off') return null

  const dpr = quality === 'low' ? [1, 1] : [1, 1.8]
  const shadows = quality !== 'low'

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
      }}
    >
      <Canvas
        shadows={shadows}
        dpr={dpr}
        gl={{ antialias: quality === 'high', powerPreference: 'high-performance', alpha: true }}
        camera={{ position: [-6.2, 2.1, 7.6], fov: 42, near: 0.1, far: 100 }}
        frameloop="always"
      >
        <Suspense fallback={null}>
          <SceneContents env={env} />
        </Suspense>
      </Canvas>
    </div>
  )
}
