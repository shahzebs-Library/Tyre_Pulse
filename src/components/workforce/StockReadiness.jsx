import { useEffect, useState } from 'react'
import { loadStockReadiness } from '../../lib/api/workforceStockReadiness'
import { READINESS_TEXT } from '../../lib/workforceStockReadiness'

const TONE = { in_stock: 'text-green-600', low: 'text-amber-600', out: 'text-red-500', no_record: 'text-amber-600' }

/**
 * Tells the manager whether the planned site holds the tyre size the asset runs on. Information only:
 * it never blocks an assignment. Renders nothing until an asset is entered.
 */
export default function StockReadiness ({ assetNo, site, country }) {
  const [state, setState] = useState({ phase: 'idle' })
  useEffect(() => {
    let live = true
    if (!String(assetNo ?? '').trim()) { setState({ phase: 'idle' }); return undefined }
    const t = setTimeout(async () => {
      setState({ phase: 'loading' })
      const r = await loadStockReadiness({ assetNo, site, country })
      if (live) setState(r.ok ? { phase: 'ready', ...r } : { phase: 'error' })
    }, 400)
    return () => { live = false; clearTimeout(t) }
  }, [assetNo, site, country])

  if (state.phase === 'idle') return null
  return (
    <div className="md:col-span-2 rounded-lg border border-[var(--input-border)] p-3 text-xs space-y-1" aria-live="polite">
      <p className="font-semibold text-sm">Tyre stock</p>
      {state.phase === 'loading' && <p>Checking stock...</p>}
      {state.phase === 'error' && <p className="text-amber-600">Could not check stock right now. This does not stop the assignment.</p>}
      {state.phase === 'ready' && state.result && (
        state.result.lines.length === 0
          ? <p className="text-[var(--text-muted)]">{READINESS_TEXT[state.result.state]}</p>
          : state.result.lines.map(l => (
            <p key={l.size}>
              <span className="font-medium">{l.size}</span>{': '}
              <span className={TONE[l.state] || ''}>{READINESS_TEXT[l.state]}</span>
              {l.qty != null ? ` (${l.qty} on hand${l.lastCounted ? `, counted ${String(l.lastCounted).slice(0, 10)}` : ''})` : ''}
              {l.state !== 'in_stock' && l.elsewhere.length > 0 && ` | Available at ${l.elsewhere.slice(0, 3).map(e => `${e.site} (${e.qty})`).join(', ')}`}
            </p>
          ))
      )}
      {state.truncated && <p className="text-[var(--text-muted)]">Stock list is larger than could be read in full.</p>}
      <p className="text-[var(--text-muted)]">For information only. It does not block the assignment.</p>
    </div>
  )
}
