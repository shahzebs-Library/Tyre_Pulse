/**
 * Shared building blocks for the Inventory Control Center sections.
 *
 * Every section renders one of five honest states: loading, error (with
 * Retry), not set up (the database objects are not installed yet), permission
 * (the user lacks the capability) and empty. Nothing here fabricates a figure.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Info, Lock, RefreshCw, Search } from 'lucide-react'
import { Card, KitTable, Kpi, Pager } from '../commandCenter/kit'
import ExplainThisNumber from '../trust/ExplainThisNumber'
import { toUserMessage } from '../../lib/inventory/errorText'
import { useLanguage } from '../../contexts/LanguageContext'
import { isInventoryNotSetUp } from '../../lib/api/inventory'
import { floorText } from '../../lib/inventory/floorText'

const TONE = { good: 'good', info: 'info', warning: 'warn', warn: 'warn', bad: 'bad', muted: 'muted' }

/**
 * The active tab of a hub section. A link may name it (`?tab=` via the hub's
 * `tab` prop, e.g. "Open evidence" -> Controls > Opening balances); an unknown
 * or absent value falls back to the section default. Picking a tab reports it
 * back through `onTab` so the address bar keeps it across a refresh.
 */
export function useHubTab(linked, onTab, allowed, fallback) {
  const valid = (v) => (v && allowed.includes(v) ? v : null)
  const [tab, setTabState] = useState(() => valid(linked) || fallback)
  useEffect(() => {
    const v = valid(linked)
    if (v) setTabState(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked])
  const setTab = useCallback((v) => {
    setTabState(v)
    if (onTab) onTab(v === fallback ? null : v)
  }, [onTab, fallback])
  return [tab, setTab]
}

/** Load once per dependency change; the newest request always wins. */
export function useInvQuery(loader, deps) {
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const seq = useRef(0)
  const run = useCallback(async () => {
    const id = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await loader()
      if (id === seq.current) setState({ loading: false, error: null, data })
    } catch (err) {
      if (id === seq.current) {
        setState({ loading: false, error: isInventoryNotSetUp(err) ? null : toUserMessage(err), data: isInventoryNotSetUp(err) ? { status: 'not_provisioned', rows: [], total: 0 } : null })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { run() }, [run])
  return { ...state, retry: run }
}

export function Note({ tone = 'info', icon: Icon = Info, title, children, action }) {
  return (
    <div className={`inv-note ${tone}`} role={tone === 'bad' ? 'alert' : 'note'}>
      <Icon size={16} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <strong>{title}</strong>}
        {title && children ? <br /> : null}
        {children}
      </div>
      {action}
    </div>
  )
}

export function NotSetUp({ what }) {
  const { t } = useLanguage()
  return (
    <Note tone="warn" icon={Info} title={t('inventory.state.notSetUpTitle', { what })}>
      {t('inventory.state.notSetUpBody')}
    </Note>
  )
}

export function ErrorNote({ error, onRetry, load = false }) {
  const { t } = useLanguage()
  return (
    // A read failure offers Retry; an action refusal (no retry) is not a load failure.
    <Note tone="bad" icon={AlertTriangle} title={t(onRetry || load ? 'inventory.state.errorTitle' : 'inventory.state.actionErrorTitle')}
      action={onRetry && (
        <button type="button" className="cc-btn-ghost" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" /> {t('inventory.actions.retry')}
        </button>
      )}>
      {error}
    </Note>
  )
}

export function Denied({ capLabel }) {
  const { t } = useLanguage()
  return (
    <Note tone="warn" icon={Lock} title={t('inventory.state.deniedTitle')}>
      {t('inventory.state.deniedBody', { cap: capLabel })}
    </Note>
  )
}

/** "N/A" in the reader's language (exactly "N/A" in English). */
export function useNa() {
  const { t, language } = useLanguage()
  return language === 'en' ? 'N/A' : floorText(t)('wmsmsgfloor.common.na')
}

/** An empty `value` shows `na` (default: "N/A" in the reader's language). */
export function StatusPill({ value, tone, label, na }) {
  const naText = useNa()
  if (value === null || value === undefined || value === '') return <span className="cc-na">{na ?? naText}</span>
  return <span className={`cc-pill ${TONE[tone] || 'muted'}`}>{label || String(value).replace(/_/g, ' ')}</span>
}

export function Field({ label, error, children, full, id }) {
  return (
    <label className={`cc-field ${full ? 'inv-full' : ''}`} htmlFor={id} style={{ minWidth: 0 }}>
      <span>{label}</span>
      {children}
      {error && <p className="inv-err" role="alert">{error}</p>}
    </label>
  )
}

export function SearchBox({ value, onChange, placeholder, label }) {
  return (
    <div className="cc-search">
      <Search size={15} aria-hidden="true" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label || placeholder} />
    </div>
  )
}

/**
 * Right-align numeric cells (KitTable aligns the header; this aligns the value).
 * `na` is shown for an empty value without its own cell renderer (default "N/A").
 */
export function alignNumeric(columns, na = 'N/A') {
  return columns.map((c) => (c.numeric
    ? { ...c, cell: (r) => <span className="inv-num-cell">{c.cell ? c.cell(r) : (r[c.key] ?? na)}</span> }
    : c))
}

/**
 * A server-paged table with every state. `query` is a useInvQuery result whose
 * data is `{ status, rows, total }`.
 */
export function PagedTable({ query, columns, page, pageSize, onPage, onPageSize, empty, what, onRowClick, noun }) {
  const na = useNa()
  if (query.error) return <ErrorNote error={query.error} onRetry={query.retry} />
  if (query.data?.status === 'not_provisioned') return <NotSetUp what={what} />
  const rows = query.data?.rows || []
  return (
    <>
      <div className="inv-scroll">
        <KitTable compact columns={alignNumeric(columns, na)} rows={rows} loading={query.loading && !query.data} empty={empty} onRowClick={onRowClick} />
      </div>
      {(query.data?.total ?? 0) > 0 && (
        <Pager page={page} pageSize={pageSize} total={query.data.total} onPage={onPage} onPageSize={onPageSize} sizes={[25, 50, 100, 200]} noun={noun} />
      )}
    </>
  )
}

export function SectionCard({ title, sub, action, children }) {
  return <Card title={title} sub={sub} action={action}>{children}</Card>
}

/** dd Mon yyyy; `na` is returned for an empty value (default "N/A"). */
export function fmtDate(v, na = 'N/A') {
  if (!v) return na
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** dd Mon yyyy, hh:mm; `na` is returned for an empty value (default "N/A"). */
export function fmtDateTime(v, na = 'N/A') {
  if (!v) return na
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * A KPI tile with its governed definition one click away. `metricId` is a key
 * of src/lib/inventory/kpi.js KPI_CATALOGUE (seeded into metric_registry by
 * the DB lane), so the explanation and the tile can never name different
 * formulas. The Explain button sits beside the tile, never inside it (the tile
 * may itself be a button).
 */
export function ExplainedKpi({ metricId, country, explainValue, ...kpi }) {
  return (
    <div className="inv-kpi-wrap">
      <Kpi {...kpi} />
      {metricId && (
        <span className="inv-kpi-explain">
          <ExplainThisNumber metricId={metricId} country={country || null} value={explainValue ?? kpi.display ?? kpi.value ?? null} label={kpi.label} />
        </span>
      )}
    </div>
  )
}
