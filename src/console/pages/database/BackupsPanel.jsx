/**
 * Backups on the Health tab: last three nightly copies, recovery window,
 * restore-tested status, the nightly switch and the recorded restore test.
 * The full backups tool (every snapshot, per-table preview and restore) stays
 * on the Backups tab.
 */
import { useMemo, useState } from 'react'
import { DatabaseBackup, Info, RotateCcw, FlaskConical } from 'lucide-react'
import {
  Panel, PanelHeader, Badge, Btn, ErrorState, LoadingState, Note, ConfirmImpactDialog, EmptyState,
} from '../../components/ui'
import { MetricRow, PanelFoot } from '../runtime/runtimeParts'
import { fmtInt, fmtRiyadh, shapeSnapshot, recoveryWindow, cronToRiyadh } from '../../../lib/databaseCenter'
import { createBackupSnapshot } from '../../../lib/api/backups'
import { runRestoreTest } from '../../../lib/api/databaseCenter'
import { saveSystemConfigValues } from '../../../lib/api/systemConfig'
import { toUserMessage } from '../../../lib/safeError'
import { useConsoleAuth } from '../../ConsoleAuthContext'
import RestoreDialog from './RestoreDialog'

export function Switch({ on, onClick, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} onClick={onClick} disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
        on ? 'bg-emerald-600 border-emerald-600' : 'bg-gray-800 border-gray-700'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

export default function BackupsPanel({ snaps, tests, backupEnabled, cronJob, onChanged }) {
  const { logAction } = useConsoleAuth()
  const [busy, setBusy] = useState('')
  const [dlg, setDlg] = useState(null) // 'backup' | 'nightly' | 'test'
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [restoreFor, setRestoreFor] = useState(null)

  const shaped = useMemo(() => (snaps.data || []).map(shapeSnapshot), [snaps.data])
  const win = recoveryWindow(snaps.data || [])
  const last3 = shaped.slice(0, 3)
  const ok3 = last3.filter((s) => s.totalRows > 0).length
  const lastTest = (tests.data || [])[0] || null
  const schedule = cronToRiyadh(cronJob?.schedule)

  async function backupNow({ reason }) {
    setBusy('backup'); setErr('')
    try {
      const snap = await createBackupSnapshot(reason || 'manual')
      try { await logAction?.('backup_now', snap?.id || null, 'backup', { reason }) } catch { /* audit best effort */ }
      setNotice(`Backup taken: ${fmtInt(snap?.total_rows)} rows in ${fmtInt(snap?.table_count)} tables.`)
      setDlg(null); onChanged?.()
    } catch (e) { setErr(toUserMessage(e, 'The backup could not be taken.')) } finally { setBusy('') }
  }
  async function toggleNightly({ reason }) {
    setBusy('nightly'); setErr('')
    try {
      await saveSystemConfigValues({ backup_enabled: !backupEnabled })
      try { await logAction?.('nightly_backup_switch', null, 'system_config', { to: !backupEnabled, reason }) } catch { /* audit best effort */ }
      setDlg(null); onChanged?.()
    } catch (e) { setErr(toUserMessage(e, 'The setting could not be saved.')) } finally { setBusy('') }
  }
  async function runTest() {
    setBusy('test'); setErr('')
    try {
      const r = await runRestoreTest(null)
      if (r?.ok === false) setErr('There is no nightly copy to test yet.')
      else setNotice(r.status === 'passed'
        ? `Restore test passed: ${fmtInt(r.rows_restored)} of ${fmtInt(r.rows_expected)} rows rebuilt from ${fmtRiyadh(r.snapshot_taken_at, { time: true })}.`
        : `Restore test found a problem: ${fmtInt(r.rows_restored)} of ${fmtInt(r.rows_expected)} rows rebuilt. See the test list for which table.`)
      setDlg(null); onChanged?.()
    } catch (e) { setErr(toUserMessage(e, 'The restore test could not run.')) } finally { setBusy('') }
  }

  return (
    <Panel flush>
      <div className="p-4 pb-2">
        <PanelHeader icon={DatabaseBackup} title="Backups"
          subtitle={snaps.data ? `Kept 30 days, ${win.count} recovery points` : 'Nightly row copies of 8 core tables'}
          actions={<Btn icon={DatabaseBackup} busy={busy === 'backup'} onClick={() => setDlg('backup')}>Back up now</Btn>} />
        {snaps.data && last3.length > 0 && <Badge tone={ok3 === last3.length ? 'good' : 'warning'}>{ok3} of {last3.length} OK</Badge>}
      </div>
      {notice && <div className="px-4 pb-2"><Note tone="accent">{notice}</Note></div>}
      {err && <div className="px-4 pb-2"><ErrorState message={err} /></div>}
      {snaps.loading && !snaps.data ? <div className="px-4 pb-3"><LoadingState label="Reading backups" rows={3} /></div>
        : snaps.error ? <div className="px-4 pb-3"><ErrorState message={snaps.error} onRetry={snaps.reload} /></div>
          : !last3.length ? <EmptyState title="No backups recorded" reason="The nightly job has not written a copy yet." />
            : (
              <ol className="px-4 pb-2 space-y-3">
                {last3.map((s) => (
                  <li key={s.id} className="grid grid-cols-[3.5rem_1fr] gap-3">
                    <div className="text-[11px] text-gray-400 tabular-nums">{fmtRiyadh(s.takenAt)}<br /><span className="text-gray-500">{fmtRiyadh(s.takenAt, { date: false, time: true })}</span></div>
                    <div className="min-w-0 border-l border-gray-800 pl-3">
                      <p className="text-xs font-medium text-gray-200">{s.reason === 'nightly' || /cron|night/i.test(s.reason) ? 'Nightly' : 'Manual'}, {s.tableCount} tables, {fmtInt(s.totalRows)} rows</p>
                      {s.skipped.map((k) => (
                        <p key={k.table} className="text-[11px] text-gray-500">{k.table} skipped: too large for this copy ({fmtInt(k.rows)} rows)</p>
                      ))}
                      <Btn size="xs" className="mt-1" icon={RotateCcw} onClick={() => setRestoreFor(s)}>Preview restore</Btn>
                    </div>
                  </li>
                ))}
              </ol>
            )}
      <MetricRow items={[
        { label: 'Recovery points', value: snaps.data ? fmtInt(win.count) : 'N/A', sub: win.first ? `${fmtRiyadh(win.first)} to ${fmtRiyadh(win.last)}` : 'none recorded' },
        { label: 'Latest restorable', value: win.last ? fmtRiyadh(win.last, { date: false, time: true }) : 'N/A', sub: win.last ? `${fmtRiyadh(win.last)}, row copy` : 'no copy' },
        { label: 'Restore tested', value: tests.error ? 'N/A' : lastTest ? (lastTest.status === 'passed' ? 'Passed' : 'Failed') : 'Never',
          tone: tests.error ? undefined : lastTest ? (lastTest.status === 'passed' ? 'good' : 'danger') : 'warning',
          sub: tests.error ? 'could not read tests' : lastTest ? fmtRiyadh(lastTest.started_at, { time: true }) : 'no test recorded' },
      ]} />
      <div className="divide-y divide-gray-800 border-t border-gray-800">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-200">Nightly backup</p>
            <p className="text-[11px] text-gray-500">{schedule || 'Schedule not readable'}, 8 core tables{cronJob && !cronJob.active ? '. The scheduled job is paused.' : ''}</p>
          </div>
          <Switch on={backupEnabled === true} label="Nightly backup" disabled={backupEnabled == null} onClick={() => setDlg('nightly')} />
        </div>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-200">Restore test</p>
            <p className="text-[11px] text-gray-500">Rebuilds last night's copy into a scratch table, counts the rows, deletes the scratch copy. A monthly schedule needs owner decision.</p>
          </div>
          <Btn icon={FlaskConical} busy={busy === 'test'} onClick={() => setDlg('test')}>Run test now</Btn>
        </div>
      </div>
      {Array.isArray(tests.data) && tests.data.length > 0 && (
        <ul className="border-t border-gray-800 px-4 py-2 space-y-1">
          {tests.data.slice(0, 3).map((t) => (
            <li key={t.id} className="text-[11px] text-gray-400 flex flex-wrap gap-x-2">
              <Badge tone={t.status === 'passed' ? 'good' : t.status === 'failed' ? 'danger' : 'default'}>{t.status}</Badge>
              <span>{fmtRiyadh(t.started_at, { time: true })}</span>
              <span className="tabular-nums">{fmtInt(t.rows_restored)} of {fmtInt(t.rows_expected)} rows, {t.tables_tested} tables</span>
              {(t.detail || []).filter((d) => !d.ok).map((d) => <span key={d.table} className="text-red-300">{d.table} did not rebuild</span>)}
            </li>
          ))}
        </ul>
      )}
      <PanelFoot icon={Info}>
        This is row recovery for 8 tables. Full disaster recovery is the platform point-in-time restore run by Supabase; its status is not readable from here (N/A).
      </PanelFoot>

      <ConfirmImpactDialog open={dlg === 'backup'} title="Back up now" confirmLabel="Take backup" requireReason busy={busy === 'backup'}
        onCancel={() => setDlg(null)} onConfirm={backupNow}
        impact={{ what: 'Takes a row copy of the 8 core tables now.', change: 'Adds one recovery point. No data changes.', who: 'Nobody. The copy runs in the background of the database.', undo: 'Copies older than 30 days are removed by the nightly job.' }} />
      <ConfirmImpactDialog open={dlg === 'nightly'} title={backupEnabled ? 'Turn off the nightly backup' : 'Turn on the nightly backup'}
        confirmLabel={backupEnabled ? 'Turn off' : 'Turn on'} danger={!!backupEnabled} requireReason typedWord={backupEnabled ? 'OFF' : undefined}
        busy={busy === 'nightly'} onCancel={() => setDlg(null)} onConfirm={toggleNightly}
        impact={backupEnabled
          ? { tone: 'danger', what: 'Stops the nightly row copy.', change: 'From tonight no new recovery point is taken. Existing copies age out after 30 days.', who: 'Everyone, if rows are deleted by mistake later: there would be no recent copy to restore from.', undo: 'Yes. Turn it back on; the next night takes a copy again.' }
          : { what: 'Starts the nightly row copy again.', change: 'A copy is taken every night.', who: 'Nobody sees a change.', undo: 'Yes. Turn it off again.' }} />
      <ConfirmImpactDialog open={dlg === 'test'} title="Run a restore test" confirmLabel="Run test" busy={busy === 'test'}
        onCancel={() => setDlg(null)} onConfirm={runTest}
        impact={{ what: "Proves last night's copy can be read back.", change: 'Each table is rebuilt into a throwaway scratch table, counted, then deleted. Live data is never touched. The result is recorded.', who: 'Nobody.', undo: 'Nothing to undo. The test record stays in the list.' }} />
      <RestoreDialog snapshot={restoreFor} onClose={() => setRestoreFor(null)} onRestored={onChanged} />
    </Panel>
  )
}
