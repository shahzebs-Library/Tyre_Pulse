/**
 * KPI tile with a sub-line, for the scrap and retread pages. Same skin as the
 * kit's Kpi (cc-card cc-kpi, coloured icon circle, kit Trend) plus the
 * explanatory line under the value the owner's mockups carry ("Last 180 days",
 * "Priced on 12 of 30"). Lives outside kit.jsx so the shared kit is untouched.
 */
import { Trend } from '../commandCenter/kit'
import './TyreKpiTile.css'

export default function TyreKpiTile({ icon: Icon, tone = 't-green', label, display, sub, trend, goodWhenUp = true, trendTitle, title, loading, onClick, active }) {
  const body = (
    <>
      <span className={`cc-kpi-icon ${tone}`}><Icon size={21} aria-hidden="true" /></span>
      <div className="cc-kpi-body tk-body">
        <div className="tk-top">
          <span className="cc-kpi-label tk-label">{label}</span>
          <Trend value={loading ? null : trend} goodWhenUp={goodWhenUp} title={trendTitle} />
        </div>
        <div className="cc-kpi-val tk-val">{loading ? '...' : display}</div>
        {sub && <div className="tk-sub">{sub}</div>}
      </div>
    </>
  )
  const cls = `cc-card cc-kpi tk-tile${active ? ' tk-active' : ''}`
  if (onClick) return <button type="button" className={cls} onClick={onClick} title={title} aria-pressed={active || undefined}>{body}</button>
  return <div className={cls} title={title}>{body}</div>
}
