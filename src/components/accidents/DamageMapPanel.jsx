/**
 * DamageMapPanel — the "Mark vehicle/equipment damage" case tab (mockups 8-10):
 * an orthographic multi-view mapper for on-road vehicles (bus/pickup/generic -
 * rotate through Front/Left/Right/Rear and tap a panel) and a single
 * component-tapping overview for a concrete pump (tap a named part - boom
 * section, outrigger, pump unit...). The vehicle family and its region/
 * component layout come from the pure engine src/lib/vehicleDamageViews.js;
 * this file is presentation + the write path only.
 *
 * Marks live in accident_damage_assessments.damage_areas (jsonb) via the
 * already-built upsertDamageMark/removeDamageMark (accidentDamageAssessment.js,
 * step 1/9) - the SAME row the Workshop Assessment tab reads read-only, so a
 * mark made here shows up there immediately (accidentId-scoped reload).
 *
 * A case with no assessment yet has nowhere to hold a mark (the array lives
 * on one assessment row); the panel creates a bare draft assessment silently
 * on the FIRST mark saved, rather than forcing an empty save just to open
 * this tab.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  MapPin, X, Trash2, Loader2, AlertTriangle, Check, ChevronLeft, ChevronRight,
} from 'lucide-react'
import {
  familyForVehicleType, FAMILY_VIEWS, layoutFor, groupMarksByKey, markKey, viewLabel,
  MARK_SEVERITIES, SEVERITY_DOT_TONE,
} from '../../lib/vehicleDamageViews'
import { getDamageAssessment, saveDamageAssessment, upsertDamageMark, removeDamageMark } from '../../lib/api/accidentDamageAssessment'
import { DAMAGE_CONDITION_OPTS } from '../../lib/accidentVocab'
import { toUserMessage } from '../../lib/safeError'

const MARK_DAMAGE_TYPES = DAMAGE_CONDITION_OPTS.filter((v) => v !== 'N/A')

export default function DamageMapPanel({ accidentId, vehicleType, elevated, onChanged }) {
  const [assessment, setAssessment] = useState(null) // null while loading, {} when none exists yet
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null) // {view, regionKey, label, damage_type, severity, note} | null

  const family = useMemo(() => familyForVehicleType(vehicleType), [vehicleType])
  const views = FAMILY_VIEWS[family] || FAMILY_VIEWS.generic
  const [activeView, setActiveView] = useState(views[0])
  useEffect(() => { setActiveView(views[0]) }, [family]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      setAssessment((await getDamageAssessment(accidentId)) || {})
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the damage marks.'))
      setAssessment({})
    } finally {
      setLoading(false)
    }
  }, [accidentId])

  useEffect(() => { load() }, [load])

  const damageAreas = useMemo(() => (Array.isArray(assessment?.damage_areas) ? assessment.damage_areas : []), [assessment])
  const marksMap = useMemo(() => groupMarksByKey(damageAreas), [damageAreas])
  const layout = layoutFor(family, activeView)
  const viewIdx = views.indexOf(activeView)

  function openRegion(regionKey, label) {
    if (!elevated) return
    const existing = marksMap.get(markKey(activeView, regionKey))
    setEditing({
      view: activeView,
      regionKey,
      label,
      damage_type: existing?.damage_type || MARK_DAMAGE_TYPES[0],
      severity: existing?.severity || 'minor',
      note: existing?.note || '',
      isNew: !existing,
    })
  }

  async function ensureAssessmentId() {
    if (assessment?.id) return assessment.id
    const created = await saveDamageAssessment(accidentId, {}, {})
    setAssessment(created)
    return created.id
  }

  async function saveMark() {
    if (!editing || saving) return
    setSaving(true); setErr('')
    try {
      const id = await ensureAssessmentId()
      const currentAreas = id === assessment?.id ? damageAreas : []
      const saved = await upsertDamageMark(id, currentAreas, {
        view: editing.view,
        region_key: editing.regionKey,
        component_label: editing.label,
        damage_type: editing.damage_type,
        severity: editing.severity,
        note: editing.note || null,
      })
      setAssessment(saved)
      setEditing(null)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the damage mark.'))
    } finally {
      setSaving(false)
    }
  }

  async function removeMark() {
    if (!editing || saving || !assessment?.id) return
    setSaving(true); setErr('')
    try {
      const saved = await removeDamageMark(assessment.id, damageAreas, editing.view, editing.regionKey)
      setAssessment(saved)
      setEditing(null)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not remove the damage mark.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading the damage map…</div>
  }

  return (
    <div className="p-6 space-y-6">
      <section className="card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><MapPin size={16} /> Mark vehicle / equipment damage</h3>
          <span className="text-[11px] text-[var(--text-muted)]">{vehicleType || 'Unknown type'} · {family === 'concrete_pump' ? 'Component diagram' : 'Multi-view diagram'}</span>
        </div>

        {views.length > 1 && (
          <div className="flex items-center gap-2">
            <button type="button" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30"
              disabled={viewIdx <= 0} onClick={() => setActiveView(views[viewIdx - 1])}>
              <ChevronLeft size={16} />
            </button>
            <div className="flex gap-1.5 flex-1">
              {views.map((v) => (
                <button key={v} type="button" onClick={() => setActiveView(v)}
                  className={`px-2.5 py-1 rounded text-xs font-medium border ${
                    activeView === v ? 'border-green-500 text-green-400 bg-green-900/10' : 'border-[var(--input-border)] text-[var(--text-secondary)]'
                  }`}>
                  {viewLabel(v)}
                </button>
              ))}
            </div>
            <button type="button" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30"
              disabled={viewIdx >= views.length - 1} onClick={() => setActiveView(views[viewIdx + 1])}>
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        <div
          className="grid gap-1.5 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-2"
          style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, minmax(52px, 1fr))` }}
        >
          {layout.regions.map((r) => {
            const mark = marksMap.get(markKey(activeView, r.key))
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => openRegion(r.key, r.label)}
                disabled={!elevated}
                style={{ gridColumn: `${r.col[0]} / ${r.col[1]}`, gridRow: `${r.row[0]} / ${r.row[1]}` }}
                className={`relative rounded border text-[11px] px-1.5 py-1 flex items-center justify-center text-center leading-tight transition-colors disabled:cursor-default ${
                  mark
                    ? 'border-amber-500/60 bg-amber-900/10 text-amber-200'
                    : 'border-[var(--input-border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]'
                }`}
              >
                {mark && (
                  <span
                    className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: SEVERITY_DOT_TONE[mark.severity] || SEVERITY_DOT_TONE.minor }}
                  />
                )}
                {r.label}
              </button>
            )
          })}
        </div>
        {!elevated && <p className="text-xs text-[var(--text-muted)]">Only Admin / Manager / Director can mark damage. Marks recorded elsewhere are shown above.</p>}
        {err && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}

        {editing && (
          <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/60 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{editing.label} <span className="text-[11px] text-[var(--text-muted)]">({viewLabel(editing.view)})</span></p>
              <button type="button" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={() => setEditing(null)}><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Damage type</label>
                <select className="input w-full" value={editing.damage_type}
                  onChange={(e) => setEditing((s) => ({ ...s, damage_type: e.target.value }))}>
                  {MARK_DAMAGE_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Severity</label>
                <div className="flex gap-2 mt-1">
                  {MARK_SEVERITIES.map((s) => (
                    <button key={s.value} type="button" onClick={() => setEditing((v) => ({ ...v, severity: s.value }))}
                      className={`px-2.5 py-1.5 rounded border text-xs ${
                        editing.severity === s.value ? 'border-amber-500 bg-amber-900/20 text-amber-300' : 'border-[var(--input-border)] text-[var(--text-secondary)]'
                      }`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="label">Note</label>
              <textarea rows={2} className="input w-full" value={editing.note}
                onChange={(e) => setEditing((s) => ({ ...s, note: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-primary text-xs inline-flex items-center gap-1.5" disabled={saving} onClick={saveMark}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save mark
              </button>
              {!editing.isNew && (
                <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" disabled={saving} onClick={removeMark}>
                  <Trash2 size={13} /> Remove mark
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h3 className="font-semibold text-[var(--text-primary)]">Marked damage ({damageAreas.length})</h3>
        {damageAreas.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No damage marked yet - tap a region or component above.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {damageAreas.map((a, i) => (
              <button
                key={`${a.view}-${a.region_key}-${i}`}
                type="button"
                disabled={!elevated}
                onClick={() => {
                  setActiveView(a.view)
                  setEditing({
                    view: a.view, regionKey: a.region_key, label: a.component_label || a.region_key,
                    damage_type: a.damage_type || MARK_DAMAGE_TYPES[0], severity: a.severity || 'minor',
                    note: a.note || '', isNew: false,
                  })
                }}
                className="text-left rounded-lg border border-[var(--input-border)] px-3 py-2 disabled:cursor-default"
              >
                <p className="text-sm text-[var(--text-primary)] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SEVERITY_DOT_TONE[a.severity] || SEVERITY_DOT_TONE.minor }} />
                  {a.component_label || a.region_key} <span className="text-[11px] text-[var(--text-muted)]">({viewLabel(a.view)})</span>
                </p>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{a.damage_type || 'Damage'}{a.note ? ` · ${a.note}` : ''}</p>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
