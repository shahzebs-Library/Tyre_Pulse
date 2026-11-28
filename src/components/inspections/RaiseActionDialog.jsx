import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, Search, UserCheck } from 'lucide-react'
import Modal from '../ui/Modal'
import { defaultPlanFor } from '../../lib/inspectionTyreFlags'
import { listAssignablePeople, raiseActionsForInspection } from '../../lib/api/correctiveActions'
import { toUserMessage } from '../../lib/safeError'
import { useLanguage } from '../../contexts/LanguageContext'

const ROLE_CHIPS = [
  { key: 'tyreMen', roles: ['Tyre Man', 'Tyre Data Collector'] },
  { key: 'drivers', roles: ['Driver'] },
  { key: 'supervisors', roles: ['Workshop Supervisor', 'Maintenance Supervisor', 'Fleet Supervisor'] },
  { key: 'everyone', roles: [] },
]

/**
 * Raise corrective actions from an inspection with the details filled in:
 * how it should be done, the raiser's own comment or correction, a due date,
 * and a named person. An assigned person is told through the Action Center
 * (in-app notice, plus a phone push when their device is registered), and the
 * work then sits in their task list until it is fixed.
 */
export default function RaiseActionDialog({ open, onClose, inspection, defects, onDone }) {
  const { t } = useLanguage()
  const p = (k, v) => t(`inspections.raiseDialog.${k}`, v)
  const [plans, setPlans] = useState({})
  const [chip, setChip] = useState(0)
  const [search, setSearch] = useState('')
  const [people, setPeople] = useState([])
  const [loadingPeople, setLoadingPeople] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Defaults come from the defect so a one-click confirm still raises a full action.
  useEffect(() => {
    if (!open) return
    const next = {}
    for (const d of defects) {
      const base = defaultPlanFor(d)
      next[d.key] = { include: d.defaultInclude !== false, instruction: base.instruction, comment: '', due_date: base.due_date, assignee: null }
    }
    setPlans(next); setError(''); setSearch('')
  }, [open, defects])

  useEffect(() => {
    if (!open) return undefined
    let live = true
    setLoadingPeople(true)
    const timer = setTimeout(() => {
      listAssignablePeople({ search, roles: ROLE_CHIPS[chip].roles })
        .then((r) => { if (live) setPeople(r) })
        .catch(() => { if (live) setPeople([]) })
        .finally(() => { if (live) setLoadingPeople(false) })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [open, chip, search])

  const set = (key, patch) => setPlans((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  const chosen = useMemo(() => defects.filter((d) => plans[d.key]?.include), [defects, plans])
  const selectAll = (include) => setPlans((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, include }])))
  const assignAll = (person) => setPlans((prev) => Object.fromEntries(
    Object.entries(prev).map(([k, v]) => [k, { ...v, assignee: person }]),
  ))

  const submit = async () => {
    setBusy(true); setError('')
    try {
      const res = await raiseActionsForInspection(inspection, chosen, { plans })
      if (res.failed?.length || res.notifyFailed?.length) {
        setError(p('partial', { created: res.created?.length || 0, failed: res.failed?.length || 0, notify: res.notifyFailed?.length || 0 }))
        onDone(res)
        return
      }
      onDone(res)
      onClose()
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open} onClose={busy ? () => {} : onClose} size="lg"
      title={p('title')}
      subtitle={p('subtitle', { asset: inspection?.asset_no || p('vehicle') })}
      footer={(
        <div className="flex items-center gap-3 w-full justify-end">
          {error && <span role="alert" className="text-xs mr-auto" style={{ color: '#ef4444' }}>{error}</span>}
          <button type="button" className="btn-secondary min-h-[44px]" onClick={onClose} disabled={busy}>{p('cancel')}</button>
          <button type="button" className="btn-primary min-h-[44px] flex items-center gap-2" onClick={submit}
            disabled={busy || chosen.length === 0}>
            <ClipboardList size={14} />
            {busy ? p('raising') : chosen.length === 1 ? p('raiseOne') : p('raiseMany', { count: chosen.length })}
          </button>
        </div>
      )}
    >
      <section aria-label={p('pickAria')} className="mb-4">
        <p className="text-xs text-[var(--text-secondary)] mb-2">
          {p('pickHint')}
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {ROLE_CHIPS.map((c, i) => (
            <button key={c.key} type="button" onClick={() => setChip(i)} aria-pressed={chip === i}
              className={`text-xs px-3 min-h-[36px] rounded-full border ${chip === i ? 'border-[var(--accent)] font-semibold' : 'border-[var(--border)]'}`}>
              {p(`chips.${c.key}`)}
            </button>
          ))}
        </div>
        <label className="relative block">
          <span className="sr-only">{p('searchLabel')}</span>
          <Search size={13} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input className="input w-full pl-8" placeholder={p('searchPlaceholder')} value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </label>
        <ul className="mt-2 max-h-40 overflow-auto divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {loadingPeople && <li className="px-3 py-2 text-xs text-[var(--text-muted)]">{p('loadingPeople')}</li>}
          {!loadingPeople && people.length === 0 && (
            <li className="px-3 py-2 text-xs text-[var(--text-muted)]">{p('noPeople')}</li>
          )}
          {people.map((person) => (
            <li key={person.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
              <span>{person.name} <span className="text-xs text-[var(--text-muted)]">{person.role}{person.site ? ` | ${person.site}` : ''}</span></span>
              <button type="button" className="btn-secondary text-xs min-h-[36px]" onClick={() => assignAll(person)}>
                {p('giveAll', { name: person.name.split(' ')[0] })}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-[var(--text-secondary)]">{p('selected', { chosen: chosen.length, total: defects.length })}</p>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary min-h-[36px]" onClick={() => selectAll(true)}>{p('selectAll')}</button>
          <button type="button" className="btn-secondary min-h-[36px]" onClick={() => selectAll(false)}>{p('clear')}</button>
        </div>
      </div>
      <div className="space-y-3">
        {defects.map((d) => {
          const plan = plans[d.key]
          if (!plan) return null
          return (
            <fieldset key={d.key} className="rounded-xl border border-[var(--border)] p-3"
              style={{ opacity: plan.include ? 1 : 0.55 }}>
              <legend className="px-1 text-xs font-semibold flex items-center gap-2">
                <input type="checkbox" checked={plan.include} onChange={(e) => set(d.key, { include: e.target.checked })}
                  aria-label={p('include', { title: d.title })} />
                {d.title} <span className="font-normal text-[var(--text-muted)]">({d.priority})</span>
              </legend>
              <label className="block mb-2">
                <span className="label">{p('howLabel')}</span>
                <textarea className="input w-full" rows={2} maxLength={1000} value={plan.instruction}
                  onChange={(e) => set(d.key, { instruction: e.target.value })} />
              </label>
              <label className="block mb-2">
                <span className="label">{p('commentLabel')}</span>
                <textarea className="input w-full" rows={2} maxLength={1000} value={plan.comment}
                  placeholder={p('commentPlaceholder')}
                  onChange={(e) => set(d.key, { comment: e.target.value })} />
              </label>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="label">{p('fixBy')}</span>
                  <input type="date" className="input" value={plan.due_date}
                    onChange={(e) => set(d.key, { due_date: e.target.value })} />
                </label>
                <span className="text-xs flex items-center gap-1 min-h-[36px]">
                  <UserCheck size={13} aria-hidden />
                  {plan.assignee ? `${plan.assignee.name} (${plan.assignee.role})` : p('notAssigned')}
                  {plan.assignee && (
                    <button type="button" className="underline ml-2" onClick={() => set(d.key, { assignee: null })}>{p('clearAssignee')}</button>
                  )}
                </span>
                {people.slice(0, 5).map((person) => (
                  <button key={person.id} type="button" className="btn-secondary text-xs min-h-[36px]"
                    onClick={() => set(d.key, { assignee: person })}>{person.name}</button>
                ))}
              </div>
            </fieldset>
          )
        })}
      </div>
    </Modal>
  )
}
