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
  UserX, Mail, Clock, Play, CheckCircle2, XCircle, Inbox, Info, FileSpreadsheet, FileText, BarChart3,
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
import { exportConsoleRows, sortRows, useTableSort } from '../../lib/consoleTable'
import {
  PageHeader, useUrlTab, useRefreshStamp, usePaged, Pager, Drawer, DetailList, AttentionList,
} from './accessKit'

const STATUS_META = {
  pending:    { label: 'Pending',    tone: 'warning' },
  processing: { label: 'Processing', tone: 'info' },
  completed:  { label: 'Completed',  tone: 'good' },
  rejected:   { label: 'Rejected',   tone: 'danger' },
}

const TREND_DAYS = 30
const OVERDUE_DAYS = 30
const TABS = ['queue', 'insights']

const ageDays = (v) => {
  const t = Date.parse(v)
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null
}

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
  const [error, setError]       = useState('')      // the queue could not be read
  const [actionError, setActionError] = useState('') // a status change failed
  const [exporting, setExporting] = useState('')
  const { sort, onSort } = useTableSort({ key: 'requested_at', dir: 'desc' })
  const [busyId, setBusyId]     = useState(null)   // row being advanced
  const [confirm, setConfirm]   = useState(null)   // { id, status, email }
  const [detail, setDetail]     = useState(null)   // row open in the side drawer
  const [tab, setTab] = useUrlTab(TABS, 'queue')
  const { refreshedAt, stamp } = useRefreshStamp()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await listDeletionRequests({})
      setRows(Array.isArray(data) ? data : [])
      stamp()
    } catch (e) {
      setRows([])
      setError(toUserMessage(e, 'Could not load deletion requests.'))
    } finally {
      setLoading(false)
    }
  }, [stamp])

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
  const sorted = useMemo(() => sortRows(visible, sort), [visible, sort])
  const na = loading || !!error

  const trend = useMemo(() => dailySeries(rows, (r) => r.requested_at, TREND_DAYS), [rows])

  const oldestOpen = useMemo(() => {
    const open = rows.filter((r) => r.status === 'pending' || r.status === 'processing')
      .map((r) => new Date(r.requested_at).getTime()).filter((t) => Number.isFinite(t))
    if (!open.length) return null
    return Math.floor((Date.now() - Math.min(...open)) / 86400000)
  }, [rows])

  async function advance(id, status) {
    setBusyId(id); setActionError('')
    try {
      const updated = await setDeletionRequestStatus(id, status)
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)))
      setDetail((d) => (d && d.id === id ? { ...d, ...updated } : d))
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not update the request.'))
    } finally {
      setBusyId(null); setConfirm(null)
    }
  }

  async function runExport(format) {
    setExporting(format); setActionError('')
    try {
      await exportConsoleRows({
        rows: sorted,
        title: 'Account Deletion Requests',
        format,
        columns: [
          { key: 'email', header: 'Requester' },
          { key: 'reason', header: 'Reason' },
          { key: 'requested_at', header: 'Requested', value: (r) => fmtDateTime(r.requested_at) },
          { key: 'status', header: 'Status', value: (r) => STATUS_META[r.status]?.label || r.status },
          { key: 'processed_at', header: 'Resolved', value: (r) => (r.processed_at ? fmtDateTime(r.processed_at) : '') },
        ],
      })
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not create the export file.'))
    } finally {
      setExporting('')
    }
  }

  const filterOptions = [
    { key: 'all', label: 'All', count: na ? null : counts.total },
    ...DELETION_STATUSES.map((s) => ({ key: s, label: STATUS_META[s]?.label || s, count: na ? null : counts[s] })),
  ]
  const paged = usePaged(sorted, 25, `${filter}|${search}|${sort?.key}|${sort?.dir}`)

  const overdue = useMemo(() => rows.filter((r) => (r.status === 'pending' || r.status === 'processing')
    && (ageDays(r.requested_at) ?? 0) > OVERDUE_DAYS), [rows])
  const attention = useMemo(() => {
    const out = []
    if (overdue.length) {
      out.push({
        key: 'overdue', tone: 'danger',
        title: `${overdue.length} open request${overdue.length === 1 ? ' is' : 's are'} older than ${OVERDUE_DAYS} days`,
        detail: 'Deletion requests should be resolved promptly. Start with the oldest.',
        action: { label: 'Show open', onClick: () => { setFilter('pending'); setTab('queue') } },
      })
    }
    if (counts.pending) {
      out.push({
        key: 'pending', tone: 'warning',
        title: `${counts.pending} request${counts.pending === 1 ? '' : 's'} not started`,
        detail: 'Nobody has picked these up yet.',
        action: { label: 'Show pending', onClick: () => { setFilter('pending'); setTab('queue') } },
      })
    }
    return out
  }, [overdue, counts.pending, setTab])

  const exportActions = (
    <>
      <Btn icon={FileSpreadsheet} onClick={() => runExport('excel')} busy={exporting === 'excel'} disabled={na || sorted.length === 0}>Excel</Btn>
      <Btn icon={FileText} onClick={() => runExport('pdf')} busy={exporting === 'pdf'} disabled={na || sorted.length === 0}>PDF</Btn>
    </>
  )

  // A confirm opened from the drawer closes the drawer first: two stacked
  // dialogs would both trap focus and both close on one Escape.
  const ask = (c) => { setDetail(null); setConfirm(c) }

  function rowActions(r) {
    const rowBusy = busyId === r.id
    return (
      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {r.status === 'pending' && (
          <Btn size="xs" icon={Play} busy={rowBusy}
            onClick={() => ask({ id: r.id, status: 'processing', email: r.email })}>Start</Btn>
        )}
        {(r.status === 'pending' || r.status === 'processing') && (
          <>
            <Btn size="xs" variant="good" icon={CheckCircle2} disabled={rowBusy}
              onClick={() => ask({ id: r.id, status: 'completed', email: r.email })}>Complete</Btn>
            <Btn size="xs" variant="danger" icon={XCircle} disabled={rowBusy}
              onClick={() => ask({ id: r.id, status: 'rejected', email: r.email })}>Reject</Btn>
          </>
        )}
        {(r.status === 'completed' || r.status === 'rejected') && (
          <span className="text-[11px] text-gray-400">Resolved {fmtDateTime(r.processed_at)}</span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={UserX} title="Account Deletions"
        purpose="Work the account and data deletion request queue for your organisation."
        actions={exportActions} refreshedAt={refreshedAt} onRefresh={load} refreshing={loading} />

      <ErrorState message={error} onRetry={load} />
      <ErrorState message={actionError} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile label="Pending" value={na ? 'N/A' : counts.pending} tone={counts.pending ? 'warning' : 'default'} icon={Inbox}
          onClick={() => { setFilter(filter === 'pending' ? 'all' : 'pending'); setTab('queue') }} active={filter === 'pending'}
          sub={na ? undefined : `${counts.total} on record`} />
        <StatTile label="Processing" value={na ? 'N/A' : counts.processing}
          onClick={() => { setFilter(filter === 'processing' ? 'all' : 'processing'); setTab('queue') }} active={filter === 'processing'} />
        <StatTile label="Completed" value={na ? 'N/A' : counts.completed} tone="good"
          onClick={() => { setFilter(filter === 'completed' ? 'all' : 'completed'); setTab('queue') }} active={filter === 'completed'} />
        <StatTile label="Rejected" value={na ? 'N/A' : counts.rejected} tone={counts.rejected ? 'danger' : 'default'}
          onClick={() => { setFilter(filter === 'rejected' ? 'all' : 'rejected'); setTab('queue') }} active={filter === 'rejected'} />
        <StatTile label="Oldest open" value={na || oldestOpen == null ? 'N/A' : `${oldestOpen}d`}
          sub="Days since the oldest open request" tone={oldestOpen != null && oldestOpen > OVERDUE_DAYS ? 'danger' : 'default'} icon={Clock} />
      </div>

      <Segmented ariaLabel="Account deletion views" value={tab} onChange={setTab} options={[
        { key: 'queue', label: 'Queue', count: na ? null : counts.pending + counts.processing },
        { key: 'insights', label: 'Insights' },
      ]} />

      {tab === 'queue' && (
        <div role="tabpanel" aria-label="Queue" className="space-y-4">
          <AttentionList ready={!na} items={attention} clearText="No open request is waiting or overdue." />
          <Panel flush>
            <div className="p-4 pb-3 space-y-3">
              <PanelHeader icon={Inbox} title="Requests" subtitle={na ? undefined : `${visible.length} of ${counts.total} shown. Select a row for the full request.`} />
              <Toolbar>
                <Segmented options={filterOptions} value={filter} onChange={setFilter} ariaLabel="Filter by status" />
                <SearchInput value={search} onChange={setSearch} placeholder="Search email or reason" className="w-64" />
              </Toolbar>
            </div>
            {loading ? <div className="px-4"><LoadingState label="Loading requests" /></div> : error ? (
              <EmptyState title="Queue unavailable" reason="The deletion request queue could not be read. Use Retry above." />
            ) : visible.length === 0 ? (
              <EmptyState
                title={rows.length === 0 ? 'No deletion requests' : 'No requests match'}
                reason={rows.length === 0
                  ? 'No user has filed an account deletion request.'
                  : 'Nothing matches the current status filter and search.'} />
            ) : (
              <>
                <Table className="border-0 rounded-none">
                  <THead>
                    <Th sortKey="email" sort={sort} onSort={onSort}>Requester</Th>
                    <Th sortKey="reason" sort={sort} onSort={onSort}>Reason</Th>
                    <Th sortKey="requested_at" sort={sort} onSort={onSort}>Requested</Th>
                    <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
                    <Th align="right">Actions</Th>
                  </THead>
                  <tbody>
                    {paged.pageRows.map((r) => (
                      <Tr key={r.id} onClick={() => setDetail(r)} ariaLabel={`Open request from ${r.email || 'unknown requester'}`}>
                        <Td>
                          <span className="flex items-center gap-1.5 text-gray-200 font-medium">
                            <Mail size={11} className="text-gray-500 shrink-0" aria-hidden="true" />
                            {r.email || 'N/A'}
                          </span>
                        </Td>
                        <Td className="text-gray-300 max-w-[260px] truncate"><span title={r.reason || ''}>{r.reason || 'N/A'}</span></Td>
                        <Td nowrap className="text-gray-400">{fmtDateTime(r.requested_at)}</Td>
                        <Td><StatusBadge status={r.status} /></Td>
                        <Td align="right">{rowActions(r)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <Pager {...paged} onPage={paged.setPage} />
              </>
            )}
          </Panel>
        </div>
      )}

      {tab === 'insights' && (
        <div role="tabpanel" aria-label="Insights" className="grid gap-4 lg:grid-cols-3">
          <Panel className="lg:col-span-2">
            <PanelHeader icon={BarChart3} title="Requests raised per day"
              subtitle={na ? 'N/A' : `Last ${TREND_DAYS} days, ${trend.total} request${trend.total === 1 ? '' : 's'} in the window`} />
            {loading ? <LoadingState rows={3} /> : error ? (
              <EmptyState title="Not available" reason="The queue could not be read, so no trend is shown." />
            ) : (
              <TrendChart labels={trend.labels} series={[{ label: 'Requests', values: trend.values }]} height={180}
                summary={`${trend.total} deletion requests raised in the last ${TREND_DAYS} days`}
                emptyText="No deletion requests raised in the last 30 days." />
            )}
          </Panel>
          <Panel>
            <PanelHeader icon={Inbox} title="Queue by status" subtitle="Share of every request on record" />
            {loading ? <LoadingState rows={2} /> : error ? (
              <EmptyState title="Not available" reason="The queue could not be read." />
            ) : counts.total === 0 ? (
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
          <div className="lg:col-span-3">
            <Note icon={Info} tone="accent">
              Advancing a request records its resolution status only. Actual account and data deletion remains a verified, manual back-office step.
            </Note>
          </div>
        </div>
      )}

      <Drawer open={!!detail} title={detail?.email || 'Deletion request'} subtitle="Account deletion request"
        onClose={() => setDetail(null)} footer={detail ? rowActions(detail) : null}>
        {detail && (
          <>
            <DetailList items={[
              ['Status', <StatusBadge key="s" status={detail.status} />],
              ['Requested', fmtDateTime(detail.requested_at)],
              ['Age', ageDays(detail.requested_at) == null ? null : `${ageDays(detail.requested_at)} days`],
              ['Resolved', detail.processed_at ? fmtDateTime(detail.processed_at) : 'Not yet'],
            ]} />
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Reason given</p>
              <p className="text-xs text-gray-200 whitespace-pre-wrap break-words">{detail.reason || 'No reason given.'}</p>
            </div>
            <Note icon={Info} tone="accent">Marking a request completed does not delete anything. Delete the account through the verified process first.</Note>
          </>
        )}
      </Drawer>

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
