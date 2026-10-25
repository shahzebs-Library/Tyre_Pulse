/** Live notification inbox. Presentation changes reuse the existing feed/actions. */
import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Bell, BellRing, X, CheckCircle, AlertTriangle, AlertOctagon,
  ArrowRight, RefreshCw, Info, Search, ChevronDown, Settings, FileCheck,
} from 'lucide-react'
import { useRealtimeAlerts } from '../hooks/useRealtimeAlerts'
import { useFeatureGate } from '../hooks/useFeatureFlags'
import { groupByDay } from '../lib/notifications'
import { filterInboxNotifications, groupInboxUpdates } from '../lib/notificationInbox'
import { isWorkshopNotification, workshopNotificationLink } from '../lib/workshopStatus/notificationLinks'
import { isDueAlert, dueAlertLink } from '../lib/dueAlertLinks'
import './notificationCenter.css'

const SEVERITY = {
  Critical: { icon: AlertOctagon, tone: 'critical' },
  High: { icon: AlertTriangle, tone: 'high' },
  Medium: { icon: AlertTriangle, tone: 'medium' },
  Low: { icon: Info, tone: 'low' },
}
const FILTERS = [['inbox', 'Inbox'], ['approvals', 'Approvals'], ['critical', 'Critical'], ['read', 'Read']]

// Keep routing identical to the live panel; review decisions stay on guarded pages.
function notificationLink(n) {
  if (isWorkshopNotification(n)) return workshopNotificationLink(n)
  if (isDueAlert(n.type)) return dueAlertLink(n.type)
  if (n.type === 'driver_workspace') return '/driver-workspace'
  if (n.type === 'approval') return '/approvals'
  if (n.type === 'approval_decision') {
    return n.entityType === 'checklist' ? '/checklists' : '/inspections'
  }
  return null
}

function NotificationRow({ group, expanded, onToggle, onMarkRead, onDismiss, relativeTime, onNavigate, detailId }) {
  const cfg = SEVERITY[group.severity] || SEVERITY.Low
  const Icon = group.type === 'approval' ? FileCheck : cfg.icon
  const to = notificationLink(group)
  const markGroupRead = () => group.items.filter(n => !n.read).forEach(n => onMarkRead(n.id))
  const openRecord = () => {
    markGroupRead()
    onNavigate(to)
  }
  return (
    <article className={`tp-notification-row tp-notification-${cfg.tone}${expanded ? ' is-expanded' : ''}${group.read ? ' is-read' : ''}`}>
      <button type="button" role="button" tabIndex={0} className="tp-notification-summary"
        onClick={onToggle} aria-expanded={expanded} aria-controls={expanded ? detailId : undefined}>
        <span className="tp-notification-icon" aria-hidden="true"><Icon size={19} /></span>
        <span className="tp-notification-copy">
          <span className="tp-notification-title">{group.title}</span>
          {group.assetNo && <span className="tp-notification-asset">{group.assetNo}</span>}
          {!expanded && <span className="tp-notification-message">{group.message}</span>}
          {group.items.length > 1 && <span className="tp-notification-updates">{group.items.length} updates</span>}
        </span>
        <span className="tp-notification-meta">
          <span>{relativeTime(group.timestamp)}</span>
          {!group.read && <span className="tp-notification-unread" aria-label="Unread" />}
          <ChevronDown size={14} aria-hidden="true" className="tp-notification-chevron" />
        </span>
      </button>
      {expanded && <div className="tp-notification-detail" id={detailId}>
        <p className="tp-notification-body">{group.message}</p>
        <span className="tp-notification-priority">{group.severity || 'Low'} priority</span>
        {group.items.length > 1 && <ol className="tp-notification-history" aria-label="Grouped updates">
          {group.items.map(item => <li key={item.id}>
            <span>{item.message || item.title}</span><small>{relativeTime(item.timestamp)}{!item.read ? ' · Unread' : ''}</small>
          </li>)}
        </ol>}
        <div className="tp-notification-actions">
          {to && <button type="button" className="tp-notification-primary" onClick={openRecord}>
            {group.type === 'approval' ? 'Review approval' : 'Open record'}<ArrowRight size={14} aria-hidden="true" />
          </button>}
          {!group.read && <button type="button" className="tp-notification-text-action" onClick={markGroupRead}>Mark read</button>}
          <button type="button" className="tp-notification-dismiss" onClick={() => group.items.forEach(n => onDismiss(n.id))}>
            Dismiss{group.items.length > 1 ? ' updates' : ''}
          </button>
        </div>
      </div>}
    </article>
  )
}

export default function NotificationCenter() {
  const { notifications, unreadCount, loading, error, refresh, markRead, markAllRead, clearAll, dismiss, relativeTime } = useRealtimeAlerts()
  const notificationsEnabled = useFeatureGate('notifications_center')
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('inbox')
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState(undefined)
  const panelRef = useRef(null)
  const buttonRef = useRef(null)
  const searchRef = useRef(null)

  const closePanel = useCallback(() => { setOpen(false); buttonRef.current?.focus() }, [])
  const handleOutsideClick = useCallback(e => {
    if (panelRef.current && !panelRef.current.contains(e.target) && buttonRef.current && !buttonRef.current.contains(e.target)) setOpen(false)
  }, [])
  useEffect(() => {
    if (!open) return undefined
    document.addEventListener('mousedown', handleOutsideClick)
    searchRef.current?.focus()
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [open, handleOutsideClick])
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key !== 'Escape') return
      setOpen(false)
      const active = document.activeElement
      if (!active || active === document.body || panelRef.current?.contains(active)) buttonRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const visible = useMemo(() => filterInboxNotifications(notifications, filter, query), [notifications, filter, query])
  const updates = useMemo(() => groupInboxUpdates(visible), [visible])
  const dayGroups = useMemo(() => groupByDay(updates), [updates])
  const selectedId = expandedId === undefined ? dayGroups[0]?.items[0]?.id : expandedId
  const hasCritical = notifications.some(n => n.severity === 'Critical' && !n.read)

  if (!notificationsEnabled) return null
  return <div className="relative flex-shrink-0">
    <button ref={buttonRef} type="button" onClick={() => setOpen(v => !v)}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'tp-notification-panel' : undefined}
      className="tp-notification-bell" aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`} title="Notifications">
      {unreadCount > 0 ? <BellRing size={17} aria-hidden="true" className={hasCritical ? 'text-red-400' : ''} /> : <Bell size={17} aria-hidden="true" />}
      {unreadCount > 0 && <span aria-hidden="true" className="tp-notification-bell-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    <AnimatePresence>
      {open && <motion.div ref={panelRef} id="tp-notification-panel" role="dialog" aria-label="Notifications" className="tp-notification-panel"
        initial={reduceMotion ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }} transition={{ duration: reduceMotion ? 0 : 0.15 }}>
        <div className="tp-notification-heading">
          <div><div className="tp-notification-heading-line"><Bell size={21} aria-hidden="true" /><h2>Notifications</h2><span className="tp-notification-count">{unreadCount} unread</span></div>
            <p>Stay on top of fleet activity.</p></div>
          <button type="button" className="tp-notification-close" onClick={closePanel} aria-label="Close notifications"><X size={19} /></button>
        </div>
        <div className="tp-notification-filters" role="group" aria-label="Filter notifications">
          {FILTERS.map(([id, label]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => { setFilter(id); setExpandedId(undefined) }}>{label}</button>)}
        </div>
        <div className="tp-notification-tools">
          <label className="tp-notification-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search notifications</span>
            <input ref={searchRef} type="search" value={query} onChange={e => { setQuery(e.target.value); setExpandedId(undefined) }} placeholder="Search vehicle, site or message" /></label>
          <div className="tp-notification-toolbar">
            <button type="button" disabled={unreadCount === 0} onClick={markAllRead}><CheckCircle size={14} aria-hidden="true" />Mark all read</button>
            <Link to="/settings?tab=notifications" onClick={() => setOpen(false)}><Settings size={14} aria-hidden="true" />Notification settings</Link>
          </div>
        </div>
        {error && <div className="tp-notification-error" role="alert"><span>{error}</span><button type="button" onClick={refresh}><RefreshCw size={13} aria-hidden="true" />Retry</button></div>}
        <div className="tp-notification-list" aria-busy={loading}>
          {loading && notifications.length === 0 ? <div className="tp-notification-empty" role="status">Loading notifications…</div>
            : notifications.length === 0 ? <div className="tp-notification-empty"><Bell size={25} aria-hidden="true" /><strong>{error ? 'Notifications unavailable' : 'You’re all caught up'}</strong><span>{error ? 'Retry to load your notifications.' : 'New fleet activity will appear here.'}</span></div>
              : updates.length === 0 ? <div className="tp-notification-empty"><Search size={24} aria-hidden="true" /><strong>No matching notifications</strong><span>Try another search or filter.</span><button type="button" onClick={() => { setFilter('inbox'); setQuery(''); setExpandedId(undefined) }}>Reset filters</button></div>
                : dayGroups.map(day => <section key={day.key} aria-label={day.label}>
                  <h3 className="tp-notification-day">{day.label}</h3>
                  {day.items.map((group, i) => <NotificationRow key={group.id} group={group} detailId={`tp-notification-${day.key}-${i}`}
                    expanded={selectedId === group.id} onToggle={() => setExpandedId(selectedId === group.id ? null : group.id)}
                    onMarkRead={markRead} onDismiss={dismiss} relativeTime={relativeTime} onNavigate={to => { setOpen(false); navigate(to) }} />)}
                </section>)}
        </div>
        <div className="tp-notification-footer"><div><span>{visible.length} of {notifications.length} loaded</span>
          {notifications.length > 0 && <button type="button" onClick={clearAll}>Clear loaded feed</button>}</div>
          <Link to="/alerts" onClick={() => setOpen(false)}>View all alerts<ArrowRight size={14} aria-hidden="true" className="rtl:rotate-180" /></Link>
        </div>
      </motion.div>}
    </AnimatePresence>
  </div>
}
