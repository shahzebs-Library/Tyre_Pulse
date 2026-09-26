/**
 * PageHeader - the compact console page header: icon + title, a one-line
 * purpose, when the data was last read, and the page's actions (Refresh plus
 * the one primary action). Keeping this identical across pages means the
 * reader always finds "how fresh is this" and "reload it" in the same place.
 */
import { RefreshCw } from 'lucide-react'
import { Btn } from '../../components/ui'

export function fmtRelative(v, now = Date.now()) {
  if (!v) return 'N/A'
  const t = new Date(v).getTime()
  if (Number.isNaN(t)) return 'N/A'
  const diff = now - t
  const past = diff >= 0
  const mins = Math.floor(Math.abs(diff) / 60000)
  if (mins < 1) return 'just now'
  const shape = (n, unit) => (past ? `${n} ${unit} ago` : `in ${n} ${unit}`)
  if (mins < 60) return shape(mins, 'min')
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return shape(hrs, 'h')
  return shape(Math.floor(hrs / 24), 'd')
}

export function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString()
}

export default function PageHeader({ icon: Icon, title, purpose, refreshedAt, onRefresh, refreshing, actions, children }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2">
          {Icon && <Icon size={18} className="text-orange-400" aria-hidden="true" />} {title}
        </h1>
        {purpose && <p className="text-xs text-gray-500 mt-1">{purpose}</p>}
        {refreshedAt ? (
          <p className="text-[11px] text-gray-600 mt-0.5" title={fmtDateTime(refreshedAt)}>
            Last refreshed {fmtRelative(refreshedAt)}
          </p>
        ) : null}
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {onRefresh && <Btn icon={RefreshCw} onClick={onRefresh} busy={refreshing}>Refresh</Btn>}
      </div>
    </header>
  )
}
