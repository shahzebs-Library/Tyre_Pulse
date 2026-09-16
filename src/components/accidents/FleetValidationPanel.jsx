/**
 * FleetValidationPanel - the "Fleet Validation" case tab, field for field the
 * owner's mock M6:
 *
 *   header strip (severity + Open/Closed + WorkstreamHeader)
 *   incident summary card ("View complete incident report" = the case PDF)
 *   the six-item checklist (state icon, label, count, time, note, chevron)
 *   Notify Insurance / Claims block
 *   footer "<Command Center owner> · Command Center is monitoring SLA"
 *   "Complete Fleet validation and notify <insurance owner>" + "Save progress"
 *
 * Every state has two layers (src/lib/fleetValidation.js): a SUGGESTED state
 * derived from real case data and a SAVED state a Fleet Supervisor records on
 * accident_fleet_validation_items. Until that table is applied live the panel
 * still renders the derived checklist and says plainly that ticks are not
 * saved. Notifications here write accident_case_communications rows (the case
 * timeline); they do not send email/push themselves - the gated
 * accidentWorkflow engine owns live delivery.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2, AlertTriangle, Clock, MinusCircle, ChevronRight, StickyNote, Loader2, RefreshCw,
  AlertCircle, FileText, Send, MailQuestion, Save, ShieldAlert, Info,
} from 'lucide-react'
import { listWorkstreams, setWorkstreamStatus } from '../../lib/api/accidentCase'
import { listAuthorityReports } from '../../lib/api/accidentLiability'
import { getDamageAssessment } from '../../lib/api/accidentDamageAssessment'
import { getAssetByNo } from '../../lib/api/assets'
import { listProfiles } from '../../lib/api/users'
import { logCommunication } from '../../lib/api/accidentCommunications'
import { listFleetValidationItems, upsertFleetValidationItem, upsertFleetValidationItems } from '../../lib/api/fleetValidationItems'
import { renderAccidentCasePdf } from '../../lib/accidentCasePdf'
import {
  deriveChecklist, mergeChecklist, validationSummary, countLabel, toggleState, resolveRecipient,
  authorityWarning, missingAuthorityDocs, markedAreaCount, photoCount, injuriesLabel, thirdPartyLabel,
  NOTIFY_PACKAGE_TEXT,
} from '../../lib/fleetValidation'
import { caseFlowLabel } from '../../lib/accidentCaseVocab'
import { accidentSeverityPill, isIncidentClosed, canonAccidentType } from '../../lib/accidentVocab'
import WorkstreamHeader from './WorkstreamHeader'
import { useAuth } from '../../contexts/AuthContext'
import { useTenant } from '../../contexts/TenantContext'
import { toUserMessage } from '../../lib/safeError'

const STATE_ICON = {
  done: { Icon: CheckCircle2, cls: 'text-green-500', title: 'Done' },
  attention: { Icon: AlertTriangle, cls: 'text-amber-500', title: 'Needs attention' },
  pending: { Icon: Clock, cls: 'text-[var(--text-muted)]', title: 'Pending' },
  not_applicable: { Icon: MinusCircle, cls: 'text-[var(--text-dim)]', title: 'Not applicable' },
}

const NOT_SET = 'Not set'
const text = (v) => (v != null && String(v).trim() !== '' ? String(v).trim() : NOT_SET)

function hhmm(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function StatePill({ closed }) {
  return closed
    ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">Closed</span>
    : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">Open</span>
}

/**
 * @param {{accidentId:string, elevated:boolean, acc:object, onChanged?:()=>void,
 *   onNavigateTab?:(tabKey:string)=>void}} props
 */
export default function FleetValidationPanel({ accidentId, elevated, acc, onChanged, onNavigateTab }) {
  const { profile } = useAuth()
  const { branding } = useTenant() || {}
  const [workstreams, setWorkstreams] = useState([])
  const [asset, setAsset] = useState(null)
  const [reports, setReports] = useState([])
  const [damage, setDamage] = useState(null)
  const [rows, setRows] = useState([])
  const [persisted, setPersisted] = useState(true)
  const [profiles, setProfiles] = useState([])
  const [dirty, setDirty] = useState(() => new Set())
  const [noteFor, setNoteFor] = useState(null)
  const [sendWhenComplete, setSendWhenComplete] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState('') // 'pdf' | 'request' | 'send' | 'complete' | ''
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')

  const myName = profile?.full_name || profile?.username || null

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [ws, r, a, d, items, people] = await Promise.all([
        listWorkstreams(accidentId, { country: acc?.country }),
        listAuthorityReports(accidentId),
        acc?.asset_no ? getAssetByNo(acc.asset_no, acc?.country).catch(() => null) : Promise.resolve(null),
        getDamageAssessment(accidentId),
        listFleetValidationItems(accidentId),
        listProfiles().catch(() => []),
      ])
      setWorkstreams(ws || [])
      setReports(r || [])
      setAsset(a)
      setDamage(d)
      setRows(items.rows || [])
      setPersisted(items.persisted !== false)
      setProfiles(people || [])
      setDirty(new Set())
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load fleet validation.'))
    } finally {
      setLoading(false)
    }
  }, [accidentId, acc?.country, acc?.asset_no])

  useEffect(() => { load() }, [load])

  const items = useMemo(
    () => mergeChecklist(deriveChecklist({ acc: acc || {}, asset, authorityReports: reports, damageAssessment: damage, workstreams }), rows),
    [acc, asset, reports, damage, workstreams, rows],
  )
  const summary = validationSummary(items)
  const fleetWs = workstreams.find((w) => w.workstream_key === 'fleet_validation') || null
  const fleetOwner = resolveRecipient({ workstreams, profiles, workstreamKey: 'fleet_validation', roleKey: 'fleet' })
  const insurance = resolveRecipient({ workstreams, profiles, workstreamKey: 'insurance', roleKey: 'insurance' })
  const commandCenter = resolveRecipient({ workstreams, profiles, roleKey: 'command_center' })
  const sev = accidentSeverityPill(acc?.severity)
  const closed = isIncidentClosed(acc)
  const warning = authorityWarning(reports)
  const missingDocs = missingAuthorityDocs(reports)
  const completed = fleetWs?.status === 'completed'
  const ctx = { country: acc?.country || null, site: acc?.site || null }

  function patchRow(key, patch) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.item_key === key)
      const base = idx >= 0 ? prev[idx] : { accident_id: accidentId, item_key: key }
      const next = { ...base, ...patch }
      return idx >= 0 ? prev.map((r, i) => (i === idx ? next : r)) : [...prev, next]
    })
  }

  async function toggleRow(item) {
    if (!elevated || saving || completed) return
    const patch = {
      state: toggleState(item.state),
      count_done: item.countable ? item.countDone : null,
      count_required: item.countable ? item.countRequired : null,
      checked_by_id: profile?.id || null,
      checked_by_name: myName,
      checked_at: new Date().toISOString(),
    }
    patchRow(item.key, patch)
    setInfo('')
    if (!persisted) {
      setInfo('Checklist is not saved until the migration is applied. Your ticks stay on this screen only.')
      return
    }
    setSaving(true); setErr('')
    try {
      const saved = await upsertFleetValidationItem(accidentId, item.key, { ...patch, note: item.note || null }, ctx)
      patchRow(item.key, saved)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the checklist item.'))
    } finally {
      setSaving(false)
    }
  }

  function editNote(key, note) {
    patchRow(key, { note })
    setDirty((prev) => new Set(prev).add(key))
  }

  async function saveProgress() {
    if (saving) return
    setInfo(''); setErr('')
    if (!persisted) {
      setInfo('Checklist is not saved until the migration is applied. Notes and ticks stay on this screen only.')
      return
    }
    const entries = items.filter((i) => dirty.has(i.key) || i.saved).map((i) => ({
      itemKey: i.key,
      patch: {
        state: i.state,
        note: i.note || null,
        count_done: i.countable ? i.countDone : null,
        count_required: i.countable ? i.countRequired : null,
        checked_by_id: i.checkedAt ? (rows.find((r) => r.item_key === i.key)?.checked_by_id ?? profile?.id ?? null) : null,
        checked_by_name: i.checkedByName || (i.checkedAt ? myName : null),
        checked_at: i.checkedAt,
      },
    }))
    if (!entries.length) { setInfo('Nothing to save yet.'); return }
    setSaving(true)
    try {
      const saved = await upsertFleetValidationItems(accidentId, entries, ctx)
      setRows((prev) => {
        const map = Object.fromEntries(prev.map((r) => [r.item_key, r]))
        saved.forEach((s) => { map[s.item_key] = s })
        return Object.values(map)
      })
      setDirty(new Set())
      setInfo('Progress saved.')
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save progress.'))
    } finally {
      setSaving(false)
    }
  }

  async function openReport() {
    if (busy) return
    setBusy('pdf'); setErr('')
    try {
      await renderAccidentCasePdf({
        case: { ...acc, workstreams },
        workstreams,
        company: branding?.display_name || 'TyrePulse',
        save: true,
      })
    } catch (e) {
      setErr(toUserMessage(e, 'Could not generate the incident report PDF.'))
    } finally {
      setBusy('')
    }
  }

  async function logNotify(kind) {
    if (busy) return
    setBusy(kind); setErr(''); setInfo('')
    try {
      if (kind === 'request') {
        const docs = missingDocs.map((d) => d.label).join(', ') || 'required documents'
        await logCommunication(accidentId, {
          channel: 'in_app', direction: 'outbound', workstreamKey: 'fleet_validation',
          subject: `Request missing document: ${docs}`,
          body: `Fleet validation is waiting for: ${docs}.`,
          toParty: fleetOwner.label, authorName: myName,
        })
        setInfo(`Logged a request for ${docs} on the case timeline.`)
      } else {
        await logCommunication(accidentId, {
          channel: 'in_app', direction: 'outbound', workstreamKey: 'fleet_validation',
          subject: `Fleet validation details (${summary.passed} of ${summary.total} items) for ${acc?.asset_no || 'incident'}`,
          body: `${NOTIFY_PACKAGE_TEXT}. Priority: ${sev.label || NOT_SET}.${warning ? ` ${warning}` : ''}`,
          toParty: insurance.label, authorName: myName,
        })
        setInfo(`Logged the notification to ${insurance.label} on the case timeline.`)
      }
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not log the notification.'))
    } finally {
      setBusy('')
    }
  }

  async function complete() {
    if (busy || !summary.complete || !elevated) return
    setBusy('complete'); setErr(''); setInfo('')
    try {
      const saved = await setWorkstreamStatus(accidentId, 'fleet_validation', {
        status: 'completed', completed_at: new Date().toISOString(),
      })
      setWorkstreams((prev) => {
        const rest = prev.filter((w) => w.workstream_key !== 'fleet_validation')
        return [...rest, saved]
      })
      await logCommunication(accidentId, {
        channel: 'in_app', direction: 'outbound', workstreamKey: 'fleet_validation',
        subject: `Fleet validation complete for ${acc?.asset_no || 'incident'}`,
        body: `${NOTIFY_PACKAGE_TEXT}. Priority: ${sev.label || NOT_SET}.`,
        toParty: insurance.label, authorName: myName,
      })
      setInfo(`Fleet validation completed and ${insurance.label} notified on the case timeline.`)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not complete fleet validation.'))
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading fleet validation...</div>
  }

  const areas = markedAreaCount(damage)
  const photos = photoCount(acc)
  const locationLine = [acc?.site, acc?.location].filter((v) => v != null && String(v).trim()).join(' · ') || NOT_SET

  return (
    <div className="p-6 space-y-6" data-testid="fleet-validation-panel">
      {/* Header strip */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {sev.label ? <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sev.className}`}>{sev.label} accident</span> : null}
          <StatePill closed={closed} />
          <span className="text-xs text-[var(--text-muted)]">{caseFlowLabel('fleet_validation')}</span>
        </div>
        <WorkstreamHeader accidentId={accidentId} workstreamKey="fleet_validation" workstreams={workstreams} ownerName={fleetOwner.name} />
      </div>

      {err && (
        <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertCircle size={12} /> {err}
          <button type="button" className="underline inline-flex items-center gap-1" onClick={load}><RefreshCw size={10} /> Retry</button>
        </p>
      )}
      {!persisted && (
        <p className="text-xs text-amber-500 flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <Info size={12} /> Checklist is not saved until the migration is applied. States below are derived from the case data.
        </p>
      )}

      {/* Incident summary */}
      <section className="card space-y-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-semibold text-[var(--text-primary)]">{canonAccidentType(acc?.accident_type) || text(acc?.accident_type)}</h3>
            <p className="text-sm text-[var(--text-secondary)]">{locationLine}</p>
          </div>
          <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" disabled={!!busy} onClick={openReport}>
            {busy === 'pdf' ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} View complete incident report
          </button>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          <div className="flex gap-2"><dt className="text-[var(--text-muted)] w-24 shrink-0">Driver</dt><dd className="text-[var(--text-primary)]">{text(acc?.driver_name)}</dd></div>
          <div className="flex gap-2"><dt className="text-[var(--text-muted)] w-24 shrink-0">Damage</dt><dd className="text-[var(--text-primary)]">{areas} marked damage area{areas === 1 ? '' : 's'} · {photos} photo{photos === 1 ? '' : 's'}</dd></div>
          <div className="flex gap-2"><dt className="text-[var(--text-muted)] w-24 shrink-0">Injuries</dt><dd className="text-[var(--text-primary)]">{injuriesLabel(acc)}</dd></div>
          <div className="flex gap-2"><dt className="text-[var(--text-muted)] w-24 shrink-0">Third party</dt><dd className="text-[var(--text-primary)]">{thirdPartyLabel(acc)}</dd></div>
        </dl>
      </section>

      {/* Checklist */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-[var(--text-primary)]">Fleet validation checklist</h3>
          <span className={`text-xs font-semibold ${summary.complete ? 'text-green-400' : 'text-amber-400'}`}>{summary.passed} of {summary.total} done</span>
        </div>
        <ul className="divide-y divide-[var(--input-border)]" role="list">
          {items.map((it) => {
            const meta = STATE_ICON[it.state] || STATE_ICON.pending
            const count = countLabel(it)
            const time = hhmm(it.checkedAt)
            return (
              <li key={it.key} className="py-2" data-testid={`fv-item-${it.key}`}>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    className="flex items-center gap-2.5 flex-1 min-w-0 text-left disabled:cursor-default"
                    disabled={!elevated || saving || completed}
                    aria-pressed={it.state === 'done'}
                    aria-label={`${it.label}: ${meta.title}`}
                    onClick={() => toggleRow(it)}
                  >
                    <meta.Icon size={16} className={`${meta.cls} shrink-0`} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-sm text-[var(--text-primary)]">{it.label}</span>
                      <span className="block text-[11px] text-[var(--text-muted)] truncate">{it.detail}</span>
                    </span>
                  </button>
                  {count ? <span className={`text-xs font-medium shrink-0 ${it.state === 'done' ? 'text-green-400' : it.state === 'attention' ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>{count}</span> : null}
                  <span className="text-[11px] text-[var(--text-muted)] w-12 text-right shrink-0">{time}</span>
                  <button type="button" className={`p-1 rounded ${it.note ? 'text-amber-400' : 'text-[var(--text-muted)]'}`} title={it.note ? 'Edit note' : 'Add note'} aria-label={`Note for ${it.label}`}
                    onClick={() => setNoteFor(noteFor === it.key ? null : it.key)}>
                    <StickyNote size={14} />
                  </button>
                  <button type="button" className="p-1 rounded text-[var(--text-muted)]" title="Open related tab" aria-label={`Open ${it.label}`}
                    disabled={!onNavigateTab} onClick={() => onNavigateTab?.(it.tab)}>
                    <ChevronRight size={16} />
                  </button>
                </div>
                {it.checkedByName && it.checkedAt ? (
                  <p className="pl-7 text-[11px] text-[var(--text-dim)]">Checked by {it.checkedByName}</p>
                ) : null}
                {noteFor === it.key && (
                  <div className="pl-7 pt-2">
                    <textarea
                      className="input text-xs w-full" rows={2} maxLength={500}
                      placeholder="Note for this item"
                      value={it.note || ''}
                      disabled={!elevated}
                      onChange={(e) => editNote(it.key, e.target.value)}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {/* Notify Insurance / Claims */}
      <section className="card space-y-3">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><Send size={15} /> Notify Insurance / Claims</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          <div className="flex gap-2"><dt className="text-[var(--text-muted)] w-36 shrink-0">Assigned recipient</dt><dd className="text-[var(--text-primary)]">{insurance.label}{insurance.name && insurance.role ? <span className="text-[var(--text-muted)]"> · {insurance.role}</span> : null}</dd></div>
          <div className="flex gap-2"><dt className="text-[var(--text-muted)] w-36 shrink-0">Notification priority</dt><dd className="text-[var(--text-primary)]">{sev.label || NOT_SET}</dd></div>
          <div className="flex gap-2 sm:col-span-2"><dt className="text-[var(--text-muted)] w-36 shrink-0">Detailed package includes</dt><dd className="text-[var(--text-primary)]">{NOTIFY_PACKAGE_TEXT}</dd></div>
        </dl>
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input type="checkbox" checked={sendWhenComplete} onChange={(e) => setSendWhenComplete(e.target.checked)} />
          Send when required documents complete
        </label>
        {warning && (
          <p className="text-sm text-amber-500 flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2" role="alert">
            <ShieldAlert size={14} /> {warning}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" disabled={!!busy || !elevated || !missingDocs.length} onClick={() => logNotify('request')}>
            {busy === 'request' ? <Loader2 size={12} className="animate-spin" /> : <MailQuestion size={12} />} Request missing document
          </button>
          <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" disabled={!!busy || !elevated} onClick={() => logNotify('send')}>
            {busy === 'send' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send available details now
          </button>
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">Each action logs a notification on the case timeline. Live email or push delivery is handled by the accident notification engine when it is enabled.</p>
      </section>

      {/* Footer */}
      {commandCenter.name ? (
        <p className="text-xs text-[var(--text-muted)]">{commandCenter.name} · Command Center is monitoring SLA</p>
      ) : null}
      {info && <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5"><Info size={12} /> {info}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-1.5"
          disabled={!summary.complete || !elevated || !!busy || completed}
          onClick={complete}
          title={completed ? 'Fleet validation is already completed' : undefined}
        >
          {busy === 'complete' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          {completed ? 'Fleet validation completed' : `Complete Fleet validation and notify ${insurance.label}`}
        </button>
        <button type="button" className="btn-secondary inline-flex items-center gap-1.5" disabled={saving || !elevated} onClick={saveProgress}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save progress
        </button>
        {!summary.complete && !completed && (
          <span className="text-xs text-[var(--text-muted)]">Complete all required checklist items to enable.</span>
        )}
      </div>
    </div>
  )
}
