/**
 * WorkshopSettings (route /workshop-settings) - Admin configuration surface for
 * Workshop Live Control.
 *
 * Lets an Admin tune the values that were previously hardcoded in the Live
 * Control engine (src/lib/workshopLive.js): the five alert thresholds, the
 * productivity (utilization) target, the hourly labour rate that drives the
 * delay cost impact, and the default shift window. Values persist to
 * public.workshop_config (V295) via src/lib/api/workshopConfig.js; absence of a
 * saved value = the engine's built-in default, so this page only ever narrows
 * the gap between "hardcoded" and "tuned".
 *
 * Self-gated: Admin / Manager / Director (and super admin) can view; only Admin
 * and super admin can write - inputs are disabled for everyone else. Honest
 * loading / error states. Light + dark via var(--*) tokens. ASCII only.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  SlidersHorizontal, AlertTriangle, ShieldAlert, Save, Timer, Gauge,
  Clock, CheckCircle2, RotateCcw, Info, Wallet,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import {
  loadWorkshopConfig, saveWorkshopConfig, WORKSHOP_CONFIG_DEFAULTS,
} from '../lib/api/workshopConfig'
import { toUserMessage } from '../lib/safeError'

const VIEW_ROLES = new Set(['Admin', 'Manager', 'Director'])
const D = WORKSHOP_CONFIG_DEFAULTS

// Field metadata for the numeric threshold inputs (label + unit + range +
// default). Keeps the JSX declarative and the ranges consistent with the
// service-side clamps.
const THRESHOLD_FIELDS = [
  { key: 'unassignedMin', label: 'Unassigned time', unit: 'minutes', min: 1, max: 1440,
    hint: 'A technician left unassigned longer than this raises an alert.' },
  { key: 'noActivityMin', label: 'No activity', unit: 'minutes', min: 1, max: 1440,
    hint: 'A job that is started but records no activity for this long is flagged.' },
  { key: 'overSafeOvertimeMin', label: 'Safe overtime', unit: 'minutes', min: 1, max: 1440,
    hint: 'Working beyond this many minutes past shift end raises an overtime alert.' },
  { key: 'vorSlaHours', label: 'VOR SLA', unit: 'hours', min: 1, max: 8760,
    hint: 'A vehicle off road beyond this SLA is escalated.' },
  { key: 'blockedPendingMin', label: 'Blocked / pending', unit: 'minutes', min: 1, max: 1440,
    hint: 'Stuck waiting for parts or approval beyond this raises an alert.' },
]

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
function clampFloat(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// Config object -> flat, editable form state.
function toForm(cfg) {
  return {
    unassignedMin: cfg.thresholds.unassignedMin,
    noActivityMin: cfg.thresholds.noActivityMin,
    overSafeOvertimeMin: cfg.thresholds.overSafeOvertimeMin,
    vorSlaHours: cfg.thresholds.vorSlaHours,
    blockedPendingMin: cfg.thresholds.blockedPendingMin,
    targetPct: Math.round(cfg.targetUtilization * 100),
    labourRate: cfg.labourRate,
    shiftStart: cfg.shiftDefault.start,
    shiftEnd: cfg.shiftDefault.end,
  }
}

// Flat form state -> the patch shape saveWorkshopConfig expects (server clamps too).
function toPatch(form) {
  return {
    thresholds: {
      unassignedMin: clampInt(form.unassignedMin, 1, 1440, D.thresholds.unassignedMin),
      noActivityMin: clampInt(form.noActivityMin, 1, 1440, D.thresholds.noActivityMin),
      overSafeOvertimeMin: clampInt(form.overSafeOvertimeMin, 1, 1440, D.thresholds.overSafeOvertimeMin),
      vorSlaHours: clampInt(form.vorSlaHours, 1, 8760, D.thresholds.vorSlaHours),
      blockedPendingMin: clampInt(form.blockedPendingMin, 1, 1440, D.thresholds.blockedPendingMin),
    },
    targetUtilization: clampFloat(Number(form.targetPct) / 100, 0, 1, D.targetUtilization),
    labourRate: clampFloat(form.labourRate, 0, 100000, D.labourRate),
    shiftDefault: { start: form.shiftStart, end: form.shiftEnd },
  }
}

const INPUT_CLASS =
  'w-full px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] ' +
  'text-[var(--text-primary)] text-sm focus:outline-none focus:border-blue-600/60 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed'

export default function WorkshopSettings() {
  const { profile, isSuperAdmin } = useAuth()
  const { activeCurrency } = useSettings()

  const role = profile?.role
  const canView = isSuperAdmin === true || VIEW_ROLES.has(role)
  const canWrite = isSuperAdmin === true || role === 'Admin'

  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(null) // { kind:'success'|'error', msg }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cfg = await loadWorkshopConfig()
      setForm(toForm(cfg))
    } catch (e) {
      setError(toUserMessage(e, 'Could not load workshop settings.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (canView) load()
    else setLoading(false)
  }, [canView, load])

  const setField = (key) => (e) => {
    const value = e?.target?.value
    setForm((f) => ({ ...f, [key]: value }))
    setFlash(null)
  }

  const resetToDefaults = () => {
    setForm(toForm({
      thresholds: { ...D.thresholds },
      targetUtilization: D.targetUtilization,
      labourRate: D.labourRate,
      shiftDefault: { ...D.shiftDefault },
      overtimeSafeMin: D.overtimeSafeMin,
    }))
    setFlash(null)
  }

  const onSave = async () => {
    if (!canWrite || !form) return
    setSaving(true)
    setFlash(null)
    try {
      await saveWorkshopConfig(toPatch(form))
      // Re-read so the form reflects any server-side clamping exactly.
      const cfg = await loadWorkshopConfig()
      setForm(toForm(cfg))
      setFlash({ kind: 'success', msg: 'Workshop settings saved. Live Control alerts will use the new values.' })
    } catch (e) {
      setFlash({ kind: 'error', msg: toUserMessage(e, 'Could not save workshop settings.') })
    } finally {
      setSaving(false)
    }
  }

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workshop Settings" subtitle="Tune Workshop Live Control." icon={SlidersHorizontal} />
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <ShieldAlert size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">You do not have access to Workshop Settings.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              This configuration is limited to Admin, Manager and Director roles.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workshop Settings"
        subtitle="Tune the alert thresholds, productivity target, labour rate and default shift used by Workshop Live Control."
        icon={SlidersHorizontal}
        onRefresh={load}
        refreshing={loading}
      />

      {/* Explainer */}
      <div className="card border border-blue-900/40 flex items-start gap-3">
        <Info size={18} className="text-blue-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-[var(--text-primary)] font-medium text-sm">How these are used</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            These values feed the Live Control alerts (unassigned, no-activity, overtime, VOR and blocked
            time) and the delay cost impact (labour rate x hours lost). A field left at its default keeps the
            built-in engine behaviour. Changes apply the next time the Live Control board loads.
          </p>
        </div>
      </div>

      {!canWrite && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <ShieldAlert size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-amber-300 text-sm">
            You can view these settings, but only an Admin can change them. Inputs are read only.
          </p>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-red-300 font-medium">Something went wrong.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
            <button onClick={load} className="mt-2 text-sm text-blue-400 hover:text-blue-300">Retry</button>
          </div>
        </div>
      )}

      {loading && !form && (
        <div className="card text-[var(--text-muted)] text-sm">Loading workshop settings...</div>
      )}

      {form && (
        <>
          {/* Alert thresholds */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 text-[var(--text-secondary)]">
              <Timer size={16} className="text-blue-400" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">Alert thresholds</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {THRESHOLD_FIELDS.map((fld) => (
                <div key={fld.key} className="space-y-1">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">
                    {fld.label} <span className="text-[var(--text-muted)]">({fld.unit})</span>
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={fld.min}
                    max={fld.max}
                    step={1}
                    value={form[fld.key]}
                    onChange={setField(fld.key)}
                    disabled={!canWrite}
                    className={INPUT_CLASS}
                  />
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {fld.hint} Default: {D.thresholds[fld.key]} {fld.unit}.
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Productivity + labour */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 text-[var(--text-secondary)]">
              <Gauge size={16} className="text-emerald-400" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">Productivity and labour</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  Target utilization <span className="text-[var(--text-muted)]">(percent)</span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  value={form.targetPct}
                  onChange={setField('targetPct')}
                  disabled={!canWrite}
                  className={INPUT_CLASS}
                />
                <p className="text-[11px] text-[var(--text-muted)]">
                  Productive share of available duty time a technician should hit. Default:{' '}
                  {Math.round(D.targetUtilization * 100)} percent.
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1">
                  <Wallet size={12} /> Labour rate
                  <span className="text-[var(--text-muted)]">({activeCurrency} per hour)</span>
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100000}
                  step={1}
                  value={form.labourRate}
                  onChange={setField('labourRate')}
                  disabled={!canWrite}
                  className={INPUT_CLASS}
                />
                <p className="text-[11px] text-[var(--text-muted)]">
                  Used to cost lost workshop time in the delay breakdown. Default: {D.labourRate} per hour.
                </p>
              </div>
            </div>
          </div>

          {/* Default shift */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 text-[var(--text-secondary)]">
              <Clock size={16} className="text-violet-400" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">Default shift</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-secondary)]">Shift start</label>
                <input
                  type="time"
                  value={form.shiftStart}
                  onChange={setField('shiftStart')}
                  disabled={!canWrite}
                  className={INPUT_CLASS}
                />
                <p className="text-[11px] text-[var(--text-muted)]">Default: {D.shiftDefault.start}.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--text-secondary)]">Shift end</label>
                <input
                  type="time"
                  value={form.shiftEnd}
                  onChange={setField('shiftEnd')}
                  disabled={!canWrite}
                  className={INPUT_CLASS}
                />
                <p className="text-[11px] text-[var(--text-muted)]">Default: {D.shiftDefault.end}.</p>
              </div>
            </div>
          </div>

          {/* Save bar */}
          {flash && (
            <div
              className={
                'card flex items-start gap-3 border ' +
                (flash.kind === 'success' ? 'border-emerald-800/50' : 'border-red-800/50')
              }
            >
              {flash.kind === 'success'
                ? <CheckCircle2 size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                : <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />}
              <p className={'text-sm ' + (flash.kind === 'success' ? 'text-emerald-300' : 'text-red-300')}>
                {flash.msg}
              </p>
            </div>
          )}

          {canWrite && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={onSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Save size={15} /> {saving ? 'Saving...' : 'Save settings'}
              </button>
              <button
                onClick={resetToDefaults}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] text-sm hover:border-blue-600/50 disabled:opacity-60"
              >
                <RotateCcw size={15} /> Reset to defaults
              </button>
              <span className="text-[11px] text-[var(--text-muted)]">
                Reset fills the form with engine defaults; you still need to Save to persist.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
