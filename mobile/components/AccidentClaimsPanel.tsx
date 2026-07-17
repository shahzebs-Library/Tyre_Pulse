/**
 * AccidentClaimsPanel
 *
 * The deep claims-management module for a single accident, shared into the
 * accident detail screen. Self-contained: case timeline (remarks), parts list
 * with running cost, claim & responsibility (who pays / who is liable), and the
 * close -> admin-approval workflow. Backed by MIGRATIONS_V19 tables + RPCs.
 *
 * Visual: Daylight design system (theme tokens, sunlight-legible).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  View, TextInput, TouchableOpacity, StyleSheet,
  Modal, Alert, ActivityIndicator, Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import { Theme, radius, spacing } from '../lib/theme'
import { AppText } from './ui'
import { supabase } from '../lib/supabase'
import { toUserMessage } from '../lib/safeError'
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

// GCC case / repair vocabularies (mirror src/lib/accidentVocab.js). Stored as
// display labels on their columns; the chip pickers below make them easy to edit.
const FAULT_STATUS_OPTS = ['Faulty', 'Non-faulty', 'Under review']
const LIABILITY_RATIO_OPTS = ['0', '50', '100']
const NAJM_STATUS_OPTS = ['Najm report', 'No Najm']
const NAJM_FAULT_OPTS = ['Faulty', 'Non-faulty', 'N/A']
const TAQDEER_STATUS_OPTS = ['Taqdeer report', 'No Taqdeer']
const DAMAGE_CONDITION_OPTS = ['Minor', 'Moderate', 'Major', 'N/A']
const LIABLE_PARTY_OPTS = ['GCC', 'Other Party']
const PAYER_OPTS = ['GCC', 'Insurance', 'Recovery Claim']
const REPAIR_TYPE_OPTS = ['Internal', 'External']
const najmHasReport = (v: string) => /report/i.test(v || '') && !/^no/i.test(v || '')
const taqdeerHasReport = (v: string) => /report/i.test(v || '') && !/^no/i.test(v || '')
const repairIsInternal = (v: string) => (v || '') === 'Internal'
const computeRecovered = (claim: string, approved: string, deductible: string) => {
  const n = (x: string) => (Number.isFinite(Number(x)) ? Number(x) : 0)
  return Math.max(0, n(claim) - n(approved) - n(deductible))
}

function money(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '-'
  return `SAR ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
}

function useStyles() {
  const { theme } = useTheme()
  return useMemo(() => createStyles(theme), [theme])
}

export default function AccidentClaimsPanel({ accident, onChanged }: Props) {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
  const { theme } = useTheme()
  const c = theme.color
  const styles = useStyles()
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
    if (error) { Alert.alert('Error', toUserMessage(error)); return }
    onChanged(); load()
  }

  async function approveClosure() {
    setBusy(true)
    const { error } = await supabase.rpc('approve_accident_closure', { p_accident_id: accident.id })
    setBusy(false)
    if (error) { Alert.alert('Error', toUserMessage(error)); return }
    onChanged(); load()
  }

  async function rejectClosure(reason: string) {
    setBusy(true)
    const { error } = await supabase.rpc('reject_accident_closure', {
      p_accident_id: accident.id, p_reason: reason || null,
    })
    setBusy(false); setShowReject(false)
    if (error) { Alert.alert('Error', toUserMessage(error)); return }
    onChanged(); load()
  }

  async function deletePart(id: string) {
    const { error } = await supabase.from('accident_parts').delete().eq('id', id)
    if (error) { Alert.alert('Error', 'Could not remove part.'); return }
    load(); onChanged()
  }

  // Extra field-parity columns are present at runtime (select('*')) but not on
  // the AccidentRecord type; read them through a loose view.
  const a = accident as any
  const claimColor = CLAIM_STATUS_COLORS[accident.claim_status ?? 'none']
  const recoveryColor = RECOVERY_STATUS_COLORS[accident.recovery_status ?? 'pending']
  const grossCost = (Number(accident.estimated_damage_cost) || 0) + partsTotal
  const netCost = Math.max(0, grossCost - (Number(accident.recovered_amount) || 0))

  return (
    <View style={{ gap: spacing.md }}>
      {/* -- Closure workflow banner ------------------------------------------ */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="flag-outline" size={15} color={c.danger.base} />
          <AppText variant="label" style={styles.sectionTitle}>Case Closure</AppText>
        </View>
        <View style={styles.sectionBody}>
          {closure === 'closed' ? (
            <View style={[styles.banner, { backgroundColor: c.success.soft, borderColor: c.success.base + '55' }]}>
              <Ionicons name="checkmark-done-circle" size={20} color={c.success.base} />
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong" style={{ color: c.success.on }}>Closed and approved</AppText>
                {accident.closure_approved_at && (
                  <AppText variant="caption" color="muted">{new Date(accident.closure_approved_at).toLocaleString()}</AppText>
                )}
              </View>
            </View>
          ) : closure === 'pending_closure' ? (
            <>
              <View style={[styles.banner, { backgroundColor: c.warning.soft, borderColor: c.warning.base + '66' }]}>
                <Ionicons name="hourglass-outline" size={20} color={c.warning.base} />
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong" style={{ color: c.warning.on }}>Awaiting admin approval</AppText>
                  {accident.close_request_note ? (
                    <AppText variant="caption" color="muted">"{accident.close_request_note}"</AppText>
                  ) : null}
                </View>
              </View>
              {canManage && (
                <View style={styles.rowBtns}>
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: c.success.base }]}
                    onPress={() => Alert.alert('Approve Closure', 'Confirm this accident is fully resolved and approve closure?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Approve', onPress: approveClosure },
                    ])}
                    disabled={busy}
                  >
                    <Ionicons name="checkmark-circle-outline" size={17} color="#fff" />
                    <AppText variant="bodyStrong" style={styles.btnText}>Approve</AppText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: c.danger.base }]}
                    onPress={() => setShowReject(true)}
                    disabled={busy}
                  >
                    <Ionicons name="close-circle-outline" size={17} color="#fff" />
                    <AppText variant="bodyStrong" style={styles.btnText}>Reject</AppText>
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : (
            <>
              {accident.closure_rejected_reason ? (
                <View style={[styles.banner, { backgroundColor: c.danger.soft, borderColor: c.danger.base + '40' }]}>
                  <Ionicons name="alert-circle-outline" size={18} color={c.danger.base} />
                  <AppText variant="caption" style={{ flex: 1, color: c.danger.on }}>
                    Previous closure rejected: {accident.closure_rejected_reason}
                  </AppText>
                </View>
              ) : null}
              <TouchableOpacity style={[styles.btn, { backgroundColor: c.danger.base }]} onPress={() => setShowClose(true)} disabled={busy}>
                <Ionicons name="lock-closed-outline" size={17} color="#fff" />
                <AppText variant="bodyStrong" style={styles.btnText}>Request Closure</AppText>
              </TouchableOpacity>
              <AppText variant="caption" color="muted" center style={{ marginTop: spacing.xs }}>
                An Admin / Manager / Director is notified to review and approve.
              </AppText>
            </>
          )}
        </View>
      </View>

      {/* -- Claim & Responsibility ------------------------------------------- */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="briefcase-outline" size={15} color={c.danger.base} />
          <AppText variant="label" style={styles.sectionTitle}>Claim and Responsibility</AppText>
          {canManage && (
            <TouchableOpacity style={styles.editLink} onPress={() => setShowClaim(true)}>
              <Ionicons name="create-outline" size={14} color={c.danger.base} />
              <AppText variant="caption" style={{ color: c.danger.base }}>Edit</AppText>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.sectionBody}>
          <View style={styles.claimStatusRow}>
            <View style={[styles.claimChip, { backgroundColor: claimColor + '1F', borderColor: claimColor + '55' }]}>
              <AppText variant="caption" style={{ color: claimColor }}>
                {CLAIM_STATUS_LABELS[accident.claim_status ?? 'none']}
              </AppText>
            </View>
          </View>
          <Row label="Responsible party" value={accident.responsible_party} />
          <Row label="Liable party" value={accident.liable_party} />
          <Row label="Who pays" value={accident.payer} highlight />
          <Row label="Fault status" value={a.fault_status} />
          {a.gcc_liability_ratio != null && a.gcc_liability_ratio !== '' ? (
            <Row label="GCC liability" value={`${Number(a.gcc_liability_ratio)}%`} />
          ) : null}
          <Row label="Najm report" value={a.najm_status} />
          {najmHasReport(a.najm_status) ? <Row label="Najm fault" value={a.najm_fault} /> : null}
          <Row label="Taqdeer report" value={a.taqdeer_status} />
          {taqdeerHasReport(a.taqdeer_status) ? <Row label="Taqdeer no" value={a.taqdeer_no} /> : null}
          <Row label="Damage condition" value={a.damage_condition} />
          <Row label="Driver" value={accident.driver_name} />
          <Row label="Insurer" value={accident.insurer} />
          <Row label="Policy No" value={accident.policy_no} />
          <Row label="Claim No" value={a.insurance_claim_no} />
          <Row label="Claim amount" value={money(accident.claim_amount)} />
          <Row label="Approved amount" value={money(accident.claim_approved_amount)} />
          <Row label="Deductible" value={money(accident.deductible)} />

          {/* Recovery */}
          <View style={styles.divider} />
          <View style={styles.claimStatusRow}>
            <View style={[styles.claimChip, { backgroundColor: recoveryColor + '1F', borderColor: recoveryColor + '55' }]}>
              <AppText variant="caption" style={{ color: recoveryColor }}>
                Recovery: {RECOVERY_STATUS_LABELS[accident.recovery_status ?? 'pending']}
              </AppText>
            </View>
          </View>
          <Row label="Recovered amount" value={money(accident.recovered_amount)} highlight />
          <Row label="Recovery source" value={RECOVERY_SOURCE_LABELS[accident.recovery_source ?? 'none']} />
          <Row label="Recovery date" value={accident.recovery_date} />
          <Row label="Recovery ref" value={accident.recovery_reference} />
          {a.amount_transfer != null ? <Row label="Amount transfer" value={money(a.amount_transfer)} /> : null}

          {/* Repair & release */}
          {(a.repair_type || a.workshop_name || a.workshop_location || a.repair_cost != null || a.expected_release_date || a.release_date) ? (
            <>
              <View style={styles.divider} />
              <Row label="Repair type" value={a.repair_type} />
              <Row label="Workshop" value={a.workshop_name} />
              <Row label="Workshop location" value={a.workshop_location} />
              {a.repair_cost != null ? <Row label="Repair cost" value={money(a.repair_cost)} /> : null}
              <Row label="Expected release" value={a.expected_release_date} />
              <Row label="Release date" value={a.release_date} />
            </>
          ) : null}

          {/* Net cost after recovery */}
          <View style={styles.netRow}>
            <AppText variant="bodyStrong" color="secondary">Net cost after recovery</AppText>
            <AppText variant="h3" style={{ color: c.danger.base }}>{money(netCost)}</AppText>
          </View>
        </View>
      </View>

      {/* -- Parts list ------------------------------------------------------- */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="construct-outline" size={15} color={c.danger.base} />
          <AppText variant="label" style={styles.sectionTitle}>Parts and Repairs ({parts.length})</AppText>
          {canManage && (
            <TouchableOpacity style={styles.editLink} onPress={() => setShowPart(true)}>
              <Ionicons name="add-circle-outline" size={15} color={c.danger.base} />
              <AppText variant="caption" style={{ color: c.danger.base }}>Add</AppText>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.sectionBody}>
          {loading ? (
            <ActivityIndicator size="small" color={c.danger.base} />
          ) : parts.length === 0 ? (
            <AppText variant="caption" color="muted" style={{ fontStyle: 'italic' }}>No parts recorded yet.</AppText>
          ) : (
            parts.map(p => {
              const pc = PART_STATUS_COLORS[p.status]
              return (
                <View key={p.id} style={styles.partRow}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyStrong">{p.part_name}</AppText>
                    <AppText variant="caption" color="muted">
                      {p.part_number ? `#${p.part_number} - ` : ''}{Number(p.quantity)} x {money(p.unit_cost)}
                      {p.supplier ? ` - ${p.supplier}` : ''}
                    </AppText>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <AppText variant="bodyStrong">{money(p.total_cost)}</AppText>
                    <View style={[styles.partStatus, { backgroundColor: pc + '1F' }]}>
                      <AppText variant="micro" style={{ color: pc }}>{PART_STATUS_LABELS[p.status]}</AppText>
                    </View>
                  </View>
                  {canManage && (
                    <TouchableOpacity onPress={() => deletePart(p.id)} hitSlop={8} style={{ marginLeft: spacing.xs }}>
                      <Ionicons name="trash-outline" size={16} color={c.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              )
            })
          )}
          {parts.length > 0 && (
            <View style={styles.partsTotalRow}>
              <AppText variant="bodyStrong" color="secondary">Total parts cost</AppText>
              <AppText variant="h3" style={{ color: c.danger.base }}>{money(partsTotal)}</AppText>
            </View>
          )}
        </View>
      </View>

      {/* -- Case timeline / remarks ------------------------------------------ */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="time-outline" size={15} color={c.danger.base} />
          <AppText variant="label" style={styles.sectionTitle}>Case Log ({remarks.length})</AppText>
        </View>
        <View style={styles.sectionBody}>
          {/* Add remark */}
          <View style={[styles.addRemarkRow, isRTL && { flexDirection: 'row-reverse' }]}>
            <TextInput
              style={[styles.remarkInput, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]}
              value={newRemark}
              onChangeText={setNewRemark}
              placeholder="Add an update (e.g. insurance rejected claim)..."
              placeholderTextColor={c.textMuted}
              multiline
            />
            <TouchableOpacity
              style={[styles.remarkSend, { backgroundColor: c.danger.base }, !newRemark.trim() && { opacity: 0.4 }]}
              onPress={addRemark}
              disabled={!newRemark.trim() || busy}
            >
              <Ionicons name="send" size={17} color="#fff" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator size="small" color={c.danger.base} style={{ marginTop: spacing.sm }} />
          ) : remarks.length === 0 ? (
            <AppText variant="caption" color="muted" style={{ fontStyle: 'italic' }}>No log entries yet.</AppText>
          ) : (
            remarks.map((r, i) => {
              const meta = REMARK_TYPE_META[r.remark_type] ?? REMARK_TYPE_META.note
              return (
                <View key={r.id} style={[styles.logRow, i < remarks.length - 1 && styles.logRowBorder]}>
                  <View style={[styles.logIcon, { backgroundColor: meta.color + '1F' }]}>
                    <Ionicons name={meta.icon as any} size={14} color={meta.color} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="body" color="secondary">{r.remark}</AppText>
                    <AppText variant="micro" color="muted">
                      {r.author_name ?? 'User'} - {new Date(r.created_at).toLocaleDateString()} {new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </AppText>
                  </View>
                </View>
              )
            })
          )}
        </View>
      </View>

      {/* -- Modals ----------------------------------------------------------- */}
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

// -- Row ---------------------------------------------------------------------------
function Row({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  const { theme } = useTheme()
  const styles = useStyles()
  return (
    <View style={styles.infoRow}>
      <AppText variant="caption" color="muted" style={{ flex: 1 }}>{label}</AppText>
      <AppText
        variant="bodyStrong"
        style={[styles.infoValue, highlight && value ? { color: theme.color.danger.base } : { color: theme.color.textSecondary }]}
      >
        {value || '-'}
      </AppText>
    </View>
  )
}

// -- Generic text prompt modal (cross-platform) ----------------------------------
function TextPromptModal({
  visible, title, message, placeholder, confirmLabel, destructive, busy, onCancel, onConfirm,
}: {
  visible: boolean; title: string; message: string; placeholder: string
  confirmLabel: string; destructive?: boolean; busy?: boolean
  onCancel: () => void; onConfirm: (text: string) => void
}) {
  const { theme } = useTheme()
  const c = theme.color
  const styles = useStyles()
  const [text, setText] = useState('')
  useEffect(() => { if (visible) setText('') }, [visible])
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.promptBackdrop, { backgroundColor: c.overlay }]}>
        <View style={[styles.promptCard, { backgroundColor: c.surface }]}>
          <AppText variant="h3">{title}</AppText>
          <AppText variant="caption" color="secondary">{message}</AppText>
          <TextInput
            style={[styles.promptInput, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]}
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={c.textMuted}
            multiline
            autoFocus
          />
          <View style={styles.promptBtns}>
            <TouchableOpacity style={[styles.promptCancel, { backgroundColor: c.surfaceAlt }]} onPress={onCancel}>
              <AppText variant="bodyStrong" color="secondary">Cancel</AppText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.promptConfirm, { backgroundColor: destructive ? c.danger.base : c.primary }]}
              onPress={() => onConfirm(text.trim())}
              disabled={busy}
            >
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <AppText variant="bodyStrong" style={{ color: '#fff' }}>{confirmLabel}</AppText>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// -- Add part modal ----------------------------------------------------------------
function PartModal({
  visible, accidentId, authorId, onClose, onSaved,
}: {
  visible: boolean; accidentId: string; authorId: string | null
  onClose: () => void; onSaved: () => void
}) {
  const { theme } = useTheme()
  const c = theme.color
  const styles = useStyles()
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
    if (error) { Alert.alert('Error', toUserMessage(error)); return }
    onSaved()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.sheetBackdrop, { backgroundColor: c.overlay }]}>
        <View style={[styles.sheet, { backgroundColor: c.surface }]}>
          <View style={[styles.handle, { backgroundColor: c.borderStrong }]} />
          <AppText variant="h3">Add Part / Repair</AppText>
          <Field label="Part name *"><TextInput style={[styles.input, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]} value={name} onChangeText={setName} placeholder="e.g. Front bumper" placeholderTextColor={c.textMuted} /></Field>
          <View style={styles.twoCol}>
            <Field label="Part number" flex><TextInput style={[styles.input, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]} value={num} onChangeText={setNum} placeholder="Optional" placeholderTextColor={c.textMuted} /></Field>
            <Field label="Supplier" flex><TextInput style={[styles.input, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]} value={supplier} onChangeText={setSupplier} placeholder="Optional" placeholderTextColor={c.textMuted} /></Field>
          </View>
          <View style={styles.twoCol}>
            <Field label="Quantity" flex><TextInput style={[styles.input, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]} value={qty} onChangeText={setQty} keyboardType="decimal-pad" /></Field>
            <Field label="Unit cost (SAR)" flex><TextInput style={[styles.input, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]} value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.textMuted} /></Field>
          </View>
          <Field label="Status">
            <View style={styles.chipWrap}>
              {PART_STATUSES.map(s => {
                const active = status === s
                const pc = PART_STATUS_COLORS[s]
                return (
                  <TouchableOpacity key={s} style={[styles.pickChip, { borderColor: c.border }, active && { backgroundColor: pc + '1F', borderColor: pc }]} onPress={() => setStatus(s)}>
                    <AppText variant="caption" style={{ color: active ? pc : c.textMuted }}>{PART_STATUS_LABELS[s]}</AppText>
                  </TouchableOpacity>
                )
              })}
            </View>
          </Field>
          <View style={styles.sheetBtns}>
            <TouchableOpacity style={[styles.sheetCancel, { backgroundColor: c.surfaceAlt }]} onPress={onClose}><AppText variant="bodyStrong" color="secondary">Cancel</AppText></TouchableOpacity>
            <TouchableOpacity style={[styles.sheetSave, { backgroundColor: c.danger.base }]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <AppText variant="bodyStrong" style={{ color: '#fff' }}>Add Part</AppText>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// -- Edit claim modal --------------------------------------------------------------
function ClaimEditModal({
  visible, accident, onClose, onSaved,
}: {
  visible: boolean; accident: AccidentRecord; onClose: () => void; onSaved: () => void
}) {
  const { theme } = useTheme()
  const c = theme.color
  const styles = useStyles()
  const a = accident as any
  const [f, setF] = useState({
    responsible_party: '', liable_party: '', payer: '', driver_name: '',
    insurer: '', policy_no: '', insurance_claim_no: '', claim_status: 'none' as ClaimStatus,
    claim_amount: '', claim_approved_amount: '', deductible: '',
    recovered_amount: '', recovery_date: '', recovery_reference: '',
    recovery_source: 'none' as RecoverySource, recovery_status: 'pending' as RecoveryStatus,
    // GCC case + repair (field-parity with the web incident form)
    fault_status: '', gcc_liability_ratio: '', najm_status: '', najm_fault: '',
    taqdeer_status: '', taqdeer_no: '', damage_condition: '', amount_transfer: '',
    repair_type: '', workshop_name: '', workshop_location: '',
    repair_cost: '', expected_release_date: '', release_date: '',
  })
  const [saving, setSaving] = useState(false)
  const recoveredTouched = useRef(false)

  useEffect(() => {
    if (visible) {
      recoveredTouched.current = false
      setF({
        responsible_party: accident.responsible_party ?? '',
        liable_party: accident.liable_party ?? '',
        payer: accident.payer ?? '',
        driver_name: accident.driver_name ?? '',
        insurer: accident.insurer ?? '',
        policy_no: accident.policy_no ?? '',
        insurance_claim_no: a.insurance_claim_no ?? '',
        claim_status: accident.claim_status ?? 'none',
        claim_amount: accident.claim_amount != null ? String(accident.claim_amount) : '',
        claim_approved_amount: accident.claim_approved_amount != null ? String(accident.claim_approved_amount) : '',
        deductible: accident.deductible != null ? String(accident.deductible) : '',
        recovered_amount: accident.recovered_amount != null ? String(accident.recovered_amount) : '',
        recovery_date: accident.recovery_date ?? '',
        recovery_reference: accident.recovery_reference ?? '',
        recovery_source: accident.recovery_source ?? 'none',
        recovery_status: accident.recovery_status ?? 'pending',
        fault_status: a.fault_status ?? '',
        gcc_liability_ratio: a.gcc_liability_ratio != null ? String(a.gcc_liability_ratio) : '',
        najm_status: a.najm_status ?? '',
        najm_fault: a.najm_fault ?? '',
        taqdeer_status: a.taqdeer_status ?? '',
        taqdeer_no: a.taqdeer_no ?? '',
        damage_condition: a.damage_condition ?? '',
        amount_transfer: a.amount_transfer != null ? String(a.amount_transfer) : '',
        repair_type: a.repair_type ?? '',
        workshop_name: a.workshop_name ?? '',
        workshop_location: a.workshop_location ?? '',
        repair_cost: a.repair_cost != null ? String(a.repair_cost) : '',
        expected_release_date: a.expected_release_date ?? '',
        release_date: a.release_date ?? '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, accident])

  // Recovered = Claim - Approved - Deductible until the user overrides it.
  useEffect(() => {
    if (recoveredTouched.current) return
    const r = computeRecovered(f.claim_amount, f.claim_approved_amount, f.deductible)
    const next = r > 0 ? String(r) : ''
    setF(prev => (prev.recovered_amount === next ? prev : { ...prev, recovered_amount: next }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.claim_amount, f.claim_approved_amount, f.deductible])

  const set = (k: keyof typeof f, v: any) => setF(prev => ({ ...prev, [k]: v }))
  const inputStyle = [styles.input, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]

  async function save() {
    setSaving(true)
    const internal = repairIsInternal(f.repair_type)
    const { error } = await supabase.from('accidents').update({
      responsible_party: f.responsible_party.trim() || null,
      liable_party: f.liable_party || null,
      payer: f.payer || null,
      driver_name: f.driver_name.trim() || null,
      insurer: f.insurer.trim() || null,
      policy_no: f.policy_no.trim() || null,
      insurance_claim_no: f.insurance_claim_no.trim() || null,
      claim_status: f.claim_status,
      claim_amount: f.claim_amount ? Number(f.claim_amount) : null,
      claim_approved_amount: f.claim_approved_amount ? Number(f.claim_approved_amount) : null,
      deductible: f.deductible ? Number(f.deductible) : null,
      recovered_amount: f.recovered_amount ? Number(f.recovered_amount) : null,
      recovery_date: f.recovery_date.trim() || null,
      recovery_reference: f.recovery_reference.trim() || null,
      recovery_source: f.recovery_source,
      recovery_status: f.recovery_status,
      // GCC case / classification
      fault_status: f.fault_status || null,
      gcc_liability_ratio: f.gcc_liability_ratio !== '' ? Number(f.gcc_liability_ratio) : null,
      najm_status: f.najm_status || null,
      najm_fault: najmHasReport(f.najm_status) ? (f.najm_fault || null) : null,
      taqdeer_status: f.taqdeer_status || null,
      taqdeer_no: taqdeerHasReport(f.taqdeer_status) ? (f.taqdeer_no.trim() || null) : null,
      damage_condition: f.damage_condition || null,
      amount_transfer: f.amount_transfer ? Number(f.amount_transfer) : null,
      // Repair & release
      repair_type: f.repair_type || null,
      workshop_name: f.workshop_name.trim() || null,
      workshop_location: f.workshop_location.trim() || null,
      repair_cost: internal && f.repair_cost ? Number(f.repair_cost) : null,
      expected_release_date: f.expected_release_date.trim() || null,
      release_date: f.release_date.trim() || null,
    }).eq('id', accident.id)
    setSaving(false)
    if (error) { Alert.alert('Error', toUserMessage(error)); return }
    onSaved()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.sheetBackdrop, { backgroundColor: c.overlay }]}>
        <View style={[styles.sheet, { backgroundColor: c.surface, maxHeight: '90%' }]}>
          <View style={[styles.handle, { backgroundColor: c.borderStrong }]} />
          <AppText variant="h3">Edit Claim and Responsibility</AppText>
          <View style={{ gap: spacing.md }}>
            <Field label="Responsible party"><TextInput style={inputStyle} value={f.responsible_party} onChangeText={v => set('responsible_party', v)} placeholder="Who is at fault" placeholderTextColor={c.textMuted} /></Field>
            <Field label="Liable party">
              <ChipPick options={LIABLE_PARTY_OPTS} value={f.liable_party} onSelect={v => set('liable_party', v)} c={c} styles={styles} clearable />
            </Field>
            <Field label="Who pays">
              <ChipPick options={PAYER_OPTS} value={f.payer} onSelect={v => set('payer', v)} c={c} styles={styles} clearable />
            </Field>

            {/* GCC case / liability */}
            <View style={styles.divider} />
            <AppText variant="label" color="secondary" style={{ textTransform: 'uppercase' }}>GCC Case & Liability</AppText>
            <Field label="Fault status">
              <ChipPick options={FAULT_STATUS_OPTS} value={f.fault_status} onSelect={v => set('fault_status', v)} c={c} styles={styles} clearable />
            </Field>
            <Field label="GCC liability %">
              <ChipPick options={LIABILITY_RATIO_OPTS} value={f.gcc_liability_ratio} onSelect={v => set('gcc_liability_ratio', v)} c={c} styles={styles} display={v => `${v}%`} clearable />
            </Field>
            <Field label="Najm report">
              <ChipPick options={NAJM_STATUS_OPTS} value={f.najm_status} onSelect={v => set('najm_status', najmHasReport(v) ? v : v)} c={c} styles={styles} clearable />
            </Field>
            {najmHasReport(f.najm_status) && (
              <Field label="Najm fault">
                <ChipPick options={NAJM_FAULT_OPTS} value={f.najm_fault} onSelect={v => set('najm_fault', v)} c={c} styles={styles} clearable />
              </Field>
            )}
            <Field label="Taqdeer report">
              <ChipPick options={TAQDEER_STATUS_OPTS} value={f.taqdeer_status} onSelect={v => set('taqdeer_status', v)} c={c} styles={styles} clearable />
            </Field>
            {taqdeerHasReport(f.taqdeer_status) && (
              <Field label="Taqdeer no"><TextInput style={inputStyle} value={f.taqdeer_no} onChangeText={v => set('taqdeer_no', v)} placeholder="Estimation reference" placeholderTextColor={c.textMuted} /></Field>
            )}
            <Field label="Damage condition">
              <ChipPick options={DAMAGE_CONDITION_OPTS} value={f.damage_condition} onSelect={v => set('damage_condition', v)} c={c} styles={styles} clearable />
            </Field>

            {/* Insurance */}
            <View style={styles.divider} />
            <AppText variant="label" color="secondary" style={{ textTransform: 'uppercase' }}>Insurance</AppText>
            <View style={styles.twoCol}>
              <Field label="Driver" flex><TextInput style={inputStyle} value={f.driver_name} onChangeText={v => set('driver_name', v)} placeholderTextColor={c.textMuted} /></Field>
              <Field label="Insurer" flex><TextInput style={inputStyle} value={f.insurer} onChangeText={v => set('insurer', v)} placeholderTextColor={c.textMuted} /></Field>
            </View>
            <View style={styles.twoCol}>
              <Field label="Policy No" flex><TextInput style={inputStyle} value={f.policy_no} onChangeText={v => set('policy_no', v)} placeholderTextColor={c.textMuted} /></Field>
              <Field label="Claim No" flex><TextInput style={inputStyle} value={f.insurance_claim_no} onChangeText={v => set('insurance_claim_no', v)} placeholderTextColor={c.textMuted} /></Field>
            </View>
            <Field label="Claim status">
              <View style={styles.chipWrap}>
                {CLAIM_STATUSES.map(s => {
                  const active = f.claim_status === s
                  const cc = CLAIM_STATUS_COLORS[s]
                  return (
                    <TouchableOpacity key={s} style={[styles.pickChip, { borderColor: c.border }, active && { backgroundColor: cc + '1F', borderColor: cc }]} onPress={() => set('claim_status', s)}>
                      <AppText variant="caption" style={{ color: active ? cc : c.textMuted }}>{CLAIM_STATUS_LABELS[s]}</AppText>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </Field>
            <View style={styles.twoCol}>
              <Field label="Claim amount" flex><TextInput style={inputStyle} value={f.claim_amount} onChangeText={v => set('claim_amount', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.textMuted} /></Field>
              <Field label="Approved" flex><TextInput style={inputStyle} value={f.claim_approved_amount} onChangeText={v => set('claim_approved_amount', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.textMuted} /></Field>
            </View>
            <Field label="Deductible"><TextInput style={inputStyle} value={f.deductible} onChangeText={v => set('deductible', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.textMuted} /></Field>

            {/* Recovery */}
            <View style={styles.divider} />
            <AppText variant="label" color="secondary" style={{ textTransform: 'uppercase' }}>Cost Recovery</AppText>
            <View style={styles.twoCol}>
              <Field label="Recovered (auto)" flex><TextInput style={inputStyle} value={f.recovered_amount} onChangeText={v => { recoveredTouched.current = true; set('recovered_amount', v) }} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.textMuted} /></Field>
              <Field label="Recovery date" flex><TextInput style={inputStyle} value={f.recovery_date} onChangeText={v => set('recovery_date', v)} placeholder="YYYY-MM-DD" placeholderTextColor={c.textMuted} /></Field>
            </View>
            <Field label="Recovery source">
              <View style={styles.chipWrap}>
                {RECOVERY_SOURCES.map(s => {
                  const active = f.recovery_source === s
                  return (
                    <TouchableOpacity key={s} style={[styles.pickChip, { borderColor: c.border }, active && { backgroundColor: c.success.soft, borderColor: c.success.base }]} onPress={() => set('recovery_source', s)}>
                      <AppText variant="caption" style={{ color: active ? c.success.base : c.textMuted }}>{RECOVERY_SOURCE_LABELS[s]}</AppText>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </Field>
            <Field label="Recovery status">
              <View style={styles.chipWrap}>
                {RECOVERY_STATUSES.map(s => {
                  const active = f.recovery_status === s
                  const rc = RECOVERY_STATUS_COLORS[s]
                  return (
                    <TouchableOpacity key={s} style={[styles.pickChip, { borderColor: c.border }, active && { backgroundColor: rc + '1F', borderColor: rc }]} onPress={() => set('recovery_status', s)}>
                      <AppText variant="caption" style={{ color: active ? rc : c.textMuted }}>{RECOVERY_STATUS_LABELS[s]}</AppText>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </Field>
            <View style={styles.twoCol}>
              <Field label="Recovery reference" flex><TextInput style={inputStyle} value={f.recovery_reference} onChangeText={v => set('recovery_reference', v)} placeholderTextColor={c.textMuted} /></Field>
              <Field label="Amount transfer" flex><TextInput style={inputStyle} value={f.amount_transfer} onChangeText={v => set('amount_transfer', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.textMuted} /></Field>
            </View>

            {/* Repair & release */}
            <View style={styles.divider} />
            <AppText variant="label" color="secondary" style={{ textTransform: 'uppercase' }}>Repair & Release</AppText>
            <Field label="Repair type">
              <ChipPick options={REPAIR_TYPE_OPTS} value={f.repair_type} onSelect={v => set('repair_type', v)} c={c} styles={styles} clearable />
            </Field>
            <View style={styles.twoCol}>
              <Field label="Workshop" flex><TextInput style={inputStyle} value={f.workshop_name} onChangeText={v => set('workshop_name', v)} placeholder={repairIsInternal(f.repair_type) ? 'GCC Workshop' : 'External'} placeholderTextColor={c.textMuted} /></Field>
              <Field label="Workshop location" flex><TextInput style={inputStyle} value={f.workshop_location} onChangeText={v => set('workshop_location', v)} placeholderTextColor={c.textMuted} /></Field>
            </View>
            {repairIsInternal(f.repair_type) && (
              <Field label="Repair cost"><TextInput style={inputStyle} value={f.repair_cost} onChangeText={v => set('repair_cost', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.textMuted} /></Field>
            )}
            <View style={styles.twoCol}>
              <Field label="Expected release" flex><TextInput style={inputStyle} value={f.expected_release_date} onChangeText={v => set('expected_release_date', v)} placeholder="YYYY-MM-DD" placeholderTextColor={c.textMuted} /></Field>
              <Field label="Release date" flex><TextInput style={inputStyle} value={f.release_date} onChangeText={v => set('release_date', v)} placeholder="YYYY-MM-DD" placeholderTextColor={c.textMuted} /></Field>
            </View>
          </View>
          <View style={styles.sheetBtns}>
            <TouchableOpacity style={[styles.sheetCancel, { backgroundColor: c.surfaceAlt }]} onPress={onClose}><AppText variant="bodyStrong" color="secondary">Cancel</AppText></TouchableOpacity>
            <TouchableOpacity style={[styles.sheetSave, { backgroundColor: c.danger.base }]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <AppText variant="bodyStrong" style={{ color: '#fff' }}>Save</AppText>}
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
      <AppText variant="micro" color="secondary" style={{ textTransform: 'uppercase' }}>{label}</AppText>
      {children}
    </View>
  )
}

/** Single-select chip picker for a constrained vocabulary (tap to toggle). */
function ChipPick({
  options, value, onSelect, c, styles, display, clearable,
}: {
  options: readonly string[]
  value: string
  onSelect: (v: string) => void
  c: Theme['color']
  styles: any
  display?: (v: string) => string
  clearable?: boolean
}) {
  return (
    <View style={styles.chipWrap}>
      {options.map(opt => {
        const active = opt === value
        return (
          <TouchableOpacity
            key={opt}
            style={[styles.pickChip, { borderColor: c.border }, active && { backgroundColor: c.danger.soft, borderColor: c.danger.base }]}
            onPress={() => onSelect(clearable && active ? '' : opt)}
          >
            <AppText variant="caption" style={{ color: active ? c.danger.on : c.textMuted }}>{display ? display(opt) : opt}</AppText>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

function createStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    section: {
      backgroundColor: c.surface, borderRadius: radius.xl, overflow: 'hidden',
      borderWidth: 1, borderColor: c.border,
    },
    sectionHeader: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm + 2,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    sectionTitle: { color: c.text, flex: 1, textTransform: 'none' },
    sectionBody: { padding: spacing.lg, gap: spacing.md },
    editLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },

    banner: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      borderWidth: 1, borderRadius: radius.md, padding: spacing.md,
    },
    rowBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
    btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, borderRadius: radius.md },
    btnText: { color: '#fff' },

    claimStatusRow: { flexDirection: 'row' },
    claimChip: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.sm, borderWidth: 1 },

    infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
    infoValue: { textAlign: 'right', flex: 1.4 },
    divider: { height: 1, backgroundColor: c.border, marginVertical: spacing.xs },
    netRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },

    partRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
    partStatus: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
    partsTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.sm },

    addRemarkRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
    remarkInput: {
      flex: 1, borderWidth: 1, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, fontSize: 14,
      minHeight: 44, maxHeight: 110,
    },
    remarkSend: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },

    logRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm + 2 },
    logRowBorder: { borderBottomWidth: 1, borderBottomColor: c.border },
    logIcon: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },

    // Prompt modal
    promptBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing['2xl'] },
    promptCard: { width: '100%', borderRadius: radius['2xl'], padding: spacing.xl, gap: spacing.md },
    promptInput: {
      borderWidth: 1, borderRadius: radius.md,
      padding: spacing.md, fontSize: 15, minHeight: 72, textAlignVertical: 'top',
    },
    promptBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
    promptCancel: { flex: 1, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    promptConfirm: { flex: 1.4, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },

    // Sheet modal (parts / claim)
    sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
    sheet: { borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'], padding: spacing.xl, paddingBottom: Platform.OS === 'ios' ? 36 : spacing['2xl'], gap: spacing.md, maxHeight: '88%' },
    handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.xs },
    twoCol: { flexDirection: 'row', gap: spacing.md },
    input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, fontSize: 15 },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    pickChip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1.5 },
    sheetBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
    sheetCancel: { flex: 1, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    sheetSave: { flex: 1.4, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  })
}
