"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * The hero wheel.
 *
 * Two deliberate constraints shape this scene, and both are departures from
 * what was here before:
 *
 * 1. ONE motion with a meaning. The previous version ran four animations at
 *    once (a manual rotation.z, a <Float> wobble, OrbitControls autoRotate and
 *    drag), which fought each other and read as restlessness rather than as a
 *    turning wheel. A wheel rotates; that is the motion. The pulse ring is the
 *    only other moving thing, and it earns its place by saying what the product
 *    does: a reading being taken, and the "Pulse" in the name.
 *
 * 2. Nothing is fetched. The previous version used drei's Environment with
 *    preset="city", which downloads an HDRI from a third-party CDN on the hero
 *    of the marketing site. Lighting is authored here instead, so the scene
 *    cannot be delayed, blocked or broken by someone else's host.
 *
 * Colours come from the product rather than from this file: #16a34a is the
 * brand green used by the web app and the Android launcher icon, and the
 * near-black carries the same green undertone as the app's own surfaces.
 */

const BRAND = "#16a34a";
const BRAND_BRIGHT = "#22c55e";
const BRAND_ELECTRIC = "#4ade80";
const TREAD_DARK = "#09150e";
const TREAD_BLOCK = "#0d1f16";
const RIM_METAL = "#cfe6d8";

/** Tread blocks around the circumference. */
const BLOCKS = 34;
/** Rim spokes. Five reads as a wheel; ten read as a bicycle. */
const SPOKES = 5;

const HUB_RADIUS = 0.46;
const RIM_RADIUS = 1.44;
const OUTER_RADIUS = 2.6;
/** Half the widest thing drawn, lugs included. Used to fit the wheel on screen. */
const WHEEL_EXTENT = 2.72;
const PULSE_SECONDS = 2.8;

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

/**
 * The tread blocks, ticks and spokes are each one geometry and one material
 * shared across every instance. Declaring a geometry inside a map would build a
 * separate one per block and upload all of them to the GPU, which is fifty
 * needless buffers for a decoration.
 */
function useSharedParts() {
  const parts = useMemo(() => {
    const block = new THREE.BoxGeometry(0.18, 0.46, 0.9);
    const tick = new THREE.BoxGeometry(0.07, 0.055, 0.2);
    /*
     * A spoke runs from the hub to the rim, so it is exactly that long and is
     * pushed out to sit between them. The previous geometry was 1.24 long and
     * centred on the origin, which meant each box crossed the whole wheel and
     * stuck out the far side: five of them drew ten arms and read as a gear,
     * not as a road wheel.
     */
    const spoke = new THREE.BoxGeometry(RIM_RADIUS - HUB_RADIUS, 0.26, 0.34);

    const blockMaterial = new THREE.MeshStandardMaterial({
      color: TREAD_BLOCK,
      roughness: 0.95,
      metalness: 0.02,
    });
    const tickMaterial = new THREE.MeshStandardMaterial({
      color: BRAND_ELECTRIC,
      emissive: new THREE.Color(BRAND_BRIGHT),
      emissiveIntensity: 0.9,
      roughness: 0.4,
    });
    const spokeMaterial = new THREE.MeshStandardMaterial({
      color: RIM_METAL,
      metalness: 0.92,
      roughness: 0.26,
    });

    return { block, tick, spoke, blockMaterial, tickMaterial, spokeMaterial };
  }, []);

  // Geometries and materials hold GPU memory that React will not reclaim on
  // its own, and this component unmounts whenever the visitor turns reduced
  // motion on or crosses the mobile breakpoint.
  useEffect(() => {
    return () => {
      parts.block.dispose();
      parts.tick.dispose();
      parts.spoke.dispose();
      parts.blockMaterial.dispose();
      parts.tickMaterial.dispose();
      parts.spokeMaterial.dispose();
    };
  }, [parts]);

  return parts;
}

/**
 * A ring that grows out of the hub and fades, once every PULSE_SECONDS.
 *
 * It reads as a reading being taken: it starts at the hub, crosses the tread
 * and stops. Opacity is driven from the same normalised progress as the scale,
 * so the ring can never be left visible at a size it was not drawn at.
 */
function PulseRing({ still }: { still: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    if (!mesh.current || !material.current) return;

    if (still) {
      // One legible frame, rather than a ring frozen mid-fade at random.
      mesh.current.scale.setScalar(1);
      material.current.opacity = 0.22;
      return;
    }

    const progress = (clock.getElapsedTime() % PULSE_SECONDS) / PULSE_SECONDS;
    const eased = 1 - Math.pow(1 - progress, 2.2);

    mesh.current.scale.setScalar(0.34 + eased * 1.12);
    // In quickly, then out across the rest of the sweep.
    material.current.opacity = 0.5 * Math.min(progress / 0.12, 1) * (1 - eased);
  });

  return (
    <mesh ref={mesh} position={[0, 0, 0.5]}>
      <ringGeometry args={[1.94, 2.06, 96]} />
      <meshBasicMaterial
        ref={material}
        color={BRAND_ELECTRIC}
        transparent
        opacity={0}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function Wheel({ still }: { still: boolean }) {
  const group = useRef<THREE.Group>(null);
  const { block, tick, spoke, blockMaterial, tickMaterial, spokeMaterial } = useSharedParts();

  useFrame((_, delta) => {
    if (still || !group.current) return;
    // Slow enough to read as a wheel under load, not as a fan.
    group.current.rotation.z += delta * 0.16;
  });

  const blocks = useMemo(
    () =>
      Array.from({ length: BLOCKS }, (_, i) => {
        const angle = (Math.PI * 2 * i) / BLOCKS;
        return {
          key: i,
          x: Math.cos(angle) * OUTER_RADIUS,
          y: Math.sin(angle) * OUTER_RADIUS,
          angle,
          // Alternating lateral offset gives the tread a pattern, not a fence.
          offset: i % 2 === 0 ? 0.19 : -0.19,
        };
      }),
    [],
  );

  const ticks = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const angle = (Math.PI * 2 * i) / 12;
        return {
          key: i,
          x: Math.cos(angle) * 1.62,
          y: Math.sin(angle) * 1.62,
          angle,
        };
      }),
    [],
  );

  return (
    <group ref={group} rotation={[0.2, -0.42, 0.06]}>
      {/* Carcass. The bulk of the tyre. */}
      <mesh>
        <torusGeometry args={[1.98, 0.66, 28, 112]} />
        <meshStandardMaterial color={TREAD_DARK} roughness={0.88} metalness={0.06} />
      </mesh>

      {/* Circumferential groove, sitting slightly proud as a darker band so the
          tread reads as patterned rather than as a smooth doughnut. */}
      <mesh>
        <torusGeometry args={[2.62, 0.075, 14, 96]} />
        <meshStandardMaterial color="#060f0a" roughness={1} />
      </mesh>

      {blocks.map((b) => (
        <mesh
          key={b.key}
          geometry={block}
          material={blockMaterial}
          position={[b.x, b.y, b.offset]}
          rotation={[0, 0, b.angle]}
        />
      ))}

      {/* Sidewall shoulder, catching the key light. */}
      <mesh position={[0, 0, 0.36]}>
        <torusGeometry args={[1.72, 0.2, 16, 88]} />
        <meshStandardMaterial color="#132a1d" roughness={0.62} metalness={0.15} />
      </mesh>

      {/* Rim lip: the one genuinely bright ring, in brand green. */}
      <mesh position={[0, 0, 0.42]}>
        <torusGeometry args={[1.46, 0.11, 18, 88]} />
        <meshStandardMaterial
          color={BRAND_BRIGHT}
          emissive={new THREE.Color(BRAND)}
          emissiveIntensity={0.28}
          metalness={0.7}
          roughness={0.24}
        />
      </mesh>

      {/* Rim face. */}
      <mesh position={[0, 0, 0.3]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1.44, 1.44, 0.2, 64]} />
        <meshStandardMaterial color="#0d2117" metalness={0.5} roughness={0.42} />
      </mesh>

      {Array.from({ length: SPOKES }).map((_, i) => {
        const angle = (Math.PI * 2 * i) / SPOKES;
        // Seated at the midpoint of the gap it spans, so it reaches the hub at
        // one end and the rim at the other and no further.
        const r = HUB_RADIUS + (RIM_RADIUS - HUB_RADIUS) / 2;
        return (
          <mesh
            key={`spoke-${i}`}
            geometry={spoke}
            material={spokeMaterial}
            position={[Math.cos(angle) * r, Math.sin(angle) * r, 0.38]}
            rotation={[0, 0, angle]}
          />
        );
      })}

      {/* Hub and centre cap. */}
      <mesh position={[0, 0, 0.46]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.46, 0.46, 0.36, 48]} />
        <meshStandardMaterial color={RIM_METAL} metalness={0.95} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0, 0.64]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.24, 0.24, 0.12, 40]} />
        <meshStandardMaterial
          color={BRAND}
          emissive={new THREE.Color(BRAND)}
          emissiveIntensity={0.7}
          metalness={0.4}
          roughness={0.3}
        />
      </mesh>

      {/* Measurement ticks on the rim face. Twelve marks, evenly spaced: the
          visual language of a gauge, which is what the product is. */}
      {ticks.map((t) => (
        <mesh
          key={`tick-${t.key}`}
          geometry={tick}
          material={tickMaterial}
          position={[t.x, t.y, 0.44]}
          rotation={[0, 0, t.angle]}
        />
      ))}
    </group>
  );
}

/**
 * Keeps the whole wheel on screen at every size.
 *
 * A fixed camera distance cannot do this, because the hero stage is portrait on
 * a desktop (roughly 546 by 610) and the field of view is vertical: the wheel
 * fitted top to bottom and was sliced off at the right. Scaling to whichever
 * axis is tighter means the lugs stay inside the frame whatever shape the
 * column takes, with no per-breakpoint numbers to keep in step with the CSS.
 */
function FitToView({ children }: { children: React.ReactNode }) {
  const viewport = useThree((state) => state.viewport);
  // A little under a perfect fit, so the tread is not flush against the edge.
  const scale = (Math.min(viewport.width, viewport.height) / (WHEEL_EXTENT * 2)) * 0.88;

  return <group scale={scale}>{children}</group>;
}

export default function HeroScene() {
  const reduced = usePrefersReducedMotion();

  /*
   * Decoration. The wheel says nothing the hero copy does not already say, so
   * it is hidden from assistive technology rather than given a label a screen
   * reader user would hear on every visit. Nothing inside is focusable and
   * there are no controls, so hiding the subtree traps no keyboard focus.
   */
  return (
    <div className="canvas-wrap" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 7.6], fov: 40 }}
        dpr={[1, 1.5]}
        /* A still frame costs one render instead of sixty a second. */
        frameloop={reduced ? "demand" : "always"}
      >
        {/* Authored lighting. Nothing here reaches the network. */}
        <hemisphereLight args={["#eaf6ef", "#04120b", 1.1]} />
        <directionalLight position={[4.2, 5.4, 6]} intensity={2.6} color="#ffffff" />
        <directionalLight position={[-5, -1.5, 2]} intensity={0.9} color={BRAND_ELECTRIC} />
        <pointLight position={[-3.4, -2.6, 4.2]} intensity={14} distance={16} color={BRAND} />
        <pointLight position={[3.2, 3.4, 3.2]} intensity={9} distance={14} color="#d9fbe7" />

        <FitToView>
          <Wheel still={reduced} />
          <PulseRing still={reduced} />
        </FitToView>
      </Canvas>
    </div>
  );
}
