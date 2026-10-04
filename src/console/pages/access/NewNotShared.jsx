/**
 * NewNotShared - the "anything NEW is Admin and Super Admin only until shared"
 * surface.
 *
 * HONEST MODEL: a brand new area has no saved role rule. Today the web app then
 * falls back to the built-in role defaults, under which Manager and Director
 * see almost every area. The locked policy is therefore an OPT-IN switch
 * (system_config `new_features_admin_only`, default off). When it is on, the
 * web permission resolver (AuthContext hasPermission -> baseRoleAllows) denies
 * a non-admin role any area that role has no saved rule for. This page:
 *   - shows the policy card with the switch and what turning it on would hide;
 *   - lists every area no non-admin role has a saved rule for;
 *   - shares an area with chosen roles by writing module_permissions rows
 *     through saveModulePermissions (audited by the access_audit trigger).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Lock, Share2, ShieldCheck, AlertTriangle } from 'lucide-react'
import { NAV_CATALOG } from '../../../components/Layout'
import { buildNavModuleCatalog } from '../../../lib/moduleCatalog'
import { mobileKeyFor, newAndNotShared, buildShareChanges, webCell } from '../../../lib/accessOverview'
import { saveModulePermissions } from '../../../lib/api/modulePermissions'
import { getNewFeaturesPolicy, setNewFeaturesPolicy } from '../../../lib/api/adminAccess'
import { toUserMessage } from '../../../lib/safeError'
import { useConsoleAuth } from '../../ConsoleAuthContext'
import {
  Badge, Btn, EmptyState, Modal, Note, Panel, PanelHeader, SearchInput, Segmented, Table, THead, Th, Tr, Td, Toolbar,
} from '../../components/ui'
import AccessImpact from './AccessImpact'

const CATALOG = buildNavModuleCatalog(NAV_CATALOG).map((m) => ({ key: m.module_id, label: m.name, group: m.category }))

export function useNewAreas(permMap) {
  return useMemo(() => (permMap ? newAndNotShared(permMap, CATALOG) : []), [permMap])
}

export default function NewNotShared({ permMap, columns, peopleCounts, onShared }) {
  const { logAction } = useConsoleAuth() || {}
  const items = useNewAreas(permMap)
  const [search, setSearch] = useState('')
  const [sharing, setSharing] = useState(null)
  const [policy, setPolicy] = useState({ enabled: false, known: false, loading: true })
  const [policyBusy, setPolicyBusy] = useState(false)
  const [policyErr, setPolicyErr] = useState('')
  const [confirmPolicy, setConfirmPolicy] = useState(false)
  const [msg, setMsg] = useState('')

  const loadPolicy = useCallback(async () => {
    const p = await getNewFeaturesPolicy()
    setPolicy({ ...p, loading: false })
  }, [])
  useEffect(() => { loadPolicy() }, [loadPolicy])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((i) => !q || i.label.toLowerCase().includes(q) || i.key.includes(q))
  }, [items, search])

  // What switching the policy ON would hide: per role, areas it sees today only
  // through the built-in default (no saved rule).
  const wouldHide = useMemo(() => {
    const out = []
    for (const c of columns || []) {
      if (c.name === 'Admin') continue
      let n = 0
      for (const m of CATALOG) {
        const w = webCell(permMap, c.name, m.key)
        if (w && !w.saved && w.on) n += 1
      }
      if (n) out.push({ role: c.name, areas: n, people: peopleCounts?.[c.name] })
    }
    return out
  }, [columns, permMap, peopleCounts])

  async function flipPolicy(next) {
    setPolicyBusy(true); setPolicyErr('')
    try {
      await setNewFeaturesPolicy(next)
      try { await logAction?.('access_policy_new_features', null, 'system_config', { enabled: next }) } catch { /* audit best effort */ }
      setPolicy({ enabled: next, known: true, loading: false })
      setConfirmPolicy(false)
    } catch (e) {
      setPolicyErr(toUserMessage(e, 'The policy could not be changed.'))
    } finally {
      setPolicyBusy(false)
    }
  }

  const affectedPeople = wouldHide.reduce((s, r) => s + (typeof r.people === 'number' ? r.people : 0), 0)

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader icon={Lock} title="New features: Admin and Super Admin only until shared"
          subtitle="Any area with no saved role rule stays hidden from every other role until someone shares it here."
          actions={policy.loading ? null : (
            <Badge tone={policy.enabled ? 'good' : 'warning'} icon={ShieldCheck}>
              {!policy.known ? 'Policy state unreadable' : policy.enabled ? 'Policy on' : 'Policy off'}
            </Badge>
          )} />
        <div className="space-y-2 text-xs text-gray-400">
          {policy.known && !policy.enabled && (
            <p>
              Today the policy is off, so an unshared area follows the built-in defaults (Manager and Director see most
              areas). Turning it on hides every area a role has no saved rule for, on the web. Admin and Super Admin are never affected.
            </p>
          )}
          {policy.enabled && <p>The policy is on. Roles only see areas they have a saved rule for; share areas below.</p>}
          {!policy.known && !policy.loading && <Note tone="warning">The policy setting could not be read, so it is treated as off.</Note>}
          {policyErr && <Note tone="danger">{policyErr}</Note>}
          {confirmPolicy ? (
            <div className="space-y-2">
              <AccessImpact
                happened="You asked to turn the new-areas policy on."
                change={wouldHide.length
                  ? `Roles lose web areas they only see by default: ${wouldHide.map((r) => `${r.role} ${r.areas}`).join(', ')}.`
                  : 'No role sees any area through a default only, so nothing disappears today.'}
                who={`${affectedPeople} ${affectedPeople === 1 ? 'person' : 'people'} in those roles. Admin and Super Admin keep everything.`}
                undo="Yes. Turn the policy off again and every default returns at the next page load." />
              <div className="flex gap-2 justify-end">
                <Btn size="xs" onClick={() => setConfirmPolicy(false)}>Cancel</Btn>
                <Btn size="xs" variant="danger" busy={policyBusy} onClick={() => flipPolicy(true)}>Turn on</Btn>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              {policy.enabled
                ? <Btn size="xs" busy={policyBusy} onClick={() => flipPolicy(false)}>Turn policy off</Btn>
                : <Btn size="xs" icon={AlertTriangle} disabled={policy.loading} onClick={() => setConfirmPolicy(true)}>Turn policy on</Btn>}
            </div>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHeader icon={Share2} title={`New and not yet shared (${items.length})`}
          subtitle="Areas with no saved rule for any role except Admin." />
        {msg && <div className="mb-2"><Note tone="accent">{msg}</Note></div>}
        <Toolbar className="mb-3">
          <SearchInput className="w-56" value={search} onChange={setSearch} placeholder="Find an area" />
        </Toolbar>
        {!permMap ? (
          <EmptyState title="Rules not loaded" reason="The role rules could not be read, so shared and unshared areas cannot be told apart." />
        ) : !items.length ? (
          <EmptyState icon={ShieldCheck} title="Everything is shared" reason="Every area has at least one saved role rule." />
        ) : !filtered.length ? (
          <EmptyState title="No area matches" reason="Nothing matches this search." />
        ) : (
          <Table>
            <THead><Th>Area</Th><Th>Group</Th><Th>Where</Th><Th>Sees it today (by default)</Th><Th>Under the policy</Th><Th align="right">Action</Th></THead>
            <tbody>
              {filtered.map((i) => {
                const g = CATALOG.find((m) => m.key === i.key)
                return (
                  <Tr key={i.storedKey}>
                    <Td><span className="text-gray-200">{i.label}</span><div className="text-[10px] text-gray-500">{i.key}</div></Td>
                    <Td>{g?.group || 'N/A'}</Td>
                    <Td>{i.surface === 'phone' ? 'Phone' : mobileKeyFor(i.key) ? 'Web and phone' : 'Web page'}</Td>
                    <Td>{i.seenByDefault.length ? i.seenByDefault.join(', ') : 'Admin only'}</Td>
                    <Td><Badge tone="accent" icon={Lock}>Admin and Super Admin</Badge></Td>
                    <Td align="right"><Btn size="xs" icon={Share2} onClick={() => setSharing(i)}>Share with roles</Btn></Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      <ShareDialog item={sharing} columns={columns} peopleCounts={peopleCounts} onClose={() => setSharing(null)}
        onDone={async (text) => { setSharing(null); setMsg(text); await onShared?.() }} logAction={logAction} />
    </div>
  )
}

function ShareDialog({ item, columns, peopleCounts, onClose, onDone, logAction }) {
  const [roles, setRoles] = useState(() => new Set())
  const [where, setWhere] = useState('web')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setRoles(new Set()); setWhere(item?.surface === 'phone' ? 'phone' : 'web'); setReason(''); setErr('') }, [item])
  if (!item) return null
  const hasPhone = item.surface === 'phone' || Boolean(mobileKeyFor(item.key))
  const choices = (columns || []).filter((c) => c.name !== 'Admin')
  const picked = [...roles]
  const people = picked.reduce((s, r) => s + (typeof peopleCounts?.[r] === 'number' ? peopleCounts[r] : 0), 0)
  const changes = buildShareChanges(item, picked, where)
  const ready = picked.length > 0 && reason.trim().length >= 3 && changes.length > 0

  async function share() {
    setBusy(true); setErr('')
    try {
      await saveModulePermissions(changes, reason.trim())
      try { await logAction?.('access_share_new_area', null, 'module_permissions', { area: item.storedKey, roles: picked, where, reason: reason.trim() }) } catch { /* best effort */ }
      await onDone(`${item.label} shared with ${picked.join(', ')}.`)
    } catch (e) {
      setErr(toUserMessage(e, 'The area could not be shared.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title={`Share ${item.label} with roles`}
      subtitle={`${item.label} has no role rule yet. Pick who should get it.`}
      onClose={busy ? undefined : onClose}
      footer={<>
        <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" busy={busy} disabled={!ready} onClick={share}>
          Share with {picked.length} {picked.length === 1 ? 'role' : 'roles'}
        </Btn>
      </>}>
      <div className="space-y-3 text-xs">
        <ul className="rounded-lg border border-gray-800 divide-y divide-gray-800">
          {choices.map((c) => (
            <li key={c.name}>
              <label className="flex items-center gap-2 px-3 py-2">
                <input type="checkbox" checked={roles.has(c.name)}
                  onChange={() => setRoles((s) => { const n = new Set(s); if (n.has(c.name)) n.delete(c.name); else n.add(c.name); return n })} />
                <span className="text-gray-200 flex-1">{c.name}</span>
                <span className="text-gray-500">{typeof peopleCounts?.[c.name] === 'number' ? `${peopleCounts[c.name]} ${peopleCounts[c.name] === 1 ? 'person' : 'people'}` : 'N/A'}</span>
              </label>
            </li>
          ))}
        </ul>
        {item.surface !== 'phone' && (
          <div>
            <p className="text-gray-400 mb-1">Where</p>
            <Segmented role="group" ariaLabel="Where" value={where} onChange={setWhere}
              options={[
                { key: 'web', label: 'Web' },
                { key: 'phone', label: 'Phone', disabled: !hasPhone, hint: hasPhone ? undefined : 'This area has no phone screen' },
                { key: 'both', label: 'Both', disabled: !hasPhone },
              ]} />
          </div>
        )}
        <AccessImpact
          happened={`${item.label} has no role rule, so under the policy it is Admin only.`}
          change={picked.length ? `${picked.join(', ')} get view access ${where === 'both' ? 'on web and phone' : where === 'phone' ? 'on the phone' : 'on the web'}.` : 'Pick at least one role.'}
          who={`${people} ${people === 1 ? 'person' : 'people'}.`}
          undo="Yes. Switch the cells off in the matrix or read the change in Change history." />
        <label className="block text-gray-400">
          Reason (required)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
            className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
        </label>
        {err && <Note tone="danger">{err}</Note>}
      </div>
    </Modal>
  )
}
