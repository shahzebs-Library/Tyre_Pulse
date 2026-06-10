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
  const key = useRef()

  // Light fog for depth only. Background stays transparent so the canvas
  // composites over the page's designed gradient/grid instead of flat-filling
  // the viewport with a solid colour.
  useMemo(() => {
    scene.fog = new THREE.Fog(env.fog.color, 16, 46)
    scene.background = null
  }, [scene, env])

  useFrame(() => {
    const b = motionRef.current.brightness
    // Floor the time-of-day lights so the hero truck always reads, even at night.
    if (sun.current) sun.current.intensity = (0.5 + env.sun.intensity) * b
    if (ambient.current) ambient.current.intensity = (0.45 + env.ambient.intensity) * b
    if (fill.current) fill.current.intensity = (0.9 + 0.8 * env.glow) * b
    if (key.current) key.current.intensity = 1.5 * b
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
      {/* Constant hero key light from camera side — keeps the truck legible
          regardless of time of day; mood/colour still shift with the period. */}
      <spotLight
        ref={key}
        color="#eafff3"
        intensity={1.5}
        position={[-5, 5, 8]}
        angle={0.7}
        penumbra={0.8}
        distance={30}
        castShadow
      />
      {/* Brand green rim/fill light from behind — intensifies at night via glow. */}
      <pointLight
        ref={fill}
        color={BRAND.greenLight}
        intensity={1.2}
        position={[3, 1.5, -3]}
        distance={20}
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
