/**
 * ConsoleAccessReviews.jsx - periodic access recertification.
 *
 * ISO 27001 A.5.18 / A.8.2 and SOC 2 CC6 evidence: a super admin starts a
 * campaign, which snapshots every approved user's access at that moment, then
 * records keep / revoke / modify per user. Deciding changes nothing on its own;
 * "Apply decisions" locks every user decided revoke, writes an audit row per
 * lock and closes the campaign. The Excel export is the audit evidence.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ClipboardCheck, Play, RefreshCw, FileSpreadsheet, FileText, CheckCircle2, XCircle, PenLine, Clock,
  ArrowLeft, ShieldCheck, Lock, CalendarClock, ListChecks, AlertTriangle, Users, UserX, KeyRound,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { ShareChart, BarsChart, ScoreRing, STATUS, useChartTheme } from '../components/ui/charts'
import {
  listAccessReviews, getAccessReview, startAccessReview, decideAccessItem, bulkDecide, applyAccessReview,
} from '../../lib/api/accessReviews'
import {
  reviewProgress, filterItems, rolesIn, bulkKeepCandidates, dormancy, grantCount,
  evidenceRows, EVIDENCE_COLUMNS, DECISION_LABEL, isOverdue, DORMANT_DAYS,
} from '../../lib/accessReviews'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import { sortRows, useTableSort } from '../../lib/consoleTable'
import {
  PageHeader, useUrlTab, useUrlParam, useRefreshStamp, usePaged, Pager, Drawer, DetailList, AttentionList,
} from './accessKit'

const PAGE = 25
const VIEW_TABS = ['decisions', 'overview']
const DECISION_TONE = { pending: 'quiet', keep: 'good', revoke: 'danger', modify: 'warning' }
const DECISION_ICON = { pending: Clock, keep: CheckCircle2, revoke: XCircle, modify: PenLine }

function fmtDate(v, withTime = false) {
  if (!v) return 'N/A'
  const opts = { day: '2-digit', month: 'short', year: 'numeric' }
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' })
  return new Date(v).toLocaleString('en-GB', opts)
}

function defaultName() {
  const d = new Date()
  const q = Math.floor(d.getMonth() / 3) + 1
  return `Access review Q${q} ${d.getFullYear()}`
}

function defaultDue() {
  const d = new Date(Date.now() + 14 * 86400000)
  return d.toISOString().slice(0, 10)
}

/* ── campaign list ─────────────────────────────────────────────────────────── */

const CAMPAIGN_SORT = {
  status: (c) => (c.status === 'closed' ? 0 : isOverdue(c) ? 2 : 1),
  progress: (c) => {
    const total = Number(c.total) || 0
    return total ? (total - (Number(c.pending) || 0)) / total : null
  },
  total: (c) => Number(c.total) || 0,
  revoked: (c) => Number(c.revoked) || 0,
}

function CampaignList({ campaigns, onOpen }) {
  const { sort, onSort } = useTableSort({ key: 'created_at', dir: 'desc' })
  const sorted = useMemo(() => sortRows(campaigns, sort, CAMPAIGN_SORT), [campaigns, sort])
  const paged = usePaged(sorted, 15, `${sort?.key}|${sort?.dir}`)
  if (!campaigns.length) {
    return (
      <EmptyState icon={ClipboardCheck} title="No access reviews yet"
        reason="Start a campaign to snapshot every approved user's access and record a keep or revoke decision for each one." />
    )
  }
  return (
    <>
    <Table>
      <THead>
        <Th sortKey="name" sort={sort} onSort={onSort}>Campaign</Th>
        <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
        <Th sortKey="created_at" sort={sort} onSort={onSort}>Started</Th>
        <Th sortKey="due_at" sort={sort} onSort={onSort}>Due</Th>
        <Th sortKey="progress" sort={sort} onSort={onSort}>Progress</Th>
        <Th align="right" sortKey="revoked" sort={sort} onSort={onSort}>Revoke</Th>
        <Th align="right" sortKey="total" sort={sort} onSort={onSort}>Users</Th>
      </THead>
      <tbody>
        {paged.pageRows.map((c) => {
          const total = Number(c.total) || 0
          const decided = total - (Number(c.pending) || 0)
          const pct = total ? Math.round((decided / total) * 100) : 0
          const overdue = isOverdue(c)
          return (
            <Tr key={c.id} onClick={() => onOpen(c.id)} ariaLabel={`Open ${c.name}`}>
              <Td>
                <p className="text-gray-200">{c.name}</p>
                <p className="text-[11px] text-gray-400">by {c.created_by_email || 'N/A'}</p>
              </Td>
              <Td>
                {c.status === 'closed'
                  ? <Badge tone="quiet" icon={Lock}>Closed</Badge>
                  : overdue ? <Badge tone="danger" icon={AlertTriangle}>Overdue</Badge>
                    : <Badge tone="info" icon={Clock}>Open</Badge>}
              </Td>
              <Td nowrap>{fmtDate(c.created_at)}</Td>
              <Td nowrap>{fmtDate(c.due_at)}</Td>
              <Td>
                <div className="flex items-center gap-2 min-w-[140px]">
                  <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                    <div className="h-full bg-orange-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="tabular-nums text-gray-400 text-[11px]">{pct}%</span>
                </div>
              </Td>
              <Td align="right"><span className="tabular-nums text-gray-300">{c.revoked ?? 0}</span></Td>
              <Td align="right"><span className="tabular-nums text-gray-300">{total}</span></Td>
            </Tr>
          )
        })}
      </tbody>
    </Table>
    <Pager {...paged} onPage={paged.setPage} />
    </>
  )
}

/* ── one campaign ──────────────────────────────────────────────────────────── */

function CampaignView({ campaignId, onBack, onChanged }) {
  const theme = useChartTheme()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [decision, setDecision] = useState('all')
  const [role, setRole] = useState('')
  const [flag, setFlag] = useState('all')
  const [detail, setDetail] = useState(null)
  const [view, setView] = useUrlTab(VIEW_TABS, 'decisions', 'view')
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [noteFor, setNoteFor] = useState(null) // { item, decision }
  const [note, setNote] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyResult, setApplyResult] = useState(null)
  const [exporting, setExporting] = useState('')
  const { sort, onSort } = useTableSort({ key: 'full_name', dir: 'asc' })

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setData(await getAccessReview(campaignId))
    } catch (e) {
      setError(toUserMessage(e, 'Could not load this access review.'))
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => { load() }, [load])

  const items = useMemo(() => data?.items || [], [data])
  const campaign = data?.campaign
  const closed = campaign?.status === 'closed'
  const progress = useMemo(() => reviewProgress(items), [items])
  const roles = useMemo(() => rolesIn(items), [items])
  const filtered = useMemo(() => sortRows(filterItems(items, { search, decision, role, flag }), sort, {
    grants: grantCount,
    countries: (it) => (it.country || []).join(', '),
    sites: (it) => (it.sites || []).join(', '),
  }), [items, search, decision, role, flag, sort])
  const bulkTargets = useMemo(() => bulkKeepCandidates(filtered), [filtered])
  const dormantCount = useMemo(() => filterItems(items, { flag: 'dormant' }).length, [items])
  const superCount = useMemo(() => filterItems(items, { flag: 'super' }).length, [items])
  const grantsCount = useMemo(() => filterItems(items, { flag: 'grants' }).length, [items])

  const paged = usePaged(filtered, PAGE, `${search}|${decision}|${role}|${flag}|${sort?.key}|${sort?.dir}`)
  const detailItem = detail ? items.find((i) => i.id === detail) : null

  const byRole = useMemo(() => {
    const m = new Map()
    for (const it of items) {
      const k = it.role || 'N/A'
      const cur = m.get(k) || { total: 0, revoke: 0 }
      cur.total += 1
      if (it.decision === 'revoke') cur.revoke += 1
      m.set(k, cur)
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8)
      .map(([label, v]) => ({ label, value: v.total }))
  }, [items])

  function patchItem(id, patch) {
    setData((d) => d ? { ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) } : d)
  }

  async function decide(item, dec, reason = null) {
    setBusyId(item.id); setActionError(null)
    try {
      await decideAccessItem(item.id, dec, reason)
      patchItem(item.id, {
        decision: dec, decision_note: reason || null,
        decided_at: dec === 'pending' ? null : new Date().toISOString(),
      })
      onChanged?.()
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not record that decision.'))
    } finally {
      setBusyId(null)
    }
  }

  function askNote(item, dec) {
    setDetail(null)
    setNote(item.decision === dec ? (item.decision_note || '') : '')
    setNoteFor({ item, decision: dec })
  }

  async function submitNote() {
    if (!noteFor) return
    if (noteFor.decision === 'revoke' && !note.trim()) return
    const { item, decision: dec } = noteFor
    setNoteFor(null)
    await decide(item, dec, note.trim() || null)
  }

  async function runBulkKeep() {
    setBulkBusy(true); setActionError(null); setBulkProgress({ done: 0, total: bulkTargets.length })
    try {
      const res = await bulkDecide(bulkTargets.map((i) => i.id), 'keep', null,
        (done, total) => setBulkProgress({ done, total }))
      if (res.failed) setActionError(`${res.failed} of ${bulkTargets.length} decisions could not be saved. ${toUserMessage(res.errors[0], '')}`)
      await load()
      onChanged?.()
    } catch (e) {
      setActionError(toUserMessage(e, 'The bulk keep could not be completed. Reload to see which decisions were saved.'))
    } finally {
      setBulkBusy(false); setBulkOpen(false); setBulkProgress(null)
    }
  }

  async function runApply() {
    setApplyBusy(true); setActionError(null)
    try {
      const res = await applyAccessReview(campaignId)
      setApplyResult(res)
      await load()
      onChanged?.()
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not apply the decisions.'))
    } finally {
      setApplyBusy(false); setApplyOpen(false)
    }
  }

  async function exportEvidence(format) {
    setExporting(format); setActionError(null)
    try {
      const rows = evidenceRows(filtered.length ? filtered : items)
      const file = reportFileName('Access Review Evidence', campaign?.name, fmtDate(new Date()))
      if (format === 'pdf') {
        await exportToPdf(rows, EVIDENCE_COLUMNS.map(([key, header]) => ({ key, header })),
          `Access Review Evidence: ${campaign?.name || ''}`, file, 'landscape')
      } else {
        await exportToExcel(rows, EVIDENCE_COLUMNS.map(([k]) => k), EVIDENCE_COLUMNS.map(([, h]) => h), file, 'Access review')
      }
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export the evidence.'))
    } finally {
      setExporting('')
    }
  }

  if (loading && !data) return <LoadingState label="Loading access review" rows={6} />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!campaign) return <EmptyState title="Review not found" reason="It may have been removed." />

  const parts = [
    { label: 'Pending', value: progress.pending, color: STATUS[theme].low },
    { label: 'Keep', value: progress.keep, color: STATUS[theme].good },
    { label: 'Revoke', value: progress.revoke, color: STATUS[theme].critical },
    { label: 'Modify', value: progress.modify, color: STATUS[theme].medium },
  ]
  const overdue = isOverdue(campaign)
  const pickDecision = (d) => { setDecision(decision === d ? 'all' : d); setView('decisions') }

  const attention = []
  if (!closed) {
    if (progress.pending && overdue) attention.push({ key: 'overdue', tone: 'danger', title: `Past due with ${progress.pending} decision${progress.pending === 1 ? '' : 's'} pending`, detail: 'Finish the remaining decisions, then apply them.', action: { label: 'Show pending', onClick: () => { setDecision('pending'); setView('decisions') } } })
    const dormantPending = items.filter((i) => i.decision === 'pending' && dormancy(i).dormant).length
    if (dormantPending) attention.push({ key: 'dormant', tone: 'warning', title: `${dormantPending} dormant user${dormantPending === 1 ? ' is' : 's are'} still pending`, detail: `No sign-in for ${DORMANT_DAYS}+ days. These are the usual revoke candidates.`, action: { label: 'Show dormant', onClick: () => { setFlag('dormant'); setDecision('pending'); setView('decisions') } } })
    const superPending = items.filter((i) => i.decision === 'pending' && i.is_super_admin).length
    if (superPending) attention.push({ key: 'super', tone: 'warning', title: `${superPending} super admin${superPending === 1 ? '' : 's'} not yet reviewed`, detail: 'Privileged access is what auditors check first.', action: { label: 'Show', onClick: () => { setFlag('super'); setDecision('pending'); setView('decisions') } } })
    if (!progress.pending && progress.total) attention.push({ key: 'apply', tone: 'info', title: 'Every user has a decision', detail: `Apply the decisions to lock the ${progress.revoke} user${progress.revoke === 1 ? '' : 's'} decided revoke and close the review.`, action: { label: 'Apply decisions', onClick: () => setApplyOpen(true) } })
  }

  function itemActions(it) {
    const busy = busyId === it.id
    if (closed) return <span className="text-[11px] text-gray-400">{it.decided_by_email || ''}</span>
    return (
      <div className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
        <Btn size="xs" variant={it.decision === 'keep' ? 'good' : 'ghost'} busy={busy}
          onClick={() => decide(it, it.decision === 'keep' ? 'pending' : 'keep')}>Keep</Btn>
        <Btn size="xs" variant={it.decision === 'modify' ? 'primary' : 'ghost'} disabled={busy}
          onClick={() => askNote(it, 'modify')}>Modify</Btn>
        <Btn size="xs" variant={it.decision === 'revoke' ? 'danger' : 'ghost'} disabled={busy}
          onClick={() => askNote(it, 'revoke')}>Revoke</Btn>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <Btn icon={ArrowLeft} onClick={onBack}>All reviews</Btn>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-gray-100 truncate">{campaign.name}</h2>
          <p className="text-xs text-gray-400">
            Snapshot {fmtDate(campaign.created_at, true)} by {campaign.created_by_email || 'N/A'}
            {' | '}Due {fmtDate(campaign.due_at)}
            {closed && ` | Closed ${fmtDate(campaign.closed_at, true)} by ${campaign.closed_by_email || 'N/A'}`}
          </p>
        </div>
        <Toolbar>
          <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
          <Btn icon={FileSpreadsheet} onClick={() => exportEvidence('excel')} busy={exporting === 'excel'}>Export evidence</Btn>
          <Btn icon={FileText} onClick={() => exportEvidence('pdf')} busy={exporting === 'pdf'}>PDF</Btn>
          {!closed && (
            <Btn variant="danger" icon={Lock} onClick={() => setApplyOpen(true)}>Apply decisions</Btn>
          )}
        </Toolbar>
      </div>

      {closed && <Note icon={Lock}>This review is closed. Decisions are frozen and the export is the recorded evidence.</Note>}
      {actionError && <Note icon={AlertTriangle} tone="danger">{actionError}</Note>}
      {applyResult && (
        <Note icon={ShieldCheck} tone="accent">
          Applied. {applyResult.summary?.locked ?? 0} users locked
          {applyResult.summary?.refused ? `, ${applyResult.summary.refused} refused (see Apply result column)` : ''}.
        </Note>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile label="Users reviewed" value={progress.total} icon={Users} onClick={() => pickDecision('all')} active={decision === 'all'}
          sub={progress.pct == null ? undefined : `${progress.pct}% decided`} />
        <StatTile label="Pending" value={progress.pending} tone={progress.pending ? 'warning' : 'good'} icon={Clock}
          onClick={() => pickDecision('pending')} active={decision === 'pending'} />
        <StatTile label="Keep" value={progress.keep} tone="good" icon={CheckCircle2}
          onClick={() => pickDecision('keep')} active={decision === 'keep'} />
        <StatTile label="Revoke" value={progress.revoke} tone={progress.revoke ? 'danger' : 'default'} icon={XCircle}
          onClick={() => pickDecision('revoke')} active={decision === 'revoke'} />
        <StatTile label="Modify" value={progress.modify} tone={progress.modify ? 'warning' : 'default'} icon={PenLine}
          onClick={() => pickDecision('modify')} active={decision === 'modify'} />
      </div>

      <Segmented ariaLabel="Review views" value={view} onChange={setView} options={[
        { key: 'decisions', label: 'Decisions', count: progress.pending },
        { key: 'overview', label: 'Overview' },
      ]} />

      {view === 'overview' && (
        <div role="tabpanel" aria-label="Overview" className="grid gap-4 lg:grid-cols-3">
          <Panel>
            <PanelHeader icon={ListChecks} title="Decision progress" subtitle={`${progress.decided} of ${progress.total} decided`} />
            <ShareChart parts={parts} center={{ value: progress.pct == null ? 'N/A' : `${progress.pct}%`, label: 'Decided' }}
              summary={`${progress.decided} of ${progress.total} users have a decision`} />
          </Panel>
          <Panel>
            <PanelHeader icon={Users} title="Users by role" subtitle="Largest eight roles in this snapshot" />
            <BarsChart bars={byRole} summary="Number of users per role" />
          </Panel>
          <Panel>
            <PanelHeader icon={UserX} title="Reviewer attention" subtitle="Accounts that deserve a closer look" />
            <div className="space-y-3">
              <ScoreRing score={progress.pct ?? 0} label="Completion" size={96} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <StatTile label="Dormant" value={dormantCount} sub={`${DORMANT_DAYS}+ days`} tone={dormantCount ? 'warning' : 'default'}
                  onClick={() => { setFlag(flag === 'dormant' ? 'all' : 'dormant'); setView('decisions') }} active={flag === 'dormant'} />
                <StatTile label="Super admins" value={superCount}
                  onClick={() => { setFlag(flag === 'super' ? 'all' : 'super'); setView('decisions') }} active={flag === 'super'} />
                <StatTile label="With grants" value={grantsCount}
                  onClick={() => { setFlag(flag === 'grants' ? 'all' : 'grants'); setView('decisions') }} active={flag === 'grants'} />
              </div>
            </div>
          </Panel>
        </div>
      )}

      {view === 'decisions' && (
        <div role="tabpanel" aria-label="Decisions" className="space-y-4">
          <AttentionList items={attention} clearText={closed ? 'This review is closed.' : 'Nothing in this review needs attention yet.'} />
          <Panel flush>
            <div className="p-4 pb-3 space-y-3">
              <PanelHeader icon={ClipboardCheck} title="Users" subtitle={`${filtered.length} of ${items.length} shown by the current filters. Select a row for grants and notes.`}
                actions={!closed && (
                  <Btn variant="good" icon={CheckCircle2} disabled={!bulkTargets.length} onClick={() => setBulkOpen(true)}>
                    Keep all pending in view ({bulkTargets.length})
                  </Btn>
                )} />
              <Toolbar>
                <SearchInput value={search} onChange={setSearch} placeholder="Search name, email, role, country or site" className="w-72" />
                <Select value={role} onChange={setRole} placeholder="All roles" ariaLabel="Filter by role" options={roles.map((r) => ({ value: r, label: r }))} className="w-44" />
                <Segmented role="group" ariaLabel="Filter by account type" value={flag} onChange={setFlag} options={[
                  { key: 'all', label: 'Everyone' },
                  { key: 'dormant', label: 'Dormant', count: dormantCount },
                  { key: 'super', label: 'Super admins', count: superCount },
                  { key: 'grants', label: 'Has grants', count: grantsCount },
                ]} />
                <Segmented role="group" ariaLabel="Filter by decision" value={decision} onChange={setDecision} options={[
                  { key: 'all', label: 'Any decision' },
                  { key: 'pending', label: 'Pending', count: progress.pending },
                  { key: 'keep', label: 'Keep', count: progress.keep },
                  { key: 'revoke', label: 'Revoke', count: progress.revoke },
                  { key: 'modify', label: 'Modify', count: progress.modify },
                ]} />
              </Toolbar>
            </div>

            {!filtered.length ? (
              <EmptyState title="No users match" reason="No user in this snapshot matches the current filters." />
            ) : (
              <>
                <Table className="border-0 rounded-none">
                  <THead>
                    <Th sortKey="full_name" sort={sort} onSort={onSort}>User</Th>
                    <Th sortKey="role" sort={sort} onSort={onSort}>Role</Th>
                    <Th sortKey="countries" sort={sort} onSort={onSort}>Countries</Th>
                    <Th align="right" sortKey="grants" sort={sort} onSort={onSort}>Grants</Th>
                    <Th sortKey="last_sign_in_at" sort={sort} onSort={onSort}>Last sign in</Th>
                    <Th sortKey="decision" sort={sort} onSort={onSort}>Decision</Th>
                    <Th align="right">Action</Th>
                  </THead>
                  <tbody>
                    {paged.pageRows.map((it) => {
                      const dm = dormancy(it)
                      const DIcon = DECISION_ICON[it.decision] || Clock
                      return (
                        <Tr key={it.id} onClick={() => setDetail(it.id)} ariaLabel={`Open ${it.full_name || it.user_email || 'user'}`}>
                          <Td>
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-200">{it.full_name || 'N/A'}</span>
                              {it.is_super_admin && <Badge tone="accent" icon={ShieldCheck}>Super admin</Badge>}
                              {it.locked && <Badge tone="quiet" icon={Lock}>Locked</Badge>}
                            </div>
                            <p className="text-[11px] text-gray-400">{it.user_email || 'N/A'}</p>
                          </Td>
                          <Td nowrap>{it.role || 'N/A'}</Td>
                          <Td><span className="text-gray-400">{(it.country || []).join(', ') || 'None'}</span></Td>
                          <Td align="right"><span className="tabular-nums text-gray-300">{grantCount(it)}</span></Td>
                          <Td nowrap>
                            <span className="text-gray-400">{it.last_sign_in_at ? fmtDate(it.last_sign_in_at) : 'Never'}</span>
                            {dm.dormant && <span className="ml-1.5"><Badge tone="warning" icon={Clock}>Dormant</Badge></span>}
                          </Td>
                          <Td>
                            <Badge tone={DECISION_TONE[it.decision] || 'quiet'} icon={DIcon}>{DECISION_LABEL[it.decision] || 'Pending'}</Badge>
                            {it.decision_note && <p className="text-[11px] text-gray-400 mt-0.5 max-w-[220px] truncate" title={it.decision_note}>{it.decision_note}</p>}
                            {it.apply_result && <p className="text-[11px] text-gray-400 mt-0.5">Applied: {it.apply_result}</p>}
                          </Td>
                          <Td align="right" nowrap>{itemActions(it)}</Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </Table>
                <Pager {...paged} onPage={paged.setPage} />
              </>
            )}
          </Panel>
        </div>
      )}

      <Drawer open={!!detailItem} title={detailItem ? (detailItem.full_name || detailItem.user_email || 'User') : ''}
        subtitle={detailItem?.user_email} onClose={() => setDetail(null)} footer={detailItem ? itemActions(detailItem) : null}>
        {detailItem && (
          <>
            <DetailList items={[
              ['Role', detailItem.role],
              ['Countries', (detailItem.country || []).join(', ') || 'None'],
              ['Sites', (detailItem.sites || []).join(', ') || 'None'],
              ['Last sign in', detailItem.last_sign_in_at ? fmtDate(detailItem.last_sign_in_at, true) : 'Never'],
              ['Status at snapshot', `${detailItem.locked ? 'Locked' : 'Active'}${detailItem.is_super_admin ? ', super admin' : ''}`],
              ['Decision', DECISION_LABEL[detailItem.decision] || 'Pending'],
              ['Decided', detailItem.decided_at ? `${fmtDate(detailItem.decided_at, true)}${detailItem.decided_by_email ? ` by ${detailItem.decided_by_email}` : ''}` : 'Not yet'],
              ['Note', detailItem.decision_note],
              detailItem.apply_result && ['Apply result', detailItem.apply_result],
            ]} />
            <div>
              <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-gray-500 mb-1"><KeyRound size={11} aria-hidden="true" /> Per user grants ({grantCount(detailItem)})</p>
              {grantCount(detailItem) === 0 ? <p className="text-xs text-gray-400">None. Access comes from the role only.</p> : (
                <ul className="space-y-1">
                  {detailItem.grants.map((g, i) => (
                    <li key={`${g.module_key}-${i}`} className="text-xs text-gray-300">
                      <Badge tone={g.effect === 'revoke' ? 'danger' : 'good'}>{g.effect}</Badge> {g.module_key}{g.capability ? ` (${g.capability})` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </Drawer>

      <Modal open={!!noteFor} onClose={() => setNoteFor(null)}
        title={noteFor?.decision === 'revoke' ? 'Revoke access' : 'Access needs changes'}
        subtitle={noteFor ? `${noteFor.item.full_name || noteFor.item.user_email || 'User'} (${noteFor.item.role || 'N/A'})` : ''}
        width="max-w-lg"
        footer={<>
          <Btn onClick={() => setNoteFor(null)}>Cancel</Btn>
          <Btn variant={noteFor?.decision === 'revoke' ? 'danger' : 'primary'}
            disabled={noteFor?.decision === 'revoke' && !note.trim()} onClick={submitNote}>
            Record {noteFor?.decision === 'revoke' ? 'revoke' : 'modify'}
          </Btn>
        </>}>
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            {noteFor?.decision === 'revoke'
              ? 'A reason is required. Recording this does not lock the user yet; access is removed only when the decisions are applied.'
              : 'Describe what should change (for example a role or site). Make the change in Users or Access Control; this records the decision as evidence.'}
          </p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} autoFocus
            aria-label={noteFor?.decision === 'revoke' ? 'Reason for revoking' : 'What should change'}
            placeholder={noteFor?.decision === 'revoke' ? 'Reason, for example: left the company' : 'What should change'}
            className="w-full rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 p-2.5 placeholder-gray-500 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
        </div>
      </Modal>

      <Modal open={bulkOpen} onClose={() => !bulkBusy && setBulkOpen(false)} title="Keep all pending users in view"
        subtitle={`${bulkTargets.length} users`} width="max-w-lg"
        footer={<>
          <Btn onClick={() => setBulkOpen(false)} disabled={bulkBusy}>Cancel</Btn>
          <Btn variant="good" busy={bulkBusy} onClick={runBulkKeep}>Keep {bulkTargets.length}</Btn>
        </>}>
        <p className="text-xs text-gray-400">
          Records a keep decision for every user in the current view that is still pending. Users who already have a
          decision are left as they are. Each decision is stored against your account with a timestamp.
        </p>
        {bulkProgress && <p className="text-xs text-gray-300 mt-3 tabular-nums">Saved {bulkProgress.done} of {bulkProgress.total}</p>}
      </Modal>

      <Modal open={applyOpen} onClose={() => !applyBusy && setApplyOpen(false)} title="Apply decisions and close this review"
        width="max-w-lg"
        footer={<>
          <Btn onClick={() => setApplyOpen(false)} disabled={applyBusy}>Cancel</Btn>
          <Btn variant="danger" icon={Lock} busy={applyBusy} onClick={runApply}>Lock {progress.revoke} and close</Btn>
        </>}>
        <div className="space-y-3 text-xs text-gray-400">
          <p>
            Every user decided <span className="text-red-400 font-medium">Revoke</span> ({progress.revoke}) will be locked
            and cannot sign in until an administrator unlocks them. Each lock is written to the access audit trail with your reason.
          </p>
          <p>Your own account and the last active super admin are never locked; those are reported as refused.</p>
          {progress.pending > 0 && (
            <Note icon={AlertTriangle} tone="warning">
              {progress.pending} users are still pending. They will be recorded as not reviewed in the evidence.
            </Note>
          )}
          <p>After this the review is closed and decisions can no longer change.</p>
        </div>
      </Modal>
    </div>
  )
}

/* ── page ──────────────────────────────────────────────────────────────────── */

export default function ConsoleAccessReviews() {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useUrlParam('review')
  const { refreshedAt, stamp } = useRefreshStamp()
  const [startOpen, setStartOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const [due, setDue] = useState(defaultDue)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setCampaigns(await listAccessReviews())
      stamp()
    } catch (e) {
      setError(toUserMessage(e, 'Could not load access reviews.'))
    } finally {
      setLoading(false)
    }
  }, [stamp])

  useEffect(() => { load() }, [load])

  const openCount = campaigns.filter((c) => c.status !== 'closed').length
  const overdueCount = campaigns.filter((c) => isOverdue(c)).length
  const lastClosed = campaigns.find((c) => c.status === 'closed')
  const na = loading || !!error

  async function start() {
    setStarting(true); setStartError(null)
    try {
      const id = await startAccessReview(name, due ? `${due}T23:59:59` : null)
      setStartOpen(false)
      await load()
      if (id) setOpenId(id)
    } catch (e) {
      setStartError(toUserMessage(e, 'Could not start the access review.'))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={ClipboardCheck} title="Access Reviews"
        purpose="Periodic recertification of every user's access, kept as audit evidence (ISO 27001 A.5.18 and A.8.2, SOC 2 CC6)."
        primary={!openId && <Btn variant="primary" icon={Play} onClick={() => { setStartError(null); setStartOpen(true) }}>Start a review</Btn>}
        refreshedAt={refreshedAt} onRefresh={openId ? undefined : load} refreshing={loading} />

      {openId ? (
        <CampaignView campaignId={openId} onBack={() => { setOpenId(null); load() }} onChanged={() => {}} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Reviews" value={na ? 'N/A' : campaigns.length} icon={ClipboardCheck} />
            <StatTile label="Open" value={na ? 'N/A' : openCount} icon={Clock} tone={openCount ? 'accent' : 'default'} />
            <StatTile label="Overdue" value={na ? 'N/A' : overdueCount} icon={AlertTriangle} tone={na ? 'default' : overdueCount ? 'danger' : 'good'} />
            <StatTile label="Last completed" value={na ? 'N/A' : lastClosed ? fmtDate(lastClosed.closed_at) : 'Never'} icon={CalendarClock}
              sub={na ? undefined : lastClosed ? lastClosed.name : 'No review has been closed yet'} />
          </div>
          <AttentionList ready={!na} clearText="Every open review is on time and a review has been completed." items={[
            ...(!lastClosed ? [{ key: 'none', tone: 'warning', title: 'No access review has been completed',
              detail: 'Auditors expect one at least every quarter for privileged users and every year for everyone.',
              action: { label: 'Start a review', onClick: () => { setStartError(null); setStartOpen(true) } } }] : []),
            ...campaigns.filter((c) => isOverdue(c)).slice(0, 3).map((c) => ({ key: c.id, tone: 'danger',
              title: `${c.name} is overdue`, detail: `${Number(c.pending) || 0} decision${Number(c.pending) === 1 ? '' : 's'} still pending, due ${fmtDate(c.due_at)}.`,
              action: { label: 'Open', onClick: () => setOpenId(c.id) } })),
          ]} />
          <Panel>
            <PanelHeader icon={ListChecks} title="Review campaigns" subtitle="Open one to record decisions or export the evidence" />
            <div>
              {loading ? <LoadingState label="Loading reviews" />
                : error ? <ErrorState message={error} onRetry={load} />
                  : <CampaignList campaigns={campaigns} onOpen={setOpenId} />}
            </div>
          </Panel>
        </>
      )}

      <Modal open={startOpen} onClose={() => !starting && setStartOpen(false)} title="Start an access review"
        subtitle="Snapshots every approved user's role, countries, sites, grants and last sign in" width="max-w-lg"
        footer={<>
          <Btn onClick={() => setStartOpen(false)} disabled={starting}>Cancel</Btn>
          <Btn variant="primary" icon={Play} busy={starting} disabled={!name.trim()} onClick={start}>Start review</Btn>
        </>}>
        <div className="space-y-3">
          <label className="block text-xs text-gray-400">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
              className="mt-1 w-full rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 px-2.5 py-1.5 focus:border-gray-700 focus:outline-none" />
          </label>
          <label className="block text-xs text-gray-400">
            Due date
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
              className="mt-1 w-full rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 px-2.5 py-1.5 focus:border-gray-700 focus:outline-none" />
          </label>
          <p className="text-[11px] text-gray-400">
            The snapshot is fixed at the moment the review starts, so the evidence shows exactly what was reviewed even if access changes later.
          </p>
          {startError && <Note icon={AlertTriangle} tone="danger">{startError}</Note>}
        </div>
      </Modal>
    </div>
  )
}
