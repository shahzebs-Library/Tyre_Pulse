/**
 * Restore preview for one nightly copy: per table, rows in the copy, rows
 * missing now, rows that would be re-inserted. Uses the existing
 * backup_restore_preview / backup_restore_missing functions, which only ever
 * put back rows whose id no longer exists and never overwrite a live row.
 * Typed RESTORE and a reason are required; the button stays locked at 0.
 */
import { useEffect, useState } from 'react'
import { RotateCcw, CheckCircle2 } from 'lucide-react'
import { Modal, Btn, Table, THead, Th, Tr, Td, LoadingState, ErrorState, ImpactBox, Note } from '../../components/ui'
import { restorePreview, restoreMissing } from '../../../lib/api/backups'
import { fmtInt, fmtRiyadh } from '../../../lib/databaseCenter'
import { toUserMessage } from '../../../lib/safeError'
import { useConsoleAuth } from '../../ConsoleAuthContext'

export default function RestoreDialog({ snapshot, onClose, onRestored }) {
  const { logAction } = useConsoleAuth() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  useEffect(() => {
    let off = false
    setRows(null); setError(''); setReason(''); setTyped(''); setDone('')
    if (!snapshot) return undefined
    ;(async () => {
      const out = []
      for (const t of snapshot.tables) {
        if (t.skipped) { out.push({ table: t.name, skipped: true, snapshot_rows: t.rows }); continue }
        try { out.push({ table: t.name, ...(await restorePreview(snapshot.id, t.name)) }) } catch (e) {
          out.push({ table: t.name, error: toUserMessage(e, 'Could not compare this table.') })
        }
      }
      if (!off) setRows(out)
    })().catch((e) => { if (!off) setError(toUserMessage(e, 'The preview could not run.')) })
    return () => { off = true }
  }, [snapshot])

  const missing = (rows || []).reduce((s, r) => s + (Number(r.missing_rows) || 0), 0)
  const inCopy = (rows || []).reduce((s, r) => s + (r.skipped ? 0 : Number(r.snapshot_rows) || 0), 0)
  const ready = missing > 0 && reason.trim().length >= 3 && typed.trim() === 'RESTORE' && !busy

  async function restore() {
    setBusy(true); setError('')
    let put = 0
    try {
      for (const r of rows.filter((x) => Number(x.missing_rows) > 0)) {
        const res = await restoreMissing(snapshot.id, r.table)
        put += Number(res?.restored) || 0
      }
      try { await logAction?.('backup_restore_missing', snapshot.id, 'backup', { reason: reason.trim(), rows: put }) } catch { /* audit best effort */ }
      setDone(`Put back ${fmtInt(put)} rows. Nothing that exists now was changed.`)
      onRestored?.()
    } catch (e) { setError(toUserMessage(e, 'The restore stopped part way. Rows already put back stay.')) } finally { setBusy(false) }
  }

  return (
    <Modal open={!!snapshot} onClose={busy ? () => {} : onClose} width="max-w-3xl"
      title={snapshot ? `Restore missing rows from ${fmtRiyadh(snapshot.takenAt, { time: true })}` : ''}
      subtitle="A restore only puts back rows deleted since the backup. It never changes or overwrites a row that exists now."
      footer={(
        <>
          <Btn onClick={onClose} disabled={busy}>{done ? 'Close' : 'Cancel'}</Btn>
          {!done && <Btn variant="danger" icon={RotateCcw} busy={busy} disabled={!ready} onClick={restore}>Restore {fmtInt(missing)} rows</Btn>}
        </>
      )}>
      <div className="space-y-3">
        {!rows && !error ? <LoadingState label="Comparing the copy with live data" rows={4} /> : null}
        {error && <ErrorState message={error} />}
        {rows && (
          <Table>
            <THead><Th>Table</Th><Th align="right">Rows in backup</Th><Th align="right">Missing now</Th><Th align="right">Will re-insert</Th></THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.table}>
                  <Td className="font-mono text-[11.5px]">{r.table}</Td>
                  <Td align="right" className="tabular-nums">{r.skipped ? 'skipped' : fmtInt(r.snapshot_rows)}</Td>
                  <Td align="right" className="tabular-nums">{r.skipped || r.error ? 'N/A' : fmtInt(r.missing_rows)}</Td>
                  <Td align="right" className="tabular-nums">{r.skipped || r.error ? 'N/A' : fmtInt(r.missing_rows)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {rows && rows.some((r) => r.error) && <Note tone="warning">Some tables could not be compared, so their counts read N/A.</Note>}
        {rows && missing === 0 && (
          <Note tone="accent" icon={CheckCircle2}>
            Checked just now: nothing is missing. All {fmtInt(inCopy)} rows in this backup still exist, so there is nothing to restore. The button stays locked.
          </Note>
        )}
        {done && <Note tone="accent" icon={CheckCircle2}>{done}</Note>}
        {rows && (
          <ImpactBox tone={missing > 0 ? 'warning' : 'info'}
            what={`Preview compared ${fmtInt(inCopy)} backup rows with live data.`}
            change={`Would re-insert ${fmtInt(missing)} rows. Newer data is never overwritten.`}
            who={missing > 0 ? 'Users will see the deleted rows return.' : 'Nobody today.'}
            undo="Yes. Re-inserted rows keep their original ids and can be removed again." />
        )}
        {rows && missing > 0 && !done && (
          <>
            <label className="block">
              <span className="block text-[11px] font-semibold text-gray-400 mb-1">Reason (goes to the audit log)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off"
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                placeholder="Why are you restoring?" />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-gray-400 mb-1">Type <span className="font-mono text-gray-200">RESTORE</span> to confirm</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} aria-label="Type RESTORE to confirm"
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs font-mono text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
            </label>
          </>
        )}
      </div>
    </Modal>
  )
}
