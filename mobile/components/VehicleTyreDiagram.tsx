/**
 * VehicleTyreDiagram - Interactive top-down vehicle diagram.
 *
 * FAITHFUL port of the WEB diagram (src/components/VehicleTyreDiagram.jsx): the
 * same per-vehicle-type SVG bodies, the same realistic 3D tyre, and the same
 * per-type tyre coordinates (from lib/tyreDiagramLayouts.ts). Every rect / path /
 * ellipse / gradient / colour matches the web original 1:1.
 *
 * Two RN-specific adaptations only:
 *   1. Touch: the SVG is rendered with pointerEvents="none" and one absolutely
 *      positioned TouchableOpacity overlay sits on top of each tyre. Touch
 *      handlers inside SVG elements are frequently swallowed by the outer
 *      ScrollView on Android, so overlays are the reliable approach.
 *   2. SVG drop-shadow filters are omitted (react-native-svg filter support is
 *      unreliable on Android); each body already draws its own ground-shadow
 *      ellipse, so the visual is preserved.
 */

import React, { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Svg, {
  G, Rect, Circle, Ellipse, Line, Path,
  Text as SvgText, Defs, RadialGradient, LinearGradient, Stop,
} from 'react-native-svg'
import type { TyreCondition, TyrePositionData } from '../lib/types'
import { CONDITION_META } from '../lib/tyreConditions'
import { useTheme } from '../contexts/ThemeContext'
import { radius, spacing, typography, elevation, Theme } from '../lib/theme'
import {
  RISK, RiskKey, BodyKey, LAYOUTS,
  resolveVehicleType, isTyrelessEquipment, diagramPositions,
  matchPositionsToLayout,
} from '../lib/tyreDiagramLayouts'

// Re-export the pure helpers so callers can source positions/tyreless-state
// from the same layout the diagram renders.
export { diagramPositions, isTyrelessEquipment } from '../lib/tyreDiagramLayouts'

// ── Condition -> risk mapping ───────────────────────────────────────────────────
const CONDITION_RISK: Record<TyreCondition, RiskKey> = {
  Good:     'good',
  Worn:     'warning',
  Damaged:  'critical',
  Puncture: 'critical',
  Flat:     'warning',
  Missing:  'none',
}

// ── Shared SVG defs (gradients ported verbatim from the web SharedDefs) ──────────
function SharedDefs() {
  return (
    <Defs>
      {/* Glass reflection */}
      <LinearGradient id="glassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <Stop offset="0%"   stopColor="#dbeafe" stopOpacity="0.95" />
        <Stop offset="40%"  stopColor="#93c5fd" stopOpacity="0.85" />
        <Stop offset="100%" stopColor="#3b82f6" stopOpacity="0.6" />
      </LinearGradient>
      <LinearGradient id="glassReflect" x1="0%" y1="0%" x2="60%" y2="60%">
        <Stop offset="0%"   stopColor="white" stopOpacity="0.5" />
        <Stop offset="100%" stopColor="white" stopOpacity="0" />
      </LinearGradient>
      {/* Chrome */}
      <LinearGradient id="chrome" x1="0%" y1="0%" x2="0%" y2="100%">
        <Stop offset="0%"   stopColor="#f1f5f9" />
        <Stop offset="40%"  stopColor="#94a3b8" />
        <Stop offset="100%" stopColor="#475569" />
      </LinearGradient>
      {/* Headlight yellow */}
      <RadialGradient id="headlight" cx="50%" cy="50%" r="50%">
        <Stop offset="0%"   stopColor="#fffde7" />
        <Stop offset="60%"  stopColor="#fef08a" />
        <Stop offset="100%" stopColor="#fbbf24" stopOpacity="0.6" />
      </RadialGradient>
      {/* Brake light red */}
      <RadialGradient id="brakeLight" cx="50%" cy="50%" r="50%">
        <Stop offset="0%"   stopColor="#fee2e2" />
        <Stop offset="60%"  stopColor="#fca5a5" />
        <Stop offset="100%" stopColor="#ef4444" stopOpacity="0.7" />
      </RadialGradient>
    </Defs>
  )
}

// ── Realistic 3D Tyre (no touch handlers - overlays handle touches) ─────────────
interface TyreProps {
  x: number; y: number; w: number; h: number
  id: string; risk: RiskKey; label: string
  selected: boolean; recorded?: boolean
}

function Tyre({ x, y, w, h, id, risk, label, selected, recorded }: TyreProps) {
  const col = RISK[risk]
  const cx  = x + w / 2
  const cy  = y + h / 2
  const uid = `tyre-${id}`

  const r1 = Math.min(w, h) * 0.12
  const r2 = Math.min(w, h) * 0.3
  const spokes = [0, 60, 120]

  return (
    <G>
      <Defs>
        {/* Rubber gradient - dark edges, slight sheen */}
        <RadialGradient id={`${uid}-rubber`} cx="35%" cy="30%" r="65%">
          <Stop offset="0%"   stopColor="#2d2d2d" />
          <Stop offset="70%"  stopColor="#111111" />
          <Stop offset="100%" stopColor="#0a0a0a" />
        </RadialGradient>
        {/* Rim gradient - metallic 3D */}
        <RadialGradient id={`${uid}-rim`} cx="35%" cy="30%" r="65%">
          <Stop offset="0%"   stopColor={col.rim} stopOpacity="1" />
          <Stop offset="60%"  stopColor={col.glow} />
          <Stop offset="100%" stopColor={col.dark} />
        </RadialGradient>
        {/* Hub cap shine */}
        <RadialGradient id={`${uid}-hub`} cx="30%" cy="30%" r="70%">
          <Stop offset="0%"   stopColor="#9ca3af" />
          <Stop offset="100%" stopColor="#1f2937" />
        </RadialGradient>
      </Defs>

      {/* Drop shadow */}
      <Ellipse cx={cx + 1.5} cy={cy + 2} rx={w / 2 + 1} ry={h / 2 + 0.5} fill="rgba(0,0,0,0.45)" />

      {/* Rubber body */}
      <Rect x={x} y={y} width={w} height={h} rx={w * 0.28}
        fill={`url(#${uid}-rubber)`} stroke="#000" strokeWidth={0.6} />

      {/* Tread blocks */}
      {[0.2, 0.38, 0.56, 0.74].map((pct, i) => (
        <Rect key={i} x={x + 1.5} y={y + h * pct} width={w - 3} height={h * 0.1}
          rx={0.8} fill="#222" opacity={0.7} />
      ))}

      {/* Tyre sidewall highlight */}
      <Rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx={w * 0.26}
        fill="none" stroke="#555" strokeWidth={0.4} opacity={0.5} />

      {/* Rim disc */}
      <Ellipse cx={cx} cy={cy} rx={w * 0.33} ry={h * 0.33} fill={`url(#${uid}-rim)`} />

      {/* Rim ring border */}
      <Ellipse cx={cx} cy={cy} rx={w * 0.33} ry={h * 0.33}
        fill="none" stroke={col.dark} strokeWidth={0.6} />

      {/* Spoke lines */}
      {spokes.map((angle, i) => {
        const rad = (angle * Math.PI) / 180
        return (
          <Line key={i}
            x1={cx + Math.cos(rad) * r1} y1={cy + Math.sin(rad) * r1 * (h / w)}
            x2={cx + Math.cos(rad) * r2} y2={cy + Math.sin(rad) * r2 * (h / w)}
            stroke={col.dark} strokeWidth={0.8} opacity={0.7}
          />
        )
      })}
      {spokes.map((angle, i) => {
        const rad = ((angle + 180) * Math.PI) / 180
        return (
          <Line key={i + 3}
            x1={cx + Math.cos(rad) * r1} y1={cy + Math.sin(rad) * r1 * (h / w)}
            x2={cx + Math.cos(rad) * r2} y2={cy + Math.sin(rad) * r2 * (h / w)}
            stroke={col.dark} strokeWidth={0.8} opacity={0.7}
          />
        )
      })}

      {/* Hub cap */}
      <Ellipse cx={cx} cy={cy} rx={w * 0.13} ry={h * 0.13}
        fill={`url(#${uid}-hub)`} stroke="#374151" strokeWidth={0.4} />

      {/* Label */}
      <SvgText x={cx} y={cy + 0.4} textAnchor="middle"
        fontSize={Math.max(3.5, Math.min(w * 0.5, 8))} fontWeight="800" fill="white">
        {label}
      </SvgText>

      {/* Recorded badge (RN addition) */}
      {recorded && !selected && (
        <Circle cx={x + w} cy={y} r={Math.max(2.5, w * 0.16)} fill="#16a34a" stroke="#fff" strokeWidth={0.5} />
      )}

      {/* Selected ring (RN addition) */}
      {selected && (
        <Rect x={x - 3} y={y - 3} width={w + 6} height={h + 6}
          rx={w * 0.3 + 1} fill="none" stroke="#3b82f6" strokeWidth={2.5} />
      )}
    </G>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// VEHICLE BODIES (ported verbatim from the web Body components)
// ═════════════════════════════════════════════════════════════════════════════

// ── 1. PICKUP - dark navy blue metallic ─────────────────────────────────────────
function PickupBody() {
  return (
    <G>
      <Defs>
        <RadialGradient id="pkRoof" cx="48%" cy="40%" r="60%">
          <Stop offset="0%"   stopColor="#93c5fd" />
          <Stop offset="35%"  stopColor="#3b82f6" />
          <Stop offset="70%"  stopColor="#1d4ed8" />
          <Stop offset="100%" stopColor="#1e3a8a" />
        </RadialGradient>
        <LinearGradient id="pkHood" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#1e3a8a" />
          <Stop offset="30%"  stopColor="#2563eb" />
          <Stop offset="50%"  stopColor="#60a5fa" />
          <Stop offset="70%"  stopColor="#2563eb" />
          <Stop offset="100%" stopColor="#1e3a8a" />
        </LinearGradient>
        <LinearGradient id="pkBed" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%"   stopColor="#1e3a8a" />
          <Stop offset="50%"  stopColor="#1d4ed8" />
          <Stop offset="100%" stopColor="#1e3a8a" />
        </LinearGradient>
        <RadialGradient id="pkCab" cx="50%" cy="50%" r="55%">
          <Stop offset="0%"   stopColor="#3b82f6" />
          <Stop offset="100%" stopColor="#1e3a8a" />
        </RadialGradient>
      </Defs>

      {/* Ground shadow */}
      <Ellipse cx={100} cy={305} rx={78} ry={10} fill="rgba(0,0,0,0.3)" />

      {/* Side body panels - dark trim line */}
      <Path d="M 60,70 L 60,275 Q 60,283 72,285 L 128,285 Q 140,283 140,275 L 140,70"
        fill="none" stroke="#1e3a8a" strokeWidth={1} />

      {/* Main body */}
      <Path d="M 72,22 Q 60,22 58,36 L 56,70 L 56,275 Q 56,286 72,288 L 128,288 Q 144,286 144,275 L 144,70 L 142,36 Q 140,22 128,22 Z"
        fill="url(#pkRoof)" />

      {/* Hood */}
      <Rect x={60} y={22} width={80} height={52} rx={5} fill="url(#pkHood)" />
      <Line x1={100} y1={25} x2={100} y2={73} stroke="#93c5fd" strokeWidth={0.8} opacity={0.6} />
      <Line x1={72} y1={25} x2={72} y2={73} stroke="#1e3a8a" strokeWidth={0.6} opacity={0.5} />
      <Line x1={128} y1={25} x2={128} y2={73} stroke="#1e3a8a" strokeWidth={0.6} opacity={0.5} />

      {/* Front bumper */}
      <Rect x={60} y={12} width={80} height={13} rx={4} fill="url(#chrome)" />
      <Rect x={72} y={15} width={56} height={7} rx={2} fill="#111827" />
      {[0, 1, 2, 3, 4].map(i => (
        <Line key={i} x1={79 + i * 11} y1={15} x2={79 + i * 11} y2={22}
          stroke="#374151" strokeWidth={0.8} />
      ))}

      {/* Headlights */}
      <Rect x={60} y={13} width={22} height={10} rx={3} fill="url(#headlight)" />
      <Rect x={118} y={13} width={22} height={10} rx={3} fill="url(#headlight)" />
      {/* DRL strip */}
      <Rect x={61} y={22} width={80} height={2.5} rx={1} fill="#fbbf24" opacity={0.8} />

      {/* Windshield */}
      <Path d="M 65,74 L 135,74 L 131,96 L 69,96 Z" fill="url(#glassGrad)" />
      <Path d="M 70,75 L 115,75 L 112,85 L 72,85 Z" fill="url(#glassReflect)" opacity={0.6} />
      <Line x1={80} y1={94} x2={100} y2={78} stroke="#374151" strokeWidth={0.8} opacity={0.7} />
      <Line x1={120} y1={94} x2={100} y2={78} stroke="#374151" strokeWidth={0.8} opacity={0.7} />

      {/* Cab roof */}
      <Rect x={60} y={96} width={80} height={64} rx={3} fill="url(#pkCab)" />
      <Path d="M 60,96 L 65,74" stroke="#1e3a8a" strokeWidth={3} strokeLinecap="round" />
      <Path d="M 140,96 L 135,74" stroke="#1e3a8a" strokeWidth={3} strokeLinecap="round" />
      <Rect x={73} y={100} width={54} height={4} rx={2} fill="#60a5fa" opacity={0.4} />
      <Line x1={100} y1={98} x2={100} y2={158} stroke="#1e3a8a" strokeWidth={1.2} opacity={0.8} />
      <Rect x={84} y={128} width={10} height={3} rx={1.5} fill="url(#chrome)" />
      <Rect x={106} y={128} width={10} height={3} rx={1.5} fill="url(#chrome)" />
      <Ellipse cx={80} cy={110} rx={10} ry={7} fill="#1e3a8a" stroke="#1d4ed8" strokeWidth={0.5} />
      <Ellipse cx={120} cy={110} rx={10} ry={7} fill="#1e3a8a" stroke="#1d4ed8" strokeWidth={0.5} />
      <Circle cx={83} cy={135} r={8} fill="none" stroke="#0f172a" strokeWidth={2.5} />
      <Circle cx={83} cy={135} r={2.5} fill="#0f172a" />
      <Line x1={83} y1={128} x2={83} y2={142} stroke="#0f172a" strokeWidth={1.2} />
      <Line x1={76} y1={135} x2={90} y2={135} stroke="#0f172a" strokeWidth={1.2} />

      {/* Rear window */}
      <Path d="M 68,158 L 132,158 L 130,169 L 70,169 Z" fill="url(#glassGrad)" opacity={0.85} />
      <Path d="M 72,159 L 105,159 L 103,165 L 74,165 Z" fill="url(#glassReflect)" opacity={0.5} />
      <Path d="M 60,160 L 60,165" stroke="#1e3a8a" strokeWidth={3} strokeLinecap="round" />
      <Path d="M 140,160 L 140,165" stroke="#1e3a8a" strokeWidth={3} strokeLinecap="round" />

      {/* Pickup bed */}
      <Rect x={60} y={172} width={80} height={108} rx={3} fill="url(#pkBed)" />
      {[0, 1, 2, 3, 4, 5].map(i => (
        <Line key={i} x1={63} y1={180 + i * 16} x2={137} y2={180 + i * 16}
          stroke="#1e3a8a" strokeWidth={0.7} opacity={0.5} />
      ))}
      <Rect x={60} y={172} width={5} height={108} fill="#1d4ed8" opacity={0.9} />
      <Rect x={135} y={172} width={5} height={108} fill="#1d4ed8" opacity={0.9} />
      <Rect x={65} y={173} width={70} height={18} rx={2} fill="#1e40af" />
      <Line x1={100} y1={173} x2={100} y2={191} stroke="#3b82f6" strokeWidth={0.8} opacity={0.6} />

      {/* Rear bumper */}
      <Rect x={60} y={281} width={80} height={12} rx={4} fill="url(#chrome)" />
      <Rect x={62} y={282} width={20} height={8} rx={2} fill="url(#brakeLight)" />
      <Rect x={118} y={282} width={20} height={8} rx={2} fill="url(#brakeLight)" />
      <Rect x={86} y={283} width={28} height={6} rx={2} fill="#111827" />

      {/* Side mirrors */}
      <Rect x={42} y={65} width={15} height={7} rx={2.5} fill="#1d4ed8" stroke="#1e3a8a" strokeWidth={0.5} />
      <Rect x={143} y={65} width={15} height={7} rx={2.5} fill="#1d4ed8" stroke="#1e3a8a" strokeWidth={0.5} />
      <Line x1={57} y1={68.5} x2={60} y2={70} stroke="#1e3a8a" strokeWidth={1.5} />
      <Line x1={143} y1={68.5} x2={140} y2={70} stroke="#1e3a8a" strokeWidth={1.5} />
    </G>
  )
}

// ── 2. CANTER - white commercial truck with orange stripe ───────────────────────
function CanterBody() {
  return (
    <G>
      <Defs>
        <RadialGradient id="ctBody" cx="48%" cy="35%" r="62%">
          <Stop offset="0%"   stopColor="#f8fafc" />
          <Stop offset="50%"  stopColor="#e2e8f0" />
          <Stop offset="100%" stopColor="#94a3b8" />
        </RadialGradient>
        <LinearGradient id="ctHood" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#94a3b8" />
          <Stop offset="30%"  stopColor="#e2e8f0" />
          <Stop offset="50%"  stopColor="#f8fafc" />
          <Stop offset="70%"  stopColor="#e2e8f0" />
          <Stop offset="100%" stopColor="#94a3b8" />
        </LinearGradient>
        <LinearGradient id="ctCargo" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#cbd5e1" />
          <Stop offset="15%"  stopColor="#f1f5f9" />
          <Stop offset="50%"  stopColor="#f8fafc" />
          <Stop offset="85%"  stopColor="#f1f5f9" />
          <Stop offset="100%" stopColor="#cbd5e1" />
        </LinearGradient>
        <LinearGradient id="ctStripe" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#c2410c" />
          <Stop offset="30%"  stopColor="#f97316" />
          <Stop offset="50%"  stopColor="#fb923c" />
          <Stop offset="70%"  stopColor="#f97316" />
          <Stop offset="100%" stopColor="#c2410c" />
        </LinearGradient>
      </Defs>

      <Ellipse cx={100} cy={300} rx={80} ry={10} fill="rgba(0,0,0,0.25)" />

      {/* Main body */}
      <Path d="M 70,18 Q 57,18 56,30 L 54,110 L 54,278 Q 54,288 70,290 L 130,290 Q 146,288 146,278 L 146,110 L 144,30 Q 143,18 130,18 Z"
        fill="url(#ctBody)" />

      {/* Cab section */}
      <Rect x={58} y={18} width={84} height={100} rx={5} fill="url(#ctBody)" />

      {/* Front bumper - heavy chrome */}
      <Rect x={58} y={8} width={84} height={14} rx={4} fill="url(#chrome)" />
      <Rect x={68} y={10} width={64} height={5} rx={2} fill="#94a3b8" />
      <Rect x={62} y={10} width={8} height={10} rx={2} fill="url(#headlight)" />
      <Rect x={130} y={10} width={8} height={10} rx={2} fill="url(#headlight)" />

      {/* Headlights - rectangular */}
      <Rect x={58} y={11} width={26} height={11} rx={3} fill="url(#headlight)" />
      <Rect x={116} y={11} width={26} height={11} rx={3} fill="url(#headlight)" />
      <Rect x={60} y={21} width={80} height={2.5} rx={1} fill="#fb923c" opacity={0.9} />

      {/* Hood */}
      <Rect x={60} y={23} width={80} height={42} rx={4} fill="url(#ctHood)" />
      <Line x1={100} y1={25} x2={100} y2={64} stroke="#f8fafc" strokeWidth={1} opacity={0.6} />
      {[0, 1, 2, 3].map(i => (
        <Rect key={i} x={68} y={32 + i * 7} width={64} height={3} rx={1.5}
          fill="#94a3b8" opacity={0.5} />
      ))}

      {/* Windshield */}
      <Path d="M 62,65 L 138,65 L 134,84 L 66,84 Z" fill="url(#glassGrad)" />
      <Path d="M 68,66 L 114,66 L 111,76 L 71,76 Z" fill="url(#glassReflect)" opacity={0.5} />
      <Line x1={76} y1={82} x2={98} y2={68} stroke="#475569" strokeWidth={0.8} opacity={0.7} />
      <Line x1={124} y1={82} x2={102} y2={68} stroke="#475569" strokeWidth={0.8} opacity={0.7} />

      {/* Cab interior */}
      <Rect x={58} y={84} width={84} height={40} rx={3} fill="#cbd5e1" />
      <Rect x={64} y={88} width={20} height={15} rx={3} fill="#94a3b8" />
      <Rect x={64} y={88} width={20} height={6} rx={3} fill="#e2e8f0" />
      <Rect x={116} y={88} width={20} height={15} rx={3} fill="#94a3b8" />
      <Rect x={116} y={88} width={20} height={6} rx={3} fill="#e2e8f0" />
      <Rect x={64} y={106} width={72} height={6} rx={2} fill="#475569" />
      <Circle cx={80} cy={112} r={8} fill="none" stroke="#1e293b" strokeWidth={2.5} />
      <Circle cx={80} cy={112} r={2.5} fill="#1e293b" />

      {/* Orange stripe */}
      <Rect x={58} y={118} width={84} height={10} fill="url(#ctStripe)" />

      {/* Cargo box */}
      <Rect x={58} y={128} width={84} height={154} rx={3} fill="url(#ctCargo)" />
      {[0, 1, 2, 3, 4].map(i => (
        <Line key={i} x1={60} y1={145 + i * 28} x2={140} y2={145 + i * 28}
          stroke="#94a3b8" strokeWidth={1} opacity={0.6} />
      ))}
      <Rect x={58} y={128} width={5} height={154} fill="#cbd5e1" />
      <Rect x={137} y={128} width={5} height={154} fill="#cbd5e1" />

      {/* Rear bumper */}
      <Rect x={60} y={283} width={80} height={11} rx={3} fill="url(#chrome)" />
      <Rect x={62} y={284} width={20} height={7} rx={2} fill="url(#brakeLight)" />
      <Rect x={118} y={284} width={20} height={7} rx={2} fill="url(#brakeLight)" />
      <Rect x={84} y={285} width={32} height={5} rx={2} fill="#fb923c" opacity={0.7} />
      <Rect x={82} y={274} width={36} height={8} rx={1} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={0.5} />

      {/* Exhaust pipe */}
      <Circle cx={55} cy={265} r={3} fill="#374151" stroke="#1f2937" strokeWidth={0.8} />
      <Circle cx={55} cy={265} r={1.5} fill="#111827" />

      {/* Mirrors */}
      <Rect x={39} y={55} width={17} height={9} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.5} />
      <Rect x={144} y={55} width={17} height={9} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.5} />
    </G>
  )
}

// ── 3. TRI-MIXER - Green Concrete Company livery (white + green) ─────────────────
function TriMixerBody() {
  return (
    <G>
      <Defs>
        <RadialGradient id="tmBody" cx="48%" cy="35%" r="60%">
          <Stop offset="0%"   stopColor="#ffffff" />
          <Stop offset="55%"  stopColor="#f1f5f9" />
          <Stop offset="100%" stopColor="#cbd5e1" />
        </RadialGradient>
        <LinearGradient id="tmHood" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#94a3b8" />
          <Stop offset="30%"  stopColor="#e2e8f0" />
          <Stop offset="50%"  stopColor="#ffffff" />
          <Stop offset="70%"  stopColor="#e2e8f0" />
          <Stop offset="100%" stopColor="#94a3b8" />
        </LinearGradient>
        <LinearGradient id="tmGreenStripe" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#004d26" />
          <Stop offset="30%"  stopColor="#006C35" />
          <Stop offset="50%"  stopColor="#00A850" />
          <Stop offset="70%"  stopColor="#006C35" />
          <Stop offset="100%" stopColor="#004d26" />
        </LinearGradient>
        <RadialGradient id="tmDrum" cx="42%" cy="35%" r="65%">
          <Stop offset="0%"   stopColor="#ffffff" />
          <Stop offset="45%"  stopColor="#e2e8f0" />
          <Stop offset="80%"  stopColor="#94a3b8" />
          <Stop offset="100%" stopColor="#64748b" />
        </RadialGradient>
        <RadialGradient id="tmDrumHub" cx="35%" cy="32%" r="65%">
          <Stop offset="0%"   stopColor="#e2e8f0" />
          <Stop offset="100%" stopColor="#475569" />
        </RadialGradient>
        <RadialGradient id="tmLogoBg" cx="50%" cy="50%" r="50%">
          <Stop offset="0%"   stopColor="#006C35" />
          <Stop offset="100%" stopColor="#004d26" />
        </RadialGradient>
      </Defs>

      <Ellipse cx={100} cy={352} rx={80} ry={10} fill="rgba(0,0,0,0.25)" />

      {/* Cab - white */}
      <Path d="M 70,14 Q 57,14 56,28 L 54,108 L 54,125 L 146,125 L 146,108 L 144,28 Q 143,14 130,14 Z"
        fill="url(#tmBody)" />

      {/* Front bumper chrome */}
      <Rect x={58} y={6} width={84} height={12} rx={4} fill="url(#chrome)" />
      <Rect x={66} y={8} width={68} height={5} rx={2} fill="#1e293b" />
      {[0, 1, 2].map(i => (
        <Rect key={i} x={68} y={9 + i * 1.5} width={64} height={1} rx={0.5} fill="#475569" opacity={0.7} />
      ))}

      {/* Headlights */}
      <Rect x={58} y={7} width={24} height={12} rx={3} fill="url(#headlight)" />
      <Rect x={118} y={7} width={24} height={12} rx={3} fill="url(#headlight)" />
      <Rect x={60} y={18} width={80} height={3} rx={1} fill="#00A850" opacity={0.95} />

      {/* Hood - white */}
      <Rect x={60} y={21} width={80} height={42} rx={4} fill="url(#tmHood)" />
      <Line x1={100} y1={23} x2={100} y2={62} stroke="#cbd5e1" strokeWidth={1} opacity={0.7} />
      {[0, 1, 2].map(i => (
        <Rect key={i} x={70} y={30 + i * 9} width={60} height={4} rx={2} fill="#cbd5e1" opacity={0.5} />
      ))}

      {/* Green Concrete logo on hood */}
      <Circle cx={100} cy={44} r={10} fill="url(#tmLogoBg)" opacity={0.9} />
      <Path d="M 96,44 Q 96,39 100,38 Q 106,38 106,44 Q 106,49 100,50 Q 97,50 96,48 L 96,44 Z"
        fill="#00A850" />
      <Line x1={100} y1={50} x2={100} y2={54} stroke="#00A850" strokeWidth={1.2} />
      <SvgText x={100} y={57} textAnchor="middle" fontSize={3.5} fontWeight="800" fill="#006C35">GCC</SvgText>

      {/* Windshield */}
      <Path d="M 63,63 L 137,63 L 133,80 L 67,80 Z" fill="url(#glassGrad)" />
      <Path d="M 68,64 L 112,64 L 109,74 L 71,74 Z" fill="url(#glassReflect)" opacity={0.5} />
      <Line x1={78} y1={78} x2={98} y2={65} stroke="#475569" strokeWidth={0.8} opacity={0.6} />
      <Line x1={122} y1={78} x2={102} y2={65} stroke="#475569" strokeWidth={0.8} opacity={0.6} />

      {/* Cab interior */}
      <Rect x={58} y={80} width={84} height={42} rx={3} fill="#e2e8f0" />
      <Rect x={65} y={84} width={18} height={14} rx={3} fill="#cbd5e1" />
      <Rect x={117} y={84} width={18} height={14} rx={3} fill="#cbd5e1" />
      <Circle cx={80} cy={108} r={8} fill="none" stroke="#334155" strokeWidth={2.5} />
      <Circle cx={80} cy={108} r={2.5} fill="#334155" />

      {/* Green brand stripe across cab bottom */}
      <Rect x={58} y={116} width={84} height={10} fill="url(#tmGreenStripe)" />
      <SvgText x={100} y={123} textAnchor="middle" fontSize={4} fontWeight="800"
        fill="white" letterSpacing={0.5}>GREEN CONCRETE</SvgText>

      {/* Chassis frame */}
      <Rect x={68} y={126} width={12} height={215} fill="#334155" />
      <Rect x={120} y={126} width={12} height={215} fill="#334155" />
      {[0, 1, 2, 3].map(i => (
        <Rect key={i} x={68} y={148 + i * 50} width={64} height={6} fill="#475569" />
      ))}

      {/* Drum - white with green fins */}
      <Ellipse cx={100} cy={228} rx={44} ry={100} fill="url(#tmDrum)" />
      <Ellipse cx={100} cy={228} rx={44} ry={100} fill="none" stroke="#94a3b8" strokeWidth={1.5} />

      {/* Green spiral fins */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => {
        const yPos = 135 + i * 21
        const curve = i % 2 === 0 ? -9 : 9
        return (
          <Path key={i} d={`M 58,${yPos} Q 100,${yPos + curve} 142,${yPos}`}
            fill="none" stroke="#006C35" strokeWidth={2.2} opacity={0.9} />
        )
      })}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => {
        const yPos = 134 + i * 21
        const curve = i % 2 === 0 ? -9 : 9
        return (
          <Path key={i + 10} d={`M 60,${yPos} Q 100,${yPos + curve} 140,${yPos}`}
            fill="none" stroke="#00A850" strokeWidth={0.8} opacity={0.5} />
        )
      })}

      {/* Green Concrete logo badge on drum */}
      <Ellipse cx={100} cy={228} rx={22} ry={22} fill="url(#tmLogoBg)" stroke="#00A850" strokeWidth={1.5} />
      <Path d="M 96,224 Q 95,218 100,217 Q 107,217 107,224 Q 107,231 100,232 Q 96,232 95,229 L 96,224 Z"
        fill="#00A850" />
      <Line x1={100} y1={232} x2={100} y2={237} stroke="#00A850" strokeWidth={1.5} />
      <SvgText x={100} y={241} textAnchor="middle" fontSize={4.5} fontWeight="900" fill="white">GCC</SvgText>
      <SvgText x={100} y={246} textAnchor="middle" fontSize={3} fill="#86efac" letterSpacing={0.3}>THINK · BELIEVE · GREEN</SvgText>

      {/* Hub bolts ring */}
      <Ellipse cx={100} cy={228} rx={14} ry={14} fill="url(#tmDrumHub)" stroke="#94a3b8" strokeWidth={1} />
      {[0, 72, 144, 216, 288].map((deg, i) => {
        const rad = (deg * Math.PI) / 180
        return <Circle key={i} cx={100 + Math.cos(rad) * 9} cy={228 + Math.sin(rad) * 9} r={1.8} fill="#475569" />
      })}
      <Circle cx={100} cy={228} r={4.5} fill="#1e293b" />

      {/* Water tank */}
      <Rect x={70} y={315} width={60} height={24} rx={4} fill="#006C35" opacity={0.8} />
      <Rect x={72} y={317} width={56} height={8} rx={2} fill="#00A850" opacity={0.3} />
      <SvgText x={100} y={330} textAnchor="middle" fontSize={4} fill="white" opacity={0.8} fontWeight="600">WATER</SvgText>

      {/* Rear chassis + lights */}
      <Rect x={58} y={335} width={84} height={12} rx={3} fill="url(#chrome)" />
      <Rect x={60} y={336} width={22} height={8} rx={2} fill="url(#brakeLight)" />
      <Rect x={118} y={336} width={22} height={8} rx={2} fill="url(#brakeLight)" />
      <Rect x={82} y={337} width={36} height={6} rx={2} fill="#006C35" opacity={0.8} />

      {/* Mirrors - green */}
      <Rect x={39} y={52} width={17} height={9} rx={3} fill="#006C35" stroke="#004d26" strokeWidth={0.5} />
      <Rect x={144} y={52} width={17} height={9} rx={3} fill="#006C35" stroke="#004d26" strokeWidth={0.5} />
    </G>
  )
}

// ── 4. CONCRETE PUMP - Green Concrete Company livery (white + green) ─────────────
function ConcretePumpBody() {
  return (
    <G>
      <Defs>
        <RadialGradient id="cpBody" cx="48%" cy="35%" r="62%">
          <Stop offset="0%"   stopColor="#ffffff" />
          <Stop offset="55%"  stopColor="#f1f5f9" />
          <Stop offset="100%" stopColor="#cbd5e1" />
        </RadialGradient>
        <LinearGradient id="cpHood" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#94a3b8" />
          <Stop offset="30%"  stopColor="#e2e8f0" />
          <Stop offset="50%"  stopColor="#ffffff" />
          <Stop offset="70%"  stopColor="#e2e8f0" />
          <Stop offset="100%" stopColor="#94a3b8" />
        </LinearGradient>
        <RadialGradient id="cpPump" cx="45%" cy="35%" r="60%">
          <Stop offset="0%"   stopColor="#ffffff" />
          <Stop offset="55%"  stopColor="#f1f5f9" />
          <Stop offset="100%" stopColor="#cbd5e1" />
        </RadialGradient>
        <RadialGradient id="cpHopper" cx="40%" cy="35%" r="65%">
          <Stop offset="0%"   stopColor="#4ade80" />
          <Stop offset="50%"  stopColor="#16a34a" />
          <Stop offset="100%" stopColor="#14532d" />
        </RadialGradient>
        <LinearGradient id="cpOutrigger" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#004d26" />
          <Stop offset="50%"  stopColor="#006C35" />
          <Stop offset="100%" stopColor="#004d26" />
        </LinearGradient>
        <LinearGradient id="cpBoom" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#004d26" />
          <Stop offset="50%"  stopColor="#006C35" />
          <Stop offset="100%" stopColor="#004d26" />
        </LinearGradient>
        <LinearGradient id="cpGreenStripe" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#004d26" />
          <Stop offset="30%"  stopColor="#006C35" />
          <Stop offset="50%"  stopColor="#00A850" />
          <Stop offset="70%"  stopColor="#006C35" />
          <Stop offset="100%" stopColor="#004d26" />
        </LinearGradient>
        <RadialGradient id="cpLogoBg" cx="50%" cy="50%" r="50%">
          <Stop offset="0%"   stopColor="#006C35" />
          <Stop offset="100%" stopColor="#004d26" />
        </RadialGradient>
      </Defs>

      <Ellipse cx={100} cy={362} rx={90} ry={11} fill="rgba(0,0,0,0.25)" />

      {/* Cab - white */}
      <Path d="M 70,14 Q 57,14 56,28 L 54,110 L 54,128 L 146,128 L 146,110 L 144,28 Q 143,14 130,14 Z"
        fill="url(#cpBody)" />

      {/* Front bumper chrome */}
      <Rect x={58} y={6} width={84} height={12} rx={4} fill="url(#chrome)" />
      <Rect x={66} y={8} width={68} height={5} rx={2} fill="#1e293b" />
      {[0, 1, 2].map(i => (
        <Rect key={i} x={68} y={9 + i * 1.5} width={64} height={1} rx={0.5} fill="#475569" opacity={0.8} />
      ))}

      {/* Headlights */}
      <Rect x={58} y={7} width={24} height={12} rx={3} fill="url(#headlight)" />
      <Rect x={118} y={7} width={24} height={12} rx={3} fill="url(#headlight)" />
      <Rect x={60} y={18} width={80} height={3} rx={1} fill="#00A850" opacity={0.95} />

      {/* Hood - white */}
      <Rect x={60} y={21} width={80} height={44} rx={4} fill="url(#cpHood)" />
      <Line x1={100} y1={23} x2={100} y2={64} stroke="#cbd5e1" strokeWidth={1} opacity={0.7} />
      {[0, 1, 2].map(i => (
        <Rect key={i} x={70} y={30 + i * 10} width={60} height={4} rx={2} fill="#e2e8f0" opacity={0.6} />
      ))}

      {/* GCC logo badge on hood */}
      <Circle cx={100} cy={44} r={10} fill="url(#cpLogoBg)" opacity={0.9} />
      <Path d="M 96,44 Q 96,39 100,38 Q 106,38 106,44 Q 106,49 100,50 Q 97,50 96,48 L 96,44 Z"
        fill="#00A850" />
      <Line x1={100} y1={50} x2={100} y2={54} stroke="#00A850" strokeWidth={1.2} />
      <SvgText x={100} y={57} textAnchor="middle" fontSize={3.5} fontWeight="800" fill="#006C35">GCC</SvgText>

      {/* Windshield */}
      <Path d="M 63,65 L 137,65 L 133,83 L 67,83 Z" fill="url(#glassGrad)" />
      <Path d="M 68,66 L 112,66 L 109,76 L 71,76 Z" fill="url(#glassReflect)" opacity={0.5} />
      <Line x1={78} y1={81} x2={98} y2={67} stroke="#475569" strokeWidth={0.8} opacity={0.6} />
      <Line x1={122} y1={81} x2={102} y2={67} stroke="#475569" strokeWidth={0.8} opacity={0.6} />

      {/* Cab interior */}
      <Rect x={58} y={83} width={84} height={42} rx={3} fill="#e2e8f0" />
      <Rect x={65} y={87} width={18} height={14} rx={3} fill="#cbd5e1" />
      <Rect x={117} y={87} width={18} height={14} rx={3} fill="#cbd5e1" />
      <Circle cx={80} cy={111} r={8} fill="none" stroke="#334155" strokeWidth={2.5} />
      <Circle cx={80} cy={111} r={2.5} fill="#334155" />

      {/* Green Concrete brand stripe */}
      <Rect x={58} y={120} width={84} height={9} fill="url(#cpGreenStripe)" />
      <SvgText x={100} y={126.5} textAnchor="middle" fontSize={4} fontWeight="800"
        fill="white" letterSpacing={0.5}>GREEN CONCRETE</SvgText>

      {/* Cab bottom bar */}
      <Rect x={58} y={126} width={84} height={3} fill="#004d26" />

      {/* Chassis frame */}
      <Rect x={68} y={129} width={11} height={222} fill="#334155" />
      <Rect x={121} y={129} width={11} height={222} fill="#334155" />

      {/* Outrigger beams - green */}
      <Rect x={20} y={142} width={50} height={10} rx={3} fill="url(#cpOutrigger)" />
      <Rect x={130} y={142} width={50} height={10} rx={3} fill="url(#cpOutrigger)" />
      <Rect x={12} y={138} width={14} height={18} rx={4} fill="#006C35" stroke="#00A850" strokeWidth={1.5} />
      <Rect x={174} y={138} width={14} height={18} rx={4} fill="#006C35" stroke="#00A850" strokeWidth={1.5} />
      <Rect x={14} y={140} width={10} height={14} rx={2} fill="#004d26" opacity={0.8} />
      <Rect x={176} y={140} width={10} height={14} rx={2} fill="#004d26" opacity={0.8} />
      <Rect x={20} y={238} width={50} height={10} rx={3} fill="url(#cpOutrigger)" />
      <Rect x={130} y={238} width={50} height={10} rx={3} fill="url(#cpOutrigger)" />
      <Rect x={12} y={234} width={14} height={18} rx={4} fill="#006C35" stroke="#00A850" strokeWidth={1.5} />
      <Rect x={174} y={234} width={14} height={18} rx={4} fill="#006C35" stroke="#00A850" strokeWidth={1.5} />
      <Rect x={14} y={236} width={10} height={14} rx={2} fill="#004d26" opacity={0.8} />
      <Rect x={176} y={236} width={10} height={14} rx={2} fill="#004d26" opacity={0.8} />

      {/* Pump body - white */}
      <Rect x={58} y={129} width={84} height={220} rx={4} fill="url(#cpPump)" />

      {/* Green side stripe on pump body */}
      <Rect x={58} y={129} width={5} height={220} fill="#006C35" opacity={0.8} rx={2} />
      <Rect x={137} y={129} width={5} height={220} fill="#006C35" opacity={0.8} rx={2} />

      {/* Hopper - green branded */}
      <Rect x={66} y={135} width={68} height={58} rx={6} fill="url(#cpHopper)" />
      <Rect x={70} y={139} width={60} height={46} rx={4} fill="#14532d" opacity={0.5} />
      <Ellipse cx={100} cy={164} rx={24} ry={17} fill="#052e16" />
      <SvgText x={100} y={162} textAnchor="middle" fontSize={5.5} fontWeight="700" fill="#4ade80" opacity={0.9}>HOPPER</SvgText>
      {[0, 1, 2].map(i => (
        <Line key={i} x1={72} y1={152 + i * 6} x2={128} y2={152 + i * 6} stroke="#4ade80" strokeWidth={0.7} opacity={0.4} />
      ))}
      {[0, 1, 2].map(i => (
        <Line key={i + 3} x1={88 + i * 12} y1={138} x2={88 + i * 12} y2={190} stroke="#4ade80" strokeWidth={0.7} opacity={0.4} />
      ))}

      {/* Pump cylinders */}
      <Rect x={70} y={198} width={26} height={42} rx={5} fill="#475569" stroke="#006C35" strokeWidth={1.2} />
      <Rect x={104} y={198} width={26} height={42} rx={5} fill="#475569" stroke="#006C35" strokeWidth={1.2} />
      <Ellipse cx={83} cy={219} rx={10} ry={10} fill="url(#chrome)" />
      <Ellipse cx={117} cy={219} rx={10} ry={10} fill="url(#chrome)" />
      <Circle cx={83} cy={219} r={4} fill="#334155" />
      <Circle cx={117} cy={219} r={4} fill="#334155" />

      {/* S-valve */}
      <Rect x={76} y={240} width={48} height={18} rx={5} fill="#1e293b" stroke="#006C35" strokeWidth={1.2} />
      <SvgText x={100} y={252} textAnchor="middle" fontSize={5} fill="#00A850" fontWeight="700">S-VALVE</SvgText>

      {/* GCC logo badge on pump body */}
      <Ellipse cx={100} cy={290} rx={18} ry={18} fill="url(#cpLogoBg)" stroke="#00A850" strokeWidth={1.5} />
      <Path d="M 97,287 Q 96,282 100,281 Q 105,281 105,287 Q 105,293 100,294 Q 97,294 96,291 L 97,287 Z"
        fill="#00A850" />
      <Line x1={100} y1={294} x2={100} y2={298} stroke="#00A850" strokeWidth={1.2} />
      <SvgText x={100} y={302} textAnchor="middle" fontSize={3.8} fontWeight="900" fill="white">GCC</SvgText>

      {/* Boom arm - green */}
      <Rect x={66} y={263} width={68} height={12} rx={4} fill="url(#cpBoom)" stroke="#00A850" strokeWidth={0.8} />
      <Rect x={70} y={276} width={60} height={10} rx={4} fill="url(#cpBoom)" stroke="#00A850" strokeWidth={0.8} />
      <Rect x={74} y={287} width={52} height={10} rx={4} fill="url(#cpBoom)" stroke="#00A850" strokeWidth={0.8} />
      <Rect x={78} y={298} width={44} height={10} rx={4} fill="url(#cpBoom)" stroke="#00A850" strokeWidth={0.8} />
      <Circle cx={100} cy={269} r={4} fill="#004d26" stroke="#00A850" strokeWidth={0.8} />
      <Circle cx={100} cy={281} r={4} fill="#004d26" stroke="#00A850" strokeWidth={0.8} />
      <Circle cx={100} cy={292} r={4} fill="#004d26" stroke="#00A850" strokeWidth={0.8} />

      {/* Concrete pipe */}
      <Line x1={100} y1={181} x2={100} y2={303} stroke="#006C35" strokeWidth={2.5} strokeDasharray="3 2" opacity={0.7} />

      {/* Rear bumper */}
      <Rect x={60} y={348} width={80} height={12} rx={3} fill="url(#chrome)" />
      <Rect x={62} y={349} width={22} height={8} rx={2} fill="url(#brakeLight)" />
      <Rect x={116} y={349} width={22} height={8} rx={2} fill="url(#brakeLight)" />
      <Rect x={86} y={350} width={28} height={6} rx={2} fill="#006C35" opacity={0.8} />

      {/* Mirrors - green */}
      <Rect x={39} y={55} width={17} height={9} rx={3} fill="#006C35" stroke="#004d26" strokeWidth={0.8} />
      <Rect x={144} y={55} width={17} height={9} rx={3} fill="#006C35" stroke="#004d26" strokeWidth={0.8} />
    </G>
  )
}

// ── 5. WHEEL LOADER - CAT yellow articulated ────────────────────────────────────
function WheelLoaderBody() {
  return (
    <G>
      <Defs>
        <RadialGradient id="wlBody" cx="48%" cy="38%" r="62%">
          <Stop offset="0%"   stopColor="#fef9c3" />
          <Stop offset="40%"  stopColor="#fde047" />
          <Stop offset="75%"  stopColor="#ca8a04" />
          <Stop offset="100%" stopColor="#78350f" />
        </RadialGradient>
        <RadialGradient id="wlCab" cx="40%" cy="35%" r="65%">
          <Stop offset="0%"   stopColor="#fef9c3" />
          <Stop offset="50%"  stopColor="#fde047" />
          <Stop offset="100%" stopColor="#92400e" />
        </RadialGradient>
        <LinearGradient id="wlBucket" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%"   stopColor="#9ca3af" />
          <Stop offset="40%"  stopColor="#4b5563" />
          <Stop offset="100%" stopColor="#1f2937" />
        </LinearGradient>
        <LinearGradient id="wlArm" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#78350f" />
          <Stop offset="50%"  stopColor="#fde047" />
          <Stop offset="100%" stopColor="#78350f" />
        </LinearGradient>
      </Defs>

      <Ellipse cx={100} cy={248} rx={82} ry={10} fill="rgba(0,0,0,0.3)" />

      {/* Front frame (bucket side) */}
      <Rect x={58} y={22} width={84} height={82} rx={6} fill="url(#wlBody)" />

      {/* Lift arms */}
      <Rect x={60} y={14} width={14} height={90} rx={4} fill="url(#wlArm)" stroke="#78350f" strokeWidth={0.8} />
      <Rect x={126} y={14} width={14} height={90} rx={4} fill="url(#wlArm)" stroke="#78350f" strokeWidth={0.8} />

      {/* Bucket */}
      <Path d="M 44,5 L 156,5 L 160,22 L 40,22 Z" fill="url(#wlBucket)" />
      <Rect x={44} y={6} width={112} height={14} rx={2} fill="#374151" />
      <Rect x={42} y={3} width={116} height={5} rx={1.5} fill="url(#chrome)" />
      {[0, 1, 2, 3, 4, 5, 6].map(i => (
        <Path key={i}
          d={`M ${52 + i * 17},3 L ${52 + i * 17 - 3},0 L ${52 + i * 17 + 3},0 Z`}
          fill="#94a3b8" />
      ))}
      <Rect x={44} y={5} width={6} height={18} rx={2} fill="#374151" />
      <Rect x={150} y={5} width={6} height={18} rx={2} fill="#374151" />

      {/* Lift arm hydraulic cylinders */}
      <Rect x={65} y={20} width={6} height={28} rx={2} fill="#94a3b8" />
      <Rect x={129} y={20} width={6} height={28} rx={2} fill="#94a3b8" />
      <Rect x={64} y={19} width={8} height={3} rx={1} fill="url(#chrome)" />
      <Rect x={128} y={19} width={8} height={3} rx={1} fill="url(#chrome)" />

      {/* Articulation joint */}
      <Rect x={64} y={100} width={72} height={14} rx={5} fill="#374151" stroke="#fde047" strokeWidth={1} />
      <Circle cx={100} cy={107} r={8} fill="#1f2937" stroke="#fde047" strokeWidth={1.5} />
      <Circle cx={100} cy={107} r={3.5} fill="#374151" stroke="#94a3b8" strokeWidth={0.8} />

      {/* Rear frame (engine/cab side) */}
      <Rect x={56} y={114} width={88} height={118} rx={8} fill="url(#wlBody)" />

      {/* ROPS cab frame */}
      <Rect x={62} y={116} width={76} height={52} rx={5} fill="url(#wlCab)" />
      <Rect x={66} y={118} width={68} height={10} rx={2} fill="url(#glassGrad)" opacity={0.9} />
      <Rect x={68} y={119} width={30} height={6} rx={1} fill="url(#glassReflect)" opacity={0.5} />
      <Rect x={62} y={116} width={5} height={52} rx={2} fill="#92400e" />
      <Rect x={133} y={116} width={5} height={52} rx={2} fill="#92400e" />
      <Rect x={67} y={128} width={66} height={36} rx={3} fill="#a16207" opacity={0.6} />
      <Rect x={82} y={133} width={24} height={18} rx={4} fill="#78350f" />
      <Rect x={82} y={133} width={24} height={8} rx={4} fill="#92400e" />
      <Circle cx={108} cy={148} r={3} fill="#1f2937" />
      <Line x1={108} y1={148} x2={108} y2={153} stroke="#374151" strokeWidth={1.5} />
      <Circle cx={78} cy={152} r={6} fill="none" stroke="#451a03" strokeWidth={2} />
      <Circle cx={78} cy={152} r={2} fill="#451a03" />

      {/* Engine hood */}
      <Rect x={62} y={168} width={76} height={56} rx={4} fill="#ca8a04" opacity={0.8} />
      {[0, 1, 2, 3].map(i => (
        <Rect key={i} x={70} y={175 + i * 11} width={60} height={6} rx={3} fill="#92400e" opacity={0.5} />
      ))}
      <Circle cx={130} cy={175} r={5} fill="#374151" stroke="#4b5563" strokeWidth={1} />
      <Circle cx={130} cy={175} r={2.5} fill="#1f2937" />

      {/* Rear counterweight */}
      <Rect x={60} y={224} width={80} height={14} rx={5} fill="#374151" stroke="#6b7280" strokeWidth={1} />
      <Rect x={65} y={226} width={70} height={10} rx={3} fill="#4b5563" />
      <Rect x={62} y={225} width={14} height={10} rx={2} fill="url(#brakeLight)" />
      <Rect x={124} y={225} width={14} height={10} rx={2} fill="url(#brakeLight)" />

      {/* CAT badge */}
      <Rect x={84} y={184} width={32} height={12} rx={2} fill="#1f2937" opacity={0.6} />
      <SvgText x={100} y={192} textAnchor="middle" fontSize={7} fontWeight="900" fill="#fde047" opacity={0.9}>CAT</SvgText>
    </G>
  )
}

// ── 6. BUS - white staff/transit bus with green GCC stripe ───────────────────────
function BusBody() {
  return (
    <G>
      <Defs>
        <RadialGradient id="busRoof" cx="48%" cy="38%" r="58%">
          <Stop offset="0%"   stopColor="#ffffff" />
          <Stop offset="55%"  stopColor="#f1f5f9" />
          <Stop offset="100%" stopColor="#cbd5e1" />
        </RadialGradient>
        <LinearGradient id="busStripe" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#004d26" />
          <Stop offset="30%"  stopColor="#006C35" />
          <Stop offset="50%"  stopColor="#00A850" />
          <Stop offset="70%"  stopColor="#006C35" />
          <Stop offset="100%" stopColor="#004d26" />
        </LinearGradient>
        <LinearGradient id="busWindow" x1="0%" y1="0%" x2="60%" y2="100%">
          <Stop offset="0%"   stopColor="#bfdbfe" stopOpacity="0.9" />
          <Stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.5" />
        </LinearGradient>
      </Defs>

      <Ellipse cx={100} cy={340} rx={86} ry={10} fill="rgba(0,0,0,0.25)" />

      {/* Main body - wide rectangular coach */}
      <Path d="M 52,20 Q 40,20 38,34 L 36,290 Q 36,305 52,308 L 148,308 Q 164,305 164,290 L 164,34 Q 162,20 148,20 Z"
        fill="url(#busRoof)" />

      {/* Front bumper */}
      <Rect x={38} y={10} width={124} height={14} rx={5} fill="url(#chrome)" />
      {/* Destination board */}
      <Rect x={54} y={12} width={92} height={7} rx={2} fill="#0f172a" />
      <SvgText x={100} y={17.5} textAnchor="middle" fontSize={4} fill="#fde047" fontWeight="700">STAFF BUS · GCC</SvgText>
      {/* Headlights */}
      <Rect x={38} y={12} width={18} height={11} rx={3} fill="url(#headlight)" />
      <Rect x={144} y={12} width={18} height={11} rx={3} fill="url(#headlight)" />
      <Rect x={40} y={23} width={120} height={3} rx={1} fill="#00A850" opacity={0.9} />
      {/* Front windshield - wide panoramic */}
      <Path d="M 42,26 L 158,26 L 155,48 L 45,48 Z" fill="url(#glassGrad)" />
      <Path d="M 46,27 L 120,27 L 118,40 L 48,40 Z" fill="url(#glassReflect)" opacity={0.5} />
      <Line x1={60} y1={46} x2={96} y2={30} stroke="#475569" strokeWidth={0.8} opacity={0.6} />
      <Line x1={140} y1={46} x2={104} y2={30} stroke="#475569" strokeWidth={0.8} opacity={0.6} />

      {/* Green stripe - runs full length */}
      <Rect x={36} y={130} width={128} height={14} fill="url(#busStripe)" />
      <SvgText x={100} y={139.5} textAnchor="middle" fontSize={4.5} fontWeight="800"
        fill="white" letterSpacing={0.8}>GREEN CONCRETE COMPANY</SvgText>

      {/* Side windows - left + right columns */}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <Rect key={i} x={36} y={55 + i * 38} width={8} height={26} rx={2}
          fill="url(#busWindow)" opacity={0.85} />
      ))}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <Rect key={i + 6} x={156} y={55 + i * 38} width={8} height={26} rx={2}
          fill="url(#busWindow)" opacity={0.85} />
      ))}

      {/* Interior - seats visible from top */}
      <Rect x={44} y={50} width={112} height={248} rx={3} fill="#f8fafc" opacity={0.15} />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => (
        <G key={i}>
          <Rect x={46} y={56 + i * 27} width={22} height={16} rx={3} fill="#e2e8f0" opacity={0.5} />
          <Rect x={132} y={56 + i * 27} width={22} height={16} rx={3} fill="#e2e8f0" opacity={0.5} />
        </G>
      ))}
      <Line x1={100} y1={50} x2={100} y2={295} stroke="#cbd5e1" strokeWidth={0.5}
        strokeDasharray="4 4" opacity={0.4} />

      {/* Front door */}
      <Rect x={36} y={54} width={10} height={30} rx={2} fill="#006C35" opacity={0.7} />
      <Rect x={38} y={56} width={6} height={26} rx={1} fill="#00A850" opacity={0.4} />

      {/* Rear */}
      <Path d="M 44,292 L 156,292 L 154,306 L 46,306 Z" fill="url(#glassGrad)" opacity={0.8} />
      <Path d="M 48,293 L 110,293 L 108,302 L 50,302 Z" fill="url(#glassReflect)" opacity={0.4} />
      <Rect x={38} y={306} width={124} height={10} rx={4} fill="url(#chrome)" />
      <Rect x={40} y={307} width={28} height={7} rx={2} fill="url(#brakeLight)" />
      <Rect x={132} y={307} width={28} height={7} rx={2} fill="url(#brakeLight)" />
      <Circle cx={42} cy={303} r={4} fill="#374151" stroke="#1f2937" strokeWidth={1} />
      <Circle cx={42} cy={303} r={2} fill="#111827" />

      {/* Mirrors - large coach mirrors */}
      <Rect x={16} y={30} width={20} height={10} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.8} />
      <Rect x={164} y={30} width={20} height={10} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.8} />
    </G>
  )
}

// ── 7. TATA - blue Tata Prima heavy truck ───────────────────────────────────────
function TataBody() {
  return (
    <G>
      <Defs>
        <RadialGradient id="tataCab" cx="48%" cy="35%" r="60%">
          <Stop offset="0%"   stopColor="#4d8fd1" />
          <Stop offset="40%"  stopColor="#0072CE" />
          <Stop offset="80%"  stopColor="#003087" />
          <Stop offset="100%" stopColor="#001f5b" />
        </RadialGradient>
        <LinearGradient id="tataHood" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#001f5b" />
          <Stop offset="30%"  stopColor="#0072CE" />
          <Stop offset="50%"  stopColor="#4d8fd1" />
          <Stop offset="70%"  stopColor="#0072CE" />
          <Stop offset="100%" stopColor="#001f5b" />
        </LinearGradient>
        <LinearGradient id="tataCargo" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#cbd5e1" />
          <Stop offset="15%"  stopColor="#f1f5f9" />
          <Stop offset="50%"  stopColor="#ffffff" />
          <Stop offset="85%"  stopColor="#f1f5f9" />
          <Stop offset="100%" stopColor="#cbd5e1" />
        </LinearGradient>
        <LinearGradient id="tataStripe" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#001f5b" />
          <Stop offset="30%"  stopColor="#003087" />
          <Stop offset="50%"  stopColor="#0072CE" />
          <Stop offset="70%"  stopColor="#003087" />
          <Stop offset="100%" stopColor="#001f5b" />
        </LinearGradient>
      </Defs>

      <Ellipse cx={100} cy={298} rx={80} ry={10} fill="rgba(0,0,0,0.28)" />

      {/* Cab - Tata Prima style, blue */}
      <Path d="M 68,14 Q 56,14 55,27 L 53,112 L 53,128 L 147,128 L 147,112 L 145,27 Q 144,14 132,14 Z"
        fill="url(#tataCab)" />

      {/* Front bumper - heavy chrome + bull bar */}
      <Rect x={56} y={5} width={88} height={13} rx={4} fill="url(#chrome)" />
      <Rect x={60} y={8} width={80} height={4} rx={2} fill="#94a3b8" />
      <Rect x={75} y={5} width={4} height={13} rx={1} fill="#94a3b8" />
      <Rect x={121} y={5} width={4} height={13} rx={1} fill="#94a3b8" />
      <Rect x={58} y={7} width={14} height={9} rx={2} fill="url(#headlight)" opacity={0.8} />
      <Rect x={128} y={7} width={14} height={9} rx={2} fill="url(#headlight)" opacity={0.8} />

      {/* Main headlights */}
      <Rect x={55} y={8} width={26} height={13} rx={3} fill="url(#headlight)" />
      <Rect x={119} y={8} width={26} height={13} rx={3} fill="url(#headlight)" />
      <Rect x={57} y={18} width={86} height={3} rx={1} fill="#0072CE" opacity={0.95} />

      {/* Hood */}
      <Rect x={58} y={21} width={84} height={46} rx={4} fill="url(#tataHood)" />
      <Line x1={100} y1={23} x2={100} y2={66} stroke="#4d8fd1" strokeWidth={1.2} opacity={0.6} />
      {[0, 1, 2, 3].map(i => (
        <Rect key={i} x={68} y={28 + i * 8} width={64} height={4} rx={2} fill="#001f5b" opacity={0.5} />
      ))}

      {/* TATA logo on hood */}
      <Rect x={84} y={40} width={32} height={14} rx={3} fill="#001f5b" opacity={0.85} />
      <SvgText x={100} y={50} textAnchor="middle" fontSize={8} fontWeight="900"
        fill="#ffffff" letterSpacing={1}>TATA</SvgText>

      {/* Windshield */}
      <Path d="M 61,67 L 139,67 L 135,85 L 65,85 Z" fill="url(#glassGrad)" />
      <Path d="M 66,68 L 112,68 L 109,78 L 69,78 Z" fill="url(#glassReflect)" opacity={0.5} />
      <Line x1={76} y1={83} x2={97} y2={69} stroke="#1e293b" strokeWidth={0.8} opacity={0.6} />
      <Line x1={124} y1={83} x2={103} y2={69} stroke="#1e293b" strokeWidth={0.8} opacity={0.6} />

      {/* Cab interior */}
      <Rect x={57} y={85} width={86} height={40} rx={3} fill="#003087" opacity={0.7} />
      <Rect x={64} y={89} width={18} height={14} rx={3} fill="#001f5b" />
      <Rect x={118} y={89} width={18} height={14} rx={3} fill="#001f5b" />
      <Circle cx={80} cy={114} r={8} fill="none" stroke="#001f5b" strokeWidth={2.5} />
      <Circle cx={80} cy={114} r={2.5} fill="#001f5b" />

      {/* Blue stripe on cab bottom */}
      <Rect x={57} y={120} width={86} height={9} fill="url(#tataStripe)" />
      <SvgText x={100} y={126.5} textAnchor="middle" fontSize={4} fontWeight="800"
        fill="white" letterSpacing={0.4}>TATA PRIMA · HEAVY DUTY</SvgText>

      {/* Chassis */}
      <Rect x={67} y={129} width={11} height={158} fill="#334155" />
      <Rect x={122} y={129} width={11} height={158} fill="#334155" />
      {[0, 1, 2].map(i => (
        <Rect key={i} x={67} y={145 + i * 45} width={66} height={6} fill="#475569" />
      ))}

      {/* Cargo box - white with blue stripe */}
      <Rect x={57} y={129} width={86} height={152} rx={3} fill="url(#tataCargo)" />
      <Rect x={57} y={129} width={5} height={152} fill="#003087" opacity={0.8} rx={1} />
      <Rect x={138} y={129} width={5} height={152} fill="#003087" opacity={0.8} rx={1} />
      {[0, 1, 2, 3, 4].map(i => (
        <Line key={i} x1={59} y1={148 + i * 27} x2={141} y2={148 + i * 27}
          stroke="#94a3b8" strokeWidth={0.8} opacity={0.5} />
      ))}

      {/* Rear bumper */}
      <Rect x={58} y={281} width={84} height={11} rx={3} fill="url(#chrome)" />
      <Rect x={60} y={282} width={22} height={7} rx={2} fill="url(#brakeLight)" />
      <Rect x={118} y={282} width={22} height={7} rx={2} fill="url(#brakeLight)" />
      <Rect x={84} y={283} width={32} height={5} rx={2} fill="#003087" opacity={0.7} />

      {/* Exhaust */}
      <Circle cx={55} cy={268} r={3.5} fill="#374151" stroke="#1f2937" strokeWidth={0.8} />
      <Circle cx={55} cy={268} r={1.8} fill="#111827" />

      {/* Mirrors - Tata Prima style */}
      <Rect x={37} y={54} width={17} height={10} rx={3} fill="#0072CE" stroke="#003087" strokeWidth={0.8} />
      <Rect x={146} y={54} width={17} height={10} rx={3} fill="#0072CE" stroke="#003087" strokeWidth={0.8} />
    </G>
  )
}

// ── 8. ASHOK LEYLAND - red/white AL heavy truck ─────────────────────────────────
function AshokLeylandBody() {
  return (
    <G>
      <Defs>
        <RadialGradient id="alCab" cx="48%" cy="35%" r="60%">
          <Stop offset="0%"   stopColor="#ffffff" />
          <Stop offset="45%"  stopColor="#f1f5f9" />
          <Stop offset="100%" stopColor="#cbd5e1" />
        </RadialGradient>
        <LinearGradient id="alHood" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#94a3b8" />
          <Stop offset="30%"  stopColor="#e2e8f0" />
          <Stop offset="50%"  stopColor="#ffffff" />
          <Stop offset="70%"  stopColor="#e2e8f0" />
          <Stop offset="100%" stopColor="#94a3b8" />
        </LinearGradient>
        <LinearGradient id="alStripe" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#7f0d1c" />
          <Stop offset="30%"  stopColor="#C41E3A" />
          <Stop offset="50%"  stopColor="#E8192C" />
          <Stop offset="70%"  stopColor="#C41E3A" />
          <Stop offset="100%" stopColor="#7f0d1c" />
        </LinearGradient>
        <LinearGradient id="alCargo" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#cbd5e1" />
          <Stop offset="15%"  stopColor="#f1f5f9" />
          <Stop offset="50%"  stopColor="#ffffff" />
          <Stop offset="85%"  stopColor="#f1f5f9" />
          <Stop offset="100%" stopColor="#cbd5e1" />
        </LinearGradient>
        <RadialGradient id="alBadge" cx="50%" cy="50%" r="50%">
          <Stop offset="0%"   stopColor="#E8192C" />
          <Stop offset="100%" stopColor="#7f0d1c" />
        </RadialGradient>
      </Defs>

      <Ellipse cx={100} cy={298} rx={80} ry={10} fill="rgba(0,0,0,0.28)" />

      {/* Cab - white */}
      <Path d="M 68,14 Q 56,14 55,27 L 53,112 L 53,128 L 147,128 L 147,112 L 145,27 Q 144,14 132,14 Z"
        fill="url(#alCab)" />

      {/* Front bumper - red AL style */}
      <Rect x={56} y={5} width={88} height={13} rx={4} fill="url(#alStripe)" />
      <Rect x={62} y={7} width={76} height={7} rx={3} fill="url(#chrome)" />

      {/* Headlights - round style (AL signature) */}
      <Ellipse cx={66} cy={12} rx={12} ry={9} fill="url(#headlight)" />
      <Ellipse cx={134} cy={12} rx={12} ry={9} fill="url(#headlight)" />
      <Ellipse cx={66} cy={12} rx={7} ry={5.5} fill="#fde047" opacity={0.7} />
      <Ellipse cx={134} cy={12} rx={7} ry={5.5} fill="#fde047" opacity={0.7} />
      <Rect x={57} y={20} width={86} height={2.5} rx={1} fill="#E8192C" opacity={0.9} />

      {/* Hood - white */}
      <Rect x={58} y={23} width={84} height={44} rx={4} fill="url(#alHood)" />
      <Line x1={100} y1={25} x2={100} y2={66} stroke="#e2e8f0" strokeWidth={1} opacity={0.8} />
      {[0, 1, 2].map(i => (
        <Rect key={i} x={70} y={30 + i * 10} width={60} height={4} rx={2} fill="#e2e8f0" opacity={0.6} />
      ))}

      {/* AL badge on hood - circular logo */}
      <Circle cx={100} cy={44} r={12} fill="url(#alBadge)" />
      <Circle cx={100} cy={44} r={12} fill="none" stroke="#fca5a5" strokeWidth={0.8} />
      <SvgText x={100} y={41} textAnchor="middle" fontSize={6} fontWeight="900"
        fill="white" letterSpacing={0.5}>AL</SvgText>
      <SvgText x={100} y={51} textAnchor="middle" fontSize={2.8} fill="#fca5a5"
        letterSpacing={0.2} fontWeight="600">ASHOK LEYLAND</SvgText>

      {/* Windshield */}
      <Path d="M 61,67 L 139,67 L 135,85 L 65,85 Z" fill="url(#glassGrad)" />
      <Path d="M 66,68 L 112,68 L 109,78 L 69,78 Z" fill="url(#glassReflect)" opacity={0.5} />
      <Line x1={76} y1={83} x2={97} y2={69} stroke="#475569" strokeWidth={0.8} opacity={0.6} />
      <Line x1={124} y1={83} x2={103} y2={69} stroke="#475569" strokeWidth={0.8} opacity={0.6} />

      {/* Cab interior */}
      <Rect x={57} y={85} width={86} height={40} rx={3} fill="#e2e8f0" />
      <Rect x={64} y={89} width={18} height={14} rx={3} fill="#cbd5e1" />
      <Rect x={118} y={89} width={18} height={14} rx={3} fill="#cbd5e1" />
      <Circle cx={80} cy={114} r={8} fill="none" stroke="#334155" strokeWidth={2.5} />
      <Circle cx={80} cy={114} r={2.5} fill="#334155" />

      {/* Red AL brand stripe on cab bottom */}
      <Rect x={57} y={120} width={86} height={9} fill="url(#alStripe)" />
      <SvgText x={100} y={126.5} textAnchor="middle" fontSize={4} fontWeight="800"
        fill="white" letterSpacing={0.4}>ASHOK LEYLAND · ECOMET</SvgText>

      {/* Chassis */}
      <Rect x={67} y={129} width={11} height={158} fill="#334155" />
      <Rect x={122} y={129} width={11} height={158} fill="#334155" />
      {[0, 1, 2].map(i => (
        <Rect key={i} x={67} y={145 + i * 45} width={66} height={6} fill="#475569" />
      ))}

      {/* Cargo box - white with red stripes */}
      <Rect x={57} y={129} width={86} height={152} rx={3} fill="url(#alCargo)" />
      <Rect x={57} y={129} width={5} height={152} fill="#C41E3A" opacity={0.8} rx={1} />
      <Rect x={138} y={129} width={5} height={152} fill="#C41E3A" opacity={0.8} rx={1} />
      {[0, 1, 2, 3, 4].map(i => (
        <Line key={i} x1={59} y1={148 + i * 27} x2={141} y2={148 + i * 27}
          stroke="#94a3b8" strokeWidth={0.8} opacity={0.5} />
      ))}
      <Circle cx={100} cy={200} r={14} fill="url(#alBadge)" opacity={0.9} />
      <Circle cx={100} cy={200} r={14} fill="none" stroke="#fca5a5" strokeWidth={0.8} />
      <SvgText x={100} y={197} textAnchor="middle" fontSize={7} fontWeight="900" fill="white">AL</SvgText>
      <SvgText x={100} y={207} textAnchor="middle" fontSize={3} fill="#fca5a5" letterSpacing={0.2}>ASHOK LEYLAND</SvgText>

      {/* Rear bumper */}
      <Rect x={58} y={281} width={84} height={11} rx={3} fill="url(#alStripe)" />
      <Rect x={60} y={282} width={22} height={7} rx={2} fill="url(#brakeLight)" />
      <Rect x={118} y={282} width={22} height={7} rx={2} fill="url(#brakeLight)" />

      {/* Exhaust */}
      <Circle cx={55} cy={268} r={3.5} fill="#374151" stroke="#1f2937" strokeWidth={0.8} />
      <Circle cx={55} cy={268} r={1.8} fill="#111827" />

      {/* Mirrors - white */}
      <Rect x={37} y={54} width={17} height={10} rx={3} fill="#e2e8f0" stroke="#C41E3A" strokeWidth={1} />
      <Rect x={146} y={54} width={17} height={10} rx={3} fill="#e2e8f0" stroke="#C41E3A" strokeWidth={1} />
    </G>
  )
}

// ── Body key -> component map ────────────────────────────────────────────────────
const BODY_COMPONENTS: Record<BodyKey, () => React.JSX.Element> = {
  pickup:       PickupBody,
  canter:       CanterBody,
  triMixer:     TriMixerBody,
  concretePump: ConcretePumpBody,
  wheelLoader:  WheelLoaderBody,
  bus:          BusBody,
  tata:         TataBody,
  ashokLeyland: AshokLeylandBody,
}

// ── Component ────────────────────────────────────────────────────────────────────
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

  const resolved = resolveVehicleType(vehicleType)
  const layout   = LAYOUTS[resolved] || LAYOUTS.Pickup
  const { emoji, viewH, bodyKey } = layout
  const Body = BODY_COMPONENTS[bodyKey]

  // Render ONLY the wheels the caller's position set defines - callers may pass
  // either the diagram id vocabulary (diagramPositions) or the lib/types.ts
  // vocabulary (getPositionsForVehicle); both are mapped onto layout slots.
  // Unmatched positions (Spare, foreign ids) never render as ghost slots.
  const tyres = useMemo(() => matchPositionsToLayout(layout, positions), [layout, positions])

  // SVG viewBox: minX -10, width 220, minY -5, height viewH + 10.
  const SVG_COORD_W = 220
  const SVG_MIN_X   = -10
  const SVG_MIN_Y   = -5
  const scale       = width / SVG_COORD_W
  const svgHeight   = Math.round((viewH + 10) * scale)

  // Risk / recorded / condition maps keyed by the caller's position id.
  // Data may be stored under the position id OR the layout's internal id
  // (older records) - check both.
  const { riskMap, recordedMap, conditionMap } = useMemo(() => {
    const risk: Record<string, RiskKey> = {}
    const recorded: Record<string, boolean> = {}
    const cond: Record<string, TyreCondition> = {}
    tyres.forEach(t => {
      const d = tyreData[t.positionId] ?? tyreData[t.id]
      risk[t.positionId] = d ? CONDITION_RISK[d.condition] : 'none'
      cond[t.positionId] = d?.condition ?? 'Good'
      recorded[t.positionId] = !!d && (
        !!d.serial_number || !!d.pressure_psi || !!d.tread_depth_mm ||
        !!d.notes || !!d.photo_uri || !!d.photo_url || d.condition !== 'Good'
      )
    })
    return { riskMap: risk, recordedMap: recorded, conditionMap: cond }
  }, [tyres, tyreData])

  // SVG coordinate -> screen pixels for the overlay touch targets.
  function toScreen(svgX: number, svgY: number, svgW: number, svgH: number) {
    const pad = 2  // small finger padding in SVG units
    return {
      left:   (svgX - pad - SVG_MIN_X) * scale,
      top:    (svgY - pad - SVG_MIN_Y) * scale,
      width:  (svgW + pad * 2) * scale,
      height: (svgH + pad * 2) * scale,
    }
  }

  // Tyreless equipment (generator, chiller, ice/batch plant, reclaimer ...):
  // show an honest "no tyres" state instead of a misleading layout.
  if (isTyrelessEquipment(vehicleType)) {
    return (
      <View style={[styles.container, { paddingVertical: 32, alignItems: 'center' }]}>
        <Text style={{ fontSize: 34 }}>🏭</Text>
        <Text style={styles.emptyTitle}>{vehicleType || 'Equipment'}</Text>
        <Text style={styles.emptyText}>Stationary equipment, no tyres to inspect.</Text>
      </View>
    )
  }

  // No positions supplied -> honest empty state.
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
      <Text style={styles.caption}>{emoji} {resolved} · {tyres.length} tyres</Text>

      {/* Tap hint */}
      <Text style={styles.tapHint}>Tap a tyre to record its condition</Text>

      {/* SVG diagram - purely visual, no touch handlers */}
      <View style={{ width, height: svgHeight }}>
        <Svg
          width={width}
          height={svgHeight}
          viewBox={`${SVG_MIN_X} ${SVG_MIN_Y} ${SVG_COORD_W} ${viewH + 10}`}
          style={styles.svg}
          pointerEvents="none"
        >
          <SharedDefs />

          {/* FRONT label */}
          <SvgText x={100} y={-2} textAnchor="middle" fontSize={5.5} fill="#64748b"
            fontWeight="600" letterSpacing={1}>▲ FRONT</SvgText>

          {/* Vehicle body */}
          <Body />

          {/* Tyres rendered on top */}
          {tyres.map(t => (
            <Tyre
              key={t.positionId}
              x={t.x} y={t.y} w={t.w} h={t.h}
              id={t.positionId} label={t.label}
              risk={riskMap[t.positionId] ?? 'none'}
              recorded={recordedMap[t.positionId]}
              selected={selectedPosition === t.positionId}
            />
          ))}
        </Svg>

        {/* Absolute touch overlays - one per tyre, on top of the SVG */}
        {tyres.map(t => {
          const pos = toScreen(t.x, t.y, t.w, t.h)
          const isSelected = selectedPosition === t.positionId
          const cond = conditionMap[t.positionId]
          const meta = cond ? CONDITION_META[cond] : null
          return (
            <TouchableOpacity
              key={`hit-${t.positionId}`}
              style={[styles.hitOverlay, pos, isSelected && styles.hitOverlaySelected]}
              onPress={() => onPositionPress?.(t.positionId)}
              activeOpacity={0.6}
            >
              {recordedMap[t.positionId] && meta && (
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
