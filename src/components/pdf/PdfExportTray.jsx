/**
 * Progress and result of bulk PDF downloads. Mounted once in the layout, so a ZIP
 * that was started on the inspections page keeps going while the person works elsewhere.
 */
import { useSyncExternalStore } from 'react'
import { Download, X, FileArchive } from 'lucide-react'
import { subscribeExportTasks, getExportTasks, cancelExportTask, dismissExportTask } from '../../lib/pdfCache/exportTasks'
import { saveBlob } from '../../lib/pdfCache/service'

export default function PdfExportTray() {
  const tasks = useSyncExternalStore(subscribeExportTasks, getExportTasks, getExportTasks)
  if (!tasks.length) return null
  return (
    <div className="fixed bottom-4 right-4 z-[70] flex w-[min(92vw,360px)] flex-col gap-2" role="region" aria-label="PDF downloads">
      {tasks.map((t) => {
        const pct = t.total > 0 ? Math.round((t.done / t.total) * 100) : 0
        return (
          <div key={t.id} className="rounded-xl border p-3 shadow-lg" role="status" aria-live="polite"
            style={{ background: 'var(--surface-raised, var(--card-bg))', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium"><FileArchive size={16} aria-hidden /> {t.title}</div>
              <button type="button" className="min-h-[32px] min-w-[32px] rounded-md" aria-label={t.status === 'running' ? 'Cancel download' : 'Dismiss'}
                onClick={() => (t.status === 'running' ? cancelExportTask(t.id) : dismissExportTask(t.id))}><X size={14} aria-hidden /></button>
            </div>
            {t.status === 'running' && (
              <>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--border)' }}
                  role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                  <div className="h-full" style={{ width: `${pct}%`, background: 'var(--accent, #16a34a)' }} />
                </div>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {t.cancelled ? 'Cancelling...' : t.phase === 'zip' ? 'Building the ZIP file...' : `Preparing ${t.done} of ${t.total} reports`}
                </p>
              </>
            )}
            {t.status === 'ready' && t.result && (
              <div className="mt-2">
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {t.result.included} included{t.result.missing ? `, ${t.result.missing} missing (listed in manifest.csv inside the ZIP)` : ''}.
                </p>
                <button type="button" className="btn-secondary mt-2 flex min-h-[36px] items-center gap-1.5 text-sm"
                  onClick={() => saveBlob(t.result.blob, t.result.fileName)}>
                  <Download size={14} aria-hidden /> Save ZIP again
                </button>
              </div>
            )}
            {t.status === 'failed' && <p role="alert" className="mt-2 text-xs text-red-500">{t.error}</p>}
          </div>
        )
      })}
    </div>
  )
}
