"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * The hero wheel: a commercial steer tyre on a green alloy.
 *
 * WHAT IT IS, AND WHY IT IS THAT. The previous version drew thirty-four chunky
 * blocks standing proud of the carcass, which is the tread of a tractor or an
 * earthmover. This product is sold to mixer, transport and workshop fleets, so
 * the tyre on the front page should be the one those fleets actually run: a
 * commercial steer casing with continuous circumferential ribs and deep
 * longitudinal grooves. The ribs are the single clearest signal that this is a
 * truck tyre rather than a generic wheel, so they are the thing the scene is
 * built around.
 *
 * Proportion follows a real 315/80R22.5: the rim is a little under 60% of the
 * overall diameter, where the old scene had a small rim lost inside a very fat
 * carcass.
 *
 * MOTION. Three things move, and each says something:
 *   1. the wheel turns, because a wheel turns;
 *   2. it leans toward the pointer, so the object reads as solid and as
 *      something you are looking at rather than a picture;
 *   3. a pulse ring crosses the tread, which is a reading being taken and the
 *      "Pulse" in the name.
 * Everything stops under prefers-reduced-motion.
 *
 * NOTHING IS FETCHED. An earlier version used drei's Environment preset, which
 * pulls an HDRI from a third-party CDN on the hero of the marketing site.
 * Lighting is authored here, so the scene cannot be delayed or broken by
 * someone else's host.
 *
 * Colours are the product's own: #16a34a is the brand green used by the web app
 * and the Android launcher icon.
 */

const BRAND = "#16a34a";
const BRAND_BRIGHT = "#22c55e";
const BRAND_ELECTRIC = "#4ade80";
const RUBBER = "#0b1710";
const RUBBER_LIT = "#16281d";
const GROOVE = "#050d08";
const ALLOY = "#dcefe4";

/** Tread geometry, in the same proportions as a 315/80R22.5. */
const TREAD_R = 2.58;   // rib surface
const GROOVE_R = 2.42;  // groove floor, sitting below the ribs
const RIM_R = 1.52;     // wheel flange, just under 60% of overall diameter
const HALF_W = 0.62;    // half the section width

/** Five ribs and four grooves, the classic steer pattern. */
const RIB_CENTRES = [-0.53, -0.265, 0, 0.265, 0.53];
const RIB_W = 0.185;

const STUDS = 10;
const PULSE_SECONDS = 2.8;
/** Half the widest thing drawn. Used to fit the wheel on screen. */
const WHEEL_EXTENT = 2.68;

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
 * Geometries and materials that are used many times over are built once and
 * shared. Declaring them inside a map would upload a separate buffer per stud
 * and per rib, which is dozens of needless allocations for a decoration, and
 * React will not reclaim GPU memory on its own when the scene unmounts.
 */
function useSharedParts() {
  const parts = useMemo(() => {
    // A cylinder's axis is Y, so every one of these is rotated onto Z by its
    // mesh. Open-ended: the rib walls are hidden by their neighbours.
    const rib = new THREE.CylinderGeometry(TREAD_R, TREAD_R, RIB_W, 96, 1, true);
    const stud = new THREE.CylinderGeometry(0.058, 0.058, 0.1, 16);

    const ribMaterial = new THREE.MeshStandardMaterial({
      color: RUBBER_LIT,
      roughness: 0.82,
      metalness: 0.04,
    });
    const studMaterial = new THREE.MeshStandardMaterial({
      color: ALLOY,
      metalness: 0.95,
      roughness: 0.22,
    });

    return { rib, stud, ribMaterial, studMaterial };
  }, []);

  useEffect(() => () => {
    parts.rib.dispose();
    parts.stud.dispose();
    parts.ribMaterial.dispose();
    parts.studMaterial.dispose();
  }, [parts]);

  return parts;
}

/**
 * A ring that grows out of the hub, crosses the tread and fades, once every
 * PULSE_SECONDS. Opacity is driven from the same normalised progress as the
 * scale, so it can never be left visible at a size it was not drawn at.
 */
function PulseRing({ still }: { still: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    if (!mesh.current || !material.current) return;

    if (still) {
      // One legible frame rather than a ring frozen mid-fade at random.
      mesh.current.scale.setScalar(1);
      material.current.opacity = 0.2;
      return;
    }

    const progress = (clock.getElapsedTime() % PULSE_SECONDS) / PULSE_SECONDS;
    const eased = 1 - Math.pow(1 - progress, 2.2);

    mesh.current.scale.setScalar(0.32 + eased * 1.1);
    material.current.opacity = 0.46 * Math.min(progress / 0.12, 1) * (1 - eased);
  });

  return (
    <mesh ref={mesh} position={[0, 0, 0.62]}>
      <ringGeometry args={[2.1, 2.2, 96]} />
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

/** The rubber: grooved base, five ribs, rounded shoulders, bulged sidewalls. */
function Tyre() {
  const { rib, ribMaterial } = useSharedParts();

  return (
    <group>
      {/* Groove floor. Sitting below the ribs, the gaps between them read as
          four deep longitudinal grooves without a single cut being made. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[GROOVE_R, GROOVE_R, HALF_W * 2, 72, 1, true]} />
        <meshStandardMaterial color={GROOVE} roughness={1} side={THREE.DoubleSide} />
      </mesh>

      {RIB_CENTRES.map((z) => (
        <mesh key={z} geometry={rib} material={ribMaterial} position={[0, 0, z]} rotation={[Math.PI / 2, 0, 0]} />
      ))}

      {/* Shoulders: the rounded edge where the tread turns into the sidewall. */}
      {[-HALF_W, HALF_W].map((z) => (
        <mesh key={`sh-${z}`} position={[0, 0, z]}>
          <torusGeometry args={[TREAD_R - 0.08, 0.1, 14, 96]} />
          <meshStandardMaterial color={RUBBER} roughness={0.88} />
        </mesh>
      ))}

      {/* Sidewalls. One torus spanning rim flange to shoulder, flattened on Z
          so it bulges like a loaded casing instead of reading as a doughnut. */}
      <mesh scale={[1, 1, 0.92]}>
        <torusGeometry args={[(RIM_R + TREAD_R) / 2, (TREAD_R - RIM_R) / 2, 26, 96]} />
        <meshStandardMaterial color={RUBBER} roughness={0.9} metalness={0.05} />
      </mesh>
    </group>
  );
}

/** The alloy: flange, dished face, ten studs, centre cap. */
function Rim() {
  const { stud, studMaterial } = useSharedParts();

  const studs = useMemo(
    () =>
      Array.from({ length: STUDS }, (_, i) => {
        const a = (Math.PI * 2 * i) / STUDS;
        return { key: i, x: Math.cos(a) * 0.62, y: Math.sin(a) * 0.62 };
      }),
    [],
  );

  return (
    <group>
      {/* Flange: the one genuinely bright ring, in brand green. */}
      <mesh position={[0, 0, 0.3]}>
        <torusGeometry args={[RIM_R, 0.11, 20, 96]} />
        <meshStandardMaterial
          color={BRAND_BRIGHT}
          emissive={new THREE.Color(BRAND)}
          emissiveIntensity={0.3}
          metalness={0.78}
          roughness={0.22}
        />
      </mesh>

      {/* Dished face, set back from the flange so the rim reads as having depth. */}
      <mesh position={[0, 0, 0.22]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[RIM_R - 0.02, RIM_R - 0.02, 0.16, 72]} />
        <meshStandardMaterial color="#0f2a1b" metalness={0.62} roughness={0.36} />
      </mesh>

      {/* Bolt circle. Ten studs is the commercial standard. */}
      {studs.map((s) => (
        <mesh key={s.key} geometry={stud} material={studMaterial} position={[s.x, s.y, 0.34]} rotation={[Math.PI / 2, 0, 0]} />
      ))}

      {/* Hub and cap. */}
      <mesh position={[0, 0, 0.33]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.36, 0.36, 0.2, 48]} />
        <meshStandardMaterial color={ALLOY} metalness={0.94} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0, 0.45]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.21, 0.21, 0.1, 40]} />
        <meshStandardMaterial
          color={BRAND}
          emissive={new THREE.Color(BRAND)}
          emissiveIntensity={0.4}
          metalness={0.45}
          roughness={0.3}
        />
      </mesh>
    </group>
  );
}

/** Constant rotation. Slow enough to read as a wheel under load, not a fan. */
function Spin({ still, children }: { still: boolean; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (still || !group.current) return;
    group.current.rotation.z += delta * 0.14;
  });

  return <group ref={group}>{children}</group>;
}

/**
 * Lean toward the pointer.
 *
 * state.pointer is already normalised to -1..1 across the canvas and only
 * updates while the pointer is over it, so no DOM listener is needed and the
 * wheel settles back to its resting angle on its own when the pointer leaves.
 * The lean is small and eased; a hero that swings hard at the cursor reads as a
 * toy, and this one sits next to a demo request.
 */
function HoverTilt({ still, children }: { still: boolean; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const REST_X = 0.34;
  const REST_Y = -0.72;

  useFrame(({ pointer }, delta) => {
    if (!group.current) return;
    if (still) {
      group.current.rotation.set(REST_X, REST_Y, 0);
      return;
    }
    // Frame-rate independent easing, so the feel is the same at 60 and 144Hz.
    const k = 1 - Math.pow(0.0001, delta);
    group.current.rotation.x += (REST_X - pointer.y * 0.16 - group.current.rotation.x) * k;
    group.current.rotation.y += (REST_Y + pointer.x * 0.2 - group.current.rotation.y) * k;
  });

  return <group ref={group}>{children}</group>;
}

/**
 * Keeps the whole wheel on screen at every size.
 *
 * A fixed camera distance cannot: the hero stage is portrait on a desktop and
 * the field of view is vertical, so the wheel fitted top to bottom and was
 * sliced off at the right. Scaling to whichever axis is tighter means the tread
 * stays inside the frame whatever shape the column takes, with no
 * per-breakpoint numbers to keep in step with the CSS.
 */
function FitToView({ children }: { children: React.ReactNode }) {
  const viewport = useThree((state) => state.viewport);
  // 0.8 rather than a tighter fit: the two floating KPI panels sit over the
  // stage, and at a fuller size the tread ran under them and touched the
  // right edge of the column.
  const scale = (Math.min(viewport.width, viewport.height) / (WHEEL_EXTENT * 2)) * 0.8;

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
        <hemisphereLight args={["#eaf6ef", "#04120b", 1.15]} />
        <directionalLight position={[4.2, 5.4, 6]} intensity={2.7} color="#ffffff" />
        <directionalLight position={[-5, -1.5, 2]} intensity={0.85} color={BRAND_ELECTRIC} />
        <pointLight position={[-3.4, -2.6, 4.2]} intensity={13} distance={16} color={BRAND} />
        <pointLight position={[3.2, 3.4, 3.2]} intensity={9} distance={14} color="#d9fbe7" />

        <FitToView>
          <HoverTilt still={reduced}>
            <Spin still={reduced}>
              <Tyre />
              <Rim />
            </Spin>
            <PulseRing still={reduced} />
          </HoverTilt>
        </FitToView>
      </Canvas>
    </div>
  );
}
