import { useEffect, useRef, useState } from 'react'
import { Download, FileText, FileSpreadsheet, FileType, Check, Loader2 } from 'lucide-react'
import {
  runTableExport,
  EXPORT_MODES,
  EXPORT_FORMATS,
  modeLabel,
} from '../../lib/report/tableReport'

/**
 * ExportMenu — state-faithful export dropdown for EnterpriseTable.
 *
 * Lets the user pick a MODE (which rows) then a FORMAT (PDF/Excel/CSV). Every
 * export reads the live table state (filters, search, multi-sort, visible
 * columns, selection), so the file matches exactly what is on screen.
 *
 * `meta`: { title, company, currency, branding, dateRange } — optional report
 * branding/context forwarded to the renderers.
 */
export default function ExportMenu({
  table,
  fileName = 'table_export',
  meta = {},
  hasSelection = false,
  disabled = false,
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState(EXPORT_MODES.FILTERED)
  const [busy, setBusy] = useState(null) // format currently exporting
  const [errored, setErrored] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Selection-only mode is offered only while rows are ticked.
  useEffect(() => {
    if (!hasSelection && mode === EXPORT_MODES.SELECTED) setMode(EXPORT_MODES.FILTERED)
  }, [hasSelection, mode])

  const modes = [
    { key: EXPORT_MODES.CURRENT, hint: 'The rows on this page' },
    { key: EXPORT_MODES.FILTERED, hint: 'All rows matching current filters' },
    ...(hasSelection ? [{ key: EXPORT_MODES.SELECTED, hint: 'Only the ticked rows' }] : []),
  ]

  const formats = [
    { key: EXPORT_FORMATS.PDF, label: 'PDF', icon: FileText },
    { key: EXPORT_FORMATS.EXCEL, label: 'Excel', icon: FileSpreadsheet },
    { key: EXPORT_FORMATS.CSV, label: 'CSV', icon: FileType },
  ]

  async function handleExport(format) {
    setBusy(format)
    setErrored(false)
    try {
      await runTableExport({
        table,
        format,
        mode,
        fileName,
        title: meta.title || fileName,
        company: meta.company || '',
        currency: meta.currency || 'SAR',
        branding: meta.branding,
        dateRange: meta.dateRange,
      })
      setOpen(false)
    } catch (err) {
      // Surface failure instead of silently producing nothing.
      console.error('Export failed', err)
      setErrored(true)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5 disabled:opacity-40"
        aria-haspopup="true"
        aria-expanded={open}
        title="Export current view"
      >
        <Download size={13} /> Export
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-60 rounded-xl border border-[var(--border-dim)] bg-surface-2 shadow-float p-2">
          <p className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Rows to export
          </p>
          <div className="flex flex-col gap-0.5">
            {modes.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-surface-3"
              >
                <span
                  className={`flex items-center justify-center w-3.5 h-3.5 rounded-full border ${
                    mode === m.key
                      ? 'bg-[var(--accent)] border-[var(--accent)]'
                      : 'border-[var(--border-bright)]'
                  }`}
                >
                  {mode === m.key && <Check size={10} className="text-white" />}
                </span>
                <span className="flex-1">
                  <span className="block text-[var(--text-primary)]">{modeLabel(m.key)}</span>
                  <span className="block text-[10px] text-muted">{m.hint}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="my-2 border-t border-[var(--border-dim)]" />

          <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Format
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {formats.map((f) => {
              const Icon = f.icon
              const isBusy = busy === f.key
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => handleExport(f.key)}
                  disabled={busy != null}
                  className="flex flex-col items-center gap-1 py-2 rounded-lg border border-[var(--border-dim)] hover:bg-surface-3 disabled:opacity-50 transition-colors"
                >
                  {isBusy ? (
                    <Loader2 size={15} className="animate-spin text-[var(--accent)]" />
                  ) : (
                    <Icon size={15} className="text-[var(--text-secondary)]" />
                  )}
                  <span className="text-[11px] text-[var(--text-primary)]">{f.label}</span>
                </button>
              )
            })}
          </div>

          {errored && (
            <p className="mt-2 px-2 text-[10px] text-red-400">
              Export failed — please retry.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
