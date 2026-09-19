/**
 * DamageMapPanel - the "Mark damage" case tab, field-for-field against mock
 * screens M8 (bus), M9 (concrete pump / equipment) and M10 (pickup):
 *   - view chip strip per vehicle family in the mock's order (FAMILY_VIEW_ORDER)
 *   - numbered markers (1, 2, 3...) on marked regions / components
 *   - selected-area card: label, damage type . level . photo count, Edit | Remove
 *   - damage type chips (DAMAGE_TYPES) + level chips (DAMAGE_LEVELS)
 *   - close-up photos (multiple) + optional note with a live n/200 counter
 *   - "Marked areas (N)" numbered list with Edit all
 *   - "Save marked area" / "Save area and continue"
 *
 * The mocks show a rotatable, zoomable 3D model. The web has no 3D asset for
 * every fleet type, so this is the ORTHOGRAPHIC MULTI-VIEW MAPPER (the M10
 * title) - flat named views of the same vehicle - and the header says so.
 * Mobile-only chrome (Step 3 of 5, Continue to evidence) is not reproduced.
 *
 * Data: marks live in accident_damage_assessments.damage_areas (jsonb) via
 * upsertDamageMark/removeDamageMark. Marks the Flutter app recorded in
 * accidents.damage_description ({"version":2,"marks":[...]}) are READ and
 * merged in by readMarks so they appear here; the web never writes that
 * column, so a phone-only mark can be edited (the edit lands in the
 * assessment and wins on the next merge) but not removed from here.
 *
 * A case with no assessment yet has nowhere to hold a mark; the panel creates
 * a bare draft assessment silently on the FIRST mark saved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MapPin, X, Trash2, Loader2, AlertTriangle, Check, Camera, ChevronRight, Pencil, Smartphone, Info,
} from 'lucide-react'
import {
  familyForVehicleType, viewsForFamily, layoutFor, groupMarksByKey, markKey, viewLabel, numberMarks,
  markPhotoCount, severityLabel, damageTypeLabel, clampNote, canonicalView, regionLabel,
  SEVERITY_DOT_TONE,
} from '../../lib/vehicleDamageViews'
import { DAMAGE_TYPES, DAMAGE_LEVELS, DAMAGE_NOTE_MAX, canonDamageType } from '../../lib/accidentCaseVocab'
import { readMarks, saveDamageAssessment, upsertDamageMark, removeDamageMark } from '../../lib/api/accidentDamageAssessment'
import { uploadEvidenceFile } from '../../lib/api/accidentEvidence'
import { toUserMessage } from '../../lib/safeError'

const EMPTY = { assessment: null, marks: [], counts: { assessment: 0, mobile: 0 } }

/** "Dent . Minor . 2 photos" - the one-line summary the mock prints under an area. */
export function markSummary(mark) {
  const n = markPhotoCount(mark)
  const parts = [damageTypeLabel(mark?.damage_type), severityLabel(mark?.severity), `${n} photo${n === 1 ? '' : 's'}`]
  return parts.filter(Boolean).join(' · ')
}

function Chip({ active, onClick, disabled, children, tone = 'green', testId }) {
  const on = tone === 'amber'
    ? 'border-amber-500 bg-amber-900/20 text-amber-300'
    : 'border-green-500 text-green-400 bg-green-900/10'
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={!!active}
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-60 disabled:cursor-default ${
        active ? on : 'border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
      }`}
    >
      {children}
    </button>
  )
}

export default function DamageMapPanel({ accidentId, vehicleType, assetNo, elevated, onChanged }) {
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [selectedKey, setSelectedKey] = useState(null) // markKey of the area whose summary card is open
  const [editing, setEditing] = useState(null) // {view, regionKey, label, damage_type, severity, note, photo_refs, isNew, source}
  const [editAll, setEditAll] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const photoInputRef = useRef(null)

  // Family resolution goes through the SAME canonical resolver the rest of
  // the app uses (src/lib/vehicleTyreLayout.js, via familyForVehicleType), so
  // this click-surface grid always matches how the app classifies the same
  // asset elsewhere - including falling back to the asset number when the
  // incident's own vehicle_type snapshot is blank. Unknown -> generic, never
  // an invented body.
  const family = useMemo(() => familyForVehicleType(vehicleType, assetNo), [vehicleType, assetNo])
  const views = viewsForFamily(family)
  const [activeView, setActiveView] = useState(views[0])
  useEffect(() => { setActiveView(views[0]); setSelectedKey(null); setEditing(null) }, [family]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      setData((await readMarks(accidentId)) || EMPTY)
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the damage marks.'))
      setData(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [accidentId])

  useEffect(() => { load() }, [load])

  const marks = data.marks
  const assessment = data.assessment
  const assessmentAreas = useMemo(() => (Array.isArray(assessment?.damage_areas) ? assessment.damage_areas : []), [assessment])
  const marksMap = useMemo(() => groupMarksByKey(marks), [marks])
  const numbers = useMemo(() => numberMarks(marks), [marks])
  const layout = layoutFor(family, activeView)
  const selected = selectedKey ? marksMap.get(selectedKey) : null

  function labelFor(mark) {
    return mark.region_label || mark.component_label || regionLabel(family, mark.view, mark.region_key) || mark.region_key
  }

  function beginEdit(mark, fallback) {
    setEditing({
      view: mark?.view || fallback.view, // an existing mark keeps its STORED view (e.g. legacy 'overview') so an edit never duplicates it
      regionKey: mark?.region_key || fallback.regionKey,
      label: mark ? labelFor(mark) : fallback.label,
      damage_type: canonDamageType(mark?.damage_type) || DAMAGE_TYPES[0].key,
      severity: DAMAGE_LEVELS.some((l) => l.key === mark?.severity) ? mark.severity : DAMAGE_LEVELS[0].key,
      note: clampNote(mark?.note),
      photo_refs: Array.isArray(mark?.photo_refs) ? mark.photo_refs : [],
      isNew: !mark,
      source: mark?.source || null,
    })
    setSelectedKey(null)
  }

  function selectMark(mark) {
    setActiveView(canonicalView(mark.view))
    if (editAll && elevated) { beginEdit(mark); return }
    setEditing(null)
    setSelectedKey(markKey(mark.view, mark.region_key))
  }

  function clickRegion(region) {
    const existing = marksMap.get(markKey(activeView, region.key))
    if (existing) { selectMark(existing); return }
    if (!elevated) return
    beginEdit(null, { view: activeView, regionKey: region.key, label: region.label })
  }

  async function attachPhotos(e) {
    const files = Array.from(e.target.files || [])
    if (photoInputRef.current) photoInputRef.current.value = ''
    if (!files.length || !editing) return
    setPhotoUploading(true); setErr('')
    try {
      const urls = []
      for (const f of files) {
        const url = await uploadEvidenceFile(accidentId, f) // existing evidence upload, one file at a time
        if (url) urls.push(url)
      }
      setEditing((s) => (s ? { ...s, photo_refs: [...(s.photo_refs || []), ...urls] } : s))
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not attach that photo.'))
    } finally {
      setPhotoUploading(false)
    }
  }

  async function ensureAssessment() {
    if (assessment?.id) return assessment
    const created = await saveDamageAssessment(accidentId, {}, {})
    return created
  }

  async function saveMark({ andContinue = false } = {}) {
    if (!editing || saving) return
    setSaving(true); setErr('')
    try {
      const a = await ensureAssessment()
      const currentAreas = a.id === assessment?.id ? assessmentAreas : []
      const saved = await upsertDamageMark(a.id, currentAreas, {
        view: editing.view,
        region_key: editing.regionKey,
        region_label: editing.label,
        component_label: editing.label, // the Workshop Assessment tab still reads this name
        damage_type: editing.damage_type,
        severity: editing.severity,
        note: editing.note ? clampNote(editing.note) : null,
        photo_refs: editing.photo_refs || [],
      })
      const key = markKey(editing.view, editing.regionKey)
      setEditing(null)
      setSelectedKey(andContinue ? null : key)
      await load()
      if (saved && !assessment?.id) setData((d) => ({ ...d, assessment: d.assessment || saved }))
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the damage mark.'))
    } finally {
      setSaving(false)
    }
  }

  async function removeMark(mark) {
    if (!mark || saving || !assessment?.id) return
    if (mark.source === 'mobile') {
      setErr('This mark was recorded on the phone. Remove it there; here you can only edit it.')
      return
    }
    setSaving(true); setErr('')
    try {
      await removeDamageMark(assessment.id, assessmentAreas, mark.view, mark.region_key)
      setEditing(null)
      setSelectedKey(null)
      await load()
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not remove the damage mark.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading the damage map...</div>
  }

  const selectedNumber = selected ? numbers.get(markKey(selected.view, selected.region_key)) : null
  const noteLen = String(editing?.note || '').length

  return (
    <div className="p-6 space-y-6">
      <section className="card space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <MapPin size={16} /> {family === 'concrete_pump' ? 'Mark equipment damage' : 'Mark vehicle damage'}
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {assetNo ? `${assetNo} · ` : ''}{vehicleType || 'Unknown type'} · Orthographic multi-view mapper
            </p>
          </div>
          {data.counts.mobile > 0 && (
            <span className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1">
              <Smartphone size={12} /> {data.counts.mobile} mark{data.counts.mobile === 1 ? '' : 's'} recorded on the phone
            </span>
          )}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] flex items-start gap-1.5">
          <Info size={12} className="mt-0.5 shrink-0" />
          The phone shows a rotatable 3D model. On the web the same vehicle is mapped as flat named views: pick a view, then tap the area or component.
        </p>

        {/* View chip strip - every view is its own always-visible chip, in the mock's order. */}
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Views">
          {views.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={activeView === v}
              data-testid={`view-chip-${v}`}
              onClick={() => { setActiveView(v); setSelectedKey(null); setEditing(null) }}
              className={`px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
                activeView === v
                  ? 'border-green-500 text-green-400 bg-green-900/10'
                  : 'border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
              }`}
            >
              {viewLabel(v)}
            </button>
          ))}
        </div>

        <div
          data-testid="damage-surface"
          className="grid gap-1.5 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-2"
          style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, minmax(52px, 1fr))` }}
        >
          {layout.regions.map((r) => {
            const key = markKey(activeView, r.key)
            const mark = marksMap.get(key)
            const n = mark ? numbers.get(key) : null
            const isSelected = selectedKey === key || (editing && canonicalView(editing.view) === canonicalView(activeView) && editing.regionKey === r.key)
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => clickRegion(r)}
                disabled={!elevated && !mark}
                aria-label={mark ? `${n}. ${r.label}: ${markSummary(mark)}` : r.label}
                style={{ gridColumn: `${r.col[0]} / ${r.col[1]}`, gridRow: `${r.row[0]} / ${r.row[1]}` }}
                className={`relative rounded border text-[11px] px-1.5 py-1 flex items-center justify-center text-center leading-tight transition-colors disabled:cursor-default ${
                  mark
                    ? 'border-amber-500/60 bg-amber-900/10 text-amber-200'
                    : 'border-[var(--input-border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]'
                } ${isSelected ? 'ring-2 ring-green-500' : ''}`}
              >
                {mark && (
                  <span
                    data-testid={`marker-${n}`}
                    className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-black flex items-center justify-center"
                    style={{ backgroundColor: SEVERITY_DOT_TONE[mark.severity] || SEVERITY_DOT_TONE.minor }}
                  >
                    {n}
                  </span>
                )}
                {r.label}
              </button>
            )
          })}
        </div>
        {selected && (
          <p className="text-xs text-[var(--text-secondary)]" data-testid="surface-caption">
            <span className="font-semibold text-[var(--text-primary)]">{selectedNumber}. {labelFor(selected)}</span>
            <span className="text-[var(--text-muted)]"> ({viewLabel(selected.view)})</span>
          </p>
        )}
        {!elevated && <p className="text-xs text-[var(--text-muted)]">Only Admin / Manager / Director can mark damage. Marks recorded elsewhere are shown above.</p>}
        {err && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}

        {/* Selected-area card (M8 / M10): label, type . level . photos, Edit | Remove */}
        {selected && !editing && (
          <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/60 p-3 flex items-start justify-between gap-3" data-testid="selected-card">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: SEVERITY_DOT_TONE[selected.severity] || SEVERITY_DOT_TONE.minor }} />
                {labelFor(selected)}
                {selected.source === 'mobile' && <span className="text-[10px] text-[var(--text-muted)] inline-flex items-center gap-1"><Smartphone size={10} /> phone</span>}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{markSummary(selected)}</p>
              {selected.note && <p className="text-xs text-[var(--text-secondary)] mt-1">{selected.note}</p>}
              {markPhotoCount(selected) > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selected.photo_refs.map((url, i) => (
                    <img key={url + i} src={url} alt={`Close-up ${i + 1}`} className="h-12 w-12 object-cover rounded border border-[var(--input-border)]" />
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" disabled={!elevated} onClick={() => beginEdit(selected)}>
                <Pencil size={12} /> Edit
              </button>
              <button
                type="button"
                className="btn-secondary text-xs inline-flex items-center gap-1"
                disabled={!elevated || saving || selected.source === 'mobile'}
                title={selected.source === 'mobile' ? 'Recorded on the phone; remove it there' : 'Remove this mark'}
                onClick={() => removeMark(selected)}
              >
                <Trash2 size={12} /> Remove
              </button>
              <button type="button" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] ml-1" aria-label="Close" onClick={() => setSelectedKey(null)}><X size={14} /></button>
            </div>
          </div>
        )}

        {/* Area sheet (M9): Damage type chips, Level chips, close-up photos, Note 0/200, Save */}
        {editing && (
          <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/60 p-3 space-y-3" data-testid="area-sheet">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {editing.label} <span className="text-[11px] text-[var(--text-muted)]">({viewLabel(editing.view)})</span>
              </p>
              <button type="button" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Cancel" onClick={() => setEditing(null)}><X size={14} /></button>
            </div>
            <div>
              <label className="label">Damage type</label>
              <div className="flex flex-wrap gap-2 mt-1" role="group" aria-label="Damage type">
                {DAMAGE_TYPES.map((d) => (
                  <Chip key={d.key} testId={`type-chip-${d.key}`} active={editing.damage_type === d.key}
                    onClick={() => setEditing((s) => ({ ...s, damage_type: d.key }))}>
                    {d.label}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Level</label>
              <div className="flex flex-wrap gap-2 mt-1" role="group" aria-label="Level">
                {DAMAGE_LEVELS.map((l) => (
                  <Chip key={l.key} tone="amber" testId={`level-chip-${l.key}`} active={editing.severity === l.key}
                    onClick={() => setEditing((s) => ({ ...s, severity: l.key }))}>
                    {l.label}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <label className="label mb-1.5 block">Close-up photos</label>
              <div className="flex flex-wrap gap-2 items-center">
                {(editing.photo_refs || []).map((url, i) => (
                  <div key={url + i} className="relative">
                    <img src={url} alt={`Close-up ${i + 1}`} className="h-14 w-14 object-cover rounded border border-[var(--input-border)]" />
                    <button type="button" aria-label={`Remove close-up ${i + 1}`}
                      onClick={() => setEditing((s) => ({ ...s, photo_refs: s.photo_refs.filter((_, idx) => idx !== i) }))}
                      className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px]">
                      <X size={9} />
                    </button>
                  </div>
                ))}
                <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" data-testid="photo-input" onChange={attachPhotos} />
                <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" disabled={photoUploading}
                  onClick={() => photoInputRef.current?.click()}>
                  {photoUploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />} Add close-up photos
                </button>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="label" htmlFor="damage-mark-note">Note (optional)</label>
                <span className="text-[11px] text-[var(--text-muted)]" data-testid="note-counter">{noteLen}/{DAMAGE_NOTE_MAX}</span>
              </div>
              <textarea id="damage-mark-note" rows={2} className="input w-full" value={editing.note} maxLength={DAMAGE_NOTE_MAX}
                onChange={(e) => setEditing((s) => ({ ...s, note: clampNote(e.target.value) }))} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary text-xs inline-flex items-center gap-1.5" disabled={saving} onClick={() => saveMark()}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save marked area
              </button>
              <button type="button" className="btn-primary text-xs inline-flex items-center gap-1.5" disabled={saving} onClick={() => saveMark({ andContinue: true })}>
                <ChevronRight size={13} /> Save area and continue
              </button>
              {!editing.isNew && editing.source !== 'mobile' && (
                <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" disabled={saving}
                  onClick={() => removeMark(marksMap.get(markKey(editing.view, editing.regionKey)))}>
                  <Trash2 size={13} /> Remove
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Marked areas (N) - numbered list, Edit all */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-[var(--text-primary)]">Marked areas ({marks.length})</h3>
          {marks.length > 0 && elevated && (
            <button type="button" className="text-xs text-green-400 hover:underline inline-flex items-center gap-1" aria-pressed={editAll}
              onClick={() => setEditAll((v) => !v)}>
              <Pencil size={12} /> {editAll ? 'Done editing' : 'Edit all'}
            </button>
          )}
        </div>
        {marks.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No damage marked yet. Pick a view above and tap an area or component.</p>
        ) : (
          <ol className="divide-y divide-[var(--input-border)]" data-testid="marked-list">
            {marks.map((a) => {
              const key = markKey(a.view, a.region_key)
              const n = numbers.get(key)
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => selectMark(a)}
                    className={`w-full text-left px-2 py-2 flex items-center gap-3 hover:bg-[var(--input-bg)]/40 ${selectedKey === key ? 'bg-[var(--input-bg)]/60' : ''}`}
                  >
                    <span className="w-6 h-6 rounded-full text-[11px] font-bold text-black flex items-center justify-center shrink-0"
                      style={{ backgroundColor: SEVERITY_DOT_TONE[a.severity] || SEVERITY_DOT_TONE.minor }}>{n}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[var(--text-primary)] truncate">
                        {labelFor(a)} <span className="text-[11px] text-[var(--text-muted)]">({viewLabel(a.view)})</span>
                        {a.source === 'mobile' && <Smartphone size={10} className="inline ml-1 text-[var(--text-muted)]" aria-label="Recorded on the phone" />}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">{markSummary(a)}</p>
                    </div>
                    {editAll && elevated ? <Pencil size={14} className="text-[var(--text-muted)] shrink-0" /> : <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />}
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
