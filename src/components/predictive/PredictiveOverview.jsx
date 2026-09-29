/**
 * Overview cards for /predictive-maintenance, built on the shared page kit
 * (src/components/commandCenter/kit.jsx). Presentation only: every figure comes
 * from src/lib/predictiveOverview.js over the canonical prediction engine.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Wrench, CalendarPlus, Download, Info } from 'lucide-react'
import { Card, ViewAll, Donut, Pager, fmtInt, fmtPct } from '../commandCenter/kit'
import {
  RISK_LEVEL_LABEL, RISK_LEVEL_RANGE, DUE_SOON_DAYS, filterRecommendations,
} from '../../lib/predictiveOverview'

export const LEVEL_PILL = { high: 'bad', medium: 'orange', low: 'warn', healthy: 'good' }
const PRIORITY_PILL = { high: 'bad', medium: 'warn', low: 'good' }
const RANK_TONE = ['var(--cc-red)', 'var(--cc-red)', 'var(--cc-orange)', 'var(--cc-amber)', 'var(--cc-amber)']
const LOW_YELLOW = 'color-mix(in srgb, var(--cc-amber) 55%, #fde047)'
const LEVEL_COLOR = { high: 'var(--cc-red)', medium: 'var(--cc-orange)', low: LOW_YELLOW, healthy: 'var(--cc-green)' }
const SERIES_STYLE = {
  tyre: { fill: 'var(--cc-green-strong)', opacity: 1 },
  inspection: { fill: 'var(--cc-green)', opacity: 0.5 },
  rotation: { fill: LOW_YELLOW, opacity: 1 },
  tyre_service: { fill: 'var(--cc-blue)', opacity: 0.7 },
  general: { fill: 'var(--cc-ink-3)', opacity: 0.35 },
}

const daysText = (d) => {
  if (d == null) return 'N/A'
  if (d < 0) return `${Math.abs(d)} days overdue`
  if (d === 0) return 'Today'
  return `${d} day${d === 1 ? '' : 's'}`
}

function NiceSelect({ label, value, onChange, options }) {
  return (
    <select className="cc-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ── Risk-scored assets ──────────────────────────────────────────────────────
export function RiskScoredAssets({ assets, onViewAll }) {
  const top = assets.slice(0, 5)
  return (
    <Card title="Risk-scored assets" sub="Ranked by composite tyre failure risk (worst tyre)"
      action={<ViewAll onClick={onViewAll} label="View all" />} className="pm-a-risk">
      {top.length === 0 ? <div className="cc-empty">No active tyres have been scored yet.</div> : (
        <div className="cc-table-wrap">
          <table className="cc-table pm-compact">
            <thead><tr><th>Rank</th><th>Asset / fleet no.</th><th>Risk score</th><th>Predicted issue</th><th>Est. days</th><th><span className="sr-only">Action</span></th></tr></thead>
            <tbody>
              {top.map((a, i) => (
                <tr key={a.asset_no}>
                  <td><span className="pm-rank" style={{ background: RANK_TONE[i] }}>{i + 1}</span></td>
                  <td>
                    <span className="cc-strong">{a.asset_no}</span>
                    <span className="cc-sub">{[a.make, a.model].filter(Boolean).join(' ') || a.vehicle_type || a.site || 'N/A'}</span>
                  </td>
                  <td><span className={`cc-pill ${LEVEL_PILL[a.level] || 'muted'}`} title={`Composite risk 0 to 100. ${RISK_LEVEL_LABEL[a.level] || ''} is ${RISK_LEVEL_RANGE[a.level] || ''}.`}>{a.score != null ? Math.round(a.score) : 'N/A'}</span></td>
                  <td>{a.issue || <span className="cc-na" title="No single factor stands out">No dominant factor</span>}</td>
                  <td title="Days until the earliest tyre on this asset reaches its replacement limit">{a.minDays != null ? a.minDays : 'N/A'}</td>
                  <td className="pm-row-act">
                    <Link className="cc-btn pm-btn-sm" to={`/asset-management/${encodeURIComponent(a.asset_no)}`} aria-label={`View ${a.asset_no}`}>View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ── Maintenance forecast (stacked bars) ─────────────────────────────────────
export function MaintenanceForecast({ forecast, months, onMonths, pmState }) {
  const W = 360; const H = 200; const padL = 26; const padB = 22; const padT = 6
  const max = Math.max(1, forecast.max)
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const ticks = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  const bw = (W - padL - 6) / forecast.labels.length
  const y = (v) => padT + (H - padT - padB) * (1 - v / top)
  return (
    <Card title="Maintenance forecast" sub={`Predicted demand, next ${months} months`} className="pm-a-fc"
      action={<NiceSelect label="Forecast period" value={String(months)} onChange={(v) => onMonths(Number(v))}
        options={[{ value: '3', label: 'Next 3 months' }, { value: '6', label: 'Next 6 months' }, { value: '12', label: 'Next 12 months' }]} />}>
      {forecast.series.length > 0 && (
        <div className="pm-legend">
          {forecast.series.map((s) => (
            <span key={s.key}><i style={{ background: SERIES_STYLE[s.key].fill, opacity: SERIES_STYLE[s.key].opacity }} aria-hidden="true" />{s.label}</span>
          ))}
        </div>
      )}
      {pmState?.error && <p className="pm-note" role="status">Service plans could not be loaded, so only tyre replacements are shown.</p>}
      {forecast.series.length === 0 ? <div className="cc-empty">No predicted maintenance demand in this period.</div> : (
        <div className="pm-chart">
          <svg viewBox={`0 0 ${W} ${H}`} role="img"
            aria-label={forecast.labels.map((l, i) => `${l} ${forecast.totals[i]}`).join(', ')}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--cc-track)" />
                <text x={padL - 5} y={y(t) + 3} textAnchor="end" className="cc-axis">{t}</text>
              </g>
            ))}
            {forecast.labels.map((l, i) => {
              let acc = 0
              const x = padL + i * bw + bw * 0.22
              const w = bw * 0.56
              return (
                <g key={l + i}>
                  {forecast.series.map((s) => {
                    const v = s.values[i]
                    if (!v) return null
                    const y1 = y(acc + v); const y0 = y(acc)
                    acc += v
                    return <rect key={s.key} x={x} y={y1} width={w} height={Math.max(0, y0 - y1)} fill={SERIES_STYLE[s.key].fill} fillOpacity={SERIES_STYLE[s.key].opacity}><title>{`${l}: ${s.label} ${v}`}</title></rect>
                  })}
                  <text x={x + w / 2} y={H - 6} textAnchor="middle" className="cc-axis">{l}</text>
                </g>
              )
            })}
          </svg>
        </div>
      )}
    </Card>
  )
}

function niceStep(max) {
  const raw = max / 5
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  const n = raw / mag
  const s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return Math.max(1, s * mag)
}

// ── Due soon ────────────────────────────────────────────────────────────────
export function DueSoon({ rows, onViewAll }) {
  const top = rows.slice(0, 5)
  return (
    <Card title="Due soon" sub={`Assets requiring service in the next ${DUE_SOON_DAYS} days`} className="pm-a-due"
      action={<ViewAll onClick={onViewAll} label="View all" />}>
      {top.length === 0 ? <div className="cc-empty">Nothing is due in the next {DUE_SOON_DAYS} days.</div> : (
        <div className="cc-table-wrap">
          <table className="cc-table pm-compact">
            <thead><tr><th>Asset / fleet no.</th><th>Service type</th><th>Due in</th><th>Priority</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.key}>
                  <td><span className="cc-strong">{r.asset_no || 'N/A'}</span><span className="cc-sub">{r.site || 'No site'}</span></td>
                  <td>{r.service}{r.detail && <span className="cc-sub">{r.detail}</span>}</td>
                  <td className={r.days < 0 ? 'pm-overdue' : undefined}>{daysText(r.days)}</td>
                  <td><span className={`cc-pill ${PRIORITY_PILL[r.priority]}`}>{r.priority === 'high' ? 'High' : r.priority === 'medium' ? 'Medium' : 'Low'}</span></td>
                  <td className="pm-row-act">
                    <Link to={r.source === 'pm' ? '/pm-programs' : `/asset-management/${encodeURIComponent(r.asset_no || '')}`}
                      className="cc-icon-btn" aria-label={`Open ${r.service} for ${r.asset_no || 'asset'}`}><ChevronRight size={15} aria-hidden="true" /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ── Tyre health trend (removals) ────────────────────────────────────────────
export function TyreHealthTrend({ trend }) {
  const W = 520; const H = 170; const padL = 28; const padB = 20; const padT = 8
  const max = Math.max(1, ...trend.all)
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const ticks = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  const n = trend.labels.length
  const x = (i) => padL + ((W - padL - 8) * i) / Math.max(1, n - 1)
  const y = (v) => padT + (H - padT - padB) * (1 - v / top)
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ')
  const area = (vals) => `${path(vals)} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`
  return (
    <Card title="Tyre health trends" className="pm-a-trend"
      sub={<>Tyre removals per month, last 6 months <span className="pm-tip" title="Composite health scores are computed from current readings and are not stored over time, so removal history is the honest trend. Early removals came off before the fleet average tyre life."><Info size={12} aria-label="About this chart" /></span></>}
      action={(
        <div className="pm-legend pm-legend-inline">
          <span><i style={{ background: 'var(--cc-green)' }} aria-hidden="true" />All removals</span>
          {trend.early && <span><i style={{ background: 'var(--cc-red)' }} aria-hidden="true" />Early removals</span>}
        </div>
      )}>
      {trend.total === 0 ? <div className="cc-empty">No tyre removals recorded in the last 6 months.</div> : (
        <div className="pm-chart">
          <svg viewBox={`0 0 ${W} ${H}`} role="img"
            aria-label={trend.labels.map((l, i) => `${l} ${trend.all[i]} removals${trend.early ? `, ${trend.early[i]} early` : ''}`).join('; ')}>
            <defs>
              <linearGradient id="pmTrendG" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--cc-green)" stopOpacity="0.22" /><stop offset="1" stopColor="var(--cc-green)" stopOpacity="0" /></linearGradient>
              <linearGradient id="pmTrendR" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--cc-red)" stopOpacity="0.18" /><stop offset="1" stopColor="var(--cc-red)" stopOpacity="0" /></linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke="var(--cc-track)" />
                <text x={padL - 5} y={y(t) + 3} textAnchor="end" className="cc-axis">{t}</text>
              </g>
            ))}
            <path d={area(trend.all)} fill="url(#pmTrendG)" />
            <path d={path(trend.all)} fill="none" stroke="var(--cc-green)" strokeWidth="2" />
            {trend.all.map((v, i) => <circle key={`a${i}`} cx={x(i)} cy={y(v)} r="3" fill="var(--cc-green)"><title>{`${trend.labels[i]}: ${v} removals`}</title></circle>)}
            {trend.early && (
              <>
                <path d={area(trend.early)} fill="url(#pmTrendR)" />
                <path d={path(trend.early)} fill="none" stroke="var(--cc-red)" strokeWidth="2" />
                {trend.early.map((v, i) => <circle key={`e${i}`} cx={x(i)} cy={y(v)} r="3" fill="var(--cc-red)"><title>{`${trend.labels[i]}: ${v} early removals`}</title></circle>)}
              </>
            )}
            {trend.labels.map((l, i) => <text key={l + i} x={x(i)} y={H - 4} textAnchor="middle" className="cc-axis">{l}</text>)}
          </svg>
        </div>
      )}
    </Card>
  )
}

// ── Risk distribution ───────────────────────────────────────────────────────
export function RiskDistribution({ dist, onSelect }) {
  const total = dist.reduce((s, d) => s + d.count, 0)
  return (
    <Card title="Risk distribution" sub="Current asset risk profile" className="pm-a-dist">
      {total === 0 ? <div className="cc-empty">No scored assets yet.</div> : (
        <Donut
          segments={dist.map((d) => ({ label: d.label, count: d.count, color: LEVEL_COLOR[d.level], level: d.level }))}
          total={total}
          centerLabel="Assets"
          onSelect={onSelect ? (s) => onSelect(s.level) : undefined}
        />
      )}
    </Card>
  )
}

// ── Predicted failure types ─────────────────────────────────────────────────
export function FailureTypes({ types, horizon, onHorizon }) {
  const max = Math.max(1, ...types.map((t) => t.count))
  const tones = ['var(--cc-red)', 'var(--cc-orange)', LOW_YELLOW, 'var(--cc-green)', 'var(--cc-green)']
  return (
    <Card title="Predicted failure types" className="pm-a-types"
      sub="Replacements forecast, by the factor that limits each tyre"
      action={<NiceSelect label="Failure type horizon" value={String(horizon)} onChange={(v) => onHorizon(Number(v))}
        options={[{ value: '90', label: 'Next 3 months' }, { value: '180', label: 'Next 6 months' }, { value: '365', label: 'Next 12 months' }]} />}>
      {types.length === 0 ? <div className="cc-empty">No replacements forecast in this period.</div> : (
        <ul className="pm-hbars">
          {types.map((t, i) => (
            <li key={t.label}>
              <span className="pm-hbar-label">{t.label}</span>
              <b>{fmtInt(t.count)}</b>
              <span className="cc-bar-track" aria-hidden="true"><i style={{ width: `${(t.count / max) * 100}%`, background: tones[i] || tones[4] }} /></span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ── Recommendations ─────────────────────────────────────────────────────────
export function Recommendations({ recs, sites, currency, currencySafe, canCreate, onCreateJob, onExport, filterLevel, setFilterLevel }) {
  const [type, setType] = useState('all')
  const [site, setSite] = useState('all')
  const [selected, setSelected] = useState(() => new Set())
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const rows = useMemo(() => filterRecommendations(recs, { level: filterLevel, type, site }), [recs, filterLevel, type, site])
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, pages - 1)
  const visible = rows.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))
  const picked = rows.filter((r) => selected.has(r.id))

  return (
    <Card className="pm-recs"
      title={<>Predictive recommendations <span className="pm-title-note">Data-driven actions to prevent tyre failures, from the prediction engine</span></>}
      action={(
        <div className="pm-rec-filters">
          <NiceSelect label="Risk level" value={filterLevel} onChange={(v) => { setFilterLevel(v); setPage(0) }}
            options={[{ value: 'all', label: 'All risk levels' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }, { value: 'healthy', label: 'Healthy' }]} />
          <NiceSelect label="Recommendation type" value={type} onChange={(v) => { setType(v); setPage(0) }}
            options={[{ value: 'all', label: 'All recommendations' }, { value: 'replace', label: 'Replace' }, { value: 'inspect', label: 'Inspect' }]} />
          <NiceSelect label="Site" value={site} onChange={(v) => { setSite(v); setPage(0) }}
            options={[{ value: 'all', label: 'All sites' }, ...sites.map((s) => ({ value: s, label: s }))]} />
        </div>
      )}>
      {picked.length > 0 && (
        <div className="cc-bulk" role="status">
          <span className="cc-bulk-count">{picked.length} selected</span>
          <button type="button" className="cc-btn-ghost" onClick={() => onExport(picked)}><Download size={14} aria-hidden="true" /> Export selected</button>
          <button type="button" className="cc-btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="cc-empty">{recs.length ? 'No recommendations match these filters.' : 'No asset needs action right now: no tyre is due within 90 days and no asset is at Medium or High risk.'}</div>
      ) : (
        <div className="cc-table-wrap">
          <table className="cc-table pm-compact">
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select all recommendations" checked={allOn} onChange={toggleAll} /></th>
                <th>Asset / fleet no.</th><th>Recommendation</th><th>Predicted benefit</th>
                <th title={currencySafe ? 'Estimated replacement cost from tyre prices' : 'Pick a country to see cost in its own currency'}>Est. cost</th>
                <th title="Share of completed tyre lives behind the prediction (6 or more = 100%)">Confidence</th>
                <th>Risk level</th><th>Target date</th><th>Status</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} aria-selected={selected.has(r.id)}>
                  <td><input type="checkbox" aria-label={`Select ${r.asset_no}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td>
                    <Link to={`/asset-management/${encodeURIComponent(r.asset_no)}`} className="cc-strong pm-asset-link">{r.asset_no}</Link>
                    <span className="cc-sub">{[r.make, r.model].filter(Boolean).join(' ') || r.site || 'N/A'}</span>
                  </td>
                  <td><span className="pm-rec-text"><Wrench size={13} aria-hidden="true" />{r.text}</span></td>
                  <td className="pm-wrap">{r.benefit}</td>
                  <td>{r.cost != null ? `${currency} ${fmtInt(Math.round(r.cost))}` : <span className="cc-na" title={currencySafe ? 'No tyre price on record for these tyres' : 'Pick a country: costs are not added across currencies'}>N/A</span>}</td>
                  <td>
                    {r.confidence != null ? (
                      <span className="pm-conf"><span className="cc-meter-track"><span style={{ width: `${Math.round(r.confidence * 100)}%`, background: 'var(--cc-green)' }} /></span>{fmtPct(r.confidence * 100)}</span>
                    ) : <span className="cc-na">N/A</span>}
                  </td>
                  <td><span className={`cc-pill ${LEVEL_PILL[r.level] || 'muted'}`}>{RISK_LEVEL_LABEL[r.level] || 'N/A'}</span></td>
                  <td>{r.targetDays == null ? 'N/A' : daysText(r.targetDays)}</td>
                  <td>{r.status === 'job_open'
                    ? <span className="cc-pill info" title="An open work order already exists for this asset">Job open</span>
                    : <span className="cc-pill muted" title="No open work order for this asset">No job</span>}</td>
                  <td className="pm-row-act">
                    {r.type === 'replace' ? (
                      <button type="button" className="cc-btn pm-btn-sm" disabled={!canCreate}
                        title={canCreate ? undefined : 'You do not have permission to create work orders'}
                        onClick={() => onCreateJob(r)}>Create job</button>
                    ) : (
                      <Link className="cc-btn pm-btn-sm pm-btn-info" to="/pm-programs"><CalendarPlus size={12} aria-hidden="true" /> Schedule</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > pageSize && (
        <Pager page={safePage} pageSize={pageSize} total={rows.length} onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(0) }} sizes={[10, 25, 50]} noun="recommendations" />
      )}
    </Card>
  )
}
