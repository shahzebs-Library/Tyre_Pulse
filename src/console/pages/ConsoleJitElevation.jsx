/**
 * ConsoleJitElevation.jsx - just-in-time privilege elevation (super admin).
 *
 * A non-admin user asks for ONE module capability for 5 minutes to 8 hours
 * with a reason; a super admin approves (optionally for less time) or denies.
 * Approval writes an EXPIRING row into the existing user_access_grants table,
 * which every permission reader already ignores once expires_at passes, so an
 * elevation stops working at expiry whether or not the 5-minute sweep has run.
 * A super admin can also grant directly on someone's behalf, and end any
 * active elevation early. Every action is audited (console_sessions +
 * access_audit) by the server; see 20260924116000_jit_elevation.sql.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Timer, ShieldCheck, ShieldOff, Clock, RefreshCw, Download, Plus, Ban, Info, History, Hourglass, BarChart3,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Code, Btn, Segmented, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { TrendChart, BarsChart } from '../components/ui/charts'
import { dailySeries, topShare } from '../../lib/consoleCharts'
import {
  listElevations, decideElevation, grantElevation, revokeElevation, listElevationCandidates,
} from '../../lib/api/jitElevation'
import {
  JIT_CAPABILITIES, DURATION_PRESETS, STATUS_META, MIN_DECISION_NOTE,
  clampMinutes, durationError, reasonError, validateRequest, remainingMs, effectiveStatus,
  formatRemaining, formatMinutes, elapsedPct, summarize, partition, filterRows,
} from '../../lib/jitElevation'
import { ALL_MODULES, MODULE_LABEL } from '../../lib/moduleCatalog'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'

function fmtWhen(v) {
  if (!v) return 'N/A'
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const moduleName = (k) => MODULE_LABEL[k] || k
const capName = (c) => JIT_CAPABILITIES.find((x) => x.key === c)?.label || c

const inputCls = 'mt-1 w-full rounded-lg bg-gray-900 border border-gray-800 px-2.5 py-1.5 text-xs text-gray-200 focus:border-gray-700 focus:outline-none'

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

function Who({ row }) {
  return (
    <div>
      <div className="text-gray-200">{row.target_name || 'Unknown user'}</div>
      <div className="text-[11px] text-gray-500">{row.target_role || 'N/A'}{row.organisation_name ? `, ${row.organisation_name}` : ''}</div>
    </div>
  )
}

function What({ row }) {
  return (
    <div>
      <div className="text-gray-200">{capName(row.capability)} on {moduleName(row.module_key)}</div>
      <div className="mt-0.5"><Code>{row.module_key}</Code></div>
    </div>
  )
}

function DecideModal({ target, approve, onClose, onDone }) {
  const [note, setNote] = useState('')
  const [minutes, setMinutes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { setNote(''); setErr(null); setMinutes(target ? String(target.requested_minutes) : '') }, [target, approve])
  if (!target) return null
  const max = target.requested_minutes
  const minErr = approve ? (durationError(Number(minutes)) || (Number(minutes) > max ? `Cannot approve more than the ${max} minutes requested.` : null)) : null
  const noteErr = !approve ? reasonError(note, MIN_DECISION_NOTE) : null
  const invalid = minErr || noteErr
  const submit = async () => {
    if (invalid) { setErr(invalid); return }
    setBusy(true); setErr(null)
    try {
      const res = await decideElevation(target.id, { approve, note: note || null, minutes: approve ? Number(minutes) : null })
      if (res && res.ok === false) setErr('This request was already decided.')
      else onDone(approve ? `Approved for ${formatMinutes(Number(minutes))}.` : 'Request denied.')
    } catch (e) {
      setErr(toUserMessage(e, 'Could not record the decision.'))
    } finally { setBusy(false) }
  }
  return (
    <Modal open title={approve ? 'Approve elevation' : 'Deny elevation'}
      subtitle={`${target.target_name || 'User'}: ${capName(target.capability)} on ${moduleName(target.module_key)}`}
      onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant={approve ? 'good' : 'danger'} icon={approve ? ShieldCheck : ShieldOff} busy={busy} disabled={!!invalid} onClick={submit}>
          {approve ? 'Approve' : 'Deny'}
        </Btn>
      </>}>
      <div className="space-y-3">
        <Note icon={Info}>Reason given: {target.reason}</Note>
        {approve && (
          <div>
            <p className="text-xs text-gray-400 mb-1">Duration (the clock starts when you approve, not when it was requested)</p>
            <Toolbar>
              {DURATION_PRESETS.filter((d) => d <= max).map((d) => (
                <Btn key={d} size="xs" onClick={() => setMinutes(String(d))}>{formatMinutes(d)}</Btn>
              ))}
            </Toolbar>
            <label className="block text-xs text-gray-400 mt-2">
              Minutes (up to {max})
              <input type="number" min={5} max={max} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={inputCls} />
            </label>
          </div>
        )}
        <label className="block text-xs text-gray-400">
          {approve ? 'Note (optional)' : 'Reason for denial (sent to the requester)'}
          <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls}
            placeholder={approve ? 'For example: approved for the month-end count only' : 'For example: ask your manager to do this change'} />
        </label>
        {err && <p className="text-xs text-red-300">{err}</p>}
      </div>
    </Modal>
  )
}

function RevokeModal({ target, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { setReason(''); setErr(null) }, [target])
  if (!target) return null
  const invalid = reasonError(reason, MIN_DECISION_NOTE)
  const submit = async () => {
    if (invalid) { setErr(invalid); return }
    setBusy(true); setErr(null)
    try {
      const res = await revokeElevation(target.id, reason)
      if (res && res.ok === false) setErr('This elevation is no longer active.')
      else onDone('Elevation ended. The access stopped immediately.')
    } catch (e) {
      setErr(toUserMessage(e, 'Could not end the elevation.'))
    } finally { setBusy(false) }
  }
  return (
    <Modal open title="End elevation now" subtitle={`${target.target_name || 'User'}: ${capName(target.capability)} on ${moduleName(target.module_key)}`}
      onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" icon={Ban} busy={busy} disabled={!!invalid} onClick={submit}>End now</Btn>
      </>}>
      <div className="space-y-3">
        <label className="block text-xs text-gray-400">
          Reason (recorded in the audit trail and sent to the user)
          <textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}
            placeholder="For example: task finished early" />
        </label>
        {err && <p className="text-xs text-red-300">{err}</p>}
      </div>
    </Modal>
  )
}

function GrantModal({ open, onClose, onDone }) {
  const [users, setUsers] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [form, setForm] = useState({ userId: '', moduleKey: '', capability: 'view', minutes: 60, reason: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (!open) return
    setForm({ userId: '', moduleKey: '', capability: 'view', minutes: 60, reason: '' }); setErr(null)
    let live = true
    listElevationCandidates()
      .then((r) => { if (live) { setUsers(r.users); setLoadErr(null) } })
      .catch((e) => { if (live) setLoadErr(toUserMessage(e, 'Could not load users.')) })
    return () => { live = false }
  }, [open])
  if (!open) return null
  const errors = validateRequest(form)
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))
  const submit = async () => {
    if (Object.keys(errors).length) { setErr(Object.values(errors)[0]); return }
    setBusy(true); setErr(null)
    try {
      await grantElevation({ ...form, minutes: clampMinutes(form.minutes) })
      onDone(`Granted for ${formatMinutes(clampMinutes(form.minutes))}.`)
    } catch (e) {
      setErr(toUserMessage(e, 'Could not grant the elevation.'))
    } finally { setBusy(false) }
  }
  const userOptions = (users || []).map((u) => ({ value: u.id, label: `${u.full_name || u.email || u.id} (${u.role || 'no role'})` }))
  const moduleOptions = ALL_MODULES.map((m) => ({ value: m.key, label: `${m.group}: ${m.label}` }))
  return (
    <Modal open title="Grant temporary access" subtitle="Filed and approved in one step on the user's behalf. Audited like any other approval."
      onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" icon={ShieldCheck} busy={busy} disabled={!!Object.keys(errors).length} onClick={submit}>Grant</Btn>
      </>}>
      <div className="space-y-3">
        {loadErr ? <ErrorState message={loadErr} /> : (
          <label className="block text-xs text-gray-400">
            User
            <Select value={form.userId} onChange={set('userId')} options={userOptions}
              placeholder={users ? 'Choose a user' : 'Loading users'} className="mt-1 w-full" />
            <span className="text-[11px] text-gray-500">Admins and super admins are not listed: they already hold every capability.</span>
          </label>
        )}
        <label className="block text-xs text-gray-400">
          Module
          <Select value={form.moduleKey} onChange={set('moduleKey')} options={moduleOptions} placeholder="Choose a module" className="mt-1 w-full" />
        </label>
        <div>
          <p className="text-xs text-gray-400 mb-1">Capability</p>
          <Segmented role="group" ariaLabel="Capability" value={form.capability} onChange={set('capability')}
            options={JIT_CAPABILITIES.map((c) => ({ key: c.key, label: c.label }))} />
          <p className="text-[11px] text-gray-500 mt-1">Delete is not offered: the server refuses delete to every non-admin, so a grant would change nothing.</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Duration</p>
          <Toolbar>
            {DURATION_PRESETS.map((d) => <Btn key={d} size="xs" onClick={() => set('minutes')(d)}>{formatMinutes(d)}</Btn>)}
          </Toolbar>
          <label className="block text-xs text-gray-400 mt-2">
            Minutes (5 to 480)
            <input type="number" min={5} max={480} value={form.minutes} onChange={(e) => set('minutes')(e.target.value)} className={inputCls} />
          </label>
          {errors.minutes && <p className="text-[11px] text-amber-300 mt-1">{errors.minutes}</p>}
        </div>
        <label className="block text-xs text-gray-400">
          Reason (recorded in the audit trail)
          <textarea rows={3} maxLength={1000} value={form.reason} onChange={(e) => set('reason')(e.target.value)} className={inputCls}
            placeholder="For example: covering the stock count while the store keeper is on leave" />
        </label>
        {err && <p className="text-xs text-red-300">{err}</p>}
      </div>
    </Modal>
  )
}

export default function ConsoleJitElevation() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [flash, setFlash] = useState(null)
  const [decide, setDecide] = useState(null) // { row, approve }
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [granting, setGranting] = useState(false)
  const [search, setSearch] = useState('')
  const [histStatus, setHistStatus] = useState('')
  const now = useNow(1000)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await listElevations()) } catch (e) { setError(toUserMessage(e, 'Could not load elevation requests.')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const rows = useMemo(() => data?.rows || [], [data])
  // Recomputed each minute, not each second: the countdown text reads `now` directly.
  const minuteNow = Math.floor(now / 60000) * 60000
  const summary = useMemo(() => summarize(rows, minuteNow), [rows, minuteNow])
  const parts = useMemo(() => partition(rows, minuteNow), [rows, minuteNow])
  const history = useMemo(() => filterRows(parts.history, { search, status: histStatus }, minuteNow), [parts, search, histStatus, minuteNow])
  const trend = useMemo(() => dailySeries(rows, (r) => r.created_at, 14), [rows])
  const topModules = useMemo(() => topShare(rows, (r) => moduleName(r.module_key), 6), [rows])

  const done = (msg) => { setDecide(null); setRevokeTarget(null); setGranting(false); setFlash(msg); load() }

  const doExport = () => {
    exportToExcel(
      rows.map((r) => ({
        user: r.target_name || '', role: r.target_role || '', organisation: r.organisation_name || '',
        module: moduleName(r.module_key), module_key: r.module_key, capability: capName(r.capability),
        status: STATUS_META[effectiveStatus(r, Date.now())]?.label || r.status,
        requested_by: r.requested_by_name || '', requested_minutes: r.requested_minutes,
        granted_minutes: r.granted_minutes ?? 'N/A', reason: r.reason || '',
        requested_at: fmtWhen(r.created_at), decided_by: r.decided_by_name || '', decided_at: fmtWhen(r.decided_at),
        decision_note: r.decision_note || '', expires_at: fmtWhen(r.expires_at),
        revoked_by: r.revoked_by_name || '', revoked_at: fmtWhen(r.revoked_at), revoke_reason: r.revoke_reason || '',
      })),
      ['user', 'role', 'organisation', 'module', 'module_key', 'capability', 'status', 'requested_by', 'requested_minutes', 'granted_minutes', 'reason', 'requested_at', 'decided_by', 'decided_at', 'decision_note', 'expires_at', 'revoked_by', 'revoked_at', 'revoke_reason'],
      ['User', 'Role', 'Organisation', 'Module', 'Module key', 'Capability', 'Status', 'Requested by', 'Requested (min)', 'Granted (min)', 'Reason', 'Requested at', 'Decided by', 'Decided at', 'Decision note', 'Expires', 'Revoked by', 'Revoked at', 'Revoke reason'],
      reportFileName('JIT Elevation', new Date().toISOString().slice(0, 10)),
      'Elevations',
    )
  }

  const histTabs = [
    { key: '', label: 'All', count: parts.history.length },
    ...['expired', 'revoked', 'denied', 'cancelled', 'lapsed'].map((s) => ({
      key: s, label: STATUS_META[s].label, count: parts.history.filter((r) => effectiveStatus(r, minuteNow) === s).length,
    })),
  ]

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1><Timer size={18} className="text-orange-400" /> Just-in-time Elevation</h1>
          <p className="text-xs text-gray-500 mt-1">
            Time-limited access to one module capability, with a reason, a decision and an automatic end. Last read {fmtWhen(data?.generatedAt)}.
          </p>
        </div>
        <Toolbar>
          <Btn icon={Plus} variant="primary" onClick={() => setGranting(true)}>Grant temporary access</Btn>
          <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
          <Btn icon={Download} onClick={doExport} disabled={!rows.length}>Export</Btn>
        </Toolbar>
      </header>

      {flash && <Note icon={Info} tone="accent">{flash}</Note>}

      {loading && !data ? <LoadingState label="Loading elevation requests" /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <>
          {data?.truncated && (
            <Note icon={Info} tone="warning">Showing the newest {rows.length} of {data.total} requests. Export and counts cover the rows shown.</Note>
          )}
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Waiting" value={summary.pending} icon={Hourglass} tone={summary.pending ? 'warning' : 'muted'} />
            <StatTile label="Active now" value={summary.active} icon={ShieldCheck} tone={summary.active ? 'good' : 'muted'} />
            <StatTile label="Ended early" value={summary.revoked} tone={summary.revoked ? 'danger' : 'muted'} />
            <StatTile label="Approval rate" value={summary.approvalRate === null ? 'N/A' : `${summary.approvalRate}%`}
              sub={summary.approvalRate === null ? 'Nothing decided yet' : 'Of decided requests'} />
            <StatTile label="Median wait" value={summary.medianDecisionMinutes === null ? 'N/A' : formatMinutes(summary.medianDecisionMinutes)}
              sub="Request to decision" icon={Clock} />
          </div>

          <Note icon={Info}>
            Access ends exactly at expiry even between sweeps: every permission check already ignores an expired grant. Admins and super admins cannot be elevated because they already hold every capability. Requests are filed with the <Code>request_elevation</Code> RPC; users get a notification when you decide.
          </Note>

          <Panel>
            <PanelHeader icon={Hourglass} title="Waiting for a decision" subtitle={`${parts.pending.length} request${parts.pending.length === 1 ? '' : 's'}. Undecided requests lapse after 24 hours.`} tone={parts.pending.length ? 'warning' : 'default'} />
            {!parts.pending.length ? (
              <EmptyState icon={Hourglass} title="Nothing waiting" reason="No elevation request is waiting for a decision." />
            ) : (
              <Table>
                <THead><Th>User</Th><Th>Access asked for</Th><Th>Duration</Th><Th>Reason</Th><Th>Requested</Th><Th align="right">Decision</Th></THead>
                <tbody>
                  {parts.pending.map((r) => (
                    <Tr key={r.id}>
                      <Td><Who row={r} /></Td>
                      <Td><What row={r} /></Td>
                      <Td nowrap>{formatMinutes(r.requested_minutes)}</Td>
                      <Td><span className="text-gray-300 block max-w-[18rem]" title={r.reason}>{r.reason}</span></Td>
                      <Td nowrap>{fmtWhen(r.created_at)}</Td>
                      <Td align="right" nowrap>
                        <div className="inline-flex gap-1.5">
                          <Btn size="xs" variant="good" icon={ShieldCheck} onClick={() => setDecide({ row: r, approve: true })}>Approve</Btn>
                          <Btn size="xs" variant="danger" icon={ShieldOff} onClick={() => setDecide({ row: r, approve: false })}>Deny</Btn>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel>
            <PanelHeader icon={ShieldCheck} title="Active elevations" subtitle="Soonest to expire first. Time left updates every second." />
            {!parts.active.length ? (
              <EmptyState icon={ShieldCheck} title="No active elevations" reason="Nobody holds temporary access right now." />
            ) : (
              <Table>
                <THead><Th>User</Th><Th>Access</Th><Th>Approved by</Th><Th>Time left</Th><Th>Ends</Th><Th align="right">Actions</Th></THead>
                <tbody>
                  {parts.active.map((r) => {
                    const left = remainingMs(r, now)
                    const pct = elapsedPct(r, now)
                    return (
                      <Tr key={r.id}>
                        <Td><Who row={r} /></Td>
                        <Td><What row={r} /></Td>
                        <Td nowrap>
                          <div className="text-gray-300">{r.decided_by_name || 'Unknown'}</div>
                          {r.requested_by === r.decided_by && <div className="text-[11px] text-gray-500">Granted directly</div>}
                        </Td>
                        <Td nowrap>
                          <div className="text-gray-100 tabular-nums">{formatRemaining(left)}</div>
                          {pct !== null && (
                            <div className="mt-1 h-1 w-28 rounded bg-gray-800 overflow-hidden" aria-label={`${pct}% of the window used`}>
                              <div className={`h-full ${pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </Td>
                        <Td nowrap>{fmtWhen(r.expires_at)}</Td>
                        <Td align="right"><Btn size="xs" variant="danger" icon={Ban} onClick={() => setRevokeTarget(r)}>End now</Btn></Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader icon={BarChart3} title="Requests per day" subtitle={`${trend.total} in the last 14 days`} />
              <TrendChart labels={trend.labels} series={[{ label: 'Requests', values: trend.values }]} height={180}
                summary={`${trend.total} elevation requests in the last 14 days`} emptyText="No requests in the last 14 days." />
            </Panel>
            <Panel>
              <PanelHeader icon={BarChart3} title="Most requested modules" subtitle="All time, every status" />
              <BarsChart bars={topModules.map((m) => ({ label: m.label, value: m.value }))}
                summary={topModules.map((m) => `${m.label} ${m.value}`).join(', ')} emptyText="No requests yet." />
            </Panel>
          </div>

          <Panel flush>
            <div className="p-4 pb-3 space-y-3">
              <PanelHeader icon={History} title="History" subtitle={`${history.length} of ${parts.history.length} shown`} />
              <Toolbar>
                <Segmented options={histTabs} value={histStatus} onChange={setHistStatus} ariaLabel="Filter history by outcome" />
                <SearchInput value={search} onChange={setSearch} placeholder="Search user, module, reason, decider" className="w-72" />
              </Toolbar>
            </div>
            {!parts.history.length ? (
              <div className="p-4 pt-0"><EmptyState icon={History} title="No history yet" reason="No elevation has ended, been denied or been cancelled." /></div>
            ) : !history.length ? (
              <div className="p-4 pt-0"><EmptyState title="Nothing matches" reason="No past request matches the current filters." /></div>
            ) : (
              <Table className="rounded-none border-x-0 border-b-0">
                <THead><Th>User</Th><Th>Access</Th><Th>Outcome</Th><Th>Requested</Th><Th>Decided</Th><Th>Detail</Th></THead>
                <tbody>
                  {history.map((r) => {
                    const s = effectiveStatus(r, minuteNow)
                    const meta = STATUS_META[s] || { label: s, tone: 'quiet' }
                    const detail = s === 'revoked' ? `${r.revoked_by_name || 'Unknown'}: ${r.revoke_reason || ''}`
                      : s === 'denied' ? r.decision_note || ''
                        : r.granted_minutes ? `Granted ${formatMinutes(r.granted_minutes)}${r.expires_at ? `, ended ${fmtWhen(r.expires_at)}` : ''}` : r.reason
                    return (
                      <Tr key={r.id}>
                        <Td><Who row={r} /></Td>
                        <Td><What row={r} /></Td>
                        <Td><Badge tone={meta.tone}>{meta.label}</Badge></Td>
                        <Td nowrap>
                          <div className="text-gray-300">{fmtWhen(r.created_at)}</div>
                          <div className="text-[11px] text-gray-500">{r.requested_by_name || 'Unknown'}, {formatMinutes(r.requested_minutes)}</div>
                        </Td>
                        <Td nowrap>
                          <div className="text-gray-300">{fmtWhen(r.decided_at)}</div>
                          {r.decided_by_name && <div className="text-[11px] text-gray-500">{r.decided_by_name}</div>}
                        </Td>
                        <Td><span className="text-gray-400 block max-w-[18rem]" title={detail}>{detail || 'N/A'}</span></Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </Panel>
        </>
      )}

      <DecideModal target={decide?.row || null} approve={!!decide?.approve} onClose={() => setDecide(null)} onDone={done} />
      <RevokeModal target={revokeTarget} onClose={() => setRevokeTarget(null)} onDone={done} />
      <GrantModal open={granting} onClose={() => setGranting(false)} onDone={done} />
    </div>
  )
}
