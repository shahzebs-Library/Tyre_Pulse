/**
 * WorkflowSettings (route /workflow-settings) - the admin home for approval
 * chains (workflow_definitions). Design KPIs, a per-chain health check, entity
 * coverage and live usage/SLA figures come from the pure engine
 * src/lib/workflowSettingsAnalytics.js. Editing happens in the visual builder
 * (/workflow-settings/builder); this page lists, toggles, clones and deletes.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  GitBranch, Plus, Edit2, Trash2, X, Loader2, Search,
  ToggleLeft, ToggleRight, XCircle, ChevronRight,
  Zap, Layers, Clock, Filter, Copy, Sparkles, CircleDashed, SlidersHorizontal,
  AlertTriangle, CheckCircle2, Activity, FileSpreadsheet, FileText, RefreshCcw, ListChecks,
} from 'lucide-react'
import * as workflows from '../lib/api/workflows'
import { STARTER_TEMPLATES } from '../lib/workflow/starterTemplates'
import { toUserMessage } from '../lib/safeError'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import {
  definitionRows, summarizeDefinitions, entityCoverage, summarizeInstances,
  filterDefinitionRows, definitionExportRows, DEFINITION_ISSUE_LABELS,
} from '../lib/workflowSettingsAnalytics'

// ─── Constants ────────────────────────────────────────────────────────────────

// Stable palette for role badges, hashed off the role name.
const ROLE_HUES = ['#f97316', '#3b82f6', '#a855f7', '#22c55e', '#eab308', '#ec4899', '#14b8a6', '#ef4444']
function roleHue(role) {
  let h = 0
  for (let i = 0; i < (role || '').length; i++) h = (h * 31 + role.charCodeAt(i)) >>> 0
  return ROLE_HUES[h % ROLE_HUES.length]
}

function assigneeLabel(s) {
  if (s.assignee_type === 'user') return s.approver_user_id?.trim() ? `User ${s.approver_user_id}` : 'Specific user'
  return s.approver_role
}

// ─── Definition card ──────────────────────────────────────────────────────────

function DefinitionCard({ def, health = 'ok', issues = [], onEdit, onClone, onDelete, onToggle }) {
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [cloning, setCloning] = useState(false)
  const steps = Array.isArray(def.steps) ? def.steps : []

  async function handleDelete() {
    if (!window.confirm(`Delete workflow "${def.name}"? In-flight approvals keep their snapshot, but no new chains will start.`)) return
    setDeleting(true)
    await onDelete(def.id)
    setDeleting(false)
  }

  async function handleToggle() {
    setToggling(true)
    await onToggle(def.id, !def.active)
    setToggling(false)
  }

  async function handleClone() {
    setCloning(true)
    await onClone(def)
    setCloning(false)
  }

  return (
    <div className="relative bg-gray-800 rounded-xl border border-gray-700 border-l-4 border-l-orange-500 overflow-hidden hover:border-gray-600 transition-all">
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate">{def.name}</p>
            {def.description && <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{def.description}</p>}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700 text-gray-300 text-[11px]">
                <Layers className="w-3 h-3" /> {def.entity_type}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 text-[11px] font-mono">
                <Zap className="w-3 h-3" /> {def.trigger_event || 'manual'}
              </span>
            </div>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling}
            title={def.active ? 'Deactivate' : 'Activate'}
            className="shrink-0 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            {toggling
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : def.active
                ? <ToggleRight className="w-6 h-6 text-orange-500" />
                : <ToggleLeft className="w-6 h-6" />
            }
          </button>
        </div>

        {/* Steps preview */}
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {steps.map((s, i) => {
            const hue = roleHue(s.approver_role)
            return (
              <span key={i} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium"
                  style={{ backgroundColor: `${hue}26`, color: hue }}
                  title={s.name}
                >
                  {i + 1}. {s.name || assigneeLabel(s)}
                  {s.optional ? <CircleDashed className="w-2.5 h-2.5 opacity-70" /> : null}
                  {s.condition?.field ? <SlidersHorizontal className="w-2.5 h-2.5 opacity-70" /> : null}
                  {s.sla_hours ? <span className="inline-flex items-center gap-0.5 text-[10px] opacity-75"><Clock className="w-2.5 h-2.5" />{s.sla_hours}h</span> : null}
                </span>
                {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-gray-600" />}
              </span>
            )
          })}
        </div>
      </div>

      <div className="px-4 py-2.5 border-t border-gray-700/60 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-gray-500 text-xs">
          {steps.length} step{steps.length !== 1 ? 's' : ''}
          <HealthBadge health={health} issues={issues} />
        </span>
        <div className="flex items-center gap-1">
          <button onClick={handleClone} disabled={cloning} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-all disabled:opacity-50" title="Clone">
            {cloning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => onEdit(def)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-all" title="Edit">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleDelete} disabled={deleting} className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50" title="Delete">
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {!def.active && <div className="absolute inset-0 bg-gray-900/40 rounded-xl pointer-events-none" />}
    </div>
  )
}

function HealthBadge({ health, issues = [] }) {
  const title = issues.map((i) => DEFINITION_ISSUE_LABELS[i] || i).join('; ')
  if (health === 'ok') return <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-3 h-3" /> Healthy</span>
  return (
    <span title={title} className={`inline-flex items-center gap-1 ${health === 'error' ? 'text-red-400' : 'text-amber-400'}`}>
      <AlertTriangle className="w-3 h-3" /> {issues.length} issue{issues.length !== 1 ? 's' : ''}
    </span>
  )
}

function Kpi({ icon: Icon, label, value, sub, tone = '' }) {
  return (
    <div className="rounded-xl bg-gray-800 border border-gray-700 p-3">
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{label}</span>
        {Icon && <Icon className="w-3.5 h-3.5" />}
      </div>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tone || 'text-white'}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

const na = (v, suffix = '') => (v == null ? 'N/A' : `${v}${suffix}`)
const REFERENCE_ENTITIES = [...new Set(STARTER_TEMPLATES.map((t) => t.entity_type))]
const EXPORT_KEYS = ['name', 'entity_type', 'trigger_event', 'status', 'steps', 'sla_hours', 'roles', 'evidence', 'health', 'issues']
const EXPORT_HEADERS = ['Workflow', 'Entity', 'Trigger', 'Status', 'Steps', 'Chain SLA (h)', 'Approvers', 'Evidence required', 'Health', 'Issues']

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkflowSettings() {
  const navigate = useNavigate()
  const [definitions, setDefinitions] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [actionError, setActionError] = useState(null)
  const [search, setSearch]           = useState('')
  const [filterActive, setFilterActive] = useState('all')
  const [filterEntity, setFilterEntity] = useState('all')
  const [filterHealth, setFilterHealth] = useState('all')
  const [view, setView]               = useState('cards')

  const [instances, setInstances]     = useState({ rows: [], count: 0 })
  const [instLoading, setInstLoading] = useState(true)
  const [instError, setInstError]     = useState(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await workflows.listWorkflowDefinitions()
      setDefinitions(rows || [])
    } catch (err) { setError(toUserMessage(err, 'Failed to load workflows')) }
    finally { setLoading(false) }
  }, [])

  // Usage + SLA read the whole run history (paged, bounded by
  // WORKFLOW_HISTORY_MAX). When the ceiling is hit the exact total comes back
  // too, so the panel states how much of the history it covers.
  const fetchInstances = useCallback(async () => {
    setInstLoading(true)
    setInstError(null)
    try {
      const res = await workflows.listAllWorkflowInstances()
      setInstances({ rows: res?.rows || [], count: res?.count ?? 0 })
    } catch (err) { setInstError(toUserMessage(err, 'Could not load workflow runs')) }
    finally { setInstLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])
  useEffect(() => { fetchInstances() }, [fetchInstances])

  const rows = useMemo(() => definitionRows(definitions), [definitions])
  const summary = useMemo(() => summarizeDefinitions(definitions), [definitions])
  const coverage = useMemo(() => entityCoverage(definitions, REFERENCE_ENTITIES), [definitions])
  const usage = useMemo(
    () => summarizeInstances(instances.rows, { now: new Date(), sampleOf: instances.count }),
    [instances],
  )
  const entities = useMemo(() => [...new Set(rows.map((r) => r.entity_type).filter(Boolean))].sort(), [rows])
  const visibleRows = useMemo(
    () => filterDefinitionRows(rows, { search, status: filterActive, entity: filterEntity, health: filterHealth }),
    [rows, search, filterActive, filterEntity, filterHealth],
  )
  const filtersOn = !!search || filterActive !== 'all' || filterEntity !== 'all' || filterHealth !== 'all'
  const clearFilters = () => { setSearch(''); setFilterActive('all'); setFilterEntity('all'); setFilterHealth('all') }

  async function handleDelete(id) {
    setActionError(null)
    try {
      await workflows.deleteWorkflowDefinition(id)
      setDefinitions(prev => prev.filter(d => d.id !== id))
    } catch (err) { setActionError(toUserMessage(err, 'Delete failed')) }
  }

  async function handleToggle(id, active) {
    setActionError(null)
    try {
      await workflows.updateWorkflowDefinition(id, { active })
      setDefinitions(prev => prev.map(d => d.id === id ? { ...d, active } : d))
    } catch (err) { setActionError(toUserMessage(err, 'Update failed')) }
  }

  // Navigate to the builder page in create mode, pre-loaded with a copy of an
  // existing definition (no id) so save creates a new row. The seed rides in
  // router navigation state, which the builder reads via history.state.usr.
  function handleClone(def) {
    navigate('/workflow-settings/builder', {
      state: {
        seed: {
          name: `${def.name} (copy)`,
          description: def.description,
          entity_type: def.entity_type,
          trigger_event: def.trigger_event,
          active: false,
          steps: Array.isArray(def.steps) ? def.steps : [],
        },
      },
    })
  }

  // Navigate to the builder page in create mode, pre-loaded from a starter template.
  function openTemplate(tpl) {
    navigate('/workflow-settings/builder', {
      state: {
        seed: {
          name: tpl.name,
          description: `Starter template: ${tpl.name}`,
          entity_type: tpl.entity_type,
          trigger_event: tpl.trigger_event,
          active: true,
          steps: tpl.steps,
        },
      },
    })
  }

  function exportDefinitions(kind) {
    if (!visibleRows.length) return
    const data = definitionExportRows(visibleRows)
    const fname = reportFileName('TyrePulse', 'Approval workflows')
    if (kind === 'excel') exportToExcel(data, EXPORT_KEYS, EXPORT_HEADERS, fname, 'Workflows')
    else exportToPdf(data, EXPORT_KEYS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Approval Workflows', fname, 'landscape')
  }

  const columns = useMemo(() => [
    {
      id: 'name', header: 'Workflow', accessorFn: (r) => r.name,
      cell: ({ row }) => (
        <button type="button" onClick={() => navigate(`/workflow-settings/builder/${row.original.id}`)} className="text-left text-white hover:text-orange-300 font-medium">
          {row.original.name}
        </button>
      ),
    },
    { id: 'entity_type', header: 'Entity', accessorFn: (r) => r.entity_type || 'N/A', meta: { filterVariant: 'select' } },
    { id: 'trigger_event', header: 'Trigger', accessorFn: (r) => r.trigger_event, cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span> },
    { id: 'status', header: 'Status', accessorFn: (r) => (r.active ? 'Active' : 'Inactive'), meta: { filterVariant: 'select' } },
    { id: 'steps', header: 'Steps', accessorFn: (r) => r.steps, meta: { align: 'right' } },
    { id: 'sla', header: 'Chain SLA', accessorFn: (r) => r.sla_hours ?? -1, meta: { align: 'right' }, cell: ({ getValue }) => (getValue() < 0 ? 'N/A' : `${getValue()} h`) },
    { id: 'roles', header: 'Approvers', accessorFn: (r) => (r.roles || []).join(', ') || 'N/A' },
    {
      id: 'evidence', header: 'Evidence',
      accessorFn: (r) => r.evidence.signature + r.evidence.photo + r.evidence.gps,
      cell: ({ row }) => {
        const e = row.original.evidence
        const parts = [e.signature ? 'Signature' : '', e.photo ? 'Photo' : '', e.gps ? 'GPS' : ''].filter(Boolean)
        return <span className="text-xs text-gray-300">{parts.length ? parts.join(', ') : 'None'}</span>
      },
    },
    { id: 'health', header: 'Health', accessorFn: (r) => r.health, cell: ({ row }) => <HealthBadge health={row.original.health} issues={row.original.issues} /> },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button type="button" aria-label={row.original.active ? 'Deactivate workflow' : 'Activate workflow'} onClick={() => handleToggle(row.original.id, !row.original.active)} className="p-1 text-gray-400 hover:text-white">
            {row.original.active ? <ToggleRight className="w-5 h-5 text-orange-500" /> : <ToggleLeft className="w-5 h-5" />}
          </button>
          <button type="button" aria-label="Clone workflow" onClick={() => handleClone(row.original._def)} className="p-1 text-gray-400 hover:text-white"><Copy className="w-3.5 h-3.5" /></button>
          <button type="button" aria-label="Delete workflow" onClick={() => { if (window.confirm(`Delete workflow "${row.original.name}"? In-flight approvals keep their snapshot, but no new chains will start.`)) handleDelete(row.original.id) }} className="p-1 text-gray-400 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ),
    },
  ], [navigate]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectCls = 'bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all cursor-pointer'

  return (
    <div className="text-white space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 rounded-lg bg-orange-500/20">
              <GitBranch className="w-5 h-5 text-orange-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Approval Workflows</h1>
          </div>
          <p className="text-gray-400 text-sm ml-11">Visually build multi-step approval chains, Start, then each step, then Complete, per entity type</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <button onClick={() => { fetch(); fetchInstances() }} className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-gray-300 bg-gray-800 border border-gray-700 hover:text-white">
            <RefreshCcw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => exportDefinitions('excel')} disabled={!visibleRows.length} className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-gray-300 bg-gray-800 border border-gray-700 hover:text-white disabled:opacity-40">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </button>
          <button onClick={() => exportDefinitions('pdf')} disabled={!visibleRows.length} className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-gray-300 bg-gray-800 border border-gray-700 hover:text-white disabled:opacity-40">
            <FileText className="w-4 h-4" /> PDF
          </button>
          <button
            onClick={() => navigate('/workflow-settings/builder')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg shadow-orange-500/25 transition-all whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> New Workflow
          </button>
        </div>
      </div>

      {/* ── KPIs ── */}
      {!loading && definitions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi icon={GitBranch} label="Workflows" value={summary.total} sub={`${summary.active} active, ${summary.inactive} inactive`} />
          <Kpi icon={Layers} label="Entities covered" value={summary.activeEntities} sub={`${coverage.filter((c) => c.uncovered).length} reference entity type(s) with no active chain`} />
          <Kpi icon={ListChecks} label="Average steps" value={na(summary.avgSteps)} sub={`Average chain SLA ${na(summary.avgChainSlaHours, ' h')}`} />
          <Kpi icon={AlertTriangle} label="Needing attention" value={summary.withIssues} sub={`${summary.withErrors} with blocking problems`} tone={summary.withErrors ? 'text-red-400' : summary.withIssues ? 'text-amber-400' : 'text-emerald-400'} />
          <Kpi icon={Activity} label="Pending runs" value={instLoading ? '...' : usage.byStatus.pending} sub={instLoading ? 'Loading' : `${usage.overdue} past the current step SLA`} tone={usage.overdue ? 'text-amber-400' : ''} />
          <Kpi icon={Clock} label="SLA compliance" value={instLoading ? '...' : na(usage.slaCompliancePct, '%')} sub={usage.slaTracked ? `${usage.slaTracked} pending run(s) with an SLA` : 'No pending run carries an SLA'} />
          <Kpi icon={CheckCircle2} label="Approval rate" value={instLoading ? '...' : na(usage.approvalRatePct, '%')} sub="Approved out of approved + rejected" />
          <Kpi icon={Zap} label="Median cycle time" value={instLoading ? '...' : na(usage.medianCycleHours, ' h')} sub="Start to completion, finished runs only" />
        </div>
      )}
      {!loading && definitions.length > 0 && !instLoading && !instError && usage.sampleOf > usage.sampled && (
        <p className="text-xs text-gray-500">Run figures cover the most recent {usage.sampled.toLocaleString()} of {usage.sampleOf.toLocaleString()} runs.</p>
      )}
      {instError && !loading && definitions.length > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" /> Run figures are unavailable: {instError}
          <button onClick={fetchInstances} className="ml-auto px-3 py-1 text-xs font-semibold rounded-lg border border-amber-500/30 hover:bg-amber-500/20">Retry</button>
        </div>
      )}

      {/* ── Filters ── */}
      {definitions.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search workflows, entity, trigger or approver..."
              className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white" aria-label="Clear search">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select aria-label="Status filter" value={filterActive} onChange={e => setFilterActive(e.target.value)} className={selectCls}>
            <option value="all">All Status</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <select aria-label="Entity filter" value={filterEntity} onChange={e => setFilterEntity(e.target.value)} className={selectCls}>
            <option value="all">All entities</option>
            {entities.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <select aria-label="Health filter" value={filterHealth} onChange={e => setFilterHealth(e.target.value)} className={selectCls}>
            <option value="all">Any health</option>
            <option value="ok">Healthy</option>
            <option value="warning">Warnings</option>
            <option value="error">Blocking problems</option>
          </select>
          <div className="inline-flex rounded-xl border border-gray-700 p-0.5 bg-gray-800">
            {['cards', 'table'].map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={`px-3 py-1.5 text-sm rounded-lg ${view === v ? 'bg-orange-500 text-white' : 'text-gray-400'}`}>
                {v === 'cards' ? 'Cards' : 'Table'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {(error || actionError) && (
        <div className="flex items-center gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error || actionError}</p>
          <button
            onClick={() => { if (error) fetch(); else setActionError(null) }}
            className="ml-auto shrink-0 px-3 py-1 text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 rounded-lg border border-red-500/30 transition-all"
          >
            {error ? 'Retry' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-40 rounded-xl bg-gray-800 border border-gray-700 animate-pulse" />)}
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && definitions.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-16 gap-6">
          <div className="w-20 h-20 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
            <GitBranch className="w-9 h-9 text-gray-500" />
          </div>
          <div className="text-center max-w-lg">
            <p className="text-gray-300 text-lg font-medium">No approval workflows yet</p>
            <p className="text-gray-500 text-sm mt-1">
              Build a multi-step chain visually, or start from a ready-made reference flow below.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
            {STARTER_TEMPLATES.map(tpl => (
              <button
                key={tpl.name}
                onClick={() => openTemplate(tpl)}
                className="text-left p-4 rounded-xl bg-gray-800 border border-gray-700 hover:border-orange-500/50 transition-all group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-orange-400" />
                  <p className="text-white text-sm font-semibold">{tpl.name}</p>
                </div>
                <p className="text-gray-500 text-xs">{tpl.steps.length} steps, {tpl.entity_type}, {tpl.trigger_event}</p>
                <span className="mt-2 inline-flex items-center gap-1 text-orange-400 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  Use template <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Grid / Table ── */}
      {!loading && definitions.length > 0 && (
        visibleRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Filter className="w-8 h-8 text-gray-600" />
            <p className="text-gray-400 text-sm">No workflows match your filters.</p>
            <button onClick={clearFilters} className="text-orange-400 text-xs hover:text-orange-300 transition-colors">
              Clear filters
            </button>
          </div>
        ) : view === 'table' ? (
          <EnterpriseTable
            columns={columns}
            data={visibleRows}
            getRowId={(r) => String(r.id)}
            enableGlobalFilter={false}
            enableExport={false}
            emptyMessage="No workflows match your filters."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visibleRows.map(r => (
              <DefinitionCard
                key={r.id}
                def={r._def}
                health={r.health}
                issues={r.issues}
                onEdit={def => navigate(`/workflow-settings/builder/${def.id}`)}
                onClone={handleClone}
                onDelete={handleDelete}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )
      )}
      {!loading && definitions.length > 0 && filtersOn && visibleRows.length > 0 && (
        <p className="text-xs text-gray-500">{visibleRows.length} of {rows.length} workflows shown. <button onClick={clearFilters} className="text-orange-400 hover:text-orange-300">Clear filters</button></p>
      )}

      {/* ── Coverage + usage ── */}
      {!loading && definitions.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl bg-gray-800 border border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-white mb-1">Entity coverage</h3>
            <p className="text-xs text-gray-500 mb-3">Entity types from your workflows and the reference starter flows. An entity with no active chain starts no approvals.</p>
            <div className="space-y-2">
              {coverage.map((c) => (
                <div key={c.entity} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-gray-300">{c.entity}</span>
                  <span className={`text-xs ${c.uncovered ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {c.uncovered ? 'No active chain' : `${c.active} active`}{c.inactive ? `, ${c.inactive} inactive` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl bg-gray-800 border border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-white mb-1">Runs by workflow</h3>
            <p className="text-xs text-gray-500 mb-3">From the recorded run history. Overdue means the current step has waited longer than its SLA.</p>
            {instLoading ? (
              <div className="h-24 rounded-lg bg-gray-700/40 animate-pulse" />
            ) : instError ? (
              <p className="text-xs text-gray-500">Run figures are unavailable.</p>
            ) : usage.byDefinition.length === 0 ? (
              <p className="text-xs text-gray-500">No workflow has started a run yet.</p>
            ) : (
              <div className="space-y-2">
                {usage.byDefinition.slice(0, 8).map((d) => (
                  <div key={d.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-gray-300">{d.name}</span>
                    <span className="shrink-0 text-xs text-gray-400 tabular-nums">
                      {d.runs} runs, {d.pending} pending, {d.approved} approved, {d.rejected} rejected
                      {d.overdue ? <span className="text-amber-400">, {d.overdue} overdue</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
