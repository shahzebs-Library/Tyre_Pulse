import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { exportToPdf, exportToExcel } from '../lib/exportUtils'
import { ScanLine, Search, Download, FileText } from 'lucide-react'

export default function SerialTracker() {
  const [serialInput, setSerialInput] = useState('')
  const [records, setRecords]         = useState([])
  const [loading, setLoading]         = useState(false)
  const [searched, setSearched]       = useState(false)
  const [lastQuery, setLastQuery]     = useState('')

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

  // Group records by asset_no for timeline display
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ScanLine size={22} className="text-green-400" /> Serial Tracker
        </h1>
        <p className="text-gray-400 text-sm mt-1">Track a tyre's complete service history by serial number</p>
      </div>

      {/* Search */}
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

      {/* Results */}
      {searched && records.length === 0 && (
        <div className="card text-center py-12">
          <ScanLine size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No records found for serial number <span className="text-white font-mono">"{lastQuery}"</span></p>
          <p className="text-gray-600 text-sm mt-1">Check spelling and capitalisation</p>
        </div>
      )}

      {stats && (
        <>
          {/* Lifecycle header */}
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

            {/* Stats row */}
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

          {/* Timeline */}
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
    </div>
  )
}
