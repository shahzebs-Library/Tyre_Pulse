/**
 * ConsoleCorrectionCenter.jsx - governance for a number that looks wrong.
 *
 * The rule this page enforces: do NOT edit a dashboard total directly. Open a
 * case instead. Opening a case freezes the value that was on screen, then the
 * case moves through investigate -> propose -> approve -> apply -> reconcile ->
 * close, with every step and note kept as history. The case is the audit trail
 * and the rollback record; it does not itself mutate business tables - the
 * actual fix is applied through the linked data tool.
 *
 * Layout: header, four KPI tiles, what needs attention, then tabs
 * (?tab=cases|insights). A case opens in a modal; the list is paged.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ClipboardList, Plus, ArrowRight, Check, AlertTriangle,
  FolderOpen, Hourglass, CheckCircle2, Flame, BarChart3,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, Badge, Btn, Select, Toolbar, SearchInput, StatTile, Segmented,
  Table, THead, Th, Tr, Td, Modal,
  LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import {
  listCorrectionCases, getCorrectionCase, openCorrectionCase,
  transitionCorrectionCase, updateCorrectionCase,
} from '../../lib/api/dataTrustOps'
import {
  CASE_STATUSES, CASE_STATUS_LABEL, nextStatuses, caseStatusTone,
  ROOT_CAUSE_CATEGORIES, CASE_SEVERITIES,
} from '../../lib/dataTrustOps'
import { COUNTRIES } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import { BarsChart } from '../components/ui/charts'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, usePaged, Pager, AttentionList } from './dataTrust/kit'

function when(ts) {
  if (!ts) return 'N/A'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 19).replace('T', ' ')
  return d.toLocaleString()
}
const show = (v) => (v === null || v === undefined || v === '' ? 'N/A' : String(v))

const COUNTRY_OPTS = [{ value: 'All', label: 'All countries' }, ...COUNTRIES.map((x) => ({ value: x, label: x }))]
const STATUS_FILTER_OPTS = [{ value: 'all', label: 'All statuses' }, ...CASE_STATUSES.map((s) => ({ value: s, label: CASE_STATUS_LABEL[s] || s }))]
const SEVERITY_OPTS = CASE_SEVERITIES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))
const SEVERITY_FILTER_OPTS = [...SEVERITY_OPTS, { value: 'urgent', label: 'Critical or high, open' }]
const ROOT_CAUSE_OPTS = ROOT_CAUSE_CATEGORIES.map((r) => ({ value: r, label: r }))

const TERMINAL = new Set(['closed', 'reconciled', 'rejected'])
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }
const ACCESSORS = {
  status: (r) => CASE_STATUSES.indexOf(r.status),
  severity: (r) => SEVERITY_RANK[String(r.severity || '').toLowerCase()] ?? 4,
}
const EXPORT_COLUMNS = [
  { key: 'case_no', header: 'Case no', value: (r) => r.case_no || 'N/A' },
  { key: 'title', header: 'Title', value: (r) => r.title || 'Untitled' },
  { key: 'metric', header: 'Metric', value: (r) => show(r.metric_id) },
  { key: 'country', header: 'Country', value: (r) => show(r.country) },
  { key: 'status', header: 'Status', value: (r) => CASE_STATUS_LABEL[r.status] || show(r.status) },
  { key: 'severity', header: 'Severity', value: (r) => show(r.severity) },
  { key: 'original_value', header: 'Original value', value: (r) => show(r.original_value) },
  { key: 'corrected_value', header: 'Corrected value', value: (r) => show(r.corrected_value) },
  { key: 'root_cause', header: 'Root cause', value: (r) => show(r.root_cause_category) },
  { key: 'created', header: 'Created', value: (r) => when(r.created_at) },
]
const TABS = ['cases', 'insights']
const STALE_DAYS = 14
const DAY = 86400000
function ageDays(ts, now = Date.now()) {
  const t = Date.parse(ts || '')
  return Number.isFinite(t) ? Math.floor((now - t) / DAY) : null
}

const EMPTY_NEW = { title: '', metricId: '', suspectedCause: '', severity: 'medium', originalValue: '' }

export default function ConsoleCorrectionCenter() {
  const [country, setCountry] = useState('All')
  const [status, setStatus] = useState('all')
  const [state, setState] = useState({ loading: true, error: null, cases: [], at: null })
  const [tab, setTab] = useUrlTab(TABS, 'cases')
  const [flash, setFlash] = useState(null)

  // Create modal
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(EMPTY_NEW)
  const [busyNew, setBusyNew] = useState(false)

  // Detail modal
  const [detail, setDetail] = useState(null)   // { case, events, loading, error }
  const [edit, setEdit] = useState({ root_cause_category: '', proposed_action: '', corrected_value: '' })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmReject, setConfirmReject] = useState(false)
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const cases = await listCorrectionCases({ country, status })
      setState({ loading: false, error: null, cases: cases || [], at: new Date() })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), cases: [], at: null })
    }
  }, [country, status])

  useEffect(() => { load() }, [load])

  const cases = useMemo(() => state.cases || [], [state.cases])
  const stats = useMemo(() => {
    const open = cases.filter((c) => !TERMINAL.has(c.status))
    return {
      total: cases.length,
      open: open.length,
      awaiting: cases.filter((c) => c.status === 'proposed').length,
      urgent: open.filter((c) => ['critical', 'high'].includes(String(c.severity || '').toLowerCase())).length,
      closed: cases.filter((c) => c.status === 'closed' || c.status === 'reconciled').length,
    }
  }, [cases])
  const filtered = useMemo(() => {
    const sevOf = (c) => String(c.severity || '').toLowerCase()
    const bySev = !severityFilter ? cases
      : severityFilter === 'urgent' ? cases.filter((c) => !TERMINAL.has(c.status) && ['critical', 'high'].includes(sevOf(c)))
        : cases.filter((c) => sevOf(c) === severityFilter)
    return searchRows(bySev, search, ['case_no', 'title', 'metric_id', 'suspected_cause'])
  }, [cases, search, severityFilter])
  const { sort, onSort } = useTableSort({ key: 'created_at', dir: 'desc' })
  const sorted = useMemo(() => sortRows(filtered, sort, ACCESSORS), [filtered, sort])
  const paged = usePaged(sorted, 25)

  // ── insights ──
  const openCases = useMemo(() => cases.filter((c) => !TERMINAL.has(c.status)), [cases])
  const stale = useMemo(() => openCases.filter((c) => (ageDays(c.created_at) ?? 0) > STALE_DAYS), [openCases])
  const byStatus = useMemo(() => CASE_STATUSES
    .map((s) => ({ label: CASE_STATUS_LABEL[s] || s, value: cases.filter((c) => c.status === s).length }))
    .filter((b) => b.value > 0), [cases])
  const byRootCause = useMemo(() => {
    const m = new Map()
    for (const c of cases) {
      const k = c.root_cause_category || 'Not yet identified'
      m.set(k, (m.get(k) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value }))
  }, [cases])
  const byMetric = useMemo(() => {
    const m = new Map()
    for (const c of openCases) {
      if (!c.metric_id) continue
      m.set(c.metric_id, (m.get(c.metric_id) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))
  }, [openCases])
  const attention = useMemo(() => {
    const out = []
    const urgent = openCases.filter((c) => ['critical', 'high'].includes(String(c.severity || '').toLowerCase()))
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    if (urgent.length) {
      const c = urgent[0]
      out.push({ key: 'urgent', tone: 'danger', title: `${urgent.length} critical or high case${urgent.length === 1 ? '' : 's'} open`,
        detail: `Oldest: ${c.case_no || ''} ${c.title || ''}`.trim(), action: { label: 'Open oldest', onClick: () => { setFlash(null); openDetail(c) } } })
    }
    if (stats.awaiting) {
      out.push({ key: 'awaiting', tone: 'warning', title: `${stats.awaiting} proposed fix${stats.awaiting === 1 ? '' : 'es'} awaiting approval`,
        detail: 'A proposal nobody approves blocks the fix.', action: { label: 'Show them', onClick: () => { setStatus('proposed'); setTab('cases') } } })
    }
    if (stale.length) {
      out.push({ key: 'stale', tone: 'warning', title: `${stale.length} open case${stale.length === 1 ? '' : 's'} older than ${STALE_DAYS} days`,
        detail: 'Open the oldest and move it forward or reject it.', action: { label: 'Open oldest', onClick: () => {
          const c = [...stale].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0]
          setFlash(null); openDetail(c)
        } } })
    }
    return out
  }, [openCases, stale, stats.awaiting]) // eslint-disable-line react-hooks/exhaustive-deps

  const submitNew = async () => {
    if (!form.title.trim()) return
    setBusyNew(true)
    try {
      const res = await openCorrectionCase({
        title: form.title.trim(),
        metricId: form.metricId.trim() || null,
        country,
        suspectedCause: form.suspectedCause.trim() || null,
        severity: form.severity,
        originalValue: form.originalValue.trim() === '' ? null : form.originalValue.trim(),
      })
      setFlash({ tone: 'ok', text: `Opened case ${res.case_no || ''}. The value is frozen; investigate before proposing a fix.` })
      setCreating(false)
      setForm(EMPTY_NEW)
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusyNew(false)
    }
  }

  const openDetail = async (row) => {
    setDetail({ case: row, events: [], loading: true, error: null })
    setNote('')
    try {
      const { case: kase, events } = await getCorrectionCase(row.id)
      const c = kase || row
      setDetail({ case: c, events, loading: false, error: null })
      setEdit({
        root_cause_category: c.root_cause_category || '',
        proposed_action: c.proposed_action || '',
        corrected_value: c.corrected_value == null ? '' : String(c.corrected_value),
      })
    } catch (e) {
      setDetail({ case: row, events: [], loading: false, error: toUserMessage(e) })
    }
  }

  const saveEdit = async () => {
    if (!detail?.case) return
    setBusy('save')
    try {
      const patch = {
        root_cause_category: edit.root_cause_category || null,
        proposed_action: edit.proposed_action.trim() || null,
        corrected_value: edit.corrected_value.trim() === '' ? null : edit.corrected_value.trim(),
      }
      await updateCorrectionCase(detail.case.id, patch)
      setFlash({ tone: 'ok', text: 'Case updated.' })
      await openDetail({ ...detail.case, ...patch })
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  const doTransition = async (toStatus, confirmed = false) => {
    if (!detail?.case) return
    if (toStatus === 'rejected' && !confirmed) { setConfirmReject(true); return }
    setConfirmReject(false)
    setBusy(`t:${toStatus}`)
    try {
      await transitionCorrectionCase(detail.case.id, toStatus, note.trim() || null)
      setFlash({ tone: 'ok', text: `Case moved to ${CASE_STATUS_LABEL[toStatus] || toStatus}.` })
      setNote('')
      await openDetail({ ...detail.case, status: toStatus })
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  const kase = detail?.case
  const context = kase?.dashboard_context && typeof kase.dashboard_context === 'object' ? kase.dashboard_context : null

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ClipboardList}
        title="Correction and Investigation Center"
        purpose="Do not edit a dashboard total directly. Open a case: freeze the value, investigate, propose, approve, apply, reconcile and close, with full history and rollback."
        refreshedAt={state.at}
        onRefresh={load}
        refreshing={state.loading}
        actions={<>
          <Select ariaLabel="Country" value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-40" />
          <Select ariaLabel="Case status" value={status} onChange={setStatus} options={STATUS_FILTER_OPTS} className="w-44" />
          <Btn variant="primary" icon={Plus} onClick={() => { setForm(EMPTY_NEW); setFlash(null); setCreating(true) }}>New case</Btn>
        </>}
      />

      {flash && (
        <div role="status">
          <Note icon={flash.tone === 'ok' ? Check : AlertTriangle} tone={flash.tone === 'ok' ? 'accent' : 'danger'}>
            {flash.text}
          </Note>
        </div>
      )}

      {!state.loading && !state.error && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Open cases" value={stats.open.toLocaleString()} icon={FolderOpen} tone={stats.open ? 'accent' : 'default'}
            sub={`${stats.total.toLocaleString()} cases in view`}
            onClick={() => { setStatus('all'); setSeverityFilter(''); setTab('cases') }} active={status === 'all' && !severityFilter && tab === 'cases'} />
          <StatTile label="Awaiting approval" value={stats.awaiting.toLocaleString()} icon={Hourglass} tone={stats.awaiting ? 'warning' : 'default'}
            onClick={() => setStatus((v) => (v === 'proposed' ? 'all' : 'proposed'))} active={status === 'proposed'} />
          <StatTile label="Critical or high, open" value={stats.urgent.toLocaleString()} icon={Flame} tone={stats.urgent ? 'danger' : 'default'}
            onClick={() => { setSeverityFilter((v) => (v === 'urgent' ? '' : 'urgent')); setTab('cases') }} active={severityFilter === 'urgent'} />
          <StatTile label="Closed or reconciled" value={stats.closed.toLocaleString()} icon={CheckCircle2} tone={stats.closed ? 'good' : 'default'}
            onClick={() => { setStatus((v) => (v === 'closed' ? 'all' : 'closed')); setTab('cases') }} active={status === 'closed'} />
        </div>
      )}

      {!state.loading && !state.error && cases.length > 0 && <AttentionList items={attention} />}

      {state.error && <Panel><ErrorState message={state.error} onRetry={load} /></Panel>}

      <Segmented ariaLabel="Correction center views" value={tab} onChange={setTab} options={[
        { key: 'cases', label: 'Cases', count: state.loading || state.error ? undefined : cases.length },
        { key: 'insights', label: 'Insights' },
      ]} />

      {tab === 'insights' && (
        state.loading ? <LoadingState label="Reading correction cases" rows={3} /> : state.error ? null : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel>
              <PanelHeader icon={BarChart3} title="Cases by status" subtitle="Where the cases in view sit in the flow." />
              <BarsChart bars={byStatus} summary={byStatus.length ? `${stats.open} open of ${stats.total} cases.` : undefined} emptyText="No cases in view." />
            </Panel>
            <Panel>
              <PanelHeader icon={AlertTriangle} title="Root causes" subtitle="What investigations concluded. Repeats point at a process to fix, not a number." />
              <BarsChart bars={byRootCause} summary={byRootCause.length ? `Most common: ${byRootCause[0].label}.` : undefined} emptyText="No cases in view." />
            </Panel>
            <Panel className="lg:col-span-2">
              <PanelHeader icon={ClipboardList} title="Open cases by metric" subtitle="A metric with several open cases deserves a look at its definition in the Metric Catalogue." />
              <BarsChart bars={byMetric} emptyText="No open case names a metric." />
              <p className="text-[11px] text-gray-500 mt-2">
                <a href="/console/metric-catalogue" className="text-orange-300 hover:text-orange-200 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">Open the Metric Catalogue</a>
              </p>
            </Panel>
          </div>
        )
      )}

      {tab === 'cases' && (
      <Panel>
        <PanelHeader icon={ClipboardList} title="Correction cases"
          subtitle={`Newest first, ${filtered.length.toLocaleString()} of ${cases.length.toLocaleString()} shown. Click a case to investigate and move it forward.`}
          actions={<ExportButtons rows={sorted} columns={EXPORT_COLUMNS} title={`TyrePulse Correction Cases ${country}`} />} />
        <Note>
          A case is governance and audit: it records the decision and the original value. It does not itself mutate
          business tables; apply the actual fix through the linked data tool, then reconcile and close the case here.
        </Note>
        <div className="mb-3" />
        {!state.loading && !state.error && cases.length > 0 && (
          <Toolbar className="mb-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search case no, title or metric" className="w-full sm:w-72" />
            <Select ariaLabel="Filter by severity" value={severityFilter} onChange={setSeverityFilter} placeholder="All severities"
              options={SEVERITY_FILTER_OPTS} className="w-36" />
            {(search || severityFilter) && <Btn variant="quiet" onClick={() => { setSearch(''); setSeverityFilter('') }}>Clear filters</Btn>}
          </Toolbar>
        )}
        {state.loading ? (
          <LoadingState label="Reading correction cases" rows={5} />
        ) : state.error ? (
          <p className="text-xs text-gray-400 px-1">The case list could not be read, so it is not shown. Use Retry above.</p>
        ) : cases.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No correction cases yet"
            reason={status !== 'all' ? 'No case matches this status filter.' : 'When a number looks wrong, open a case here instead of editing the total.'}
          />
        ) : sorted.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No cases match these filters" reason="Clear the search and severity filter to see every case in view." />
        ) : (
          <Table>
            <THead>
              <Th sortKey="case_no" sort={sort} onSort={onSort}>Case no</Th>
              <Th sortKey="title" sort={sort} onSort={onSort}>Title</Th>
              <Th sortKey="metric_id" sort={sort} onSort={onSort}>Metric</Th>
              <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
              <Th sortKey="severity" sort={sort} onSort={onSort}>Severity</Th>
              <Th sortKey="created_at" sort={sort} onSort={onSort}>Created</Th>
            </THead>
            <tbody>
              {paged.pageRows.map((r) => (
                <Tr key={r.id} onClick={() => { setFlash(null); openDetail(r) }}>
                  <Td nowrap><button type="button" onClick={(e) => { e.stopPropagation(); setFlash(null); openDetail(r) }} aria-label={`Open case ${r.case_no || r.title || ''}`} className="font-mono text-gray-300 hover:text-orange-300 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded">{r.case_no || 'N/A'}</button></Td>
                  <Td><span className="text-gray-100">{r.title || 'Untitled'}</span></Td>
                  <Td>{show(r.metric_id)}</Td>
                  <Td><Badge tone={caseStatusTone(r.status)}>{CASE_STATUS_LABEL[r.status] || r.status || 'N/A'}</Badge></Td>
                  <Td>{show(r.severity)}</Td>
                  <Td nowrap>{when(r.created_at)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {!state.loading && !state.error && sorted.length > 0 && <Pager {...paged} label="cases" />}
      </Panel>
      )}

      {/* ── New case ─────────────────────────────────────────────────────────── */}
      <Modal
        open={creating}
        title="Open a correction case"
        subtitle="This freezes the value that is on screen so it cannot be lost while the number is investigated."
        onClose={() => setCreating(false)}
        width="max-w-xl"
        footer={(
          <Toolbar className="justify-end">
            <Btn onClick={() => setCreating(false)}>Cancel</Btn>
            <Btn variant="primary" icon={Plus} onClick={submitNew} busy={busyNew} disabled={!form.title.trim()}>
              Open case
            </Btn>
          </Toolbar>
        )}
      >
        <div className="space-y-3">
          <Field label="Title">
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="What number looks wrong?"
              className={INPUT}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Metric id (optional)">
              <input
                value={form.metricId}
                onChange={(e) => setForm((f) => ({ ...f, metricId: e.target.value }))}
                placeholder="e.g. fleet_cpk"
                className={INPUT}
              />
            </Field>
            <Field label="Severity">
              <Select value={form.severity} onChange={(v) => setForm((f) => ({ ...f, severity: v }))} options={SEVERITY_OPTS} />
            </Field>
          </div>
          <Field label="Original value (optional)">
            <input
              value={form.originalValue}
              onChange={(e) => setForm((f) => ({ ...f, originalValue: e.target.value }))}
              placeholder="The value on screen right now"
              className={INPUT}
            />
          </Field>
          <Field label="Suspected cause (optional)">
            <textarea
              value={form.suspectedCause}
              onChange={(e) => setForm((f) => ({ ...f, suspectedCause: e.target.value }))}
              placeholder="Your first read on why it is wrong"
              rows={2}
              className={INPUT}
            />
          </Field>
          <Note>Country is taken from the filter above ({country}).</Note>
          {flash?.tone === 'bad' && <Note icon={AlertTriangle} tone="danger">{flash.text}</Note>}
        </div>
      </Modal>

      {/* ── Case detail ──────────────────────────────────────────────────────── */}
      <Modal
        open={!!detail}
        title={kase ? `${kase.case_no || 'Case'} - ${kase.title || 'Untitled'}` : 'Case'}
        subtitle={kase ? `${CASE_STATUS_LABEL[kase.status] || kase.status || ''} | ${show(kase.country)}` : ''}
        onClose={() => { setDetail(null); setConfirmReject(false) }}
        width="max-w-3xl"
      >
        {detail?.loading && <LoadingState label="Reading case" rows={4} />}
        {detail?.error && <ErrorState message={detail.error} onRetry={() => openDetail(detail.case)} />}
        {kase && !detail.loading && !detail.error && (
          <div className="space-y-4">
            {/* Save and transition failures land in the page flash, which sits behind this dialog. */}
            {flash?.tone === 'bad' && <Note icon={AlertTriangle} tone="danger">{flash.text}</Note>}
            {/* frozen facts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <KV label="Metric" value={show(kase.metric_id)} />
              <KV label="Severity" value={show(kase.severity)} />
              <KV label="Original value" value={show(kase.original_value)} />
              <KV label="Corrected value" value={show(kase.corrected_value)} />
              <KV label="Created" value={when(kase.created_at)} />
              <KV label="Status" value={CASE_STATUS_LABEL[kase.status] || show(kase.status)} />
            </div>

            {context && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">Frozen dashboard context</p>
                <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {Object.entries(context).map(([k, v]) => (
                    <div key={k} className="flex items-baseline gap-2 text-xs">
                      <span className="text-gray-500 shrink-0">{k}:</span>
                      <span className="text-gray-300 break-all">{typeof v === 'object' ? JSON.stringify(v) : show(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* status stepper */}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">Progress</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {CASE_STATUSES.map((s, i) => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    <Badge tone={s === kase.status ? caseStatusTone(s) : 'quiet'}>
                      {s === kase.status ? <Check size={10} aria-hidden="true" /> : null}
                      {CASE_STATUS_LABEL[s] || s}
                    </Badge>
                    {i < CASE_STATUSES.length - 1 && <ArrowRight size={11} className="text-gray-600" aria-hidden="true" />}
                  </span>
                ))}
              </div>
            </div>

            {/* investigation edit */}
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-300">Investigation</p>
              <Field label="Root cause">
                <Select
                  value={edit.root_cause_category}
                  onChange={(v) => setEdit((e) => ({ ...e, root_cause_category: v }))}
                  options={ROOT_CAUSE_OPTS}
                  placeholder="Not set"
                />
              </Field>
              <Field label="Proposed action">
                <textarea
                  value={edit.proposed_action}
                  onChange={(e) => setEdit((s) => ({ ...s, proposed_action: e.target.value }))}
                  placeholder="What should be done to fix it, in the linked data tool"
                  rows={2}
                  className={INPUT}
                />
              </Field>
              <Field label="Corrected value">
                <input
                  value={edit.corrected_value}
                  onChange={(e) => setEdit((s) => ({ ...s, corrected_value: e.target.value }))}
                  placeholder="The value it should be"
                  className={INPUT}
                />
              </Field>
              <Toolbar className="justify-end">
                <Btn variant="primary" icon={Check} onClick={saveEdit} busy={busy === 'save'}>Save</Btn>
              </Toolbar>
            </div>

            {/* transitions */}
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-300">Move this case forward</p>
              {nextStatuses(kase.status).length === 0 ? (
                <Note>This case is in a terminal state. There is no next step.</Note>
              ) : (
                <>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    aria-label="Note for this step (optional)"
                    placeholder="Note for this step (optional)"
                    className={INPUT}
                  />
                  {confirmReject && (
                    <Note icon={AlertTriangle} tone="danger">
                      <p>Reject this case? It becomes terminal and cannot be moved forward again.</p>
                      <Toolbar className="mt-2 justify-end">
                        <Btn onClick={() => setConfirmReject(false)}>Keep it open</Btn>
                        <Btn variant="danger" onClick={() => doTransition('rejected', true)} busy={busy === 't:rejected'}>Yes, reject case</Btn>
                      </Toolbar>
                    </Note>
                  )}
                  <Toolbar className="justify-end">
                    {nextStatuses(kase.status).map((s) => (
                      <Btn
                        key={s}
                        variant={s === 'rejected' ? 'danger' : 'primary'}
                        icon={ArrowRight}
                        onClick={() => doTransition(s)}
                        busy={busy === `t:${s}`}
                        disabled={!!busy && busy !== `t:${s}`}
                      >
                        {CASE_STATUS_LABEL[s] || s}
                      </Btn>
                    ))}
                  </Toolbar>
                </>
              )}
            </div>

            {/* timeline */}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">History</p>
              {detail.events.length === 0 ? (
                <Note>No events recorded yet.</Note>
              ) : (
                <Table>
                  <THead>
                    <Th>Event</Th>
                    <Th>Change</Th>
                    <Th>Note</Th>
                    <Th>When</Th>
                  </THead>
                  <tbody>
                    {detail.events.map((ev, i) => (
                      <Tr key={`${ev.event_type || 'ev'}:${ev.created_at || i}:${i}`}>
                        <Td>{show(ev.event_type)}</Td>
                        <Td nowrap>
                          {ev.from_status || ev.to_status
                            ? <span className="text-gray-400">{show(ev.from_status)} <ArrowRight size={10} className="inline" aria-label="to" /> {show(ev.to_status)}</span>
                            : <span className="text-gray-400">N/A</span>}
                        </Td>
                        <Td>{show(ev.note)}</Td>
                        <Td nowrap>{when(ev.created_at)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

const INPUT = 'w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

function KV({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-sm text-gray-200 mt-0.5 break-all">{value}</p>
    </div>
  )
}
