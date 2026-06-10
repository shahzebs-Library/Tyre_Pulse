import React from 'react';

// ── Vehicle type normaliser — maps any DB/prop value to a LAYOUTS key ──────────
function resolveVehicleType(vt) {
  if (!vt) return 'Pickup'
  if (LAYOUTS[vt]) return vt                                             // exact match
  const s = vt.toLowerCase().trim()
  if (s.includes('tri') || s.includes('mixer'))            return 'Tri-mixer'
  if (s.includes('concrete') || s.includes('pump'))        return 'Concrete pump'
  if (s.includes('wheel') && s.includes('load'))           return 'Wheel loader'
  if (s.includes('skid'))                                  return 'Skid loader'
  if (s.includes('canter'))                                return 'Canter'
  if (s.includes('bus'))                                   return 'Bus'
  if (s.includes('tata'))                                  return 'Tata'
  if (s.includes('ashok') || s.includes('leyland'))        return 'Ashok Leyland'
  return 'Pickup'
}

// ── Risk colours ───────────────────────────────────────────────────────────────
const RISK = {
  good:     { rim: '#22c55e', glow: '#16a34a', dark: '#15803d', label: 'Good' },
  warning:  { rim: '#f59e0b', glow: '#d97706', dark: '#b45309', label: 'Warning' },
  critical: { rim: '#ef4444', glow: '#dc2626', dark: '#b91c1c', label: 'Critical' },
  none:     { rim: '#6b7280', glow: '#4b5563', dark: '#374151', label: 'No Data' },
};
function rc(risk) { return RISK[risk] ?? RISK.none; }

// ── Realistic 3D Tyre ──────────────────────────────────────────────────────────
function Tyre({ x, y, w, h, id, risk = 'none', onClick, label }) {
  const col  = rc(risk);
  const cx   = x + w / 2;
  const cy   = y + h / 2;
  const uid  = `tyre-${id}`;

  return (
    <g onClick={() => onClick?.(id)} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <defs>
        {/* Rubber gradient — dark edges, slight sheen */}
        <radialGradient id={`${uid}-rubber`} cx="35%" cy="30%" r="65%">
          <stop offset="0%"   stopColor="#2d2d2d" />
          <stop offset="70%"  stopColor="#111111" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </radialGradient>
        {/* Rim gradient — metallic 3D */}
        <radialGradient id={`${uid}-rim`} cx="35%" cy="30%" r="65%">
          <stop offset="0%"   stopColor={col.rim} stopOpacity="1" />
          <stop offset="60%"  stopColor={col.glow} />
          <stop offset="100%" stopColor={col.dark} />
        </radialGradient>
        {/* Hub cap shine */}
        <radialGradient id={`${uid}-hub`} cx="30%" cy="30%" r="70%">
          <stop offset="0%"   stopColor="#9ca3af" />
          <stop offset="100%" stopColor="#1f2937" />
        </radialGradient>
      </defs>

      {/* Drop shadow */}
      <ellipse cx={cx + 1.5} cy={cy + 2} rx={w / 2 + 1} ry={h / 2 + 0.5} fill="rgba(0,0,0,0.45)" />

      {/* Rubber body */}
      <rect x={x} y={y} width={w} height={h} rx={w * 0.28}
        fill={`url(#${uid}-rubber)`} stroke="#000" strokeWidth="0.6" />

      {/* Tread blocks */}
      {[0.2, 0.38, 0.56, 0.74].map((pct, i) => (
        <rect key={i} x={x + 1.5} y={y + h * pct} width={w - 3} height={h * 0.1}
          rx="0.8" fill="#222" opacity="0.7" />
      ))}

      {/* Tyre sidewall highlight */}
      <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx={w * 0.26}
        fill="none" stroke="#555" strokeWidth="0.4" opacity="0.5" />

      {/* Rim disc */}
      <ellipse cx={cx} cy={cy} rx={w * 0.33} ry={h * 0.33}
        fill={`url(#${uid}-rim)`} />

      {/* Rim ring border */}
      <ellipse cx={cx} cy={cy} rx={w * 0.33} ry={h * 0.33}
        fill="none" stroke={col.dark} strokeWidth="0.6" />

      {/* Spoke lines */}
      {[0, 60, 120].map((angle, i) => {
        const rad = (angle * Math.PI) / 180;
        const r1 = Math.min(w, h) * 0.12;
        const r2 = Math.min(w, h) * 0.3;
        return (
          <line key={i}
            x1={cx + Math.cos(rad) * r1} y1={cy + Math.sin(rad) * r1 * (h / w)}
            x2={cx + Math.cos(rad) * r2} y2={cy + Math.sin(rad) * r2 * (h / w)}
            stroke={col.dark} strokeWidth="0.8" opacity="0.7"
          />
        );
      })}
      {[0, 60, 120].map((angle, i) => {
        const rad = ((angle + 180) * Math.PI) / 180;
        const r1 = Math.min(w, h) * 0.12;
        const r2 = Math.min(w, h) * 0.3;
        return (
          <line key={i + 3}
            x1={cx + Math.cos(rad) * r1} y1={cy + Math.sin(rad) * r1 * (h / w)}
            x2={cx + Math.cos(rad) * r2} y2={cy + Math.sin(rad) * r2 * (h / w)}
            stroke={col.dark} strokeWidth="0.8" opacity="0.7"
          />
        );
      })}

      {/* Hub cap */}
      <ellipse cx={cx} cy={cy} rx={w * 0.13} ry={h * 0.13}
        fill={`url(#${uid}-hub)`} stroke="#374151" strokeWidth="0.4" />

      {/* Label */}
      <text x={cx} y={cy + 0.4} textAnchor="middle" dominantBaseline="middle"
        fontSize={Math.max(3.5, Math.min(w * 0.5, 8))} fontWeight="800"
        fill="white" style={{ userSelect: 'none', pointerEvents: 'none' }}
        filter="url(#textShadow)">
        {label}
      </text>
    </g>
  );
}

// ── Shared SVG defs (drop shadows, glass reflection, etc.) ────────────────────
function SharedDefs() {
  return (
    <defs>
      <filter id="bodyShadow" x="-15%" y="-10%" width="135%" height="130%">
        <feDropShadow dx="4" dy="6" stdDeviation="5" floodColor="#000" floodOpacity="0.5" />
      </filter>
      <filter id="softShadow" x="-10%" y="-5%" width="125%" height="120%">
        <feDropShadow dx="2" dy="3" stdDeviation="3" floodColor="#000" floodOpacity="0.35" />
      </filter>
      <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0.5" dy="0.5" stdDeviation="0.8" floodColor="#000" floodOpacity="0.8" />
      </filter>
      {/* Glass reflection */}
      <linearGradient id="glassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stopColor="#dbeafe" stopOpacity="0.95" />
        <stop offset="40%"  stopColor="#93c5fd" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.6" />
      </linearGradient>
      <linearGradient id="glassReflect" x1="0%" y1="0%" x2="60%" y2="60%">
        <stop offset="0%"   stopColor="white" stopOpacity="0.5" />
        <stop offset="100%" stopColor="white" stopOpacity="0" />
      </linearGradient>
      {/* Chrome */}
      <linearGradient id="chrome" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%"   stopColor="#f1f5f9" />
        <stop offset="40%"  stopColor="#94a3b8" />
        <stop offset="100%" stopColor="#475569" />
      </linearGradient>
      {/* Headlight yellow */}
      <radialGradient id="headlight" cx="50%" cy="50%" r="50%">
        <stop offset="0%"   stopColor="#fffde7" />
        <stop offset="60%"  stopColor="#fef08a" />
        <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.6" />
      </radialGradient>
      {/* Brake light red */}
      <radialGradient id="brakeLight" cx="50%" cy="50%" r="50%">
        <stop offset="0%"   stopColor="#fee2e2" />
        <stop offset="60%"  stopColor="#fca5a5" />
        <stop offset="100%" stopColor="#ef4444" stopOpacity="0.7" />
      </radialGradient>
    </defs>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VEHICLE BODIES
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. PICKUP — dark navy blue metallic ───────────────────────────────────────
function PickupBody() {
  return (
    <g filter="url(#bodyShadow)">
      <defs>
        <radialGradient id="pkRoof" cx="48%" cy="40%" r="60%">
          <stop offset="0%"   stopColor="#93c5fd" />
          <stop offset="35%"  stopColor="#3b82f6" />
          <stop offset="70%"  stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </radialGradient>
        <linearGradient id="pkHood" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#1e3a8a" />
          <stop offset="30%"  stopColor="#2563eb" />
          <stop offset="50%"  stopColor="#60a5fa" />
          <stop offset="70%"  stopColor="#2563eb" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </linearGradient>
        <linearGradient id="pkBed" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#1e3a8a" />
          <stop offset="50%"  stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </linearGradient>
        <radialGradient id="pkCab" cx="50%" cy="50%" r="55%">
          <stop offset="0%"   stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </radialGradient>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="100" cy="305" rx="78" ry="10" fill="rgba(0,0,0,0.3)" />

      {/* === BODY === */}
      {/* Side body panels — dark trim line */}
      <path d="M 60,70 L 60,275 Q 60,283 72,285 L 128,285 Q 140,283 140,275 L 140,70"
        fill="none" stroke="#1e3a8a" strokeWidth="1" />

      {/* Main body */}
      <path d="M 72,22 Q 60,22 58,36 L 56,70 L 56,275 Q 56,286 72,288 L 128,288 Q 144,286 144,275 L 144,70 L 142,36 Q 140,22 128,22 Z"
        fill="url(#pkRoof)" />

      {/* Hood */}
      <rect x="60" y="22" width="80" height="52" rx="5" fill="url(#pkHood)" />
      {/* Hood center crease highlight */}
      <line x1="100" y1="25" x2="100" y2="73" stroke="#93c5fd" strokeWidth="0.8" opacity="0.6" />
      {/* Hood shadow lines */}
      <line x1="72" y1="25" x2="72" y2="73" stroke="#1e3a8a" strokeWidth="0.6" opacity="0.5" />
      <line x1="128" y1="25" x2="128" y2="73" stroke="#1e3a8a" strokeWidth="0.6" opacity="0.5" />

      {/* === FRONT BUMPER === */}
      <rect x="60" y="12" width="80" height="13" rx="4" fill="url(#chrome)" />
      {/* Bumper grill */}
      <rect x="72" y="15" width="56" height="7" rx="2" fill="#111827" />
      {[0,1,2,3,4].map(i => (
        <line key={i} x1={79 + i*11} y1="15" x2={79 + i*11} y2="22"
          stroke="#374151" strokeWidth="0.8" />
      ))}

      {/* Headlights */}
      <rect x="60" y="13" width="22" height="10" rx="3" fill="url(#headlight)" />
      <rect x="118" y="13" width="22" height="10" rx="3" fill="url(#headlight)" />
      {/* DRL strip */}
      <rect x="61" y="22" width="80" height="2.5" rx="1" fill="#fbbf24" opacity="0.8" />

      {/* === WINDSHIELD === */}
      <path d="M 65,74 L 135,74 L 131,96 L 69,96 Z" fill="url(#glassGrad)" />
      <path d="M 70,75 L 115,75 L 112,85 L 72,85 Z" fill="url(#glassReflect)" opacity="0.6" />
      {/* Wiper */}
      <line x1="80" y1="94" x2="100" y2="78" stroke="#374151" strokeWidth="0.8" opacity="0.7" />
      <line x1="120" y1="94" x2="100" y2="78" stroke="#374151" strokeWidth="0.8" opacity="0.7" />

      {/* === CAB ROOF === */}
      <rect x="60" y="96" width="80" height="64" rx="3" fill="url(#pkCab)" />
      {/* A-pillars */}
      <path d="M 60,96 L 65,74" stroke="#1e3a8a" strokeWidth="3" strokeLinecap="round" />
      <path d="M 140,96 L 135,74" stroke="#1e3a8a" strokeWidth="3" strokeLinecap="round" />
      {/* Roof highlight strip */}
      <rect x="73" y="100" width="54" height="4" rx="2" fill="#60a5fa" opacity="0.4" />
      {/* Door line */}
      <line x1="100" y1="98" x2="100" y2="158" stroke="#1e3a8a" strokeWidth="1.2" opacity="0.8" />
      {/* Door handles */}
      <rect x="84" y="128" width="10" height="3" rx="1.5" fill="url(#chrome)" />
      <rect x="106" y="128" width="10" height="3" rx="1.5" fill="url(#chrome)" />
      {/* Headrests */}
      <ellipse cx="80" cy="110" rx="10" ry="7" fill="#1e3a8a" stroke="#1d4ed8" strokeWidth="0.5" />
      <ellipse cx="120" cy="110" rx="10" ry="7" fill="#1e3a8a" stroke="#1d4ed8" strokeWidth="0.5" />
      {/* Steering wheel */}
      <circle cx="83" cy="135" r="8" fill="none" stroke="#0f172a" strokeWidth="2.5" />
      <circle cx="83" cy="135" r="2.5" fill="#0f172a" />
      <line x1="83" y1="128" x2="83" y2="142" stroke="#0f172a" strokeWidth="1.2" />
      <line x1="76" y1="135" x2="90" y2="135" stroke="#0f172a" strokeWidth="1.2" />

      {/* === REAR WINDOW === */}
      <path d="M 68,158 L 132,158 L 130,169 L 70,169 Z" fill="url(#glassGrad)" opacity="0.85" />
      <path d="M 72,159 L 105,159 L 103,165 L 74,165 Z" fill="url(#glassReflect)" opacity="0.5" />
      {/* C-pillar */}
      <path d="M 60,160 L 60,165" stroke="#1e3a8a" strokeWidth="3" strokeLinecap="round" />
      <path d="M 140,160 L 140,165" stroke="#1e3a8a" strokeWidth="3" strokeLinecap="round" />

      {/* === PICKUP BED === */}
      <rect x="60" y="172" width="80" height="108" rx="3" fill="url(#pkBed)" />
      {/* Bed floor texture */}
      {[0,1,2,3,4,5].map(i => (
        <line key={i} x1="63" y1={180 + i * 16} x2="137" y2={180 + i * 16}
          stroke="#1e3a8a" strokeWidth="0.7" opacity="0.5" />
      ))}
      {/* Bed rails */}
      <rect x="60" y="172" width="5"  height="108" fill="#1d4ed8" opacity="0.9" />
      <rect x="135" y="172" width="5" height="108" fill="#1d4ed8" opacity="0.9" />
      {/* Bed tool box */}
      <rect x="65" y="173" width="70" height="18" rx="2" fill="#1e40af" />
      <line x1="100" y1="173" x2="100" y2="191" stroke="#3b82f6" strokeWidth="0.8" opacity="0.6" />

      {/* === REAR BUMPER === */}
      <rect x="60" y="281" width="80" height="12" rx="4" fill="url(#chrome)" />
      <rect x="62" y="282" width="20" height="8" rx="2" fill="url(#brakeLight)" />
      <rect x="118" y="282" width="20" height="8" rx="2" fill="url(#brakeLight)" />
      <rect x="86" y="283" width="28" height="6" rx="2" fill="#111827" />

      {/* Side mirrors */}
      <rect x="42" y="65" width="15" height="7" rx="2.5" fill="#1d4ed8" stroke="#1e3a8a" strokeWidth="0.5" />
      <rect x="143" y="65" width="15" height="7" rx="2.5" fill="#1d4ed8" stroke="#1e3a8a" strokeWidth="0.5" />
      <line x1="57" y1="68.5" x2="60" y2="70" stroke="#1e3a8a" strokeWidth="1.5" />
      <line x1="143" y1="68.5" x2="140" y2="70" stroke="#1e3a8a" strokeWidth="1.5" />
    </g>
  );
}

// ── 2. CANTER — white commercial truck with orange stripe ─────────────────────
function CanterBody() {
  return (
    <g filter="url(#bodyShadow)">
      <defs>
        <radialGradient id="ctBody" cx="48%" cy="35%" r="62%">
          <stop offset="0%"   stopColor="#f8fafc" />
          <stop offset="50%"  stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#94a3b8" />
        </radialGradient>
        <linearGradient id="ctHood" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#94a3b8" />
          <stop offset="30%"  stopColor="#e2e8f0" />
          <stop offset="50%"  stopColor="#f8fafc" />
          <stop offset="70%"  stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
        <linearGradient id="ctCargo" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#cbd5e1" />
          <stop offset="15%"  stopColor="#f1f5f9" />
          <stop offset="50%"  stopColor="#f8fafc" />
          <stop offset="85%"  stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
        <linearGradient id="ctStripe" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#c2410c" />
          <stop offset="30%"  stopColor="#f97316" />
          <stop offset="50%"  stopColor="#fb923c" />
          <stop offset="70%"  stopColor="#f97316" />
          <stop offset="100%" stopColor="#c2410c" />
        </linearGradient>
      </defs>

      <ellipse cx="100" cy="300" rx="80" ry="10" fill="rgba(0,0,0,0.25)" />

      {/* Main body */}
      <path d="M 70,18 Q 57,18 56,30 L 54,110 L 54,278 Q 54,288 70,290 L 130,290 Q 146,288 146,278 L 146,110 L 144,30 Q 143,18 130,18 Z"
        fill="url(#ctBody)" />

      {/* Cab section */}
      <rect x="58" y="18" width="84" height="100" rx="5" fill="url(#ctBody)" />

      {/* Front bumper — heavy chrome */}
      <rect x="58" y="8" width="84" height="14" rx="4" fill="url(#chrome)" />
      {/* Bull bar */}
      <rect x="68" y="10" width="64" height="5" rx="2" fill="#94a3b8" />
      {/* Fog lights */}
      <rect x="62" y="10" width="8" height="10" rx="2" fill="url(#headlight)" />
      <rect x="130" y="10" width="8" height="10" rx="2" fill="url(#headlight)" />

      {/* Headlights — rectangular */}
      <rect x="58" y="11" width="26" height="11" rx="3" fill="url(#headlight)" />
      <rect x="116" y="11" width="26" height="11" rx="3" fill="url(#headlight)" />
      {/* DRL */}
      <rect x="60" y="21" width="80" height="2.5" rx="1" fill="#fb923c" opacity="0.9" />

      {/* Hood */}
      <rect x="60" y="23" width="80" height="42" rx="4" fill="url(#ctHood)" />
      <line x1="100" y1="25" x2="100" y2="64" stroke="#f8fafc" strokeWidth="1" opacity="0.6" />
      {/* Engine vents */}
      {[0,1,2,3].map(i => (
        <rect key={i} x="68" y={32 + i * 7} width="64" height="3" rx="1.5"
          fill="#94a3b8" opacity="0.5" />
      ))}

      {/* Windshield */}
      <path d="M 62,65 L 138,65 L 134,84 L 66,84 Z" fill="url(#glassGrad)" />
      <path d="M 68,66 L 114,66 L 111,76 L 71,76 Z" fill="url(#glassReflect)" opacity="0.5" />
      {/* Wipers */}
      <line x1="76" y1="82" x2="98" y2="68" stroke="#475569" strokeWidth="0.8" opacity="0.7" />
      <line x1="124" y1="82" x2="102" y2="68" stroke="#475569" strokeWidth="0.8" opacity="0.7" />

      {/* Cab interior */}
      <rect x="58" y="84" width="84" height="40" rx="3" fill="#cbd5e1" />
      {/* Seats */}
      <rect x="64" y="88" width="20" height="15" rx="3" fill="#94a3b8" />
      <rect x="64" y="88" width="20" height="6" rx="3" fill="#e2e8f0" />
      <rect x="116" y="88" width="20" height="15" rx="3" fill="#94a3b8" />
      <rect x="116" y="88" width="20" height="6" rx="3" fill="#e2e8f0" />
      {/* Dashboard */}
      <rect x="64" y="106" width="72" height="6" rx="2" fill="#475569" />
      {/* Steering */}
      <circle cx="80" cy="112" r="8" fill="none" stroke="#1e293b" strokeWidth="2.5" />
      <circle cx="80" cy="112" r="2.5" fill="#1e293b" />

      {/* Orange stripe */}
      <rect x="58" y="118" width="84" height="10" rx="0" fill="url(#ctStripe)" />

      {/* === CARGO BOX === */}
      <rect x="58" y="128" width="84" height="154" rx="3" fill="url(#ctCargo)" />
      {/* Cargo box ribs */}
      {[0,1,2,3,4].map(i => (
        <line key={i} x1="60" y1={145 + i * 28} x2="140" y2={145 + i * 28}
          stroke="#94a3b8" strokeWidth="1" opacity="0.6" />
      ))}
      {/* Side panel lines */}
      <rect x="58" y="128" width="5"  height="154" fill="#cbd5e1" />
      <rect x="137" y="128" width="5" height="154" fill="#cbd5e1" />

      {/* Rear bumper */}
      <rect x="60" y="283" width="80" height="11" rx="3" fill="url(#chrome)" />
      <rect x="62" y="284" width="20" height="7" rx="2" fill="url(#brakeLight)" />
      <rect x="118" y="284" width="20" height="7" rx="2" fill="url(#brakeLight)" />
      {/* Rear orange lights */}
      <rect x="84" y="285" width="32" height="5" rx="2" fill="#fb923c" opacity="0.7" />
      {/* License plate area */}
      <rect x="82" y="274" width="36" height="8" rx="1" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="0.5" />

      {/* Exhaust pipe */}
      <circle cx="55" cy="265" r="3" fill="#374151" stroke="#1f2937" strokeWidth="0.8" />
      <circle cx="55" cy="265" r="1.5" fill="#111827" />

      {/* Mirrors */}
      <rect x="39" y="55" width="17" height="9" rx="3" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.5" />
      <rect x="144" y="55" width="17" height="9" rx="3" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.5" />
    </g>
  );
}

// ── 3. TRI-MIXER — Green Concrete Company livery (white + green) ──────────────
// Brand: greenconcrete.sa · "Think, Believe, Green" · Deep green #006C35 + bright #00A850
function TriMixerBody() {
  return (
    <g filter="url(#bodyShadow)">
      <defs>
        <radialGradient id="tmBody" cx="48%" cy="35%" r="60%">
          <stop offset="0%"   stopColor="#ffffff" />
          <stop offset="55%"  stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </radialGradient>
        <linearGradient id="tmHood" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#94a3b8" />
          <stop offset="30%"  stopColor="#e2e8f0" />
          <stop offset="50%"  stopColor="#ffffff" />
          <stop offset="70%"  stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
        {/* Green Concrete brand greens */}
        <linearGradient id="tmGreenStripe" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#004d26" />
          <stop offset="30%"  stopColor="#006C35" />
          <stop offset="50%"  stopColor="#00A850" />
          <stop offset="70%"  stopColor="#006C35" />
          <stop offset="100%" stopColor="#004d26" />
        </linearGradient>
        <radialGradient id="tmDrum" cx="42%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="#ffffff" />
          <stop offset="45%"  stopColor="#e2e8f0" />
          <stop offset="80%"  stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#64748b" />
        </radialGradient>
        <radialGradient id="tmDrumHub" cx="35%" cy="32%" r="65%">
          <stop offset="0%"   stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#475569" />
        </radialGradient>
        <radialGradient id="tmLogoBg" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#006C35" />
          <stop offset="100%" stopColor="#004d26" />
        </radialGradient>
      </defs>

      <ellipse cx="100" cy="352" rx="80" ry="10" fill="rgba(0,0,0,0.25)" />

      {/* === CAB — white === */}
      <path d="M 70,14 Q 57,14 56,28 L 54,108 L 54,125 L 146,125 L 146,108 L 144,28 Q 143,14 130,14 Z"
        fill="url(#tmBody)" />

      {/* Front bumper chrome */}
      <rect x="58" y="6" width="84" height="12" rx="4" fill="url(#chrome)" />
      <rect x="66" y="8" width="68" height="5" rx="2" fill="#1e293b" />
      {[0,1,2].map(i => (
        <rect key={i} x="68" y={9 + i * 1.5} width="64" height="1" rx="0.5" fill="#475569" opacity="0.7" />
      ))}

      {/* Headlights */}
      <rect x="58" y="7" width="24" height="12" rx="3" fill="url(#headlight)" />
      <rect x="118" y="7" width="24" height="12" rx="3" fill="url(#headlight)" />
      {/* Green DRL strip — brand color */}
      <rect x="60" y="18" width="80" height="3" rx="1" fill="#00A850" opacity="0.95" />

      {/* Hood — white */}
      <rect x="60" y="21" width="80" height="42" rx="4" fill="url(#tmHood)" />
      <line x1="100" y1="23" x2="100" y2="62" stroke="#cbd5e1" strokeWidth="1" opacity="0.7" />
      {[0,1,2].map(i => (
        <rect key={i} x="70" y={30 + i * 9} width="60" height="4" rx="2" fill="#cbd5e1" opacity="0.5" />
      ))}

      {/* Green Concrete logo on hood */}
      <circle cx="100" cy="44" r="10" fill="url(#tmLogoBg)" opacity="0.9" />
      {/* Leaf / G mark */}
      <path d="M 96,44 Q 96,39 100,38 Q 106,38 106,44 Q 106,49 100,50 Q 97,50 96,48 L 96,44 Z"
        fill="#00A850" />
      <line x1="100" y1="50" x2="100" y2="54" stroke="#00A850" strokeWidth="1.2" />
      <text x="100" y="57" textAnchor="middle" fontSize="3.5" fontWeight="800" fill="#006C35">GCC</text>

      {/* Windshield */}
      <path d="M 63,63 L 137,63 L 133,80 L 67,80 Z" fill="url(#glassGrad)" />
      <path d="M 68,64 L 112,64 L 109,74 L 71,74 Z" fill="url(#glassReflect)" opacity="0.5" />
      <line x1="78" y1="78" x2="98" y2="65" stroke="#475569" strokeWidth="0.8" opacity="0.6" />
      <line x1="122" y1="78" x2="102" y2="65" stroke="#475569" strokeWidth="0.8" opacity="0.6" />

      {/* Cab interior */}
      <rect x="58" y="80" width="84" height="42" rx="3" fill="#e2e8f0" />
      <rect x="65" y="84" width="18" height="14" rx="3" fill="#cbd5e1" />
      <rect x="117" y="84" width="18" height="14" rx="3" fill="#cbd5e1" />
      <circle cx="80" cy="108" r="8" fill="none" stroke="#334155" strokeWidth="2.5" />
      <circle cx="80" cy="108" r="2.5" fill="#334155" />

      {/* GREEN brand stripe across cab bottom */}
      <rect x="58" y="116" width="84" height="10" fill="url(#tmGreenStripe)" />
      {/* "GREEN CONCRETE" text on stripe */}
      <text x="100" y="123" textAnchor="middle" fontSize="4" fontWeight="800"
        fill="white" letterSpacing="0.5">GREEN CONCRETE</text>

      {/* === CHASSIS FRAME === */}
      <rect x="68" y="126" width="12" height="215" fill="#334155" />
      <rect x="120" y="126" width="12" height="215" fill="#334155" />
      {[0,1,2,3].map(i => (
        <rect key={i} x="68" y={148 + i * 50} width="64" height="6" fill="#475569" />
      ))}

      {/* === DRUM — white with green fins === */}
      <ellipse cx="100" cy="228" rx="44" ry="100" fill="url(#tmDrum)" />
      <ellipse cx="100" cy="228" rx="44" ry="100"
        fill="none" stroke="#94a3b8" strokeWidth="1.5" />

      {/* Green spiral fins */}
      {[0,1,2,3,4,5,6,7,8].map((i) => {
        const yPos = 135 + i * 21;
        const curve = i % 2 === 0 ? -9 : 9;
        return (
          <path key={i} d={`M 58,${yPos} Q 100,${yPos + curve} 142,${yPos}`}
            fill="none" stroke="#006C35" strokeWidth="2.2" opacity="0.9" />
        );
      })}
      {/* Fin highlight */}
      {[0,1,2,3,4,5,6,7,8].map((i) => {
        const yPos = 134 + i * 21;
        const curve = i % 2 === 0 ? -9 : 9;
        return (
          <path key={i + 10} d={`M 60,${yPos} Q 100,${yPos + curve} 140,${yPos}`}
            fill="none" stroke="#00A850" strokeWidth="0.8" opacity="0.5" />
        );
      })}

      {/* Green Concrete logo badge on drum */}
      <ellipse cx="100" cy="228" rx="22" ry="22" fill="url(#tmLogoBg)" stroke="#00A850" strokeWidth="1.5" />
      {/* Leaf icon */}
      <path d="M 96,224 Q 95,218 100,217 Q 107,217 107,224 Q 107,231 100,232 Q 96,232 95,229 L 96,224 Z"
        fill="#00A850" />
      <line x1="100" y1="232" x2="100" y2="237" stroke="#00A850" strokeWidth="1.5" />
      {/* GCC text */}
      <text x="100" y="241" textAnchor="middle" fontSize="4.5" fontWeight="900" fill="white">GCC</text>
      <text x="100" y="246" textAnchor="middle" fontSize="3" fill="#86efac" letterSpacing="0.3">THINK · BELIEVE · GREEN</text>

      {/* Hub bolts ring */}
      <ellipse cx="100" cy="228" rx="14" ry="14" fill="url(#tmDrumHub)" stroke="#94a3b8" strokeWidth="1" />
      {[0,72,144,216,288].map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        return <circle key={i} cx={100 + Math.cos(rad) * 9} cy={228 + Math.sin(rad) * 9} r="1.8" fill="#475569" />;
      })}
      <circle cx="100" cy="228" r="4.5" fill="#1e293b" />

      {/* Water tank */}
      <rect x="70" y="315" width="60" height="24" rx="4" fill="#006C35" opacity="0.8" />
      <rect x="72" y="317" width="56" height="8" rx="2" fill="#00A850" opacity="0.3" />
      <text x="100" y="330" textAnchor="middle" fontSize="4" fill="white" opacity="0.8" fontWeight="600">WATER</text>

      {/* Rear chassis + lights */}
      <rect x="58" y="335" width="84" height="12" rx="3" fill="url(#chrome)" />
      <rect x="60" y="336" width="22" height="8" rx="2" fill="url(#brakeLight)" />
      <rect x="118" y="336" width="22" height="8" rx="2" fill="url(#brakeLight)" />
      {/* Green rear strip */}
      <rect x="82" y="337" width="36" height="6" rx="2" fill="#006C35" opacity="0.8" />

      {/* Mirrors — green */}
      <rect x="39" y="52" width="17" height="9" rx="3" fill="#006C35" stroke="#004d26" strokeWidth="0.5" />
      <rect x="144" y="52" width="17" height="9" rx="3" fill="#006C35" stroke="#004d26" strokeWidth="0.5" />
    </g>
  );
}

// ── 4. CONCRETE PUMP — Green Concrete Company livery (white + green) ──────────
// Brand: greenconcrete.sa · Saudi Arabia · #006C35 deep green + #00A850 bright green
function ConcretePumpBody() {
  return (
    <g filter="url(#bodyShadow)">
      <defs>
        <radialGradient id="cpBody" cx="48%" cy="35%" r="62%">
          <stop offset="0%"   stopColor="#ffffff" />
          <stop offset="55%"  stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </radialGradient>
        <linearGradient id="cpHood" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#94a3b8" />
          <stop offset="30%"  stopColor="#e2e8f0" />
          <stop offset="50%"  stopColor="#ffffff" />
          <stop offset="70%"  stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
        <radialGradient id="cpPump" cx="45%" cy="35%" r="60%">
          <stop offset="0%"   stopColor="#ffffff" />
          <stop offset="55%"  stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </radialGradient>
        <radialGradient id="cpHopper" cx="40%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="#4ade80" />
          <stop offset="50%"  stopColor="#16a34a" />
          <stop offset="100%" stopColor="#14532d" />
        </radialGradient>
        <linearGradient id="cpOutrigger" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#004d26" />
          <stop offset="50%"  stopColor="#006C35" />
          <stop offset="100%" stopColor="#004d26" />
        </linearGradient>
        <linearGradient id="cpBoom" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#004d26" />
          <stop offset="50%"  stopColor="#006C35" />
          <stop offset="100%" stopColor="#004d26" />
        </linearGradient>
        <linearGradient id="cpGreenStripe" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#004d26" />
          <stop offset="30%"  stopColor="#006C35" />
          <stop offset="50%"  stopColor="#00A850" />
          <stop offset="70%"  stopColor="#006C35" />
          <stop offset="100%" stopColor="#004d26" />
        </linearGradient>
        <radialGradient id="cpLogoBg" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#006C35" />
          <stop offset="100%" stopColor="#004d26" />
        </radialGradient>
      </defs>

      <ellipse cx="100" cy="362" rx="90" ry="11" fill="rgba(0,0,0,0.25)" />

      {/* === CAB — white === */}
      <path d="M 70,14 Q 57,14 56,28 L 54,110 L 54,128 L 146,128 L 146,110 L 144,28 Q 143,14 130,14 Z"
        fill="url(#cpBody)" />

      {/* Front bumper chrome */}
      <rect x="58" y="6" width="84" height="12" rx="4" fill="url(#chrome)" />
      <rect x="66" y="8" width="68" height="5" rx="2" fill="#1e293b" />
      {[0,1,2].map(i => (
        <rect key={i} x="68" y={9 + i * 1.5} width="64" height="1" rx="0.5" fill="#475569" opacity="0.8" />
      ))}

      {/* Headlights */}
      <rect x="58" y="7" width="24" height="12" rx="3" fill="url(#headlight)" />
      <rect x="118" y="7" width="24" height="12" rx="3" fill="url(#headlight)" />
      {/* Green DRL strip */}
      <rect x="60" y="18" width="80" height="3" rx="1" fill="#00A850" opacity="0.95" />

      {/* Hood — white */}
      <rect x="60" y="21" width="80" height="44" rx="4" fill="url(#cpHood)" />
      <line x1="100" y1="23" x2="100" y2="64" stroke="#cbd5e1" strokeWidth="1" opacity="0.7" />
      {[0,1,2].map(i => (
        <rect key={i} x="70" y={30 + i * 10} width="60" height="4" rx="2" fill="#e2e8f0" opacity="0.6" />
      ))}

      {/* GCC logo badge on hood */}
      <circle cx="100" cy="44" r="10" fill="url(#cpLogoBg)" opacity="0.9" />
      <path d="M 96,44 Q 96,39 100,38 Q 106,38 106,44 Q 106,49 100,50 Q 97,50 96,48 L 96,44 Z"
        fill="#00A850" />
      <line x1="100" y1="50" x2="100" y2="54" stroke="#00A850" strokeWidth="1.2" />
      <text x="100" y="57" textAnchor="middle" fontSize="3.5" fontWeight="800" fill="#006C35">GCC</text>

      {/* Windshield */}
      <path d="M 63,65 L 137,65 L 133,83 L 67,83 Z" fill="url(#glassGrad)" />
      <path d="M 68,66 L 112,66 L 109,76 L 71,76 Z" fill="url(#glassReflect)" opacity="0.5" />
      <line x1="78" y1="81" x2="98" y2="67" stroke="#475569" strokeWidth="0.8" opacity="0.6" />
      <line x1="122" y1="81" x2="102" y2="67" stroke="#475569" strokeWidth="0.8" opacity="0.6" />

      {/* Cab interior */}
      <rect x="58" y="83" width="84" height="42" rx="3" fill="#e2e8f0" />
      <rect x="65" y="87" width="18" height="14" rx="3" fill="#cbd5e1" />
      <rect x="117" y="87" width="18" height="14" rx="3" fill="#cbd5e1" />
      <circle cx="80" cy="111" r="8" fill="none" stroke="#334155" strokeWidth="2.5" />
      <circle cx="80" cy="111" r="2.5" fill="#334155" />

      {/* GREEN CONCRETE brand stripe */}
      <rect x="58" y="120" width="84" height="9" fill="url(#cpGreenStripe)" />
      <text x="100" y="126.5" textAnchor="middle" fontSize="4" fontWeight="800"
        fill="white" letterSpacing="0.5">GREEN CONCRETE</text>

      {/* Cab bottom bar */}
      <rect x="58" y="126" width="84" height="3" fill="#004d26" />

      {/* === CHASSIS FRAME === */}
      <rect x="68" y="129" width="11" height="222" fill="#334155" />
      <rect x="121" y="129" width="11" height="222" fill="#334155" />

      {/* === OUTRIGGER BEAMS — green === */}
      <rect x="20" y="142" width="50" height="10" rx="3" fill="url(#cpOutrigger)" />
      <rect x="130" y="142" width="50" height="10" rx="3" fill="url(#cpOutrigger)" />
      {/* Front stabiliser pads */}
      <rect x="12" y="138" width="14" height="18" rx="4" fill="#006C35" stroke="#00A850" strokeWidth="1.5" />
      <rect x="174" y="138" width="14" height="18" rx="4" fill="#006C35" stroke="#00A850" strokeWidth="1.5" />
      <rect x="14" y="140" width="10" height="14" rx="2" fill="#004d26" opacity="0.8" />
      <rect x="176" y="140" width="10" height="14" rx="2" fill="#004d26" opacity="0.8" />
      {/* Rear outriggers */}
      <rect x="20" y="238" width="50" height="10" rx="3" fill="url(#cpOutrigger)" />
      <rect x="130" y="238" width="50" height="10" rx="3" fill="url(#cpOutrigger)" />
      <rect x="12" y="234" width="14" height="18" rx="4" fill="#006C35" stroke="#00A850" strokeWidth="1.5" />
      <rect x="174" y="234" width="14" height="18" rx="4" fill="#006C35" stroke="#00A850" strokeWidth="1.5" />
      <rect x="14" y="236" width="10" height="14" rx="2" fill="#004d26" opacity="0.8" />
      <rect x="176" y="236" width="10" height="14" rx="2" fill="#004d26" opacity="0.8" />

      {/* === PUMP BODY — white === */}
      <rect x="58" y="129" width="84" height="220" rx="4" fill="url(#cpPump)" />

      {/* Green side stripe on pump body */}
      <rect x="58" y="129" width="5" height="220" fill="#006C35" opacity="0.8" rx="2" />
      <rect x="137" y="129" width="5" height="220" fill="#006C35" opacity="0.8" rx="2" />

      {/* === HOPPER — green branded === */}
      <rect x="66" y="135" width="68" height="58" rx="6" fill="url(#cpHopper)" />
      <rect x="70" y="139" width="60" height="46" rx="4" fill="#14532d" opacity="0.5" />
      <ellipse cx="100" cy="164" rx="24" ry="17" fill="#052e16" />
      <text x="100" y="162" textAnchor="middle" fontSize="5.5" fontWeight="700" fill="#4ade80" opacity="0.9">HOPPER</text>
      {/* Hopper grate */}
      {[0,1,2].map(i => (
        <line key={i} x1="72" y1={152+i*6} x2="128" y2={152+i*6} stroke="#4ade80" strokeWidth="0.7" opacity="0.4" />
      ))}
      {[0,1,2].map(i => (
        <line key={i+3} x1={88+i*12} y1="138" x2={88+i*12} y2="190" stroke="#4ade80" strokeWidth="0.7" opacity="0.4" />
      ))}

      {/* Pump cylinders */}
      <rect x="70" y="198" width="26" height="42" rx="5" fill="#475569" stroke="#006C35" strokeWidth="1.2" />
      <rect x="104" y="198" width="26" height="42" rx="5" fill="#475569" stroke="#006C35" strokeWidth="1.2" />
      <ellipse cx="83" cy="219" rx="10" ry="10" fill="url(#chrome)" />
      <ellipse cx="117" cy="219" rx="10" ry="10" fill="url(#chrome)" />
      <circle cx="83" cy="219" r="4" fill="#334155" />
      <circle cx="117" cy="219" r="4" fill="#334155" />

      {/* S-valve */}
      <rect x="76" y="240" width="48" height="18" rx="5" fill="#1e293b" stroke="#006C35" strokeWidth="1.2" />
      <text x="100" y="252" textAnchor="middle" fontSize="5" fill="#00A850" fontWeight="700">S-VALVE</text>

      {/* GCC logo badge on pump body */}
      <ellipse cx="100" cy="290" rx="18" ry="18" fill="url(#cpLogoBg)" stroke="#00A850" strokeWidth="1.5" />
      <path d="M 97,287 Q 96,282 100,281 Q 105,281 105,287 Q 105,293 100,294 Q 97,294 96,291 L 97,287 Z"
        fill="#00A850" />
      <line x1="100" y1="294" x2="100" y2="298" stroke="#00A850" strokeWidth="1.2" />
      <text x="100" y="302" textAnchor="middle" fontSize="3.8" fontWeight="900" fill="white">GCC</text>

      {/* === BOOM ARM — green === */}
      <rect x="66" y="263" width="68" height="12" rx="4" fill="url(#cpBoom)" stroke="#00A850" strokeWidth="0.8" />
      <rect x="70" y="276" width="60" height="10" rx="4" fill="url(#cpBoom)" stroke="#00A850" strokeWidth="0.8" />
      <rect x="74" y="287" width="52" height="10" rx="4" fill="url(#cpBoom)" stroke="#00A850" strokeWidth="0.8" />
      <rect x="78" y="298" width="44" height="10" rx="4" fill="url(#cpBoom)" stroke="#00A850" strokeWidth="0.8" />
      <circle cx="100" cy="269" r="4" fill="#004d26" stroke="#00A850" strokeWidth="0.8" />
      <circle cx="100" cy="281" r="4" fill="#004d26" stroke="#00A850" strokeWidth="0.8" />
      <circle cx="100" cy="292" r="4" fill="#004d26" stroke="#00A850" strokeWidth="0.8" />

      {/* Concrete pipe */}
      <line x1="100" y1="181" x2="100" y2="303" stroke="#006C35" strokeWidth="2.5" strokeDasharray="3 2" opacity="0.7" />

      {/* Rear bumper */}
      <rect x="60" y="348" width="80" height="12" rx="3" fill="url(#chrome)" />
      <rect x="62" y="349" width="22" height="8" rx="2" fill="url(#brakeLight)" />
      <rect x="116" y="349" width="22" height="8" rx="2" fill="url(#brakeLight)" />
      <rect x="86" y="350" width="28" height="6" rx="2" fill="#006C35" opacity="0.8" />

      {/* Mirrors — green */}
      <rect x="39" y="55" width="17" height="9" rx="3" fill="#006C35" stroke="#004d26" strokeWidth="0.8" />
      <rect x="144" y="55" width="17" height="9" rx="3" fill="#006C35" stroke="#004d26" strokeWidth="0.8" />
    </g>
  );
}

// ── 5. WHEEL LOADER — CAT yellow articulated ──────────────────────────────────
function WheelLoaderBody() {
  return (
    <g filter="url(#bodyShadow)">
      <defs>
        <radialGradient id="wlBody" cx="48%" cy="38%" r="62%">
          <stop offset="0%"   stopColor="#fef9c3" />
          <stop offset="40%"  stopColor="#fde047" />
          <stop offset="75%"  stopColor="#ca8a04" />
          <stop offset="100%" stopColor="#78350f" />
        </radialGradient>
        <radialGradient id="wlCab" cx="40%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="#fef9c3" />
          <stop offset="50%"  stopColor="#fde047" />
          <stop offset="100%" stopColor="#92400e" />
        </radialGradient>
        <linearGradient id="wlBucket" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#9ca3af" />
          <stop offset="40%"  stopColor="#4b5563" />
          <stop offset="100%" stopColor="#1f2937" />
        </linearGradient>
        <linearGradient id="wlArm" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#78350f" />
          <stop offset="50%"  stopColor="#fde047" />
          <stop offset="100%" stopColor="#78350f" />
        </linearGradient>
      </defs>

      <ellipse cx="100" cy="248" rx="82" ry="10" fill="rgba(0,0,0,0.3)" />

      {/* === FRONT FRAME (bucket side) === */}
      <rect x="58" y="22" width="84" height="82" rx="6" fill="url(#wlBody)" />

      {/* Lift arms (prominent yellow beams) */}
      <rect x="60" y="14" width="14" height="90" rx="4" fill="url(#wlArm)" stroke="#78350f" strokeWidth="0.8" />
      <rect x="126" y="14" width="14" height="90" rx="4" fill="url(#wlArm)" stroke="#78350f" strokeWidth="0.8" />

      {/* === BUCKET === */}
      {/* Bucket body */}
      <path d="M 44,5 L 156,5 L 160,22 L 40,22 Z" fill="url(#wlBucket)" />
      {/* Bucket floor visible from top */}
      <rect x="44" y="6" width="112" height="14" rx="2" fill="#374151" />
      {/* Cutting edge (chrome steel) */}
      <rect x="42" y="3" width="116" height="5" rx="1.5" fill="url(#chrome)" />
      {/* Bucket teeth */}
      {[0,1,2,3,4,5,6].map(i => (
        <path key={i}
          d={`M ${52 + i*17},3 L ${52 + i*17 - 3},0 L ${52 + i*17 + 3},0 Z`}
          fill="#94a3b8" />
      ))}
      {/* Bucket side walls */}
      <rect x="44" y="5" width="6" height="18" rx="2" fill="#374151" />
      <rect x="150" y="5" width="6" height="18" rx="2" fill="#374151" />

      {/* Lift arm hydraulic cylinders */}
      <rect x="65" y="20" width="6" height="28" rx="2" fill="#94a3b8" />
      <rect x="129" y="20" width="6" height="28" rx="2" fill="#94a3b8" />
      {/* Cylinder caps */}
      <rect x="64" y="19" width="8" height="3" rx="1" fill="url(#chrome)" />
      <rect x="128" y="19" width="8" height="3" rx="1" fill="url(#chrome)" />

      {/* Articulation joint */}
      <rect x="64" y="100" width="72" height="14" rx="5" fill="#374151" stroke="#fde047" strokeWidth="1" />
      <circle cx="100" cy="107" r="8" fill="#1f2937" stroke="#fde047" strokeWidth="1.5" />
      <circle cx="100" cy="107" r="3.5" fill="#374151" stroke="#94a3b8" strokeWidth="0.8" />

      {/* === REAR FRAME (engine/cab side) === */}
      <rect x="56" y="114" width="88" height="118" rx="8" fill="url(#wlBody)" />

      {/* ROPS cab frame */}
      <rect x="62" y="116" width="76" height="52" rx="5" fill="url(#wlCab)" />
      {/* Cab glass */}
      <rect x="66" y="118" width="68" height="10" rx="2" fill="url(#glassGrad)" opacity="0.9" />
      <rect x="68" y="119" width="30" height="6" rx="1" fill="url(#glassReflect)" opacity="0.5" />
      {/* ROPS pillars */}
      <rect x="62" y="116" width="5" height="52" rx="2" fill="#92400e" />
      <rect x="133" y="116" width="5" height="52" rx="2" fill="#92400e" />
      {/* Cab interior */}
      <rect x="67" y="128" width="66" height="36" rx="3" fill="#a16207" opacity="0.6" />
      {/* Operator seat */}
      <rect x="82" y="133" width="24" height="18" rx="4" fill="#78350f" />
      <rect x="82" y="133" width="24" height="8" rx="4" fill="#92400e" />
      {/* Joystick */}
      <circle cx="108" cy="148" r="3" fill="#1f2937" />
      <line x1="108" y1="148" x2="108" y2="153" stroke="#374151" strokeWidth="1.5" />
      {/* Steering column */}
      <circle cx="78" cy="152" r="6" fill="none" stroke="#451a03" strokeWidth="2" />
      <circle cx="78" cy="152" r="2" fill="#451a03" />

      {/* Engine hood */}
      <rect x="62" y="168" width="76" height="56" rx="4" fill="#ca8a04" opacity="0.8" />
      {/* Hood vents */}
      {[0,1,2,3].map(i => (
        <rect key={i} x="70" y={175 + i * 11} width="60" height="6" rx="3" fill="#92400e" opacity="0.5" />
      ))}
      {/* Exhaust stack */}
      <circle cx="130" cy="175" r="5" fill="#374151" stroke="#4b5563" strokeWidth="1" />
      <circle cx="130" cy="175" r="2.5" fill="#1f2937" />

      {/* Rear counterweight */}
      <rect x="60" y="224" width="80" height="14" rx="5" fill="#374151" stroke="#6b7280" strokeWidth="1" />
      <rect x="65" y="226" width="70" height="10" rx="3" fill="#4b5563" />
      {/* Rear lights */}
      <rect x="62" y="225" width="14" height="10" rx="2" fill="url(#brakeLight)" />
      <rect x="124" y="225" width="14" height="10" rx="2" fill="url(#brakeLight)" />

      {/* CAT badge */}
      <rect x="84" y="184" width="32" height="12" rx="2" fill="#1f2937" opacity="0.6" />
      <text x="100" y="192" textAnchor="middle" fontSize="7" fontWeight="900" fill="#fde047" opacity="0.9">CAT</text>
    </g>
  );
}

// ── 6. BUS — white staff/transit bus with green GCC stripe ───────────────────
// 6 tyres: 2 front single + 4 rear dual  (like a full-size coach)
function BusBody() {
  return (
    <g filter="url(#bodyShadow)">
      <defs>
        <radialGradient id="busRoof" cx="48%" cy="38%" r="58%">
          <stop offset="0%"   stopColor="#ffffff" />
          <stop offset="55%"  stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </radialGradient>
        <linearGradient id="busStripe" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#004d26" />
          <stop offset="30%"  stopColor="#006C35" />
          <stop offset="50%"  stopColor="#00A850" />
          <stop offset="70%"  stopColor="#006C35" />
          <stop offset="100%" stopColor="#004d26" />
        </linearGradient>
        <linearGradient id="busWindow" x1="0%" y1="0%" x2="60%" y2="100%">
          <stop offset="0%"   stopColor="#bfdbfe" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.5" />
        </linearGradient>
      </defs>

      <ellipse cx="100" cy="340" rx="86" ry="10" fill="rgba(0,0,0,0.25)" />

      {/* === MAIN BODY — wide rectangular coach === */}
      <path d="M 52,20 Q 40,20 38,34 L 36,290 Q 36,305 52,308 L 148,308 Q 164,305 164,290 L 164,34 Q 162,20 148,20 Z"
        fill="url(#busRoof)" />

      {/* === FRONT === */}
      {/* Front bumper */}
      <rect x="38" y="10" width="124" height="14" rx="5" fill="url(#chrome)" />
      {/* Destination board (black) */}
      <rect x="54" y="12" width="92" height="7" rx="2" fill="#0f172a" />
      <text x="100" y="17.5" textAnchor="middle" fontSize="4" fill="#fde047" fontWeight="700">STAFF BUS · GCC</text>
      {/* Headlights */}
      <rect x="38" y="12" width="18" height="11" rx="3" fill="url(#headlight)" />
      <rect x="144" y="12" width="18" height="11" rx="3" fill="url(#headlight)" />
      {/* Green DRL */}
      <rect x="40" y="23" width="120" height="3" rx="1" fill="#00A850" opacity="0.9" />
      {/* Front windshield — wide panoramic */}
      <path d="M 42,26 L 158,26 L 155,48 L 45,48 Z" fill="url(#glassGrad)" />
      <path d="M 46,27 L 120,27 L 118,40 L 48,40 Z" fill="url(#glassReflect)" opacity="0.5" />
      {/* Wiper */}
      <line x1="60" y1="46" x2="96" y2="30" stroke="#475569" strokeWidth="0.8" opacity="0.6" />
      <line x1="140" y1="46" x2="104" y2="30" stroke="#475569" strokeWidth="0.8" opacity="0.6" />

      {/* === GREEN STRIPE — runs full length === */}
      <rect x="36" y="130" width="128" height="14" fill="url(#busStripe)" />
      <text x="100" y="139.5" textAnchor="middle" fontSize="4.5" fontWeight="800"
        fill="white" letterSpacing="0.8">GREEN CONCRETE COMPANY</text>

      {/* === SIDE WINDOWS — left column (visible top-down as thin strips) === */}
      {/* Left side windows */}
      {[0,1,2,3,4,5].map(i => (
        <rect key={i} x="36" y={55 + i * 38} width="8" height="26" rx="2"
          fill="url(#busWindow)" opacity="0.85" />
      ))}
      {/* Right side windows */}
      {[0,1,2,3,4,5].map(i => (
        <rect key={i+6} x="156" y={55 + i * 38} width="8" height="26" rx="2"
          fill="url(#busWindow)" opacity="0.85" />
      ))}

      {/* === INTERIOR — seats visible from top === */}
      <rect x="44" y="50" width="112" height="248" rx="3" fill="#f8fafc" opacity="0.15" />
      {/* Seat rows — left aisle */}
      {[0,1,2,3,4,5,6,7,8].map(i => (
        <g key={i}>
          <rect x="46" y={56 + i * 27} width="22" height="16" rx="3" fill="#e2e8f0" opacity="0.5" />
          <rect x="132" y={56 + i * 27} width="22" height="16" rx="3" fill="#e2e8f0" opacity="0.5" />
        </g>
      ))}
      {/* Aisle centre line */}
      <line x1="100" y1="50" x2="100" y2="295" stroke="#cbd5e1" strokeWidth="0.5"
        strokeDasharray="4 4" opacity="0.4" />

      {/* === FRONT DOOR === */}
      <rect x="36" y="54" width="10" height="30" rx="2" fill="#006C35" opacity="0.7" />
      <rect x="38" y="56" width="6" height="26" rx="1" fill="#00A850" opacity="0.4" />

      {/* === REAR === */}
      {/* Rear window */}
      <path d="M 44,292 L 156,292 L 154,306 L 46,306 Z" fill="url(#glassGrad)" opacity="0.8" />
      <path d="M 48,293 L 110,293 L 108,302 L 50,302 Z" fill="url(#glassReflect)" opacity="0.4" />
      {/* Rear bumper */}
      <rect x="38" y="306" width="124" height="10" rx="4" fill="url(#chrome)" />
      <rect x="40" y="307" width="28" height="7" rx="2" fill="url(#brakeLight)" />
      <rect x="132" y="307" width="28" height="7" rx="2" fill="url(#brakeLight)" />
      {/* Exhaust */}
      <circle cx="42" cy="303" r="4" fill="#374151" stroke="#1f2937" strokeWidth="1" />
      <circle cx="42" cy="303" r="2" fill="#111827" />

      {/* Mirrors — large coach mirrors */}
      <rect x="16" y="30" width="20" height="10" rx="3" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.8" />
      <rect x="164" y="30" width="20" height="10" rx="3" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.8" />
    </g>
  );
}

// ── 7. TATA — blue Tata Prima heavy truck ─────────────────────────────────────
// Tata brand: deep blue #003087, accent blue #0072CE, silver trim
// 6 tyres: 2 front single + 4 rear dual
function TataBody() {
  return (
    <g filter="url(#bodyShadow)">
      <defs>
        <radialGradient id="tataCab" cx="48%" cy="35%" r="60%">
          <stop offset="0%"   stopColor="#4d8fd1" />
          <stop offset="40%"  stopColor="#0072CE" />
          <stop offset="80%"  stopColor="#003087" />
          <stop offset="100%" stopColor="#001f5b" />
        </radialGradient>
        <linearGradient id="tataHood" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#001f5b" />
          <stop offset="30%"  stopColor="#0072CE" />
          <stop offset="50%"  stopColor="#4d8fd1" />
          <stop offset="70%"  stopColor="#0072CE" />
          <stop offset="100%" stopColor="#001f5b" />
        </linearGradient>
        <linearGradient id="tataCargo" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#cbd5e1" />
          <stop offset="15%"  stopColor="#f1f5f9" />
          <stop offset="50%"  stopColor="#ffffff" />
          <stop offset="85%"  stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
        <linearGradient id="tataStripe" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#001f5b" />
          <stop offset="30%"  stopColor="#003087" />
          <stop offset="50%"  stopColor="#0072CE" />
          <stop offset="70%"  stopColor="#003087" />
          <stop offset="100%" stopColor="#001f5b" />
        </linearGradient>
      </defs>

      <ellipse cx="100" cy="298" rx="80" ry="10" fill="rgba(0,0,0,0.28)" />

      {/* === CAB — Tata Prima style, blue === */}
      <path d="M 68,14 Q 56,14 55,27 L 53,112 L 53,128 L 147,128 L 147,112 L 145,27 Q 144,14 132,14 Z"
        fill="url(#tataCab)" />

      {/* Front bumper — heavy chrome + bull bar */}
      <rect x="56" y="5" width="88" height="13" rx="4" fill="url(#chrome)" />
      {/* Bull bar crossbar */}
      <rect x="60" y="8" width="80" height="4" rx="2" fill="#94a3b8" />
      {/* Vertical bull bar tubes */}
      <rect x="75" y="5" width="4" height="13" rx="1" fill="#94a3b8" />
      <rect x="121" y="5" width="4" height="13" rx="1" fill="#94a3b8" />
      {/* Fog lights */}
      <rect x="58" y="7" width="14" height="9" rx="2" fill="url(#headlight)" opacity="0.8" />
      <rect x="128" y="7" width="14" height="9" rx="2" fill="url(#headlight)" opacity="0.8" />

      {/* Main headlights */}
      <rect x="55" y="8" width="26" height="13" rx="3" fill="url(#headlight)" />
      <rect x="119" y="8" width="26" height="13" rx="3" fill="url(#headlight)" />
      {/* Blue DRL strip */}
      <rect x="57" y="18" width="86" height="3" rx="1" fill="#0072CE" opacity="0.95" />

      {/* Hood */}
      <rect x="58" y="21" width="84" height="46" rx="4" fill="url(#tataHood)" />
      <line x1="100" y1="23" x2="100" y2="66" stroke="#4d8fd1" strokeWidth="1.2" opacity="0.6" />
      {/* Hood vents */}
      {[0,1,2,3].map(i => (
        <rect key={i} x="68" y={28 + i * 8} width="64" height="4" rx="2"
          fill="#001f5b" opacity="0.5" />
      ))}

      {/* TATA logo on hood */}
      <rect x="84" y="40" width="32" height="14" rx="3" fill="#001f5b" opacity="0.85" />
      <text x="100" y="50" textAnchor="middle" fontSize="8" fontWeight="900"
        fill="#ffffff" letterSpacing="1">TATA</text>

      {/* Windshield */}
      <path d="M 61,67 L 139,67 L 135,85 L 65,85 Z" fill="url(#glassGrad)" />
      <path d="M 66,68 L 112,68 L 109,78 L 69,78 Z" fill="url(#glassReflect)" opacity="0.5" />
      <line x1="76" y1="83" x2="97" y2="69" stroke="#1e293b" strokeWidth="0.8" opacity="0.6" />
      <line x1="124" y1="83" x2="103" y2="69" stroke="#1e293b" strokeWidth="0.8" opacity="0.6" />

      {/* Cab interior */}
      <rect x="57" y="85" width="86" height="40" rx="3" fill="#003087" opacity="0.7" />
      <rect x="64" y="89" width="18" height="14" rx="3" fill="#001f5b" />
      <rect x="118" y="89" width="18" height="14" rx="3" fill="#001f5b" />
      <circle cx="80" cy="114" r="8" fill="none" stroke="#001f5b" strokeWidth="2.5" />
      <circle cx="80" cy="114" r="2.5" fill="#001f5b" />

      {/* Blue stripe on cab bottom */}
      <rect x="57" y="120" width="86" height="9" fill="url(#tataStripe)" />
      <text x="100" y="126.5" textAnchor="middle" fontSize="4" fontWeight="800"
        fill="white" letterSpacing="0.4">TATA PRIMA · HEAVY DUTY</text>

      {/* === CHASSIS === */}
      <rect x="67" y="129" width="11" height="158" fill="#334155" />
      <rect x="122" y="129" width="11" height="158" fill="#334155" />
      {[0,1,2].map(i => (
        <rect key={i} x="67" y={145 + i * 45} width="66" height="6" fill="#475569" />
      ))}

      {/* === CARGO BOX — white with blue stripe === */}
      <rect x="57" y="129" width="86" height="152" rx="3" fill="url(#tataCargo)" />
      {/* Blue side stripes */}
      <rect x="57" y="129" width="5" height="152" fill="#003087" opacity="0.8" rx="1" />
      <rect x="138" y="129" width="5" height="152" fill="#003087" opacity="0.8" rx="1" />
      {/* Cargo ribs */}
      {[0,1,2,3,4].map(i => (
        <line key={i} x1="59" y1={148 + i * 27} x2="141" y2={148 + i * 27}
          stroke="#94a3b8" strokeWidth="0.8" opacity="0.5" />
      ))}

      {/* Rear bumper */}
      <rect x="58" y="281" width="84" height="11" rx="3" fill="url(#chrome)" />
      <rect x="60" y="282" width="22" height="7" rx="2" fill="url(#brakeLight)" />
      <rect x="118" y="282" width="22" height="7" rx="2" fill="url(#brakeLight)" />
      {/* Blue rear strip */}
      <rect x="84" y="283" width="32" height="5" rx="2" fill="#003087" opacity="0.7" />

      {/* Exhaust */}
      <circle cx="55" cy="268" r="3.5" fill="#374151" stroke="#1f2937" strokeWidth="0.8" />
      <circle cx="55" cy="268" r="1.8" fill="#111827" />

      {/* Mirrors — Tata Prima style */}
      <rect x="37" y="54" width="17" height="10" rx="3" fill="#0072CE" stroke="#003087" strokeWidth="0.8" />
      <rect x="146" y="54" width="17" height="10" rx="3" fill="#0072CE" stroke="#003087" strokeWidth="0.8" />
    </g>
  );
}

// ── 8. ASHOK LEYLAND — red/white AL heavy truck ───────────────────────────────
// AL brand: dark red #C41E3A, accent #E8192C, silver/white body
// 6 tyres: 2 front single + 4 rear dual
function AshokLeylandBody() {
  return (
    <g filter="url(#bodyShadow)">
      <defs>
        <radialGradient id="alCab" cx="48%" cy="35%" r="60%">
          <stop offset="0%"   stopColor="#ffffff" />
          <stop offset="45%"  stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </radialGradient>
        <linearGradient id="alHood" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#94a3b8" />
          <stop offset="30%"  stopColor="#e2e8f0" />
          <stop offset="50%"  stopColor="#ffffff" />
          <stop offset="70%"  stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
        <linearGradient id="alStripe" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#7f0d1c" />
          <stop offset="30%"  stopColor="#C41E3A" />
          <stop offset="50%"  stopColor="#E8192C" />
          <stop offset="70%"  stopColor="#C41E3A" />
          <stop offset="100%" stopColor="#7f0d1c" />
        </linearGradient>
        <linearGradient id="alCargo" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#cbd5e1" />
          <stop offset="15%"  stopColor="#f1f5f9" />
          <stop offset="50%"  stopColor="#ffffff" />
          <stop offset="85%"  stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
        <radialGradient id="alBadge" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#E8192C" />
          <stop offset="100%" stopColor="#7f0d1c" />
        </radialGradient>
      </defs>

      <ellipse cx="100" cy="298" rx="80" ry="10" fill="rgba(0,0,0,0.28)" />

      {/* === CAB — white === */}
      <path d="M 68,14 Q 56,14 55,27 L 53,112 L 53,128 L 147,128 L 147,112 L 145,27 Q 144,14 132,14 Z"
        fill="url(#alCab)" />

      {/* Front bumper — red AL style */}
      <rect x="56" y="5" width="88" height="13" rx="4" fill="url(#alStripe)" />
      {/* Chrome over-rider */}
      <rect x="62" y="7" width="76" height="7" rx="3" fill="url(#chrome)" />

      {/* Headlights — round style (AL signature) */}
      <ellipse cx="66" cy="12" rx="12" ry="9" fill="url(#headlight)" />
      <ellipse cx="134" cy="12" rx="12" ry="9" fill="url(#headlight)" />
      <ellipse cx="66" cy="12" rx="7" ry="5.5" fill="#fde047" opacity="0.7" />
      <ellipse cx="134" cy="12" rx="7" ry="5.5" fill="#fde047" opacity="0.7" />
      {/* Red DRL accent */}
      <rect x="57" y="20" width="86" height="2.5" rx="1" fill="#E8192C" opacity="0.9" />

      {/* Hood — white */}
      <rect x="58" y="23" width="84" height="44" rx="4" fill="url(#alHood)" />
      <line x1="100" y1="25" x2="100" y2="66" stroke="#e2e8f0" strokeWidth="1" opacity="0.8" />
      {[0,1,2].map(i => (
        <rect key={i} x="70" y={30 + i * 10} width="60" height="4" rx="2"
          fill="#e2e8f0" opacity="0.6" />
      ))}

      {/* AL Badge on hood — circular logo */}
      <circle cx="100" cy="44" r="12" fill="url(#alBadge)" />
      <circle cx="100" cy="44" r="12" fill="none" stroke="#fca5a5" strokeWidth="0.8" />
      {/* AL text */}
      <text x="100" y="41" textAnchor="middle" fontSize="6" fontWeight="900"
        fill="white" letterSpacing="0.5">AL</text>
      <text x="100" y="51" textAnchor="middle" fontSize="2.8" fill="#fca5a5"
        letterSpacing="0.2" fontWeight="600">ASHOK LEYLAND</text>

      {/* Windshield */}
      <path d="M 61,67 L 139,67 L 135,85 L 65,85 Z" fill="url(#glassGrad)" />
      <path d="M 66,68 L 112,68 L 109,78 L 69,78 Z" fill="url(#glassReflect)" opacity="0.5" />
      <line x1="76" y1="83" x2="97" y2="69" stroke="#475569" strokeWidth="0.8" opacity="0.6" />
      <line x1="124" y1="83" x2="103" y2="69" stroke="#475569" strokeWidth="0.8" opacity="0.6" />

      {/* Cab interior */}
      <rect x="57" y="85" width="86" height="40" rx="3" fill="#e2e8f0" />
      <rect x="64" y="89" width="18" height="14" rx="3" fill="#cbd5e1" />
      <rect x="118" y="89" width="18" height="14" rx="3" fill="#cbd5e1" />
      <circle cx="80" cy="114" r="8" fill="none" stroke="#334155" strokeWidth="2.5" />
      <circle cx="80" cy="114" r="2.5" fill="#334155" />

      {/* Red AL brand stripe on cab bottom */}
      <rect x="57" y="120" width="86" height="9" fill="url(#alStripe)" />
      <text x="100" y="126.5" textAnchor="middle" fontSize="4" fontWeight="800"
        fill="white" letterSpacing="0.4">ASHOK LEYLAND · ECOMET</text>

      {/* === CHASSIS === */}
      <rect x="67" y="129" width="11" height="158" fill="#334155" />
      <rect x="122" y="129" width="11" height="158" fill="#334155" />
      {[0,1,2].map(i => (
        <rect key={i} x="67" y={145 + i * 45} width="66" height="6" fill="#475569" />
      ))}

      {/* === CARGO BOX — white with red stripes === */}
      <rect x="57" y="129" width="86" height="152" rx="3" fill="url(#alCargo)" />
      {/* Red side stripes */}
      <rect x="57" y="129" width="5" height="152" fill="#C41E3A" opacity="0.8" rx="1" />
      <rect x="138" y="129" width="5" height="152" fill="#C41E3A" opacity="0.8" rx="1" />
      {/* Cargo ribs */}
      {[0,1,2,3,4].map(i => (
        <line key={i} x1="59" y1={148 + i * 27} x2="141" y2={148 + i * 27}
          stroke="#94a3b8" strokeWidth="0.8" opacity="0.5" />
      ))}
      {/* AL badge on cargo body */}
      <circle cx="100" cy="200" r="14" fill="url(#alBadge)" opacity="0.9" />
      <circle cx="100" cy="200" r="14" fill="none" stroke="#fca5a5" strokeWidth="0.8" />
      <text x="100" y="197" textAnchor="middle" fontSize="7" fontWeight="900" fill="white">AL</text>
      <text x="100" y="207" textAnchor="middle" fontSize="3" fill="#fca5a5" letterSpacing="0.2">ASHOK LEYLAND</text>

      {/* Rear bumper */}
      <rect x="58" y="281" width="84" height="11" rx="3" fill="url(#alStripe)" />
      <rect x="60" y="282" width="22" height="7" rx="2" fill="url(#brakeLight)" />
      <rect x="118" y="282" width="22" height="7" rx="2" fill="url(#brakeLight)" />

      {/* Exhaust */}
      <circle cx="55" cy="268" r="3.5" fill="#374151" stroke="#1f2937" strokeWidth="0.8" />
      <circle cx="55" cy="268" r="1.8" fill="#111827" />

      {/* Mirrors — white */}
      <rect x="37" y="54" width="17" height="10" rx="3" fill="#e2e8f0" stroke="#C41E3A" strokeWidth="1" />
      <rect x="146" y="54" width="17" height="10" rx="3" fill="#e2e8f0" stroke="#C41E3A" strokeWidth="1" />
    </g>
  );
}

// ── Layout definitions ─────────────────────────────────────────────────────────
const LAYOUTS = {
  Pickup: {
    emoji: '🛻', viewH: 320,
    Body: PickupBody,
    tyres: [
      { id: 'FL', x: 32,  y: 48,  w: 23, h: 44, label: 'FL' },
      { id: 'FR', x: 145, y: 48,  w: 23, h: 44, label: 'FR' },
      { id: 'RL', x: 32,  y: 192, w: 23, h: 44, label: 'RL' },
      { id: 'RR', x: 145, y: 192, w: 23, h: 44, label: 'RR' },
    ],
  },
  'Wheel loader': {
    emoji: '🚜', viewH: 258,
    Body: WheelLoaderBody,
    tyres: [
      { id: 'FL', x: 24,  y: 22,  w: 32, h: 56, label: 'FL' },
      { id: 'FR', x: 144, y: 22,  w: 32, h: 56, label: 'FR' },
      { id: 'RL', x: 24,  y: 155, w: 32, h: 56, label: 'RL' },
      { id: 'RR', x: 144, y: 155, w: 32, h: 56, label: 'RR' },
    ],
  },
  'Skid loader': {
    emoji: '🚜', viewH: 258,
    Body: WheelLoaderBody,
    tyres: [
      { id: 'FL', x: 24,  y: 22,  w: 32, h: 56, label: 'FL' },
      { id: 'FR', x: 144, y: 22,  w: 32, h: 56, label: 'FR' },
      { id: 'RL', x: 24,  y: 155, w: 32, h: 56, label: 'RL' },
      { id: 'RR', x: 144, y: 155, w: 32, h: 56, label: 'RR' },
    ],
  },
  Canter: {
    emoji: '🚚', viewH: 310,
    Body: CanterBody,
    tyres: [
      { id: 'FL',  x: 31,  y: 36,  w: 22, h: 40, label: 'FL'  },
      { id: 'FR',  x: 147, y: 36,  w: 22, h: 40, label: 'FR'  },
      { id: 'RLo', x: 16,  y: 170, w: 20, h: 38, label: 'RLo' },
      { id: 'RLi', x: 38,  y: 170, w: 20, h: 38, label: 'RLi' },
      { id: 'RRi', x: 142, y: 170, w: 20, h: 38, label: 'RRi' },
      { id: 'RRo', x: 164, y: 170, w: 20, h: 38, label: 'RRo' },
    ],
  },
  'Tri-mixer': {
    emoji: '🚛', viewH: 360,
    Body: TriMixerBody,
    tyres: [
      { id: 'F1L',  x: 29,  y: 24,  w: 22, h: 38, label: 'F1L'  },
      { id: 'F1R',  x: 149, y: 24,  w: 22, h: 38, label: 'F1R'  },
      { id: 'F2L',  x: 29,  y: 76,  w: 22, h: 38, label: 'F2L'  },
      { id: 'F2R',  x: 149, y: 76,  w: 22, h: 38, label: 'F2R'  },
      { id: 'R1Lo', x: 14,  y: 170, w: 19, h: 35, label: 'R1Lo' },
      { id: 'R1Li', x: 35,  y: 170, w: 19, h: 35, label: 'R1Li' },
      { id: 'R1Ri', x: 146, y: 170, w: 19, h: 35, label: 'R1Ri' },
      { id: 'R1Ro', x: 167, y: 170, w: 19, h: 35, label: 'R1Ro' },
      { id: 'R2Lo', x: 14,  y: 218, w: 19, h: 35, label: 'R2Lo' },
      { id: 'R2Li', x: 35,  y: 218, w: 19, h: 35, label: 'R2Li' },
      { id: 'R2Ri', x: 146, y: 218, w: 19, h: 35, label: 'R2Ri' },
      { id: 'R2Ro', x: 167, y: 218, w: 19, h: 35, label: 'R2Ro' },
    ],
  },
  Bus: {
    emoji: '🚌', viewH: 330,
    Body: BusBody,
    tyres: [
      { id: 'FL',  x: 14,  y: 38,  w: 22, h: 42, label: 'FL'  },
      { id: 'FR',  x: 164, y: 38,  w: 22, h: 42, label: 'FR'  },
      { id: 'RLo', x: 0,   y: 192, w: 20, h: 38, label: 'RLo' },
      { id: 'RLi', x: 22,  y: 192, w: 20, h: 38, label: 'RLi' },
      { id: 'RRi', x: 158, y: 192, w: 20, h: 38, label: 'RRi' },
      { id: 'RRo', x: 180, y: 192, w: 20, h: 38, label: 'RRo' },
    ],
  },
  Tata: {
    emoji: '🚛', viewH: 305,
    Body: TataBody,
    tyres: [
      { id: 'FL',  x: 31,  y: 32,  w: 22, h: 40, label: 'FL'  },
      { id: 'FR',  x: 147, y: 32,  w: 22, h: 40, label: 'FR'  },
      { id: 'RLo', x: 16,  y: 178, w: 20, h: 36, label: 'RLo' },
      { id: 'RLi', x: 38,  y: 178, w: 20, h: 36, label: 'RLi' },
      { id: 'RRi', x: 142, y: 178, w: 20, h: 36, label: 'RRi' },
      { id: 'RRo', x: 164, y: 178, w: 20, h: 36, label: 'RRo' },
    ],
  },
  'Ashok Leyland': {
    emoji: '🚚', viewH: 305,
    Body: AshokLeylandBody,
    tyres: [
      { id: 'FL',  x: 31,  y: 32,  w: 22, h: 40, label: 'FL'  },
      { id: 'FR',  x: 147, y: 32,  w: 22, h: 40, label: 'FR'  },
      { id: 'RLo', x: 16,  y: 178, w: 20, h: 36, label: 'RLo' },
      { id: 'RLi', x: 38,  y: 178, w: 20, h: 36, label: 'RLi' },
      { id: 'RRi', x: 142, y: 178, w: 20, h: 36, label: 'RRi' },
      { id: 'RRo', x: 164, y: 178, w: 20, h: 36, label: 'RRo' },
    ],
  },
  'Concrete pump': {
    emoji: '🏗️', viewH: 375,
    Body: ConcretePumpBody,
    tyres: [
      { id: 'FL',   x: 29,  y: 24,  w: 22, h: 38, label: 'FL'   },
      { id: 'FR',   x: 149, y: 24,  w: 22, h: 38, label: 'FR'   },
      { id: 'R1Lo', x: 13,  y: 130, w: 19, h: 33, label: 'R1Lo' },
      { id: 'R1Li', x: 34,  y: 130, w: 19, h: 33, label: 'R1Li' },
      { id: 'R1Ri', x: 147, y: 130, w: 19, h: 33, label: 'R1Ri' },
      { id: 'R1Ro', x: 168, y: 130, w: 19, h: 33, label: 'R1Ro' },
      { id: 'R2Lo', x: 13,  y: 176, w: 19, h: 33, label: 'R2Lo' },
      { id: 'R2Li', x: 34,  y: 176, w: 19, h: 33, label: 'R2Li' },
      { id: 'R2Ri', x: 147, y: 176, w: 19, h: 33, label: 'R2Ri' },
      { id: 'R2Ro', x: 168, y: 176, w: 19, h: 33, label: 'R2Ro' },
      { id: 'R3Lo', x: 13,  y: 222, w: 19, h: 33, label: 'R3Lo' },
      { id: 'R3Li', x: 34,  y: 222, w: 19, h: 33, label: 'R3Li' },
      { id: 'R3Ri', x: 147, y: 222, w: 19, h: 33, label: 'R3Ri' },
      { id: 'R3Ro', x: 168, y: 222, w: 19, h: 33, label: 'R3Ro' },
    ],
  },
};

// ── Risk level mapping (checklist uses 'Low'/'Medium'/'Critical', diagram uses 'good'/'warning'/'critical') ──
const LEVEL_TO_RISK = {
  good: 'good', Good: 'good', Low: 'good', low: 'good',
  warning: 'warning', Warning: 'warning', Medium: 'warning', medium: 'warning', High: 'warning', high: 'warning',
  critical: 'critical', Critical: 'critical',
  none: 'none',
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function VehicleTyreDiagram({ vehicleType, positions, tyreData, onPositionClick, onTyreClick, width = 240 }) {
  const resolved = resolveVehicleType(vehicleType)
  const layout = LAYOUTS[resolved] || LAYOUTS['Pickup']

  const { emoji, viewH, Body, tyres } = layout;
  const scale = width / 200;

  // Build unified riskMap: { id -> 'good'|'warning'|'critical'|'none' }
  const riskMap = {}
  if (positions && Array.isArray(positions)) {
    positions.forEach(p => { riskMap[p.position] = LEVEL_TO_RISK[p.risk_level] || 'none' })
  } else if (tyreData && typeof tyreData === 'object') {
    Object.entries(tyreData).forEach(([id, v]) => {
      riskMap[id] = LEVEL_TO_RISK[typeof v === 'string' ? v : v?.risk] || 'none'
    })
  }

  // Support both prop-naming conventions; wrap so both receive { position } shape
  const handleClick = onPositionClick
    ? (id) => onPositionClick({ position: id })
    : onTyreClick

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Title */}
      <div className="text-sm font-bold text-gray-100 flex items-center gap-2">
        <span className="text-xl">{emoji}</span>
        <span>{resolved}</span>
        <span className="text-gray-500 font-normal text-xs">· {tyres.length} tyres</span>
      </div>

      {/* SVG */}
      <svg
        viewBox={`-10 -5 220 ${viewH + 10}`}
        width={width}
        height={(viewH + 15) * scale}
        className="overflow-visible"
        style={{ filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }}
      >
        <SharedDefs />

        {/* FRONT label */}
        <text x="100" y="-2" textAnchor="middle" fontSize="5.5" fill="#64748b"
          fontWeight="600" letterSpacing="1">▲ FRONT</text>

        {/* Vehicle body illustration */}
        <Body />

        {/* Tyres rendered on top */}
        {tyres.map(t => (
          <Tyre
            key={t.id}
            {...t}
            risk={riskMap[t.id] ?? 'none'}
            onClick={handleClick}
          />
        ))}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {Object.entries(RISK).map(([key, col]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 rounded-full"
              style={{ background: `radial-gradient(circle at 35% 35%, ${col.rim}, ${col.dark})` }} />
            <span className="text-xs text-gray-400">{col.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
