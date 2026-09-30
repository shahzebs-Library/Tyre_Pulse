/**
 * PeopleGrants - every per-person exception (allow or block beyond the role) in
 * one table, with ONE-CLICK edit and ONE-CLICK delete on every row.
 *
 *   pencil -> the row turns into an inline editor (effect, capability, where,
 *             end date, note); Save writes the new rule first, then removes the
 *             old one (editUserGrant), so a failed save never loses the rule.
 *   trash  -> a small inline confirm "Remove X for Name? Affects 1 person".
 *   bulk   -> tick rows, then remove them or set one end date on all of them.
 *
 * Writes go through the super-admin RPCs (set_user_access_grant /
 * revoke_user_access_grant); the access_audit trigger records each one.
 */
import { useMemo, useState } from 'react'
import { Pencil, Trash2, Check, X, Plus, CalendarClock, UserCheck } from 'lucide-react'
import { ALL_MODULES } from '../../../lib/moduleCatalog'
import { MOBILE_MODULES } from '../../../lib/mobileModules'
import { CAPABILITIES } from '../../../lib/permissionMatrix'
import { describeGrant } from '../../../lib/accessOverview'
import {
  deleteUserGrants, editUserGrant, setUserAccessGrantScoped,
} from '../../../lib/api/accessGrants'
import { toUserMessage } from '../../../lib/safeError'
import { displayName } from './UserDirectory'
import {
  Badge, Btn, EmptyState, ErrorState, LoadingState, Note, Panel, PanelHeader, SearchInput, Select,
  Table, THead, Th, Tr, Td, Toolbar,
} from '../../components/ui'
import AccessImpact from './AccessImpact'

const CAP_OPTIONS = CAPABILITIES.filter((c) => c.key !== 'delete').map((c) => ({ value: c.key, label: c.label || c.key }))
const EFFECT_OPTIONS = [{ value: 'grant', label: 'Allow' }, { value: 'revoke', label: 'Block' }]
const SCOPE_OPTIONS = [{ value: 'web', label: 'Web' }, { value: 'mobile', label: 'Phone' }, { value: 'both', label: 'Both' }]

function toIsoEnd(dateStr) {
  if (!dateStr) return null
  const d = new Date(`${dateStr}T23:59:59`)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

const inputCls = 'px-2 py-1 rounded-md bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

export default function PeopleGrants({ grants, profiles, loading, error, onRetry, onChanged }) {
  const [search, setSearch] = useState('')
  const [effect, setEffect] = useState('')
  const [surface, setSurface] = useState('')
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [editing, setEditing] = useState(null) // { id, effect, capability, scope, end, note }
  const [confirmId, setConfirmId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [bulkEnd, setBulkEnd] = useState('')
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [adding, setAdding] = useState(false)

  const byId = useMemo(() => new Map((profiles || []).map((p) => [p.id, p])), [profiles])

  const rows = useMemo(() => (grants || []).map((g) => {
    const p = byId.get(g.user_id)
    return { ...g, person: p ? displayName(p) : 'Unknown person', role: p?.role || 'N/A', d: describeGrant(g) }
  }), [grants, byId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (effect && r.effect !== effect) return false
      if (surface && r.d.surface !== surface) return false
      if (status === 'expiring' && !r.expires_at) return false
      if (status === 'open' && r.expires_at) return false
      if (status === 'expired' && !r.d.expired) return false
      if (!q) return true
      return [r.person, r.role, r.d.area, r.module_key, r.note].some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [rows, search, effect, surface, status])

  const allTicked = filtered.length > 0 && filtered.every((r) => selected.has(r.id))
  const ticked = rows.filter((r) => selected.has(r.id))

  function toggle(id) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleAll() {
    setSelected((s) => {
      const n = new Set(s)
      if (allTicked) filtered.forEach((r) => n.delete(r.id)); else filtered.forEach((r) => n.add(r.id))
      return n
    })
  }

  function startEdit(r) {
    setConfirmId(null)
    setEditing({
      id: r.id, effect: r.effect, capability: r.capability || 'view',
      scope: r.d.surface === 'phone' ? 'mobile' : 'web', end: r.d.ends || '', note: r.note || '',
    })
  }

  async function run(fn, success) {
    setBusy(true); setErr(''); setMsg('')
    try { await fn(); setMsg(success); await onChanged?.(); return true } catch (e) { setErr(toUserMessage(e, 'The change could not be saved.')); return false } finally { setBusy(false) }
  }

  async function saveEdit(row) {
    const e = editing
    const ok = await run(() => editUserGrant(row, {
      effect: e.effect, capability: e.capability, scope: e.scope,
      expiresAt: toIsoEnd(e.end), note: e.note.trim() || null,
    }), `Updated ${row.d.area} for ${row.person}.`)
    if (ok) setEditing(null)
  }

  async function removeOne(row) {
    const ok = await run(async () => {
      const { failed } = await deleteUserGrants([row.id])
      if (failed.length) throw failed[0].error
    }, `Removed ${row.d.area} for ${row.person}.`)
    if (!ok) return
    setConfirmId(null)
    setSelected((s) => { const n = new Set(s); n.delete(row.id); return n })
  }

  async function bulkRemove() {
    await run(async () => {
      const { removed, failed } = await deleteUserGrants(ticked.map((r) => r.id))
      if (failed.length) throw new Error(`${removed.length} removed, ${failed.length} could not be removed.`)
    }, `Removed ${ticked.length} ${ticked.length === 1 ? 'rule' : 'rules'}.`)
    setBulkConfirm(false)
    setSelected(new Set())
  }

  async function bulkSetEnd() {
    const iso = toIsoEnd(bulkEnd)
    if (!iso) return
    await run(async () => {
      let failed = 0
      for (const r of ticked) {
        try { await editUserGrant(r, { expiresAt: iso }) } catch { failed += 1 }
      }
      if (failed) throw new Error(`${ticked.length - failed} updated, ${failed} could not be updated.`)
    }, `Set an end date of ${bulkEnd} on ${ticked.length} ${ticked.length === 1 ? 'rule' : 'rules'}.`)
    setSelected(new Set())
    setBulkEnd('')
  }

  const peopleTicked = new Set(ticked.map((r) => r.user_id)).size

  return (
    <Panel>
      <PanelHeader icon={UserCheck} title="People with exceptions"
        subtitle="Extra access or a block for one person, on top of their role. Edit or remove any rule in one click."
        actions={<Btn variant="primary" size="xs" icon={Plus} onClick={() => setAdding((v) => !v)}>Add exception</Btn>} />
      {adding && (
        <AddException profiles={profiles} onCancel={() => setAdding(false)}
          onSave={(args) => run(async () => { await setUserAccessGrantScoped(args.userId, args.moduleKey, args.opts); setAdding(false) }, 'Exception added.')} busy={busy} />
      )}
      <Toolbar className="mb-3">
        <SearchInput className="w-56" value={search} onChange={setSearch} placeholder="Search person, role or area" />
        <Select ariaLabel="Effect" value={effect} onChange={setEffect} placeholder="Allow and block" options={EFFECT_OPTIONS} />
        <Select ariaLabel="Where" value={surface} onChange={setSurface} placeholder="Web and phone" options={[{ value: 'web', label: 'Web' }, { value: 'phone', label: 'Phone' }]} />
        <Select ariaLabel="End date" value={status} onChange={setStatus} placeholder="Any end date"
          options={[{ value: 'open', label: 'No end date' }, { value: 'expiring', label: 'Has an end date' }, { value: 'expired', label: 'Already ended' }]} />
        <span className="text-[11px] text-gray-500 ml-auto">{filtered.length} of {rows.length} rules</span>
      </Toolbar>

      {msg && <div className="mb-2"><Note tone="accent">{msg}</Note></div>}
      {err && <div className="mb-2"><Note tone="danger">{err}</Note></div>}

      {ticked.length > 0 && (
        <div className="mb-3 rounded-lg border border-orange-700/40 bg-orange-500/5 p-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-300">{ticked.length} selected ({peopleTicked} {peopleTicked === 1 ? 'person' : 'people'})</span>
          <label className="inline-flex items-center gap-1 text-gray-400">
            <CalendarClock size={12} aria-hidden="true" /> End date
            <input type="date" value={bulkEnd} onChange={(e) => setBulkEnd(e.target.value)} className={inputCls} aria-label="End date for selected rules" />
          </label>
          <Btn size="xs" disabled={!bulkEnd || busy} onClick={bulkSetEnd}>Set end date</Btn>
          {bulkConfirm ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-red-300">Remove {ticked.length} rules? Affects {peopleTicked} {peopleTicked === 1 ? 'person' : 'people'}.</span>
              <Btn size="xs" variant="danger" busy={busy} onClick={bulkRemove}>Remove</Btn>
              <Btn size="xs" onClick={() => setBulkConfirm(false)}>Cancel</Btn>
            </span>
          ) : (
            <Btn size="xs" variant="danger" icon={Trash2} onClick={() => setBulkConfirm(true)}>Remove selected</Btn>
          )}
          <Btn size="xs" variant="quiet" onClick={() => setSelected(new Set())}>Clear</Btn>
        </div>
      )}

      {loading ? <LoadingState label="Loading exceptions" rows={4} /> : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : !rows.length ? (
        <EmptyState icon={UserCheck} title="No exceptions yet" reason="Everyone gets exactly what their role gives them. Add an exception to give one person more or less." />
      ) : !filtered.length ? (
        <EmptyState title="No rule matches" reason="Nothing matches this search or filter." />
      ) : (
        <Table>
          <THead>
            <Th><input type="checkbox" checked={allTicked} onChange={toggleAll} aria-label="Select all shown rules" /></Th>
            <Th>Person</Th><Th>Role</Th><Th>Area</Th><Th>Where</Th><Th>Rule</Th><Th>Ends</Th><Th>Note</Th><Th align="right">Actions</Th>
          </THead>
          <tbody>
            {filtered.map((r) => {
              const isEditing = editing?.id === r.id
              return (
                <Tr key={r.id}>
                  <Td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.d.area} for ${r.person}`} /></Td>
                  <Td nowrap><span className="text-gray-200">{r.person}</span></Td>
                  <Td nowrap>{r.role}</Td>
                  <Td>{r.d.area}</Td>
                  {isEditing ? (
                    <>
                      <Td><select className={inputCls} aria-label="Where" value={editing.scope} onChange={(e) => setEditing({ ...editing, scope: e.target.value })}>
                        {SCOPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Td>
                      <Td nowrap>
                        <select className={inputCls} aria-label="Allow or block" value={editing.effect} onChange={(e) => setEditing({ ...editing, effect: e.target.value })}>
                          {EFFECT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{' '}
                        <select className={inputCls} aria-label="Capability" value={editing.capability} onChange={(e) => setEditing({ ...editing, capability: e.target.value })}>
                          {CAP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                      </Td>
                      <Td><input type="date" className={inputCls} aria-label="End date" value={editing.end} onChange={(e) => setEditing({ ...editing, end: e.target.value })} /></Td>
                      <Td><input className={inputCls} aria-label="Note" value={editing.note} maxLength={300} onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></Td>
                      <Td align="right" nowrap>
                        <Btn size="xs" variant="primary" icon={Check} busy={busy} onClick={() => saveEdit(r)}>Save</Btn>{' '}
                        <Btn size="xs" icon={X} onClick={() => setEditing(null)} title="Cancel edit" />
                      </Td>
                    </>
                  ) : (
                    <>
                      <Td><Badge tone={r.d.surface === 'phone' ? 'info' : 'default'}>{r.d.surface === 'phone' ? 'Phone' : 'Web'}</Badge></Td>
                      <Td nowrap><Badge tone={r.effect === 'revoke' ? 'danger' : 'good'}>{r.d.effectLabel}</Badge> <span className="text-gray-500">{r.capability || 'view'}</span></Td>
                      <Td nowrap>{r.d.ends ? <span className={r.d.expired ? 'text-gray-500 line-through' : ''}>{r.d.ends}</span> : <span className="text-orange-300">No end date</span>}</Td>
                      <Td><span className="text-gray-500">{r.note || 'N/A'}</span></Td>
                      <Td align="right" nowrap>
                        {confirmId === r.id ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-red-300 text-[11px]">Remove {r.d.area} for {r.person}? Affects 1 person</span>
                            <Btn size="xs" variant="danger" busy={busy} onClick={() => removeOne(r)}>Remove</Btn>
                            <Btn size="xs" onClick={() => setConfirmId(null)}>Cancel</Btn>
                          </span>
                        ) : (
                          <>
                            <Btn size="xs" variant="quiet" icon={Pencil} title={`Edit ${r.d.area} for ${r.person}`} onClick={() => startEdit(r)} />
                            <Btn size="xs" variant="quiet" icon={Trash2} title={`Remove ${r.d.area} for ${r.person}`} onClick={() => { setEditing(null); setConfirmId(r.id) }} />
                          </>
                        )}
                      </Td>
                    </>
                  )}
                </Tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Panel>
  )
}

function AddException({ profiles, onCancel, onSave, busy }) {
  const [userId, setUserId] = useState('')
  const [area, setArea] = useState('')
  const [eff, setEff] = useState('grant')
  const [scope, setScope] = useState('web')
  const [cap, setCap] = useState('view')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const people = useMemo(() => (profiles || []).filter((p) => p.approved !== false)
    .map((p) => ({ value: p.id, label: `${displayName(p)} (${p.role || 'no role'})` }))
    .sort((a, b) => a.label.localeCompare(b.label)), [profiles])
  const areaOptions = useMemo(() => [
    ...ALL_MODULES.map((m) => ({ value: m.key, label: `${m.label} (web key)` })),
    ...MOBILE_MODULES.map((m) => ({ value: `phone:${m.key}`, label: `${m.label} (phone only)` })),
  ], [])
  const phoneOnly = area.startsWith('phone:')
  const person = (profiles || []).find((p) => p.id === userId)
  const ready = userId && area && note.trim().length >= 3

  function submit() {
    const moduleKey = phoneOnly ? area.slice(6) : area
    onSave({ userId, moduleKey, opts: { capability: cap, effect: eff, scope: phoneOnly ? 'mobile' : scope, note: note.trim(), expiresAt: toIsoEnd(end) } })
  }

  return (
    <div className="mb-3 rounded-lg border border-gray-800 p-3 space-y-2">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Select ariaLabel="Person" value={userId} onChange={setUserId} placeholder="Pick a person" options={people} />
        <Select ariaLabel="Area" value={area} onChange={setArea} placeholder="Pick an area" options={areaOptions} />
        <Select ariaLabel="Allow or block" value={eff} onChange={setEff} options={EFFECT_OPTIONS} />
        <Select ariaLabel="Capability" value={cap} onChange={setCap} options={CAP_OPTIONS} />
        <Select ariaLabel="Where" value={phoneOnly ? 'mobile' : scope} onChange={setScope} options={SCOPE_OPTIONS} disabled={phoneOnly} />
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} aria-label="End date (optional)" />
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Reason (required)" aria-label="Reason"
        className={`w-full ${inputCls}`} />
      {person && area && (
        <AccessImpact compact
          change={`${displayName(person)} is ${eff === 'grant' ? 'allowed' : 'blocked from'} this area (${cap}) on ${phoneOnly || scope === 'mobile' ? 'the phone' : scope === 'both' ? 'web and phone' : 'the web'}${end ? ` until ${end}` : ' with no end date'}.`}
          who="1 person. Their role and everyone else are unchanged."
          undo="Yes. Remove the rule here in one click." />
      )}
      <div className="flex justify-end gap-2">
        <Btn size="xs" onClick={onCancel}>Cancel</Btn>
        <Btn size="xs" variant="primary" busy={busy} disabled={!ready} onClick={submit}>Add exception</Btn>
      </div>
    </div>
  )
}
