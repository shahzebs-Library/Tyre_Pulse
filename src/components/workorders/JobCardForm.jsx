// ─────────────────────────────────────────────────────────────────────────────
// JobCardForm.jsx - the full workshop job card editor.
//
// WHY: the ERP job-card export carries 34 mapped data columns and the old Work
// Orders form exposed 16, so two thirds of every uploaded card sat in the
// database and could not be corrected. This form is DRIVEN BY THE CATALOG in
// src/lib/jobCard.js - it iterates JOB_CARD_SECTIONS then fieldsForSection, so a
// field added to the catalog appears here automatically and the form can never
// drift from the detail read-out or the importer.
//
// Do NOT hand-list fields here. That is the defect this replaces.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  ChevronDown, ChevronRight, AlertTriangle, Info, Plus, Trash2,
  Loader2, Save, X, Lock,
} from 'lucide-react'
import {
  JOB_CARD_SECTIONS,
  fieldsForSection,
  editableFields,
  readField,
  validateJobCard,
  erpReportedCost,
  erpLineItems,
} from '../../lib/jobCard'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'

/**
 * Sections open on first render.
 *
 * `people` is OPEN even though most of it is read-only provenance, because it
 * also holds Technician and Workshop - two fields filled on almost every card.
 * Collapsing it hid them, which a test caught. If this is ever collapsed again,
 * move those two fields out first.
 */
const DEFAULT_OPEN = { identity: true, asset: true, classification: true, complaint: true, flow: true, hours: true, cost: true, people: true }

const INPUT_CLS =
  'w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50'
const LABEL_CLS = 'text-[var(--text-secondary)] text-xs mb-1 block'
const READONLY_CLS =
  'w-full px-3 py-2 bg-[var(--surface-3)] border border-[var(--border-subtle,var(--border-bright))] rounded-lg text-[var(--text-muted)] text-sm'

/**
 * A blank value must render as an EMPTY input, never "0". Number(null) is 0 and
 * 0 is finite, so the blank check has to come before any Number() call - a zero
 * in a cost or hours box reads as a measurement nobody took.
 */
function inputValue(v) {
  return v === null || v === undefined ? '' : v
}

/** A datetime-local input wants 'YYYY-MM-DDTHH:mm' and rejects a full ISO string. */
function toLocalInput(v) {
  if (!v) return ''
  const s = String(v)
  // Already in the short local shape.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (!Number.isFinite(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function JobCardForm({
  value,
  onChange,          // (key, val) => void  -- per-field, see setField below
  row = null,
  mode = 'create',
  locked = false,
  onSave,
  onCancel,
  saving = false,
  assetLookup,       // async (assetNo) => fleet row | null
  siteOptions,
  currency = '',
}) {
  const { t } = useLanguage()
  const tx = useCallback((key, fallback, vars) => {
    // The web t() takes interpolation vars, NOT a fallback string, so a missing
    // key would render blank. Detect the key coming back unresolved and use the
    // English fallback instead.
    const out = t(key, vars)
    return !out || out === key ? fallback : out
  }, [t])

  const [open, setOpen] = useState(DEFAULT_OPEN)
  const [errors, setErrors] = useState({})
  const [warnings, setWarnings] = useState([])
  const [assetMaster, setAssetMaster] = useState(null)
  const [assetErr, setAssetErr] = useState('')

  const setField = useCallback((key, val) => { onChange(key, val) }, [onChange])

  const toggle = key => setOpen(o => ({ ...o, [key]: !o[key] }))

  // ── Asset auto-fill ────────────────────────────────────────────────────────
  // Debounced, and it only ever fills a field that is currently EMPTY: never
  // overwrite something the user typed.
  const lookupTimer = useRef(null)
  const lastLooked = useRef('')
  useEffect(() => {
    const code = String(value?.asset_no || '').trim()
    if (!assetLookup || code.length < 2 || code === lastLooked.current) return
    clearTimeout(lookupTimer.current)
    lookupTimer.current = setTimeout(async () => {
      lastLooked.current = code
      try {
        setAssetErr('')
        const asset = await assetLookup(code)
        if (!asset) { setAssetMaster(null); return }   // not in the register is legitimate
        setAssetMaster(asset)
        const fill = {
          plate_no: asset.registration_no || asset.plate_no,
          asset_category: asset.vehicle_type,
          asset_description: asset.model,
          site: asset.site,
        }
        for (const [k, v] of Object.entries(fill)) {
          const current = value?.[k]
          if (v && (current === null || current === undefined || String(current).trim() === '')) setField(k, v)
        }
      } catch (e) {
        setAssetMaster(null)
        setAssetErr(toUserMessage(e, tx('workorders.jobcard.assetLookupFailed', 'Could not look up that asset.')))
      }
    }, 400)
    return () => clearTimeout(lookupTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.asset_no, assetLookup])

  // ── Parts lines ────────────────────────────────────────────────────────────
  const [partRow, setPartRow] = useState({ part_name: '', quantity: 1, unit_cost: '' })
  const parts = useMemo(
    () => (Array.isArray(value?.parts_used) ? value.parts_used : []),
    [value?.parts_used],
  )
  const partsTotal = useMemo(
    () => parts.reduce((s, p) => s + (parseFloat(p.unit_cost) || 0) * (parseInt(p.quantity, 10) || 1), 0),
    [parts],
  )
  function addPart() {
    if (!partRow.part_name.trim()) return
    setField('parts_used', [...parts, { ...partRow, unit_cost: parseFloat(partRow.unit_cost) || 0 }])
    setPartRow({ part_name: '', quantity: 1, unit_cost: '' })
  }
  function removePart(i) { setField('parts_used', parts.filter((_, idx) => idx !== i)) }

  // ── Save ───────────────────────────────────────────────────────────────────
  function handleSave() {
    const result = validateJobCard(value)
    setErrors(result.errors)
    setWarnings(result.warnings)
    if (!result.ok) {
      // Open every section that holds an error so the user can see what blocked.
      const bad = new Set(Object.keys(result.errors))
      const next = { ...open }
      for (const s of JOB_CARD_SECTIONS) {
        if (fieldsForSection(s.key).some(f => bad.has(f.key))) next[s.key] = true
      }
      setOpen(next)
      return
    }
    onSave()
  }

  // ── Per-field render ───────────────────────────────────────────────────────
  function renderField(f) {
    const err = errors[f.key]
    const raw = value?.[f.key]

    // Read-only / provenance: render the stored value as text, never an input,
    // so it can never end up in a payload.
    if (!f.editable) {
      const shown = readField(row, f.key)
      return (
        <div key={f.key}>
          <label className={LABEL_CLS}>{f.label}</label>
          <div className={READONLY_CLS}>
            {shown === null || shown === '' ? tx('workorders.jobcard.notRecorded', 'Not recorded') : String(shown)}
          </div>
          {f.hint && <span className="text-[var(--text-muted)] text-[11px] mt-1 block">{f.hint}</span>}
        </div>
      )
    }

    const common = {
      disabled: locked,
      className: `${INPUT_CLS} ${err ? 'border-red-500' : ''}`,
    }

    let control
    if (f.type === 'textarea') {
      control = (
        <textarea {...common} rows={3} value={inputValue(raw)}
          onChange={e => setField(f.key, e.target.value)} />
      )
    } else if (f.type === 'select' && f.freeSolo) {
      // A value the ERP invented must stay typeable, so this is a text input with
      // suggestions rather than a closed dropdown.
      const listId = `jc-${f.key}-list`
      control = (
        <>
          <input {...common} list={listId} value={inputValue(raw)}
            onChange={e => setField(f.key, e.target.value)} />
          <datalist id={listId}>
            {(f.options || []).map(o => <option key={o} value={o} />)}
          </datalist>
        </>
      )
    } else if (f.type === 'select') {
      control = (
        <select {...common} value={inputValue(raw)} onChange={e => setField(f.key, e.target.value)}>
          <option value="">{tx('workorders.jobcard.selectBlank', 'Select...')}</option>
          {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    } else if (f.type === 'datetime') {
      control = (
        <input {...common} type="datetime-local" value={toLocalInput(raw)}
          onChange={e => setField(f.key, e.target.value)} />
      )
    } else if (f.type === 'number' || f.type === 'hours' || f.type === 'money') {
      control = (
        <input {...common} type="number" step="any" value={inputValue(raw)}
          onChange={e => setField(f.key, e.target.value)} />
      )
    } else if (f.key === 'site' && Array.isArray(siteOptions) && siteOptions.length) {
      control = (
        <>
          <input {...common} list="jc-site-list" value={inputValue(raw)}
            onChange={e => setField(f.key, e.target.value)} />
          <datalist id="jc-site-list">
            {siteOptions.map(o => <option key={o} value={o} />)}
          </datalist>
        </>
      )
    } else {
      control = (
        <input {...common} value={inputValue(raw)} onChange={e => setField(f.key, e.target.value)} />
      )
    }

    const suffix = f.type === 'money' && currency ? ` (${currency})` : ''
    return (
      <div key={f.key} className={f.type === 'textarea' ? 'md:col-span-3' : ''}>
        <label className={LABEL_CLS}>
          {f.label}{suffix}
          {f.required && <span className="text-red-400 ml-1">*</span>}
        </label>
        {control}
        {err && <span className="text-red-400 text-[11px] mt-1 block">{err}</span>}
        {!err && f.hint && <span className="text-[var(--text-muted)] text-[11px] mt-1 block">{f.hint}</span>}
      </div>
    )
  }

  // How many fields in a section actually carry a value: shows what is still empty.
  function sectionFilled(sectionKey) {
    const fields = fieldsForSection(sectionKey)
    const filled = fields.filter(f => {
      const v = f.editable ? value?.[f.key] : readField(row, f.key)
      return v !== null && v !== undefined && String(v).trim() !== ''
    }).length
    return { filled, total: fields.length }
  }

  const erpCost = erpReportedCost(row)
  const erpTasks = erpLineItems(row)

  return (
    <div className="space-y-3">
      {locked && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">
          <Lock size={16} />
          {tx('workorders.jobcard.lockedNotice', 'This job card is locked by its approval workflow and cannot be edited.')}
        </div>
      )}

      {JOB_CARD_SECTIONS.map(section => {
        const fields = fieldsForSection(section.key)
        if (!fields.length) return null
        const { filled, total } = sectionFilled(section.key)
        const isOpen = !!open[section.key]
        return (
          <div key={section.key} className="border border-[var(--border-bright)] rounded-lg overflow-hidden">
            <button type="button" onClick={() => toggle(section.key)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] transition-colors text-left">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {isOpen ? <ChevronDown size={15} className="text-[var(--text-muted)]" /> : <ChevronRight size={15} className="text-[var(--text-muted)]" />}
                  <span className="text-[var(--text-primary)] font-semibold text-sm">{section.label}</span>
                </div>
                <p className="text-[var(--text-muted)] text-[11px] mt-0.5 ml-6">{section.hint}</p>
              </div>
              <span className="text-[var(--text-secondary)] text-xs whitespace-nowrap">
                {tx('workorders.jobcard.filledCount', `${filled} of ${total} filled`, { filled, total })}
              </span>
            </button>

            {isOpen && (
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {fields.map(renderField)}
                </div>

                {/* Asset master context: proves which machine the code resolved to. */}
                {section.key === 'asset' && (assetMaster || assetErr) && (
                  <div className="text-xs">
                    {assetErr
                      ? <span className="text-amber-400">{assetErr}</span>
                      : (
                        <span className="text-[var(--text-muted)]">
                          {tx('workorders.jobcard.assetMaster', 'Master')}: {[assetMaster.make, assetMaster.model, assetMaster.fleet_number].filter(Boolean).join(' / ') || tx('workorders.jobcard.notRecorded', 'Not recorded')}
                        </span>
                      )}
                  </div>
                )}

                {/* What each flow gap actually measures. */}
                {section.key === 'flow' && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--surface-2)] text-[11px] text-[var(--text-muted)]">
                    <Info size={13} className="mt-0.5 shrink-0" />
                    <div className="space-y-0.5">
                      <div>{tx('workorders.jobcard.flowHelp1', 'Production Out to Workshop In is a scheduling gap: the asset is down and nobody has started.')}</div>
                      <div>{tx('workorders.jobcard.flowHelp2', 'Workshop In to Workshop Out is the workshop own repair time.')}</div>
                      <div>{tx('workorders.jobcard.flowHelp3', 'Workshop Out to Production In is a release gap: repaired but not handed back.')}</div>
                    </div>
                  </div>
                )}

                {/* Parts lines drive parts_cost, which is why it is read-only above. */}
                {section.key === 'cost' && (
                  <div>
                    <label className="text-[var(--text-secondary)] text-xs mb-2 block">
                      {tx('workorders.jobcard.partsUsed', 'Parts used')}
                    </label>
                    {parts.length > 0 && (
                      <div className="space-y-1 mb-2">
                        {parts.map((p, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm text-[var(--text-primary)] bg-[var(--surface-2)] rounded px-3 py-1.5">
                            <span className="flex-1 truncate">{p.part_name}</span>
                            <span className="text-[var(--text-muted)]">x{p.quantity}</span>
                            <span className="text-[var(--text-secondary)]">{p.unit_cost}</span>
                            {!locked && (
                              <button type="button" onClick={() => removePart(i)} className="text-red-400 hover:text-red-300">
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {!locked && (
                      <div className="grid grid-cols-4 gap-2">
                        <input value={partRow.part_name} onChange={e => setPartRow(p => ({ ...p, part_name: e.target.value }))}
                          placeholder={tx('workorders.jobcard.partName', 'Part name')} className={`col-span-2 ${INPUT_CLS}`} />
                        <input type="number" min="1" value={partRow.quantity}
                          onChange={e => setPartRow(p => ({ ...p, quantity: e.target.value }))}
                          placeholder={tx('workorders.jobcard.qty', 'Qty')} className={INPUT_CLS} />
                        <div className="flex gap-1">
                          <input type="number" step="any" value={partRow.unit_cost}
                            onChange={e => setPartRow(p => ({ ...p, unit_cost: e.target.value }))}
                            placeholder={tx('workorders.jobcard.unitCost', 'Unit cost')} className={`flex-1 ${INPUT_CLS}`} />
                          <button type="button" onClick={addPart} className="px-2 rounded-lg bg-[var(--surface-3)] text-[var(--text-primary)] hover:bg-[var(--surface-2)]">
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="text-right text-sm text-green-400 font-medium mt-2">
                      {tx('workorders.jobcard.partsTotal', 'Parts total')}: {partsTotal.toFixed(2)} {currency}
                    </div>
                  </div>
                )}

                {/* The ERP figures, READ ONLY and kept apart on purpose: the expense
                    grid is the authoritative cost source, so these are never written
                    back and never added to the app cost. */}
                {section.key === 'cost' && erpCost && (
                  <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border-bright)]">
                    <div className="text-[var(--text-primary)] text-xs font-semibold mb-1">
                      {tx('workorders.jobcard.erpCostTitle', 'As reported by the ERP')}
                    </div>
                    <p className="text-[var(--text-muted)] text-[11px] mb-2">
                      {tx('workorders.jobcard.erpCostNote', 'Read only. The expense grid is the authoritative cost source, so these figures are never written back.')}
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      {[
                        ['Spare parts', erpCost.spareParts], ['Tyre', erpCost.tyre],
                        ['Oil', erpCost.oil], ['Others', erpCost.others],
                        ['Manpower', erpCost.manpower], ['Total parts', erpCost.totalParts],
                        ['Total repair', erpCost.totalRepair],
                      ].map(([label, v]) => (
                        <div key={label}>
                          <div className="text-[var(--text-muted)]">{label}</div>
                          <div className="text-[var(--text-primary)]">{v === null ? 'N/A' : `${v} ${currency}`}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* The card own task lines as the ERP recorded them. */}
                {section.key === 'complaint' && erpTasks.length > 0 && (
                  <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border-bright)]">
                    <div className="text-[var(--text-primary)] text-xs font-semibold mb-2">
                      {tx('workorders.jobcard.erpTasksTitle', 'Job card task lines (from ERP)')}
                    </div>
                    <div className="space-y-1">
                      {erpTasks.map((li, i) => (
                        <div key={i} className="text-[11px] text-[var(--text-secondary)] flex gap-2">
                          <span className="text-[var(--text-primary)]">{li.task || 'N/A'}</span>
                          {li.detail && <span className="text-[var(--text-muted)]">{li.detail}</span>}
                          {li.action && <span>{li.action}</span>}
                          {li.qty && <span className="text-[var(--text-muted)]">x{li.qty}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Warnings never block: a half-filled flow is the normal state of a real
          job card being worked over several days. */}
      {warnings.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold mb-1">
            <AlertTriangle size={14} />
            {tx('workorders.jobcard.warningsTitle', 'Worth checking, but you can still save')}
          </div>
          <ul className="list-disc list-inside text-amber-200/90 text-[11px] space-y-0.5">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-bright)]">
        <button type="button" onClick={onCancel} className="btn-secondary">
          <X size={14} className="inline mr-1" />
          {tx('workorders.jobcard.cancel', 'Cancel')}
        </button>
        <button type="button" onClick={handleSave} disabled={saving || locked} className="btn-primary">
          {saving ? <Loader2 size={14} className="inline mr-1 animate-spin" /> : <Save size={14} className="inline mr-1" />}
          {mode === 'edit'
            ? tx('workorders.jobcard.saveEdit', 'Save job card')
            : tx('workorders.jobcard.saveNew', 'Create job card')}
        </button>
      </div>
    </div>
  )
}

/** The count of editable fields this form renders. Exported for the test. */
export const JOB_CARD_FORM_FIELD_COUNT = editableFields().length
