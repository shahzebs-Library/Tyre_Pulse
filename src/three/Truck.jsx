/**
 * Trimixer Truck — procedural, low-poly, brand-skinned.
 * ────────────────────────────────────────────────────
 * Built from primitives (no external GLB to host/load) so it ships < a few KB,
 * runs on low-end mobile, and stays fully brand-controlled. Wheels are separable
 * groups so they roll from the MCU's integrated wheel angle; the mixer drum spins
 * independently. All transforms are driven by the `motion` ref — never random.
 *
 * Drop-in GLB path: replace <ProceduralBody/> with a useGLTF model and keep the
 * same wheel/drum group names; the MCU output is model-agnostic.
 */
import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { stepTruckMotion } from '../mcu/truckController'
import { BRAND } from './environmentEngine'

const GREEN = new THREE.Color(BRAND.green)
const GREEN_LIGHT = new THREE.Color(BRAND.greenLight)
const WHITE = new THREE.Color('#f5f7f6')
const DARK = new THREE.Color('#0a140d')

/** Material factory — memoized, reused across instances. */
function useTruckMaterials(glowRef) {
  return useMemo(() => {
    const body = new THREE.MeshStandardMaterial({
      color: WHITE,
      metalness: 0.35,
      roughness: 0.45,
    })
    const accent = new THREE.MeshStandardMaterial({
      color: GREEN,
      metalness: 0.5,
      roughness: 0.3,
      emissive: GREEN,
      emissiveIntensity: 0.35,
    })
    const glass = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#0c2a1e'),
      metalness: 0.9,
      roughness: 0.1,
      emissive: GREEN_LIGHT,
      emissiveIntensity: 0.12,
    })
    const chassis = new THREE.MeshStandardMaterial({
      color: DARK,
      metalness: 0.6,
      roughness: 0.5,
    })
    const tire = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#101712'),
      metalness: 0.2,
      roughness: 0.85,
    })
    const rim = new THREE.MeshStandardMaterial({
      color: GREEN_LIGHT,
      metalness: 0.8,
      roughness: 0.25,
      emissive: GREEN,
      emissiveIntensity: 0.5,
    })
    const head = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#fffbe6'),
      emissive: new THREE.Color('#fff4c2'),
      emissiveIntensity: 1.4,
    })
    glowRef.current = { accent, glass, rim, head }
    return { body, accent, glass, chassis, tire, rim, head }
  }, [glowRef])
}

/** One axle = two wheels mirrored across the chassis. */
function Axle({ x, mat, tire }) {
  return (
    <group position={[x, -0.55, 0]}>
      {[0.62, -0.62].map((z) => (
        <group key={z} position={[0, 0, z]} rotation={[0, 0, 0]} name="wheel">
          <mesh rotation={[Math.PI / 2, 0, 0]} material={tire} castShadow>
            <cylinderGeometry args={[0.55, 0.55, 0.34, 22]} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.18, 0]} material={mat}>
            <cylinderGeometry args={[0.28, 0.28, 0.04, 14]} />
          </mesh>
          {/* spokes */}
          {Array.from({ length: 5 }).map((_, i) => {
            const a = (i / 5) * Math.PI * 2
            return (
              <mesh
                key={i}
                position={[Math.cos(a) * 0.16, 0.2, Math.sin(a) * 0.16]}
                rotation={[Math.PI / 2, 0, 0]}
                material={mat}
              >
                <boxGeometry args={[0.05, 0.04, 0.22]} />
              </mesh>
            )
          })}
        </group>
      ))}
    </group>
  )
}

function ProceduralBody({ mats }) {
  return (
    <group>
      {/* Chassis rail */}
      <mesh position={[0.2, -0.3, 0]} material={mats.chassis} castShadow>
        <boxGeometry args={[5.4, 0.18, 1.1]} />
      </mesh>

      {/* Cab */}
      <group position={[-2.0, 0.25, 0]}>
        <mesh material={mats.body} castShadow>
          <boxGeometry args={[1.25, 1.25, 1.5]} />
        </mesh>
        {/* windscreen */}
        <mesh position={[-0.55, 0.35, 0]} rotation={[0, 0, 0.32]} material={mats.glass}>
          <boxGeometry args={[0.08, 0.7, 1.32]} />
        </mesh>
        {/* green visor stripe */}
        <mesh position={[0, 0.66, 0]} material={mats.accent}>
          <boxGeometry args={[1.28, 0.12, 1.54]} />
        </mesh>
        {/* headlights */}
        {[0.55, -0.55].map((z) => (
          <mesh key={z} position={[-0.66, -0.35, z]} material={mats.head}>
            <boxGeometry args={[0.06, 0.18, 0.24]} />
          </mesh>
        ))}
      </group>

      {/* Mixer drum — tapered, angled, spins via name="drum" */}
      <group position={[0.95, 0.5, 0]} rotation={[0, 0, 0.13]} name="drum">
        <mesh material={mats.body} castShadow>
          <cylinderGeometry args={[0.78, 1.0, 2.9, 24]} />
        </mesh>
        {/* spiral brand bands */}
        {Array.from({ length: 5 }).map((_, i) => (
          <mesh key={i} position={[0, -1.1 + i * 0.55, 0]} material={mats.accent}>
            <torusGeometry args={[0.9 - i * 0.045, 0.045, 8, 24]} />
          </mesh>
        ))}
        {/* feed chute */}
        <mesh position={[0, 1.6, 0]} material={mats.chassis}>
          <cylinderGeometry args={[0.4, 0.62, 0.5, 16]} />
        </mesh>
      </group>

      {/* Rear hopper */}
      <mesh position={[2.55, 0.1, 0]} rotation={[0, 0, -0.3]} material={mats.accent}>
        <cylinderGeometry args={[0.3, 0.5, 0.7, 16]} />
      </mesh>

      {/* Axles (separable wheels) */}
      <Axle x={-2.0} mat={mats.rim} tire={mats.tire} />
      <Axle x={1.35} mat={mats.rim} tire={mats.tire} />
      <Axle x={2.25} mat={mats.rim} tire={mats.tire} />
    </group>
  )
}

export default function Truck({ phase, reducedMotion, motionRef, onMotion, glowRef }) {
  const root = useRef()
  const wheels = useRef([])
  const drum = useRef()
  const mats = useTruckMaterials(glowRef)

  // Collect wheel + drum groups once mounted.
  const collect = (g) => {
    if (!g) return
    root.current = g
    wheels.current = []
    g.traverse((o) => {
      if (o.name === 'wheel') wheels.current.push(o)
      if (o.name === 'drum') drum.current = o
    })
  }

  useFrame((_, dt) => {
    const m = motionRef.current
    stepTruckMotion(m, phase, dt, reducedMotion)

    if (root.current) {
      // Float + heading sway + vibration + error shake.
      const t = m.clock
      const vib = m.vibration
      const shake = m.shake
      root.current.position.y =
        Math.sin(t * m.floatFreq) * m.floatAmp +
        (vib ? Math.sin(t * 60) * vib : 0) +
        (shake ? Math.sin(t * 48) * shake : 0)
      root.current.position.x = shake ? Math.sin(t * 53) * shake * 0.6 : 0
      root.current.rotation.z = shake ? Math.sin(t * 41) * shake * 0.05 : 0
      root.current.rotation.y =
        -0.35 + Math.sin(t * 0.6) * m.yawAmp + (vib ? Math.sin(t * 55) * vib * 0.3 : 0)
    }

    for (const w of wheels.current) w.rotation.z = -m.wheelAngle
    if (drum.current) drum.current.rotation.y = m.drumAngle

    // Pulse brand emissives with brightness channel.
    const g = glowRef.current
    if (g) {
      g.accent.emissiveIntensity = 0.3 * m.brightness
      g.rim.emissiveIntensity = 0.45 * m.brightness
      g.glass.emissiveIntensity = 0.12 * m.brightness
    }

    onMotion?.(m)
  })

  return (
    <group ref={collect} position={[0, 0, 0]}>
      <ProceduralBody mats={mats} />
    </group>
  )
}
