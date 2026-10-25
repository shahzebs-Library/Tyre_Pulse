import { useEffect, useMemo, useState } from 'react'
import Modal from '../ui/Modal'
import { PM_TEMPLATES } from '../../lib/pmTemplates'
import { planPmFromTemplate } from '../../lib/pmBulkPlan'
import { listAssets } from '../../lib/api/assets'
import { bulkCreatePmPrograms } from '../../lib/api/pmPrograms'
import { toUserMessage } from '../../lib/safeError'

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Create maintenance plans for every matching active vehicle from one service template. */
export default function PmBulkFromTemplate({ country, plans, onClose, onDone }) {
  const [templateId, setTemplateId] = useState(PM_TEMPLATES[0]?.id || '')
  const [vehicles, setVehicles] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState(null)

  useEffect(() => {
    let live = true
    listAssets({ country: country && country !== 'All' ? country : undefined, status: 'Active' })
      .then((rows) => { if (live) setVehicles(rows) })
      .catch((err) => { if (live) setError(toUserMessage(err, 'Could not load the fleet.')) })
    return () => { live = false }
  }, [country])

  const template = PM_TEMPLATES.find((t) => t.id === templateId)
  const plan = useMemo(
    () => (vehicles && template ? planPmFromTemplate(template, vehicles, { today: todayISO(), existing: plans }) : null),
    [vehicles, template, plans],
  )

  const create = async () => {
    if (!plan?.rows.length) return
    setSaving(true); setError('')
    try {
      const n = await bulkCreatePmPrograms(plan.rows)
      setCreated(n)
      onDone?.(n)
    } catch (err) { setError(toUserMessage(err, 'Could not create the plans.')) }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={() => { if (!saving) onClose() }} size="lg" title="Create plans from a template"
      subtitle="One plan per matching active vehicle. Existing identical plans are skipped.">
      <div className="space-y-4">
        <label className="block text-xs text-[var(--text-secondary)]">Service template
          <select className="input w-full mt-1" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setCreated(null) }} disabled={saving}>
            {PM_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        {template && <p className="text-xs text-[var(--text-muted)]">Every {template.interval_value} {template.interval_type}
          {template.meter_interval ? ` or ${template.meter_interval} ${template.meter_source === 'engine_hours' ? 'engine hours' : 'km'}` : ''}. {template.tasks.length} tasks.</p>}
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        {!vehicles && !error && <p role="status" className="text-sm text-[var(--text-muted)]">Loading the fleet</p>}
        {plan && created === null && (
          <div className="rounded-lg border border-[var(--border-dim)] p-3 text-sm space-y-1">
            <div><strong>{plan.rows.length}</strong> plan{plan.rows.length === 1 ? '' : 's'} will be created</div>
            <div className="text-[var(--text-muted)]">{plan.skippedExisting} already have this plan. {plan.skippedNoFit} vehicles do not fit this template.</div>
            {plan.rows.length > 0 && <div className="text-[var(--text-muted)]">Examples: {plan.rows.slice(0, 5).map((r) => r.asset_no).join(', ')}{plan.rows.length > 5 ? ` and ${plan.rows.length - 5} more` : ''}</div>}
            <p className="text-xs text-amber-500 pt-1">The first due date is one interval from today. Record a real service on each vehicle to set its true schedule.</p>
          </div>
        )}
        {created !== null && <p role="status" className="text-sm text-green-500">{created} plan{created === 1 ? '' : 's'} created.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>{created !== null ? 'Close' : 'Cancel'}</button>
          {created === null && <button type="button" className="btn-primary" onClick={create} disabled={saving || !plan?.rows.length}>{saving ? 'Creating' : 'Create plans'}</button>}
        </div>
      </div>
    </Modal>
  )
}
