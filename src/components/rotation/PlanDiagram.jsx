/**
 * Simple four-wheel plan diagram: the chosen positions highlighted, with a
 * spare slot. Illustrates the recorded plan; it does not claim an axle layout.
 */
const SLOTS = [
  { key: 'FL', x: 8, y: 14 }, { key: 'FR', x: 72, y: 14 },
  { key: 'RL', x: 8, y: 92 }, { key: 'RR', x: 72, y: 92 },
]

export default function PlanDiagram({ positions = [], tone = 'var(--cc-green)', label }) {
  const on = new Set(positions)
  return (
    <figure className="rs-diagram">
      <figcaption>{label}</figcaption>
      <svg viewBox="0 0 100 150" role="img" aria-label={`${label}: ${positions.length ? positions.join(', ') : 'none recorded'}`}>
        <rect x="30" y="8" width="40" height="126" rx="12" fill="var(--cc-track)" stroke="var(--cc-inner-border)" />
        <rect x="36" y="18" width="28" height="22" rx="4" fill="var(--cc-inner-border)" />
        {SLOTS.map((s) => (
          <g key={s.key}>
            <rect x={s.x} y={s.y} width="20" height="34" rx="5" fill={on.has(s.key) ? tone : 'var(--cc-card-flat)'} stroke={on.has(s.key) ? tone : 'var(--cc-ink-3)'} />
            <text x={s.x + 10} y={s.y + 21} textAnchor="middle" fontSize="8" fontWeight="700" fill={on.has(s.key) ? '#fff' : 'var(--cc-ink-2)'}>{s.key}</text>
          </g>
        ))}
        <text x="50" y="146" textAnchor="middle" fontSize="7" fill={on.has('Spare') ? tone : 'var(--cc-ink-3)'}>{on.has('Spare') ? 'Spare included' : ''}</text>
      </svg>
    </figure>
  )
}
