/**
 * Checklist Audit Pack (/checklist-audit) - one place to produce the evidence an
 * internal, external (certification), customer or regulatory audit asks for:
 * the controlled form register, every record with its document number and
 * sign-off, every fault with its corrective action, and the findings the data
 * itself shows. Downloads as PDF or Excel. Figures come from the pure engine in
 * src/lib/checklistAuditPack.js.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, FileText, FileSpreadsheet, RefreshCw, AlertTriangle, CheckCircle2,
  ClipboardList, Wrench, ListChecks, Loader2, BadgeCheck,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import {
  listTemplates, listSubmissions, listChecklistCorrectiveActions,
  markFormReviewed, raiseChecklistCorrectiveActions,
} from '../lib/api/checklists'
import { getChecklistGovernancePolicy } from '../lib/api/checklistSchedules'
import {
  AUDIT_TYPES, auditType, buildAuditPack, filterRecords,
  FINDING_COLS, FORM_COLS, RECORD_COLS, FAULT_COLS, summaryRows,
} from '../lib/checklistAuditPack'
import { toUserMessage } from '../lib/safeError'

const loadExportUtils = () => import('../lib/exportUtils')

const TABS = [
  { key: 'findings', label: 'Findings', icon: AlertTriangle },
  { key: 'forms', label: 'Form register', icon: ClipboardList },
  { key: 'records', label: 'Records', icon: ListChecks },
  { key: 'faults', label: 'Faults and actions', icon: Wrench },
]

const SEV_CLS = {
  major: 'bg-red-500/15 text-red-400 border-red-500/30',
  minor: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  observation: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
}
const REVIEW_CLS = {
  ok: 'text-green-400', due_soon: 'text-amber-400', overdue: 'text-red-400', never: 'text-red-400',
}

const INPUT = 'w-full rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-primary)]'
const LABEL = 'block text-xs font-medium text-[var(--text-secondary)] mb-1'

function yearStart() {
  return `${new Date().getFullYear()}-01-01`
}
function today() {
  return new Date().toISOString().slice(0, 10)
}

function Tile({ label, value, tone }) {
  const cls = tone === 'bad' ? 'text-red-400' : tone === 'warn' ? 'text-amber-400' : tone === 'good' ? 'text-green-400' : 'text-[var(--text-primary)]'
  return (
    <div className="card p-3">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${cls}`}>{value}</p>
    </div>
  )
}

const plainCols = (cols) => cols.map(([k, h]) => ({
  accessorKey: k, header: h,
  cell: ({ getValue }) => {
    const v = getValue()
    return v == null || v === '' ? <span className="text-[var(--text-muted)]">-</span> : String(v)
  },
}))

export default function ChecklistAuditPack() {
  const { activeCountry } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || 'TyrePulse'

  const [type, setType] = useState('internal')
  const [from, setFrom] = useState(yearStart)
  const [to, setTo] = useState(today)
  const [site, setSite] = useState('')
  const [templateIds, setTemplateIds] = useState([])
  const [hideNames, setHideNames] = useState(auditType('internal').hideNames)
  const [tab, setTab] = useState('findings')

  const [data, setData] = useState({ templates: [], submissions: [], actions: [], policy: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  const [raise, setRaise] = useState(null) // { preview } while confirming

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [templates, submissions, actions, policy] = await Promise.all([
        listTemplates({ country: activeCountry, limit: 500 }),
        listSubmissions({ country: activeCountry, lean: true }),
        listChecklistCorrectiveActions(),
        getChecklistGovernancePolicy().catch(() => ({})),
      ])
      setData({ templates: templates || [], submissions: submissions || [], actions: actions || [], policy: policy || {} })
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the checklist records.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])
  useEffect(() => { load() }, [load])

  const published = useMemo(() => data.templates.filter((t) => t.status === 'published'), [data.templates])
  const sites = useMemo(
    () => [...new Set(data.submissions.map((s) => s.site).filter(Boolean))].sort(),
    [data.submissions],
  )

  const pack = useMemo(() => {
    const templates = templateIds.length ? published.filter((t) => templateIds.includes(t.id)) : published
    const submissions = filterRecords(data.submissions, { from, to, site, templateIds })
    return buildAuditPack({
      templates, submissions, actions: data.actions, policy: data.policy,
      type, from, to, site, hideNames,
    })
  }, [published, data, from, to, site, templateIds, type, hideNames])

  const chooseType = (key) => { setType(key); setHideNames(auditType(key).hideNames) }

  async function downloadPdf() {
    setBusy('pdf'); setNotice(null)
    try {
      const { renderAuditPackPdf } = await import('../lib/checklistAuditPackPdf')
      await renderAuditPackPdf(pack, { company, branding })
    } catch (e) {
      setNotice({ tone: 'error', text: toUserMessage(e, 'The PDF could not be created.') })
    } finally { setBusy('') }
  }

  async function downloadExcel() {
    setBusy('excel'); setNotice(null)
    try {
      const { exportSheetsToExcel, reportFileName } = await loadExportUtils()
      const sheet = (name, cols, rows, note) => ({ name, rows, columns: cols.map(([k]) => k), headers: cols.map(([, h]) => h), note })
      await exportSheetsToExcel([
        { name: 'Summary', rows: summaryRows(pack.summary).map(([item, value]) => ({ item, value })), columns: ['item', 'value'], headers: ['Item', 'Value'], note: 'Audit scope and headline figures' },
        sheet('Findings', FINDING_COLS, pack.findings, 'Gaps the data shows, by ISO clause'),
        sheet('Form register', FORM_COLS, pack.forms, 'Controlled forms (ISO 7.5)'),
        sheet('Records', RECORD_COLS, pack.records, 'Every record in the period'),
        sheet('Faults and actions', FAULT_COLS, pack.faults, 'Faults and their corrective actions (ISO 10.2)'),
      ], reportFileName('Checklist Audit Pack', pack.summary.audit_type, pack.summary.generated), {
        title: `Checklist Audit Pack - ${pack.summary.audit_type}`, company, dateRange: pack.summary.period,
      })
    } catch (e) {
      setNotice({ tone: 'error', text: toUserMessage(e, 'The Excel file could not be created.') })
    } finally { setBusy('') }
  }

  async function previewRaise() {
    setBusy('raise'); setNotice(null)
    try {
      const preview = await raiseChecklistCorrectiveActions({ dryRun: true })
      setRaise({ preview })
    } catch (e) {
      setNotice({ tone: 'error', text: toUserMessage(e, 'Could not check for missing corrective actions.') })
    } finally { setBusy('') }
  }
  async function confirmRaise() {
    setBusy('raise')
    try {
      const res = await raiseChecklistCorrectiveActions({ dryRun: false })
      setRaise(null)
      setNotice({ tone: 'ok', text: `${res?.actions ?? 0} corrective action(s) raised on ${res?.checklists ?? 0} checklist(s).` })
      await load()
    } catch (e) {
      setNotice({ tone: 'error', text: toUserMessage(e, 'The corrective actions could not be raised.') })
    } finally { setBusy('') }
  }

  async function reviewForm(row) {
    setBusy(`review:${row.id}`); setNotice(null)
    try {
      await markFormReviewed(row.id)
      setNotice({ tone: 'ok', text: `${row.name} marked as reviewed.` })
      await load()
    } catch (e) {
      setNotice({ tone: 'error', text: toUserMessage(e, 'The review could not be recorded.') })
    } finally { setBusy('') }
  }

  const findingCols = useMemo(() => [
    { accessorKey: 'severity_label', header: 'Severity', size: 110,
      cell: ({ row }) => <span className={`px-2 py-0.5 rounded border text-xs font-medium ${SEV_CLS[row.original.severity]}`}>{row.original.severity_label}</span> },
    { accessorKey: 'clause', header: 'Clause', size: 80 },
    { accessorKey: 'title', header: 'Finding' },
    { accessorKey: 'count', header: 'Count', size: 80 },
    { accessorKey: 'detail', header: 'Detail', cell: ({ getValue }) => <span className="whitespace-normal">{getValue()}</span> },
  ], [])

  const formCols = useMemo(() => [
    ...plainCols(FORM_COLS.filter(([k]) => k !== 'review')),
    { accessorKey: 'review', header: 'Review',
      cell: ({ row }) => <span className={REVIEW_CLS[row.original.review_status]}>{row.original.review}</span> },
    { id: 'act', header: '', size: 140, enableSorting: false,
      cell: ({ row }) => (
        <button type="button" className="btn-secondary text-xs" disabled={busy === `review:${row.original.id}`}
          onClick={() => reviewForm(row.original)} title="Record that this form was reviewed and still fits its purpose">
          {busy === `review:${row.original.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BadgeCheck className="w-3.5 h-3.5" />} Mark reviewed
        </button>
      ) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [busy])

  const recordCols = useMemo(() => [
    { accessorKey: 'document_no', header: 'Document no',
      cell: ({ row }) => <Link className="text-[var(--accent)] hover:underline" to={`/checklists/submission/${row.original.id}`}>{row.original.document_no || 'Not numbered'}</Link> },
    ...plainCols(RECORD_COLS.slice(1)),
  ], [])

  const faultCols = useMemo(() => [
    ...plainCols(FAULT_COLS.filter(([k]) => k !== 'action_status')),
    { accessorKey: 'action_status', header: 'Status',
      cell: ({ row }) => {
        const f = row.original
        const cls = !f.has_action ? 'text-red-400' : f.overdue ? 'text-amber-400' : String(f.action_status).toLowerCase() === 'closed' ? 'text-green-400' : ''
        return <span className={cls}>{f.action_status}{f.overdue ? ' (overdue)' : ''}</span>
      } },
  ], [])

  const s = pack.summary
  const missingCa = pack.faults.filter((f) => !f.has_action).length
  const empty = !loading && !error && published.length === 0

  return (
    <div className="space-y-4">
      <PageHeader
        title="Checklist Audit Pack"
        subtitle="Produce the evidence for an internal, external, customer or regulatory audit"
        icon={ShieldCheck}
        onRefresh={load}
        refreshing={loading}
        actions={(
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={downloadExcel} disabled={loading || !!error || empty || !!busy}>
              {busy === 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />} Excel
            </button>
            <button type="button" className="btn-primary" onClick={downloadPdf} disabled={loading || !!error || empty || !!busy}>
              {busy === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Audit pack PDF
            </button>
          </div>
        )}
      />

      {/* Scope */}
      <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="lg:col-span-2">
          <label className={LABEL} htmlFor="ap-type">Audit type</label>
          <select id="ap-type" className={INPUT} value={type} onChange={(e) => chooseType(e.target.value)}>
            {AUDIT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="ap-from">From</label>
          <input id="ap-from" type="date" className={INPUT} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className={LABEL} htmlFor="ap-to">To</label>
          <input id="ap-to" type="date" className={INPUT} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className={LABEL} htmlFor="ap-site">Site</label>
          <select id="ap-site" className={INPUT} value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">All sites</option>
            {sites.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="ap-form">Form</label>
          <select id="ap-form" className={INPUT} value={templateIds[0] || ''}
            onChange={(e) => setTemplateIds(e.target.value ? [e.target.value] : [])}>
            <option value="">All forms</option>
            {published.map((t) => <option key={t.id} value={t.id}>{t.form_ref ? `${t.form_ref} ` : ''}{t.name}</option>)}
          </select>
        </div>
        <label className="lg:col-span-6 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input type="checkbox" checked={hideNames} onChange={(e) => setHideNames(e.target.checked)} />
          Hide people&apos;s names in this pack (shows &quot;Recorded&quot; instead)
        </label>
        <p className="lg:col-span-6 text-xs text-[var(--text-muted)]">{auditType(type).purpose}</p>
      </div>

      {notice && (
        <div role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`card p-3 text-sm flex items-center gap-2 ${notice.tone === 'error' ? 'text-red-400' : 'text-green-400'}`}>
          {notice.tone === 'error' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />} {notice.text}
        </div>
      )}

      {error ? (
        <div role="alert" className="card p-6 text-center space-y-3">
          <p className="text-red-400">{error}</p>
          <button type="button" className="btn-secondary" onClick={load}><RefreshCw className="w-4 h-4" /> Retry</button>
        </div>
      ) : loading ? (
        <div className="card p-10 flex items-center justify-center gap-2 text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading checklist records...
        </div>
      ) : empty ? (
        <div className="card p-10 text-center text-[var(--text-secondary)]">
          No published checklist forms yet. Publish a form in the <Link className="text-[var(--accent)] hover:underline" to="/checklist-builder">checklist builder</Link> first.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Tile label="Controlled forms" value={`${s.forms_in_date} / ${s.forms} in review date`} tone={s.forms_in_date < s.forms ? 'warn' : 'good'} />
            <Tile label="Records" value={s.records} />
            <Tile label="Signed off" value={s.approval_rate == null ? 'N/A' : `${s.approval_rate}%`} tone={s.approval_rate == null ? '' : s.approval_rate < 80 ? 'warn' : 'good'} />
            <Tile label="Waiting for sign-off" value={s.pending} tone={s.pending ? 'warn' : 'good'} />
            <Tile label="Faults with an action" value={s.action_coverage == null ? 'N/A' : `${s.action_coverage}%`} tone={s.action_coverage == null ? '' : s.action_coverage < 100 ? 'bad' : 'good'} />
            <Tile label="Findings (major / minor / obs.)" value={`${s.majors} / ${s.minors} / ${s.observations}`} tone={s.majors ? 'bad' : s.minors ? 'warn' : 'good'} />
          </div>

          {missingCa > 0 && (
            <div className="card p-3 flex flex-wrap items-center justify-between gap-2 border border-red-500/30">
              <p className="text-sm text-[var(--text-primary)]">
                {missingCa} fault(s) have no corrective action. ISO 10.2 expects each one to be handled.
              </p>
              <button type="button" className="btn-primary" onClick={previewRaise} disabled={!!busy}>
                {busy === 'raise' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />} Raise missing corrective actions
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2" role="tablist">
            {TABS.map(({ key, label, icon: Icon }) => {
              const count = key === 'findings' ? pack.findings.length : key === 'forms' ? pack.forms.length : key === 'records' ? pack.records.length : pack.faults.length
              return (
                <button key={key} type="button" role="tab" aria-selected={tab === key}
                  className={tab === key ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(key)}>
                  <Icon className="w-4 h-4" /> {label} ({count})
                </button>
              )
            })}
          </div>

          <div className="card p-2">
            {tab === 'findings' && (
              <EnterpriseTable columns={findingCols} data={pack.findings} getRowId={(r) => `${r.clause}-${r.title}`}
                emptyMessage="No findings: every check passed for this scope." searchPlaceholder="Search findings..." />
            )}
            {tab === 'forms' && (
              <EnterpriseTable columns={formCols} data={pack.forms} getRowId={(r) => r.id}
                emptyMessage="No forms in this scope." searchPlaceholder="Search forms..." />
            )}
            {tab === 'records' && (
              <EnterpriseTable columns={recordCols} data={pack.records} getRowId={(r) => r.id}
                emptyMessage="No records in this period." searchPlaceholder="Search records, assets, sites..." />
            )}
            {tab === 'faults' && (
              <EnterpriseTable columns={faultCols} data={pack.faults} getRowId={(r, i) => `${r.document_no}-${r.item}-${i}`}
                emptyMessage="No faults recorded in this period." searchPlaceholder="Search faults and actions..." />
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)]">Record retention: {s.retention}.</p>
        </>
      )}

      {raise && (
        <Modal open onClose={() => (busy ? null : setRaise(null))} title="Raise missing corrective actions" size="sm">
          <div className="space-y-3 text-sm text-[var(--text-secondary)]">
            <p>
              {raise.preview?.actions
                ? `${raise.preview.actions} corrective action(s) will be raised on ${raise.preview.checklists} checklist(s). The responsible people are notified.`
                : 'Every fault already has a corrective action. Nothing to raise.'}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setRaise(null)} disabled={!!busy}>Cancel</button>
              {!!raise.preview?.actions && (
                <button type="button" className="btn-primary" onClick={confirmRaise} disabled={!!busy}>
                  {busy === 'raise' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />} Raise them
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
