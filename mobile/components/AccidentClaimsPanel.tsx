/**
 * AccidentClaimsPanel
 *
 * The deep claims-management module for a single accident, shared into the
 * accident detail screen. Self-contained: case timeline (remarks), parts list
 * with running cost, claim & responsibility (who pays / who is liable), and the
 * close → admin-approval workflow. Backed by MIGRATIONS_V19 tables + RPCs.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, Alert, ActivityIndicator, Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { supabase } from '../lib/supabase'
import {
  AccidentRecord, AccidentRemark, AccidentPart,
  ClaimStatus, PartStatus, ClosureStatus, RecoverySource, RecoveryStatus,
  CLAIM_STATUS_LABELS, CLAIM_STATUS_COLORS,
  PART_STATUS_LABELS, PART_STATUS_COLORS,
  RECOVERY_SOURCE_LABELS, RECOVERY_STATUS_LABELS, RECOVERY_STATUS_COLORS,
  REMARK_TYPE_META, isAdminOrAbove,
} from '../lib/types'

interface Props {
  accident: AccidentRecord
  onChanged: () => void
}

const CLAIM_STATUSES: ClaimStatus[] = ['none', 'filed', 'approved', 'rejected', 'settled']
const PART_STATUSES: PartStatus[] = ['needed', 'ordered', 'received', 'fitted']
const RECOVERY_SOURCES: RecoverySource[] = ['none', 'insurer', 'third_party', 'driver', 'warranty']
const RECOVERY_STATUSES: RecoveryStatus[] = ['pending', 'partial', 'recovered', 'written_off']

function money(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '-'
  return `SAR ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
}

export default function AccidentClaimsPanel({ accident, onChanged }: Props) {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
  const role = profile?.role ?? null
  const canManage = isAdminOrAbove(role)

  const [remarks, setRemarks] = useState<AccidentRemark[]>([])
  const [parts, setParts] = useState<AccidentPart[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [newRemark, setNewRemark] = useState('')
  const [showClaim, setShowClaim] = useState(false)
  const [showPart, setShowPart] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [showReject, setShowReject] = useState(false)

  const closure: ClosureStatus = accident.closure_status ?? 'open'
  const partsTotal = parts.reduce((s, p) => s + (Number(p.total_cost) || 0), 0)

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([
      supabase.from('accident_remarks').select('*').eq('accident_id', accident.id).order('created_at', { ascending: false }),
      supabase.from('accident_parts').select('*').eq('accident_id', accident.id).order('created_at', { ascending: true }),
    ])
    setRemarks((r.data ?? []) as AccidentRemark[])
    setParts((p.data ?? []) as AccidentPart[])
    setLoading(false)
  }, [accident.id])

  useEffect(() => { load() }, [load])

  async function addRemark() {
    const text = newRemark.trim()
    if (!text) return
    setBusy(true)
    const { error } = await supabase.from('accident_remarks').insert({
      accident_id: accident.id,
      author_id: profile?.id ?? null,
      author_name: profile?.full_name ?? profile?.username ?? 'User',
      remark: text,
      remark_type: 'note',
    })
    setBusy(false)
    if (error) { Alert.alert('Error', 'Could not save remark.'); return }
    setNewRemark('')
    load()
  }

  async function requestClosure(note: string) {
    setBusy(true)
    const { error } = await supabase.rpc('request_accident_closure', {
      p_accident_id: accident.id, p_note: note || null,
    })
    setBusy(false); setShowClose(false)
    if (error) { Alert.alert('Error', error.message); return }
    onChanged(); load()
  }

  async function approveClosure() {
    setBusy(true)
    const { error } = await supabase.rpc('approve_accident_closure', { p_accident_id: accident.id })
    setBusy(false)
    if (error) { Alert.alert('Error', error.message); return }
    onChanged(); load()
  }

  async function rejectClosure(reason: string) {
    setBusy(true)
    const { error } = await supabase.rpc('reject_accident_closure', {
      p_accident_id: accident.id, p_reason: reason || null,
    })
    setBusy(false); setShowReject(false)
    if (error) { Alert.alert('Error', error.message); return }
    onChanged(); load()
  }

  async function deletePart(id: string) {
    const { error } = await supabase.from('accident_parts').delete().eq('id', id)
    if (error) { Alert.alert('Error', 'Could not remove part.'); return }
    load(); onChanged()
  }

  const claimColor = CLAIM_STATUS_COLORS[accident.claim_status ?? 'none']
  const recoveryColor = RECOVERY_STATUS_COLORS[accident.recovery_status ?? 'pending']
  const grossCost = (Number(accident.estimated_damage_cost) || 0) + partsTotal
  const netCost = Math.max(0, grossCost - (Number(accident.recovered_amount) || 0))

  return (
    <View style={{ gap: 14 }}>
      {/* ── Closure workflow banner ─────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="flag-outline" size={15} color="#dc2626" />
          <Text style={styles.sectionTitle}>Case Closure</Text>
        </View>
        <View style={styles.sectionBody}>
          {closure === 'closed' ? (
            <View style={[styles.banner, { backgroundColor: 'rgba(22,163,74,0.08)', borderColor: 'rgba(22,163,74,0.3)' }]}>
              <Ionicons name="checkmark-done-circle" size={20} color="#16a34a" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.bannerTitle, { color: '#15803d' }]}>Closed & approved</Text>
                {accident.closure_approved_at && (
                  <Text style={styles.bannerSub}>{new Date(accident.closure_approved_at).toLocaleString()}</Text>
                )}
              </View>
            </View>
          ) : closure === 'pending_closure' ? (
            <>
              <View style={[styles.banner, { backgroundColor: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.35)' }]}>
                <Ionicons name="hourglass-outline" size={20} color="#d97706" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.bannerTitle, { color: '#b45309' }]}>Awaiting admin approval</Text>
                  {accident.close_request_note ? (
                    <Text style={styles.bannerSub}>“{accident.close_request_note}”</Text>
                  ) : null}
                </View>
              </View>
              {canManage && (
                <View style={styles.rowBtns}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnApprove]}
                    onPress={() => Alert.alert('Approve Closure', 'Confirm this accident is fully resolved and approve closure?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Approve', onPress: approveClosure },
                    ])}
                    disabled={busy}
                  >
                    <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                    <Text style={styles.btnText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnReject]}
                    onPress={() => setShowReject(true)}
                    disabled={busy}
                  >
                    <Ionicons name="close-circle-outline" size={16} color="#fff" />
                    <Text style={styles.btnText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : (
            <>
              {accident.closure_rejected_reason ? (
                <View style={[styles.banner, { backgroundColor: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.25)' }]}>
                  <Ionicons name="alert-circle-outline" size={18} color="#dc2626" />
                  <Text style={[styles.bannerSub, { flex: 1, color: '#b91c1c' }]}>
                    Previous closure rejected: {accident.closure_rejected_reason}
                  </Text>
                </View>
              ) : null}
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => setShowClose(true)} disabled={busy}>
                <Ionicons name="lock-closed-outline" size={16} color="#fff" />
                <Text style={styles.btnText}>Request Closure</Text>
              </TouchableOpacity>
              <Text style={styles.hint}>An Admin / Manager / Director is notified to review and approve.</Text>
            </>
          )}
        </View>
      </View>

      {/* ── Claim & Responsibility ──────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="briefcase-outline" size={15} color="#dc2626" />
          <Text style={styles.sectionTitle}>Claim & Responsibility</Text>
          {canManage && (
            <TouchableOpacity style={styles.editLink} onPress={() => setShowClaim(true)}>
              <Ionicons name="create-outline" size={13} color="#dc2626" />
              <Text style={styles.editLinkText}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.sectionBody}>
          <View style={styles.claimStatusRow}>
            <View style={[styles.claimChip, { backgroundColor: claimColor + '18', borderColor: claimColor + '50' }]}>
              <Text style={[styles.claimChipText, { color: claimColor }]}>
                {CLAIM_STATUS_LABELS[accident.claim_status ?? 'none']}
              </Text>
            </View>
          </View>
          <Row label="Responsible party" value={accident.responsible_party} />
          <Row label="Liable party" value={accident.liable_party} />
          <Row label="Who pays" value={accident.payer} highlight />
          <Row label="Driver" value={accident.driver_name} />
          <Row label="Insurer" value={accident.insurer} />
          <Row label="Policy / Claim No" value={accident.policy_no} />
          <Row label="Claim amount" value={money(accident.claim_amount)} />
          <Row label="Approved amount" value={money(accident.claim_approved_amount)} />
          <Row label="Deductible" value={money(accident.deductible)} />

          {/* Recovery */}
          <View style={styles.divider} />
          <View style={styles.claimStatusRow}>
            <View style={[styles.claimChip, { backgroundColor: recoveryColor + '18', borderColor: recoveryColor + '50' }]}>
              <Text style={[styles.claimChipText, { color: recoveryColor }]}>
                Recovery: {RECOVERY_STATUS_LABELS[accident.recovery_status ?? 'pending']}
              </Text>
            </View>
          </View>
          <Row label="Recovered amount" value={money(accident.recovered_amount)} highlight />
          <Row label="Recovery source" value={RECOVERY_SOURCE_LABELS[accident.recovery_source ?? 'none']} />
          <Row label="Recovery date" value={accident.recovery_date} />
          <Row label="Recovery ref" value={accident.recovery_reference} />

          {/* Net cost after recovery */}
          <View style={styles.netRow}>
            <Text style={styles.netLabel}>Net cost after recovery</Text>
            <Text style={styles.netValue}>{money(netCost)}</Text>
          </View>
        </View>
      </View>

      {/* ── Parts list ──────────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="construct-outline" size={15} color="#dc2626" />
          <Text style={styles.sectionTitle}>Parts & Repairs ({parts.length})</Text>
          {canManage && (
            <TouchableOpacity style={styles.editLink} onPress={() => setShowPart(true)}>
              <Ionicons name="add-circle-outline" size={14} color="#dc2626" />
              <Text style={styles.editLinkText}>Add</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.sectionBody}>
          {loading ? (
            <ActivityIndicator size="small" color="#dc2626" />
          ) : parts.length === 0 ? (
            <Text style={styles.empty}>No parts recorded yet.</Text>
          ) : (
            parts.map(p => {
              const pc = PART_STATUS_COLORS[p.status]
              return (
                <View key={p.id} style={styles.partRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.partName}>{p.part_name}</Text>
                    <Text style={styles.partMeta}>
                      {p.part_number ? `#${p.part_number} · ` : ''}{Number(p.quantity)} × {money(p.unit_cost)}
                      {p.supplier ? ` · ${p.supplier}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={styles.partTotal}>{money(p.total_cost)}</Text>
                    <View style={[styles.partStatus, { backgroundColor: pc + '18' }]}>
                      <Text style={[styles.partStatusText, { color: pc }]}>{PART_STATUS_LABELS[p.status]}</Text>
                    </View>
                  </View>
                  {canManage && (
                    <TouchableOpacity onPress={() => deletePart(p.id)} hitSlop={8} style={{ marginLeft: 6 }}>
                      <Ionicons name="trash-outline" size={15} color="#cbd5e1" />
                    </TouchableOpacity>
                  )}
                </View>
              )
            })
          )}
          {parts.length > 0 && (
            <View style={styles.partsTotalRow}>
              <Text style={styles.partsTotalLabel}>Total parts cost</Text>
              <Text style={styles.partsTotalValue}>{money(partsTotal)}</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Case timeline / remarks ─────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="time-outline" size={15} color="#dc2626" />
          <Text style={styles.sectionTitle}>Case Log ({remarks.length})</Text>
        </View>
        <View style={styles.sectionBody}>
          {/* Add remark */}
          <View style={[styles.addRemarkRow, isRTL && { flexDirection: 'row-reverse' }]}>
            <TextInput
              style={styles.remarkInput}
              value={newRemark}
              onChangeText={setNewRemark}
              placeholder="Add an update (e.g. insurance rejected claim)..."
              placeholderTextColor="#94a3b8"
              multiline
            />
            <TouchableOpacity
              style={[styles.remarkSend, !newRemark.trim() && { opacity: 0.4 }]}
              onPress={addRemark}
              disabled={!newRemark.trim() || busy}
            >
              <Ionicons name="send" size={16} color="#fff" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator size="small" color="#dc2626" style={{ marginTop: 8 }} />
          ) : remarks.length === 0 ? (
            <Text style={styles.empty}>No log entries yet.</Text>
          ) : (
            remarks.map((r, i) => {
              const meta = REMARK_TYPE_META[r.remark_type] ?? REMARK_TYPE_META.note
              return (
                <View key={r.id} style={[styles.logRow, i < remarks.length - 1 && styles.logRowBorder]}>
                  <View style={[styles.logIcon, { backgroundColor: meta.color + '18' }]}>
                    <Ionicons name={meta.icon as any} size={14} color={meta.color} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.logText}>{r.remark}</Text>
                    <Text style={styles.logMeta}>
                      {r.author_name ?? 'User'} · {new Date(r.created_at).toLocaleDateString()} {new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>
              )
            })
          )}
        </View>
      </View>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      <ClaimEditModal
        visible={showClaim}
        accident={accident}
        onClose={() => setShowClaim(false)}
        onSaved={() => { setShowClaim(false); onChanged() }}
      />
      <PartModal
        visible={showPart}
        accidentId={accident.id}
        authorId={profile?.id ?? null}
        onClose={() => setShowPart(false)}
        onSaved={() => { setShowPart(false); load(); onChanged() }}
      />
      <TextPromptModal
        visible={showClose}
        title="Request Closure"
        message="Add an optional closing note for the approver."
        placeholder="e.g. Repairs complete, claim settled"
        confirmLabel="Submit for approval"
        onCancel={() => setShowClose(false)}
        onConfirm={requestClosure}
        busy={busy}
      />
      <TextPromptModal
        visible={showReject}
        title="Reject Closure"
        message="Tell the requester what still needs to be done."
        placeholder="Reason for rejection"
        confirmLabel="Reject"
        destructive
        onCancel={() => setShowReject(false)}
        onConfirm={rejectClosure}
        busy={busy}
      />
    </View>
  )
}

// ── Row ─────────────────────────────────────────────────────────────────────────
function Row({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, highlight && value ? styles.infoValueHi : null]}>{value || '-'}</Text>
    </View>
  )
}

// ── Generic text prompt modal (cross-platform) ──────────────────────────────────
function TextPromptModal({
  visible, title, message, placeholder, confirmLabel, destructive, busy, onCancel, onConfirm,
}: {
  visible: boolean; title: string; message: string; placeholder: string
  confirmLabel: string; destructive?: boolean; busy?: boolean
  onCancel: () => void; onConfirm: (text: string) => void
}) {
  const [text, setText] = useState('')
  useEffect(() => { if (visible) setText('') }, [visible])
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.promptBackdrop}>
        <View style={styles.promptCard}>
          <Text style={styles.promptTitle}>{title}</Text>
          <Text style={styles.promptMsg}>{message}</Text>
          <TextInput
            style={styles.promptInput}
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor="#94a3b8"
            multiline
            autoFocus
          />
          <View style={styles.promptBtns}>
            <TouchableOpacity style={styles.promptCancel} onPress={onCancel}>
              <Text style={styles.promptCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.promptConfirm, destructive && { backgroundColor: '#dc2626' }]}
              onPress={() => onConfirm(text.trim())}
              disabled={busy}
            >
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.promptConfirmText}>{confirmLabel}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── Add part modal ───────────────────────────────────────────────────────────────
function PartModal({
  visible, accidentId, authorId, onClose, onSaved,
}: {
  visible: boolean; accidentId: string; authorId: string | null
  onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [num, setNum] = useState('')
  const [qty, setQty] = useState('1')
  const [cost, setCost] = useState('')
  const [supplier, setSupplier] = useState('')
  const [status, setStatus] = useState<PartStatus>('needed')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (visible) { setName(''); setNum(''); setQty('1'); setCost(''); setSupplier(''); setStatus('needed') }
  }, [visible])

  async function save() {
    if (!name.trim()) { Alert.alert('Required', 'Enter a part name.'); return }
    setSaving(true)
    const { error } = await supabase.from('accident_parts').insert({
      accident_id: accidentId,
      part_name: name.trim(),
      part_number: num.trim() || null,
      quantity: Number(qty) || 1,
      unit_cost: Number(cost) || 0,
      supplier: supplier.trim() || null,
      status,
      created_by: authorId,
    })
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    onSaved()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Add Part / Repair</Text>
          <Field label="Part name *"><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Front bumper" placeholderTextColor="#94a3b8" /></Field>
          <View style={styles.twoCol}>
            <Field label="Part number" flex><TextInput style={styles.input} value={num} onChangeText={setNum} placeholder="Optional" placeholderTextColor="#94a3b8" /></Field>
            <Field label="Supplier" flex><TextInput style={styles.input} value={supplier} onChangeText={setSupplier} placeholder="Optional" placeholderTextColor="#94a3b8" /></Field>
          </View>
          <View style={styles.twoCol}>
            <Field label="Quantity" flex><TextInput style={styles.input} value={qty} onChangeText={setQty} keyboardType="decimal-pad" /></Field>
            <Field label="Unit cost (SAR)" flex><TextInput style={styles.input} value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#94a3b8" /></Field>
          </View>
          <Field label="Status">
            <View style={styles.chipWrap}>
              {PART_STATUSES.map(s => {
                const active = status === s
                const c = PART_STATUS_COLORS[s]
                return (
                  <TouchableOpacity key={s} style={[styles.pickChip, active && { backgroundColor: c + '18', borderColor: c }]} onPress={() => setStatus(s)}>
                    <Text style={[styles.pickChipText, active && { color: c }]}>{PART_STATUS_LABELS[s]}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </Field>
          <View style={styles.sheetBtns}>
            <TouchableOpacity style={styles.sheetCancel} onPress={onClose}><Text style={styles.sheetCancelText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={styles.sheetSave} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sheetSaveText}>Add Part</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── Edit claim modal ─────────────────────────────────────────────────────────────
function ClaimEditModal({
  visible, accident, onClose, onSaved,
}: {
  visible: boolean; accident: AccidentRecord; onClose: () => void; onSaved: () => void
}) {
  const [f, setF] = useState({
    responsible_party: '', liable_party: '', payer: '', driver_name: '',
    insurer: '', policy_no: '', claim_status: 'none' as ClaimStatus,
    claim_amount: '', claim_approved_amount: '', deductible: '',
    recovered_amount: '', recovery_date: '', recovery_reference: '',
    recovery_source: 'none' as RecoverySource, recovery_status: 'pending' as RecoveryStatus,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (visible) setF({
      responsible_party: accident.responsible_party ?? '',
      liable_party: accident.liable_party ?? '',
      payer: accident.payer ?? '',
      driver_name: accident.driver_name ?? '',
      insurer: accident.insurer ?? '',
      policy_no: accident.policy_no ?? '',
      claim_status: accident.claim_status ?? 'none',
      claim_amount: accident.claim_amount != null ? String(accident.claim_amount) : '',
      claim_approved_amount: accident.claim_approved_amount != null ? String(accident.claim_approved_amount) : '',
      deductible: accident.deductible != null ? String(accident.deductible) : '',
      recovered_amount: accident.recovered_amount != null ? String(accident.recovered_amount) : '',
      recovery_date: accident.recovery_date ?? '',
      recovery_reference: accident.recovery_reference ?? '',
      recovery_source: accident.recovery_source ?? 'none',
      recovery_status: accident.recovery_status ?? 'pending',
    })
  }, [visible, accident])

  const set = (k: keyof typeof f, v: any) => setF(prev => ({ ...prev, [k]: v }))

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('accidents').update({
      responsible_party: f.responsible_party.trim() || null,
      liable_party: f.liable_party.trim() || null,
      payer: f.payer.trim() || null,
      driver_name: f.driver_name.trim() || null,
      insurer: f.insurer.trim() || null,
      policy_no: f.policy_no.trim() || null,
      claim_status: f.claim_status,
      claim_amount: f.claim_amount ? Number(f.claim_amount) : null,
      claim_approved_amount: f.claim_approved_amount ? Number(f.claim_approved_amount) : null,
      deductible: f.deductible ? Number(f.deductible) : null,
      recovered_amount: f.recovered_amount ? Number(f.recovered_amount) : null,
      recovery_date: f.recovery_date.trim() || null,
      recovery_reference: f.recovery_reference.trim() || null,
      recovery_source: f.recovery_source,
      recovery_status: f.recovery_status,
    }).eq('id', accident.id)
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    onSaved()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={[styles.sheet, { maxHeight: '90%' }]}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Edit Claim & Responsibility</Text>
          <View style={{ gap: 10 }}>
            <Field label="Responsible party"><TextInput style={styles.input} value={f.responsible_party} onChangeText={v => set('responsible_party', v)} placeholder="Who is at fault" placeholderTextColor="#94a3b8" /></Field>
            <View style={styles.twoCol}>
              <Field label="Liable party" flex><TextInput style={styles.input} value={f.liable_party} onChangeText={v => set('liable_party', v)} placeholder="Liable" placeholderTextColor="#94a3b8" /></Field>
              <Field label="Who pays" flex><TextInput style={styles.input} value={f.payer} onChangeText={v => set('payer', v)} placeholder="Payer" placeholderTextColor="#94a3b8" /></Field>
            </View>
            <View style={styles.twoCol}>
              <Field label="Driver" flex><TextInput style={styles.input} value={f.driver_name} onChangeText={v => set('driver_name', v)} placeholderTextColor="#94a3b8" /></Field>
              <Field label="Insurer" flex><TextInput style={styles.input} value={f.insurer} onChangeText={v => set('insurer', v)} placeholderTextColor="#94a3b8" /></Field>
            </View>
            <Field label="Policy / Claim No"><TextInput style={styles.input} value={f.policy_no} onChangeText={v => set('policy_no', v)} placeholderTextColor="#94a3b8" /></Field>
            <Field label="Claim status">
              <View style={styles.chipWrap}>
                {CLAIM_STATUSES.map(s => {
                  const active = f.claim_status === s
                  const c = CLAIM_STATUS_COLORS[s]
                  return (
                    <TouchableOpacity key={s} style={[styles.pickChip, active && { backgroundColor: c + '18', borderColor: c }]} onPress={() => set('claim_status', s)}>
                      <Text style={[styles.pickChipText, active && { color: c }]}>{CLAIM_STATUS_LABELS[s]}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </Field>
            <View style={styles.twoCol}>
              <Field label="Claim amount" flex><TextInput style={styles.input} value={f.claim_amount} onChangeText={v => set('claim_amount', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#94a3b8" /></Field>
              <Field label="Approved" flex><TextInput style={styles.input} value={f.claim_approved_amount} onChangeText={v => set('claim_approved_amount', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#94a3b8" /></Field>
            </View>
            <Field label="Deductible"><TextInput style={styles.input} value={f.deductible} onChangeText={v => set('deductible', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#94a3b8" /></Field>

            {/* Recovery */}
            <View style={styles.divider} />
            <Text style={styles.fieldLabel}>Cost Recovery</Text>
            <View style={styles.twoCol}>
              <Field label="Recovered amount" flex><TextInput style={styles.input} value={f.recovered_amount} onChangeText={v => set('recovered_amount', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#94a3b8" /></Field>
              <Field label="Recovery date" flex><TextInput style={styles.input} value={f.recovery_date} onChangeText={v => set('recovery_date', v)} placeholder="YYYY-MM-DD" placeholderTextColor="#94a3b8" /></Field>
            </View>
            <Field label="Recovery source">
              <View style={styles.chipWrap}>
                {RECOVERY_SOURCES.map(s => {
                  const active = f.recovery_source === s
                  return (
                    <TouchableOpacity key={s} style={[styles.pickChip, active && { backgroundColor: '#16a34a18', borderColor: '#16a34a' }]} onPress={() => set('recovery_source', s)}>
                      <Text style={[styles.pickChipText, active && { color: '#16a34a' }]}>{RECOVERY_SOURCE_LABELS[s]}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </Field>
            <Field label="Recovery status">
              <View style={styles.chipWrap}>
                {RECOVERY_STATUSES.map(s => {
                  const active = f.recovery_status === s
                  const c = RECOVERY_STATUS_COLORS[s]
                  return (
                    <TouchableOpacity key={s} style={[styles.pickChip, active && { backgroundColor: c + '18', borderColor: c }]} onPress={() => set('recovery_status', s)}>
                      <Text style={[styles.pickChipText, active && { color: c }]}>{RECOVERY_STATUS_LABELS[s]}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </Field>
            <Field label="Recovery reference"><TextInput style={styles.input} value={f.recovery_reference} onChangeText={v => set('recovery_reference', v)} placeholderTextColor="#94a3b8" /></Field>
          </View>
          <View style={styles.sheetBtns}>
            <TouchableOpacity style={styles.sheetCancel} onPress={onClose}><Text style={styles.sheetCancelText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={styles.sheetSave} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sheetSaveText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: boolean }) {
  return (
    <View style={[{ gap: 5 }, flex && { flex: 1 }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a', flex: 1 },
  sectionBody: { padding: 16, gap: 10 },
  editLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  editLinkText: { fontSize: 12, fontWeight: '700', color: '#dc2626' },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 12, padding: 12,
  },
  bannerTitle: { fontSize: 13, fontWeight: '800' },
  bannerSub: { fontSize: 12, color: '#64748b', marginTop: 1 },
  rowBtns: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: 12 },
  btnPrimary: { backgroundColor: '#dc2626' },
  btnApprove: { backgroundColor: '#16a34a' },
  btnReject: { backgroundColor: '#ef4444' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  hint: { fontSize: 11, color: '#94a3b8', marginTop: 6, textAlign: 'center' },

  claimStatusRow: { flexDirection: 'row' },
  claimChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  claimChipText: { fontSize: 12, fontWeight: '800' },

  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  infoLabel: { fontSize: 12, color: '#94a3b8', fontWeight: '600', flex: 1 },
  infoValue: { fontSize: 13, color: '#374151', fontWeight: '600', textAlign: 'right', flex: 1.4 },
  infoValueHi: { color: '#dc2626', fontWeight: '800' },
  divider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 4 },
  netRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  netLabel: { fontSize: 13, fontWeight: '700', color: '#64748b' },
  netValue: { fontSize: 15, fontWeight: '800', color: '#dc2626' },

  empty: { fontSize: 13, color: '#94a3b8', fontStyle: 'italic' },

  partRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  partName: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  partMeta: { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  partTotal: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  partStatus: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  partStatusText: { fontSize: 10, fontWeight: '700' },
  partsTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8 },
  partsTotalLabel: { fontSize: 13, fontWeight: '700', color: '#64748b' },
  partsTotalValue: { fontSize: 15, fontWeight: '800', color: '#dc2626' },

  addRemarkRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  remarkInput: {
    flex: 1, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#0f172a',
    minHeight: 42, maxHeight: 110,
  },
  remarkSend: { width: 42, height: 42, borderRadius: 10, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },

  logRow: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  logRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  logIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  logText: { fontSize: 13, color: '#374151', lineHeight: 19 },
  logMeta: { fontSize: 11, color: '#94a3b8' },

  // Prompt modal
  promptBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  promptCard: { width: '100%', backgroundColor: '#fff', borderRadius: 18, padding: 20, gap: 10 },
  promptTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  promptMsg: { fontSize: 13, color: '#64748b' },
  promptInput: {
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12,
    padding: 12, fontSize: 14, color: '#0f172a', minHeight: 70, textAlignVertical: 'top',
  },
  promptBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  promptCancel: { flex: 1, height: 46, borderRadius: 12, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  promptCancelText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  promptConfirm: { flex: 1.4, height: 46, borderRadius: 12, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  promptConfirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // Sheet modal (parts / claim)
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 22, gap: 12, maxHeight: '88%' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#e2e8f0', alignSelf: 'center', marginBottom: 4 },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  twoCol: { flexDirection: 'row', gap: 10 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3 },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0f172a' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pickChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1.5, borderColor: '#e2e8f0' },
  pickChipText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  sheetBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  sheetCancel: { flex: 1, height: 48, borderRadius: 12, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  sheetCancelText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  sheetSave: { flex: 1.4, height: 48, borderRadius: 12, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  sheetSaveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
})
