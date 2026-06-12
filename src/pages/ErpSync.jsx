import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  RefreshCw, Database, Link, Link2Off, CheckCircle, XCircle,
  AlertTriangle, Download, Settings, Clock, Activity, ArrowRight,
  Shield, Zap, Filter, ChevronDown, ChevronRight, Eye, EyeOff,
  Calendar, BarChart2, TrendingUp, Info,
} from 'lucide-react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import * as XLSX from 'xlsx'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(ArcElement, Tooltip, Legend)

// ── Static config data ────────────────────────────────────────────────────────

const ERP_SYSTEMS = [
  {
    id: 'sap',
    name: 'SAP S/4HANA',
    logo: 'SAP',
    status: 'Connected',
    lastSync: '2026-06-08T04:15:00Z',
    recordsSynced: 142_830,
    frequency: 'Every 4 hours',
    frequencyCron: '0 */4 * * *',
    health: 'green',
    endpoint: 'https://sap-prod.corp.internal/api/v2/odata/',
    authMethod: 'OAuth 2.0 (Client Credentials)',
    apiVersion: 'OData v4',
    color: '#0078d4',
  },
  {
    id: 'oracle',
    name: 'Oracle Fusion ERP',
    logo: 'ORC',
    status: 'Connected',
    lastSync: '2026-06-08T03:50:00Z',
    recordsSynced: 87_442,
    frequency: 'Every 6 hours',
    frequencyCron: '0 */6 * * *',
    health: 'yellow',
    endpoint: 'https://oracle-erp.corp.internal/fscmRestApi/resources/11.13/',
    authMethod: 'Basic Auth (TLS 1.3)',
    apiVersion: 'REST v11.13',
    color: '#f80000',
  },
  {
    id: 'dynamics',
    name: 'Microsoft Dynamics 365',
    logo: 'D365',
    status: 'Pending',
    lastSync: '2026-06-07T22:00:00Z',
    recordsSynced: 31_200,
    frequency: 'Every 12 hours',
    frequencyCron: '0 */12 * * *',
    health: 'yellow',
    endpoint: 'https://org12abc34.crm.dynamics.com/api/data/v9.2/',
    authMethod: 'Azure AD (MSAL)',
    apiVersion: 'OData v4 (Dynamics)',
    color: '#00a4ef',
  },
  {
    id: 'custom',
    name: 'Custom REST API',
    logo: 'API',
    status: 'Disconnected',
    lastSync: '2026-06-06T10:30:00Z',
    recordsSynced: 12_890,
    frequency: 'Daily at 01:00',
    frequencyCron: '0 1 * * *',
    health: 'red',
    endpoint: 'https://fleet-erp.internal/api/v1/',
    authMethod: 'API Key (Header)',
    apiVersion: 'REST v1',
    color: '#8b5cf6',
  },
]

const FIELD_MAPPINGS = [
  { erpField: 'ASSET_NO',         tpField: 'asset_number',          dataType: 'VARCHAR(50)',  transform: 'UPPER(TRIM(value))',                 status: 'Active' },
  { erpField: 'TYRE_SERIAL',      tpField: 'serial_number',         dataType: 'VARCHAR(30)',  transform: 'TRIM(value)',                        status: 'Active' },
  { erpField: 'KM_READING',       tpField: 'km_at_fitment',         dataType: 'DECIMAL(10,2)',transform: 'CAST(value AS DECIMAL)',              status: 'Active' },
  { erpField: 'TYRE_BRAND',       tpField: 'brand',                 dataType: 'VARCHAR(80)',  transform: 'PROPER_CASE(TRIM(value))',            status: 'Active' },
  { erpField: 'TYRE_SIZE',        tpField: 'tyre_size',             dataType: 'VARCHAR(30)',  transform: 'UPPER(REPLACE(value," ",""))',        status: 'Active' },
  { erpField: 'AXLE_POSITION',    tpField: 'position',              dataType: 'VARCHAR(10)',  transform: 'MAP_POSITION(value)',                 status: 'Active' },
  { erpField: 'SITE_CODE',        tpField: 'site',                  dataType: 'VARCHAR(50)',  transform: 'LOOKUP_SITE_NAME(value)',             status: 'Active' },
  { erpField: 'COUNTRY_CODE',     tpField: 'country',               dataType: 'CHAR(2)',      transform: 'ISO_COUNTRY(value)',                  status: 'Active' },
  { erpField: 'TREAD_DEPTH_MM',   tpField: 'tread_depth',           dataType: 'DECIMAL(4,1)', transform: 'CAST(value AS DECIMAL)',              status: 'Active' },
  { erpField: 'PRESSURE_KPA',     tpField: 'pressure',              dataType: 'DECIMAL(6,1)', transform: 'KPA_TO_PSI(value)',                   status: 'Active' },
  { erpField: 'FIT_DATE',         tpField: 'date_fitted',           dataType: 'DATE',         transform: 'TO_DATE(value,"YYYYMMDD")',           status: 'Active' },
  { erpField: 'REM_DATE',         tpField: 'date_removed',          dataType: 'DATE',         transform: 'TO_DATE(value,"YYYYMMDD")',           status: 'Active' },
  { erpField: 'REMOVAL_REASON',   tpField: 'reason_for_removal',    dataType: 'VARCHAR(200)', transform: 'MAP_REMOVAL_CODE(value)',             status: 'Active' },
  { erpField: 'VEHTYPE_CODE',     tpField: 'vehicle_type',          dataType: 'VARCHAR(30)',  transform: 'LOOKUP_VEHICLE_TYPE(value)',          status: 'Active' },
  { erpField: 'FLEET_NO',         tpField: 'fleet_number',          dataType: 'VARCHAR(20)',  transform: 'TRIM(value)',                         status: 'Active' },
  { erpField: 'COST_CENTRE',      tpField: 'cost_center',           dataType: 'VARCHAR(20)',  transform: 'TRIM(value)',                         status: 'Active' },
  { erpField: 'PURCHASE_COST',    tpField: 'purchase_price',        dataType: 'DECIMAL(10,2)',transform: 'CURRENCY_NORMALIZE(value,"USD")',      status: 'Active' },
  { erpField: 'SUPPLIER_CODE',    tpField: 'supplier',              dataType: 'VARCHAR(80)',  transform: 'LOOKUP_SUPPLIER_NAME(value)',         status: 'Active' },
  { erpField: 'INSP_DATE',        tpField: 'inspection_date',       dataType: 'TIMESTAMP',    transform: 'TO_TIMESTAMP(value,"YYYYMMDD HH24MI")',status: 'Active' },
  { erpField: 'INSPECTOR_ID',     tpField: 'inspector',             dataType: 'VARCHAR(50)',  transform: 'LOOKUP_USER_NAME(value)',             status: 'Active' },
  { erpField: 'RETREAD_FLAG',     tpField: 'is_retread',            dataType: 'BOOLEAN',      transform: 'CAST(value="Y" AS BOOLEAN)',          status: 'Active' },
  { erpField: 'RETREAD_BRAND',    tpField: 'retread_brand',         dataType: 'VARCHAR(80)',  transform: 'PROPER_CASE(TRIM(value))',            status: 'Active' },
  { erpField: 'LOAD_INDEX',       tpField: 'load_rating',           dataType: 'SMALLINT',     transform: 'CAST(value AS SMALLINT)',             status: 'Inactive' },
  { erpField: 'SPEED_RATING',     tpField: 'speed_rating',          dataType: 'CHAR(2)',      transform: 'UPPER(TRIM(value))',                  status: 'Inactive' },
  { erpField: 'WORK_ORDER_NO',    tpField: 'work_order',            dataType: 'VARCHAR(30)',  transform: 'TRIM(value)',                         status: 'Active' },
]

const VALIDATION_FAILURES = [
  { field: 'PRESSURE_KPA',   issue: 'Value outside valid range (0–1200 kPa)',     count: 214,  severity: 'Error'   },
  { field: 'KM_READING',     issue: 'Odometer rollback detected',                 count: 87,   severity: 'Error'   },
  { field: 'TYRE_SERIAL',    issue: 'Duplicate serial in same sync batch',        count: 43,   severity: 'Error'   },
  { field: 'FIT_DATE',       issue: 'Date precedes vehicle manufacture year',     count: 19,   severity: 'Error'   },
  { field: 'TREAD_DEPTH_MM', issue: 'Tread depth exceeds new tyre specification', count: 156,  severity: 'Warning' },
  { field: 'ASSET_NO',       issue: 'Asset not found in Fleet Master',            count: 72,   severity: 'Warning' },
  { field: 'SUPPLIER_CODE',  issue: 'Unknown supplier code — lookup failed',      count: 38,   severity: 'Warning' },
  { field: 'SITE_CODE',      issue: 'Site code not mapped to TyrePulse site',     count: 25,   severity: 'Warning' },
  { field: 'COST_CENTRE',    issue: 'Cost centre not present in chart of accounts',count: 11,  severity: 'Warning' },
  { field: 'INSP_DATE',      issue: 'Inspection timestamp in future',             count: 6,    severity: 'Warning' },
]

function generateSyncHistory() {
  const statuses = ['Success', 'Success', 'Success', 'Partial', 'Success', 'Success', 'Failed', 'Success', 'Partial', 'Success', 'Success', 'Success', 'Success', 'Partial', 'Success']
  const triggers = ['Scheduled', 'Scheduled', 'Manual', 'Scheduled', 'Scheduled', 'Scheduled', 'Scheduled', 'Manual', 'Scheduled', 'Scheduled', 'Scheduled', 'Scheduled', 'Manual', 'Scheduled', 'Scheduled']
  const erpSources = ['SAP S/4HANA', 'Oracle Fusion', 'SAP S/4HANA', 'Microsoft Dynamics', 'SAP S/4HANA', 'Oracle Fusion', 'Custom REST API', 'SAP S/4HANA', 'Oracle Fusion', 'SAP S/4HANA', 'SAP S/4HANA', 'Oracle Fusion', 'SAP S/4HANA', 'Microsoft Dynamics', 'SAP S/4HANA']
  const now = new Date('2026-06-08T04:30:00Z')
  return statuses.map((status, i) => {
    const startedAt = new Date(now.getTime() - (i * 4.2 + 0.5) * 3600_000)
    const durationSec = status === 'Failed' ? 12 + Math.floor(Math.random() * 30) : 45 + Math.floor(Math.random() * 180)
    const completedAt = new Date(startedAt.getTime() + durationSec * 1000)
    const processed = status === 'Failed' ? 0 : 1200 + Math.floor(Math.random() * 4800)
    const failed = status === 'Success' ? Math.floor(Math.random() * 15) : status === 'Partial' ? 150 + Math.floor(Math.random() * 300) : processed
    const updated = status === 'Failed' ? 0 : processed - failed - Math.floor(Math.random() * 80)
    return {
      syncId: `SYNC-${String(100 + i).padStart(4, '0')}`,
      startedAt,
      completedAt,
      durationSec,
      processed,
      updated: Math.max(0, updated),
      failed,
      status,
      triggeredBy: triggers[i],
      source: erpSources[i],
    }
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(secs) {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

function formatTs(date) {
  return date.toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatRelative(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function StatusDot({ health }) {
  const colors = { green: '#22c55e', yellow: '#f59e0b', red: '#ef4444' }
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
      style={{ backgroundColor: colors[health] ?? '#6b7280', boxShadow: `0 0 6px ${colors[health] ?? '#6b7280'}88` }}
    />
  )
}

function StatusBadge({ status }) {
  const styles = {
    Connected:    'bg-green-900/40 text-green-300 border border-green-700/40',
    Disconnected: 'bg-red-900/40 text-red-300 border border-red-700/40',
    Pending:      'bg-yellow-900/40 text-yellow-300 border border-yellow-700/40',
    Success:      'bg-green-900/40 text-green-300 border border-green-700/40',
    Failed:       'bg-red-900/40 text-red-300 border border-red-700/40',
    Partial:      'bg-yellow-900/40 text-yellow-300 border border-yellow-700/40',
    Active:       'bg-green-900/30 text-green-400 border border-green-700/30',
    Inactive:     'bg-gray-800/60 text-gray-500 border border-gray-700/40',
  }
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${styles[status] ?? styles.Inactive}`}>
      {status}
    </span>
  )
}

function SeverityBadge({ severity }) {
  const styles = {
    Error:   'bg-red-900/40 text-red-300 border border-red-700/40',
    Warning: 'bg-yellow-900/40 text-yellow-300 border border-yellow-700/40',
    Info:    'bg-blue-900/40 text-blue-300 border border-blue-700/40',
  }
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${styles[severity] ?? styles.Info}`}>
      {severity}
    </span>
  )
}

function StatCard({ icon: Icon, label, value, sub, color = '#22c55e' }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1" style={{ background: 'rgba(17,24,39,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
          <Icon size={15} style={{ color }} />
        </div>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-600">{sub}</p>}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ErpSync() {
  const [loading, setLoading]               = useState(true)
  const [erpFilter, setErpFilter]           = useState('All')
  const [dateRange, setDateRange]           = useState('24h')
  const [expandedErp, setExpandedErp]       = useState(null)
  const [showEndpoints, setShowEndpoints]   = useState({})
  const [mappingSearch, setMappingSearch]   = useState('')
  const [mappingStatus, setMappingStatus]   = useState('All')
  const [historyPage, setHistoryPage]       = useState(0)
  const HISTORY_PAGE_SIZE = 8

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 600)
    return () => clearTimeout(t)
  }, [])

  const syncHistory = useMemo(() => generateSyncHistory(), [])

  const stats = useMemo(() => {
    const totalRecords = ERP_SYSTEMS.reduce((s, e) => s + e.recordsSynced, 0)
    const successRuns  = syncHistory.filter(r => r.status === 'Success').length
    const successRate  = ((successRuns / syncHistory.length) * 100).toFixed(1)
    const avgDuration  = Math.round(syncHistory.filter(r => r.status !== 'Failed').reduce((s, r) => s + r.durationSec, 0) / syncHistory.filter(r => r.status !== 'Failed').length)
    const lastSync     = ERP_SYSTEMS.reduce((latest, e) => {
      const d = new Date(e.lastSync)
      return d > latest ? d : latest
    }, new Date(0))
    return { totalRecords, successRate, avgDuration, lastSync }
  }, [syncHistory])

  const validationChart = useMemo(() => ({
    valid:   112_480,
    warning: 308,
    error:   363,
  }), [])

  const doughnutData = useMemo(() => ({
    labels: ['Valid', 'Warning', 'Error'],
    datasets: [{
      data: [validationChart.valid, validationChart.warning, validationChart.error],
      backgroundColor: ['rgba(34,197,94,0.8)', 'rgba(245,158,11,0.8)', 'rgba(239,68,68,0.8)'],
      borderColor:     ['rgba(34,197,94,1)',    'rgba(245,158,11,1)',    'rgba(239,68,68,1)'],
      borderWidth: 1,
      hoverOffset: 6,
    }],
  }), [validationChart])

  const doughnutOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '72%',
    plugins: {
      legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 11 }, padding: 14, boxWidth: 12 } },
      tooltip: {
        backgroundColor: '#111827',
        titleColor: '#f9fafb',
        bodyColor: '#d1d5db',
        borderColor: '#374151',
        borderWidth: 1,
        callbacks: {
          label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString()} records`,
        },
      },
    },
  }), [])

  const filteredMappings = useMemo(() => FIELD_MAPPINGS.filter(m => {
    const matchSearch = !mappingSearch || m.erpField.toLowerCase().includes(mappingSearch.toLowerCase()) || m.tpField.toLowerCase().includes(mappingSearch.toLowerCase())
    const matchStatus = mappingStatus === 'All' || m.status === mappingStatus
    return matchSearch && matchStatus
  }), [mappingSearch, mappingStatus])

  const filteredHistory = useMemo(() => {
    let h = syncHistory
    if (erpFilter !== 'All') h = h.filter(r => r.source.includes(erpFilter))
    const hoursMap = { '4h': 4, '24h': 24, '7d': 168, '30d': 720 }
    const cutoff = new Date(Date.now() - (hoursMap[dateRange] ?? 24) * 3_600_000)
    return h.filter(r => r.startedAt >= cutoff)
  }, [syncHistory, erpFilter, dateRange])

  const pagedHistory = useMemo(() => {
    const start = historyPage * HISTORY_PAGE_SIZE
    return filteredHistory.slice(start, start + HISTORY_PAGE_SIZE)
  }, [filteredHistory, historyPage])

  const totalPages = Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE)

  const handleDownloadLog = useCallback(() => {
    const rows = syncHistory.map(r => ({
      'Sync ID':            r.syncId,
      'ERP Source':         r.source,
      'Started At':         formatTs(r.startedAt),
      'Completed At':       formatTs(r.completedAt),
      'Duration':           formatDuration(r.durationSec),
      'Records Processed':  r.processed,
      'Records Updated':    r.updated,
      'Records Failed':     r.failed,
      'Status':             r.status,
      'Triggered By':       r.triggeredBy,
    }))
    const ws  = XLSX.utils.json_to_sheet(rows)
    const wb  = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sync History')
    XLSX.writeFile(wb, `erp-sync-log-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }, [syncHistory])

  function toggleEndpoint(id) {
    setShowEndpoints(prev => ({ ...prev, [id]: !prev[id] }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw size={24} className="text-green-500 animate-spin" />
          <p className="text-gray-500 text-sm">Loading ERP sync data…</p>
        </div>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-6"
    >
      {/* ── Page Header ────────────────────────────────────────────────────────── */}
      <PageHeader
        title="ERP Sync Hub"
        subtitle="Monitor ERP data pipelines, field mappings, and sync health in real time."
        icon={Database}
        badge="Read-Only"
        actions={<>
          <div className="flex items-center gap-1.5 bg-gray-900/60 border border-gray-800 rounded-lg px-2.5 py-1.5">
            <Filter size={12} className="text-gray-500" />
            <select
              value={erpFilter}
              onChange={e => { setErpFilter(e.target.value); setHistoryPage(0) }}
              className="bg-transparent text-xs text-gray-300 focus:outline-none cursor-pointer"
            >
              <option value="All">All ERPs</option>
              <option value="SAP">SAP</option>
              <option value="Oracle">Oracle</option>
              <option value="Dynamics">Dynamics</option>
              <option value="Custom">Custom REST</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5 bg-gray-900/60 border border-gray-800 rounded-lg px-2.5 py-1.5">
            <Calendar size={12} className="text-gray-500" />
            <select
              value={dateRange}
              onChange={e => { setDateRange(e.target.value); setHistoryPage(0) }}
              className="bg-transparent text-xs text-gray-300 focus:outline-none cursor-pointer"
            >
              <option value="4h">Last 4 hours</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </div>
          <div className="relative group">
            <button disabled className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-800/60 text-gray-600 border border-gray-700/40 cursor-not-allowed">
              <Zap size={13} /> Trigger Full Sync
            </button>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-300 bg-gray-900 border border-gray-700 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              Requires API access — read-only mode
            </div>
          </div>
          <div className="relative group">
            <button disabled className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-800/60 text-gray-600 border border-gray-700/40 cursor-not-allowed">
              <RefreshCw size={13} /> Trigger Delta Sync
            </button>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-300 bg-gray-900 border border-gray-700 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              Requires API access — read-only mode
            </div>
          </div>
          <button
            onClick={handleDownloadLog}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg,rgba(22,163,74,0.3),rgba(22,163,74,0.15))', border: '1px solid rgba(22,163,74,0.3)' }}
          >
            <Download size={13} /> Download Log
          </button>
        </>}
      />

      {/* ── Sync Statistics ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Database} label="Total Records Synced" value={stats.totalRecords.toLocaleString()} sub="Across all ERP systems" color="#22c55e" />
        <StatCard icon={Clock}    label="Last Sync Duration"   value={formatDuration(stats.avgDuration)} sub="Average across successful runs" color="#3b82f6" />
        <StatCard icon={Activity} label="Sync Success Rate"    value={`${stats.successRate}%`} sub={`${syncHistory.filter(r => r.status === 'Success').length} of ${syncHistory.length} runs`} color="#f59e0b" />
        <StatCard icon={Zap}      label="Data Freshness"       value={formatRelative(stats.lastSync.toISOString())} sub={`Last sync: ${formatTs(stats.lastSync)}`} color="#8b5cf6" />
      </div>

      {/* ── Connection Status Panel ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Link size={14} className="text-green-400" /> Connection Status
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {ERP_SYSTEMS.map((erp, idx) => (
            <motion.div
              key={erp.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.07 }}
              className="rounded-xl p-4 flex flex-col gap-3"
              style={{ background: 'rgba(17,24,39,0.8)', border: `1px solid ${erp.status === 'Connected' ? 'rgba(22,163,74,0.18)' : 'rgba(255,255,255,0.06)'}` }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0" style={{ background: `${erp.color}20`, border: `1px solid ${erp.color}40`, color: erp.color }}>
                    {erp.logo}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-200 leading-tight">{erp.name}</p>
                    <p className="text-[11px] text-gray-600">{erp.apiVersion}</p>
                  </div>
                </div>
                <StatusDot health={erp.health} />
              </div>

              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-gray-600">Status</span>
                  <StatusBadge status={erp.status} />
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Last Sync</span>
                  <span className="text-gray-400">{formatRelative(erp.lastSync)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Records</span>
                  <span className="text-gray-300 font-medium">{erp.recordsSynced.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Frequency</span>
                  <span className="text-gray-400">{erp.frequency}</span>
                </div>
              </div>

              <div className="h-px bg-gray-800" />
              <div className="flex items-center justify-between">
                {erp.status === 'Connected'
                  ? <span className="flex items-center gap-1 text-[11px] text-green-400"><CheckCircle size={11} /> Healthy pipeline</span>
                  : erp.status === 'Pending'
                  ? <span className="flex items-center gap-1 text-[11px] text-yellow-400"><AlertTriangle size={11} /> Sync pending</span>
                  : <span className="flex items-center gap-1 text-[11px] text-red-400"><Link2Off size={11} /> Connection lost</span>
                }
                <span className="text-[11px] text-gray-700 font-mono">{erp.frequencyCron}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Field Mapping Table ─────────────────────────────────────────────────── */}
      <section>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <ArrowRight size={14} className="text-green-400" /> Field Mapping ({filteredMappings.length} of {FIELD_MAPPINGS.length})
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-gray-900/60 border border-gray-800 rounded-lg px-2.5 py-1.5">
              <input
                type="text"
                placeholder="Search fields…"
                value={mappingSearch}
                onChange={e => setMappingSearch(e.target.value)}
                className="bg-transparent text-xs text-gray-300 placeholder-gray-600 focus:outline-none w-40"
              />
            </div>
            <select
              value={mappingStatus}
              onChange={e => setMappingStatus(e.target.value)}
              className="bg-gray-900/60 border border-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none cursor-pointer"
            >
              <option value="All">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'rgba(17,24,39,0.9)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <th className="px-4 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider">ERP Field</th>
                  <th className="px-4 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider">TyrePulse Field</th>
                  <th className="px-4 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider hidden sm:table-cell">Data Type</th>
                  <th className="px-4 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider hidden lg:table-cell">Transform</th>
                  <th className="px-4 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredMappings.map((m, i) => (
                  <tr
                    key={m.erpField}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'rgba(17,24,39,0.6)' : 'rgba(9,11,17,0.6)' }}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-2.5 font-mono text-yellow-300 font-medium">{m.erpField}</td>
                    <td className="px-4 py-2.5 font-mono text-green-400">{m.tpField}</td>
                    <td className="px-4 py-2.5 text-gray-500 hidden sm:table-cell">{m.dataType}</td>
                    <td className="px-4 py-2.5 font-mono text-blue-400 text-[11px] hidden lg:table-cell max-w-xs truncate">{m.transform}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={m.status} /></td>
                  </tr>
                ))}
                {filteredMappings.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-gray-600 text-xs">No field mappings match the current filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Sync History + Data Validation ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Sync History Log */}
        <section className="xl:col-span-2">
          <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Clock size={14} className="text-green-400" /> Sync History Log
            <span className="ml-auto text-[11px] text-gray-600">{filteredHistory.length} entries</span>
          </h2>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: 'rgba(17,24,39,0.9)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th className="px-3 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider">Sync ID</th>
                    <th className="px-3 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider hidden md:table-cell">Source</th>
                    <th className="px-3 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider hidden sm:table-cell">Started</th>
                    <th className="px-3 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider hidden lg:table-cell">Completed</th>
                    <th className="px-3 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider">Dur.</th>
                    <th className="px-3 py-2.5 text-right text-gray-500 font-semibold uppercase tracking-wider hidden sm:table-cell">Proc.</th>
                    <th className="px-3 py-2.5 text-right text-gray-500 font-semibold uppercase tracking-wider hidden md:table-cell">Updated</th>
                    <th className="px-3 py-2.5 text-right text-gray-500 font-semibold uppercase tracking-wider">Failed</th>
                    <th className="px-3 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider hidden lg:table-cell">By</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedHistory.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-gray-600">No sync runs in the selected period.</td>
                    </tr>
                  )}
                  {pagedHistory.map((r, i) => (
                    <tr
                      key={r.syncId}
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'rgba(17,24,39,0.6)' : 'rgba(9,11,17,0.6)' }}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-3 py-2 font-mono text-gray-300 font-medium">{r.syncId}</td>
                      <td className="px-3 py-2 text-gray-500 hidden md:table-cell max-w-[100px] truncate">{r.source}</td>
                      <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">{formatTs(r.startedAt)}</td>
                      <td className="px-3 py-2 text-gray-500 hidden lg:table-cell">{formatTs(r.completedAt)}</td>
                      <td className="px-3 py-2 text-gray-400 font-mono">{formatDuration(r.durationSec)}</td>
                      <td className="px-3 py-2 text-right text-gray-400 hidden sm:table-cell">{r.processed.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-green-500 hidden md:table-cell">{r.updated.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-red-400">{r.failed.toLocaleString()}</td>
                      <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                      <td className="px-3 py-2 text-gray-600 hidden lg:table-cell">{r.triggeredBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(17,24,39,0.9)' }}>
                <span className="text-[11px] text-gray-600">
                  Page {historyPage + 1} of {totalPages} · {filteredHistory.length} entries
                </span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setHistoryPage(p => Math.max(0, p - 1))} disabled={historyPage === 0}
                    className="px-2.5 py-1 rounded text-[11px] bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    Prev
                  </button>
                  <button onClick={() => setHistoryPage(p => Math.min(totalPages - 1, p + 1))} disabled={historyPage >= totalPages - 1}
                    className="px-2.5 py-1 rounded text-[11px] bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Data Validation Results */}
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Shield size={14} className="text-green-400" /> Data Validation
          </h2>
          <div className="rounded-xl p-4 mb-4" style={{ background: 'rgba(17,24,39,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[11px] text-gray-600 mb-3">Last sync validation — {(validationChart.valid + validationChart.warning + validationChart.error).toLocaleString()} total records</p>
            <div style={{ height: 200 }}>
              <Doughnut data={doughnutData} options={doughnutOptions} />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <div className="text-center">
                <p className="text-base font-bold text-green-400">{((validationChart.valid / (validationChart.valid + validationChart.warning + validationChart.error)) * 100).toFixed(1)}%</p>
                <p className="text-[10px] text-gray-600">Valid</p>
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-yellow-400">{validationChart.warning.toLocaleString()}</p>
                <p className="text-[10px] text-gray-600">Warnings</p>
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-red-400">{validationChart.error.toLocaleString()}</p>
                <p className="text-[10px] text-gray-600">Errors</p>
              </div>
            </div>
          </div>

          {/* Validation failure list */}
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="px-3 py-2" style={{ background: 'rgba(17,24,39,0.9)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Validation Failures</p>
            </div>
            <div className="divide-y divide-gray-800/60">
              {VALIDATION_FAILURES.map(f => (
                <div key={f.field} className="px-3 py-2 flex items-start gap-2" style={{ background: 'rgba(9,11,17,0.5)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-mono text-[11px] text-yellow-300 font-medium">{f.field}</span>
                      <SeverityBadge severity={f.severity} />
                    </div>
                    <p className="text-[11px] text-gray-600 leading-tight">{f.issue}</p>
                  </div>
                  <span className={`text-[11px] font-bold flex-shrink-0 ${f.severity === 'Error' ? 'text-red-400' : 'text-yellow-400'}`}>
                    {f.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ── ERP Configuration Panel ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Settings size={14} className="text-green-400" /> ERP Configuration
          <span className="text-[11px] text-gray-600 ml-1 font-normal">(read-only view)</span>
        </h2>
        <div className="space-y-2">
          {ERP_SYSTEMS.map(erp => {
            const open = expandedErp === erp.id
            return (
              <div key={erp.id} className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(17,24,39,0.7)' }}>
                {/* Accordion header */}
                <button
                  onClick={() => setExpandedErp(open ? null : erp.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
                >
                  <div className="w-7 h-7 rounded-md flex items-center justify-center font-bold text-[10px] flex-shrink-0" style={{ background: `${erp.color}20`, border: `1px solid ${erp.color}40`, color: erp.color }}>
                    {erp.logo}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-200">{erp.name}</span>
                      <StatusBadge status={erp.status} />
                      <StatusDot health={erp.health} />
                    </div>
                    <p className="text-[11px] text-gray-600">{erp.authMethod} · {erp.frequency}</p>
                  </div>
                  {open ? <ChevronDown size={14} className="text-gray-600 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-600 flex-shrink-0" />}
                </button>

                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        {/* Connection details */}
                        <div className="pt-4 space-y-3">
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Connection Details</p>
                          <div className="space-y-2 text-xs">
                            <div className="flex items-start gap-2">
                              <span className="text-gray-600 w-28 flex-shrink-0">API Endpoint</span>
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                <span className="font-mono text-gray-400 truncate">
                                  {showEndpoints[erp.id] ? erp.endpoint : erp.endpoint.replace(/\/\/[^/]+/, '//***masked***')}
                                </span>
                                <button onClick={() => toggleEndpoint(erp.id)} className="text-gray-600 hover:text-gray-400 transition-colors flex-shrink-0">
                                  {showEndpoints[erp.id] ? <EyeOff size={11} /> : <Eye size={11} />}
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-600 w-28 flex-shrink-0">Auth Method</span>
                              <span className="text-gray-300">{erp.authMethod}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-600 w-28 flex-shrink-0">API Version</span>
                              <span className="text-gray-300 font-mono">{erp.apiVersion}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-600 w-28 flex-shrink-0">Cron Schedule</span>
                              <span className="text-gray-300 font-mono">{erp.frequencyCron}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-600 w-28 flex-shrink-0">Last Sync</span>
                              <span className="text-gray-300">{new Date(erp.lastSync).toLocaleString('en-US')}</span>
                            </div>
                          </div>
                        </div>

                        {/* Field mappings enabled toggles (read-only) */}
                        <div className="pt-4 space-y-3">
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Field Mappings Enabled</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {FIELD_MAPPINGS.slice(0, 12).map(m => (
                              <div key={m.erpField} className="flex items-center justify-between px-2 py-1 rounded" style={{ background: 'rgba(0,0,0,0.3)' }}>
                                <span className="text-[10px] font-mono text-gray-500 truncate mr-1">{m.erpField}</span>
                                <div className={`w-6 h-3 rounded-full flex-shrink-0 flex items-center relative ${m.status === 'Active' ? 'bg-green-700' : 'bg-gray-700'}`}>
                                  <div className={`w-2 h-2 rounded-full bg-white absolute transition-all ${m.status === 'Active' ? 'right-0.5' : 'left-0.5'}`} />
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-[10px] text-gray-700 flex items-center gap-1">
                            <Info size={10} /> Toggle controls are read-only. Contact your ERP admin to modify mappings.
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      </section>
    </motion.div>
  )
}
