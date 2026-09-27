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
import { useSearchParams } from 'react-router-dom'
import {
  GitBranch, Building2, ListChecks, Mail, ToggleRight, Plus, X, Save,
  Loader2, AlertTriangle, Trash2, Pencil, RefreshCw, CheckCircle2,
  Eye, ShieldAlert, Power, PowerOff, Info, Search, ShieldCheck,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import SharedModal from '../components/ui/Modal'
import { useAuth } from '../contexts/AuthContext'
import {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  listRoutingRules, createRoutingRule, updateRoutingRule, deleteRoutingRule,
  listEmailTemplates, updateEmailTemplate,
  getAccidentEmailsEnabled, setAccidentEmailsEnabled,
  getAccidentEmailConfig, setAccidentEmailConfig,
} from '../lib/api/accidentWorkflow'
import { SEVERITY_TOKENS, severityLabel } from '../lib/accidentWorkflow'
import {
  TEMPLATE_TOKENS, TEMPLATE_STATE_LABEL, renderTemplatePreview, unknownTokens,
  ruleMatchSummary, ruleHasNoRecipients, ruleOrphanDepartments, departmentUsage,
  templateState, workflowOverview, filterDepartments, filterRules, filterTemplates,
  sortDepartments as sortDept, sortRules as sortRule,
} from '../lib/accidentWorkflowSettingsAnalytics'
import { compareValues } from '../lib/consoleTable'
import { reportFileName } from '../lib/exportUtils'
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

const TABS = [
  { id: 'departments', label: 'Departments', icon: Building2 },
  { id: 'rules', label: 'Routing Rules', icon: ListChecks },
  { id: 'templates', label: 'Email Templates', icon: Mail },
  { id: 'delivery', label: 'Email Delivery', icon: ToggleRight },
]
const TAB_IDS = TABS.map((t) => t.id)

const inputCls =
  'w-full min-h-[44px] rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus:border-[var(--accent)]'
const iconBtn =
  'inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
const secondaryBtn =
  'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

/** Null-last, number/date/text aware sort for every EnterpriseTable column. */
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blankToUndef = (v) => (v === null || v === undefined || v === '' ? undefined : v)

function arr(v) { return Array.isArray(v) ? v : [] }

export default function AccidentWorkflowSettings() {
  const { profile, isSuperAdmin } = useAuth()
  const canWrite = isSuperAdmin === true || WRITE_ROLES.has(profile?.role)

  // The active tab is URL-borne so a link can open a given section.
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = TAB_IDS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'departments'
  const setTab = (id) => {
    const next = new URLSearchParams(searchParams)
    if (id === 'departments') next.delete('tab'); else next.set('tab', id)
    setSearchParams(next, { replace: true })
  }

  // Section data + independent load state so one failure never blanks the page.
  const [departments, setDepartments] = useState([])
  const [rules, setRules] = useState([])
  const [templates, setTemplates] = useState([])
  const [emailsEnabled, setEmailsEnabled] = useState(false)
  const [emailCfg, setEmailCfg] = useState(null) // null = not loaded / unreadable

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errors, setErrors] = useState({ departments: '', rules: '', templates: '', delivery: '', config: '' })
  const setSectionError = (k, v) => setErrors((e) => ({ ...e, [k]: v }))

  const load = useCallback(async () => {
    setRefreshing(true)
    const next = { departments: '', rules: '', templates: '', delivery: '', config: '' }
    const [d, r, t, e, c] = await Promise.allSettled([
      listDepartments(),
      listRoutingRules(),
      listEmailTemplates(),
      getAccidentEmailsEnabled(),
      getAccidentEmailConfig(),
    ])
    if (d.status === 'fulfilled') setDepartments(arr(d.value)); else next.departments = toUserMessage(d.reason, 'Could not load departments.')
    if (r.status === 'fulfilled') setRules(arr(r.value)); else next.rules = toUserMessage(r.reason, 'Could not load routing rules.')
    if (t.status === 'fulfilled') setTemplates(arr(t.value)); else next.templates = toUserMessage(t.reason, 'Could not load email templates.')
    if (e.status === 'fulfilled') setEmailsEnabled(e.value === true); else next.delivery = toUserMessage(e.reason, 'Could not load the delivery setting.')
    if (c.status === 'fulfilled') setEmailCfg(c.value || {}); else { setEmailCfg(null); next.config = toUserMessage(c.reason, 'Could not load the email recipients.') }
    setErrors(next)
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { setLoading(true); load() }, [load])

  const activeDeptNames = useMemo(
    () => departments.filter((d) => d.active !== false).map((d) => d.name),
    [departments],
  )

  const anyReadFailed = Boolean(errors.departments || errors.rules || errors.templates || errors.delivery)
  const recipientsConfigured = emailCfg == null ? null : String(emailCfg.to || '').trim() !== ''
  const overview = useMemo(
    () => workflowOverview({ departments, rules, templates, emailsEnabled, recipientsConfigured }),
    [departments, rules, templates, emailsEnabled, recipientsConfigured],
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
        <div className="card border border-amber-800/50 flex items-start gap-3" role="note">
          <ShieldAlert size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Read-only view</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              You can review the workflow configuration. Changes require an Admin, Manager or Director role.
            </p>
          </div>
        </div>
      )}

      <OverviewStrip overview={overview} loading={loading} anyReadFailed={anyReadFailed} onJump={setTab} />

      {/* Tabs */}
      <div role="tablist" aria-label="Accident workflow sections" className="flex items-center gap-1 border-b border-[var(--input-border)] overflow-x-auto">
        {TABS.map((t) => {
          const on = tab === t.id
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`awf-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`awf-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 min-h-[44px] px-4 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${on ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={15} aria-hidden="true" /> {t.label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id={`awf-panel-${tab}`} aria-labelledby={`awf-tab-${tab}`}>
        {tab === 'departments' && (
          <DepartmentsTab
            rows={departments} rules={rules} setRows={setDepartments} canWrite={canWrite}
            loading={loading} error={errors.departments} onRetry={load} clearError={() => setSectionError('departments', '')}
          />
        )}
        {tab === 'rules' && (
          <RulesTab
            rows={rules} departments={departments} setRows={setRules} deptNames={activeDeptNames} canWrite={canWrite}
            loading={loading} error={errors.rules} onRetry={load} clearError={() => setSectionError('rules', '')}
          />
        )}
        {tab === 'templates' && (
          <TemplatesTab
            rows={templates} setRows={setTemplates} canWrite={canWrite}
            loading={loading} error={errors.templates} onRetry={load}
          />
        )}
        {tab === 'delivery' && (
          <DeliveryTab
            enabled={emailsEnabled} setEnabled={setEmailsEnabled} canWrite={canWrite}
            loading={loading} error={errors.delivery} onRetry={load} setSectionError={(v) => setSectionError('delivery', v)}
            cfgInitial={emailCfg} cfgLoadError={errors.config} onCfgSaved={setEmailCfg}
          />
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────── overview ─────────────────────────── */

const ISSUE_TONE = {
  crit: 'border-red-700/50 text-[var(--text-primary)]',
  warn: 'border-amber-700/50 text-[var(--text-primary)]',
  info: 'border-[var(--input-border)] text-[var(--text-secondary)]',
}
const ISSUE_LABEL = { crit: 'Blocker', warn: 'Check', info: 'Note' }

function Kpi({ label, value, sub, onClick }) {
  const body = (
    <>
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
      <span className="block text-2xl font-bold tabular-nums text-[var(--text-primary)] mt-1">{value}</span>
      {sub && <span className="block text-xs text-[var(--text-muted)] mt-0.5">{sub}</span>}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="card !p-4 text-left min-h-[44px] hover:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
      {body}
    </button>
  ) : <div className="card !p-4">{body}</div>
}

function OverviewStrip({ overview, loading, anyReadFailed, onJump }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-busy="true" aria-label="Loading workflow summary">
        {[0, 1, 2, 3].map((i) => <div key={i} className="card !p-4 h-[92px] animate-pulse" />)}
      </div>
    )
  }
  const o = overview
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Departments" value={`${o.departments.active} of ${o.departments.total}`} sub="active" onClick={() => onJump('departments')} />
        <Kpi label="Routing rules" value={o.rules.active} sub={`${o.rules.total} configured`} onClick={() => onJump('rules')} />
        <Kpi label="Templates ready" value={`${o.templates.usable} of ${o.templates.total}`} sub="active and approved" onClick={() => onJump('templates')} />
        <Kpi label="Email delivery" value={o.emailsEnabled ? 'ON' : 'OFF'} sub={o.emailsEnabled ? 'Sending real emails' : 'Nothing is sent'} onClick={() => onJump('delivery')} />
      </div>
      {anyReadFailed ? (
        <p className="text-xs text-[var(--text-muted)]">Readiness cannot be checked while a section failed to load. Retry that section below.</p>
      ) : o.issues.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] inline-flex items-center gap-1.5">
          <ShieldCheck size={15} className="text-emerald-400" aria-hidden="true" /> Configuration check passed: every active rule reaches someone and a template is ready.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Configuration checks">
          {o.issues.map((i) => (
            <li key={i.text} className={`card !py-2.5 !px-3 border text-sm flex items-start gap-2 ${ISSUE_TONE[i.level]}`}>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] shrink-0 w-14">{ISSUE_LABEL[i.level]}</span>
              <span>{i.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SearchBox({ value, onChange, label }) {
  return (
    <label className="relative block flex-1 min-w-[12rem]">
      <span className="sr-only">{label}</span>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" aria-hidden="true" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} className={`${inputCls} pl-9`} />
    </label>
  )
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="block min-w-[10rem]">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

/* ─────────────────────────── shared bits ─────────────────────────── */

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
      <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-[12rem]">
        <p className="text-[var(--text-primary)] font-medium">This section could not be loaded.</p>
        <p className="text-[var(--text-muted)] text-sm mt-1">{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className={secondaryBtn}>
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  )
}

// Thin wrapper over the shared shell so this page's six dialogs keep their call
// signature while gaining viewport sizing, a pinned header, Escape and a focus
// trap. The panel used to be a `.card`, which clips anything inside it.
function Modal({ title, onClose, children, wide = false }) {
  return (
    <SharedModal open onClose={onClose} title={title} size={wide ? 'lg' : 'md'}>
      {children}
    </SharedModal>
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
            <input type="checkbox" checked={set.has(o)} onChange={() => toggle(o)} className="accent-[var(--accent)] h-4 w-4" />
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
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${active !== false ? 'bg-emerald-500/15 text-[var(--text-primary)] border-emerald-500/40' : 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--input-border)]'}`}>
      {active !== false ? <CheckCircle2 size={11} className="text-emerald-400" aria-hidden="true" /> : <X size={11} aria-hidden="true" />}
      {active !== false ? 'Active' : 'Inactive'}
    </span>
  )
}

/* ─────────────────────────── Departments ─────────────────────────── */

const EMPTY_DEPT = { name: '', code: '', description: '', active: true, sort_order: 0 }

function DepartmentsTab({ rows, rules, setRows, canWrite, loading, error, onRetry, clearError }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const usage = useMemo(() => departmentUsage([...rows].sort(sortDept), rules), [rows, rules])
  const visible = useMemo(() => filterDepartments(usage, { q, status }), [usage, q, status])
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

  const columns = [
    {
      id: 'name', header: 'Name', accessorFn: (d) => blankToUndef(d.name), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => <span className="text-[var(--text-primary)] font-medium">{row.original.name}</span>,
    },
    { id: 'code', header: 'Code', accessorFn: (d) => blankToUndef(d.code), sortingFn: valueSort, sortUndefined: 'last', cell: ({ getValue }) => getValue() ?? 'N/A', meta: { exportValue: (d) => d.code || 'N/A' } },
    {
      id: 'description', header: 'Description', accessorFn: (d) => blankToUndef(d.description), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="block max-w-xs truncate" title={getValue() || ''}>{getValue() ?? 'N/A'}</span>,
      meta: { exportValue: (d) => d.description || 'N/A' },
    },
    { id: 'sort_order', header: 'Order', accessorFn: (d) => d.sort_order ?? 0, sortingFn: valueSort, meta: { align: 'center' } },
    {
      id: 'rule_count', header: 'Active rules', accessorFn: (d) => d.rule_count, sortingFn: valueSort, meta: { align: 'center' },
      cell: ({ getValue }) => (getValue() === 0 ? <span className="text-[var(--text-muted)]">None</span> : getValue()),
    },
    {
      id: 'status', header: 'Status', accessorFn: (d) => (d.active !== false ? 'Active' : 'Inactive'), sortingFn: valueSort,
      cell: ({ row }) => <ActiveBadge active={row.original.active} />,
    },
    ...(canWrite ? [{
      id: 'actions', header: 'Actions', enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <span className="inline-flex whitespace-nowrap">
          <button type="button" onClick={() => openEdit(row.original)} className={iconBtn} aria-label={`Edit department ${row.original.name}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDel(row.original)} className={`${iconBtn} hover:text-red-400`} aria-label={`Delete department ${row.original.name}`}><Trash2 size={15} /></button>
        </span>
      ),
    }] : []),
  ]

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Building2 size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
        <h2 className="font-semibold text-[var(--text-primary)]">Departments</h2>
        <span className="text-[11px] text-[var(--text-muted)]">{visible.length} of {rows.length} shown</span>
        {canWrite && (
          <button type="button" onClick={openCreate} className="ml-auto btn-primary min-h-[44px] text-sm inline-flex items-center gap-1.5">
            <Plus size={14} aria-hidden="true" /> New department
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <SearchBox value={q} onChange={setQ} label="Search departments by name, code or description" />
        <FilterSelect label="Filter departments by status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </div>

      <EnterpriseTable
        columns={columns}
        data={visible}
        getRowId={(d) => String(d.id)}
        loading={loading}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        initialPageSize={25}
        exportFileName={reportFileName('Accident workflow departments')}
        reportMeta={{ title: 'Accident workflow departments' }}
        emptyMessage={rows.length === 0 ? 'No departments configured yet.' : 'No department matches these filters.'}
      />

      {modal && (
        <Modal title={modal.mode === 'create' ? 'New department' : 'Edit department'} onClose={() => !busy && setModal(null)}>
          {formError && <div className="mb-3 rounded-lg border border-red-800/50 bg-red-500/10 px-3 py-2 text-sm text-[var(--text-primary)]" role="alert">{formError}</div>}
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
              <input type="checkbox" checked={modal.values.active !== false} onChange={(e) => setV('active', e.target.checked)} className="accent-[var(--accent)] h-4 w-4" />
              Active
            </label>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setModal(null)} disabled={busy} className="px-3 min-h-[44px] text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">Cancel</button>
              <button type="submit" disabled={busy} className="btn-primary min-h-[44px] text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDel && (
        <Modal title="Delete department" onClose={() => !busy && setConfirmDel(null)}>
          {confirmDel.error && <div className="mb-3 rounded-lg border border-red-800/50 bg-red-500/10 px-3 py-2 text-sm text-[var(--text-primary)]" role="alert">{confirmDel.error}</div>}
          <p className="text-sm text-[var(--text-muted)]">
            Delete <span className="text-[var(--text-primary)] font-medium">{confirmDel.name}</span>? Routing rules that reference it will keep the name until re-saved.
          </p>
          <div className="flex items-center justify-end gap-2 mt-4">
            <button onClick={() => setConfirmDel(null)} disabled={busy} className="px-3 min-h-[44px] text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">Cancel</button>
            <button onClick={doDelete} disabled={busy} className="px-3 min-h-[44px] text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white inline-flex items-center gap-1.5 disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ─────────────────────────── Routing Rules ─────────────────────────── */

const EMPTY_RULE = {
  name: '', description: '', active: true, priority: 100, event_key: '',
  match_severities: [], match_types: [], match_sites: [], match_countries: [],
  min_cost: '', require_injury: false, require_vor: false, require_third_party: false,
  departments: [], to_roles: [], cc_roles: [], escalate_roles: [],
}

function RulesTab({ rows, departments, setRows, deptNames, canWrite, loading, error, onRetry, clearError }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [event, setEvent] = useState('all')
  const visible = useMemo(() => filterRules([...rows].sort(sortRule), { q, status, event }), [rows, q, status, event])
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

  if (error) return <ErrorBanner message={error} onRetry={onRetry} />

  const columns = [
    {
      id: 'name', header: 'Name', accessorFn: (r) => blankToUndef(r.name), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => (
        <div>
          <div className="text-[var(--text-primary)] font-medium">{row.original.name}</div>
          {row.original.description && <div className="text-[11px] text-[var(--text-muted)] max-w-[220px] truncate" title={row.original.description}>{row.original.description}</div>}
        </div>
      ),
    },
    { id: 'priority', header: 'Priority', accessorFn: (r) => r.priority ?? 0, sortingFn: valueSort, meta: { align: 'center' } },
    { id: 'event', header: 'Event', accessorFn: (r) => EVENT_LABEL[r.event_key || ''] || r.event_key, sortingFn: valueSort },
    {
      id: 'matches', header: 'Matches', accessorFn: (r) => ruleMatchSummary(r), sortingFn: valueSort,
      cell: ({ getValue }) => <span className="block max-w-[220px]">{getValue()}</span>,
    },
    {
      id: 'departments', header: 'Departments', accessorFn: (r) => arr(r.departments).join(', ') || undefined, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => {
        const orphans = ruleOrphanDepartments(row.original, departments)
        return (
          <div className="space-y-1">
            <Pills values={row.original.departments} />
            {orphans.length > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                <AlertTriangle size={11} className="text-amber-400" aria-hidden="true" /> Not active: {orphans.join(', ')}
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: 'recipients', header: 'To / CC', accessorFn: (r) => [...arr(r.to_roles), ...arr(r.cc_roles)].join(', ') || undefined, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => (
        <div className="space-y-1">
          <Pills values={row.original.to_roles} empty="No to-roles" />
          {arr(row.original.cc_roles).length > 0 && <Pills values={row.original.cc_roles} />}
          {row.original.active !== false && ruleHasNoRecipients(row.original) && (
            <span className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
              <AlertTriangle size={11} className="text-amber-400" aria-hidden="true" /> Reaches nobody
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => (r.active !== false ? 'Active' : 'Inactive'), sortingFn: valueSort,
      cell: ({ row }) => <ActiveBadge active={row.original.active} />,
    },
    ...(canWrite ? [{
      id: 'actions', header: 'Actions', enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <span className="inline-flex whitespace-nowrap">
          <button type="button" onClick={() => openEdit(row.original)} className={iconBtn} aria-label={`Edit rule ${row.original.name}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDel(row.original)} className={`${iconBtn} hover:text-red-400`} aria-label={`Delete rule ${row.original.name}`}><Trash2 size={15} /></button>
        </span>
      ),
    }] : []),
  ]

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ListChecks size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
        <h2 className="font-semibold text-[var(--text-primary)]">Routing rules</h2>
        <span className="text-[11px] text-[var(--text-muted)]">{visible.length} of {rows.length} shown</span>
        {canWrite && (
          <button type="button" onClick={openCreate} className="ml-auto btn-primary min-h-[44px] text-sm inline-flex items-center gap-1.5">
            <Plus size={14} aria-hidden="true" /> New rule
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <SearchBox value={q} onChange={setQ} label="Search rules by name, department or role" />
        <FilterSelect label="Filter rules by status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        <FilterSelect
          label="Filter rules by event"
          value={event}
          onChange={setEvent}
          options={[{ value: 'all', label: 'All events' }, ...EVENT_CHOICES]}
        />
      </div>

      <EnterpriseTable
        columns={columns}
        data={visible}
        getRowId={(r) => String(r.id)}
        loading={loading}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        initialPageSize={25}
        exportFileName={reportFileName('Accident routing rules')}
        reportMeta={{ title: 'Accident routing rules' }}
        emptyMessage={rows.length === 0 ? 'No routing rules configured yet.' : 'No rule matches these filters.'}
      />

      {modal && (
        <Modal title={modal.mode === 'create' ? 'New routing rule' : 'Edit routing rule'} onClose={() => !busy && setModal(null)} wide>
          {formError && <div className="mb-3 rounded-lg border border-red-800/50 bg-red-500/10 px-3 py-2 text-sm text-[var(--text-primary)]" role="alert">{formError}</div>}
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
                  <input type="checkbox" checked={modal.values.require_injury} onChange={(e) => setV('require_injury', e.target.checked)} className="accent-[var(--accent)] h-4 w-4" /> Require injury
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <input type="checkbox" checked={modal.values.require_vor} onChange={(e) => setV('require_vor', e.target.checked)} className="accent-[var(--accent)] h-4 w-4" /> Require VOR
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <input type="checkbox" checked={modal.values.require_third_party} onChange={(e) => setV('require_third_party', e.target.checked)} className="accent-[var(--accent)] h-4 w-4" /> Require third party
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
              <input type="checkbox" checked={modal.values.active !== false} onChange={(e) => setV('active', e.target.checked)} className="accent-[var(--accent)] h-4 w-4" /> Active
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setModal(null)} disabled={busy} className="px-3 min-h-[44px] text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">Cancel</button>
              <button type="submit" disabled={busy} className="btn-primary min-h-[44px] text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save rule
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDel && (
        <Modal title="Delete routing rule" onClose={() => !busy && setConfirmDel(null)}>
          {confirmDel.error && <div className="mb-3 rounded-lg border border-red-800/50 bg-red-500/10 px-3 py-2 text-sm text-[var(--text-primary)]" role="alert">{confirmDel.error}</div>}
          <p className="text-sm text-[var(--text-muted)]">Delete <span className="text-[var(--text-primary)] font-medium">{confirmDel.name}</span>? Accidents will no longer route through this rule.</p>
          <div className="flex items-center justify-end gap-2 mt-4">
            <button onClick={() => setConfirmDel(null)} disabled={busy} className="px-3 min-h-[44px] text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">Cancel</button>
            <button onClick={doDelete} disabled={busy} className="px-3 min-h-[44px] text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white inline-flex items-center gap-1.5 disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ─────────────────────────── Email Templates ─────────────────────────── */

function TemplatesTab({ rows, setRows, canWrite, loading, error, onRetry }) {
  const [q, setQ] = useState('')
  const [state, setState] = useState('all')
  const visible = useMemo(() => filterTemplates(rows, { q, state }), [rows, q, state])
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

  const columns = [
    {
      id: 'name', header: 'Template', accessorFn: (t) => blankToUndef(t.name || t.key), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => (
        <div>
          <div className="text-[var(--text-primary)] font-medium">{row.original.name || row.original.key}</div>
          <div className="text-[11px] text-[var(--text-muted)] font-mono">{row.original.key}</div>
        </div>
      ),
    },
    {
      id: 'subject', header: 'Subject', accessorFn: (t) => blankToUndef(t.subject), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="block max-w-xs truncate" title={getValue() || ''}>{getValue() ?? 'N/A'}</span>,
      meta: { exportValue: (t) => t.subject || 'N/A' },
    },
    {
      id: 'readiness', header: 'Readiness', accessorFn: (t) => TEMPLATE_STATE_LABEL[templateState(t)], sortingFn: valueSort,
      cell: ({ row }) => {
        const st = templateState(row.original)
        return (
          <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${st === 'usable' ? 'bg-emerald-500/15 border-emerald-500/40 text-[var(--text-primary)]' : 'bg-amber-500/10 border-amber-500/40 text-[var(--text-primary)]'}`}>
            {st === 'usable' ? <CheckCircle2 size={11} className="text-emerald-400" aria-hidden="true" /> : <AlertTriangle size={11} className="text-amber-400" aria-hidden="true" />}
            {TEMPLATE_STATE_LABEL[st]}
          </span>
        )
      },
    },
    {
      id: 'tokens', header: 'Unknown tokens', accessorFn: (t) => [...unknownTokens(t.subject), ...unknownTokens(t.body_html)].join(', ') || undefined,
      sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => (getValue()
        ? <span className="text-[11px] font-mono text-[var(--text-secondary)]">{getValue()}</span>
        : <span className="text-[var(--text-muted)]">None</span>),
      meta: { exportValue: (t) => [...unknownTokens(t.subject), ...unknownTokens(t.body_html)].join(', ') || 'None' },
    },
    {
      id: 'actions', header: 'Actions', enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <button type="button" onClick={() => openEdit(row.original)} className={iconBtn} aria-label={`${canWrite ? 'Edit' : 'View'} template ${row.original.name || row.original.key}`}>
          {canWrite ? <Pencil size={15} /> : <Eye size={15} />}
        </button>
      ),
    },
  ]
  const modalUnknown = modal ? [...unknownTokens(modal.values.subject), ...unknownTokens(modal.values.body_html)] : []

  return (
    <div className="space-y-4">
      <div className="card border border-[var(--input-border)]">
        <div className="flex items-start gap-3">
          <Info size={16} className="text-[var(--accent)] mt-0.5 shrink-0" aria-hidden="true" />
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

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Mail size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
          <h2 className="font-semibold text-[var(--text-primary)]">Email templates</h2>
          <span className="text-[11px] text-[var(--text-muted)]">{visible.length} of {rows.length} shown</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <SearchBox value={q} onChange={setQ} label="Search templates by name, key or subject" />
          <FilterSelect
            label="Filter templates by readiness"
            value={state}
            onChange={setState}
            options={[
              { value: 'all', label: 'All templates' },
              ...Object.entries(TEMPLATE_STATE_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>

        <EnterpriseTable
          columns={columns}
          data={visible}
          getRowId={(t) => String(t.id)}
          loading={loading}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          initialPageSize={25}
          exportFileName={reportFileName('Accident email templates')}
          reportMeta={{ title: 'Accident email templates' }}
          emptyMessage={rows.length === 0 ? 'No email templates found.' : 'No template matches these filters.'}
        />
      </div>

      {modal && (
        <Modal title={`${canWrite ? 'Edit' : 'View'} template: ${modal.name || modal.key}`} onClose={() => !busy && setModal(null)} wide>
          {formError && <div className="mb-3 rounded-lg border border-red-800/50 bg-red-500/10 px-3 py-2 text-sm text-[var(--text-primary)]" role="alert">{formError}</div>}
          <form onSubmit={save} className="space-y-3">
            <label className="text-xs text-[var(--text-muted)] space-y-1 block">
              <span>Subject</span>
              <input value={modal.values.subject} onChange={(e) => setV('subject', e.target.value)} className={inputCls} disabled={!canWrite} />
            </label>
            <label className="text-xs text-[var(--text-muted)] space-y-1 block">
              <span>Body (HTML)</span>
              <textarea value={modal.values.body_html} onChange={(e) => setV('body_html', e.target.value)} rows={10} className={`${inputCls} font-mono text-[12px] leading-relaxed`} disabled={!canWrite} />
            </label>

            {modalUnknown.length > 0 && (
              <p className="text-xs text-[var(--text-secondary)] flex items-start gap-1.5" role="status">
                <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
                These tokens are not recognised and will be sent as written: <span className="font-mono">{modalUnknown.join(', ')}</span>
              </p>
            )}
            <div>
              <p className="text-xs text-[var(--text-muted)] mb-1 flex items-center gap-1"><Eye size={13} aria-hidden="true" /> Live preview <span className="text-[var(--text-muted)]">(sample values)</span></p>
              <iframe
                title="Template preview"
                className="w-full h-64 rounded-lg border border-[var(--input-border)] bg-white"
                sandbox=""
                srcDoc={renderTemplatePreview(modal.values.body_html)}
              />
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input type="checkbox" checked={modal.values.active !== false} onChange={(e) => setV('active', e.target.checked)} disabled={!canWrite} className="accent-[var(--accent)] h-4 w-4" /> Active
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input type="checkbox" checked={modal.values.approved === true} onChange={(e) => setV('approved', e.target.checked)} disabled={!canWrite} className="accent-[var(--accent)] h-4 w-4" /> Approved
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setModal(null)} disabled={busy} className="px-3 min-h-[44px] text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">Close</button>
              {canWrite && (
                <button type="submit" disabled={busy} className="btn-primary min-h-[44px] text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
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

function DeliveryTab({ enabled, setEnabled, canWrite, loading, error, onRetry, setSectionError, cfgInitial, cfgLoadError, onCfgSaved }) {
  const [saving, setSaving] = useState(false)
  const [confirmOn, setConfirmOn] = useState(false)

  // Fixed-mailbox routing config (To / CC / subject prefix).
  const [cfg, setCfg] = useState({ to: '', cc: '', subjectPrefix: '', sender: 'info@tyrepulse.app' })
  const [cfgSaving, setCfgSaving] = useState(false)
  const [cfgError, setCfgError] = useState('')
  const [cfgSaved, setCfgSaved] = useState(false)
  // The recipients config is read once by the page (it also feeds the
  // readiness check); a failed read keeps the form closed rather than showing
  // blank addresses that would read as "none configured".
  const cfgLoading = loading
  const cfgUnreadable = !loading && cfgInitial == null

  useEffect(() => {
    if (cfgInitial) setCfg((prev) => ({ ...prev, ...cfgInitial }))
  }, [cfgInitial])

  const setCfgField = (k, v) => { setCfg((c) => ({ ...c, [k]: v })); setCfgSaved(false) }

  const saveCfg = async () => {
    setCfgError(''); setCfgSaved(false); setCfgSaving(true)
    try {
      await setAccidentEmailConfig({ to: cfg.to, cc: cfg.cc, subjectPrefix: cfg.subjectPrefix })
      setCfgSaved(true)
      onCfgSaved?.({ ...cfg })
    } catch (err) {
      setCfgError(toUserMessage(err, 'Could not save the email recipients.'))
    } finally { setCfgSaving(false) }
  }

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
          <div className={`rounded-lg border p-4 flex flex-wrap items-center gap-4 ${enabled ? 'border-emerald-700/50 bg-emerald-500/5' : 'border-[var(--input-border)] bg-[var(--surface-2)]'}`}>
            {enabled ? <Power size={22} className="text-emerald-400 shrink-0" aria-hidden="true" /> : <PowerOff size={22} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />}
            <div className="flex-1 min-w-[12rem]">
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
              aria-label="Accident email delivery"
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--accent)] before:absolute before:-inset-2 before:content-[''] ${enabled ? 'bg-emerald-500' : 'bg-[var(--text-dim)]'}`}
              title={canWrite ? 'Toggle delivery' : 'Requires an elevated role'}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          <div className="mt-4 rounded-lg border border-amber-800/50 bg-amber-500/5 flex items-start gap-3 p-3">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-sm text-[var(--text-muted)]">
              Turning this <span className="font-medium text-[var(--text-primary)]">ON starts sending real emails</span> to the managers matched by your routing rules. Confirm your departments, rules and approved templates first. Delivery defaults to OFF.
            </p>
          </div>

          {!canWrite && (
            <p className="text-xs text-[var(--text-muted)] mt-3">Only an Admin, Manager or Director can change this setting.</p>
          )}

          {/* Fixed-mailbox routing */}
          <div className="mt-6 pt-5 border-t border-[var(--input-border)]">
            <div className="flex items-center gap-2 mb-1">
              <Mail size={16} className="text-[var(--text-secondary)]" />
              <h4 className="font-semibold text-[var(--text-primary)]">Accident email recipients</h4>
            </div>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              Accident emails are sent from info@tyrepulse.app to these addresses. The acting user's name is added in the signature.
            </p>

            {cfgError && (
              <div role="alert" className="mb-3 rounded-lg border border-red-800/50 bg-red-500/10 px-3 py-2 text-sm text-[var(--text-primary)]">{cfgError}</div>
            )}

            {cfgLoading ? (
              <div className="h-40 bg-[var(--input-bg)] rounded animate-pulse" />
            ) : cfgUnreadable ? (
              <ErrorBanner message={cfgLoadError || 'Could not load the email recipients.'} onRetry={onRetry} />
            ) : (
              <div className="space-y-3">
                <label className="text-xs text-[var(--text-muted)] space-y-1 block">
                  <span>Sender</span>
                  <input value={cfg.sender} readOnly disabled className={`${inputCls} opacity-70 cursor-not-allowed`} />
                  <span className="text-[11px] text-[var(--text-muted)]">Verified Resend sender. This cannot be changed here.</span>
                </label>
                <label className="text-xs text-[var(--text-muted)] space-y-1 block">
                  <span>To <span className="text-[var(--text-muted)]">(comma or newline separated)</span></span>
                  <textarea
                    value={cfg.to}
                    onChange={(e) => setCfgField('to', e.target.value)}
                    disabled={!canWrite}
                    rows={2}
                    className={`${inputCls} font-mono text-[12px]`}
                    placeholder="ops@example.com, claims@example.com"
                  />
                </label>
                <label className="text-xs text-[var(--text-muted)] space-y-1 block">
                  <span>CC <span className="text-[var(--text-muted)]">(optional)</span></span>
                  <textarea
                    value={cfg.cc}
                    onChange={(e) => setCfgField('cc', e.target.value)}
                    disabled={!canWrite}
                    rows={2}
                    className={`${inputCls} font-mono text-[12px]`}
                    placeholder="manager@example.com"
                  />
                </label>
                <label className="text-xs text-[var(--text-muted)] space-y-1 block">
                  <span>Subject prefix <span className="text-[var(--text-muted)]">(optional)</span></span>
                  <input
                    value={cfg.subjectPrefix}
                    onChange={(e) => setCfgField('subjectPrefix', e.target.value)}
                    disabled={!canWrite}
                    className={inputCls}
                    placeholder="[Tyre Pulse Accident]"
                  />
                </label>

                {canWrite && (
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={saveCfg}
                      disabled={cfgSaving}
                      type="button"
                      className="btn-primary min-h-[44px] text-sm inline-flex items-center gap-1.5 disabled:opacity-60"
                    >
                      {cfgSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save recipients
                    </button>
                    {cfgSaved && (
                      <span role="status" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-primary)]">
                        <CheckCircle2 size={15} /> Saved
                      </span>
                    )}
                  </div>
                )}

                <p className="text-xs text-[var(--text-muted)] pt-1">
                  If no addresses are set here, no accident email is sent. Emails are only delivered while the master switch above is ON.
                </p>
              </div>
            )}
          </div>
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
            <button onClick={() => setConfirmOn(false)} disabled={saving} className="px-3 min-h-[44px] text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">Cancel</button>
            <button onClick={() => apply(true)} disabled={saving} className="px-3 min-h-[44px] text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1.5 disabled:opacity-60">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />} Turn on emails
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
