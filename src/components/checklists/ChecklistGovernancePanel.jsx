import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, Save, AlertTriangle } from 'lucide-react'
import {
  getChecklistGovernancePolicy,
  saveChecklistGovernancePolicy,
} from '../../lib/api/checklistSchedules'
import { toUserMessage } from '../../lib/safeError'

const INDUSTRIES = [
  'general', 'construction', 'mining', 'logistics', 'manufacturing',
  'utilities', 'oil_gas', 'aviation', 'healthcare', 'food', 'public_sector',
]

const numberFields = [
  ['supervisor_approval_sla_hours', 'Supervisor approval', 'hours'],
  ['area_manager_approval_sla_hours', 'Area manager approval', 'hours'],
  ['corrective_critical_sla_hours', 'Critical correction', 'hours'],
  ['corrective_high_sla_hours', 'High correction', 'hours'],
  ['corrective_medium_sla_hours', 'Medium correction', 'hours'],
  ['corrective_low_sla_hours', 'Low correction', 'hours'],
  ['submission_retention_months', 'Checklist retention', 'months'],
  ['evidence_retention_months', 'Evidence retention', 'months'],
  ['audit_retention_months', 'Audit retention', 'months'],
]

const evidenceFields = [
  ['exception_note_required', 'Note for every exception'],
  ['exception_photo_required', 'Photo for every exception'],
  ['completion_signature_required', 'Completion signature'],
  ['gps_required', 'GPS coordinates'],
]

export default function ChecklistGovernancePanel({ activeCountry, siteOptions = [] }) {
  const [policy, setPolicy] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      setPolicy(await getChecklistGovernancePolicy())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load checklist governance.'))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const set = (key, value) => setPolicy((current) => ({ ...current, [key]: value }))
  const sites = siteOptions.map((item) => typeof item === 'string' ? item : item?.value || item?.name)
    .filter(Boolean)

  async function onSave(event) {
    event.preventDefault()
    setError(''); setSaved('')
    if (policy.pilot_enabled && (!String(policy.pilot_site || '').trim() || !policy.pilot_start_date)) {
      setError('An enabled pilot requires a site and start date.')
      return
    }
    setSaving(true)
    try {
      const payload = { ...policy }
      for (const [key] of numberFields) payload[key] = Number(payload[key])
      if (payload.pilot_enabled && !payload.pilot_country && activeCountry !== 'All') {
        payload.pilot_country = activeCountry
      }
      setPolicy(await saveChecklistGovernancePolicy(payload))
      setSaved('Governance policy saved. New schedules and records use these controls.')
    } catch (err) {
      setError(toUserMessage(err, 'Could not save checklist governance.'))
    } finally {
      setSaving(false)
    }
  }

  if (!policy) return error
    ? <div className="card text-sm text-red-300">{error}</div>
    : <div className="card text-sm text-[var(--text-muted)]">Loading governance policy...</div>

  return (
    <form onSubmit={onSave} className="card space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck size={20} className="mt-0.5 text-cyan-400" />
          <div>
            <h2 className="font-semibold text-[var(--text-primary)]">Checklist governance</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Organisation-wide pilot, SLA, evidence and retention rules. Checklist questions are unchanged.
            </p>
          </div>
        </div>
        <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
          <Save size={15} /> {saving ? 'Saving...' : 'Save policy'}
        </button>
      </div>

      {(error || saved) && (
        <div role="status" className={`rounded-lg border px-3 py-2 text-sm ${error ? 'border-red-700/60 bg-red-950/30 text-red-200' : 'border-green-700/60 bg-green-950/30 text-green-200'}`}>
          {error || saved}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <label className="text-sm text-[var(--text-muted)]">Industry profile
          <input list="checklist-industries" value={policy.industry_profile || ''} onChange={(e) => set('industry_profile', e.target.value)} className="input mt-1 w-full" required />
          <datalist id="checklist-industries">{INDUSTRIES.map((v) => <option key={v} value={v} />)}</datalist>
        </label>
        <label className="text-sm text-[var(--text-muted)]">Operational timezone
          <input value={policy.timezone || 'UTC'} onChange={(e) => set('timezone', e.target.value)} className="input mt-1 w-full" required />
        </label>
        <label className="text-sm text-[var(--text-muted)]">Evidence enforcement
          <select value={policy.evidence_enforcement || 'monitor'} onChange={(e) => set('evidence_enforcement', e.target.value)} className="input mt-1 w-full">
            <option value="monitor">Monitor gaps</option>
            <option value="enforce">Block incomplete evidence</option>
          </select>
        </label>
      </div>

      <fieldset className="rounded-xl border border-[var(--border-dim)] p-4">
        <legend className="px-2 text-sm font-medium text-[var(--text-primary)]">Controlled pilot</legend>
        <label className="mb-3 flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <input type="checkbox" checked={Boolean(policy.pilot_enabled)} onChange={(e) => set('pilot_enabled', e.target.checked)} /> Enable pilot boundary
        </label>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm text-[var(--text-muted)]">Country<input value={policy.pilot_country || ''} onChange={(e) => set('pilot_country', e.target.value)} className="input mt-1 w-full" /></label>
          <label className="text-sm text-[var(--text-muted)]">Site<input list="checklist-pilot-sites" value={policy.pilot_site || ''} onChange={(e) => set('pilot_site', e.target.value)} className="input mt-1 w-full" /></label>
          <datalist id="checklist-pilot-sites">{sites.map((v) => <option key={v} value={v} />)}</datalist>
          <label className="text-sm text-[var(--text-muted)]">Start<input type="date" value={policy.pilot_start_date || ''} onChange={(e) => set('pilot_start_date', e.target.value || null)} className="input mt-1 w-full" /></label>
          <label className="text-sm text-[var(--text-muted)]">End<input type="date" value={policy.pilot_end_date || ''} onChange={(e) => set('pilot_end_date', e.target.value || null)} className="input mt-1 w-full" /></label>
        </div>
      </fieldset>

      <div>
        <h3 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Service levels and retention</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {numberFields.map(([key, label, unit]) => (
            <label key={key} className="text-sm text-[var(--text-muted)]">{label}
              <div className="mt-1 flex items-center gap-2"><input type="number" min="1" value={policy[key] ?? ''} onChange={(e) => set(key, e.target.value)} className="input min-w-0 flex-1" required /><span className="text-xs">{unit}</span></div>
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <fieldset className="rounded-xl border border-[var(--border-dim)] p-4">
          <legend className="px-2 text-sm font-medium text-[var(--text-primary)]">Required evidence</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {evidenceFields.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><input type="checkbox" checked={Boolean(policy[key])} onChange={(e) => set(key, e.target.checked)} />{label}</label>)}
          </div>
        </fieldset>
        <fieldset className="rounded-xl border border-[var(--border-dim)] p-4">
          <legend className="px-2 text-sm font-medium text-[var(--text-primary)]">End-of-retention action</legend>
          <select value={policy.retention_disposition || 'review_then_archive'} onChange={(e) => set('retention_disposition', e.target.value)} className="input w-full">
            <option value="review_then_archive">Review, then archive</option>
            <option value="review_then_delete">Review, then approved deletion</option>
            <option value="retain">Retain indefinitely</option>
          </select>
          <p className="mt-2 flex gap-2 text-xs text-amber-300"><AlertTriangle size={14} className="shrink-0" />No automatic deletion occurs. Legal holds always remain excluded from disposition.</p>
        </fieldset>
      </div>
    </form>
  )
}
