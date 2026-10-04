/**
 * SectionKit - the header and impact line shared by the People screens
 * (Users editor, Sessions and devices, Support sessions, Account deletions,
 * Organisations, Incidents).
 *
 * Most of these pages are also shown as a tab of a bigger screen (Users,
 * Organizations, Alert Center), which already carries the page title. When a
 * page is embedded (its tab parameter is not the plain "tab") it renders a
 * compact section header (h2) instead of a second h1, so the screen does not
 * show two titles and two Refresh buttons stacked on top of each other.
 */
import { RefreshCw } from 'lucide-react'
import { Btn } from '../../components/ui'
import { PageHeader, ageText, fmtDateTime, useNow } from '../shared/pageKit'

/** True when the page is rendered as a tab of another screen. */
export const isEmbedded = (tabParam) => Boolean(tabParam) && tabParam !== 'tab'

export function SectionTop({ embedded, icon: Icon, title, purpose, actions, primary, refreshedAt, onRefresh, refreshing, children }) {
  const now = useNow()
  if (!embedded) {
    return (
      <PageHeader icon={Icon} title={title} purpose={purpose} actions={actions} primary={primary}
        refreshedAt={refreshedAt} onRefresh={onRefresh} refreshing={refreshing}>{children}</PageHeader>
    )
  }
  const age = ageText(refreshedAt, now)
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-100">
          {Icon && <Icon size={15} className="text-orange-400 shrink-0" aria-hidden="true" />} {title}
        </h2>
        {purpose && <p className="text-xs text-gray-400 mt-0.5 max-w-3xl">{purpose}</p>}
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {primary}
        {onRefresh && (
          <>
            <span className="text-[11px] text-gray-500 tabular-nums" aria-live="polite" title={refreshedAt ? fmtDateTime(refreshedAt) : undefined}>
              {refreshing ? 'Refreshing...' : age ? `Updated ${age}` : 'Not loaded yet'}
            </span>
            <Btn icon={RefreshCw} onClick={onRefresh} busy={refreshing}>Refresh</Btn>
          </>
        )}
      </div>
    </header>
  )
}

/** One quiet line under a control: what it changes and who it affects. */
export function ImpactLine({ change, who, className = '' }) {
  if (!change && !who) return null
  return (
    <p className={`text-[11px] text-gray-500 leading-relaxed ${className}`}>
      {change && <><span className="font-semibold text-gray-400">What this changes: </span>{change} </>}
      {who && <><span className="font-semibold text-gray-400">Who is affected: </span>{who}</>}
    </p>
  )
}
