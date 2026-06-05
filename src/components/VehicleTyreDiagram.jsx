import { useState } from 'react'

const VEHICLE_ICONS = {
  'Pickup':        '🛻',
  'Tri-mixer':     '🚛',
  'Concrete pump': '🏗️',
  'Canter':        '🚚',
  'Wheel loader':  '🚜',
  'Skid loader':   '🚜',
}

function riskColor(riskLevel) {
  const map = { Low: '#16a34a', Medium: '#ca8a04', High: '#ea580c', Critical: '#dc2626' }
  return map[riskLevel] ?? '#374151'
}

function getLayout(vehicleType) {
  const emoji = VEHICLE_ICONS[vehicleType] ?? '🚗'

  if (vehicleType === 'Pickup' || vehicleType === 'Wheel loader' || vehicleType === 'Skid loader') {
    return {
      viewBox: '0 0 280 280',
      bodyRect: { x: 80, y: 40, width: 120, height: 200 },
      emoji,
      axles: [90, 190],
      tyrePositions: [
        { id: 'FL', label: 'FL', x: 58,  y: 90  },
        { id: 'FR', label: 'FR', x: 222, y: 90  },
        { id: 'RL', label: 'RL', x: 58,  y: 190 },
        { id: 'RR', label: 'RR', x: 222, y: 190 },
      ],
    }
  }

  if (vehicleType === 'Canter') {
    return {
      viewBox: '0 0 280 280',
      bodyRect: { x: 80, y: 40, width: 120, height: 200 },
      emoji,
      axles: [90, 190],
      tyrePositions: [
        { id: 'FL',  label: 'FL',  x: 58,  y: 90  },
        { id: 'FR',  label: 'FR',  x: 222, y: 90  },
        { id: 'RLO', label: 'RLO', x: 46,  y: 190 },
        { id: 'RLI', label: 'RLI', x: 68,  y: 190 },
        { id: 'RRI', label: 'RRI', x: 212, y: 190 },
        { id: 'RRO', label: 'RRO', x: 234, y: 190 },
      ],
    }
  }

  if (vehicleType === 'Tri-mixer') {
    const axleYs = [70, 140, 240, 320]
    return {
      viewBox: '0 0 280 400',
      bodyRect: { x: 80, y: 40, width: 120, height: 320 },
      emoji,
      axles: axleYs,
      tyrePositions: [
        { id: 'FL1',  label: 'FL1',  x: 58,  y: axleYs[0] },
        { id: 'FR1',  label: 'FR1',  x: 222, y: axleYs[0] },
        { id: 'FL2',  label: 'FL2',  x: 58,  y: axleYs[1] },
        { id: 'FR2',  label: 'FR2',  x: 222, y: axleYs[1] },
        { id: 'RLO3', label: 'RLO3', x: 46,  y: axleYs[2] },
        { id: 'RLI3', label: 'RLI3', x: 68,  y: axleYs[2] },
        { id: 'RRI3', label: 'RRI3', x: 212, y: axleYs[2] },
        { id: 'RRO3', label: 'RRO3', x: 234, y: axleYs[2] },
        { id: 'RLO4', label: 'RLO4', x: 46,  y: axleYs[3] },
        { id: 'RLI4', label: 'RLI4', x: 68,  y: axleYs[3] },
        { id: 'RRI4', label: 'RRI4', x: 212, y: axleYs[3] },
        { id: 'RRO4', label: 'RRO4', x: 234, y: axleYs[3] },
      ],
    }
  }

  if (vehicleType === 'Concrete pump') {
    const axleYs = [70, 160, 250, 340]
    return {
      viewBox: '0 0 280 400',
      bodyRect: { x: 80, y: 40, width: 120, height: 320 },
      emoji,
      axles: axleYs,
      tyrePositions: [
        { id: 'FL1',  label: 'FL1',  x: 58,  y: axleYs[0] },
        { id: 'FR1',  label: 'FR1',  x: 222, y: axleYs[0] },
        { id: 'RLO2', label: 'RLO2', x: 46,  y: axleYs[1] },
        { id: 'RLI2', label: 'RLI2', x: 68,  y: axleYs[1] },
        { id: 'RRI2', label: 'RRI2', x: 212, y: axleYs[1] },
        { id: 'RRO2', label: 'RRO2', x: 234, y: axleYs[1] },
        { id: 'RLO3', label: 'RLO3', x: 46,  y: axleYs[2] },
        { id: 'RLI3', label: 'RLI3', x: 68,  y: axleYs[2] },
        { id: 'RRI3', label: 'RRI3', x: 212, y: axleYs[2] },
        { id: 'RRO3', label: 'RRO3', x: 234, y: axleYs[2] },
        { id: 'RLO4', label: 'RLO4', x: 46,  y: axleYs[3] },
        { id: 'RLI4', label: 'RLI4', x: 68,  y: axleYs[3] },
        { id: 'RRI4', label: 'RRI4', x: 212, y: axleYs[3] },
        { id: 'RRO4', label: 'RRO4', x: 234, y: axleYs[3] },
      ],
    }
  }

  return getLayout('Pickup')
}

export default function VehicleTyreDiagram({ positions = [], vehicleType = 'Pickup', onPositionClick }) {
  const [tooltip, setTooltip] = useState(null)

  const layout = getLayout(vehicleType)

  function getPositionData(posId) {
    return positions.find(p => p.position === posId) || {}
  }

  return (
    <div className="relative inline-block">
      <svg viewBox={layout.viewBox} className="w-full max-w-xs">
        <rect
          x={layout.bodyRect.x}
          y={layout.bodyRect.y}
          width={layout.bodyRect.width}
          height={layout.bodyRect.height}
          rx="8"
          fill="#1f2937"
          stroke="#374151"
          strokeWidth="2"
        />

        {layout.axles.map((y, i) => (
          <line
            key={i}
            x1={layout.bodyRect.x}
            x2={layout.bodyRect.x + layout.bodyRect.width}
            y1={y}
            y2={y}
            stroke="#4b5563"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
        ))}

        {layout.tyrePositions.map(tp => {
          const data  = getPositionData(tp.id)
          const color = riskColor(data.risk_level)
          const hasData = !!data.risk_level
          return (
            <g
              key={tp.id}
              onClick={() => onPositionClick?.(data)}
              style={{ cursor: onPositionClick ? 'pointer' : 'default' }}
              onMouseEnter={() => setTooltip({ ...tp, ...data })}
              onMouseLeave={() => setTooltip(null)}
            >
              <title>{tp.id}{data.brand ? ` · ${data.brand}` : ''}{data.risk_level ? ` · ${data.risk_level}` : ' · No data'}</title>
              <circle
                cx={tp.x}
                cy={tp.y}
                r={12}
                fill={color}
                stroke={hasData ? color : '#6b7280'}
                strokeWidth="2"
                opacity={hasData ? 1 : 0.4}
              />
              <text
                x={tp.x}
                y={tp.y + 22}
                textAnchor="middle"
                fill="#9ca3af"
                fontSize="8"
                fontFamily="monospace"
              >
                {tp.label}
              </text>
            </g>
          )
        })}

        <text
          x={layout.bodyRect.x + layout.bodyRect.width / 2}
          y={layout.bodyRect.y + 24}
          textAnchor="middle"
          fontSize="20"
        >
          {layout.emoji}
        </text>
      </svg>

      {tooltip && (
        <div
          className="absolute z-10 bg-gray-800 border border-gray-600 rounded-lg p-2 text-xs pointer-events-none"
          style={{ top: 0, right: '-180px', width: 170 }}
        >
          <p className="font-semibold text-white">{tooltip.label} · {tooltip.id}</p>
          <p className="text-gray-400 mt-1">Brand: {tooltip.brand || 'No data'}</p>
          <p className="text-gray-400">S/N: {tooltip.serial_no || '—'}</p>
          <p style={{ color: riskColor(tooltip.risk_level) }}>
            Risk: {tooltip.risk_level || 'No data'}
          </p>
        </div>
      )}
    </div>
  )
}
