/**
 * Shared page kit for the redesigned screens (Command Center, Fleet Master,
 * Asset Management). One visual system, light and dark from the same tokens in
 * commandCenter.css: wrap a page in <div className="cc"> and build it from these.
 *
 * Nothing here fetches or fabricates. A value that cannot be measured renders
 * "N/A", and a trend is drawn only when the caller could compute one.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, ArrowUp, ArrowDown, ChevronLeft, ChevronRight,
  Truck, Bus, Construction, Factory, Container, Car,
} from 'lucide-react'
import { toUserMessage } from '../../lib/safeError'
import EnterpriseTable from '../ui/EnterpriseTable'
import { vehiclePhoto, vehicleKind } from '../../lib/vehiclePhoto'
import './commandCenter.css'

export const fmtInt = (n) => (n == null || Number.isNaN(Number(n)) ? 'N/A' : Number(n).toLocaleString('en-US'))
export const fmtPct = (n) => (n == null || Number.isNaN(Number(n)) ? 'N/A' : `${Math.round(Number(n))}%`)

/** One loader per card, so each card loads, fails and retries on its own. */
export function useCard(loader, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const seq = useRef(0)
  const run = useCallback(() => {
    const id = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.resolve().then(loader).then(
      (data) => { if (id === seq.current) setState({ loading: false, data, error: null }) },
      (e) => { if (id === seq.current) setState({ loading: false, data: null, error: toUserMessage(e, 'Could not load this section.') }) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { run() }, [run])
  return { ...state, retry: run }
}

export function Card({ area, title, sub, action, children, className = '', style }) {
  return (
    <section className={`cc-card ${area || ''} ${className}`} aria-label={typeof title === 'string' ? title : undefined} style={style}>
      {(title || action) && (
        <div className="cc-card-head">
          <div>
            {title && <h2 className="cc-card-title">{title}</h2>}
            {sub && <p className="cc-card-sub">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function ViewAll({ to, label = 'View all', onClick }) {
  if (onClick) return <button type="button" className="cc-link cc-link-btn" onClick={onClick}>{label} <ArrowRight size={13} aria-hidden="true" /></button>
  return <Link className="cc-link" to={to}>{label} <ArrowRight size={13} aria-hidden="true" /></Link>
}

export function CardState({ state, empty, lines = 4, children }) {
  if (state.loading && !state.data) {
    return <div style={{ display: 'grid', gap: 10 }}>{Array.from({ length: lines }, (_, i) => <div key={i} className="cc-skel" style={{ height: 30 }} />)}</div>
  }
  if (state.error) {
    return <div className="cc-empty" role="alert"><div>{state.error}<br /><button type="button" className="cc-btn" onClick={state.retry}>Try again</button></div></div>
  }
  if (empty) return <div className="cc-empty">{empty}</div>
  return children
}

export function Tabs({ tabs, value, onChange, label, variant }) {
  return (
    <div className={`cc-tabs ${variant === 'line' ? 'cc-tabs-line' : ''}`} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" className="cc-tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>
          {t.label}{t.count != null && <span className={`cc-count ${t.countTone || ''}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Trend({ value, goodWhenUp = true, title = 'Change over the last 30 days' }) {
  if (value == null) return null
  if (value === 0) return <span className="cc-kpi-trend flat" title={title}><ArrowRight size={12} aria-hidden="true" /> 0%</span>
  const up = value > 0
  const cls = up === goodWhenUp ? (up ? 'up-good' : 'down-good') : (up ? 'up-bad' : 'down-bad')
  return (
    <span className={`cc-kpi-trend ${cls}`} title={title}>
      {up ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}{Math.abs(value)}%
    </span>
  )
}

/** KPI tile. `display` overrides the formatted value (e.g. "82" or "76%"). */
export function Kpi({ icon: Icon, tone, value, display, label, to, onClick, trend, goodWhenUp, loading, danger, title }) {
  const body = (
    <>
      <span className={`cc-kpi-icon ${tone}`}><Icon size={21} aria-hidden="true" /></span>
      <div className="cc-kpi-body">
        <div className="cc-kpi-val" style={danger ? { color: 'var(--cc-red)' } : undefined}>{loading ? '...' : (display ?? fmtInt(value))}</div>
        <div className="cc-kpi-label">{label}</div>
      </div>
      <Trend value={trend} goodWhenUp={goodWhenUp} />
    </>
  )
  if (to) return <Link to={to} className="cc-card cc-kpi" title={title}>{body}</Link>
  if (onClick) return <button type="button" onClick={onClick} className="cc-card cc-kpi" title={title}>{body}</button>
  return <div className="cc-card cc-kpi" title={title}>{body}</div>
}

/**
 * Page hero: title, lead line, class artwork for light and dark, and an
 * optional headline stat on the right.
 */
export function PageHero({ hello, title, lead, imgLight, imgDark, stat }) {
  return (
    <div className="cc-hero">
      {imgDark && <div className="cc-hero-img cc-hero-dark" style={{ backgroundImage: `url(${imgDark})` }} aria-hidden="true" />}
      {imgLight && <div className="cc-hero-img cc-hero-light" style={{ backgroundImage: `url(${imgLight})` }} aria-hidden="true" />}
      <div className="cc-hero-copy">
        {hello && <p className="cc-hero-hello">{hello}</p>}
        <h1>{title}</h1>
        {lead && <p className="cc-hero-lead">{lead}</p>}
      </div>
      {stat && (
        <div className="cc-hero-stat">
          <b>{stat.value}</b>
          <span>{stat.lines.map((l, i) => <span key={i} style={{ display: 'block', marginTop: 0 }}>{l}</span>)}</span>
          <i aria-hidden="true" />
        </div>
      )}
    </div>
  )
}

const KIND_ICON = {
  bus: Bus, pickup: Car, wheelLoader: Construction, skidLoader: Construction, trailer: Container,
  generator: Factory, chiller: Factory, batchingPlant: Factory, placingBoom: Factory, stationaryPump: Factory,
  towablePump: Container, tyreless: Factory,
}

/**
 * Vehicle picture: the asset's own photo URL when the caller has one, else the
 * shared class artwork (same rules as the Flutter app), else a neutral icon.
 */
export function VehicleThumb({ row, src, size = 'md' }) {
  const [failed, setFailed] = useState(false)
  const url = !failed ? (src || vehiclePhoto(row)) : null
  const Icon = KIND_ICON[vehicleKind(row)] || Truck
  return (
    <span className={`cc-thumb cc-thumb-${size}`}>
      {url
        ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <Icon size={size === 'lg' ? 28 : 18} aria-hidden="true" />}
    </span>
  )
}

/** Donut with a centred total and a legend table of label, count and share. */
export function Donut({ segments, total, centerLabel, onSelect }) {
  const sum = segments.reduce((s, x) => s + (x.count || 0), 0)
  const R = 52; const C = 2 * Math.PI * R
  let off = 0
  return (
    <div className="cc-donut-wrap">
      <svg viewBox="0 0 140 140" className="cc-donut" role="img" aria-label={segments.map((s) => `${s.label} ${s.count}`).join(', ')}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--cc-track)" strokeWidth="18" />
        {sum > 0 && segments.map((s) => {
          const len = (s.count / sum) * C
          const el = <circle key={s.label} cx="70" cy="70" r={R} fill="none" stroke={s.color} strokeWidth="18" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />
          off += len
          return el
        })}
        <text x="70" y="68" textAnchor="middle" className="cc-donut-num">{fmtInt(total ?? sum)}</text>
        <text x="70" y="86" textAnchor="middle" className="cc-donut-cap">{centerLabel}</text>
      </svg>
      <ul className="cc-legend-table">
        {segments.map((s) => (
          <li key={s.label}>
            <button type="button" disabled={!onSelect} onClick={() => onSelect?.(s)}>
              <i style={{ background: s.color }} aria-hidden="true" />
              <span className="cc-lt-label">{s.label}</span>
              <b>{fmtInt(s.count)}</b>
              <span className="cc-lt-pct">{sum ? `${Math.round((s.count / sum) * 100)}%` : 'N/A'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Numbered pager: "Showing 1 to 10 of 126", page buttons and a page-size select. */
export function Pager({ page, pageSize, total, onPage, onPageSize, sizes = [10, 25, 50, 100], noun = 'rows' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? page * pageSize + 1 : 0
  const to = Math.min(total, (page + 1) * pageSize)
  const nums = []
  for (let i = 0; i < pages; i++) {
    if (i < 5 || i === pages - 1 || Math.abs(i - page) <= 1) nums.push(i)
    else if (nums[nums.length - 1] !== '...') nums.push('...')
  }
  return (
    <div className="cc-pager">
      <span className="cc-pager-info">Showing {fmtInt(from)} to {fmtInt(to)} of {fmtInt(total)} {noun}</span>
      <div className="cc-pager-nums">
        <button type="button" aria-label="Previous page" disabled={page <= 0} onClick={() => onPage(page - 1)}><ChevronLeft size={15} /></button>
        {nums.map((n, i) => n === '...'
          ? <span key={`e${i}`} className="cc-pager-gap">...</span>
          : <button key={n} type="button" aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n + 1}</button>)}
        <button type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}><ChevronRight size={15} /></button>
      </div>
      {onPageSize && (
        <select className="cc-select" aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {sizes.map((s) => <option key={s} value={s}>{s} per page</option>)}
        </select>
      )}
    </div>
  )
}

/** Small horizontal bar with a number, for health score and utilisation cells. */
export function MeterCell({ value, suffix = '', tone }) {
  if (value == null) return <span className="cc-na">N/A</span>
  const v = Math.max(0, Math.min(100, Number(value)))
  const t = tone || (v >= 70 ? 'var(--cc-green)' : v >= 40 ? 'var(--cc-amber)' : 'var(--cc-red)')
  return (
    <span className="cc-meter">
      <b>{Math.round(Number(value))}{suffix}</b>
      <span className="cc-meter-track"><span style={{ width: `${v}%`, background: t }} /></span>
    </span>
  )
}

/**
 * Kit table: the app's EnterpriseTable (sorting, paging, selection, column
 * visibility, states) wearing the kit skin. Pages never hand-roll a <table>.
 *
 * columns: [{ key, header, cell?: (row) => node, sortValue?: (row) => any,
 *             align?: 'right'|'center', numeric?: boolean, sortable? }]
 * `numeric` right-aligns the column (header and cells) with tabular figures.
 * `scroll` caps the body height and keeps the header pinned while it scrolls.
 * Every other EnterpriseTable prop passes straight through (onRowClick,
 * error/onRetry, loading, manualPagination...); the defaults turn off its own
 * search, filters and export because kit pages provide their own.
 */
export function KitTable({ columns, rows, empty = 'No records found', compact = false, scroll = false, className = '', ...rest }) {
  const defs = columns.map((c) => {
    const align = c.align || (c.numeric ? 'right' : undefined)
    return {
      id: c.key,
      header: align && typeof c.header === 'string'
        ? () => <span className={`cc-th-${align}`}>{c.header}</span>
        : c.header,
      accessorFn: (r) => (c.sortValue ? c.sortValue(r) : r[c.key]),
      cell: ({ row }) => (c.cell ? c.cell(row.original) : (row.original[c.key] ?? <span className="cc-na">N/A</span>)),
      enableSorting: c.sortable !== false,
      meta: { align },
    }
  })
  return (
    <EnterpriseTable
      columns={defs}
      data={rows}
      emptyMessage={empty}
      enableGlobalFilter={false}
      enableColumnFilters={false}
      enableExport={false}
      enableColumnVisibility={false}
      stickyHeader={scroll}
      showPagination={!compact}
      enableSorting={!compact}
      initialPageSize={compact ? 1000 : 25}
      skeletonRows={compact ? 3 : 8}
      className={`cc-et ${compact ? 'cc-et-compact' : ''} ${scroll ? 'cc-et-scroll' : ''} ${rest.onRowClick ? 'cc-et-clickable' : ''} ${className}`}
      {...rest}
    />
  )
}
