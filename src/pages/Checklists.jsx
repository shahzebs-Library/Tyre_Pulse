import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ClipboardList, Plus, Search, Filter, PenLine, ShieldCheck,
  Play, Pencil, RefreshCw, AlertTriangle, ChevronRight, ListChecks,
  Layers, Inbox, CalendarDays, Download, Loader2, Users, X,
  FileSpreadsheet, FileText, CheckCircle2, Clock, XCircle,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { listTemplates, listSubmissions, getSubmission } from '../lib/api/checklists'
import { CHECKLIST_LANGS } from '../lib/checklist/checklistI18n'
import { resolveChecklistIcon, checklistIconComponent } from '../lib/checklist/checklistIcons'
import { roleTargetLabel } from '../lib/checklist/checklistRoles'
import { gridFields, submissionDate, submissionTarget } from '../lib/checklistMonthly'
import { renderChecklistPdf } from '../lib/checklistPdf'
import { toUserMessage } from '../lib/safeError'
import { useTenant } from '../contexts/TenantContext'
import ChecklistViewerDrawer from '../components/checklist/ChecklistViewerDrawer'
import MonthlyGridPanel from '../components/checklist/MonthlyGridPanel'
import ChecklistWorkspace from '../components/checklists/ChecklistWorkspace'
import { isMissingRelation } from '../lib/api/_client'
import Card from '../components/ui/Card'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { compareValues, isBlank } from '../lib/consoleTable'
import {
  STATUS_BUCKETS, EVIDENCE_OPTIONS, prettyStatus, evidenceLabel, fieldCount, templateCategories,
  filterTemplates, filterSubmissions, summarizeTemplates, summarizeSubmissions, submissionDay,
  submissionExportRows, SUBMISSION_EXPORT_COLUMNS,
} from '../lib/checklistsAnalytics'

/** Column sorting through the shared console comparator (blanks sort last). */
const sortable = (fn) => ({
  accessorFn: (r) => { const v = fn(r); return isBlank(v) ? undefined : v },
  sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)),
  sortUndefined: 'last',
})

const ELEVATED = ['admin', 'manager', 'director']

// The friendly "tables not deployed yet" heuristic — mirrors Billing.jsx.

const STATUS_BADGE = {
  submitted: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  approved: 'bg-green-900/40 text-green-300 border border-green-700/50',
  rejected: 'bg-red-900/40 text-red-300 border border-red-700/50',
  in_review: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  pending: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  draft: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
function statusBadge(s) {
  return STATUS_BADGE[String(s || '').toLowerCase()] || 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]'
}
/**
 * Render the template's icon. Resolved, never printed raw: `icon` holds an
 * emoji on some rows and a lucide component name on others, and the raw string
 * used to be rendered as text - which is why a card showed the literal word
 * "ClipboardCheck".
 */
function TemplateIcon({ template }) {
  const res = resolveChecklistIcon(template)
  if (res.kind === 'emoji') {
    return <span className="text-xl leading-none" role="img" aria-label="Checklist icon">{res.emoji}</span>
  }
  const Icon = checklistIconComponent(res.token)
  return <Icon size={18} className="text-brand-bright" aria-hidden="true" />
}

function fmtDate(v) {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function ChecklistDates({ submission, template }) {
  const date = submissionDate(submission, template?.fields)
  const sheetDate = date.basis === 'sheet_date'
    ? `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
    : null
  const receivedValue = submission.submitted_at || submission.created_at
  const receivedDate = receivedValue ? String(receivedValue).slice(0, 10) : null
  if (!sheetDate) return <div>Received: {fmtDate(receivedValue)}</div>
  if (sheetDate === receivedDate) {
    return <div className="text-[var(--text-primary)]">Checklist date: {fmtDate(`${sheetDate}T12:00:00`)}</div>
  }
  return <>
    <div className="text-[var(--text-primary)]">Checklist date: {fmtDate(`${sheetDate}T12:00:00`)}</div>
    <div>Received: {fmtDate(receivedValue)}</div>
  </>
}

const TABS = [
  { key: 'templates', label: 'Templates', icon: Layers },
  { key: 'submissions', label: 'Recent Submissions', icon: Inbox },
  // A daily check is filled one day at a time but READ one month at a time -
  // that is the sheet the workshop pins on the wall.
  { key: 'month', label: 'Month grid', icon: CalendarDays },
]

export default function Checklists() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { activeCountry } = useSettings()
  const { profile } = useAuth()
  const isElevated = ELEVATED.includes(String(profile?.role || '').toLowerCase())

  // Arriving from Insights with ?template=<id> opens the submissions for that one
  // template. Insights only ever showed a count; this is where that count is.
  const templateParam = searchParams.get('template') || ''
  const [tab, setTab] = useState(templateParam ? 'submissions' : 'templates')
  const [templates, setTemplates] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [evidenceFilter, setEvidenceFilter] = useState('all')
  const [bucketFilter, setBucketFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [exportNote, setExportNote] = useState('')
  // The submission open in the quick viewer, if any.
  const [viewId, setViewId] = useState(null)
  // The language of the printed sheet, chosen at download time - the floor copy
  // is not always read in the language of whoever pressed the button.
  const [pdfLang, setPdfLang] = useState('en')
  const [pdfBusyId, setPdfBusyId] = useState(null)
  const [pdfNote, setPdfNote] = useState('')
  const [monthTemplateId, setMonthTemplateId] = useState('')
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || 'TyrePulse'

  const load = useCallback(async () => {
    setLoading(true); setError(''); setMissing(false)
    try {
      const [tpls, subs] = await Promise.all([
        listTemplates({ status: 'published', country: activeCountry }),
        listSubmissions({ country: activeCountry }),
      ])
      setTemplates(Array.isArray(tpls) ? tpls : [])
      setSubmissions(Array.isArray(subs) ? subs : [])
      setNow(Date.now())
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      else setError(toUserMessage(err, 'Could not load checklists.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const categories = useMemo(() => templateCategories(templates), [templates])
  const filteredTemplates = useMemo(() => filterTemplates(templates, { query: search, category }), [templates, search, category])
  const filteredSubmissions = useMemo(() => filterSubmissions(submissions, templates, {
    templateId: templateParam, evidence: evidenceFilter, bucket: bucketFilter, query: search, from: fromDate, to: toDate,
  }), [submissions, templates, search, templateParam, evidenceFilter, bucketFilter, fromDate, toDate])
  // The submission tiles cover the rows matching the template link, search and
  // dates. The status and evidence filters are held out: the tiles report the
  // status mix and the evidence reading, so narrowing them would restate it.
  const submissionScope = useMemo(() => filterSubmissions(submissions, templates, {
    templateId: templateParam, query: search, from: fromDate, to: toDate,
  }), [submissions, templates, search, templateParam, fromDate, toDate])
  const subSummary = useMemo(() => summarizeSubmissions(submissionScope, now), [submissionScope, now])
  const tplSummary = useMemo(() => summarizeTemplates(templates), [templates])
  const subFilters = search || evidenceFilter !== 'all' || bucketFilter !== 'all' || fromDate || toDate
  const clearSubFilters = () => { setSearch(''); setEvidenceFilter('all'); setBucketFilter('all'); setFromDate(''); setToDate('') }

  const exportSubmissions = useCallback(async (kind) => {
    setExportNote('')
    try {
      const rows = submissionExportRows(filteredSubmissions, templates)
      const name = reportFileName('Checklist submissions', new Date().toISOString().slice(0, 10))
      if (kind === 'excel') await exportToExcel(rows, SUBMISSION_EXPORT_COLUMNS.map((c) => c.key), SUBMISSION_EXPORT_COLUMNS.map((c) => c.header), name)
      else await exportToPdf(rows, SUBMISSION_EXPORT_COLUMNS, 'Checklist Submissions', name, 'landscape')
    } catch (err) {
      setExportNote(toUserMessage(err, 'Could not export. Try again.'))
    }
  }, [filteredSubmissions, templates])

  const exportTemplates = useCallback(async (kind) => {
    setExportNote('')
    try {
      const rows = filteredTemplates.map((t) => ({
        name: t.name || 'Untitled checklist', category: t.category || 'General', version: t.version ?? 1,
        fields: fieldCount(t), signature: t.require_signature ? 'Yes' : 'No', approval: t.require_approval ? 'Yes' : 'No',
        target: roleTargetLabel(t) || 'Everyone',
      }))
      const cols = [
        { key: 'name', header: 'Checklist' }, { key: 'category', header: 'Category' }, { key: 'version', header: 'Version' },
        { key: 'fields', header: 'Fields' }, { key: 'signature', header: 'Signature' }, { key: 'approval', header: 'Approval' },
        { key: 'target', header: 'Written for' },
      ]
      const name = reportFileName('Checklist templates', new Date().toISOString().slice(0, 10))
      if (kind === 'excel') await exportToExcel(rows, cols.map((c) => c.key), cols.map((c) => c.header), name)
      else await exportToPdf(rows, cols, 'Checklist Templates', name, 'landscape')
    } catch (err) {
      setExportNote(toUserMessage(err, 'Could not export. Try again.'))
    }
  }, [filteredTemplates])

  // Name the template we were sent to look at, so a filtered-to-nothing list
  // reads as "this template has no submissions" rather than as a broken page.
  const templateParamName = useMemo(() => {
    if (!templateParam) return null
    return templates.find((t) => String(t.id) === templateParam)?.name || null
  }, [templates, templateParam])

  // Only a template with daily tick-box lines has a month grid to draw.
  const monthTemplates = useMemo(
    () => templates.filter((t) => gridFields(t?.fields).length > 0),
    [templates],
  )
  useEffect(() => {
    if (!monthTemplateId && monthTemplates.length) setMonthTemplateId(String(monthTemplates[0].id))
  }, [monthTemplates, monthTemplateId])
  const monthTemplate = useMemo(
    () => monthTemplates.find((t) => String(t.id) === monthTemplateId) || null,
    [monthTemplates, monthTemplateId],
  )

  const downloadPdf = useCallback(async (row) => {
    if (!row?.id || pdfBusyId) return
    setPdfBusyId(row.id); setPdfNote('')
    try {
      // The list row is a summary; the printed sheet needs the answers, the
      // remarks, the photographs and the signatures, so the record is loaded in
      // full before anything is drawn.
      const full = await getSubmission(row.id)
      if (!full) { setPdfNote('That checklist could not be opened.'); return }
      const res = await renderChecklistPdf({ submission: full, lang: pdfLang, company, branding })
      if (pdfLang !== 'en' && res.fellBack) {
        setPdfNote('That language could not be printed, so the English wording was used.')
      } else if (pdfLang !== 'en' && !res.translated) {
        setPdfNote('This checklist carries no translation for that language, so English was used.')
      }
    } catch (err) {
      setPdfNote(toUserMessage(err, 'Could not generate the PDF.'))
    } finally {
      setPdfBusyId(null)
    }
  }, [pdfBusyId, pdfLang, company, branding])

  const submissionColumns = useMemo(() => [
    { id: 'checklist', header: 'Checklist', ...sortable((s) => s.title || s.template_name), size: 230,
      cell: ({ row }) => {
        const s = row.original
        return (
          <div>
            <div className="font-medium text-[var(--text-primary)]">{s.title || s.template_name || 'Checklist'}</div>
            {s.title && s.template_name && s.title !== s.template_name && (
              <div className="text-xs text-[var(--text-muted)]">{s.template_name}</div>
            )}
          </div>
        )
      } },
    { id: 'target', header: 'Asset / Site', ...sortable((s) => submissionTarget(s, templates.find((t) => String(t.id) === String(s.template_id))?.fields).assetNo), size: 170,
      cell: ({ row }) => {
        const s = row.original
        const target = submissionTarget(s, templates.find((t) => String(t.id) === String(s.template_id))?.fields)
        return (
          <div>
            <div className="text-[var(--text-primary)]">{target.assetNo || 'N/A'}</div>
            <div className="text-xs text-[var(--text-muted)]">{[target.site, s.country].filter(Boolean).join(', ') || 'N/A'}</div>
          </div>
        )
      } },
    { id: 'status', header: 'Status', ...sortable((s) => prettyStatus(s.status)), size: 190,
      cell: ({ row }) => {
        const s = row.original
        return (
          <div>
            <span className={`badge text-xs ${statusBadge(s.status)}`}>{prettyStatus(s.status)}</span>
            <div className={`text-[11px] mt-1 ${s.template_snapshot_status === 'exact' ? 'text-green-500' : 'text-amber-500'}`}>
              {evidenceLabel(s.template_snapshot_status)}
            </div>
          </div>
        )
      } },
    { id: 'date', header: 'Checklist / received date', ...sortable((s) => submissionDay(s, templates)), size: 190,
      cell: ({ row }) => (
        <div className="whitespace-nowrap text-[var(--text-muted)]">
          <ChecklistDates submission={row.original} template={templates.find((t) => String(t.id) === String(row.original.template_id))} />
        </div>
      ) },
    { id: 'actions', header: '', enableSorting: false, size: 120, meta: { export: false },
      cell: ({ row }) => {
        const s = row.original
        return (
          <div className="flex items-center justify-end gap-1 whitespace-nowrap">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); downloadPdf(s) }}
              disabled={pdfBusyId === s.id}
              className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[36px] disabled:opacity-60"
              title="Download this checklist as a PDF"
            >
              {pdfBusyId === s.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
              PDF
            </button>
            <ChevronRight size={16} className="text-[var(--text-muted)]" aria-hidden="true" />
          </div>
        )
      } },
  ], [templates, pdfBusyId, downloadPdf])

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {tab !== 'month' && (
        <>
          <button
            type="button"
            onClick={() => (tab === 'templates' ? exportTemplates('excel') : exportSubmissions('excel'))}
            disabled={tab === 'templates' ? !filteredTemplates.length : !filteredSubmissions.length}
            className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"
          >
            <FileSpreadsheet size={14} aria-hidden="true" /> Excel
          </button>
          <button
            type="button"
            onClick={() => (tab === 'templates' ? exportTemplates('pdf') : exportSubmissions('pdf'))}
            disabled={tab === 'templates' ? !filteredTemplates.length : !filteredSubmissions.length}
            className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"
          >
            <FileText size={14} aria-hidden="true" /> PDF
          </button>
        </>
      )}
      {isElevated && (
        <button type="button" onClick={() => navigate('/checklist-builder')} className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px]">
          <Plus size={15} aria-hidden="true" /> New template
        </button>
      )}
    </div>
  )

  const kpis = [
    { label: 'Published checklists', value: tplSummary.total, icon: Layers, tone: 'text-[var(--text-primary)]',
      sub: `${tplSummary.requireApproval} need approval, ${tplSummary.requireSignature} need a signature` },
    { label: 'Submissions', value: subSummary.total, icon: Inbox, tone: 'text-[var(--text-primary)]', sub: `${subSummary.last30Days} in the last 30 days` },
    { label: 'Awaiting review', value: subSummary.pending, icon: Clock, tone: subSummary.pending > 0 ? 'text-amber-400' : 'text-[var(--text-primary)]' },
    { label: 'Approval rate', value: subSummary.approvalRatePct == null ? 'N/A' : `${subSummary.approvalRatePct}%`, icon: CheckCircle2, tone: 'text-green-400',
      sub: `${subSummary.approved} approved, ${subSummary.rejected} rejected` },
    { label: 'Evidence gaps', value: subSummary.evidenceGaps, icon: XCircle, tone: subSummary.evidenceGaps > 0 ? 'text-amber-400' : 'text-[var(--text-primary)]',
      sub: subSummary.exactEvidencePct == null ? 'No submissions yet' : `${subSummary.exactEvidencePct}% carry the exact template` },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Checklists"
        subtitle="Published inspection and compliance checklists: fill, submit, and route for approval."
        icon={ClipboardList}
        actions={headerActions}
        onRefresh={load}
        refreshing={loading}
        updatedAt={updatedAt}
      />

      {/* Workspace: the inspections-and-observations view (list, selected sheet,
          findings, trend). Everything below it is unchanged. */}
      {!missing && (
        <ChecklistWorkspace
          submissions={submissions}
          templates={templates}
          loading={loading}
          error={error}
          onRetry={load}
          onOpenViewer={(id) => setViewId(id)}
          onDownloadPdf={downloadPdf}
          pdfBusyId={pdfBusyId}
          now={now}
        />
      )}
      {pdfNote && tab !== 'submissions' && (
        <p className="text-xs text-amber-500" role="status">{pdfNote}</p>
      )}

      {/* KPI strip */}
      {!missing && !error && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {kpis.map((k) => {
            const Icon = k.icon
            return (
              <Card key={k.label}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                  <Icon size={16} className={k.tone} aria-hidden="true" />
                </div>
                {loading
                  ? <div className="h-7 w-12 mt-2 rounded bg-[var(--input-bg)] animate-pulse" />
                  : <p className={`text-2xl font-bold mt-1 tabular-nums ${k.tone}`}>{k.value}</p>}
                {k.sub && !loading && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{k.sub}</p>}
              </Card>
            )
          })}
        </div>
      )}
      {!loading && !missing && !error && submissionScope.length !== submissions.length && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">
          The submission figures cover the {submissionScope.length} submission{submissionScope.length === 1 ? '' : 's'} matching the template, search and date filters, of {submissions.length}.
          The status and evidence filters are not applied here.
        </p>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border-dim)] overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => {
          const count = key === 'templates' ? templates.length
            : key === 'submissions' ? submissions.length
              : monthTemplates.length
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`px-4 min-h-[44px] text-sm font-medium flex items-center gap-2 border-b-2 -mb-px transition-colors ${
                tab === key ? 'border-green-500 text-green-400' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon size={15} aria-hidden="true" /> {label}
              {!loading && !missing && <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)]">{count}</span>}
            </button>
          )
        })}
      </div>

      {/* Search + filters */}
      {tab !== 'month' && (
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            className="input pl-9"
            aria-label={tab === 'templates' ? 'Search checklists' : 'Search submissions'}
            placeholder={tab === 'templates' ? 'Search checklists' : 'Search submissions'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {tab === 'submissions' && (
          <div className="flex items-center gap-2">
            <select className="input py-2" aria-label="Status" value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value)}>
              <option value="all">All statuses</option>
              {STATUS_BUCKETS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            <select className="input py-2" aria-label="Evidence" value={evidenceFilter} onChange={(e) => setEvidenceFilter(e.target.value)}>
              <option value="all">All evidence</option>
              {EVIDENCE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
        )}
        {tab === 'submissions' && (
          <div className="flex items-center gap-2">
            <input type="date" className="input py-2" aria-label="Checklist date from" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <span className="text-xs text-[var(--text-muted)]">to</span>
            <input type="date" className="input py-2" aria-label="Checklist date to" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        )}
        {tab === 'submissions' && subFilters && (
          <button type="button" onClick={clearSubFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
            <X size={14} aria-hidden="true" /> Clear
          </button>
        )}
        {tab === 'submissions' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">PDF language</span>
            <select
              className="input py-2"
              aria-label="PDF language"
              value={pdfLang}
              onChange={(e) => { setPdfLang(e.target.value); setPdfNote('') }}
            >
              {CHECKLIST_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
        )}
        {tab === 'templates' && categories.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-[var(--text-muted)]" />
            <select className="input py-2" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
      </div>
      )}

      {pdfNote && tab === 'submissions' && (
        <p className="text-xs text-amber-500" role="status">{pdfNote}</p>
      )}
      {exportNote && <p className="text-xs text-red-400" role="alert">{exportNote}</p>}

      {/* Migration hint */}
      {missing && (
        <div className="card border border-amber-800/50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-amber-300 font-medium">Checklists aren't enabled on this database yet.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">
                Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V123_CHECKLIST_TEMPLATES.sql</span> to create the
                {' '}<span className="font-mono">checklist_templates</span> and <span className="font-mono">checklist_submissions</span> tables, then reload.
              </p>
              <button onClick={load} className="btn-secondary text-sm mt-3 inline-flex items-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && !missing && (
        <div className="card border border-red-800/50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-red-300 font-medium">Couldn't load checklists.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
              <button onClick={load} className="btn-secondary text-sm mt-3 inline-flex items-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !missing && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card animate-pulse space-y-3">
              <div className="h-5 w-40 bg-[var(--input-bg)] rounded" />
              <div className="h-3 w-full bg-[var(--input-bg)] rounded" />
              <div className="h-3 w-2/3 bg-[var(--input-bg)] rounded" />
              <div className="h-8 w-24 bg-[var(--input-bg)] rounded mt-2" />
            </div>
          ))}
        </div>
      )}

      {/* Templates tab */}
      {!loading && !missing && !error && tab === 'templates' && (
        filteredTemplates.length === 0 ? (
          <div className="card text-center py-16 space-y-3">
            <ListChecks size={34} className="mx-auto text-[var(--text-muted)]" />
            <p className="text-[var(--text-primary)] font-semibold">
              {templates.length === 0 ? 'No checklists yet' : 'No checklists match your filters'}
            </p>
            <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
              {templates.length === 0
                ? 'Published checklist templates will appear here. Create one to start capturing structured inspections.'
                : 'Try clearing the search or category filter.'}
            </p>
            {isElevated && templates.length === 0 && (
              <button onClick={() => navigate('/checklist-builder')} className="btn-primary text-sm inline-flex items-center gap-2 mx-auto">
                <Plus size={15} /> Create a checklist
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map((tpl) => (
              <div key={tpl.id} className="card flex flex-col group">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-subtle border border-[rgba(22,163,74,0.2)] flex items-center justify-center shrink-0">
                    <TemplateIcon template={tpl} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[var(--text-primary)] font-semibold truncate">{tpl.name || 'Untitled checklist'}</h3>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {tpl.category || 'General'} · v{tpl.version ?? 1}
                    </p>
                  </div>
                </div>

                {tpl.description && (
                  <p className="text-sm text-[var(--text-muted)] mt-3 line-clamp-2">{tpl.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <span className="badge text-xs bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)] inline-flex items-center gap-1">
                    <ListChecks size={11} /> {fieldCount(tpl)} field{fieldCount(tpl) === 1 ? '' : 's'}
                  </span>
                  {tpl.require_signature && (
                    <span className="badge text-xs bg-sky-900/40 text-sky-300 border border-sky-700/50 inline-flex items-center gap-1">
                      <PenLine size={11} /> Signature
                    </span>
                  )}
                  {tpl.require_approval && (
                    <span className="badge text-xs bg-purple-900/40 text-purple-300 border border-purple-700/50 inline-flex items-center gap-1">
                      <ShieldCheck size={11} /> Approval
                    </span>
                  )}
                  {/* Renders NOTHING for an untargeted checklist: a chip reading
                      "Everyone" on every card is noise, not information. */}
                  {roleTargetLabel(tpl) && (
                    <span
                      className="badge text-xs bg-amber-900/40 text-amber-300 border border-amber-700/50 inline-flex items-center gap-1"
                      title={`Written for ${roleTargetLabel(tpl)}`}
                    >
                      <Users size={11} /> For: {roleTargetLabel(tpl)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[var(--border-dim)]">
                  <button
                    onClick={() => navigate(`/checklists/${tpl.id}/run`)}
                    className="btn-primary text-sm inline-flex items-center gap-2 flex-1 justify-center min-h-[44px]"
                  >
                    <Play size={15} /> Fill
                  </button>
                  {isElevated && (
                    <Link
                      to={`/checklist-builder/${tpl.id}`}
                      className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"
                      title="Edit this template"
                    >
                      <Pencil size={14} /> Edit
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Submissions tab */}
      {!loading && !missing && !error && tab === 'submissions' && templateParam && (
        <div className="card flex items-center justify-between gap-3 py-3">
          <p className="text-sm text-[var(--text-secondary)]">
            Showing submissions for{' '}
            <span className="text-[var(--text-primary)] font-medium">
              {templateParamName || 'one template'}
            </span>
          </p>
          <button onClick={() => navigate('/checklists')} className="btn-secondary text-xs">
            Show all
          </button>
        </div>
      )}

      {!missing && !error && tab === 'submissions' && (
        <Card pad="none" clip>
          <EnterpriseTable
            columns={submissionColumns}
            data={filteredSubmissions}
            getRowId={(r) => String(r.id)}
            loading={loading}
            onRowClick={(r) => setViewId(r?.id)}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableSorting
            enableExport={false}
            initialPageSize={25}
            pageSizeOptions={[25, 50, 100]}
            emptyMessage={submissions.length === 0
              ? 'No submissions yet. Completed checklists appear here once they are filled and submitted.'
              : 'No submissions match these filters.'}
          />
        </Card>
      )}

      {/* Month grid */}
      {!loading && !missing && !error && tab === 'month' && (
        monthTemplates.length === 0 ? (
          <div className="card text-center py-16 space-y-3">
            <CalendarDays size={34} className="mx-auto text-[var(--text-muted)]" />
            <p className="text-[var(--text-primary)] font-semibold">No daily checklist to plot</p>
            <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
              A month grid is drawn for a checklist whose lines are daily tick boxes. None of the
              published templates has those lines yet.
            </p>
          </div>
        ) : (
          <div className="card space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Checklist</label>
                <select
                  className="input py-2"
                  value={monthTemplateId}
                  onChange={(e) => setMonthTemplateId(e.target.value)}
                >
                  {monthTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <MonthlyGridPanel
              template={monthTemplate}
              country={activeCountry}
              branding={branding}
              company={company}
            />
          </div>
        )
      )}

      <ChecklistViewerDrawer
        submissionId={viewId}
        onClose={() => setViewId(null)}
        onOpenFull={(id) => navigate(`/checklists/submission/${id}`)}
      />
    </div>
  )
}
