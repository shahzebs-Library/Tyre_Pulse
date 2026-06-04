import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Search, Filter, ChevronLeft, ChevronRight, Trash2, Eye } from 'lucide-react'

const PAGE_SIZE = 25

const RISK_BADGE = {
  Critical: 'bg-red-900/50 text-red-300',
  High: 'bg-orange-900/50 text-orange-300',
  Medium: 'bg-yellow-900/50 text-yellow-300',
  Low: 'bg-green-900/50 text-green-300',
}

export default function TyreRecords() {
  const [records, setRecords] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [riskFilter, setRiskFilter] = useState('')
  const [sites, setSites] = useState([])
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedRecord, setSelectedRecord] = useState(null)

  useEffect(() => {
    loadFilters()
  }, [])

  useEffect(() => {
    loadRecords()
  }, [page, search, siteFilter, brandFilter, riskFilter])

  async function loadFilters() {
    const [siteRes, brandRes] = await Promise.all([
      supabase.from('tyre_records').select('site').not('site', 'is', null),
      supabase.from('tyre_records').select('brand').not('brand', 'is', null),
    ])
    const uniqueSites = [...new Set((siteRes.data ?? []).map(r => r.site))].sort()
    const uniqueBrands = [...new Set((brandRes.data ?? []).map(r => r.brand))].sort()
    setSites(uniqueSites)
    setBrands(uniqueBrands)
  }

  const loadRecords = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('tyre_records')
      .select('*', { count: 'exact' })
      .order('issue_date', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (search) {
      query = query.or(`asset_no.ilike.%${search}%,serial_no.ilike.%${search}%,mis_number.ilike.%${search}%,job_card.ilike.%${search}%`)
    }
    if (siteFilter) query = query.eq('site', siteFilter)
    if (brandFilter) query = query.eq('brand', brandFilter)
    if (riskFilter) query = query.eq('risk_level', riskFilter)

    const { data, count } = await query
    setRecords(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, search, siteFilter, brandFilter, riskFilter])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  function handleSearchChange(e) {
    setSearch(e.target.value)
    setPage(0)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tyre Records</h1>
          <p className="text-gray-400 text-sm mt-1">{total.toLocaleString()} total records</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              className="input pl-9"
              placeholder="Search asset, serial, MIS, job card…"
              value={search}
              onChange={handleSearchChange}
            />
          </div>
          <select className="input w-auto min-w-36" value={siteFilter} onChange={e => { setSiteFilter(e.target.value); setPage(0) }}>
            <option value="">All Sites</option>
            {sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input w-auto min-w-36" value={brandFilter} onChange={e => { setBrandFilter(e.target.value); setPage(0) }}>
            <option value="">All Brands</option>
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select className="input w-auto min-w-36" value={riskFilter} onChange={e => { setRiskFilter(e.target.value); setPage(0) }}>
            <option value="">All Risk Levels</option>
            {['Critical', 'High', 'Medium', 'Low'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Date', 'Asset No', 'Serial No', 'Brand', 'Site', 'MIS No', 'Job Card', 'Risk', 'Cost', ''].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="text-center py-12 text-gray-500">Loading…</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-gray-500">No records found</td></tr>
              ) : records.map(r => (
                <tr key={r.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="table-cell text-gray-400">{r.issue_date ?? '—'}</td>
                  <td className="table-cell font-medium text-white">{r.asset_no ?? '—'}</td>
                  <td className="table-cell">{r.serial_no ?? '—'}</td>
                  <td className="table-cell">{r.brand ?? '—'}</td>
                  <td className="table-cell">{r.site ?? '—'}</td>
                  <td className="table-cell">{r.mis_number ?? '—'}</td>
                  <td className="table-cell">{r.job_card ?? '—'}</td>
                  <td className="table-cell">
                    {r.risk_level ? (
                      <span className={`badge ${RISK_BADGE[r.risk_level] ?? 'bg-gray-800 text-gray-400'}`}>{r.risk_level}</span>
                    ) : '—'}
                  </td>
                  <td className="table-cell">SAR {(r.cost_per_tyre ?? 1200).toLocaleString()}</td>
                  <td className="table-cell">
                    <button
                      onClick={() => setSelectedRecord(r)}
                      className="text-gray-400 hover:text-blue-400 transition-colors"
                    >
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <p className="text-sm text-gray-400">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary py-1.5 px-3 disabled:opacity-40">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-gray-400">Page {page + 1} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn-secondary py-1.5 px-3 disabled:opacity-40">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSelectedRecord(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Record Detail</h2>
              <button onClick={() => setSelectedRecord(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Asset No', selectedRecord.asset_no],
                ['Serial No', selectedRecord.serial_no],
                ['Brand', selectedRecord.brand],
                ['Site', selectedRecord.site],
                ['Issue Date', selectedRecord.issue_date],
                ['MIS Number', selectedRecord.mis_number],
                ['Job Card', selectedRecord.job_card],
                ['Qty', selectedRecord.qty],
                ['Risk Level', selectedRecord.risk_level],
                ['Category', selectedRecord.category],
                ['Cost', selectedRecord.cost_per_tyre ? `SAR ${selectedRecord.cost_per_tyre}` : null],
                ['Description', selectedRecord.description],
                ['Remarks', selectedRecord.remarks],
              ].map(([key, val]) => val ? (
                <div key={key} className={key === 'Description' || key === 'Remarks' ? 'col-span-2' : ''}>
                  <dt className="text-gray-500">{key}</dt>
                  <dd className="text-gray-200 font-medium">{val}</dd>
                </div>
              ) : null)}
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}
