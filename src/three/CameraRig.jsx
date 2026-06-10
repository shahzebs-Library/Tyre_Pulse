/**
 * Camera System
 * ─────────────
 * State-driven cinematography. Reads the MCU motion (dolly + lift channels) and
 * eases the camera between a hero framing (idle) and a chase/zoom-through
 * (success / transition). Frame-rate independent; no random drift.
 */
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

const BASE_POS = new THREE.Vector3(-6.2, 2.1, 7.6)
const BASE_TARGET = new THREE.Vector3(0.2, 0.1, 0)

export default function CameraRig({ motionRef }) {
  const { camera } = useThree()
  const target = useRef(BASE_TARGET.clone())
  const pos = useRef(BASE_POS.clone())

  useFrame((_, dt) => {
    const m = motionRef.current
    const d = Math.min(dt, 0.05)
    const k = 1 - Math.exp(-2.4 * d)

    // Dolly pushes the camera in along its view and slightly down the truck's
    // travel; lift raises it. Transition drives a hard zoom-through.
    const dolly = m.cameraDolly
    const lift = m.cameraLift

    const desired = new THREE.Vector3(
      BASE_POS.x + dolly * 1.6,
      BASE_POS.y + lift * 2.2,
      BASE_POS.z - dolly * 2.4
    )
    const desiredTarget = new THREE.Vector3(
      BASE_TARGET.x + dolly * 0.6,
      BASE_TARGET.y + lift,
      BASE_TARGET.z
    )

    pos.current.lerp(desired, k)
    target.current.lerp(desiredTarget, k)

    camera.position.copy(pos.current)
    camera.lookAt(target.current)
    // FOV widens on zoom-through for a speed-tunnel feel.
    const fov = 42 + Math.min(dolly, 3.2) * 6
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  })

  return null
}
