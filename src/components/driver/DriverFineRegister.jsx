import { useCallback, useEffect, useState } from 'react'
import { loadDriverFineRegister, runDriverFineReminders } from '../../lib/api/driverWorkspace'
import { exportDriverFineRegisterExcel, exportDriverFineRegisterPdf } from '../../lib/driverFineReports'
import { toUserMessage } from '../../lib/safeError'

const PAGE_SIZE = 100
const human = value => String(value || 'not recorded').replaceAll('_', ' ')

export default function DriverFineRegister({ canRunReminders, onOpenDriver }) {
  const [filters, setFilters] = useState({ search: '', status: '', review_stage: '', overdue: false })
  const [applied, setApplied] = useState(filters)
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')
  const load = useCallback(async (isActive = () => true) => {
    setLoading(true); setMessage('')
    try {
      const result = await loadDriverFineRegister(applied, offset)
      if (isActive()) setRows(result?.rows || [])
    } catch (error) {
      if (isActive()) { setRows([]); setMessage(toUserMessage(error, 'The fine register could not be loaded.')) }
    } finally { if (isActive()) setLoading(false) }
  }, [applied, offset])
  useEffect(() => { let active = true; load(() => active); return () => { active = false } }, [load])
  const visibleRows = rows.slice(0, PAGE_SIZE)
  async function exportRows(format) {
    setMessage(''); setExporting(true)
    try {
      const allRows = []
      for (let pageOffset = 0; pageOffset < 10000; pageOffset += PAGE_SIZE) {
        const page = await loadDriverFineRegister(applied, pageOffset); const pageRows = page?.rows || []
        allRows.push(...pageRows.slice(0, PAGE_SIZE))
        if (pageRows.length <= PAGE_SIZE) break
        if (pageOffset === 9900) throw new Error('The report exceeds 10,000 rows. Narrow the filters and export again.')
      }
      await (format === 'excel' ? exportDriverFineRegisterExcel(allRows) : exportDriverFineRegisterPdf(allRows))
    } catch (error) { setMessage(toUserMessage(error, 'The report could not be generated.')) }
    finally { setExporting(false) }
  }
  async function reminders() {
    setMessage('')
    try { const result = await runDriverFineReminders(); await load(); setMessage(`Reminder run complete: ${result.sent || 0} sent, ${result.skipped || 0} skipped.`) }
    catch (error) { setMessage(toUserMessage(error, 'The reminder run could not be completed.')) }
  }
  return <section className="space-y-3 rounded-xl border border-[var(--input-border)] p-4" aria-labelledby="fine-register-title">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id="fine-register-title" className="text-lg font-bold">Traffic fine register</h2><p className="text-sm text-[var(--text-muted)]">Driver, supervisor and finance workflow across all accessible cases.</p></div><div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={!visibleRows.length || exporting} onClick={() => exportRows('excel')}>Export Excel</button><button className="btn-secondary" disabled={!visibleRows.length || exporting} onClick={() => exportRows('pdf')}>Export PDF</button>{canRunReminders && <button className="btn-secondary" onClick={reminders}>Run due reminders</button>}</div></div>
    <form className="grid gap-2 md:grid-cols-5" onSubmit={event => { event.preventDefault(); setOffset(0); setApplied(filters) }}>
      <input className="input md:col-span-2" aria-label="Search fine register" placeholder="Driver, ID, notice, vehicle, authority or site" value={filters.search} onChange={event => setFilters(value => ({ ...value, search: event.target.value }))} />
      <select className="input" aria-label="Case status" value={filters.status} onChange={event => setFilters(value => ({ ...value, status: event.target.value }))}><option value="">All case statuses</option><option value="open">Open</option><option value="settled">Settled</option><option value="cancelled">Cancelled</option></select>
      <select className="input" aria-label="Review stage" value={filters.review_stage} onChange={event => setFilters(value => ({ ...value, review_stage: event.target.value }))}><option value="">All review stages</option><option value="driver">Driver action</option><option value="supervisor">Supervisor review</option><option value="finance">Finance approval</option><option value="complete">Complete / payment</option></select>
      <button className="btn-primary" type="submit">Apply filters</button>
      <label className="flex items-center gap-2"><input type="checkbox" checked={filters.overdue} onChange={event => setFilters(value => ({ ...value, overdue: event.target.checked }))} />Overdue only</label>
    </form>
    {loading && <p role="status">Loading fine register...</p>}{message && <p role="status">{message}</p>}
    {!loading && !message && !visibleRows.length && <p>No fines match these filters.</p>}
    {!!visibleRows.length && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-start"><th className="p-2">Notice</th><th className="p-2">Driver</th><th className="p-2">Vehicle</th><th className="p-2">Amount / balance</th><th className="p-2">Status</th><th className="p-2">Due</th><th className="p-2">Action</th></tr></thead><tbody>{visibleRows.map(row => <tr key={row.id} className="border-b border-[var(--input-border)]"><td className="p-2"><strong>{row.notice_reference}</strong><br />{row.authority}</td><td className="p-2">{row.driver_name}<br />{row.employee_id}</td><td className="p-2">{row.asset_no || 'Not assigned'}</td><td className="p-2">{row.currency} {row.amount}<br />Balance {row.balance}</td><td className="p-2">{human(row.status)}<br />{human(row.review_stage)}</td><td className="p-2">{row.due_date || 'Not supplied'}{row.overdue && <strong className="block text-red-500">Overdue</strong>}</td><td className="p-2"><button className="btn-secondary" onClick={() => onOpenDriver(row.driver_id)}>Open case</button></td></tr>)}</tbody></table></div>}
    <div className="flex gap-2">{offset > 0 && <button className="btn-secondary" onClick={() => setOffset(value => Math.max(0, value - PAGE_SIZE))}>Previous</button>}{rows.length > PAGE_SIZE && <button className="btn-secondary" onClick={() => setOffset(value => value + PAGE_SIZE)}>Next</button>}</div>
  </section>
}
