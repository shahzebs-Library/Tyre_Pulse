/**
 * IntakePanel - Daily Ops -> Workshop Status -> Vehicle intake.
 *
 * Views (each gated on the server's answer; the server checks again):
 *   sheet     add vehicles like a shared Excel sheet           (intake)
 *   waiting   vehicles routed to me, confirm / return          (intake_confirm)
 *   list      every intake vehicle still in the workshop:
 *             outcome with reason, job card, reasoned release  (view)
 *   roster    supervisors per site, day / night shift          (roster or configure)
 *   checks    unusual patterns for managers                    (view_reports or configure)
 *   sheets    connected Google Sheets and their heartbeat      (configure)
 *
 * The list is polled every 20 s with an updated_at cursor (only changed rows
 * come back). No realtime subscription, on purpose.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RotateCcw, ShieldAlert, AlertTriangle, CheckCircle2, Undo2, LogOut, CalendarClock, Users, FileSpreadsheet } from 'lucide-react'
import { Card, Tabs, fmtInt } from '../commandCenter/kit'
import Modal from '../ui/Modal'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'
import { getCurrentUserId } from '../../lib/api/workshopStatusNotifications'
import {
  listIntake, confirmIntake, returnIntake, setIntakeOutcome, releaseIntake, setIntakeJobCard,
  listRoster, listRosterCandidates, saveRosterEntry, listAnomalies, listIntakeSheets, registerIntakeSheet,
} from '../../lib/api/workshopIntake'
import {
  groupIntake, mergePolled, cursorOf, canConfirm, reasonOk, assetKey,
  JOB_OUTCOMES, RELEASE_DISPOSITIONS, SHIFTS,
} from '../../lib/workshopStatus/intake'
import IntakeSheetGrid from './IntakeSheetGrid'
import './workshopStatus.css'
import './activeVehicles.css'
import './intake.css'

const POLL_MS = 20000
const AREA_ROLES = ['Workshop Maintenance Area Manager', 'Workshop Area Manager']

export function intakeViews(perms) {
  const v = []
  if (perms?.intake) v.push('sheet')
  if (perms?.intake_confirm) v.push('waiting')
  if (perms?.view) v.push('list')
  if (perms?.roster || perms?.configure) v.push('roster')
  if (perms?.view_reports || perms?.configure) v.push('checks')
  if (perms?.configure) v.push('sheets')
  return v
}

function fmtTime(v) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function IntakePanel({ permissions, permState = 'ready', onRetryPermissions, initialView, myRole }) {
  const { t } = useLanguage()
  const k = useCallback((key, v) => t(`workshopStatusIntake.${key}`, v), [t])
  const { activeCountry } = useSettings()
  const country = !activeCountry || activeCountry === 'All' ? '' : activeCountry
  const views = intakeViews(permissions)
  const [view, setView] = useState(initialView && views.includes(initialView) ? initialView : views[0])
  useEffect(() => { if (!views.includes(view) && views.length) setView(views[0]) }, [views, view])

  const [me, setMe] = useState(null)
  useEffect(() => { let live = true; getCurrentUserId().then((u) => { if (live) setMe(u) }); return () => { live = false } }, [])

  // ---- live list (polled) -------------------------------------------------
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastPoll, setLastPoll] = useState(null)
  const cursorRef = useRef(null)
  const runRef = useRef(0)

  const loadAll = useCallback(async () => {
    const run = ++runRef.current
    setLoading(true); setError('')
    try {
      const { rows } = await listIntake({ country })
      if (run !== runRef.current) return
      setRecords(rows); cursorRef.current = cursorOf(rows); setLastPoll(new Date())
    } catch (err) {
      if (run === runRef.current) setError(toUserMessage(err, k('loadError')))
    } finally {
      if (run === runRef.current) setLoading(false)
    }
  }, [country, k])

  const poll = useCallback(async () => {
    if (document.hidden || !cursorRef.current) return
    try {
      const { rows } = await listIntake({ country, since: cursorRef.current })
      if (rows.length) {
        setRecords((cur) => mergePolled(cur, rows))
        cursorRef.current = cursorOf(rows, cursorRef.current)
      }
      setLastPoll(new Date())
    } catch { /* keep the last good list; the next poll retries */ }
  }, [country])

  const canSee = permissions?.view === true && views.length > 0
  useEffect(() => {
    if (permState !== 'ready' || !canSee) return undefined
    loadAll()
    const id = setInterval(poll, POLL_MS)
    return () => clearInterval(id)
  }, [permState, canSee, loadAll, poll])

  const groups = useMemo(() => groupIntake(records, me), [records, me])
  const listed = useMemo(() => new Map(records.filter((r) => r.current_active).map((r) => [assetKey(r.asset_no), r])), [records])
  const override = permissions?.configure === true || AREA_ROLES.includes(myRole)

  if (permState === 'loading') {
    return <Card><div className="wks-state" role="status"><Loader2 size={18} className="wks-spin" aria-hidden="true" /> {k('loadingPerms')}</div></Card>
  }
  if (!canSee) {
    return (
      <Card>
        <div className="wks-state wks-state-col" role="alert">
          <ShieldAlert size={26} aria-hidden="true" className="wks-ico-warn" />
          <h2 className="wks-h">{k('deniedTitle')}</h2>
          <p className="wks-muted">{k('deniedBody')}</p>
          {permState === 'error' && onRetryPermissions && (
            <button type="button" className="cc-btn-ghost wks-tap" onClick={onRetryPermissions}><RotateCcw size={14} aria-hidden="true" /> {k('retry')}</button>
          )}
        </div>
      </Card>
    )
  }

  const tabs = views.map((v) => ({
    key: v,
    label: k(`views.${v}`),
    count: v === 'waiting' ? groups.waiting.length : undefined,
    countTone: v === 'waiting' && groups.waiting.length ? 'red' : '',
  }))

  return (
    <div className="wks-panel">
      <Card
        title={k('title')}
        sub={k('lead')}
        action={(
          <div className="wks-av-tools">
            {lastPoll && <span className="wks-muted wks-intake-poll">{k('updated', { time: lastPoll.toLocaleTimeString() })}</span>}
            <button type="button" className="cc-btn-ghost wks-tap" onClick={loadAll} disabled={loading} aria-label={k('refresh')}>
              <RotateCcw size={14} aria-hidden="true" className={loading ? 'wks-spin' : ''} />
            </button>
          </div>
        )}
      >
        <Tabs label={k('viewsLabel')} value={view} onChange={setView} tabs={tabs} variant="line" />
        {error && (
          <div className="wks-banner bad" role="alert">
            <AlertTriangle size={17} aria-hidden="true" />
            <div><strong>{k('loadErrorTitle')}</strong><p>{error}</p>
              <button type="button" className="cc-btn-ghost wks-tap" onClick={loadAll}><RotateCcw size={14} aria-hidden="true" /> {k('retry')}</button>
            </div>
          </div>
        )}
        <div className="wks-intake-body">
          {view === 'sheet' && <IntakeSheetGrid country={country} listed={listed} onSent={loadAll} />}
          {view === 'waiting' && (
            <WaitingView rows={groups.waiting} others={override ? groups.pending : []} me={me} override={override}
              loading={loading} k={k} onDone={loadAll} />
          )}
          {view === 'list' && <ListView groups={groups} permissions={permissions} loading={loading} k={k} onDone={loadAll} />}
          {view === 'roster' && <RosterView country={country} k={k} />}
          {view === 'checks' && <ChecksView country={country} k={k} />}
          {view === 'sheets' && <SheetsView country={country} k={k} />}
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
function VehicleLine({ r, k }) {
  return (
    <div className="wks-intake-line">
      <strong className="wks-mono">{r.asset_no}</strong>
      {r.reg_no && <bdi dir="ltr" className="wks-muted">{r.reg_no}</bdi>}
      {r.site && <span className="wks-chip">{r.site}</span>}
      <span className={`wks-chip is-src-${r.intake_source}`}>{k(`source.${r.intake_source}`)}</span>
      {r.priority && <span className={`wks-chip is-prio-${r.priority.toLowerCase()}`}>{k(`priority.${r.priority}`)}</span>}
      {r.job_card_ref ? <span className="wks-muted">{k('jobCard')}: <bdi dir="ltr">{r.job_card_ref}</bdi></span>
        : r.provisional_ref && <span className="wks-muted">{k('provisional')}: <bdi dir="ltr">{r.provisional_ref}</bdi></span>}
      {r.complaint && <p className="wks-intake-complaint">{r.complaint}</p>}
      <p className="wks-muted wks-intake-meta">
        {k('enteredBy', { name: r.submitted_by_name || k('system'), time: fmtTime(r.submitted_at || r.first_seen_at) })}
        {(!r.routed_to || r.routed_to.length === 0) && r.confirm_status === 'pending_confirm' && <> · <span className="wks-intake-warn">{k('noSupervisor')}</span></>}
      </p>
    </div>
  )
}

function ReasonModal({ open, title, onClose, onSubmit, k, children, busy, error, canSubmit = true, submitLabel }) {
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={title} size="sm"
      footer={(
        <div className="wks-av-tools">
          <button type="button" className="cc-btn-ghost wks-tap" onClick={onClose} disabled={busy}>{k('cancel')}</button>
          <button type="button" className="cc-btn wks-tap" onClick={onSubmit} disabled={busy || !canSubmit}>
            {busy && <Loader2 size={14} className="wks-spin" aria-hidden="true" />} {submitLabel || k('save')}
          </button>
        </div>
      )}>
      <div className="wks-intake-form">
        {children}
        {error && <p className="wks-intake-err" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}

function WaitingView({ rows, others, me, override, loading, k, onDone }) {
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [returning, setReturning] = useState(null)
  const [reason, setReason] = useState('')
  const all = [...rows, ...others]
  const confirmable = all.filter((r) => canConfirm(r, me, { override }))

  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const doConfirm = async (ids) => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const res = await confirmIntake(ids)
      const results = res?.results || []
      const ok = results.filter((x) => x.outcome === 'confirmed').length
      const refused = results.filter((x) => x.outcome !== 'confirmed')
      setMsg(k('confirmedN', { n: ok }) + (refused.length ? ` ${k('notConfirmedN', { n: refused.length })}` : ''))
      if (refused.some((x) => x.outcome === 'refused')) setErr(refused.find((x) => x.message)?.message || '')
      setPicked(new Set()); onDone()
    } catch (e) {
      setErr(toUserMessage(e, k('confirmError')))
    } finally { setBusy(false) }
  }
  const doReturn = async () => {
    setBusy(true); setErr('')
    try { await returnIntake(returning.id, reason); setReturning(null); setReason(''); onDone() } catch (e) { setErr(toUserMessage(e, k('returnError'))) } finally { setBusy(false) }
  }

  if (loading && !all.length) return <div className="wks-av-skel" role="status"><span className="wks-sr">{k('loading')}</span>{[0, 1, 2].map((i) => <div key={i} className="cc-skel" style={{ height: 56 }} />)}</div>
  if (!all.length) {
    return <div className="wks-empty"><CheckCircle2 size={22} className="wks-ico-good" aria-hidden="true" /><h2 className="wks-h">{k('waiting.emptyTitle')}</h2><p className="wks-muted">{k('waiting.emptyBody')}</p></div>
  }
  return (
    <>
      <div className="wks-intake-toolbar">
        <p className="wks-muted">{k('waiting.lead', { n: rows.length })}</p>
        <button type="button" className="cc-btn wks-tap" disabled={!picked.size || busy} onClick={() => doConfirm([...picked])}>
          {busy ? <Loader2 size={14} className="wks-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />} {k('waiting.confirmSelected', { n: picked.size })}
        </button>
      </div>
      {msg && <p className="wks-muted" role="status">{msg}</p>}
      {err && !returning && <div className="wks-banner bad" role="alert"><AlertTriangle size={17} aria-hidden="true" /><p>{err}</p></div>}
      <ul className="wks-intake-list">
        {all.map((r) => {
          const can = canConfirm(r, me, { override })
          const own = r.submitted_by && r.submitted_by === me
          return (
            <li key={r.id} className="wks-intake-item">
              <label className="wks-intake-pick">
                <input type="checkbox" checked={picked.has(r.id)} disabled={!can} onChange={() => toggle(r.id)} aria-label={k('waiting.pick', { asset: r.asset_no })} />
              </label>
              <VehicleLine r={r} k={k} />
              <div className="wks-intake-actions">
                {own && <span className="wks-muted">{k('waiting.ownEntry')}</span>}
                {!own && (
                  <>
                    <button type="button" className="cc-btn wks-tap" disabled={!can || busy} onClick={() => doConfirm([r.id])}><CheckCircle2 size={14} aria-hidden="true" /> {k('waiting.confirm')}</button>
                    <button type="button" className="cc-btn-ghost wks-tap" disabled={busy} onClick={() => { setReturning(r); setReason(''); setErr('') }}><Undo2 size={14} aria-hidden="true" /> {k('waiting.return')}</button>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <ReasonModal open={!!returning} title={k('waiting.returnTitle', { asset: returning?.asset_no || '' })} onClose={() => setReturning(null)}
        onSubmit={doReturn} k={k} busy={busy} error={err} canSubmit={reasonOk(reason)} submitLabel={k('waiting.return')}>
        <label className="wks-intake-field">{k('reason')}
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={k('waiting.returnHint')} />
        </label>
      </ReasonModal>
    </>
  )
}

function ListView({ groups, permissions, loading, k, onDone }) {
  const [act, setAct] = useState(null) // { kind: 'outcome'|'release'|'job', r }
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const open = (kind, r) => { setAct({ kind, r }); setForm({ outcome: r.job_outcome || 'rescheduled', reason: '', date: r.rescheduled_for || '', disposition: 'repair_completed', job: '' }); setErr('') }
  const submit = async () => {
    setBusy(true); setErr('')
    try {
      if (act.kind === 'outcome') await setIntakeOutcome(act.r.id, form.outcome, form.reason, form.outcome === 'rescheduled' ? form.date : null)
      else if (act.kind === 'release') await releaseIntake(act.r.id, form.disposition, form.reason)
      else await setIntakeJobCard(act.r.id, form.job)
      setAct(null); onDone()
    } catch (e) { setErr(toUserMessage(e, k('saveError'))) } finally { setBusy(false) }
  }
  const sections = ['returned', 'waiting', 'pending', 'confirmed']
  const total = sections.reduce((n, s) => n + groups[s].length, 0)
  if (loading && !total) return <div className="wks-av-skel" role="status"><span className="wks-sr">{k('loading')}</span>{[0, 1, 2].map((i) => <div key={i} className="cc-skel" style={{ height: 56 }} />)}</div>
  if (!total) return <div className="wks-empty"><h2 className="wks-h">{k('list.emptyTitle')}</h2><p className="wks-muted">{k('list.emptyBody')}</p></div>
  const canAct = (r) => ({
    outcome: permissions?.update && r.current_active,
    release: permissions?.disposition && r.current_active,
    job: (permissions?.update || permissions?.intake) && !r.work_order_id,
  })
  const canSubmit = act?.kind === 'job' ? form.job?.trim() : reasonOk(form.reason) && (act?.kind !== 'outcome' || form.outcome !== 'rescheduled' || form.date)
  return (
    <>
      {sections.map((s) => groups[s].length > 0 && (
        <section key={s} className="wks-intake-section" aria-label={k(`list.${s}`)}>
          <h3 className="wks-h">{k(`list.${s}`)} <span className="cc-count">{fmtInt(groups[s].length)}</span></h3>
          <ul className="wks-intake-list">
            {groups[s].map((r) => {
              const a = canAct(r)
              return (
                <li key={r.id} className="wks-intake-item">
                  <VehicleLine r={r} k={k} />
                  <div className="wks-intake-state">
                    <span className={`wks-chip is-${r.confirm_status}`}>{k(`status.${r.confirm_status}`)}</span>
                    {r.confirm_status === 'confirmed' && r.confirmed_by_name && <span className="wks-muted">{k('confirmedBy', { name: r.confirmed_by_name, time: fmtTime(r.confirmed_at) })}</span>}
                    {r.confirm_status === 'returned' && <span className="wks-intake-warn">{r.returned_reason}</span>}
                    {r.job_outcome && <span className="wks-chip is-outcome">{k(`outcome.${r.job_outcome}`)}{r.rescheduled_for ? ` · ${r.rescheduled_for}` : ''}</span>}
                    {r.job_outcome_reason && <span className="wks-muted">{r.job_outcome_reason}</span>}
                    {r.link_suggestion && <span className="wks-intake-warn">{k('linkSuggestion', { jc: r.link_suggestion.job_card || '' })}</span>}
                  </div>
                  <div className="wks-intake-actions">
                    {a.job && <button type="button" className="cc-btn-ghost wks-tap" onClick={() => open('job', r)}>{k('list.addJobCard')}</button>}
                    {a.outcome && <button type="button" className="cc-btn-ghost wks-tap" onClick={() => open('outcome', r)}><CalendarClock size={14} aria-hidden="true" /> {k('list.outcome')}</button>}
                    {a.release && <button type="button" className="cc-btn-ghost wks-tap" onClick={() => open('release', r)}><LogOut size={14} aria-hidden="true" /> {k('list.release')}</button>}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      <ReasonModal open={!!act} onClose={() => setAct(null)} onSubmit={submit} k={k} busy={busy} error={err} canSubmit={Boolean(canSubmit)}
        title={act ? k(`list.${act.kind}Title`, { asset: act.r.asset_no }) : ''}>
        {act?.kind === 'outcome' && (
          <>
            <label className="wks-intake-field">{k('list.outcome')}
              <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
                {JOB_OUTCOMES.map((o) => <option key={o} value={o}>{k(`outcome.${o}`)}</option>)}
              </select>
            </label>
            {form.outcome === 'rescheduled' && (
              <label className="wks-intake-field">{k('list.newDate')}
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </label>
            )}
            <p className="wks-muted">{k('list.outcomeNote')}</p>
          </>
        )}
        {act?.kind === 'release' && (
          <label className="wks-intake-field">{k('list.howLeft')}
            <select value={form.disposition} onChange={(e) => setForm({ ...form, disposition: e.target.value })}>
              {RELEASE_DISPOSITIONS.map((d) => <option key={d} value={d}>{k(`disposition.${d}`)}</option>)}
            </select>
          </label>
        )}
        {act?.kind === 'job' ? (
          <label className="wks-intake-field">{k('jobCard')}
            <input value={form.job} onChange={(e) => setForm({ ...form, job: e.target.value })} />
          </label>
        ) : act && (
          <label className="wks-intake-field">{k('reason')}
            <textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </label>
        )}
      </ReasonModal>
    </>
  )
}

function RosterView({ country, k }) {
  const [rows, setRows] = useState([])
  const [people, setPeople] = useState([])
  const [state, setState] = useState('loading')
  const [err, setErr] = useState('')
  const [form, setForm] = useState({ site: '', user_id: '', shift_name: 'day', role: 'primary' })
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    setState('loading'); setErr('')
    try {
      const [r, p] = await Promise.all([listRoster({ country }), listRosterCandidates().catch(() => [])])
      setRows(r); setPeople(p); setState('ready')
    } catch (e) { setErr(toUserMessage(e, k('roster.loadError'))); setState('error') }
  }, [country, k])
  useEffect(() => { load() }, [load])
  const save = async (row) => {
    setBusy(true); setErr('')
    try { await saveRosterEntry(row); await load(); setForm((f) => ({ ...f, user_id: '' })) } catch (e) { setErr(toUserMessage(e, k('roster.saveError'))) } finally { setBusy(false) }
  }
  const bySite = useMemo(() => {
    const m = new Map()
    for (const r of rows) { const key = `${r.country}|${r.site}`; if (!m.has(key)) m.set(key, []); m.get(key).push(r) }
    return [...m.entries()]
  }, [rows])
  if (!country) return <div className="wks-banner warn" role="status"><AlertTriangle size={17} aria-hidden="true" /><p>{k('sheet.pickCountry')}</p></div>
  return (
    <>
      <p className="wks-muted"><Users size={14} aria-hidden="true" /> {k('roster.lead', { day: `${SHIFTS.day.start}-${SHIFTS.day.end}`, night: `${SHIFTS.night.start}-${SHIFTS.night.end}` })}</p>
      <form className="wks-intake-roster-form" onSubmit={(e) => { e.preventDefault(); save({ ...form, country, site: form.site.trim() }) }}>
        <label className="wks-intake-field">{k('roster.site')}<input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} required /></label>
        <label className="wks-intake-field">{k('roster.person')}
          <select value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} required>
            <option value="">{k('roster.choose')}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.role ? ` (${p.role})` : ''}</option>)}
          </select>
        </label>
        <label className="wks-intake-field">{k('roster.shift')}
          <select value={form.shift_name} onChange={(e) => setForm({ ...form, shift_name: e.target.value })}>
            {Object.keys(SHIFTS).map((s) => <option key={s} value={s}>{k(`roster.shifts.${s}`)}</option>)}
          </select>
        </label>
        <label className="wks-intake-field">{k('roster.role')}
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="primary">{k('roster.primary')}</option><option value="backup">{k('roster.backup')}</option>
          </select>
        </label>
        <button type="submit" className="cc-btn wks-tap" disabled={busy || !form.site.trim() || !form.user_id}>{busy && <Loader2 size={14} className="wks-spin" aria-hidden="true" />} {k('roster.add')}</button>
      </form>
      {err && <div className="wks-banner bad" role="alert"><AlertTriangle size={17} aria-hidden="true" /><p>{err}</p></div>}
      {state === 'loading' ? <div className="cc-skel" style={{ height: 80 }} role="status" aria-label={k('loading')} />
        : !rows.length ? <div className="wks-empty"><h2 className="wks-h">{k('roster.emptyTitle')}</h2><p className="wks-muted">{k('roster.emptyBody')}</p></div>
          : (
            <div className="wks-av-table-wrap">
              <table className="wks-av-table" aria-label={k('views.roster')}>
                <thead><tr><th scope="col">{k('roster.site')}</th><th scope="col">{k('roster.shift')}</th><th scope="col">{k('roster.person')}</th><th scope="col">{k('roster.role')}</th><th scope="col"><span className="wks-sr">{k('actions')}</span></th></tr></thead>
                <tbody>
                  {bySite.flatMap(([, list]) => list.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">{r.site}</th>
                      <td>{k(`roster.shifts.${r.shift_name}`)} <span className="wks-muted">{r.shift_start ? `${r.shift_start.slice(0, 5)}-${(r.shift_end || '').slice(0, 5)}` : ''}</span></td>
                      <td>{r.name || k('unknownPerson')}</td>
                      <td>{k(`roster.${r.role}`)}</td>
                      <td><button type="button" className="cc-btn-ghost wks-tap" disabled={busy} onClick={() => save({ ...r, active: false })}>{k('roster.remove')}</button></td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
    </>
  )
}

function ChecksView({ country, k }) {
  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading')
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    setState('loading'); setErr('')
    try { setRows(await listAnomalies({ country })); setState('ready') } catch (e) { setErr(toUserMessage(e, k('checks.loadError'))); setState('error') }
  }, [country, k])
  useEffect(() => { load() }, [load])
  if (state === 'loading') return <div className="cc-skel" style={{ height: 80 }} role="status" aria-label={k('loading')} />
  if (state === 'error') return <div className="wks-banner bad" role="alert"><AlertTriangle size={17} aria-hidden="true" /><div><p>{err}</p><button type="button" className="cc-btn-ghost wks-tap" onClick={load}>{k('retry')}</button></div></div>
  if (!rows.length) return <div className="wks-empty"><CheckCircle2 size={22} className="wks-ico-good" aria-hidden="true" /><h2 className="wks-h">{k('checks.emptyTitle')}</h2><p className="wks-muted">{k('checks.emptyBody')}</p></div>
  return (
    <>
      <p className="wks-muted">{k('checks.lead')}</p>
      <ul className="wks-intake-list">
        {rows.map((r, i) => (
          <li key={`${r.kind}-${r.record_id || i}`} className="wks-intake-item">
            <div className="wks-intake-line">
              <span className="wks-chip is-flag">{k(`checks.kinds.${r.kind}`)}</span>
              {r.asset_no && <strong className="wks-mono">{r.asset_no}</strong>}
              {r.site && <span className="wks-chip">{r.site}</span>}
              <p className="wks-muted">{k(`checks.explain.${r.kind}`, { ...(r.detail || {}), name: r.actor_name || '' })}</p>
              <p className="wks-muted wks-intake-meta">{fmtTime(r.at)}</p>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

function SheetsView({ country, k }) {
  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading')
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [site, setSite] = useState('')
  const [made, setMade] = useState('')
  const load = useCallback(async () => {
    setState('loading')
    try { setRows(await listIntakeSheets()); setState('ready') } catch (e) { setErr(toUserMessage(e, k('sheets.loadError'))); setState('error') }
  }, [k])
  useEffect(() => { load() }, [load])
  const add = async (e) => {
    e.preventDefault(); setErr('')
    try { const id = await registerIntakeSheet({ country, name, defaultSite: site }); setMade(id); setName(''); setSite(''); load() } catch (ex) { setErr(toUserMessage(ex, k('sheets.saveError'))) }
  }
  const silent = (r) => !r.last_seen_at || Date.now() - new Date(r.last_seen_at).getTime() > 30 * 60 * 1000
  return (
    <>
      <p className="wks-muted"><FileSpreadsheet size={14} aria-hidden="true" /> {k('sheets.lead')}</p>
      {country && (
        <form className="wks-intake-roster-form" onSubmit={add}>
          <label className="wks-intake-field">{k('sheets.name')}<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label className="wks-intake-field">{k('sheets.defaultSite')}<input value={site} onChange={(e) => setSite(e.target.value)} /></label>
          <button type="submit" className="cc-btn wks-tap" disabled={!name.trim()}>{k('sheets.register')}</button>
        </form>
      )}
      {made && <div className="wks-banner ok" role="status"><CheckCircle2 size={17} aria-hidden="true" className="wks-ico-good" /><p>{k('sheets.made', { id: made })}</p></div>}
      {err && <div className="wks-banner bad" role="alert"><AlertTriangle size={17} aria-hidden="true" /><p>{err}</p></div>}
      {state === 'loading' ? <div className="cc-skel" style={{ height: 60 }} role="status" aria-label={k('loading')} />
        : !rows.length ? <div className="wks-empty"><h2 className="wks-h">{k('sheets.emptyTitle')}</h2><p className="wks-muted">{k('sheets.emptyBody')}</p></div>
          : (
            <ul className="wks-intake-list">
              {rows.map((r) => (
                <li key={r.id} className="wks-intake-item">
                  <div className="wks-intake-line">
                    <strong>{r.name}</strong><span className="wks-chip">{r.country}</span>{r.default_site && <span className="wks-chip">{r.default_site}</span>}
                    <span className={`wks-chip ${silent(r) ? 'is-flag' : 'is-confirmed'}`}>{silent(r) ? k('sheets.silent') : k('sheets.live')}</span>
                    <p className="wks-muted wks-mono">{k('sheets.id')}: {r.id}</p>
                    <p className="wks-muted">{r.last_seen_at ? k('sheets.lastSeen', { time: fmtTime(r.last_seen_at), n: r.last_row_count ?? 0 }) : k('sheets.never')}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
    </>
  )
}
