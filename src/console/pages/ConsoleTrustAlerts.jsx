/**
 * ConsoleTrustAlerts.jsx - the data trust alert desk.
 *
 * The quality and reconciliation scans raise a breach when a number stops
 * being trustworthy. This page is where a person acknowledges each one and
 * marks it resolved, so a trust problem is never silently open.
 *
 * A scan is a deliberate press, not a background poll: running it here reruns
 * both scans and shows exactly how many alerts are open afterward.
 *
 * Layout: a compact header, status tiles that double as filters, a short
 * "needs attention" list, then two tabs (?tab=alerts | trends). Row detail and
 * the acknowledge / resolve actions live in a drawer as well as on the row.
 *
 * Every decision (acknowledge, resolve, reopen, single or bulk) goes through a
 * ConfirmImpactDialog with a required reason: decide_trust_alert writes the
 * reason and the actor into the trust_alert_events timeline (Admin or super
 * admin only, 20261004101000) and the console audit log records it too.
 * Response time (median time to acknowledge / resolve) is measured only from
 * alerts that carry both timestamps; otherwise it reads N/A.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BellRing, ShieldAlert, CheckCircle2, Play, AlertTriangle, Clock, TrendingUp, Eye, ListChecks,
  RotateCcw, Timer, History, X,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, Toolbar, SearchInput, Segmented,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal, ConfirmImpactDialog,
} from '../components/ui'
import { TrendChart, ShareChart, BarsChart } from '../components/ui/charts'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import { dailySeries, topShare } from '../../lib/consoleCharts'
import ExportButtons from './shared/ExportButtons'
import {
  scanDataTrust, listTrustAlerts, decideTrustAlert, listTrustAlertEvents, listActorNames, TRUST_ALERTS_WINDOW,
} from '../../lib/api/lineageOps'
import { responseTimes, fmtHours, allowedDecisions, decisionImpact, DECISION_LABEL } from '../../lib/trustAlertOps'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { alertTone } from '../../lib/lineageOps'
import { COUNTRIES } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'
import {
  PageHeader, useUrlTab, usePaged, Pager, AttentionList, ConsoleLink, TabPanel, whenText, ageText,
} from './shared/pageKit'

const nf = new Intl.NumberFormat('en-US')
const DAY = 86400000
const STALE_DAYS = 7

const SEVERITY_RANK = { critical: 0, error: 0, high: 1, warning: 2, warn: 2, medium: 2, low: 3, info: 4 }
const EXPORT_COLUMNS = [
  { key: 'source', header: 'Source' },
  { key: 'ref_key', header: 'Ref' },
  { key: 'severity', header: 'Severity' },
  { key: 'country', header: 'Country', value: (r) => r.country || 'All' },
  { key: 'message', header: 'Message' },
  { key: 'status', header: 'Status' },
  { key: 'created_at', header: 'Raised' },
  { key: 'resolution_note', header: 'Last reason', value: (r) => r.resolution_note || 'N/A' },
]

const SOURCE_TONE = { quality: 'warning', reconciliation: 'info' }
const SOURCE_LABEL = { quality: 'Quality', reconciliation: 'Reconciliation' }
const SOURCE_PAGE = { quality: '/console/data-quality', reconciliation: '/console/reconciliation' }
const STATUS_TONE = { open: 'danger', ack: 'warning', resolved: 'good' }
const STATUS_LABEL = { open: 'Open', ack: 'Acknowledged', resolved: 'Resolved' }

const COUNTRY_OPTS = [{ value: 'all', label: 'All countries' }, ...COUNTRIES.map((c) => ({ value: c, label: c }))]
const SOURCE_OPTS = [
  { value: 'all', label: 'All sources' },
  { value: 'quality', label: 'Quality' },
  { value: 'reconciliation', label: 'Reconciliation' },
]
const TABS = ['alerts', 'trends']
const PAGE_SIZE = 25

const isCritical = (r) => ['critical', 'error'].includes(String(r.severity || '').toLowerCase())
const isActive = (r) => r.status === 'open' || r.status === 'ack'
const sourceLabel = (s) => SOURCE_LABEL[s] || s || 'N/A'

export default function ConsoleTrustAlerts({ tabParam = 'tab' } = {}) {
  const [state, setState] = useState({ loading: true, error: null, rows: [], readAt: null })
  const [country, setCountry] = useState('all')
  const [status, setStatus] = useState('active')
  const [source, setSource] = useState('all')
  const [query, setQuery] = useState('')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState('')     // `${id}:${action}`
  const [flash, setFlash] = useState(null) // {tone, text}
  const [detail, setDetail] = useState(null)
  const [tab, setTab] = useUrlTab(TABS, 'alerts', tabParam)
  const { logAction } = useConsoleAuth()
  const [selected, setSelected] = useState(() => new Set())
  const [pending, setPending] = useState(null) // { rows, next }
  const [decideErr, setDecideErr] = useState('')
  const [timeline, setTimeline] = useState({ loading: false, error: '', rows: [], names: {} })

  // One read of the newest window for every status: the tiles and the trend
  // must describe the same rows, so the status filter is applied on screen.
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const rows = await listTrustAlerts({ status: null })
      setState({ loading: false, error: null, rows, readAt: Date.now() })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), rows: [], readAt: null })
    }
  }, [])

  useEffect(() => { load() }, [load])

  const scoped = useMemo(
    () => state.rows.filter((r) => country === 'all' || !r.country || r.country === country),
    [state.rows, country],
  )

  const counts = useMemo(() => {
    const c = { open: 0, ack: 0, resolved: 0, quality: 0, reconciliation: 0, critical: 0, stale: 0 }
    const now = Date.now()
    for (const r of scoped) {
      if (r.status in c) c[r.status] += 1
      if (!isActive(r)) continue
      if (r.source === 'quality') c.quality += 1
      if (r.source === 'reconciliation') c.reconciliation += 1
      if (isCritical(r)) c.critical += 1
      const t = new Date(r.created_at).getTime()
      if (Number.isFinite(t) && now - t > STALE_DAYS * DAY) c.stale += 1
    }
    return c
  }, [scoped])

  // The same reference raising again and again is a broken rule or a broken
  // feed, not five separate problems.
  const repeats = useMemo(() => {
    const m = new Map()
    for (const r of scoped) {
      if (!isActive(r) || !r.ref_key) continue
      m.set(r.ref_key, (m.get(r.ref_key) || 0) + 1)
    }
    return [...m.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])
  }, [scoped])

  const { sort, setSort, onSort } = useTableSort({ key: 'created_at', dir: 'desc' })
  const visible = useMemo(() => {
    const byStatus = scoped.filter((r) => (
      status === 'all' ? true : status === 'active' ? isActive(r) : r.status === status))
    const bySource = source === 'all' ? byStatus : byStatus.filter((r) => r.source === source)
    return sortRows(
      searchRows(bySource, query, ['message', 'ref_key', 'country', 'source', 'severity']),
      sort,
      { severity: (r) => SEVERITY_RANK[String(r.severity || '').toLowerCase()] ?? 9 },
    )
  }, [scoped, status, source, query, sort])
  const paged = usePaged(visible, PAGE_SIZE, `${status}|${source}|${query}|${country}|${sort?.key}|${sort?.dir}`)

  const trend = useMemo(() => dailySeries(scoped, (r) => r.created_at, 30), [scoped])
  const bySource = useMemo(() => topShare(scoped.filter(isActive), (r) => sourceLabel(r.source), 4), [scoped])
  const topRefs = useMemo(() => repeats.slice(0, 8).map(([label, value]) => ({ label, value })), [repeats])

  const runScan = async () => {
    setScanning(true)
    setFlash(null)
    try {
      const res = await scanDataTrust(country === 'all' ? null : country)
      const open = Number(res?.open_alerts ?? 0)
      const fresh = Number(res?.new_quality_alerts ?? 0)
      setFlash({ tone: 'ok', text: `Scan complete: ${nf.format(open)} open alerts, ${nf.format(fresh)} new.` })
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setScanning(false)
    }
  }

  // Every decision is confirmed with a reason; the reason lands in the
  // alert timeline (server) and in the console audit log.
  const decide = (row, next) => { setDecideErr(''); setPending({ rows: [row], next }) }
  const decideMany = (next) => {
    const rows = state.rows.filter((r) => selected.has(r.id) && allowedDecisions(r.status).includes(next))
    if (rows.length) { setDecideErr(''); setPending({ rows, next }) }
  }
  const confirmDecision = async ({ reason }) => {
    if (!pending) return
    const { rows, next } = pending
    setBusy(`bulk:${next}`)
    let ok = 0
    const failed = []
    for (const row of rows) {
      try {
        await decideTrustAlert(row.id, next, reason)
        ok += 1
        logAction?.(`trust_alert_${next}`, null, 'trust_alert', { alert_id: row.id, ref: row.ref_key || null, reason })
      } catch (e) {
        failed.push(toUserMessage(e))
      }
    }
    setBusy('')
    if (failed.length && !ok) { setDecideErr(failed[0]); return }
    setPending(null)
    setSelected(new Set())
    const verb = next === 'resolved' ? 'resolved' : next === 'ack' ? 'acknowledged' : 'reopened'
    setFlash({ tone: failed.length ? 'bad' : 'ok', text: `${nf.format(ok)} alert${ok === 1 ? '' : 's'} ${verb}.${failed.length ? ` ${failed.length} could not be changed: ${failed[0]}` : ''}` })
    setDetail((d) => (d && rows.some((r) => r.id === d.id) ? { ...d, status: next, resolution_note: reason } : d))
    await load()
  }

  // Timeline + actor names for the open alert.
  useEffect(() => {
    if (!detail?.id) return undefined
    let stop = false
    setTimeline({ loading: true, error: '', rows: [], names: {} })
    listTrustAlertEvents(detail.id)
      .then(async (rows) => {
        const names = await listActorNames([...rows.map((r) => r.actor), detail.acked_by, detail.resolved_by])
        if (!stop) setTimeline({ loading: false, error: '', rows, names })
      })
      .catch((e) => { if (!stop) setTimeline({ loading: false, error: toUserMessage(e, 'The timeline could not be read.'), rows: [], names: {} }) })
    return () => { stop = true }
  }, [detail?.id, detail?.status, detail?.acked_by, detail?.resolved_by])

  const pickStatus = (s) => { setStatus(s); setSource('all'); setTab('alerts') }
  const pickSource = (s) => { setStatus('active'); setSource(s); setTab('alerts') }

  const attention = useMemo(() => {
    if (state.error || state.loading) return []
    const out = []
    if (counts.critical) {
      out.push({ key: 'crit', tone: 'danger', text: `${nf.format(counts.critical)} critical ${counts.critical === 1 ? 'alert is' : 'alerts are'} still open or only acknowledged.`, actionLabel: 'Show them', onAction: () => { pickStatus('active'); setSort({ key: 'severity', dir: 'asc' }) } })
    }
    if (counts.stale) {
      out.push({ key: 'stale', tone: 'warning', text: `${nf.format(counts.stale)} ${counts.stale === 1 ? 'alert has' : 'alerts have'} been unresolved for more than ${STALE_DAYS} days.`, actionLabel: 'Oldest first', onAction: () => { pickStatus('active'); setSort({ key: 'created_at', dir: 'asc' }) } })
    }
    if (repeats.length) {
      const [ref, n] = repeats[0]
      out.push({ key: 'repeat', tone: 'warning', text: `Reference ${ref} has raised ${n} open alerts. A rule or feed is failing repeatedly, not once.`, actionLabel: 'Filter to it', onAction: () => { pickStatus('active'); setQuery(ref) } })
    }
    if (counts.open && !counts.ack) {
      out.push({ key: 'unowned', tone: 'info', text: `${nf.format(counts.open)} open ${counts.open === 1 ? 'alert has' : 'alerts have'} not been acknowledged by anyone.`, actionLabel: 'Open alerts', onAction: () => pickStatus('open') })
    }
    return out
    // pickStatus only calls stable state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, repeats, state.error, state.loading, setSort])

  const times = useMemo(() => responseTimes(scoped), [scoped])
  const selectedRows = useMemo(() => state.rows.filter((r) => selected.has(r.id)), [state.rows, selected])
  const toggleRow = (id) => setSelected((s0) => { const n = new Set(s0); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allOnPage = paged.rows.length > 0 && paged.rows.every((r) => selected.has(r.id))
  const togglePage = () => setSelected((s0) => {
    const n = new Set(s0)
    if (allOnPage) paged.rows.forEach((r) => n.delete(r.id)); else paged.rows.forEach((r) => n.add(r.id))
    return n
  })

  const tileValue = (n) => (state.error ? 'N/A' : state.loading && !state.readAt ? '...' : nf.format(n))
  const truncated = state.rows.length >= TRUST_ALERTS_WINDOW

  return (
    <div className="space-y-4 max-w-7xl">
      <PageHeader
        icon={BellRing}
        title="Data Trust Alerts"
        purpose="Breaches raised by the quality and reconciliation scans. Acknowledge who owns each one and resolve it when the number is trustworthy again."
        refreshedAt={state.readAt}
        onRefresh={load}
        refreshing={state.loading}
        meta={<span>Run scan now: reruns the quality and reconciliation rules for the selected country and raises new alerts. It changes no business data.</span>}
        actions={(
          <>
            <Select ariaLabel="Country" value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-40" />
            <Btn icon={Play} variant="primary" onClick={runScan} busy={scanning}>Run scan now</Btn>
          </>
        )}
      />

      {flash && (
        <Note icon={flash.tone === 'ok' ? CheckCircle2 : AlertTriangle} tone={flash.tone === 'ok' ? 'accent' : 'danger'}>
          <span role={flash.tone === 'ok' ? 'status' : 'alert'}>{flash.text}</span>
        </Note>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <StatTile label="Open" icon={ShieldAlert} value={tileValue(counts.open)}
          tone={state.error ? 'default' : counts.open ? 'danger' : 'good'} sub="Not yet owned"
          onClick={() => pickStatus('open')} active={status === 'open' && source === 'all'} />
        <StatTile label="Acknowledged" value={tileValue(counts.ack)} tone={!state.error && counts.ack ? 'warning' : 'default'}
          sub="Owned, not fixed" onClick={() => pickStatus('ack')} active={status === 'ack'} />
        <StatTile label="Resolved" value={tileValue(counts.resolved)} tone="good" sub="In the loaded window"
          onClick={() => pickStatus('resolved')} active={status === 'resolved'} />
        <StatTile label="Quality, active" value={tileValue(counts.quality)} tone={!state.error && counts.quality ? 'warning' : 'default'}
          sub="Rule breaches" onClick={() => pickSource('quality')} active={source === 'quality'} />
        <StatTile label="Reconciliation, active" value={tileValue(counts.reconciliation)} tone={!state.error && counts.reconciliation ? 'warning' : 'default'}
          sub="Totals that disagree" onClick={() => pickSource('reconciliation')} active={source === 'reconciliation'} />
        <StatTile label="Time to acknowledge" icon={Timer} value={state.error ? 'N/A' : fmtHours(times.mtta)}
          sub={times.ackSample ? `Median of ${nf.format(times.ackSample)} alerts` : 'No alert carries both times yet'} />
        <StatTile label="Time to resolve" icon={Clock} value={state.error ? 'N/A' : fmtHours(times.mttr)}
          sub={times.resolveSample ? `Median of ${nf.format(times.resolveSample)} alerts` : 'Recorded from now on'} />
      </div>

      {state.error ? (
        <ErrorState message={state.error} onRetry={load} />
      ) : (
        <AttentionList items={attention} clear={state.loading ? 'Checking...' : 'No open alert needs you right now.'} />
      )}

      <nav aria-label="Trust alert views" className="flex flex-wrap items-center justify-between gap-2">
        <Segmented ariaLabel="Trust alert views" value={tab} onChange={setTab} options={[
          { key: 'alerts', label: <><ListChecks size={13} aria-hidden="true" />Alerts</>, count: state.error ? null : visible.length },
          { key: 'trends', label: <><TrendingUp size={13} aria-hidden="true" />Trends</> },
        ]} />
        <p className="text-[11px] text-gray-500">
          Fix the cause in <ConsoleLink plain to="/console/data-quality">Data Quality</ConsoleLink>,{' '}
          <ConsoleLink plain to="/console/reconciliation">Reconciliation</ConsoleLink> or{' '}
          <ConsoleLink plain to="/console/correction-center">Correction Center</ConsoleLink>.
        </p>
      </nav>

      {tab === 'alerts' ? (
        <TabPanel label="Alerts">
          <Panel>
            <PanelHeader
              icon={ShieldAlert}
              title="Raised alerts"
              subtitle="Click a row for the full message and actions. Acknowledging records ownership; resolving records that the breach was handled."
              actions={(
                <Toolbar>
                  <SearchInput value={query} onChange={setQuery} placeholder="Search message, ref or country" className="w-full sm:w-56" ariaLabel="Search alerts" />
                  <Select ariaLabel="Alert status" value={status} onChange={setStatus} className="w-40" options={[
                    { value: 'active', label: 'Open and acknowledged' },
                    { value: 'all', label: 'All statuses' },
                    { value: 'open', label: 'Open' },
                    { value: 'ack', label: 'Acknowledged' },
                    { value: 'resolved', label: 'Resolved' },
                  ]} />
                  <Select ariaLabel="Alert source" value={source} onChange={setSource} options={SOURCE_OPTS} className="w-36" />
                  <ExportButtons rows={visible} columns={EXPORT_COLUMNS} title="Data Trust Alerts" disabled={!!state.error} />
                </Toolbar>
              )}
            />

            {truncated && !state.error && (
              <div className="mb-3">
                <Note icon={Clock}>Showing the newest {nf.format(TRUST_ALERTS_WINDOW)} alerts. Older alerts exist but are not counted in the tiles above.</Note>
              </div>
            )}

            {selectedRows.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-800 bg-gray-900/60 px-3 py-2">
                <span className="text-xs text-gray-300">{selectedRows.length} selected</span>
                <Btn size="xs" onClick={() => decideMany('ack')} disabled={!selectedRows.some((r) => r.status === 'open')}>Acknowledge</Btn>
                <Btn size="xs" variant="good" icon={CheckCircle2} onClick={() => decideMany('resolved')} disabled={!selectedRows.some((r) => isActive(r))}>Resolve</Btn>
                <Btn size="xs" icon={RotateCcw} onClick={() => decideMany('open')} disabled={!selectedRows.some((r) => r.status !== 'open')}>Reopen</Btn>
                <Btn size="xs" variant="quiet" icon={X} onClick={() => setSelected(new Set())}>Clear</Btn>
                <span className="text-[11px] text-gray-500">Each alert gets the same reason. Alerts already in the target state are skipped.</span>
              </div>
            )}
            {state.loading && !state.readAt ? (
              <LoadingState label="Reading trust alerts" rows={5} />
            ) : state.error ? (
              <EmptyState icon={AlertTriangle} title="Alerts could not be read" reason="Nothing is listed because the read failed, not because there are no alerts. Retry above." />
            ) : scoped.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="No alerts"
                reason={country === 'all'
                  ? 'Nothing has been raised. Run a scan to check the quality and reconciliation rules now.'
                  : `Nothing has been raised for ${country}. Run a scan to check now.`}
                action={<Btn icon={Play} variant="primary" onClick={runScan} busy={scanning}>Run scan now</Btn>}
              />
            ) : visible.length === 0 ? (
              <EmptyState icon={ShieldAlert} title="No alerts match these filters"
                reason="Clear the search or widen the status and source filters to see every loaded alert."
                action={<Btn onClick={() => { setQuery(''); setStatus('all'); setSource('all') }}>Show every alert</Btn>} />
            ) : (
              <>
                <Table>
                  <THead>
                    <Th><input type="checkbox" aria-label="Select every alert on this page" className="accent-orange-500" checked={allOnPage} onChange={togglePage} /></Th>
                    <Th sortKey="severity" sort={sort} onSort={onSort}>Severity</Th>
                    <Th sortKey="source" sort={sort} onSort={onSort}>Source</Th>
                    <Th sortKey="ref_key" sort={sort} onSort={onSort}>Ref</Th>
                    <Th sortKey="message" sort={sort} onSort={onSort}>Message</Th>
                    <Th sortKey="country" sort={sort} onSort={onSort}>Country</Th>
                    <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
                    <Th sortKey="created_at" sort={sort} onSort={onSort}>Raised</Th>
                    <Th align="right">Actions</Th>
                  </THead>
                  <tbody>
                    {paged.rows.map((r) => {
                      const acting = busy.startsWith(`${r.id}:`)
                      return (
                        <Tr key={r.id} tone={r.status === 'open' ? 'warning' : undefined}
                          onClick={() => setDetail(r)} ariaLabel={`Alert ${r.ref_key || ''} ${r.message || ''}`.trim()}>
                          <Td>
                            <input type="checkbox" aria-label={`Select alert ${r.ref_key || r.id}`} className="accent-orange-500"
                              checked={selected.has(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleRow(r.id)} />
                          </Td>
                          <Td><Badge tone={alertTone(r.severity)}>{r.severity || 'N/A'}</Badge></Td>
                          <Td><Badge tone={SOURCE_TONE[r.source] || 'default'}>{sourceLabel(r.source)}</Badge></Td>
                          <Td nowrap><span className="font-mono text-gray-400">{r.ref_key || 'N/A'}</span></Td>
                          <Td className="text-gray-300 min-w-[12rem]"><span className="line-clamp-2 break-words">{r.message || 'N/A'}</span></Td>
                          <Td>{r.country || 'All'}</Td>
                          <Td><Badge tone={STATUS_TONE[r.status] || 'default'}>{STATUS_LABEL[r.status] || r.status || 'N/A'}</Badge></Td>
                          <Td nowrap>
                            <span className="text-gray-500" title={whenText(r.created_at)}>{ageText(r.created_at) || 'N/A'}</span>
                          </Td>
                          <Td align="right">
                            {isActive(r) ? (
                              <Toolbar className="justify-end">
                                {r.status === 'open' && (
                                  <Btn size="xs" onClick={(e) => { e.stopPropagation(); decide(r, 'ack') }}
                                    busy={busy === `${r.id}:ack`} disabled={acting}>Ack</Btn>
                                )}
                                <Btn size="xs" variant="good" icon={CheckCircle2}
                                  onClick={(e) => { e.stopPropagation(); decide(r, 'resolved') }}
                                  busy={busy === `${r.id}:resolved`} disabled={acting}>Resolve</Btn>
                              </Toolbar>
                            ) : (
                              <Btn size="xs" icon={RotateCcw} onClick={(e) => { e.stopPropagation(); decide(r, 'open') }}
                                disabled={acting}>Reopen</Btn>
                            )}
                          </Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </Table>
                <Pager paged={paged} label="alerts" />
              </>
            )}
          </Panel>
        </TabPanel>
      ) : (
        <TabPanel label="Trends">
          {state.error ? (
            <Panel><EmptyState icon={AlertTriangle} title="No trend without data" reason="The alerts could not be read, so there is nothing to chart. Retry above." /></Panel>
          ) : (
            <>
              <Panel>
                <PanelHeader icon={TrendingUp} title="Alerts raised per day" subtitle="Last 30 days, every status, in the selected country." />
                <TrendChart labels={trend.labels} series={[{ label: 'Alerts raised', values: trend.values }]}
                  summary={`${trend.total} alerts raised in the last 30 days`} emptyText="No alert was raised in the last 30 days." />
              </Panel>
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel>
                  <PanelHeader icon={ShieldAlert} title="Active alerts by source" subtitle="Open and acknowledged only." />
                  <ShareChart parts={bySource} summary={bySource.map((p) => `${p.label} ${p.value}`).join(', ')}
                    emptyText="No active alerts." />
                </Panel>
                <Panel>
                  <PanelHeader icon={Eye} title="Repeat offenders" subtitle="References with more than one active alert." />
                  <BarsChart bars={topRefs} valueFormat={(v) => nf.format(v)}
                    summary={topRefs.map((b) => `${b.label} ${b.value}`).join(', ')}
                    emptyText="No reference is raising alerts repeatedly." />
                </Panel>
              </div>
            </>
          )}
        </TabPanel>
      )}

      <Modal
        open={!!detail}
        title={detail ? `${sourceLabel(detail.source)} alert ${detail.ref_key || ''}`.trim() : ''}
        subtitle={detail ? `Raised ${whenText(detail.created_at)} (${ageText(detail.created_at) || 'unknown age'})` : ''}
        onClose={() => setDetail(null)}
        width="max-w-lg"
        footer={detail && (
          <>
            <Btn onClick={() => setDetail(null)}>Close</Btn>
            {detail.status === 'open' && (
              <Btn onClick={() => decide(detail, 'ack')} busy={busy === `${detail.id}:ack`} disabled={!!busy}>Acknowledge</Btn>
            )}
            {isActive(detail) && (
              <Btn variant="good" icon={CheckCircle2} onClick={() => decide(detail, 'resolved')}
                busy={busy === `${detail.id}:resolved`} disabled={!!busy}>Resolve</Btn>
            )}
            {detail.status === 'resolved' && (
              <Btn icon={RotateCcw} onClick={() => decide(detail, 'open')} disabled={!!busy}>Reopen</Btn>
            )}
          </>
        )}
      >
        {detail && (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap gap-2">
              <Badge tone={alertTone(detail.severity)}>{detail.severity || 'No severity'}</Badge>
              <Badge tone={STATUS_TONE[detail.status] || 'default'}>{STATUS_LABEL[detail.status] || detail.status || 'N/A'}</Badge>
              <Badge tone={SOURCE_TONE[detail.source] || 'default'}>{sourceLabel(detail.source)}</Badge>
              <Badge>{detail.country || 'All countries'}</Badge>
            </div>
            <p className="text-sm text-gray-200 break-words whitespace-pre-wrap">{detail.message || 'No message was recorded.'}</p>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-gray-400">
              <dt className="text-gray-500">Reference</dt><dd className="col-span-2 font-mono break-all">{detail.ref_key || 'N/A'}</dd>
              <dt className="text-gray-500">Raised</dt><dd className="col-span-2">{whenText(detail.created_at)}</dd>
              {detail.updated_at && (<><dt className="text-gray-500">Last change</dt><dd className="col-span-2">{whenText(detail.updated_at)}</dd></>)}
              <dt className="text-gray-500">Acknowledged</dt>
              <dd className="col-span-2">{detail.acked_at ? `${whenText(detail.acked_at)} by ${timeline.names[detail.acked_by] || 'a past admin'}` : 'Not yet'}</dd>
              <dt className="text-gray-500">Resolved</dt>
              <dd className="col-span-2">{detail.resolved_at ? `${whenText(detail.resolved_at)} by ${timeline.names[detail.resolved_by] || 'a past admin'}` : detail.status === 'resolved' ? 'Before reasons were recorded' : 'Not yet'}</dd>
              <dt className="text-gray-500">Last reason</dt><dd className="col-span-2 break-words">{detail.resolution_note || 'N/A'}</dd>
            </dl>
            <div>
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-500 mb-1.5"><History size={12} aria-hidden="true" />Timeline</p>
              {timeline.loading ? <LoadingState label="Reading the timeline" rows={2} />
                : timeline.error ? <ErrorState message={timeline.error} />
                  : timeline.rows.length === 0 ? <p className="text-gray-400">No decision with a reason has been recorded for this alert yet.</p>
                    : (
                      <ol className="space-y-1.5">
                        {timeline.rows.map((ev) => (
                          <li key={ev.id} className="rounded-lg border border-gray-800 bg-gray-900/40 px-2.5 py-1.5">
                            <p className="text-gray-200">
                              {STATUS_LABEL[ev.from_status] || ev.from_status || 'New'} to {STATUS_LABEL[ev.to_status] || ev.to_status}
                              <span className="text-gray-500"> by {timeline.names[ev.actor] || 'a past admin'}, {whenText(ev.at)}</span>
                            </p>
                            <p className="text-gray-400 break-words">{ev.note}</p>
                          </li>
                        ))}
                      </ol>
                    )}
            </div>
            {SOURCE_PAGE[detail.source] && (
              <p>Investigate the cause in <ConsoleLink plain to={SOURCE_PAGE[detail.source]}>{sourceLabel(detail.source)}</ConsoleLink>.</p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmImpactDialog
        open={!!pending}
        title={pending ? `${DECISION_LABEL[pending.next]} ${pending.rows.length === 1 ? 'alert' : `${pending.rows.length} alerts`}` : ''}
        impact={pending ? decisionImpact(pending.next, pending.rows.length) : undefined}
        confirmLabel={pending ? DECISION_LABEL[pending.next] : 'Confirm'}
        requireReason
        busy={busy.startsWith('bulk:')}
        error={decideErr}
        danger={pending?.next === 'open'}
        onCancel={() => setPending(null)}
        onConfirm={confirmDecision}
      />
    </div>
  )
}

