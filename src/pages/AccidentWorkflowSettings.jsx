/**
 * AccidentWorkflowSettings (route /accident-workflow-settings) - one admin home
 * to configure the accident management workflow:
 *
 *   1. Departments   - the routing departments (name, code, active, sort order).
 *   2. Routing Rules - who gets notified for which accident events, with match
 *      conditions (severity / type / site / country / cost / injury / VOR /
 *      third-party) and recipient departments + to/cc/escalate roles.
 *   3. Email Templates - the approved notification templates (subject + HTML
 *      body with {{tokens}}), with a token legend and a live sample preview.
 *   4. Email Delivery - the master ON/OFF switch that gates whether the workflow
 *      actually sends real emails to routed managers.
 *
 * The backend (tables, triggers, RLS) and the service layer already exist; this
 * page is presentation + orchestration only. Mutations are gated to elevated
 * roles (Admin / Manager / Director) and super admins; everyone else is
 * read-only. Honest loading / empty / error+Retry states, no fabricated data.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  GitBranch, Building2, ListChecks, Mail, ToggleRight, Plus, X, Save,
  Loader2, AlertTriangle, Trash2, Pencil, RefreshCw, CheckCircle2,
  Eye, ShieldAlert, Power, PowerOff, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../contexts/AuthContext'
import {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  listRoutingRules, createRoutingRule, updateRoutingRule, deleteRoutingRule,
  listEmailTemplates, updateEmailTemplate, createEmailTemplate,
  getAccidentEmailsEnabled, setAccidentEmailsEnabled,
} from '../lib/api/accidentWorkflow'
import { SEVERITY_TOKENS, severityLabel } from '../lib/accidentWorkflow'
import { toUserMessage } from '../lib/safeError'

const WRITE_ROLES = new Set(['Admin', 'Manager', 'Director'])

// Recipient role choices for routing rules (Title Case, mirrors the app roles).
const ROLE_CHOICES = [
  'Admin', 'Manager', 'Director', 'Reporter', 'Inspector', 'Tyre Man', 'Driver',
  'Maintenance Supervisor', 'Store Keeper', 'Data Monitor Officer',
]

const EVENT_CHOICES = [
  { value: '', label: 'Any event' },
  { value: 'accident.reported', label: 'Accident reported' },
  { value: 'accident.stage_changed', label: 'Stage changed' },
  { value: 'accident.claim_changed', label: 'Claim changed' },
  { value: 'accident.vor_changed', label: 'VOR changed' },
]
const EVENT_LABEL = Object.fromEntries(EVENT_CHOICES.map((e) => [e.value, e.label]))

// The {{tokens}} an approved email body may use, for the legend + preview.
const TEMPLATE_TOKENS = [
  'reference_no', 'company', 'site', 'asset_no', 'plate_number', 'driver_name',
  'incident_date', 'location', 'severity', 'stage_label', 'vor_label',
  'estimated_cost', 'approved_cost', 'claim_status', 'department',
  'pending_action', 'due_date', 'link',
]
const SAMPLE_TOKEN_VALUES = {
  reference_no: 'ACC-2026-0142',
  company: 'Company A',
  site: 'DHAHBAN',
  asset_no: 'TRK-1187',
  plate_number: '4821 ABC',
  driver_name: 'Ahmed Ali',
  incident_date: '2026-07-20',
  location: 'Gate 3, North Yard',
  severity: 'Major',
  stage_label: 'Insurance Claim',
  vor_label: 'Vehicle Off Road',
  estimated_cost: '12,500 SAR',
  approved_cost: '9,800 SAR',
  claim_status: 'Submitted',
  department: 'Insurance',
  pending_action: 'Submit insurer estimate',
  due_date: '2026-07-27',
  link: 'https://app.tyrepulse.app/accidents/ACC-2026-0142',
}

const TABS = [
  { id: 'departments', label: 'Departments', icon: Building2 },
  { id: 'rules', label: 'Routing Rules', icon: ListChecks },
  { id: 'templates', label: 'Email Templates', icon: Mail },
  { id: 'delivery', label: 'Email Delivery', icon: ToggleRight },
]

const inputCls =
  'w-full rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500'

/** Replace {{token}} occurrences with sample values (local, no network). */
function renderTemplatePreview(html) {
  let out = String(html || '')
  for (const [k, v] of Object.entries(SAMPLE_TOKEN_VALUES)) {
    out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), v)
  }
  // Leave any unknown tokens visible so authors can spot typos.
  return out
}

function arr(v) { return Array.isArray(v) ? v : [] }

export default function AccidentWorkflowSettings() {
  const { profile, isSuperAdmin } = useAuth()
  const canWrite = isSuperAdmin === true || WRITE_ROLES.has(profile?.role)

  const [tab, setTab] = useState('departments')

  // Section data + independent load state so one failure never blanks the page.
  const [departments, setDepartments] = useState([])
  const [rules, setRules] = useState([])
  const [templates, setTemplates] = useState([])
  const [emailsEnabled, setEmailsEnabled] = useState(false)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errors, setErrors] = useState({ departments: '', rules: '', templates: '', delivery: '' })
  const setSectionError = (k, v) => setErrors((e) => ({ ...e, [k]: v }))

  const load = useCallback(async () => {
    setRefreshing(true)
    const next = { departments: '', rules: '', templates: '', delivery: '' }
    const [d, r, t, e] = await Promise.allSettled([
      listDepartments(),
      listRoutingRules(),
      listEmailTemplates(),
      getAccidentEmailsEnabled(),
    ])
    if (d.status === 'fulfilled') setDepartments(arr(d.value)); else next.departments = toUserMessage(d.reason, 'Could not load departments.')
    if (r.status === 'fulfilled') setRules(arr(r.value)); else next.rules = toUserMessage(r.reason, 'Could not load routing rules.')
    if (t.status === 'fulfilled') setTemplates(arr(t.value)); else next.templates = toUserMessage(t.reason, 'Could not load email templates.')
    if (e.status === 'fulfilled') setEmailsEnabled(e.value === true); else next.delivery = toUserMessage(e.reason, 'Could not load the delivery setting.')
    setErrors(next)
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { setLoading(true); load() }, [load])

  const activeDeptNames = useMemo(
    () => departments.filter((d) => d.active !== false).map((d) => d.name),
    [departments],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accident Workflow"
        subtitle="Configure the accident management workflow: departments, notification routing rules, approved email templates and the master email delivery switch."
        icon={GitBranch}
        onRefresh={load}
        refreshing={refreshing}
      />

      {!canWrite && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <ShieldAlert size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Read-only view</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              You can review the workflow configuration. Changes require an Admin, Manager or Director role.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--input-border)] overflow-x-auto">
        {TABS.map((t) => {
          const on = tab === t.id
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${on ? 'border-blue-500 text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'departments' && (
        <DepartmentsTab
          rows={departments} setRows={setDepartments} canWrite={canWrite}
          loading={loading} error={errors.departments} onRetry={load} clearError={() => setSectionError('departments', '')}
        />
      )}
      {tab === 'rules' && (
        <RulesTab
          rows={rules} setRows={setRules} deptNames={activeDeptNames} canWrite={canWrite}
          loading={loading} error={errors.rules} onRetry={load} clearError={() => setSectionError('rules', '')}
        />
      )}
      {tab === 'templates' && (
        <TemplatesTab
          rows={templates} setRows={setTemplates} canWrite={canWrite}
          loading={loading} error={errors.templates} onRetry={load} clearError={() => setSectionError('templates', '')}
        />
      )}
      {tab === 'delivery' && (
        <DeliveryTab
          enabled={emailsEnabled} setEnabled={setEmailsEnabled} canWrite={canWrite}
          loading={loading} error={errors.delivery} onRetry={load} setSectionError={(v) => setSectionError('delivery', v)}
        />
      )}
    </div>
  )
}

/* ─────────────────────────── shared bits ─────────────────────────── */

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="card border border-red-800/50 flex items-start gap-3">
      <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="text-red-300 font-medium">Something went wrong.</p>
        <p className="text-[var(--text-muted)] text-sm mt-1">{message}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  )
}

function TableSkeleton() {
  return <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="py-10 text-center text-[var(--text-muted)]">
      <Icon size={28} className="mx-auto mb-2 opacity-50" />
      <p className="text-sm">{text}</p>
    </div>
  )
}

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="font-semibold text-[var(--text-primary)]">{title}</h3>
          <button onClick={onClose} className="ml-auto p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Reliable checkbox multiselect (no dropdown - avoids the .card clip issue). */
function MultiCheck({ label, options, selected, onChange, columns = 2, optionLabel }) {
  const set = new Set(arr(selected))
  const toggle = (v) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v); else next.add(v)
    onChange([...next])
  }
  const gridCls = columns === 1 ? 'grid-cols-1' : 'grid-cols-2'
  return (
    <div className="text-xs text-[var(--text-muted)] space-y-1">
      <span>{label}</span>
      <div className={`grid ${gridCls} gap-1 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-2 max-h-40 overflow-y-auto`}>
        {options.length === 0 && <span className="text-[11px] text-[var(--text-muted)] col-span-full">No options.</span>}
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] cursor-pointer">
            <input type="checkbox" checked={set.has(o)} onChange={() => toggle(o)} className="accent-blue-500" />
            {optionLabel ? optionLabel(o) : o}
          </label>
        ))}
      </div>
    </div>
  )
}

function Pills({ values, empty = 'None' }) {
  const list = arr(values)
  if (list.length === 0) return <span className="text-[var(--text-muted)]">{empty}</span>
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((v) => (
        <span key={v} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">{v}</span>
      ))}
    </span>
  )
}

function ActiveBadge({ active }) {
  return (
    <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${active !== false ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-500/15 text-slate-300 border-slate-500/30'}`}>
      {active !== false ? 'Active' : 'Inactive'}
    </span>
  )
}

/* ─────────────────────────── Departments ─────────────────────────── */

const EMPTY_DEPT = { name: '', code: '', description: '', active: true, sort_order: 0 }

function DepartmentsTab({ rows, setRows, canWrite, loading, error, onRetry, clearError }) {
  const [modal, setModal] = useState(null) // { mode:'create'|'edit', values }
  const [confirmDel, setConfirmDel] = useState(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  const openCreate = () => { setFormError(''); setModal({ mode: 'create', values: { ...EMPTY_DEPT } }) }
  const openEdit = (d) => { setFormError(''); setModal({ mode: 'edit', id: d.id, values: { name: d.name || '', code: d.code || '', description: d.description || '', active: d.active !== false, sort_order: d.sort_order ?? 0 } }) }
  const setV = (k, v) => setModal((m) => ({ ...m, values: { ...m.values, [k]: v } }))

  const save = async (e) => {
    e?.preventDefault?.()
    setFormError('')
    const v = modal.values
    if (!String(v.name || '').trim()) { setFormError('A department name is required.'); return }
    setBusy(true)
    try {
      const payload = {
        name: v.name.trim(),
        code: v.code?.trim() || null,
        description: v.description?.trim() || null,
        active: v.active !== false,
        sort_order: Number(v.sort_order) || 0,
      }
      if (modal.mode === 'create') {
        const created = await createDepartment(payload)
        if (created) setRows((r) => [...r, created].sort(sortDept))
      } else {
        const updated = await updateDepartment(modal.id, payload)
        setRows((r) => r.map((x) => (x.id === modal.id ? { ...x, ...(updated || payload) } : x)).sort(sortDept))
      }
      setModal(null)
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the department.'))
    } finally { setBusy(false) }
  }

  const doDelete = async () => {
    if (!confirmDel) return
    setBusy(true)
    try {
      await deleteDepartment(confirmDel.id)
      setRows((r) => r.filter((x) => x.id !== confirmDel.id))
      setConfirmDel(null)
    } catch (err) {
      clearError?.()
      setConfirmDel((c) => (c ? { ...c, error: toUserMessage(err, 'Could not delete the department.') } : c))
    } finally { setBusy(false) }
  }

  if (error) return <ErrorBanner message={error} onRetry={onRetry} />

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Building2 size={16} className="text-[var(--text-secondary)]" />
        <h3 className="font-semibold text-[var(--text-primary)]">Departments</h3>
        <span className="text-[11px] text-[var(--text-muted)]">{rows.length} total</span>
        {canWrite && (
          <button onClick={openCreate} className="ml-auto btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus size={14} /> New department
          </button>
        )}
      </div>

      {loading ? <TableSkeleton /> : rows.length === 0 ? (
        <EmptyState icon={Building2} text="No departments configured yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Code</th>
                <th className="py-2 pr-3 font-medium">Description</th>
                <th className="py-2 pr-3 font-medium text-center">Order</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                {canWrite && <th className="py-2 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {[...rows].sort(sortDept).map((d) => (
                <tr key={d.id} className="border-b border-[var(--input-border)]/60 hover:bg-[var(--input-bg)]/50">
                  <td className="py-2 pr-3 text-[var(--text-primary)] font-medium">{d.name}</td>
                  <td className="py-2 pr-3 text-[var(--text-secondary)]">{d.code || 'N/A'}</td>
                  <td className="py-2 pr-3 text-[var(--text-secondary)] max-w-xs truncate">{d.description || 'N/A'}</td>
                  <td className="py-2 pr-3 text-center text-[var(--text-secondary)]">{d.sort_order ?? 0}</td>
                  <td className="py-2 pr-3"><ActiveBadge active={d.active} /></td>
                  {canWrite && (
                    <td className="py-2 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(d)} className="p-1.5 rounded hover:bg-blue-500/10 text-[var(--text-muted)] hover:text-blue-300" title="Edit"><Pencil size={14} /></button>
                      <button onClick={() => setConfirmDel(d)} className="p-1.5 rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-300" title="Delete"><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal.mode === 'create' ? 'New department' : 'Edit department'} onClose={() => !busy && setModal(null)}>
          {formError && <div className="mb-3 rounded-lg border border-red-800/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">{formError}</div>}
          <form onSubmit={save} className="space-y-3">
            <label className="text-xs text-[var(--text-muted)] space-y-1 block">
              <span>Name <span className="text-red-400">*</span></span>
              <input value={modal.values.name} onChange={(e) => setV('name', e.target.value)} className={inputCls} placeholder="e.g. Insurance" autoFocus />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-[var(--text-muted)] space-y-1 block">
                <span>Code</span>
                <input value={modal.values.code} onChange={(e) => setV('code', e.target.value)} className={inputCls} placeholder="e.g. INS" />
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1 block">
                <span>Sort order</span>
                <input type="number" value={modal.values.sort_order} onChange={(e) => setV('sort_order', e.target.value)} className={inputCls} />
              </label>
            </div>
            <label className="text-xs text-[var(--text-muted)] space-y-1 block">
              <span>Description</span>
              <input value={modal.values.description} onChange={(e) => setV('description', e.target.value)} className={inputCls} placeholder="optional" />
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <input type="checkbox" checked={modal.values.active !== false} onChange={(e) => setV('active', e.target.checked)} className="accent-blue-500" />
              Active
            </label>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setModal(null)} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">Cancel</button>
              <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDel && (
        <Modal title="Delete department" onClose={() => !busy && setConfirmDel(null)}>
          {confirmDel.error && <div className="mb-3 rounded-lg border border-red-800/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">{confirmDel.error}</div>}
          <p className="text-sm text-[var(--text-muted)]">
            Delete <span className="text-[var(--text-primary)] font-medium">{confirmDel.name}</span>? Routing rules that reference it will keep the name until re-saved.
          </p>
          <div className="flex items-center justify-end gap-2 mt-4">
            <button onClick={() => setConfirmDel(null)} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">Cancel</button>
            <button onClick={doDelete} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white inline-flex items-center gap-1.5 disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
function sortDept(a, b) { return (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name || '').localeCompare(String(b.name || '')) }

/* ─────────────────────────── Routing Rules ─────────────────────────── */

const EMPTY_RULE = {
  name: '', description: '', active: true, priority: 100, event_key: '',
  match_severities: [], match_types: [], match_sites: [], match_countries: [],
  min_cost: '', require_injury: false, require_vor: false, require_third_party: false,
  departments: [], to_roles: [], cc_roles: [], escalate_roles: [],
}

function RulesTab({ rows, setRows, deptNames, canWrite, loading, error, onRetry, clearError }) {
  const [modal, setModal] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  // comma lists edited as text in the modal
  const [csvTypes, setCsvTypes] = useState('')
  const [csvSites, setCsvSites] = useState('')
  const [csvCountries, setCsvCountries] = useState('')

  const openCreate = () => {
    setFormError(''); setCsvTypes(''); setCsvSites(''); setCsvCountries('')
    setModal({ mode: 'create', values: { ...EMPTY_RULE } })
  }
  const openEdit = (r) => {
    setFormError('')
    setCsvTypes(arr(r.match_types).join(', '))
    setCsvSites(arr(r.match_sites).join(', '))
    setCsvCountries(arr(r.match_countries).join(', '))
    setModal({
      mode: 'edit', id: r.id,
      values: {
        name: r.name || '', description: r.description || '', active: r.active !== false,
        priority: r.priority ?? 100, event_key: r.event_key || '',
        match_severities: arr(r.match_severities), match_types: arr(r.match_types),
        match_sites: arr(r.match_sites), match_countries: arr(r.match_countries),
        min_cost: r.min_cost ?? '', require_injury: !!r.require_injury,
        require_vor: !!r.require_vor, require_third_party: !!r.require_third_party,
        departments: arr(r.departments), to_roles: arr(r.to_roles),
        cc_roles: arr(r.cc_roles), escalate_roles: arr(r.escalate_roles),
      },
    })
  }
  const setV = (k, v) => setModal((m) => ({ ...m, values: { ...m.values, [k]: v } }))
  const csvToArr = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean)

  const save = async (e) => {
    e?.preventDefault?.()
    setFormError('')
    const v = modal.values
    if (!String(v.name || '').trim()) { setFormError('A rule name is required.'); return }
    setBusy(true)
    try {
      const payload = {
        name: v.name.trim(),
        description: v.description?.trim() || null,
        active: v.active !== false,
        priority: Number(v.priority) || 0,
        event_key: v.event_key || null,
        match_severities: arr(v.match_severities),
        match_types: csvToArr(csvTypes),
        match_sites: csvToArr(csvSites),
        match_countries: csvToArr(csvCountries),
        min_cost: v.min_cost === '' || v.min_cost == null ? null : Number(v.min_cost),
        require_injury: !!v.require_injury,
        require_vor: !!v.require_vor,
        require_third_party: !!v.require_third_party,
        departments: arr(v.departments),
        to_roles: arr(v.to_roles),
        cc_roles: arr(v.cc_roles),
        escalate_roles: arr(v.escalate_roles),
      }
      if (modal.mode === 'create') {
        const created = await createRoutingRule(payload)
        if (created) setRows((r) => [...r, created].sort(sortRule))
      } else {
        const updated = await updateRoutingRule(modal.id, payload)
        setRows((r) => r.map((x) => (x.id === modal.id ? { ...x, ...(updated || payload) } : x)).sort(sortRule))
      }
      setModal(null)
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the routing rule.'))
    } finally { setBusy(false) }
  }

  const doDelete = async () => {
    if (!confirmDel) return
    setBusy(true)
    try {
      await deleteRoutingRule(confirmDel.id)
      setRows((r) => r.filter((x) => x.id !== confirmDel.id))
      setConfirmDel(null)
    } catch (err) {
      clearError?.()
      setConfirmDel((c) => (c ? { ...c, error: toUserMessage(err, 'Could not delete the rule.') } : c))
    } finally { setBusy(false) }
  }

  const matchSummary = (r) => {
    const parts = []
    if (arr(r.match_severities).length) parts.push(arr(r.match_severities).map(severityLabel).join('/'))
    if (arr(r.match_types).length) parts.push(`${r.match_types.length} type(s)`)
    if (arr(r.match_sites).length) parts.push(`${r.match_sites.length} site(s)`)
    if (arr(r.match_countries).length) parts.push(`${r.match_countries.length} country`)
    if (r.min_cost != null && r.min_cost !== '') parts.push(`cost>=${r.min_cost}`)
    if (r.require_injury) parts.push('injury')
    if (r.require_vor) parts.push('VOR')
    if (r.require_third_party) parts.push('3rd party')
    return parts.length ? parts.join(', ') : 'Any accident'
  }

  if (error) return <ErrorBanner message={error} onRetry={onRetry} />

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <ListChecks size={16} className="text-[var(--text-secondary)]" />
        <h3 className="font-semibold text-[var(--text-primary)]">Routing rules</h3>
        <span className="text-[11px] text-[var(--text-muted)]">{rows.length} total</span>
        {canWrite && (
          <button onClick={openCreate} className="ml-auto btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus size={14} /> New rule
          </button>
        )}
      </div>

      {loading ? <TableSkeleton /> : rows.length === 0 ? (
        <EmptyState icon={ListChecks} text="No routing rules configured yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium text-center">Priority</th>
                <th className="py-2 pr-3 font-medium">Event</th>
                <th className="py-2 pr-3 font-medium">Matches</th>
                <th className="py-2 pr-3 font-medium">Departments</th>
                <th className="py-2 pr-3 font-medium">To / CC</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                {canWrite && <th className="py-2 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {[...rows].sort(sortRule).map((r) => (
                <tr key={r.id} className="border-b border-[var(--input-border)]/60 hover:bg-[var(--input-bg)]/50 align-top">
                  <td className="py-2 pr-3">
                    <div className="text-[var(--text-primary)] font-medium">{r.name}</div>
                    {r.description && <div className="text-[11px] text-[var(--text-muted)] max-w-[220px] truncate">{r.description}</div>}
                  </td>
                  <td className="py-2 pr-3 text-center text-[var(--text-secondary)]">{r.priority ?? 0}</td>
                  <td className="py-2 pr-3 text-[var(--text-secondary)]">{EVENT_LABEL[r.event_key || ''] || r.event_key}</td>
                  <td className="py-2 pr-3 text-[var(--text-secondary)] max-w-[220px]">{matchSummary(r)}</td>
                  <td className="py-2 pr-3"><Pills values={r.departments} /></td>
                  <td className="py-2 pr-3">
                    <div className="space-y-1">
                      <Pills values={r.to_roles} empty="No to-roles" />
                      {arr(r.cc_roles).length > 0 && <Pills values={r.cc_roles} />}
                    </div>
                  </td>
                  <td className="py-2 pr-3"><ActiveBadge active={r.active} /></td>
                  {canWrite && (
                    <td className="py-2 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-blue-500/10 text-[var(--text-muted)] hover:text-blue-300" title="Edit"><Pencil size={14} /></button>
                      <button onClick={() => setConfirmDel(r)} className="p-1.5 rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-300" title="Delete"><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal.mode === 'create' ? 'New routing rule' : 'Edit routing rule'} onClose={() => !busy && setModal(null)} wide>
          {formError && <div className="mb-3 rounded-lg border border-red-800/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">{formError}</div>}
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-[var(--text-muted)] space-y-1 block">
                <span>Name <span className="text-red-400">*</span></span>
                <input value={modal.values.name} onChange={(e) => setV('name', e.target.value)} className={inputCls} placeholder="e.g. Major accidents to HSE" autoFocus />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-[var(--text-muted)] space-y-1 block">
                  <span>Priority <span className="text-[var(--text-muted)]">(lower first)</span></span>
                  <input type="number" value={modal.values.priority} onChange={(e) => setV('priority', e.target.value)} className={inputCls} />
                </label>
                <label className="text-xs text-[var(--text-muted)] space-y-1 block">
                  <span>Event</span>
                  <select value={modal.values.event_key} onChange={(e) => setV('event_key', e.target.value)} className={inputCls}>
                    {EVENT_CHOICES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                  </select>
                </label>
              </div>
            </div>
            <label className="text-xs text-[var(--text-muted)] space-y-1 block">
              <span>Description</span>
              <input value={modal.values.description} onChange={(e) => setV('description', e.target.value)} className={inputCls} placeholder="optional" />
            </label>

            <div className="rounded-lg border border-[var(--input-border)] p-3 space-y-3">
              <p className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wide">Match conditions <span className="text-[var(--text-muted)] normal-case">(empty = matches any)</span></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <MultiCheck
                  label="Severities"
                  options={SEVERITY_TOKENS}
                  optionLabel={severityLabel}
                  selected={modal.values.match_severities}
                  onChange={(v) => setV('match_severities', v)}
                />
                <label className="text-xs text-[var(--text-muted)] space-y-1 block">
                  <span>Minimum cost</span>
                  <input type="number" min="0" step="any" value={modal.values.min_cost} onChange={(e) => setV('min_cost', e.target.value)} className={inputCls} placeholder="any" />
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="text-xs text-[var(--text-muted)] space-y-1 block">
                  <span>Accident types <span className="text-[var(--text-muted)]">(comma separated)</span></span>
                  <input value={csvTypes} onChange={(e) => setCsvTypes(e.target.value)} className={inputCls} placeholder="e.g. collision, rollover" />
                </label>
                <label className="text-xs text-[var(--text-muted)] space-y-1 block">
                  <span>Sites <span className="text-[var(--text-muted)]">(comma separated)</span></span>
                  <input value={csvSites} onChange={(e) => setCsvSites(e.target.value)} className={inputCls} placeholder="e.g. DHAHBAN, NHC" />
                </label>
                <label className="text-xs text-[var(--text-muted)] space-y-1 block">
                  <span>Countries <span className="text-[var(--text-muted)]">(comma separated)</span></span>
                  <input value={csvCountries} onChange={(e) => setCsvCountries(e.target.value)} className={inputCls} placeholder="e.g. KSA" />
                </label>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <input type="checkbox" checked={modal.values.require_injury} onChange={(e) => setV('require_injury', e.target.checked)} className="accent-blue-500" /> Require injury
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <input type="checkbox" checked={modal.values.require_vor} onChange={(e) => setV('require_vor', e.target.checked)} className="accent-blue-500" /> Require VOR
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <input type="checkbox" checked={modal.values.require_third_party} onChange={(e) => setV('require_third_party', e.target.checked)} className="accent-blue-500" /> Require third party
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--input-border)] p-3 space-y-3">
              <p className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wide">Recipients</p>
              <MultiCheck label="Departments" options={deptNames} columns={2} selected={modal.values.departments} onChange={(v) => setV('departments', v)} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <MultiCheck label="To roles" options={ROLE_CHOICES} columns={1} selected={modal.values.to_roles} onChange={(v) => setV('to_roles', v)} />
                <MultiCheck label="CC roles" options={ROLE_CHOICES} columns={1} selected={modal.values.cc_roles} onChange={(v) => setV('cc_roles', v)} />
                <MultiCheck label="Escalate roles" options={ROLE_CHOICES} columns={1} selected={modal.values.escalate_roles} onChange={(v) => setV('escalate_roles', v)} />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <input type="checkbox" checked={modal.values.active !== false} onChange={(e) => setV('active', e.target.checked)} className="accent-blue-500" /> Active
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setModal(null)} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">Cancel</button>
              <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save rule
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDel && (
        <Modal title="Delete routing rule" onClose={() => !busy && setConfirmDel(null)}>
          {confirmDel.error && <div className="mb-3 rounded-lg border border-red-800/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">{confirmDel.error}</div>}
          <p className="text-sm text-[var(--text-muted)]">Delete <span className="text-[var(--text-primary)] font-medium">{confirmDel.name}</span>? Accidents will no longer route through this rule.</p>
          <div className="flex items-center justify-end gap-2 mt-4">
            <button onClick={() => setConfirmDel(null)} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">Cancel</button>
            <button onClick={doDelete} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white inline-flex items-center gap-1.5 disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
function sortRule(a, b) { return (a.priority ?? 0) - (b.priority ?? 0) || String(a.name || '').localeCompare(String(b.name || '')) }

/* ─────────────────────────── Email Templates ─────────────────────────── */

function TemplatesTab({ rows, setRows, canWrite, loading, error, onRetry, clearError }) {
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  const openEdit = (t) => {
    setFormError('')
    setModal({ id: t.id, key: t.key, name: t.name, values: { subject: t.subject || '', body_html: t.body_html || '', active: t.active !== false, approved: t.approved === true } })
  }
  const setV = (k, v) => setModal((m) => ({ ...m, values: { ...m.values, [k]: v } }))

  const save = async (e) => {
    e?.preventDefault?.()
    setFormError('')
    setBusy(true)
    try {
      const payload = {
        subject: modal.values.subject || '',
        body_html: modal.values.body_html || '',
        active: modal.values.active !== false,
        approved: modal.values.approved === true,
      }
      const updated = await updateEmailTemplate(modal.id, payload)
      setRows((r) => r.map((x) => (x.id === modal.id ? { ...x, ...(updated || payload) } : x)))
      setModal(null)
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the template.'))
    } finally { setBusy(false) }
  }

  if (error) return <ErrorBanner message={error} onRetry={onRetry} />

  return (
    <div className="space-y-4">
      <div className="card border border-[var(--input-border)]">
        <div className="flex items-start gap-3">
          <Info size={16} className="text-blue-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-[var(--text-secondary)]">Templates must be marked <span className="font-medium text-[var(--text-primary)]">approved</span> and <span className="font-medium text-[var(--text-primary)]">active</span> before the workflow will use them. Bodies may use these tokens:</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {TEMPLATE_TOKENS.map((tk) => (
                <code key={tk} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">{`{{${tk}}}`}</code>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Mail size={16} className="text-[var(--text-secondary)]" />
          <h3 className="font-semibold text-[var(--text-primary)]">Email templates</h3>
          <span className="text-[11px] text-[var(--text-muted)]">{rows.length} total</span>
        </div>

        {loading ? <TableSkeleton /> : rows.length === 0 ? (
          <EmptyState icon={Mail} text="No email templates found." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                  <th className="py-2 pr-3 font-medium">Template</th>
                  <th className="py-2 pr-3 font-medium">Subject</th>
                  <th className="py-2 pr-3 font-medium text-center">Active</th>
                  <th className="py-2 pr-3 font-medium text-center">Approved</th>
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--input-border)]/60 hover:bg-[var(--input-bg)]/50">
                    <td className="py-2 pr-3">
                      <div className="text-[var(--text-primary)] font-medium">{t.name || t.key}</div>
                      <div className="text-[11px] text-[var(--text-muted)] font-mono">{t.key}</div>
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)] max-w-xs truncate">{t.subject || 'N/A'}</td>
                    <td className="py-2 pr-3 text-center">{t.active !== false ? <CheckCircle2 size={15} className="text-emerald-400 inline" /> : <X size={15} className="text-[var(--text-muted)] inline" />}</td>
                    <td className="py-2 pr-3 text-center">{t.approved === true ? <CheckCircle2 size={15} className="text-emerald-400 inline" /> : <span className="text-[11px] text-amber-300">Not approved</span>}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-blue-500/10 text-[var(--text-muted)] hover:text-blue-300" title={canWrite ? 'Edit' : 'View'}>
                        {canWrite ? <Pencil size={14} /> : <Eye size={14} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <Modal title={`${canWrite ? 'Edit' : 'View'} template: ${modal.name || modal.key}`} onClose={() => !busy && setModal(null)} wide>
          {formError && <div className="mb-3 rounded-lg border border-red-800/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">{formError}</div>}
          <form onSubmit={save} className="space-y-3">
            <label className="text-xs text-[var(--text-muted)] space-y-1 block">
              <span>Subject</span>
              <input value={modal.values.subject} onChange={(e) => setV('subject', e.target.value)} className={inputCls} disabled={!canWrite} />
            </label>
            <label className="text-xs text-[var(--text-muted)] space-y-1 block">
              <span>Body (HTML)</span>
              <textarea value={modal.values.body_html} onChange={(e) => setV('body_html', e.target.value)} rows={10} className={`${inputCls} font-mono text-[12px] leading-relaxed`} disabled={!canWrite} />
            </label>

            <div>
              <p className="text-xs text-[var(--text-muted)] mb-1 flex items-center gap-1"><Eye size={13} /> Live preview <span className="text-[var(--text-muted)]">(sample values)</span></p>
              <iframe
                title="Template preview"
                className="w-full h-64 rounded-lg border border-[var(--input-border)] bg-white"
                sandbox=""
                srcDoc={renderTemplatePreview(modal.values.body_html)}
              />
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input type="checkbox" checked={modal.values.active !== false} onChange={(e) => setV('active', e.target.checked)} disabled={!canWrite} className="accent-blue-500" /> Active
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input type="checkbox" checked={modal.values.approved === true} onChange={(e) => setV('approved', e.target.checked)} disabled={!canWrite} className="accent-blue-500" /> Approved
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setModal(null)} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">Close</button>
              {canWrite && (
                <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

/* ─────────────────────────── Email Delivery ─────────────────────────── */

function DeliveryTab({ enabled, setEnabled, canWrite, loading, error, onRetry, setSectionError }) {
  const [saving, setSaving] = useState(false)
  const [confirmOn, setConfirmOn] = useState(false)

  const apply = async (next) => {
    setSectionError('')
    setSaving(true)
    try {
      await setAccidentEmailsEnabled(next)
      setEnabled(next)
      setConfirmOn(false)
    } catch (err) {
      setSectionError(toUserMessage(err, 'Could not update the delivery setting.'))
    } finally { setSaving(false) }
  }

  const onToggle = () => {
    if (!canWrite) return
    if (!enabled) setConfirmOn(true) // turning ON needs confirmation
    else apply(false)
  }

  if (error) return <ErrorBanner message={error} onRetry={onRetry} />

  return (
    <div className="card max-w-2xl">
      <div className="flex items-center gap-2 mb-4">
        <ToggleRight size={16} className="text-[var(--text-secondary)]" />
        <h3 className="font-semibold text-[var(--text-primary)]">Master email delivery</h3>
      </div>

      {loading ? (
        <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
      ) : (
        <>
          <div className={`rounded-lg border p-4 flex items-center gap-4 ${enabled ? 'border-emerald-700/50 bg-emerald-500/5' : 'border-slate-700/50 bg-slate-500/5'}`}>
            {enabled ? <Power size={22} className="text-emerald-400 shrink-0" /> : <PowerOff size={22} className="text-slate-400 shrink-0" />}
            <div className="flex-1">
              <p className="font-medium text-[var(--text-primary)]">
                Accident emails are currently {enabled ? 'ON' : 'OFF'}
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-0.5">
                {enabled
                  ? 'The workflow is sending real emails to routed managers as accidents progress.'
                  : 'No accident emails are being sent. Routing rules are still evaluated but nothing is delivered.'}
              </p>
            </div>
            <button
              onClick={onToggle}
              disabled={!canWrite || saving}
              role="switch"
              aria-checked={enabled}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
              title={canWrite ? 'Toggle delivery' : 'Requires an elevated role'}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          <div className="mt-4 rounded-lg border border-amber-800/50 bg-amber-500/5 flex items-start gap-3 p-3">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-sm text-[var(--text-muted)]">
              Turning this <span className="font-medium text-amber-300">ON starts sending real emails</span> to the managers matched by your routing rules. Confirm your departments, rules and approved templates first. Delivery defaults to OFF.
            </p>
          </div>

          {!canWrite && (
            <p className="text-xs text-[var(--text-muted)] mt-3">Only an Admin, Manager or Director can change this setting.</p>
          )}
        </>
      )}

      {confirmOn && (
        <Modal title="Turn on accident emails" onClose={() => !saving && setConfirmOn(false)}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-sm text-[var(--text-muted)]">
              This will start sending <span className="text-[var(--text-primary)] font-medium">real emails</span> to routed managers whenever an accident is reported or updated. Make sure your routing rules and approved templates are correct. Continue?
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 mt-4">
            <button onClick={() => setConfirmOn(false)} disabled={saving} className="px-3 py-1.5 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">Cancel</button>
            <button onClick={() => apply(true)} disabled={saving} className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1.5 disabled:opacity-60">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />} Turn on emails
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
