/**
 * Scene Environment — lights, ground, fog, street lamps.
 * Driven by the Environment Engine profile (time-of-day) and the MCU brightness.
 */
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { BRAND } from './environmentEngine'

export default function SceneEnvironment({ env, motionRef }) {
  const { scene } = useThree()
  const sun = useRef()
  const ambient = useRef()
  const fill = useRef()

  // Fog + background follow the resolved period.
  useMemo(() => {
    scene.fog = new THREE.Fog(env.fog.color, env.fog.near, env.fog.far)
    scene.background = new THREE.Color(env.sky)
  }, [scene, env])

  useFrame(() => {
    const b = motionRef.current.brightness
    if (sun.current) sun.current.intensity = env.sun.intensity * b
    if (ambient.current) ambient.current.intensity = env.ambient.intensity * b
    if (fill.current) fill.current.intensity = 0.6 * env.glow * b
  })

  // Moving ground stripes to imply travel without translating the truck.
  const stripes = useMemo(
    () => Array.from({ length: 14 }).map((_, i) => i),
    []
  )
  const road = useRef()
  useFrame((_, dt) => {
    if (!road.current) return
    const m = motionRef.current
    road.current.position.x -= m.speed * Math.min(dt, 0.05)
    if (road.current.position.x < -4) road.current.position.x += 4
  })

  return (
    <>
      <ambientLight ref={ambient} color={env.ambient.color} intensity={env.ambient.intensity} />
      <directionalLight
        ref={sun}
        color={env.sun.color}
        intensity={env.sun.intensity}
        position={env.sun.position}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      {/* Brand green rim/fill light from behind — intensifies at night via glow. */}
      <pointLight
        ref={fill}
        color={BRAND.greenLight}
        intensity={0.6 * env.glow}
        position={[3, 1.5, -3]}
        distance={18}
      />

      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.12, 0]} receiveShadow>
        <planeGeometry args={[60, 24]} />
        <meshStandardMaterial color="#06120c" metalness={0.4} roughness={0.7} />
      </mesh>

      {/* Lane stripes that scroll to imply forward travel. */}
      <group ref={road} position={[0, -1.11, 0]}>
        {stripes.map((i) => (
          <mesh
            key={i}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[-12 + i * 2, 0, 0.9]}
          >
            <planeGeometry args={[1.1, 0.16]} />
            <meshStandardMaterial
              color={BRAND.greenLight}
              emissive={BRAND.green}
              emissiveIntensity={0.5 + env.glow}
              transparent
              opacity={0.55}
            />
          </mesh>
        ))}
      </group>

      {/* Street lamps — auto-on at night. */}
      {env.streetLights &&
        [-7, 7].map((x) => (
          <group key={x} position={[x, -1.1, -3.2]}>
            <mesh position={[0, 1.4, 0]}>
              <cylinderGeometry args={[0.05, 0.07, 2.8, 8]} />
              <meshStandardMaterial color="#0a1a12" />
            </mesh>
            <pointLight
              color="#bdf5d2"
              intensity={1.4}
              distance={9}
              position={[0, 2.7, 0.4]}
            />
            <mesh position={[0.35, 2.7, 0.4]}>
              <sphereGeometry args={[0.16, 10, 10]} />
              <meshStandardMaterial
                color="#eafff2"
                emissive="#cdebd8"
                emissiveIntensity={2}
              />
            </mesh>
          </group>
        ))}
    </>
  )
}
