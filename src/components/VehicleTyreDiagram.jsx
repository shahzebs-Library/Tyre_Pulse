import React from 'react';

const RISK_COLOURS = {
  good:     { fill: '#22c55e', stroke: '#16a34a', label: 'Good' },
  warning:  { fill: '#eab308', stroke: '#ca8a04', label: 'Warning' },
  critical: { fill: '#ef4444', stroke: '#dc2626', label: 'Critical' },
  none:     { fill: '#374151', stroke: '#4b5563', label: 'No Data' },
};

function riskColour(risk) {
  return RISK_COLOURS[risk] ?? RISK_COLOURS.none;
}

// Each tyre: { id, x, y, w, h, rx, label }
// Coordinates in a 200x320 viewBox. Vehicle body centred.
const LAYOUTS = {
  Pickup: {
    emoji: '🛻',
    body: { x: 60, y: 40, w: 80, h: 200, rx: 8 },
    tyres: [
      { id: 'FL', x: 35,  y: 55,  w: 22, h: 38, rx: 4, label: 'FL' },
      { id: 'FR', x: 143, y: 55,  w: 22, h: 38, rx: 4, label: 'FR' },
      { id: 'RL', x: 35,  y: 185, w: 22, h: 38, rx: 4, label: 'RL' },
      { id: 'RR', x: 143, y: 185, w: 22, h: 38, rx: 4, label: 'RR' },
    ],
  },
  'Wheel loader': {
    emoji: '🚜',
    body: { x: 60, y: 40, w: 80, h: 200, rx: 8 },
    tyres: [
      { id: 'FL', x: 30,  y: 55,  w: 28, h: 44, rx: 5, label: 'FL' },
      { id: 'FR', x: 142, y: 55,  w: 28, h: 44, rx: 5, label: 'FR' },
      { id: 'RL', x: 30,  y: 185, w: 28, h: 44, rx: 5, label: 'RL' },
      { id: 'RR', x: 142, y: 185, w: 28, h: 44, rx: 5, label: 'RR' },
    ],
  },
  'Skid loader': {
    emoji: '🚜',
    body: { x: 60, y: 40, w: 80, h: 200, rx: 8 },
    tyres: [
      { id: 'FL', x: 30,  y: 55,  w: 28, h: 44, rx: 5, label: 'FL' },
      { id: 'FR', x: 142, y: 55,  w: 28, h: 44, rx: 5, label: 'FR' },
      { id: 'RL', x: 30,  y: 185, w: 28, h: 44, rx: 5, label: 'RL' },
      { id: 'RR', x: 142, y: 185, w: 28, h: 44, rx: 5, label: 'RR' },
    ],
  },
  Canter: {
    emoji: '🚚',
    body: { x: 60, y: 30, w: 80, h: 240, rx: 8 },
    tyres: [
      // Front single
      { id: 'FL', x: 35,  y: 45,  w: 22, h: 36, rx: 4, label: 'FL' },
      { id: 'FR', x: 143, y: 45,  w: 22, h: 36, rx: 4, label: 'FR' },
      // Rear dual left
      { id: 'RLo', x: 22, y: 175, w: 20, h: 34, rx: 3, label: 'RLo' },
      { id: 'RLi', x: 44, y: 175, w: 20, h: 34, rx: 3, label: 'RLi' },
      // Rear dual right
      { id: 'RRi', x: 136, y: 175, w: 20, h: 34, rx: 3, label: 'RRi' },
      { id: 'RRo', x: 158, y: 175, w: 20, h: 34, rx: 3, label: 'RRo' },
    ],
  },
  'Tri-mixer': {
    emoji: '🚛',
    body: { x: 55, y: 20, w: 90, h: 290, rx: 8 },
    tyres: [
      // Front axle 1 single
      { id: 'F1L', x: 28, y: 30,  w: 22, h: 34, rx: 4, label: 'F1L' },
      { id: 'F1R', x: 150,y: 30,  w: 22, h: 34, rx: 4, label: 'F1R' },
      // Front axle 2 single
      { id: 'F2L', x: 28, y: 80,  w: 22, h: 34, rx: 4, label: 'F2L' },
      { id: 'F2R', x: 150,y: 80,  w: 22, h: 34, rx: 4, label: 'F2R' },
      // Rear axle 1 dual
      { id: 'R1Lo', x: 16, y: 170, w: 18, h: 32, rx: 3, label: 'R1Lo' },
      { id: 'R1Li', x: 36, y: 170, w: 18, h: 32, rx: 3, label: 'R1Li' },
      { id: 'R1Ri', x: 146,y: 170, w: 18, h: 32, rx: 3, label: 'R1Ri' },
      { id: 'R1Ro', x: 166,y: 170, w: 18, h: 32, rx: 3, label: 'R1Ro' },
      // Rear axle 2 dual
      { id: 'R2Lo', x: 16, y: 215, w: 18, h: 32, rx: 3, label: 'R2Lo' },
      { id: 'R2Li', x: 36, y: 215, w: 18, h: 32, rx: 3, label: 'R2Li' },
      { id: 'R2Ri', x: 146,y: 215, w: 18, h: 32, rx: 3, label: 'R2Ri' },
      { id: 'R2Ro', x: 166,y: 215, w: 18, h: 32, rx: 3, label: 'R2Ro' },
    ],
  },
  'Concrete pump': {
    emoji: '🏗️',
    body: { x: 55, y: 20, w: 90, h: 310, rx: 8 },
    tyres: [
      // Front single
      { id: 'FL',  x: 28, y: 30,  w: 22, h: 34, rx: 4, label: 'FL'  },
      { id: 'FR',  x: 150,y: 30,  w: 22, h: 34, rx: 4, label: 'FR'  },
      // Rear axle 1 dual
      { id: 'R1Lo', x: 16, y: 130, w: 18, h: 30, rx: 3, label: 'R1Lo' },
      { id: 'R1Li', x: 36, y: 130, w: 18, h: 30, rx: 3, label: 'R1Li' },
      { id: 'R1Ri', x: 146,y: 130, w: 18, h: 30, rx: 3, label: 'R1Ri' },
      { id: 'R1Ro', x: 166,y: 130, w: 18, h: 30, rx: 3, label: 'R1Ro' },
      // Rear axle 2 dual
      { id: 'R2Lo', x: 16, y: 175, w: 18, h: 30, rx: 3, label: 'R2Lo' },
      { id: 'R2Li', x: 36, y: 175, w: 18, h: 30, rx: 3, label: 'R2Li' },
      { id: 'R2Ri', x: 146,y: 175, w: 18, h: 30, rx: 3, label: 'R2Ri' },
      { id: 'R2Ro', x: 166,y: 175, w: 18, h: 30, rx: 3, label: 'R2Ro' },
      // Rear axle 3 dual
      { id: 'R3Lo', x: 16, y: 220, w: 18, h: 30, rx: 3, label: 'R3Lo' },
      { id: 'R3Li', x: 36, y: 220, w: 18, h: 30, rx: 3, label: 'R3Li' },
      { id: 'R3Ri', x: 146,y: 220, w: 18, h: 30, rx: 3, label: 'R3Ri' },
      { id: 'R3Ro', x: 166,y: 220, w: 18, h: 30, rx: 3, label: 'R3Ro' },
    ],
  },
};

/**
 * VehicleTyreDiagram
 *
 * Props:
 *   vehicleType  — string matching a key in LAYOUTS
 *   tyreData     — object keyed by tyre id, e.g. { FL: { risk: 'good', info: '...' } }
 *   onTyreClick  — optional (tyreId, tyreInfo) => void
 *   width        — SVG render width (default 200)
 */
export default function VehicleTyreDiagram({ vehicleType, tyreData = {}, onTyreClick, width = 200 }) {
  const layout = LAYOUTS[vehicleType];

  if (!layout) {
    return (
      <div className="text-gray-400 text-sm italic">
        No diagram available for vehicle type: {vehicleType}
      </div>
    );
  }

  const { body, tyres, emoji } = layout;
  const viewH = body.y + body.h + 40;
  const scale = width / 200;

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Title */}
      <div className="text-sm font-medium text-gray-300 flex items-center gap-1">
        <span>{emoji}</span>
        <span>{vehicleType}</span>
        <span className="text-gray-500">· {tyres.length} tyres</span>
      </div>

      {/* SVG diagram */}
      <svg
        viewBox={`0 0 200 ${viewH}`}
        width={width}
        height={viewH * scale}
        className="overflow-visible"
      >
        {/* Vehicle body */}
        <rect
          x={body.x} y={body.y} width={body.w} height={body.h} rx={body.rx}
          fill="#1f2937" stroke="#374151" strokeWidth="2"
        />
        {/* Centre line */}
        <line
          x1={body.x + body.w / 2} y1={body.y + 10}
          x2={body.x + body.w / 2} y2={body.y + body.h - 10}
          stroke="#374151" strokeWidth="1" strokeDasharray="4 4"
        />

        {/* Tyres */}
        {tyres.map((t) => {
          const td = tyreData[t.id] ?? {};
          const risk = td.risk ?? 'none';
          const col = riskColour(risk);
          const cx = t.x + t.w / 2;
          const cy = t.y + t.h / 2;

          return (
            <g
              key={t.id}
              className={onTyreClick ? 'cursor-pointer' : ''}
              onClick={() => onTyreClick?.(t.id, td)}
            >
              {/* Shadow */}
              <rect
                x={t.x + 2} y={t.y + 2} width={t.w} height={t.h} rx={t.rx}
                fill="rgba(0,0,0,0.4)"
              />
              {/* Tyre body */}
              <rect
                x={t.x} y={t.y} width={t.w} height={t.h} rx={t.rx}
                fill={col.fill} stroke={col.stroke} strokeWidth="1.5"
                opacity="0.9"
              />
              {/* Label */}
              <text
                x={cx} y={cy + 1}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={t.w < 20 ? '5' : '6'}
                fontWeight="600"
                fill="white"
                style={{ userSelect: 'none' }}
              >
                {t.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        {Object.entries(RISK_COLOURS).map(([key, col]) => (
          <div key={key} className="flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: col.fill, border: `1px solid ${col.stroke}` }}
            />
            <span className="text-xs text-gray-400">{col.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
