import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import * as gatePassPageApi from '../lib/api/gatePassPage'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { exportToPdf, exportToExcel } from '../lib/exportUtils'
import { formatDate } from '../lib/formatters'
import {
  ShieldCheck, ShieldClose, CheckCircle, XCircle, Printer, Clock,
  Download, Search, RefreshCw, Activity, Upload,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/EmptyState'
import { gatePasses } from '../lib/api'

const STATUS_CONFIG = {
  Cleared: { color: 'text-green-400', bg: 'bg-green-900/30', border: 'border-green-700/50' },
  Denied:  { color: 'text-red-400',   bg: 'bg-red-900/30',   border: 'border-red-700/50' },
  Pending: { color: 'text-yellow-400',bg: 'bg-yellow-900/30',border: 'border-yellow-700/50' },
}

export default function GatePass() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { activeCountry } = useSettings()

  const [assetSearch, setAssetSearch] = useState('')
  const [siteFilter, setSiteFilter]   = useState('')
  const [checkResult, setCheckResult] = useState(null) // null | 'found' | 'not-found'
  const [inspection, setInspection]   = useState(null)
  const [blockers, setBlockers]       = useState(null) // safety gate: {total,blocked,corrective_actions,tyres,inspections}
  const [issueError, setIssueError]   = useState('')
  const [passes, setPasses]           = useState([])
  const [sites, setSites]             = useState([])
  const [checking, setChecking]       = useState(false)
  const [issuing, setIssuing]         = useState(false)
  const [denialReason, setDenialReason] = useState('')
  const [showDenialInput, setShowDenialInput] = useState(false)

  // Tab state: 'today' | 'history'
  const [logTab, setLogTab] = useState('today')
  const [logSearch, setLogSearch] = useState('')
  const yesterday = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().split('T')[0]
  })()
  const [historyDate, setHistoryDate] = useState(yesterday)
  const [historyPasses, setHistoryPasses] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const autoRefreshRef = useRef(null)

  const today = new Date().toISOString().split('T')[0]
  const todayDisplay = formatDate(new Date(), 'All', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  useEffect(() => {
    loadPasses()
    loadSites()
    // Auto-refresh every 60 s for gate station use
    clearInterval(autoRefreshRef.current)
    autoRefreshRef.current = setInterval(loadPasses, 60_000)
    return () => clearInterval(autoRefreshRef.current)
  }, [siteFilter, activeCountry])

  async function loadSites() {
    const { data } = await gatePassPageApi.listGatePassSites()
    if (data) setSites([...new Set(data.map(r => r.site).filter(Boolean))].sort())
  }

  async function loadPasses() {
    const { data } = await gatePassPageApi.listGatePasses({ date: today, site: siteFilter })
    setPasses(data || [])
  }

  async function loadHistoryPasses(date) {
    setHistoryLoading(true)
    const { data } = await gatePassPageApi.listGatePasses({ date, site: siteFilter })
    setHistoryPasses(data || [])
    setHistoryLoading(false)
  }

  function handleHistoryDateChange(date) {
    setHistoryDate(date)
    loadHistoryPasses(date)
  }

  // Load history when switching to history tab
  useEffect(() => {
    if (logTab === 'history') {
      loadHistoryPasses(historyDate)
    }
  }, [logTab, siteFilter])

  async function checkClearance() {
    if (!assetSearch.trim()) return
    setChecking(true)
    setCheckResult(null)
    setInspection(null)
    setShowDenialInput(false)
    setBlockers(null)
    setIssueError('')
    // Safety gate: surface open critical defects for this asset before release.
    gatePasses.listGatePassBlockers({ assetNo: assetSearch.trim(), country: activeCountry })
      .then(setBlockers).catch(() => setBlockers(null))
    const { data } = await gatePassPageApi.findAssetInspectionForClearance({ assetNo: assetSearch.trim(), date: today })
    if (data?.[0]) {
      setInspection(data[0])
      setCheckResult('found')
      if (data[0].site && !siteFilter) setSiteFilter(data[0].site)
    } else {
      setCheckResult('not-found')
    }
    setChecking(false)
  }

  async function issuePass(status) {
    setIssuing(true); setIssueError('')
    const values = {
      asset_no:      assetSearch.trim(),
      site:          siteFilter || inspection?.site || null,
      country:       activeCountry !== 'All' ? activeCountry : null,
      pass_date:     today,
      status,
      inspection_id: inspection?.id || null,
      cleared_by:    status === 'Cleared' ? (profile?.id || null) : null,
      cleared_at:    status === 'Cleared' ? new Date().toISOString() : null,
      denial_reason: status === 'Denied' ? (denialReason || null) : null,
    }
    try {
      if (status === 'Cleared') {
        // Route release through the safety gate - refuses when critical defects are open.
        const { blockers: b } = await gatePasses.createGatePass(values)
        if (b) setBlockers(b)
      } else {
        await gatePassPageApi.insertGatePass(values) // denials/other are never blocked
      }
    } catch (err) {
      if (err?.code === 'BLOCKED') {
        setBlockers(err.blockers)
        setIssueError(err.message)
        setIssuing(false)
        return
      }
      setIssueError(err?.message || 'Could not issue the pass.')
      setIssuing(false)
      return
    }
    await loadPasses()
    setCheckResult(null)
    setInspection(null)
    setAssetSearch('')
    setDenialReason('')
    setShowDenialInput(false)
    setBlockers(null)
    setIssuing(false)
  }

  function formatPassesForExport(passArr) {
    return passArr.map(p => ({
      ...p,
      created_at: new Date(p.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    }))
  }

  function exportDailyLogExcel(passArr, dateLabel) {
    exportToExcel(
      formatPassesForExport(passArr),
      ['asset_no', 'site', 'status', 'pass_date', 'denial_reason', 'created_at'],
      ['Asset No', 'Site', 'Status', 'Pass Date', 'Denial Reason', 'Time'],
      `TyrePulse_GatePass_${dateLabel}`
    )
  }

  function printDailyLog(passArr, dateLabel, dateDisplay) {
    exportToPdf(
      passArr,
      [
        { key: 'asset_no',    header: 'Asset No' },
        { key: 'site',        header: 'Site' },
        { key: 'status',      header: 'Status' },
        { key: 'pass_date',   header: 'Date' },
        { key: 'denial_reason', header: 'Denial Reason' },
      ],
      `Gate Pass Log: ${dateDisplay}`,
      `TyrePulse_GatePass_${dateLabel}`,
      'landscape'
    )
  }

  function printPolicy() {
    const policyRows = [
      { section: 'POLICY', text: 'No vehicle may leave the site without a completed daily tyre inspection on the same date.' },
      { section: 'STEP 1', text: 'Driver presents vehicle at gate.' },
      { section: 'STEP 2', text: 'Gate officer enters asset number in the TyrePulse Gate Pass system.' },
      { section: 'STEP 3', text: 'System checks for a tyre inspection completed today for that vehicle.' },
      { section: 'STEP 4', text: 'If cleared: issue pass and log exit time.' },
      { section: 'STEP 5', text: 'If not cleared: deny exit and notify supervisor.' },
      { section: 'CONSEQUENCE 1', text: 'First offence: written warning to driver and supervisor.' },
      { section: 'CONSEQUENCE 2', text: 'Second offence: vehicle grounded until inspection is completed.' },
      { section: 'CONSEQUENCE 3', text: 'Third offence: disciplinary action per company HR policy.' },
    ]
    exportToPdf(
      policyRows,
      [
        { key: 'section', header: 'Section' },
        { key: 'text',    header: 'Policy Statement' },
      ],
      `Tyre Gate Pass Policy · Effective ${todayDisplay}`,
      'TyrePulse_GatePolicy',
      'portrait'
    )
  }

  const cleared    = useMemo(() => passes.filter(p => p.status === 'Cleared').length, [passes])
  const denied     = useMemo(() => passes.filter(p => p.status === 'Denied').length, [passes])
  const clearRate  = useMemo(() => {
    const total = cleared + denied
    return total > 0 ? Math.round((cleared / total) * 100) : null
  }, [cleared, denied])

  const siteBreakdown = useMemo(() => {
    const m = {}
    passes.forEach(p => {
      const s = p.site || '(No Site)'
      if (!m[s]) m[s] = { cleared: 0, denied: 0 }
      if (p.status === 'Cleared') m[s].cleared++
      else if (p.status === 'Denied') m[s].denied++
    })
    return Object.entries(m).sort((a, b) => (b[1].cleared + b[1].denied) - (a[1].cleared + a[1].denied))
  }, [passes])

  const activePassList = logTab === 'today' ? passes : historyPasses
  const activeDateLabel = logTab === 'today' ? today : historyDate
  const activeDateDisplay = logTab === 'today'
    ? todayDisplay
    : formatDate(historyDate + 'T00:00:00', 'All', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const filteredPassList = useMemo(() => {
    if (!logSearch) return activePassList
    const q = logSearch.toLowerCase()
    return activePassList.filter(p =>
      p.asset_no?.toLowerCase().includes(q) ||
      p.site?.toLowerCase().includes(q) ||
      p.status?.toLowerCase().includes(q) ||
      p.denial_reason?.toLowerCase().includes(q)
    )
  }, [activePassList, logSearch])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <PageHeader
            title="Gate Pass"
            subtitle={todayDisplay}
            icon={ShieldCheck}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => navigate('/data-intake?module=gatepass')}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Upload size={15} /> Import via Data Intake Center
          </button>
          <button onClick={() => exportDailyLogExcel(activePassList, activeDateLabel)} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
            <Download size={14} /> Excel
          </button>
          <button onClick={() => printDailyLog(activePassList, activeDateLabel, activeDateDisplay)} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
            <Printer size={14} /> Daily Log PDF
          </button>
          <button onClick={printPolicy} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
            <Printer size={14} /> Print Policy
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500 -mt-3">
        New: controlled, validated, audited gate-pass import with Arabic/English header mapping and asset + date duplicate detection.
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Today',    value: passes.length, color: 'text-white',      icon: Activity },
          { label: 'Cleared',        value: cleared,        color: 'text-green-400', icon: CheckCircle },
          { label: 'Denied',         value: denied,         color: 'text-red-400',   icon: XCircle },
          { label: 'Clearance Rate', value: clearRate !== null ? `${clearRate}%` : '-', color: clearRate >= 80 ? 'text-green-400' : clearRate >= 60 ? 'text-yellow-400' : 'text-red-400', icon: ShieldCheck },
        ].map(s => (
          <div key={s.label} className="card text-center">
            <s.icon size={16} className={`mx-auto mb-1 ${s.color} opacity-60`} />
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-gray-400 text-sm mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Site breakdown (when >1 site) */}
      {siteBreakdown.length > 1 && (
        <div className="card py-3 px-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Today by Site</p>
          <div className="flex flex-wrap gap-3">
            {siteBreakdown.map(([site, counts]) => (
              <div key={site} className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">{site}</span>
                <span className="text-green-400 font-medium">{counts.cleared}✓</span>
                {counts.denied > 0 && <span className="text-red-400 font-medium">{counts.denied}✗</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gate Clearance panel */}
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-4">Gate Clearance Check</h2>
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex-1 min-w-56">
            <label className="label">Vehicle Asset Number</label>
            <input
              className="input text-lg h-12"
              placeholder="Enter asset no..."
              value={assetSearch}
              onChange={e => setAssetSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && checkClearance()}
            />
          </div>
          <div className="w-44">
            <label className="label">Site</label>
            <select className="input h-12" value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
              <option value="">All Sites</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={checkClearance} disabled={checking || !assetSearch.trim()}
              className="btn-primary h-12 px-6 disabled:opacity-50">
              {checking ? 'Checking...' : 'Check Clearance'}
            </button>
          </div>
        </div>

        {/* Result panel */}
        {checkResult === 'found' && inspection && (
          <div className="rounded-xl p-5 mb-4" style={{ background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.4)' }}>
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle size={28} className="text-green-400 flex-shrink-0" />
              <div>
                <p className="text-green-300 font-bold text-lg">CLEARED</p>
                <p className="text-green-400/70 text-sm">Tyre inspection completed today</p>
              </div>
            </div>
            <div className="text-sm text-gray-300 space-y-1 mb-4">
              <p>Type: <span className="text-white">{inspection.inspection_type}</span></p>
              <p>Inspector: <span className="text-white">{inspection.inspector || 'Not specified'}</span></p>
              <p>Recorded: <span className="text-white">{new Date(inspection.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></p>
            </div>
            {blockers?.blocked && (
              <div className="rounded-lg p-3 mb-3" style={{ background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.45)' }}>
                <p className="text-red-300 font-semibold text-sm mb-1">⛔ Release blocked - {blockers.total} open critical safety item(s)</p>
                <ul className="text-xs text-red-200/90 space-y-0.5 list-disc pl-4">
                  {blockers.corrective_actions?.map((c) => <li key={c.id}>Corrective action: {c.title} ({c.status})</li>)}
                  {blockers.tyres?.map((t) => <li key={t.id}>Critical tyre {t.serial_no || ''} {t.brand ? `(${t.brand})` : ''}</li>)}
                  {blockers.inspections?.map((i) => <li key={i.id}>Critical inspection: {i.title || i.inspection_type} ({i.status})</li>)}
                </ul>
                <p className="text-[11px] text-red-200/70 mt-1">Resolve/close these before the vehicle can be released.</p>
              </div>
            )}
            {issueError && !blockers?.blocked && <p className="text-red-400 text-xs mb-2">{issueError}</p>}
            <button onClick={() => issuePass('Cleared')} disabled={issuing || blockers?.blocked}
              className="btn-primary px-6 disabled:opacity-50"
              title={blockers?.blocked ? 'Blocked by open critical safety items' : undefined}>
              {issuing ? 'Issuing...' : blockers?.blocked ? 'Release blocked' : 'Issue Gate Pass'}
            </button>
          </div>
        )}

        {checkResult === 'not-found' && (
          <div className="rounded-xl p-5 mb-4" style={{ background: 'rgba(220,38,38,0.10)', border: '1px solid rgba(220,38,38,0.4)' }}>
            <div className="flex items-center gap-3 mb-3">
              <ShieldClose size={28} className="text-red-400 flex-shrink-0" />
              <div>
                <p className="text-red-300 font-bold text-lg">NOT CLEARED</p>
                <p className="text-red-400/70 text-sm">No tyre inspection found for today</p>
              </div>
            </div>
            {!showDenialInput ? (
              <button onClick={() => setShowDenialInput(true)} className="px-5 py-2 rounded-lg bg-red-700/30 text-red-300 border border-red-700/50 hover:bg-red-700/50 text-sm font-medium">
                Deny Exit
              </button>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="label">Denial reason (optional)</label>
                  <input className="input" placeholder="e.g. No inspection record found" value={denialReason}
                    onChange={e => setDenialReason(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => issuePass('Denied')} disabled={issuing}
                    className="px-5 py-2 rounded-lg bg-red-700 text-white font-medium hover:bg-red-600 text-sm disabled:opacity-50">
                    {issuing ? 'Saving...' : 'Confirm Deny Exit'}
                  </button>
                  <button onClick={() => setShowDenialInput(false)} className="btn-secondary text-sm">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pass Log with Today / History tabs */}
      <div className="card">
        {/* Tab row */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex gap-1 p-1 bg-gray-800/50 rounded-lg">
            {[['today', 'Today'], ['history', 'History']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setLogTab(key)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  logTab === key ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Clock size={18} className="text-gray-400" />
            {logTab === 'today' ? "Today's Pass Log" : 'Historical Pass Log'}
          </h2>
        </div>

        {/* History date picker */}
        {logTab === 'history' && (
          <div className="mb-4">
            <label className="label">Select Date</label>
            <input
              type="date"
              className="input w-48"
              value={historyDate}
              max={yesterday}
              onChange={e => handleHistoryDateChange(e.target.value)}
            />
          </div>
        )}

        {/* Log search */}
        {activePassList.length > 0 && (
          <div className="relative mb-3 max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="input pl-8 text-sm"
              placeholder="Search asset, site..."
              value={logSearch}
              onChange={e => setLogSearch(e.target.value)}
            />
          </div>
        )}

        {/* Table */}
        {logTab === 'history' && historyLoading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : filteredPassList.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No gate passes"
            description={logSearch ? 'No passes match the search' : logTab === 'today' ? 'No gate passes recorded today yet' : `No gate passes found for ${activeDateLabel}`}
            compact
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-800 text-xs">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Asset</th>
                  <th className="pb-2 pr-4">Site</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredPassList.map(p => {
                  const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.Pending
                  return (
                    <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                      <td className="py-2 pr-4 text-gray-400 text-xs font-mono">
                        {new Date(p.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-2 pr-4 font-mono text-white font-semibold">{p.asset_no}</td>
                      <td className="py-2 pr-4 text-gray-300">{p.site || '-'}</td>
                      <td className="py-2 pr-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="py-2 text-gray-400 text-xs">{p.denial_reason || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="px-0 pt-2 text-xs text-gray-600 text-right">
              {filteredPassList.length} pass{filteredPassList.length !== 1 ? 'es' : ''}
              {logSearch && activePassList.length !== filteredPassList.length && ` (filtered from ${activePassList.length})`}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
