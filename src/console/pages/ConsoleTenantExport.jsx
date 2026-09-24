/**
 * ConsoleTenantExport.jsx - Tenant Data Export.
 *
 * Export one organisation's full dataset for portability, offboarding or legal
 * hold. The table list and the organisation predicate are enforced server-side
 * (admin_tenant_export_* RPCs, super admin only); every export is recorded with
 * its reason in tenant_export_jobs and in the console audit trail.
 *
 * The page never claims completeness it cannot prove: a failed table, a table
 * cut at the ceiling, or a count that changed mid-export all mark the export
 * PARTIAL, in the file itself and in the job record.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PackageOpen, Building2, FileSpreadsheet, FileJson, History, RefreshCw, CheckCircle2,
  AlertTriangle, XCircle, CheckSquare, Square, ShieldAlert, Database,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, Table, THead, Th, Tr, Td,
  Modal, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { BarsChart } from '../components/ui/charts'
import {
  listExportOrganisations, getExportManifest, exportTableRows, logTenantExport, listExportJobs,
} from '../../lib/api/tenantExport'
import {
  CEILING_OPTIONS, DEFAULT_CEILING, defaultSelection, planExport, validateReason, parseCeiling,
  buildWorkbookSheets, buildJsonBundle, summarizeResults, manifestBars, safeFileStem, MIN_REASON,
} from '../../lib/tenantExport'
import { configNum } from '../../lib/api/systemConfig'
import { exportSheetsToExcel } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

const fmt = (n) => (n == null ? 'N/A' : Number(n).toLocaleString('en-US'))
function fmtWhen(v) {
  if (!v) return 'N/A'
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const STATUS_TONE = { completed: 'good', partial: 'warning', failed: 'danger' }
const STATUS_TEXT = { completed: 'Complete', partial: 'Partial', failed: 'Failed' }
const OUTCOME = {
  complete: { tone: 'good', text: 'Complete', icon: CheckCircle2 },
  truncated: { tone: 'warning', text: 'Truncated', icon: AlertTriangle },
  drifted: { tone: 'warning', text: 'Count changed', icon: AlertTriangle },
  failed: { tone: 'danger', text: 'Failed', icon: XCircle },
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ConsoleTenantExport() {
  const [orgs, setOrgs] = useState([])
  const [orgsErr, setOrgsErr] = useState('')
  const [orgId, setOrgId] = useState('')
  const [manifest, setManifest] = useState(null)
  const [manLoading, setManLoading] = useState(false)
  const [manErr, setManErr] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [ceiling, setCeiling] = useState(String(DEFAULT_CEILING))
  const [jobs, setJobs] = useState([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsErr, setJobsErr] = useState('')

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [format, setFormat] = useState('xlsx')
  const [reason, setReason] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({})
  const [result, setResult] = useState(null)
  const [runErr, setRunErr] = useState('')
  const cancelRef = useRef(false)

  const orgName = useMemo(() => orgs.find((o) => o.id === orgId)?.name || '', [orgs, orgId])

  const loadOrgs = useCallback(async () => {
    setOrgsErr('')
    try { setOrgs(await listExportOrganisations()) } catch (e) { setOrgsErr(toUserMessage(e, 'Could not load organisations.')) }
  }, [])
  const loadJobs = useCallback(async () => {
    setJobsLoading(true); setJobsErr('')
    try { setJobs(await listExportJobs(25)) } catch (e) { setJobsErr(toUserMessage(e, 'Could not load export history.')) } finally { setJobsLoading(false) }
  }, [])
  const loadManifest = useCallback(async (id) => {
    if (!id) { setManifest(null); return }
    setManLoading(true); setManErr(''); setResult(null); setProgress({})
    try {
      const m = await getExportManifest(id)
      setManifest(m)
      setSelected(defaultSelection(m))
    } catch (e) {
      setManifest(null)
      setManErr(toUserMessage(e, 'Could not read the table counts for this organisation.'))
    } finally { setManLoading(false) }
  }, [])

  useEffect(() => { loadOrgs(); loadJobs() }, [loadOrgs, loadJobs])
  useEffect(() => { loadManifest(orgId) }, [orgId, loadManifest])

  const plan = useMemo(() => planExport(manifest, selected, ceiling), [manifest, selected, ceiling])
  const bars = useMemo(() => manifestBars(manifest, 12), [manifest])
  const reasonError = validateReason(reason)

  const toggle = (t) => setSelected((prev) => {
    const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n
  })
  const selectAll = () => setSelected(new Set((manifest?.tables || []).map((t) => t.table)))
  const selectNone = () => setSelected(new Set())

  const openExport = (fmtKey) => { setFormat(fmtKey); setRunErr(''); setConfirmOpen(true) }

  const runExport = async () => {
    if (reasonError || !plan.items.length) return
    setRunning(true); setRunErr(''); setResult(null); cancelRef.current = false
    const results = []
    try {
      for (const item of plan.items) {
        setProgress((p) => ({ ...p, [item.table]: { fetched: 0, state: 'running' } }))
        const r = await exportTableRows(orgId, item.table, {
          expected: item.expected,
          ceiling: parseCeiling(ceiling),
          isCancelled: () => cancelRef.current,
          onProgress: (n) => setProgress((p) => ({ ...p, [item.table]: { fetched: n, state: 'running' } })),
        })
        results.push(r)
        setProgress((p) => ({ ...p, [item.table]: { fetched: r.rows.length, state: 'done' } }))
      }
      const summary = summarizeResults(results)
      let jobId = null
      try {
        jobId = await logTenantExport(orgId, reason.trim(), plan.items.map((i) => i.table), summary.counts, summary.status)
      } catch (e) {
        // The data is already read; refuse to hand it over unrecorded.
        throw new Error(toUserMessage(e, 'The export could not be recorded, so no file was produced.'))
      }
      const stem = safeFileStem(`TyrePulse Tenant Export ${manifest?.orgName || orgName} ${new Date().toISOString().slice(0, 10)}`)
      if (format === 'json') {
        downloadJson(buildJsonBundle({ manifest, results, reason, jobId }), stem)
      } else {
        const wb = buildWorkbookSheets(results, { maxExportRows: configNum('max_export_rows', 0) })
        await exportSheetsToExcel(wb.sheets, stem, {
          title: 'Tenant data export',
          company: manifest?.orgName || orgName,
          meta: { 'Export job': jobId || 'N/A', Reason: reason.trim(), Status: STATUS_TEXT[wb.status] },
          notes: wb.notes.length ? wb.notes : ['Every selected table was exported in full.'],
        })
      }
      setResult({ ...summary, jobId })
      setConfirmOpen(false)
      setReason('')
      loadJobs()
    } catch (e) {
      setRunErr(toUserMessage(e, 'The export did not finish.'))
    } finally {
      setRunning(false)
    }
  }

  const orgOptions = orgs.map((o) => ({ value: o.id, label: `${o.name}${o.active === false ? ' (inactive)' : ''}` }))
  const orgNameById = useMemo(() => Object.fromEntries(orgs.map((o) => [o.id, o.name])), [orgs])

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>
            <PackageOpen size={18} className="text-orange-400" /> Tenant Data Export
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Export one organisation&apos;s full dataset for portability, offboarding or legal hold. Every export is recorded with its reason.
          </p>
        </div>
        <Btn icon={RefreshCw} onClick={() => { loadOrgs(); loadJobs(); if (orgId) loadManifest(orgId) }}>Refresh</Btn>
      </header>

      <ErrorState message={orgsErr} onRetry={loadOrgs} />

      <Panel>
        <PanelHeader icon={Building2} title="Organisation"
          subtitle="Pick the tenant to export. Counts are read live from the database for that organisation only." />
        <div className="flex flex-wrap items-center gap-2">
          <Select className="w-80" value={orgId} onChange={setOrgId} placeholder="Choose an organisation" options={orgOptions} />
          <Select className="w-56" value={ceiling} onChange={setCeiling} options={CEILING_OPTIONS} />
          <span className="text-[11px] text-gray-600">Ceiling per table. A table above it is exported partially and marked truncated.</span>
        </div>
      </Panel>

      {!orgId && !orgsErr && (
        <Panel><EmptyState icon={Building2} title="No organisation chosen" reason="Choose an organisation above to see what it holds." /></Panel>
      )}

      {orgId && manLoading && <Panel><LoadingState label="Counting rows per table" rows={5} /></Panel>}
      {orgId && <ErrorState message={manErr} onRetry={() => loadManifest(orgId)} />}

      {manifest && !manLoading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Rows held" value={fmt(manifest.totalRows)} sub={`across ${manifest.nonEmpty} of ${manifest.tables.length} tables`} icon={Database} />
            <StatTile label="Tables selected" value={fmt(plan.tables)} sub={`${fmt(plan.expectedRows)} rows`} />
            <StatTile label="Rows to export" value={fmt(plan.fetchRows)} sub={`${fmt(plan.pages)} pages of 1,000`} />
            <StatTile label="Will be truncated" value={fmt(plan.truncating.length)}
              tone={plan.truncating.length ? 'warning' : 'default'}
              sub={plan.truncating.length ? 'raise the ceiling for a full export' : 'none at this ceiling'} />
          </div>

          {manifest.unreadable > 0 && (
            <Note icon={AlertTriangle} tone="warning">
              {manifest.unreadable} table(s) could not be counted. They are shown as N/A and are not assumed empty.
            </Note>
          )}

          <div className="grid lg:grid-cols-5 gap-4">
            <Panel className="lg:col-span-2">
              <PanelHeader icon={Database} title="Largest tables" subtitle={`Rows held by ${manifest.orgName}`} />
              <BarsChart bars={bars} valueFormat={fmt}
                summary={`${manifest.orgName} holds ${fmt(manifest.totalRows)} rows across ${manifest.nonEmpty} tables.`}
                emptyText="This organisation holds no rows in any exportable table." />
            </Panel>

            <Panel className="lg:col-span-3" flush>
              <div className="p-4 pb-2">
                <PanelHeader icon={CheckSquare} title="Tables to export"
                  subtitle="Every table carries this organisation's rows only. Empty tables are unticked by default."
                  actions={<>
                    <Btn size="xs" onClick={selectAll}>All</Btn>
                    <Btn size="xs" onClick={selectNone}>None</Btn>
                  </>} />
              </div>
              <div className="max-h-[420px] overflow-y-auto px-4 pb-4">
                <Table>
                  <THead>
                    <Th>Table</Th>
                    <Th align="right">Rows</Th>
                    <Th>Plan</Th>
                    <Th align="right">Progress</Th>
                  </THead>
                  <tbody>
                    {manifest.tables.map((t) => {
                      const on = selected.has(t.table)
                      const planned = plan.items.find((i) => i.table === t.table)
                      const pr = progress[t.table]
                      return (
                        <Tr key={t.table} onClick={() => !running && toggle(t.table)}>
                          <Td>
                            <span className="inline-flex items-center gap-2">
                              {on ? <CheckSquare size={14} className="text-orange-400" /> : <Square size={14} className="text-gray-600" />}
                              <span className="text-gray-200">{t.label}</span>
                              <span className="text-[10px] text-gray-600 font-mono">{t.table}</span>
                            </span>
                          </Td>
                          <Td align="right" nowrap>{t.rows == null ? <Badge tone="danger">N/A</Badge> : fmt(t.rows)}</Td>
                          <Td nowrap>
                            {!on ? <span className="text-gray-600">Skipped</span>
                              : planned?.willTruncate ? <Badge tone="warning">First {fmt(planned.willFetch)}</Badge>
                                : t.rows == null ? <Badge tone="warning">Count unknown</Badge>
                                  : <Badge tone="quiet">Full table</Badge>}
                          </Td>
                          <Td align="right" nowrap>
                            {pr ? `${fmt(pr.fetched)}${pr.state === 'running' ? ' ...' : ''}` : ''}
                          </Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </Table>
              </div>
            </Panel>
          </div>

          <Panel tone="accent">
            <PanelHeader icon={ShieldAlert} title="Export"
              subtitle="Exports are recorded with who ran them, why, and exactly how many rows left the system." />
            <div className="flex flex-wrap gap-2">
              <Btn variant="primary" icon={FileSpreadsheet} disabled={!plan.tables} onClick={() => openExport('xlsx')}>Export as Excel</Btn>
              <Btn icon={FileJson} disabled={!plan.tables} onClick={() => openExport('json')}>Export as JSON</Btn>
            </div>
            <p className="text-[11px] text-gray-600 mt-2">
              JSON keeps every row and nested field. Excel is capped by the max export rows policy and by Excel&apos;s own sheet limit, and says so inside the file when either applies.
            </p>
          </Panel>

          {result && (
            <Panel tone={result.complete ? undefined : 'warning'}>
              <PanelHeader icon={result.complete ? CheckCircle2 : AlertTriangle}
                tone={result.complete ? 'default' : 'warning'}
                title={`Export ${STATUS_TEXT[result.status].toLowerCase()}: ${fmt(result.totalRows)} rows`}
                subtitle={`Recorded as job ${result.jobId || 'N/A'}`} />
              {result.notes.length ? (
                <ul className="space-y-1 mb-3">
                  {result.notes.map((n) => <li key={n} className="text-xs text-amber-200">{n}</li>)}
                </ul>
              ) : <p className="text-xs text-gray-400 mb-3">Every selected table was exported in full and matched its manifest count.</p>}
              <div className="flex flex-wrap gap-1.5">
                {result.per.map((p) => {
                  const o = OUTCOME[p.outcome]
                  return <Badge key={p.table} tone={o.tone} icon={o.icon}>{p.label}: {fmt(p.fetched)} {o.text.toLowerCase()}</Badge>
                })}
              </div>
            </Panel>
          )}
        </>
      )}

      <Panel flush>
        <div className="p-4 pb-2">
          <PanelHeader icon={History} title="Recent exports" subtitle="The last 25 tenant exports, newest first." />
        </div>
        <div className="px-4 pb-4">
          <ErrorState message={jobsErr} onRetry={loadJobs} />
          {jobsLoading ? <LoadingState label="Loading export history" rows={3} />
            : !jobsErr && !jobs.length ? <EmptyState icon={History} title="No exports yet" reason="Nothing has been exported from this console." />
              : !jobsErr && (
                <Table>
                  <THead>
                    <Th>When</Th>
                    <Th>Organisation</Th>
                    <Th>Reason</Th>
                    <Th align="right">Tables</Th>
                    <Th align="right">Rows</Th>
                    <Th>Status</Th>
                  </THead>
                  <tbody>
                    {jobs.map((j) => {
                      const rows = Object.values(j.row_counts || {}).reduce((s, v) => s + (Number(v) || 0), 0)
                      return (
                        <Tr key={j.id}>
                          <Td nowrap>{fmtWhen(j.created_at)}</Td>
                          <Td>{orgNameById[j.org_id] || j.org_id}</Td>
                          <Td className="max-w-xs"><span className="text-gray-300">{j.reason}</span></Td>
                          <Td align="right">{Array.isArray(j.tables) ? j.tables.length : 0}</Td>
                          <Td align="right">{fmt(rows)}</Td>
                          <Td><Badge tone={STATUS_TONE[j.status] || 'quiet'}>{STATUS_TEXT[j.status] || j.status}</Badge></Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </Table>
              )}
        </div>
      </Panel>

      <Modal open={confirmOpen} onClose={() => { if (!running) setConfirmOpen(false); else cancelRef.current = true }}
        title={`Export ${manifest?.orgName || orgName} as ${format === 'json' ? 'JSON' : 'Excel'}`}
        subtitle={`${plan.tables} tables, ${fmt(plan.fetchRows)} rows`}
        footer={<>
          {running
            ? <Btn onClick={() => { cancelRef.current = true }}>Stop</Btn>
            : <Btn onClick={() => setConfirmOpen(false)}>Cancel</Btn>}
          <Btn variant="primary" busy={running} disabled={!!reasonError} onClick={runExport}
            icon={format === 'json' ? FileJson : FileSpreadsheet}>
            {running ? 'Exporting' : 'Start export'}
          </Btn>
        </>}>
        <div className="space-y-3">
          <Note tone="warning" icon={ShieldAlert}>
            This hands a copy of a customer&apos;s data to you. It is recorded in the audit trail with your name and the reason below.
          </Note>
          {plan.truncating.length > 0 && (
            <Note tone="warning" icon={AlertTriangle}>
              {plan.truncating.length} table(s) exceed the ceiling and will be exported partially. The file and the job record will say so.
            </Note>
          )}
          <label className="block">
            <span className="text-xs text-gray-400">Reason (required, at least {MIN_REASON} characters)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} disabled={running} rows={3}
              placeholder="For example: customer offboarding request, ticket 1234"
              className="mt-1 w-full rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 p-2 placeholder-gray-600 focus:border-gray-700 focus:outline-none" />
          </label>
          {reason && reasonError && <p className="text-[11px] text-amber-300">{reasonError}</p>}
          {running && (
            <p className="text-xs text-gray-400">
              Reading {fmt(Object.values(progress).reduce((s, p) => s + (p.fetched || 0), 0))} of about {fmt(plan.fetchRows)} rows...
            </p>
          )}
          <ErrorState message={runErr} />
        </div>
      </Modal>
    </div>
  )
}
