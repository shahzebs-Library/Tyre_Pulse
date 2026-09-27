/**
 * AiAdministration (route /ai-administration) — AI & Automation Administration
 * (enterprise plan §12). A single admin home for the DB-backed AI configuration
 * surfaces introduced in V205:
 *
 *   • Models   — model catalogue + pricing (USD per 1M tokens), default flag.
 *   • Prompts  — versioned agent system-prompts (en/ar).
 *   • Budgets  — token / cost caps per period, with utilisation vs real spend.
 *   • Feedback — user ratings / corrections captured on AI answers.
 *
 * SAFE + ADDITIVE: this page is configuration and audit only. The edge
 * functions keep their own hardcoded model, pricing and prompts as the
 * authoritative runtime fallback, so nothing here changes live AI behaviour.
 *
 * Every tab carries KPI tiles, search/filter, a table, create/edit modal,
 * Excel/PDF export, and full loading / empty / error / not-provisioned states.
 * Admin-gated in-page (defence in depth; a route guard is wired by the parent).
 * The Budgets tab reads real spend from the existing ai_token_logs table — no
 * fabricated numbers; when that table is absent it shows cap config only.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Sparkles, Cpu, BookOpen, Wallet, Star, Search, AlertTriangle,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, ShieldAlert, CheckCircle2,
  Coins, ThumbsUp, Activity, Send, RefreshCw, Languages, Gauge,
} from 'lucide-react'
import { AiOperationsTab, AiDeliveryJobsTab } from '../components/ai/AiOpsTabs'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import UiModal from '../components/ui/Modal'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { costPerCall } from '../lib/aiAdmin'
import { readTokenLogs } from '../lib/api/aiOps'
import { compareValues } from '../lib/consoleTable'
import {
  searchRecords, spendWindows, budgetUtilisation, modelKpis, promptKpis,
  budgetKpis, feedbackKpis, ratingDistribution,
} from '../lib/aiAdministrationAnalytics'
import {
  listAiModels, createAiModel, updateAiModel, deleteAiModel,
} from '../lib/api/aiModels'
import {
  listAiPrompts, createAiPrompt, updateAiPrompt, deleteAiPrompt, LOCALES,
} from '../lib/api/aiPrompts'
import {
  listAiBudgets, createAiBudget, updateAiBudget, deleteAiBudget, PERIODS,
} from '../lib/api/aiBudgets'
import {
  listAiFeedback, createAiFeedback, updateAiFeedback, deleteAiFeedback,
} from '../lib/api/aiFeedback'
import { isMissingRelation } from '../lib/api/_client'

const ADMIN_ROLES = new Set(['Admin'])

const TABS = [
  { key: 'operations', label: 'Operations', Icon: Activity },
  { key: 'jobs', label: 'Delivery & Jobs', Icon: Send },
  { key: 'models', label: 'Models', Icon: Cpu },
  { key: 'prompts', label: 'Prompts', Icon: BookOpen },
  { key: 'budgets', label: 'Budgets', Icon: Wallet },
  { key: 'feedback', label: 'Feedback', Icon: Star },
]

// ── formatting helpers ───────────────────────────────────────────────────────
const fmtUSD = (v) => (v == null || v === '' ? 'N/A' : `$${Number(v).toFixed(4)}`)
const fmtNum = (v) => (v == null || v === '' ? 'N/A' : Number(v).toLocaleString())
const fmtBool = (v) => (v === true ? 'Yes' : v === false ? 'No' : 'N/A')
const fmtDate = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

// ── generic UI atoms ─────────────────────────────────────────────────────────
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
const CTRL = `min-h-[44px] sm:min-h-[36px] ${FOCUS}`

// One sort rule for every column: number/date aware, blanks last.
const SORT = { sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)), sortUndefined: 'last' }
const undef = (v) => (v == null || v === '' ? undefined : v)
const NA = <span className="text-[var(--text-muted)] text-xs">N/A</span>

function KpiTile({ label, value, Icon, tone = 'text-[var(--text-primary)]', sub }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)] truncate">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums truncate ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

function StatePanel({ tone = 'amber', title, children, onRetry }) {
  const border = tone === 'red' ? 'border-red-500/40' : 'border-amber-500/40'
  const text = tone === 'red' ? 'text-red-400' : 'text-amber-400'
  return (
    <div className={`card border ${border} flex flex-wrap items-start gap-3`} role={tone === 'red' ? 'alert' : 'status'}>
      <AlertTriangle size={18} className={`${text} mt-0.5 shrink-0`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className={`${text} font-medium`}>{title}</p>
        <p className="text-[var(--text-muted)] text-sm mt-1">{children}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className={`btn-secondary text-sm inline-flex items-center gap-1.5 px-3 ${CTRL}`}>
          <RefreshCw size={14} aria-hidden="true" /> Retry
        </button>
      )}
    </div>
  )
}

function Badge({ ok, yes = 'Active', no = 'Inactive' }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border ${
      ok ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-[var(--panel-2)] text-[var(--text-muted)] border-[var(--border)]'
    }`}>
      {ok && <CheckCircle2 size={11} aria-hidden="true" />}{ok ? yes : no}
    </span>
  )
}

function Modal({ title, onClose, saving, children }) {
  return (
    <UiModal open onClose={() => { if (!saving) onClose() }} title={title} size="lg" closeOnBackdrop={!saving}>
      {children}
    </UiModal>
  )
}

function Field({ label, hint, children }) {
  // The control is nested inside the label, so it is named by it.
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[var(--text-muted)] mt-1">{hint}</span>}
    </label>
  )
}

function DeleteConfirm({ label, onCancel, onConfirm, deleting }) {
  return (
    <UiModal
      open
      onClose={() => { if (!deleting) onCancel() }}
      title="Delete this record?"
      size="sm"
      closeOnBackdrop={!deleting}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} className={`btn-secondary text-sm px-3 ${CTRL}`} disabled={deleting}>Cancel</button>
          <button onClick={onConfirm} className={`btn-danger text-sm inline-flex items-center gap-1.5 px-3 disabled:opacity-60 ${CTRL}`} disabled={deleting}>
            <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      )}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" aria-hidden="true" /></div>
        <p className="text-sm text-[var(--text-secondary)]">{label}. This cannot be undone.</p>
      </div>
    </UiModal>
  )
}

function Toolbar({ search, setSearch, placeholder, extra, onExcel, onPdf, onCreate, createLabel, canCreate, count, total }) {
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[200px]">
          <span className="sr-only">{placeholder}</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
          <input type="search" className={`input pl-9 w-full ${CTRL}`} placeholder={placeholder} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {extra}
        <button onClick={onExcel} className={`btn-secondary text-sm inline-flex items-center gap-1.5 px-3 disabled:opacity-40 ${CTRL}`} disabled={!count}>
          <FileSpreadsheet size={14} aria-hidden="true" /> Excel
        </button>
        <button onClick={onPdf} className={`btn-secondary text-sm inline-flex items-center gap-1.5 px-3 disabled:opacity-40 ${CTRL}`} disabled={!count}>
          <FileText size={14} aria-hidden="true" /> PDF
        </button>
        <button onClick={onCreate} className={`btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-40 ${CTRL}`} disabled={!canCreate}>
          <Plus size={14} aria-hidden="true" /> {createLabel}
        </button>
        <span className="text-xs text-[var(--text-muted)] ml-auto w-full sm:w-auto text-right" aria-live="polite">{count} of {total}</span>
      </div>
    </div>
  )
}

/** Row actions (edit + delete) as a column cell. Icon-only, so each is labelled. */
function RowActions({ what, onEdit, onDelete }) {
  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <button onClick={onEdit} className={`w-11 h-11 sm:w-9 sm:h-9 inline-flex items-center justify-center rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] ${FOCUS}`} aria-label={`Edit ${what}`}><Pencil size={14} aria-hidden="true" /></button>
      <button onClick={onDelete} className={`w-11 h-11 sm:w-9 sm:h-9 inline-flex items-center justify-center rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 ${FOCUS}`} aria-label={`Delete ${what}`}><Trash2 size={14} aria-hidden="true" /></button>
    </div>
  )
}

/**
 * The shared register for every catalogue tab: EnterpriseTable over the FULL
 * filtered set (it pages and sorts across it), with the tab's own states.
 */
function ResourceTable({ viewKey, columns, rows, loading, error, onRetry, notProvisioned, onRowClick }) {
  return (
    <EnterpriseTable
      viewKey={viewKey}
      columns={columns}
      data={rows}
      getRowId={(r) => String(r.id)}
      loading={loading}
      error={error || null}
      onRetry={onRetry}
      enableGlobalFilter={false}
      enableColumnFilters={false}
      enableExport={false}
      initialPageSize={25}
      pageSizeOptions={[25, 50, 100]}
      onRowClick={onRowClick}
      emptyMessage={notProvisioned ? 'Not provisioned yet.' : 'No records match these filters.'}
    />
  )
}


// ── shared tab controller hook ───────────────────────────────────────────────
function useResource(loader, country) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await loader({ country })
      setRows(Array.isArray(data) ? data : [])
      // An empty list from a service that swallows missing-relation is
      // indistinguishable from a genuinely empty table; we only flag
      // not-provisioned on an explicit relation error below.
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load records.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [loader, country])

  useEffect(() => { load() }, [load])
  return { rows, error, notProvisioned, refreshing, load, setError }
}

// ── Models tab ───────────────────────────────────────────────────────────────
const MODEL_FORM = {
  key: '', provider: '', model_id: '', input_price: '', output_price: '',
  max_tokens: '', active: true, is_default: false, notes: '',
}

function ModelsTab({ country }) {
  const { rows, error, notProvisioned, load, setError } = useResource(listAiModels, country)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null) // { editing }
  const [form, setForm] = useState(MODEL_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [statusFilter, setStatusFilter] = useState('')
  const summary = useMemo(() => modelKpis(rows || []), [rows])

  const filtered = useMemo(() => {
    const base = searchRecords(rows || [], search, ['key', 'provider', 'model_id', 'notes'])
    if (statusFilter === 'active') return base.filter((r) => r.active !== false)
    if (statusFilter === 'inactive') return base.filter((r) => r.active === false)
    return base
  }, [rows, search, statusFilter])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const openCreate = () => { setForm(MODEL_FORM); setFormError(''); setModal({ editing: null }) }
  const openEdit = (r) => {
    setForm({
      key: r.key || '', provider: r.provider || '', model_id: r.model_id || '',
      input_price: r.input_price ?? '', output_price: r.output_price ?? '',
      max_tokens: r.max_tokens ?? '', active: r.active !== false,
      is_default: r.is_default === true, notes: r.notes || '',
    })
    setFormError(''); setModal({ editing: r })
  }

  const submit = async (e) => {
    e?.preventDefault?.(); setFormError('')
    if (!form.key.trim()) { setFormError('A model key is required.'); return }
    setSaving(true)
    try {
      if (modal.editing) await updateAiModel(modal.editing.id, form)
      else await createAiModel(form)
      setModal(null); await load()
    } catch (err) { setFormError(toUserMessage(err, 'Could not save the model.')) }
    finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try { await deleteAiModel(confirmDelete.id); setConfirmDelete(null); await load() }
    catch (err) { setError(toUserMessage(err, 'Could not delete the model.')) }
    finally { setDeleting(false) }
  }

  const COLS = ['key', 'provider', 'model_id', 'input_price', 'output_price', 'max_tokens', 'is_default', 'active']
  const HEADERS = ['Key', 'Provider', 'Model ID', 'Input $/1M', 'Output $/1M', 'Max tokens', 'Default', 'Active']
  const exportRows = filtered.map((r) => ({
    key: r.key || '', provider: r.provider || '', model_id: r.model_id || '',
    input_price: r.input_price ?? '', output_price: r.output_price ?? '',
    max_tokens: r.max_tokens ?? '', is_default: fmtBool(r.is_default), active: fmtBool(r.active),
  }))
  // A reference call-cost preview for the default model (1M in + 1M out tokens).
  const sampleCost = summary.defaultModel ? costPerCall(summary.defaultModel, 1_000_000, 1_000_000) : null

  const modelColumns = [
    { id: 'key', header: 'Key', accessorFn: (r) => undef(r.key), size: 160, ...SORT, cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue() ?? 'N/A'}</span> },
    { id: 'provider', header: 'Provider', accessorFn: (r) => undef(r.provider), size: 110, ...SORT, cell: ({ getValue }) => getValue() ?? NA },
    { id: 'model_id', header: 'Model ID', accessorFn: (r) => undef(r.model_id), size: 200, ...SORT, cell: ({ getValue }) => (getValue() ? <span className="font-mono text-xs">{getValue()}</span> : NA) },
    { id: 'input_price', header: 'Input $/1M', accessorFn: (r) => undef(r.input_price == null ? null : Number(r.input_price)), size: 100, meta: { align: 'right' }, ...SORT, cell: ({ getValue }) => fmtUSD(getValue()) },
    { id: 'output_price', header: 'Output $/1M', accessorFn: (r) => undef(r.output_price == null ? null : Number(r.output_price)), size: 100, meta: { align: 'right' }, ...SORT, cell: ({ getValue }) => fmtUSD(getValue()) },
    { id: 'max_tokens', header: 'Max tokens', accessorFn: (r) => undef(r.max_tokens == null ? null : Number(r.max_tokens)), size: 100, meta: { align: 'right' }, ...SORT, cell: ({ getValue }) => fmtNum(getValue()) },
    { id: 'is_default', header: 'Default', accessorFn: (r) => (r.is_default ? 1 : 0), size: 90, ...SORT, cell: ({ row }) => (row.original.is_default ? <Badge ok yes="Default" /> : <span className="text-[var(--text-muted)] text-xs">No</span>) },
    { id: 'active', header: 'Active', accessorFn: (r) => (r.active !== false ? 1 : 0), size: 90, ...SORT, cell: ({ row }) => <Badge ok={row.original.active !== false} /> },
    { id: 'actions', header: '', enableSorting: false, size: 90, meta: { export: false }, cell: ({ row }) => <RowActions what={`model ${row.original.key || ''}`} onEdit={() => openEdit(row.original)} onDelete={() => setConfirmDelete(row.original)} /> },
  ]

  return (
    <div className="space-y-6">
      {notProvisioned && <StatePanel title="AI model catalogue is not enabled yet.">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V205_AI_ADMINISTRATION.sql</span>, then reload.</StatePanel>}
      {error && <StatePanel tone="red" title="Could not load models." onRetry={load}>{error}</StatePanel>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiTile label="Models configured" value={rows === null || error ? 'N/A' : summary.total} Icon={Cpu} />
        <KpiTile label="Active" value={rows === null || error ? 'N/A' : summary.activeCount} Icon={CheckCircle2} tone="text-green-400" />
        <KpiTile label="Priced" value={rows === null || error ? 'N/A' : summary.priced} Icon={Coins} sub="Input and output price set" />
        <KpiTile label="Default model" value={rows === null || error ? 'N/A' : (summary.defaultModel?.key || 'None')} Icon={Sparkles} tone="text-amber-400" />
        <KpiTile label="1M in + 1M out (default)" value={sampleCost == null ? 'N/A' : fmtUSD(sampleCost)} Icon={Gauge} />
      </div>

      <Toolbar
        search={search} setSearch={setSearch} placeholder="Search key, provider, model id, notes"
        extra={(
          <label><span className="sr-only">Status</span>
            <select className={`input ${CTRL}`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        )}
        onExcel={async () => { try { await exportToExcel(exportRows, COLS, HEADERS, reportFileName('TyrePulse AI Models')) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }}
        onPdf={async () => { try { await exportToPdf(exportRows, COLS.map((k, i) => ({ key: k, header: HEADERS[i] })), 'AI Models', reportFileName('TyrePulse AI Models'), 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }}
        onCreate={openCreate} createLabel="Add model" canCreate={!notProvisioned}
        count={filtered.length} total={summary.total}
      />

      <ResourceTable
        viewKey="ai-admin-models"
        columns={modelColumns}
        rows={filtered}
        loading={rows === null}
        error={error}
        onRetry={load}
        notProvisioned={notProvisioned}
        onRowClick={openEdit}
      />

      {modal && (
        <Modal title={modal.editing ? 'Edit model' : 'Add model'} onClose={() => setModal(null)} saving={saving}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Key"><input className="input w-full" placeholder="claude-haiku-4-5" value={form.key} maxLength={120} onChange={(e) => set('key', e.target.value)} /></Field>
              <Field label="Provider"><input className="input w-full" placeholder="anthropic / openai" value={form.provider} maxLength={120} onChange={(e) => set('provider', e.target.value)} /></Field>
            </div>
            <Field label="Model ID" hint="The exact provider model identifier."><input className="input w-full" placeholder="claude-haiku-4-5-20251001" value={form.model_id} maxLength={200} onChange={(e) => set('model_id', e.target.value)} /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Input $/1M tokens"><input className="input w-full" type="number" step="0.0001" min="0" placeholder="1.00" value={form.input_price} onChange={(e) => set('input_price', e.target.value)} /></Field>
              <Field label="Output $/1M tokens"><input className="input w-full" type="number" step="0.0001" min="0" placeholder="5.00" value={form.output_price} onChange={(e) => set('output_price', e.target.value)} /></Field>
              <Field label="Max tokens"><input className="input w-full" type="number" step="1" min="0" placeholder="2000" value={form.max_tokens} onChange={(e) => set('max_tokens', e.target.value)} /></Field>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active</label>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><input type="checkbox" checked={form.is_default} onChange={(e) => set('is_default', e.target.checked)} /> Default model</label>
            </div>
            <Field label="Notes (optional)"><textarea className="input w-full min-h-[70px] resize-y" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} /></Field>
            <FormFooter {...{ formError, saving, editing: modal.editing, onCancel: () => setModal(null) }} />
          </form>
        </Modal>
      )}

      {confirmDelete && <DeleteConfirm label={`Model ${confirmDelete.key || ''}`} onCancel={() => setConfirmDelete(null)} onConfirm={doDelete} deleting={deleting} />}
    </div>
  )
}

// ── Prompts tab ──────────────────────────────────────────────────────────────
const PROMPT_FORM = { agent: '', name: '', system_prompt: '', locale: 'en', version: 1, active: true, notes: '' }

function PromptsTab({ country }) {
  const { rows, error, notProvisioned, load, setError } = useResource(listAiPrompts, country)
  const [search, setSearch] = useState('')
  const [localeFilter, setLocaleFilter] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(PROMPT_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const k = useMemo(() => promptKpis(rows || []), [rows])
  const total = k.total

  const filtered = useMemo(() => (
    searchRecords(rows || [], search, ['agent', 'name', 'system_prompt', 'notes'])
      .filter((r) => !localeFilter || r.locale === localeFilter)
  ), [rows, search, localeFilter])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const openCreate = () => { setForm(PROMPT_FORM); setFormError(''); setModal({ editing: null }) }
  const openEdit = (r) => {
    setForm({
      agent: r.agent || '', name: r.name || '', system_prompt: r.system_prompt || '',
      locale: r.locale || 'en', version: r.version ?? 1, active: r.active !== false, notes: r.notes || '',
    })
    setFormError(''); setModal({ editing: r })
  }

  const submit = async (e) => {
    e?.preventDefault?.(); setFormError('')
    if (!form.agent.trim()) { setFormError('An agent identifier is required.'); return }
    if (!form.system_prompt.trim()) { setFormError('A system prompt is required.'); return }
    setSaving(true)
    try {
      if (modal.editing) await updateAiPrompt(modal.editing.id, form)
      else await createAiPrompt(form)
      setModal(null); await load()
    } catch (err) { setFormError(toUserMessage(err, 'Could not save the prompt.')) }
    finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try { await deleteAiPrompt(confirmDelete.id); setConfirmDelete(null); await load() }
    catch (err) { setError(toUserMessage(err, 'Could not delete the prompt.')) }
    finally { setDeleting(false) }
  }

  const promptColumns = [
    { id: 'agent', header: 'Agent', accessorFn: (r) => undef(r.agent), size: 140, ...SORT, cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue() ?? 'N/A'}</span> },
    { id: 'name', header: 'Name', accessorFn: (r) => undef(r.name), size: 200, ...SORT, cell: ({ getValue }) => getValue() ?? NA },
    { id: 'locale', header: 'Locale', accessorFn: (r) => undef(r.locale), size: 80, ...SORT, cell: ({ getValue }) => (getValue() ? <span className="uppercase">{getValue()}</span> : NA) },
    { id: 'version', header: 'Version', accessorFn: (r) => undef(r.version == null ? null : Number(r.version)), size: 80, meta: { align: 'right' }, ...SORT, cell: ({ getValue }) => (getValue() == null ? NA : `v${getValue()}`) },
    { id: 'length', header: 'Prompt length', accessorFn: (r) => (r.system_prompt ? r.system_prompt.length : undefined), size: 110, meta: { align: 'right' }, ...SORT, cell: ({ getValue }) => (getValue() == null ? NA : `${getValue().toLocaleString()} chars`) },
    { id: 'active', header: 'Active', accessorFn: (r) => (r.active !== false ? 1 : 0), size: 90, ...SORT, cell: ({ row }) => <Badge ok={row.original.active !== false} /> },
    { id: 'actions', header: '', enableSorting: false, size: 90, meta: { export: false }, cell: ({ row }) => <RowActions what={`prompt ${row.original.agent || ''}`} onEdit={() => openEdit(row.original)} onDelete={() => setConfirmDelete(row.original)} /> },
  ]

  const COLS = ['agent', 'name', 'locale', 'version', 'active']
  const HEADERS = ['Agent', 'Name', 'Locale', 'Version', 'Active']
  const exportRows = filtered.map((r) => ({
    agent: r.agent || '', name: r.name || '', locale: r.locale || '', version: r.version ?? '', active: fmtBool(r.active),
  }))

  return (
    <div className="space-y-6">
      {notProvisioned && <StatePanel title="AI prompt catalogue is not enabled yet.">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V205_AI_ADMINISTRATION.sql</span>, then reload.</StatePanel>}
      {error && <StatePanel tone="red" title="Could not load prompts." onRetry={load}>{error}</StatePanel>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiTile label="Prompts" value={rows === null || error ? 'N/A' : k.total} Icon={BookOpen} />
        <KpiTile label="Active" value={rows === null || error ? 'N/A' : k.active} Icon={CheckCircle2} tone="text-green-400" />
        <KpiTile label="Distinct agents" value={rows === null || error ? 'N/A' : k.agents} Icon={Sparkles} tone="text-amber-400" />
        <KpiTile label="Locales in use" value={rows === null || error ? 'N/A' : `${k.locales} of ${LOCALES.length}`} Icon={Languages} />
        <KpiTile label="Conflicting actives" value={rows === null || error ? 'N/A' : k.conflicts} Icon={AlertTriangle} tone={k.conflicts ? 'text-red-400' : 'text-[var(--text-primary)]'} sub="Same agent and locale, more than one active" />
      </div>

      <Toolbar
        search={search} setSearch={setSearch} placeholder="Search agent, name, prompt text"
        extra={(
          <label><span className="sr-only">Locale</span>
            <select className={`input ${CTRL}`} value={localeFilter} onChange={(e) => setLocaleFilter(e.target.value)}>
              <option value="">All locales</option>
              {LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        )}
        onExcel={async () => { try { await exportToExcel(exportRows, COLS, HEADERS, reportFileName('TyrePulse AI Prompts')) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }}
        onPdf={async () => { try { await exportToPdf(exportRows, COLS.map((c, i) => ({ key: c, header: HEADERS[i] })), 'AI Prompts', reportFileName('TyrePulse AI Prompts'), 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }}
        onCreate={openCreate} createLabel="Add prompt" canCreate={!notProvisioned}
        count={filtered.length} total={total}
      />

      <ResourceTable
        viewKey="ai-admin-prompts"
        columns={promptColumns}
        rows={filtered}
        loading={rows === null}
        error={error}
        onRetry={load}
        notProvisioned={notProvisioned}
        onRowClick={openEdit}
      />

      {modal && (
        <Modal title={modal.editing ? 'Edit prompt' : 'Add prompt'} onClose={() => setModal(null)} saving={saving}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Agent" hint="e.g. analyst, engineer, planner"><input className="input w-full" placeholder="analyst" value={form.agent} maxLength={120} onChange={(e) => set('agent', e.target.value)} /></Field>
              <Field label="Name (optional)"><input className="input w-full" placeholder="Analyst system prompt" value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Locale">
                <select className="input w-full" value={form.locale} onChange={(e) => set('locale', e.target.value)}>
                  {LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
              <Field label="Version"><input className="input w-full" type="number" step="1" min="1" value={form.version} onChange={(e) => set('version', e.target.value)} /></Field>
            </div>
            <Field label="System prompt"><textarea className="input w-full min-h-[160px] resize-y font-mono text-xs" placeholder="You are TyrePulse Analyst Agent..." value={form.system_prompt} maxLength={20000} onChange={(e) => set('system_prompt', e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active</label>
            <Field label="Notes (optional)"><textarea className="input w-full min-h-[60px] resize-y" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} /></Field>
            <FormFooter {...{ formError, saving, editing: modal.editing, onCancel: () => setModal(null) }} />
          </form>
        </Modal>
      )}

      {confirmDelete && <DeleteConfirm label={`Prompt ${confirmDelete.agent || ''} v${confirmDelete.version ?? 1}`} onCancel={() => setConfirmDelete(null)} onConfirm={doDelete} deleting={deleting} />}
    </div>
  )
}

// ── Budgets tab ──────────────────────────────────────────────────────────────
const BUDGET_FORM = { period: 'monthly', token_cap: '', cost_cap_usd: '', hard_stop: false, scope: '', active: true, notes: '' }

function BudgetsTab({ country }) {
  const { rows, error, notProvisioned, load, setError } = useResource(listAiBudgets, country)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(BUDGET_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  // Real spend windows from ai_token_logs through the ONE reader (aiOps, paged
  // past the 1,000-row cap). Unknown spend stays unknown, never 0.
  const [spend, setSpend] = useState({ available: false, windows: null, truncated: false, error: '' })
  const [statusFilter, setStatusFilter] = useState('')

  const loadSpend = useCallback(async () => {
    try {
      const { rows: logs, truncated } = await readTokenLogs({ days: 30, country })
      setSpend({ available: true, windows: spendWindows(logs, Date.now()), truncated, error: '' })
    } catch (err) {
      setSpend({ available: false, windows: null, truncated: false, error: toUserMessage(err, 'Live spend is unavailable.') })
    }
  }, [country])
  useEffect(() => { loadSpend() }, [loadSpend])

  const k = useMemo(() => budgetKpis(rows || [], spend.windows), [rows, spend.windows])
  const total = k.total

  const filtered = useMemo(() => {
    const base = searchRecords(rows || [], search, ['period', 'scope', 'notes'])
    if (statusFilter === 'over') return base.filter((r) => budgetUtilisation(r, spend.windows)?.over)
    if (statusFilter === 'active') return base.filter((r) => r.active !== false)
    if (statusFilter === 'inactive') return base.filter((r) => r.active === false)
    return base
  }, [rows, search, statusFilter, spend.windows])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const openCreate = () => { setForm(BUDGET_FORM); setFormError(''); setModal({ editing: null }) }
  const openEdit = (r) => {
    setForm({
      period: r.period || 'monthly', token_cap: r.token_cap ?? '', cost_cap_usd: r.cost_cap_usd ?? '',
      hard_stop: r.hard_stop === true, scope: r.scope || '', active: r.active !== false, notes: r.notes || '',
    })
    setFormError(''); setModal({ editing: r })
  }

  const submit = async (e) => {
    e?.preventDefault?.(); setFormError('')
    if (form.token_cap === '' && form.cost_cap_usd === '') { setFormError('Set a token cap or a cost cap.'); return }
    setSaving(true)
    try {
      if (modal.editing) await updateAiBudget(modal.editing.id, form)
      else await createAiBudget(form)
      setModal(null); await load()
    } catch (err) { setFormError(toUserMessage(err, 'Could not save the budget.')) }
    finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try { await deleteAiBudget(confirmDelete.id); setConfirmDelete(null); await load() }
    catch (err) { setError(toUserMessage(err, 'Could not delete the budget.')) }
    finally { setDeleting(false) }
  }

  const budgetColumns = [
    { id: 'period', header: 'Period', accessorFn: (r) => undef(r.period), size: 100, ...SORT, cell: ({ getValue }) => <span className="font-medium capitalize text-[var(--text-primary)]">{getValue() ?? 'N/A'}</span> },
    {
      id: 'cap', header: 'Cap', accessorFn: (r) => undef(r.cost_cap_usd != null ? Number(r.cost_cap_usd) : (r.token_cap != null ? Number(r.token_cap) : null)), size: 120, meta: { align: 'right' }, ...SORT,
      cell: ({ row }) => {
        const r = row.original
        return r.cost_cap_usd != null ? fmtUSD(r.cost_cap_usd) : (r.token_cap != null ? `${fmtNum(r.token_cap)} tok` : NA)
      },
    },
    {
      id: 'util', header: 'Utilisation', accessorFn: (r) => budgetUtilisation(r, spend.windows)?.pct, size: 170, ...SORT,
      cell: ({ row }) => {
        const u = budgetUtilisation(row.original, spend.windows)
        if (!u) return NA
        return (
          <div className="min-w-[120px]">
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className={u.over ? 'text-red-400 font-medium' : 'text-[var(--text-secondary)]'}>{u.pct.toFixed(0)}%{u.over ? ' over cap' : ''}</span>
              <span className="text-[var(--text-muted)]">{u.basis === 'cost' ? fmtUSD(u.spend) : `${fmtNum(u.spend)} tok`}</span>
            </div>
            <div className="w-full bg-[var(--panel-2)] rounded-full h-1.5" role="progressbar" aria-valuenow={Math.round(u.pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
              <div className={`h-1.5 rounded-full ${u.over ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${Math.min(u.pct, 100).toFixed(1)}%` }} />
            </div>
          </div>
        )
      },
    },
    { id: 'hard_stop', header: 'Hard stop', accessorFn: (r) => (r.hard_stop ? 1 : 0), size: 90, ...SORT, cell: ({ row }) => (row.original.hard_stop ? <Badge ok yes="Hard" /> : <span className="text-[var(--text-muted)] text-xs">Soft</span>) },
    { id: 'scope', header: 'Scope', accessorFn: (r) => undef(r.scope), size: 140, ...SORT, cell: ({ getValue }) => getValue() ?? <span className="text-[var(--text-muted)]">Org-wide</span> },
    { id: 'active', header: 'Active', accessorFn: (r) => (r.active !== false ? 1 : 0), size: 90, ...SORT, cell: ({ row }) => <Badge ok={row.original.active !== false} /> },
    { id: 'actions', header: '', enableSorting: false, size: 90, meta: { export: false }, cell: ({ row }) => <RowActions what={`${row.original.period || ''} budget`} onEdit={() => openEdit(row.original)} onDelete={() => setConfirmDelete(row.original)} /> },
  ]

  const COLS = ['period', 'token_cap', 'cost_cap_usd', 'hard_stop', 'scope', 'active', 'utilisation']
  const HEADERS = ['Period', 'Token cap', 'Cost cap $', 'Hard stop', 'Scope', 'Active', 'Utilisation %']
  const exportRows = filtered.map((r) => {
    const u = budgetUtilisation(r, spend.windows)
    return {
      period: r.period || 'N/A', token_cap: r.token_cap ?? 'N/A', cost_cap_usd: r.cost_cap_usd ?? 'N/A',
      hard_stop: fmtBool(r.hard_stop), scope: r.scope || 'Org-wide', active: fmtBool(r.active),
      utilisation: u ? Number(u.pct.toFixed(1)) : 'N/A',
    }
  })

  return (
    <div className="space-y-6">
      {notProvisioned && <StatePanel title="AI budgets are not enabled yet.">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V205_AI_ADMINISTRATION.sql</span>, then reload.</StatePanel>}
      {error && <StatePanel tone="red" title="Could not load budgets." onRetry={load}>{error}</StatePanel>}
      {!spend.available && !notProvisioned && (
        <StatePanel title="Live spend is unavailable." onRetry={loadSpend}>
          {spend.error || 'Spend could not be read.'} Showing cap configuration only; utilisation reads N/A.
        </StatePanel>
      )}
      {spend.truncated && (
        <p className="text-xs text-amber-400" role="status">Spend read hit its row ceiling, so utilisation is a lower bound.</p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiTile label="Budgets" value={rows === null || error ? 'N/A' : k.total} Icon={Wallet} />
        <KpiTile label="Active" value={rows === null || error ? 'N/A' : k.active} Icon={CheckCircle2} tone="text-green-400" />
        <KpiTile label="Hard stops" value={rows === null || error ? 'N/A' : k.hardStops} Icon={ShieldAlert} />
        <KpiTile label="Over cap now" value={rows === null || error || k.overCap == null ? 'N/A' : k.overCap} Icon={AlertTriangle} tone={k.overCap ? 'text-red-400' : 'text-[var(--text-primary)]'} />
        <KpiTile label="30 day spend" value={k.spend30d == null ? 'N/A' : fmtUSD(k.spend30d)} Icon={Coins} sub={spend.windows ? `${spend.windows.monthly.calls.toLocaleString()} calls` : undefined} />
      </div>

      <Toolbar
        search={search} setSearch={setSearch} placeholder="Search period, scope, notes"
        extra={(
          <label><span className="sr-only">Status</span>
            <select className={`input ${CTRL}`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All budgets</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="over">Over cap</option>
            </select>
          </label>
        )}
        onExcel={async () => { try { await exportToExcel(exportRows, COLS, HEADERS, reportFileName('TyrePulse AI Budgets')) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }}
        onPdf={async () => { try { await exportToPdf(exportRows, COLS.map((c, i) => ({ key: c, header: HEADERS[i] })), 'AI Budgets', reportFileName('TyrePulse AI Budgets'), 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }}
        onCreate={openCreate} createLabel="Add budget" canCreate={!notProvisioned}
        count={filtered.length} total={total}
      />

      <ResourceTable
        viewKey="ai-admin-budgets"
        columns={budgetColumns}
        rows={filtered}
        loading={rows === null}
        error={error}
        onRetry={load}
        notProvisioned={notProvisioned}
        onRowClick={openEdit}
      />

      {modal && (
        <Modal title={modal.editing ? 'Edit budget' : 'Add budget'} onClose={() => setModal(null)} saving={saving}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Period">
                <select className="input w-full" value={form.period} onChange={(e) => set('period', e.target.value)}>
                  {PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Scope (optional)" hint="Blank = org-wide"><input className="input w-full" placeholder="site / team / agent" value={form.scope} maxLength={200} onChange={(e) => set('scope', e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Token cap"><input className="input w-full" type="number" step="1" min="0" placeholder="5000000" value={form.token_cap} onChange={(e) => set('token_cap', e.target.value)} /></Field>
              <Field label="Cost cap (USD)"><input className="input w-full" type="number" step="0.01" min="0" placeholder="250.00" value={form.cost_cap_usd} onChange={(e) => set('cost_cap_usd', e.target.value)} /></Field>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active</label>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><input type="checkbox" checked={form.hard_stop} onChange={(e) => set('hard_stop', e.target.checked)} /> Hard stop at cap</label>
            </div>
            <Field label="Notes (optional)"><textarea className="input w-full min-h-[60px] resize-y" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} /></Field>
            <FormFooter {...{ formError, saving, editing: modal.editing, onCancel: () => setModal(null) }} />
          </form>
        </Modal>
      )}

      {confirmDelete && <DeleteConfirm label={`${confirmDelete.period || ''} budget`} onCancel={() => setConfirmDelete(null)} onConfirm={doDelete} deleting={deleting} />}
    </div>
  )
}

// ── Feedback tab ─────────────────────────────────────────────────────────────
const FEEDBACK_FORM = { conversation_id: '', message_id: '', rating: '', correct: '', note: '' }

function FeedbackTab({ country }) {
  const { rows, error, notProvisioned, load, setError } = useResource(listAiFeedback, country)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(FEEDBACK_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [verdictFilter, setVerdictFilter] = useState('')
  const k = useMemo(() => feedbackKpis(rows || []), [rows])
  const dist = useMemo(() => ratingDistribution(rows || []), [rows])
  const total = k.total

  const filtered = useMemo(() => {
    const base = searchRecords(rows || [], search, ['note', 'conversation_id', 'message_id'])
    if (verdictFilter === 'correct') return base.filter((r) => r.correct === true)
    if (verdictFilter === 'wrong') return base.filter((r) => r.correct === false)
    if (verdictFilter === 'unjudged') return base.filter((r) => r.correct == null)
    if (verdictFilter === 'low') return base.filter((r) => r.rating != null && Number(r.rating) <= 2)
    return base
  }, [rows, search, verdictFilter])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const openCreate = () => { setForm(FEEDBACK_FORM); setFormError(''); setModal({ editing: null }) }
  const openEdit = (r) => {
    setForm({
      conversation_id: r.conversation_id || '', message_id: r.message_id || '',
      rating: r.rating ?? '', correct: r.correct == null ? '' : (r.correct ? 'true' : 'false'), note: r.note || '',
    })
    setFormError(''); setModal({ editing: r })
  }

  const normalise = (f) => ({
    ...f,
    correct: f.correct === '' ? null : f.correct === 'true' || f.correct === true,
  })

  const submit = async (e) => {
    e?.preventDefault?.(); setFormError('')
    setSaving(true)
    try {
      if (modal.editing) await updateAiFeedback(modal.editing.id, normalise(form))
      else await createAiFeedback(normalise(form))
      setModal(null); await load()
    } catch (err) { setFormError(toUserMessage(err, 'Could not save the feedback.')) }
    finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try { await deleteAiFeedback(confirmDelete.id); setConfirmDelete(null); await load() }
    catch (err) { setError(toUserMessage(err, 'Could not delete the feedback.')) }
    finally { setDeleting(false) }
  }

  const feedbackColumns = [
    { id: 'created_at', header: 'Date', accessorFn: (r) => undef(r.created_at), size: 110, ...SORT, cell: ({ getValue }) => fmtDate(getValue()) },
    { id: 'rating', header: 'Rating', accessorFn: (r) => undef(r.rating == null ? null : Number(r.rating)), size: 80, meta: { align: 'right' }, ...SORT, cell: ({ getValue }) => (getValue() == null ? NA : <span className="font-semibold">{getValue()}/5</span>) },
    { id: 'correct', header: 'Correct', accessorFn: (r) => (r.correct == null ? undefined : (r.correct ? 1 : 0)), size: 90, ...SORT, cell: ({ row }) => (row.original.correct == null ? NA : <Badge ok={row.original.correct === true} yes="Correct" no="Wrong" />) },
    { id: 'note', header: 'Note', accessorFn: (r) => undef(r.note), size: 320, ...SORT, cell: ({ getValue }) => (getValue() ? <span className="block max-w-[320px] truncate" title={getValue()}>{getValue()}</span> : NA) },
    { id: 'conversation_id', header: 'Conversation', accessorFn: (r) => undef(r.conversation_id), size: 160, ...SORT, cell: ({ getValue }) => (getValue() ? <span className="font-mono text-xs block max-w-[160px] truncate" title={getValue()}>{getValue()}</span> : NA) },
    { id: 'actions', header: '', enableSorting: false, size: 90, meta: { export: false }, cell: ({ row }) => <RowActions what="feedback entry" onEdit={() => openEdit(row.original)} onDelete={() => setConfirmDelete(row.original)} /> },
  ]

  const COLS = ['created_at', 'rating', 'correct', 'note', 'conversation_id']
  const HEADERS = ['Date', 'Rating', 'Correct', 'Note', 'Conversation']
  const exportRows = filtered.map((r) => ({
    created_at: fmtDate(r.created_at), rating: r.rating ?? '', correct: fmtBool(r.correct),
    note: r.note || '', conversation_id: r.conversation_id || '',
  }))

  return (
    <div className="space-y-6">
      {notProvisioned && <StatePanel title="AI feedback is not enabled yet.">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V205_AI_ADMINISTRATION.sql</span>, then reload.</StatePanel>}
      {error && <StatePanel tone="red" title="Could not load feedback." onRetry={load}>{error}</StatePanel>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Feedback entries" value={rows === null || error ? 'N/A' : k.total} Icon={Star} />
        <KpiTile label="Avg rating" value={rows === null || error || k.avgRating == null ? 'N/A' : `${k.avgRating.toFixed(2)} / 5`} Icon={Star} tone="text-amber-400" sub={k.rated ? `${k.rated} rated` : 'No ratings yet'} />
        <KpiTile label="Marked correct" value={rows === null || error ? 'N/A' : k.correct} Icon={ThumbsUp} tone="text-green-400" sub={`of ${k.judged} judged`} />
        <KpiTile label="Correct share" value={rows === null || error || k.correctPct == null ? 'N/A' : `${k.correctPct.toFixed(0)}%`} Icon={CheckCircle2} sub="Among judged answers" />
      </div>

      {k.rated > 0 && (
        <div className="card" aria-label="Rating distribution">
          <p className="text-xs text-[var(--text-muted)] mb-2">Rating distribution</p>
          <ul className="grid grid-cols-5 gap-2">
            {dist.map((d) => (
              <li key={d.rating} className="text-center">
                <div className="h-16 flex items-end justify-center">
                  <div className="w-full max-w-[40px] rounded-t bg-amber-500/70" style={{ height: `${k.rated ? Math.max(4, (d.count / k.rated) * 100) : 0}%` }} />
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-1">{d.rating} star{d.rating === 1 ? '' : 's'}</p>
                <p className="text-xs font-semibold text-[var(--text-primary)] tabular-nums">{d.count}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Toolbar
        search={search} setSearch={setSearch} placeholder="Search note, conversation, message id"
        extra={(
          <label><span className="sr-only">Verdict</span>
            <select className={`input ${CTRL}`} value={verdictFilter} onChange={(e) => setVerdictFilter(e.target.value)}>
              <option value="">All feedback</option>
              <option value="correct">Correct</option>
              <option value="wrong">Wrong</option>
              <option value="unjudged">Not judged</option>
              <option value="low">Rated 2 or lower</option>
            </select>
          </label>
        )}
        onExcel={async () => { try { await exportToExcel(exportRows, COLS, HEADERS, reportFileName('TyrePulse AI Feedback')) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }}
        onPdf={async () => { try { await exportToPdf(exportRows, COLS.map((c, i) => ({ key: c, header: HEADERS[i] })), 'AI Feedback', reportFileName('TyrePulse AI Feedback'), 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }}
        onCreate={openCreate} createLabel="Log feedback" canCreate={!notProvisioned}
        count={filtered.length} total={total}
      />

      <ResourceTable
        viewKey="ai-admin-feedback"
        columns={feedbackColumns}
        rows={filtered}
        loading={rows === null}
        error={error}
        onRetry={load}
        notProvisioned={notProvisioned}
        onRowClick={openEdit}
      />

      {modal && (
        <Modal title={modal.editing ? 'Edit feedback' : 'Log feedback'} onClose={() => setModal(null)} saving={saving}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Rating (1 to 5)"><input className="input w-full" type="number" step="1" min="1" max="5" placeholder="4" value={form.rating} onChange={(e) => set('rating', e.target.value)} /></Field>
              <Field label="Correct?">
                <select className="input w-full" value={form.correct} onChange={(e) => set('correct', e.target.value)}>
                  <option value="">Unspecified</option>
                  <option value="true">Correct</option>
                  <option value="false">Incorrect</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Conversation ID (optional)"><input className="input w-full font-mono text-xs" placeholder="uuid" value={form.conversation_id} onChange={(e) => set('conversation_id', e.target.value)} /></Field>
              <Field label="Message ID (optional)"><input className="input w-full font-mono text-xs" placeholder="uuid" value={form.message_id} onChange={(e) => set('message_id', e.target.value)} /></Field>
            </div>
            <Field label="Note (optional)"><textarea className="input w-full min-h-[90px] resize-y" placeholder="What was right or wrong about the answer?" value={form.note} maxLength={8000} onChange={(e) => set('note', e.target.value)} /></Field>
            <FormFooter {...{ formError, saving, editing: modal.editing, onCancel: () => setModal(null), createWord: 'Log feedback' }} />
          </form>
        </Modal>
      )}

      {confirmDelete && <DeleteConfirm label="Feedback entry" onCancel={() => setConfirmDelete(null)} onConfirm={doDelete} deleting={deleting} />}
    </div>
  )
}

// ── shared modal footer ──────────────────────────────────────────────────────
function FormFooter({ formError, saving, editing, onCancel, createWord = 'Create' }) {
  return (
    <>
      {formError && (
        <div role="alert" className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className={`btn-secondary text-sm px-3 ${CTRL}`} disabled={saving}>Cancel</button>
        <button type="submit" className={`btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60 ${CTRL}`} disabled={saving}>
          {saving ? 'Saving...' : editing ? 'Save changes' : createWord}
        </button>
      </div>
    </>
  )
}

// ── Access denied ────────────────────────────────────────────────────────────
function AccessDenied() {
  return (
    <div className="card max-w-md mx-auto mt-16 p-8 text-center flex flex-col items-center gap-3">
      <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center">
        <ShieldAlert size={22} className="text-red-400" aria-hidden="true" />
      </div>
      <h1 className="text-lg font-bold text-[var(--text-primary)]">Admin access required</h1>
      <p className="text-sm text-muted">
        AI &amp; Automation Administration is restricted to administrators. If you
        need access, ask an administrator to update your role.
      </p>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AiAdministration() {
  const { profile, loading: authLoading } = useAuth()
  const { activeCountry } = useSettings()
  const isAdmin = ADMIN_ROLES.has(profile?.role)
  const [tab, setTab] = useState('operations')

  if (authLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="h-12 w-64 rounded-xl bg-[var(--panel-2)] animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-[var(--panel-2)] animate-pulse" />)}
        </div>
      </div>
    )
  }

  if (!isAdmin) return <AccessDenied />

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI & Automation Administration"
        subtitle="Monitor live AI usage, spend, failed requests and report delivery, and manage the model catalogue, prompts, budgets and feedback."
        icon={Sparkles}
        badge="Admin"
      />

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-[var(--input-border)] pb-px" role="tablist" aria-label="AI administration sections">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-3.5 min-h-[44px] text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${FOCUS} ${
              tab === key
                ? 'border-brand-bright text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      {tab === 'operations' && <AiOperationsTab country={activeCountry} />}
      {tab === 'jobs' && <AiDeliveryJobsTab />}
      {tab === 'models' && <ModelsTab country={activeCountry} />}
      {tab === 'prompts' && <PromptsTab country={activeCountry} />}
      {tab === 'budgets' && <BudgetsTab country={activeCountry} />}
      {tab === 'feedback' && <FeedbackTab country={activeCountry} />}
    </div>
  )
}
