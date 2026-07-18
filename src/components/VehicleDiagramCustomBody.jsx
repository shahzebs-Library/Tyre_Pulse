import React, { useId } from 'react'

/**
 * CustomBody - SVG renderer for Vehicle Designer layouts (V268).
 *
 * Draws a top-down vehicle body from the pure `bodySpec` emitted by
 * src/lib/vehicleDiagram.js positionsFromConfig(), in the SAME pseudo-3D
 * visual language as the built-in Body components in VehicleTyreDiagram.jsx:
 * gradient-painted metal with sheen falloff, chrome bumpers, glass with a
 * highlight sweep, soft blurred ground shadow + feDropShadow body depth, and
 * rich per-style art (ribbed cargo box, rotating mixer drum, folded pump boom
 * with outrigger pads, per-window bus panes, pickup bed + tailgate, trailer
 * deck with twist locks + kingpin, loader bucket + articulation, van panels
 * with sliding-door seam).
 *
 * Animated accents (blinking hazard indicators with selectable speed, pulsing
 * roof beacon, rotating mixer drum) are CSS keyframes inside the SVG and are
 * disabled under prefers-reduced-motion, as is the subtle road-speed dash
 * effect shown while the hazards are OFF. Every gradient/filter/clip id is
 * prefixed with a React useId per instance so multiple diagrams on one page
 * never collide.
 *
 * Shared by src/components/VehicleTyreDiagram.jsx (custom layouts in the app)
 * and the console Vehicle Designer live preview - do NOT fork this renderer.
 * The geometry contract (bodySpec cab/hull rects, tyre slot x/y/w/h) comes
 * from src/lib/vehicleDiagram.js and is consumed as-is: all art draws within
 * (or symmetrically around) those bounds so taps and status overlays align.
 */

const ANIM_CSS = `
@keyframes vdzBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.12; } }
@keyframes vdzPulse {
  0%, 100% { opacity: 0.95; transform: scale(1); }
  50%      { opacity: 0.35; transform: scale(1.55); }
}
@keyframes vdzSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes vdzRoad { from { stroke-dashoffset: 32; } to { stroke-dashoffset: 0; } }
.vdz-hazard { animation: vdzBlink 1s step-end infinite; }
.vdz-beacon { animation: vdzPulse 1.5s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
.vdz-drum   { animation: vdzSpin 7s linear infinite; transform-box: fill-box; transform-origin: center; }
.vdz-road   { animation: vdzRoad 1.2s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .vdz-hazard, .vdz-beacon, .vdz-drum, .vdz-road { animation: none; }
  .vdz-road { display: none; }
}
`

/** Blink interval per configured hazard speed ('slow'|'normal'|'fast'). */
const HAZARD_BLINK_SECONDS = { slow: 1.6, normal: 1, fast: 0.5 }

/** Paint palette per body style (light sheen / mid coat / dark shadow / line). */
const PAINT = {
  truck: { light: '#93c5fd', mid: '#3b82f6', dark: '#1e3a8a', line: '#172554' },
  mixer: { light: '#ffffff', mid: '#e2e8f0', dark: '#94a3b8', line: '#475569' },
  pump: { light: '#e2e8f0', mid: '#94a3b8', dark: '#475569', line: '#1f2937' },
  bus: { light: '#67e8f9', mid: '#0891b2', dark: '#155e75', line: '#083344' },
  pickup: { light: '#93c5fd', mid: '#2563eb', dark: '#1e3a8a', line: '#172554' },
  trailer: { light: '#d4d4d8', mid: '#71717a', dark: '#3f3f46', line: '#18181b' },
  loader: { light: '#fcd34d', mid: '#f59e0b', dark: '#b45309', line: '#78350f' },
  van: { light: '#a5b4fc', mid: '#6366f1', dark: '#3730a3', line: '#1e1b4b' },
}

function paint(body) {
  return PAINT[body] || PAINT.truck
}

/* ── Shared per-instance defs (shadows, glass, chrome, lights, cab paint) ──── */

function SharedFx({ uid, p }) {
  return (
    <defs>
      <filter id={`${uid}-drop`} x="-30%" y="-20%" width="160%" height="150%">
        <feDropShadow dx="3" dy="5" stdDeviation="4" floodColor="#000" floodOpacity="0.45" />
      </filter>
      <filter id={`${uid}-blur`} x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="3.2" />
      </filter>
      {/* Glass + reflection sweep */}
      <linearGradient id={`${uid}-glass`} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#dbeafe" stopOpacity="0.95" />
        <stop offset="40%" stopColor="#93c5fd" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.6" />
      </linearGradient>
      <linearGradient id={`${uid}-glassR`} x1="0%" y1="0%" x2="60%" y2="60%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      {/* Chrome */}
      <linearGradient id={`${uid}-chrome`} x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#f1f5f9" />
        <stop offset="40%" stopColor="#94a3b8" />
        <stop offset="100%" stopColor="#475569" />
      </linearGradient>
      {/* Lamp glows */}
      <radialGradient id={`${uid}-hl`} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fffde7" />
        <stop offset="60%" stopColor="#fef08a" />
        <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.6" />
      </radialGradient>
      <radialGradient id={`${uid}-brake`} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fee2e2" />
        <stop offset="60%" stopColor="#fca5a5" />
        <stop offset="100%" stopColor="#ef4444" stopOpacity="0.7" />
      </radialGradient>
      <radialGradient id={`${uid}-beaconGlow`} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fdba74" stopOpacity="0.9" />
        <stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
      </radialGradient>
      {/* Cab paint: radial light falloff + cylindrical hood sheen */}
      <radialGradient id={`${uid}-cab`} cx="48%" cy="32%" r="64%">
        <stop offset="0%" stopColor={p.light} />
        <stop offset="55%" stopColor={p.mid} />
        <stop offset="100%" stopColor={p.dark} />
      </radialGradient>
      <linearGradient id={`${uid}-hood`} x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor={p.dark} />
        <stop offset="30%" stopColor={p.mid} />
        <stop offset="50%" stopColor={p.light} />
        <stop offset="70%" stopColor={p.mid} />
        <stop offset="100%" stopColor={p.dark} />
      </linearGradient>
    </defs>
  )
}

/** Soft blurred ground shadow under the whole chassis. */
function GroundShadow({ uid, hull }) {
  return (
    <ellipse cx="100" cy={hull.y + hull.h + 5} rx="80" ry="9"
      fill="rgba(0,0,0,0.35)" filter={`url(#${uid}-blur)`} />
  )
}

/** Animated road-speed dashes beside the vehicle (only while hazards are OFF). */
function RoadMotion({ cab, viewH }) {
  const y1 = Math.max(-2, cab.y - 6)
  return (
    <g>
      {[2, 198].map((x) => (
        <line key={x} className="vdz-road" x1={x} y1={y1} x2={x} y2={viewH}
          stroke="#64748b" strokeWidth="1.6" strokeLinecap="round"
          strokeDasharray="7 9" opacity="0.3" />
      ))}
    </g>
  )
}

function HazardLights({ cab, hull, speed = 'normal' }) {
  const top = cab.y + 3
  const bottom = hull.y + hull.h - 3
  const xL = cab.x + 4
  const xR = cab.x + cab.w - 4
  const dur = HAZARD_BLINK_SECONDS[speed] || HAZARD_BLINK_SECONDS.normal
  return (
    <g className="vdz-hazard" style={{ animationDuration: `${dur}s` }}>
      {[[xL, top], [xR, top], [xL, bottom], [xR, bottom]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="4.5" fill="#f59e0b" opacity="0.25" />
          <circle cx={x} cy={y} r="2.6" fill="#fbbf24" stroke="#b45309" strokeWidth="0.5" />
          <circle cx={x - 0.8} cy={y - 0.8} r="0.8" fill="#fef3c7" opacity="0.9" />
        </g>
      ))}
    </g>
  )
}

/** Soft white headlight beams at the cab front (vehicle front = top). */
function Headlights({ cab, uid }) {
  const y = cab.y + 1
  const xs = [cab.x + 13, cab.x + cab.w - 13]
  return (
    <g>
      {xs.map((x, i) => (
        <g key={i}>
          <path d={`M ${x - 3},${y} L ${x + 3},${y} L ${x + 7},${y - 12} L ${x - 7},${y - 12} Z`}
            fill="#f8fafc" opacity="0.2" />
          <rect x={x - 3.5} y={y - 1.5} width="7" height="3.5" rx="1.2"
            fill={`url(#${uid}-hl)`} stroke="#64748b" strokeWidth="0.5" />
        </g>
      ))}
    </g>
  )
}

/** Rear amber work-light glow at the back of the hull. */
function WorkLight({ hull }) {
  const cx = hull.x + hull.w / 2
  const y = hull.y + hull.h
  return (
    <g>
      <ellipse cx={cx} cy={y + 4} rx="17" ry="7" fill="#fbbf24" opacity="0.22" />
      <ellipse cx={cx} cy={y + 3} rx="9" ry="4" fill="#fde68a" opacity="0.3" />
      <rect x={cx - 4.5} y={y - 2} width="9" height="4" rx="1.2"
        fill="#fde68a" stroke="#b45309" strokeWidth="0.5" />
    </g>
  )
}

/** Small LIFT pills over each lifted axle line. */
function LiftMarkers({ markers }) {
  if (!Array.isArray(markers) || markers.length === 0) return null
  return (
    <g>
      {markers.map((m, i) => (
        <g key={i} opacity="0.92">
          <rect x="87" y={m.y - 4.5} width="26" height="9" rx="3.5"
            fill="#0f172a" stroke="#f97316" strokeWidth="0.6" />
          <text x="100" y={m.y + 1.7} textAnchor="middle" fontSize="4.6"
            fontWeight="800" fill="#fdba74" letterSpacing="0.6">LIFT</text>
        </g>
      ))}
    </g>
  )
}

function Beacon({ cab, uid }) {
  const cx = cab.x + cab.w / 2
  const cy = cab.y + 12
  return (
    <g>
      <circle className="vdz-beacon" cx={cx} cy={cy} r="7" fill={`url(#${uid}-beaconGlow)`} />
      <circle cx={cx} cy={cy} r="3.2" fill="#f97316" stroke="#7c2d12" strokeWidth="0.6" />
      <circle cx={cx - 1} cy={cy - 1} r="1" fill="#fed7aa" />
    </g>
  )
}

/* ── Cab (front unit): bumper + grille, headlights, hood sheen, glass, roof ── */

function Cab3D({ cab, uid, p, merged = false }) {
  if (merged) return null
  const { x, y, w, h } = cab
  const bumperH = 6
  const inner = h - bumperH
  const hoodH = Math.max(8, Math.round(inner * 0.34))
  const glassH = Math.max(6, Math.round(inner * 0.2))
  const hoodY = y + bumperH
  const glassY = hoodY + hoodH
  const roofY = glassY + glassH
  const roofH = Math.max(4, y + h - roofY)
  const mid = x + w / 2
  return (
    <g>
      {/* Painted body base */}
      <rect x={x} y={y} width={w} height={h} rx="9"
        fill={`url(#${uid}-cab)`} stroke={p.line} strokeWidth="1" />

      {/* Front bumper: chrome bar + grille slats */}
      <rect x={x + 2} y={y} width={w - 4} height={bumperH} rx="3" fill={`url(#${uid}-chrome)`} />
      <rect x={x + 16} y={y + 1.5} width={w - 32} height="3.2" rx="1.4" fill="#111827" />
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1={x + 22 + (i * (w - 44)) / 4} y1={y + 1.5}
          x2={x + 22 + (i * (w - 44)) / 4} y2={y + 4.7}
          stroke="#374151" strokeWidth="0.7" />
      ))}
      {/* Headlights + DRL strip */}
      <rect x={x + 3} y={y + 1} width="11" height="4.4" rx="1.6" fill={`url(#${uid}-hl)`} />
      <rect x={x + w - 14} y={y + 1} width="11" height="4.4" rx="1.6" fill={`url(#${uid}-hl)`} />
      <rect x={x + 2} y={y + bumperH - 0.6} width={w - 4} height="1.5" rx="0.7"
        fill="#fbbf24" opacity="0.7" />

      {/* Hood: cylindrical sheen + centre crease */}
      <rect x={x + 3} y={hoodY + 1} width={w - 6} height={Math.max(4, hoodH - 2)} rx="3"
        fill={`url(#${uid}-hood)`} />
      <line x1={mid} y1={hoodY + 2} x2={mid} y2={hoodY + hoodH - 1.5}
        stroke={p.light} strokeWidth="0.7" opacity="0.6" />
      <line x1={x + 10} y1={hoodY + 2} x2={x + 10} y2={hoodY + hoodH - 1.5}
        stroke={p.dark} strokeWidth="0.5" opacity="0.5" />
      <line x1={x + w - 10} y1={hoodY + 2} x2={x + w - 10} y2={hoodY + hoodH - 1.5}
        stroke={p.dark} strokeWidth="0.5" opacity="0.5" />

      {/* Windshield with reflection sweep + wipers */}
      <path d={`M ${x + 6},${glassY} L ${x + w - 6},${glassY} L ${x + w - 10},${glassY + glassH} L ${x + 10},${glassY + glassH} Z`}
        fill={`url(#${uid}-glass)`} />
      <path d={`M ${x + 9},${glassY + 1} L ${x + w * 0.55},${glassY + 1} L ${mid},${glassY + glassH * 0.55} L ${x + 11},${glassY + glassH * 0.55} Z`}
        fill={`url(#${uid}-glassR)`} opacity="0.6" />
      <line x1={x + w * 0.32} y1={glassY + glassH - 1} x2={x + w * 0.48} y2={glassY + 1.5}
        stroke="#334155" strokeWidth="0.7" opacity="0.7" />
      <line x1={x + w * 0.68} y1={glassY + glassH - 1} x2={x + w * 0.52} y2={glassY + 1.5}
        stroke="#334155" strokeWidth="0.7" opacity="0.7" />
      {/* A-pillars */}
      <path d={`M ${x + 4},${glassY + glassH + 1} L ${x + 6.5},${glassY}`}
        stroke={p.dark} strokeWidth="2.2" strokeLinecap="round" />
      <path d={`M ${x + w - 4},${glassY + glassH + 1} L ${x + w - 6.5},${glassY}`}
        stroke={p.dark} strokeWidth="2.2" strokeLinecap="round" />

      {/* Roof panel: shade + highlight strip, door seam + chrome handles */}
      <rect x={x + 4} y={roofY + 1} width={w - 8} height={Math.max(2, roofH - 3)} rx="3"
        fill={p.dark} opacity="0.35" />
      <rect x={x + 11} y={roofY + 2.5} width={w - 22} height="3" rx="1.5"
        fill={p.light} opacity="0.35" />
      <line x1={mid} y1={roofY + 1.5} x2={mid} y2={y + h - 2}
        stroke={p.line} strokeWidth="1" opacity="0.8" />
      <rect x={mid - 12} y={roofY + Math.max(3, roofH * 0.45)} width="8" height="2.4" rx="1.2"
        fill={`url(#${uid}-chrome)`} />
      <rect x={mid + 4} y={roofY + Math.max(3, roofH * 0.45)} width="8" height="2.4" rx="1.2"
        fill={`url(#${uid}-chrome)`} />

      {/* Side mirrors on stalks */}
      <line x1={x - 2} y1={glassY + 1.5} x2={x + 1} y2={glassY + 2.5} stroke={p.line} strokeWidth="1.2" />
      <line x1={x + w + 2} y1={glassY + 1.5} x2={x + w - 1} y2={glassY + 2.5} stroke={p.line} strokeWidth="1.2" />
      <rect x={x - 10} y={glassY - 1} width="9" height="4.6" rx="1.8"
        fill={p.mid} stroke={p.line} strokeWidth="0.5" />
      <rect x={x + w + 1} y={glassY - 1} width="9" height="4.6" rx="1.8"
        fill={p.mid} stroke={p.line} strokeWidth="0.5" />
    </g>
  )
}

/* ── Hulls (rear unit) per body style ──────────────────────────────────────── */

function TruckHull({ hull, uid }) {
  const { x, y, w, h } = hull
  const ribs = Math.max(3, Math.floor(h / 22))
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-cargo`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="18%" stopColor="#e2e8f0" />
          <stop offset="50%" stopColor="#f8fafc" />
          <stop offset="82%" stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
      </defs>
      {/* Ribbed cargo box */}
      <rect x={x} y={y} width={w} height={h} rx="3"
        fill={`url(#${uid}-cargo)`} stroke="#334155" strokeWidth="1" />
      <rect x={x} y={y} width="4.5" height={h} fill="#cbd5e1" />
      <rect x={x + w - 4.5} y={y} width="4.5" height={h} fill="#cbd5e1" />
      {Array.from({ length: ribs }, (_, i) => (
        <line key={i} x1={x + 5} x2={x + w - 5}
          y1={y + ((i + 1) * h) / (ribs + 1)} y2={y + ((i + 1) * h) / (ribs + 1)}
          stroke="#94a3b8" strokeWidth="0.9" opacity="0.7" />
      ))}
      {/* Roof sheen sweep */}
      <rect x={x + 8} y={y + 3} width={w * 0.32} height={Math.max(4, h - 6)} rx="2"
        fill="#ffffff" opacity="0.12" />
      {/* Rear bumper, brake lights, plate */}
      <rect x={x + 3} y={y + h - 1} width={w - 6} height="6" rx="2" fill={`url(#${uid}-chrome)`} />
      <rect x={x + 4} y={y + h} width="13" height="4" rx="1.5" fill={`url(#${uid}-brake)`} />
      <rect x={x + w - 17} y={y + h} width="13" height="4" rx="1.5" fill={`url(#${uid}-brake)`} />
      <rect x={x + w / 2 - 12} y={y + h - 5} width="24" height="5" rx="1"
        fill="#f1f5f9" stroke="#94a3b8" strokeWidth="0.5" />
    </g>
  )
}

function MixerHull({ hull, uid }) {
  const { x, y, w, h } = hull
  const cx = x + w / 2
  const cy = y + h / 2
  const rx = Math.min(34, w / 2 - 6)
  const ry = Math.max(20, h / 2 - 6)
  return (
    <g>
      <defs>
        <radialGradient id={`${uid}-drum`} cx="40%" cy="32%" r="68%">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="45%" stopColor="#cbd5e1" />
          <stop offset="80%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#64748b" />
        </radialGradient>
        <linearGradient id={`${uid}-rail`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="50%" stopColor="#334155" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <clipPath id={`${uid}-drumClip`}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
        </clipPath>
      </defs>
      {/* Chassis frame: rails + cross members */}
      <rect x={x + 7} y={y} width="9" height={h} rx="2" fill={`url(#${uid}-rail)`} />
      <rect x={x + w - 16} y={y} width="9" height={h} rx="2" fill={`url(#${uid}-rail)`} />
      {[0.14, 0.5, 0.86].map((p2, i) => (
        <rect key={i} x={x + 14} y={y + h * p2 - 2} width={w - 28} height="4" rx="1"
          fill="#1e293b" opacity="0.85" />
      ))}
      {/* Drum: shadow + metallic barrel + rotating helix stripes + highlight */}
      <ellipse cx={cx + 1.5} cy={cy + 2} rx={rx} ry={ry} fill="rgba(0,0,0,0.35)" />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry}
        fill={`url(#${uid}-drum)`} stroke="#334155" strokeWidth="1.2" />
      <g clipPath={`url(#${uid}-drumClip)`}>
        <g className="vdz-drum">
          {[0, 45, 90, 135].map((deg) => (
            <rect key={deg} x={cx - rx - 6} y={cy - 2.4} width={(rx + 6) * 2} height="4.8" rx="2"
              fill="#475569" opacity="0.45" transform={`rotate(${deg} ${cx} ${cy})`} />
          ))}
        </g>
        <ellipse cx={cx - rx * 0.35} cy={cy - ry * 0.42} rx={rx * 0.5} ry={ry * 0.32}
          fill="#ffffff" opacity="0.22" />
      </g>
      {/* Charge collar */}
      <ellipse cx={cx} cy={cy} rx={rx * 0.34} ry={ry * 0.3}
        fill="#64748b" stroke="#1e293b" strokeWidth="0.8" />
      <ellipse cx={cx - rx * 0.08} cy={cy - ry * 0.07} rx={rx * 0.15} ry={ry * 0.12}
        fill="#94a3b8" />
      {/* Rear hopper + chute */}
      <path d={`M ${cx - 13},${y + h - 8} L ${cx + 13},${y + h - 8} L ${cx + 7},${y + h + 3} L ${cx - 7},${y + h + 3} Z`}
        fill={`url(#${uid}-rail)`} stroke="#0f172a" strokeWidth="0.8" />
      <rect x={cx - 3} y={y + h + 2} width="6" height="4.5" rx="1.5" fill="#334155" />
    </g>
  )
}

function PumpHull({ hull, uid }) {
  const { x, y, w, h } = hull
  const cx = x + w / 2
  const cy = y + h / 2
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-deck`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1f2937" />
          <stop offset="30%" stopColor="#4b5563" />
          <stop offset="50%" stopColor="#6b7280" />
          <stop offset="70%" stopColor="#4b5563" />
          <stop offset="100%" stopColor="#1f2937" />
        </linearGradient>
        <linearGradient id={`${uid}-boom`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#b45309" />
          <stop offset="35%" stopColor="#f59e0b" />
          <stop offset="50%" stopColor="#fcd34d" />
          <stop offset="65%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
      </defs>
      {/* Working deck */}
      <rect x={x} y={y} width={w} height={h} rx="4"
        fill={`url(#${uid}-deck)`} stroke="#111827" strokeWidth="1" />
      {/* Outriggers: legs + chequered pads */}
      {[[x, y + 8, -1], [x + w, y + 8, 1], [x, y + h - 14, -1], [x + w, y + h - 14, 1]].map(([ox, oy, dir], i) => (
        <g key={i}>
          <line x1={ox} y1={oy + 2.5} x2={ox + dir * 11} y2={oy + 2.5}
            stroke="#4b5563" strokeWidth="4" strokeLinecap="round" />
          <rect x={ox + dir * 11 - 4} y={oy - 1.5} width="8" height="8" rx="1.5"
            fill={`url(#${uid}-chrome)`} stroke="#1f2937" strokeWidth="0.6" />
          <path d={`M ${ox + dir * 11 - 2.5},${oy} L ${ox + dir * 11 + 2.5},${oy + 5} M ${ox + dir * 11 + 2.5},${oy} L ${ox + dir * 11 - 2.5},${oy + 5}`}
            stroke="#1f2937" strokeWidth="0.6" />
        </g>
      ))}
      {/* Folded boom sections + hinge pins */}
      <rect x={cx - 6} y={y + 5} width="12" height={Math.max(8, h - 10)} rx="3.5"
        fill={`url(#${uid}-boom)`} stroke="#78350f" strokeWidth="0.8" />
      <rect x={cx - 14} y={y + 11} width="8" height={Math.max(6, h - 22)} rx="3"
        fill={`url(#${uid}-boom)`} stroke="#78350f" strokeWidth="0.6" opacity="0.95" />
      <rect x={cx + 6} y={y + 11} width="8" height={Math.max(6, h - 22)} rx="3"
        fill={`url(#${uid}-boom)`} stroke="#78350f" strokeWidth="0.6" opacity="0.95" />
      {[y + 9, y + h - 9].map((py, i) => (
        <circle key={i} cx={cx} cy={py} r="2.6" fill="#374151" stroke="#111827" strokeWidth="0.7" />
      ))}
      {/* Slewing turret */}
      <circle cx={cx} cy={cy} r="7" fill={`url(#${uid}-chrome)`} stroke="#1f2937" strokeWidth="1" />
      <circle cx={cx} cy={cy} r="2.5" fill="#111827" />
    </g>
  )
}

function BusHull({ cab, hull, uid }) {
  const x = cab.x
  const w = cab.w
  const y = cab.y
  const h = hull.y + hull.h - cab.y
  const winTop = y + 26
  const winBottom = y + h - 16
  const n = Math.max(3, Math.floor((winBottom - winTop) / 20))
  return (
    <g>
      <defs>
        <radialGradient id={`${uid}-busBody`} cx="48%" cy="28%" r="70%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="45%" stopColor="#0891b2" />
          <stop offset="100%" stopColor="#155e75" />
        </radialGradient>
      </defs>
      {/* Full-length body */}
      <rect x={x} y={y} width={w} height={h} rx="13"
        fill={`url(#${uid}-busBody)`} stroke="#083344" strokeWidth="1" />
      {/* Windshield + sweep */}
      <path d={`M ${x + 6},${y + 5} L ${x + w - 6},${y + 5} L ${x + w - 9},${y + 16} L ${x + 9},${y + 16} Z`}
        fill={`url(#${uid}-glass)`} />
      <path d={`M ${x + 9},${y + 6} L ${x + w * 0.55},${y + 6} L ${x + w * 0.48},${y + 12} L ${x + 11},${y + 12} Z`}
        fill={`url(#${uid}-glassR)`} opacity="0.6" />
      {/* Roof panel + AC pod + hatches */}
      <rect x={x + 14} y={y + h * 0.3} width={w - 28} height={h * 0.4} rx="5"
        fill="#155e75" opacity="0.65" />
      <rect x={x + w / 2 - 9} y={y + h * 0.4} width="18" height="11" rx="2.5"
        fill="#a5f3fc" opacity="0.35" stroke="#083344" strokeWidth="0.5" />
      <rect x={x + w / 2 - 6} y={y + h * 0.62} width="12" height="7" rx="2"
        fill="#0e7490" stroke="#083344" strokeWidth="0.5" />
      {/* Per-window side panes */}
      {Array.from({ length: n }, (_, i) => {
        const wy = winTop + (i * (winBottom - winTop)) / n
        return (
          <g key={i}>
            <rect x={x + 2.5} y={wy} width="6.5" height="13" rx="2"
              fill={`url(#${uid}-glass)`} opacity="0.85" stroke="#083344" strokeWidth="0.4" />
            <rect x={x + w - 9} y={wy} width="6.5" height="13" rx="2"
              fill={`url(#${uid}-glass)`} opacity="0.85" stroke="#083344" strokeWidth="0.4" />
          </g>
        )
      })}
      {/* Rear engine vents + brake lights */}
      {[0, 1, 2].map((i) => (
        <line key={i} x1={x + 18} x2={x + w - 18} y1={y + h - 11 + i * 3} y2={y + h - 11 + i * 3}
          stroke="#083344" strokeWidth="0.8" opacity="0.6" />
      ))}
      <rect x={x + 4} y={y + h - 4} width="12" height="3.5" rx="1.5" fill={`url(#${uid}-brake)`} />
      <rect x={x + w - 16} y={y + h - 4} width="12" height="3.5" rx="1.5" fill={`url(#${uid}-brake)`} />
    </g>
  )
}

function PickupHull({ hull, uid }) {
  const { x, y, w, h } = hull
  const ribs = Math.max(3, Math.floor(h / 18))
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-bed`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1e3a8a" />
          <stop offset="30%" stopColor="#1d4ed8" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="70%" stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </linearGradient>
      </defs>
      {/* Open bed */}
      <rect x={x} y={y} width={w} height={h} rx="4"
        fill={`url(#${uid}-bed)`} stroke="#172554" strokeWidth="1" />
      <rect x={x + 5} y={y + 4} width={w - 10} height={Math.max(6, h - 14)} rx="2.5"
        fill="#0f172a" opacity="0.9" />
      {Array.from({ length: ribs }, (_, i) => (
        <line key={i} x1={x + 7} x2={x + w - 7}
          y1={y + 7 + ((i + 1) * (h - 18)) / (ribs + 1)} y2={y + 7 + ((i + 1) * (h - 18)) / (ribs + 1)}
          stroke="#1e293b" strokeWidth="0.8" opacity="0.8" />
      ))}
      {/* Bed rails */}
      <rect x={x} y={y} width="4.5" height={h} rx="2" fill="#1d4ed8" opacity="0.95" />
      <rect x={x + w - 4.5} y={y} width="4.5" height={h} rx="2" fill="#1d4ed8" opacity="0.95" />
      {/* Tailgate + chrome handle + brake lights */}
      <rect x={x + 3} y={y + h - 8} width={w - 6} height="6.5" rx="1.5"
        fill={`url(#${uid}-bed)`} stroke="#172554" strokeWidth="0.8" />
      <rect x={x + w / 2 - 5} y={y + h - 6.2} width="10" height="2.6" rx="1.2"
        fill={`url(#${uid}-chrome)`} />
      <rect x={x + 3} y={y + h - 0.5} width="12" height="3.5" rx="1.5" fill={`url(#${uid}-brake)`} />
      <rect x={x + w - 15} y={y + h - 0.5} width="12" height="3.5" rx="1.5" fill={`url(#${uid}-brake)`} />
    </g>
  )
}

function TrailerHull({ hull, uid }) {
  const { x, y, w, h } = hull
  const planks = Math.max(4, Math.floor(h / 16))
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-deckZ`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3f3f46" />
          <stop offset="30%" stopColor="#71717a" />
          <stop offset="50%" stopColor="#a1a1aa" />
          <stop offset="70%" stopColor="#71717a" />
          <stop offset="100%" stopColor="#3f3f46" />
        </linearGradient>
      </defs>
      {/* Flat deck + rave rails + plank lines */}
      <rect x={x + 1} y={y} width={w - 2} height={h} rx="2"
        fill={`url(#${uid}-deckZ)`} stroke="#18181b" strokeWidth="1" />
      <rect x={x + 1} y={y} width="3.5" height={h} fill="#52525b" />
      <rect x={x + w - 4.5} y={y} width="3.5" height={h} fill="#52525b" />
      {Array.from({ length: planks }, (_, i) => (
        <line key={i} x1={x + 5} x2={x + w - 5}
          y1={y + ((i + 1) * h) / (planks + 1)} y2={y + ((i + 1) * h) / (planks + 1)}
          stroke="#52525b" strokeWidth="0.8" opacity="0.7" />
      ))}
      {/* Kingpin plate */}
      <circle cx={x + w / 2} cy={y + 9} r="5.5" fill={`url(#${uid}-chrome)`}
        stroke="#18181b" strokeWidth="1" />
      <circle cx={x + w / 2} cy={y + 9} r="1.8" fill="#18181b" />
      {/* Twist locks with slot */}
      {[[x + 4, y + 3], [x + w - 9, y + 3], [x + 4, y + h - 8], [x + w - 9, y + h - 8]].map(([tx, ty], i) => (
        <g key={i}>
          <rect x={tx} y={ty} width="5" height="5" rx="1.2"
            fill="#facc15" stroke="#a16207" strokeWidth="0.5" />
          <line x1={tx + 1} y1={ty + 2.5} x2={tx + 4} y2={ty + 2.5}
            stroke="#713f12" strokeWidth="0.8" />
        </g>
      ))}
      {/* Side marker lamps */}
      {[0.3, 0.55, 0.8].map((p2, i) => (
        <g key={i}>
          <circle cx={x + 2.5} cy={y + h * p2} r="1.2" fill="#fbbf24" opacity="0.9" />
          <circle cx={x + w - 2.5} cy={y + h * p2} r="1.2" fill="#fbbf24" opacity="0.9" />
        </g>
      ))}
      {/* Rear underride bar + brake lights */}
      <rect x={x + 6} y={y + h - 0.5} width={w - 12} height="3" rx="1.2" fill="#27272a" />
      <rect x={x + 4} y={y + h - 1} width="10" height="4" rx="1.5" fill={`url(#${uid}-brake)`} />
      <rect x={x + w - 14} y={y + h - 1} width="10" height="4" rx="1.5" fill={`url(#${uid}-brake)`} />
    </g>
  )
}

function LoaderHull({ cab, hull, uid }) {
  const { x, y, w, h } = hull
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-bucket`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f1f5f9" />
          <stop offset="55%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
        <radialGradient id={`${uid}-ldr`} cx="48%" cy="35%" r="62%">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="55%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b45309" />
        </radialGradient>
      </defs>
      {/* Bucket ahead of the cab, with cutting-edge teeth */}
      <path d={`M ${cab.x - 12},${cab.y - 6} L ${cab.x + cab.w + 12},${cab.y - 6} L ${cab.x + cab.w + 2},${cab.y + 9} L ${cab.x - 2},${cab.y + 9} Z`}
        fill={`url(#${uid}-bucket)`} stroke="#334155" strokeWidth="1" />
      {[0, 1, 2, 3, 4].map((i) => {
        const tx = cab.x - 8 + (i * (cab.w + 16)) / 4
        return (
          <path key={i} d={`M ${tx - 2.5},${cab.y - 6} L ${tx},${cab.y - 10.5} L ${tx + 2.5},${cab.y - 6} Z`}
            fill="#64748b" stroke="#334155" strokeWidth="0.5" />
        )
      })}
      {/* Lift arms along the cab sides */}
      <line x1={cab.x - 4} y1={cab.y + 7} x2={cab.x + 6} y2={y + 2}
        stroke="#b45309" strokeWidth="3.5" strokeLinecap="round" />
      <line x1={cab.x + cab.w + 4} y1={cab.y + 7} x2={cab.x + cab.w - 6} y2={y + 2}
        stroke="#b45309" strokeWidth="3.5" strokeLinecap="round" />
      {/* Articulation joint */}
      <circle cx={x + w / 2} cy={y + 3.5} r="6" fill={`url(#${uid}-chrome)`}
        stroke="#1f2937" strokeWidth="1" />
      <circle cx={x + w / 2} cy={y + 3.5} r="2" fill="#111827" />
      {/* Engine deck + vents + fenders + counterweight */}
      <rect x={x + 5} y={y + 9} width={w - 10} height={Math.max(10, h - 14)} rx="6"
        fill={`url(#${uid}-ldr)`} stroke="#78350f" strokeWidth="1" />
      {[0, 1, 2].map((i) => (
        <line key={i} x1={x + 16} x2={x + w - 16}
          y1={y + 14 + i * 4} y2={y + 14 + i * 4}
          stroke="#92400e" strokeWidth="1" opacity="0.7" />
      ))}
      <rect x={x + 1} y={y + Math.max(9, h * 0.35)} width="5" height={Math.min(16, h * 0.4)} rx="2.5"
        fill="#78350f" opacity="0.9" />
      <rect x={x + w - 6} y={y + Math.max(9, h * 0.35)} width="5" height={Math.min(16, h * 0.4)} rx="2.5"
        fill="#78350f" opacity="0.9" />
      <rect x={x + 9} y={y + h - 5} width={w - 18} height="5" rx="2"
        fill="#451a03" stroke="#78350f" strokeWidth="0.6" />
      <circle cx={x + w - 13} cy={y + 12} r="2.2" fill="#374151" stroke="#111827" strokeWidth="0.6" />
    </g>
  )
}

function VanHull({ cab, hull, uid }) {
  const x = cab.x
  const w = cab.w
  const y = cab.y
  const h = hull.y + hull.h - cab.y
  const seamY = y + Math.max(24, h * 0.32)
  return (
    <g>
      <defs>
        <radialGradient id={`${uid}-vanBody`} cx="48%" cy="28%" r="70%">
          <stop offset="0%" stopColor="#a5b4fc" />
          <stop offset="50%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#3730a3" />
        </radialGradient>
      </defs>
      {/* Panel body */}
      <rect x={x} y={y} width={w} height={h} rx="14"
        fill={`url(#${uid}-vanBody)`} stroke="#1e1b4b" strokeWidth="1" />
      {/* Windshield + sweep */}
      <path d={`M ${x + 6},${y + 5} L ${x + w - 6},${y + 5} L ${x + w - 10},${y + 17} L ${x + 10},${y + 17} Z`}
        fill={`url(#${uid}-glass)`} />
      <path d={`M ${x + 9},${y + 6} L ${x + w * 0.55},${y + 6} L ${x + w * 0.48},${y + 13} L ${x + 11},${y + 13} Z`}
        fill={`url(#${uid}-glassR)`} opacity="0.6" />
      {/* Roof rails + recessed cargo panel */}
      <line x1={x + 9} y1={seamY + 4} x2={x + 9} y2={y + h - 12} stroke="#312e81" strokeWidth="1.4" opacity="0.9" />
      <line x1={x + w - 9} y1={seamY + 4} x2={x + w - 9} y2={y + h - 12} stroke="#312e81" strokeWidth="1.4" opacity="0.9" />
      <rect x={x + 13} y={seamY + 7} width={w - 26} height={Math.max(8, h - (seamY - y) - 22)} rx="4"
        fill="#3730a3" opacity="0.8" />
      <rect x={x + 16} y={seamY + 9} width={(w - 32) * 0.4} height={Math.max(5, h - (seamY - y) - 26)} rx="3"
        fill="#a5b4fc" opacity="0.14" />
      {/* B-pillar seam + sliding-door track and handle (kerbside) */}
      <line x1={x + 4} y1={seamY} x2={x + w - 4} y2={seamY} stroke="#1e1b4b" strokeWidth="1" opacity="0.9" />
      <line x1={x + w - 3.5} y1={seamY + 3} x2={x + w - 3.5} y2={seamY + Math.min(30, h * 0.3)}
        stroke="#1e1b4b" strokeWidth="1.4" />
      <rect x={x + w - 7.5} y={seamY + 5} width="5" height="2.4" rx="1.2" fill={`url(#${uid}-chrome)`} />
      {/* Rear barn doors + brake lights */}
      <line x1={x + w / 2} y1={y + h - 10} x2={x + w / 2} y2={y + h - 1} stroke="#1e1b4b" strokeWidth="1" />
      <rect x={x + 4} y={y + h - 4} width="11" height="3.5" rx="1.5" fill={`url(#${uid}-brake)`} />
      <rect x={x + w - 15} y={y + h - 4} width="11" height="3.5" rx="1.5" fill={`url(#${uid}-brake)`} />
    </g>
  )
}

const MERGED_BODIES = new Set(['bus', 'van'])

export default function CustomBody({ spec }) {
  const uid = `vdz${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  if (!spec) return null
  const { body, cab, hull, accents = {} } = spec
  const merged = MERGED_BODIES.has(body)
  const p = paint(body)
  const viewH = spec.viewH || hull.y + hull.h + 20
  return (
    <g>
      <style>{ANIM_CSS}</style>
      <SharedFx uid={uid} p={p} />
      {!accents.hazard && <RoadMotion cab={cab} viewH={viewH} />}
      <GroundShadow uid={uid} hull={hull} />
      <g filter={`url(#${uid}-drop)`}>
        {body === 'bus' && <BusHull cab={cab} hull={hull} uid={uid} />}
        {body === 'van' && <VanHull cab={cab} hull={hull} uid={uid} />}
        <Cab3D cab={cab} uid={uid} p={p} merged={merged} />
        {body === 'truck' && <TruckHull hull={hull} uid={uid} />}
        {body === 'mixer' && <MixerHull hull={hull} uid={uid} />}
        {body === 'pump' && <PumpHull hull={hull} uid={uid} />}
        {body === 'pickup' && <PickupHull hull={hull} uid={uid} />}
        {body === 'trailer' && <TrailerHull hull={hull} uid={uid} />}
        {body === 'loader' && <LoaderHull cab={cab} hull={hull} uid={uid} />}
      </g>
      <LiftMarkers markers={spec.liftMarkers} />
      {accents.headlights && <Headlights cab={cab} uid={uid} />}
      {accents.workLight && <WorkLight hull={hull} />}
      {accents.hazard && <HazardLights cab={cab} hull={hull} speed={accents.hazardSpeed} />}
      {accents.beacon && <Beacon cab={cab} uid={uid} />}
    </g>
  )
}

/**
 * The app's tyre status palette (matches RISK in VehicleTyreDiagram.jsx) so
 * the designer's "Simulate tyre status" preview shows the real live colours.
 */
export const PREVIEW_STATUS_COLORS = {
  good: { rim: '#22c55e', hub: '#15803d' },
  warning: { rim: '#f59e0b', hub: '#b45309' },
  critical: { rim: '#ef4444', hub: '#b91c1c' },
}

/** Dual pairs (outer id + matching inner id) for the axle connector bars. */
function dualPairs(tyres) {
  const byId = new Map(tyres.map((t) => [t.id, t]))
  const pairs = []
  tyres.forEach((t) => {
    if (/^[FR]\d+[LR]o$/.test(t.id)) {
      const inner = byId.get(t.id.slice(0, -1) + 'i')
      if (inner) pairs.push([t, inner])
    }
  })
  return pairs
}

/**
 * Detailed pseudo-3D wheel for the console preview: radial-gradient rubber,
 * tread sipes + shoulder notches, gradient rim with lug dots and a shined hub.
 * All art stays within the slot rect (t.x/t.y/t.w/t.h) so status overlays and
 * future tap targets keep aligning. A `status` ({rim,hub}) tints ring + hub.
 */
function PreviewTyre({ t, uid, status }) {
  const cx = t.x + t.w / 2
  const cy = t.y + t.h / 2
  return (
    <g>
      <ellipse cx={cx + 1.2} cy={cy + 1.8} rx={t.w / 2 + 1} ry={t.h / 2 + 0.5}
        fill="rgba(0,0,0,0.45)" />
      <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={t.w * 0.28}
        fill={`url(#${uid}-rubber)`} stroke={status ? status.rim : '#000'}
        strokeWidth={status ? 1.4 : 0.6} />
      {/* Tread sipes */}
      {[0.18, 0.34, 0.5, 0.66, 0.82].map((pct, i) => (
        <rect key={i} x={t.x + 1.5} y={t.y + t.h * pct} width={t.w - 3} height={t.h * 0.07}
          rx="0.8" fill="#222" opacity="0.75" />
      ))}
      {/* Shoulder notches */}
      {[0.24, 0.56, 0.88].map((pct, i) => (
        <g key={i}>
          <rect x={t.x - 0.5} y={t.y + t.h * pct - t.h * 0.04} width="1.8" height={t.h * 0.08}
            rx="0.6" fill="#0a0a0a" />
          <rect x={t.x + t.w - 1.3} y={t.y + t.h * pct - t.h * 0.04} width="1.8" height={t.h * 0.08}
            rx="0.6" fill="#0a0a0a" />
        </g>
      ))}
      {/* Sidewall highlight */}
      <rect x={t.x + 0.5} y={t.y + 0.5} width={t.w - 1} height={t.h - 1} rx={t.w * 0.26}
        fill="none" stroke="#555" strokeWidth="0.4" opacity="0.5" />
      {/* Rim disc + lug dots + hub */}
      <ellipse cx={cx} cy={cy} rx={t.w * 0.33} ry={t.h * 0.33}
        fill={status ? status.rim : `url(#${uid}-rim)`}
        stroke={status ? status.hub : '#1f2937'} strokeWidth="0.7" />
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const rad = (deg * Math.PI) / 180
        return (
          <circle key={deg} cx={cx + Math.cos(rad) * t.w * 0.21}
            cy={cy + Math.sin(rad) * t.h * 0.21} r="0.9" fill="#111827" opacity="0.8" />
        )
      })}
      <ellipse cx={cx} cy={cy} rx={t.w * 0.13} ry={t.h * 0.13}
        fill={status ? status.hub : `url(#${uid}-hub)`} stroke="#374151" strokeWidth="0.4" />
      <text x={cx} y={cy + 0.4} textAnchor="middle" dominantBaseline="middle"
        fontSize="4.6" fontWeight="800" fill="white"
        style={{ userSelect: 'none', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 0.7 }}>
        {t.label}
      </text>
    </g>
  )
}

/**
 * Standalone preview SVG for the console designer: same viewBox geometry as
 * VehicleTyreDiagram, the shared CustomBody, and detailed 3D wheels rendered
 * from the SAME positionsFromConfig() output the app consumes (exact slot
 * x/y/w/h - only the art inside each slot is richer). Dual pairs get a dark
 * axle-hub connector bar so twins read as one dual assembly.
 *
 * `statuses` (optional, preview-only) is a { tyreId: 'good'|'warning'|
 * 'critical' } map; matching wheels get the app's status ring + hub colour so
 * an admin can see the design under live data. It is never persisted.
 */
export function CustomDiagramPreview({ layout, width = 260, statuses = null }) {
  const uid = `vdp${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  if (!layout) return null
  const { viewH, tyres, bodySpec } = layout
  const scale = width / 200
  return (
    <svg
      viewBox={`-10 -5 220 ${viewH + 10}`}
      width={width}
      height={(viewH + 15) * scale}
      className="overflow-visible"
      role="img"
      aria-label="Vehicle diagram preview"
    >
      <defs>
        <radialGradient id={`${uid}-rubber`} cx="35%" cy="30%" r="65%">
          <stop offset="0%" stopColor="#2d2d2d" />
          <stop offset="70%" stopColor="#111111" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </radialGradient>
        <radialGradient id={`${uid}-rim`} cx="35%" cy="30%" r="65%">
          <stop offset="0%" stopColor="#9ca3af" />
          <stop offset="60%" stopColor="#6b7280" />
          <stop offset="100%" stopColor="#374151" />
        </radialGradient>
        <radialGradient id={`${uid}-hub`} cx="30%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#9ca3af" />
          <stop offset="100%" stopColor="#1f2937" />
        </radialGradient>
      </defs>
      <text x="100" y="-1" textAnchor="middle" fontSize="5.5" fill="#94a3b8"
        fontWeight="600" letterSpacing="1">FRONT</text>
      <CustomBody spec={bodySpec} />
      {/* Dual-pair axle connectors, under the wheels */}
      {dualPairs(tyres).map(([a, b], i) => {
        const x1 = Math.min(a.x, b.x) + a.w * 0.4
        const x2 = Math.max(a.x + a.w, b.x + b.w) - a.w * 0.4
        const cy = a.y + a.h / 2
        return (
          <rect key={i} x={x1} y={cy - 2.4} width={x2 - x1} height="4.8" rx="1.6"
            fill="#1f2937" stroke="#0f172a" strokeWidth="0.5" />
        )
      })}
      {tyres.map((t) => (
        <PreviewTyre key={t.id} t={t} uid={uid}
          status={statuses ? PREVIEW_STATUS_COLORS[statuses[t.id]] : null} />
      ))}
    </svg>
  )
}
