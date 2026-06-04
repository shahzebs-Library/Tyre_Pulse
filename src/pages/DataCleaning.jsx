import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { batchClassify, RISK_COLOUR, CONFIDENCE_COLOUR, ALL_CATEGORY_LABELS } from '../lib/tyreClassifier'
import { Wand2, CheckCheck, ChevronLeft, ChevronRight, RefreshCw, Info, Filter, Check, X } from 'lucide-react'

const PAGE_SIZE = 50

export default function DataCleaning() {
  const { profile } = useAuth()

  // ── state ───────────────────────────────────────────────────────────────────
  const [tab, setTab]                   = useState('pending')   // 'pending' | 'cleaned'
  const [rawRecords, setRawRecords]     = useState([])
  const [classified, setClassified]     = useState([])          // pending classifications
  const [overrides, setOverrides]       = useState({})          // id → { category, risk_level }
  const [selected, setSelected]         = useState(new Set())
  const [page, setPage]                 = useState(0)
  const [totalPending, setTotalPending] = useState(0)
  const [cleanedRecords, setCleanedRecords] = useState([])
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [saveCount, setSaveCount]       = useState(0)
  const [filterConf, setFilterConf]     = useState('')  // '', 'High', 'Medium', 'Low'
  const [filterSite, setFilterSite]     = useState('')
  const [sites, setSites]               = useState([])
  const [stats, setStats]               = useState({ pending: 0, cleaned: 0 })

  // ── load ────────────────────────────────────────────────────────────────────
  useEffect(() => { loadStats(); loadSites() }, [saveCount])
  useEffect(() => { tab === 'pending' ? loadPending() : loadCleaned() }, [tab, page, filterConf, filterSite, saveCount])

  async function loadStats() {
    const [pendingRes, cleanedRes] = await Promise.all([
      supabase.from('tyre_records').select('id', { count: 'exact', head: true }).eq('cleaned', false),
      supabase.from('tyre_records').select('id', { count: 'exact', head: true }).eq('cleaned', true),
    ])
    setStats({ pending: pendingRes.count ?? 0, cleaned: cleanedRes.count ?? 0 })
  }

  async function loadSites() {
    const { data } = await supabase.from('tyre_records').select('site').not('site', 'is', null).eq('cleaned', false)
    setSites([...new Set((data ?? []).map(r => r.site))].sort())
  }

  const loadPending = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('tyre_records')
      .select('id, description, remarks, site, asset_no, brand, issue_date')
      .eq('cleaned', false)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (filterSite) q = q.eq('site', filterSite)

    const { data, count, error } = await q.returns()
    const records = data ?? []
    setRawRecords(records)
    setTotalPending(count ?? 0)

    // Run classifier on the loaded records
    const results = batchClassify(records)

    // Filter by confidence if requested
    const visible = filterConf
      ? results.filter(r => r.confidence === filterConf)
      : results

    setClassified(visible)
    setSelected(new Set())
    setLoading(false)
  }, [page, filterConf, filterSite])

  async function loadCleaned() {
    setLoading(true)
    const { data } = await supabase
      .from('tyre_records')
      .select('id, asset_no, brand, site, category, risk_level, remarks_cleaned, issue_date')
      .eq('cleaned', true)
      .order('created_at', { ascending: false })
      .limit(100)
    setCleanedRecords(data ?? [])
    setLoading(false)
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  function getResult(id) {
    const base = classified.find(r => r.id === id)
    return overrides[id]
      ? { ...base, ...overrides[id] }
      : base
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(classified.map(r => r.id)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  function setOverride(id, field, value) {
    setOverrides(prev => ({
      ...prev,
      [id]: { ...(prev[id] ?? {}), [field]: value },
    }))
  }

  // ── save (approve) ───────────────────────────────────────────────────────────
  async function approveSelected() {
    if (selected.size === 0) return
    setSaving(true)

    const toSave = [...selected].map(id => {
      const r = getResult(id)
      return {
        id,
        category: r?.category ?? null,
        risk_level: r?.risk_level ?? null,
        remarks_cleaned: r?.remarks_cleaned ?? null,
        cleaned: true,
      }
    })

    // Upsert in batches of 100
    const BATCH = 100
    const logEntries = []

    for (let i = 0; i < toSave.length; i += BATCH) {
      const batch = toSave.slice(i, i + BATCH)
      await supabase.from('tyre_records').upsert(batch, { onConflict: 'id' })

      // Build cleaning_log entries
      batch.forEach(saved => {
        const original = rawRecords.find(r => r.id === saved.id)
        if (original) {
          logEntries.push({
            original_text: [original.description, original.remarks].filter(Boolean).join(' | '),
            cleaned_text: saved.remarks_cleaned,
            category: saved.category,
            confidence: getResult(saved.id)?.confidence,
            tyre_record_id: saved.id,
            cleaned_by_model: 'rule-based-v1',
          })
        }
      })
    }

    // Write cleaning log
    if (logEntries.length > 0) {
      await supabase.from('cleaning_log').insert(logEntries)
    }

    setSaveCount(c => c + 1)
    setOverrides({})
    setSaving(false)
  }

  // ── approve all on current page ──────────────────────────────────────────────
  async function approveAll() {
    selectAll()
    // Wait a tick then save
    setTimeout(() => approveSelected(), 0)
  }

  const totalPages = Math.ceil(totalPending / PAGE_SIZE)

  // ── confidence badge ─────────────────────────────────────────────────────────
  function ConfBadge({ conf }) {
    return <span className={`text-xs font-medium ${CONFIDENCE_COLOUR[conf] ?? 'text-gray-500'}`}>{conf ?? '—'} confidence</span>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Wand2 size={22} className="text-blue-400" /> Data Cleaning Engine
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Rule-based auto-classification — zero AI tokens required
          </p>
        </div>
        <div className="flex gap-3">
          <div className="card py-2 px-4 text-center">
            <p className="text-xl font-bold text-yellow-400">{stats.pending.toLocaleString()}</p>
            <p className="text-xs text-gray-400">Pending</p>
          </div>
          <div className="card py-2 px-4 text-center">
            <p className="text-xl font-bold text-green-400">{stats.cleaned.toLocaleString()}</p>
            <p className="text-xs text-gray-400">Cleaned</p>
          </div>
        </div>
      </div>

      {/* Info banner */}
      <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg px-4 py-3 flex gap-3">
        <Info size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-300">
          The classifier matches tyre description and remarks against 13 failure categories using keyword patterns.
          Review proposed changes, adjust if needed, then approve to persist to the database.
          Confidence reflects how many keywords matched.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 pb-0">
        {[['pending', 'Pending Classification'], ['cleaned', 'Already Cleaned']].map(([val, label]) => (
          <button
            key={val}
            onClick={() => { setTab(val); setPage(0) }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === val ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'pending' && (
        <>
          {/* Filters + Actions */}
          <div className="flex flex-wrap gap-3 items-center">
            <select className="input w-auto" value={filterSite} onChange={e => { setFilterSite(e.target.value); setPage(0) }}>
              <option value="">All Sites</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="input w-auto" value={filterConf} onChange={e => { setFilterConf(e.target.value); setPage(0) }}>
              <option value="">All Confidence</option>
              {['High', 'Medium', 'Low'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <div className="flex-1" />

            <span className="text-sm text-gray-400">{selected.size} selected</span>
            <button onClick={selectAll} className="btn-secondary py-1.5 px-3 text-sm">Select All</button>
            <button onClick={clearAll} className="btn-secondary py-1.5 px-3 text-sm">Clear</button>
            <button
              onClick={approveSelected}
              disabled={selected.size === 0 || saving}
              className="btn-primary flex items-center gap-2 disabled:opacity-40"
            >
              <Check size={15} /> {saving ? 'Saving…' : `Approve ${selected.size > 0 ? selected.size : ''}`}
            </button>
          </div>

          {/* Records */}
          {loading ? (
            <div className="text-center py-16 text-gray-500">Classifying records…</div>
          ) : classified.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              {totalPending === 0 ? '✅ All records have been classified!' : 'No records match the current filter.'}
            </div>
          ) : (
            <div className="space-y-2">
              {classified.map(r => {
                const result = getResult(r.id)
                const isSelected = selected.has(r.id)
                return (
                  <div
                    key={r.id}
                    className={`card transition-all cursor-pointer ${isSelected ? 'border-blue-500/60 bg-blue-950/20' : 'hover:border-gray-700'}`}
                    onClick={() => toggleSelect(r.id)}
                  >
                    <div className="flex items-start gap-4">
                      {/* Checkbox */}
                      <div className={`w-5 h-5 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-600 border-blue-500' : 'border-gray-600'}`}>
                        {isSelected && <Check size={12} className="text-white" />}
                      </div>

                      {/* Record info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap gap-2 items-baseline">
                          <span className="font-medium text-white">{r.original_description || '—'}</span>
                          {r.original_remarks && r.original_remarks !== r.original_description && (
                            <span className="text-gray-500 text-xs">"{r.original_remarks.slice(0, 80)}{r.original_remarks.length > 80 ? '…' : ''}"</span>
                          )}
                        </div>
                        <div className="flex gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                          {r.site && <span>📍 {r.site}</span>}
                          {r.asset_no && <span>🚛 {r.asset_no}</span>}
                          {r.brand && <span>🏷 {r.brand}</span>}
                          {r.issue_date && <span>🗓 {r.issue_date}</span>}
                        </div>
                        {result?.matched_keywords?.length > 0 && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {result.matched_keywords.map((kw, i) => (
                              <span key={i} className="bg-gray-800 text-gray-400 text-xs px-1.5 py-0.5 rounded">{kw}</span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Classification result — editable */}
                      <div className="flex-shrink-0 flex flex-col gap-2 items-end" onClick={e => e.stopPropagation()}>
                        <ConfBadge conf={result?.confidence} />

                        <select
                          className="bg-gray-800 border border-gray-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={result?.category ?? ''}
                          onChange={e => setOverride(r.id, 'category', e.target.value)}
                        >
                          {ALL_CATEGORY_LABELS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>

                        <select
                          className="bg-gray-800 border border-gray-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={result?.risk_level ?? ''}
                          onChange={e => setOverride(r.id, 'risk_level', e.target.value)}
                        >
                          {['Critical', 'High', 'Medium', 'Low'].map(l => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>

                        <span className={`badge text-xs ${RISK_COLOUR[result?.risk_level] ?? 'bg-gray-800 text-gray-400'}`}>
                          {result?.risk_level ?? '—'}
                        </span>
                      </div>
                    </div>

                    {/* Cleaned text preview */}
                    {result?.remarks_cleaned && (
                      <div className="mt-2 ml-9 text-xs text-gray-400 bg-gray-800/60 rounded px-3 py-1.5">
                        <span className="text-gray-600 mr-1">Cleaned:</span>
                        {result.remarks_cleaned}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-400">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalPending)} of {totalPending.toLocaleString()} pending
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary py-1.5 px-3 disabled:opacity-40"><ChevronLeft size={16} /></button>
                <span className="text-sm text-gray-400">Page {page + 1} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn-secondary py-1.5 px-3 disabled:opacity-40"><ChevronRight size={16} /></button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'cleaned' && (
        <>
          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading…</div>
          ) : cleanedRecords.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No cleaned records yet</div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      {['Asset No', 'Brand', 'Site', 'Category', 'Risk Level', 'Cleaned Remarks', 'Date'].map(h => (
                        <th key={h} className="table-header">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cleanedRecords.map(r => (
                      <tr key={r.id} className="hover:bg-gray-800/30 transition-colors">
                        <td className="table-cell font-medium text-white">{r.asset_no ?? '—'}</td>
                        <td className="table-cell">{r.brand ?? '—'}</td>
                        <td className="table-cell">{r.site ?? '—'}</td>
                        <td className="table-cell">{r.category ?? '—'}</td>
                        <td className="table-cell">
                          {r.risk_level && <span className={`badge ${RISK_COLOUR[r.risk_level]}`}>{r.risk_level}</span>}
                        </td>
                        <td className="table-cell text-gray-400 text-xs max-w-xs truncate">{r.remarks_cleaned ?? '—'}</td>
                        <td className="table-cell text-gray-500">{r.issue_date ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
