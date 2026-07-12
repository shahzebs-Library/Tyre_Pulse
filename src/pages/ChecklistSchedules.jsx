import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarClock, Plus, RefreshCw, AlertTriangle, Trash2, Zap, Loader2,
  CheckCircle2, X, Power, PowerOff, MapPin, Truck, Layers, ArrowLeft,
  CalendarDays, Users, ListChecks,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listSchedules, createSchedule, setScheduleActive, deleteSchedule, generateNow,
} from '../lib/api/checklistSchedules'
import { listTemplates } from '../lib/api/checklists'
import { useSites } from '../hooks/useSites'

// The friendly "tables not deployed yet" heuristic — mirrors Billing.jsx / Checklists.jsx.
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table') ||
    m.includes('generate_checklist_assignments')
}

const CADENCES = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'once', label: 'One-off' },
]
const CADENCE_LABEL = Object.fromEntries(CADENCES.map((c) => [c.key, c.label]))

// Roles a schedule can target for its generated assignments.
const ROLES = ['Admin', 'Manager', 'Director', 'Inspector', 'Tyre Man', 'Store Keeper', 'Reporter', 'Driver']

const CADENCE_BADGE = {
  daily: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  weekly: 'bg-green-900/40 text-green-300 border border-green-700/50',
  monthly: 'bg-purple-900/40 text-purple-300 border border-purple-700/50',
  once: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
}
function cadenceBadge(c) {
  return CADENCE_BADGE[String(c || '').toLowerCase()] || 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]'
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
function fmtDate(v) {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
function isOverdue(v) {
  if (!v) return false
  const d = new Date(v)
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now() - 24 * 60 * 60 * 1000
}

// A schedule's target audience, summarised for the table.
function targetSummary(s) {
  const sites = Array.isArray(s?.sites) ? s.sites.filter(Boolean) : []
  const assets = Array.isArray(s?.asset_nos) ? s.asset_nos.filter(Boolean) : []
  if (sites.length) return `${sites.length} site${sites.length === 1 ? '' : 's'}`
  if (assets.length) return `${assets.length} asset${assets.length === 1 ? '' : 's'}`
  return 'All'
}

export default function ChecklistSchedules() {
  const { activeCountry } = useSettings()
  const { options: siteOptions } = useSites(activeCountry)

  const [schedules, setSchedules] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [rowBusyId, setRowBusyId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [formError, setFormError] = useState('')

  // Lightweight self-contained toast (no external dependency).
  const [toast, setToast] = useState(null) // { kind:'success'|'error', text }
  const toastTimer = useRef(null)
  const showToast = useCallback((kind, text) => {
    setToast({ kind, text })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4500)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  // ── Create-schedule form ────────────────────────────────────────────────────
  const emptyForm = useMemo(() => ({
    template_id: '', name: '', cadence: 'weekly',
    targetMode: 'sites', sites: [], asset_nos: [],
    assignee_role: '', start_date: todayISO(),
  }), [])
  const [form, setForm] = useState(emptyForm)
  const [assetInput, setAssetInput] = useState('')
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true); setError(''); setMissing(false)
    try {
      const [rows, tpls] = await Promise.all([
        listSchedules({ country: activeCountry }),
        listTemplates({ status: 'published', country: activeCountry }).catch(() => []),
      ])
      setSchedules(Array.isArray(rows) ? rows : [])
      setTemplates(Array.isArray(tpls) ? tpls : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      else setError(err?.message || 'Could not load checklist schedules.')
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const templateName = useCallback((id) => {
    const t = templates.find((x) => x?.id === id)
    return t?.name || 'Unknown template'
  }, [templates])

  // ── Asset chip handling ─────────────────────────────────────────────────────
  function addAssetsFromInput() {
    const parts = String(assetInput || '')
      .split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
    if (!parts.length) { setAssetInput(''); return }
    setForm((f) => {
      const set = new Set([...(f.asset_nos || []), ...parts])
      return { ...f, asset_nos: Array.from(set) }
    })
    setAssetInput('')
  }
  function onAssetKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAssetsFromInput() }
  }
  function removeAsset(a) {
    setForm((f) => ({ ...f, asset_nos: (f.asset_nos || []).filter((x) => x !== a) }))
  }

  function toggleSite(site) {
    setForm((f) => {
      const has = (f.sites || []).includes(site)
      return { ...f, sites: has ? f.sites.filter((s) => s !== site) : [...(f.sites || []), site] }
    })
  }

  function resetForm() {
    setForm({ ...emptyForm, start_date: todayISO() })
    setAssetInput('')
    setFormError('')
  }

  // ── Create ──────────────────────────────────────────────────────────────────
  async function onSubmit(e) {
    e.preventDefault()
    setFormError('')
    if (!form.template_id) { setFormError('Choose a published checklist template.'); return }
    if (!form.name.trim()) { setFormError('Give this schedule a name.'); return }
    if (!form.start_date) { setFormError('Pick a start date.'); return }

    // Fold any half-typed asset text into the list before saving.
    const typed = String(assetInput || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
    const assetNos = form.targetMode === 'assets'
      ? Array.from(new Set([...(form.asset_nos || []), ...typed]))
      : []
    const sites = form.targetMode === 'sites' ? (form.sites || []) : []

    setSaving(true)
    try {
      await createSchedule({
        template_id: form.template_id,
        name: form.name.trim(),
        cadence: form.cadence,
        sites,
        asset_nos: assetNos,
        assignee_role: form.assignee_role || null,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
        start_date: form.start_date,
        next_due: form.start_date,
        active: true,
      })
      resetForm()
      showToast('success', 'Schedule created.')
      await load()
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      setFormError(err?.message || 'Could not create the schedule.')
    } finally {
      setSaving(false)
    }
  }

  // ── Row actions ─────────────────────────────────────────────────────────────
  async function onToggleActive(s) {
    if (rowBusyId) return
    setRowBusyId(s.id)
    const next = !s.active
    // Optimistic flip; reverted on failure.
    setSchedules((rows) => rows.map((r) => (r.id === s.id ? { ...r, active: next } : r)))
    try {
      await setScheduleActive(s.id, next)
      showToast('success', next ? 'Schedule activated.' : 'Schedule paused.')
    } catch (err) {
      setSchedules((rows) => rows.map((r) => (r.id === s.id ? { ...r, active: s.active } : r)))
      showToast('error', err?.message || 'Could not update the schedule.')
    } finally {
      setRowBusyId(null)
    }
  }

  async function onDelete(s) {
    if (rowBusyId) return
    if (!window.confirm(`Delete schedule "${s.name || 'this schedule'}"? Existing generated assignments are kept; no new ones will be created.`)) return
    setRowBusyId(s.id)
    try {
      await deleteSchedule(s.id)
      setSchedules((rows) => rows.filter((r) => r.id !== s.id))
      showToast('success', 'Schedule deleted.')
    } catch (err) {
      showToast('error', err?.message || 'Could not delete the schedule.')
    } finally {
      setRowBusyId(null)
    }
  }

  async function onGenerateNow() {
    if (generating) return
    setGenerating(true)
    try {
      const res = await generateNow()
      const count = typeof res === 'number' ? res : (res?.count ?? res?.generated ?? 0)
      const n = Number.isFinite(Number(count)) ? Number(count) : 0
      showToast('success', `${n} assignment${n === 1 ? '' : 's'} created.`)
      await load()
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      showToast('error', err?.message || 'Could not generate assignments.')
    } finally {
      setGenerating(false)
    }
  }

  const activeCount = useMemo(() => schedules.filter((s) => s?.active).length, [schedules])

  const headerActions = (
    <button
      onClick={onGenerateNow}
      disabled={generating || missing || loading}
      className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50"
      title="Materialise any due assignments now"
    >
      {generating ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
      Generate due now
    </button>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Checklist Schedules"
        subtitle="Automate recurring compliance — assign checklists to sites and assets on a cadence."
        icon={CalendarClock}
        badge={!loading && !missing ? `${activeCount} active` : undefined}
        actions={headerActions}
        onRefresh={load}
        refreshing={loading}
        updatedAt={updatedAt}
      />

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed z-50 bottom-6 right-6 max-w-sm rounded-xl px-4 py-3 shadow-lg border flex items-start gap-2.5 text-sm ${
            toast.kind === 'success'
              ? 'bg-green-950/90 border-green-700/60 text-green-200'
              : 'bg-red-950/90 border-red-700/60 text-red-200'
          }`}
        >
          {toast.kind === 'success'
            ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{toast.text}</span>
          <button onClick={() => setToast(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={14} />
          </button>
        </div>
      )}

      {/* How it works */}
      <div className="card border border-[var(--border-dim)] bg-[var(--surface-1)]">
        <div className="flex items-start gap-3">
          <Zap size={18} className="text-brand-bright mt-0.5 shrink-0" />
          <p className="text-sm text-[var(--text-muted)]">
            Schedules generate checklist assignments automatically every day. Use
            {' '}<span className="text-[var(--text-primary)] font-medium">Generate due now</span> to materialise any that are already due
            without waiting for the daily run. Assignments appear on the{' '}
            <Link to="/checklists" className="text-brand-bright hover:underline">Checklists</Link> workspace.
          </p>
        </div>
      </div>

      {/* Migration hint */}
      {missing && (
        <div className="card border border-amber-800/50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-amber-300 font-medium">Checklist scheduling isn't enabled on this database yet.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">
                Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V124_CHECKLIST_SCHEDULES.sql</span> to create the
                {' '}<span className="font-mono">checklist_schedules</span> and <span className="font-mono">checklist_assignments</span> tables
                and the <span className="font-mono">generate_checklist_assignments()</span> function, then reload.
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
              <p className="text-red-300 font-medium">Couldn't load checklist schedules.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
              <button onClick={load} className="btn-secondary text-sm mt-3 inline-flex items-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {!missing && !error && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Create form */}
          <div className="xl:col-span-1">
            <form onSubmit={onSubmit} className="card space-y-4">
              <div className="flex items-center gap-2">
                <Plus size={16} className="text-brand-bright" />
                <h2 className="text-[var(--text-primary)] font-semibold">Schedule a checklist</h2>
              </div>

              {templates.length === 0 && !loading && (
                <div className="rounded-lg border border-amber-800/40 bg-amber-900/15 px-3 py-2.5 text-xs text-amber-300 flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    No published templates for {activeCountry || 'this scope'}.{' '}
                    <Link to="/checklists" className="underline hover:text-amber-200">Publish one first</Link> to schedule it.
                  </span>
                </div>
              )}

              <div>
                <label className="label">Template</label>
                <select
                  className="input"
                  value={form.template_id}
                  onChange={(e) => setField('template_id', e.target.value)}
                  disabled={loading}
                >
                  <option value="">Select a published template…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name || 'Untitled'}{t.version ? ` (v${t.version})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Schedule name</label>
                <input
                  className="input"
                  placeholder="e.g. Weekly steer-tyre safety check"
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  maxLength={120}
                />
              </div>

              <div>
                <label className="label">Cadence</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {CADENCES.map((c) => (
                    <button
                      type="button"
                      key={c.key}
                      onClick={() => setField('cadence', c.key)}
                      className={`px-2 py-2 rounded-lg text-xs font-medium border transition-colors ${
                        form.cadence === c.key
                          ? 'bg-green-600 border-green-600 text-white'
                          : 'bg-[var(--surface-1)] border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target */}
              <div>
                <label className="label">Target</label>
                <div className="flex gap-1.5 mb-2">
                  {[
                    { key: 'sites', label: 'Sites', icon: MapPin },
                    { key: 'assets', label: 'Assets', icon: Truck },
                    { key: 'general', label: 'General', icon: Layers },
                  ].map(({ key, label, icon: Icon }) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setField('targetMode', key)}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border inline-flex items-center justify-center gap-1.5 transition-colors ${
                        form.targetMode === key
                          ? 'bg-brand-subtle border-[rgba(22,163,74,0.4)] text-brand-bright'
                          : 'bg-[var(--surface-1)] border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>

                {form.targetMode === 'sites' && (
                  <div className="rounded-lg border border-[var(--border-dim)] max-h-44 overflow-y-auto divide-y divide-[var(--border-dim)]">
                    {siteOptions.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-[var(--text-muted)]">No sites available for this country.</p>
                    ) : siteOptions.map((site) => {
                      const checked = (form.sites || []).includes(site)
                      return (
                        <label key={site} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--surface-2)]">
                          <input type="checkbox" checked={checked} onChange={() => toggleSite(site)} className="accent-green-600" />
                          <span className="text-sm text-[var(--text-primary)] truncate">{site}</span>
                        </label>
                      )
                    })}
                  </div>
                )}

                {form.targetMode === 'assets' && (
                  <div>
                    <input
                      className="input"
                      placeholder="Type asset no, comma or Enter to add"
                      value={assetInput}
                      onChange={(e) => setAssetInput(e.target.value)}
                      onKeyDown={onAssetKeyDown}
                      onBlur={addAssetsFromInput}
                    />
                    {(form.asset_nos || []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {form.asset_nos.map((a) => (
                          <span key={a} className="inline-flex items-center gap-1 text-xs bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-full px-2 py-1 text-[var(--text-primary)]">
                            {a}
                            <button type="button" onClick={() => removeAsset(a)} className="text-[var(--text-muted)] hover:text-red-400">
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {form.targetMode === 'general' && (
                  <p className="text-xs text-[var(--text-muted)] px-1">
                    One general assignment is created per cadence — not tied to a specific site or asset.
                  </p>
                )}
              </div>

              <div>
                <label className="label">Assignee role <span className="text-[var(--text-dim)]">(optional)</span></label>
                <select
                  className="input"
                  value={form.assignee_role}
                  onChange={(e) => setField('assignee_role', e.target.value)}
                >
                  <option value="">Anyone</option>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <label className="label">Start date</label>
                <input
                  type="date"
                  className="input"
                  value={form.start_date}
                  min={todayISO()}
                  onChange={(e) => setField('start_date', e.target.value)}
                />
              </div>

              {formError && (
                <div className="rounded-lg border border-red-800/50 bg-red-900/15 px-3 py-2 text-xs text-red-300 flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving || templates.length === 0}
                  className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50 flex-1 justify-center"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  {saving ? 'Saving…' : 'Create schedule'}
                </button>
                <button type="button" onClick={resetForm} disabled={saving} className="btn-secondary text-sm disabled:opacity-50">
                  Reset
                </button>
              </div>
            </form>
          </div>

          {/* Schedules list */}
          <div className="xl:col-span-2 space-y-4">
            {loading ? (
              <div className="card p-0 overflow-hidden">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-4 border-t first:border-t-0 border-[var(--border-dim)] animate-pulse">
                    <div className="h-4 w-40 bg-[var(--input-bg)] rounded" />
                    <div className="h-4 w-20 bg-[var(--input-bg)] rounded" />
                    <div className="h-4 w-16 bg-[var(--input-bg)] rounded ml-auto" />
                    <div className="h-6 w-12 bg-[var(--input-bg)] rounded" />
                  </div>
                ))}
              </div>
            ) : schedules.length === 0 ? (
              <div className="card text-center py-16 space-y-3">
                <CalendarDays size={34} className="mx-auto text-[var(--text-muted)]" />
                <p className="text-[var(--text-primary)] font-semibold">No schedules yet</p>
                <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
                  Schedule your first recurring checklist using the form on the left. It will generate
                  assignments automatically on the cadence you choose.
                </p>
              </div>
            ) : (
              <div className="card p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="table-header text-left">Schedule</th>
                      <th className="table-header text-left">Cadence</th>
                      <th className="table-header text-left">Target</th>
                      <th className="table-header text-left">Next due</th>
                      <th className="table-header text-left">Active</th>
                      <th className="table-header"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((s) => {
                      const busy = rowBusyId === s.id
                      const overdue = s.active && isOverdue(s.next_due)
                      return (
                        <tr key={s.id} className="border-t border-[var(--border-dim)]">
                          <td className="table-cell">
                            <div className="font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                              <ListChecks size={14} className="text-[var(--text-muted)] shrink-0" />
                              {s.name || 'Untitled schedule'}
                            </div>
                            <div className="text-xs text-[var(--text-muted)] mt-0.5">{templateName(s.template_id)}</div>
                          </td>
                          <td className="table-cell">
                            <span className={`badge text-xs ${cadenceBadge(s.cadence)}`}>{CADENCE_LABEL[s.cadence] || s.cadence || '-'}</span>
                          </td>
                          <td className="table-cell">
                            <span className="text-[var(--text-primary)]">{targetSummary(s)}</span>
                            {s.assignee_role && (
                              <div className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1 mt-0.5">
                                <Users size={11} /> {s.assignee_role}
                              </div>
                            )}
                          </td>
                          <td className="table-cell whitespace-nowrap">
                            <span className={overdue ? 'text-amber-400 font-medium' : 'text-[var(--text-muted)]'}>
                              {fmtDate(s.next_due)}
                            </span>
                            {overdue && <div className="text-[10px] uppercase tracking-wide text-amber-400/80">overdue</div>}
                          </td>
                          <td className="table-cell">
                            <button
                              onClick={() => onToggleActive(s)}
                              disabled={busy}
                              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-50 ${
                                s.active
                                  ? 'bg-green-900/30 border-green-700/50 text-green-300 hover:bg-green-900/50'
                                  : 'bg-[var(--surface-2)] border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                              }`}
                              title={s.active ? 'Pause this schedule' : 'Activate this schedule'}
                            >
                              {busy ? <Loader2 size={12} className="animate-spin" />
                                : s.active ? <Power size={12} /> : <PowerOff size={12} />}
                              {s.active ? 'Active' : 'Paused'}
                            </button>
                          </td>
                          <td className="table-cell text-right">
                            <button
                              onClick={() => onDelete(s)}
                              disabled={busy}
                              className="text-[var(--text-muted)] hover:text-red-400 disabled:opacity-50 p-1"
                              title="Delete schedule"
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && schedules.length > 0 && (
              <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                <ArrowLeft size={12} />
                {schedules.length} schedule{schedules.length === 1 ? '' : 's'} · {activeCount} active. Assignments generate daily; use “Generate due now” to run immediately.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
