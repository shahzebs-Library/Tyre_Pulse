/**
 * WorkshopNotificationsPanel - Workshop Status notices inside Daily Ops ->
 * Workshop Status (Loop 12).
 *
 * Shows the caller's OWN unread Workshop Status notifications (the same rows
 * the global Notification Center and the mobile inbox read). Each notice opens
 * the exact vehicle or the filtered list through `onOpen(path)`; opening or
 * "Mark read" clears it everywhere (mark_notification_read).
 *
 * Renders nothing while there is nothing unread, so it never adds an empty box
 * to the working screen; a failed read shows a small retry line instead of
 * pretending there is nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, ChevronDown, ChevronRight, ExternalLink, Check, CheckCheck, RotateCcw, Loader2 } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import { listMyWorkshopNotifications, markWorkshopNotificationsRead } from '../../lib/api/workshopStatusNotifications'
import { workshopNotificationLink } from '../../lib/workshopStatus/notificationLinks'
import { fmtDateTime } from '../../lib/workshopStatus/activeView'
import './workshopStatusNotifications.css'

const SHOWN = 5

export default function WorkshopNotificationsPanel({ onOpen, reloadKey = 0 }) {
  const { t } = useLanguage()
  const n = useCallback((k, v) => t(`workshopStatusNotifications.${k}`, v), [t])
  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const runRef = useRef(0)

  const load = useCallback(async () => {
    const run = ++runRef.current
    setState('loading'); setError('')
    try {
      const res = await listMyWorkshopNotifications({ limit: 50, unreadOnly: true })
      if (run !== runRef.current) return
      setRows(res.rows || [])
      setState('ready')
    } catch (err) {
      if (run !== runRef.current) return
      setError(toUserMessage(err, n('loadError')))
      setState('error')
    }
  }, [n])

  useEffect(() => { load() }, [load, reloadKey])

  const markRead = async (ids) => {
    const list = Array.isArray(ids) ? ids : [ids]
    setRows((cur) => cur.filter((r) => !list.includes(r.id)))
    const failed = await markWorkshopNotificationsRead(list)
    if (failed.length) load()
  }

  const markAll = async () => {
    if (busy || !rows.length) return
    setBusy(true)
    try { await markRead(rows.map((r) => r.id)) } finally { setBusy(false) }
  }

  const openNotice = (row) => {
    markRead(row.id)
    const to = workshopNotificationLink(row)
    if (to && typeof onOpen === 'function') onOpen(to)
  }

  if (state === 'error') {
    return (
      <div className="cc-card wks-banner warn wks-nt-error" role="status">
        <Bell size={16} aria-hidden="true" />
        <p>{error}</p>
        <button type="button" className="cc-btn-ghost wks-tap" onClick={load}>
          <RotateCcw size={14} aria-hidden="true" /> {n('retry')}
        </button>
      </div>
    )
  }
  if (state === 'loading' && !rows.length) return null
  if (!rows.length) return null

  const shown = showAll ? rows : rows.slice(0, SHOWN)

  return (
    <section className="cc-card wks-nt" aria-labelledby="wks-nt-title">
      <div className="wks-nt-head">
        <button type="button" className="wks-nt-toggle wks-tap" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
          <Bell size={16} aria-hidden="true" />
          <span id="wks-nt-title" className="wks-nt-title">{n('title')}</span>
          <span className="cc-pill warn">{n('unread', { n: rows.length })}</span>
        </button>
        <div className="wks-nt-tools">
          <button type="button" className="cc-btn-ghost wks-tap" onClick={markAll} disabled={busy}>
            {busy ? <Loader2 size={14} className="wks-spin" aria-hidden="true" /> : <CheckCheck size={14} aria-hidden="true" />} {n('markAll')}
          </button>
          <button type="button" className="cc-btn-ghost wks-tap" onClick={load} aria-label={n('refresh')}>
            <RotateCcw size={14} aria-hidden="true" className={state === 'loading' ? 'wks-spin' : ''} />
          </button>
        </div>
      </div>

      {open && (
        <>
          <ul className="wks-nt-list">
            {shown.map((row) => (
              <li key={row.id} className="wks-nt-item">
                <div className="wks-nt-text">
                  <p className="wks-nt-item-title">{row.title}</p>
                  {row.body && <p className="wks-nt-item-body">{row.body}</p>}
                  {row.created_at && <p className="wks-nt-item-at">{fmtDateTime(row.created_at)}</p>}
                </div>
                <div className="wks-nt-actions">
                  <button type="button" className="cc-btn-ghost wks-tap" onClick={() => openNotice(row)}
                    aria-label={n('openFor', { title: row.title })}>
                    <ExternalLink size={14} aria-hidden="true" /> {n('open')}
                  </button>
                  <button type="button" className="cc-btn-ghost wks-tap" onClick={() => markRead(row.id)}
                    aria-label={n('markReadFor', { title: row.title })}>
                    <Check size={14} aria-hidden="true" /> {n('markRead')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {rows.length > SHOWN && (
            <button type="button" className="cc-btn-ghost wks-tap wks-nt-more" onClick={() => setShowAll((s) => !s)}>
              {showAll ? n('showLess') : n('showAll', { n: rows.length })}
            </button>
          )}
        </>
      )}
    </section>
  )
}
