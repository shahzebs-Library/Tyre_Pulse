/**
 * WhoCanDoThis - the reverse lookup: pick an area, see which roles reach it on
 * the web and the phone (and whether through a saved rule or the built-in
 * default), how many people that is, and every person-level exception for it.
 * Read only; built from data the host already loaded.
 */
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { ALL_MODULES } from '../../../lib/moduleCatalog'
import { MOBILE_PREFIX, mobileKeyFor, phoneCell, webCell } from '../../../lib/accessOverview'
import { displayName } from './UserDirectory'
import { Badge, EmptyState, Panel, PanelHeader, Select, Table, THead, Th, Tr, Td } from '../../components/ui'

export default function WhoCanDoThis({ permMap, columns, peopleCounts, grants, profiles }) {
  const [area, setArea] = useState('')
  const options = ALL_MODULES.map((m) => ({ value: m.key, label: `${m.label} (${m.group})` }))
  const mk = area ? mobileKeyFor(area) : null
  const byId = useMemo(() => new Map((profiles || []).map((p) => [p.id, p])), [profiles])

  const roleRows = useMemo(() => {
    if (!area) return []
    return (columns || []).map((c) => {
      const w = webCell(permMap, c.name, area)
      const p = phoneCell(permMap, c.name, mk)
      return { role: c.name, w, p, people: peopleCounts?.[c.name] }
    }).filter((r) => r.w.on || (r.p && r.p.on))
  }, [area, mk, columns, permMap, peopleCounts])

  const personRows = useMemo(() => (grants || []).filter((g) =>
    area && (g.module_key === area || (mk && g.module_key === MOBILE_PREFIX + mk))), [grants, area, mk])

  const total = roleRows.reduce((s, r) => s + (typeof r.people === 'number' ? r.people : 0), 0)
  const src = (s) => (!s ? 'N/A' : s.locked ? 'Always' : s.saved ? 'Saved rule' : 'Built-in default')

  return (
    <Panel>
      <PanelHeader icon={Search} title="Who can do this?" subtitle="Pick an area to see every role and person that reaches it." />
      <Select ariaLabel="Area" value={area} onChange={setArea} placeholder="Pick an area" options={options} className="max-w-md mb-3" />
      {!area ? <EmptyState title="No area picked" reason="Choose an area above." /> : !permMap ? (
        <EmptyState title="Rules not loaded" reason="The role rules could not be read." />
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">{roleRows.length} {roleRows.length === 1 ? 'role reaches' : 'roles reach'} it, about {total} {total === 1 ? 'person' : 'people'}, plus {personRows.length} person {personRows.length === 1 ? 'exception' : 'exceptions'}.</p>
          <Table>
            <THead><Th>Role</Th><Th>People</Th><Th>Web</Th><Th>Phone</Th></THead>
            <tbody>
              {roleRows.map((r) => (
                <Tr key={r.role}>
                  <Td>{r.role}</Td><Td>{typeof r.people === 'number' ? r.people : 'N/A'}</Td>
                  <Td><Badge tone={r.w.on ? 'good' : 'quiet'}>{r.w.on ? 'On' : 'Off'}</Badge> <span className="text-gray-500">{src(r.w)}</span></Td>
                  <Td>{r.p ? <><Badge tone={r.p.on ? 'good' : 'quiet'}>{r.p.on ? 'On' : 'Off'}</Badge> <span className="text-gray-500">{src(r.p)}</span></> : 'Web only'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {personRows.length > 0 && (
            <Table>
              <THead><Th>Person</Th><Th>Rule</Th><Th>Where</Th><Th>Ends</Th></THead>
              <tbody>
                {personRows.map((g) => {
                  const p = byId.get(g.user_id)
                  return (
                    <Tr key={g.id}>
                      <Td>{p ? displayName(p) : 'Unknown person'}</Td>
                      <Td><Badge tone={g.effect === 'revoke' ? 'danger' : 'good'}>{g.effect === 'revoke' ? 'Block' : 'Allow'}</Badge></Td>
                      <Td>{g.module_key.startsWith(MOBILE_PREFIX) ? 'Phone' : 'Web'}</Td>
                      <Td>{g.expires_at ? String(g.expires_at).slice(0, 10) : 'No end date'}</Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </div>
      )}
    </Panel>
  )
}
