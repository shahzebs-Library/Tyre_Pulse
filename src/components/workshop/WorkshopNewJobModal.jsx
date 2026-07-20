/**
 * WorkshopNewJobModal - create a new workshop job (work_order) straight from the
 * Workshop Live Control dashboard. Two tabs:
 *
 *  - Manual: asset_no (debounced getAssetByNo auto-fills site + shows plate /
 *    vehicle_type context, NEVER overwriting a typed value), work_type, priority,
 *    description, estimated minutes, target completion, and an optional assign-to
 *    technician. asset_no is required (honest validation).
 *  - From PM: lists preventive-maintenance programs that are due / overdue
 *    (reuses listPmPrograms). Picking one prefills the manual form (asset,
 *    work type, description) so the foreman can finish + submit. Honest empty
 *    state when there is nothing due; breakdown_callouts prefill is deliberately
 *    NOT included (kept focused - PM covers the common raise-from-schedule case).
 *
 * UI only: it collects the form and calls onCreate(values). The parent owns the
 * write (createJob -> optional assignJob -> reload). Matches the dashboard's dark
 * var(--*) theme. No fabricated data; all option lists are static vocab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, X, Car, Wrench, Clock, User, ClipboardList, AlertTriangle, RefreshCw, CalendarClock,
} from 'lucide-react'
import { getAssetByNo } from '../../lib/api/assets'
import { listPmPrograms } from '../../lib/api/pmPrograms'
import { toUserMessage } from '../../lib/safeError'

// Valid work_orders.work_type values (mirrors the Work Orders page vocab + the
// V253-widened 'Preventive Maintenance'). Kept local so this modal has no page dep.
const WORK_TYPES = [
  'Tyre Change', 'Inspection', 'Repair', 'Rotation', 'Balancing', 'Alignment',
  'Retread', 'Puncture Repair', 'Pressure Check', 'Emergency', 'Preventive Maintenance', 'Other',
]

const PRIORITIES = ['Critical', 'High', 'Medium', 'Low']

const EMPTY = {
  asset_no: '', work_type: 'Repair', priority: 'Medium', description: '',
  est_minutes: '', target_completion: '', site: '', assignee: '',
}

const inputStyle = { background: 'var(--surface-2)', borderColor: 'var(--border-dim)', color: 'var(--panel-ink)' }

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}

/** Whole days from now to an ISO date (negative = overdue). null when unparseable. */
function daysUntil(iso) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.round((t - Date.now()) / 86_400_000)
}

export default function WorkshopNewJobModal({ technicians = [], busy = false, onClose, onCreate }) {
  const [tab, setTab] = useState('manual')       // 'manual' | 'pm'
  const [form, setForm] = useState(EMPTY)
  const [master, setMaster] = useState(null)     // { registration_no, vehicle_type, make, model }
  const [looking, setLooking] = useState(false)
  const [pm, setPm] = useState({ loading: false, rows: [], error: '' })

  const siteTouched = useRef(false)
  const lookupTimer = useRef(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (lookupTimer.current) clearTimeout(lookupTimer.current)
    }
  }, [])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  // Debounced asset auto-fill: fill site (only when not typed) + show master context.
  useEffect(() => {
    const asset = form.asset_no.trim()
    if (lookupTimer.current) clearTimeout(lookupTimer.current)
    if (!asset) { setMaster(null); setLooking(false); return }
    setLooking(true)
    lookupTimer.current = setTimeout(async () => {
      try {
        const row = await getAssetByNo(asset)
        if (!mounted.current) return
        if (row) {
          setMaster({
            registration_no: row.registration_no || null,
            vehicle_type: row.vehicle_type || null,
            make: row.make || null,
            model: row.model || null,
          })
          if (row.site && !siteTouched.current) setForm((f) => (f.site ? f : { ...f, site: row.site }))
        } else {
          setMaster(null)
        }
      } catch {
        if (mounted.current) setMaster(null)
      } finally {
        if (mounted.current) setLooking(false)
      }
    }, 400)
    return () => { if (lookupTimer.current) clearTimeout(lookupTimer.current) }
  }, [form.asset_no])

  // PM-due programs (loaded when the PM tab is first opened).
  const loadPm = useCallback(async () => {
    setPm((p) => ({ ...p, loading: true, error: '' }))
    try {
      const rows = await listPmPrograms({ status: 'active' })
      if (!mounted.current) return
      const due = (rows || [])
        .filter((r) => r.next_due)
        .map((r) => ({ ...r, _days: daysUntil(r.next_due) }))
        .filter((r) => r._days == null || r._days <= 30)
        .sort((a, b) => (a._days ?? 1e9) - (b._days ?? 1e9))
      setPm({ loading: false, rows: due, error: '' })
    } catch (e) {
      if (mounted.current) setPm({ loading: false, rows: [], error: toUserMessage(e) })
    }
  }, [])

  useEffect(() => {
    if (tab === 'pm' && !pm.loading && pm.rows.length === 0 && !pm.error) loadPm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const pickPm = (row) => {
    siteTouched.current = Boolean(row.site)
    setForm((f) => ({
      ...f,
      asset_no: row.asset_no || f.asset_no,
      work_type: 'Preventive Maintenance',
      description: row.name ? `PM: ${row.name}` : f.description,
      site: row.site || f.site,
    }))
    setTab('manual')
  }

  const assetValid = form.asset_no.trim().length > 0

  const submit = (e) => {
    e.preventDefault()
    if (!assetValid || busy) return
    onCreate({
      asset_no: form.asset_no.trim(),
      work_type: form.work_type || null,
      priority: form.priority || 'Medium',
      description: form.description.trim() || null,
      est_minutes: form.est_minutes === '' ? null : Number(form.est_minutes),
      target_completion: form.target_completion || null,
      site: form.site.trim() || null,
      assignee: form.assignee || null,
    })
  }

  const masterLine = useMemo(() => {
    if (!master) return null
    const parts = [
      [master.make, master.model].filter(Boolean).join(' '),
      master.vehicle_type,
      master.registration_no ? `Plate ${master.registration_no}` : null,
    ].filter(Boolean)
    return parts.length ? parts.join(' | ') : null
  }, [master])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      role="dialog" aria-modal="true" aria-label="Create a new job"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] rounded-t-2xl sm:rounded-2xl border flex flex-col"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border-dim)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 p-4 border-b" style={{ borderColor: 'var(--border-dim)' }}>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Job
          </h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-white" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3">
          {[
            { key: 'manual', label: 'Manual', icon: ClipboardList },
            { key: 'pm', label: 'From PM', icon: CalendarClock },
          ].map((t) => {
            const Icon = t.icon
            const active = tab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5"
                style={{
                  background: active ? 'var(--surface-2)' : 'transparent',
                  borderColor: active ? 'var(--border-dim)' : 'transparent',
                  color: active ? 'var(--panel-ink)' : 'var(--text-muted)',
                }}
                aria-pressed={active}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            )
          })}
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {tab === 'manual' ? (
            <form id="new-job-form" onSubmit={submit} className="flex flex-col gap-3">
              <Field label="Asset number (required)">
                <div className="relative">
                  <Car className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    value={form.asset_no}
                    onChange={(e) => set({ asset_no: e.target.value })}
                    placeholder="Scan or type an asset number"
                    autoFocus
                    className="w-full text-sm rounded-lg pl-8 pr-8 py-2 border"
                    style={inputStyle}
                  />
                  {looking && <RefreshCw className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted animate-spin" />}
                </div>
                {masterLine && (
                  <span className="mt-1 block text-[11px] text-muted truncate">Master: {masterLine}</span>
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Work type">
                  <select value={form.work_type} onChange={(e) => set({ work_type: e.target.value })} className="w-full text-sm rounded-lg px-2 py-2 border" style={inputStyle}>
                    {WORK_TYPES.map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </Field>
                <Field label="Priority">
                  <select value={form.priority} onChange={(e) => set({ priority: e.target.value })} className="w-full text-sm rounded-lg px-2 py-2 border" style={inputStyle}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={(e) => set({ description: e.target.value })}
                  rows={2}
                  placeholder="What needs doing?"
                  className="w-full text-sm rounded-lg px-3 py-2 border resize-none"
                  style={inputStyle}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Estimated minutes">
                  <div className="relative">
                    <Clock className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      value={form.est_minutes}
                      onChange={(e) => set({ est_minutes: e.target.value.replace(/[^0-9]/g, '') })}
                      inputMode="numeric"
                      placeholder="e.g. 90"
                      className="w-full text-sm rounded-lg pl-8 pr-2 py-2 border"
                      style={inputStyle}
                    />
                  </div>
                </Field>
                <Field label="Target completion">
                  <input
                    type="datetime-local"
                    value={form.target_completion}
                    onChange={(e) => set({ target_completion: e.target.value })}
                    className="w-full text-sm rounded-lg px-2 py-2 border"
                    style={inputStyle}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Site">
                  <input
                    value={form.site}
                    onChange={(e) => { siteTouched.current = true; set({ site: e.target.value }) }}
                    placeholder="Auto-filled from asset"
                    className="w-full text-sm rounded-lg px-3 py-2 border"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Assign to (optional)">
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                    <select value={form.assignee} onChange={(e) => set({ assignee: e.target.value })} className="w-full text-sm rounded-lg pl-8 pr-2 py-2 border" style={inputStyle}>
                      <option value="">Unassigned</option>
                      {technicians.map((t) => <option key={t.userId} value={t.userId}>{t.name}</option>)}
                    </select>
                  </div>
                </Field>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted">Preventive-maintenance programs due within 30 days.</span>
                <button type="button" onClick={loadPm} disabled={pm.loading} className="text-[11px] text-muted hover:text-white inline-flex items-center gap-1 disabled:opacity-40">
                  <RefreshCw className={`w-3 h-3 ${pm.loading ? 'animate-spin' : ''}`} /> Refresh
                </button>
              </div>
              {pm.loading ? (
                <div className="text-sm text-muted text-center py-6"><RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-60" /> Loading PM schedule...</div>
              ) : pm.error ? (
                <div className="rounded-lg px-3 py-3 text-sm flex items-start gap-2" style={{ background: 'var(--surface-2)', color: 'var(--panel-ink)' }}>
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#f59e0b' }} /> {pm.error}
                </div>
              ) : pm.rows.length === 0 ? (
                <div className="text-sm text-muted text-center py-8">
                  <Wrench className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  Nothing due in the next 30 days.
                  <div className="text-[11px] mt-1">Use the Manual tab to raise any job.</div>
                </div>
              ) : (
                pm.rows.map((r) => {
                  const overdue = r._days != null && r._days < 0
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => pickPm(r)}
                      className="text-left rounded-lg px-3 py-2.5 border"
                      style={{ background: 'var(--surface-2)', borderColor: 'var(--border-dim)' }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-white font-medium truncate">{r.name || 'PM program'}</span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0" style={{ background: overdue ? 'rgba(239,68,68,0.16)' : 'rgba(245,158,11,0.16)', color: overdue ? '#ef4444' : '#f59e0b' }}>
                          {r._days == null ? 'Due' : overdue ? `${Math.abs(r._days)}d overdue` : `${r._days}d`}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted mt-0.5 truncate">
                        {[r.asset_no || 'No asset', r.site, r.next_due ? `Due ${new Date(r.next_due).toLocaleDateString()}` : null].filter(Boolean).join(' | ')}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>

        {tab === 'manual' && (
          <div className="p-3 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--border-dim)' }}>
            <span className="text-[11px] text-muted">{assetValid ? 'Ready to create.' : 'An asset number is required.'}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="btn-secondary text-sm px-3 py-2">Cancel</button>
              <button type="submit" form="new-job-form" disabled={busy || !assetValid} className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-1.5 disabled:opacity-40">
                <Plus className="w-4 h-4" /> Create job
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
