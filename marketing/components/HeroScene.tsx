"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float, OrbitControls } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Hero3D already declines to mount this scene when the visitor asks for reduced
 * motion, so in practice these guards never fire. They stay because a person can
 * change the system setting while the page is open, and because a component that
 * animates should not depend on its parent remembering to stop it.
 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return reduced;
}

function Wheel({ still }: { still: boolean }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (still) return;
    if (group.current) group.current.rotation.z += delta * 0.08;
  });

  const spokes = Array.from({ length: 10 });
  return (
    <group ref={group} rotation={[0.15, -0.45, 0.1]}>
      <mesh castShadow receiveShadow>
        <torusGeometry args={[2.05, 0.72, 32, 96]} />
        <meshStandardMaterial color="#07111e" roughness={0.6} metalness={0.12} />
      </mesh>
      <mesh>
        <torusGeometry args={[1.35, 0.16, 18, 64]} />
        <meshStandardMaterial color="#75a8e8" roughness={0.22} metalness={0.9} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[0.52, 0.52, 0.42, 48]} />
        <meshStandardMaterial color="#b8c7d8" metalness={0.95} roughness={0.2} />
      </mesh>
      {spokes.map((_, i) => (
        <mesh key={i} rotation={[0, 0, (Math.PI * 2 * i) / spokes.length]} position={[0, 0, 0]}>
          <boxGeometry args={[1.48, 0.14, 0.22]} />
          <meshStandardMaterial color="#367cd8" metalness={0.75} roughness={0.26} />
        </mesh>
      ))}
      {Array.from({ length: 28 }).map((_, i) => {
        const a = (Math.PI * 2 * i) / 28;
        return (
          <mesh key={`t-${i}`} position={[Math.cos(a) * 2.52, Math.sin(a) * 2.52, 0]} rotation={[0, 0, a]}>
            <boxGeometry args={[0.42, 0.13, 0.76]} />
            <meshStandardMaterial color="#101b28" roughness={0.92} />
          </mesh>
        );
      })}
    </group>
  );
}

export default function HeroScene() {
  const reduced = usePrefersReducedMotion();

  return (
    /*
     * Decoration. The wheel says nothing the hero copy does not already say, so
     * it is hidden from assistive technology rather than given a label that a
     * screen reader user would have to listen to on every visit. Nothing inside
     * is focusable, so hiding the subtree traps no keyboard focus.
     */
    <div className="canvas-wrap" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 7.5], fov: 42 }}
        dpr={[1, 1.5]}
        shadows
        // A still frame costs one render instead of sixty a second.
        frameloop={reduced ? "demand" : "always"}
      >
        <ambientLight intensity={1.2} />
        <directionalLight position={[4, 5, 6]} intensity={5} castShadow color="#d6eaff" />
        <pointLight position={[-4, -2, 4]} intensity={18} color="#0ba7b4" />
        <Float
          speed={reduced ? 0 : 1.2}
          rotationIntensity={reduced ? 0 : 0.18}
          floatIntensity={reduced ? 0 : 0.35}
        >
          <Wheel still={reduced} />
        </Float>
        <Environment preset="city" />
        <OrbitControls enablePan={false} enableZoom={false} autoRotate={!reduced} autoRotateSpeed={0.6} />
      </Canvas>
    </div>
  );
}
