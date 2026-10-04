/**
 * ConsoleAccountDeletions - admin queue for account and data deletion requests
 * (V317 table `account_deletion_requests`). Also the "Account deletions" tab of
 * Users (tabParam="dtab"), where it renders a compact section header.
 *
 * Users file a self-service "Delete my account" request from the app; an
 * Admin or super admin works the queue here: filter by status, see when each
 * request is due (30 days from the request, the privacy-law clock), and move
 * it pending -> processing -> completed / rejected.
 *
 * IMPORTANT: this RECORDS the resolution status only. It does NOT itself delete
 * auth, user or business data; actual deletion stays a verified, human-driven
 * back-office process. Completing or rejecting needs a reason and a typed
 * confirmation; the reason goes to the console audit log (the V317 table has
 * no note column). Emails are masked on screen and in exports.
 *
 * The whole queue is read once and the status filter narrows it on screen, so
 * the tiles always count the WHOLE queue, never the filtered view.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  UserX, Mail, Clock, Play, CheckCircle2, XCircle, Inbox, Info, FileSpreadsheet, FileText, BarChart3, Timer, CalendarClock,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, ProportionBar, Badge, Btn, Segmented, SearchInput, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, ConfirmImpactDialog,
} from '../components/ui'
import { TrendChart } from '../components/ui/charts'
import { dailySeries } from '../../lib/consoleCharts'
import {
  listDeletionRequests, setDeletionRequestStatus, DELETION_STATUSES,
} from '../../lib/api/accountDeletion'
import { toUserMessage } from '../../lib/safeError'
import { exportConsoleRows, sortRows, useTableSort } from '../../lib/consoleTable'
import { maskEmail } from '../../lib/consolePlatform'
import { deletionAgeing, daysSince } from '../../lib/consolePeopleControls'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { useUrlTab, useRefreshStamp, usePaged, Pager, Drawer, DetailList, AttentionList } from './shared/pageKit'
import { SectionTop, ImpactLine, isEmbedded } from './platform/SectionKit'

const STATUS_META = {
  pending:    { label: 'Pending',    tone: 'warning' },
  processing: { label: 'Processing', tone: 'info' },
  completed:  { label: 'Completed',  tone: 'good' },
  rejected:   { label: 'Rejected',   tone: 'danger' },
}

const TREND_DAYS = 30
const OVERDUE_DAYS = 30
const TABS = ['queue', 'insights']

const fmtDateTime = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

const shownEmail = (e) => maskEmail(e) || (e ? 'Hidden' : 'N/A')
const isOpen = (r) => r.status === 'pending' || r.status === 'processing'

/** Days left before the request passes the 30 day clock (negative = overdue), null when unknown. */
function daysLeft(r) {
  const age = daysSince(r.requested_at)
  return age === null ? null : OVERDUE_DAYS - age
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status]
  return <Badge tone={meta?.tone || 'quiet'}>{meta?.label || status || 'N/A'}</Badge>
}

function DueBadge({ row }) {
  if (!isOpen(row)) return <span className="text-[11px] text-gray-500">Closed</span>
  const left = daysLeft(row)
  if (left === null) return <span className="text-[11px] text-gray-500">N/A</span>
  if (left < 0) return <Badge tone="danger">{-left}d overdue</Badge>
  return <Badge tone={left <= 7 ? 'warning' : 'default'}>{left}d left</Badge>
}

const CONFIRM = {
  processing: {
    title: 'Start processing this request?', label: 'Start processing', danger: false, reason: false,
    impact: (who) => ({ what: `Mark the request from ${who} as being worked on.`, change: 'The status becomes Processing so other admins know someone owns it.', who: 'Nobody loses access. The account stays active.', undo: 'The status can be moved on at any time.' }),
  },
  completed: {
    title: 'Mark this request completed?', label: 'Mark completed', danger: true, reason: true, typed: 'COMPLETE',
    impact: (who) => ({ tone: 'warning', what: `Record that the account and data of ${who} have been deleted.`, change: 'The status becomes Completed. Nothing is deleted by this button: do the verified deletion first.', who: 'The requester. The record says their data is gone.', undo: 'The record can be corrected, but treat Completed as final.' }),
  },
  rejected: {
    title: 'Reject this request?', label: 'Reject request', danger: true, reason: true, typed: 'REJECT',
    impact: (who) => ({ tone: 'danger', what: `Refuse the deletion request from ${who}.`, change: 'The status becomes Rejected and the account stays active.', who: 'The requester. Tell them why, outside this screen.', undo: 'The record can be corrected later.' }),
  },
}

export default function ConsoleAccountDeletions({ tabParam = 'tab' } = {}) {
  const embedded = isEmbedded(tabParam)
  const { logAction } = useConsoleAuth()
  const [rows, setRows]         = useState([])
  const [filter, setFilter]     = useState('all')
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')      // the queue could not be read
  const [actionError, setActionError] = useState('') // a status change failed
  const [exporting, setExporting] = useState('')
  const { sort, onSort } = useTableSort({ key: 'requested_at', dir: 'desc' })
  const [busyId, setBusyId]     = useState(null)   // row being advanced
  const [confirm, setConfirm]   = useState(null)   // { ids, status, email }
  const [detail, setDetail]     = useState(null)   // row open in the side drawer
  const [flash, setFlash]       = useState('')
  const [tab, setTab] = useUrlTab(TABS, 'queue', tabParam)
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
  const ageing = useMemo(() => deletionAgeing(rows, OVERDUE_DAYS), [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === 'overdue') { if (!isOpen(r) || (daysLeft(r) ?? 1) >= 0) return false }
      else if (filter !== 'all' && r.status !== filter) return false
      if (!q) return true
      return `${r.email || ''} ${r.reason || ''}`.toLowerCase().includes(q)
    })
  }, [rows, filter, search])
  const sorted = useMemo(() => sortRows(visible, sort, { due: (r) => (isOpen(r) ? daysLeft(r) : null) }), [visible, sort])
  const na = loading || !!error

  const trend = useMemo(() => dailySeries(rows, (r) => r.requested_at, TREND_DAYS), [rows])

  async function advance({ ids, status }, reason) {
    setBusyId(ids.length === 1 ? ids[0] : 'bulk'); setActionError('')
    let done = 0
    try {
      for (const id of ids) {
        const updated = await setDeletionRequestStatus(id, status)
        done += 1
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)))
        setDetail((d) => (d && d.id === id ? { ...d, ...updated } : d))
        await logAction?.(`deletion_request_${status}`, id, 'account_deletion_request', { reason: reason || null })
      }
      setFlash(`${done} request${done === 1 ? '' : 's'} set to ${STATUS_META[status]?.label}.`)
      setConfirm(null)
    } catch (e) {
      setActionError(`${done ? `${done} updated before a failure. ` : ''}${toUserMessage(e, 'Could not update the request.')}`)
    } finally {
      setBusyId(null)
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
          { key: 'email', header: 'Requester (masked)', value: (r) => shownEmail(r.email) },
          { key: 'reason', header: 'Reason' },
          { key: 'requested_at', header: 'Requested', value: (r) => fmtDateTime(r.requested_at) },
          { key: 'due', header: 'Due', value: (r) => { const l = daysLeft(r); return !isOpen(r) ? 'Closed' : l === null ? 'N/A' : l < 0 ? `${-l} days overdue` : `${l} days left` } },
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
    { key: 'overdue', label: 'Overdue', count: na ? null : ageing.breaching },
  ]
  const paged = usePaged(sorted, 25, `${filter}|${search}|${sort?.key}|${sort?.dir}`)
  const pendingIds = rows.filter((r) => r.status === 'pending').map((r) => r.id)

  const attention = useMemo(() => {
    const out = []
    if (ageing.breaching) {
      out.push({
        key: 'overdue', tone: 'danger',
        title: `${ageing.breaching} open request${ageing.breaching === 1 ? ' is' : 's are'} past ${OVERDUE_DAYS} days`,
        detail: 'Privacy rules usually expect a deletion request to be answered within a month. Start with the oldest.',
        action: { label: 'Show overdue', onClick: () => { setFilter('overdue'); setTab('queue') } },
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
  }, [ageing.breaching, counts.pending, setTab])

  const exportActions = (
    <>
      <Btn icon={FileSpreadsheet} onClick={() => runExport('excel')} busy={exporting === 'excel'} disabled={na || sorted.length === 0}>Excel</Btn>
      <Btn icon={FileText} onClick={() => runExport('pdf')} busy={exporting === 'pdf'} disabled={na || sorted.length === 0}>PDF</Btn>
    </>
  )

  // A confirm opened from the drawer closes the drawer first: two stacked
  // dialogs would both trap focus and both close on one Escape.
  const ask = (c) => { setDetail(null); setFlash(''); setConfirm(c) }

  function rowActions(r) {
    const rowBusy = busyId === r.id
    return (
      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {r.status === 'pending' && (
          <Btn size="xs" icon={Play} busy={rowBusy}
            onClick={() => ask({ ids: [r.id], status: 'processing', email: r.email })}>Start</Btn>
        )}
        {isOpen(r) && (
          <>
            <Btn size="xs" variant="good" icon={CheckCircle2} disabled={rowBusy}
              onClick={() => ask({ ids: [r.id], status: 'completed', email: r.email })}>Complete</Btn>
            <Btn size="xs" variant="danger" icon={XCircle} disabled={rowBusy}
              onClick={() => ask({ ids: [r.id], status: 'rejected', email: r.email })}>Reject</Btn>
          </>
        )}
        {(r.status === 'completed' || r.status === 'rejected') && (
          <span className="text-[11px] text-gray-400">Resolved {fmtDateTime(r.processed_at)}</span>
        )}
      </div>
    )
  }

  const confirmMeta = confirm ? CONFIRM[confirm.status] : null
  const confirmWho = confirm ? (confirm.ids.length > 1 ? `${confirm.ids.length} requesters` : shownEmail(confirm.email)) : ''

  return (
    <div className="space-y-5 max-w-7xl">
      <SectionTop embedded={embedded} icon={UserX} title="Account Deletions"
        purpose="People who asked for their account and data to be deleted. Record who is working each request and how it ended; the deletion itself is a separate verified step."
        actions={exportActions} refreshedAt={refreshedAt} onRefresh={load} refreshing={loading} />

      <ErrorState message={error} onRetry={load} />
      <ErrorState message={actionError} />
      {flash && <Note icon={CheckCircle2} tone="accent">{flash}</Note>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Pending" value={na ? 'N/A' : counts.pending} tone={counts.pending ? 'warning' : 'default'} icon={Inbox}
          onClick={() => { setFilter(filter === 'pending' ? 'all' : 'pending'); setTab('queue') }} active={filter === 'pending'}
          sub={na ? undefined : `${counts.total} on record`} />
        <StatTile label="Processing" value={na ? 'N/A' : counts.processing}
          onClick={() => { setFilter(filter === 'processing' ? 'all' : 'processing'); setTab('queue') }} active={filter === 'processing'} />
        <StatTile label="Completed" value={na ? 'N/A' : counts.completed} tone="good"
          onClick={() => { setFilter(filter === 'completed' ? 'all' : 'completed'); setTab('queue') }} active={filter === 'completed'} />
        <StatTile label="Rejected" value={na ? 'N/A' : counts.rejected} tone={counts.rejected ? 'danger' : 'default'}
          onClick={() => { setFilter(filter === 'rejected' ? 'all' : 'rejected'); setTab('queue') }} active={filter === 'rejected'} />
        <StatTile label="Oldest open" value={na || ageing.oldest == null ? 'N/A' : `${ageing.oldest}d`}
          sub={na ? undefined : ageing.oldest == null ? 'No open request' : `${ageing.breaching} past ${OVERDUE_DAYS} days`}
          tone={ageing.breaching ? 'danger' : 'default'} icon={Clock}
          onClick={() => { setFilter('overdue'); setTab('queue') }} active={filter === 'overdue'} />
        <StatTile label="Median turnaround" value={na || ageing.medianTurnaround == null ? 'N/A' : `${ageing.medianTurnaround}d`}
          sub={na ? undefined : ageing.medianTurnaround == null ? 'No request resolved yet' : 'Request to resolution'} icon={Timer} />
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
              <PanelHeader icon={Inbox} title="Requests" subtitle={na ? undefined : `${visible.length} of ${counts.total} shown. Select a row for the full request.`}
                actions={pendingIds.length > 1 && (
                  <Btn size="xs" icon={Play} busy={busyId === 'bulk'} onClick={() => ask({ ids: pendingIds, status: 'processing', email: null })}>
                    Start all {pendingIds.length} pending
                  </Btn>
                )} />
              <Toolbar>
                <Segmented options={filterOptions} value={filter} onChange={setFilter} ariaLabel="Filter by status" />
                <SearchInput value={search} onChange={setSearch} placeholder="Search email or reason" className="w-full sm:w-64" />
              </Toolbar>
              <ImpactLine change="Each status button records where a request stands. No button here deletes an account."
                who="Admins working the queue see the new status straight away." />
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
                    <Th sortKey="due" sort={sort} onSort={onSort}>Due</Th>
                    <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
                    <Th align="right">Actions</Th>
                  </THead>
                  <tbody>
                    {paged.pageRows.map((r) => (
                      <Tr key={r.id} onClick={() => setDetail(r)} ariaLabel={`Open request from ${shownEmail(r.email)}`}>
                        <Td>
                          <span className="flex items-center gap-1.5 text-gray-200 font-medium">
                            <Mail size={11} className="text-gray-500 shrink-0" aria-hidden="true" />
                            {shownEmail(r.email)}
                          </span>
                        </Td>
                        <Td className="text-gray-300 max-w-[260px] truncate"><span title={r.reason || ''}>{r.reason || 'N/A'}</span></Td>
                        <Td nowrap className="text-gray-400">{fmtDateTime(r.requested_at)}</Td>
                        <Td nowrap><DueBadge row={r} /></Td>
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
              The reason you give is written to the console audit log, because the request table has no note column.
            </Note>
          </div>
        </div>
      )}

      <Drawer open={!!detail} title={detail ? shownEmail(detail.email) : 'Deletion request'} subtitle="Account deletion request"
        onClose={() => setDetail(null)} footer={detail ? rowActions(detail) : null}>
        {detail && (
          <>
            <DetailList items={[
              ['Status', <StatusBadge key="s" status={detail.status} />],
              ['Requested', fmtDateTime(detail.requested_at)],
              ['Age', daysSince(detail.requested_at) == null ? null : `${daysSince(detail.requested_at)} days`],
              ['Due', <DueBadge key="d" row={detail} />],
              ['Resolved', detail.processed_at ? fmtDateTime(detail.processed_at) : 'Not yet'],
            ]} />
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Reason given</p>
              <p className="text-xs text-gray-200 whitespace-pre-wrap break-words">{detail.reason || 'No reason given.'}</p>
            </div>
            <Note icon={CalendarClock} tone="accent">Marking a request completed does not delete anything. Delete the account through the verified process first.</Note>
          </>
        )}
      </Drawer>

      <ConfirmImpactDialog
        open={!!confirm}
        title={confirmMeta?.title || ''}
        confirmLabel={confirmMeta?.label || 'Confirm'}
        danger={!!confirmMeta?.danger}
        requireReason={!!confirmMeta?.reason}
        typedWord={confirm && confirm.ids.length > 1 ? 'START' : confirmMeta?.typed}
        busy={busyId != null}
        error={actionError}
        impact={confirmMeta ? confirmMeta.impact(confirmWho) : undefined}
        onCancel={() => { if (busyId == null) setConfirm(null) }}
        onConfirm={({ reason }) => advance(confirm, reason)}
      />
    </div>
  )
}
