/**
 * CustomRolesQuick - every custom role in one row with ONE-CLICK edit (inline
 * description + on/off) and ONE-CLICK delete (inline confirm). A role that
 * still has people is not deletable: move them first, otherwise they would be
 * left on a role name that no longer exists. The full builder (create, pick
 * areas, copy from another role) stays below in CustomRolesManager.
 */
import { useState } from 'react'
import { Pencil, Trash2, Check, X, UserCog, Power } from 'lucide-react'
import { deleteCustomRole, updateCustomRole } from '../../../lib/api/customRoles'
import { toUserMessage } from '../../../lib/safeError'
import {
  Badge, Btn, EmptyState, ErrorState, LoadingState, Note, Panel, PanelHeader, Table, THead, Th, Tr, Td,
} from '../../components/ui'

const inputCls = 'w-full px-2 py-1 rounded-md bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

export default function CustomRolesQuick({ roles, peopleCounts, loading, error, onRetry, onChanged }) {
  const [editing, setEditing] = useState(null) // { id, description }
  const [confirmId, setConfirmId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function run(fn, success) {
    setBusy(true); setErr(''); setMsg('')
    try { await fn(); setMsg(success); await onChanged?.(); return true } catch (e) { setErr(toUserMessage(e, 'The change could not be saved.')); return false } finally { setBusy(false) }
  }

  return (
    <Panel>
      <PanelHeader icon={UserCog} title={`Custom roles${roles ? ` (${roles.length})` : ''}`}
        subtitle="Edit or remove a role in one click. Use the builder below to create one or change its areas." />
      {msg && <div className="mb-2"><Note tone="accent">{msg}</Note></div>}
      {err && <div className="mb-2"><Note tone="danger">{err}</Note></div>}
      {loading ? <LoadingState label="Loading custom roles" rows={3} /> : error ? <ErrorState message={error} onRetry={onRetry} /> : !roles?.length ? (
        <EmptyState icon={UserCog} title="No custom roles" reason="Only the built-in roles exist. Create one in the builder below." />
      ) : (
        <Table>
          <THead><Th>Role</Th><Th>People</Th><Th>Description</Th><Th>Status</Th><Th align="right">Actions</Th></THead>
          <tbody>
            {roles.map((r) => {
              const people = peopleCounts?.[r.name]
              const isEditing = editing?.id === r.id
              return (
                <Tr key={r.id}>
                  <Td nowrap><span className="text-gray-200">{r.name}</span></Td>
                  <Td>{typeof people === 'number' ? people : 'N/A'}</Td>
                  <Td>{isEditing
                    ? <input className={inputCls} value={editing.description} maxLength={500} aria-label={`Description for ${r.name}`}
                        onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                    : <span className="text-gray-400">{r.description || 'N/A'}</span>}</Td>
                  <Td><Badge tone={r.active === false ? 'quiet' : 'good'}>{r.active === false ? 'Off' : 'On'}</Badge></Td>
                  <Td align="right" nowrap>
                    {isEditing ? (
                      <>
                        <Btn size="xs" variant="primary" icon={Check} busy={busy}
                          onClick={() => run(() => updateCustomRole(r.id, { description: editing.description }), `Saved ${r.name}.`).then((ok) => { if (ok) setEditing(null) })}>Save</Btn>{' '}
                        <Btn size="xs" icon={X} title="Cancel edit" onClick={() => setEditing(null)} />
                      </>
                    ) : confirmId === r.id ? (
                      people > 0 ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-amber-300 text-[11px]">{people} {people === 1 ? 'person has' : 'people have'} this role. Move them first.</span>
                          <Btn size="xs" onClick={() => setConfirmId(null)}>OK</Btn>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-red-300 text-[11px]">Delete {r.name}? Affects 0 people; its area rules are switched off.</span>
                          <Btn size="xs" variant="danger" busy={busy}
                            onClick={() => run(() => deleteCustomRole(r.id, r.name), `Deleted ${r.name}.`).then((ok) => { if (ok) setConfirmId(null) })}>Delete</Btn>
                          <Btn size="xs" onClick={() => setConfirmId(null)}>Cancel</Btn>
                        </span>
                      )
                    ) : (
                      <>
                        <Btn size="xs" variant="quiet" icon={Pencil} title={`Edit ${r.name}`}
                          onClick={() => { setConfirmId(null); setEditing({ id: r.id, description: r.description || '' }) }} />
                        <Btn size="xs" variant="quiet" icon={Power} title={r.active === false ? `Turn ${r.name} on` : `Turn ${r.name} off`} busy={busy}
                          onClick={() => run(() => updateCustomRole(r.id, { active: r.active === false }), `${r.name} turned ${r.active === false ? 'on' : 'off'}.`)} />
                        <Btn size="xs" variant="quiet" icon={Trash2} title={`Delete ${r.name}`}
                          onClick={() => { setEditing(null); setConfirmId(r.id) }} />
                      </>
                    )}
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Panel>
  )
}
