/**
 * ConsoleReconciliation.jsx - the Reconciliation Center.
 *
 * Expected vs actual across cost, fleet and production, with the difference and
 * where to investigate. A reconciliation that balances is quiet; one with a
 * variance carries the exact gap and a drilldown into the rows behind it.
 *
 * Running a reconciliation computes and stores the runs server-side; this page
 * reads them back. Nothing runs on load - a person presses "Run reconciliation
 * now".
 *
 * Layout: header, KPI tiles (click to filter), what needs attention, then tabs
 * (?tab=runs|insights). A row opens a modal with that reconciliation's run
 * history, so the table itself stays one line per reconciliation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Scale, Play, AlertTriangle, CheckCircle2, ExternalLink, ListChecks, Users,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, Toolbar, SearchInput, Segmented, Modal,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { runReconciliation, listReconciliationRuns } from '../../lib/api/dataTrustOps'
import { shapeReconciliation, reconSummary } from '../../lib/dataTrustOps'
import { COUNTRIES } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import { BarsChart, TrendChart, STATUS, useChartTheme } from '../components/ui/charts'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, usePaged, Pager, AttentionList, DetailGrid } from './shared/pageKit'

const nf = new Intl.NumberFormat('en-US')
const num = (v) => (v === null || v === undefined ? 'N/A' : nf.format(Number(v)))

const COUNTRY_OPTS = ['All', ...COUNTRIES].map((c) => ({ value: c, label: c }))

function statusTone(status) {
  if (status === 'balanced') return 'good'
  if (status === 'variance') return 'warning'
  return 'default'
}
function statusLabel(status) {
  if (status === 'balanced') return 'Balanced'
  if (status === 'variance') return 'Variance'
  return status || 'Unknown'
}
/** Zero difference reads calm; any gap is amber and worth a look. */
function differenceClass(diff) {
  if (diff === null || diff === undefined) return 'text-gray-500'
  return Number(diff) === 0 ? 'text-emerald-300' : 'text-amber-300'
}
function drilldownHref(d) {
  if (typeof d !== 'string' || !d) return null
  if (d.startsWith('/') || d.startsWith('http://') || d.startsWith('https://')) return d
  return null
}
/** Difference as a share of what was expected; null when there is nothing to divide by. */
function variancePct(r) {
  if (!r || r.difference === null || r.difference === undefined) return null
  if (!r.expected) return null
  return (Number(r.difference) / Math.abs(Number(r.expected))) * 100
}
const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? 'N/A' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)
const ACCESSORS = {
  absDiff: (r) => (r.difference === null || r.difference === undefined ? null : Math.abs(r.difference)),
  pct: (r) => variancePct(r),
  status: (r) => (r.status === 'variance' ? 0 : r.status === 'balanced' ? 1 : 2),
}

const TABS = ['runs', 'insights']
const EXPORT_COLUMNS = [
  { key: 'label', header: 'Reconciliation' },
  { key: 'expected', header: 'Expected', value: (r) => r.expected ?? 'N/A' },
  { key: 'actual', header: 'Actual', value: (r) => r.actual ?? 'N/A' },
  { key: 'difference', header: 'Difference', value: (r) => r.difference ?? 'N/A' },
  { key: 'variance_pct', header: 'Variance %', value: (r) => fmtPct(variancePct(r)) },
  { key: 'unit', header: 'Unit', value: (r) => r.unit || 'N/A' },
  { key: 'status', header: 'Status', value: (r) => statusLabel(r.status) },
  { key: 'affected', header: 'Affected' },
  { key: 'last_run', header: 'Last run', value: (r) => formatRunAt(r.runAt) },
]

function DrillLink({ href, name }) {
  if (!href) return <span className="text-gray-400 text-xs">N/A</span>
  const internal = href.startsWith('/console')
  return (
    <a
      href={href}
      target={internal ? undefined : '_blank'}
      rel={internal ? undefined : 'noopener noreferrer'}
      aria-label={`Open the rows behind ${name}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-orange-300 hover:text-orange-200 text-xs rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
    >
      <ExternalLink size={12} aria-hidden="true" /> Open
    </a>
  )
}

function formatRunAt(ts) {
  if (!ts) return 'N/A'
  const dt = new Date(ts)
  if (Number.isNaN(dt.getTime())) return 'N/A'
  return dt.toLocaleString()
}

export default function ConsoleReconciliation() {
  const [country, setCountry] = useState('All')
  const [state, setState] = useState({ loading: true, error: null, runs: [], raw: [], at: null })
  const [running, setRunning] = useState(false)
  const [flash, setFlash] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [tab, setTab] = useUrlTab(TABS, 'runs')
  const [detail, setDetail] = useState(null)
  const theme = useChartTheme()

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const raw = await listReconciliationRuns({ country: country === 'All' ? null : country })
      setState({ loading: false, error: null, runs: shapeReconciliation(raw), raw: raw || [], at: new Date() })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), runs: [], raw: [], at: null })
    }
  }, [country])

  useEffect(() => { load() }, [load])

  const runNow = async () => {
    setRunning(true)
    setFlash(null)
    try {
      await runReconciliation(country === 'All' ? null : country)
      const raw = await listReconciliationRuns({ country: country === 'All' ? null : country })
      const fresh = shapeReconciliation(raw)
      setState((s) => ({ ...s, runs: fresh, raw: raw || [], at: new Date() }))
      const sum = reconSummary(fresh)
      setFlash({
        tone: sum.variance > 0 ? 'warning' : 'accent',
        text: sum.total === 0
          ? 'The run finished but stored no reconciliations for this scope.'
          : sum.variance > 0
            ? `${sum.variance} of ${sum.total} reconciliation${sum.total === 1 ? '' : 's'} show a variance.`
            : `All ${sum.total} reconciliation${sum.total === 1 ? '' : 's'} balanced.`,
      })
    } catch (e) {
      setFlash({ tone: 'danger', text: toUserMessage(e) })
    } finally {
      setRunning(false)
    }
  }

  const summary = useMemo(() => reconSummary(state.runs), [state.runs])
  const affectedTotal = useMemo(() => state.runs.reduce((a, r) => a + (r.status === 'variance' ? r.affected || 0 : 0), 0), [state.runs])
  const filtered = useMemo(() => {
    const byStatus = statusFilter ? state.runs.filter((r) => r.status === statusFilter) : state.runs
    return searchRows(byStatus, search, ['label', 'unit', 'reconKey'])
  }, [state.runs, search, statusFilter])
  const { sort, onSort } = useTableSort({ key: 'status', dir: 'asc' })
  const sorted = useMemo(() => sortRows(filtered, sort, ACCESSORS), [filtered, sort])
  const paged = usePaged(sorted, 25)

  const varianceBars = useMemo(() => state.runs
    .filter((r) => r.status === 'variance' && r.difference)
    .map((r) => ({ label: r.label, value: Math.abs(Number(r.difference)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8), [state.runs])

  const attention = useMemo(() => state.runs
    .filter((r) => r.status === 'variance')
    .sort((a, b) => Math.abs(Number(b.difference) || 0) - Math.abs(Number(a.difference) || 0))
    .slice(0, 4)
    .map((r) => ({
      key: r.reconKey,
      tone: 'warning',
      title: `${r.label}: off by ${num(r.difference)}${r.unit ? ` ${r.unit}` : ''} (${fmtPct(variancePct(r))})`,
      detail: `${num(r.affected)} affected records.`,
      action: { label: 'Details', onClick: () => setDetail(r) },
    })), [state.runs])

  // Variance count per run day from the stored history.
  const trend = useMemo(() => {
    const m = new Map()
    for (const r of state.raw) {
      const day = String(r.run_at || '').slice(0, 10)
      if (!day) continue
      const cur = m.get(day) || { variance: 0, balanced: 0 }
      if (r.status === 'variance') cur.variance += 1
      else if (r.status === 'balanced') cur.balanced += 1
      m.set(day, cur)
    }
    const days = [...m.keys()].sort()
    return {
      labels: days,
      series: [
        { label: 'Variance', values: days.map((d) => m.get(d).variance), color: STATUS[theme].medium },
        { label: 'Balanced', values: days.map((d) => m.get(d).balanced), color: STATUS[theme].good },
      ],
    }
  }, [state.raw, theme])

  const history = useMemo(() => {
    if (!detail) return []
    return state.raw.filter((r) => r.recon_key === detail.reconKey)
      .sort((a, b) => String(b.run_at || '').localeCompare(String(a.run_at || '')))
      .slice(0, 20)
  }, [detail, state.raw])

  const header = (
    <PageHeader
      icon={Scale}
      title="Reconciliation Center"
      purpose="Expected vs actual across cost, fleet and production, with the difference and where to investigate."
      refreshedAt={state.at}
      onRefresh={load}
      refreshing={state.loading}
      actions={<>
        <Select ariaLabel="Country" value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-32" />
        <Btn variant="primary" icon={Play} busy={running} disabled={state.loading} onClick={runNow}>Run reconciliation now</Btn>
      </>}
    />
  )

  if (state.loading && !state.at) return <div className="space-y-4">{header}<LoadingState label="Reading reconciliation runs" rows={5} /></div>
  if (state.error) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorState message={state.error} onRetry={load} />
      </div>
    )
  }

  const pickStatus = (v) => { setStatusFilter((cur) => (cur === v ? '' : v)); setTab('runs') }

  return (
    <div className="space-y-4">
      {header}
      {flash && (
        <div role="status">
          <Note icon={flash.tone === 'accent' ? CheckCircle2 : AlertTriangle} tone={flash.tone}>{flash.text}</Note>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Checks" value={num(summary.total)} icon={ListChecks}
          onClick={() => { setStatusFilter(''); setTab('runs') }} active={!statusFilter && tab === 'runs'} />
        <StatTile label="Balanced" value={num(summary.balanced)} tone={summary.balanced ? 'good' : 'default'}
          onClick={() => pickStatus('balanced')} active={statusFilter === 'balanced'} />
        <StatTile label="Variance" value={num(summary.variance)} icon={AlertTriangle} tone={summary.variance ? 'warning' : 'default'}
          onClick={() => pickStatus('variance')} active={statusFilter === 'variance'} />
        <StatTile label="Affected records" value={num(affectedTotal)} icon={Users} tone={affectedTotal ? 'warning' : 'default'}
          sub="Behind reconciliations with a variance" />
      </div>

      {state.runs.length > 0 && (
        <AttentionList items={attention} clearText="Every reconciliation balanced on its latest run." />
      )}

      <Segmented ariaLabel="Reconciliation views" value={tab} onChange={setTab} options={[
        { key: 'runs', label: 'Reconciliation runs', count: state.runs.length },
        { key: 'insights', label: 'Insights' },
      ]} />

      {tab === 'runs' && (
        <Panel>
          <PanelHeader
            icon={Scale}
            title="Reconciliation runs"
            subtitle={`Latest run per reconciliation, ${num(filtered.length)} of ${num(state.runs.length)} shown. Open a row for its run history.`}
            actions={<ExportButtons rows={sorted} columns={EXPORT_COLUMNS} title={`TyrePulse Reconciliation ${country}`} />}
          />
          {state.runs.length > 0 && (
            <Toolbar className="mb-3">
              <SearchInput value={search} onChange={setSearch} placeholder="Search reconciliations" className="w-full sm:w-64" />
              <Select ariaLabel="Filter by status" value={statusFilter} onChange={setStatusFilter} placeholder="All statuses" className="w-36"
                options={[{ value: 'variance', label: 'Variance' }, { value: 'balanced', label: 'Balanced' }]} />
              {(search || statusFilter) && <Btn variant="quiet" onClick={() => { setSearch(''); setStatusFilter('') }}>Clear filters</Btn>}
            </Toolbar>
          )}
          {state.runs.length === 0 ? (
            <EmptyState
              icon={Scale}
              title="No reconciliations have been run yet"
              reason="Press Run reconciliation now to compute and store the current expected-vs-actual runs."
              action={<Btn variant="primary" icon={Play} busy={running} onClick={runNow}>Run reconciliation now</Btn>}
            />
          ) : sorted.length === 0 ? (
            <EmptyState icon={Scale} title="No reconciliations match these filters" reason="Clear the search and filters to see every run." />
          ) : (
            <>
              <Table>
                <THead>
                  <Th sortKey="label" sort={sort} onSort={onSort}>Reconciliation</Th>
                  <Th sortKey="expected" sort={sort} onSort={onSort} align="right">Expected</Th>
                  <Th sortKey="actual" sort={sort} onSort={onSort} align="right">Actual</Th>
                  <Th sortKey="absDiff" sort={sort} onSort={onSort} align="right">Difference</Th>
                  <Th sortKey="pct" sort={sort} onSort={onSort} align="right">Variance</Th>
                  <Th>Unit</Th>
                  <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
                  <Th sortKey="affected" sort={sort} onSort={onSort} align="right">Affected</Th>
                  <Th align="right">Investigate</Th>
                  <Th sortKey="runAt" sort={sort} onSort={onSort}>Last run</Th>
                </THead>
                <tbody>
                  {paged.pageRows.map((r) => (
                    <Tr key={r.reconKey} tone={r.status === 'variance' ? 'warning' : undefined}
                      onClick={() => setDetail(r)} ariaLabel={`Run history for ${r.label}`}>
                      <Td><span className="font-medium text-gray-100">{r.label}</span></Td>
                      <Td align="right" nowrap>{num(r.expected)}</Td>
                      <Td align="right" nowrap>{num(r.actual)}</Td>
                      <Td align="right" nowrap>
                        <span className={`tabular-nums font-medium ${differenceClass(r.difference)}`}>{num(r.difference)}</span>
                      </Td>
                      <Td align="right" nowrap><span className={`tabular-nums ${differenceClass(r.difference)}`}>{fmtPct(variancePct(r))}</span></Td>
                      <Td><span className="text-gray-400">{r.unit || 'N/A'}</span></Td>
                      <Td><Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge></Td>
                      <Td align="right" nowrap>{num(r.affected)}</Td>
                      <Td align="right"><DrillLink href={drilldownHref(r.drilldown)} name={r.label} /></Td>
                      <Td nowrap><span className="text-gray-400 text-[11px]">{formatRunAt(r.runAt)}</span></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <Pager {...paged} label="reconciliations" />
            </>
          )}
        </Panel>
      )}

      {tab === 'insights' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel>
            <PanelHeader icon={AlertTriangle} title="Largest gaps" subtitle="Absolute difference, reconciliations with a variance only." />
            <BarsChart bars={varianceBars} valueFormat={(v) => num(v)}
              summary={varianceBars.length ? `Largest gap: ${varianceBars[0].label} at ${num(varianceBars[0].value)}.` : 'No reconciliation shows a variance.'}
              emptyText="No reconciliation shows a variance." />
          </Panel>
          <Panel>
            <PanelHeader icon={Scale} title="Results per run day" subtitle="From the stored run history. Fewer variances over time means the books are converging." />
            <TrendChart labels={trend.labels} series={trend.series} height={200} area={false}
              summary={trend.labels.length ? `${trend.labels.length} run days on record.` : undefined}
              emptyText="No run history yet. Run a reconciliation to start one." />
          </Panel>
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.label || ''}
        subtitle={detail ? `Latest run ${formatRunAt(detail.runAt)}` : undefined}
        footer={<Btn onClick={() => setDetail(null)}>Close</Btn>}>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(detail.status)}>{statusLabel(detail.status)}</Badge>
              <DrillLink href={drilldownHref(detail.drilldown)} name={detail.label} />
            </div>
            <DetailGrid items={[
              ['Expected', num(detail.expected)],
              ['Actual', num(detail.actual)],
              ['Difference', num(detail.difference)],
              ['Variance', fmtPct(variancePct(detail))],
              ['Unit', detail.unit],
              ['Affected records', num(detail.affected)],
            ]} />
            <div>
              <p className="text-[11px] text-gray-500 mb-1">Recent runs (newest first)</p>
              {history.length === 0 ? (
                <p className="text-xs text-gray-500">No earlier runs are stored for this reconciliation.</p>
              ) : (
                <Table>
                  <THead>
                    <Th>Run</Th><Th align="right">Expected</Th><Th align="right">Actual</Th><Th align="right">Difference</Th><Th>Status</Th>
                  </THead>
                  <tbody>
                    {history.map((h, i) => (
                      <Tr key={`${h.run_at}-${i}`}>
                        <Td nowrap><span className="text-[11px] text-gray-400">{formatRunAt(h.run_at)}</span></Td>
                        <Td align="right">{num(h.expected_value)}</Td>
                        <Td align="right">{num(h.actual_value)}</Td>
                        <Td align="right"><span className={differenceClass(h.difference)}>{num(h.difference)}</span></Td>
                        <Td><Badge tone={statusTone(h.status)}>{statusLabel(h.status)}</Badge></Td>
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
