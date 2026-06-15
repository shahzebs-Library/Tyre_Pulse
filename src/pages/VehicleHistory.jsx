import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { computeAssetMetrics, bucketByMonth, countBy, sum } from '../lib/analyticsEngine'
import { detectAnomalies, ANOMALY_TYPES } from '../lib/anomalyEngine'
import { exportToPdf } from '../lib/exportUtils'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { Search, AlertTriangle, X, FileText, Car, TrendingUp } from 'lucide-react'
import VehicleTyreDiagram from '../components/VehicleTyreDiagram'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

// ── Vehicle type icons ────────────────────────────────────────────────────────

const VEHICLE_ICONS = {
  'Pickup':        '🛻',
  'Tri-mixer':     '🚛',
  'Concrete pump': '🏗️',
  'Canter':        '🚚',
  'Wheel loader':  '🚜',
  'Skid loader':   '🚜',
}

function vehicleIcon(type) { return VEHICLE_ICONS[type] ?? '🚗' }

// ── Shared badge helpers ──────────────────────────────────────────────────────

const RISK_BADGE = {
  Critical: 'bg-red-900/50 text-red-300 border-red-700/50',
  High:     'bg-orange-900/50 text-orange-300 border-orange-700/50',
  Medium:   'bg-yellow-900/50 text-yellow-300 border-yellow-700/50',
  Low:      'bg-green-900/50 text-green-300 border-green-700/50',
  Unknown:  'bg-gray-800 text-gray-400 border-gray-700',
}

function riskBadgeClass(level) {
  return RISK_BADGE[level] || RISK_BADGE.Unknown
}

function misuseBadgeClass(score) {
  if (score <= 25)  return 'bg-green-900/40 text-green-400 border-green-700/50'
  if (score <= 50)  return 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50'
  if (score <= 75)  return 'bg-orange-900/40 text-orange-400 border-orange-700/50'
  return 'bg-red-900/40 text-red-400 border-red-700/50'
}

const BAR_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
    y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
  },
}

const DOUGHNUT_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 11 }, padding: 10 } },
  },
}

const CHART_COLORS = [
  'rgba(59,130,246,0.7)', 'rgba(16,185,129,0.7)', 'rgba(245,158,11,0.7)',
  'rgba(239,68,68,0.7)',  'rgba(139,92,246,0.7)', 'rgba(236,72,153,0.7)',
  'rgba(20,184,166,0.7)', 'rgba(251,146,60,0.7)',
]

// ── Compute additional local red flags ────────────────────────────────────────

function computeLocalRedFlags(assetRecords) {
  const flags = []

  const sorted = [...assetRecords]
    .filter(r => r.issue_date)
    .sort((a, b) => new Date(a.issue_date) - new Date(b.issue_date))

  // LOW_KM_USAGE: tyre removed after < 500 km
  sorted.forEach(r => {
    const kmFit = r.km_at_fitment != null ? +r.km_at_fitment : null
    const kmRem = r.km_at_removal  != null ? +r.km_at_removal  : null
    if (kmFit !== null && kmRem !== null && !isNaN(kmFit) && !isNaN(kmRem) && kmRem > 0 && kmFit > 0) {
      const km = kmRem - kmFit
      if (km >= 0 && km < 500) {
        flags.push({
          type: 'LOW_KM_USAGE',
          severity: 'high',
          record_ids: [r.id],
          records: [r],
          message: `Suspiciously low mileage: tyre removed after only ${km} km — possible theft or misuse`,
          detail: `Asset ${r.asset_no}, fitment: ${kmFit} km, removal: ${kmRem} km on ${r.issue_date}`,
        })
      }
    }
  })

  // INCONSISTENT_KM: km at next fitment < km at previous removal
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    const prevRem  = prev.km_at_removal  != null ? +prev.km_at_removal  : null
    const currFit  = curr.km_at_fitment  != null ? +curr.km_at_fitment  : null
    if (prevRem !== null && currFit !== null && !isNaN(prevRem) && !isNaN(currFit) && prevRem > 0 && currFit > 0) {
      if (currFit < prevRem) {
        flags.push({
          type: 'INCONSISTENT_KM',
          severity: 'high',
          record_ids: [prev.id, curr.id],
          records: [prev, curr],
          message: `Odometer inconsistency detected: km readings are not sequential — possible tampering`,
          detail: `Previous removal: ${prevRem} km (${prev.issue_date}), next fitment: ${currFit} km (${curr.issue_date})`,
        })
      }
    }
  }

  return flags
}

// ── Compute misuse risk score ─────────────────────────────────────────────────

function computeMisuseScore(anomalies, highRiskCount, totalCount, spanMonths) {
  let score = 0
  const anomalyCount = anomalies.length
  score += Math.min(40, anomalyCount * 20)
  if (totalCount > 0 && highRiskCount / totalCount > 0.5) score += 20
  const avgDays = totalCount > 1 ? (spanMonths * 30) / totalCount : 999
  if (avgDays < 30) score += 20
  const hasSerialReuse = anomalies.some(a => a.type === ANOMALY_TYPES.SERIAL_REUSE)
  const hasDuplicate   = anomalies.some(a => a.type === ANOMALY_TYPES.DUPLICATE_ENTRY)
  if (hasSerialReuse) score += 20
  if (hasDuplicate)   score += 10
  return Math.min(100, score)
}

// ── Fleet-policy red flags (computed locally using fleet master data) ─────────

function computeFleetPolicyFlags(assetRecords, fleetRecord) {
  const flags = []
  if (!fleetRecord) return flags

  // BUDGET_BREACH: monthly spend > monthly_tyre_budget
  if (fleetRecord.monthly_tyre_budget) {
    const budget = +fleetRecord.monthly_tyre_budget
    // Group records by YYYY-MM
    const byMonth = {}
    assetRecords.forEach(r => {
      if (!r.issue_date) return
      const month = r.issue_date.slice(0, 7)
      if (!byMonth[month]) byMonth[month] = []
      byMonth[month].push(r)
    })
    Object.entries(byMonth).forEach(([month, recs]) => {
      const spend = recs.reduce((s, r) => s + (+(r.cost_per_tyre || 0)) * (+(r.qty || 1)), 0)
      if (spend > budget) {
        flags.push({
          type: 'BUDGET_BREACH',
          severity: 'high',
          record_ids: recs.map(r => r.id),
          records: recs,
          message: `Monthly budget exceeded in ${month}: spent ${spend.toLocaleString()} vs budget ${budget.toLocaleString()}`,
          detail: `${recs.length} tyre record(s) in ${month}, total cost: ${spend.toLocaleString()}`,
        })
      }
    })
  }

  // LOW_KM_VS_POLICY: km run < 40% of expected_km_per_tyre
  if (fleetRecord.expected_km_per_tyre) {
    const threshold = +fleetRecord.expected_km_per_tyre * 0.4
    assetRecords.forEach(r => {
      const kmFit = r.km_at_fitment != null ? +r.km_at_fitment : null
      const kmRem = r.km_at_removal  != null ? +r.km_at_removal  : null
      if (kmFit !== null && kmRem !== null && !isNaN(kmFit) && !isNaN(kmRem) && kmRem > kmFit) {
        const km = kmRem - kmFit
        if (km < threshold) {
          flags.push({
            type: 'LOW_KM_VS_POLICY',
            severity: 'high',
            record_ids: [r.id],
            records: [r],
            message: `Tyre removed after only ${km.toLocaleString()} km — below 40% of policy threshold (${Math.round(threshold).toLocaleString()} km)`,
            detail: `Expected: ${fleetRecord.expected_km_per_tyre.toLocaleString()} km, actual: ${km.toLocaleString()} km on ${r.issue_date}`,
          })
        }
      }
    })
  }

  return flags
}

// ── Flag type metadata ────────────────────────────────────────────────────────

const FLAG_META = {
  SHORT_INTERVAL:    { label: 'Short Interval',       color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-700/40' },
  SAME_DAY_BURST:    { label: 'Same-Day Burst',        color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/40' },
  RAPID_RECURRENCE:  { label: 'Rapid Recurrence',      color: 'text-red-400',    bg: 'bg-red-900/20 border-red-700/40' },
  COST_SPIKE:        { label: 'Cost Spike',             color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/40' },
  SERIAL_REUSE:      { label: 'Serial Reuse',           color: 'text-red-400',    bg: 'bg-red-900/20 border-red-700/40' },
  DUPLICATE_ENTRY:   { label: 'Duplicate Entry',        color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-700/40' },
  LOW_KM_USAGE:      { label: 'Low KM Usage',           color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/40' },
  INCONSISTENT_KM:   { label: 'Inconsistent Odometer',  color: 'text-red-400',    bg: 'bg-red-900/20 border-red-700/40' },
  BUDGET_BREACH:     { label: 'Budget Breach',          color: 'text-red-400',    bg: 'bg-red-900/20 border-red-700/40' },
  LOW_KM_VS_POLICY:  { label: 'KM Below Policy',        color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/40' },
}

function getFlagMeta(type) {
  return FLAG_META[type] || { label: type, color: 'text-gray-400', bg: 'bg-gray-800/40 border-gray-700/40' }
}

// ── Detail Panel Tabs ─────────────────────────────────────────────────────────

const DETAIL_TABS = ['Timeline', 'Analysis', 'Red Flags', 'Related Records', 'Forecast']

// ─────────────────────────────────────────────────────────────────────────────
// Main page component
// ─────────────────────────────────────────────────────────────────────────────

export default function VehicleHistory() {
  const { appSettings, activeCountry, activeCurrency } = useSettings()
  const dc = appSettings?.cost_per_tyre || 1200

  const [allRecords, setAllRecords]   = useState([])
  const [loading, setLoading]         = useState(true)
  const [sites, setSites]             = useState([])
  const [selected, setSelected]       = useState(null)   // asset_no string

  // Fleet master data
  const [fleetMap, setFleetMap] = useState({})   // asset_no -> vehicle_fleet row

  // Filters
  const [search, setSearch]               = useState('')
  const [siteFilter, setSiteFilter]       = useState('')
  const [anomalyFilter, setAnomalyFilter] = useState('all')  // 'all' | 'has' | 'clean'
  const [sortBy, setSortBy]               = useState('misuse') // 'misuse' | 'cost' | 'count' | 'date'

  // Related records state
  const [relatedActions, setRelatedActions]         = useState([])
  const [relatedRca, setRelatedRca]                 = useState([])
  const [relatedInspections, setRelatedInspections] = useState([])

  // Tyre positions for SVG diagram
  const [tyrePositions, setTyrePositions] = useState([])

  // ── Load data ────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await fetchAllPages((from, to) => {
        let q = supabase.from('tyre_records').select('*').order('issue_date', { ascending: true })
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      }, { max: 200000 })
      const rows = data || []
      setAllRecords(rows)
      const uniqSites = [...new Set(rows.map(r => r.site).filter(Boolean))].sort()
      setSites(uniqSites)

      // Load fleet master data
      const { data: fleetData } = await supabase.from('vehicle_fleet').select('*')
      const map = {}
      ;(fleetData || []).forEach(v => { map[v.asset_no] = v })
      setFleetMap(map)

      setLoading(false)
    }
    load()
  }, [activeCountry])

  // ── Detect anomalies across full fleet ───────────────────────────────────────
  const allAnomalies = useMemo(() => {
    if (!allRecords.length) return []
    return detectAnomalies(allRecords)
  }, [allRecords])

  // ── Compute asset metrics ────────────────────────────────────────────────────
  const assetMetrics = useMemo(() => computeAssetMetrics(allRecords, dc), [allRecords, dc])

  // ── Build per-asset enriched rows ────────────────────────────────────────────
  const vehicleRows = useMemo(() => {
    return assetMetrics.map(asset => {
      const assetAnomalies = allAnomalies.filter(a => {
        if (a.type === ANOMALY_TYPES.SERIAL_REUSE) {
          return a.assets && a.assets.includes(asset.assetNo)
        }
        return a.asset_no === asset.assetNo
      })

      const fleetRecord   = fleetMap[asset.assetNo] || null
      const localFlags    = computeLocalRedFlags(asset.records)
      const policyFlags   = computeFleetPolicyFlags(asset.records, fleetRecord)
      const allFlags      = [...assetAnomalies, ...localFlags, ...policyFlags]
      const misuseScore   = computeMisuseScore(assetAnomalies, asset.highRiskCount, asset.count, asset.spanMonths)
      const avgDays       = asset.count > 1 ? Math.round((asset.spanMonths * 30) / asset.count) : null

      return {
        ...asset,
        anomalies: assetAnomalies,
        localFlags,
        policyFlags,
        allFlags,
        misuseScore,
        avgDays,
        fleetRecord,
      }
    })
  }, [assetMetrics, allAnomalies, fleetMap])

  // ── Filter + sort ────────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    let rows = vehicleRows

    if (search)
      rows = rows.filter(r => r.assetNo.toLowerCase().includes(search.toLowerCase()))

    if (siteFilter)
      rows = rows.filter(r => r.sites.includes(siteFilter))

    if (anomalyFilter === 'has')
      rows = rows.filter(r => r.allFlags.length > 0)
    else if (anomalyFilter === 'clean')
      rows = rows.filter(r => r.allFlags.length === 0)

    const copy = [...rows]
    if (sortBy === 'misuse')  copy.sort((a, b) => b.misuseScore - a.misuseScore)
    if (sortBy === 'cost')    copy.sort((a, b) => b.totalCost   - a.totalCost)
    if (sortBy === 'count')   copy.sort((a, b) => b.count       - a.count)
    if (sortBy === 'date')    copy.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''))

    return copy
  }, [vehicleRows, search, siteFilter, anomalyFilter, sortBy])

  const selectedRow = selected ? vehicleRows.find(r => r.assetNo === selected) : null

  // ── Load related records when asset selected ─────────────────────────────────
  useEffect(() => {
    if (!selected) {
      setRelatedActions([])
      setRelatedRca([])
      setRelatedInspections([])
      setTyrePositions([])
      return
    }
    async function loadRelated() {
      const [actRes, rcaRes, insRes, tyreRes] = await Promise.all([
        supabase.from('corrective_actions')
          .select('id,title,status,priority,due_date,site,created_at')
          .or(`asset_no.eq.${selected},description.ilike.%${selected}%`)
          .limit(20),
        supabase.from('rca_records')
          .select('id,asset_no,root_cause,tyre_serial,brand,site,created_at')
          .eq('asset_no', selected)
          .limit(20),
        supabase.from('inspections')
          .select('id,asset_no,status,site,created_at')
          .eq('asset_no', selected)
          .limit(20),
        supabase.from('tyre_records')
          .select('position,risk_level,brand,serial_no,issue_date')
          .eq('asset_no', selected)
          .order('issue_date', { ascending: false }),
      ])
      setRelatedActions(actRes.data || [])
      setRelatedRca(rcaRes.data || [])
      setRelatedInspections(insRes.data || [])

      const rows = tyreRes.data || []
      const latestPerPosition = Object.values(
        rows.reduce((acc, r) => {
          if (r.position && !acc[r.position]) acc[r.position] = r
          return acc
        }, {})
      )
      setTyrePositions(latestPerPosition)
    }
    loadRelated()
  }, [selected])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="text-center">
          <Car size={40} className="mx-auto mb-3 opacity-40" />
          <p>Loading vehicle history data…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle Asset History"
        subtitle="Per-vehicle replacement history, misuse risk scoring, and red flag detection"
        icon={Car}
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Vehicles',   value: vehicleRows.length,                                                color: 'text-blue-400' },
          { label: 'With Anomalies',   value: vehicleRows.filter(r => r.allFlags.length > 0).length,            color: 'text-orange-400' },
          { label: 'High Misuse Risk', value: vehicleRows.filter(r => r.misuseScore >= 51).length,              color: 'text-red-400' },
          {
            label: 'Total Fleet Cost',
            value: `${activeCurrency} ${Math.round(vehicleRows.reduce((s, r) => s + r.totalCost, 0)).toLocaleString()}`,
            color: 'text-green-400',
          },
        ].map(({ label, value, color }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="card text-center"
          >
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-muted text-sm mt-1">{label}</p>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Search asset number…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="input w-40" value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
            <option value="">All Sites</option>
            {sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input w-44" value={anomalyFilter} onChange={e => setAnomalyFilter(e.target.value)}>
            <option value="all">All Vehicles</option>
            <option value="has">Has Anomalies</option>
            <option value="clean">Clean</option>
          </select>
          <select className="input w-52" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="misuse">Sort: Misuse Risk Score</option>
            <option value="cost">Sort: Total Cost</option>
            <option value="count">Sort: Replacement Count</option>
            <option value="date">Sort: Last Replacement</option>
          </select>
        </div>
      </div>

      {/* Vehicle fleet table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-800 text-xs">
                <th className="px-4 py-3">Asset No</th>
                <th className="px-3 py-3 text-right">Replacements</th>
                <th className="px-3 py-3 text-right">Total Cost</th>
                <th className="px-3 py-3 text-right">High Risk</th>
                <th className="px-3 py-3 text-right">Anomalies</th>
                <th className="px-3 py-3 text-right">Avg Days/Repl</th>
                <th className="px-3 py-3">Last Replacement</th>
                <th className="px-3 py-3 text-center">Misuse Score</th>
                <th className="px-3 py-3">Red Flags</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                    No vehicles match the current filters.
                  </td>
                </tr>
              )}
              {filteredRows.slice(0, 200).map(row => (
                <tr
                  key={row.assetNo}
                  onClick={() => setSelected(selected === row.assetNo ? null : row.assetNo)}
                  className={`border-b border-gray-800/50 cursor-pointer transition-colors ${
                    selected === row.assetNo ? 'bg-blue-900/20' : 'hover:bg-gray-800/20'
                  }`}
                >
                  <td className="px-4 py-2 font-mono text-xs text-blue-400 font-medium">{row.assetNo}</td>
                  <td className="px-3 py-2 text-gray-300 text-right">{row.count}</td>
                  <td className="px-3 py-2 text-gray-300 text-right text-xs">
                    {activeCurrency} {row.totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.highRiskCount > 0
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-400">{row.highRiskCount}</span>
                      : <span className="text-gray-600 text-xs">0</span>
                    }
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.anomalies.length > 0
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-orange-900/40 text-orange-400">{row.anomalies.length}</span>
                      : <span className="text-gray-600 text-xs">0</span>
                    }
                  </td>
                  <td className="px-3 py-2 text-gray-400 text-right text-xs">
                    {row.avgDays !== null ? `${row.avgDays}d` : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{row.lastSeen || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${misuseBadgeClass(row.misuseScore)}`}>
                      {row.misuseScore}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.allFlags.slice(0, 3).map((f, i) => {
                        const meta = getFlagMeta(f.type)
                        return (
                          <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.bg} ${meta.color}`}>
                            {meta.label}
                          </span>
                        )
                      })}
                      {row.allFlags.length > 3 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-800 text-gray-400 border-gray-700">
                          +{row.allFlags.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredRows.length > 200 && (
          <p className="text-xs text-gray-500 text-center py-3">
            Showing 200 of {filteredRows.length} vehicles — use filters to narrow results
          </p>
        )}
      </div>

      {/* Vehicle detail panel */}
      {selectedRow && (
        <VehicleDetailPanel
          row={selectedRow}
          currency={activeCurrency}
          defaultCost={dc}
          onClose={() => setSelected(null)}
          relatedActions={relatedActions}
          relatedRca={relatedRca}
          relatedInspections={relatedInspections}
          fleetRecord={selectedRow.fleetRecord}
          tyrePositions={tyrePositions}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle Detail Panel
// ─────────────────────────────────────────────────────────────────────────────

function VehicleDetailPanel({ row, currency, defaultCost, onClose, relatedActions, relatedRca, relatedInspections, fleetRecord, tyrePositions }) {
  const [activeTab, setActiveTab] = useState(0)

  // Build set of flagged record IDs for highlighting in timeline
  const flaggedIds = useMemo(() => {
    const ids = new Set()
    row.allFlags.forEach(f => f.record_ids?.forEach(id => ids.add(id)))
    return ids
  }, [row.allFlags])

  // Sorted records oldest-first for timeline
  const timelineRecords = useMemo(() =>
    [...row.records].sort((a, b) => new Date(a.issue_date) - new Date(b.issue_date)),
    [row.records]
  )

  // Analysis data
  const monthlyBuckets = useMemo(() =>
    bucketByMonth(row.records, r => r.issue_date, r => (r.cost_per_tyre || defaultCost) * (r.qty || 1)),
    [row.records, defaultCost]
  )

  const categoryBreakdown = useMemo(() =>
    countBy(row.records.filter(r => r.category), r => r.category),
    [row.records]
  )

  const brandBreakdown = useMemo(() =>
    countBy(row.records.filter(r => r.brand), r => r.brand),
    [row.records]
  )

  const totalCost   = row.totalCost
  const avgCostTyre = row.count > 0 ? totalCost / row.count : 0
  const highRiskPct = row.count > 0 ? (row.highRiskCount / row.count) * 100 : 0

  const kmValues = row.records
    .map(r => (r.km_at_removal != null && r.km_at_fitment != null)
      ? +r.km_at_removal - +r.km_at_fitment : null)
    .filter(v => v !== null && v > 0)
  const avgKm = kmValues.length ? Math.round(kmValues.reduce((s, v) => s + v, 0) / kmValues.length) : null

  // PDF export
  function handleExportPdf() {
    const cols = [
      { key: 'issue_date',      header: 'Date',             width: 22 },
      { key: 'brand',           header: 'Brand',            width: 24 },
      { key: 'serial_no',       header: 'Serial No',        width: 28 },
      { key: 'category',        header: 'Category',         width: 30 },
      { key: 'risk_level',      header: 'Risk',             width: 18 },
      { key: 'cost_display',    header: `Cost (${currency})`, width: 22 },
      { key: 'site',            header: 'Site',             width: 26 },
      { key: 'remarks_cleaned', header: 'Remarks',          width: 40 },
    ]
    const pdfRows = timelineRecords.map(r => ({
      ...r,
      cost_display: ((r.cost_per_tyre || defaultCost) * (r.qty || 1)).toLocaleString(),
    }))
    exportToPdf(
      pdfRows, cols,
      `Vehicle Asset History · ${row.assetNo} (${row.count} records, Misuse Score: ${row.misuseScore})`,
      `VehicleHistory_${row.assetNo}_${new Date().toISOString().slice(0, 10)}`
    )
  }

  return (
    <div className="card border border-blue-500/30 space-y-5">
      {/* Panel header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-white font-bold text-xl font-mono">{row.assetNo}</h2>
            <span className={`text-xs px-2.5 py-1 rounded-full border font-bold ${misuseBadgeClass(row.misuseScore)}`}>
              Misuse Risk: {row.misuseScore}/100
            </span>
            {row.allFlags.length > 0 && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-700/40">
                <AlertTriangle size={11} /> {row.allFlags.length} Red Flag{row.allFlags.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm mt-1.5">
            {row.sites.slice(0, 3).join(' · ')}
            {row.lastSeen ? ` · Last replaced: ${row.lastSeen}` : ''}
          </p>
          <p className="text-gray-500 text-xs mt-0.5">
            {row.count} replacements · {currency} {totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })} total
            {row.firstSeen ? ` · Since ${row.firstSeen}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExportPdf} className="btn-secondary flex items-center gap-2 text-xs">
            <FileText size={13} className="text-red-400" /> Export PDF
          </button>
          <button onClick={onClose} className="btn-secondary flex items-center gap-1.5 text-xs">
            <X size={13} /> Close
          </button>
        </div>
      </div>

      {/* Vehicle Specs row */}
      {fleetRecord ? (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500 mr-1">Vehicle Specs:</span>
          {fleetRecord.make && (
            <span className="text-xs px-2 py-0.5 rounded bg-blue-900/30 border border-blue-700/40 text-blue-300">
              <span className="text-gray-500 mr-1">Make</span>{fleetRecord.make}
            </span>
          )}
          {fleetRecord.model && (
            <span className="text-xs px-2 py-0.5 rounded bg-blue-900/30 border border-blue-700/40 text-blue-300">
              <span className="text-gray-500 mr-1">Model</span>{fleetRecord.model}
            </span>
          )}
          {fleetRecord.year && (
            <span className="text-xs px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-300">
              <span className="text-gray-500 mr-1">Year</span>{fleetRecord.year}
            </span>
          )}
          {fleetRecord.vehicle_type && (
            <span className="text-xs px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-300">
              <span className="text-gray-500 mr-1">Type</span>{vehicleIcon(fleetRecord.vehicle_type)} {fleetRecord.vehicle_type}
            </span>
          )}
          {fleetRecord.operator_name && (
            <span className="text-xs px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-300">
              <span className="text-gray-500 mr-1">Operator</span>{fleetRecord.operator_name}
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-600">
          No fleet record —{' '}
          <a href="/fleet-master" className="text-blue-500 hover:text-blue-400 underline">
            add in Fleet Master
          </a>
        </p>
      )}

      {/* Tyre Position Overview */}
      {fleetRecord?.vehicle_type && (
        <div className="card">
          <p className="text-sm font-semibold text-gray-300 mb-4">Tyre Position Overview</p>
          <div className="flex flex-wrap gap-8 items-start">
            <VehicleTyreDiagram
              positions={tyrePositions}
              vehicleType={fleetRecord.vehicle_type}
            />
            <div className="flex-1 min-w-48">
              <p className="text-xs text-gray-500 mb-3">Risk level by position</p>
              <div className="flex flex-wrap gap-3">
                {[
                  { label: 'Low',     color: '#16a34a' },
                  { label: 'Medium',  color: '#ca8a04' },
                  { label: 'High',    color: '#ea580c' },
                  { label: 'Critical',color: '#dc2626' },
                  { label: 'No data', color: '#374151' },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: item.color, opacity: item.label === 'No data' ? 0.4 : 1 }}
                    />
                    <span className="text-xs text-gray-400">{item.label}</span>
                  </div>
                ))}
              </div>
              {tyrePositions.length > 0 && (
                <div className="mt-4 space-y-1">
                  <p className="text-xs text-gray-500 mb-2">Current tyre data</p>
                  {tyrePositions.filter(p => p.risk_level).map(p => (
                    <div key={p.position} className="flex items-center gap-2 text-xs">
                      <span
                        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: { Low: '#16a34a', Medium: '#ca8a04', High: '#ea580c', Critical: '#dc2626' }[p.risk_level] ?? '#374151' }}
                      />
                      <span className="font-mono text-gray-400 w-16">{p.position}</span>
                      <span className="text-gray-500">{p.brand || '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Red flags alert box */}
      {row.allFlags.length > 0 && (
        <div className="rounded-lg border border-red-700/40 bg-red-950/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
            <p className="text-red-400 font-semibold text-sm">Red Flags Detected</p>
          </div>
          <div className="space-y-2">
            {row.allFlags.map((flag, i) => {
              const meta = getFlagMeta(flag.type)
              return (
                <div key={i} className={`rounded p-2.5 border text-xs ${meta.bg}`}>
                  <span className={`font-semibold ${meta.color}`}>[{meta.label}]</span>
                  <span className="text-gray-300 ml-2">{flag.message}</span>
                  {flag.detail && <p className="text-gray-500 mt-0.5 text-[11px]">{flag.detail}</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-800 gap-1 flex-wrap">
        {DETAIL_TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === i
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {t === 'Forecast' && <TrendingUp size={13} />}
            {t}
            {t === 'Red Flags' && row.allFlags.length > 0 && (
              <span className="ml-1.5 text-xs bg-red-600 text-white rounded-full px-1.5 py-0.5 font-bold">
                {row.allFlags.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Timeline */}
      {activeTab === 0 && (
        <TimelineTab
          records={timelineRecords}
          flaggedIds={flaggedIds}
          currency={currency}
          defaultCost={defaultCost}
        />
      )}

      {/* Tab: Analysis */}
      {activeTab === 1 && (
        <AnalysisTab
          monthlyBuckets={monthlyBuckets}
          categoryBreakdown={categoryBreakdown}
          brandBreakdown={brandBreakdown}
          totalCost={totalCost}
          avgCostTyre={avgCostTyre}
          highRiskPct={highRiskPct}
          avgKm={avgKm}
          currency={currency}
        />
      )}

      {/* Tab: Red Flags */}
      {activeTab === 2 && (
        <RedFlagsTab flags={row.allFlags} />
      )}

      {/* Tab: Related Records */}
      {activeTab === 3 && (
        <RelatedTab
          assetNo={row.assetNo}
          actions={relatedActions}
          rca={relatedRca}
          inspections={relatedInspections}
        />
      )}

      {/* Tab: Forecast */}
      {activeTab === 4 && (
        <ForecastTab
          row={row}
          tyrePositions={tyrePositions}
          currency={currency}
          defaultCost={defaultCost}
          fleetRecord={fleetRecord}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Timeline
// ─────────────────────────────────────────────────────────────────────────────

function TimelineTab({ records, flaggedIds, currency, defaultCost }) {
  if (records.length === 0) {
    return <p className="text-gray-500 text-sm py-4 text-center">No records available.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-400 border-b border-gray-800 text-left">
            <th className="pb-2 pr-3">Date</th>
            <th className="pb-2 pr-3">Brand</th>
            <th className="pb-2 pr-3">Description</th>
            <th className="pb-2 pr-3">Category</th>
            <th className="pb-2 pr-3">Risk</th>
            <th className="pb-2 pr-3 text-right">Cost</th>
            <th className="pb-2 pr-3">KM</th>
            <th className="pb-2 pr-3 text-right">Qty</th>
            <th className="pb-2 pr-3">Site</th>
            <th className="pb-2">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {records.map(r => {
            const isFlagged = flaggedIds.has(r.id)
            const kmRun = (r.km_at_fitment != null && r.km_at_removal != null)
              ? `${(+r.km_at_removal - +r.km_at_fitment).toLocaleString()} km`
              : '—'
            return (
              <tr
                key={r.id}
                className={`border-b border-gray-800/30 hover:bg-gray-800/20 ${
                  isFlagged ? 'bg-red-950/10' : ''
                }`}
                style={isFlagged ? { borderLeft: '2px solid rgba(239,68,68,0.6)' } : {}}
              >
                <td className="py-1.5 pr-3 text-gray-400 whitespace-nowrap">
                  {isFlagged && <AlertTriangle size={10} className="inline text-red-400 mr-1" />}
                  {r.issue_date || '—'}
                </td>
                <td className="py-1.5 pr-3 text-gray-300">{r.brand || '—'}</td>
                <td className="py-1.5 pr-3 text-gray-400 max-w-[120px] truncate">{r.description || '—'}</td>
                <td className="py-1.5 pr-3">
                  {r.category
                    ? <span className="px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 text-[10px]">{r.category}</span>
                    : <span className="text-gray-600">—</span>
                  }
                </td>
                <td className="py-1.5 pr-3">
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${riskBadgeClass(r.risk_level)}`}>
                    {r.risk_level || '?'}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-gray-300 text-right whitespace-nowrap">
                  {currency} {((r.cost_per_tyre || defaultCost) * (r.qty || 1)).toLocaleString()}
                </td>
                <td className="py-1.5 pr-3 text-gray-500 whitespace-nowrap">{kmRun}</td>
                <td className="py-1.5 pr-3 text-gray-400 text-right">{r.qty || 1}</td>
                <td className="py-1.5 pr-3 text-gray-400 whitespace-nowrap">{r.site || '—'}</td>
                <td className="py-1.5 text-gray-500 max-w-[160px] truncate">{r.remarks_cleaned || r.remarks || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Analysis
// ─────────────────────────────────────────────────────────────────────────────

function AnalysisTab({ monthlyBuckets, categoryBreakdown, brandBreakdown, totalCost, avgCostTyre, highRiskPct, avgKm, currency }) {
  const costByMonth = {
    labels: monthlyBuckets.map(b => b.month),
    datasets: [{
      label: `Cost (${currency})`,
      data: monthlyBuckets.map(b => Math.round(b.total)),
      backgroundColor: 'rgba(59,130,246,0.6)',
      borderRadius: 4,
    }],
  }

  const catData = {
    labels: categoryBreakdown.slice(0, 8).map(c => c.key),
    datasets: [{
      data: categoryBreakdown.slice(0, 8).map(c => c.count),
      backgroundColor: CHART_COLORS,
    }],
  }

  const brandData = {
    labels: brandBreakdown.slice(0, 8).map(b => b.key),
    datasets: [{
      label: 'Usage Count',
      data: brandBreakdown.slice(0, 8).map(b => b.count),
      backgroundColor: 'rgba(16,185,129,0.6)',
      borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Cost',      value: `${currency} ${Math.round(totalCost).toLocaleString()}`,    color: 'text-blue-400' },
          { label: 'Avg Cost/Tyre',   value: `${currency} ${Math.round(avgCostTyre).toLocaleString()}`,  color: 'text-green-400' },
          { label: 'High Risk %',     value: `${highRiskPct.toFixed(1)}%`,                               color: highRiskPct > 30 ? 'text-red-400' : 'text-yellow-400' },
          { label: avgKm !== null ? 'Avg KM/Tyre' : 'KM Data', value: avgKm !== null ? `${avgKm.toLocaleString()} km` : 'N/A', color: 'text-purple-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg p-4 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            <p className="text-gray-500 text-xs mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-gray-400 mb-2">Cost by Month ({currency})</p>
          {monthlyBuckets.length > 0 ? (
            <div style={{ height: 200 }}>
              <Bar data={costByMonth} options={BAR_OPTS} />
            </div>
          ) : (
            <p className="text-gray-600 text-xs text-center py-10">No monthly data</p>
          )}
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-2">Failure Category Breakdown</p>
          {categoryBreakdown.length > 0 ? (
            <div style={{ height: 200 }}>
              <Doughnut data={catData} options={DOUGHNUT_OPTS} />
            </div>
          ) : (
            <p className="text-gray-600 text-xs text-center py-10">No category data</p>
          )}
        </div>
      </div>

      {/* Brand chart */}
      <div>
        <p className="text-xs text-gray-400 mb-2">Brand Usage Frequency</p>
        {brandBreakdown.length > 0 ? (
          <div style={{ height: 180 }}>
            <Bar data={brandData} options={BAR_OPTS} />
          </div>
        ) : (
          <p className="text-gray-600 text-xs text-center py-10">No brand data</p>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Red Flags
// ─────────────────────────────────────────────────────────────────────────────

const FLAG_RECOMMENDATIONS = {
  SERIAL_REUSE:    'Investigate tyre movement records. Verify physical tyre identity across assets. May indicate theft or data fraud.',
  DUPLICATE_ENTRY: 'Review data entry procedures. Remove duplicate record and confirm which entry is accurate.',
  SHORT_INTERVAL:  'Review driver behaviour and road conditions. Early failure may indicate misuse, overloading, or improper fitment.',
  SAME_DAY_BURST:  'Verify incident report. Bulk same-day replacements may indicate genuine emergency or fraudulent batch entry.',
  RAPID_RECURRENCE:'Investigate asset operating conditions. Recurrent high-risk failures suggest systematic misuse or equipment issue.',
  COST_SPIKE:      'Verify invoice. Compare against supplier rate card. May indicate billing error or procurement issue.',
  LOW_KM_USAGE:    'Physical inspection recommended. Extremely low mileage before removal is a strong indicator of tyre theft.',
  INCONSISTENT_KM: 'Audit odometer readings. Non-sequential km may indicate tampering, odometer rollback, or data entry error.',
  BUDGET_BREACH:   'Review monthly spend against approved budget. Escalate to procurement if systematic. Update budget in Fleet Master if policy has changed.',
  LOW_KM_VS_POLICY:'Tyre was removed well below the expected km threshold in Fleet Master. Investigate for premature failure, misuse, or incorrect odometer data.',
}

function RedFlagsTab({ flags }) {
  if (flags.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="inline-flex items-center gap-2 text-green-400 bg-green-900/20 border border-green-700/30 rounded-full px-4 py-2 text-sm">
          No red flags detected for this vehicle.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {flags.map((flag, i) => {
        const meta     = getFlagMeta(flag.type)
        const rec      = FLAG_RECOMMENDATIONS[flag.type] || 'Review this record carefully.'
        const sevLabel = flag.severity === 'high' ? 'HIGH' : flag.severity === 'medium' ? 'MEDIUM' : 'LOW'
        const sevClass = flag.severity === 'high'
          ? 'bg-red-900/40 text-red-400 border-red-700/50'
          : flag.severity === 'medium'
          ? 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50'
          : 'bg-green-900/40 text-green-400 border-green-700/50'

        return (
          <div key={i} className={`rounded-lg border p-4 space-y-2 ${meta.bg}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${sevClass}`}>{sevLabel}</span>
              <span className={`font-semibold text-sm ${meta.color}`}>{meta.label}</span>
            </div>
            <p className="text-gray-300 text-sm">{flag.message}</p>
            {flag.detail && <p className="text-gray-500 text-xs">{flag.detail}</p>}
            {flag.records && flag.records.length > 0 && (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-[10px] text-gray-600">Affected records:</span>
                {flag.records.slice(0, 5).map(r => (
                  <span key={r.id} className="text-[10px] font-mono text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                    {r.issue_date || r.id?.slice(0, 8)}
                  </span>
                ))}
              </div>
            )}
            <div className="pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-xs text-gray-400">
                <span className="text-gray-600 font-medium">Recommendation: </span>{rec}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Related Records
// ─────────────────────────────────────────────────────────────────────────────

function RelatedTab({ assetNo, actions, rca, inspections }) {
  const hasAny = actions.length > 0 || rca.length > 0 || inspections.length > 0

  if (!hasAny) {
    return (
      <div className="text-center py-10 text-gray-500 text-sm">
        No related corrective actions, RCA, or inspection records found for{' '}
        <span className="font-mono text-gray-400">{assetNo}</span>.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Corrective Actions */}
      {actions.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-300 mb-3">Corrective Actions ({actions.length})</p>
          <div className="space-y-2">
            {actions.map(a => (
              <div key={a.id} className="flex items-center gap-3 bg-gray-800/30 rounded-lg px-4 py-2.5 text-sm flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  a.status === 'Closed'
                    ? 'bg-green-900/30 text-green-400 border-green-700/40'
                    : 'bg-yellow-900/30 text-yellow-400 border-yellow-700/40'
                }`}>{a.status || '—'}</span>
                <span className="text-gray-300 flex-1">{a.title || '(no title)'}</span>
                {a.site && <span className="text-gray-500 text-xs">{a.site}</span>}
                {a.priority && (
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${riskBadgeClass(a.priority)}`}>
                    {a.priority}
                  </span>
                )}
                {a.due_date && <span className="text-gray-600 text-xs">{a.due_date}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RCA Records */}
      {rca.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-300 mb-3">Root Cause Analysis ({rca.length})</p>
          <div className="space-y-2">
            {rca.map(r => (
              <div key={r.id} className="flex items-center gap-3 bg-gray-800/30 rounded-lg px-4 py-2.5 text-sm flex-wrap">
                <span className="font-mono text-xs text-blue-400">{r.tyre_serial || '—'}</span>
                <span className="text-gray-300 flex-1">{r.root_cause || '(no root cause logged)'}</span>
                {r.brand && <span className="text-gray-500 text-xs">{r.brand}</span>}
                {r.site  && <span className="text-gray-500 text-xs">{r.site}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inspections */}
      {inspections.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-300 mb-3">Inspections ({inspections.length})</p>
          <div className="space-y-2">
            {inspections.map(r => (
              <div key={r.id} className="flex items-center gap-3 bg-gray-800/30 rounded-lg px-4 py-2.5 text-sm flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  r.status === 'Completed'
                    ? 'bg-green-900/30 text-green-400 border-green-700/40'
                    : 'bg-blue-900/30 text-blue-400 border-blue-700/40'
                }`}>{r.status || '—'}</span>
                <span className="text-gray-300 flex-1 font-mono text-xs">{r.id?.slice(0, 12)}…</span>
                {r.site && <span className="text-gray-500 text-xs">{r.site}</span>}
                <span className="text-gray-600 text-xs">{r.created_at?.slice(0, 10) || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Forecast
// ─────────────────────────────────────────────────────────────────────────────

function computeHealthScore(position) {
  let score = 100

  // Risk level deduction
  const riskDeductions = { Critical: -40, High: -25, Medium: -10, Low: 0 }
  score += riskDeductions[position.risk_level] ?? 0

  // Age deduction: each 30 days past 180 days = -5, capped at -30
  if (position.issue_date) {
    const daysSince = Math.floor((Date.now() - new Date(position.issue_date).getTime()) / (1000 * 60 * 60 * 24))
    if (daysSince > 180) {
      const periodsOver = Math.floor((daysSince - 180) / 30)
      score += Math.max(-30, periodsOver * -5)
    }
  }

  return Math.max(0, Math.min(100, score))
}

function healthScoreColor(score) {
  if (score <= 25) return { bar: 'bg-red-500', text: 'text-red-400', border: 'border-red-700/50', bg: 'bg-red-900/20' }
  if (score <= 50) return { bar: 'bg-orange-500', text: 'text-orange-400', border: 'border-orange-700/50', bg: 'bg-orange-900/20' }
  if (score <= 75) return { bar: 'bg-yellow-500', text: 'text-yellow-400', border: 'border-yellow-700/50', bg: 'bg-yellow-900/20' }
  return { bar: 'bg-green-500', text: 'text-green-400', border: 'border-green-700/50', bg: 'bg-green-900/20' }
}

function urgencyFromHealth(score) {
  if (score < 25) return { label: 'Urgent', cls: 'bg-red-900/50 text-red-300 border-red-700/50' }
  if (score <= 50) return { label: 'Soon', cls: 'bg-orange-900/50 text-orange-300 border-orange-700/50' }
  return { label: 'Monitor', cls: 'bg-blue-900/40 text-blue-300 border-blue-700/40' }
}

function replacementReason(position, healthScore) {
  if (position.risk_level === 'Critical') return 'Critical risk level — immediate replacement required'
  if (position.risk_level === 'High') return 'High risk level — schedule replacement soon'
  if (healthScore < 25) return 'Health score critically low — tyre nearing end of life'
  if (healthScore <= 50) return 'Declining health — plan replacement within 2 months'
  return 'Monitor condition — no immediate action required'
}

function ForecastTab({ row, tyrePositions, currency, defaultCost, fleetRecord }) {
  // Derive avgKm from records with km data
  const kmValues = row.records
    .map(r => (r.km_at_removal != null && r.km_at_fitment != null)
      ? +r.km_at_removal - +r.km_at_fitment : null)
    .filter(v => v !== null && v > 0)
  const avgKm = kmValues.length
    ? Math.round(kmValues.reduce((s, v) => s + v, 0) / kmValues.length)
    : null

  const spanMonths = row.spanMonths > 0 ? row.spanMonths : null
  const avgMonthlyKm = avgKm !== null && spanMonths ? avgKm / spanMonths : null

  const expectedKmPerTyre = fleetRecord?.expected_km_per_tyre
    ? +fleetRecord.expected_km_per_tyre
    : 60000

  // Per-position health scores
  const positionScores = tyrePositions.map(p => ({
    ...p,
    healthScore: computeHealthScore(p),
  }))

  // Monthly cost average
  const avgMonthlyCost = spanMonths && row.totalCost > 0
    ? Math.round(row.totalCost / spanMonths)
    : null

  const monthlyBudget = fleetRecord?.monthly_tyre_budget
    ? +fleetRecord.monthly_tyre_budget
    : null

  // Top 3 action recommendations
  const actionItems = positionScores
    .map(p => {
      const flagCount = row.allFlags.filter(f =>
        f.records?.some(r => r.position === p.position)
      ).length
      const priorityScore = (100 - p.healthScore) + flagCount * 10
      return { ...p, priorityScore, flagCount }
    })
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 3)

  const hasPositions = positionScores.length > 0

  return (
    <div className="space-y-6">

      {/* ── Section 1: Tyre Health Score ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={15} className="text-blue-400" />
          <p className="text-sm font-semibold text-gray-200">Tyre Health Score by Position</p>
        </div>

        {!hasPositions ? (
          <div className="rounded-lg border border-gray-700/40 bg-gray-800/20 p-6 text-center text-gray-500 text-sm">
            No tyre position data available. Ensure tyre records include position information.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {positionScores.map(p => {
              const colors = healthScoreColor(p.healthScore)
              return (
                <div
                  key={p.position}
                  className={`rounded-lg border p-4 ${colors.border} ${colors.bg}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-mono text-sm font-semibold text-gray-200">{p.position}</span>
                      {p.brand && (
                        <span className="ml-2 text-xs text-gray-500">{p.brand}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {p.risk_level && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${riskBadgeClass(p.risk_level)}`}>
                          {p.risk_level}
                        </span>
                      )}
                      <span className={`text-lg font-bold ${colors.text}`}>{p.healthScore}</span>
                    </div>
                  </div>
                  {/* Health bar */}
                  <div className="h-2 rounded-full bg-gray-700/50 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${colors.bar}`}
                      style={{ width: `${p.healthScore}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-gray-600">0</span>
                    <span className={`text-[10px] font-medium ${colors.text}`}>{p.healthScore}/100</span>
                    <span className="text-[10px] text-gray-600">100</span>
                  </div>
                  {p.issue_date && (
                    <p className="text-[10px] text-gray-600 mt-1.5">Last recorded: {p.issue_date}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Section 2: Replacement Forecast ──────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={15} className="text-purple-400" />
          <p className="text-sm font-semibold text-gray-200">Replacement Forecast by Position</p>
        </div>

        {!hasPositions ? (
          <div className="rounded-lg border border-gray-700/40 bg-gray-800/20 p-6 text-center text-gray-500 text-sm">
            No position data available for replacement forecasting.
          </div>
        ) : (
          <div className="space-y-2">
            {positionScores.map(p => {
              let forecastText = null
              let forecastClass = 'text-gray-400'
              let isDueSoon = false

              if (avgMonthlyKm && avgMonthlyKm > 0 && avgKm !== null) {
                const remaining = expectedKmPerTyre - avgKm
                const monthsRemaining = remaining > 0 ? Math.round(remaining / avgMonthlyKm) : 0
                isDueSoon = monthsRemaining < 2
                forecastText = isDueSoon
                  ? 'Due soon — replacement recommended'
                  : `Est. ${monthsRemaining} month${monthsRemaining !== 1 ? 's' : ''} remaining`
                forecastClass = isDueSoon ? 'text-red-400' : monthsRemaining <= 3 ? 'text-orange-400' : 'text-green-400'
              } else if (row.avgDays) {
                const daysSinceIssue = p.issue_date
                  ? Math.floor((Date.now() - new Date(p.issue_date).getTime()) / (1000 * 60 * 60 * 24))
                  : null
                if (daysSinceIssue !== null) {
                  const daysLeft = row.avgDays - daysSinceIssue
                  const monthsLeft = Math.round(daysLeft / 30)
                  isDueSoon = daysLeft < 60
                  forecastText = isDueSoon
                    ? 'Due soon — based on avg replacement interval'
                    : `Est. ${Math.max(0, monthsLeft)} month${monthsLeft !== 1 ? 's' : ''} remaining (interval-based)`
                  forecastClass = isDueSoon ? 'text-red-400' : monthsLeft <= 2 ? 'text-orange-400' : 'text-blue-400'
                } else {
                  forecastText = 'Insufficient data for forecast'
                  forecastClass = 'text-gray-500'
                }
              } else {
                forecastText = 'No km or interval data — unable to forecast'
                forecastClass = 'text-gray-500'
              }

              return (
                <div
                  key={p.position}
                  className={`flex items-center justify-between rounded-lg px-4 py-3 border ${
                    isDueSoon
                      ? 'bg-red-950/20 border-red-800/40'
                      : 'bg-gray-800/30 border-gray-700/40'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-gray-300 w-20">{p.position}</span>
                    {p.brand && <span className="text-xs text-gray-500">{p.brand}</span>}
                    {/* serial_no disabled — re-enable when ready
                    {p.serial_no && (
                      <span className="text-[10px] font-mono text-gray-600">{p.serial_no}</span>
                    )} */}
                  </div>
                  <span className={`text-xs font-medium ${forecastClass}`}>{forecastText}</span>
                </div>
              )
            })}
            <p className="text-[10px] text-gray-600 mt-2 pl-1">
              Expected km/tyre: {expectedKmPerTyre.toLocaleString()} km
              {fleetRecord?.expected_km_per_tyre ? ' (from Fleet Master)' : ' (default)'}
              {avgMonthlyKm ? ` · Avg monthly km: ${Math.round(avgMonthlyKm).toLocaleString()}` : ''}
            </p>
          </div>
        )}
      </div>

      {/* ── Section 3: Top 3 Action Recommendations ───────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={15} className="text-orange-400" />
          <p className="text-sm font-semibold text-gray-200">Top Action Recommendations</p>
        </div>

        {actionItems.length === 0 ? (
          <div className="rounded-lg border border-green-700/30 bg-green-900/10 p-5 text-center">
            <p className="text-green-400 text-sm">All tyre positions are within acceptable health ranges.</p>
            <p className="text-gray-500 text-xs mt-1">No immediate action required based on available data.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {actionItems.map((p, idx) => {
              const urgency = urgencyFromHealth(p.healthScore)
              const reason = replacementReason(p, p.healthScore)
              return (
                <div
                  key={p.position}
                  className="flex items-start gap-4 rounded-lg border border-gray-700/40 bg-gray-800/30 px-4 py-3"
                >
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-700 text-gray-300 text-xs font-bold flex items-center justify-center mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium text-gray-200">
                        {p.position}{p.brand ? ` · ${p.brand}` : ''}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${urgency.cls}`}>
                        {urgency.label}
                      </span>
                      <span className={`text-[10px] font-medium ${healthScoreColor(p.healthScore).text}`}>
                        Health: {p.healthScore}/100
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">{reason}</p>
                    {p.flagCount > 0 && (
                      <p className="text-[10px] text-orange-400 mt-0.5">{p.flagCount} associated red flag{p.flagCount !== 1 ? 's' : ''}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Section 4: 3-Month Cost Projection ───────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={15} className="text-green-400" />
          <p className="text-sm font-semibold text-gray-200">3-Month Cost Projection</p>
        </div>

        {avgMonthlyCost === null ? (
          <div className="rounded-lg border border-gray-700/40 bg-gray-800/20 p-6 text-center text-gray-500 text-sm">
            Insufficient historical data to project costs. At least one month of spend history required.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 mb-3">
              {[1, 2, 3].map(offset => {
                const projectedDate = new Date()
                projectedDate.setMonth(projectedDate.getMonth() + offset)
                const monthLabel = projectedDate.toLocaleString('default', { month: 'short', year: 'numeric' })
                const isOverBudget = monthlyBudget !== null && avgMonthlyCost > monthlyBudget
                return (
                  <div
                    key={offset}
                    className={`rounded-lg border p-4 text-center ${
                      isOverBudget
                        ? 'bg-red-950/20 border-red-800/40'
                        : 'bg-gray-800/30 border-gray-700/40'
                    }`}
                  >
                    <p className="text-xs text-gray-500 mb-1">{monthLabel}</p>
                    <p className={`text-lg font-bold ${isOverBudget ? 'text-red-400' : 'text-green-400'}`}>
                      {currency} {avgMonthlyCost.toLocaleString()}
                    </p>
                    {monthlyBudget !== null && (
                      <p className={`text-[10px] mt-1 font-medium ${isOverBudget ? 'text-red-500' : 'text-green-500'}`}>
                        {isOverBudget
                          ? `Over budget by ${(avgMonthlyCost - monthlyBudget).toLocaleString()}`
                          : `Within budget`
                        }
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="rounded-lg border border-gray-700/30 bg-gray-800/20 px-4 py-3">
              <p className="text-xs text-gray-400">
                Based on historical average of{' '}
                <span className="text-white font-semibold">{currency} {avgMonthlyCost.toLocaleString()}</span>
                {' '}per month over {Math.round(spanMonths)} month{Math.round(spanMonths) !== 1 ? 's' : ''}.
                {monthlyBudget !== null && (
                  <span className="ml-1">
                    Fleet Master budget:{' '}
                    <span className={`font-semibold ${avgMonthlyCost > monthlyBudget ? 'text-red-400' : 'text-green-400'}`}>
                      {currency} {monthlyBudget.toLocaleString()}
                    </span>
                    /month.
                  </span>
                )}
              </p>
            </div>
          </>
        )}
      </div>

    </div>
  )
}
