/**
 * ConsoleNotifications - /console/notifications. Every message the platform
 * sends: phone push, email and the in-app bell.
 *
 * Replaces, and keeps whole as tabs: Delivery & Alerts and Announcements. The
 * overview reads get_notification_health() (delivery results by event, time to
 * deliver, bell read rate from notifications.read, phones by app version) and
 * adds an announcement composer with a live audience count and a country
 * filter (announcements.target_countries).
 *
 * Honest limits, stated on screen: the system records the event, not the
 * channel, per message; email opens, clicks and bounces are not synced from
 * the provider; there is no WhatsApp connection and no iOS app.
 */
import { lazy, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bell, BellRing, Mail, Smartphone, Megaphone, Send, PauseCircle, PlayCircle, Clock, FileText, Info, CheckCircle2, MessageCircle,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal, ConfirmImpactDialog,
} from '../components/ui'
import { PageHeader, TabBar, useUrlTab, useUrlParam, useRefreshStamp } from './shared/pageKit'
import ExportButtons from './shared/ExportButtons'
import Embedded, { MovedFrom } from './monitor/Embedded'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { getNotificationHealth, getAnnouncementAudience } from '../../lib/api/monitorCenter'
import { previewAudience, sendBroadcast } from '../../lib/api/broadcast'
import { loadSystemConfig, saveSystemConfigValues } from '../../lib/api/systemConfig'
import {
  fmtNum, pctOf, fmtPct, riyadhDateTime, eventLabel, fmtDuration, BELL_TYPE_LABELS, EVENT_LABELS,
} from '../../lib/monitorCenter'
import { toUserMessage } from '../../lib/safeError'

const ConsoleDelivery = lazy(() => import('./ConsoleDelivery'))
const ConsoleAnnouncements = lazy(() => import('./ConsoleAnnouncements'))

const TABS = [
  { key: 'overview', label: 'Overview', icon: Bell },
  { key: 'delivery', label: 'Delivery & alerts', icon: BellRing },
  { key: 'announcements', label: 'Announcements', icon: Megaphone },
]
const TAB_KEYS = TABS.map((t) => t.key)
const ROLES = ['Driver', 'Tyre Man', 'Inspector', 'Tyre Data Collector', 'Fleet Supervisor', 'Maintenance Supervisor',
  'Workshop Supervisor', 'Reporter', 'Manager', 'Director', 'Admin']
const COUNTRIES = ['KSA', 'UAE', 'Egypt']
const INPUT = 'w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'
const on = (v, d = true) => (v === undefined || v === null || v === '' ? d : v === true || String(v).toLowerCase() === 'true')

const LOG_COLUMNS = [
  { key: 'label', header: 'What triggered it' },
  { key: 'event_type', header: 'Event' },
  { key: 'messages', header: 'Messages' },
  { key: 'people', header: 'People' },
  { key: 'status', header: 'Result' },
  { key: 'retries', header: 'Retries' },
  { key: 'errors', header: 'Provider errors' },
  { key: 'last_at', header: 'Last sent', value: (r) => riyadhDateTime(r.last_at) || 'N/A' },
]

export default function ConsoleNotifications() {
  const [tab, setTab] = useUrlTab(TAB_KEYS, 'overview')
  const [compose, setCompose] = useUrlParam('compose')
  const { logAction } = useConsoleAuth()
  const { refreshedAt, stamp } = useRefreshStamp()
  const [data, setData] = useState(null)
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [pausing, setPausing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [h, c] = await Promise.allSettled([getNotificationHealth(), loadSystemConfig({ force: true })])
      if (h.status === 'rejected') throw h.reason
      setData(h.value)
      setConfig(c.status === 'fulfilled' ? (c.value || {}) : null)
      stamp()
    } catch (e) { setError(toUserMessage(e, 'Notification health could not be loaded.')); setData(null) }
    finally { setLoading(false) }
  }, [stamp])
  useEffect(() => { if (tab === 'overview') load() }, [tab, load])
  useEffect(() => { if (compose) setComposerOpen(true) }, [compose])

  const wf = data?.workflow || {}
  const bell = data?.bell || {}
  const dev = data?.devices || {}
  const pushOn = config ? on(config.push_notifications) : null
  const emailOn = config ? on(config.email_notifications) : null
  const accidentEmailOn = config ? on(config.accident_emails_enabled, false) : null
  const logRows = useMemo(() => (data?.by_event || [])
    .map((r) => ({ ...r, label: eventLabel(r.event_type) }))
    .filter((r) => (!statusFilter || r.status === statusFilter)
      && (!q || `${r.label} ${r.event_type}`.toLowerCase().includes(q.toLowerCase()))), [data, q, statusFilter])
  const statuses = useMemo(() => [...new Set((data?.by_event || []).map((r) => r.status))], [data])
  const oldVersions = (data?.by_version || []).filter((v) => v.version !== (data?.by_version?.[0]?.version)).reduce((a, v) => a + (Number(v.devices) || 0), 0)
  const unreadSecurity = (data?.bell_by_type || []).find((b) => b.type === 'security' && Number(b.sent) > 0 && !Number(b.read))

  async function togglePush({ reason }) {
    setBusy(true); setActionError('')
    try {
      const next = !pushOn
      await saveSystemConfigValues({ push_notifications: next })
      await logAction(next ? 'push_resume' : 'push_pause', null, 'system_config', { key: 'push_notifications', value: next, reason })
      setNotice(next ? 'Phone push is on again. Messages queued from now on are delivered.' : 'Phone push is paused. The in-app bell and email keep working.')
      setPausing(false); await load()
    } catch (e) { setActionError(toUserMessage(e, 'Push could not be changed. Nothing was changed.')) }
    finally { setBusy(false) }
  }

  const channelStrip = [
    { label: 'Push', icon: Smartphone, value: pushOn == null ? 'N/A' : pushOn ? 'On' : 'Paused', tone: pushOn === false ? 'warning' : 'good', sub: `${fmtNum(dev.active)} devices` },
    { label: 'Email', icon: Mail, value: emailOn == null ? 'N/A' : emailOn ? 'On' : 'Off', tone: emailOn === false ? 'warning' : 'good', sub: 'Resend' },
    { label: 'Accident emails', icon: Mail, value: accidentEmailOn == null ? 'N/A' : accidentEmailOn ? 'On' : 'Off', tone: 'default', sub: 'fixed mailbox' },
    { label: 'WhatsApp', icon: MessageCircle, value: 'Not connected', tone: 'muted', sub: 'no provider set up' },
    { label: 'Last delivery', icon: Clock, value: riyadhDateTime(wf.last_delivered_at) || 'N/A', tone: 'default', sub: 'workflow messages' },
  ]

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={Bell} title="Notifications"
        purpose="Every message the platform sends: phone push, email and the in-app bell. See what was delivered and send a message to your people."
        refreshedAt={tab === 'overview' ? refreshedAt : null} onRefresh={tab === 'overview' ? load : undefined} busy={loading}
        actions={tab === 'overview' && (<>
          <Btn variant={pushOn ? 'danger' : 'good'} icon={pushOn ? PauseCircle : PlayCircle} disabled={pushOn == null} onClick={() => setPausing(true)}>
            {pushOn === false ? 'Resume push' : 'Pause all push'}
          </Btn>
          <Btn variant="primary" icon={Send} onClick={() => setComposerOpen(true)}>Send a message</Btn>
        </>)} />
      <MovedFrom onPick={setTab} items={[{ key: 'delivery', label: 'Delivery & Alerts' }, { key: 'announcements', label: 'Announcements' }]} />
      <TabBar tabs={TABS} value={tab} onChange={setTab} ariaLabel="Notifications sections" />

      {tab === 'delivery' && <Embedded page={ConsoleDelivery} label="delivery and alerts" />}
      {tab === 'announcements' && <Embedded page={ConsoleAnnouncements} label="announcements" />}

      {tab === 'overview' && (
        <div className="space-y-4">
          {notice && <Note icon={CheckCircle2} tone="accent">{notice}</Note>}
          {error && <ErrorState message={error} onRetry={load} />}
          {loading && !data && <Panel><LoadingState label="Reading delivery results" rows={5} /></Panel>}

          {data && (<>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {channelStrip.map((c) => <StatTile key={c.label} label={c.label} icon={c.icon} value={c.value} tone={c.tone} sub={c.sub} />)}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatTile label="Delivered, 30 days" value={fmtNum(wf.delivered)} tone="good"
                sub={`of ${fmtNum(wf.total)}, ${fmtPct(pctOf(wf.delivered, wf.total, 1))} success`} />
              <StatTile label="Skipped" value={fmtNum(wf.skipped)} tone={wf.skipped ? 'warning' : 'default'} sub={`${fmtNum(wf.failed)} failed, ${fmtNum(wf.pending)} waiting`} />
              <StatTile label="People reached" value={fmtNum(wf.people)} sub="30 days" />
              <StatTile label="Report emails" value={fmtNum(data.reports?.sent_30d)} tone={data.reports?.failed_30d ? 'danger' : 'default'} sub={`${fmtNum(data.reports?.failed_30d)} failed, 30 days`} />
              <StatTile label="Active phones" value={fmtNum(dev.active)} sub={`${fmtNum(dev.seen_7d)} seen in 7 days`} />
              <StatTile label="Announcements showing" value={fmtNum(data.announcements?.showing)} sub={`${fmtNum(data.announcements?.total)} on record`}
                onClick={() => setTab('announcements')} />
            </div>
            <p className="text-[11px] text-gray-500">Alert rules and trust alerts live in the Alert Center, which decides what is worth telling you; this page decides how it is delivered.</p>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Panel>
                <PanelHeader icon={Smartphone} title="Push to phones" subtitle={pushOn === false ? 'Paused' : 'On'} />
                <ul className="space-y-1.5 text-xs text-gray-300">
                  <li className="flex justify-between"><span>Active Android devices</span><span className="tabular-nums">{fmtNum(dev.android)}</span></li>
                  <li className="flex justify-between"><span>Seen in last 7 days</span><span className="tabular-nums">{fmtNum(dev.seen_7d)}</span></li>
                  <li className="flex justify-between"><span>Accounts with a push token</span><span className="tabular-nums">{fmtNum(data.push_tokens)}</span></li>
                  {(data.by_version || []).slice(0, 4).map((v) => (
                    <li key={v.version} className="flex justify-between"><span>On app {v.version}</span><span className="tabular-nums">{fmtNum(v.devices)}</span></li>
                  ))}
                  <li className="flex justify-between"><span>iPhone</span><span className="text-gray-500">No iOS app</span></li>
                </ul>
                {oldVersions > 0 && <p className="text-[11px] text-gray-500 mt-2">{fmtNum(oldVersions)} phones are on an older app version.</p>}
              </Panel>
              <Panel>
                <PanelHeader icon={Mail} title="Email" subtitle={emailOn === false ? 'Off' : 'On'} />
                <ul className="space-y-1.5 text-xs text-gray-300">
                  <li className="flex justify-between"><span>Scheduled reports, 30 days</span><span className="tabular-nums">{fmtNum(data.reports?.sent_30d)}</span></li>
                  <li className="flex justify-between"><span>Failed</span><span className="tabular-nums">{fmtNum(data.reports?.failed_30d)}</span></li>
                  <li className="flex justify-between"><span>Last report sent</span><span>{riyadhDateTime(data.reports?.last_at) || 'N/A'}</span></li>
                  <li className="flex justify-between"><span>Opens and clicks</span><span className="text-gray-500">Not recorded</span></li>
                  <li className="flex justify-between"><span>Bounces and spam reports</span><span className="text-gray-500">Not synced from Resend</span></li>
                </ul>
              </Panel>
              <Panel>
                <PanelHeader icon={Bell} title="In-app bell" subtitle="Read or not, from notifications.read" />
                <ul className="space-y-1.5 text-xs text-gray-300">
                  <li className="flex justify-between"><span>Read, 30 days</span><span className="tabular-nums">{fmtNum(bell.read_30d)} of {fmtNum(bell.sent_30d)} ({fmtPct(pctOf(bell.read_30d, bell.sent_30d))})</span></li>
                  <li className="flex justify-between"><span>Read, all time</span><span className="tabular-nums">{fmtNum(bell.read_all)} of {fmtNum(bell.sent_all)} ({fmtPct(pctOf(bell.read_all, bell.sent_all))})</span></li>
                  <li className="flex justify-between"><span>Your unread</span><span className="tabular-nums">{fmtNum(data.my_unread)}</span></li>
                </ul>
              </Panel>
            </div>

            <Panel>
              <PanelHeader icon={Send} title="Delivery log" subtitle="Last 30 days, grouped by what triggered the message."
                actions={<ExportButtons rows={logRows} columns={LOG_COLUMNS} title="Notification delivery log" />} />
              <Toolbar className="mb-3">
                <SearchInput value={q} onChange={setQ} placeholder="Search event" className="w-full sm:w-64" />
                <Select ariaLabel="Result" value={statusFilter} onChange={setStatusFilter} placeholder="Any result"
                  options={statuses.map((s) => ({ value: s, label: s }))} />
              </Toolbar>
              {logRows.length === 0 ? <EmptyState title="Nothing sent" reason={(data.by_event || []).length ? 'No row matches the filters.' : 'No workflow message was queued in the last 30 days.'} /> : (
                <Table>
                  <THead><Th>What triggered it</Th><Th>Event</Th><Th align="right">Messages</Th><Th align="right">People</Th><Th>Result</Th><Th align="right">Retries</Th><Th>Last sent</Th></THead>
                  <tbody>
                    {logRows.map((r) => (
                      <Tr key={`${r.event_type}|${r.status}`}>
                        <Td>{r.label}</Td>
                        <Td><span className="font-mono text-[11px] text-gray-500">{r.event_type}</span></Td>
                        <Td align="right" className="tabular-nums">{fmtNum(r.messages)}</Td>
                        <Td align="right" className="tabular-nums">{fmtNum(r.people)}</Td>
                        <Td><Badge tone={r.status === 'delivered' ? 'good' : r.status === 'skipped' ? 'warning' : r.status === 'pending' ? 'info' : 'danger'}>{r.status}</Badge></Td>
                        <Td align="right" className="tabular-nums">{fmtNum(r.retries)}</Td>
                        <Td nowrap>{riyadhDateTime(r.last_at) || 'N/A'}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
              <p className="text-[11px] text-gray-500 mt-2">The system records the event, not the channel, for each message, so push and in-app are shown together. Skipped means nobody with a phone was there to receive it.</p>
            </Panel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel>
                <PanelHeader icon={Bell} title="In-app bell by type, 30 days" />
                {(data.bell_by_type || []).length === 0 ? <EmptyState title="No bell messages" reason="Nothing was posted to the bell in 30 days." /> : (
                  <Table>
                    <THead><Th>Type</Th><Th align="right">Sent</Th><Th align="right">Read</Th><Th align="right">Read rate</Th></THead>
                    <tbody>
                      {data.bell_by_type.map((b) => (
                        <Tr key={b.type}>
                          <Td>{BELL_TYPE_LABELS[b.type] || b.type}</Td>
                          <Td align="right" className="tabular-nums">{fmtNum(b.sent)}</Td>
                          <Td align="right" className="tabular-nums">{fmtNum(b.read)}</Td>
                          <Td align="right">{fmtPct(pctOf(b.read, b.sent))}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
                {unreadSecurity && <p className="text-[11px] text-amber-300 mt-2">{fmtNum(unreadSecurity.sent)} security notices in 30 days were never opened. Consider sending those by email as well.</p>}
              </Panel>
              <Panel>
                <PanelHeader icon={Clock} title="Time to deliver" subtitle="From queued to delivered, workflow messages, 30 days" />
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label="Typical (median)" value={fmtDuration(wf.p50_seconds)} />
                  <StatTile label="Slowest 5%" value={fmtDuration(wf.p95_seconds)} />
                  <StatTile label="Retried" value={fmtNum(wf.retries)} tone={wf.retries ? 'warning' : 'default'} />
                  <StatTile label="Provider errors" value={fmtNum(wf.provider_errors)} tone={wf.provider_errors ? 'danger' : 'default'} />
                </div>
                <p className="text-[11px] text-gray-500 mt-2">Messages are picked up by the delivery job every minute, so about two minutes is normal.</p>
              </Panel>
            </div>

            <Panel>
              <PanelHeader icon={FileText} title="Message templates" subtitle="What each event says. Wording lives in the delivery function, so it is shown here read-only." />
              <ul className="grid sm:grid-cols-2 gap-2 text-xs">
                {Object.entries(EVENT_LABELS).map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between gap-2 border border-gray-800 rounded-lg px-3 py-2">
                    <span className="text-gray-300">{v}</span><span className="font-mono text-[11px] text-gray-500">{k}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-gray-500 mt-2">Editing templates here needs them moved out of code into a table; that is not built yet.</p>
            </Panel>
          </>)}
        </div>
      )}

      <Composer open={composerOpen} preset={compose} logAction={logAction}
        onClose={() => { setComposerOpen(false); setCompose(null) }}
        onPublished={(msg) => { setNotice(msg); setComposerOpen(false); setCompose(null); if (tab === 'overview') load() }} />

      <ConfirmImpactDialog open={pausing} danger={pushOn !== false} requireReason typedWord={pushOn ? 'PAUSE' : undefined}
        title={pushOn ? 'Pause all phone push' : 'Resume phone push'} confirmLabel={pushOn ? 'Pause push' : 'Resume push'}
        busy={busy} error={actionError} onCancel={() => { setPausing(false); setActionError('') }} onConfirm={togglePush}
        impact={pushOn ? {
          tone: 'danger', what: 'Stops every push message to every phone.',
          change: 'Approval requests, workflow steps and upload reminders stop arriving on phones. The in-app bell and email keep working.',
          who: `${fmtNum(dev.active)} active phones, ${fmtNum(data?.push_tokens)} people.`,
          undo: 'Yes, resume here. Messages sent while paused are not re-sent.',
        } : {
          tone: 'info', what: 'Turns phone push back on.', change: 'New messages are delivered to phones again.',
          who: `${fmtNum(dev.active)} active phones.`, undo: 'Yes, pause again.',
        }} />
    </div>
  )
}

function Composer({ open, preset, onClose, onPublished, logAction }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [roles, setRoles] = useState([])
  const [countries, setCountries] = useState([])
  const [sendPush, setSendPush] = useState(true)
  const [preview, setPreview] = useState(null)
  const [reach, setReach] = useState(null)
  const [audErr, setAudErr] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    setErr(''); setConfirm(false)
    if (preset === 'drivers') {
      setTitle('Please sign in to Tyre Pulse')
      setBody('Your account is ready. Open the Tyre Pulse app and sign in with the username you were given, so your inspections and meter readings are recorded.')
      setRoles(['Driver'])
    }
  }, [open, preset])

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    setAudErr('')
    const t = setTimeout(() => {
      Promise.allSettled([previewAudience({ roles, countries }), getAnnouncementAudience(roles, countries)]).then(([p, r]) => {
        if (!alive) return
        if (p.status === 'fulfilled' && p.value.ok) setPreview(p.value)
        else { setPreview(null); setAudErr('The audience could not be counted.') }
        setReach(r.status === 'fulfilled' ? r.value : null)
      })
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [open, roles, countries])

  const flip = (list, set, v) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const ready = title.trim().length >= 3 && body.trim().length >= 3 && Boolean(preview?.total)

  async function send() {
    setBusy(true); setErr('')
    try {
      const res = await sendBroadcast({ title: title.trim(), body: body.trim(), roles, countries, sendPush })
      if (!res.ok) throw new Error(res.reason || 'not sent')
      await logAction('console_broadcast', res.id ?? null, 'broadcast', { roles, countries, recipients: res.recipients, pushes: res.pushes_queued })
      onPublished(`Message sent to ${fmtNum(res.recipients)} inboxes${sendPush ? `, ${fmtNum(res.pushes_queued)} phones queued` : ''}.`)
      setTitle(''); setBody(''); setRoles([]); setCountries([])
    } catch (e) { setErr(toUserMessage(e, 'The message could not be sent. Nothing was sent.')) }
    finally { setBusy(false); setConfirm(false) }
  }

  const chip = (active) => `px-2 py-1 rounded border text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${active ? 'border-orange-600/60 bg-orange-500/15 text-orange-200' : 'border-gray-800 text-gray-400 hover:text-gray-200'}`

  return (
    <>
      <Modal open={open && !confirm} title="Send a message" subtitle="Goes to the in-app bell of everyone in the audience, and to their phone if push is ticked." onClose={onClose} width="max-w-2xl"
        footer={(<>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" icon={Send} disabled={!ready} onClick={() => setConfirm(true)}>Review and send</Btn>
        </>)}>
        <div className="space-y-3">
          <label className="block text-xs text-gray-400">Title<input className={`${INPUT} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>
          <label className="block text-xs text-gray-400">Message<textarea className={`${INPUT} mt-1`} rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} /></label>
          <fieldset>
            <legend className="text-xs text-gray-400 mb-1">Roles (none ticked = everyone)</legend>
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map((r) => <button key={r} type="button" aria-pressed={roles.includes(r)} onClick={() => flip(roles, setRoles, r)} className={chip(roles.includes(r))}>{r}</button>)}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-xs text-gray-400 mb-1">Countries (none ticked = every country)</legend>
            <div className="flex flex-wrap gap-1.5">
              {COUNTRIES.map((c) => <button key={c} type="button" aria-pressed={countries.includes(c)} onClick={() => flip(countries, setCountries, c)} className={chip(countries.includes(c))}>{c}</button>)}
            </div>
          </fieldset>
          <label className="flex items-start gap-2 text-xs text-gray-300">
            <input type="checkbox" className="accent-orange-500 mt-0.5" checked={sendPush} onChange={(e) => setSendPush(e.target.checked)} />
            <span>Also send to phones. The phone buzzes; the global push switch above still applies.</span>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Inboxes" value={preview ? fmtNum(preview.total) : 'N/A'} sub="approved accounts" />
            <StatTile label="With the app" value={preview ? fmtNum(preview.with_app) : 'N/A'} sub="can get a push" />
            <StatTile label="Signed in, 30 days" value={reach ? fmtNum(reach.signed_in_30d) : 'N/A'} sub="likely to read it soon" />
          </div>
          {audErr && <p role="alert" className="text-xs text-red-300">{audErr}</p>}
          <Note icon={Info}>Banners written in the Announcements tab are stored but no app screen shows them today, so this sends a real message instead.</Note>
        </div>
      </Modal>
      <ConfirmImpactDialog open={open && confirm} title="Send this message" confirmLabel="Send" busy={busy} error={err}
        onCancel={() => setConfirm(false)} onConfirm={send}
        impact={{
          tone: 'warning', what: `Sends "${title.trim()}".`,
          change: `A bell message for ${roles.length ? roles.join(', ') : 'every role'} in ${countries.length ? countries.join(', ') : 'every country'}${sendPush ? ', plus a phone push' : ''}.`,
          who: preview ? `${fmtNum(preview.total)} accounts in your organization; ${fmtNum(preview.with_app)} have the app.` : 'Audience count not available.',
          undo: 'No. A sent message cannot be unsent.',
          stats: preview ? [{ label: 'Inboxes', value: fmtNum(preview.total) }, { label: 'Phones', value: sendPush ? fmtNum(preview.with_app) : '0' }, { label: 'Active 30d', value: reach ? fmtNum(reach.signed_in_30d) : null }] : undefined,
        }} />
    </>
  )
}
