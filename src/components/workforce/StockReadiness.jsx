import { useEffect, useState } from 'react'
import { loadStockReadiness } from '../../lib/api/workforceStockReadiness'
import { useLanguage } from '../../contexts/LanguageContext'

const TONE = { in_stock: 'text-green-600', low: 'text-amber-600', out: 'text-red-500', no_record: 'text-amber-600' }

/**
 * Tells the manager whether the planned site holds the tyre size the asset runs on. Information only:
 * it never blocks an assignment. Renders nothing until an asset is entered.
 */
export default function StockReadiness ({ assetNo, site, country }) {
  const { t } = useLanguage()
  const [state, setState] = useState({ phase: 'idle' })
  useEffect(() => {
    let live = true
    if (!String(assetNo ?? '').trim()) { setState({ phase: 'idle' }); return undefined }
    const timer = setTimeout(async () => {
      setState({ phase: 'loading' })
      const r = await loadStockReadiness({ assetNo, site, country })
      if (live) setState(r.ok ? { phase: 'ready', ...r } : { phase: 'error' })
    }, 400)
    return () => { live = false; clearTimeout(timer) }
  }, [assetNo, site, country])

  if (state.phase === 'idle') return null
  return (
    <div className="md:col-span-2 rounded-lg border border-[var(--input-border)] p-3 text-xs space-y-1" aria-live="polite">
      <p className="font-semibold text-sm">{t('workforce.stock.title')}</p>
      {state.phase === 'loading' && <p>{t('workforce.stock.checking')}</p>}
      {state.phase === 'error' && <p className="text-amber-600">{t('workforce.stock.error')}</p>}
      {state.phase === 'ready' && state.result && (
        state.result.lines.length === 0
          ? <p className="text-[var(--text-muted)]">{t(`workforce.stock.${state.result.state}`)}</p>
          : state.result.lines.map(l => (
            <p key={l.size}>
              <span className="font-medium">{l.size}</span>{': '}
              <span className={TONE[l.state] || ''}>{t(`workforce.stock.${l.state}`)}</span>
              {l.qty != null ? ` (${t('workforce.stock.onHand', { qty: l.qty })}${l.lastCounted ? `, ${t('workforce.stock.counted', { date: String(l.lastCounted).slice(0, 10) })}` : ''})` : ''}
              {l.state !== 'in_stock' && l.elsewhere.length > 0 && ` | ${t('workforce.stock.availableAt', { list: l.elsewhere.slice(0, 3).map(e => `${e.site} (${e.qty})`).join(', ') })}`}
            </p>
          ))
      )}
      {state.truncated && <p className="text-[var(--text-muted)]">{t('workforce.stock.truncated')}</p>}
      <p className="text-[var(--text-muted)]">{t('workforce.stock.infoOnly')}</p>
    </div>
  )
}
