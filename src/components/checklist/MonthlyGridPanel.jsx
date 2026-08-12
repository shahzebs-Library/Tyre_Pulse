import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  CalendarDays, Download, FileSpreadsheet, RefreshCw, AlertTriangle, Loader2,
} from 'lucide-react'
import { listSubmissions } from '../../lib/api/checklists'
import {
  monthlyGrid, monthlySummary, monthlyExportRows, cellText, isNotOk,
} from '../../lib/checklistMonthly'
import { renderMonthlyGridPdf } from '../../lib/checklistPdf'
import { CHECKLIST_LANGS, normalizeLang } from '../../lib/checklist/checklistI18n'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

// PostgREST caps a response at 1000 rows whatever the limit says, so this is the
// real ceiling of one read - not a number we chose.
const READ_LIMIT = 1000

/**
 * The month as the paper sheet shows it: checks down, days across.
 *
 * One submission is one day, so this is a REPORT assembled from the days that
 * were filled in - not a second capture surface. The empty column is the point:
 * a day with no submission is shown as MISSING, never as blank and never as OK,
 * because that is the only way anyone sees which days the machine went unchecked.
 */
export default function MonthlyGridPanel({ template, country, branding, company }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [asset, setAsset] = useState('')
  const [lang, setLang] = useState('en')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [capped, setCapped] = useState(false)

  const templateId = template?.id || null

  const load = useCallback(async () => {
    if (!templateId) { setRows([]); return }
    setLoading(true); setError('')
    try {
      const list = await listSubmissions({ templateId, country, limit: READ_LIMIT })
      const got = Array.isArray(list) ? list : []
      setRows(got)
      // A capped read is dangerous HERE specifically: this grid's whole claim is
      // that an empty column means nobody checked the machine. If the newest
      // submissions filled the cap, older days would read as missed when they
      // were in fact recorded - the report would invent the very gap it exists
      // to find. So a capped read is stated, not swallowed.
      setCapped(got.length >= READ_LIMIT)
    } catch (err) {
      setError(toUserMessage(err, 'Could not load this month.'))
    } finally {
      setLoading(false)
    }
  }, [templateId, country])

  useEffect(() => { load() }, [load])

  const assets = useMemo(() => {
    const set = new Set()
    for (const r of rows) if (r?.asset_no) set.add(String(r.asset_no))
    return Array.from(set).sort()
  }, [rows])

  useEffect(() => {
    if (!asset && assets.length) setAsset(assets[0])
  }, [assets, asset])

  const forAsset = useMemo(
    () => rows.filter((r) => String(r.asset_no || '') === asset),
    [rows, asset],
  )

  const grid = useMemo(
    () => monthlyGrid(forAsset, template, { year, month, lang: normalizeLang(lang) }),
    [forAsset, template, year, month, lang],
  )
  const summary = useMemo(() => monthlySummary(grid), [grid])

  const downloadPdf = useCallback(async () => {
    setBusy('pdf'); setError('')
    try {
      await renderMonthlyGridPdf({
        grid, template, assetNo: asset, lang, branding, company,
      })
    } catch (err) {
      setError(toUserMessage(err, 'Could not build the month PDF.'))
    } finally { setBusy('') }
  }, [grid, template, asset, lang, branding, company])

  const downloadExcel = useCallback(async () => {
    setBusy('xls'); setError('')
    try {
      const data = monthlyExportRows(grid)
      const keys = ['line', ...grid.days.map((d) => `d${d}`)]
      const headers = ['Check', ...grid.days.map(String)]
      await exportToExcel(
        data, keys, headers,
        reportFileName('Checklist month', asset || '', `${year}-${String(month).padStart(2, '0')}`),
        'Month',
      )
    } catch (err) {
      setError(toUserMessage(err, 'Could not build the spreadsheet.'))
    } finally { setBusy('') }
  }, [grid, asset, year, month])

  const monthName = new Date(Date.UTC(year, month - 1, 1))
    .toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })
  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] text-[var(--text-muted)] mb-1">Asset</label>
          <select className="input py-2" value={asset} onChange={(e) => setAsset(e.target.value)}>
            {assets.length === 0 && <option value="">No asset recorded</option>}
            {assets.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-[var(--text-muted)] mb-1">Month</label>
          <select className="input py-2" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {new Date(Date.UTC(2000, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-[var(--text-muted)] mb-1">Year</label>
          <select className="input py-2" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-[var(--text-muted)] mb-1">Language</label>
          <select className="input py-2" value={lang} onChange={(e) => setLang(e.target.value)}>
            {CHECKLIST_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={load} disabled={loading} className="btn-secondary text-xs inline-flex items-center gap-1.5">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
          </button>
          <button
            onClick={downloadExcel}
            disabled={!!busy || !grid.rows.length}
            className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button
            onClick={downloadPdf}
            disabled={!!busy || !grid.rows.length}
            className="btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {busy === 'pdf' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF
          </button>
        </div>
      </div>

      {capped && (
        <div className="text-xs rounded-lg px-3 py-2" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
          This checklist has more submissions than one read returns, so a day shown as missed may
          in fact have been recorded. Narrow by country, or read the month for a smaller template.
        </div>
      )}

      {error && (
        <div className="text-sm rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          ['Days recorded', String(summary.submitted)],
          ['Days missed', String(summary.missed)],
          ['Not yet due', String(summary.pending)],
          ['Lines not OK', String(summary.notOk)],
          // A month that has not started has no coverage to report. Zero would
          // read as a fleet nobody is checking, when nothing was due yet.
          ['Coverage', summary.coveragePct == null ? 'Not yet measurable' : `${summary.coveragePct}%`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg p-3" style={{ background: 'var(--panel-2)' }}>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
            <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
          </div>
        ))}
      </div>

      {!loading && !grid.rows.length && (
        <p className="text-sm text-[var(--text-muted)] py-6 text-center">
          This checklist has no daily check lines, so there is no month grid to draw.
        </p>
      )}

      {grid.rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
          <table className="text-xs" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th className="table-header text-left sticky left-0 z-10" style={{ background: 'var(--panel-2)', minWidth: 220 }}>
                  {monthName} {year}
                </th>
                {grid.days.map((d) => (
                  <th
                    key={d}
                    className="table-header text-center px-1"
                    title={grid.missingDays.includes(d) ? 'No checklist was recorded on this day' : undefined}
                    style={{ color: grid.missingDays.includes(d) ? '#ef4444' : undefined }}
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className="px-2 py-1.5 sticky left-0" style={{ background: 'var(--panel)', color: 'var(--text-primary)' }}>
                    {row.label}
                  </td>
                  {grid.days.map((d) => {
                    const cell = row.byDay[d]
                    const text = cellText(cell)
                    const fault = cell && isNotOk(cell.english)
                    return (
                      <td
                        key={d}
                        className="text-center px-1 py-1.5"
                        style={{
                          color: fault ? '#f43f5e' : 'var(--text-secondary)',
                          fontWeight: fault ? 600 : 400,
                          background: grid.missingDays.includes(d) ? 'rgba(239,68,68,0.06)' : undefined,
                        }}
                        title={cell?.text || (grid.missingDays.includes(d) ? 'Not recorded' : '')}
                      >
                        {text}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {grid.missingDays.length > 0 && (
        <p className="text-xs" style={{ color: '#f43f5e' }}>
          No checklist was recorded on: {grid.missingDays.join(', ')}.
        </p>
      )}
      {grid.duplicateDays.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Filled in more than once on: {grid.duplicateDays.join(', ')} - the later record is shown.
        </p>
      )}

      {grid.remarks.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            <CalendarDays size={14} className="inline mr-1.5" /> Remarks
          </h3>
          <div className="space-y-1.5">
            {grid.remarks.map((r, i) => (
              <div key={`${r.day}-${r.id}-${i}`} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--text-primary)' }}>Day {r.day} - {r.label}:</span> {r.note}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
