/**
 * AccidentDetailModal.jsx
 *
 * Deep claims-management view for one accident (web). Tabs: Overview,
 * Claim & Responsibility, Parts & Repairs, Case Log, and the close →
 * admin-approval workflow. Backed by MIGRATIONS_V19 tables + RPCs.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  X, Save, Plus, Trash2, Send, Lock, CheckCircle2, XCircle,
  ShieldCheck, Hourglass, FileText, Wrench, MessageSquare, Briefcase, History, User, ClipboardList,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { formatCurrency } from '../lib/formatters'
import { describeAuditRow } from '../lib/auditDiff'
import { resolveStorageUrls } from '../lib/storageRefs'
import CustomFieldsPanel from './CustomFieldsPanel'

const RECOVERY_SOURCES = ['none', 'insurer', 'third_party', 'driver', 'warranty']
const RECOVERY_SOURCE_LABELS = { none: 'None', insurer: 'Insurer', third_party: 'Third Party', driver: 'Driver', warranty: 'Warranty' }
const RECOVERY_STATUSES = ['pending', 'partial', 'recovered', 'written_off']
const RECOVERY_STATUS_LABELS = { pending: 'Pending', partial: 'Partial', recovered: 'Recovered', written_off: 'Written Off' }
const RECOVERY_BADGE = {
  pending:     'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50',
  partial:     'bg-blue-900/50 text-blue-300 border border-blue-700/50',
  recovered:   'bg-green-900/50 text-green-300 border border-green-700/50',
  written_off: 'bg-red-900/50 text-red-300 border border-red-700/50',
}

const CLAIM_STATUSES = ['none', 'filed', 'approved', 'rejected', 'settled']
const CLAIM_LABELS = { none: 'No Claim', filed: 'Filed', approved: 'Approved', rejected: 'Rejected', settled: 'Settled' }
const CLAIM_BADGE = {
  none:     'bg-gray-800 text-gray-300 border border-gray-600',
  filed:    'bg-blue-900/50 text-blue-300 border border-blue-700/50',
  approved: 'bg-green-900/50 text-green-300 border border-green-700/50',
  rejected: 'bg-red-900/50 text-red-300 border border-red-700/50',
  settled:  'bg-purple-900/50 text-purple-300 border border-purple-700/50',
}

const PART_STATUSES = ['needed', 'ordered', 'received', 'fitted']
const PART_LABELS = { needed: 'Needed', ordered: 'Ordered', received: 'Received', fitted: 'Fitted' }
const PART_BADGE = {
  needed:   'bg-yellow-900/50 text-yellow-300',
  ordered:  'bg-blue-900/50 text-blue-300',
  received: 'bg-purple-900/50 text-purple-300',
  fitted:   'bg-green-900/50 text-green-300',
}

const REMARK_DOT = {
  note: 'bg-gray-500', insurance: 'bg-blue-500', repair: 'bg-orange-500',
  responsibility: 'bg-purple-500', status_change: 'bg-sky-500',
  closure_request: 'bg-yellow-500', closure_approved: 'bg-green-500', closure_rejected: 'bg-red-500',
}

function isElevated(role) {
  return ['admin', 'manager', 'director'].includes(String(role || '').toLowerCase().replace(/\s+/g, '_'))
}

const TABS = [
  { key: 'overview', label: 'Overview', icon: FileText },
  { key: 'tracker',  label: 'Tracker', icon: ClipboardList },
  { key: 'claim',    label: 'Claim & Recovery', icon: Briefcase },
  { key: 'parts',    label: 'Parts & Repairs', icon: Wrench },
  { key: 'log',      label: 'Case Log', icon: MessageSquare },
  { key: 'activity', label: 'Activity', icon: History },
  { key: 'closure',  label: 'Closure', icon: Lock },
]

export default function AccidentDetailModal({ accidentId, onClose, onChanged }) {
  const { profile } = useAuth()
  const elevated = isElevated(profile?.role)

  const [tab, setTab] = useState('overview')
  const [acc, setAcc] = useState(null)
  const [remarks, setRemarks] = useState([])
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const [a, r, p] = await Promise.all([
      supabase.from('accidents').select('*').eq('id', accidentId).single(),
      supabase.from('accident_remarks').select('*').eq('accident_id', accidentId).order('created_at', { ascending: false }),
      supabase.from('accident_parts').select('*').eq('accident_id', accidentId).order('created_at', { ascending: true }),
    ])
    if (a.error) { setErr(a.error.message); setLoading(false); return }
    setAcc(a.data)
    setRemarks(r.data ?? [])
    setParts(p.data ?? [])
    setLoading(false)
  }, [accidentId])

  useEffect(() => { load() }, [load])

  const closure = acc?.closure_status ?? 'open'
  const partsTotal = parts.reduce((s, p) => s + (Number(p.total_cost) || 0), 0)

  async function runRpc(fn, args, okMsg) {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) { setErr(error.message); return false }
    await load(); onChanged?.()
    return true
  }

  if (loading) {
    return (
      <Backdrop onClose={onClose}>
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-12 text-center text-gray-500">Loading...</div>
      </Backdrop>
    )
  }
  if (!acc) {
    return (
      <Backdrop onClose={onClose}>
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-12 text-center text-red-400">{err || 'Not found'}</div>
      </Backdrop>
    )
  }

  return (
    <Backdrop onClose={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl my-4 flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3 min-w-0">
            <AlertCircleHeaderIcon />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-white truncate">
                {acc.asset_no || 'Accident'} <span className="text-gray-500 font-normal">· #{String(acc.id).slice(0, 8).toUpperCase()}</span>
              </h2>
              <p className="text-xs text-gray-500">{acc.site || '-'} · {acc.incident_date ? new Date(acc.incident_date).toLocaleDateString() : '-'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ClosureBadge closure={closure} />
            <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 border-b border-gray-800 overflow-x-auto">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-2.5 text-sm font-medium flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap transition-colors ${
                tab === key ? 'border-green-500 text-green-400' : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {err && <div className="mx-6 mt-4 bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 text-sm">{err}</div>}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'overview'  && <OverviewTab acc={acc} />}
          {tab === 'tracker'   && <TrackerTab acc={acc} elevated={elevated} onSaved={() => { load(); onChanged?.() }} setErr={setErr} />}
          {tab === 'claim'     && <ClaimTab acc={acc} elevated={elevated} onSaved={() => { load(); onChanged?.() }} setErr={setErr} />}
          {tab === 'parts'     && <PartsTab acc={acc} parts={parts} partsTotal={partsTotal} elevated={elevated} profile={profile} reload={() => { load(); onChanged?.() }} setErr={setErr} />}
          {tab === 'log'       && <LogTab acc={acc} remarks={remarks} profile={profile} reload={load} setErr={setErr} />}
          {tab === 'activity'  && <ActivityTab accidentId={acc.id} />}
          {tab === 'closure'   && (
            <ClosureTab
              acc={acc} closure={closure} elevated={elevated} busy={busy}
              onRequest={(note) => runRpc('request_accident_closure', { p_accident_id: acc.id, p_note: note || null })}
              onApprove={() => runRpc('approve_accident_closure', { p_accident_id: acc.id })}
              onReject={(reason) => runRpc('reject_accident_closure', { p_accident_id: acc.id, p_reason: reason || null })}
            />
          )}
        </div>
      </div>
    </Backdrop>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function OverviewTab({ acc }) {
  const photos = Array.isArray(acc.photos) ? acc.photos.filter(Boolean) : []
  const [resolvedPhotos, setResolvedPhotos] = useState([])

  useEffect(() => {
    let mounted = true
    resolveStorageUrls(photos).then(urls => {
      if (mounted) setResolvedPhotos(urls)
    })
    return () => { mounted = false }
  }, [JSON.stringify(photos)])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KV label="Severity" value={acc.severity} />
        <KV label="Status" value={acc.status} />
        <KV label="Country" value={acc.country} />
        <KV label="Repair cost" value={acc.repair_cost != null ? formatCurrency(acc.repair_cost) : '-'} />
        <KV label="Parts cost" value={acc.parts_cost != null ? formatCurrency(acc.parts_cost) : '-'} />
        <KV label="Insurance claim no" value={acc.insurance_claim_no} />
        <KV label="Inspector" value={acc.inspector} />
        <KV label="Reported" value={acc.created_at ? new Date(acc.created_at).toLocaleString() : '-'} />
      </div>
      {acc.description && (
        <div>
          <p className="label">Description</p>
          <p className="text-sm text-gray-300 leading-relaxed mt-1">{acc.description}</p>
        </div>
      )}
      {resolvedPhotos.length > 0 && (
        <div>
          <p className="label mb-2">Photos ({resolvedPhotos.length})</p>
          <div className="flex flex-wrap gap-2">
            {resolvedPhotos.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer">
                <img src={src} alt={`Photo ${i + 1}`} className="h-20 w-20 object-cover rounded border border-gray-700 hover:border-green-500 transition-colors" />
              </a>
            ))}
          </div>
        </div>
      )}
      <CustomFieldsPanel data={acc.custom_data} title="Additional imported fields" />
    </div>
  )
}

function TrackerTab({ acc, elevated, onSaved, setErr }) {
  const [f, setF] = useState({
    location: acc.location ?? '',
    liable_party: acc.liable_party ?? '',
    case_stage: acc.case_stage ?? '',
    damage_condition: acc.damage_condition ?? '',
    current_status: acc.current_status ?? '',
    action_to_be_taken: acc.action_to_be_taken ?? '',
    responsible_owner: acc.responsible_owner ?? '',
    required_action: acc.required_action ?? '',
    status_update_date: acc.status_update_date ?? '',
    status_update_note: acc.status_update_note ?? '',
    expected_release_date: acc.expected_release_date ?? '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  async function save() {
    setSaving(true); setErr('')
    const { error } = await supabase.from('accidents').update({
      location: f.location || null,
      liable_party: f.liable_party || null,
      case_stage: f.case_stage || null,
      damage_condition: f.damage_condition || null,
      current_status: f.current_status || null,
      action_to_be_taken: f.action_to_be_taken || null,
      responsible_owner: f.responsible_owner || null,
      required_action: f.required_action || null,
      status_update_date: f.status_update_date || null,
      status_update_note: f.status_update_note || null,
      expected_release_date: f.expected_release_date || null,
    }).eq('id', acc.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  if (!elevated) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <KV label="Location" value={acc.location} />
          <KV label="Liability" value={acc.liable_party} highlight />
          <KV label="Case stage" value={acc.case_stage} />
          <KV label="Damage condition" value={acc.damage_condition} />
          <KV label="Current status" value={acc.current_status} highlight />
          <KV label="Action to be taken" value={acc.action_to_be_taken} />
          <KV label="Responsible owner" value={acc.responsible_owner} />
          <KV label="Required action" value={acc.required_action} />
          <KV label="Status update" value={acc.status_update_date} />
          <KV label="Expected release" value={acc.expected_release_date} />
        </div>
        {acc.status_update_note && <KV label="Status update note" value={acc.status_update_note} />}
        <p className="text-xs text-gray-600">Only Admin / Manager / Director can edit tracker details.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Inp label="Location" value={f.location} onChange={v => set('location', v)} placeholder="e.g. GCC Plant" />
        <Inp label="Liability" value={f.liable_party} onChange={v => set('liable_party', v)} placeholder="e.g. 100% Third Party Liability" />
        <Inp label="Case stage" value={f.case_stage} onChange={v => set('case_stage', v)} placeholder="e.g. Internal Report Preparation" />
        <Inp label="Damage condition" value={f.damage_condition} onChange={v => set('damage_condition', v)} placeholder="Minor / Major Repair" />
        <Inp label="Current status" value={f.current_status} onChange={v => set('current_status', v)} placeholder="e.g. Under Repair" />
        <Inp label="Responsible owner" value={f.responsible_owner} onChange={v => set('responsible_owner', v)} placeholder="Accountable person" />
      </div>
      <Inp label="Action to be taken" value={f.action_to_be_taken} onChange={v => set('action_to_be_taken', v)} placeholder="Next step" />
      <Inp label="Required action / progress" value={f.required_action} onChange={v => set('required_action', v)} placeholder="Latest progress note" />
      <div className="grid grid-cols-2 gap-3">
        <Inp label="Status update date" type="date" value={f.status_update_date} onChange={v => set('status_update_date', v)} />
        <Inp label="Expected release date" type="date" value={f.expected_release_date} onChange={v => set('expected_release_date', v)} />
      </div>
      <Inp label="Status update note" value={f.status_update_note} onChange={v => set('status_update_note', v)} placeholder="Optional note for this update" />
      <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
        <Save size={16} /> {saving ? 'Saving...' : 'Save Tracker'}
      </button>
    </div>
  )
}

function ClaimTab({ acc, elevated, onSaved, setErr }) {
  const [f, setF] = useState({
    responsible_party: acc.responsible_party ?? '',
    liable_party: acc.liable_party ?? '',
    payer: acc.payer ?? '',
    driver_name: acc.driver_name ?? '',
    insurer: acc.insurer ?? '',
    policy_no: acc.policy_no ?? '',
    claim_status: acc.claim_status ?? 'none',
    claim_amount: acc.claim_amount ?? '',
    claim_approved_amount: acc.claim_approved_amount ?? '',
    deductible: acc.deductible ?? '',
    recovered_amount: acc.recovered_amount ?? '',
    recovery_date: acc.recovery_date ?? '',
    recovery_source: acc.recovery_source ?? 'none',
    recovery_status: acc.recovery_status ?? 'pending',
    recovery_reference: acc.recovery_reference ?? '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const grossCost = (Number(acc.repair_cost) || 0) + (Number(acc.parts_cost) || 0)
  const netCost = Math.max(0, grossCost - (Number(acc.recovered_amount) || 0))

  async function save() {
    setSaving(true); setErr('')
    const { error } = await supabase.from('accidents').update({
      responsible_party: f.responsible_party || null,
      liable_party: f.liable_party || null,
      payer: f.payer || null,
      driver_name: f.driver_name || null,
      insurer: f.insurer || null,
      policy_no: f.policy_no || null,
      claim_status: f.claim_status,
      claim_amount: f.claim_amount !== '' ? Number(f.claim_amount) : null,
      claim_approved_amount: f.claim_approved_amount !== '' ? Number(f.claim_approved_amount) : null,
      deductible: f.deductible !== '' ? Number(f.deductible) : null,
      recovered_amount: f.recovered_amount !== '' ? Number(f.recovered_amount) : null,
      recovery_date: f.recovery_date || null,
      recovery_source: f.recovery_source,
      recovery_status: f.recovery_status,
      recovery_reference: f.recovery_reference || null,
    }).eq('id', acc.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  const NetCostCard = () => (
    <div className="grid grid-cols-3 gap-3 rounded-lg border border-gray-700 bg-gray-800/40 p-3">
      <div><p className="text-[11px] uppercase tracking-wide text-gray-500">Gross cost</p><p className="text-sm font-semibold text-gray-200">{formatCurrency(grossCost)}</p></div>
      <div><p className="text-[11px] uppercase tracking-wide text-gray-500">Recovered</p><p className="text-sm font-semibold text-green-400">{formatCurrency(Number(acc.recovered_amount) || 0)}</p></div>
      <div><p className="text-[11px] uppercase tracking-wide text-gray-500">Net cost</p><p className="text-sm font-semibold text-orange-400">{formatCurrency(netCost)}</p></div>
    </div>
  )

  if (!elevated) {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <span className={`badge text-xs ${CLAIM_BADGE[acc.claim_status ?? 'none']}`}>{CLAIM_LABELS[acc.claim_status ?? 'none']}</span>
          <span className={`badge text-xs ${RECOVERY_BADGE[acc.recovery_status ?? 'pending']}`}>Recovery: {RECOVERY_STATUS_LABELS[acc.recovery_status ?? 'pending']}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <KV label="Responsible party" value={acc.responsible_party} />
          <KV label="Liable party" value={acc.liable_party} />
          <KV label="Who pays" value={acc.payer} highlight />
          <KV label="Driver" value={acc.driver_name} />
          <KV label="Insurer" value={acc.insurer} />
          <KV label="Policy / Claim no" value={acc.policy_no} />
          <KV label="Claim amount" value={acc.claim_amount != null ? formatCurrency(acc.claim_amount) : '-'} />
          <KV label="Approved" value={acc.claim_approved_amount != null ? formatCurrency(acc.claim_approved_amount) : '-'} />
          <KV label="Deductible" value={acc.deductible != null ? formatCurrency(acc.deductible) : '-'} />
          <KV label="Recovered amount" value={acc.recovered_amount != null ? formatCurrency(acc.recovered_amount) : '-'} highlight />
          <KV label="Recovery source" value={RECOVERY_SOURCE_LABELS[acc.recovery_source ?? 'none']} />
          <KV label="Recovery date" value={acc.recovery_date} />
        </div>
        <NetCostCard />
        <p className="text-xs text-gray-600">Only Admin / Manager / Director can edit claim & recovery details.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Inp label="Responsible party" value={f.responsible_party} onChange={v => set('responsible_party', v)} placeholder="Who is at fault" />
        <Inp label="Liable party" value={f.liable_party} onChange={v => set('liable_party', v)} />
        <Inp label="Who pays" value={f.payer} onChange={v => set('payer', v)} placeholder="Payer" />
        <Inp label="Driver" value={f.driver_name} onChange={v => set('driver_name', v)} />
        <Inp label="Insurer" value={f.insurer} onChange={v => set('insurer', v)} />
        <Inp label="Policy / Claim no" value={f.policy_no} onChange={v => set('policy_no', v)} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">Claim status</label>
          <select className="input" value={f.claim_status} onChange={e => set('claim_status', e.target.value)}>
            {CLAIM_STATUSES.map(s => <option key={s} value={s}>{CLAIM_LABELS[s]}</option>)}
          </select>
        </div>
        <Inp label="Claim amount" type="number" value={f.claim_amount} onChange={v => set('claim_amount', v)} />
        <Inp label="Approved amount" type="number" value={f.claim_approved_amount} onChange={v => set('claim_approved_amount', v)} />
      </div>

      <div className="border-t border-gray-800 pt-3">
        <p className="text-xs font-semibold text-gray-400 mb-2">Cost Recovery</p>
        <div className="grid grid-cols-3 gap-3">
          <Inp label="Deductible" type="number" value={f.deductible} onChange={v => set('deductible', v)} />
          <Inp label="Recovered amount" type="number" value={f.recovered_amount} onChange={v => set('recovered_amount', v)} />
          <Inp label="Recovery date" type="date" value={f.recovery_date} onChange={v => set('recovery_date', v)} />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div>
            <label className="label">Recovery source</label>
            <select className="input" value={f.recovery_source} onChange={e => set('recovery_source', e.target.value)}>
              {RECOVERY_SOURCES.map(s => <option key={s} value={s}>{RECOVERY_SOURCE_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Recovery status</label>
            <select className="input" value={f.recovery_status} onChange={e => set('recovery_status', e.target.value)}>
              {RECOVERY_STATUSES.map(s => <option key={s} value={s}>{RECOVERY_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <Inp label="Recovery reference" value={f.recovery_reference} onChange={v => set('recovery_reference', v)} />
        </div>
      </div>

      <NetCostCard />
      <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
        <Save size={16} /> {saving ? 'Saving...' : 'Save Claim & Recovery'}
      </button>
    </div>
  )
}

function ActivityTab({ accidentId }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.rpc('get_accident_audit', { p_accident_id: accidentId })
      if (cancelled) return
      if (error) setErr(error.message)
      else setRows(data ?? [])
    })()
    return () => { cancelled = true }
  }, [accidentId])

  if (err) return <p className="text-sm text-red-400">{err}</p>
  if (rows === null) return <p className="text-sm text-gray-500">Loading activity...</p>
  if (rows.length === 0) return <p className="text-sm text-gray-500">No changes recorded yet.</p>

  return (
    <div className="space-y-3">
      {rows.map(row => {
        const d = describeAuditRow(row)
        return (
          <div key={row.id} className="flex gap-3">
            <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0 bg-green-500" />
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-gray-200 font-medium">{d.title}</p>
                <span className="text-[11px] text-gray-500 whitespace-nowrap">{new Date(row.changed_at).toLocaleString()}</span>
              </div>
              <p className="text-[11px] text-gray-500 flex items-center gap-1"><User size={10} /> {row.actor_name}</p>
              {d.summary && <p className="text-xs text-gray-400 mt-1">{d.summary}</p>}
              {d.lines.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {d.lines.map((l, i) => (
                    <li key={i} className="text-xs text-gray-400">
                      <span className="text-gray-500">{l.label}:</span> <span className="text-red-300/80 line-through">{l.from}</span> <span className="text-gray-600">→</span> <span className="text-green-300">{l.to}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PartsTab({ acc, parts, partsTotal, elevated, profile, reload, setErr }) {
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ part_name: '', part_number: '', quantity: '1', unit_cost: '', supplier: '', status: 'needed' })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  async function add() {
    if (!f.part_name.trim()) { setErr('Enter a part name.'); return }
    setSaving(true); setErr('')
    const { error } = await supabase.from('accident_parts').insert({
      accident_id: acc.id,
      part_name: f.part_name.trim(),
      part_number: f.part_number.trim() || null,
      quantity: Number(f.quantity) || 1,
      unit_cost: Number(f.unit_cost) || 0,
      supplier: f.supplier.trim() || null,
      status: f.status,
      created_by: profile?.id ?? null,
    })
    setSaving(false)
    if (error) { setErr(error.message); return }
    setF({ part_name: '', part_number: '', quantity: '1', unit_cost: '', supplier: '', status: 'needed' })
    setAdding(false); reload()
  }

  async function remove(id) {
    if (!window.confirm('Remove this part?')) return
    const { error } = await supabase.from('accident_parts').delete().eq('id', id)
    if (error) { setErr(error.message); return }
    reload()
  }

  return (
    <div className="space-y-3">
      {parts.length === 0 ? (
        <p className="text-sm text-gray-500">No parts recorded yet.</p>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="table-header">Part</th><th className="table-header">Qty</th>
              <th className="table-header">Unit</th><th className="table-header">Total</th>
              <th className="table-header">Status</th>{elevated && <th className="table-header"></th>}
            </tr></thead>
            <tbody>
              {parts.map(p => (
                <tr key={p.id} className="border-t border-gray-800">
                  <td className="table-cell">
                    <div className="font-medium text-white">{p.part_name}</div>
                    <div className="text-xs text-gray-500">{[p.part_number && `#${p.part_number}`, p.supplier].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="table-cell">{Number(p.quantity)}</td>
                  <td className="table-cell whitespace-nowrap">{formatCurrency(p.unit_cost)}</td>
                  <td className="table-cell whitespace-nowrap font-semibold text-white">{formatCurrency(p.total_cost)}</td>
                  <td className="table-cell"><span className={`badge text-xs ${PART_BADGE[p.status]}`}>{PART_LABELS[p.status]}</span></td>
                  {elevated && (
                    <td className="table-cell">
                      <button onClick={() => remove(p.id)} className="text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              ))}
              <tr className="border-t border-gray-700 bg-gray-800/30">
                <td className="table-cell font-semibold text-gray-300" colSpan={3}>Total parts cost</td>
                <td className="table-cell font-bold text-green-400 whitespace-nowrap">{formatCurrency(partsTotal)}</td>
                <td className="table-cell" colSpan={elevated ? 2 : 1}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {elevated && (adding ? (
        <div className="card space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Part name *" value={f.part_name} onChange={v => set('part_name', v)} placeholder="e.g. Front bumper" />
            <Inp label="Part number" value={f.part_number} onChange={v => set('part_number', v)} />
            <Inp label="Supplier" value={f.supplier} onChange={v => set('supplier', v)} />
            <div>
              <label className="label">Status</label>
              <select className="input" value={f.status} onChange={e => set('status', e.target.value)}>
                {PART_STATUSES.map(s => <option key={s} value={s}>{PART_LABELS[s]}</option>)}
              </select>
            </div>
            <Inp label="Quantity" type="number" value={f.quantity} onChange={v => set('quantity', v)} />
            <Inp label="Unit cost" type="number" value={f.unit_cost} onChange={v => set('unit_cost', v)} />
          </div>
          <div className="flex gap-2">
            <button onClick={add} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50"><Plus size={16} /> {saving ? 'Adding...' : 'Add Part'}</button>
            <button onClick={() => setAdding(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="btn-secondary flex items-center gap-2"><Plus size={16} /> Add Part</button>
      ))}
    </div>
  )
}

function LogTab({ acc, remarks, profile, reload, setErr }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function add() {
    if (!text.trim()) return
    setSending(true); setErr('')
    const { error } = await supabase.from('accident_remarks').insert({
      accident_id: acc.id,
      author_id: profile?.id ?? null,
      author_name: profile?.full_name || profile?.username || 'User',
      remark: text.trim(),
      remark_type: 'note',
    })
    setSending(false)
    if (error) { setErr(error.message); return }
    setText(''); reload()
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Add an update (e.g. insurance rejected claim)..."
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
        />
        <button onClick={add} disabled={!text.trim() || sending} className="btn-primary flex items-center gap-2 disabled:opacity-40"><Send size={15} /> Add</button>
      </div>
      {remarks.length === 0 ? (
        <p className="text-sm text-gray-500">No log entries yet.</p>
      ) : (
        <div className="space-y-3">
          {remarks.map(r => (
            <div key={r.id} className="flex gap-3">
              <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${REMARK_DOT[r.remark_type] || 'bg-gray-500'}`} />
              <div className="flex-1">
                <p className="text-sm text-gray-200 leading-snug">{r.remark}</p>
                <p className="text-xs text-gray-500 mt-0.5">{r.author_name || 'User'} · {new Date(r.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ClosureTab({ acc, closure, elevated, busy, onRequest, onApprove, onReject }) {
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')

  if (closure === 'closed') {
    return (
      <div className="bg-green-900/20 border border-green-700/50 rounded-xl p-5 flex items-start gap-3">
        <ShieldCheck size={22} className="text-green-400 mt-0.5" />
        <div>
          <p className="text-green-300 font-semibold">Closed & approved</p>
          {acc.closure_approved_at && <p className="text-sm text-gray-400 mt-1">Approved {new Date(acc.closure_approved_at).toLocaleString()}</p>}
        </div>
      </div>
    )
  }

  if (closure === 'pending_closure') {
    return (
      <div className="space-y-4">
        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-5 flex items-start gap-3">
          <Hourglass size={22} className="text-yellow-400 mt-0.5" />
          <div>
            <p className="text-yellow-300 font-semibold">Awaiting admin approval</p>
            {acc.close_request_note && <p className="text-sm text-gray-400 mt-1">“{acc.close_request_note}”</p>}
            {acc.close_requested_at && <p className="text-xs text-gray-500 mt-1">Requested {new Date(acc.close_requested_at).toLocaleString()}</p>}
          </div>
        </div>
        {elevated ? (
          <div className="space-y-3">
            <button onClick={onApprove} disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
              <CheckCircle2 size={16} /> Approve Closure
            </button>
            <div className="card space-y-2">
              <label className="label">Rejection reason</label>
              <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="What still needs to be done" />
              <button onClick={() => onReject(reason)} disabled={busy} className="flex items-center justify-center gap-2 w-full rounded-lg border border-red-700/60 text-red-300 hover:bg-red-900/30 py-2 text-sm font-medium disabled:opacity-50">
                <XCircle size={16} /> Reject Closure
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">An Admin / Manager / Director will review and approve this closure.</p>
        )}
      </div>
    )
  }

  // open
  return (
    <div className="space-y-3">
      {acc.closure_rejected_reason && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-2 text-sm text-red-300">
          Previous closure rejected: {acc.closure_rejected_reason}
        </div>
      )}
      <label className="label">Closing note (optional)</label>
      <textarea className="input" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Repairs complete, claim settled" />
      <button onClick={() => onRequest(note)} disabled={busy} className="btn-primary flex items-center gap-2 disabled:opacity-50">
        <Lock size={16} /> Request Closure
      </button>
      <p className="text-xs text-gray-600">Submitting notifies every Admin / Manager / Director to review and approve.</p>
    </div>
  )
}

// ── Small UI helpers ────────────────────────────────────────────────────────────

function Backdrop({ children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={onClose}>
      {children}
    </div>
  )
}

function KV({ label, value, highlight }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{label}</p>
      <p className={`text-sm font-medium mt-0.5 ${highlight && value ? 'text-green-400' : 'text-gray-200'}`}>{value || '-'}</p>
    </div>
  )
}

function Inp({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type={type} className="input" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

function ClosureBadge({ closure }) {
  const map = {
    open:            { cls: 'bg-gray-800 text-gray-300 border border-gray-600', label: 'Open' },
    pending_closure: { cls: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50', label: 'Pending Closure' },
    closed:          { cls: 'bg-green-900/50 text-green-300 border border-green-700/50', label: 'Closed' },
  }
  const c = map[closure] || map.open
  return <span className={`badge text-xs ${c.cls}`}>{c.label}</span>
}

function AlertCircleHeaderIcon() {
  return (
    <div className="w-9 h-9 rounded-lg bg-red-900/40 flex items-center justify-center flex-shrink-0">
      <FileText size={18} className="text-red-400" />
    </div>
  )
}
