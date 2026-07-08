/**
 * VehicleTyreDiagram - Interactive top-down vehicle diagram.
 *
 * Touch approach: absolute-positioned TouchableOpacity overlays sit on top of
 * the SVG. This is far more reliable than touch handlers inside SVG elements,
 * which are frequently swallowed by the outer ScrollView on Android.
 */

import React, { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Svg, {
  G, Rect, Ellipse, Circle, Line, Path,
  Text as SvgText, Defs, RadialGradient, LinearGradient, Stop,
} from 'react-native-svg'
import type { TyreCondition, TyrePositionData } from '../lib/types'
import { CONDITION_META } from '../lib/tyreConditions'

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
        <Stop offset="0%"   stopColor="#64748b" />
        <Stop offset="40%"  stopColor="#334155" />
        <Stop offset="100%" stopColor="#1e293b" />
      </RadialGradient>
      <LinearGradient id="truckHood" x1="0%" y1="0%" x2="100%" y2="0%">
        <Stop offset="0%"   stopColor="#1e293b" />
        <Stop offset="50%"  stopColor="#475569" />
        <Stop offset="100%" stopColor="#1e293b" />
      </LinearGradient>
      <LinearGradient id="truckCargo" x1="0%" y1="0%" x2="100%" y2="100%">
        <Stop offset="0%"   stopColor="#334155" />
        <Stop offset="100%" stopColor="#0f172a" />
      </LinearGradient>
      <LinearGradient id="trailerBox" x1="0%" y1="0%" x2="0%" y2="100%">
        <Stop offset="0%"   stopColor="#475569" />
        <Stop offset="100%" stopColor="#1e293b" />
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
          fontSize={Math.max(4, Math.min(h * 0.9, 7))} fontWeight="800" fill="white">
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
        fontSize={Math.max(3.5, Math.min(w * 0.50, 8))} fontWeight="800" fill="white">
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

// ── Vehicle body components ────────────────────────────────────────────────────
function FourWheelerBody() {
  return (
    <G>
      <Ellipse cx={100} cy={245} rx={52} ry={7} fill="rgba(0,0,0,0.2)" />
      <Rect x={62} y={10} width={76} height={11} rx={4} fill="url(#chrome)" />
      <Rect x={62} y={11} width={17} height={9} rx={2} fill="url(#headlt)" />
      <Rect x={121} y={11} width={17} height={9} rx={2} fill="url(#headlt)" />
      <Rect x={63} y={20} width={74} height={2} rx={1} fill="#fbbf24" opacity={0.8} />
      <Rect x={62} y={22} width={76} height={44} rx={8} fill="url(#navyHood)" />
      <Line x1={100} y1={24} x2={100} y2={64} stroke="#93c5fd" strokeWidth={0.8} opacity={0.5} />
      <Path d="M 67,66 L 133,66 L 129,82 L 71,82 Z" fill="url(#glass)" opacity={0.9} />
      <Path d="M 71,67 L 115,67 L 112,76 L 73,76 Z" fill="white" opacity={0.25} />
      <Line x1={80} y1={80} x2={99} y2={68} stroke="#475569" strokeWidth={0.8} opacity={0.7} />
      <Line x1={120} y1={80} x2={101} y2={68} stroke="#475569" strokeWidth={0.8} opacity={0.7} />
      <Rect x={62} y={82} width={76} height={68} rx={3} fill="url(#navyRoof)" />
      <Path d="M 62,82 L 67,66" stroke="#1e3a8a" strokeWidth={3} strokeLinecap="round" />
      <Path d="M 138,82 L 133,66" stroke="#1e3a8a" strokeWidth={3} strokeLinecap="round" />
      <Rect x={75} y={86} width={50} height={4} rx={2} fill="#60a5fa" opacity={0.35} />
      <Line x1={100} y1={84} x2={100} y2={148} stroke="#1e3a8a" strokeWidth={1.2} opacity={0.7} />
      <Rect x={83} y={118} width={11} height={3} rx={1.5} fill="url(#chrome)" />
      <Rect x={106} y={118} width={11} height={3} rx={1.5} fill="url(#chrome)" />
      <Ellipse cx={79} cy={99} rx={9} ry={7} fill="#1e3a8a" stroke="#1d4ed8" strokeWidth={0.5} />
      <Ellipse cx={121} cy={99} rx={9} ry={7} fill="#1e3a8a" stroke="#1d4ed8" strokeWidth={0.5} />
      <Path d="M 68,150 L 132,150 L 130,163 L 70,163 Z" fill="url(#glass)" opacity={0.8} />
      <Rect x={62} y={163} width={76} height={66} rx={3} fill="url(#navyRoof)" />
      {[0,1,2,3].map(i => (
        <Line key={i} x1={65} y1={172 + i * 14} x2={135} y2={172 + i * 14}
          stroke="#1e3a8a" strokeWidth={0.6} opacity={0.4} />
      ))}
      <Rect x={62} y={229} width={76} height={11} rx={4} fill="url(#chrome)" />
      <Rect x={62} y={230} width={18} height={9} rx={2} fill="url(#brklt)" />
      <Rect x={120} y={230} width={18} height={9} rx={2} fill="url(#brklt)" />
      <Rect x={84} y={231} width={32} height={7} rx={2} fill="#111827" />
      <Rect x={44} y={60} width={17} height={7} rx={2.5} fill="#1d4ed8" stroke="#1e3a8a" strokeWidth={0.5} />
      <Rect x={139} y={60} width={17} height={7} rx={2.5} fill="#1d4ed8" stroke="#1e3a8a" strokeWidth={0.5} />
    </G>
  )
}

interface TruckBodyProps { cargoH: number }
function TruckBody({ cargoH }: TruckBodyProps) {
  const cabBottom = 136
  const cargoTop  = cabBottom
  const cargoBot  = cargoTop + cargoH
  const bumpTop   = cargoBot
  return (
    <G>
      <Ellipse cx={100} cy={bumpTop + 20} rx={56} ry={8} fill="rgba(0,0,0,0.2)" />
      <Rect x={58} y={8} width={84} height={13} rx={4} fill="url(#chrome)" />
      <Rect x={68} y={10} width={64} height={7} rx={2} fill="#111827" />
      {[0,1,2,3].map(i => (
        <Rect key={i} x={70} y={11 + i * 1.5} width={60} height={1} rx={0.5} fill="#475569" opacity={0.8} />
      ))}
      <Rect x={58} y={9} width={22} height={11} rx={2} fill="url(#headlt)" />
      <Rect x={120} y={9} width={22} height={11} rx={2} fill="url(#headlt)" />
      <Rect x={60} y={20} width={80} height={2.5} rx={1} fill="#16a34a" opacity={0.8} />
      <Rect x={60} y={23} width={80} height={42} rx={5} fill="url(#truckHood)" />
      <Line x1={100} y1={25} x2={100} y2={64} stroke="#64748b" strokeWidth={1} opacity={0.5} />
      <Path d="M 63,65 L 137,65 L 133,83 L 67,83 Z" fill="url(#glass)" opacity={0.9} />
      <Path d="M 68,66 L 113,66 L 110,76 L 71,76 Z" fill="white" opacity={0.2} />
      <Line x1={78} y1={81} x2={98} y2={67} stroke="#475569" strokeWidth={0.8} opacity={0.6} />
      <Line x1={122} y1={81} x2={102} y2={67} stroke="#475569" strokeWidth={0.8} opacity={0.6} />
      <Rect x={58} y={83} width={84} height={48} rx={3} fill="url(#truckCab)" />
      <Rect x={62} y={86} width={18} height={14} rx={3} fill="url(#glass)" opacity={0.85} />
      <Rect x={120} y={86} width={18} height={14} rx={3} fill="url(#glass)" opacity={0.85} />
      <Circle cx={80} cy={112} r={9} fill="none" stroke="#0f172a" strokeWidth={2.5} />
      <Circle cx={80} cy={112} r={2.5} fill="#0f172a" />
      <Line x1={80} y1={104} x2={80} y2={120} stroke="#0f172a" strokeWidth={1.2} />
      <Line x1={72} y1={112} x2={88} y2={112} stroke="#0f172a" strokeWidth={1.2} />
      <Rect x={58} y={127} width={84} height={9} fill="#16a34a" opacity={0.85} />
      <SvgText x={100} y={133} textAnchor="middle" fontSize={4} fontWeight="800" fill="white">FLEET VEHICLE</SvgText>
      <Rect x={68} y={cabBottom} width={10} height={cargoH} fill="#334155" />
      <Rect x={122} y={cabBottom} width={10} height={cargoH} fill="#334155" />
      <Rect x={58} y={cargoTop} width={84} height={cargoH} rx={3} fill="url(#truckCargo)" />
      <Rect x={58}  y={cargoTop} width={5} height={cargoH} rx={2} fill="#475569" opacity={0.8} />
      <Rect x={137} y={cargoTop} width={5} height={cargoH} rx={2} fill="#475569" opacity={0.8} />
      {Array.from({ length: Math.floor(cargoH / 20) }).map((_, i) => (
        <Line key={i} x1={60} y1={cargoTop + 12 + i * 20} x2={140} y2={cargoTop + 12 + i * 20}
          stroke="#475569" strokeWidth={0.7} opacity={0.5} />
      ))}
      <Rect x={58} y={bumpTop} width={84} height={12} rx={3} fill="url(#chrome)" />
      <Rect x={60}  y={bumpTop + 1} width={22} height={8} rx={2} fill="url(#brklt)" />
      <Rect x={118} y={bumpTop + 1} width={22} height={8} rx={2} fill="url(#brklt)" />
      <Rect x={84}  y={bumpTop + 2} width={32} height={6} rx={2} fill="#111827" />
      <Rect x={38} y={56} width={18} height={9} rx={3} fill="#334155" stroke="#475569" strokeWidth={0.8} />
      <Rect x={144} y={56} width={18} height={9} rx={3} fill="#334155" stroke="#475569" strokeWidth={0.8} />
    </G>
  )
}

function TrailerBody() {
  return (
    <G>
      <Ellipse cx={100} cy={248} rx={55} ry={7} fill="rgba(0,0,0,0.2)" />
      <Ellipse cx={100} cy={20} rx={16} ry={8} fill="#475569" />
      <Ellipse cx={100} cy={20} rx={8} ry={4} fill="#1e293b" />
      <Circle cx={100} cy={20} r={3} fill="#64748b" />
      <Rect x={90} y={20} width={20} height={4} rx={2} fill="#334155" />
      <Rect x={69} y={24} width={9} height={216} fill="#334155" />
      <Rect x={122} y={24} width={9} height={216} fill="#334155" />
      <Rect x={57} y={28} width={86} height={208} rx={4} fill="url(#trailerBox)" />
      {[0,1,2,3,4,5].map(i => (
        <Line key={i} x1={59} y1={46 + i * 30} x2={141} y2={46 + i * 30}
          stroke="#475569" strokeWidth={0.8} opacity={0.5} />
      ))}
      <Rect x={57}  y={28} width={5} height={208} rx={2} fill="#64748b" opacity={0.6} />
      <Rect x={138} y={28} width={5} height={208} rx={2} fill="#64748b" opacity={0.6} />
      <Line x1={100} y1={30} x2={100} y2={233} stroke="#475569" strokeWidth={1} opacity={0.6} />
      <Rect x={88} y={140} width={10} height={3} rx={1.5} fill="url(#chrome)" />
      <Rect x={102} y={140} width={10} height={3} rx={1.5} fill="url(#chrome)" />
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
      { id: 'FL',  x: 34,  y: 22,  w: 22, h: 37, label: 'FL' },
      { id: 'FR',  x: 144, y: 22,  w: 22, h: 37, label: 'FR' },
      { id: 'RL1', x: 42,  y: 195, w: 18, h: 33, label: 'RL1' },
      { id: 'RL2', x: 22,  y: 195, w: 18, h: 33, label: 'RL2' },
      { id: 'RR1', x: 140, y: 195, w: 18, h: 33, label: 'RR1' },
      { id: 'RR2', x: 160, y: 195, w: 18, h: 33, label: 'RR2' },
      { id: 'Spare', x: 80, y: 293, w: 40, h: 11, label: 'SP', horizontal: true },
    ],
  },
  '8w': {
    viewH: 355,
    Body: TruckBody,
    bodyProps: { cargoH: 178 },
    tyres: [
      { id: 'FL',  x: 34,  y: 22,  w: 22, h: 37, label: 'FL' },
      { id: 'FR',  x: 144, y: 22,  w: 22, h: 37, label: 'FR' },
      { id: 'RL1', x: 26,  y: 178, w: 20, h: 33, label: 'RL1' },
      { id: 'RR1', x: 154, y: 178, w: 20, h: 33, label: 'RR1' },
      { id: 'RL2', x: 26,  y: 217, w: 20, h: 33, label: 'RL2' },
      { id: 'RR2', x: 154, y: 217, w: 20, h: 33, label: 'RR2' },
      { id: 'RL3', x: 26,  y: 256, w: 20, h: 33, label: 'RL3' },
      { id: 'RR3', x: 154, y: 256, w: 20, h: 33, label: 'RR3' },
      { id: 'Spare', x: 80, y: 343, w: 40, h: 11, label: 'SP', horizontal: true },
    ],
  },
  '10w': {
    viewH: 395,
    Body: TruckBody,
    bodyProps: { cargoH: 218 },
    tyres: [
      { id: 'FL',  x: 34,  y: 22,  w: 22, h: 37, label: 'FL' },
      { id: 'FR',  x: 144, y: 22,  w: 22, h: 37, label: 'FR' },
      { id: 'RL1', x: 26,  y: 178, w: 20, h: 32, label: 'RL1' },
      { id: 'RR1', x: 154, y: 178, w: 20, h: 32, label: 'RR1' },
      { id: 'RL2', x: 26,  y: 215, w: 20, h: 32, label: 'RL2' },
      { id: 'RR2', x: 154, y: 215, w: 20, h: 32, label: 'RR2' },
      { id: 'RL3', x: 26,  y: 252, w: 20, h: 32, label: 'RL3' },
      { id: 'RR3', x: 154, y: 252, w: 20, h: 32, label: 'RR3' },
      { id: 'SL',  x: 26,  y: 289, w: 20, h: 32, label: 'SL' },
      { id: 'SR',  x: 154, y: 289, w: 20, h: 32, label: 'SR' },
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

function resolveLayout(vehicleType: string): string {
  const s = (vehicleType ?? '').toLowerCase()
  if (s.includes('10'))      return '10w'
  if (s.includes('8'))       return '8w'
  if (s.includes('6'))       return '6w'
  if (s.includes('4'))       return '4w'
  if (s.includes('trailer')) return 'trailer'
  return '6w'
}

// Stationary / non-wheeled equipment (generator, chiller, ice/batch plant,
// reclaimer …) has NO tyres — show a clear state instead of a fake layout.
const NO_TYRE_EQUIPMENT = ['generator', 'genset', 'chiller', 'ice plant', 'ice-plant', 'bt-plant', 'bt plant', 'batch', 'reclaimer', 'compressor', 'tower light', 'light tower']
export function isTyrelessEquipment(vehicleType?: string | null): boolean {
  if (!vehicleType) return false
  const s = String(vehicleType).toLowerCase().trim()
  return NO_TYRE_EQUIPMENT.some(k => s.includes(k))
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
  const layoutKey = resolveLayout(vehicleType)
  const layout    = LAYOUTS[layoutKey] ?? LAYOUTS['6w']
  const { viewH, Body, bodyProps, tyres } = layout

  // SVG coordinate space is 220 units wide; scale to requested pixel width.
  // The viewBox has a -10 left margin so we add 20 to the coordinate width.
  const SVG_COORD_W = 220
  const scale       = width / SVG_COORD_W
  const svgHeight   = Math.round(viewH * scale)

  const posSet = new Set(positions)
  const { riskMap, recordedMap, conditionMap } = useMemo(() => {
    const risk: Record<string, RiskKey>     = {}
    const recorded: Record<string, boolean> = {}
    const cond: Record<string, TyreCondition> = {}
    tyres.forEach(t => {
      const d = tyreData[t.id]
      risk[t.id]     = d ? CONDITION_RISK[d.condition] : 'none'
      cond[t.id]     = d?.condition ?? 'Good'
      recorded[t.id] = !!d && (
        !!d.serial_number || !!d.pressure_psi || !!d.tread_depth_mm ||
        !!d.notes || !!d.photo_uri || d.condition !== 'Good'
      )
    })
    return { riskMap: risk, recordedMap: recorded, conditionMap: cond }
  }, [tyres, tyreData])

  const allTyres = tyres.filter(t => posSet.size === 0 || posSet.has(t.id))

  // Convert SVG coordinate space → screen pixels for the overlay touch targets.
  // SVG viewBox: x from -10 to 210 (220 units), y from -6 to viewH+6
  // Pixel mapping: screenX = (svgX + 10) * scale
  //                screenY = (svgY + 6)  * scale
  function toScreen(svgX: number, svgY: number, svgW: number, svgH: number) {
    const pad = 10  // generous finger padding in SVG units
    return {
      left:   (svgX - pad + 10) * scale,
      top:    (svgY - pad +  6) * scale,
      width:  (svgW + pad * 2)  * scale,
      height: (svgH + pad * 2)  * scale,
    }
  }

  // Equipment without tyres → clear state instead of a fake 6-wheeler.
  if (isTyrelessEquipment(vehicleType)) {
    return (
      <View style={[styles.container, { paddingVertical: 28, alignItems: 'center' }]}>
        <Text style={{ fontSize: 30 }}>🏭</Text>
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a', marginTop: 6 }}>{vehicleType || 'Equipment'}</Text>
        <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2, textAlign: 'center' }}>
          Stationary equipment — no tyres to inspect.
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* FRONT label */}
      <Text style={styles.frontLabel}>▲ FRONT</Text>

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
          <Body {...(bodyProps ?? {})} />
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
        </Svg>

        {/* Absolute touch overlays - one per tyre, on top of the SVG */}
        {allTyres.map(t => {
          const pos = toScreen(t.x, t.y, t.w, t.h)
          const isSelected = selectedPosition === t.id
          const cond = conditionMap[t.id]
          const meta = cond ? CONDITION_META[cond] : null
          return (
            <TouchableOpacity
              key={`hit-${t.id}`}
              style={[styles.hitOverlay, pos, isSelected && styles.hitOverlaySelected]}
              onPress={() => onPositionPress?.(t.id)}
              activeOpacity={0.6}
            >
              {/* Show emoji badge in top-right corner when recorded */}
              {recordedMap[t.id] && meta && (
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
            <View key={c} style={styles.legendItem}>
              <Text style={styles.legendEmoji}>{m.emoji}</Text>
              <Text style={[styles.legendLabel, { color: m.color }]}>{c}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 18,
    paddingTop: 8,
    paddingBottom: 14,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 10,
  },
  frontLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  svg: { overflow: 'visible' },
  hitOverlay: {
    position: 'absolute',
    borderRadius: 8,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  hitOverlaySelected: {
    borderWidth: 2.5,
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59,130,246,0.08)',
  },
  condBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#0f172a',
  },
  condBadgeEmoji: { fontSize: 9 },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendEmoji: { fontSize: 14 },
  legendLabel: { fontSize: 10, fontWeight: '700' },
})
