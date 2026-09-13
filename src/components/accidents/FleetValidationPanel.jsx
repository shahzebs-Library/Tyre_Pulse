/**
 * FleetValidationPanel — the "Fleet Validation" case tab: an incident summary,
 * a derived fleet-readiness checklist, the workstream's own progress control,
 * and a notify-insurance section.
 *
 * There is no dedicated fleet-validation-checklist table (see the header of
 * src/lib/fleetValidation.js for why): every checklist item is DERIVED from a
 * real, already-recorded fact (the incident row, the fleet register, the
 * authority reports already captured on Responsibility & Payment) rather than
 * a second, disconnected set of tick-boxes someone could check with nothing
 * behind them. The 'fleet_validation' workstream - already a real row on
 * accident_case_workstreams, the same table every other case tab's progress
 * lives on - is what a Fleet Supervisor actually advances once satisfied.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Truck, CheckCircle2, XCircle, Loader2, RefreshCw, AlertCircle, User, MapPin, Calendar, Car,
} from 'lucide-react'
import { listWorkstreams, setWorkstreamStatus } from '../../lib/api/accidentCase'
import { WORKSTREAM_STATUS } from '../../lib/accidentCase'
import { listAuthorityReports } from '../../lib/api/accidentLiability'
import { getAssetByNo } from '../../lib/api/assets'
import { buildValidationChecklist, validationSummary } from '../../lib/fleetValidation'
import NotifyRecipientsPanel from './NotifyRecipientsPanel'
import { toUserMessage } from '../../lib/safeError'

const INSURANCE_RECIPIENTS = [
  { key: 'insurer', label: 'Insurance team' },
  { key: 'underwriter', label: 'Underwriter' },
  { key: 'claims_desk', label: 'Claims desk' },
]

const STATUS_LABEL = {
  not_required: 'Not required', not_started: 'Not started', assigned: 'Assigned', in_progress: 'In progress',
  waiting_info: 'Waiting for info', waiting_approval: 'Waiting for approval', waiting_external: 'Waiting externally',
  on_hold: 'On hold', completed: 'Completed', rejected: 'Rejected', reopened: 'Reopened', cancelled: 'Cancelled',
}
const ADVANCE_STATUSES = [WORKSTREAM_STATUS.IN_PROGRESS, WORKSTREAM_STATUS.COMPLETED, WORKSTREAM_STATUS.ON_HOLD]

function SummaryRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon size={13} className="text-[var(--text-muted)] shrink-0" />
      <span className="text-[var(--text-muted)] w-28 shrink-0">{label}</span>
      <span className="text-[var(--text-primary)] truncate">{value || 'N/A'}</span>
    </div>
  )
}

export default function FleetValidationPanel({ accidentId, elevated, acc, onChanged }) {
  const [workstream, setWorkstream] = useState(null) // null=loading, {}=none yet
  const [asset, setAsset] = useState(null)
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [wsRows, r, a] = await Promise.all([
        listWorkstreams(accidentId, { country: acc?.country }),
        listAuthorityReports(accidentId),
        acc?.asset_no ? getAssetByNo(acc.asset_no, acc?.country) : Promise.resolve(null),
      ])
      setWorkstream(wsRows.find((w) => w.workstream_key === 'fleet_validation') || {})
      setReports(r)
      setAsset(a)
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load fleet validation.'))
    } finally {
      setLoading(false)
    }
  }, [accidentId, acc?.country, acc?.asset_no])

  useEffect(() => { load() }, [load])

  async function advance(status) {
    if (saving) return
    setSaving(true); setErr('')
    try {
      const saved = await setWorkstreamStatus(accidentId, 'fleet_validation', { status })
      setWorkstream(saved)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not update the fleet validation status.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading fleet validation…</div>
  }

  const items = buildValidationChecklist({ acc, asset, authorityReports: reports })
  const summary = validationSummary(items)

  return (
    <div className="p-6 space-y-6">
      <section className="card space-y-3">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2"><Truck size={16} /> Incident summary</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <SummaryRow icon={Car} label="Asset" value={acc?.asset_no} />
          <SummaryRow icon={User} label="Driver" value={acc?.driver_name} />
          <SummaryRow icon={MapPin} label="Site" value={acc?.site} />
          <SummaryRow icon={Calendar} label="Incident date" value={acc?.incident_date ? new Date(acc.incident_date).toLocaleDateString() : null} />
        </div>
      </section>

      <section className="card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-[var(--text-primary)]">Fleet validation checklist</h3>
          <span className={`text-xs font-semibold ${summary.complete ? 'text-green-400' : 'text-amber-400'}`}>
            {summary.passed} of {summary.total} passed
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
          <div className={`h-full ${summary.complete ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${summary.total ? Math.round((summary.passed / summary.total) * 100) : 0}%` }} />
        </div>
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.key} className="flex items-start gap-2.5 rounded-lg border border-[var(--input-border)] px-3 py-2">
              {it.passed
                ? <CheckCircle2 size={15} className="text-green-400 shrink-0 mt-0.5" />
                : <XCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />}
              <div className="min-w-0">
                <p className="text-sm text-[var(--text-primary)]">{it.label}</p>
                <p className="text-[11px] text-[var(--text-muted)] truncate">{it.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="pt-3 border-t border-[var(--input-border)] flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Workstream status</p>
            <p className="text-sm font-semibold text-[var(--text-primary)]">{STATUS_LABEL[workstream?.status] || 'Not started'}</p>
          </div>
          {elevated && (
            <div className="flex gap-2">
              {ADVANCE_STATUSES.map((s) => (
                <button key={s} type="button" className="btn-secondary text-xs" disabled={saving || workstream?.status === s} onClick={() => advance(s)}>
                  {saving ? <Loader2 size={12} className="animate-spin" /> : STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          )}
        </div>
        {err && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertCircle size={12} /> {err} <button className="underline inline-flex items-center gap-1" onClick={load}><RefreshCw size={10} /> Retry</button></p>}
      </section>

      <section className="card">
        <NotifyRecipientsPanel
          accidentId={accidentId}
          workstreamKey="fleet_validation"
          recipients={INSURANCE_RECIPIENTS}
          title="Notify insurance"
          subject="Fleet validation complete"
        />
      </section>
    </div>
  )
}
