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
  Sparkles, Cpu, BookOpen, Wallet, Star, Search, X, Filter, AlertTriangle,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, ShieldAlert, CheckCircle2,
  Coins, ThumbsUp, Activity, Send,
} from 'lucide-react'
import { AiOperationsTab, AiDeliveryJobsTab } from '../components/ai/AiOpsTabs'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { supabase } from '../lib/supabase'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { costPerCall, summariseModels, budgetStatus } from '../lib/aiAdmin'
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
const fmtUSD = (v) => (v == null || v === '' ? '—' : `$${Number(v).toFixed(4)}`)
const fmtNum = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString())
const fmtBool = (v) => (v === true ? 'Yes' : v === false ? 'No' : '—')
const fmtDate = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function isMissingRelationErr(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('could not find the table') ||
    m.includes('schema cache') || (m.includes('relation') && m.includes('ai_'))
}

// ── generic UI atoms ─────────────────────────────────────────────────────────
function KpiTile({ label, value, Icon, tone = 'text-[var(--text-primary)]' }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} />
      </div>
      <p className={`text-3xl font-bold mt-1 ${tone}`}>{value}</p>
    </div>
  )
}

function StatePanel({ tone = 'amber', title, children }) {
  const border = tone === 'red' ? 'border-red-800/50' : 'border-amber-800/50'
  const text = tone === 'red' ? 'text-red-300' : 'text-amber-300'
  return (
    <div className={`card border ${border} flex items-start gap-3`}>
      <AlertTriangle size={18} className={`${tone === 'red' ? 'text-red-400' : 'text-amber-400'} mt-0.5 shrink-0`} />
      <div>
        <p className={`${text} font-medium`}>{title}</p>
        <p className="text-[var(--text-muted)] text-sm mt-1">{children}</p>
      </div>
    </div>
  )
}

function Badge({ ok, yes = 'Active', no = 'Inactive' }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
      ok ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-[var(--text-muted)]'
    }`}>
      {ok && <CheckCircle2 size={11} />}{ok ? yes : no}
    </span>
  )
}

function Modal({ title, onClose, saving, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !saving && onClose()}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-[var(--text-primary)]">{title}</h3>
          <button onClick={() => !saving && onClose()} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-[var(--text-muted)] mt-1">{hint}</p>}
    </div>
  )
}

function DeleteConfirm({ label, onCancel, onConfirm, deleting }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && onCancel()}>
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
          <div>
            <h3 className="text-[var(--text-primary)] font-semibold">Delete this record?</h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">{label}. This can’t be undone.</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onCancel} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
          <button onClick={onConfirm} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
            <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Toolbar({ search, setSearch, placeholder, extra, onExcel, onPdf, onCreate, createLabel, canCreate, count, total }) {
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input className="input pl-9 w-full" placeholder={placeholder} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {extra}
        <button onClick={onExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!count}>
          <FileSpreadsheet size={14} /> Excel
        </button>
        <button onClick={onPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!count}>
          <FileText size={14} /> PDF
        </button>
        <button onClick={onCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={!canCreate}>
          <Plus size={14} /> {createLabel}
        </button>
        <span className="text-xs text-[var(--text-muted)] ml-auto w-full sm:w-auto text-right">{count} of {total}</span>
      </div>
    </div>
  )
}

function DataTable({ headers, loading, empty, notProvisioned, children }) {
  return (
    <div className="card overflow-hidden !p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
              {headers.map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0, 1, 2, 3, 4].map((i) => (
                <tr key={i} className="border-b border-[var(--input-border)]/50">
                  <td colSpan={headers.length} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td>
                </tr>
              ))
            ) : empty ? (
              <tr><td colSpan={headers.length} className="px-4 py-12 text-center text-[var(--text-muted)]">
                <Filter size={22} className="mx-auto mb-2 opacity-60" />
                {notProvisioned ? 'Not provisioned yet.' : 'No records match these filters.'}
              </td></tr>
            ) : children}
          </tbody>
        </table>
      </div>
    </div>
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
      if (isMissingRelationErr(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load records.')
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

  const summary = useMemo(() => summariseModels(rows || []), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (!q) return true
      return `${r.key || ''} ${r.provider || ''} ${r.model_id || ''} ${r.notes || ''}`.toLowerCase().includes(q)
    })
  }, [rows, search])

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
    } catch (err) { setFormError(err?.message || 'Could not save the model.') }
    finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try { await deleteAiModel(confirmDelete.id); setConfirmDelete(null); await load() }
    catch (err) { setError(err?.message || 'Could not delete the model.') }
    finally { setDeleting(false) }
  }

  const COLS = ['key', 'provider', 'model_id', 'input_price', 'output_price', 'max_tokens', 'is_default', 'active']
  const HEADERS = ['Key', 'Provider', 'Model ID', 'Input $/1M', 'Output $/1M', 'Max tokens', 'Default', 'Active']
  const exportRows = filtered.map((r) => ({
    key: r.key || '', provider: r.provider || '', model_id: r.model_id || '',
    input_price: r.input_price ?? '', output_price: r.output_price ?? '',
    max_tokens: r.max_tokens ?? '', is_default: fmtBool(r.is_default), active: fmtBool(r.active),
  }))
  // A reference $6/MTok call cost preview for the default model (illustrative).
  const sampleCost = summary.defaultModel ? costPerCall(summary.defaultModel, 1_000_000, 1_000_000) : null

  return (
    <div className="space-y-6">
      {notProvisioned && <StatePanel title="AI model catalogue isn’t enabled yet.">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V205_AI_ADMINISTRATION.sql</span>, then reload.</StatePanel>}
      {error && <StatePanel tone="red" title="Couldn’t load models.">{error}</StatePanel>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Models configured" value={rows === null ? '—' : summary.total} Icon={Cpu} />
        <KpiTile label="Active" value={rows === null ? '—' : summary.activeCount} Icon={CheckCircle2} tone="text-green-400" />
        <KpiTile label="Default model" value={rows === null ? '—' : (summary.defaultModel?.key || 'None')} Icon={Sparkles} tone="text-amber-400" />
        <KpiTile label="1M+1M call (default)" value={sampleCost == null ? '—' : fmtUSD(sampleCost)} Icon={Coins} tone="text-sky-400" />
      </div>

      <Toolbar
        search={search} setSearch={setSearch} placeholder="Search key, provider, model id, notes…"
        onExcel={() => exportToExcel(exportRows, COLS, HEADERS, 'ai_models')}
        onPdf={() => exportToPdf(exportRows, COLS.map((k, i) => ({ key: k, header: HEADERS[i] })), 'AI Models', 'ai_models', 'landscape')}
        onCreate={openCreate} createLabel="Add model" canCreate={!notProvisioned}
        count={filtered.length} total={summary.total}
      />

      <DataTable headers={[...HEADERS, '']} loading={rows === null} empty={filtered.length === 0} notProvisioned={notProvisioned}>
        {filtered.map((r) => (
          <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
            <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.key || '—'}</td>
            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.provider || '—'}</td>
            <td className="px-4 py-2.5 text-[var(--text-secondary)] font-mono text-xs">{r.model_id || '—'}</td>
            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtUSD(r.input_price)}</td>
            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtUSD(r.output_price)}</td>
            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtNum(r.max_tokens)}</td>
            <td className="px-4 py-2.5">{r.is_default ? <Badge ok yes="Default" /> : <span className="text-[var(--text-muted)] text-xs">—</span>}</td>
            <td className="px-4 py-2.5"><Badge ok={r.active !== false} /></td>
            <td className="px-4 py-2.5">
              <div className="flex items-center justify-end gap-1">
                <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
              </div>
            </td>
          </tr>
        ))}
      </DataTable>

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

  const total = (rows || []).length
  const activeCount = (rows || []).filter((r) => r.active !== false).length
  const agentCount = new Set((rows || []).map((r) => r.agent).filter(Boolean)).size

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (localeFilter && r.locale !== localeFilter) return false
      if (!q) return true
      return `${r.agent || ''} ${r.name || ''} ${r.system_prompt || ''} ${r.notes || ''}`.toLowerCase().includes(q)
    })
  }, [rows, search, localeFilter])

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
    } catch (err) { setFormError(err?.message || 'Could not save the prompt.') }
    finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try { await deleteAiPrompt(confirmDelete.id); setConfirmDelete(null); await load() }
    catch (err) { setError(err?.message || 'Could not delete the prompt.') }
    finally { setDeleting(false) }
  }

  const COLS = ['agent', 'name', 'locale', 'version', 'active']
  const HEADERS = ['Agent', 'Name', 'Locale', 'Version', 'Active']
  const exportRows = filtered.map((r) => ({
    agent: r.agent || '', name: r.name || '', locale: r.locale || '', version: r.version ?? '', active: fmtBool(r.active),
  }))

  return (
    <div className="space-y-6">
      {notProvisioned && <StatePanel title="AI prompt catalogue isn’t enabled yet.">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V205_AI_ADMINISTRATION.sql</span>, then reload.</StatePanel>}
      {error && <StatePanel tone="red" title="Couldn’t load prompts.">{error}</StatePanel>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Prompts" value={rows === null ? '—' : total} Icon={BookOpen} />
        <KpiTile label="Active" value={rows === null ? '—' : activeCount} Icon={CheckCircle2} tone="text-green-400" />
        <KpiTile label="Distinct agents" value={rows === null ? '—' : agentCount} Icon={Sparkles} tone="text-amber-400" />
        <KpiTile label="Locales" value={rows === null ? '—' : LOCALES.length} Icon={FileText} tone="text-sky-400" />
      </div>

      <Toolbar
        search={search} setSearch={setSearch} placeholder="Search agent, name, prompt text…"
        extra={(
          <select className="input" value={localeFilter} onChange={(e) => setLocaleFilter(e.target.value)} aria-label="Locale">
            <option value="">All locales</option>
            {LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        onExcel={() => exportToExcel(exportRows, COLS, HEADERS, 'ai_prompts')}
        onPdf={() => exportToPdf(exportRows, COLS.map((k, i) => ({ key: k, header: HEADERS[i] })), 'AI Prompts', 'ai_prompts', 'landscape')}
        onCreate={openCreate} createLabel="Add prompt" canCreate={!notProvisioned}
        count={filtered.length} total={total}
      />

      <DataTable headers={[...HEADERS, '']} loading={rows === null} empty={filtered.length === 0} notProvisioned={notProvisioned}>
        {filtered.map((r) => (
          <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
            <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.agent || '—'}</td>
            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.name || '—'}</td>
            <td className="px-4 py-2.5 text-[var(--text-secondary)] uppercase">{r.locale || '—'}</td>
            <td className="px-4 py-2.5 text-[var(--text-secondary)]">v{r.version ?? 1}</td>
            <td className="px-4 py-2.5"><Badge ok={r.active !== false} /></td>
            <td className="px-4 py-2.5">
              <div className="flex items-center justify-end gap-1">
                <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
              </div>
            </td>
          </tr>
        ))}
      </DataTable>

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
            <Field label="System prompt"><textarea className="input w-full min-h-[160px] resize-y font-mono text-xs" placeholder="You are TyrePulse Analyst Agent…" value={form.system_prompt} maxLength={20000} onChange={(e) => set('system_prompt', e.target.value)} /></Field>
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
const PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30 }

function BudgetsTab({ country }) {
  const { rows, error, notProvisioned, load, setError } = useResource(listAiBudgets, country)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(BUDGET_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  // Real spend windows from the existing ai_token_logs table (no fabrication).
  const [spend, setSpend] = useState({ available: false, byPeriod: {} })

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
        const { data, error: err } = await supabase
          .from('ai_token_logs')
          .select('cost_usd, prompt_tokens, completion_tokens, created_at')
          .gte('created_at', since)
          .limit(20000)
        if (err) throw err
        const now = Date.now()
        const acc = { daily: { cost: 0, tokens: 0 }, weekly: { cost: 0, tokens: 0 }, monthly: { cost: 0, tokens: 0 } }
        for (const r of data || []) {
          const age = now - new Date(r.created_at).getTime()
          const cost = Number(r.cost_usd) || 0
          const toks = (Number(r.prompt_tokens) || 0) + (Number(r.completion_tokens) || 0)
          for (const p of PERIODS) {
            if (age <= PERIOD_DAYS[p] * 86_400_000) { acc[p].cost += cost; acc[p].tokens += toks }
          }
        }
        if (alive) setSpend({ available: true, byPeriod: acc })
      } catch {
        if (alive) setSpend({ available: false, byPeriod: {} })
      }
    })()
    return () => { alive = false }
  }, [country])

  const total = (rows || []).length
  const activeCount = (rows || []).filter((r) => r.active !== false).length
  const hardStops = (rows || []).filter((r) => r.hard_stop === true).length

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (!q) return true
      return `${r.period || ''} ${r.scope || ''} ${r.notes || ''}`.toLowerCase().includes(q)
    })
  }, [rows, search])

  const spendFor = (b) => {
    if (!spend.available) return null
    const p = spend.byPeriod[b.period] || { cost: 0, tokens: 0 }
    // If a cost cap is set, compare against cost; else against tokens.
    return b.cost_cap_usd != null ? p.cost : p.tokens
  }

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
    } catch (err) { setFormError(err?.message || 'Could not save the budget.') }
    finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try { await deleteAiBudget(confirmDelete.id); setConfirmDelete(null); await load() }
    catch (err) { setError(err?.message || 'Could not delete the budget.') }
    finally { setDeleting(false) }
  }

  const COLS = ['period', 'token_cap', 'cost_cap_usd', 'hard_stop', 'scope', 'active']
  const HEADERS = ['Period', 'Token cap', 'Cost cap $', 'Hard stop', 'Scope', 'Active']
  const exportRows = filtered.map((r) => ({
    period: r.period || '', token_cap: r.token_cap ?? '', cost_cap_usd: r.cost_cap_usd ?? '',
    hard_stop: fmtBool(r.hard_stop), scope: r.scope || '', active: fmtBool(r.active),
  }))

  return (
    <div className="space-y-6">
      {notProvisioned && <StatePanel title="AI budgets aren’t enabled yet.">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V205_AI_ADMINISTRATION.sql</span>, then reload.</StatePanel>}
      {error && <StatePanel tone="red" title="Couldn’t load budgets.">{error}</StatePanel>}
      {!spend.available && !notProvisioned && (
        <p className="text-xs text-[var(--text-muted)]">Live spend unavailable (no ai_token_logs access) — showing cap configuration only.</p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Budgets" value={rows === null ? '—' : total} Icon={Wallet} />
        <KpiTile label="Active" value={rows === null ? '—' : activeCount} Icon={CheckCircle2} tone="text-green-400" />
        <KpiTile label="Hard stops" value={rows === null ? '—' : hardStops} Icon={ShieldAlert} tone="text-red-400" />
        <KpiTile label="30d spend" value={spend.available ? fmtUSD(spend.byPeriod.monthly?.cost) : '—'} Icon={Coins} tone="text-sky-400" />
      </div>

      <Toolbar
        search={search} setSearch={setSearch} placeholder="Search period, scope, notes…"
        onExcel={() => exportToExcel(exportRows, COLS, HEADERS, 'ai_budgets')}
        onPdf={() => exportToPdf(exportRows, COLS.map((k, i) => ({ key: k, header: HEADERS[i] })), 'AI Budgets', 'ai_budgets', 'landscape')}
        onCreate={openCreate} createLabel="Add budget" canCreate={!notProvisioned}
        count={filtered.length} total={total}
      />

      <DataTable headers={['Period', 'Cap', 'Utilisation', 'Hard stop', 'Scope', 'Active', '']} loading={rows === null} empty={filtered.length === 0} notProvisioned={notProvisioned}>
        {filtered.map((r) => {
          const status = spend.available ? budgetStatus(r, spendFor(r)) : null
          const capLabel = r.cost_cap_usd != null ? fmtUSD(r.cost_cap_usd) : (r.token_cap != null ? `${fmtNum(r.token_cap)} tok` : '—')
          return (
            <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
              <td className="px-4 py-2.5 font-medium text-[var(--text-primary)] capitalize">{r.period || '—'}</td>
              <td className="px-4 py-2.5 text-[var(--text-secondary)]">{capLabel}</td>
              <td className="px-4 py-2.5 min-w-[140px]">
                {status && status.cap > 0 ? (
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className={status.over ? 'text-red-400 font-medium' : 'text-[var(--text-muted)]'}>{status.pct.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-[var(--input-bg)] rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${status.over ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${Math.min(status.pct, 100).toFixed(1)}%` }} />
                    </div>
                  </div>
                ) : <span className="text-[var(--text-muted)] text-xs">—</span>}
              </td>
              <td className="px-4 py-2.5">{r.hard_stop ? <Badge ok yes="Hard" /> : <span className="text-[var(--text-muted)] text-xs">Soft</span>}</td>
              <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.scope || 'org-wide'}</td>
              <td className="px-4 py-2.5"><Badge ok={r.active !== false} /></td>
              <td className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-1">
                  <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                  <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                </div>
              </td>
            </tr>
          )
        })}
      </DataTable>

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

  const total = (rows || []).length
  const rated = (rows || []).filter((r) => r.rating != null)
  const avgRating = rated.length ? (rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length) : null
  const correctCount = (rows || []).filter((r) => r.correct === true).length
  const correctPct = total ? (correctCount / total) * 100 : null

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (!q) return true
      return `${r.note || ''} ${r.conversation_id || ''} ${r.message_id || ''}`.toLowerCase().includes(q)
    })
  }, [rows, search])

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
    } catch (err) { setFormError(err?.message || 'Could not save the feedback.') }
    finally { setSaving(false) }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try { await deleteAiFeedback(confirmDelete.id); setConfirmDelete(null); await load() }
    catch (err) { setError(err?.message || 'Could not delete the feedback.') }
    finally { setDeleting(false) }
  }

  const COLS = ['created_at', 'rating', 'correct', 'note', 'conversation_id']
  const HEADERS = ['Date', 'Rating', 'Correct', 'Note', 'Conversation']
  const exportRows = filtered.map((r) => ({
    created_at: fmtDate(r.created_at), rating: r.rating ?? '', correct: fmtBool(r.correct),
    note: r.note || '', conversation_id: r.conversation_id || '',
  }))

  return (
    <div className="space-y-6">
      {notProvisioned && <StatePanel title="AI feedback isn’t enabled yet.">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V205_AI_ADMINISTRATION.sql</span>, then reload.</StatePanel>}
      {error && <StatePanel tone="red" title="Couldn’t load feedback.">{error}</StatePanel>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Feedback entries" value={rows === null ? '—' : total} Icon={Star} />
        <KpiTile label="Avg rating" value={rows === null ? '—' : (avgRating == null ? '—' : avgRating.toFixed(2))} Icon={Star} tone="text-amber-400" />
        <KpiTile label="Marked correct" value={rows === null ? '—' : correctCount} Icon={ThumbsUp} tone="text-green-400" />
        <KpiTile label="Correct %" value={rows === null ? '—' : (correctPct == null ? '—' : `${correctPct.toFixed(0)}%`)} Icon={CheckCircle2} tone="text-sky-400" />
      </div>

      <Toolbar
        search={search} setSearch={setSearch} placeholder="Search note, conversation, message id…"
        onExcel={() => exportToExcel(exportRows, COLS, HEADERS, 'ai_feedback')}
        onPdf={() => exportToPdf(exportRows, COLS.map((k, i) => ({ key: k, header: HEADERS[i] })), 'AI Feedback', 'ai_feedback', 'landscape')}
        onCreate={openCreate} createLabel="Log feedback" canCreate={!notProvisioned}
        count={filtered.length} total={total}
      />

      <DataTable headers={[...HEADERS, '']} loading={rows === null} empty={filtered.length === 0} notProvisioned={notProvisioned}>
        {filtered.map((r) => (
          <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
            <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.created_at)}</td>
            <td className="px-4 py-2.5 text-[var(--text-primary)] font-semibold">{r.rating == null ? '—' : `${r.rating}/5`}</td>
            <td className="px-4 py-2.5">{r.correct == null ? <span className="text-[var(--text-muted)] text-xs">—</span> : <Badge ok={r.correct === true} yes="Correct" no="Wrong" />}</td>
            <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[320px] truncate" title={r.note || ''}>{r.note || '—'}</td>
            <td className="px-4 py-2.5 text-[var(--text-muted)] font-mono text-xs truncate max-w-[160px]">{r.conversation_id || '—'}</td>
            <td className="px-4 py-2.5">
              <div className="flex items-center justify-end gap-1">
                <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
              </div>
            </td>
          </tr>
        ))}
      </DataTable>

      {modal && (
        <Modal title={modal.editing ? 'Edit feedback' : 'Log feedback'} onClose={() => setModal(null)} saving={saving}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Rating (1–5)"><input className="input w-full" type="number" step="1" min="1" max="5" placeholder="4" value={form.rating} onChange={(e) => set('rating', e.target.value)} /></Field>
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
        <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
          {saving ? 'Saving…' : editing ? 'Save changes' : createWord}
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
        <ShieldAlert size={22} className="text-red-400" />
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
        <div className="h-12 w-64 rounded-xl bg-white/5 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-white/5 animate-pulse" />)}
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
      <div className="flex flex-wrap gap-2 border-b border-[var(--input-border)] pb-px">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-brand-bright text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Icon size={15} /> {label}
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
