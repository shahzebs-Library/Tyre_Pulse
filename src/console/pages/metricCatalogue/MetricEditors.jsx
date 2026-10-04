/**
 * MetricEditors.jsx - the write side of the Metric Catalogue.
 *
 * MetricEditor creates or edits one governed definition; VersionEditor adds a
 * new formula version. Both are Admin / super admin only (metric_registry and
 * metric_versions RLS). Each says in plain English what saving changes and
 * who reads the number, and the caller writes the console audit entry.
 */
import { useEffect, useState } from 'react'
import { Save, GitBranch } from 'lucide-react'
import { Modal, Btn, ImpactBox } from '../../components/ui'
import {
  validateMetricDraft, validateVersionDraft, draftToRow, nextVersion, completeness,
  METRIC_STATUSES, STATUS_LABEL,
} from '../../../lib/metricGovernance'
import { upsertMetric, saveMetricVersion } from '../../../lib/api/metricRegistry'
import { toUserMessage } from '../../../lib/safeError'

const inputCls = 'w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  )
}

const FIELDS = [
  ['name', 'Name', 'Fleet cost per km'],
  ['business_owner', 'Business owner', 'Fleet Engineering'],
  ['unit', 'Unit', 'per km'],
  ['source_module', 'Source module', 'Engineering KPI'],
  ['source_table', 'Source table', 'tyre_records'],
  ['refresh_sla', 'Refresh SLA', 'Daily'],
  ['currency_handling', 'Currency handling', 'Per country, never summed across currencies'],
]

function toDraft(row) {
  return {
    metric_id: row?.metric_id || '',
    name: row?.name || '',
    description: row?.description || '',
    business_owner: row?.business_owner || '',
    unit: row?.unit || '',
    source_module: row?.source_module || '',
    source_table: row?.source_table || '',
    refresh_sla: row?.refresh_sla || '',
    currency_handling: row?.currency_handling || '',
    dashboards: Array.isArray(row?.dashboards) ? row.dashboards.join(', ') : '',
    status: row?.status || '',
  }
}

export function MetricEditor({ open, row, existingIds = [], onClose, onSaved }) {
  const isNew = !row
  const [d, setD] = useState(() => toDraft(row))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setD(toDraft(row)); setErr('') } }, [open, row])
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }))
  const problem = validateMetricDraft(d, { isNew, existingIds })
  const comp = completeness(d)
  const dashCount = String(d.dashboards || '').split(',').map((x) => x.trim()).filter(Boolean).length

  async function save() {
    if (problem) { setErr(problem); return }
    setBusy(true); setErr('')
    try {
      const payload = { ...draftToRow(d), updated_at: new Date().toISOString() }
      if (isNew) payload.active = true
      const saved = await upsertMetric(payload)
      onSaved?.(saved, isNew)
    } catch (e) {
      setErr(toUserMessage(e, 'The definition could not be saved.'))
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} width="max-w-2xl"
      title={isNew ? 'New governed metric' : `Edit ${row?.name || row?.metric_id}`}
      subtitle={isNew ? 'One definition every dashboard will reference.' : row?.metric_id}
      footer={(<>
        <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" icon={Save} busy={busy} disabled={!!problem} onClick={save}>{isNew ? 'Create metric' : 'Save definition'}</Btn>
      </>)}>
      <div className="space-y-3">
        <ImpactBox
          what={isNew ? 'Adds a governed metric to the registry' : 'Changes the governed definition of this metric'}
          change={isNew ? 'A new row appears in the catalogue as Not reviewed until you certify it.' : 'The definition text, owner and source shown everywhere Explain This Number reads it. The formula itself only changes with a new version.'}
          who={dashCount ? `Readers of ${dashCount} dashboard${dashCount === 1 ? '' : 's'} that reference this metric.` : 'No dashboard references it yet.'}
          undo="Yes. Edit it again; the change is in the console audit log."
          stats={[{ label: 'Completeness', value: `${comp.score}%` }, { label: 'Missing', value: comp.missing.length }, { label: 'Dashboards', value: dashCount }]}
        />
        {isNew && (
          <Field label="Metric id (lower case, underscores)">
            <input className={`${inputCls} font-mono`} value={d.metric_id} onChange={set('metric_id')} placeholder="fleet_cpk" autoComplete="off" />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map(([k, label, ph]) => (
            <Field key={k} label={label}>
              <input className={inputCls} value={d[k]} onChange={set(k)} placeholder={ph} autoComplete="off" />
            </Field>
          ))}
          <Field label="Status">
            <select className={inputCls} value={d.status} onChange={set('status')} aria-label="Status">
              <option value="">Not reviewed</option>
              {METRIC_STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Description">
          <textarea className={inputCls} rows={3} value={d.description} onChange={set('description')} placeholder="What the number means and when to use it" />
        </Field>
        <Field label="Dashboards (comma separated)">
          <input className={inputCls} value={d.dashboards} onChange={set('dashboards')} placeholder="Engineering KPI, Board Overview" autoComplete="off" />
        </Field>
        {comp.missing.length > 0 && <p className="text-[11px] text-amber-300">Still missing for certification: {comp.missing.join(', ')}.</p>}
        {(err || (problem && d.name)) && <p role="alert" className="text-xs text-red-300">{err || problem}</p>}
      </div>
    </Modal>
  )
}

export function VersionEditor({ open, metric, versions = [], onClose, onSaved }) {
  const ver = nextVersion(versions)
  const blank = { formula: '', numerator: '', denominator: '', rounding: '', effective_from: new Date().toISOString().slice(0, 10), owner: '', approver: '', change_note: '' }
  const [v, setV] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setV({ ...blank, owner: metric?.business_owner || '' }); setErr('') } }, [open, metric?.metric_id])
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }))
  const problem = validateVersionDraft(v)
  const dashCount = Array.isArray(metric?.dashboards) ? metric.dashboards.length : 0

  async function save() {
    if (problem) { setErr(problem); return }
    setBusy(true); setErr('')
    try {
      const clean = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x || '').trim() || null]))
      const saved = await saveMetricVersion({
        ...clean, metric_id: metric.metric_id, version: ver,
        approved_at: clean.approver ? new Date().toISOString() : null,
      })
      onSaved?.(saved)
    } catch (e) {
      setErr(toUserMessage(e, 'The version could not be saved.'))
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} width="max-w-2xl"
      title={`New formula version ${ver}`} subtitle={metric?.name || metric?.metric_id}
      footer={(<>
        <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" icon={GitBranch} busy={busy} disabled={!!problem} onClick={save}>Add version {ver}</Btn>
      </>)}>
      <div className="space-y-3">
        <ImpactBox tone="warning"
          what={`Adds version ${ver} of the formula`}
          change="The formula history gains a new row from the effective date. Earlier versions stay, so past numbers remain explainable."
          who={dashCount ? `Everyone reading the ${dashCount} dashboard${dashCount === 1 ? '' : 's'} that use this metric once the code adopts it.` : 'No dashboard references this metric yet.'}
          undo="Versions are append-only here. Add a newer version to supersede a mistake."
        />
        <Field label="Formula">
          <textarea className={`${inputCls} font-mono`} rows={3} value={v.formula} onChange={set('formula')} placeholder="sum(tyre_cost) / sum(km_run)" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Numerator"><input className={inputCls} value={v.numerator} onChange={set('numerator')} /></Field>
          <Field label="Denominator"><input className={inputCls} value={v.denominator} onChange={set('denominator')} /></Field>
          <Field label="Rounding"><input className={inputCls} value={v.rounding} onChange={set('rounding')} placeholder="2 decimals" /></Field>
          <Field label="Effective from"><input type="date" className={inputCls} value={v.effective_from} onChange={set('effective_from')} /></Field>
          <Field label="Owner"><input className={inputCls} value={v.owner} onChange={set('owner')} /></Field>
          <Field label="Approver"><input className={inputCls} value={v.approver} onChange={set('approver')} placeholder="Name of the approver" /></Field>
        </div>
        <Field label="What changed (required)">
          <input className={inputCls} value={v.change_note} onChange={set('change_note')} placeholder="Exclude scrapped tyres from the numerator" />
        </Field>
        {err && <p role="alert" className="text-xs text-red-300">{err}</p>}
      </div>
    </Modal>
  )
}
