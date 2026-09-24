/**
 * ConsoleApprovals.jsx - four-eyes (dual-control) approvals.
 *
 * The most destructive console actions (data cleanup, backup restore, bulk role
 * change) can be set to need a SECOND super admin before they run. The rule is
 * enforced in the database (migration 20260924110000_dual_control.sql): the
 * gated functions refuse to run without a matching approved request, and a
 * person can never approve their own request. This page raises, decides and
 * tracks those requests, and switches the rule on or off.
 *
 * Off by default, so nothing changes until someone turns it on. Turning it on
 * needs two active super admins; turning it off needs an approved request.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck, UserCheck, Users, CheckCircle2, XCircle, Clock, Ban, Plus,
  RefreshCw, Power, AlertTriangle, History, Hourglass, FileSignature, Lock, Unlock,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, Toolbar, Select,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { TrendChart, BarsChart, ShareChart } from '../components/ui/charts'
import {
  listApprovals, requestApproval, decideApproval, cancelApproval, setDualControl,
} from '../../lib/api/dualControl'
import {
  APPROVAL_ACTIONS, REQUESTABLE_ACTIONS, STATUS_META, describePayload, canDecide,
  canCancel, timeLeft, summarizeApprovals, parseUserIds,
} from '../../lib/dualControl'
import { dailySeries } from '../../lib/consoleCharts'
import { toUserMessage } from '../../lib/safeError'

const CLEANUP_KEYS = [
  'audit_logs', 'system_logs', 'access_audit', 'ai_token_logs', 'ai_usage_log', 'odometer_logs',
  'engine_hours', 'accidents', 'tyre_records', 'inspections', 'work_orders',
]
const BACKUP_TABLES = [
  'tyre_records', 'vehicle_fleet', 'accidents', 'inspections', 'work_orders', 'pm_programs',
  'pm_service_records', 'stock_records',
]

function fmtWhen(v) {
  if (!v) return 'N/A'
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const inputCls = 'w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none'

function Field({ label, children, hint }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-600">{hint}</span>}
    </label>
  )
}

/* ── new request ──────────────────────────────────────────────────────────── */
function RequestModal({ open, onClose, onDone, forcedAction }) {
  const [action, setAction] = useState(forcedAction || 'admin_data_cleanup_run')
  const [key, setKey] = useState('system_logs')
  const [before, setBefore] = useState('')
  const [snapshot, setSnapshot] = useState('')
  const [table, setTable] = useState('tyre_records')
  const [role, setRole] = useState('')
  const [users, setUsers] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (open) { setAction(forcedAction || 'admin_data_cleanup_run'); setErr(''); setReason('') }
  }, [open, forcedAction])

  const parsed = useMemo(() => parseUserIds(users), [users])

  async function submit() {
    setErr('')
    if (reason.trim().length < 5) { setErr('Give a reason of at least 5 characters.'); return }
    let payload = {}
    if (action === 'admin_data_cleanup_run') payload = { key, before }
    else if (action === 'backup_restore_missing') payload = { snapshot_id: snapshot, table }
    else if (action === 'admin_bulk_set_role') {
      if (parsed.invalid.length) { setErr(`Not a valid user id: ${parsed.invalid.slice(0, 3).join(', ')}`); return }
      payload = { role, user_ids: parsed.ids }
    }
    setBusy(true)
    try {
      await requestApproval(action, payload, reason.trim())
      onDone?.()
      onClose?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not send the request.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={forcedAction === 'dual_control_disable' ? 'Ask to turn dual control off' : 'Request approval'}
      subtitle="A second super admin must approve this before it can run. An approval is valid for 24 hours and can be used once."
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" icon={FileSignature} busy={busy} onClick={submit}>Send request</Btn>
      </>}>
      <div className="space-y-3">
        {!forcedAction && (
          <Field label="Action">
            <Select value={action} onChange={setAction}
              options={REQUESTABLE_ACTIONS.map((a) => ({ value: a, label: APPROVAL_ACTIONS[a].label }))} />
          </Field>
        )}
        {action === 'admin_data_cleanup_run' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cleanup target">
              <Select value={key} onChange={setKey} options={CLEANUP_KEYS.map((k) => ({ value: k, label: k.replace(/_/g, ' ') }))} />
            </Field>
            <Field label="Delete records older than">
              <input type="date" value={before} onChange={(e) => setBefore(e.target.value)} className={inputCls} />
            </Field>
          </div>
        )}
        {action === 'backup_restore_missing' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Snapshot id" hint="Copy it from Console, Backups.">
              <input value={snapshot} onChange={(e) => setSnapshot(e.target.value)} placeholder="Snapshot id" className={inputCls} />
            </Field>
            <Field label="Table">
              <Select value={table} onChange={setTable} options={BACKUP_TABLES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))} />
            </Field>
          </div>
        )}
        {action === 'admin_bulk_set_role' && (
          <>
            <Field label="New role">
              <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="For example Manager" className={inputCls} />
            </Field>
            <Field label="User ids" hint={`${parsed.ids.length} valid id${parsed.ids.length === 1 ? '' : 's'}. Paste one per line or separate with commas.`}>
              <textarea rows={4} value={users} onChange={(e) => setUsers(e.target.value)} className={inputCls} />
            </Field>
          </>
        )}
        {action && APPROVAL_ACTIONS[action] && (
          <Note icon={AlertTriangle} tone="warning">{APPROVAL_ACTIONS[action].risk} The approval covers exactly these details; any change needs a new request.</Note>
        )}
        <Field label="Reason">
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Why this needs to happen" className={inputCls} />
        </Field>
        <ErrorState message={err} />
      </div>
    </Modal>
  )
}

/* ── decide ───────────────────────────────────────────────────────────────── */
function DecideModal({ row, approve, onClose, onDone }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setNote(''); setErr('') }, [row, approve])
  if (!row) return null

  async function submit() {
    setErr('')
    if (!approve && note.trim().length < 3) { setErr('Say why you are rejecting it.'); return }
    setBusy(true)
    try {
      await decideApproval(row.id, approve, note.trim() || null)
      onDone?.()
      onClose?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not record the decision.'))
    } finally {
      setBusy(false)
    }
  }

  const meta = APPROVAL_ACTIONS[row.action] || { label: row.action }
  return (
    <Modal open={!!row} onClose={onClose} width="max-w-lg"
      title={approve ? 'Approve this request' : 'Reject this request'}
      subtitle={`${meta.label} asked by ${row.requested_by_name || 'N/A'}`}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant={approve ? 'good' : 'danger'} icon={approve ? CheckCircle2 : XCircle} busy={busy} onClick={submit}>
          {approve ? 'Approve' : 'Reject'}
        </Btn>
      </>}>
      <div className="space-y-3 text-xs">
        <div className="space-y-1 text-gray-300">
          <p><span className="text-gray-500">What:</span> {describePayload(row.action, row.payload)}</p>
          <p><span className="text-gray-500">Reason given:</span> {row.reason}</p>
          <p><span className="text-gray-500">Asked:</span> {fmtWhen(row.requested_at)}</p>
        </div>
        {approve && meta.risk && <Note icon={AlertTriangle} tone="warning">{meta.risk} Once approved, the requester can run it once within 24 hours.</Note>}
        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">{approve ? 'Note (optional)' : 'Reason for rejecting'}</span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
        </label>
        <ErrorState message={err} />
      </div>
    </Modal>
  )
}

/* ── page ─────────────────────────────────────────────────────────────────── */
export default function ConsoleApprovals() {
  const [tab, setTab] = useState('open')
  const [data, setData] = useState({ enabled: false, activeSuperAdmins: 0, rows: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState(null)
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestAction, setRequestAction] = useState(null)
  const [decide, setDecide] = useState(null)
  const [toggleOpen, setToggleOpen] = useState(false)
  const [toggleReason, setToggleReason] = useState('')
  const [toggleBusy, setToggleBusy] = useState(false)
  const [toggleErr, setToggleErr] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await listApprovals(null))
    } catch (e) {
      setError(toUserMessage(e, 'Could not load approvals.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const rows = data.rows
  const summary = useMemo(() => summarizeApprovals(rows), [rows])
  const shown = useMemo(() => rows.filter((r) => (tab === 'open'
    ? (r.status === 'pending' || r.status === 'approved')
    : tab === 'decided' ? !(r.status === 'pending' || r.status === 'approved') : true)), [rows, tab])

  const trend = useMemo(() => dailySeries(rows, (r) => r.requested_at, 30), [rows])
  const statusParts = useMemo(() => Object.entries(summary.byStatus)
    .map(([k, v]) => ({ label: STATUS_META[k]?.label || k, value: v }))
    .sort((a, b) => b.value - a.value).slice(0, 5), [summary])
  const actionBars = useMemo(() => Object.entries(summary.byAction)
    .map(([k, v]) => ({ label: APPROVAL_ACTIONS[k]?.label || k, value: v }))
    .sort((a, b) => b.value - a.value), [summary])

  const hasOpenDisable = rows.some((r) => r.action === 'dual_control_disable' && r.is_mine && r.status === 'approved')

  async function onCancel(row) {
    setBusyId(row.id)
    try {
      await cancelApproval(row.id)
      setFlash({ tone: 'good', text: 'Request withdrawn.' })
      await load()
    } catch (e) {
      setFlash({ tone: 'danger', text: toUserMessage(e, 'Could not withdraw the request.') })
    } finally {
      setBusyId(null)
    }
  }

  async function onToggle() {
    setToggleErr('')
    const next = !data.enabled
    if (next && toggleReason.trim().length < 5) { setToggleErr('Give a reason of at least 5 characters.'); return }
    setToggleBusy(true)
    try {
      await setDualControl(next, toggleReason.trim() || null)
      setToggleOpen(false)
      setToggleReason('')
      setFlash({ tone: 'good', text: next ? 'Dual control is on.' : 'Dual control is off.' })
      await load()
    } catch (e) {
      setToggleErr(toUserMessage(e, 'Could not change dual control.'))
    } finally {
      setToggleBusy(false)
    }
  }

  const canEnable = data.activeSuperAdmins >= 2

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-gray-100 flex items-center gap-2">
            <ShieldCheck size={20} className="text-orange-400" /> Approvals
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Four-eyes control for data cleanup, backup restore and bulk role changes. A second super admin must approve before these run, and nobody can approve their own request.
          </p>
        </div>
        <Toolbar>
          <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
          <Btn variant="primary" icon={Plus} onClick={() => { setRequestAction(null); setRequestOpen(true) }}>Request approval</Btn>
        </Toolbar>
      </header>

      {flash && <Note tone={flash.tone === 'danger' ? 'danger' : 'accent'} icon={flash.tone === 'danger' ? AlertTriangle : CheckCircle2}>{flash.text}</Note>}
      <ErrorState message={error} onRetry={load} />

      <Panel tone={data.enabled ? 'accent' : 'warning'}>
        <PanelHeader icon={data.enabled ? Lock : Unlock}
          title={data.enabled ? 'Dual control is ON' : 'Dual control is OFF'}
          subtitle={data.enabled
            ? 'Data cleanup, backup restore and bulk role changes need a second super admin to approve first.'
            : 'These actions run on one super admin\'s say-so. Nothing is gated until you turn this on.'}
          tone={data.enabled ? 'default' : 'warning'}
          actions={<>
            <Btn variant={data.enabled ? 'danger' : 'primary'} icon={Power}
              disabled={!data.enabled && !canEnable}
              title={!data.enabled && !canEnable ? 'Needs at least two active super admins' : undefined}
              onClick={() => { setToggleErr(''); setToggleOpen(true) }}>
              {data.enabled ? 'Turn off' : 'Turn on'}
            </Btn>
          </>} />
        <div className="space-y-2">
          <Note icon={Users}>Active super admins: <strong className="text-gray-200">{data.activeSuperAdmins}</strong>.{' '}
            {canEnable ? 'Enough for four-eyes approval.' : 'Dual control needs at least two, so it cannot be switched on yet.'}</Note>
          {data.enabled && (
            <Note icon={AlertTriangle} tone="warning">
              Turning it off also needs an approved request from a second super admin, so one person cannot quietly remove the control.
              If you are the only active super admin left, the server lets you turn it off so you are never locked out.
              {!hasOpenDisable && (
                <span className="ml-1"><button className="underline text-orange-300 hover:text-orange-200"
                  onClick={() => { setRequestAction('dual_control_disable'); setRequestOpen(true) }}>Ask to turn it off</button>.</span>
              )}
            </Note>
          )}
        </div>
      </Panel>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile icon={Hourglass} label="Waiting for you" value={loading ? '...' : summary.awaitingMe}
          tone={summary.awaitingMe ? 'warning' : 'default'} sub="Other people's requests" onClick={() => setTab('open')} />
        <StatTile icon={UserCheck} label="Ready to run" value={loading ? '...' : summary.readyToRun}
          tone={summary.readyToRun ? 'good' : 'default'} sub="Your approved requests" onClick={() => setTab('open')} />
        <StatTile icon={Clock} label="Pending" value={loading ? '...' : summary.pending} sub="All waiting requests" />
        <StatTile icon={CheckCircle2} label="Used" value={loading ? '...' : summary.executed} sub="Approved and run" onClick={() => setTab('decided')} />
        <StatTile icon={XCircle} label="Rejected" value={loading ? '...' : summary.rejected}
          tone={summary.rejected ? 'danger' : 'default'} sub="Refused by a second admin" onClick={() => setTab('decided')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader icon={History} title="Requests per day" subtitle="Last 30 days" />
          <TrendChart labels={trend.labels} series={[{ label: 'Requests', values: trend.values }]} height={200}
            summary={`${trend.total} requests in the last 30 days`} emptyText="No approval requests in the last 30 days." />
        </Panel>
        <Panel>
          <PanelHeader icon={ShieldCheck} title="By outcome" />
          <ShareChart parts={statusParts} height={150} summary="Requests by outcome"
            center={{ value: summary.total, label: 'requests' }} emptyText="No requests yet." />
        </Panel>
      </div>
      {actionBars.length > 0 && (
        <Panel>
          <PanelHeader icon={FileSignature} title="By action" subtitle="Which destructive actions people ask to run" />
          <BarsChart bars={actionBars} summary="Requests per action" />
        </Panel>
      )}

      <Panel flush>
        <div className="p-4 pb-3">
          <Segmented value={tab} onChange={setTab} ariaLabel="Approval view" options={[
            { key: 'open', label: 'Open', count: summary.pending + summary.approved },
            { key: 'decided', label: 'Decided', count: summary.total - summary.pending - summary.approved },
            { key: 'all', label: 'All', count: summary.total },
          ]} />
        </div>
        {loading ? <div className="px-4 pb-4"><LoadingState label="Loading approvals" /></div>
          : shown.length === 0 ? (
            <EmptyState icon={ShieldCheck}
              title={tab === 'open' ? 'Nothing waiting' : 'No decided requests'}
              reason={error ? 'The list could not be loaded, so this may not be complete.'
                : tab === 'open' ? 'No request is waiting for a decision or ready to run.'
                  : 'No request has been approved, rejected, used or expired yet.'} />
          ) : (
            <Table className="border-0 rounded-none border-t">
              <THead>
                <Th>Action</Th><Th>Details</Th><Th>Asked by</Th><Th>Asked</Th><Th>Status</Th><Th>Decided by</Th><Th align="right">Actions</Th>
              </THead>
              <tbody>
                {shown.map((r) => {
                  const meta = STATUS_META[r.status] || { label: r.status, tone: 'default' }
                  return (
                    <Tr key={r.id} tone={canDecide(r) ? 'warning' : undefined}>
                      <Td nowrap><span className="text-gray-200">{APPROVAL_ACTIONS[r.action]?.label || r.action}</span></Td>
                      <Td>
                        <p className="text-gray-300">{describePayload(r.action, r.payload)}</p>
                        <p className="text-gray-500 mt-0.5">{r.reason}</p>
                        {r.decision_note && <p className="text-gray-500 mt-0.5">Note: {r.decision_note}</p>}
                      </Td>
                      <Td nowrap>{r.requested_by_name || 'N/A'}{r.is_mine && <Badge tone="quiet">You</Badge>}</Td>
                      <Td nowrap><span className="text-gray-400">{fmtWhen(r.requested_at)}</span></Td>
                      <Td nowrap>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {(r.status === 'pending' || r.status === 'approved') && (
                          <p className="text-[11px] text-gray-500 mt-0.5">{timeLeft(r.expires_at)}</p>
                        )}
                      </Td>
                      <Td nowrap><span className="text-gray-400">{r.decided_by_name || 'N/A'}</span></Td>
                      <Td align="right" nowrap>
                        <div className="inline-flex gap-1.5">
                          {canDecide(r) && <>
                            <Btn size="xs" variant="good" icon={CheckCircle2} onClick={() => setDecide({ row: r, approve: true })}>Approve</Btn>
                            <Btn size="xs" variant="danger" icon={XCircle} onClick={() => setDecide({ row: r, approve: false })}>Reject</Btn>
                          </>}
                          {r.status === 'pending' && r.is_mine && <span className="text-[11px] text-gray-500 self-center">Needs another admin</span>}
                          {canCancel(r) && (
                            <Btn size="xs" icon={Ban} busy={busyId === r.id} onClick={() => onCancel(r)}>Withdraw</Btn>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          )}
      </Panel>

      <RequestModal open={requestOpen} forcedAction={requestAction}
        onClose={() => setRequestOpen(false)}
        onDone={() => { setFlash({ tone: 'good', text: 'Request sent. The other super admins have been notified.' }); load() }} />
      <DecideModal row={decide?.row || null} approve={!!decide?.approve} onClose={() => setDecide(null)}
        onDone={() => { setFlash({ tone: 'good', text: decide?.approve ? 'Approved. The requester can run it once within 24 hours.' : 'Rejected.' }); load() }} />

      <Modal open={toggleOpen} onClose={() => setToggleOpen(false)} width="max-w-lg"
        title={data.enabled ? 'Turn dual control off' : 'Turn dual control on'}
        footer={<>
          <Btn onClick={() => setToggleOpen(false)}>Cancel</Btn>
          <Btn variant={data.enabled ? 'danger' : 'primary'} icon={Power} busy={toggleBusy} onClick={onToggle}>
            {data.enabled ? 'Turn off' : 'Turn on'}
          </Btn>
        </>}>
        <div className="space-y-3 text-xs">
          {data.enabled ? (
            <Note icon={AlertTriangle} tone="danger">
              Data cleanup, backup restore and bulk role changes will run on one super admin&apos;s say-so again.
              This needs an approved request from a second super admin, unless you are the only active super admin left.
            </Note>
          ) : (
            <Note icon={AlertTriangle} tone="warning">
              From now on, data cleanup, backup restore and bulk role changes will be refused until a second super admin
              approves each one. Make sure another super admin is reachable before you switch this on.
            </Note>
          )}
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">Reason{data.enabled ? ' (optional)' : ''}</span>
            <textarea rows={3} value={toggleReason} onChange={(e) => setToggleReason(e.target.value)} className={inputCls} />
          </label>
          <ErrorState message={toggleErr} />
        </div>
      </Modal>
    </div>
  )
}
