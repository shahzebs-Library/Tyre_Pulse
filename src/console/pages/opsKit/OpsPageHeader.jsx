/**
 * OpsPageHeader - the compact header every ops console page opens with:
 * title, one-line purpose, the primary action, when the data was last read and
 * a Refresh button. Kept on one line on a wide screen so the page starts with
 * the numbers, not with chrome.
 */
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Btn } from '../../components/ui'

export function fmtAgo(v, now = Date.now()) {
  if (!v) return null
  const t = new Date(v).getTime()
  if (!Number.isFinite(t)) return null
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

export default function OpsPageHeader({ icon: Icon, title, purpose, actions, refreshedAt, onRefresh, busy }) {
  // Re-render every 30s so "2 min ago" keeps moving without a data reload.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!refreshedAt) return undefined
    const id = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(id)
  }, [refreshedAt])
  const ago = fmtAgo(refreshedAt)
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2">
          {Icon && <Icon size={18} className="text-orange-400" aria-hidden="true" />} {title}
        </h1>
        {purpose && <p className="text-xs text-gray-500 mt-1">{purpose}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {onRefresh && (
          <>
            <span className="text-[11px] text-gray-500 tabular-nums" aria-live="polite">
              {busy ? 'Refreshing...' : ago ? `Updated ${ago}` : 'Not loaded yet'}
            </span>
            <Btn icon={RefreshCw} onClick={onRefresh} busy={busy}>Refresh</Btn>
          </>
        )}
      </div>
    </header>
  )
}
