import { useCallback, useMemo, useRef, useState } from 'react'
import { Upload, Download, AlertTriangle, CheckCircle2, Loader2, FileSpreadsheet } from 'lucide-react'
import Modal from '../ui/Modal'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel } from '../../lib/exportUtils'
import { parseWorkbook } from '../../lib/import/parseWorkbook'
import {
  parsePlanRows, planTemplateRows, buildPlanRef, PLAN_COLUMNS, MAX_PLAN_UPLOAD_ROWS,
} from '../../lib/schedulePlan'
import { createPlanBatch } from '../../lib/api/schedulePlanning'

const PREVIEW_LIMIT = 200

/**
 * Upload a week of inspection plans from a spreadsheet.
 *
 * Every row is validated against the live fleet register and the real staff
 * list before anything is written, and a row that cannot be resolved is shown
 * with the reason rather than dropped. Nothing is committed until the planner
 * presses the button.
 */
export default function PlanUploadModal({
  open, onClose, country, fleet, people, today, profileId, onCommitted,
}) {
  const fileRef = useRef(null)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [showBlockedOnly, setShowBlockedOnly] = useState(false)

  const reset = useCallback(() => {
    setFileName(''); setParsed(null); setError(''); setResult(null); setShowBlockedOnly(false)
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  const close = useCallback(() => { reset(); onClose?.() }, [reset, onClose])

  const downloadTemplate = useCallback(async () => {
    setError('')
    try {
      const sample = fleet?.[0]
      const rows = planTemplateRows({ asset_no: sample?.asset_no, site: sample?.site })
      const headers = PLAN_COLUMNS.map(column => column.header)
      await exportToExcel(rows, headers, headers, 'inspection-plan-template', 'Plan')
    } catch (err) {
      setError(toUserMessage(err, 'Could not build the template.'))
    }
  }, [fleet])

  const onFile = useCallback(async event => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true); setError(''); setResult(null); setParsed(null); setFileName(file.name)
    try {
      const book = await parseWorkbook(file, { fileName: file.name })
      const sheet = book?.sheets?.[0]
      if (!sheet || !sheet.dataRows?.length) {
        setError('That file has no rows under a header. Check the first sheet and try again.')
        return
      }
      setParsed(parsePlanRows(sheet.dataRows, { assets: fleet, people, today }))
    } catch (err) {
      setError(toUserMessage(err, 'That file could not be read.'))
    } finally {
      setBusy(false)
    }
  }, [fleet, people, today])

  const commit = useCallback(async () => {
    if (!parsed?.ready.length) return
    setBusy(true); setError('')
    try {
      const planRef = buildPlanRef(new Date())
      const outcome = await createPlanBatch(parsed.ready, { country, planRef, profileId })
      setResult({ ...outcome, attempted: parsed.ready.length })
      if (outcome.inserted > 0) onCommitted?.(outcome)
    } catch (err) {
      // A partial load must never read as a clean failure: say what landed and
      // under which reference, so the planner can undo or finish it.
      const landed = Number(err?.inserted || 0)
      if (landed > 0) {
        setResult({ inserted: landed, attempted: parsed.ready.length, planRef: err.planRef, partial: true })
        onCommitted?.({ inserted: landed })
      }
      setError(toUserMessage(err, 'The plans could not be saved.'))
    } finally {
      setBusy(false)
    }
  }, [parsed, country, profileId, onCommitted])

  const visibleRows = useMemo(() => {
    if (!parsed) return []
    const list = showBlockedOnly ? parsed.rows.filter(row => !row.ready) : parsed.rows
    return list.slice(0, PREVIEW_LIMIT)
  }, [parsed, showBlockedOnly])

  const summary = parsed?.summary
  const canCommit = Boolean(summary?.ready) && !summary.overLimit && !busy && !result

  return (
    <Modal
      open={open}
      onClose={close}
      title="Upload an inspection plan"
      subtitle="Add a week of scheduled inspections from a spreadsheet"
      size="xl"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3 w-full">
          <span className="text-sm text-[var(--text-secondary)]">
            {summary
              ? `${summary.ready} ready, ${summary.blocked} need a fix`
              : `Up to ${MAX_PLAN_UPLOAD_ROWS} plans per upload`}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={close}>
              {result ? 'Close' : 'Cancel'}
            </button>
            <button type="button" className="btn-primary" disabled={!canCommit} onClick={commit}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null}
              {summary?.ready ? `Schedule ${summary.ready} inspection${summary.ready === 1 ? '' : 's'}` : 'Schedule'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
        <section className="card p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">1. Start from the template</h3>
              <p className="text-sm text-[var(--text-secondary)]">
                Only <strong>Asset Code</strong> and <strong>Planned Date</strong> are required. Site is filled
                from the fleet register when you leave it blank.
              </p>
            </div>
            <button type="button" className="btn-secondary shrink-0" onClick={downloadTemplate}>
              <Download size={16} /> Download template
            </button>
          </div>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {PLAN_COLUMNS.map(column => (
              <li key={column.key} className="flex gap-2">
                <span className="font-medium">{column.header}</span>
                {column.required
                  ? <span className="text-[var(--danger,#dc2626)] text-xs self-center">required</span>
                  : null}
                <span className="text-[var(--text-dim)] truncate">{column.hint}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--text-dim)]">
            Dates are read day first, so 07-09-2026 means 7 September 2026.
          </p>
        </section>

        <section className="card p-4 space-y-3">
          <h3 className="font-semibold">2. Upload the filled sheet</h3>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={16} /> Choose file
            </button>
            <input
              ref={fileRef} type="file" className="sr-only"
              accept=".xlsx,.xls,.csv,.txt" onChange={onFile}
              aria-label="Inspection plan spreadsheet"
            />
            {fileName ? (
              <span className="text-sm inline-flex items-center gap-2">
                <FileSpreadsheet size={14} /> {fileName}
              </span>
            ) : null}
            {busy && !result ? <Loader2 size={16} className="animate-spin" /> : null}
          </div>

          {error ? (
            <p role="alert" className="text-sm text-[var(--danger,#dc2626)] inline-flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}

          {summary?.overLimit ? (
            <p role="alert" className="text-sm text-[var(--danger,#dc2626)]">
              That sheet holds {summary.total} rows. Split it into files of {MAX_PLAN_UPLOAD_ROWS} or fewer.
            </p>
          ) : null}

          {summary && !result ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Pill tone="good" label={`${summary.ready} ready`} />
              {summary.blocked ? <Pill tone="danger" label={`${summary.blocked} need a fix`} /> : null}
              {summary.unassigned ? <Pill tone="warning" label={`${summary.unassigned} unassigned`} /> : null}
              {summary.blocked ? (
                <button
                  type="button"
                  className="btn-secondary py-1 px-2 text-xs"
                  aria-pressed={showBlockedOnly}
                  onClick={() => setShowBlockedOnly(value => !value)}
                >
                  {showBlockedOnly ? 'Show all rows' : 'Show only rows to fix'}
                </button>
              ) : null}
            </div>
          ) : null}

          {summary?.unassigned && !result ? (
            <p className="text-xs text-[var(--text-dim)]">
              An unassigned plan is still scheduled, and shows on the board as needing an owner.
            </p>
          ) : null}
        </section>

        {result ? (
          <section className="card p-4 space-y-2" role="status">
            <h3 className="font-semibold inline-flex items-center gap-2">
              <CheckCircle2 size={16} /> Upload {result.inserted < result.attempted ? 'partly ' : ''}complete
            </h3>
            <p className="text-sm">
              {result.inserted} of {result.attempted} plans scheduled under reference{' '}
              <strong>{result.planRef}</strong>.
            </p>
            {result.inserted < result.attempted ? (
              <p className="text-sm text-[var(--danger,#dc2626)]">
                {result.attempted - result.inserted} rows did not save. Nothing was lost from the file, so
                correct and upload those rows again.
              </p>
            ) : null}
          </section>
        ) : null}

        {parsed && !result ? (
          <section className="space-y-2">
            <h3 className="font-semibold">3. Check before scheduling</h3>
            <div className="overflow-auto max-h-80 border border-[var(--hairline)] rounded">
              <table className="w-full text-sm">
                <caption className="sr-only">Uploaded inspection plan rows and any problems found</caption>
                <thead className="sticky top-0 bg-[var(--surface-raised,var(--panel))]">
                  <tr>
                    {['Row', 'Asset', 'Date', 'Time', 'Assigned to', 'Team', 'Site', 'Status'].map(head => (
                      <th key={head} scope="col" className="text-start p-2 font-medium whitespace-nowrap">{head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(row => (
                    <tr key={row.rowNumber} className="border-t border-[var(--hairline)] align-top">
                      <td className="p-2 text-[var(--text-dim)]">{row.rowNumber}</td>
                      <td className="p-2 font-medium">{row.asset_no || '-'}</td>
                      <td className="p-2 whitespace-nowrap">{row.scheduled_date || '-'}</td>
                      <td className="p-2">{row.inspection_time}</td>
                      <td className="p-2">{row.assigned_name || <span className="text-[var(--text-dim)]">Nobody yet</span>}</td>
                      <td className="p-2">{row.team || '-'}</td>
                      <td className="p-2">{row.site || '-'}</td>
                      <td className="p-2">
                        {row.ready
                          ? <Pill tone="good" label="Ready" />
                          : <span className="text-[var(--danger,#dc2626)]">{row.problems.join(' ')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.rows.length > visibleRows.length ? (
              <p className="text-xs text-[var(--text-dim)]">
                Showing {visibleRows.length} of {parsed.rows.length} rows. All {parsed.summary.ready} ready rows
                are scheduled when you confirm, not only the ones listed here.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </Modal>
  )
}

const TONES = {
  good: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  danger: 'bg-red-500/10 text-red-600 border-red-500/30',
  warning: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
}

function Pill({ tone, label }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone] || TONES.warning}`}>
      {label}
    </span>
  )
}
