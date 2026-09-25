/**
 * RetentionPanel.jsx - how long server tenant exports stay in private storage.
 *
 * A server export is a full copy of a tenant's data, so it must not sit in
 * storage forever. A daily job (02:40 UTC) deletes the files of every export
 * older than the retention window; "Delete expired now" queues the same job.
 * Both the setting and the purge are super-admin only and audited server-side.
 */
import { useCallback, useEffect, useState } from 'react'
import { Timer, Trash2, Save, RefreshCw } from 'lucide-react'
import { Panel, PanelHeader, Note, StatTile, Btn, LoadingState, ErrorState, Modal } from '../../components/ui'
import { getRetentionStatus, setRetentionDays, purgeExpiredNow } from '../../../lib/api/tenantExport'
import { validateRetentionDays, RETENTION_MIN, RETENTION_MAX } from '../../../lib/tenantExport'
import { toUserMessage } from '../../../lib/safeError'

function fmtWhen(v) {
  if (!v) return 'Never'
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function RetentionPanel({ onPurged }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [purging, setPurging] = useState(false)
  const [msg, setMsg] = useState('')
  const [confirmPurge, setConfirmPurge] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const s = await getRetentionStatus()
      setStatus(s)
      setDraft(s.days == null ? '' : String(s.days))
    } catch (e) {
      setErr(toUserMessage(e, 'Could not read the retention setting.'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const draftError = draft === '' ? '' : validateRetentionDays(draft)
  const changed = status && status.days != null && String(status.days) !== draft.trim()

  async function save() {
    const v = validateRetentionDays(draft)
    if (v) { setErr(v); return }
    setSaving(true); setErr(''); setMsg('')
    try {
      await setRetentionDays(Number(draft.trim()))
      setMsg(`Exports are now kept for ${Number(draft.trim())} day(s).`)
      await load()
    } catch (e) {
      setErr(toUserMessage(e, 'The retention setting could not be saved.'))
    } finally { setSaving(false) }
  }

  async function purge() {
    setConfirmPurge(false)
    setPurging(true); setErr(''); setMsg('')
    try {
      const r = await purgeExpiredNow()
      setMsg(r.queued
        ? `Deleting ${r.due} expired export(s). This runs on the server and takes a few seconds.`
        : 'Nothing has expired yet. No files were deleted.')
      if (r.queued) {
        setTimeout(() => { load(); onPurged?.() }, 6000)
      }
    } catch (e) {
      setErr(toUserMessage(e, 'The purge could not be started.'))
    } finally { setPurging(false) }
  }

  return (
    <Panel>
      <PanelHeader icon={Timer} title="Export retention"
        subtitle="Server export files are a full copy of a tenant's data. They are deleted automatically once they are older than this window. The export record stays, marked Expired."
        actions={<Btn size="xs" icon={RefreshCw} onClick={load} disabled={loading}>Refresh</Btn>} />
      <ErrorState message={err} onRetry={status ? undefined : load} />
      {loading && !status ? <LoadingState label="Reading the retention setting" rows={2} /> : status && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <StatTile label="Kept for" value={status.days == null ? 'N/A' : `${status.days} day(s)`} sub="then deleted" />
            <StatTile label="Due for deletion" value={status.dueCount} tone={status.dueCount ? 'warning' : 'default'} sub="older than the window" />
            <StatTile label="Stored exports" value={status.storedJobs == null ? 'N/A' : status.storedJobs} sub="files still in storage" />
            <StatTile label="Last deletion" value={fmtWhen(status.lastPurgeAt)} sub={status.nextRun ? `Runs ${status.nextRun}` : ''} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-400">
              <span className="block mb-1">Keep exports for (days, {RETENTION_MIN} to {RETENTION_MAX})</span>
              <input
                type="number" min={RETENTION_MIN} max={RETENTION_MAX} value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Retention in days"
                className="w-28 bg-gray-900 border border-gray-800 rounded-lg px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              />
            </label>
            <Btn variant="primary" icon={Save} busy={saving} disabled={!changed || !!draftError} onClick={save}>Save</Btn>
            <Btn variant="danger" icon={Trash2} busy={purging} disabled={!status.dueCount} onClick={() => setConfirmPurge(true)}
              title={status.dueCount ? 'Delete the files of every expired export now' : 'Nothing has expired yet'}>
              Delete expired now
            </Btn>
          </div>
          {draftError && <p className="text-xs text-amber-300">{draftError}</p>}
          {msg && <Note tone="accent">{msg}</Note>}
          <Note>Deletion cannot be undone. An expired export can no longer be downloaded; run a new export if the data is needed again. Every change and every deletion is recorded in the console audit trail.</Note>
        </div>
      )}
      <Modal open={confirmPurge} title="Delete expired exports now?" width="max-w-md"
        onClose={() => setConfirmPurge(false)}
        footer={(
          <>
            <Btn onClick={() => setConfirmPurge(false)}>Cancel</Btn>
            <Btn variant="danger" icon={Trash2} busy={purging} onClick={purge}>Delete {status?.dueCount || ''} expired</Btn>
          </>
        )}>
        <p className="text-sm text-gray-300">
          The files of {status?.dueCount || 0} expired export(s) are deleted from storage. This cannot be undone; the
          export records stay, marked Expired.
        </p>
      </Modal>
    </Panel>
  )
}
