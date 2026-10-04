/**
 * StagedChanges - the list of matrix cells switched but not yet saved, each in
 * plain English with who it touches, a required reason, and Save / Discard.
 * Saving is done by the host (one batch through save_access_control_matrix,
 * whose module_permissions writes are recorded by the access_audit trigger).
 */
import { useState } from 'react'
import { Monitor, Smartphone, Undo2, Save } from 'lucide-react'
import { describeChange, stagedPeople, surfaceOf } from '../../../lib/accessOverview'
import { Btn, Note, Panel, PanelHeader } from '../../components/ui'
import AccessImpact from './AccessImpact'

export default function StagedChanges({ changes, peopleCounts, onUndo, onDiscard, onSave, saving, error, notice }) {
  const [reason, setReason] = useState('')
  const count = changes.length
  const impact = stagedPeople(changes, peopleCounts)
  const reasonOk = reason.trim().length >= 3

  async function save() {
    const ok = await onSave(reason.trim())
    if (ok) setReason('')
  }

  return (
    <Panel>
      <PanelHeader title={`Unsaved changes${count ? ` (${count})` : ''}`}
        subtitle="Switch cells in the matrix; every change waits here until you save it with a reason."
        actions={count ? (
          <div className="flex gap-2">
            <Btn size="xs" onClick={onDiscard} disabled={saving}>Discard</Btn>
          </div>
        ) : null} />
      {notice && <Note tone="accent">{notice}</Note>}
      {!count ? (
        <p className="text-xs text-gray-500 py-2">Nothing staged. Click a web or phone switch in the matrix to start.</p>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-2">
            {changes.map((c) => {
              const d = describeChange(c, peopleCounts)
              const Icon = surfaceOf(c.storedKey) === 'phone' ? Smartphone : Monitor
              return (
                <li key={`${c.role}|${c.storedKey}`} className="flex items-start gap-2 rounded-lg border border-gray-800 p-2">
                  <Icon size={14} className={c.enabled ? 'text-emerald-400 mt-0.5' : 'text-orange-400 mt-0.5'} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-200 font-medium">{d.title}</p>
                    <p className="text-[11px] text-gray-500">{d.detail}</p>
                  </div>
                  <Btn size="xs" variant="quiet" icon={Undo2} title={`Undo: ${d.title}`} onClick={() => onUndo(c)} />
                </li>
              )
            })}
          </ul>
          <AccessImpact compact
            happened={`You changed ${count} ${count === 1 ? 'cell' : 'cells'} in the matrix. Nothing is saved yet.`}
            change="Each role gains or loses the listed area on the web or the phone. Built-in defaults become saved rules."
            who={impact.known
              ? `${impact.total} ${impact.total === 1 ? 'person' : 'people'} across ${impact.roles} ${impact.roles === 1 ? 'role' : 'roles'}. Phones update their menu at next open.`
              : `${impact.roles} ${impact.roles === 1 ? 'role' : 'roles'}; people count could not be read for all of them.`}
            undo="Yes. Each change becomes one line in Change history; switch the cell back to reverse it." />
          <label className="block text-xs text-gray-400">
            Reason (required)
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
              placeholder="For example: monthly review with site managers"
              className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
          </label>
          {error && <Note tone="danger">{error}</Note>}
          <div className="flex justify-end">
            <Btn variant="primary" icon={Save} busy={saving} disabled={!reasonOk} onClick={save}
              title={reasonOk ? undefined : 'Write a reason first'}>
              Save {count} {count === 1 ? 'change' : 'changes'}
            </Btn>
          </div>
        </div>
      )}
    </Panel>
  )
}
