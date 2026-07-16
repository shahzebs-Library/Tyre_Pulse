/**
 * ConsoleAlertRules - super-admin no-code Alert Rules builder (Admin Control
 * Module 5). A pure console page (navy + orange theme, useConsoleAuth gate).
 *
 * The builder reads plain English:
 *   "if [metric] [operator] [value] then notify via [in-app / email]"
 * assembled entirely from dropdowns (ALERT_METRICS, ALERT_OPERATORS), a number
 * input and channel checkboxes, with an optional site / brand filter and an
 * active toggle. Existing rules list with their evaluation stats (how many times
 * they fired + when last), each editable / toggleable / deletable.
 *
 * These rules ARE alert_thresholds rows (owner-scoped by RLS). They are
 * evaluated hourly by an existing cron job; severity routing (immediate vs
 * daily digest) follows the owner's notification preferences.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BellRing, Plus, Pencil, Trash2, RefreshCw, AlertTriangle, Info,
  Power, Save, X, CheckCircle2, Clock, Mail, MonitorSmartphone,
} from 'lucide-react'
import { toUserMessage } from '../../lib/safeError'
import {
  ALERT_METRICS, ALERT_OPERATORS, metricLabel, operatorLabel,
  listAlertRules, createAlertRule, updateAlertRule, toggleAlertRule, deleteAlertRule,
} from '../../lib/api/alertRules'

const EMPTY_FORM = {
  name: '',
  metric: ALERT_METRICS[0]?.key || '',
  operator: 'gte',
  threshold: '',
  siteFilter: '',
  brandFilter: '',
  notifyInApp: true,
  notifyEmail: false,
  active: true,
}

/** Plain-English tooltip marker sitting next to a technical term. */
function InfoDot({ text }) {
  return (
    <span className="inline-flex align-middle ml-1 text-gray-600 hover:text-gray-300 cursor-help" title={text}>
      <Info size={11} />
    </span>
  )
}

export default function ConsoleAlertRules() {
  const [rules, setRules]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busyId, setBusyId]   = useState(null)

  const [form, setForm]       = useState(EMPTY_FORM)
  const [editId, setEditId]   = useState(null)
  const [saving, setSaving]   = useState(false)
  const [formError, setFormError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRules(await listAlertRules())
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function resetForm() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setFormError(null)
  }

  function startEdit(r) {
    setEditId(r.id)
    setFormError(null)
    setForm({
      name: r.name || '',
      metric: r.metric || ALERT_METRICS[0]?.key || '',
      operator: r.operator || 'gte',
      threshold: r.threshold ?? '',
      siteFilter: r.site_filter || '',
      brandFilter: r.brand_filter || '',
      notifyInApp: r.notify_in_app !== false,
      notifyEmail: !!r.notify_email,
      active: r.active !== false,
    })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const validation = useMemo(() => {
    if (!form.name.trim()) return 'Give the rule a short name.'
    if (!form.metric) return 'Pick a metric to watch.'
    if (form.threshold === '' || !Number.isFinite(Number(form.threshold))) return 'Enter a numeric threshold value.'
    if (!form.notifyInApp && !form.notifyEmail) return 'Choose at least one notification channel.'
    return null
  }, [form])

  async function save(e) {
    e?.preventDefault?.()
    if (validation) { setFormError(validation); return }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        name: form.name.trim(),
        metric: form.metric,
        operator: form.operator,
        threshold: Number(form.threshold),
        siteFilter: form.siteFilter.trim(),
        brandFilter: form.brandFilter.trim(),
        notifyInApp: form.notifyInApp,
        notifyEmail: form.notifyEmail,
        active: form.active,
      }
      if (editId) await updateAlertRule(editId, payload)
      else await createAlertRule(payload)
      resetForm()
      await load()
    } catch (err) {
      setFormError(toUserMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function onToggle(r) {
    setBusyId(r.id)
    try {
      await toggleAlertRule(r.id, !(r.active !== false))
      await load()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function onDelete(r) {
    if (typeof window !== 'undefined' && !window.confirm(`Delete alert rule "${r.name}"? This cannot be undone.`)) return
    setBusyId(r.id)
    try {
      await deleteAlertRule(r.id)
      if (editId === r.id) resetForm()
      await load()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const activeCount = rules.filter((r) => r.active !== false).length

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BellRing size={20} className="text-orange-400" /> Alert Rules
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            No-code rules that watch your fleet and notify you when a threshold is crossed.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Honest evaluation note */}
      <div className="flex items-start gap-2 rounded-xl border border-blue-800/40 bg-blue-900/15 p-3 text-xs text-blue-200/90">
        <Clock size={14} className="mt-0.5 flex-shrink-0 text-blue-400" />
        <p>
          Rules are evaluated hourly. Critical alerts notify immediately, warnings batch into a daily
          digest (severity routing via your notification preferences).
        </p>
      </div>

      {/* Builder */}
      <form onSubmit={save} className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            {editId ? 'Edit alert rule' : 'New alert rule'}
          </h3>
          {editId && (
            <button type="button" onClick={resetForm}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-white">
              <X size={12} /> Cancel edit
            </button>
          )}
        </div>

        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Rule name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Too many high-risk tyres"
            className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Plain-English condition builder */}
        <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Condition</p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-300">
            <span className="text-gray-500">If</span>
            <select
              value={form.metric}
              onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}
              className="px-2 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white focus:outline-none focus:border-orange-500">
              {ALERT_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <span className="text-gray-500">is</span>
            <select
              value={form.operator}
              onChange={(e) => setForm((f) => ({ ...f, operator: e.target.value }))}
              className="px-2 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white focus:outline-none focus:border-orange-500">
              {ALERT_OPERATORS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <input
              type="number"
              step="any"
              value={form.threshold}
              onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
              placeholder="value"
              className="w-24 px-2 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
            />
            <span className="text-gray-500">then notify me.</span>
          </div>
        </div>

        {/* Channels + filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1.5">
              Notify via
              <InfoDot text="How you get told when this rule fires. In-app shows a notification; email sends a message." />
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input type="checkbox" checked={form.notifyInApp}
                  onChange={(e) => setForm((f) => ({ ...f, notifyInApp: e.target.checked }))}
                  className="accent-orange-500" />
                <MonitorSmartphone size={13} className="text-gray-500" /> In-app
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input type="checkbox" checked={form.notifyEmail}
                  onChange={(e) => setForm((f) => ({ ...f, notifyEmail: e.target.checked }))}
                  className="accent-orange-500" />
                <Mail size={13} className="text-gray-500" /> Email
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Site filter <span className="text-gray-600">(optional)</span>
                <InfoDot text="Limit this rule to one site. Leave blank to watch all sites." />
              </label>
              <input
                value={form.siteFilter}
                onChange={(e) => setForm((f) => ({ ...f, siteFilter: e.target.value }))}
                placeholder="All sites"
                className="w-full px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-700 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Brand filter <span className="text-gray-600">(optional)</span>
                <InfoDot text="Limit this rule to one tyre brand. Leave blank to watch all brands." />
              </label>
              <input
                value={form.brandFilter}
                onChange={(e) => setForm((f) => ({ ...f, brandFilter: e.target.value }))}
                placeholder="All brands"
                className="w-full px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-700 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>
        </div>

        {/* Active + submit */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              className="accent-orange-500" />
            Rule is active
            <InfoDot text="Inactive rules are kept but never evaluated." />
          </label>
          <div className="flex items-center gap-2">
            {formError && (
              <span className="flex items-center gap-1 text-xs text-red-300">
                <AlertTriangle size={12} /> {formError}
              </span>
            )}
            <button type="submit" disabled={saving || !!validation}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {editId ? <Save size={14} /> : <Plus size={14} />}
              {saving ? 'Saving...' : editId ? 'Save changes' : 'Add rule'}
            </button>
          </div>
        </div>
      </form>

      {/* Existing rules */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">
            Your alert rules {rules.length > 0 && (
              <span className="text-xs font-normal text-gray-500">
                ({activeCount} active of {rules.length})
              </span>
            )}
          </h3>
        </div>

        {error && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-200">
            <span className="flex items-center gap-2"><AlertTriangle size={14} /> {error}</span>
            <button onClick={load} className="text-xs text-red-300 underline hover:text-red-200">Retry</button>
          </div>
        )}

        {loading && !error && (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-8 justify-center">
            <RefreshCw size={14} className="animate-spin" /> Loading alert rules...
          </div>
        )}

        {!loading && !error && rules.length === 0 && (
          <div className="text-center py-10">
            <BellRing size={28} className="mx-auto text-gray-700 mb-2" />
            <p className="text-sm text-gray-500">No alert rules yet - add one to get notified.</p>
          </div>
        )}

        {!loading && !error && rules.length > 0 && (
          <div className="space-y-2">
            {rules.map((r) => {
              const isActive = r.active !== false
              return (
                <div key={r.id}
                  className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 transition-colors ${
                    isActive ? 'border-gray-800 bg-gray-950/50' : 'border-gray-800/60 bg-gray-950/20 opacity-70'
                  }`}>
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white truncate">{r.name || 'Untitled rule'}</p>
                      {isActive
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 border border-green-700/40">Active</span>
                        : <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">Paused</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      If <span className="text-gray-200">{metricLabel(r.metric)}</span>{' '}
                      is <span className="text-gray-200">{operatorLabel(r.operator)}</span>{' '}
                      <span className="text-gray-200">{r.threshold ?? '-'}</span>
                      {r.site_filter ? <span className="text-gray-500"> | site {r.site_filter}</span> : null}
                      {r.brand_filter ? <span className="text-gray-500"> | brand {r.brand_filter}</span> : null}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[11px] text-gray-500">
                      <span className="flex items-center gap-1">
                        {r.notify_in_app !== false && <MonitorSmartphone size={11} />}
                        {r.notify_email && <Mail size={11} />}
                        {r.notify_in_app === false && !r.notify_email ? 'No channel' : 'Notify'}
                      </span>
                      <span className="flex items-center gap-1">
                        <CheckCircle2 size={11} /> Fired {r.triggered_count ?? 0} time{(r.triggered_count ?? 0) === 1 ? '' : 's'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={11} /> {r.last_triggered_at
                          ? `Last ${new Date(r.last_triggered_at).toLocaleString()}`
                          : 'Never triggered'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => onToggle(r)} disabled={busyId === r.id} title={isActive ? 'Pause rule' : 'Activate rule'}
                      className={`p-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                        isActive
                          ? 'border-gray-700 text-green-400 hover:bg-gray-800'
                          : 'border-gray-700 text-gray-500 hover:bg-gray-800 hover:text-white'
                      }`}>
                      <Power size={14} />
                    </button>
                    <button onClick={() => startEdit(r)} disabled={busyId === r.id} title="Edit rule"
                      className="p-1.5 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors disabled:opacity-40">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => onDelete(r)} disabled={busyId === r.id} title="Delete rule"
                      className="p-1.5 rounded-lg border border-gray-700 text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-40">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
