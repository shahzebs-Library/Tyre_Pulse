import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Save, Trash2, Users, Smartphone, AlertTriangle, BellRing, UserCheck } from 'lucide-react'
import SharedModal from '../ui/Modal'
import {
  OWNER_WORKSTREAMS, OWNER_ROLE_CHOICES, SEVERITY_SLA_FIELDS, NOTIFY_EVENTS,
  hoursToMinutes, minutesToHours, stepsMissingSla, stepsWithoutOwner,
} from '../../lib/accidentOwnership'
import {
  listTeamRoles, saveTeamRole, removeTeamRole, listNotifyRules, saveNotifyRule,
  removeNotifyRule, listAssignablePeople, previewTeamRole,
} from '../../lib/api/accidentOwnership'
import { toUserMessage } from '../../lib/safeError'
import useAccidentOwnershipText from './useAccidentOwnershipText'

/**
 * Two Accident Workflow settings tabs the owner uses to run the case:
 *   OwnersTab  - who owns each step (role and/or named people, optional per
 *                country / site) and the SLA target per severity. A blank target
 *                is "Not set": no timer runs for that step.
 *   NotifyTab  - who is told about each event (step owner, roles, named people,
 *                the driver), push on/off, stalled days.
 * Writes go through RLS (Admin and super admin only); readers see a read-only view.
 */

const inputCls =
  'w-full min-h-[40px] rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
const btn =
  'inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 text-sm rounded-lg border focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50'
const btnPrimary = `${btn} bg-[var(--accent)] border-[var(--accent)] text-white`
const btnQuiet = `${btn} bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]`

function NotProvisioned() {
  const { tx } = useAccidentOwnershipText()
  return (
    <div className="card flex items-start gap-3" role="note">
      <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
      <div>
        <p className="text-[var(--text-primary)] font-medium">{tx('notProvisioned.title')}</p>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          {tx('notProvisioned.body')}
        </p>
      </div>
    </div>
  )
}

function ErrorCard({ message, onRetry }) {
  const { tx } = useAccidentOwnershipText()
  return (
    <div className="card flex items-center gap-3" role="alert">
      <AlertTriangle size={18} className="text-red-400 shrink-0" aria-hidden="true" />
      <p className="text-sm text-[var(--text-primary)] flex-1">{message}</p>
      <button type="button" className={btnQuiet} onClick={onRetry}>{tx('common.tryAgain')}</button>
    </div>
  )
}

function PeoplePicker({ people, value, onChange, disabled, label }) {
  const L = useAccidentOwnershipText()
  const selected = new Set(value || [])
  return (
    <details className="relative">
      <summary className={`${inputCls} cursor-pointer list-none flex items-center gap-1.5`} aria-label={label}>
        <Users size={14} aria-hidden="true" />
        <span className="truncate">{selected.size ? L.tx('people.named', { n: selected.size }) : L.tx('people.nobodyNamed')}</span>
      </summary>
      <div className="absolute z-20 mt-1 w-72 max-h-64 overflow-auto rounded-lg border border-[var(--input-border)] bg-[var(--surface-1,var(--bg-card))] p-2 shadow-lg">
        {people.length === 0 && <p className="text-xs text-[var(--text-muted)] p-2">{L.tx('people.noneToPick')}</p>}
        {people.map((p) => (
          <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-[var(--surface-2)]">
            <input
              type="checkbox" disabled={disabled} checked={selected.has(p.id)}
              onChange={(e) => {
                const next = new Set(selected)
                if (e.target.checked) next.add(p.id); else next.delete(p.id)
                onChange([...next])
              }}
            />
            <span className="truncate text-[var(--text-primary)]">{p.full_name || p.username}</span>
            <span className="ms-auto text-[11px] text-[var(--text-dim)] truncate">{L.role(p.role)}</span>
          </label>
        ))}
      </div>
    </details>
  )
}

function Preview({ role, country, site, userIds }) {
  const { tx } = useAccidentOwnershipText()
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    let alive = true
    setState({ loading: true })
    const t = setTimeout(() => {
      previewTeamRole({ role, country, site, userIds })
        .then((d) => alive && setState({ data: d }))
        .catch(() => alive && setState({ error: true }))
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [role, country, site, JSON.stringify(userIds || [])]) // eslint-disable-line react-hooks/exhaustive-deps
  if (state.loading) return <span className="text-xs text-[var(--text-dim)]">{tx('common.checking')}</span>
  if (state.error) return <span className="text-xs text-[var(--text-dim)]">{tx('people.previewUnavailable')}</span>
  const { people = 0, with_device: phones = 0 } = state.data || {}
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${people === 0 ? 'text-amber-400' : 'text-[var(--text-secondary)]'}`}
      title={(state.data?.names || []).join(', ')}>
      <Users size={12} aria-hidden="true" /> {tx(people === 1 ? 'people.person' : 'people.persons', { n: people })}
      <Smartphone size={12} aria-hidden="true" className="ms-1" /> {tx('people.withPhone', { n: phones })}
    </span>
  )
}

/* ─────────────────────────── owners ─────────────────────────── */

function blankRule(key) {
  return { workstream_key: key, country: '', site: '', owner_role: '', owner_user_ids: [],
    sla_minutes_minor: null, sla_minutes_moderate: null, sla_minutes_major: null, warning_pct: 80, active: true }
}

function OwnerRow({ rule, people, canWrite, onSaved, onRemove, isOverride }) {
  const L = useAccidentOwnershipText()
  const { tx } = L
  const stepName = L.step(rule.workstream_key)
  const [draft, setDraft] = useState(() => ({
    ...rule,
    hours: Object.fromEntries(SEVERITY_SLA_FIELDS.map((f) => [f.field, minutesToHours(rule[f.field])])),
  }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dirty = JSON.stringify({ ...draft, hours: undefined }) !== JSON.stringify({ ...rule, hours: undefined })
    || SEVERITY_SLA_FIELDS.some((f) => draft.hours[f.field] !== minutesToHours(rule[f.field]))

  const save = async () => {
    setErr('')
    const sla = {}
    for (const f of SEVERITY_SLA_FIELDS) {
      const m = hoursToMinutes(draft.hours[f.field])
      if (Number.isNaN(m)) { setErr(tx('owners.slaInvalid', { severity: L.severity(f.field) })); return }
      sla[f.field] = m
    }
    if (!draft.owner_role && !(draft.owner_user_ids || []).length) { setErr(tx('owners.pickOwner')); return }
    setBusy(true)
    try {
      const saved = await saveTeamRole({ ...draft, ...sla })
      onSaved(saved)
    } catch (e) { setErr(toUserMessage(e, tx('owners.saveFailed'))) } finally { setBusy(false) }
  }

  return (
    <tr className="border-t border-[var(--input-border)] align-top">
      <td className="py-2 pe-3">
        <p className="text-sm font-medium text-[var(--text-primary)]">{stepName}</p>
        {isOverride && <p className="text-[11px] text-[var(--text-dim)]">{[rule.country, rule.site].filter(Boolean).join(' / ') || tx('owners.orgWide')}</p>}
        {err && <p className="text-[11px] text-red-400 mt-1" role="alert">{err}</p>}
      </td>
      <td className="py-2 pe-2 min-w-[180px]">
        <select className={inputCls} value={draft.owner_role || ''} disabled={!canWrite}
          aria-label={tx('owners.ownerRoleFor', { step: stepName })}
          onChange={(e) => setDraft((d) => ({ ...d, owner_role: e.target.value }))}>
          <option value="">{tx('owners.noRole')}</option>
          {OWNER_ROLE_CHOICES.map((r) => <option key={r} value={r}>{L.role(r)}</option>)}
        </select>
      </td>
      <td className="py-2 pe-2 min-w-[150px]">
        <PeoplePicker people={people} value={draft.owner_user_ids} disabled={!canWrite}
          label={tx('owners.namedOwnersFor', { step: stepName })}
          onChange={(ids) => setDraft((d) => ({ ...d, owner_user_ids: ids }))} />
      </td>
      {SEVERITY_SLA_FIELDS.map((f) => (
        <td key={f.field} className="py-2 pe-2 w-[96px]">
          <input
            className={inputCls} inputMode="decimal" placeholder={tx('common.notSet')} disabled={!canWrite}
            aria-label={tx('owners.slaHoursFor', { severity: L.severity(f.field), step: stepName })}
            value={draft.hours[f.field]}
            onChange={(e) => setDraft((d) => ({ ...d, hours: { ...d.hours, [f.field]: e.target.value } }))}
          />
          <p className="text-[10px] text-[var(--text-dim)] mt-0.5">{L.slaMinutes(hoursToMinutes(draft.hours[f.field]))}</p>
        </td>
      ))}
      <td className="py-2 pe-2 min-w-[170px]">
        <Preview role={draft.owner_role} country={draft.country} site={draft.site} userIds={draft.owner_user_ids} />
      </td>
      <td className="py-2 text-end whitespace-nowrap">
        {canWrite && (
          <div className="inline-flex gap-1">
            <button type="button" className={btnPrimary} disabled={!dirty || busy} onClick={save} aria-label={tx('owners.saveOwner')}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {tx('common.save')}
            </button>
            {isOverride && rule.id && (
              <button type="button" className={btnQuiet} aria-label={tx('owners.removeOverride')} onClick={() => onRemove(rule)}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

export function OwnersTab({ canWrite }) {
  const L = useAccidentOwnershipText()
  const { tx } = L
  const [state, setState] = useState({ loading: true })
  const [people, setPeople] = useState([])
  const [adding, setAdding] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const [roles, ppl] = await Promise.all([listTeamRoles(), listAssignablePeople().catch(() => [])])
      setPeople(ppl)
      setState({ loading: false, ok: roles.ok, rows: roles.rows })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e, tx('owners.loadFailed')) })
    }
  }, [tx])
  useEffect(() => { load() }, [load])

  const rows = state.rows || []
  const orgWide = useMemo(() => OWNER_WORKSTREAMS.map((ws) =>
    rows.find((r) => r.workstream_key === ws.key && !r.country && !r.site) || blankRule(ws.key)), [rows])
  const overrides = rows.filter((r) => r.country || r.site)
  const missingSla = stepsMissingSla(rows)
  const noOwner = stepsWithoutOwner(rows)

  const upsertLocal = (saved) => setState((s) => ({
    ...s, rows: [...(s.rows || []).filter((r) => r.id !== saved.id), saved],
  }))

  if (state.loading && !state.rows) {
    return <div className="card flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> {tx('owners.loading')}</div>
  }
  if (state.error) return <ErrorCard message={state.error} onRetry={load} />
  if (state.ok === false) return <NotProvisioned />

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={UserCheck} label={tx('owners.statOwned')} value={tx('owners.statOwnedValue', { n: OWNER_WORKSTREAMS.length - noOwner.length, total: OWNER_WORKSTREAMS.length })} tone={noOwner.length ? 'warn' : 'good'} />
        <Stat icon={AlertTriangle} label={tx('owners.statNoSla')} value={String(missingSla.length)}
          sub={missingSla.length ? tx('owners.statNoSlaSub') : tx('owners.statAllSla')} tone={missingSla.length ? 'warn' : 'good'} />
        <Stat icon={Users} label={tx('owners.statOverrides')} value={String(overrides.length)} />
      </div>

      <div className="card overflow-x-auto">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{tx('owners.title')}</h3>
          <p className="text-xs text-[var(--text-muted)]">
            {tx('owners.help')}
          </p>
          {canWrite && (
            <button type="button" className={`${btnQuiet} ms-auto`} onClick={() => setAdding(blankRule('incident_evidence'))}>
              <Plus size={14} /> {tx('owners.addOverride')}
            </button>
          )}
        </div>
        <table className="w-full text-start text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">
            <tr>
              <th className="py-2 pe-3 font-medium">{tx('owners.colStep')}</th>
              <th className="py-2 pe-2 font-medium">{tx('owners.colRole')}</th>
              <th className="py-2 pe-2 font-medium">{tx('owners.colPeople')}</th>
              {SEVERITY_SLA_FIELDS.map((f) => <th key={f.field} className="py-2 pe-2 font-medium">{tx('owners.colSla', { severity: L.severity(f.field) })}</th>)}
              <th className="py-2 pe-2 font-medium">{tx('owners.colNotify')}</th>
              <th className="py-2 font-medium sr-only">{tx('owners.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {orgWide.map((r) => (
              <OwnerRow key={r.id || r.workstream_key} rule={r} people={people} canWrite={canWrite} onSaved={upsertLocal} onRemove={() => {}} />
            ))}
            {overrides.map((r) => (
              <OwnerRow key={r.id} rule={r} people={people} canWrite={canWrite} isOverride onSaved={upsertLocal}
                onRemove={async (row) => {
                  try { await removeTeamRole(row.id); setState((s) => ({ ...s, rows: s.rows.filter((x) => x.id !== row.id) })) } catch (e) { setState((s) => ({ ...s, error: toUserMessage(e, tx('owners.removeFailed')) })) }
                }} />
            ))}
          </tbody>
        </table>
      </div>

      <SharedModal open={Boolean(adding)} onClose={() => setAdding(null)} title={tx('owners.addOverride')} size="md"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" className={btnQuiet} onClick={() => setAdding(null)}>{tx('common.cancel')}</button>
            <button type="button" className={btnPrimary}
              onClick={async () => {
                try {
                  const saved = await saveTeamRole(adding)
                  upsertLocal(saved); setAdding(null)
                } catch (e) { setAdding((a) => ({ ...a, _err: toUserMessage(e, tx('owners.overrideSaveFailed')) })) }
              }}>
              <Save size={14} /> {tx('common.save')}
            </button>
          </div>
        )}>
        {adding && (
          <div className="grid gap-3">
            <label className="text-sm text-[var(--text-secondary)]">{tx('owners.colStep')}
              <select className={inputCls} value={adding.workstream_key} onChange={(e) => setAdding((a) => ({ ...a, workstream_key: e.target.value }))}>
                {OWNER_WORKSTREAMS.map((w) => <option key={w.key} value={w.key}>{L.step(w.key)}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-[var(--text-secondary)]">{tx('owners.country')}
                <input className={inputCls} placeholder={tx('owners.egCountry')} value={adding.country} onChange={(e) => setAdding((a) => ({ ...a, country: e.target.value }))} />
              </label>
              <label className="text-sm text-[var(--text-secondary)]">{tx('owners.site')}
                <input className={inputCls} placeholder={tx('owners.egSite')} value={adding.site} onChange={(e) => setAdding((a) => ({ ...a, site: e.target.value }))} />
              </label>
            </div>
            <label className="text-sm text-[var(--text-secondary)]">{tx('owners.colRole')}
              <select className={inputCls} value={adding.owner_role} onChange={(e) => setAdding((a) => ({ ...a, owner_role: e.target.value }))}>
                <option value="">{tx('owners.noRole')}</option>
                {OWNER_ROLE_CHOICES.map((r) => <option key={r} value={r}>{L.role(r)}</option>)}
              </select>
            </label>
            <PeoplePicker people={people} value={adding.owner_user_ids} label={tx('owners.namedOwners')}
              onChange={(ids) => setAdding((a) => ({ ...a, owner_user_ids: ids }))} />
            <Preview role={adding.owner_role} country={adding.country} site={adding.site} userIds={adding.owner_user_ids} />
            {adding._err && <p className="text-sm text-red-400" role="alert">{adding._err}</p>}
          </div>
        )}
      </SharedModal>
    </div>
  )
}

function Stat({ icon: Icon, label, value, sub, tone }) {
  const toneCls = tone === 'warn' ? 'text-amber-400' : tone === 'good' ? 'text-emerald-400' : 'text-[var(--text-primary)]'
  return (
    <div className="card">
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Icon size={14} aria-hidden="true" /> {label}</div>
      <p className={`text-xl font-semibold mt-1 ${toneCls}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{sub}</p>}
    </div>
  )
}

/* ─────────────────────────── notify ─────────────────────────── */

const NOTIFY_ROLE_CHOICES = ['Manager', 'Director', 'Admin', 'Fleet Supervisor', 'Workshop Maintenance Area Manager', 'PMV Manager']

function NotifyRuleCard({ rule, people, canWrite, onSaved, onRemove }) {
  const L = useAccidentOwnershipText()
  const { tx } = L
  const [draft, setDraft] = useState(rule)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(rule)
  const nameById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p.full_name || p.username])), [people])
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const toggleRole = (r) => set({ roles: draft.roles?.includes(r) ? draft.roles.filter((x) => x !== r) : [...(draft.roles || []), r] })

  return (
    <div className="rounded-lg border border-[var(--input-border)] p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-xs`} value={draft.name || ''} placeholder={tx('notify.ruleName')} disabled={!canWrite}
          aria-label={tx('notify.ruleName')} onChange={(e) => set({ name: e.target.value })} />
        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <input type="checkbox" checked={draft.active !== false} disabled={!canWrite} onChange={(e) => set({ active: e.target.checked })} /> {tx('notify.on')}
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <input type="checkbox" checked={draft.channel_push !== false} disabled={!canWrite} onChange={(e) => set({ channel_push: e.target.checked })} /> {tx('notify.phonePush')}
        </label>
        {canWrite && (
          <div className="ms-auto inline-flex gap-1">
            <button type="button" className={btnPrimary} disabled={!dirty || busy}
              onClick={async () => {
                setErr(''); setBusy(true)
                try { onSaved(await saveNotifyRule(draft)) } catch (e) { setErr(toUserMessage(e, tx('notify.saveFailed'))) } finally { setBusy(false) }
              }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {tx('common.save')}
            </button>
            {rule.id && <button type="button" className={btnQuiet} aria-label={tx('notify.removeRule')} onClick={() => onRemove(rule)}><Trash2 size={14} /></button>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={draft.notify_owner === true} disabled={!canWrite} onChange={(e) => set({ notify_owner: e.target.checked })} /> {tx('notify.stepOwner')}</label>
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={draft.notify_driver === true} disabled={!canWrite} onChange={(e) => set({ notify_driver: e.target.checked })} /> {tx('notify.driver')}</label>
        {NOTIFY_ROLE_CHOICES.map((r) => (
          <label key={r} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={(draft.roles || []).includes(r)} disabled={!canWrite} onChange={() => toggleRole(r)} /> {L.role(r)}</label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="w-56"><PeoplePicker people={people} value={draft.user_ids} disabled={!canWrite} label={tx('notify.namedPeople')} onChange={(ids) => set({ user_ids: ids })} /></div>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={draft.only_when_serious === true} disabled={!canWrite} onChange={(e) => set({ only_when_serious: e.target.checked })} />
          {tx('notify.onlySerious')}
        </label>
        {draft.only_when_serious && (
          <div className="w-28">
            <input className={inputCls} inputMode="numeric" disabled={!canWrite} aria-label={tx('notify.seriousCost')}
              value={draft.serious_cost ?? 20000} onChange={(e) => set({ serious_cost: Number(e.target.value) || 0 })} />
          </div>
        )}
        {draft.event_key === 'accident.stalled' && (
          <label className="inline-flex items-center gap-1.5">{tx('notify.stalledAfter')}
            <input className={`${inputCls} !w-20`} inputMode="numeric" placeholder={tx('common.notSet')} disabled={!canWrite} aria-label={tx('notify.stalledDays')}
              value={draft.stalled_days ?? ''} onChange={(e) => set({ stalled_days: e.target.value === '' ? null : Math.max(1, Number(e.target.value) || 1) })} />
            {tx('notify.daysOnStage')}
          </label>
        )}
      </div>
      <p className="text-xs text-[var(--text-muted)]">{tx('notify.tells', { who: L.ruleSummary(draft, nameById) })}</p>
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
    </div>
  )
}

export function NotifyTab({ canWrite }) {
  const L = useAccidentOwnershipText()
  const { tx } = L
  const [state, setState] = useState({ loading: true })
  const [people, setPeople] = useState([])
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const [rules, ppl] = await Promise.all([listNotifyRules(), listAssignablePeople().catch(() => [])])
      setPeople(ppl)
      setState({ loading: false, ok: rules.ok, rows: rules.rows })
    } catch (e) { setState({ loading: false, error: toUserMessage(e, tx('notify.loadFailed')) }) }
  }, [tx])
  useEffect(() => { load() }, [load])

  if (state.loading && !state.rows) {
    return <div className="card flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> {tx('notify.loading')}</div>
  }
  if (state.error) return <ErrorCard message={state.error} onRetry={load} />
  if (state.ok === false) return <NotProvisioned />

  const rows = state.rows || []
  const replace = (saved, tempKey) => setState((s) => ({ ...s, rows: [...s.rows.filter((r) => r.id !== saved.id && r._tmp !== tempKey), saved] }))

  return (
    <div className="space-y-4">
      <div className="card text-sm text-[var(--text-muted)] flex items-start gap-2">
        <BellRing size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>{tx('notify.intro')}</p>
      </div>
      {NOTIFY_EVENTS.map((ev) => {
        const list = rows.filter((r) => r.event_key === ev.key)
        return (
          <section key={ev.key} className="card space-y-2" aria-label={L.event(ev.key)}>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{L.event(ev.key)}</h3>
              {list.length === 0 && <span className="text-xs text-amber-400">{tx('notify.nobodyTold')}</span>}
              {canWrite && (
                <button type="button" className={`${btnQuiet} ms-auto`}
                  onClick={() => setState((s) => ({ ...s, rows: [...s.rows, { _tmp: `${ev.key}-${Date.now()}`, event_key: ev.key, name: '', notify_owner: true, roles: [], user_ids: [], notify_driver: false, only_when_serious: false, serious_cost: 20000, channel_push: true, active: true, stalled_days: ev.key === 'accident.stalled' ? 14 : null }] }))}>
                  <Plus size={14} /> {tx('notify.addRule')}
                </button>
              )}
            </div>
            {list.map((r) => (
              <NotifyRuleCard key={r.id || r._tmp} rule={r} people={people} canWrite={canWrite}
                onSaved={(saved) => replace(saved, r._tmp)}
                onRemove={async (row) => {
                  try { await removeNotifyRule(row.id); setState((s) => ({ ...s, rows: s.rows.filter((x) => x.id !== row.id) })) } catch (e) { setState((s) => ({ ...s, error: toUserMessage(e, tx('notify.removeFailed')) })) }
                }} />
            ))}
          </section>
        )
      })}
    </div>
  )
}
