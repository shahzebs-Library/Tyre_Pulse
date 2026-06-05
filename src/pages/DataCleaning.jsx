import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { batchClassify, RISK_COLOUR, CONFIDENCE_COLOUR, ALL_CATEGORY_LABELS } from '../lib/tyreClassifier'
import { Wand2, Info, ChevronLeft, ChevronRight, Check, X, RefreshCw, CheckCheck } from 'lucide-react'

const PAGE_SIZE = 50

export default function DataCleaning() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()

  const [tab, setTab]                       = useState('pending')
  const [rawRecords, setRawRecords]         = useState([])
  const [classified, setClassified]         = useState([])
  const [overrides, setOverrides]           = useState({})
  const [selected, setSelected]             = useState(new Set())
  const [page, setPage]                     = useState(0)
  const [totalPending, setTotalPending]     = useState(0)
  const [cleanedRecords, setCleanedRecords] = useState([])
  const [loading, setLoading]               = useState(true)
  const [saving, setSaving]                 = useState(false)
  const [saveCount, setSaveCount]           = useState(0)
  const [filterConf, setFilterConf]         = useState('')
  const [filterSite, setFilterSite]         = useState('')
  const [sites, setSites]                   = useState([])
  const [stats, setStats]                   = useState({ pending: 0, cleaned: 0 })
  const [cleanedSearch, setCleanedSearch]   = useState('')
  const [cleanedPage, setCleanedPage]       = useState(1)
  const CLEANED_PAGE_SIZE = 50

  // ── Approve-all progress ─────────────────────────────────────────────────────
  const [approveAllProgress, setApproveAllProgress] = useState(null)   // null | { done, total }
  const [showApproveAllConfirm, setShowApproveAllConfirm] = useState(false)

  // ── Re-classify on cleaned tab ───────────────────────────────────────────────
  const [cleanedSelected, setCleanedSelected]   = useState(new Set())
  const [reclassifyProposed, setReclassifyProposed] = useState(null)  // null | array of diffs

  useEffect(() => { loadStats(); loadSites() }, [saveCount, activeCountry])
  useEffect(() => { tab === 'pending' ? loadPending() : loadCleaned() }, [tab, page, filterConf, filterSite, saveCount, activeCountry])

  async function loadStats() {
    const cf = activeCountry !== 'All' ? activeCountry : null
    const base = (q) => cf ? q.eq('country', cf) : q
    const [p, c] = await Promise.all([
      base(supabase.from('tyre_records').select('id', { count: 'exact', head: true }).eq('cleaned', false)),
      base(supabase.from('tyre_records').select('id', { count: 'exact', head: true }).eq('cleaned', true)),
    ])
    setStats({ pending: p.count ?? 0, cleaned: c.count ?? 0 })
  }

  async function loadSites() {
    let q = supabase.from('tyre_records').select('site').not('site', 'is', null).eq('cleaned', false)
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)
    const { data } = await q
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
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)
    if (filterSite) q = q.eq('site', filterSite)

    const { data, count } = await q
    const records = data ?? []
    setRawRecords(records)
    setTotalPending(count ?? 0)

    let results = batchClassify(records)
    if (filterConf) results = results.filter(r => r.confidence === filterConf)
    setClassified(results)
    setSelected(new Set())
    setLoading(false)
  }, [page, filterConf, filterSite, activeCountry])

  async function loadCleaned() {
    setLoading(true)
    const { data } = await supabase
      .from('tyre_records')
      .select('id, asset_no, brand, site, category, risk_level, remarks_cleaned, issue_date, description, remarks')
      .eq('cleaned', true)
      .order('created_at', { ascending: false })
      .limit(500)
    setCleanedRecords(data ?? [])
    setCleanedSelected(new Set())
    setReclassifyProposed(null)
    setLoading(false)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function getResult(id) {
    const base = classified.find(r => r.id === id)
    return overrides[id] ? { ...base, ...overrides[id] } : base
  }

  function toggleSelect(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function setOverride(id, field, value) {
    setOverrides(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), [field]: value } }))
  }

  // ── Approve selected (current page) ─────────────────────────────────────────
  async function approveSelected() {
    if (selected.size === 0) return
    setSaving(true)
    const toSave = [...selected].map(id => {
      const r = getResult(id)
      return { id, category: r?.category ?? null, risk_level: r?.risk_level ?? null, remarks_cleaned: r?.remarks_cleaned ?? null, cleaned: true }
    })
    const BATCH = 100
    const logEntries = []
    for (let i = 0; i < toSave.length; i += BATCH) {
      const batch = toSave.slice(i, i + BATCH)
      await supabase.from('tyre_records').upsert(batch, { onConflict: 'id' })
      batch.forEach(saved => {
        const orig = rawRecords.find(r => r.id === saved.id)
        if (orig) logEntries.push({ original_text: [orig.description, orig.remarks].filter(Boolean).join(' | '), cleaned_text: saved.remarks_cleaned, category: saved.category, confidence: getResult(saved.id)?.confidence, tyre_record_id: saved.id, cleaned_by_model: 'rule-based-v1' })
      })
    }
    if (logEntries.length) await supabase.from('cleaning_log').insert(logEntries)
    setSaveCount(c => c + 1)
    setOverrides({})
    setSaving(false)
  }

  // ── Approve ALL pending ──────────────────────────────────────────────────────
  async function approveAll() {
    setShowApproveAllConfirm(false)
    setSaving(true)

    // Fetch all uncleaned records in batches
    const FETCH_BATCH = 500
    let offset = 0
    let allPending = []
    while (true) {
      let q = supabase.from('tyre_records').select('id, description, remarks').eq('cleaned', false).range(offset, offset + FETCH_BATCH - 1)
      if (filterSite) q = q.eq('site', filterSite)
      const { data } = await q
      if (!data || data.length === 0) break
      allPending.push(...data)
      if (data.length < FETCH_BATCH) break
      offset += FETCH_BATCH
    }

    setApproveAllProgress({ done: 0, total: allPending.length })

    const SAVE_BATCH = 200
    const logEntries = []
    for (let i = 0; i < allPending.length; i += SAVE_BATCH) {
      const batch = allPending.slice(i, i + SAVE_BATCH)
      const results = batchClassify(batch)
      const toSave = results.map(r => ({ id: r.id, category: r.category, risk_level: r.risk_level, remarks_cleaned: r.remarks_cleaned, cleaned: true }))
      await supabase.from('tyre_records').upsert(toSave, { onConflict: 'id' })

      results.forEach(r => {
        const orig = batch.find(b => b.id === r.id)
        if (orig) logEntries.push({ original_text: [orig.description, orig.remarks].filter(Boolean).join(' | '), cleaned_text: r.remarks_cleaned, category: r.category, confidence: r.confidence, tyre_record_id: r.id, cleaned_by_model: 'rule-based-v1' })
      })

      setApproveAllProgress({ done: Math.min(i + SAVE_BATCH, allPending.length), total: allPending.length })
    }

    if (logEntries.length) {
      const LOG_BATCH = 500
      for (let i = 0; i < logEntries.length; i += LOG_BATCH) {
        await supabase.from('cleaning_log').insert(logEntries.slice(i, i + LOG_BATCH))
      }
    }

    setApproveAllProgress(null)
    setSaveCount(c => c + 1)
    setSaving(false)
  }

  // ── Re-classify (cleaned tab) ────────────────────────────────────────────────
  function runReclassify() {
    const toReclassify = cleanedRecords.filter(r => cleanedSelected.has(r.id))
    const results      = batchClassify(toReclassify.map(r => ({ id: r.id, description: r.description, remarks: r.remarks })))
    const proposed     = results.map(r => {
      const orig = cleanedRecords.find(c => c.id === r.id)
      const changed = orig.category !== r.category || orig.risk_level !== r.risk_level
      return { ...r, orig_category: orig?.category, orig_risk: orig?.risk_level, changed }
    })
    setReclassifyProposed(proposed)
  }

  async function approveReclassify() {
    if (!reclassifyProposed) return
    setSaving(true)
    const toSave = reclassifyProposed.map(r => ({ id: r.id, category: r.category, risk_level: r.risk_level, remarks_cleaned: r.remarks_cleaned, cleaned: true }))
    const BATCH = 200
    for (let i = 0; i < toSave.length; i += BATCH) {
      await supabase.from('tyre_records').upsert(toSave.slice(i, i + BATCH), { onConflict: 'id' })
    }
    setReclassifyProposed(null)
    setCleanedSelected(new Set())
    setSaveCount(c => c + 1)
    setSaving(false)
  }

  // ── Undo classification (cleaned tab) ───────────────────────────────────────
  async function undoClassification(record) {
    await supabase.from('tyre_records').update({
      category: null,
      risk_level: null,
      remarks_cleaned: null,
      cleaned: false,
    }).eq('id', record.id)

    await supabase.from('cleaning_log').delete().eq('tyre_record_id', record.id)

    await loadCleaned()
    setSaveCount(c => c + 1)
  }

  const totalPages = Math.ceil(totalPending / PAGE_SIZE)
  const allSelected = classified.length > 0 && classified.every(r => selected.has(r.id))

  // ── Cleaned tab derived data ─────────────────────────────────────────────────
  let cleanedFiltered = cleanedRecords
  if (cleanedSearch) {
    const q = cleanedSearch.toLowerCase()
    cleanedFiltered = cleanedFiltered.filter(r =>
      r.asset_no?.toLowerCase().includes(q) ||
      r.brand?.toLowerCase().includes(q) ||
      r.site?.toLowerCase().includes(q) ||
      r.serial_no?.toLowerCase().includes(q)
    )
  }
  const cleanedPaged = cleanedFiltered.slice((cleanedPage - 1) * CLEANED_PAGE_SIZE, cleanedPage * CLEANED_PAGE_SIZE)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Wand2 size={22} className="text-green-400" /> Data Cleaning Engine
          </h1>
          <p className="text-gray-400 text-sm mt-1">Rule-based auto-classification — zero AI tokens required</p>
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

      {/* Info */}
      <div className="bg-green-900/20 border border-green-800/50 rounded-lg px-4 py-3 flex gap-3">
        <Info size={16} className="text-green-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-green-300">
          Matches tyre description + remarks against 13 failure categories using keyword patterns. Confidence reflects keyword match strength. Review, adjust dropdowns if needed, then approve.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-800">
        {[['pending', 'Pending Classification'], ['cleaned', 'Already Cleaned']].map(([val, label]) => (
          <button key={val} onClick={() => { setTab(val); setPage(0) }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === val ? 'border-green-500 text-green-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Pending tab ───────────────────────────────────────────────────── */}
      {tab === 'pending' && (
        <>
          {/* Toolbar */}
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

            {stats.pending > 0 && (
              <button onClick={() => setShowApproveAllConfirm(true)} disabled={saving}
                className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-40">
                <CheckCheck size={15} className="text-green-400" /> Approve All {stats.pending.toLocaleString()}
              </button>
            )}

            <span className="text-sm text-gray-400">{selected.size} selected</span>
            <button onClick={() => allSelected ? setSelected(new Set()) : setSelected(new Set(classified.map(r => r.id)))}
              className="btn-secondary py-1.5 px-3 text-sm">
              {allSelected ? 'Clear' : 'Select All'}
            </button>
            <button onClick={approveSelected} disabled={selected.size === 0 || saving}
              className="btn-primary flex items-center gap-2 disabled:opacity-40">
              <Check size={15} /> {saving ? 'Saving…' : `Approve ${selected.size > 0 ? selected.size : ''}`}
            </button>
          </div>

          {/* Approve-all progress */}
          {approveAllProgress && (
            <div className="card">
              <p className="text-white font-medium mb-2">Approving all pending records…</p>
              <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${(approveAllProgress.done / approveAllProgress.total) * 100}%` }} />
              </div>
              <p className="text-gray-400 text-sm mt-1">{approveAllProgress.done.toLocaleString()} / {approveAllProgress.total.toLocaleString()}</p>
            </div>
          )}

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
                const isSel  = selected.has(r.id)
                return (
                  <div key={r.id} className={`card cursor-pointer transition-all ${isSel ? 'border-green-600/60 bg-green-950/20' : 'hover:border-gray-700'}`}
                    onClick={() => toggleSelect(r.id)}>
                    <div className="flex items-start gap-4">
                      <div className={`w-5 h-5 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${isSel ? 'bg-green-700 border-green-600' : 'border-gray-600'}`}>
                        {isSel && <Check size={12} className="text-white" />}
                      </div>
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
                            {result.matched_keywords.map((kw, i) => <span key={i} className="bg-gray-800 text-gray-400 text-xs px-1.5 py-0.5 rounded">{kw}</span>)}
                          </div>
                        )}
                        {result?.remarks_cleaned && (
                          <div className="mt-2 text-xs text-gray-400 bg-gray-800/60 rounded px-3 py-1.5">
                            <span className="text-gray-600 mr-1">Cleaned:</span>{result.remarks_cleaned}
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0 flex flex-col gap-2 items-end" onClick={e => e.stopPropagation()}>
                        <span className={`text-xs font-medium ${CONFIDENCE_COLOUR[result?.confidence] ?? 'text-gray-500'}`}>{result?.confidence ?? '—'} confidence</span>
                        <select className="bg-gray-800 border border-gray-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-600"
                          value={result?.category ?? ''} onChange={e => setOverride(r.id, 'category', e.target.value)}>
                          {ALL_CATEGORY_LABELS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select className="bg-gray-800 border border-gray-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-600"
                          value={result?.risk_level ?? ''} onChange={e => setOverride(r.id, 'risk_level', e.target.value)}>
                          {['Critical', 'High', 'Medium', 'Low'].map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                        <span className={`badge text-xs ${RISK_COLOUR[result?.risk_level] ?? 'bg-gray-800 text-gray-400'}`}>{result?.risk_level ?? '—'}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

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

      {/* ── Cleaned tab ───────────────────────────────────────────────────── */}
      {tab === 'cleaned' && (
        <>
          {/* Filter / search bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <input
              className="input flex-1 min-w-48"
              placeholder="Search asset, brand, site…"
              value={cleanedSearch}
              onChange={e => { setCleanedSearch(e.target.value); setCleanedPage(1) }}
            />
          </div>

          {/* Re-classify toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-400">{cleanedSelected.size} selected</span>
            {cleanedSelected.size > 0 && (
              <>
                <button onClick={runReclassify} disabled={saving}
                  className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-40">
                  <RefreshCw size={14} /> Re-classify {cleanedSelected.size} Selected
                </button>
                <button onClick={() => setCleanedSelected(new Set())} className="text-gray-400 hover:text-white text-sm">Clear</button>
              </>
            )}
          </div>

          {/* Re-classify diff view */}
          {reclassifyProposed && (
            <div className="card">
              <h3 className="font-semibold text-white mb-3">Proposed Re-classification</h3>
              <div className="space-y-2 mb-4">
                {reclassifyProposed.map(r => (
                  <div key={r.id} className={`flex items-center gap-4 px-3 py-2 rounded-lg text-sm ${r.changed ? 'bg-yellow-900/20 border border-yellow-700/40' : 'bg-gray-800/40'}`}>
                    <span className="text-gray-300 flex-1">{r.original_description?.slice(0, 60) ?? '—'}</span>
                    {r.changed ? (
                      <>
                        <span className="text-gray-500 line-through text-xs">{r.orig_category}</span>
                        <span className="text-yellow-300 text-xs">→ {r.category}</span>
                        <span className="text-gray-500 line-through text-xs">{r.orig_risk}</span>
                        <span className="text-yellow-300 text-xs">→ {r.risk_level}</span>
                      </>
                    ) : (
                      <span className="text-gray-500 text-xs">No change</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={approveReclassify} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <Check size={15} /> {saving ? 'Saving…' : 'Apply Changes'}
                </button>
                <button onClick={() => setReclassifyProposed(null)} className="btn-secondary">Cancel</button>
              </div>
            </div>
          )}

          {loading ? <div className="text-center py-12 text-gray-500">Loading…</div> : cleanedRecords.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No cleaned records yet</div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="table-header w-10">
                        <input type="checkbox" className="rounded border-gray-600 bg-gray-700"
                          checked={cleanedPaged.length > 0 && cleanedPaged.every(r => cleanedSelected.has(r.id))}
                          onChange={() => {
                            if (cleanedPaged.every(r => cleanedSelected.has(r.id))) setCleanedSelected(new Set())
                            else setCleanedSelected(new Set(cleanedPaged.map(r => r.id)))
                          }} />
                      </th>
                      {['Asset No', 'Brand', 'Site', 'Category', 'Risk Level', 'Cleaned Remarks', 'Original Remarks', 'Date', ''].map(h => <th key={h} className="table-header">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {cleanedPaged.map(r => (
                      <tr key={r.id} className={`transition-colors ${cleanedSelected.has(r.id) ? 'bg-green-950/30' : 'hover:bg-gray-800/30'}`}>
                        <td className="table-cell">
                          <input type="checkbox" className="rounded border-gray-600 bg-gray-700"
                            checked={cleanedSelected.has(r.id)} onChange={() => setCleanedSelected(s => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })} />
                        </td>
                        <td className="table-cell font-medium text-white">{r.asset_no ?? '—'}</td>
                        <td className="table-cell">{r.brand ?? '—'}</td>
                        <td className="table-cell">{r.site ?? '—'}</td>
                        <td className="table-cell">{r.category ?? '—'}</td>
                        <td className="table-cell">{r.risk_level ? <span className={`badge ${RISK_COLOUR[r.risk_level]}`}>{r.risk_level}</span> : '—'}</td>
                        <td className="table-cell text-gray-400 text-xs max-w-xs truncate">{r.remarks_cleaned ?? '—'}</td>
                        <td className="py-2 pr-3 text-gray-500 text-xs max-w-48 truncate" title={r.remarks || r.description}>
                          {(r.remarks || r.description || '—').slice(0, 60)}{(r.remarks || r.description || '').length > 60 ? '…' : ''}
                        </td>
                        <td className="table-cell text-gray-500">{r.issue_date ?? '—'}</td>
                        <td className="table-cell">
                          <button
                            onClick={() => undoClassification(r)}
                            className="text-xs px-2 py-1 rounded bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/40 border border-yellow-700/40 transition-colors"
                            title="Move back to Pending"
                          >
                            Undo
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {cleanedFiltered.length > CLEANED_PAGE_SIZE && (
                <div className="flex items-center justify-between mt-3 px-4 pb-3 text-sm text-gray-500">
                  <span>{cleanedFiltered.length} records · page {cleanedPage} of {Math.ceil(cleanedFiltered.length / CLEANED_PAGE_SIZE)}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCleanedPage(p => Math.max(1, p - 1))}
                      disabled={cleanedPage === 1}
                      className="px-3 py-1 rounded bg-gray-800 border border-gray-700 disabled:opacity-40 hover:bg-gray-700"
                    >← Prev</button>
                    <button
                      onClick={() => setCleanedPage(p => Math.min(Math.ceil(cleanedFiltered.length / CLEANED_PAGE_SIZE), p + 1))}
                      disabled={cleanedPage >= Math.ceil(cleanedFiltered.length / CLEANED_PAGE_SIZE)}
                      className="px-3 py-1 rounded bg-gray-800 border border-gray-700 disabled:opacity-40 hover:bg-gray-700"
                    >Next →</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Approve-all confirm modal ──────────────────────────────────────── */}
      {showApproveAllConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowApproveAllConfirm(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-2">Approve All Pending Records</h2>
            <p className="text-gray-400 text-sm mb-4">
              The classifier will run on all <strong className="text-white">{stats.pending.toLocaleString()}</strong> pending records and save the results automatically.
              {filterSite && ` Only records from "${filterSite}" will be processed.`}
            </p>
            <p className="text-yellow-300 text-sm mb-4">Low-confidence classifications will still be saved — no manual review step.</p>
            <div className="flex gap-3">
              <button onClick={approveAll} className="btn-primary flex items-center gap-2">
                <CheckCheck size={15} /> Approve All
              </button>
              <button onClick={() => setShowApproveAllConfirm(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
