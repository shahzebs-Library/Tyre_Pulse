/**
 * HandoverPanel - the "Dispatch and handover" case tab, field for field the
 * owner's mock M2 (external workshop):
 *
 *   header chips  Repair route | Dispatch status | Transit elapsed | Vendor repair SLA
 *   1 Destination and vendor      (accident_repair_orders + its vendor columns)
 *   2 Dispatch details            (accident_dispatches + the legacy downtime fields)
 *   3 Vehicle handover condition  (accident_dispatches outgoing block)
 *   4 Workshop receipt            (accident_dispatches receipt block, vendor-completed)
 *   stepper 1-4, info note, inspection history, notify recipients
 *
 * Data contracts: accidentCaseVocab (stepper / live states / required receipt
 * keys), handoverGating (what "complete" means), accidentDispatch (stepper
 * derivation). SHIP-BEFORE-MIGRATE: the accident_dispatches table and the
 * vendor columns come from a migration that is NOT applied live yet, so every
 * read degrades to an honest "not provisioned" note and every blank renders
 * "Not set" - never 0, never an invented value.
 *
 * Signing and accepting ALSO writes the legacy accident_handover_inspections
 * row (decision accepted, signature in `photos` as before) so the older flow,
 * the timeline feed and the closure gate keep reading one consistent record.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Truck, PenLine, CheckCircle2, AlertTriangle, Loader2, RefreshCw, ClipboardCheck, Trash2,
  MapPin, Wrench, Check, Circle, Phone, Mail, Pencil, Info, Camera, Image as ImageIcon, FileText, Timer, Milestone,
} from 'lucide-react'
import WorkstreamHeader from './WorkstreamHeader'
import EvidenceTable from './EvidenceTable'
import NotifyRecipientsPanel from './NotifyRecipientsPanel'
import SignaturePad from '../SignaturePad'
import { listHandoverInspections, recordHandoverInspection } from '../../lib/api/accidentHandover'
import { getOpenRepairOrder, upsertRepairOrder, updateVendorDetails } from '../../lib/api/accidentRepairOrders'
import { getDowntime, saveDowntime, VEHICLE_STATUSES } from '../../lib/api/accidentDowntime'
import { getLatestDispatch, saveDispatch, acceptCustody, NOT_PROVISIONED_MESSAGE } from '../../lib/api/accidentDispatches'
import { listEvidence, uploadEvidenceFile } from '../../lib/api/accidentEvidence'
import { listSlaInstances } from '../../lib/api/accidentSla'
import { dispatchSteps } from '../../lib/accidentDispatch'
import {
  receiptMissing, canSignAndAccept, RECEIPT_FIELD_LABELS, liveStatusLabel, transitElapsedMs, vendorSlaChip,
} from '../../lib/handoverGating'
import { DISPATCH_LIVE_STATES, REPAIR_ROUTE_TILES, QUOTATION_STATES } from '../../lib/accidentCaseVocab'
import { durationLabel } from '../../lib/caseTimelineFeed'
import { safeHref, safeImageSrc } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'

// ── labels ───────────────────────────────────────────────────────────────────
const VEHICLE_STATUS_LABEL = {
  operational: 'Operational', restricted: 'Restricted', awaiting_recovery: 'Awaiting recovery',
  off_road_accident: 'Off-road (accident)', under_inspection: 'Under inspection', under_repair: 'Under repair',
  ready_for_inspection: 'Ready for inspection', rejected_after_repair: 'Rejected after repair',
  returned_to_operation: 'Returned to operation', total_loss: 'Total loss', disposed: 'Disposed',
}
const ROUTE_LABEL = {
  ...Object.fromEntries(REPAIR_ROUTE_TILES.map((t) => [t.key, t.label])),
  none: 'No repair', temporary: 'Temporary repair', insurer_approved: "Insurer's approved workshop",
  dealer: 'Dealer', specialist: 'Specialist', replacement: 'Replacement', total_loss: 'Total loss',
  disposal: 'Disposal', under_review: 'Under review',
}
const LIVE_TONE = {
  preparing: 'border-[var(--input-border)] text-[var(--text-secondary)]',
  in_transit: 'border-blue-500/60 text-blue-400 bg-blue-500/10',
  arrived: 'border-amber-500/60 text-amber-400 bg-amber-500/10',
  accepted: 'border-green-500/60 text-green-400 bg-green-500/10',
}
const CHIP_TONE = {
  neutral: 'border-[var(--input-border)] text-[var(--text-secondary)]',
  ok: 'border-green-500/60 text-green-400',
  warn: 'border-amber-500/60 text-amber-400',
  danger: 'border-red-500/60 text-red-400',
}
const STEP_STATE_LABEL = { complete: 'Complete', next: 'Next', pending: 'Pending' }

// ── small pure helpers ──────────────────────────────────────────────────────
const NOT_SET = 'Not set'
const show = (v) => (v == null || String(v).trim() === '' ? NOT_SET : String(v))
const showNum = (v, unit) => (v == null || v === '' || !Number.isFinite(Number(v)) ? NOT_SET : `${Number(v).toLocaleString()}${unit ? ` ${unit}` : ''}`)
function fmtDT(iso) {
  if (!iso) return NOT_SET
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? NOT_SET : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
/** ISO -> value for <input type="datetime-local"> in the browser's LOCAL time. */
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
/** datetime-local value -> full ISO timestamp (null when blank). */
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null)
const listToText = (arr) => (Array.isArray(arr) ? arr.join(', ') : '')
const textToList = (s) => String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean)
const numOrNull = (v) => (v === '' || v == null ? null : Number(v))
/** A phone the tel: scheme can carry: digits, plus, spaces, hyphens, parentheses only. */
const telHref = (phone) => (/^\+?[0-9 ()-]{5,20}$/.test(String(phone || '').trim()) ? `tel:${String(phone).replace(/[^0-9+]/g, '')}` : undefined)

const BLANK_VENDOR = {
  workshop_name: '', vendor_city: '', vendor_contact_name: '', vendor_contact_phone: '', vendor_contact_email: '',
  vendor_registration_no: '', vendor_inspector_name: '',
}
const BLANK_DISPATCH = {
  sent_by_name: '', departure_at: '', carrier: '', driver_name: '', recovery_vehicle: '', origin: '', destination: '',
  eta_at: '', live_status: 'preparing',
}
const BLANK_DOWNTIME = { vehicle_status: '', recovery_required: false, towing_reference: '', delivered_to_workshop_at: '', expected_return_date: '' }
const BLANK_CONDITION = {
  out_odometer_km: '', out_engine_hours: '', out_fuel_pct: '', keys_count: '', documents_sent: '', accessories: '',
  outgoing_signed_by: '', outgoing_signed_at: null, outgoing_signature: null,
}
const BLANK_RECEIPT = {
  arrived_at: '', received_by_name: '', received_by_designation: '', in_odometer_km: '', in_engine_hours: '', in_fuel_pct: '',
  condition_matches: null, additional_damage_remarks: '', receiving_photos: [], handover_paper_ref: '',
  receiver_signature: null, sender_signature: null, custody_accepted: false,
}

function dispatchToForms(d) {
  return {
    dispatch: {
      sent_by_name: d?.sent_by_name || '', departure_at: toLocalInput(d?.departure_at), carrier: d?.carrier || '',
      driver_name: d?.driver_name || '', recovery_vehicle: d?.recovery_vehicle || '', origin: d?.origin || '',
      destination: d?.destination || '', eta_at: toLocalInput(d?.eta_at), live_status: d?.live_status || 'preparing',
    },
    condition: {
      out_odometer_km: d?.out_odometer_km ?? '', out_engine_hours: d?.out_engine_hours ?? '', out_fuel_pct: d?.out_fuel_pct ?? '',
      keys_count: d?.keys_count ?? '', documents_sent: listToText(d?.documents_sent), accessories: listToText(d?.accessories),
      outgoing_signed_by: d?.outgoing_signed_by || '', outgoing_signed_at: d?.outgoing_signed_at || null,
      outgoing_signature: d?.outgoing_signature || null,
    },
    receipt: {
      arrived_at: toLocalInput(d?.arrived_at), received_by_name: d?.received_by_name || '',
      received_by_designation: d?.received_by_designation || '', in_odometer_km: d?.in_odometer_km ?? '',
      in_engine_hours: d?.in_engine_hours ?? '', in_fuel_pct: d?.in_fuel_pct ?? '',
      condition_matches: d?.condition_matches ?? null, additional_damage_remarks: d?.additional_damage_remarks || '',
      receiving_photos: Array.isArray(d?.receiving_photos) ? d.receiving_photos : [], handover_paper_ref: d?.handover_paper_ref || '',
      receiver_signature: d?.receiver_signature || null, sender_signature: d?.sender_signature || d?.outgoing_signature || null,
      custody_accepted: !!d?.custody_accepted,
    },
  }
}

/** The receipt draft in the shape handoverGating expects (ISO timestamps, lists). */
function receiptDraftToRow(r) {
  return {
    arrived_at: fromLocalInput(r.arrived_at),
    received_by_name: r.received_by_name || null,
    received_by_designation: r.received_by_designation || null,
    in_odometer_km: numOrNull(r.in_odometer_km),
    in_engine_hours: numOrNull(r.in_engine_hours),
    in_fuel_pct: numOrNull(r.in_fuel_pct),
    condition_matches: r.condition_matches,
    additional_damage_remarks: r.additional_damage_remarks || null,
    receiving_photos: r.receiving_photos || [],
    handover_paper_ref: r.handover_paper_ref || null,
    receiver_signature: r.receiver_signature || null,
    sender_signature: r.sender_signature || null,
    custody_accepted: !!r.custody_accepted,
  }
}

// ── tiny presentational pieces ──────────────────────────────────────────────
function Chip({ icon: Icon, label, value, tone = 'neutral', testId }) {
  return (
    <span data-testid={testId} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${CHIP_TONE[tone] || CHIP_TONE.neutral}`}>
      {Icon && <Icon size={12} aria-hidden="true" />}
      <span className="text-[var(--text-muted)]">{label}:</span>
      <span className="font-medium">{value}</span>
    </span>
  )
}
function Field({ label, children, required }) {
  return (
    <div>
      <label className="label">{label}{required && <span className="text-red-400 ml-0.5" aria-label="required">*</span>}</label>
      {children}
    </div>
  )
}
function Fact({ label, value, required }) {
  return (
    <div>
      <p className="text-[11px] text-[var(--text-muted)]">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</p>
      <p className={`text-sm ${value === NOT_SET ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>{value}</p>
    </div>
  )
}
function Chips({ items, noun }) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return <span className="text-sm text-[var(--text-muted)]">{NOT_SET}</span>
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {list.map((x, i) => <span key={`${x}-${i}`} className="rounded-full border border-[var(--input-border)] px-2 py-0.5 text-[11px] text-[var(--text-primary)]">{x}</span>)}
      <span className="text-[11px] text-[var(--text-muted)]">{list.length} {noun}{list.length === 1 ? '' : 's'}</span>
    </div>
  )
}
function SignatureBlock({ value, label, onClear, onCapture, canEdit }) {
  const src = safeImageSrc(value)
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {src ? (
        <img src={src} alt={label} className="h-14 rounded border border-[var(--input-border)] bg-white" />
      ) : (
        <span className="text-sm text-[var(--text-muted)]">Not captured</span>
      )}
      {canEdit && (src ? (
        <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={onClear}><Trash2 size={12} /> Clear</button>
      ) : (
        <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={onCapture}><PenLine size={13} /> Capture {label.toLowerCase()}</button>
      ))}
    </div>
  )
}
function Stepper({ steps }) {
  return (
    <ol className="flex items-start overflow-x-auto pb-1" aria-label="Dispatch progress">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-start shrink-0">
          <div className="flex flex-col items-center gap-1 min-w-[128px] px-1">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center border-2 text-xs ${
              s.state === 'complete' ? 'border-green-500 bg-green-900/30 text-green-400'
                : s.state === 'next' ? 'border-blue-500 bg-blue-900/30 text-blue-300'
                  : 'border-[var(--input-border)] text-[var(--text-muted)]'
            }`}>
              {s.state === 'complete' ? <Check size={14} /> : s.state === 'next' ? <Circle size={9} className="fill-current" /> : s.n}
            </span>
            <span className={`text-[11px] text-center leading-tight ${s.state === 'next' ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-secondary)]'}`}>{s.n} {s.label}</span>
            <span className="text-[10px] text-[var(--text-muted)] text-center">{s.at ? fmtDT(s.at) : STEP_STATE_LABEL[s.state]}</span>
            {s.at && <span className="text-[10px] text-green-400">{STEP_STATE_LABEL[s.state]}</span>}
          </div>
          {i < steps.length - 1 && <span className={`h-0.5 w-8 mt-3.5 ${s.state === 'complete' ? 'bg-green-500' : 'bg-[var(--input-border)]'}`} />}
        </li>
      ))}
    </ol>
  )
}

// ── the panel ───────────────────────────────────────────────────────────────
export default function HandoverPanel({ accidentId, elevated, acc, onChanged, workstreams = [] }) {
  const [rows, setRows] = useState(null) // handover inspections; null = loading
  const [err, setErr] = useState('')
  const [repairOrder, setRepairOrder] = useState(null)
  const [downtime, setDowntime] = useState(null)
  const [dispatch, setDispatch] = useState(null) // accident_dispatches row or null
  const [provisioned, setProvisioned] = useState(true)
  const [photoCount, setPhotoCount] = useState(null)
  const [sla, setSla] = useState([])
  const [now, setNow] = useState(() => Date.now())

  const [vendorEdit, setVendorEdit] = useState(false)
  const [vendorForm, setVendorForm] = useState(BLANK_VENDOR)
  const [vendorSaving, setVendorSaving] = useState(false)

  const [dispForm, setDispForm] = useState(BLANK_DISPATCH)
  const [dtForm, setDtForm] = useState(BLANK_DOWNTIME)
  const [dispSaving, setDispSaving] = useState(false)

  const [condForm, setCondForm] = useState(BLANK_CONDITION)
  const [condSaving, setCondSaving] = useState(false)
  const [showGallery, setShowGallery] = useState(false)

  const [rcpt, setRcpt] = useState(BLANK_RECEIPT)
  const [rcptSaving, setRcptSaving] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [uploading, setUploading] = useState('')

  const [pad, setPad] = useState(null) // 'outgoing' | 'receiver' | 'sender'

  const load = useCallback(async () => {
    setRows(null); setErr('')
    try {
      const [h, order, d, dsp, photos, slaRows] = await Promise.all([
        listHandoverInspections(accidentId),
        getOpenRepairOrder(accidentId),
        getDowntime(accidentId),
        getLatestDispatch(accidentId),
        listEvidence(accidentId, { workstreamKey: 'handover' }).catch(() => null),
        listSlaInstances(accidentId).catch(() => []),
      ])
      setRows(h)
      setRepairOrder(order || {})
      setVendorForm({
        workshop_name: order?.workshop_name || (!order ? acc?.workshop_name : '') || '',
        vendor_city: order?.vendor_city || '', vendor_contact_name: order?.vendor_contact_name || '',
        vendor_contact_phone: order?.vendor_contact_phone || '', vendor_contact_email: order?.vendor_contact_email || '',
        vendor_registration_no: order?.vendor_registration_no || '', vendor_inspector_name: order?.vendor_inspector_name || '',
      })
      setDowntime(d || {})
      setDtForm({
        vehicle_status: d?.vehicle_status || '', recovery_required: !!d?.recovery_required,
        towing_reference: d?.towing_reference || '', delivered_to_workshop_at: toLocalInput(d?.delivered_to_workshop_at),
        expected_return_date: d?.expected_return_date || '',
      })
      setDispatch(dsp.row)
      setProvisioned(dsp.provisioned)
      const f = dispatchToForms(dsp.row)
      setDispForm(f.dispatch); setCondForm(f.condition); setRcpt(f.receipt)
      setPhotoCount(photos == null ? null : photos.filter((p) => p.kind === 'photo').length + (Array.isArray(dsp.row?.outgoing_photos) ? dsp.row.outgoing_photos.length : 0))
      setSla(slaRows || [])
      setNow(Date.now())
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the dispatch and handover record.'))
      setRows([])
    }
  }, [accidentId, acc?.workshop_name])

  useEffect(() => { load() }, [load])
  // Transit elapsed ticks every minute while the vehicle is on the road.
  useEffect(() => {
    if (!dispatch?.departure_at || dispatch?.arrived_at) return undefined
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [dispatch?.departure_at, dispatch?.arrived_at])

  const canEdit = !!elevated
  const accepted = !!dispatch?.custody_accepted
  const receiptRow = useMemo(() => receiptDraftToRow(rcpt), [rcpt])
  const missing = receiptMissing(receiptRow)
  const canAccept = canSignAndAccept(receiptRow) && provisioned && canEdit && !accepted
  const steps = dispatchSteps({ dispatch, downtime, handoverRows: rows || [], repairOrder })
  const transitMs = transitElapsedMs(dispatch, now)
  const slaChip = vendorSlaChip(dispatch, sla, now)
  const routeLabel = ROUTE_LABEL[repairOrder?.repair_route] || (repairOrder?.repair_route ? repairOrder.repair_route : NOT_SET)
  const telUrl = telHref(repairOrder?.vendor_contact_phone)
  const mailUrl = repairOrder?.vendor_contact_email ? safeHref(`mailto:${String(repairOrder.vendor_contact_email).trim()}`) : undefined

  // ── writes ────────────────────────────────────────────────────────────────
  async function saveVendor(e) {
    e.preventDefault()
    if (vendorSaving) return
    setVendorSaving(true); setErr('')
    try {
      let order = repairOrder?.id ? repairOrder : null
      if (!order || (vendorForm.workshop_name && vendorForm.workshop_name !== order.workshop_name)) {
        order = await upsertRepairOrder(accidentId, {
          workshopName: vendorForm.workshop_name || undefined,
          workshopType: order?.workshop_type || (vendorForm.workshop_name ? 'external' : undefined),
        })
      }
      // Only the vendor fields that actually changed are written, so a save
      // that touched nothing but the workshop name never hits the (possibly
      // unprovisioned) vendor columns.
      const vendor = {}
      for (const k of Object.keys(BLANK_VENDOR)) {
        if (k === 'workshop_name') continue
        if ((vendorForm[k] || '') !== (order?.[k] || '')) vendor[k] = vendorForm[k]
      }
      const saved = Object.keys(vendor).length ? await updateVendorDetails(order.id, vendor) : order
      setRepairOrder({ ...order, ...saved })
      setVendorEdit(false)
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not save the vendor details.'))
    } finally {
      setVendorSaving(false)
    }
  }

  async function persistDispatch(patch) {
    const saved = await saveDispatch(accidentId, { ...patch, repair_order_id: repairOrder?.id || null }, { existingId: dispatch?.id })
    setDispatch(saved)
    const f = dispatchToForms(saved)
    setDispForm(f.dispatch); setCondForm(f.condition); setRcpt(f.receipt)
    return saved
  }

  async function saveDispatchDetails(e) {
    e.preventDefault()
    if (dispSaving) return
    setDispSaving(true); setErr('')
    try {
      const dt = await saveDowntime(accidentId, {
        vehicle_status: dtForm.vehicle_status || null,
        recovery_required: dtForm.recovery_required,
        towing_reference: dtForm.recovery_required ? (dtForm.towing_reference || null) : null,
        delivered_to_workshop_at: fromLocalInput(dtForm.delivered_to_workshop_at),
        expected_return_date: dtForm.expected_return_date || null,
      }, { existingId: downtime?.id })
      setDowntime(dt)
      if (provisioned) {
        await persistDispatch({
          sent_by_name: dispForm.sent_by_name, departure_at: fromLocalInput(dispForm.departure_at), carrier: dispForm.carrier,
          driver_name: dispForm.driver_name, recovery_vehicle: dispForm.recovery_vehicle, origin: dispForm.origin,
          destination: dispForm.destination, eta_at: fromLocalInput(dispForm.eta_at), live_status: dispForm.live_status || 'preparing',
        })
      }
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not save the dispatch details.'))
    } finally {
      setDispSaving(false)
    }
  }

  async function saveCondition(e) {
    e.preventDefault()
    if (condSaving) return
    setCondSaving(true); setErr('')
    try {
      await persistDispatch({
        out_odometer_km: numOrNull(condForm.out_odometer_km), out_engine_hours: numOrNull(condForm.out_engine_hours),
        out_fuel_pct: numOrNull(condForm.out_fuel_pct), keys_count: numOrNull(condForm.keys_count),
        documents_sent: textToList(condForm.documents_sent), accessories: textToList(condForm.accessories),
        outgoing_signed_by: condForm.outgoing_signed_by || null, outgoing_signed_at: condForm.outgoing_signed_at,
        outgoing_signature: condForm.outgoing_signature,
      })
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not save the handover condition.'))
    } finally {
      setCondSaving(false)
    }
  }

  async function onUpload(kind, e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(kind); setErr('')
    try {
      const url = await uploadEvidenceFile(accidentId, file)
      if (!url) throw new Error('The upload returned no file reference.')
      if (kind === 'photos') setRcpt((r) => ({ ...r, receiving_photos: [...(r.receiving_photos || []), url] }))
      else setRcpt((r) => ({ ...r, handover_paper_ref: url }))
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not upload that file.'))
    } finally {
      setUploading('')
    }
  }

  async function saveReceiptDraft(e) {
    e?.preventDefault?.()
    if (rcptSaving) return
    setRcptSaving(true); setErr('')
    try {
      const patch = receiptDraftToRow(rcpt)
      if (patch.arrived_at && dispatch?.live_status !== 'accepted' && dispatch?.live_status !== 'arrived') patch.live_status = 'arrived'
      await persistDispatch(patch)
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not save the workshop receipt.'))
    } finally {
      setRcptSaving(false)
    }
  }

  async function signAndAccept() {
    if (!canAccept || accepting) return
    setAccepting(true); setErr('')
    try {
      const patch = receiptDraftToRow(rcpt)
      const target = dispatch?.id ? dispatch : await persistDispatch(patch)
      const saved = await acceptCustody(target.id, patch)
      setDispatch(saved)
      const f = dispatchToForms(saved)
      setRcpt(f.receipt)
      // Keep the older flow consistent: one accepted handover inspection row.
      const inspection = await recordHandoverInspection(accidentId, {
        inspector_name: patch.received_by_name,
        decision: 'accepted',
        matches_approved_scope: patch.condition_matches !== false,
        operational_test_done: false,
        rejection_reason: null,
        remarks: patch.additional_damage_remarks,
        photos: patch.receiver_signature
          ? [{ kind: 'signature', data_url: patch.receiver_signature, signed_by: patch.received_by_name, signed_at: saved.accepted_at }]
          : [],
      })
      setRows((prev) => [inspection, ...(prev || [])])
      onChanged?.()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not sign and accept the vehicle.'))
    } finally {
      setAccepting(false)
    }
  }

  function onPadSave(dataUrl) {
    const at = new Date().toISOString()
    if (pad === 'outgoing') setCondForm((f) => ({ ...f, outgoing_signature: dataUrl, outgoing_signed_at: at }))
    if (pad === 'receiver') setRcpt((r) => ({ ...r, receiver_signature: dataUrl }))
    if (pad === 'sender') setRcpt((r) => ({ ...r, sender_signature: dataUrl }))
    setPad(null)
  }

  const errorLine = err ? (
    <p className="text-red-400 text-xs flex items-center gap-1.5" role="alert"><AlertTriangle size={12} /> {err} <button className="underline inline-flex items-center gap-1" onClick={load}><RefreshCw size={10} /> Retry</button></p>
  ) : null

  const loading = rows === null

  return (
    <div className="p-6 space-y-6">
      <WorkstreamHeader accidentId={accidentId} workstreamKey="handover" workstreams={workstreams}
        banner="Vendor SLA starts only after signed vehicle acceptance." />

      {/* header chips */}
      <div className="flex flex-wrap items-center gap-2" data-testid="handover-chips">
        <Chip icon={Milestone} label="Repair route" value={routeLabel} testId="chip-route" />
        <Chip icon={Truck} label="Dispatch status" value={liveStatusLabel(dispatch?.live_status)} tone={dispatch?.live_status === 'accepted' ? 'ok' : 'neutral'} testId="chip-status" />
        <Chip icon={Timer} label="Transit elapsed" value={transitMs == null ? NOT_SET : (durationLabel(transitMs) || '0m')} testId="chip-transit" />
        <Chip icon={Timer} label="Vendor repair SLA"
          value={slaChip.remainingMs != null ? `${slaChip.label} ${durationLabel(Math.abs(slaChip.remainingMs))}${slaChip.tone === 'danger' ? ' over' : ' remaining'}` : slaChip.label}
          tone={slaChip.tone} testId="chip-sla" />
      </div>

      {!provisioned && (
        <p className="text-xs text-amber-400 flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2" data-testid="not-provisioned">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {NOT_PROVISIONED_MESSAGE} The vendor block, the legacy dispatch fields and the inspection history below still work.
        </p>
      )}

      {loading && <div className="space-y-2 animate-pulse">{[0, 1, 2].map((i) => <div key={i} className="h-16 bg-[var(--input-bg)]/60 rounded" />)}</div>}

      {/* 1 Destination and vendor */}
      <section className="card space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><Wrench size={16} /> 1 Destination and vendor</h3>
          <div className="flex items-center gap-2">
            {canEdit && !vendorEdit && (
              <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => setVendorEdit(true)}><Pencil size={12} /> Edit vendor details</button>
            )}
            {telUrl && <a href={telUrl} className="btn-secondary text-xs inline-flex items-center gap-1.5"><Phone size={12} /> Contact workshop</a>}
            {!telUrl && mailUrl && <a href={mailUrl} className="btn-secondary text-xs inline-flex items-center gap-1.5"><Mail size={12} /> Contact workshop</a>}
          </div>
        </div>
        {vendorEdit ? (
          <form onSubmit={saveVendor} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              ['workshop_name', 'Workshop name'], ['vendor_city', 'City'], ['vendor_contact_name', 'Vendor contact name'],
              ['vendor_contact_phone', 'Phone'], ['vendor_contact_email', 'Email'], ['vendor_registration_no', 'Workshop registration / tax no.'],
              ['vendor_inspector_name', 'Assigned vendor inspector'],
            ].map(([k, label]) => (
              <Field key={k} label={label}>
                <input className="input w-full" type={k === 'vendor_contact_email' ? 'email' : 'text'} value={vendorForm[k]}
                  onChange={(e) => setVendorForm((f) => ({ ...f, [k]: e.target.value }))} />
              </Field>
            ))}
            <div className="flex items-end gap-2">
              <button type="submit" className="btn-primary text-xs" disabled={vendorSaving}>{vendorSaving ? <Loader2 size={13} className="animate-spin" /> : 'Save vendor details'}</button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setVendorEdit(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Fact label="Workshop name" value={show(repairOrder?.workshop_name)} />
            <Fact label="City" value={show(repairOrder?.vendor_city)} />
            <Fact label="Vendor contact name" value={show(repairOrder?.vendor_contact_name)} />
            <Fact label="Phone" value={show(repairOrder?.vendor_contact_phone)} />
            <Fact label="Email" value={show(repairOrder?.vendor_contact_email)} />
            <Fact label="Workshop registration / tax no." value={show(repairOrder?.vendor_registration_no)} />
            <Fact label="Assigned vendor inspector" value={repairOrder?.vendor_inspector_name ? repairOrder.vendor_inspector_name : 'Unassigned'} />
          </div>
        )}
        <p className="text-[11px] text-[var(--text-muted)]">Shared with the Workshop Assessment tab's repair order: one workshop assignment per case.</p>
      </section>

      {/* 2 Dispatch details */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><MapPin size={16} /> 2 Dispatch details</h3>
          <span data-testid="live-status-pill" className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${LIVE_TONE[dispatch?.live_status] || LIVE_TONE.preparing}`}>
            <Truck size={11} /> Live status: {liveStatusLabel(dispatch?.live_status)}
          </span>
        </div>
        {canEdit ? (
          <form onSubmit={saveDispatchDetails} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Sent by"><input className="input w-full" value={dispForm.sent_by_name} disabled={!provisioned} onChange={(e) => setDispForm((f) => ({ ...f, sent_by_name: e.target.value }))} /></Field>
              <Field label="Departure (date and time)"><input type="datetime-local" className="input w-full" value={dispForm.departure_at} disabled={!provisioned} onChange={(e) => setDispForm((f) => ({ ...f, departure_at: e.target.value }))} /></Field>
              <Field label="Carrier"><input className="input w-full" aria-label="Carrier" value={dispForm.carrier} disabled={!provisioned} onChange={(e) => setDispForm((f) => ({ ...f, carrier: e.target.value }))} /></Field>
              <Field label="Driver"><input className="input w-full" value={dispForm.driver_name} disabled={!provisioned} onChange={(e) => setDispForm((f) => ({ ...f, driver_name: e.target.value }))} /></Field>
              <Field label="Recovery vehicle"><input className="input w-full" value={dispForm.recovery_vehicle} disabled={!provisioned} onChange={(e) => setDispForm((f) => ({ ...f, recovery_vehicle: e.target.value }))} /></Field>
              <Field label="Origin"><input className="input w-full" value={dispForm.origin} disabled={!provisioned} onChange={(e) => setDispForm((f) => ({ ...f, origin: e.target.value }))} /></Field>
              <Field label="Destination"><input className="input w-full" value={dispForm.destination} disabled={!provisioned} onChange={(e) => setDispForm((f) => ({ ...f, destination: e.target.value }))} /></Field>
              <Field label="Estimated arrival"><input type="datetime-local" className="input w-full" value={dispForm.eta_at} disabled={!provisioned} onChange={(e) => setDispForm((f) => ({ ...f, eta_at: e.target.value }))} /></Field>
              <Field label="Live status">
                <select className="input w-full" value={dispForm.live_status} disabled={!provisioned || accepted} aria-label="Live status" onChange={(e) => setDispForm((f) => ({ ...f, live_status: e.target.value }))}>
                  {DISPATCH_LIVE_STATES.filter((s) => s.key !== 'accepted' || accepted).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-[var(--input-border)]">
              <Field label="Vehicle status">
                <select className="input w-full" value={dtForm.vehicle_status} onChange={(e) => setDtForm((f) => ({ ...f, vehicle_status: e.target.value }))}>
                  <option value="">Select</option>
                  {VEHICLE_STATUSES.map((v) => <option key={v} value={v}>{VEHICLE_STATUS_LABEL[v] || v}</option>)}
                </select>
              </Field>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer mt-6">
                  <input type="checkbox" className="accent-green-500" checked={dtForm.recovery_required} onChange={(e) => setDtForm((f) => ({ ...f, recovery_required: e.target.checked }))} /> Recovery / towing required
                </label>
              </div>
              <Field label="Towing reference"><input className="input w-full" value={dtForm.towing_reference} disabled={!dtForm.recovery_required} onChange={(e) => setDtForm((f) => ({ ...f, towing_reference: e.target.value }))} /></Field>
              <Field label="Delivered to workshop"><input type="datetime-local" className="input w-full" aria-label="Delivered to workshop" value={dtForm.delivered_to_workshop_at} onChange={(e) => setDtForm((f) => ({ ...f, delivered_to_workshop_at: e.target.value }))} /></Field>
              <Field label="Expected return date"><input type="date" className="input w-full" value={dtForm.expected_return_date} onChange={(e) => setDtForm((f) => ({ ...f, expected_return_date: e.target.value }))} /></Field>
            </div>
            <button type="submit" className="btn-secondary text-xs" disabled={dispSaving}>{dispSaving ? <Loader2 size={13} className="animate-spin" /> : 'Save dispatch details'}</button>
          </form>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Fact label="Sent by" value={show(dispatch?.sent_by_name)} />
            <Fact label="Departure" value={fmtDT(dispatch?.departure_at)} />
            <Fact label="Carrier" value={show(dispatch?.carrier)} />
            <Fact label="Driver" value={show(dispatch?.driver_name)} />
            <Fact label="Recovery vehicle" value={show(dispatch?.recovery_vehicle)} />
            <Fact label="Origin" value={show(dispatch?.origin)} />
            <Fact label="Destination" value={show(dispatch?.destination)} />
            <Fact label="Estimated arrival" value={fmtDT(dispatch?.eta_at)} />
            <Fact label="Live status" value={liveStatusLabel(dispatch?.live_status)} />
            <Fact label="Vehicle status" value={downtime?.vehicle_status ? (VEHICLE_STATUS_LABEL[downtime.vehicle_status] || downtime.vehicle_status) : NOT_SET} />
            <Fact label="Recovery / towing" value={downtime?.recovery_required == null ? NOT_SET : downtime.recovery_required ? `Required${downtime.towing_reference ? `: ${downtime.towing_reference}` : ''}` : 'Not required'} />
            <Fact label="Delivered to workshop" value={fmtDT(downtime?.delivered_to_workshop_at)} />
            <Fact label="Expected return date" value={show(downtime?.expected_return_date)} />
          </div>
        )}
      </section>

      {/* 3 Vehicle handover condition */}
      <section className="card space-y-4">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><ClipboardCheck size={16} /> 3 Vehicle handover condition</h3>
        {canEdit && provisioned ? (
          <form onSubmit={saveCondition} className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Odometer (km)"><input type="number" min="0" className="input w-full" value={condForm.out_odometer_km} onChange={(e) => setCondForm((f) => ({ ...f, out_odometer_km: e.target.value }))} /></Field>
              <Field label="Engine hours"><input type="number" min="0" className="input w-full" value={condForm.out_engine_hours} onChange={(e) => setCondForm((f) => ({ ...f, out_engine_hours: e.target.value }))} /></Field>
              <Field label="Fuel (%)"><input type="number" min="0" max="100" className="input w-full" value={condForm.out_fuel_pct} onChange={(e) => setCondForm((f) => ({ ...f, out_fuel_pct: e.target.value }))} /></Field>
              <Field label="Keys (count)"><input type="number" min="0" className="input w-full" value={condForm.keys_count} onChange={(e) => setCondForm((f) => ({ ...f, keys_count: e.target.value }))} /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Documents sent (comma separated)"><input className="input w-full" value={condForm.documents_sent} onChange={(e) => setCondForm((f) => ({ ...f, documents_sent: e.target.value }))} /></Field>
              <Field label="Accessories / checklist (comma separated)"><input className="input w-full" value={condForm.accessories} onChange={(e) => setCondForm((f) => ({ ...f, accessories: e.target.value }))} /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><p className="text-[11px] text-[var(--text-muted)] mb-1">Documents sent</p><Chips items={textToList(condForm.documents_sent)} noun="document" /></div>
              <div><p className="text-[11px] text-[var(--text-muted)] mb-1">Accessories / checklist</p><Chips items={textToList(condForm.accessories)} noun="item" /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Outgoing condition signed by"><input className="input w-full" value={condForm.outgoing_signed_by} onChange={(e) => setCondForm((f) => ({ ...f, outgoing_signed_by: e.target.value }))} /></Field>
              <div>
                <p className="label">Outgoing signature{condForm.outgoing_signed_at ? ` (${fmtDT(condForm.outgoing_signed_at)})` : ''}</p>
                <SignatureBlock value={condForm.outgoing_signature} label="Outgoing signature" canEdit
                  onClear={() => setCondForm((f) => ({ ...f, outgoing_signature: null, outgoing_signed_at: null }))}
                  onCapture={() => setPad('outgoing')} />
              </div>
            </div>
            <button type="submit" className="btn-secondary text-xs" disabled={condSaving}>{condSaving ? <Loader2 size={13} className="animate-spin" /> : 'Save handover condition'}</button>
          </form>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Fact label="Odometer" value={showNum(dispatch?.out_odometer_km, 'km')} />
            <Fact label="Engine hours" value={showNum(dispatch?.out_engine_hours, 'h')} />
            <Fact label="Fuel" value={showNum(dispatch?.out_fuel_pct, '%')} />
            <Fact label="Keys" value={showNum(dispatch?.keys_count)} />
            <div className="col-span-2"><p className="text-[11px] text-[var(--text-muted)] mb-1">Documents sent</p><Chips items={dispatch?.documents_sent} noun="document" /></div>
            <div className="col-span-2"><p className="text-[11px] text-[var(--text-muted)] mb-1">Accessories / checklist</p><Chips items={dispatch?.accessories} noun="item" /></div>
            <div className="col-span-2">
              <p className="text-[11px] text-[var(--text-muted)]">Outgoing condition signed by</p>
              <p className="text-sm text-[var(--text-primary)]">{show(dispatch?.outgoing_signed_by)}{dispatch?.outgoing_signed_at ? ` at ${fmtDT(dispatch.outgoing_signed_at)}` : ''}</p>
              <SignatureBlock value={dispatch?.outgoing_signature} label="Outgoing signature" canEdit={false} />
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-[var(--input-border)]">
          <p className="text-sm text-[var(--text-primary)] inline-flex items-center gap-1.5">
            <Camera size={14} /> Outgoing damage photos: <span className="font-medium" data-testid="outgoing-photo-count">{photoCount == null ? NOT_SET : `${photoCount} photo${photoCount === 1 ? '' : 's'}`}</span>
          </p>
          <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => setShowGallery((v) => !v)}>
            <ImageIcon size={12} /> {showGallery ? 'Hide gallery' : 'Open gallery'}
          </button>
        </div>
        {showGallery && <EvidenceTable accidentId={accidentId} workstreamKey="handover" elevated={canEdit} title="Outgoing damage photos" defaultKind="photo" />}
      </section>

      {/* 4 Workshop receipt */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><Truck size={16} /> 4 Workshop receipt (completed by vendor)</h3>
          {accepted && <span className="inline-flex items-center gap-1.5 text-xs text-green-400"><CheckCircle2 size={13} /> Accepted {fmtDT(dispatch.accepted_at)}</span>}
        </div>
        <p className="text-xs text-[var(--text-muted)]">Fields marked <span className="text-red-400">*</span> are required before the vehicle can be signed and accepted.</p>

        {canEdit && provisioned && !accepted ? (
          <form onSubmit={saveReceiptDraft} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Arrived date/time" required><input type="datetime-local" className="input w-full" aria-label="Arrived date/time" value={rcpt.arrived_at} onChange={(e) => setRcpt((r) => ({ ...r, arrived_at: e.target.value }))} /></Field>
              <Field label="Received by (name)" required><input className="input w-full" aria-label="Received by (name)" value={rcpt.received_by_name} onChange={(e) => setRcpt((r) => ({ ...r, received_by_name: e.target.value }))} /></Field>
              <Field label="Received by (designation)" required><input className="input w-full" aria-label="Received by (designation)" value={rcpt.received_by_designation} onChange={(e) => setRcpt((r) => ({ ...r, received_by_designation: e.target.value }))} /></Field>
              <Field label="Incoming odometer (km)"><input type="number" min="0" className="input w-full" value={rcpt.in_odometer_km} onChange={(e) => setRcpt((r) => ({ ...r, in_odometer_km: e.target.value }))} /></Field>
              <Field label="Incoming engine hours"><input type="number" min="0" className="input w-full" value={rcpt.in_engine_hours} onChange={(e) => setRcpt((r) => ({ ...r, in_engine_hours: e.target.value }))} /></Field>
              <Field label="Incoming fuel (%)"><input type="number" min="0" max="100" className="input w-full" value={rcpt.in_fuel_pct} onChange={(e) => setRcpt((r) => ({ ...r, in_fuel_pct: e.target.value }))} /></Field>
            </div>
            <div>
              <p className="label">Condition matches dispatch</p>
              <div className="flex gap-2">
                {[[true, 'Yes'], [false, 'No']].map(([v, l]) => (
                  <button key={l} type="button" onClick={() => setRcpt((r) => ({ ...r, condition_matches: v }))}
                    className={`px-3 py-1.5 rounded border text-xs ${rcpt.condition_matches === v ? (v ? 'border-green-500 text-green-400' : 'border-amber-500 text-amber-400') : 'border-[var(--input-border)] text-[var(--text-secondary)]'}`}>{l}</button>
                ))}
                {rcpt.condition_matches == null && <span className="text-xs text-[var(--text-muted)] self-center">{NOT_SET}</span>}
              </div>
            </div>
            <Field label="Additional damage / remarks"><textarea rows={2} className="input w-full" value={rcpt.additional_damage_remarks} onChange={(e) => setRcpt((r) => ({ ...r, additional_damage_remarks: e.target.value }))} /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="label">Upload receiving photos<span className="text-red-400 ml-0.5">*</span></p>
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="btn-secondary text-xs inline-flex items-center gap-1.5 cursor-pointer">
                    {uploading === 'photos' ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />} Add photo
                    <input type="file" accept="image/*" className="hidden" aria-label="Upload receiving photos" onChange={(e) => onUpload('photos', e)} />
                  </label>
                  <span className="text-xs text-[var(--text-muted)]" data-testid="receiving-photo-count">{rcpt.receiving_photos.length ? `${rcpt.receiving_photos.length} photo${rcpt.receiving_photos.length === 1 ? '' : 's'}` : 'None yet'}</span>
                </div>
              </div>
              <div>
                <p className="label">Upload signed handover paper<span className="text-red-400 ml-0.5">*</span></p>
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="btn-secondary text-xs inline-flex items-center gap-1.5 cursor-pointer">
                    {uploading === 'paper' ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Upload paper
                    <input type="file" accept="image/*,application/pdf" className="hidden" aria-label="Upload signed handover paper" onChange={(e) => onUpload('paper', e)} />
                  </label>
                  {rcpt.handover_paper_ref ? (
                    safeHref(rcpt.handover_paper_ref) ? <a href={safeHref(rcpt.handover_paper_ref)} target="_blank" rel="noopener noreferrer" className="text-xs underline text-[var(--text-secondary)]">View paper</a> : <span className="text-xs text-[var(--text-secondary)]">Attached</span>
                  ) : <span className="text-xs text-[var(--text-muted)]">None yet</span>}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="label">Vendor receiver signature<span className="text-red-400 ml-0.5">*</span></p>
                <SignatureBlock value={rcpt.receiver_signature} label="Receiver signature" canEdit
                  onClear={() => setRcpt((r) => ({ ...r, receiver_signature: null }))} onCapture={() => setPad('receiver')} />
              </div>
              <div>
                <p className="label">Sender / driver signature {rcpt.sender_signature ? '(captured)' : ''}</p>
                <SignatureBlock value={rcpt.sender_signature} label="Sender signature" canEdit
                  onClear={() => setRcpt((r) => ({ ...r, sender_signature: null }))} onCapture={() => setPad('sender')} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
              <input type="checkbox" className="accent-green-500" checked={rcpt.custody_accepted} aria-label="I accept custody of this vehicle" onChange={(e) => setRcpt((r) => ({ ...r, custody_accepted: e.target.checked }))} />
              I accept custody of this vehicle<span className="text-red-400">*</span>
            </label>
            <div className="flex items-center gap-3 flex-wrap">
              <button type="submit" className="btn-secondary text-xs" disabled={rcptSaving}>{rcptSaving ? <Loader2 size={13} className="animate-spin" /> : 'Save receipt draft'}</button>
              <button type="button" className="btn-primary text-xs inline-flex items-center gap-1.5" disabled={!canAccept || accepting} onClick={signAndAccept} data-testid="sign-accept">
                {accepting ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Sign and accept vehicle
              </button>
              {!canAccept && (
                <span className="text-xs text-[var(--text-muted)]" data-testid="accept-helper">
                  Complete all required fields to enable{missing.length ? `: ${missing.map((k) => RECEIPT_FIELD_LABELS[k] || k).join(', ')}` : ''}
                </span>
              )}
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Fact label="Arrived date/time" required value={fmtDT(dispatch?.arrived_at)} />
            <Fact label="Received by" required value={dispatch?.received_by_name ? `${dispatch.received_by_name}${dispatch.received_by_designation ? `, ${dispatch.received_by_designation}` : ''}` : NOT_SET} />
            <Fact label="Incoming odometer" value={showNum(dispatch?.in_odometer_km, 'km')} />
            <Fact label="Incoming engine hours" value={showNum(dispatch?.in_engine_hours, 'h')} />
            <Fact label="Incoming fuel" value={showNum(dispatch?.in_fuel_pct, '%')} />
            <Fact label="Condition matches dispatch" value={dispatch?.condition_matches == null ? NOT_SET : dispatch.condition_matches ? 'Yes' : 'No'} />
            <Fact label="Additional damage / remarks" value={show(dispatch?.additional_damage_remarks)} />
            <Fact label="Receiving photos" required value={Array.isArray(dispatch?.receiving_photos) && dispatch.receiving_photos.length ? `${dispatch.receiving_photos.length} photo${dispatch.receiving_photos.length === 1 ? '' : 's'}` : NOT_SET} />
            <Fact label="Signed handover paper" required value={dispatch?.handover_paper_ref ? 'Attached' : NOT_SET} />
            <div><p className="text-[11px] text-[var(--text-muted)]">Vendor receiver signature<span className="text-red-400 ml-0.5">*</span></p><SignatureBlock value={dispatch?.receiver_signature} label="Receiver signature" canEdit={false} /></div>
            <div><p className="text-[11px] text-[var(--text-muted)]">Sender / driver signature</p><SignatureBlock value={dispatch?.sender_signature || dispatch?.outgoing_signature} label="Sender signature" canEdit={false} /></div>
            <Fact label="Custody" required value={dispatch?.custody_accepted ? `Accepted ${fmtDT(dispatch.accepted_at)}` : 'Not accepted'} />
            {!canEdit && <p className="text-xs text-[var(--text-muted)] col-span-full">Only Admin / Manager / Director can complete the workshop receipt.</p>}
          </div>
        )}
        {errorLine}
      </section>

      {/* stepper */}
      <section className="card space-y-3">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><Truck size={16} /> Dispatch and handover progress</h3>
        <Stepper steps={steps} />
        <p className="text-xs text-[var(--text-secondary)] flex items-start gap-1.5 rounded border border-[var(--input-border)] px-3 py-2">
          <Info size={13} className="shrink-0 mt-0.5" />
          After acceptance, vendor can add inspection details, quotation, parts, schedule and progress in its own workspace. PO is created only after quotation review and approval.
        </p>
        {repairOrder?.quotation_status && (
          <p className="text-[11px] text-[var(--text-muted)]">Quotation status: {QUOTATION_STATES.find((q) => q.key === repairOrder.quotation_status)?.label || repairOrder.quotation_status}</p>
        )}
      </section>

      {/* inspection history (legacy accident_handover_inspections) */}
      <section className="card space-y-3">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><ClipboardCheck size={16} /> Inspection history</h3>
        {rows === null ? (
          <div className="space-y-2 animate-pulse">{[0, 1].map((i) => <div key={i} className="h-12 bg-[var(--input-bg)]/60 rounded" />)}</div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No handover inspection recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const sig = (Array.isArray(r.photos) ? r.photos : []).find((p) => p && p.kind === 'signature')
              const sigSrc = safeImageSrc(sig?.data_url)
              return (
                <div key={r.id} className="rounded-lg border border-[var(--input-border)] px-3 py-2.5 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] capitalize">{String(r.decision || '').replace(/_/g, ' ')}</p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{r.inspector_name || 'Unknown inspector'}: {fmtDT(r.inspected_at)}</p>
                    {r.remarks && <p className="text-xs text-[var(--text-secondary)] mt-1 whitespace-pre-wrap">{r.remarks}</p>}
                  </div>
                  {sigSrc && <img src={sigSrc} alt="Signature" className="h-12 rounded border border-[var(--input-border)] bg-white shrink-0" />}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="card">
        <NotifyRecipientsPanel accidentId={accidentId} workstreamKey="handover" title="Notify recipients" subject="Dispatch and handover update" />
      </section>

      {pad && (
        <SignaturePad
          label={pad === 'outgoing' ? 'Outgoing condition signature' : pad === 'receiver' ? 'Vendor receiver signature' : 'Sender / driver signature'}
          inspectorName={pad === 'outgoing' ? condForm.outgoing_signed_by : pad === 'receiver' ? rcpt.received_by_name : dispForm.driver_name}
          onSave={onPadSave}
          onClose={() => setPad(null)}
        />
      )}
    </div>
  )
}
