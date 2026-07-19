import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft, FileText, FileSpreadsheet, Lock, User, AlertTriangle,
  RefreshCw, Award, ShieldAlert, ClipboardList, StickyNote, Gauge,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import EmptyState from '../components/EmptyState'
import LoadingState from '../components/LoadingState'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'

// ── Formatting helpers (shared logic with DriverManagement, kept pure) ──────────
function fmtCpk(v, currency) {
  if (v == null || !isFinite(v) || v <= 0) return 'N/A'
  return `${currency} ${v.toFixed(4)}`
}

function fmtCurrency(v, currency) {
  if (v == null || !isFinite(v)) return `${currency} 0`
  return `${currency} ${Math.round(v).toLocaleString()}`
}

function fmtKm(v) {
  if (v == null || !isFinite(v) || v === 0) return 'N/A'
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k km`
  return `${Math.round(v).toLocaleString()} km`
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return '0.0%'
  return `${v.toFixed(1)}%`
}

function performanceBadge(score) {
  if (score <= 20) return { label: 'Excellent', cls: 'bg-green-500/20 text-green-400 border-green-500/30' }
  if (score <= 40) return { label: 'Good',      cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' }
  if (score <= 60) return { label: 'Average',   cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' }
  if (score <= 80) return { label: 'Poor',      cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30' }
  return                  { label: 'Critical',  cls: 'bg-red-500/20 text-red-400 border-red-500/30' }
}

function cpkColor(cpk) {
  if (cpk == null || !isFinite(cpk) || cpk <= 0) return 'text-[var(--text-muted)]'
  if (cpk <= 1.0) return 'text-green-400'
  if (cpk <= 2.0) return 'text-yellow-400'
  return 'text-red-400'
}

function calcCpk(cost, kmFit, kmRem) {
  if (cost == null || kmFit == null || kmRem == null) return null
  const dist = kmRem - kmFit
  if (dist <= 0) return null
  return cost / dist
}

function isHighRisk(r) {
  const rl = (r.risk_level ?? '').toLowerCase()
  return rl === 'high' || rl === 'critical'
}

// ── Single-driver aggregation ───────────────────────────────────────────────────
// Mirrors DriverManagement.aggregateDrivers for one driver's record set. The
// fleet-relative rank / risk-score require the full fleet, so those are derived
// from the fleet aggregate the detail page also fetches (see aggregateDriver).
function aggregateDriver(name, records) {
  const cpkValues = []
  const kmValues = []
  let totalCost = 0
  let highRiskCount = 0

  for (const r of records) {
    totalCost += (r.cost_per_tyre ?? 0) * (r.qty || 1)
    if (isHighRisk(r)) highRiskCount++
    const cpk = calcCpk(r.cost_per_tyre, r.km_at_fitment, r.km_at_removal)
    if (cpk !== null && cpk > 0) cpkValues.push(cpk)
    const life = (r.km_at_removal != null && r.km_at_fitment != null)
      ? r.km_at_removal - r.km_at_fitment
      : null
    if (life !== null && life > 0) kmValues.push(life)
  }

  return {
    name,
    totalTyres: records.length,
    totalCost,
    avgCpk: cpkValues.length > 0
      ? cpkValues.reduce((s, v) => s + v, 0) / cpkValues.length
      : null,
    avgTyreLife: kmValues.length > 0
      ? kmValues.reduce((s, v) => s + v, 0) / kmValues.length
      : null,
    failureRate: records.length > 0
      ? (highRiskCount / records.length) * 100
      : 0,
    highRiskCount,
    records,
  }
}

// ── Fleet-relative risk score + rank (matches DriverManagement.aggregateDrivers) ─
// Recomputes the composite risk score & rank across the fleet so the detail page
// shows the same numbers as the ranking table. Only the target driver's derived
// { riskScore, rank } are returned.
function computeFleetRank(targetName, fleetRecords) {
  const map = new Map()
  for (const r of fleetRecords) {
    const nm = (r.driver_name ?? '').trim() || 'Unassigned'
    if (!map.has(nm)) map.set(nm, [])
    map.get(nm).push(r)
  }

  const drivers = Array.from(map.entries()).map(([nm, recs]) => aggregateDriver(nm, recs))

  const withCpk = drivers.filter(d => d.avgCpk !== null)
  const noCpk   = drivers.filter(d => d.avgCpk === null)
  withCpk.sort((a, b) => a.avgCpk - b.avgCpk)
  const cpkRanked = withCpk.map((d, i) => ({ ...d, cpkRank: (i / Math.max(withCpk.length - 1, 1)) * 100 }))

  const allForFailure = [...cpkRanked, ...noCpk.map(d => ({ ...d, cpkRank: 100 }))]
  const sortedByFailure = [...allForFailure].sort((a, b) => a.failureRate - b.failureRate)
  const failureRankMap = new Map(
    sortedByFailure.map((d, i) => [d.name, (i / Math.max(sortedByFailure.length - 1, 1)) * 100])
  )

  const withScores = allForFailure.map(d => {
    const failureRank = failureRankMap.get(d.name) ?? 100
    const riskScore = Math.min(100, Math.round(d.cpkRank * 0.4 + failureRank * 0.6))
    return { ...d, riskScore }
  })

  withScores.sort((a, b) => a.riskScore - b.riskScore)
  const ranked = withScores.map((d, i) => ({ ...d, rank: i + 1 }))
  return ranked.find(d => d.name === targetName) ?? null
}

// ── Tab definitions ─────────────────────────────────────────────────────────────
const TABS = [
  { key: 'profile',   labelKey: 'driver.detail.tabs.profile',   fallback: 'Profile',     icon: User },
  { key: 'performance', labelKey: 'driver.detail.tabs.performance', fallback: 'Performance', icon: Gauge },
  { key: 'incidents', labelKey: 'driver.detail.tabs.incidents', fallback: 'Incidents',   icon: ShieldAlert },
  { key: 'records',   labelKey: 'driver.detail.tabs.records',   fallback: 'Tyre Records', icon: ClipboardList },
  { key: 'notes',     labelKey: 'driver.detail.tabs.notes',     fallback: 'Notes',       icon: StickyNote },
]

// ── Stat tile ────────────────────────────────────────────────────────────────────
function StatTile({ label, value, accent }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <p className="text-[10px] text-[var(--text-dim)] mb-0.5">{label}</p>
      <p className={`text-sm font-bold truncate ${accent || 'text-[var(--text-primary)]'}`}>{value}</p>
    </div>
  )
}

export default function DriverDetail() {
  const { driverId } = useParams()
  const navigate = useNavigate()
  const { activeCurrency, activeCountry } = useSettings()
  const { t } = useLanguage()

  const driverName = useMemo(() => {
    try { return decodeURIComponent(driverId ?? '') } catch { return driverId ?? '' }
  }, [driverId])

  // Data state
  const [driver, setDriver] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('profile')
  const [recordSort, setRecordSort] = useState({ col: 'issue_date', dir: 'desc' })

  // Approval & Workflow Engine gate — mirrors the original drawer: while the
  // driver-violation approval is active (pending/in_review/returned) or locked
  // (approved) the formal disciplinary PDF export is disabled.
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [driverName])

  // Guards against a slow earlier response overwriting a newer one.
  const reqIdRef = useRef(0)

  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      // Fetch the whole fleet's records (respecting the active-country scope) so
      // the driver's fleet-relative rank & composite risk score match the
      // ranking table exactly, then narrow to this driver.
      const { data, error: err } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select(
            'id,asset_no,asset_number,serial_no,brand,site,country,driver_name,driver_id,' +
            'cost_per_tyre,km_at_fitment,km_at_removal,risk_level,removal_reason,issue_date,category,qty'
          )
        if (activeCountry && activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      })
      if (myReq !== reqIdRef.current) return
      if (err) throw err

      const fleet = data || []
      const mine = fleet.filter(r => ((r.driver_name ?? '').trim() || 'Unassigned') === driverName)
      if (mine.length === 0) {
        setDriver(null)
      } else {
        const ranked = computeFleetRank(driverName, fleet)
        const base = aggregateDriver(driverName, mine)
        setDriver({ ...base, riskScore: ranked?.riskScore ?? 0, rank: ranked?.rank ?? null })
      }
    } catch (e) {
      if (myReq === reqIdRef.current) setError(toUserMessage(e, 'Failed to load driver record'))
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  }, [activeCountry, driverName])

  useEffect(() => { load() }, [load])

  const sortedRecords = useMemo(() => {
    if (!driver) return []
    const recs = [...driver.records]
    recs.sort((a, b) => {
      let va = a[recordSort.col] ?? ''
      let vb = b[recordSort.col] ?? ''
      if (typeof va === 'string') va = va.toLowerCase()
      if (typeof vb === 'string') vb = vb.toLowerCase()
      if (va < vb) return recordSort.dir === 'asc' ? -1 : 1
      if (va > vb) return recordSort.dir === 'asc' ? 1 : -1
      return 0
    })
    return recs
  }, [driver, recordSort])

  // Derived incident (high-risk) records for the Incidents tab.
  const incidents = useMemo(
    () => sortedRecords.filter(isHighRisk),
    [sortedRecords]
  )

  function handleRecordSort(col) {
    setRecordSort(prev => ({
      col,
      dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  function handleExcelExport() {
    if (!driver) return
    exportToExcel(
      sortedRecords,
      ['asset_no', 'serial_no', 'brand', 'issue_date', 'cost_per_tyre', 'km_at_fitment', 'km_at_removal', 'risk_level', 'removal_reason'],
      ['Asset No', 'Serial No', 'Brand', 'Issue Date', 'Cost', 'KM Fitment', 'KM Removal', 'Risk Level', 'Removal Reason'],
      `driver_${driver.name.replace(/\s+/g, '_')}_history`,
      'Driver History',
    )
  }

  function handlePdfExport() {
    if (!driver) return
    // Locked — this driver's disciplinary record is mid-approval; the formal
    // export is blocked until the workflow completes.
    if (wfLocked) return
    exportToPdf(
      sortedRecords.map(r => ({
        ...r,
        cpk_display: fmtCpk(calcCpk(r.cost_per_tyre, r.km_at_fitment, r.km_at_removal), activeCurrency),
        life_km: r.km_at_removal != null && r.km_at_fitment != null
          ? Math.max(0, r.km_at_removal - r.km_at_fitment)
          : '',
      })),
      [
        { key: 'asset_no',        header: 'Asset No' },
        { key: 'brand',           header: 'Brand' },
        { key: 'issue_date',      header: 'Date' },
        { key: 'cost_per_tyre',   header: 'Cost' },
        { key: 'cpk_display',     header: 'CPK' },
        { key: 'life_km',         header: 'Life (km)' },
        { key: 'risk_level',      header: 'Risk Level' },
        { key: 'removal_reason',  header: 'Removal Reason' },
      ],
      `Driver History - ${driver.name}`,
      `driver_${driver.name.replace(/\s+/g, '_')}_history`,
      'landscape',
    )
  }

  // ── States ─────────────────────────────────────────────────────────────────────
  if (loading) return <LoadingState message={t('driver.detail.loading')} />

  if (error) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <button
          onClick={() => navigate('/driver-management')}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5"
        >
          <ArrowLeft size={15} /> {t('driver.detail.back')}
        </button>
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <AlertTriangle size={32} className="text-red-500" />
          <p className="text-red-400 font-medium">{t('driver.detail.errorTitle')}</p>
          <p className="text-[var(--text-dim)] text-sm">{error}</p>
          <button
            onClick={load}
            className="mt-2 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-green-400 transition-colors hover:bg-green-400/10"
            style={{ border: '1px solid rgba(22,163,74,0.3)' }}
          >
            <RefreshCw size={14} /> {t('driver.detail.retry')}
          </button>
        </div>
      </div>
    )
  }

  if (!driver) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <button
          onClick={() => navigate('/driver-management')}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5"
        >
          <ArrowLeft size={15} /> {t('driver.detail.back')}
        </button>
        <EmptyState
          illustration="module/fleet"
          icon={User}
          title={t('driver.detail.notFoundTitle')}
          description={t('driver.detail.notFoundDesc', { name: driverName })}
          action={{ label: t('driver.detail.back'), onClick: () => navigate('/driver-management') }}
        />
      </div>
    )
  }

  const badge = performanceBadge(driver.riskScore)

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/driver-management')}
            className="p-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title={t('driver.detail.back')}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg"
            style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', boxShadow: '0 0 14px rgba(22,163,74,0.4)' }}>
            {driver.name[0]?.toUpperCase() ?? 'D'}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">{driver.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${badge.cls}`}>
                {badge.label}
              </span>
              {driver.rank != null && (
                <span className="text-xs text-[var(--text-muted)]">
                  {t('driver.detail.rank', { rank: driver.rank })}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePdfExport}
            disabled={wfLocked}
            title={wfLocked ? t('driver.detail.lockedTitle') : t('driver.detail.exportPdfTitle')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            {wfLocked ? <Lock size={13} /> : <FileText size={13} />} PDF
          </button>
          <button
            onClick={handleExcelExport}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}
          >
            <FileSpreadsheet size={13} /> Excel
          </button>
        </div>
      </div>

      {/* ── Stat summary strip ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatTile label={t('driver.detail.stats.totalTyres')} value={driver.totalTyres} />
        <StatTile label={t('driver.detail.stats.avgCpk')} value={fmtCpk(driver.avgCpk, activeCurrency)} accent={cpkColor(driver.avgCpk)} />
        <StatTile label={t('driver.detail.stats.totalCost')} value={fmtCurrency(driver.totalCost, activeCurrency)} />
        <StatTile label={t('driver.detail.stats.failureRate')} value={fmtPct(driver.failureRate)} />
        <StatTile label={t('driver.detail.stats.avgTyreLife')} value={fmtKm(driver.avgTyreLife)} />
        <StatTile label={t('driver.detail.stats.highRisk')} value={driver.highRiskCount} accent={driver.highRiskCount > 0 ? 'text-red-400' : undefined} />
        <StatTile label={t('driver.detail.stats.riskScore')} value={driver.riskScore} />
        <StatTile label={t('driver.detail.stats.performance')} value={badge.label} />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 rounded-xl p-1"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {TABS.map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                active ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
              style={active ? { background: '#15803d' } : {}}
            >
              <Icon size={13} /> {t(tab.labelKey) === tab.labelKey ? tab.fallback : t(tab.labelKey)}
            </button>
          )
        })}
      </div>

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {activeTab === 'profile' && (
          <div className="space-y-5">
            <div className="rounded-xl p-5"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2 mb-4">
                <User size={14} className="text-green-400" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('driver.detail.profile.title')}</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                <Field label={t('driver.detail.profile.name')} value={driver.name} />
                <Field label={t('driver.detail.profile.rank')} value={driver.rank != null ? `#${driver.rank}` : '—'} />
                <Field label={t('driver.detail.profile.performance')} value={badge.label} />
                <Field label={t('driver.detail.profile.sites')} value={uniqueValues(driver.records, 'site')} />
                <Field label={t('driver.detail.profile.countries')} value={uniqueValues(driver.records, 'country')} />
                <Field label={t('driver.detail.profile.driverId')} value={firstValue(driver.records, 'driver_id')} />
              </div>
            </div>

            {/* Approval & Workflow Engine — driver-violation gate (preserved from drawer). */}
            <div className="rounded-xl p-5 space-y-3"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <EntityApprovalPanel
                entityType="driver_violation"
                entityId={driver.name}
                entityLabel={driver.name}
                context={{
                  severity: performanceBadge(driver.riskScore).label,
                  violation_type: 'tyre_cost_risk',
                  points: driver.riskScore,
                  failure_rate: Number(driver.failureRate?.toFixed?.(1)) || 0,
                  high_risk_count: driver.highRiskCount,
                  total_tyres: driver.totalTyres,
                  total_cost: Math.round(driver.totalCost || 0),
                }}
                onStateChange={(s) => setWfLocked(!!(s?.isActive || s?.isLocked))}
                title={t('driver.detail.approval.title')}
              />
              {wfLocked && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--accent)] bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2">
                  <Lock size={12} />
                  {t('driver.detail.approval.lockedNote')}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'performance' && (
          <div className="rounded-xl p-5"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-4">
              <Award size={14} className="text-yellow-400" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('driver.detail.performance.title')}</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <StatTile label={t('driver.detail.stats.avgCpk')} value={fmtCpk(driver.avgCpk, activeCurrency)} accent={cpkColor(driver.avgCpk)} />
              <StatTile label={t('driver.detail.stats.totalCost')} value={fmtCurrency(driver.totalCost, activeCurrency)} />
              <StatTile label={t('driver.detail.stats.avgTyreLife')} value={fmtKm(driver.avgTyreLife)} />
              <StatTile label={t('driver.detail.stats.failureRate')} value={fmtPct(driver.failureRate)} accent={
                driver.failureRate >= 30 ? 'text-red-400' : driver.failureRate >= 15 ? 'text-yellow-400' : 'text-green-400'
              } />
              <StatTile label={t('driver.detail.stats.totalTyres')} value={driver.totalTyres} />
              <StatTile label={t('driver.detail.stats.highRisk')} value={driver.highRiskCount} accent={driver.highRiskCount > 0 ? 'text-red-400' : undefined} />
              <StatTile label={t('driver.detail.stats.riskScore')} value={driver.riskScore} />
              <StatTile label={t('driver.detail.stats.rank')} value={driver.rank != null ? `#${driver.rank}` : '—'} />
            </div>
          </div>
        )}

        {activeTab === 'incidents' && (
          <div className="rounded-xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="px-5 py-4 border-b border-[var(--input-border)] flex items-center gap-2">
              <ShieldAlert size={14} className="text-red-400" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('driver.detail.incidents.title')}</h3>
              <span className="text-xs text-[var(--text-dim)] ml-1">({incidents.length})</span>
            </div>
            {incidents.length === 0 ? (
              <EmptyState
                icon={ShieldAlert}
                title={t('driver.detail.incidents.emptyTitle')}
                description={t('driver.detail.incidents.emptyDesc')}
                compact
              />
            ) : (
              <RecordsTable
                records={incidents}
                currency={activeCurrency}
                sort={recordSort}
                onSort={handleRecordSort}
                t={t}
              />
            )}
          </div>
        )}

        {activeTab === 'records' && (
          <div className="rounded-xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="px-5 py-4 border-b border-[var(--input-border)] flex items-center gap-2">
              <ClipboardList size={14} className="text-green-400" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('driver.detail.records.title')}</h3>
              <span className="text-xs text-[var(--text-dim)] ml-1">({driver.records.length})</span>
            </div>
            {sortedRecords.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title={t('driver.detail.records.emptyTitle')}
                description={t('driver.detail.records.emptyDesc')}
                compact
              />
            ) : (
              <RecordsTable
                records={sortedRecords}
                currency={activeCurrency}
                sort={recordSort}
                onSort={handleRecordSort}
                t={t}
              />
            )}
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="rounded-xl p-5"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-4">
              <StickyNote size={14} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('driver.detail.notes.title')}</h3>
            </div>
            {/* Removal-reason notes surfaced from the driver's tyre records. */}
            {sortedRecords.filter(r => r.removal_reason).length === 0 ? (
              <EmptyState
                icon={StickyNote}
                title={t('driver.detail.notes.emptyTitle')}
                description={t('driver.detail.notes.emptyDesc')}
                compact
              />
            ) : (
              <ul className="space-y-2">
                {sortedRecords.filter(r => r.removal_reason).map((r, i) => (
                  <li key={r.id ?? i}
                    className="rounded-lg px-3 py-2.5 text-sm text-[var(--text-muted)]"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs text-[var(--text-dim)]">
                        {r.asset_no ?? r.asset_number ?? '-'}{r.issue_date ? ` · ${r.issue_date.slice(0, 10)}` : ''}
                      </span>
                      {r.risk_level && (
                        <span className="text-[11px] capitalize text-[var(--text-dim)]">{r.risk_level}</span>
                      )}
                    </div>
                    {r.removal_reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}

// ── Small presentational helpers ─────────────────────────────────────────────────
function Field({ label, value }) {
  return (
    <div>
      <p className="text-[11px] text-[var(--text-dim)] mb-0.5">{label}</p>
      <p className="text-[var(--text-primary)] font-medium">{value || '—'}</p>
    </div>
  )
}

function uniqueValues(records, key) {
  const s = new Set(records.map(r => r[key]).filter(Boolean))
  return Array.from(s).join(', ')
}

function firstValue(records, key) {
  const hit = records.find(r => r[key])
  return hit ? hit[key] : ''
}

function RecordsTable({ records, currency, sort, onSort, t }) {
  const cols = [
    ['asset_no', t('driver.detail.cols.asset')],
    ['brand', t('driver.detail.cols.brand')],
    ['issue_date', t('driver.detail.cols.date')],
    ['cost_per_tyre', t('driver.detail.cols.cost')],
    ['cpk', t('driver.detail.cols.cpk')],
    ['life', t('driver.detail.cols.life')],
    ['risk_level', t('driver.detail.cols.risk')],
    ['removal_reason', t('driver.detail.cols.reason')],
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
          <tr>
            {cols.map(([col, lbl]) => (
              <th
                key={col}
                className="px-3 py-2.5 text-left text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider cursor-pointer hover:text-[var(--text-muted)] transition-colors"
                onClick={() => onSort(col)}
              >
                {lbl}{sort.col === col ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => {
            const cpk = calcCpk(r.cost_per_tyre, r.km_at_fitment, r.km_at_removal)
            const life = r.km_at_removal != null && r.km_at_fitment != null
              ? Math.max(0, r.km_at_removal - r.km_at_fitment)
              : null
            const riskLow = (r.risk_level ?? '').toLowerCase()
            const riskCls = riskLow === 'critical' ? 'text-red-400'
              : riskLow === 'high'     ? 'text-orange-400'
              : riskLow === 'medium'   ? 'text-yellow-400'
              : riskLow === 'low'      ? 'text-green-400'
              : 'text-[var(--text-muted)]'
            return (
              <tr key={r.id ?? i} className="border-t border-[var(--input-border)] hover:bg-white/[0.02] transition-colors">
                <td className="px-3 py-2 text-[var(--text-dim)] font-medium">{r.asset_no ?? r.asset_number ?? '-'}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{r.brand ?? '-'}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{r.issue_date ? r.issue_date.slice(0, 10) : '-'}</td>
                <td className="px-3 py-2 text-[var(--text-dim)]">{r.cost_per_tyre != null ? `${currency} ${r.cost_per_tyre}` : '-'}</td>
                <td className={`px-3 py-2 font-mono ${cpkColor(cpk)}`}>{fmtCpk(cpk, currency)}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{life != null ? fmtKm(life) : '-'}</td>
                <td className={`px-3 py-2 font-semibold capitalize ${riskCls}`}>{r.risk_level ?? '-'}</td>
                <td className="px-3 py-2 text-[var(--text-muted)] max-w-[160px] truncate">{r.removal_reason ?? '-'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
