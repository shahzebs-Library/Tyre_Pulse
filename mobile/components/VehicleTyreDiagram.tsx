/**
 * VehicleTyreDiagram - Interactive top-down vehicle diagram.
 *
 * Layout parity with the WEB app (src/components/VehicleTyreDiagram.jsx): the
 * per-vehicle-type axle structure - single-wheel steer axles, dual-wheel drive
 * axles, lift/tag and trailer singles, and a spare shown ONLY when the vehicle
 * carries one - is produced by the pure `buildTyreDiagramLayout` engine in
 * lib/tyreLayout.ts. This component is presentation + touch only.
 *
 * Touch approach: absolute-positioned TouchableOpacity overlays sit on top of
 * the SVG. This is far more reliable than touch handlers inside SVG elements,
 * which are frequently swallowed by the outer ScrollView on Android.
 */

import React, { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Svg, {
  G, Rect, Ellipse, Circle, Line, Path,
  Text as SvgText, Defs, RadialGradient, LinearGradient, Stop,
} from 'react-native-svg'
import type { TyreCondition, TyrePositionData } from '../lib/types'
import { CONDITION_META } from '../lib/tyreConditions'
import { useTheme } from '../contexts/ThemeContext'
import { radius, spacing, typography, elevation, Theme } from '../lib/theme'
import {
  buildTyreDiagramLayout, TyreSlot, VehicleBodyClass,
} from '../lib/tyreLayout'

// ── Risk colour palette ────────────────────────────────────────────────────────
const RISK = {
  good:     { rim: '#22c55e', glow: '#16a34a', dark: '#15803d' },
  warning:  { rim: '#f59e0b', glow: '#d97706', dark: '#b45309' },
  critical: { rim: '#ef4444', glow: '#dc2626', dark: '#b91c1c' },
  none:     { rim: '#6b7280', glow: '#4b5563', dark: '#374151' },
} as const

type RiskKey = keyof typeof RISK

const CONDITION_RISK: Record<TyreCondition, RiskKey> = {
  Good:     'good',
  Worn:     'warning',
  Damaged:  'critical',
  Puncture: 'critical',
  Flat:     'warning',
  Missing:  'none',
}

// ── Shared SVG gradients ───────────────────────────────────────────────────────
function SharedDefs() {
  return (
    <Defs>
      <RadialGradient id="rub" cx="35%" cy="30%" r="65%" fx="35%" fy="30%">
        <Stop offset="0%"   stopColor="#2d2d2d" />
        <Stop offset="70%"  stopColor="#111111" />
        <Stop offset="100%" stopColor="#0a0a0a" />
      </RadialGradient>
      <RadialGradient id="hub" cx="30%" cy="30%" r="70%" fx="30%" fy="30%">
        <Stop offset="0%"  stopColor="#9ca3af" />
        <Stop offset="100%" stopColor="#1f2937" />
      </RadialGradient>
      {(['good', 'warning', 'critical', 'none'] as RiskKey[]).map(k => (
        <RadialGradient key={k} id={`rim_${k}`} cx="35%" cy="30%" r="65%" fx="35%" fy="30%">
          <Stop offset="0%"   stopColor={RISK[k].rim} />
          <Stop offset="60%"  stopColor={RISK[k].glow} />
          <Stop offset="100%" stopColor={RISK[k].dark} />
        </RadialGradient>
      ))}
      <LinearGradient id="chrome" x1="0%" y1="0%" x2="0%" y2="100%">
        <Stop offset="0%"   stopColor="#f1f5f9" />
        <Stop offset="40%"  stopColor="#94a3b8" />
        <Stop offset="100%" stopColor="#475569" />
      </LinearGradient>
      <RadialGradient id="navyRoof" cx="48%" cy="40%" r="62%">
        <Stop offset="0%"   stopColor="#93c5fd" />
        <Stop offset="35%"  stopColor="#3b82f6" />
        <Stop offset="70%"  stopColor="#1d4ed8" />
        <Stop offset="100%" stopColor="#1e3a8a" />
      </RadialGradient>
      <LinearGradient id="navyHood" x1="0%" y1="0%" x2="100%" y2="0%">
        <Stop offset="0%"   stopColor="#1e3a8a" />
        <Stop offset="50%"  stopColor="#60a5fa" />
        <Stop offset="100%" stopColor="#1e3a8a" />
      </LinearGradient>
      <RadialGradient id="truckCab" cx="48%" cy="35%" r="60%">
        <Stop offset="0%"   stopColor="#f8fafc" />
        <Stop offset="45%"  stopColor="#e2e8f0" />
        <Stop offset="100%" stopColor="#94a3b8" />
      </RadialGradient>
      <LinearGradient id="truckHood" x1="0%" y1="0%" x2="100%" y2="0%">
        <Stop offset="0%"   stopColor="#94a3b8" />
        <Stop offset="50%"  stopColor="#f1f5f9" />
        <Stop offset="100%" stopColor="#94a3b8" />
      </LinearGradient>
      <LinearGradient id="truckCargo" x1="0%" y1="0%" x2="100%" y2="100%">
        <Stop offset="0%"   stopColor="#e2e8f0" />
        <Stop offset="100%" stopColor="#cbd5e1" />
      </LinearGradient>
      <LinearGradient id="trailerBox" x1="0%" y1="0%" x2="0%" y2="100%">
        <Stop offset="0%"   stopColor="#e2e8f0" />
        <Stop offset="100%" stopColor="#94a3b8" />
      </LinearGradient>
      <LinearGradient id="glass" x1="0%" y1="0%" x2="100%" y2="100%">
        <Stop offset="0%"   stopColor="#dbeafe" stopOpacity="0.95" />
        <Stop offset="100%" stopColor="#3b82f6" stopOpacity="0.6" />
      </LinearGradient>
      <RadialGradient id="headlt" cx="50%" cy="50%" r="50%">
        <Stop offset="0%"   stopColor="#fffde7" />
        <Stop offset="100%" stopColor="#fbbf24" stopOpacity="0.6" />
      </RadialGradient>
      <RadialGradient id="brklt" cx="50%" cy="50%" r="50%">
        <Stop offset="0%"   stopColor="#fee2e2" />
        <Stop offset="100%" stopColor="#ef4444" stopOpacity="0.7" />
      </RadialGradient>
    </Defs>
  )
}

// ── 3D Tyre visual (no touch handlers - overlays handle touches) ───────────────
interface TyreProps {
  x: number; y: number; w: number; h: number
  risk: RiskKey; label: string
  selected: boolean; recorded?: boolean
  horizontal?: boolean
}

function Tyre({ x, y, w, h, risk, label, selected, recorded, horizontal }: TyreProps) {
  const col = RISK[risk]
  const cx  = x + w / 2
  const cy  = y + h / 2

  if (horizontal) {
    return (
      <G>
        <Ellipse cx={cx} cy={cy + 2} rx={w / 2 + 1} ry={h / 2 + 0.5} fill="rgba(0,0,0,0.4)" />
        <Rect x={x} y={y} width={w} height={h} rx={h * 0.5}
          fill="#111111" stroke={selected ? '#3b82f6' : col.rim} strokeWidth={selected ? 2 : 1.2} />
        <Ellipse cx={cx} cy={cy} rx={w * 0.22} ry={h * 0.45} fill={`url(#rim_${risk})`} />
        <SvgText x={cx} y={cy + 1} textAnchor="middle"
          fontSize={Math.max(4.5, Math.min(h * 0.95, 8))} fontWeight="800" fill="white">
          {label}
        </SvgText>
      </G>
    )
  }

  const r1 = Math.min(w, h) * 0.12
  const r2 = Math.min(w, h) * 0.30
  const spokes = [0, 60, 120]

  return (
    <G>
      <Ellipse cx={cx + 1.5} cy={cy + 2} rx={w / 2 + 1} ry={h / 2 + 0.5} fill="rgba(0,0,0,0.45)" />
      <Rect x={x} y={y} width={w} height={h} rx={w * 0.28}
        fill="url(#rub)" stroke="#000" strokeWidth={0.6} />
      {[0.20, 0.38, 0.56, 0.74].map((pct, i) => (
        <Rect key={i} x={x + 1.5} y={y + h * pct} width={w - 3} height={h * 0.10} rx={0.8} fill="#222" opacity={0.7} />
      ))}
      <Rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx={w * 0.26}
        fill="none" stroke="#555" strokeWidth={0.4} opacity={0.5} />
      <Ellipse cx={cx} cy={cy} rx={w * 0.33} ry={h * 0.33} fill={`url(#rim_${risk})`} />
      <Ellipse cx={cx} cy={cy} rx={w * 0.33} ry={h * 0.33}
        fill="none" stroke={col.dark} strokeWidth={0.6} />
      {spokes.map((angle, i) => {
        const rad = (angle * Math.PI) / 180
        return (
          <React.Fragment key={i}>
            <Line x1={cx + Math.cos(rad) * r1}         y1={cy + Math.sin(rad) * r1 * (h / w)}
                  x2={cx + Math.cos(rad) * r2}         y2={cy + Math.sin(rad) * r2 * (h / w)}
                  stroke={col.dark} strokeWidth={0.8} opacity={0.7} />
            <Line x1={cx + Math.cos(rad + Math.PI) * r1} y1={cy + Math.sin(rad + Math.PI) * r1 * (h / w)}
                  x2={cx + Math.cos(rad + Math.PI) * r2} y2={cy + Math.sin(rad + Math.PI) * r2 * (h / w)}
                  stroke={col.dark} strokeWidth={0.8} opacity={0.7} />
          </React.Fragment>
        )
      })}
      <Ellipse cx={cx} cy={cy} rx={w * 0.13} ry={h * 0.13} fill="url(#hub)" stroke="#374151" strokeWidth={0.4} />
      <SvgText x={cx} y={cy + 0.4} textAnchor="middle"
        fontSize={Math.max(4, Math.min(w * 0.55, 9))} fontWeight="800" fill="white">
        {label}
      </SvgText>
      {recorded && !selected && (
        <Circle cx={x + w} cy={y} r={Math.max(2.5, w * 0.16)} fill="#16a34a" stroke="#fff" strokeWidth={0.5} />
      )}
      {selected && (
        <Rect x={x - 3} y={y - 3} width={w + 6} height={h + 6}
          rx={w * 0.3 + 1} fill="none" stroke="#3b82f6" strokeWidth={2.5} />
      )}
    </G>
  )
}

// ── Axle beams (drawn behind the wheels so each axle reads as one bar) ──────────
interface Beam { y: number; x1: number; x2: number }
function AxleBeams({ beams }: { beams: Beam[] }) {
  return (
    <G>
      {beams.map((b, i) => (
        <Line key={i} x1={b.x1} y1={b.y} x2={b.x2} y2={b.y}
          stroke="#334155" strokeWidth={3.4} opacity={0.55} strokeLinecap="round" />
      ))}
    </G>
  )
}

// ── Adaptive vehicle bodies (geometry driven by the layout engine) ─────────────
interface BodyProps {
  bodyClass: VehicleBodyClass
  chassisTop: number
  chassisBot: number
  cabBottom: number
}

function VehicleBody({ bodyClass, chassisTop, chassisBot, cabBottom }: BodyProps) {
  if (bodyClass === 'trailer') return <TrailerFrame top={chassisTop} bottom={chassisBot} />
  if (bodyClass === 'car')     return <CarBody top={chassisTop} bottom={chassisBot} cabBottom={cabBottom} />
  return <TruckFrame top={chassisTop} bottom={chassisBot} cabBottom={cabBottom} />
}

function CarBody({ top, bottom, cabBottom }: { top: number; bottom: number; cabBottom: number }) {
  const hoodBot = Math.min(top + 30, cabBottom - 4)
  return (
    <G>
      <Ellipse cx={100} cy={bottom + 10} rx={54} ry={8} fill="rgba(0,0,0,0.18)" />
      {/* Front bumper + lights */}
      <Rect x={62} y={top - 12} width={76} height={11} rx={4} fill="url(#chrome)" />
      <Rect x={62} y={top - 11} width={17} height={9} rx={2} fill="url(#headlt)" />
      <Rect x={121} y={top - 11} width={17} height={9} rx={2} fill="url(#headlt)" />
      {/* Body shell */}
      <Rect x={60} y={top} width={80} height={bottom - top} rx={14} fill="url(#navyRoof)" />
      {/* Hood */}
      <Rect x={62} y={top} width={76} height={hoodBot - top} rx={9} fill="url(#navyHood)" />
      <Line x1={100} y1={top + 2} x2={100} y2={hoodBot} stroke="#93c5fd" strokeWidth={0.8} opacity={0.5} />
      {/* Windshield + cabin */}
      <Path d={`M 67,${hoodBot} L 133,${hoodBot} L 129,${hoodBot + 14} L 71,${hoodBot + 14} Z`} fill="url(#glass)" opacity={0.9} />
      <Line x1={100} y1={cabBottom} x2={100} y2={bottom - 8} stroke="#1e3a8a" strokeWidth={1.2} opacity={0.6} />
      {/* Roof highlight */}
      <Rect x={74} y={cabBottom + 4} width={52} height={4} rx={2} fill="#60a5fa" opacity={0.35} />
      {/* Rear bumper */}
      <Rect x={62} y={bottom} width={76} height={10} rx={4} fill="url(#chrome)" />
      <Rect x={64} y={bottom + 1} width={18} height={7} rx={2} fill="url(#brklt)" />
      <Rect x={118} y={bottom + 1} width={18} height={7} rx={2} fill="url(#brklt)" />
      {/* Mirrors */}
      <Rect x={45} y={hoodBot - 4} width={16} height={7} rx={2.5} fill="#1d4ed8" stroke="#1e3a8a" strokeWidth={0.5} />
      <Rect x={139} y={hoodBot - 4} width={16} height={7} rx={2.5} fill="#1d4ed8" stroke="#1e3a8a" strokeWidth={0.5} />
    </G>
  )
}

function TruckFrame({ top, bottom, cabBottom }: { top: number; bottom: number; cabBottom: number }) {
  const hoodBot = Math.min(top + 26, cabBottom - 8)
  const cargoTop = cabBottom
  return (
    <G>
      <Ellipse cx={100} cy={bottom + 12} rx={58} ry={8} fill="rgba(0,0,0,0.18)" />
      {/* Front bumper + lights */}
      <Rect x={58} y={top - 12} width={84} height={12} rx={4} fill="url(#chrome)" />
      <Rect x={58} y={top - 11} width={22} height={10} rx={2} fill="url(#headlt)" />
      <Rect x={120} y={top - 11} width={22} height={10} rx={2} fill="url(#headlt)" />
      {/* Chassis rails span the whole running length */}
      <Rect x={68} y={cabBottom} width={9} height={bottom - cabBottom} fill="#334155" />
      <Rect x={123} y={cabBottom} width={9} height={bottom - cabBottom} fill="#334155" />
      {/* Cab */}
      <Rect x={58} y={top} width={84} height={cabBottom - top} rx={6} fill="url(#truckCab)" />
      {/* Hood */}
      <Rect x={60} y={top} width={80} height={hoodBot - top} rx={4} fill="url(#truckHood)" />
      <Line x1={100} y1={top + 2} x2={100} y2={hoodBot} stroke="#94a3b8" strokeWidth={0.8} opacity={0.5} />
      {/* Windshield */}
      <Path d={`M 63,${hoodBot} L 137,${hoodBot} L 133,${hoodBot + 16} L 67,${hoodBot + 16} Z`} fill="url(#glass)" opacity={0.9} />
      {/* Brand stripe (Daylight green) across cab bottom */}
      <Rect x={58} y={cabBottom - 8} width={84} height={8} fill="#16a34a" opacity={0.9} />
      <SvgText x={100} y={cabBottom - 2.4} textAnchor="middle" fontSize={4} fontWeight="800" fill="white">FLEET VEHICLE</SvgText>
      {/* Cargo box */}
      <Rect x={58} y={cargoTop} width={84} height={bottom - cargoTop} rx={3} fill="url(#truckCargo)" />
      <Rect x={58}  y={cargoTop} width={5} height={bottom - cargoTop} rx={2} fill="#cbd5e1" opacity={0.9} />
      <Rect x={137} y={cargoTop} width={5} height={bottom - cargoTop} rx={2} fill="#cbd5e1" opacity={0.9} />
      {Array.from({ length: Math.max(0, Math.floor((bottom - cargoTop) / 24)) }).map((_, i) => (
        <Line key={i} x1={64} y1={cargoTop + 16 + i * 24} x2={136} y2={cargoTop + 16 + i * 24}
          stroke="#94a3b8" strokeWidth={0.8} opacity={0.5} />
      ))}
      {/* Rear bumper */}
      <Rect x={58} y={bottom} width={84} height={11} rx={3} fill="url(#chrome)" />
      <Rect x={60}  y={bottom + 1} width={22} height={7} rx={2} fill="url(#brklt)" />
      <Rect x={118} y={bottom + 1} width={22} height={7} rx={2} fill="url(#brklt)" />
      {/* Mirrors */}
      <Rect x={40} y={hoodBot} width={18} height={9} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.8} />
      <Rect x={142} y={hoodBot} width={18} height={9} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.8} />
    </G>
  )
}

function TrailerFrame({ top, bottom }: { top: number; bottom: number }) {
  return (
    <G>
      <Ellipse cx={100} cy={bottom + 10} rx={55} ry={7} fill="rgba(0,0,0,0.18)" />
      {/* Coupling / king-pin */}
      <Ellipse cx={100} cy={top - 8} rx={16} ry={8} fill="#94a3b8" />
      <Ellipse cx={100} cy={top - 8} rx={8} ry={4} fill="#475569" />
      <Rect x={90} y={top - 8} width={20} height={4} rx={2} fill="#64748b" />
      {/* Chassis rails */}
      <Rect x={69} y={top} width={9} height={bottom - top} fill="#334155" />
      <Rect x={122} y={top} width={9} height={bottom - top} fill="#334155" />
      {/* Box */}
      <Rect x={57} y={top} width={86} height={bottom - top} rx={4} fill="url(#trailerBox)" />
      <Rect x={57}  y={top} width={5} height={bottom - top} rx={2} fill="#94a3b8" opacity={0.7} />
      <Rect x={138} y={top} width={5} height={bottom - top} rx={2} fill="#94a3b8" opacity={0.7} />
      {Array.from({ length: Math.max(0, Math.floor((bottom - top) / 28)) }).map((_, i) => (
        <Line key={i} x1={59} y1={top + 20 + i * 28} x2={141} y2={top + 20 + i * 28}
          stroke="#94a3b8" strokeWidth={0.8} opacity={0.5} />
      ))}
      {/* Rear bumper */}
      <Rect x={57} y={bottom} width={86} height={11} rx={3} fill="url(#chrome)" />
      <Rect x={59}  y={bottom + 1} width={22} height={7} rx={2} fill="url(#brklt)" />
      <Rect x={119} y={bottom + 1} width={22} height={7} rx={2} fill="url(#brklt)" />
    </G>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────
interface Props {
  vehicleType: string
  positions: string[]
  tyreData: Record<string, TyrePositionData>
  selectedPosition?: string | null
  onPositionPress?: (position: string) => void
  width?: number
}

export default function VehicleTyreDiagram({
  vehicleType, positions, tyreData, selectedPosition, onPositionPress, width = 320,
}: Props) {
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])

  // Build the per-vehicle-type axle layout (web-parity structure).
  const layout = useMemo(
    () => buildTyreDiagramLayout(vehicleType, positions),
    [vehicleType, positions.join('|')],
  )
  const { viewH, bodyClass, chassisTop, chassisBot, axleYs, slots } = layout

  // SVG coordinate space is 220 units wide; scale to requested pixel width.
  const SVG_COORD_W = 220
  const scale       = width / SVG_COORD_W
  const svgHeight   = Math.round(viewH * scale)

  // Cab bottom = midway between the last steer axle and the first driven axle,
  // so the cab always sits above the running gear regardless of axle count.
  const cabBottom = useMemo(() => {
    const steerSlots = slots.filter(s => s.kind === 'steer')
    const rearSlots  = slots.filter(s => s.kind === 'drive' || s.kind === 'lift' || s.kind === 'trailer')
    if (steerSlots.length && rearSlots.length) {
      const lastSteerY = Math.max(...steerSlots.map(s => s.y + s.h))
      const firstRearY = Math.min(...rearSlots.map(s => s.y))
      return Math.round((lastSteerY + firstRearY) / 2)
    }
    return Math.round(chassisTop + Math.max(28, (chassisBot - chassisTop) * 0.28))
  }, [slots, chassisTop, chassisBot])

  // Axle beams: one bar per axle, spanning that axle's wheels.
  const beams = useMemo<Beam[]>(() => {
    const byAxle = new Map<number, TyreSlot[]>()
    slots.forEach(s => {
      if (s.kind === 'spare') return
      const arr = byAxle.get(s.axle) ?? []
      arr.push(s)
      byAxle.set(s.axle, arr)
    })
    const out: Beam[] = []
    byAxle.forEach(arr => {
      const y  = arr[0].y + arr[0].h / 2
      const x1 = Math.min(...arr.map(s => s.x)) - 2
      const x2 = Math.max(...arr.map(s => s.x + s.w)) + 2
      out.push({ y, x1, x2 })
    })
    return out
  }, [slots])

  const { riskMap, recordedMap, conditionMap } = useMemo(() => {
    const risk: Record<string, RiskKey>     = {}
    const recorded: Record<string, boolean> = {}
    const cond: Record<string, TyreCondition> = {}
    slots.forEach(s => {
      const d = tyreData[s.id]
      risk[s.id]     = d ? CONDITION_RISK[d.condition] : 'none'
      cond[s.id]     = d?.condition ?? 'Good'
      recorded[s.id] = !!d && (
        !!d.serial_number || !!d.pressure_psi || !!d.tread_depth_mm ||
        !!d.notes || !!d.photo_uri || d.condition !== 'Good'
      )
    })
    return { riskMap: risk, recordedMap: recorded, conditionMap: cond }
  }, [slots, tyreData])

  // Convert SVG coordinate space -> screen pixels for the overlay touch targets.
  // SVG viewBox: x from -10 to 210 (220 units), y from -6 to viewH+6.
  function toScreen(svgX: number, svgY: number, svgW: number, svgH: number) {
    const pad = 10  // generous finger padding in SVG units
    return {
      left:   (svgX - pad + 10) * scale,
      top:    (svgY - pad +  6) * scale,
      width:  (svgW + pad * 2)  * scale,
      height: (svgH + pad * 2)  * scale,
    }
  }

  // Nothing to render (no positions supplied) -> honest empty state.
  if (positions.length === 0) {
    return (
      <View style={[styles.container, { paddingVertical: 32, alignItems: 'center' }]}>
        <Text style={{ fontSize: 34 }}>🛞</Text>
        <Text style={styles.emptyTitle}>{vehicleType || 'Vehicle'}</Text>
        <Text style={styles.emptyText}>No tyre positions to display.</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* FRONT label */}
      <View style={styles.frontLabel}>
        <Ionicons name="chevron-up" size={13} color={theme.color.textMuted} />
        <Text style={styles.frontLabelText}>FRONT</Text>
      </View>

      {/* Vehicle heading + tyre count (mirrors the web caption) */}
      <Text style={styles.caption}>{layout.resolvedType} · {slots.length} tyres</Text>

      {/* Tap hint */}
      <Text style={styles.tapHint}>Tap a tyre to record its condition</Text>

      {/* SVG diagram - purely visual, no touch handlers */}
      <View style={{ width, height: svgHeight }}>
        <Svg
          width={width}
          height={svgHeight}
          viewBox={`-10 -6 ${SVG_COORD_W} ${viewH + 12}`}
          style={styles.svg}
          pointerEvents="none"
        >
          <SharedDefs />
          <AxleBeams beams={beams} />
          <VehicleBody
            bodyClass={bodyClass}
            chassisTop={chassisTop}
            chassisBot={chassisBot}
            cabBottom={cabBottom}
          />
          {slots.map(s => (
            <Tyre
              key={s.id}
              x={s.x} y={s.y} w={s.w} h={s.h}
              label={s.label}
              horizontal={s.horizontal}
              risk={riskMap[s.id] ?? 'none'}
              recorded={recordedMap[s.id]}
              selected={selectedPosition === s.id}
            />
          ))}
        </Svg>

        {/* Absolute touch overlays - one per tyre, on top of the SVG */}
        {slots.map(s => {
          const pos = toScreen(s.x, s.y, s.w, s.h)
          const isSelected = selectedPosition === s.id
          const cond = conditionMap[s.id]
          const meta = cond ? CONDITION_META[cond] : null
          return (
            <TouchableOpacity
              key={`hit-${s.id}`}
              style={[styles.hitOverlay, pos, isSelected && styles.hitOverlaySelected]}
              onPress={() => onPositionPress?.(s.id)}
              activeOpacity={0.6}
            >
              {/* Show emoji badge in top-right corner when recorded */}
              {recordedMap[s.id] && meta && (
                <View style={[styles.condBadge, { backgroundColor: meta.color }]}>
                  <Text style={styles.condBadgeEmoji}>{meta.emoji}</Text>
                </View>
              )}
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Condition legend */}
      <View style={styles.legend}>
        {(['Good', 'Worn', 'Damaged', 'Puncture', 'Flat', 'Missing'] as TyreCondition[]).map(c => {
          const m = CONDITION_META[c]
          return (
            <View key={c} style={[styles.legendItem, { backgroundColor: m.tint, borderColor: m.borderColor }]}>
              <Text style={styles.legendEmoji}>{m.emoji}</Text>
              <Text style={[styles.legendLabel, { color: m.color }]}>{c}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    container: {
      alignItems: 'center',
      backgroundColor: c.surfaceAlt,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: c.border,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
      marginBottom: spacing.lg,
      ...elevation(theme, 1),
    },
    frontLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      marginBottom: spacing.xs,
    },
    frontLabelText: {
      fontSize: 11,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 2,
    },
    caption: {
      fontSize: 13,
      fontWeight: '800',
      color: c.text,
      marginBottom: 2,
      textAlign: 'center',
    },
    tapHint: {
      ...typography.caption,
      color: c.textSecondary,
      marginBottom: spacing.sm,
      textAlign: 'center',
    },
    emptyTitle: { ...typography.title, color: c.text, marginTop: spacing.sm },
    emptyText: { ...typography.caption, color: c.textMuted, marginTop: 2, textAlign: 'center' },
    svg: { overflow: 'visible' },
    hitOverlay: {
      position: 'absolute',
      borderRadius: 8,
      backgroundColor: 'transparent',
      borderWidth: 0,
    },
    hitOverlaySelected: {
      borderWidth: 3,
      borderColor: c.info.base,
      backgroundColor: theme.mode === 'dark' ? 'rgba(56,189,248,0.14)' : 'rgba(3,105,161,0.10)',
    },
    condBadge: {
      position: 'absolute',
      top: -2,
      right: -2,
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: c.surface,
    },
    condBadgeEmoji: { fontSize: 10 },
    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    legendEmoji: { fontSize: 13 },
    legendLabel: { fontSize: 11, fontWeight: '800' },
  })
}
