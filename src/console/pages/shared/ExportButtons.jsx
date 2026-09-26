/**
 * ExportButtons - the Excel + PDF export pair used by console list panels.
 * Exports exactly the rows passed in (the filtered, sorted view on screen),
 * so a download always matches what the reader is looking at. Failures are
 * reported through toUserMessage, never as raw driver text, either to the
 * caller's onError or inline next to the buttons (never replacing the data).
 */
import { useState } from 'react'
import { FileSpreadsheet, FileText } from 'lucide-react'
import { Btn } from '../../components/ui'
import { exportConsoleRows } from '../../../lib/consoleTable'
import { toUserMessage } from '../../../lib/safeError'

export default function ExportButtons({ rows, columns, title, onError, disabled }) {
  const [busy, setBusy] = useState(null)
  const [failed, setFailed] = useState(null)
  const empty = !Array.isArray(rows) || rows.length === 0
  async function run(format) {
    setBusy(format)
    setFailed(null)
    try {
      await exportConsoleRows({ rows, columns, title, format })
    } catch (err) {
      const msg = toUserMessage(err, 'The export could not be created.')
      if (onError) onError(msg)
      else setFailed(msg)
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <Btn icon={FileSpreadsheet} busy={busy === 'excel'} disabled={disabled || empty || !!busy}
        onClick={() => run('excel')} title={empty ? 'Nothing to export' : `Download ${rows.length} rows as Excel`}>
        Excel
      </Btn>
      <Btn icon={FileText} busy={busy === 'pdf'} disabled={disabled || empty || !!busy}
        onClick={() => run('pdf')} title={empty ? 'Nothing to export' : `Download ${rows.length} rows as PDF`}>
        PDF
      </Btn>
      {failed && <span role="alert" className="text-[11px] text-red-300">{failed}</span>}
    </>
  )
}
