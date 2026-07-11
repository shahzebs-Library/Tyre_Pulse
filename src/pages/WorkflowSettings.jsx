import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  GitBranch, Plus, Edit2, Trash2, X, Loader2, Search,
  ToggleLeft, ToggleRight, XCircle, ChevronRight,
  Zap, Layers, Clock, Filter, Copy, Sparkles, CircleDashed, SlidersHorizontal,
} from 'lucide-react'
import * as workflows from '../lib/api/workflows'
import { STARTER_TEMPLATES } from '../lib/workflow/starterTemplates'

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

function DefinitionCard({ def, onEdit, onClone, onDelete, onToggle }) {
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
        <span className="text-gray-500 text-xs">{steps.length} step{steps.length !== 1 ? 's' : ''}</span>
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkflowSettings() {
  const navigate = useNavigate()
  const [definitions, setDefinitions] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [search, setSearch]           = useState('')
  const [filterActive, setFilterActive] = useState('all')

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await workflows.listWorkflowDefinitions()
      setDefinitions(rows || [])
    } catch (err) { setError(err.message || 'Failed to load workflows') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  const q = search.trim().toLowerCase()
  const visible = useMemo(() => definitions.filter(d => {
    const matchSearch = !q
      || (d.name || '').toLowerCase().includes(q)
      || (d.entity_type || '').toLowerCase().includes(q)
      || (d.trigger_event || '').toLowerCase().includes(q)
    const matchActive = filterActive === 'all' || (filterActive === 'active' ? d.active : !d.active)
    return matchSearch && matchActive
  }), [definitions, q, filterActive])

  async function handleDelete(id) {
    setError(null)
    try {
      await workflows.deleteWorkflowDefinition(id)
      setDefinitions(prev => prev.filter(d => d.id !== id))
    } catch (err) { setError(err.message || 'Delete failed') }
  }

  async function handleToggle(id, active) {
    setError(null)
    try {
      await workflows.updateWorkflowDefinition(id, { active })
      setDefinitions(prev => prev.map(d => d.id === id ? { ...d, active } : d))
    } catch (err) { setError(err.message || 'Update failed') }
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
          <p className="text-gray-400 text-sm ml-11">Visually build multi-step approval chains, Start → step → step → Complete, per entity type</p>
        </div>
        <button
          onClick={() => navigate('/workflow-settings/builder')}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg shadow-orange-500/25 transition-all whitespace-nowrap self-start"
        >
          <Plus className="w-4 h-4" /> New Workflow
        </button>
      </div>

      {/* ── Filters ── */}
      {definitions.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search workflows..."
              className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white" aria-label="Clear search">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select
            value={filterActive}
            onChange={e => setFilterActive(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={fetch}
            className="ml-auto shrink-0 px-3 py-1 text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 rounded-lg border border-red-500/30 transition-all"
          >
            Retry
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
                <p className="text-gray-500 text-xs">{tpl.steps.length} steps · {tpl.entity_type} · {tpl.trigger_event}</p>
                <span className="mt-2 inline-flex items-center gap-1 text-orange-400 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  Use template <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Grid ── */}
      {!loading && definitions.length > 0 && (
        visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Filter className="w-8 h-8 text-gray-600" />
            <p className="text-gray-400 text-sm">No workflows match your filters.</p>
            <button onClick={() => { setSearch(''); setFilterActive('all') }} className="text-orange-400 text-xs hover:text-orange-300 transition-colors">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visible.map(d => (
              <DefinitionCard
                key={d.id}
                def={d}
                onEdit={def => navigate(`/workflow-settings/builder/${def.id}`)}
                onClone={handleClone}
                onDelete={handleDelete}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )
      )}
    </div>
  )
}
