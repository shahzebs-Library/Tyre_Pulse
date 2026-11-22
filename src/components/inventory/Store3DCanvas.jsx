/**
 * The three.js part of the 3D store view. Loaded ONLY through a dynamic
 * import from Store3DPanel, so three / @react-three/* stay out of the main
 * bundle and out of every other route.
 *
 * Containers (20 ft standard by default, door at +x) and rooms are translucent boxes; racks are frames; every bin is
 * a small box coloured by its real status. A bin that just changed pulses for
 * a few seconds (never under prefers-reduced-motion).
 */
import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html, Edges } from '@react-three/drei'

export const BIN_COLORS = { empty: '#71717a', stock: '#22c55e', low: '#f59e0b', counted: '#38bdf8' }
const PULSE_MS = 4000

function Bin({ bin, rack, selected, pulseAt, reducedMotion, onPick }) {
  const ref = useRef()
  useFrame(() => {
    if (!ref.current) return
    const age = pulseAt ? Date.now() - pulseAt : Infinity
    const s = !reducedMotion && age < PULSE_MS ? 1 + 0.25 * Math.abs(Math.sin(age / 180)) : 1
    ref.current.scale.setScalar(s)
  })
  return (
    <mesh ref={ref} position={[bin.u, bin.v - rack.height / 2, 0]}
      onClick={(e) => { e.stopPropagation(); onPick(bin) }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { document.body.style.cursor = '' }}>
      <boxGeometry args={bin.size} />
      <meshStandardMaterial color={BIN_COLORS[bin.status] || BIN_COLORS.empty} emissive={selected || pulseAt ? '#FFC629' : '#000000'}
        emissiveIntensity={selected ? 0.6 : (pulseAt && Date.now() - pulseAt < PULSE_MS ? 0.4 : 0)} />
      {selected && <Edges color="#FFC629" />}
    </mesh>
  )
}

function Rack({ rack, selectedId, pulses, reducedMotion, onPick }) {
  return (
    <group position={[rack.x, rack.height / 2 + 0.02, rack.z]} rotation={[0, rack.rotation || 0, 0]}>
      <mesh>
        <boxGeometry args={[rack.length, rack.height, rack.depth]} />
        <meshStandardMaterial color="#9ca3af" transparent opacity={0.06} depthWrite={false} />
        <Edges color="#71717a" />
      </mesh>
      {rack.bins.map((b) => (
        <Bin key={b.id} bin={b} rack={rack} selected={b.id === selectedId} pulseAt={pulses.get(b.id)} reducedMotion={reducedMotion} onPick={onPick} />
      ))}
    </group>
  )
}

function Zone({ zone, selectedId, pulses, reducedMotion, onPick }) {
  const shell = zone.kind === 'container' ? '#b45309' : '#64748b'
  return (
    <group position={[zone.x, 0, zone.z]}>
      <mesh position={[0, zone.height / 2, 0]}>
        <boxGeometry args={[zone.length, zone.height, zone.width]} />
        <meshStandardMaterial color={shell} transparent opacity={0.1} depthWrite={false} />
        <Edges color={shell} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[zone.length, zone.width]} />
        <meshStandardMaterial color="#18181b" />
      </mesh>
      {zone.kind === 'container' && (
        // Door frame at the +x end (the aisle runs between the two wall racks).
        <mesh position={[zone.length / 2, zone.height / 2, 0]}>
          <boxGeometry args={[0.04, zone.height * 0.95, zone.width * 0.95]} />
          <meshStandardMaterial color="#FFC629" transparent opacity={0.25} />
          <Edges color="#FFC629" />
        </mesh>
      )}
      {zone.racks.map((r) => (
        <Rack key={r.id} rack={r} selectedId={selectedId} pulses={pulses} reducedMotion={reducedMotion} onPick={onPick} />
      ))}
      <Html position={[-zone.length / 2, zone.height + 0.35, 0]} center={false} distanceFactor={14} zIndexRange={[10, 0]}>
        <div dir="auto" className="inv-3d-tag">{zone.code}{zone.name ? ` · ${zone.name}` : ''}</div>
      </Html>
    </group>
  )
}

export default function Store3DCanvas({ layout, selectedId, pulses, reducedMotion, onPick, label }) {
  const dist = useMemo(() => Math.max(8, layout.span * 0.75 + 5), [layout.span])
  return (
    <Canvas camera={{ position: [dist * 0.35, dist * 0.6, dist * 0.8], fov: 45 }} dpr={[1, 2]} aria-label={label}
      onPointerMissed={() => onPick(null)} frameloop={reducedMotion ? 'demand' : 'always'}>
      <color attach="background" args={['#0b0b0c']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 18, 8]} intensity={0.9} />
      <gridHelper args={[Math.max(40, layout.span * 2 + 20), 40, '#27272a', '#1c1c1f']} />
      {layout.zones.map((z) => (
        <Zone key={z.id} zone={z} selectedId={selectedId} pulses={pulses} reducedMotion={reducedMotion} onPick={onPick} />
      ))}
      <OrbitControls makeDefault enableDamping={!reducedMotion} maxPolarAngle={Math.PI / 2.05} />
    </Canvas>
  )
}
