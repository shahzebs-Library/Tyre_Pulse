import { useCallback, useEffect, useState } from 'react'
import { Users, AlertTriangle, RefreshCw } from 'lucide-react'
import { listAccidentTaskHoldings } from '../../lib/api/accidentOwnership'
import useAccidentOwnershipText from './useAccidentOwnershipText'
import { toUserMessage } from '../../lib/safeError'

/**
 * Who holds what (B2): every open accident step grouped by the person (or the
 * role queue) holding it, with how many, the oldest and how many are overdue.
 * Read from accident_task_holdings(), scoped by RLS-equivalent country/site checks.
 */
export default function AccidentHoldingsBoard() {
  const L = useAccidentOwnershipText()
  const { tx } = L
  const [state, setState] = useState({ loading: true })
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await listAccidentTaskHoldings()
      setState({ loading: false, ok: res.ok, rows: res.rows })
    } catch (e) { setState({ loading: false, error: toUserMessage(e, tx('holdings.loadFailed')) }) }
  }, [tx])
  useEffect(() => { load() }, [load])

  const rows = state.rows || []
  const max = Math.max(1, ...rows.map((r) => r.open_count || 0))

  return (
    <section className="card" aria-label={tx('holdings.title')}>
      <div className="flex items-center gap-2 mb-3">
        <Users size={16} className="text-[var(--accent)]" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{tx('holdings.title')}</h3>
        <span className="text-xs text-[var(--text-muted)]">{tx('holdings.sub')}</span>
        <button type="button" onClick={load} aria-label={tx('holdings.refresh')}
          className="ms-auto inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]">
          <RefreshCw size={14} className={state.loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {state.loading && !state.rows && <p className="text-sm text-[var(--text-muted)]">{tx('common.loading')}</p>}
      {state.error && (
        <p className="text-sm text-[var(--text-primary)] flex items-center gap-2" role="alert">
          <AlertTriangle size={14} className="text-red-400" aria-hidden="true" /> {state.error}
          <button type="button" onClick={load} className="text-[var(--accent)] hover:underline">{tx('common.tryAgain')}</button>
        </p>
      )}
      {state.ok === false && <p className="text-sm text-[var(--text-muted)]">{tx('common.notOn')}</p>}
      {state.ok && rows.length === 0 && <p className="text-sm text-[var(--text-muted)]">{tx('holdings.empty')}</p>}
      {state.ok && rows.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-[var(--text-dim)] text-start">
            <tr><th className="py-1.5 font-medium">{tx('holdings.colHolder')}</th><th className="py-1.5 font-medium px-3">{tx('holdings.colOpen')}</th><th className="py-1.5 font-medium text-end">{tx('holdings.colOverdue')}</th><th className="py-1.5 font-medium text-end">{tx('holdings.colOldest')}</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.holder_id || 'role'}-${r.holder_role || ''}`} className="border-t border-[var(--input-border)]">
                <td className="py-2 pe-3">
                  <p className={`font-medium ${r.no_owner ? 'text-amber-400' : 'text-[var(--text-primary)]'}`}>{L.holder(r)}</p>
                  {r.holder_name && r.holder_role && <p className="text-[11px] text-[var(--text-dim)]">{L.role(r.holder_role)}</p>}
                </td>
                <td className="py-2 px-3 w-1/3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(6, (r.open_count / max) * 100)}%` }} aria-hidden="true" />
                    <span className="text-[var(--text-primary)]">{r.open_count}</span>
                  </div>
                </td>
                <td className={`py-2 px-2 text-end ${r.overdue_count ? 'text-red-400 font-medium' : 'text-[var(--text-muted)]'}`}>{r.overdue_count}</td>
                <td dir="auto" className="py-2 text-end text-[var(--text-secondary)]">{L.days(r.oldest_days)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
