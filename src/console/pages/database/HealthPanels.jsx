/**
 * The smaller Health-tab panels of the Database Center. Each one takes a
 * loader result ({data, error, loading, reload}) and renders loading, error
 * with Retry, empty with a reason, or the figures. Nothing is invented.
 */
import { useMemo, useState } from 'react'
import {
  Network, Gauge, RotateCcw, Lightbulb, Info, Clock3, Play, ShieldCheck, Scale, History, Search, GitBranch, ClipboardList, Download,
} from 'lucide-react'
import {
  Panel, PanelHeader, Badge, Btn, Table, THead, Th, Tr, Td, EmptyState, ErrorState, LoadingState, ImpactBox, ConfirmImpactDialog, Note,
} from '../../components/ui'
import { BarCell, ListRow, MetricRow, PanelFoot, useLoad } from '../runtime/runtimeParts'
import {
  fmtInt, fmtPct, fmtRiyadh, connectionSummary, shapeQueryTime, shapeFreshness, trustTone, daysSince, migrationTime,
} from '../../../lib/databaseCenter'
import { resetQueryCounters } from '../../../lib/api/databaseCenter'
import { runQualityChecks, runReconciliation } from '../../../lib/api/dataTrustOps'
import { shapeQualityResults, qualitySummary, shapeReconciliation } from '../../../lib/dataTrustOps'
import { exportConsoleRows } from '../../../lib/consoleTable'
import { toUserMessage } from '../../../lib/safeError'

const nfMs = (v) => (v == null ? 'N/A' : `${Number(v).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ms`)

export function ConnectionsPanel({ overview }) {
  const c = connectionSummary(overview.data?.connections)
  const cache = overview.data?.cache_hit_pct
  return (
    <Panel flush>
      <div className="p-4 pb-2">
        <PanelHeader icon={Network} title="Connections"
          subtitle={c ? `${c.label}, ${c.busy} busy, limit ${c.max ?? 'N/A'}` : 'Open database connections'}
          actions={c ? <Badge tone={c.tone}>{c.total} open</Badge> : null} />
      </div>
      {overview.loading && !overview.data ? <div className="px-4 pb-4"><LoadingState label="Reading connections" rows={2} /></div>
        : overview.error ? <div className="px-4 pb-4"><ErrorState message={overview.error} onRetry={overview.reload} /></div>
          : c && (
            <>
              <div className="px-4 pb-2">
                <div className="flex h-3 rounded-md overflow-hidden bg-gray-800" role="img"
                  aria-label={`${c.idle} idle, ${c.background} background, ${c.busy} busy of ${c.max}`}>
                  <div className="bg-gray-500" style={{ width: `${c.max ? c.idle / c.max * 100 : 0}%` }} />
                  <div className="bg-blue-500" style={{ width: `${c.max ? c.background / c.max * 100 : 0}%` }} />
                  <div className="bg-emerald-500" style={{ width: `${c.max ? c.busy / c.max * 100 : 0}%` }} />
                </div>
              </div>
              <ul className="divide-y divide-gray-800/70">
                <ListRow tone="default" title="Idle, waiting" right={<span className="text-xs tabular-nums text-gray-300">{c.idle}</span>} />
                <ListRow tone="info" title="Background workers" right={<span className="text-xs tabular-nums text-gray-300">{c.background}</span>} />
                <ListRow tone="good" title="Busy now" right={<span className="text-xs tabular-nums text-gray-300">{c.busy}</span>} />
              </ul>
              <MetricRow items={[
                { label: 'Memory cache hits', value: fmtPct(cache, 2), tone: cache != null && cache < 99 ? 'warning' : undefined, sub: 'aim for 99% or more' },
                { label: 'Room left', value: c.max == null ? 'N/A' : `${c.free} of ${c.max}`, sub: 'connections free right now' },
              ]} />
            </>
          )}
    </Panel>
  )
}

export function QueryTimePanel({ query, onChanged }) {
  const q = useMemo(() => shapeQueryTime(query.data), [query.data])
  const [dlg, setDlg] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [shape, setShape] = useState(null)
  const top = q.rows[0]

  async function reset({ reason }) {
    setBusy(true); setErr('')
    try { await resetQueryCounters(reason); setDlg(false); onChanged?.() } catch (e) { setErr(toUserMessage(e, 'The counters could not be reset.')) } finally { setBusy(false) }
  }
  async function exportRows() {
    await exportConsoleRows({
      rows: q.rows.map((r) => ({ ...r, avg: nfMs(r.meanMs), total: nfMs(r.totalMs), share: fmtPct(r.share) })),
      title: 'Where database time goes',
      columns: [{ key: 'label', header: 'Work' }, { key: 'calls', header: 'Times run' }, { key: 'avg', header: 'Average' },
        { key: 'total', header: 'Total time' }, { key: 'share', header: 'Share of DB time' }, { key: 'shape', header: 'Query shape' }],
    })
  }
  return (
    <Panel flush>
      <div className="p-4 pb-3">
        <PanelHeader icon={Gauge} title="Where database time goes"
          subtitle={q.since ? `Since ${fmtRiyadh(q.since, { time: true })}, all callers` : 'Top query shapes by total time'}
          actions={(
            <>
              {q.ok && <Badge tone={q.hotSpots ? 'warning' : 'good'}>{q.hotSpots ? `${q.hotSpots} hot spot${q.hotSpots > 1 ? 's' : ''}` : 'No hot spot'}</Badge>}
              <Btn icon={Download} onClick={exportRows} disabled={!q.rows.length}>Export</Btn>
              <Btn icon={RotateCcw} onClick={() => setDlg(true)} disabled={!q.ok}>Reset counters</Btn>
            </>
          )} />
      </div>
      {err && <div className="px-4 pb-2"><ErrorState message={err} /></div>}
      {query.loading && !query.data ? <div className="px-4 pb-4"><LoadingState label="Reading query counters" rows={5} /></div>
        : query.error ? <div className="px-4 pb-4"><ErrorState message={query.error} onRetry={query.reload} /></div>
          : !q.ok ? <EmptyState title="Query counters not available" reason="The pg_stat_statements extension could not be read, so this panel reads N/A." />
            : !q.rows.length ? <EmptyState title="No work counted yet" reason="The counters were reset recently. Check back after some use." />
              : (
                <Table className="border-0 rounded-none">
                  <THead><Th>Work (plain English)</Th><Th align="right">Times run</Th><Th align="right">Average</Th><Th>Share of all DB time</Th></THead>
                  <tbody>
                    {q.rows.slice(0, 10).map((r) => (
                      <Tr key={r.id} onClick={() => setShape(shape?.id === r.id ? null : r)} ariaLabel={`${r.label}, show query shape`}>
                        <Td>
                          <p className="text-xs font-medium text-gray-200">{r.label}</p>
                          {shape?.id === r.id && <p className="mt-1 font-mono text-[10.5px] text-gray-500 break-all">{r.shape}</p>}
                        </Td>
                        <Td align="right" nowrap className="tabular-nums">{fmtInt(r.calls)}</Td>
                        <Td align="right" nowrap className="tabular-nums">{nfMs(r.meanMs)}</Td>
                        <Td><BarCell width="w-28" pct={r.share} label={fmtPct(r.share)} tone={(r.share ?? 0) >= 25 ? 'danger' : (r.meanMs ?? 0) >= 1000 ? 'warning' : 'info'} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
      {top && (
        <PanelFoot icon={Lightbulb}>
          {top.share >= 50
            ? `${fmtPct(top.share, 0)} of all database time is "${top.label}". That is the biggest speed lever.`
            : `The largest single share is ${fmtPct(top.share)}, "${top.label}".`} Sorted by total time, not average, because total is what users feel. Select a row to see its query shape (values are masked).
        </PanelFoot>
      )}
      {q.ok && (
        <div className="px-4 pb-4">
          <ImpactBox what={`Counters have run since ${fmtRiyadh(q.since, { time: true })} and cover the busiest query shapes.`}
            change="Reset clears the counters so the next week can be compared cleanly. No data changes."
            who="Nobody. Only this report starts from zero." undo="No. Past counts are gone; export first." />
        </div>
      )}
      <ConfirmImpactDialog open={dlg} title="Reset query counters" confirmLabel="Reset counters" danger requireReason typedWord="RESET"
        busy={busy} onCancel={() => setDlg(false)} onConfirm={reset}
        impact={{ tone: 'warning', what: 'Clears every query-time counter.', change: 'This report starts from zero. No business data changes.', who: 'Nobody. Only this report and the platform query statistics.', undo: 'No. Export first if you want the current figures.' }} />
    </Panel>
  )
}

export function FreshnessPanel({ fresh }) {
  const f = useMemo(() => shapeFreshness(fresh.data), [fresh.data])
  const silent = f.rows.filter((r) => r.tone === 'danger')
  return (
    <Panel flush>
      <div className="p-4 pb-2">
        <PanelHeader icon={Clock3} title="Data freshness" subtitle="Newest row per core table"
          actions={fresh.data ? <Badge tone={silent.length ? 'danger' : 'good'}>{silent.length ? `${silent.length} feed${silent.length > 1 ? 's' : ''} silent` : 'All feeds recent'}</Badge> : null} />
      </div>
      {fresh.loading && !fresh.data ? <div className="px-4 pb-4"><LoadingState label="Checking the newest rows" rows={4} /></div>
        : fresh.error ? <div className="px-4 pb-4"><ErrorState message={fresh.error} onRetry={fresh.reload} /></div>
          : (
            <ul className="divide-y divide-gray-800/70">
              {f.rows.map((r) => (
                <ListRow key={r.table} tone={r.tone} title={r.label}
                  sub={r.unreadable ? 'Could not be read' : r.lastRowAt ? `Last new row ${fmtRiyadh(r.lastRowAt, { time: true })}` : 'No rows yet'}
                  right={<Badge tone={r.tone}>{r.status}</Badge>} />
              ))}
            </ul>
          )}
      {silent.length > 0 && (
        <PanelFoot icon={Info}>
          {silent.map((s) => s.label).join(', ')} {silent.length > 1 ? 'have' : 'has'} had no new rows for {silent[0].days} days, so reports that use {silent.length > 1 ? 'them' : 'it'} are incomplete from then on. Upload coverage alerts live in Operations.
        </PanelFoot>
      )}
    </Panel>
  )
}

const QUALITY_MEANING = {
  tyre_unpriced: 'Cost per km for these reads N/A',
  tyre_removal_reason_gap: 'Removal analysis is thinner',
  vehicle_type_gap: 'They fall out of per-type reports',
  tyre_brand_gap: 'Brand ranking excludes them',
  tyre_size_gap: 'Size forecasts exclude them',
}

export function QualityPanel({ quality, rules, onChanged, onOpen }) {
  const shaped = useMemo(() => shapeQualityResults(quality.data || []), [quality.data])
  const sum = qualitySummary(shaped)
  const ruleMap = useMemo(() => Object.fromEntries((rules.data || []).map((r) => [r.rule_key, r])), [rules.data])
  const last = shaped.reduce((m, r) => (r.checkedAt && (!m || r.checkedAt > m) ? r.checkedAt : m), null)
  const age = daysSince(last)
  const [dlg, setDlg] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function run() {
    setBusy(true); setErr('')
    try { await runQualityChecks(null); setDlg(false); onChanged?.() } catch (e) { setErr(toUserMessage(e, 'The checks could not run.')) } finally { setBusy(false) }
  }
  const needs = sum.fail + sum.warn
  return (
    <Panel flush>
      <div className="p-4 pb-3">
        <PanelHeader icon={ShieldCheck} title="Data quality checks"
          subtitle={last ? `Last run ${fmtRiyadh(last)}, ${age} ${age === 1 ? 'day' : 'days'} ago` : 'Never run'}
          actions={(
            <>
              {quality.data && <Badge tone={needs ? 'warning' : 'good'}>{needs} of {sum.total} need a look</Badge>}
              <Btn variant="primary" icon={Play} onClick={() => setDlg(true)}>Run all checks now</Btn>
            </>
          )} />
      </div>
      {err && <div className="px-4 pb-2"><ErrorState message={err} /></div>}
      {quality.loading && !quality.data ? <div className="px-4 pb-4"><LoadingState label="Reading the last checks" rows={4} /></div>
        : quality.error ? <div className="px-4 pb-4"><ErrorState message={quality.error} onRetry={quality.reload} /></div>
          : !shaped.length ? <EmptyState title="No check has run yet" reason="Run the checks to count data gaps." />
            : (
              <Table className="border-0 rounded-none">
                <THead><Th>Result</Th><Th>Finding</Th><Th>What it means</Th><Th><span className="sr-only">Fix</span></Th></THead>
                <tbody>
                  {shaped.map((r) => (
                    <Tr key={r.ruleKey}>
                      <Td nowrap><Badge tone={r.status === 'pass' ? 'good' : r.status === 'fail' ? 'danger' : 'warning'}>{r.status === 'pass' ? 'Pass' : 'Check'}</Badge></Td>
                      <Td className="text-gray-200">{r.message || ruleMap[r.ruleKey]?.name || r.ruleKey}</Td>
                      <Td className="text-gray-500">{r.status === 'pass' ? 'Clean' : QUALITY_MEANING[r.ruleKey] || ruleMap[r.ruleKey]?.description || 'N/A'}</Td>
                      <Td align="right">{r.status !== 'pass' && <Btn size="xs" variant="quiet" onClick={() => onOpen?.('quality')}>Fix</Btn>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
      <div className="p-4">
        <ImpactBox what={age != null && age > 7 ? `Checks last ran ${age} days ago, so these counts are stale.` : 'Counts from the last run.'}
          change={`Running now re-counts all ${sum.total || 10} checks. It reads only; no data changes.`}
          who="Nobody. Results are visible to super admins." undo="Nothing to undo: it only reads." />
      </div>
      <ConfirmImpactDialog open={dlg} title="Run all data checks" confirmLabel="Run checks" busy={busy}
        onCancel={() => setDlg(false)} onConfirm={run}
        impact={{ what: 'Re-counts every data quality check across all countries.', change: 'New results are recorded. No business data changes.', who: 'Nobody.', undo: 'Nothing to undo: it only reads.' }} />
    </Panel>
  )
}

export function TrustPanel({ trust, onOpen }) {
  const overall = trust.data?.ok ? Object.values(trust.data.overall || {}) : []
  const weakest = overall.filter((d) => d.score != null).sort((a, b) => a.score - b.score)[0]
  return (
    <Panel flush>
      <div className="p-4 pb-2">
        <PanelHeader icon={ShieldCheck} title="Trust scores" subtitle="0 to 100, from the latest Data Trust measures"
          actions={<Btn size="xs" onClick={() => onOpen?.('control')}>Open</Btn>} />
      </div>
      {trust.loading && !trust.data ? <div className="px-4 pb-4"><LoadingState label="Scoring" rows={4} /></div>
        : trust.error ? <div className="px-4 pb-4"><ErrorState message={trust.error} onRetry={trust.reload} /></div>
          : !overall.length ? <EmptyState title="Scores not available" reason="The trust measures could not be read, so every score reads N/A." />
            : (
              <ul className="divide-y divide-gray-800/70">
                {overall.map((d) => {
                  const t = trustTone(d.score)
                  return (
                    <ListRow key={d.key} title={d.label} right={<Badge tone={t.tone}>{t.label}</Badge>}>
                      <div className="mt-1"><BarCell width="w-40" pct={d.score ?? 0} label={d.score == null ? 'N/A' : `${d.score} / 100`} tone={t.tone === 'good' ? 'good' : t.tone === 'warning' ? 'warning' : 'danger'} /></div>
                    </ListRow>
                  )
                })}
              </ul>
            )}
      {weakest && <PanelFoot>Each score lists its reasons on the Data trust tab. Weakest: {weakest.label}.</PanelFoot>}
    </Panel>
  )
}

export function ReconPanel({ recon, dupCount, cases, alerts, onChanged, onOpen }) {
  const shaped = useMemo(() => shapeReconciliation(recon.data || []), [recon.data])
  const last = shaped.reduce((m, r) => (r.runAt && (!m || r.runAt > m) ? r.runAt : m), null)
  const [dlg, setDlg] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function run() {
    setBusy(true); setErr('')
    try { await runReconciliation(null); setDlg(false); onChanged?.() } catch (e) { setErr(toUserMessage(e, 'Reconciliation could not run.')) } finally { setBusy(false) }
  }
  const openCases = Array.isArray(cases.data) ? cases.data.filter((c) => !['closed', 'rejected', 'reconciled'].includes(c.status)).length : null
  const openAlerts = Array.isArray(alerts.data) ? alerts.data.filter((a) => a.status === 'open').length : null
  const resolved = Array.isArray(alerts.data) ? alerts.data.filter((a) => a.status !== 'open').length : null
  const fmtVal = (v, unit) => (v == null ? 'N/A' : `${unit === 'SAR' ? 'SAR ' : ''}${Number(v).toLocaleString('en-US')}${unit && unit !== 'SAR' ? ` ${unit}` : ''}`)
  return (
    <Panel flush>
      <div className="p-4 pb-2">
        <PanelHeader icon={Scale} title="Reconciliation" subtitle={last ? `Last run ${fmtRiyadh(last)}` : 'Never run'}
          actions={<Btn icon={Play} onClick={() => setDlg(true)}>Run</Btn>} />
      </div>
      {err && <div className="px-4 pb-2"><ErrorState message={err} /></div>}
      {recon.loading && !recon.data ? <div className="px-4 pb-4"><LoadingState label="Reading reconciliation" rows={3} /></div>
        : recon.error ? <div className="px-4 pb-4"><ErrorState message={recon.error} onRetry={recon.reload} /></div>
          : !shaped.length ? <EmptyState title="No reconciliation yet" reason="Run it to compare totals across tables." />
            : (
              <ul className="divide-y divide-gray-800/70">
                {shaped.map((r) => (
                  <ListRow key={r.reconKey} tone={r.status === 'balanced' ? 'good' : 'warning'} title={r.label}
                    sub={r.status === 'balanced' ? `${fmtVal(r.actual, r.unit)} both sides` : `Expected ${fmtVal(r.expected, r.unit)}, found ${fmtVal(r.actual, r.unit)}`}
                    right={<Badge tone={r.status === 'balanced' ? 'good' : 'warning'}>{r.status === 'balanced' ? 'Balanced' : 'Variance'}</Badge>} />
                ))}
              </ul>
            )}
      <MetricRow items={[
        { label: 'Duplicates removed', value: fmtInt(dupCount.data), sub: dupCount.error ? 'could not count' : 'archived, undoable' },
        { label: 'Correction cases', value: openCases == null ? 'N/A' : fmtInt(openCases), sub: 'open' },
        { label: 'Trust alerts', value: openAlerts == null ? 'N/A' : fmtInt(openAlerts), sub: resolved == null ? 'open' : `open, ${resolved} resolved` },
      ]} />
      <div className="flex flex-wrap gap-2 px-4 py-2 border-t border-gray-800">
        <Btn size="xs" onClick={() => onOpen?.('recon')}>Open reconciliation</Btn>
        <Btn size="xs" onClick={() => onOpen?.('cases')}>Open cases</Btn>
      </div>
      <ConfirmImpactDialog open={dlg} title="Run reconciliation" confirmLabel="Run" busy={busy}
        onCancel={() => setDlg(false)} onConfirm={run}
        impact={{ what: 'Compares totals across tables (job card cost, tyre assets, production).', change: 'New results are recorded. No business data changes.', who: 'Nobody.', undo: 'Nothing to undo: it only reads.' }} />
    </Panel>
  )
}

export function MigrationsPanel({ overview, full = false }) {
  const m = overview.data?.migrations
  const list = (m?.latest || []).slice(0, full ? 12 : 5)
  return (
    <Panel flush>
      <div className="p-4 pb-3">
        <PanelHeader icon={History} title="Latest migrations"
          subtitle={m ? `${fmtInt(m.total)} applied in total, ${fmtInt(m.today)} today, latest ${list.length} shown` : 'Database structure changes'} />
      </div>
      {overview.loading && !overview.data ? <div className="px-4 pb-4"><LoadingState label="Reading migrations" rows={3} /></div>
        : overview.error ? <div className="px-4 pb-4"><ErrorState message={overview.error} onRetry={overview.reload} /></div>
          : !m ? <EmptyState title="Migration history not readable" reason="The migrations list could not be read from here, so it reads N/A." />
            : (
              <Table className="border-0 rounded-none">
                <THead><Th>Version</Th><Th>What changed</Th><Th>When (Riyadh)</Th><Th>State</Th></THead>
                <tbody>
                  {list.map((x) => (
                    <Tr key={x.version}>
                      <Td className="font-mono text-[11px]" nowrap>{x.version}</Td>
                      <Td className="text-gray-200">{String(x.name || '').replace(/_/g, ' ')}</Td>
                      <Td nowrap>{migrationTime(x.version)}</Td>
                      <Td><Badge tone="good">Applied</Badge></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
      <PanelFoot>Migrations change the database structure. They are applied by engineering, never from this page.</PanelFoot>
    </Panel>
  )
}

export function BrowserTeaser({ onOpen }) {
  return (
    <Panel>
      <PanelHeader icon={Search} title="Data browser" subtitle="14 approved tables. Pick, filter, export. No code."
        actions={<><Badge>Read only</Badge><Btn variant="primary" onClick={() => onOpen('browser')}>Open data browser</Btn></>} />
      <Note icon={ShieldCheck}>Typed SQL is not offered here on purpose. Every read goes through an approved list of tables and is logged. Editing one row is kept, with undo, in the row menu.</Note>
    </Panel>
  )
}

export function LineageLinks({ assets, cases, onOpen }) {
  const openCases = Array.isArray(cases.data) ? cases.data.filter((c) => !['closed', 'rejected', 'reconciled'].includes(c.status)).length : null
  return (
    <Panel flush>
      <div className="p-4 pb-2"><PanelHeader icon={GitBranch} title="Lineage and corrections" subtitle="Where a number comes from, and fixes in progress" /></div>
      <div className="grid gap-px bg-gray-800 border-t border-gray-800 sm:grid-cols-2">
        <div className="bg-gray-950/40 flex items-center gap-3 px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-200">Explain a number</p>
            <p className="text-[11px] text-gray-500">Trace a KPI back to its tables and uploads. {Array.isArray(assets.data) ? `${fmtInt(assets.data.length)} data sources mapped.` : 'Source count N/A.'}</p>
          </div>
          <Btn size="xs" icon={GitBranch} onClick={() => onOpen('lineage')}>Open lineage</Btn>
        </div>
        <div className="bg-gray-950/40 flex items-center gap-3 px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-200">Correction cases</p>
            <p className="text-[11px] text-gray-500">{openCases == null ? 'Open count N/A.' : `${fmtInt(openCases)} open.`} Records the original value and who approved the fix.</p>
          </div>
          <Btn size="xs" icon={ClipboardList} onClick={() => onOpen('cases')}>Open cases</Btn>
        </div>
      </div>
    </Panel>
  )
}

export { useLoad }
