/**
 * VehicleTyreDiagram — React Native SVG
 *
 * Interactive top-down vehicle diagram with 3D tyre rendering per position.
 * Risk colours and tyre geometry mirror the web VehicleTyreDiagram.jsx exactly.
 * Tap any tyre to call onPositionPress(positionId).
 */

import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Svg, {
  G, Rect, Ellipse, Circle, Line, Path,
  Text as SvgText, Defs, RadialGradient,
  LinearGradient, Stop,
} from 'react-native-svg'
import type { TyreCondition, TyrePositionData } from '../lib/types'

// ── Risk colour palette (matches web exactly) ──────────────────────────────────
const RISK = {
  good:     { rim: '#22c55e', glow: '#16a34a', dark: '#15803d', label: 'Good' },
  warning:  { rim: '#f59e0b', glow: '#d97706', dark: '#b45309', label: 'Warning' },
  critical: { rim: '#ef4444', glow: '#dc2626', dark: '#b91c1c', label: 'Critical' },
  none:     { rim: '#6b7280', glow: '#4b5563', dark: '#374151', label: 'No Data' },
} as const

type RiskKey = keyof typeof RISK

const CONDITION_RISK: Record<TyreCondition, RiskKey> = {
  Good:    'good',
  Worn:    'warning',
  Damaged: 'critical',
  Flat:    'critical',
  Missing: 'none',
}

// ── Shared SVG defs — rubber + hub + per-risk rim gradients ───────────────────
function SharedDefs() {
  return (
    <Defs>
      {/* Rubber body gradient — dark radial */}
      <RadialGradient id="rub" cx="35%" cy="30%" r="65%" fx="35%" fy="30%">
        <Stop offset="0%" stopColor="#2d2d2d" />
        <Stop offset="70%" stopColor="#111111" />
        <Stop offset="100%" stopColor="#0a0a0a" />
      </RadialGradient>

      {/* Hub-cap shine */}
      <RadialGradient id="hub" cx="30%" cy="30%" r="70%" fx="30%" fy="30%">
        <Stop offset="0%" stopColor="#9ca3af" />
        <Stop offset="100%" stopColor="#1f2937" />
      </RadialGradient>

      {/* Rim gradient per risk level */}
      <RadialGradient id="rim_good" cx="35%" cy="30%" r="65%" fx="35%" fy="30%">
        <Stop offset="0%"   stopColor={RISK.good.rim} />
        <Stop offset="60%"  stopColor={RISK.good.glow} />
        <Stop offset="100%" stopColor={RISK.good.dark} />
      </RadialGradient>
      <RadialGradient id="rim_warning" cx="35%" cy="30%" r="65%" fx="35%" fy="30%">
        <Stop offset="0%"   stopColor={RISK.warning.rim} />
        <Stop offset="60%"  stopColor={RISK.warning.glow} />
        <Stop offset="100%" stopColor={RISK.warning.dark} />
      </RadialGradient>
      <RadialGradient id="rim_critical" cx="35%" cy="30%" r="65%" fx="35%" fy="30%">
        <Stop offset="0%"   stopColor={RISK.critical.rim} />
        <Stop offset="60%"  stopColor={RISK.critical.glow} />
        <Stop offset="100%" stopColor={RISK.critical.dark} />
      </RadialGradient>
      <RadialGradient id="rim_none" cx="35%" cy="30%" r="65%" fx="35%" fy="30%">
        <Stop offset="0%"   stopColor={RISK.none.rim} />
        <Stop offset="60%"  stopColor={RISK.none.glow} />
        <Stop offset="100%" stopColor={RISK.none.dark} />
      </RadialGradient>

      {/* Chrome bumper / trim */}
      <LinearGradient id="chrome" x1="0%" y1="0%" x2="0%" y2="100%">
        <Stop offset="0%"   stopColor="#f1f5f9" />
        <Stop offset="40%"  stopColor="#94a3b8" />
        <Stop offset="100%" stopColor="#475569" />
      </LinearGradient>

      {/* Navy-blue body gradients */}
      <RadialGradient id="navyRoof" cx="48%" cy="40%" r="62%" fx="48%" fy="40%">
        <Stop offset="0%"   stopColor="#93c5fd" />
        <Stop offset="35%"  stopColor="#3b82f6" />
        <Stop offset="70%"  stopColor="#1d4ed8" />
        <Stop offset="100%" stopColor="#1e3a8a" />
      </RadialGradient>
      <LinearGradient id="navyHood" x1="0%" y1="0%" x2="100%" y2="0%">
        <Stop offset="0%"   stopColor="#1e3a8a" />
        <Stop offset="30%"  stopColor="#2563eb" />
        <Stop offset="50%"  stopColor="#60a5fa" />
        <Stop offset="70%"  stopColor="#2563eb" />
        <Stop offset="100%" stopColor="#1e3a8a" />
      </LinearGradient>

      {/* Slate truck gradients */}
      <RadialGradient id="truckCab" cx="48%" cy="35%" r="60%" fx="48%" fy="35%">
        <Stop offset="0%"   stopColor="#64748b" />
        <Stop offset="40%"  stopColor="#334155" />
        <Stop offset="100%" stopColor="#1e293b" />
      </RadialGradient>
      <LinearGradient id="truckHood" x1="0%" y1="0%" x2="100%" y2="0%">
        <Stop offset="0%"   stopColor="#1e293b" />
        <Stop offset="30%"  stopColor="#334155" />
        <Stop offset="50%"  stopColor="#475569" />
        <Stop offset="70%"  stopColor="#334155" />
        <Stop offset="100%" stopColor="#1e293b" />
      </LinearGradient>
      <LinearGradient id="truckCargo" x1="0%" y1="0%" x2="100%" y2="100%">
        <Stop offset="0%"   stopColor="#334155" />
        <Stop offset="50%"  stopColor="#1e293b" />
        <Stop offset="100%" stopColor="#0f172a" />
      </LinearGradient>

      {/* Trailer */}
      <LinearGradient id="trailerBox" x1="0%" y1="0%" x2="0%" y2="100%">
        <Stop offset="0%"   stopColor="#475569" />
        <Stop offset="50%"  stopColor="#334155" />
        <Stop offset="100%" stopColor="#1e293b" />
      </LinearGradient>

      {/* Glass */}
      <LinearGradient id="glass" x1="0%" y1="0%" x2="100%" y2="100%">
        <Stop offset="0%"   stopColor="#dbeafe" stopOpacity="0.95" />
        <Stop offset="40%"  stopColor="#93c5fd" stopOpacity="0.85" />
        <Stop offset="100%" stopColor="#3b82f6" stopOpacity="0.6" />
      </LinearGradient>

      {/* Headlight */}
      <RadialGradient id="headlt" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        <Stop offset="0%"   stopColor="#fffde7" />
        <Stop offset="60%"  stopColor="#fef08a" />
        <Stop offset="100%" stopColor="#fbbf24" stopOpacity="0.6" />
      </RadialGradient>

      {/* Brake light */}
      <RadialGradient id="brklt" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        <Stop offset="0%"   stopColor="#fee2e2" />
        <Stop offset="60%"  stopColor="#fca5a5" />
        <Stop offset="100%" stopColor="#ef4444" stopOpacity="0.7" />
      </RadialGradient>
    </Defs>
  )
}

// ── 3D Tyre (visual only — touch handled by a separate hit layer) ──────────────
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

  // For horizontal spare tyre: just draw a flat oval
  if (horizontal) {
    return (
      <G>
        <Ellipse cx={cx} cy={cy + 2} rx={w / 2 + 1} ry={h / 2 + 0.5} fill="rgba(0,0,0,0.4)" />
        <Rect x={x} y={y} width={w} height={h} rx={h * 0.5}
          fill="#111111" stroke={selected ? '#3b82f6' : col.rim}
          strokeWidth={selected ? 2 : 1.2} />
        <Ellipse cx={cx} cy={cy} rx={w * 0.22} ry={h * 0.45}
          fill={`url(#rim_${risk})`} />
        <SvgText x={cx} y={cy + 1} textAnchor="middle"
          fontSize={Math.max(4, Math.min(h * 0.9, 7))}
          fontWeight="800" fill="white">
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
      {/* Drop shadow */}
      <Ellipse cx={cx + 1.5} cy={cy + 2} rx={w / 2 + 1} ry={h / 2 + 0.5}
        fill="rgba(0,0,0,0.45)" />

      {/* Rubber body */}
      <Rect x={x} y={y} width={w} height={h} rx={w * 0.28}
        fill="url(#rub)" stroke="#000" strokeWidth={0.6} />

      {/* Tread blocks */}
      {[0.20, 0.38, 0.56, 0.74].map((pct, i) => (
        <Rect key={i} x={x + 1.5} y={y + h * pct}
          width={w - 3} height={h * 0.10} rx={0.8} fill="#222" opacity={0.7} />
      ))}

      {/* Sidewall highlight */}
      <Rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1}
        rx={w * 0.26} fill="none" stroke="#555" strokeWidth={0.4} opacity={0.5} />

      {/* Rim disc */}
      <Ellipse cx={cx} cy={cy} rx={w * 0.33} ry={h * 0.33}
        fill={`url(#rim_${risk})`} />
      <Ellipse cx={cx} cy={cy} rx={w * 0.33} ry={h * 0.33}
        fill="none" stroke={col.dark} strokeWidth={0.6} />

      {/* Spokes */}
      {spokes.map((angle, i) => {
        const rad = (angle * Math.PI) / 180
        return (
          <React.Fragment key={i}>
            <Line
              x1={cx + Math.cos(rad) * r1} y1={cy + Math.sin(rad) * r1 * (h / w)}
              x2={cx + Math.cos(rad) * r2} y2={cy + Math.sin(rad) * r2 * (h / w)}
              stroke={col.dark} strokeWidth={0.8} opacity={0.7}
            />
            <Line
              x1={cx + Math.cos(rad + Math.PI) * r1} y1={cy + Math.sin(rad + Math.PI) * r1 * (h / w)}
              x2={cx + Math.cos(rad + Math.PI) * r2} y2={cy + Math.sin(rad + Math.PI) * r2 * (h / w)}
              stroke={col.dark} strokeWidth={0.8} opacity={0.7}
            />
          </React.Fragment>
        )
      })}

      {/* Hub cap */}
      <Ellipse cx={cx} cy={cy} rx={w * 0.13} ry={h * 0.13}
        fill="url(#hub)" stroke="#374151" strokeWidth={0.4} />

      {/* Label */}
      <SvgText x={cx} y={cy + 0.4} textAnchor="middle"
        fontSize={Math.max(3.5, Math.min(w * 0.50, 8))}
        fontWeight="800" fill="white">
        {label}
      </SvgText>

      {/* Recorded check mark — drawn at the top-right corner once data exists */}
      {recorded && !selected && (
        <Circle cx={x + w} cy={y} r={Math.max(2.5, w * 0.16)} fill="#16a34a" stroke="#fff" strokeWidth={0.5} />
      )}

      {/* Selection ring */}
      {selected && (
        <Rect x={x - 3} y={y - 3} width={w + 6} height={h + 6}
          rx={w * 0.3 + 1} fill="none" stroke="#3b82f6" strokeWidth={2.5} />
      )}
    </G>
  )
}

// ── Touch hit target ──────────────────────────────────────────────────────────
// A dedicated, generously-padded transparent rectangle rendered ABOVE every
// visual element. Keeping the press handler on a single leaf <Rect> (rather than
// a parent <G> wrapping decorative shapes) makes taps register reliably on both
// iOS and Android — the previous nested-<G> approach frequently swallowed touches.
interface HitAreaProps {
  x: number; y: number; w: number; h: number
  id: string
  onActivate: (id: string) => void
}

function HitArea({ x, y, w, h, id, onActivate }: HitAreaProps) {
  // Minimum ~44pt-equivalent target: expand small tyres outward so the finger
  // target is comfortable even though the drawn tyre is small.
  const padX = Math.max(6, w * 0.45)
  const padY = Math.max(6, h * 0.30)
  return (
    <Rect
      x={x - padX}
      y={y - padY}
      width={w + padX * 2}
      height={h + padY * 2}
      fill="transparent"
      // onPressIn fires on finger-down for snappy feedback; onPress covers the
      // standard tap. Both are safe to call — the parent de-bounces.
      onPressIn={() => onActivate(id)}
      onPress={() => onActivate(id)}
    />
  )
}

// ── Vehicle body components ────────────────────────────────────────────────────

function FourWheelerBody() {
  return (
    <G>
      {/* Ground shadow */}
      <Ellipse cx={100} cy={245} rx={52} ry={7} fill="rgba(0,0,0,0.2)" />

      {/* Front bumper */}
      <Rect x={62} y={10} width={76} height={11} rx={4} fill="url(#chrome)" />
      {/* Headlights */}
      <Rect x={62} y={11} width={17} height={9} rx={2} fill="url(#headlt)" />
      <Rect x={121} y={11} width={17} height={9} rx={2} fill="url(#headlt)" />
      {/* DRL strip */}
      <Rect x={63} y={20} width={74} height={2} rx={1} fill="#fbbf24" opacity={0.8} />

      {/* Hood */}
      <Rect x={62} y={22} width={76} height={44} rx={8} fill="url(#navyHood)" />
      {/* Center crease */}
      <Line x1={100} y1={24} x2={100} y2={64} stroke="#93c5fd" strokeWidth={0.8} opacity={0.5} />

      {/* Windshield */}
      <Path d="M 67,66 L 133,66 L 129,82 L 71,82 Z" fill="url(#glass)" opacity={0.9} />
      <Path d="M 71,67 L 115,67 L 112,76 L 73,76 Z" fill="white" opacity={0.25} />
      {/* Wipers */}
      <Line x1={80} y1={80} x2={99} y2={68} stroke="#475569" strokeWidth={0.8} opacity={0.7} />
      <Line x1={120} y1={80} x2={101} y2={68} stroke="#475569" strokeWidth={0.8} opacity={0.7} />

      {/* Cab */}
      <Rect x={62} y={82} width={76} height={68} rx={3} fill="url(#navyRoof)" />
      {/* A-pillars */}
      <Path d="M 62,82 L 67,66" stroke="#1e3a8a" strokeWidth={3} strokeLinecap="round" />
      <Path d="M 138,82 L 133,66" stroke="#1e3a8a" strokeWidth={3} strokeLinecap="round" />
      {/* Roof highlight */}
      <Rect x={75} y={86} width={50} height={4} rx={2} fill="#60a5fa" opacity={0.35} />
      {/* Door divider */}
      <Line x1={100} y1={84} x2={100} y2={148} stroke="#1e3a8a" strokeWidth={1.2} opacity={0.7} />
      {/* Door handles */}
      <Rect x={83} y={118} width={11} height={3} rx={1.5} fill="url(#chrome)" />
      <Rect x={106} y={118} width={11} height={3} rx={1.5} fill="url(#chrome)" />
      {/* Headrests */}
      <Ellipse cx={79} cy={99} rx={9} ry={7} fill="#1e3a8a" stroke="#1d4ed8" strokeWidth={0.5} />
      <Ellipse cx={121} cy={99} rx={9} ry={7} fill="#1e3a8a" stroke="#1d4ed8" strokeWidth={0.5} />

      {/* Rear window */}
      <Path d="M 68,150 L 132,150 L 130,163 L 70,163 Z" fill="url(#glass)" opacity={0.8} />
      <Path d="M 72,151 L 106,151 L 104,158 L 74,158 Z" fill="white" opacity={0.2} />

      {/* Boot/trunk */}
      <Rect x={62} y={163} width={76} height={66} rx={3} fill="url(#navyRoof)" />
      {[0,1,2,3].map(i => (
        <Line key={i} x1={65} y1={172 + i * 14} x2={135} y2={172 + i * 14}
          stroke="#1e3a8a" strokeWidth={0.6} opacity={0.4} />
      ))}

      {/* Rear bumper */}
      <Rect x={62} y={229} width={76} height={11} rx={4} fill="url(#chrome)" />
      {/* Brake lights */}
      <Rect x={62} y={230} width={18} height={9} rx={2} fill="url(#brklt)" />
      <Rect x={120} y={230} width={18} height={9} rx={2} fill="url(#brklt)" />
      <Rect x={84} y={231} width={32} height={7} rx={2} fill="#111827" />

      {/* Side mirrors */}
      <Rect x={44} y={60} width={17} height={7} rx={2.5} fill="#1d4ed8" stroke="#1e3a8a" strokeWidth={0.5} />
      <Rect x={139} y={60} width={17} height={7} rx={2.5} fill="#1d4ed8" stroke="#1e3a8a" strokeWidth={0.5} />
    </G>
  )
}

interface TruckBodyProps { cargoH: number }

function TruckBody({ cargoH }: TruckBodyProps) {
  const cabBottom = 136     // cab ends here
  const cargoTop  = cabBottom
  const cargoBot  = cargoTop + cargoH
  const bumpTop   = cargoBot
  const totalH    = bumpTop + 12

  return (
    <G>
      {/* Ground shadow */}
      <Ellipse cx={100} cy={totalH + 8} rx={56} ry={8} fill="rgba(0,0,0,0.2)" />

      {/* === FRONT BUMPER === */}
      <Rect x={58} y={8} width={84} height={13} rx={4} fill="url(#chrome)" />
      {/* Grill */}
      <Rect x={68} y={10} width={64} height={7} rx={2} fill="#111827" />
      {[0,1,2,3].map(i => (
        <Rect key={i} x={70} y={11 + i * 1.5} width={60} height={1} rx={0.5}
          fill="#475569" opacity={0.8} />
      ))}
      {/* Headlights */}
      <Rect x={58} y={9} width={22} height={11} rx={2} fill="url(#headlt)" />
      <Rect x={120} y={9} width={22} height={11} rx={2} fill="url(#headlt)" />
      {/* Green DRL */}
      <Rect x={60} y={20} width={80} height={2.5} rx={1} fill="#16a34a" opacity={0.8} />

      {/* === HOOD === */}
      <Rect x={60} y={23} width={80} height={42} rx={5} fill="url(#truckHood)" />
      <Line x1={100} y1={25} x2={100} y2={64} stroke="#64748b" strokeWidth={1} opacity={0.5} />
      {[0,1].map(i => (
        <Rect key={i} x={70} y={30 + i * 11} width={60} height={5} rx={2}
          fill="#475569" opacity={0.4} />
      ))}

      {/* === WINDSHIELD === */}
      <Path d="M 63,65 L 137,65 L 133,83 L 67,83 Z" fill="url(#glass)" opacity={0.9} />
      <Path d="M 68,66 L 113,66 L 110,76 L 71,76 Z" fill="white" opacity={0.2} />
      <Line x1={78} y1={81} x2={98} y2={67} stroke="#475569" strokeWidth={0.8} opacity={0.6} />
      <Line x1={122} y1={81} x2={102} y2={67} stroke="#475569" strokeWidth={0.8} opacity={0.6} />

      {/* === CAB === */}
      <Rect x={58} y={83} width={84} height={48} rx={3} fill="url(#truckCab)" />
      {/* Side windows */}
      <Rect x={62} y={86} width={18} height={14} rx={3} fill="url(#glass)" opacity={0.85} />
      <Rect x={120} y={86} width={18} height={14} rx={3} fill="url(#glass)" opacity={0.85} />
      {/* Steering wheel */}
      <Circle cx={80} cy={112} r={9} fill="none" stroke="#0f172a" strokeWidth={2.5} />
      <Circle cx={80} cy={112} r={2.5} fill="#0f172a" />
      <Line x1={80} y1={104} x2={80} y2={120} stroke="#0f172a" strokeWidth={1.2} />
      <Line x1={72} y1={112} x2={88} y2={112} stroke="#0f172a" strokeWidth={1.2} />

      {/* Brand stripe */}
      <Rect x={58} y={127} width={84} height={9} fill="#16a34a" opacity={0.85} />
      <SvgText x={100} y={133} textAnchor="middle" fontSize={4}
        fontWeight="800" fill="white">
        FLEET VEHICLE
      </SvgText>

      {/* === CHASSIS RAILS === */}
      <Rect x={68} y={cabBottom} width={10} height={cargoH} fill="#334155" />
      <Rect x={122} y={cabBottom} width={10} height={cargoH} fill="#334155" />
      {/* Cross members — spaced evenly */}
      {Array.from({ length: Math.floor(cargoH / 38) }).map((_, i) => (
        <Rect key={i} x={68} y={cabBottom + 14 + i * 38} width={64} height={5}
          fill="#475569" />
      ))}

      {/* === CARGO BOX === */}
      <Rect x={58} y={cargoTop} width={84} height={cargoH} rx={3}
        fill="url(#truckCargo)" />
      {/* Side rails */}
      <Rect x={58}  y={cargoTop} width={5} height={cargoH} rx={2} fill="#475569" opacity={0.8} />
      <Rect x={137} y={cargoTop} width={5} height={cargoH} rx={2} fill="#475569" opacity={0.8} />
      {/* Cargo rib lines */}
      {Array.from({ length: Math.floor(cargoH / 20) }).map((_, i) => (
        <Line key={i} x1={60} y1={cargoTop + 12 + i * 20} x2={140} y2={cargoTop + 12 + i * 20}
          stroke="#475569" strokeWidth={0.7} opacity={0.5} />
      ))}

      {/* === REAR BUMPER === */}
      <Rect x={58} y={bumpTop} width={84} height={12} rx={3} fill="url(#chrome)" />
      {/* Brake lights */}
      <Rect x={60}  y={bumpTop + 1} width={22} height={8} rx={2} fill="url(#brklt)" />
      <Rect x={118} y={bumpTop + 1} width={22} height={8} rx={2} fill="url(#brklt)" />
      <Rect x={84}  y={bumpTop + 2} width={32} height={6} rx={2} fill="#111827" />

      {/* Mirrors */}
      <Rect x={38} y={56} width={18} height={9} rx={3} fill="#334155" stroke="#475569" strokeWidth={0.8} />
      <Rect x={144} y={56} width={18} height={9} rx={3} fill="#334155" stroke="#475569" strokeWidth={0.8} />
    </G>
  )
}

function TrailerBody() {
  return (
    <G>
      {/* Ground shadow */}
      <Ellipse cx={100} cy={248} rx={55} ry={7} fill="rgba(0,0,0,0.2)" />

      {/* === KINGPIN AREA === */}
      <Ellipse cx={100} cy={20} rx={16} ry={8} fill="#475569" />
      <Ellipse cx={100} cy={20} rx={8} ry={4} fill="#1e293b" />
      <Circle cx={100} cy={20} r={3} fill="#64748b" />
      {/* Connection bar */}
      <Rect x={90} y={20} width={20} height={4} rx={2} fill="#334155" />

      {/* === CHASSIS === */}
      <Rect x={69} y={24} width={9} height={216} fill="#334155" />
      <Rect x={122} y={24} width={9} height={216} fill="#334155" />

      {/* === BOX BODY === */}
      <Rect x={57} y={28} width={86} height={208} rx={4}
        fill="url(#trailerBox)" />
      {/* Side vents / ribs */}
      {[0,1,2,3,4,5].map(i => (
        <Line key={i} x1={59} y1={46 + i * 30} x2={141} y2={46 + i * 30}
          stroke="#475569" strokeWidth={0.8} opacity={0.5} />
      ))}
      {/* Left side stripe */}
      <Rect x={57}  y={28} width={5} height={208} rx={2} fill="#64748b" opacity={0.6} />
      <Rect x={138} y={28} width={5} height={208} rx={2} fill="#64748b" opacity={0.6} />

      {/* Rear doors */}
      <Line x1={100} y1={30} x2={100} y2={233} stroke="#475569" strokeWidth={1} opacity={0.6} />
      {/* Door handles */}
      <Rect x={88} y={140} width={10} height={3} rx={1.5} fill="url(#chrome)" />
      <Rect x={102} y={140} width={10} height={3} rx={1.5} fill="url(#chrome)" />

      {/* === REAR BUMPER === */}
      <Rect x={57} y={234} width={86} height={11} rx={3} fill="url(#chrome)" />
      <Rect x={59}  y={235} width={22} height={8} rx={2} fill="url(#brklt)" />
      <Rect x={119} y={235} width={22} height={8} rx={2} fill="url(#brklt)" />
      <Rect x={84}  y={236} width={32} height={6} rx={2} fill="#111827" />
    </G>
  )
}

// ── Layout definitions ─────────────────────────────────────────────────────────

interface TyreLayoutItem {
  id: string; x: number; y: number; w: number; h: number
  label: string; horizontal?: boolean
}

interface VehicleLayout {
  viewH: number
  // Body components differ in props (TruckBody needs cargoH; others take none),
  // so the descriptor accepts any body and the matching bodyProps are supplied
  // alongside it below.
  Body: React.ComponentType<any>
  bodyProps?: TruckBodyProps
  tyres: TyreLayoutItem[]
}

const LAYOUTS: Record<string, VehicleLayout> = {
  '4w': {
    viewH: 268,
    Body: FourWheelerBody,
    tyres: [
      { id: 'FL',    x: 33,  y: 22,  w: 22, h: 38, label: 'FL' },
      { id: 'FR',    x: 145, y: 22,  w: 22, h: 38, label: 'FR' },
      { id: 'RL',    x: 33,  y: 190, w: 22, h: 38, label: 'RL' },
      { id: 'RR',    x: 145, y: 190, w: 22, h: 38, label: 'RR' },
      { id: 'Spare', x: 80,  y: 252, w: 40, h: 12, label: 'SP', horizontal: true },
    ],
  },
  '6w': {
    viewH: 305,
    Body: TruckBody,
    bodyProps: { cargoH: 130 },
    tyres: [
      { id: 'FL',    x: 34,  y: 22,  w: 22, h: 37, label: 'FL' },
      { id: 'FR',    x: 144, y: 22,  w: 22, h: 37, label: 'FR' },
      { id: 'RL1',   x: 42,  y: 195, w: 18, h: 33, label: 'RL1' },  // inner
      { id: 'RL2',   x: 22,  y: 195, w: 18, h: 33, label: 'RL2' },  // outer
      { id: 'RR1',   x: 140, y: 195, w: 18, h: 33, label: 'RR1' },  // inner
      { id: 'RR2',   x: 160, y: 195, w: 18, h: 33, label: 'RR2' },  // outer
      { id: 'Spare', x: 80,  y: 293, w: 40, h: 11, label: 'SP', horizontal: true },
    ],
  },
  '8w': {
    viewH: 355,
    Body: TruckBody,
    bodyProps: { cargoH: 178 },
    tyres: [
      { id: 'FL',    x: 34,  y: 22,  w: 22, h: 37, label: 'FL' },
      { id: 'FR',    x: 144, y: 22,  w: 22, h: 37, label: 'FR' },
      { id: 'RL1',   x: 26,  y: 178, w: 20, h: 33, label: 'RL1' },
      { id: 'RR1',   x: 154, y: 178, w: 20, h: 33, label: 'RR1' },
      { id: 'RL2',   x: 26,  y: 217, w: 20, h: 33, label: 'RL2' },
      { id: 'RR2',   x: 154, y: 217, w: 20, h: 33, label: 'RR2' },
      { id: 'RL3',   x: 26,  y: 256, w: 20, h: 33, label: 'RL3' },
      { id: 'RR3',   x: 154, y: 256, w: 20, h: 33, label: 'RR3' },
      { id: 'Spare', x: 80,  y: 343, w: 40, h: 11, label: 'SP', horizontal: true },
    ],
  },
  '10w': {
    viewH: 395,
    Body: TruckBody,
    bodyProps: { cargoH: 218 },
    tyres: [
      { id: 'FL',    x: 34,  y: 22,  w: 22, h: 37, label: 'FL' },
      { id: 'FR',    x: 144, y: 22,  w: 22, h: 37, label: 'FR' },
      { id: 'RL1',   x: 26,  y: 178, w: 20, h: 32, label: 'RL1' },
      { id: 'RR1',   x: 154, y: 178, w: 20, h: 32, label: 'RR1' },
      { id: 'RL2',   x: 26,  y: 215, w: 20, h: 32, label: 'RL2' },
      { id: 'RR2',   x: 154, y: 215, w: 20, h: 32, label: 'RR2' },
      { id: 'RL3',   x: 26,  y: 252, w: 20, h: 32, label: 'RL3' },
      { id: 'RR3',   x: 154, y: 252, w: 20, h: 32, label: 'RR3' },
      { id: 'SL',    x: 26,  y: 289, w: 20, h: 32, label: 'SL' },
      { id: 'SR',    x: 154, y: 289, w: 20, h: 32, label: 'SR' },
    ],
  },
  trailer: {
    viewH: 268,
    Body: TrailerBody,
    tyres: [
      { id: 'AxleL1', x: 26,  y: 108, w: 20, h: 35, label: 'L1' },
      { id: 'AxleR1', x: 154, y: 108, w: 20, h: 35, label: 'R1' },
      { id: 'AxleL2', x: 26,  y: 158, w: 20, h: 35, label: 'L2' },
      { id: 'AxleR2', x: 154, y: 158, w: 20, h: 35, label: 'R2' },
      { id: 'Spare',  x: 80,  y: 252, w: 40, h: 12, label: 'SP', horizontal: true },
    ],
  },
}

// ── Vehicle type resolver ─────────────────────────────────────────────────────
function resolveLayout(vehicleType: string): string {
  const s = (vehicleType ?? '').toLowerCase()
  if (s.includes('10')) return '10w'
  if (s.includes('8'))  return '8w'
  if (s.includes('6'))  return '6w'
  if (s.includes('4'))  return '4w'
  if (s.includes('trailer')) return 'trailer'
  return '6w'
}

// ── Component props ────────────────────────────────────────────────────────────
interface Props {
  vehicleType: string
  positions: string[]
  tyreData: Record<string, TyrePositionData>
  selectedPosition?: string | null
  onPositionPress?: (position: string) => void
  /** SVG render width in px — defaults to 320 */
  width?: number
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function VehicleTyreDiagram({
  vehicleType,
  positions,
  tyreData,
  selectedPosition,
  onPositionPress,
  width = 320,
}: Props) {
  const layoutKey = resolveLayout(vehicleType)
  const layout    = LAYOUTS[layoutKey] ?? LAYOUTS['6w']
  const { viewH, Body, bodyProps, tyres } = layout

  const scale     = width / 200
  const svgHeight = Math.round(viewH * scale)

  // Build risk + "recorded" maps keyed by every tyre id in the layout. We never
  // hide a tyre: positions not yet inspected simply render in the neutral
  // "No Data" colour so the operator can always see and tap the full axle set.
  const posSet = new Set(positions)
  const { riskMap, recordedMap } = useMemo(() => {
    const risk: Record<string, RiskKey> = {}
    const recorded: Record<string, boolean> = {}
    tyres.forEach(t => {
      const d = tyreData[t.id]
      risk[t.id] = d ? CONDITION_RISK[d.condition] : 'none'
      // "Recorded" = the inspector entered something beyond the default state.
      recorded[t.id] = !!d && (
        !!d.serial_number || !!d.pressure_psi || !!d.tread_depth_mm ||
        !!d.notes || !!d.photo_uri || d.condition !== 'Good'
      )
    })
    return { riskMap: risk, recordedMap: recorded }
  }, [tyres, tyreData])

  // Every tyre that belongs to this vehicle is rendered AND tappable.
  const allTyres = tyres.filter(t => posSet.size === 0 || posSet.has(t.id))

  const handlePress = (id: string) => onPositionPress?.(id)

  return (
    <View style={styles.container}>
      {/* SVG diagram */}
      <Svg
        width={width}
        height={svgHeight}
        viewBox={`-10 -6 220 ${viewH + 12}`}
        style={styles.svg}
      >
        <SharedDefs />

        {/* FRONT label */}
        <SvgText x={100} y={-1} textAnchor="middle" fontSize={5.5}
          fill="#94a3b8" fontWeight="600">
          ▲ FRONT
        </SvgText>

        {/* Vehicle body */}
        <Body {...(bodyProps ?? {})} />

        {/* Tyres — visual layer (all positions always shown) */}
        {allTyres.map(t => (
          <Tyre
            key={t.id}
            x={t.x} y={t.y} w={t.w} h={t.h}
            label={t.label}
            horizontal={t.horizontal}
            risk={riskMap[t.id] ?? 'none'}
            recorded={recordedMap[t.id]}
            selected={selectedPosition === t.id}
          />
        ))}

        {/* Touch layer — rendered last so transparent hit targets sit on top of
            every decorative shape and reliably capture taps. */}
        {allTyres.map(t => (
          <HitArea
            key={`hit-${t.id}`}
            id={t.id}
            x={t.x} y={t.y} w={t.w} h={t.h}
            onActivate={handlePress}
          />
        ))}
      </Svg>

      {/* Risk legend */}
      <View style={styles.legend}>
        {(Object.entries(RISK) as [RiskKey, typeof RISK[RiskKey]][]).map(([key, col]) => (
          <View key={key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: col.rim }]} />
            <Text style={styles.legendLabel}>{col.label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 16,
    paddingTop: 12,
    paddingBottom: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  svg: {
    overflow: 'visible',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '500',
  },
})
