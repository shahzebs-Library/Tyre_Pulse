/**
 * ConsoleAccountDeletions - admin queue for account & data deletion requests
 * (V317 table `account_deletion_requests`).
 *
 * Users file a self-service "Delete my account" request from the app; an
 * Admin / super-admin works the queue here: filter by status, review the
 * requester email + reason + when it was raised, and advance each request
 * pending -> processing -> completed / rejected.
 *
 * IMPORTANT: this RECORDS the resolution status only. It does NOT itself delete
 * auth/user/business data - actual deletion stays a verified, human-driven
 * back-office process. RLS (V317) restricts every read/update to Admin/super
 * within their own organisation. No raw Supabase errors reach the UI; no
 * em/en dashes.
 *
 * The whole queue is read once and the status filter narrows it on screen, so
 * the tiles always count the WHOLE queue. Previously the read itself was
 * filtered, so picking "Completed" made the Pending tile read 0 while pending
 * requests were still waiting: a zero that described the filter, not the queue.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  UserX, RefreshCw, Mail, Clock, Play, CheckCircle2, XCircle, Inbox, Info,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, ProportionBar, Badge, Btn, Segmented, SearchInput, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { TrendChart } from '../components/ui/charts'
import { dailySeries } from '../../lib/consoleCharts'
import {
  listDeletionRequests, setDeletionRequestStatus, DELETION_STATUSES,
} from '../../lib/api/accountDeletion'
import { toUserMessage } from '../../lib/safeError'

const STATUS_META = {
  pending:    { label: 'Pending',    tone: 'warning' },
  processing: { label: 'Processing', tone: 'info' },
  completed:  { label: 'Completed',  tone: 'good' },
  rejected:   { label: 'Rejected',   tone: 'danger' },
}

const TREND_DAYS = 30

const fmtDateTime = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status]
  return <Badge tone={meta?.tone || 'quiet'}>{meta?.label || status || 'N/A'}</Badge>
}

const CONFIRM_TITLE = {
  processing: 'Start processing?',
  completed: 'Mark completed?',
  rejected: 'Reject request?',
}

export default function ConsoleAccountDeletions() {
  const [rows, setRows]         = useState([])
  const [filter, setFilter]     = useState('all')
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [busyId, setBusyId]     = useState(null)   // row being advanced
  const [confirm, setConfirm]   = useState(null)   // { id, status, email }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await listDeletionRequests({})
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(toUserMessage(e, 'Could not load deletion requests.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const c = { total: rows.length, pending: 0, processing: 0, completed: 0, rejected: 0 }
    rows.forEach((r) => { if (c[r.status] != null) c[r.status] += 1 })
    return c
  }, [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter !== 'all' && r.status !== filter) return false
      if (!q) return true
      return `${r.email || ''} ${r.reason || ''}`.toLowerCase().includes(q)
    })
  }, [rows, filter, search])

  const trend = useMemo(() => dailySeries(rows, (r) => r.requested_at, TREND_DAYS), [rows])

  const oldestOpen = useMemo(() => {
    const open = rows.filter((r) => r.status === 'pending' || r.status === 'processing')
      .map((r) => new Date(r.requested_at).getTime()).filter((t) => Number.isFinite(t))
    if (!open.length) return null
    return Math.floor((Date.now() - Math.min(...open)) / 86400000)
  }, [rows])

  async function advance(id, status) {
    setBusyId(id); setError('')
    try {
      const updated = await setDeletionRequestStatus(id, status)
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)))
    } catch (e) {
      setError(toUserMessage(e, 'Could not update the request.'))
    } finally {
      setBusyId(null); setConfirm(null)
    }
  }

  const filterOptions = [
    { key: 'all', label: 'All', count: counts.total },
    ...DELETION_STATUSES.map((s) => ({ key: s, label: STATUS_META[s]?.label || s, count: counts[s] })),
  ]

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2"><UserX size={18} className="text-orange-400" /> Account Deletions</h1>
          <p className="text-xs text-gray-500 mt-1">Work the account and data deletion request queue for your organisation.</p>
        </div>
        <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
      </header>

      <Note icon={Info} tone="accent">
        Advancing a request records its resolution status only. Actual account and data deletion remains a verified, manual back-office step.
      </Note>

      <ErrorState message={error} onRetry={load} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Total" value={loading ? 'N/A' : counts.total} icon={Inbox} />
        <StatTile label="Pending" value={loading ? 'N/A' : counts.pending} tone={counts.pending ? 'warning' : 'default'}
          onClick={() => setFilter('pending')} active={filter === 'pending'} />
        <StatTile label="Processing" value={loading ? 'N/A' : counts.processing}
          onClick={() => setFilter('processing')} active={filter === 'processing'} />
        <StatTile label="Completed" value={loading ? 'N/A' : counts.completed} tone="good"
          onClick={() => setFilter('completed')} active={filter === 'completed'} />
        <StatTile label="Rejected" value={loading ? 'N/A' : counts.rejected} tone={counts.rejected ? 'danger' : 'default'}
          onClick={() => setFilter('rejected')} active={filter === 'rejected'} />
        <StatTile label="Oldest open" value={loading || oldestOpen == null ? 'N/A' : `${oldestOpen}d`}
          sub="Days since the oldest open request" tone={oldestOpen != null && oldestOpen > 30 ? 'danger' : 'default'} icon={Clock} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader icon={Clock} title="Requests raised per day"
            subtitle={`Last ${TREND_DAYS} days, ${trend.total} request${trend.total === 1 ? '' : 's'} in the window`} />
          {loading ? <LoadingState rows={3} /> : (
            <TrendChart labels={trend.labels} series={[{ label: 'Requests', values: trend.values }]} height={180}
              summary={`${trend.total} deletion requests raised in the last ${TREND_DAYS} days`}
              emptyText="No deletion requests raised in the last 30 days." />
          )}
        </Panel>
        <Panel>
          <PanelHeader icon={Inbox} title="Queue by status" subtitle="Share of every request on record" />
          {loading ? <LoadingState rows={2} /> : counts.total === 0 ? (
            <EmptyState title="No requests" reason="No user has filed a deletion request yet." />
          ) : (
            <div className="space-y-3">
              <ProportionBar total={counts.total} segments={[
                { label: 'Pending', value: counts.pending, tone: 'warning' },
                { label: 'Processing', value: counts.processing, tone: 'accent' },
                { label: 'Completed', value: counts.completed, tone: 'good' },
                { label: 'Rejected', value: counts.rejected, tone: 'danger' },
              ]} />
              <ul className="space-y-1.5 text-xs">
                {DELETION_STATUSES.map((s) => (
                  <li key={s} className="flex items-center justify-between">
                    <StatusBadge status={s} />
                    <span className="tabular-nums text-gray-300">{counts[s]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <Panel flush>
        <div className="p-4 pb-3 space-y-3">
          <PanelHeader icon={Inbox} title="Requests" subtitle={`${visible.length} of ${counts.total} shown`} />
          <Toolbar>
            <Segmented options={filterOptions} value={filter} onChange={setFilter} />
            <SearchInput value={search} onChange={setSearch} placeholder="Search email or reason" className="w-64" />
          </Toolbar>
        </div>
        {loading ? <div className="px-4"><LoadingState label="Loading requests" /></div> : visible.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? 'No deletion requests' : 'No requests match'}
            reason={rows.length === 0
              ? (error ? 'The queue could not be read, so nothing is shown.' : 'No user has filed an account deletion request.')
              : 'Nothing matches the current status filter and search.'} />
        ) : (
          <Table className="border-0 rounded-none">
            <THead>
              <Th>Requester</Th>
              <Th>Reason</Th>
              <Th>Requested</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </THead>
            <tbody>
              {visible.map((r) => {
                const rowBusy = busyId === r.id
                return (
                  <Tr key={r.id}>
                    <Td>
                      <span className="flex items-center gap-1.5 text-gray-200 font-medium">
                        <Mail size={11} className="text-gray-500 shrink-0" />
                        {r.email || 'N/A'}
                      </span>
                    </Td>
                    <Td className="text-gray-400 max-w-[260px] truncate"><span title={r.reason || ''}>{r.reason || 'N/A'}</span></Td>
                    <Td nowrap className="text-gray-400">{fmtDateTime(r.requested_at)}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-1.5">
                        {r.status === 'pending' && (
                          <Btn size="xs" icon={Play} busy={rowBusy}
                            onClick={() => setConfirm({ id: r.id, status: 'processing', email: r.email })}>Start</Btn>
                        )}
                        {(r.status === 'pending' || r.status === 'processing') && (
                          <>
                            <Btn size="xs" variant="good" icon={CheckCircle2} disabled={rowBusy}
                              onClick={() => setConfirm({ id: r.id, status: 'completed', email: r.email })}>Complete</Btn>
                            <Btn size="xs" variant="danger" icon={XCircle} disabled={rowBusy}
                              onClick={() => setConfirm({ id: r.id, status: 'rejected', email: r.email })}>Reject</Btn>
                          </>
                        )}
                        {(r.status === 'completed' || r.status === 'rejected') && (
                          <span className="text-[11px] text-gray-500">Resolved {fmtDateTime(r.processed_at)}</span>
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

      <Modal
        open={!!confirm}
        width="max-w-md"
        title={confirm ? CONFIRM_TITLE[confirm.status] : ''}
        onClose={() => { if (busyId == null) setConfirm(null) }}
        footer={confirm && (
          <>
            <Btn onClick={() => setConfirm(null)} disabled={busyId != null}>Cancel</Btn>
            <Btn variant={confirm.status === 'rejected' ? 'danger' : 'primary'} icon={CheckCircle2}
              busy={busyId != null} onClick={() => advance(confirm.id, confirm.status)}>Confirm</Btn>
          </>
        )}
      >
        {confirm && (
          <p className="text-xs text-gray-400">
            Set the request from <span className="text-gray-200 font-medium">{confirm.email || 'this user'}</span> to
            {' '}<span className="text-gray-200 font-semibold">{STATUS_META[confirm.status]?.label}</span>.
            {confirm.status === 'completed' && ' Confirm the account and its data have been deleted per your process.'}
            {confirm.status === 'rejected' && ' The requester will remain active.'}
          </p>
        )}
      </Modal>
    </div>
  )
}
