import React from 'react'

/**
 * CustomBody - SVG renderer for Vehicle Designer layouts (V268).
 *
 * Draws a top-down vehicle body from the pure `bodySpec` emitted by
 * src/lib/vehicleDiagram.js positionsFromConfig(): cab + hull rectangles
 * styled per body style, plus animated accents (blinking hazard indicators
 * with selectable speed, pulsing roof beacon, rotating mixer drum), static
 * glow accents (headlight beams, rear work light) and LIFT axle markers.
 * All animation is CSS keyframes inside the SVG and is disabled under
 * prefers-reduced-motion.
 *
 * Shared by src/components/VehicleTyreDiagram.jsx (custom layouts in the app)
 * and the console Vehicle Designer live preview - do NOT fork this renderer.
 */

const ANIM_CSS = `
@keyframes vdzBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.12; } }
@keyframes vdzPulse {
  0%, 100% { opacity: 0.95; transform: scale(1); }
  50%      { opacity: 0.35; transform: scale(1.55); }
}
@keyframes vdzSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.vdz-hazard { animation: vdzBlink 1s step-end infinite; }
.vdz-beacon { animation: vdzPulse 1.5s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
.vdz-drum   { animation: vdzSpin 7s linear infinite; transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: reduce) {
  .vdz-hazard, .vdz-beacon, .vdz-drum { animation: none; }
}
`

/** Blink interval per configured hazard speed ('slow'|'normal'|'fast'). */
const HAZARD_BLINK_SECONDS = { slow: 1.6, normal: 1, fast: 0.5 }

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
        </g>
      ))}
    </g>
  )
}

/** Soft white headlight beams at the cab front (vehicle front = top). */
function Headlights({ cab }) {
  const y = cab.y + 1
  const xs = [cab.x + 13, cab.x + cab.w - 13]
  return (
    <g>
      {xs.map((x, i) => (
        <g key={i}>
          <path d={`M ${x - 3},${y} L ${x + 3},${y} L ${x + 7},${y - 12} L ${x - 7},${y - 12} Z`}
            fill="#f8fafc" opacity="0.18" />
          <rect x={x - 3.5} y={y - 1.5} width="7" height="3.5" rx="1.2"
            fill="#e0f2fe" stroke="#64748b" strokeWidth="0.5" />
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

function Beacon({ cab }) {
  const cx = cab.x + cab.w / 2
  const cy = cab.y + 12
  return (
    <g>
      <circle className="vdz-beacon" cx={cx} cy={cy} r="6" fill="#fb923c" opacity="0.5" />
      <circle cx={cx} cy={cy} r="3.2" fill="#f97316" stroke="#7c2d12" strokeWidth="0.6" />
      <circle cx={cx - 1} cy={cy - 1} r="1" fill="#fed7aa" />
    </g>
  )
}

function Cab({ cab, merged = false }) {
  if (merged) return null
  return (
    <g>
      <rect x={cab.x} y={cab.y} width={cab.w} height={cab.h} rx="8"
        fill="#1e3a8a" stroke="#0f172a" strokeWidth="1" />
      <rect x={cab.x + 6} y={cab.y + 5} width={cab.w - 12} height="9" rx="3" fill="#93c5fd" opacity="0.85" />
      <rect x={cab.x + 8} y={cab.y + cab.h - 12} width={cab.w - 16} height="7" rx="2" fill="#334155" opacity="0.7" />
      {/* Mirrors */}
      <rect x={cab.x - 9} y={cab.y + 8} width="8" height="4" rx="1.5" fill="#475569" />
      <rect x={cab.x + cab.w + 1} y={cab.y + 8} width="8" height="4" rx="1.5" fill="#475569" />
    </g>
  )
}

function TruckHull({ hull }) {
  const ribs = Math.max(2, Math.floor(hull.h / 26))
  return (
    <g>
      <rect x={hull.x} y={hull.y} width={hull.w} height={hull.h} rx="4"
        fill="#334155" stroke="#0f172a" strokeWidth="1" />
      <rect x={hull.x + 4} y={hull.y + 4} width={hull.w - 8} height={hull.h - 8} rx="3"
        fill="#475569" opacity="0.7" />
      {Array.from({ length: ribs }, (_, i) => (
        <line key={i} x1={hull.x + 5} x2={hull.x + hull.w - 5}
          y1={hull.y + ((i + 1) * hull.h) / (ribs + 1)}
          y2={hull.y + ((i + 1) * hull.h) / (ribs + 1)}
          stroke="#1e293b" strokeWidth="0.8" opacity="0.7" />
      ))}
    </g>
  )
}

function MixerHull({ hull }) {
  const cx = hull.x + hull.w / 2
  const cy = hull.y + hull.h / 2
  const rx = Math.min(34, hull.w / 2 - 6)
  const ry = Math.max(20, hull.h / 2 - 6)
  const clipId = `vdz-drum-clip-${Math.round(hull.y)}`
  return (
    <g>
      {/* Chassis rails */}
      <rect x={hull.x + 8} y={hull.y} width="9" height={hull.h} fill="#1e293b" />
      <rect x={hull.x + hull.w - 17} y={hull.y} width="9" height={hull.h} fill="#1e293b" />
      {/* Drum */}
      <defs>
        <clipPath id={clipId}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
        </clipPath>
      </defs>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#64748b" stroke="#0f172a" strokeWidth="1.2" />
      <g clipPath={`url(#${clipId})`}>
        <g className="vdz-drum">
          {[0, 45, 90, 135].map((deg) => (
            <rect key={deg} x={cx - rx - 6} y={cy - 2} width={(rx + 6) * 2} height="4"
              fill="#94a3b8" opacity="0.55" transform={`rotate(${deg} ${cx} ${cy})`} />
          ))}
        </g>
      </g>
      <ellipse cx={cx} cy={cy} rx={rx * 0.32} ry={ry * 0.28} fill="#475569" stroke="#1e293b" strokeWidth="0.8" />
      {/* Hopper at rear */}
      <path d={`M ${cx - 12},${hull.y + hull.h - 8} L ${cx + 12},${hull.y + hull.h - 8} L ${cx + 7},${hull.y + hull.h + 2} L ${cx - 7},${hull.y + hull.h + 2} Z`}
        fill="#334155" stroke="#0f172a" strokeWidth="0.8" />
    </g>
  )
}

function PumpHull({ hull }) {
  const cx = hull.x + hull.w / 2
  return (
    <g>
      <rect x={hull.x} y={hull.y} width={hull.w} height={hull.h} rx="4"
        fill="#374151" stroke="#0f172a" strokeWidth="1" />
      {/* Outrigger stubs */}
      {[hull.y + 8, hull.y + hull.h - 12].map((y, i) => (
        <g key={i}>
          <rect x={hull.x - 8} y={y} width="10" height="5" rx="1.5" fill="#4b5563" />
          <rect x={hull.x + hull.w - 2} y={y} width="10" height="5" rx="1.5" fill="#4b5563" />
        </g>
      ))}
      {/* Folded boom sections */}
      <rect x={cx - 5} y={hull.y + 6} width="10" height={hull.h - 12} rx="3" fill="#f59e0b" stroke="#92400e" strokeWidth="0.8" />
      <rect x={cx - 12} y={hull.y + 12} width="7" height={hull.h - 24} rx="2.5" fill="#fbbf24" stroke="#92400e" strokeWidth="0.6" />
      <rect x={cx + 5} y={hull.y + 12} width="7" height={hull.h - 24} rx="2.5" fill="#fbbf24" stroke="#92400e" strokeWidth="0.6" />
      <circle cx={cx} cy={hull.y + hull.h / 2} r="5" fill="#475569" stroke="#1f2937" strokeWidth="1" />
    </g>
  )
}

function BusHull({ cab, hull }) {
  const y = cab.y
  const h = hull.y + hull.h - cab.y
  const winRows = Math.max(3, Math.floor(h / 30))
  return (
    <g>
      <rect x={cab.x} y={y} width={cab.w} height={h} rx="12"
        fill="#0e7490" stroke="#083344" strokeWidth="1" />
      <rect x={cab.x + 6} y={y + 5} width={cab.w - 12} height="9" rx="3" fill="#a5f3fc" opacity="0.9" />
      {Array.from({ length: winRows }, (_, i) => {
        const wy = y + 20 + (i * (h - 34)) / winRows
        return (
          <g key={i}>
            <rect x={cab.x + 3} y={wy} width="6" height="14" rx="2" fill="#67e8f9" opacity="0.75" />
            <rect x={cab.x + cab.w - 9} y={wy} width="6" height="14" rx="2" fill="#67e8f9" opacity="0.75" />
          </g>
        )
      })}
      <rect x={cab.x + 14} y={y + h / 2 - 10} width={cab.w - 28} height="20" rx="3" fill="#155e75" opacity="0.8" />
    </g>
  )
}

function PickupHull({ hull }) {
  return (
    <g>
      <rect x={hull.x} y={hull.y} width={hull.w} height={hull.h} rx="5"
        fill="#1d4ed8" stroke="#172554" strokeWidth="1" />
      <rect x={hull.x + 6} y={hull.y + 5} width={hull.w - 12} height={hull.h - 10} rx="3"
        fill="#1e293b" opacity="0.85" />
      <line x1={hull.x + 6} x2={hull.x + hull.w - 6} y1={hull.y + hull.h - 8} y2={hull.y + hull.h - 8}
        stroke="#475569" strokeWidth="1.2" />
    </g>
  )
}

function TrailerHull({ hull }) {
  return (
    <g>
      <rect x={hull.x + 2} y={hull.y} width={hull.w - 4} height={hull.h} rx="2"
        fill="#52525b" stroke="#18181b" strokeWidth="1" />
      <rect x={hull.x + 8} y={hull.y + 6} width={hull.w - 16} height={hull.h - 12} rx="1.5"
        fill="#71717a" opacity="0.7" />
      {/* Kingpin plate */}
      <circle cx={hull.x + hull.w / 2} cy={hull.y + 10} r="5" fill="#3f3f46" stroke="#18181b" strokeWidth="1" />
      {/* Container twist locks */}
      {[[hull.x + 5, hull.y + 4], [hull.x + hull.w - 9, hull.y + 4],
        [hull.x + 5, hull.y + hull.h - 8], [hull.x + hull.w - 9, hull.y + hull.h - 8]].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="4" height="4" rx="1" fill="#facc15" opacity="0.85" />
      ))}
    </g>
  )
}

function LoaderHull({ cab, hull }) {
  return (
    <g>
      {/* Bucket in front of the cab */}
      <path d={`M ${cab.x - 10},${cab.y - 4} L ${cab.x + cab.w + 10},${cab.y - 4} L ${cab.x + cab.w},${cab.y + 8} L ${cab.x},${cab.y + 8} Z`}
        fill="#f59e0b" stroke="#92400e" strokeWidth="1" />
      {/* Articulation joint + engine deck */}
      <circle cx={hull.x + hull.w / 2} cy={hull.y + 4} r="6" fill="#475569" stroke="#1f2937" strokeWidth="1" />
      <rect x={hull.x + 6} y={hull.y + 10} width={hull.w - 12} height={hull.h - 14} rx="6"
        fill="#b45309" stroke="#78350f" strokeWidth="1" />
      <rect x={hull.x + 14} y={hull.y + 16} width={hull.w - 28} height="10" rx="3" fill="#92400e" opacity="0.8" />
    </g>
  )
}

function VanHull({ cab, hull }) {
  const y = cab.y
  const h = hull.y + hull.h - cab.y
  return (
    <g>
      <rect x={cab.x} y={y} width={cab.w} height={h} rx="14"
        fill="#4338ca" stroke="#1e1b4b" strokeWidth="1" />
      <rect x={cab.x + 6} y={y + 5} width={cab.w - 12} height="10" rx="4" fill="#c7d2fe" opacity="0.9" />
      <line x1={cab.x + 4} x2={cab.x + cab.w - 4} y1={y + 24} y2={y + 24} stroke="#312e81" strokeWidth="1" />
      <rect x={cab.x + 10} y={y + 34} width={cab.w - 20} height={h - 44} rx="4" fill="#3730a3" opacity="0.8" />
    </g>
  )
}

const MERGED_BODIES = new Set(['bus', 'van'])

export default function CustomBody({ spec }) {
  if (!spec) return null
  const { body, cab, hull, accents = {} } = spec
  const merged = MERGED_BODIES.has(body)
  return (
    <g>
      <style>{ANIM_CSS}</style>
      {body === 'bus' && <BusHull cab={cab} hull={hull} />}
      {body === 'van' && <VanHull cab={cab} hull={hull} />}
      <Cab cab={cab} merged={merged} />
      {body === 'truck' && <TruckHull hull={hull} />}
      {body === 'mixer' && <MixerHull hull={hull} />}
      {body === 'pump' && <PumpHull hull={hull} />}
      {body === 'pickup' && <PickupHull hull={hull} />}
      {body === 'trailer' && <TrailerHull hull={hull} />}
      {body === 'loader' && <LoaderHull cab={cab} hull={hull} />}
      <LiftMarkers markers={spec.liftMarkers} />
      {accents.headlights && <Headlights cab={cab} />}
      {accents.workLight && <WorkLight hull={hull} />}
      {accents.hazard && <HazardLights cab={cab} hull={hull} speed={accents.hazardSpeed} />}
      {accents.beacon && <Beacon cab={cab} />}
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

/**
 * Standalone preview SVG for the console designer: same viewBox geometry as
 * VehicleTyreDiagram, the shared CustomBody, and simple wheel slots rendered
 * from the SAME positionsFromConfig() output the app consumes.
 *
 * `statuses` (optional, preview-only) is a { tyreId: 'good'|'warning'|
 * 'critical' } map; matching wheels get the app's status ring + hub colour so
 * an admin can see the design under live data. It is never persisted.
 */
export function CustomDiagramPreview({ layout, width = 260, statuses = null }) {
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
      <text x="100" y="-1" textAnchor="middle" fontSize="5.5" fill="#94a3b8"
        fontWeight="600" letterSpacing="1">FRONT</text>
      <CustomBody spec={bodySpec} />
      {tyres.map((t) => {
        const status = statuses ? PREVIEW_STATUS_COLORS[statuses[t.id]] : null
        return (
          <g key={t.id}>
            <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={t.w * 0.28}
              fill="#111111" stroke={status ? status.rim : '#000'}
              strokeWidth={status ? 1.4 : 0.6} />
            {[0.22, 0.42, 0.62, 0.8].map((pct, i) => (
              <rect key={i} x={t.x + 1.5} y={t.y + t.h * pct} width={t.w - 3} height={t.h * 0.08}
                rx="0.8" fill="#2d2d2d" />
            ))}
            <ellipse cx={t.x + t.w / 2} cy={t.y + t.h / 2} rx={t.w * 0.3} ry={t.h * 0.3}
              fill={status ? status.hub : '#6b7280'} stroke={status ? status.rim : '#374151'} strokeWidth="0.6" />
            <text x={t.x + t.w / 2} y={t.y + t.h / 2 + 1} textAnchor="middle" dominantBaseline="middle"
              fontSize="4.6" fontWeight="800" fill="white" style={{ userSelect: 'none' }}>
              {t.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
