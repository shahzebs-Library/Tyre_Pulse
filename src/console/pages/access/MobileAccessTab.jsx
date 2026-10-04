/**
 * MobileAccessTab - picks a role or one person, then renders the existing
 * MobileAccessPanel, which switches the REAL phone module keys
 * (src/lib/mobileModules.js) on or off through `mobile:` rows.
 */
import { useMemo, useState } from 'react'
import { Smartphone } from 'lucide-react'
import MobileAccessPanel from './MobileAccessPanel'
import { displayName } from './UserDirectory'
import { Note, Panel, PanelHeader, Segmented, Select, Toolbar } from '../../components/ui'

export default function MobileAccessTab({ columns, profiles }) {
  const [mode, setMode] = useState('role')
  const [role, setRole] = useState('Tyre Man')
  const [userId, setUserId] = useState('')
  const roleOptions = (columns || []).map((c) => ({ value: c.name, label: c.name }))
  const people = useMemo(() => (profiles || []).filter((p) => p.approved !== false)
    .map((p) => ({ value: p.id, label: `${displayName(p)} (${p.role || 'no role'})` }))
    .sort((a, b) => a.label.localeCompare(b.label)), [profiles])
  const user = (profiles || []).find((p) => p.id === userId) || null

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader icon={Smartphone} title="Mobile app access"
          subtitle="The Flutter field app has its own screens and keys. Switch a screen off for a whole role or for one person. Applies on the person's next sign-in or return to the app." />
        <Toolbar>
          <Segmented role="group" ariaLabel="Role or person" value={mode} onChange={setMode}
            options={[{ key: 'role', label: 'A role' }, { key: 'user', label: 'One person' }]} />
          {mode === 'role'
            ? <Select ariaLabel="Role" value={role} onChange={setRole} options={roleOptions} className="w-56" />
            : <Select ariaLabel="Person" value={userId} onChange={setUserId} placeholder="Pick a person" options={people} className="w-72" />}
        </Toolbar>
      </Panel>
      {mode === 'user' && !user
        ? <Note>Pick a person to see and change their phone screens.</Note>
        : <MobileAccessPanel key={mode === 'role' ? `r:${role}` : `u:${userId}`} mode={mode} role={role} user={user} canWriteRole canWriteUser />}
    </div>
  )
}
