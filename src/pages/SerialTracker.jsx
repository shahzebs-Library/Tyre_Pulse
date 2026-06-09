import { useState, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { exportToPdf, exportToExcel } from '../lib/exportUtils'
import { ScanLine, Search, Download, FileText, Upload } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'

export default function SerialTracker() {
  const [activeTab, setActiveTab] = useState('single') // 'single' | 'bulk'

  // ── Single Search state ───────────────────────────────────────────────────────
  const [serialInput, setSerialInput] = useState('')
  const [records, setRecords]         = useState([])
  const [loading, setLoading]         = useState(false)
  const [searched, setSearched]       = useState(false)
  const [lastQuery, setLastQuery]     = useState('')

  // ── Bulk Lookup state ─────────────────────────────────────────────────────────
  const [bulkResults, setBulkResults]     = useState([])   // [{ serial, first_seen, last_asset, total_records, status }]
  const [bulkLoading, setBulkLoading]     = useState(false)
  const [bulkFileName, setBulkFileName]   = useState('')
  const [bulkDragOver, setBulkDragOver]   = useState(false)
  const [bulkDone, setBulkDone]           = useState(false)
  const bulkFileRef = useRef(null)

  // ── Single search functions ───────────────────────────────────────────────────
  async function search() {
    if (!serialInput.trim()) return
    setLoading(true)
    setSearched(false)
    const q = serialInput.trim()
    const { data } = await supabase
      .from('tyre_records')
      .select('*')
      .eq('serial_no', q)
      .order('issue_date', { ascending: true })
    setRecords(data || [])
    setLastQuery(q)
    setSearched(true)
    setLoading(false)
  }

  const stats = useMemo(() => {
    if (records.length === 0) return null
    const first = records[0]
    const last  = records[records.length - 1]
    const assets = new Set(records.map(r => r.asset_no).filter(Boolean))
    const totalCost = records.reduce((s, r) => s + (parseFloat(r.cost) || 0), 0)
    let days = 0
    if (first.issue_date && last.issue_date) {
      const d1 = new Date(first.issue_date), d2 = new Date(last.issue_date)
      days = Math.round((d2 - d1) / (1000 * 60 * 60 * 24))
    }
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 12)
    const active = last.issue_date && new Date(last.issue_date) >= cutoff
    return { first, last, assets: assets.size, totalCost, days, active, brand: first.brand, description: first.description }
  }, [records])

  const timeline = useMemo(() => {
    if (records.length === 0) return []
    const groups = []
    let currentGroup = null
    records.forEach(r => {
      if (!currentGroup || currentGroup.asset !== r.asset_no) {
        currentGroup = { asset: r.asset_no, records: [] }
        groups.push(currentGroup)
      }
      currentGroup.records.push(r)
    })
    return groups
  }, [records])

  function exportLifecyclePdf() {
    exportToPdf(
      records,
      [
        { key: 'issue_date',  header: 'Date' },
        { key: 'asset_no',    header: 'Asset No' },
        { key: 'site',        header: 'Site' },
        { key: 'position',    header: 'Position' },
        { key: 'brand',       header: 'Brand' },
        { key: 'description', header: 'Description' },
        { key: 'risk_level',  header: 'Risk' },
        { key: 'cost',        header: 'Cost' },
      ],
      `Serial Lifecycle: ${lastQuery}`,
      `TyrePulse_Serial_${lastQuery}`,
      'landscape'
    )
  }

  function exportLifecycleExcel() {
    exportToExcel(
      records,
      ['issue_date','asset_no','site','position','brand','description','risk_level','cost','remarks'],
      ['Date','Asset No','Site','Position','Brand','Description','Risk','Cost','Remarks'],
      `TyrePulse_Serial_${lastQuery}`
    )
  }

  const riskColor = r => {
    if (!r) return 'text-gray-500'
    const l = r.toLowerCase()
    if (l === 'critical') return 'text-red-400'
    if (l === 'high')     return 'text-orange-400'
    if (l === 'medium')   return 'text-yellow-400'
    return 'text-green-400'
  }

  // ── Bulk Lookup functions ─────────────────────────────────────────────────────
  const SERIAL_HEADERS = ['serial_no', 'Serial No', 'Serial Number', 'serial']

  function extractSerialsFromSheet(wb) {
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    if (rows.length === 0) return []
    const firstRow = rows[0]
    const matchedKey = SERIAL_HEADERS.find(h => h in firstRow)
    if (!matchedKey) return []
    const serials = rows.map(r => String(r[matchedKey] || '').trim()).filter(Boolean)
    return [...new Set(serials)]
  }

  async function processBulkFile(file) {
    setBulkFileName(file.name)
    setBulkLoading(true)
    setBulkDone(false)
    setBulkResults([])

    const arrayBuffer = await file.arrayBuffer()
    const wb = XLSX.read(arrayBuffer, { type: 'array' })
    const serials = extractSerialsFromSheet(wb)

    if (serials.length === 0) {
      setBulkLoading(false)
      setBulkDone(true)
      return
    }

    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 12)
    const cutoffStr = cutoff.toISOString().split('T')[0]

    const results = []
    const BATCH_SIZE = 10

    for (let i = 0; i < serials.length; i += BATCH_SIZE) {
      const batch = serials.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.all(
        batch.map(async serial => {
          const { data } = await supabase
            .from('tyre_records')
            .select('serial_no, issue_date, asset_no')
            .eq('serial_no', serial)
            .order('issue_date', { ascending: true })
          if (!data || data.length === 0) {
            return { serial, first_seen: null, last_asset: null, total_records: 0, status: 'Not Found' }
          }
          const first = data[0]
          const last  = data[data.length - 1]
          const isActive = last.issue_date && last.issue_date >= cutoffStr
          return {
            serial,
            first_seen: first.issue_date || null,
            last_asset: last.asset_no || null,
            total_records: data.length,
            status: isActive ? 'Active' : 'Retired',
          }
        })
      )
      results.push(...batchResults)
    }

    setBulkResults(results)
    setBulkLoading(false)
    setBulkDone(true)
  }

  function handleBulkFileInput(e) {
    const file = e.target.files?.[0]
    if (file) processBulkFile(file)
  }

  function handleBulkDrop(e) {
    e.preventDefault()
    setBulkDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processBulkFile(file)
  }

  function exportBulkExcel() {
    exportToExcel(
      bulkResults,
      ['serial', 'first_seen', 'last_asset', 'total_records', 'status'],
      ['Serial No', 'First Seen', 'Last Asset', 'Records', 'Status'],
      'TyrePulse_BulkLookup'
    )
  }

  const bulkSummary = useMemo(() => {
    if (bulkResults.length === 0) return null
    const found   = bulkResults.filter(r => r.status !== 'Not Found')
    const active  = bulkResults.filter(r => r.status === 'Active').length
    const retired = bulkResults.filter(r => r.status === 'Retired').length
    return { total: found.length, active, retired }
  }, [bulkResults])

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Serial Tracker"
        subtitle="Track a tyre's complete service history by serial number"
        icon={ScanLine}
      />

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-800/50 rounded-lg w-fit">
        {[['single', 'Single Search'], ['bulk', 'Bulk Lookup']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === key ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Single Search tab ──────────────────────────────────────────────────── */}
      {activeTab === 'single' && (
        <>
          <div className="card">
            <div className="flex gap-3">
              <input
                className="input flex-1 text-base"
                placeholder="Enter serial number (case-sensitive)..."
                value={serialInput}
                onChange={e => setSerialInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
              />
              <button onClick={search} disabled={loading || !serialInput.trim()}
                className="btn-primary flex items-center gap-2 px-5 disabled:opacity-50">
                <Search size={16} />
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          {searched && records.length === 0 && (
            <div className="card text-center py-12">
              <ScanLine size={32} className="text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">No records found for serial number <span className="text-white font-mono">"{lastQuery}"</span></p>
              <p className="text-gray-600 text-sm mt-1">Check spelling and capitalisation</p>
            </div>
          )}

          {stats && (
            <>
              <div className="card">
                <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-2xl font-bold font-mono text-white">{lastQuery}</span>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                        stats.active
                          ? 'bg-green-900/30 text-green-400 border-green-700/50'
                          : 'bg-gray-800 text-gray-400 border-gray-700'
                      }`}>
                        {stats.active ? 'Active' : 'Retired'}
                      </span>
                    </div>
                    {(stats.brand || stats.description) && (
                      <p className="text-gray-400 text-sm">{[stats.brand, stats.description].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={exportLifecycleExcel} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
                      <Download size={14} /> Excel
                    </button>
                    <button onClick={exportLifecyclePdf} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
                      <FileText size={14} /> PDF
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'First Used',     value: stats.first.issue_date || '—' },
                    { label: 'Total Records',  value: records.length },
                    { label: 'Vehicles Used',  value: stats.assets },
                    { label: 'Days in Service',value: stats.days || '—' },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-800/50 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-white">{s.value}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
                {stats.totalCost > 0 && (
                  <p className="text-gray-400 text-sm mt-3">
                    Total cost: <span className="text-white font-semibold">
                      {stats.totalCost.toLocaleString('en-US', { minimumFractionDigits: 0 })} SAR
                    </span>
                  </p>
                )}
              </div>

              <div className="card">
                <h3 className="text-base font-semibold text-white mb-4">Service Timeline</h3>
                <div className="space-y-4">
                  {timeline.map((group, gi) => (
                    <div key={gi}>
                      {gi > 0 && (
                        <div className="flex items-center gap-2 py-1 px-3 rounded-md text-xs text-blue-400 bg-blue-900/20 border border-blue-800/40 mb-3 w-fit">
                          Transferred to {group.asset || 'unknown'}
                        </div>
                      )}
                      <div className="mb-1">
                        <span className="text-sm font-semibold text-white font-mono">{group.asset || 'Unknown Asset'}</span>
                        <span className="text-xs text-gray-500 ml-2">{group.records.length} record{group.records.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="space-y-2 pl-3 border-l border-gray-700">
                        {group.records.map(r => (
                          <div key={r.id} className="flex items-start gap-3 py-2">
                            <div className="text-xs font-mono text-gray-500 w-24 flex-shrink-0 pt-0.5">{r.issue_date || '—'}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                                <span className="text-gray-400">{r.site || '—'}</span>
                                {r.position && <span className="text-gray-500">Pos: <span className="text-white font-mono">{r.position}</span></span>}
                                {r.risk_level && <span className={riskColor(r.risk_level)}>{r.risk_level}</span>}
                                {r.cost > 0 && <span className="text-gray-500">SAR {Number(r.cost).toLocaleString()}</span>}
                              </div>
                              {r.description && <p className="text-xs text-gray-600 mt-0.5 truncate">{r.description}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Bulk Lookup tab ────────────────────────────────────────────────────── */}
      {activeTab === 'bulk' && (
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            className={`card border-2 border-dashed transition-all cursor-pointer ${
              bulkDragOver ? 'border-green-500 bg-green-900/10' : 'border-gray-700 hover:border-gray-500'
            }`}
            onDragOver={e => { e.preventDefault(); setBulkDragOver(true) }}
            onDragLeave={() => setBulkDragOver(false)}
            onDrop={handleBulkDrop}
            onClick={() => bulkFileRef.current?.click()}
          >
            <input
              ref={bulkFileRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={handleBulkFileInput}
            />
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center pointer-events-none">
              <Upload size={32} className={bulkDragOver ? 'text-green-400' : 'text-gray-500'} />
              <p className="text-white font-medium">
                {bulkFileName ? bulkFileName : 'Drop an Excel or CSV file here'}
              </p>
              <p className="text-gray-500 text-sm">
                File must have a column: <span className="font-mono text-gray-400">serial_no</span>, <span className="font-mono text-gray-400">Serial No</span>, <span className="font-mono text-gray-400">Serial Number</span>, or <span className="font-mono text-gray-400">serial</span>
              </p>
              <button
                className="btn-secondary text-sm px-4 py-1.5 pointer-events-auto"
                onClick={e => { e.stopPropagation(); bulkFileRef.current?.click() }}
              >
                Browse File
              </button>
            </div>
          </div>

          {/* Loading state */}
          {bulkLoading && (
            <div className="card text-center py-10">
              <div className="inline-block w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-gray-400">Processing serial numbers...</p>
            </div>
          )}

          {/* Results */}
          {bulkDone && !bulkLoading && (
            <>
              {/* Summary banner */}
              {bulkSummary && (
                <div className="rounded-xl px-5 py-4 flex flex-wrap items-center gap-4 justify-between"
                  style={{ background: 'rgba(22,163,74,0.10)', border: '1px solid rgba(22,163,74,0.3)' }}>
                  <p className="text-green-300 font-semibold">
                    {bulkSummary.total} serial{bulkSummary.total !== 1 ? 's' : ''} found &nbsp;·&nbsp;
                    <span className="text-green-400">{bulkSummary.active} active</span> &nbsp;·&nbsp;
                    <span className="text-gray-400">{bulkSummary.retired} retired</span>
                  </p>
                  <button onClick={exportBulkExcel} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
                    <Download size={14} /> Export Excel
                  </button>
                </div>
              )}

              {bulkResults.length === 0 ? (
                <div className="card text-center py-10">
                  <p className="text-gray-400">No serial numbers could be extracted from the file.</p>
                  <p className="text-gray-600 text-sm mt-1">Check that the file has a recognised column header.</p>
                </div>
              ) : (
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-800">
                        <th className="pb-2 pr-4">Serial No</th>
                        <th className="pb-2 pr-4">First Seen</th>
                        <th className="pb-2 pr-4">Last Asset</th>
                        <th className="pb-2 pr-4 text-right">Records</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkResults.map(r => (
                        <tr key={r.serial} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                          <td className="py-2 pr-4 font-mono text-white">{r.serial}</td>
                          <td className="py-2 pr-4 text-gray-400 text-xs">{r.first_seen || '—'}</td>
                          <td className="py-2 pr-4 font-mono text-gray-300 text-xs">{r.last_asset || '—'}</td>
                          <td className="py-2 pr-4 text-gray-300 text-right">{r.total_records}</td>
                          <td className="py-2">
                            {r.status === 'Not Found' ? (
                              <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-800 text-gray-500 border-gray-700">Not Found</span>
                            ) : r.status === 'Active' ? (
                              <span className="text-xs px-2 py-0.5 rounded-full border bg-green-900/30 text-green-400 border-green-700/50">Active</span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-800 text-gray-400 border-gray-700">Retired</span>
                            )}
                          </td>
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
