/**
 * Bottom cards of the Tyre Lifecycle Tracker: life progression by corner and
 * top brands by measured life. Plain SVG and CSS on the --cc-* tokens, so light
 * and dark come from the same sheet. Data is shaped in src/lib/tyreLifecycleView.js.
 */
import { fmtInt } from '../commandCenter/kit'
import { CORNERS } from '../../lib/tyreLifecycleView'

export const CORNER_COLOR = {
  FL: 'var(--cc-green)', FR: 'var(--cc-blue)', RL: 'var(--cc-orange)', RR: 'var(--cc-purple)',
}
export const CORNER_LABEL = { FL: 'Front left', FR: 'Front right', RL: 'Rear left', RR: 'Rear right' }

const W = 380; const H = 210; const L = 38; const R = 10; const T = 12; const B = 34
const X_MAX = 140000

export function LifeProgressionChart({ data }) {
  const yMax = Math.max(100, Math.ceil(Math.max(0, ...data.series.flatMap((s) => s.points.map((p) => p.y))) / 20) * 20)
  const cap = Math.min(yMax, 160)
  const sx = (x) => L + ((x + 10000) / X_MAX) * (W - L - R)
  const sy = (y) => T + (1 - Math.min(y, cap) / cap) * (H - T - B)
  const yTicks = []
  for (let v = 0; v <= cap; v += cap > 100 ? 40 : 20) yTicks.push(v)
  const xTicks = [0, 20000, 40000, 60000, 80000, 100000, 120000]
  const label = data.series.map((s) => `${CORNER_LABEL[s.corner]}: ${s.points.map((p) => `${Math.round(p.y)}% at ${Math.round(p.x / 1000)}k km`).join(', ') || 'no data'}`).join('. ')
  return (
    <div className="tlc-prog">
      <ul className="tlc-legend" aria-hidden="true">
        {CORNERS.map((c) => <li key={c}><i style={{ background: CORNER_COLOR[c] }} />{c}</li>)}
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} className="tlc-svg" role="img" aria-label={`Life used against distance run by wheel corner. ${label}`}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="tlc-grid" />
            <text x={L - 6} y={sy(v) + 3} textAnchor="end" className="tlc-tick">{v}</text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={v} x={sx(v)} y={H - B + 14} textAnchor="middle" className="tlc-tick">{v === 120000 ? '120k+' : v ? `${v / 1000}k` : '0'}</text>
        ))}
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="tlc-axis">Distance run (km)</text>
        <text x={10} y={(T + H - B) / 2} textAnchor="middle" className="tlc-axis" transform={`rotate(-90 10 ${(T + H - B) / 2})`}>Life used %</text>
        {data.series.map((s) => (
          <g key={s.corner}>
            {s.points.length > 1 && (
              <polyline fill="none" stroke={CORNER_COLOR[s.corner]} strokeWidth="2" points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} />
            )}
            {s.points.map((p) => (
              <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r="3.2" fill={CORNER_COLOR[s.corner]}>
                <title>{`${s.corner}: ${Math.round(p.y)}% life used, ${fmtInt(p.n)} tyres`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
    </div>
  )
}

export function TopBrandsBars({ brands }) {
  const max = Math.max(...brands.map((b) => b.avgKm), 1)
  return (
    <ul className="tlc-brands">
      {brands.map((b) => (
        <li key={b.brand} title={`${fmtInt(b.n)} measured tyres`}>
          <span className="tlc-brand-name">{b.brand}</span>
          <span className="tlc-brand-track"><i style={{ width: `${(b.avgKm / max) * 100}%` }} /></span>
          <b>{fmtInt(Math.round(b.avgKm))}</b>
        </li>
      ))}
    </ul>
  )
}
