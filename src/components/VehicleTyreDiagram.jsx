import React from 'react';

// ── Risk colours ───────────────────────────────────────────────────────────────
const RISK = {
  good:     { rim: '#22c55e', glow: '#16a34a', label: 'Good' },
  warning:  { rim: '#eab308', glow: '#ca8a04', label: 'Warning' },
  critical: { rim: '#ef4444', glow: '#dc2626', label: 'Critical' },
  none:     { rim: '#4b5563', glow: '#374151', label: 'No Data' },
};
function rc(risk) { return RISK[risk] ?? RISK.none; }

// ── Realistic tyre renderer ────────────────────────────────────────────────────
// Draws a top-down tyre: black rubber + tread lines + coloured risk rim
function Tyre({ x, y, w, h, id, risk = 'none', onClick, label }) {
  const col   = rc(risk);
  const cx    = x + w / 2;
  const cy    = y + h / 2;
  const rx    = w / 2 - 2;
  const ry    = h / 2 - 2;
  // Tread line spacing
  const lines = [];
  const step  = h / 5;
  for (let i = 1; i < 5; i++) {
    lines.push(y + i * step);
  }

  return (
    <g
      onClick={() => onClick?.(id)}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      {/* Outer tyre rubber */}
      <rect x={x} y={y} width={w} height={h} rx={w * 0.25} fill="#111827" stroke="#374151" strokeWidth="0.8" />
      {/* Tread grooves */}
      {lines.map((ly, i) => (
        <line key={i} x1={x + 2} y1={ly} x2={x + w - 2} y2={ly}
          stroke="#1f2937" strokeWidth="1.2" />
      ))}
      {/* Risk glow halo */}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry}
        fill="none" stroke={col.glow} strokeWidth="1.8" opacity="0.5" />
      {/* Coloured rim disk */}
      <ellipse cx={cx} cy={cy} rx={rx * 0.55} ry={ry * 0.55}
        fill={col.rim} opacity="0.95" />
      {/* Rim centre bolt */}
      <circle cx={cx} cy={cy} r={Math.min(w, h) * 0.1} fill="#1f2937" />
      {/* Label */}
      <text x={cx} y={cy + 0.5} textAnchor="middle" dominantBaseline="middle"
        fontSize={Math.max(3.5, Math.min(w, 9) * 0.52)}
        fontWeight="700" fill="white" style={{ userSelect: 'none', pointerEvents: 'none' }}>
        {label}
      </text>
    </g>
  );
}

// ── Vehicle body definitions ───────────────────────────────────────────────────
// Each vehicle returns SVG elements for its body + its tyre specs

function PickupBody() {
  return (
    <g>
      {/* Main body silhouette */}
      <path d="M 72,22 Q 60,22 58,34 L 55,70 L 55,270 Q 55,282 72,285 L 128,285 Q 145,282 145,270 L 145,70 L 142,34 Q 140,22 128,22 Z"
        fill="#475569" />
      {/* Hood */}
      <rect x="60" y="22" width="80" height="52" rx="5" fill="#334155" />
      {/* Hood centre crease */}
      <line x1="100" y1="24" x2="100" y2="72" stroke="#1e293b" strokeWidth="1.2" opacity="0.6" />
      {/* Front bumper */}
      <rect x="62" y="14" width="76" height="12" rx="4" fill="#1f2937" />
      {/* Headlights */}
      <rect x="64" y="16" width="20" height="7" rx="2" fill="#fef9c3" opacity="0.9" />
      <rect x="116" y="16" width="20" height="7" rx="2" fill="#fef9c3" opacity="0.9" />
      {/* Headlight inner (DRL) */}
      <rect x="67" y="17.5" width="14" height="4" rx="1" fill="#fde047" opacity="0.7" />
      <rect x="119" y="17.5" width="14" height="4" rx="1" fill="#fde047" opacity="0.7" />
      {/* Windshield */}
      <path d="M 65,74 L 135,74 L 131,93 L 69,93 Z" fill="#bfdbfe" opacity="0.75" />
      {/* Windshield frame */}
      <path d="M 65,74 L 135,74 L 131,93 L 69,93 Z" fill="none" stroke="#1e293b" strokeWidth="1.2" />
      {/* Cab roof interior */}
      <rect x="60" y="93" width="80" height="68" rx="2" fill="#3b4a5c" />
      {/* Headrests */}
      <ellipse cx="82" cy="108" rx="9" ry="6" fill="#2d3a49" />
      <ellipse cx="118" cy="108" rx="9" ry="6" fill="#2d3a49" />
      {/* Steering wheel */}
      <circle cx="85" cy="128" r="7" fill="none" stroke="#1e293b" strokeWidth="2" />
      <circle cx="85" cy="128" r="2" fill="#1e293b" />
      {/* Rear window */}
      <path d="M 67,155 L 133,155 L 131,166 L 69,166 Z" fill="#bfdbfe" opacity="0.6" />
      <path d="M 67,155 L 133,155 L 131,166 L 69,166 Z" fill="none" stroke="#1e293b" strokeWidth="1" />
      {/* Pickup bed */}
      <rect x="59" y="169" width="82" height="108" rx="3" fill="#1e293b" />
      {/* Bed rails */}
      <rect x="59" y="169" width="4" height="108" fill="#334155" />
      <rect x="137" y="169" width="4" height="108" fill="#334155" />
      <rect x="59" y="169" width="82" height="4" fill="#334155" />
      {/* Rear bumper */}
      <rect x="62" y="277" width="76" height="11" rx="4" fill="#1f2937" />
      {/* Brake lights */}
      <rect x="64" y="278" width="18" height="7" rx="2" fill="#fca5a5" opacity="0.8" />
      <rect x="118" y="278" width="18" height="7" rx="2" fill="#fca5a5" opacity="0.8" />
      {/* Side mirrors */}
      <rect x="43" y="62" width="13" height="6" rx="2" fill="#374151" />
      <rect x="144" y="62" width="13" height="6" rx="2" fill="#374151" />
      {/* Mirror stems */}
      <line x1="56" y1="65" x2="60" y2="68" stroke="#374151" strokeWidth="1.5" />
      <line x1="144" y1="68" x2="140" y2="68" stroke="#374151" strokeWidth="1.5" />
    </g>
  );
}

function CanterBody() {
  return (
    <g>
      {/* Body silhouette */}
      <path d="M 68,18 Q 56,18 55,30 L 53,110 L 53,268 Q 53,280 70,283 L 130,283 Q 147,280 147,268 L 147,110 L 145,30 Q 144,18 132,18 Z"
        fill="#475569" />
      {/* Cab section background */}
      <rect x="57" y="18" width="86" height="100" rx="5" fill="#334155" />
      {/* Front bumper + bull bar */}
      <rect x="60" y="10" width="80" height="12" rx="3" fill="#1f2937" />
      <rect x="68" y="11" width="64" height="3" rx="1" fill="#374151" />
      {/* Headlights */}
      <rect x="61" y="12" width="22" height="8" rx="2" fill="#fef9c3" opacity="0.9" />
      <rect x="117" y="12" width="22" height="8" rx="2" fill="#fef9c3" opacity="0.9" />
      <rect x="64" y="13.5" width="15" height="4" rx="1" fill="#fde047" opacity="0.7" />
      <rect x="121" y="13.5" width="15" height="4" rx="1" fill="#fde047" opacity="0.7" />
      {/* Hood */}
      <rect x="60" y="22" width="80" height="40" rx="3" fill="#2d3a4a" />
      <line x1="100" y1="24" x2="100" y2="60" stroke="#1e293b" strokeWidth="1" opacity="0.5" />
      {/* Windshield */}
      <path d="M 63,62 L 137,62 L 133,78 L 67,78 Z" fill="#bfdbfe" opacity="0.75" />
      <path d="M 63,62 L 137,62 L 133,78 L 67,78 Z" fill="none" stroke="#1e293b" strokeWidth="1" />
      {/* Cab interior */}
      <rect x="57" y="78" width="86" height="40" rx="2" fill="#3b4a5c" />
      <ellipse cx="84" cy="90" rx="9" ry="6" fill="#2d3a49" />
      <ellipse cx="116" cy="90" rx="9" ry="6" fill="#2d3a49" />
      <circle cx="87" cy="108" r="7" fill="none" stroke="#1e293b" strokeWidth="2" />
      {/* Rear cab panel */}
      <rect x="57" y="115" width="86" height="5" rx="1" fill="#1e293b" />
      {/* Cargo box */}
      <rect x="56" y="120" width="88" height="155" rx="3" fill="#3d4f63" />
      {/* Cargo box sides */}
      <rect x="56" y="120" width="5" height="155" fill="#2d3a49" />
      <rect x="139" y="120" width="5" height="155" fill="#2d3a49" />
      <rect x="56" y="120" width="88" height="5" fill="#2d3a49" />
      {/* Cargo box floor panels */}
      <line x1="61" y1="160" x2="139" y2="160" stroke="#2d3a49" strokeWidth="1" />
      <line x1="61" y1="200" x2="139" y2="200" stroke="#2d3a49" strokeWidth="1" />
      <line x1="61" y1="240" x2="139" y2="240" stroke="#2d3a49" strokeWidth="1" />
      {/* Rear bumper */}
      <rect x="60" y="275" width="80" height="10" rx="3" fill="#1f2937" />
      <rect x="62" y="276" width="18" height="7" rx="2" fill="#fca5a5" opacity="0.8" />
      <rect x="120" y="276" width="18" height="7" rx="2" fill="#fca5a5" opacity="0.8" />
      {/* Mirrors */}
      <rect x="40" y="52" width="14" height="7" rx="2" fill="#374151" />
      <rect x="146" y="52" width="14" height="7" rx="2" fill="#374151" />
    </g>
  );
}

function TriMixerBody() {
  return (
    <g>
      {/* Main body */}
      <path d="M 68,15 Q 56,15 55,28 L 53,105 L 53,310 Q 53,322 70,325 L 130,325 Q 147,322 147,310 L 147,105 L 145,28 Q 144,15 132,15 Z"
        fill="#475569" />
      {/* Cab */}
      <rect x="57" y="15" width="86" height="98" rx="5" fill="#334155" />
      {/* Front bumper */}
      <rect x="60" y="7" width="80" height="12" rx="3" fill="#1f2937" />
      <rect x="61" y="8" width="22" height="8" rx="2" fill="#fef9c3" opacity="0.9" />
      <rect x="117" y="8" width="22" height="8" rx="2" fill="#fef9c3" opacity="0.9" />
      <rect x="64" y="9.5" width="15" height="4" rx="1" fill="#fde047" opacity="0.7" />
      <rect x="121" y="9.5" width="15" height="4" rx="1" fill="#fde047" opacity="0.7" />
      {/* Hood */}
      <rect x="60" y="19" width="80" height="38" rx="3" fill="#2d3a4a" />
      <line x1="100" y1="21" x2="100" y2="55" stroke="#1e293b" strokeWidth="1" opacity="0.5" />
      {/* Windshield */}
      <path d="M 63,57 L 137,57 L 133,73 L 67,73 Z" fill="#bfdbfe" opacity="0.75" />
      <path d="M 63,57 L 137,57 L 133,73 L 67,73 Z" fill="none" stroke="#1e293b" strokeWidth="1" />
      {/* Cab interior */}
      <rect x="57" y="73" width="86" height="38" rx="2" fill="#3b4a5c" />
      <ellipse cx="84" cy="85" rx="9" ry="6" fill="#2d3a49" />
      <ellipse cx="116" cy="85" rx="9" ry="6" fill="#2d3a49" />
      <circle cx="87" cy="103" r="7" fill="none" stroke="#1e293b" strokeWidth="2" />
      {/* Cab rear wall */}
      <rect x="57" y="108" width="86" height="5" rx="1" fill="#1e293b" />
      {/* Chassis frame */}
      <rect x="68" y="113" width="12" height="200" fill="#2d3a49" />
      <rect x="120" y="113" width="12" height="200" fill="#2d3a49" />
      {/* Mixer drum — oval/cylindrical from top */}
      <ellipse cx="100" cy="220" rx="40" ry="90" fill="#64748b" />
      <ellipse cx="100" cy="220" rx="40" ry="90" fill="none" stroke="#475569" strokeWidth="2" />
      {/* Drum spiral fins (top-down shows as curved lines) */}
      <path d="M 64,170 Q 100,185 136,170" fill="none" stroke="#475569" strokeWidth="1.5" opacity="0.7" />
      <path d="M 62,195 Q 100,212 138,195" fill="none" stroke="#475569" strokeWidth="1.5" opacity="0.7" />
      <path d="M 61,220 Q 100,237 139,220" fill="none" stroke="#475569" strokeWidth="1.5" opacity="0.7" />
      <path d="M 62,245 Q 100,262 138,245" fill="none" stroke="#475569" strokeWidth="1.5" opacity="0.7" />
      <path d="M 64,268 Q 100,284 136,268" fill="none" stroke="#475569" strokeWidth="1.5" opacity="0.7" />
      {/* Drum centre hub */}
      <circle cx="100" cy="220" r="10" fill="#374151" stroke="#475569" strokeWidth="1.5" />
      <circle cx="100" cy="220" r="4" fill="#1e293b" />
      {/* Rear chassis */}
      <rect x="56" y="310" width="88" height="15" rx="3" fill="#334155" />
      <rect x="60" y="312" width="80" height="10" rx="2" fill="#1f2937" />
      <rect x="62" y="313" width="18" height="7" rx="2" fill="#fca5a5" opacity="0.8" />
      <rect x="120" y="313" width="18" height="7" rx="2" fill="#fca5a5" opacity="0.8" />
      {/* Mirrors */}
      <rect x="40" y="47" width="14" height="7" rx="2" fill="#374151" />
      <rect x="146" y="47" width="14" height="7" rx="2" fill="#374151" />
    </g>
  );
}

function ConcretePumpBody() {
  return (
    <g>
      {/* Body */}
      <path d="M 68,15 Q 56,15 55,28 L 53,108 L 53,320 Q 53,332 70,335 L 130,335 Q 147,332 147,320 L 147,108 L 145,28 Q 144,15 132,15 Z"
        fill="#475569" />
      {/* Cab */}
      <rect x="57" y="15" width="86" height="100" rx="5" fill="#334155" />
      {/* Front bumper */}
      <rect x="60" y="7" width="80" height="12" rx="3" fill="#1f2937" />
      <rect x="61" y="8" width="22" height="8" rx="2" fill="#fef9c3" opacity="0.9" />
      <rect x="117" y="8" width="22" height="8" rx="2" fill="#fef9c3" opacity="0.9" />
      <rect x="64" y="9.5" width="15" height="4" rx="1" fill="#fde047" opacity="0.7" />
      <rect x="121" y="9.5" width="15" height="4" rx="1" fill="#fde047" opacity="0.7" />
      {/* Hood */}
      <rect x="60" y="19" width="80" height="40" rx="3" fill="#2d3a4a" />
      <line x1="100" y1="21" x2="100" y2="57" stroke="#1e293b" strokeWidth="1" opacity="0.5" />
      {/* Windshield */}
      <path d="M 63,59 L 137,59 L 133,75 L 67,75 Z" fill="#bfdbfe" opacity="0.75" />
      <path d="M 63,59 L 137,59 L 133,75 L 67,75 Z" fill="none" stroke="#1e293b" strokeWidth="1" />
      {/* Cab interior */}
      <rect x="57" y="75" width="86" height="40" rx="2" fill="#3b4a5c" />
      <ellipse cx="84" cy="87" rx="9" ry="6" fill="#2d3a49" />
      <ellipse cx="116" cy="87" rx="9" ry="6" fill="#2d3a49" />
      <circle cx="87" cy="105" r="7" fill="none" stroke="#1e293b" strokeWidth="2" />
      {/* Cab rear wall */}
      <rect x="57" y="112" width="86" height="5" rx="1" fill="#1e293b" />
      {/* Outrigger base plates */}
      <rect x="30" y="145" width="20" height="16" rx="3" fill="#334155" stroke="#475569" strokeWidth="1" />
      <rect x="150" y="145" width="20" height="16" rx="3" fill="#334155" stroke="#475569" strokeWidth="1" />
      <rect x="30" y="240" width="20" height="16" rx="3" fill="#334155" stroke="#475569" strokeWidth="1" />
      <rect x="150" y="240" width="20" height="16" rx="3" fill="#334155" stroke="#475569" strokeWidth="1" />
      {/* Outrigger arms */}
      <rect x="50" y="150" width="18" height="5" fill="#475569" />
      <rect x="132" y="150" width="18" height="5" fill="#475569" />
      <rect x="50" y="245" width="18" height="5" fill="#475569" />
      <rect x="132" y="245" width="18" height="5" fill="#475569" />
      {/* Pump body */}
      <rect x="57" y="117" width="86" height="210" rx="4" fill="#3d4f63" />
      {/* Pump hopper (top-down: large rectangular opening) */}
      <rect x="65" y="130" width="70" height="60" rx="4" fill="#1e293b" stroke="#475569" strokeWidth="1" />
      <text x="100" y="162" textAnchor="middle" fontSize="7" fill="#64748b" fontWeight="600">HOPPER</text>
      {/* Pump cylinders */}
      <rect x="70" y="200" width="25" height="40" rx="3" fill="#2d3a49" />
      <rect x="105" y="200" width="25" height="40" rx="3" fill="#2d3a49" />
      <circle cx="82" cy="220" r="8" fill="#374151" stroke="#4b5563" strokeWidth="1" />
      <circle cx="117" cy="220" r="8" fill="#374151" stroke="#4b5563" strokeWidth="1" />
      {/* Boom arm base (folded, top-down shows as rectangle) */}
      <rect x="68" y="248" width="64" height="30" rx="4" fill="#475569" stroke="#374151" strokeWidth="1" />
      <line x1="100" y1="248" x2="100" y2="278" stroke="#374151" strokeWidth="1.5" />
      {/* Rear bumper */}
      <rect x="60" y="326" width="80" height="10" rx="3" fill="#1f2937" />
      <rect x="62" y="327" width="18" height="7" rx="2" fill="#fca5a5" opacity="0.8" />
      <rect x="120" y="327" width="18" height="7" rx="2" fill="#fca5a5" opacity="0.8" />
      {/* Mirrors */}
      <rect x="40" y="49" width="14" height="7" rx="2" fill="#374151" />
      <rect x="146" y="49" width="14" height="7" rx="2" fill="#374151" />
    </g>
  );
}

function WheelLoaderBody({ compact }) {
  // Wheel loaders are articulated — front half (bucket + front axle) + rear half (cab + rear axle)
  // Top-down view: wide squat body, bucket at front
  return (
    <g>
      {/* Rear body (cab) */}
      <rect x="55" y="105" width="90" height="120" rx="8" fill="#475569" />
      {/* Articulation joint */}
      <rect x="68" y="98" width="64" height="14" rx="3" fill="#334155" />
      <circle cx="100" cy="105" r="6" fill="#1e293b" />
      {/* Front body (loader arm base) */}
      <rect x="58" y="25" width="84" height="80" rx="6" fill="#3d4f63" />
      {/* Bucket arms (lift linkage, top-down) */}
      <rect x="62" y="15" width="15" height="70" rx="3" fill="#334155" />
      <rect x="123" y="15" width="15" height="70" rx="3" fill="#334155" />
      {/* Bucket */}
      <path d="M 48,8 L 152,8 L 148,22 L 52,22 Z" fill="#1f2937" stroke="#374151" strokeWidth="1.2" />
      <rect x="52" y="10" width="96" height="10" rx="2" fill="#2d3a49" />
      {/* Bucket cutting edge */}
      <rect x="50" y="6" width="100" height="5" rx="1" fill="#374151" />
      {/* Engine hood */}
      <rect x="62" y="120" width="76" height="60" rx="4" fill="#334155" />
      <line x1="100" y1="122" x2="100" y2="178" stroke="#1e293b" strokeWidth="1" opacity="0.5" />
      {/* Cab windows */}
      <rect x="65" y="112" width="70" height="8" rx="2" fill="#bfdbfe" opacity="0.6" />
      {/* ROPS frame top-down */}
      <rect x="63" y="110" width="74" height="50" rx="3" fill="#3b4a5c" />
      <ellipse cx="82" cy="128" rx="9" ry="6" fill="#2d3a49" />
      <ellipse cx="118" cy="128" rx="9" ry="6" fill="#2d3a49" />
      <circle cx="85" cy="148" r="7" fill="none" stroke="#1e293b" strokeWidth="2" />
      {/* Rear counterweight */}
      <rect x="60" y="218" width="80" height="12" rx="4" fill="#1f2937" />
      <rect x="62" y="219" width="76" height="9" rx="3" fill="#374151" />
      {/* Exhaust stack (top-down: small circle) */}
      <circle cx="120" cy="128" r="4" fill="#1e293b" stroke="#4b5563" strokeWidth="0.8" />
    </g>
  );
}

// ── Layout definitions ─────────────────────────────────────────────────────────
const LAYOUTS = {
  Pickup: {
    emoji: '🛻', viewH: 310,
    Body: PickupBody,
    tyres: [
      { id: 'FL', x: 33,  y: 50,  w: 22, h: 42, label: 'FL' },
      { id: 'FR', x: 145, y: 50,  w: 22, h: 42, label: 'FR' },
      { id: 'RL', x: 33,  y: 193, w: 22, h: 42, label: 'RL' },
      { id: 'RR', x: 145, y: 193, w: 22, h: 42, label: 'RR' },
    ],
  },
  'Wheel loader': {
    emoji: '🚜', viewH: 250,
    Body: WheelLoaderBody,
    tyres: [
      { id: 'FL', x: 26,  y: 28,  w: 28, h: 50, label: 'FL' },
      { id: 'FR', x: 146, y: 28,  w: 28, h: 50, label: 'FR' },
      { id: 'RL', x: 26,  y: 160, w: 28, h: 50, label: 'RL' },
      { id: 'RR', x: 146, y: 160, w: 28, h: 50, label: 'RR' },
    ],
  },
  'Skid loader': {
    emoji: '🚜', viewH: 250,
    Body: WheelLoaderBody,
    tyres: [
      { id: 'FL', x: 26,  y: 28,  w: 28, h: 50, label: 'FL' },
      { id: 'FR', x: 146, y: 28,  w: 28, h: 50, label: 'FR' },
      { id: 'RL', x: 26,  y: 160, w: 28, h: 50, label: 'RL' },
      { id: 'RR', x: 146, y: 160, w: 28, h: 50, label: 'RR' },
    ],
  },
  Canter: {
    emoji: '🚚', viewH: 300,
    Body: CanterBody,
    tyres: [
      { id: 'FL',  x: 32,  y: 38,  w: 22, h: 38, label: 'FL'  },
      { id: 'FR',  x: 146, y: 38,  w: 22, h: 38, label: 'FR'  },
      { id: 'RLo', x: 18,  y: 172, w: 20, h: 36, label: 'RLo' },
      { id: 'RLi', x: 40,  y: 172, w: 20, h: 36, label: 'RLi' },
      { id: 'RRi', x: 140, y: 172, w: 20, h: 36, label: 'RRi' },
      { id: 'RRo', x: 162, y: 172, w: 20, h: 36, label: 'RRo' },
    ],
  },
  'Tri-mixer': {
    emoji: '🚛', viewH: 345,
    Body: TriMixerBody,
    tyres: [
      { id: 'F1L',  x: 31,  y: 26,  w: 20, h: 36, label: 'F1L'  },
      { id: 'F1R',  x: 149, y: 26,  w: 20, h: 36, label: 'F1R'  },
      { id: 'F2L',  x: 31,  y: 76,  w: 20, h: 36, label: 'F2L'  },
      { id: 'F2R',  x: 149, y: 76,  w: 20, h: 36, label: 'F2R'  },
      { id: 'R1Lo', x: 16,  y: 170, w: 18, h: 33, label: 'R1Lo' },
      { id: 'R1Li', x: 36,  y: 170, w: 18, h: 33, label: 'R1Li' },
      { id: 'R1Ri', x: 146, y: 170, w: 18, h: 33, label: 'R1Ri' },
      { id: 'R1Ro', x: 166, y: 170, w: 18, h: 33, label: 'R1Ro' },
      { id: 'R2Lo', x: 16,  y: 216, w: 18, h: 33, label: 'R2Lo' },
      { id: 'R2Li', x: 36,  y: 216, w: 18, h: 33, label: 'R2Li' },
      { id: 'R2Ri', x: 146, y: 216, w: 18, h: 33, label: 'R2Ri' },
      { id: 'R2Ro', x: 166, y: 216, w: 18, h: 33, label: 'R2Ro' },
    ],
  },
  'Concrete pump': {
    emoji: '🏗️', viewH: 350,
    Body: ConcretePumpBody,
    tyres: [
      { id: 'FL',   x: 31,  y: 26,  w: 20, h: 36, label: 'FL'   },
      { id: 'FR',   x: 149, y: 26,  w: 20, h: 36, label: 'FR'   },
      { id: 'R1Lo', x: 16,  y: 130, w: 18, h: 31, label: 'R1Lo' },
      { id: 'R1Li', x: 36,  y: 130, w: 18, h: 31, label: 'R1Li' },
      { id: 'R1Ri', x: 146, y: 130, w: 18, h: 31, label: 'R1Ri' },
      { id: 'R1Ro', x: 166, y: 130, w: 18, h: 31, label: 'R1Ro' },
      { id: 'R2Lo', x: 16,  y: 174, w: 18, h: 31, label: 'R2Lo' },
      { id: 'R2Li', x: 36,  y: 174, w: 18, h: 31, label: 'R2Li' },
      { id: 'R2Ri', x: 146, y: 174, w: 18, h: 31, label: 'R2Ri' },
      { id: 'R2Ro', x: 166, y: 174, w: 18, h: 31, label: 'R2Ro' },
      { id: 'R3Lo', x: 16,  y: 218, w: 18, h: 31, label: 'R3Lo' },
      { id: 'R3Li', x: 36,  y: 218, w: 18, h: 31, label: 'R3Li' },
      { id: 'R3Ri', x: 146, y: 218, w: 18, h: 31, label: 'R3Ri' },
      { id: 'R3Ro', x: 166, y: 218, w: 18, h: 31, label: 'R3Ro' },
    ],
  },
};

// ── Main Component ─────────────────────────────────────────────────────────────
export default function VehicleTyreDiagram({ vehicleType, tyreData = {}, onTyreClick, width = 220 }) {
  const layout = LAYOUTS[vehicleType];

  if (!layout) {
    return (
      <div className="text-gray-400 text-sm italic">
        No diagram available for: {vehicleType}
      </div>
    );
  }

  const { emoji, viewH, Body, tyres } = layout;
  const scale = width / 200;

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Title */}
      <div className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
        <span>{emoji}</span>
        <span>{vehicleType}</span>
        <span className="text-gray-500 font-normal">· {tyres.length} tyres</span>
      </div>

      {/* SVG */}
      <svg
        viewBox={`0 0 200 ${viewH}`}
        width={width}
        height={viewH * scale}
        className="overflow-visible drop-shadow-xl"
      >
        {/* Ground shadow */}
        <ellipse cx="100" cy={viewH - 8} rx="70" ry="8" fill="rgba(0,0,0,0.25)" />

        {/* Vehicle body */}
        <Body />

        {/* Tyres rendered on top of body */}
        {tyres.map(t => (
          <Tyre
            key={t.id}
            {...t}
            risk={tyreData[t.id]?.risk ?? 'none'}
            onClick={onTyreClick}
          />
        ))}

        {/* Direction arrow */}
        <g opacity="0.35">
          <polygon points="100,4 104,12 100,10 96,12" fill="#94a3b8" />
          <text x="100" y="3" textAnchor="middle" fontSize="5" fill="#94a3b8">▲ FRONT</text>
        </g>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {Object.entries(RISK).map(([key, col]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full border"
              style={{ background: col.rim, borderColor: col.glow }} />
            <span className="text-xs text-gray-400">{col.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
