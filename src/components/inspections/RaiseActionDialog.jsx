import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, Search, UserCheck } from 'lucide-react'
import Modal from '../ui/Modal'
import { defaultPlanFor } from '../../lib/inspectionTyreFlags'
import { listAssignablePeople, raiseActionsForInspection } from '../../lib/api/correctiveActions'
import { toUserMessage } from '../../lib/safeError'

const ROLE_CHIPS = [
  { label: 'Tyre men', roles: ['Tyre Man', 'Tyre Data Collector'] },
  { label: 'Drivers', roles: ['Driver'] },
  { label: 'Supervisors', roles: ['Workshop Supervisor', 'Maintenance Supervisor', 'Fleet Supervisor'] },
  { label: 'Everyone', roles: [] },
]

/**
 * Raise corrective actions from an inspection with the details filled in:
 * how it should be done, the raiser's own comment or correction, a due date,
 * and a named person. An assigned person is told through the Action Center
 * (in-app notice, plus a phone push when their device is registered), and the
 * work then sits in their task list until it is fixed.
 */
export default function RaiseActionDialog({ open, onClose, inspection, defects, onDone }) {
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
      next[d.key] = { include: true, instruction: base.instruction, comment: '', due_date: base.due_date, assignee: null }
    }
    setPlans(next); setError(''); setSearch('')
  }, [open, defects])

  useEffect(() => {
    if (!open) return undefined
    let live = true
    setLoadingPeople(true)
    const t = setTimeout(() => {
      listAssignablePeople({ search, roles: ROLE_CHIPS[chip].roles })
        .then((r) => { if (live) setPeople(r) })
        .catch(() => { if (live) setPeople([]) })
        .finally(() => { if (live) setLoadingPeople(false) })
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [open, chip, search])

  const set = (key, patch) => setPlans((p) => ({ ...p, [key]: { ...p[key], ...patch } }))
  const chosen = useMemo(() => defects.filter((d) => plans[d.key]?.include), [defects, plans])
  const assignAll = (person) => setPlans((p) => Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, { ...v, assignee: person }]),
  ))

  const submit = async () => {
    setBusy(true); setError('')
    try {
      const res = await raiseActionsForInspection(inspection, chosen, { plans })
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
      title="Raise corrective actions"
      subtitle={`${inspection?.asset_no || 'Vehicle'}: choose who does what, by when`}
      footer={(
        <div className="flex items-center gap-3 w-full justify-end">
          {error && <span role="alert" className="text-xs mr-auto" style={{ color: '#ef4444' }}>{error}</span>}
          <button type="button" className="btn-secondary min-h-[44px]" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary min-h-[44px] flex items-center gap-2" onClick={submit}
            disabled={busy || chosen.length === 0}>
            <ClipboardList size={14} />
            {busy ? 'Raising...' : `Raise ${chosen.length} action${chosen.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    >
      <section aria-label="Pick a person" className="mb-4">
        <p className="text-xs text-[var(--text-secondary)] mb-2">
          Pick a person to give every action to, or choose a different person on each action below.
          They are notified in the app and on their phone.
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {ROLE_CHIPS.map((c, i) => (
            <button key={c.label} type="button" onClick={() => setChip(i)} aria-pressed={chip === i}
              className={`text-xs px-3 min-h-[36px] rounded-full border ${chip === i ? 'border-[var(--accent)] font-semibold' : 'border-[var(--border)]'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <label className="relative block">
          <span className="sr-only">Search people by name</span>
          <Search size={13} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input className="input w-full pl-8" placeholder="Search by name" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </label>
        <ul className="mt-2 max-h-40 overflow-auto divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {loadingPeople && <li className="px-3 py-2 text-xs text-[var(--text-muted)]">Loading people...</li>}
          {!loadingPeople && people.length === 0 && (
            <li className="px-3 py-2 text-xs text-[var(--text-muted)]">No one found. Try another group or name.</li>
          )}
          {people.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
              <span>{p.name} <span className="text-xs text-[var(--text-muted)]">{p.role}{p.site ? ` | ${p.site}` : ''}</span></span>
              <button type="button" className="btn-secondary text-xs min-h-[36px]" onClick={() => assignAll(p)}>
                Give all to {p.name.split(' ')[0]}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="space-y-3">
        {defects.map((d) => {
          const plan = plans[d.key]
          if (!plan) return null
          return (
            <fieldset key={d.key} className="rounded-xl border border-[var(--border)] p-3"
              style={{ opacity: plan.include ? 1 : 0.55 }}>
              <legend className="px-1 text-xs font-semibold flex items-center gap-2">
                <input type="checkbox" checked={plan.include} onChange={(e) => set(d.key, { include: e.target.checked })}
                  aria-label={`Include ${d.title}`} />
                {d.title} <span className="font-normal text-[var(--text-muted)]">({d.priority})</span>
              </legend>
              <label className="block mb-2">
                <span className="label">How it should be done</span>
                <textarea className="input w-full" rows={2} maxLength={1000} value={plan.instruction}
                  onChange={(e) => set(d.key, { instruction: e.target.value })} />
              </label>
              <label className="block mb-2">
                <span className="label">Your comment or correction (optional)</span>
                <textarea className="input w-full" rows={2} maxLength={1000} value={plan.comment}
                  placeholder="Anything the person should know, or a correction to the finding"
                  onChange={(e) => set(d.key, { comment: e.target.value })} />
              </label>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="label">Fix by</span>
                  <input type="date" className="input" value={plan.due_date}
                    onChange={(e) => set(d.key, { due_date: e.target.value })} />
                </label>
                <span className="text-xs flex items-center gap-1 min-h-[36px]">
                  <UserCheck size={13} aria-hidden />
                  {plan.assignee ? `${plan.assignee.name} (${plan.assignee.role})` : 'Not assigned yet'}
                  {plan.assignee && (
                    <button type="button" className="underline ml-2" onClick={() => set(d.key, { assignee: null })}>clear</button>
                  )}
                </span>
                {people.slice(0, 5).map((p) => (
                  <button key={p.id} type="button" className="btn-secondary text-xs min-h-[36px]"
                    onClick={() => set(d.key, { assignee: p })}>{p.name}</button>
                ))}
              </div>
            </fieldset>
          )
        })}
      </div>
    </Modal>
  )
}
