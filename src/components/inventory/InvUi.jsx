/**
 * Shared building blocks for the Inventory Control Center sections.
 *
 * Every section renders one of five honest states: loading, error (with
 * Retry), not set up (the database objects are not installed yet), permission
 * (the user lacks the capability) and empty. Nothing here fabricates a figure.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Info, Lock, RefreshCw, Search } from 'lucide-react'
import { Card, KitTable, Pager } from '../commandCenter/kit'
import { toUserMessage } from '../../lib/safeError'
import { useLanguage } from '../../contexts/LanguageContext'
import { isInventoryNotSetUp } from '../../lib/api/inventory'

const TONE = { good: 'good', info: 'info', warning: 'warn', warn: 'warn', bad: 'bad', muted: 'muted' }

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

export function ErrorNote({ error, onRetry }) {
  const { t } = useLanguage()
  return (
    <Note tone="bad" icon={AlertTriangle} title={t('inventory.state.errorTitle')}
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

export function StatusPill({ value, tone, label }) {
  if (value === null || value === undefined || value === '') return <span className="cc-na">N/A</span>
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
 * A server-paged table with every state. `query` is a useInvQuery result whose
 * data is `{ status, rows, total }`.
 */
export function PagedTable({ query, columns, page, pageSize, onPage, onPageSize, empty, what, onRowClick, noun }) {
  if (query.error) return <ErrorNote error={query.error} onRetry={query.retry} />
  if (query.data?.status === 'not_provisioned') return <NotSetUp what={what} />
  const rows = query.data?.rows || []
  return (
    <>
      <KitTable compact columns={columns} rows={rows} loading={query.loading && !query.data} empty={empty} onRowClick={onRowClick} />
      {(query.data?.total ?? 0) > 0 && (
        <Pager page={page} pageSize={pageSize} total={query.data.total} onPage={onPage} onPageSize={onPageSize} sizes={[25, 50, 100, 200]} noun={noun} />
      )}
    </>
  )
}

export function SectionCard({ title, sub, action, children }) {
  return <Card title={title} sub={sub} action={action}>{children}</Card>
}

export function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
