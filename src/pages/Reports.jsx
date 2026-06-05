import { useState, useEffect, useCallback } from 'react'
import { FileText, ChevronRight, Download, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const REPORT_TYPES = [
  { id: 'Vehicle History',       desc: 'All tyre changes per vehicle',          table: 'tyre_records' },
  { id: 'Cost Analysis',         desc: 'Spend grouped by site and brand',        table: 'tyre_records (aggregated)' },
  { id: 'Risk Summary',          desc: 'High and Critical risk records',         table: 'tyre_records filtered' },
  { id: 'Inspection Report',     desc: 'All inspections with findings',          table: 'inspections' },
  { id: 'Tyre Replacement Log',  desc: 'Chronological replacement list',         table: 'tyre_records ordered by date' },
]

const REPORT_COLUMNS = {
  'Vehicle History':      ['issue_date','asset_no','brand','description','serial_no','site','country','cost','risk_level','remarks'],
  'Cost Analysis':        ['site','brand','count','total_cost','avg_cost','country'],
  'Risk Summary':         ['issue_date','asset_no','brand','serial_no','site','risk_level','description'],
  'Inspection Report':    ['inspection_date','asset_no','inspection_type','site','findings','inspector','status'],
  'Tyre Replacement Log': ['issue_date','asset_no','brand','serial_no','qty','cost','site','country'],
}

const COLUMN_LABELS = {
  issue_date: 'Issue Date', asset_no: 'Asset No', brand: 'Brand', description: 'Description',
  serial_no: 'Serial No', site: 'Site', country: 'Country', cost: 'Cost', risk_level: 'Risk Level',
  remarks: 'Remarks', count: 'Count', total_cost: 'Total Cost', avg_cost: 'Avg Cost',
  inspection_date: 'Inspection Date', inspection_type: 'Inspection Type', findings: 'Findings',
  inspector: 'Inspector', status: 'Status', qty: 'Qty',
}

const RISK_LEVELS = ['High', 'Critical']
const COUNTRIES   = ['Saudi Arabia', 'UAE', 'Bahrain', 'Kuwait', 'Oman', 'Qatar']

function applyShortcut(label, setDateFrom, setDateTo, setDateShortcut) {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const today = fmt(now)
  if (label === 'This Month') {
    setDateFrom(`${now.getFullYear()}-${pad(now.getMonth()+1)}-01`)
    setDateTo(today)
  } else if (label === 'Last 3 Months') {
    const d = new Date(now)
    d.setMonth(d.getMonth()-3)
    setDateFrom(fmt(d))
    setDateTo(today)
  } else if (label === 'This Year') {
    setDateFrom(`${now.getFullYear()}-01-01`)
    setDateTo(today)
  }
  setDateShortcut(label)
}

export default function Reports() {
  const { activeCountry } = useSettings()
  const [step, setStep]               = useState('type')
  const [reportType, setReportType]   = useState('')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [dateShortcut, setDateShortcut] = useState('This Month')
  const [filterSite, setFilterSite]   = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [filterAsset, setFilterAsset] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterRiskLevels, setFilterRiskLevels] = useState([...RISK_LEVELS])
  const [filterInspType, setFilterInspType] = useState('')
  const [selectedCols, setSelectedCols] = useState([])
  const [previewRows, setPreviewRows] = useState([])
  const [allRows, setAllRows]         = useState([])
  const [loading, setLoading]         = useState(false)
  const [siteSuggestions, setSiteSuggestions] = useState([])

  useEffect(() => {
    applyShortcut('This Month', setDateFrom, setDateTo, setDateShortcut)
  }, [])

  useEffect(() => {
    async function loadSites() {
      const { data } = await supabase.from('tyre_records').select('site').not('site','is',null).limit(200)
      if (data) {
        const unique = [...new Set(data.map(r => r.site).filter(Boolean))].sort()
        setSiteSuggestions(unique)
      }
    }
    loadSites()
  }, [])

  function selectType(type) {
    setReportType(type)
    setSelectedCols(REPORT_COLUMNS[type] ?? [])
    setStep('config')
  }

  function toggleCol(col) {
    setSelectedCols(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    )
  }

  function toggleRiskLevel(level) {
    setFilterRiskLevels(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    )
  }

  const runQuery = useCallback(async () => {
    setLoading(true)
    try {
      let rows = []

      if (reportType === 'Inspection Report') {
        let q = supabase.from('inspections').select('*')
        if (dateFrom)         q = q.gte('inspection_date', dateFrom)
        if (dateTo)           q = q.lte('inspection_date', dateTo)
        if (filterSite)       q = q.ilike('site', `%${filterSite}%`)
        if (filterCountry)    q = q.eq('country', filterCountry)
        if (filterInspType)   q = q.eq('inspection_type', filterInspType)
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        const { data } = await q.order('inspection_date', { ascending: false }).limit(1000)
        rows = data ?? []
      } else {
        let q = supabase.from('tyre_records').select(
          'issue_date,asset_no,brand,description,serial_no,site,country,cost_per_tyre,qty,risk_level,remarks'
        )
        if (dateFrom)      q = q.gte('issue_date', dateFrom)
        if (dateTo)        q = q.lte('issue_date', dateTo)
        if (filterSite)    q = q.ilike('site', `%${filterSite}%`)
        if (filterCountry) q = q.eq('country', filterCountry)
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)

        if (reportType === 'Vehicle History' && filterAsset)
          q = q.ilike('asset_no', `%${filterAsset}%`)

        if ((reportType === 'Cost Analysis' || reportType === 'Tyre Replacement Log') && filterBrand)
          q = q.ilike('brand', `%${filterBrand}%`)

        if (reportType === 'Risk Summary')
          q = q.in('risk_level', filterRiskLevels.length ? filterRiskLevels : RISK_LEVELS)

        if (reportType === 'Tyre Replacement Log')
          q = q.order('issue_date', { ascending: false })
        else
          q = q.order('issue_date', { ascending: false })

        const { data } = await q.limit(1000)
        const raw = data ?? []

        if (reportType === 'Cost Analysis') {
          const grouped = {}
          raw.forEach(r => {
            const key = `${r.site ?? ''}|${r.brand ?? ''}`
            if (!grouped[key]) grouped[key] = { site: r.site ?? '', brand: r.brand ?? '', country: r.country ?? '', count: 0, total_cost: 0 }
            grouped[key].count += 1
            grouped[key].total_cost += (r.cost_per_tyre ?? 0) * (r.qty ?? 1)
          })
          rows = Object.values(grouped).map(g => ({
            ...g,
            avg_cost: g.count > 0 ? Math.round(g.total_cost / g.count) : 0,
            total_cost: Math.round(g.total_cost),
          })).sort((a, b) => b.total_cost - a.total_cost)
        } else {
          rows = raw.map(r => ({
            ...r,
            cost: (r.cost_per_tyre ?? 0) * (r.qty ?? 1),
          }))
        }
      }

      setAllRows(rows)
      setPreviewRows(rows.slice(0, 50))
    } finally {
      setLoading(false)
    }
  }, [reportType, dateFrom, dateTo, filterSite, filterCountry, filterAsset, filterBrand,
      filterRiskLevels, filterInspType, activeCountry])

  function handleExcel() {
    const activeCols = (REPORT_COLUMNS[reportType] ?? []).filter(c => selectedCols.includes(c))
    const headers = activeCols.map(c => COLUMN_LABELS[c] ?? c)
    exportToExcel(
      allRows, activeCols, headers,
      `TyrePulse_${reportType.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}`
    )
  }

  function handlePdf() {
    const activeCols = (REPORT_COLUMNS[reportType] ?? []).filter(c => selectedCols.includes(c))
    const columns = activeCols.map(c => ({ key: c, header: COLUMN_LABELS[c] ?? c }))
    exportToPdf(
      allRows,
      columns,
      `TyrePulse · ${reportType}`,
      `TyrePulse_${reportType.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}`,
      'landscape'
    )
  }

  const displayCols = (REPORT_COLUMNS[reportType] ?? []).filter(c => selectedCols.includes(c))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileText size={22} className="text-green-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Custom Reports</h1>
          <p className="text-gray-400 text-sm mt-0.5">Build, filter and export tailored reports</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {['type', 'config', 'preview'].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ChevronRight size={14} className="text-gray-600" />}
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
              step === s
                ? 'bg-green-900/40 text-green-400 border border-green-700/40'
                : ['type','config','preview'].indexOf(step) > i
                  ? 'text-gray-400'
                  : 'text-gray-600'
            }`}>
              {i + 1}. {s === 'type' ? 'Select Type' : s === 'config' ? 'Configure' : 'Preview & Export'}
            </span>
          </div>
        ))}
      </div>

      {/* Step 1: Report type selector */}
      {step === 'type' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {REPORT_TYPES.map(rt => (
            <button
              key={rt.id}
              onClick={() => selectType(rt.id)}
              className="card text-left hover:border-green-600/40 transition-all group"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.2)' }}>
                  <FileText size={16} className="text-green-400" />
                </div>
                <div>
                  <p className="text-white font-semibold group-hover:text-green-400 transition-colors">{rt.id}</p>
                  <p className="text-gray-400 text-sm mt-0.5">{rt.desc}</p>
                  <p className="text-gray-600 text-xs mt-1">Source: {rt.table}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: Filters + Column picker */}
      {step === 'config' && (
        <div className="space-y-5">
          <div className="card space-y-4">
            <h2 className="text-base font-semibold text-white">Filters · {reportType}</h2>

            {/* Date shortcut chips */}
            <div>
              <label className="label">Date Range</label>
              <div className="flex gap-2 flex-wrap mb-2">
                {['This Month', 'Last 3 Months', 'This Year', 'Custom'].map(lbl => (
                  <button
                    key={lbl}
                    onClick={() => lbl !== 'Custom' && applyShortcut(lbl, setDateFrom, setDateTo, setDateShortcut) || setDateShortcut('Custom')}
                    className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                      dateShortcut === lbl
                        ? 'border-green-600 text-green-400'
                        : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                    }`}
                    style={dateShortcut === lbl ? { backgroundColor: 'rgba(22,163,74,0.08)' } : {}}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="date" className="input w-36 text-sm" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setDateShortcut('Custom') }} />
                <span className="text-gray-600">to</span>
                <input type="date" className="input w-36 text-sm" value={dateTo} onChange={e => { setDateTo(e.target.value); setDateShortcut('Custom') }} />
              </div>
            </div>

            {/* Common filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Site</label>
                <input
                  list="site-list"
                  className="input w-full"
                  placeholder="Filter by site…"
                  value={filterSite}
                  onChange={e => setFilterSite(e.target.value)}
                />
                <datalist id="site-list">
                  {siteSuggestions.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div>
                <label className="label">Country</label>
                <select className="input w-full" value={filterCountry} onChange={e => setFilterCountry(e.target.value)}>
                  <option value="">All Countries</option>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Type-specific filters */}
            {reportType === 'Vehicle History' && (
              <div>
                <label className="label">Asset Number</label>
                <input className="input w-full" placeholder="Asset no…" value={filterAsset} onChange={e => setFilterAsset(e.target.value)} />
              </div>
            )}

            {(reportType === 'Cost Analysis' || reportType === 'Tyre Replacement Log') && (
              <div>
                <label className="label">Brand</label>
                <input className="input w-full" placeholder="Filter by brand…" value={filterBrand} onChange={e => setFilterBrand(e.target.value)} />
              </div>
            )}

            {reportType === 'Risk Summary' && (
              <div>
                <label className="label">Risk Level</label>
                <div className="flex gap-3 flex-wrap">
                  {RISK_LEVELS.map(level => (
                    <label key={level} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filterRiskLevels.includes(level)}
                        onChange={() => toggleRiskLevel(level)}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-300">{level}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {reportType === 'Inspection Report' && (
              <div>
                <label className="label">Inspection Type</label>
                <select className="input w-full" value={filterInspType} onChange={e => setFilterInspType(e.target.value)}>
                  <option value="">All Types</option>
                  <option value="Routine">Routine</option>
                  <option value="Safety">Safety</option>
                  <option value="Pre-trip">Pre-trip</option>
                  <option value="Post-trip">Post-trip</option>
                </select>
              </div>
            )}
          </div>

          {/* Column picker */}
          <div className="card space-y-3">
            <h2 className="text-base font-semibold text-white">Columns</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(REPORT_COLUMNS[reportType] ?? []).map(col => (
                <label key={col} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCols.includes(col)}
                    onChange={() => toggleCol(col)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-300">{COLUMN_LABELS[col] ?? col}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep('type')} className="btn-secondary flex items-center gap-2">
              <ArrowLeft size={14} /> Back
            </button>
            <button
              onClick={() => { runQuery(); setStep('preview') }}
              className="btn-primary flex items-center gap-2"
            >
              Run Report <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview + Export */}
      {step === 'preview' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => setStep('config')} className="btn-secondary flex items-center gap-2">
              <ArrowLeft size={14} /> Back to Filters
            </button>
            <button onClick={handleExcel} className="btn-secondary flex items-center gap-1.5">
              <Download size={14} className="text-green-400" /> Export Excel
            </button>
            <button onClick={handlePdf} className="btn-secondary flex items-center gap-1.5">
              <Download size={14} className="text-red-400" /> Export PDF
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-40 text-gray-400">Running report…</div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400">
                  Total records: <span className="text-white font-semibold">{allRows.length.toLocaleString()}</span>
                </span>
                {allRows.length > 50 && (
                  <span className="text-xs text-gray-500">Showing first 50 rows in preview</span>
                )}
              </div>

              {previewRows.length === 0 ? (
                <div className="card text-center py-12 text-gray-500">
                  No records found for the selected filters.
                </div>
              ) : (
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        {displayCols.map(col => (
                          <th key={col} className="table-header text-left whitespace-nowrap">
                            {COLUMN_LABELS[col] ?? col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                          {displayCols.map(col => (
                            <td key={col} className="table-cell whitespace-nowrap max-w-48 truncate">
                              {col === 'risk_level' && row[col] ? (
                                <span className={`badge text-xs ${
                                  row[col] === 'Critical' ? 'bg-red-900/50 text-red-300' :
                                  row[col] === 'High' ? 'bg-orange-900/50 text-orange-300' :
                                  row[col] === 'Medium' ? 'bg-yellow-900/50 text-yellow-300' :
                                  'bg-green-900/50 text-green-300'
                                }`}>{row[col]}</span>
                              ) : (
                                row[col] ?? '—'
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
