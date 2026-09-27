import { useEffect, useState, useCallback, useMemo } from 'react'
import { dataCleaning } from '../lib/api'
import useLatestRequest from '../lib/useLatestRequest'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { batchClassify, RISK_COLOUR, CONFIDENCE_COLOUR, ALL_CATEGORY_LABELS } from '../lib/tyreClassifier'
import {
  Wand2, Info, ChevronLeft, ChevronRight, Check, X, RefreshCw, CheckCheck,
  ShieldAlert, AlertTriangle, BarChart2, Gauge, ClipboardList, Truck,
  Activity, ChevronDown, ChevronUp, Edit2, Hash, Layers, CheckCircle2,
  MapPin, Tag, Calendar, FileSpreadsheet, FileText,
} from 'lucide-react'
import { SkeletonTable } from '../components/ui/Skeleton'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import { formatDate } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { reportFileName } from '../lib/exportUtils'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import StatTile from '../components/ui/StatTile'
import Modal from '../components/ui/Modal'
import {
  QUALITY_CHECKS, checkBadCount, computeQualityScore, scoreBand, scoreVerdict,
  detectSerialIssues, groupDuplicateSerials, findInvalidPressure, summarizeMissingTread,
  inspectionCutoff, findMissingInspections, detectOdometerIssues, detectUnrealisticLife,
  odometerEditVerdict, searchCleaned, summarizeCleaned, cleanedShare, qualityIssueExportRows,
} from '../lib/dataCleaningAnalytics'

const PAGE_SIZE = 50

const SCORE_TEXT = { good: 'text-green-400', warn: 'text-yellow-400', crit: 'text-red-400' }
const SCORE_BG = { good: 'bg-green-900/30 border-green-700/50', warn: 'bg-yellow-900/30 border-yellow-700/50', crit: 'bg-red-900/30 border-red-700/50' }
function scoreColor(s) { return SCORE_TEXT[scoreBand(s)] || 'text-[var(--text-muted)]' }
function scoreBg(s) { return SCORE_BG[scoreBand(s)] || 'border-[var(--card-border)]' }
function readCachedScore(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null } catch { return null }
}
function writeCachedScore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable: history is a convenience */ }
}

// ─── IssueSection component ───────────────────────────────────────────────────
function IssueSection({ icon: Icon, title, count, color = 'text-yellow-400', bgColor = 'bg-yellow-900/20 border-yellow-700/40', children, loading, action, failed = false, notApplicable = false, onRetry }) {
  const [expanded, setExpanded] = useState(false)
  const canExpand = !loading && !failed && (count > 0 || notApplicable)
  let badge
  if (loading) badge = <span className="text-xs text-[var(--text-muted)] animate-pulse">Checking...</span>
  else if (failed) badge = <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-red-900/20 border-red-700/40 text-red-400">Could not check</span>
  else if (notApplicable) badge = <span className="text-xs font-semibold px-2 py-0.5 rounded-full border border-[var(--card-border)] text-[var(--text-muted)]">Not applicable</span>
  else badge = (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${count > 0 ? bgColor + ' ' + color : 'bg-green-900/20 border-green-700/40 text-green-400'}`}>
      {count > 0 ? `${count.toLocaleString()} issue${count !== 1 ? 's' : ''}` : 'Clean'}
    </span>
  )
  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => canExpand && setExpanded(e => !e)}
          aria-expanded={canExpand ? expanded : undefined}
          disabled={!canExpand}
          className="flex flex-1 min-w-0 items-center gap-3 min-h-[44px] text-left rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-default"
        >
          <Icon size={18} className={color} aria-hidden="true" />
          <span className="font-medium text-[var(--text-primary)]">{title}</span>
          {badge}
          {canExpand && (expanded ? <ChevronUp size={16} className="text-[var(--text-muted)] ml-auto" aria-hidden="true" /> : <ChevronDown size={16} className="text-[var(--text-muted)] ml-auto" aria-hidden="true" />)}
        </button>
        <div className="flex items-center gap-2">
          {action}
          {failed && onRetry && (
            <button type="button" onClick={onRetry} className="btn-secondary min-h-[36px] text-xs inline-flex items-center gap-1">
              <RefreshCw size={12} aria-hidden="true" /> Retry
            </button>
          )}
        </div>
      </div>
      {expanded && canExpand && (
        <div className="mt-3 border-t border-[var(--card-border)] pt-3">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── ExpandableList component ─────────────────────────────────────────────────
function ExpandableList({ items, renderItem, pageSize = 10 }) {
  const [show, setShow] = useState(pageSize)
  return (
    <div>
      <div className="space-y-1.5">
        {items.slice(0, show).map((item, i) => (
          <div key={i}>{renderItem(item, i)}</div>
        ))}
      </div>
      {items.length > show && (
        <button
          type="button"
          onClick={() => setShow(s => s + pageSize)}
          className="mt-3 min-h-[36px] text-xs text-[var(--accent)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          Show {Math.min(pageSize, items.length - show)} more ({items.length - show} remaining)
        </button>
      )}
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, type = 'error', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div role={type === 'error' ? 'alert' : 'status'} aria-live="polite" className={`fixed bottom-6 right-6 left-6 sm:left-auto z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-xl text-sm font-medium
      ${type === 'error' ? 'bg-red-900/90 border-red-700 text-red-200' : 'bg-green-900/90 border-green-700 text-green-200'}`}>
      {type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
      {message}
      <button type="button" onClick={onClose} aria-label="Dismiss message" className="ml-auto min-h-[32px] min-w-[32px] inline-flex items-center justify-center"><X size={14} aria-hidden="true" /></button>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
export default function DataCleaning() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const isAdmin = profile?.role === 'Admin'

  // ── Existing state ──────────────────────────────────────────────────────────
  const [tab, setTab]                       = useState('pending')
  const [rawRecords, setRawRecords]         = useState([])
  const [classified, setClassified]         = useState([])
  const [overrides, setOverrides]           = useState({})
  const [selected, setSelected]             = useState(new Set())
  const [page, setPage]                     = useState(0)
  const [totalPending, setTotalPending]     = useState(0)
  const [cleanedRecords, setCleanedRecords] = useState([])
  const [loading, setLoading]               = useState(true)
  const [loadError, setLoadError]           = useState(false)
  const [saving, setSaving]                 = useState(false)
  const [saveCount, setSaveCount]           = useState(0)
  const [filterConf, setFilterConf]         = useState('')
  const [filterSite, setFilterSite]         = useState('')
  const [sites, setSites]                   = useState([])
  const [stats, setStats]                   = useState({ pending: null, cleaned: null })
  const [statsError, setStatsError]         = useState(false)
  const [cleanedSearch, setCleanedSearch]   = useState('')

  const [approveAllProgress, setApproveAllProgress] = useState(null)
  const [showApproveAllConfirm, setShowApproveAllConfirm] = useState(false)

  const [cleanedSelected, setCleanedSelected]     = useState(new Set())
  const [reclassifyProposed, setReclassifyProposed] = useState(null)

  // ── Quality Intelligence state ──────────────────────────────────────────────
  const [qiLoading, setQiLoading]         = useState(false)
  const [totalRecords, setTotalRecords]   = useState(null)
  const [qualityScore, setQualityScore]   = useState(null)
  const [prevScore, setPrevScore]         = useState(null)
  const [toast, setToast]                 = useState(null)

  // Check results
  const [serialIssues, setSerialIssues]         = useState(null)
  const [duplicateSerial, setDuplicateSerial]   = useState(null)
  const [invalidPressure, setInvalidPressure]   = useState(null)
  const [missingTread, setMissingTread]         = useState(null)
  const [missingInspect, setMissingInspect]     = useState(null)
  const [odometerIssues, setOdometerIssues]     = useState(null)
  const [unrealisticLife, setUnrealisticLife]   = useState(null)

  // Check loading states
  const [checkLoading, setCheckLoading] = useState({
    serialIssues: false, duplicateSerial: false, invalidPressure: false,
    missingTread: false, missingInspect: false, odometer: false, unrealisticLife: false,
  })

  // Modals
  const [dupModal, setDupModal]           = useState(null)   // { group }
  const [odomModal, setOdomModal]         = useState(null)   // { record }
  const [odomEdits, setOdomEdits]         = useState({})
  const [fixingDup, setFixingDup]         = useState(false)
  const [fixingOdom, setFixingOdom]       = useState(false)

  // Load previous score from localStorage
  useEffect(() => {
    const cached = readCachedScore('tp_dq_score_prev')
    if (cached && Number.isFinite(cached.score)) setPrevScore(cached)
  }, [])

  // ── Existing loaders ─────────────────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    const [p, c] = await Promise.all([
      dataCleaning.countTyreRecords({ country: activeCountry, cleaned: false }),
      dataCleaning.countTyreRecords({ country: activeCountry, cleaned: true }),
    ])
    if (p.error || c.error) {
      setStatsError(true)
      setStats({ pending: null, cleaned: null })
      setToast({ message: toUserMessage(p.error || c.error), type: 'error' })
      return
    }
    setStatsError(false)
    setStats({ pending: p.count ?? 0, cleaned: c.count ?? 0 })
  }, [activeCountry])

  const loadSites = useCallback(async () => {
    const { data, error } = await dataCleaning.listUncleanedSites({ country: activeCountry })
    if (error) { setSites([]); setToast({ message: toUserMessage(error), type: 'error' }); return }
    setSites([...new Set((data ?? []).map(r => r.site))].sort())
  }, [activeCountry])

  // Paging and both filters drive this read; a slower earlier one would repaint
  // the previous page's records and, worse, reset the selection under them.
  const latestPending = useLatestRequest()
  const latestCleaned = useLatestRequest()

  const loadPending = useCallback(async () => {
    const stale = latestPending.begin()
    setLoading(true)
    setLoadError(false)
    const { data, count, error } = await dataCleaning.listPendingRecords({
      country: activeCountry,
      site: filterSite || undefined,
      from: page * PAGE_SIZE,
      to: (page + 1) * PAGE_SIZE - 1,
    })
    if (stale()) return
    if (error) { setLoadError(true); setRawRecords([]); setClassified([]); setSelected(new Set()); setLoading(false); setToast({ message: toUserMessage(error), type: 'error' }); return }
    const records = data ?? []
    setRawRecords(records)
    setTotalPending(count ?? 0)

    let results = batchClassify(records).map((result, index) => ({ ...records[index], ...result }))
    if (filterConf) results = results.filter(r => r.confidence === filterConf)
    setClassified(results)
    setSelected(new Set())
    setLoading(false)
  }, [page, filterConf, filterSite, activeCountry, latestPending])

  const loadCleaned = useCallback(async () => {
    const stale = latestCleaned.begin()
    setLoading(true)
    setLoadError(false)
    const { data, error } = await dataCleaning.listCleanedRecords({ country: activeCountry, site: filterSite || undefined })
    if (stale()) return
    if (error) { setLoadError(true); setToast({ message: toUserMessage(error), type: 'error' }); setCleanedRecords([]); setLoading(false); return }
    setCleanedRecords(data ?? [])
    setCleanedSelected(new Set())
    setReclassifyProposed(null)
    setLoading(false)
  }, [activeCountry, filterSite, latestCleaned])

  // ── Quality Intelligence checks ─────────────────────────────────────────────
  const checkSerialIssues = useCallback(async () => {
    setCheckLoading(p => ({ ...p, serialIssues: true }))
    try {
      const { data, error } = await dataCleaning.listSerialRecords({ country: activeCountry })
      if (error) throw error
      setSerialIssues(detectSerialIssues(data ?? []))
    } catch {
      setSerialIssues({ count: 0, issues: [], error: true })
    }
    setCheckLoading(p => ({ ...p, serialIssues: false }))
  }, [activeCountry])

  const checkDuplicateSerials = useCallback(async () => {
    setCheckLoading(p => ({ ...p, duplicateSerial: true }))
    try {
      const { data, error } = await dataCleaning.listActiveSerialRecords({ country: activeCountry })
      if (error) throw error

      setDuplicateSerial(groupDuplicateSerials(data ?? []))
    } catch {
      setDuplicateSerial({ groups: [], affectedCount: 0, groupCount: 0, error: true })
    }
    setCheckLoading(p => ({ ...p, duplicateSerial: false }))
  }, [activeCountry])

  const checkInvalidPressure = useCallback(async () => {
    setCheckLoading(p => ({ ...p, invalidPressure: true }))
    try {
      // Try pressure_reading column; gracefully handle if it doesn't exist
      const { data, error } = await dataCleaning.listPressureRecords({ country: activeCountry })

      if (error && error.message?.includes('column')) {
        setInvalidPressure({ count: 0, records: [], notApplicable: true })
        setCheckLoading(p => ({ ...p, invalidPressure: false }))
        return
      }

      if (error) throw error
      setInvalidPressure(findInvalidPressure(data ?? []))
    } catch {
      setInvalidPressure({ count: 0, records: [], error: true })
    }
    setCheckLoading(p => ({ ...p, invalidPressure: false }))
  }, [activeCountry])

  const checkMissingTread = useCallback(async () => {
    setCheckLoading(p => ({ ...p, missingTread: true }))
    try {
      // Records that look like inspections but lack tread depth
      const { data, error } = await dataCleaning.listTreadRecords({ country: activeCountry })

      if (error && error.message?.includes('column')) {
        setMissingTread({ count: 0, pct: null, bySite: [], notApplicable: true })
        setCheckLoading(p => ({ ...p, missingTread: false }))
        return
      }

      if (error) throw error
      setMissingTread(summarizeMissingTread(data ?? []))
    } catch {
      setMissingTread({ count: 0, pct: null, bySite: [], records: [], error: true })
    }
    setCheckLoading(p => ({ ...p, missingTread: false }))
  }, [activeCountry])

  const checkMissingInspections = useCallback(async () => {
    setCheckLoading(p => ({ ...p, missingInspect: true }))
    try {
      // Get all distinct asset_nos from tyre_records
      const { data: tyreData, error: tyreError } = await dataCleaning.listAssetNumbers({ country: activeCountry })
      if (tyreError) throw tyreError
      const cutoff = inspectionCutoff(new Date())

      const { data: inspData, error: inspError } = await dataCleaning.listRecentInspections({ cutoff, country: activeCountry })

      if (inspError) throw inspError

      setMissingInspect(findMissingInspections(tyreData ?? [], inspData ?? []))
    } catch {
      setMissingInspect({ count: 0, asset_nos: [], error: true })
    }
    setCheckLoading(p => ({ ...p, missingInspect: false }))
  }, [activeCountry])

  const checkOdometerIssues = useCallback(async () => {
    setCheckLoading(p => ({ ...p, odometer: true }))
    try {
      const { data, error } = await dataCleaning.listOdometerRecords({ country: activeCountry })
      if (error) throw error

      setOdometerIssues(detectOdometerIssues(data ?? []))
    } catch {
      setOdometerIssues({ count: 0, issues: [], error: true })
    }
    setCheckLoading(p => ({ ...p, odometer: false }))
  }, [activeCountry])

  const checkUnrealisticLife = useCallback(async () => {
    setCheckLoading(p => ({ ...p, unrealisticLife: true }))
    try {
      const { data, error } = await dataCleaning.listLifeRecords({ country: activeCountry })
      if (error) throw error

      setUnrealisticLife(detectUnrealisticLife(data ?? []))
    } catch {
      setUnrealisticLife({ count: 0, issues: [], error: true })
    }
    setCheckLoading(p => ({ ...p, unrealisticLife: false }))
  }, [activeCountry])

  const runAllChecks = useCallback(async () => {
    setQiLoading(true)
    setCheckLoading({ serialIssues: true, duplicateSerial: true, invalidPressure: true, missingTread: true, missingInspect: true, odometer: true, unrealisticLife: true })

    const { count: total, error: totalError } = await dataCleaning.countTyreRecords({ country: activeCountry })
    // An unreadable total must not score as "0 records": null keeps the score N/A.
    setTotalRecords(totalError ? null : (total ?? 0))

    await Promise.all([
      checkSerialIssues(),
      checkDuplicateSerials(),
      checkInvalidPressure(),
      checkMissingTread(),
      checkMissingInspections(),
      checkOdometerIssues(),
      checkUnrealisticLife(),
    ])

    setQiLoading(false)
  }, [activeCountry, checkDuplicateSerials, checkInvalidPressure, checkMissingInspections, checkMissingTread, checkOdometerIssues, checkSerialIssues, checkUnrealisticLife])

  // Effects are declared after their stable loaders so dependency changes are
  // explicit and cannot accidentally create a render/request loop.
  useEffect(() => { loadStats(); loadSites() }, [loadSites, loadStats, saveCount])
  useEffect(() => {
    if (tab === 'pending') loadPending()
    else if (tab === 'cleaned') loadCleaned()
  }, [activeCountry, loadCleaned, loadPending, saveCount, tab])
  useEffect(() => { if (tab === 'quality') runAllChecks() }, [runAllChecks, tab])

  // Recompute score whenever checks complete
  useEffect(() => {
    if (!serialIssues || !duplicateSerial || !invalidPressure || !missingTread || !missingInspect || !odometerIssues || !unrealisticLife) return
    const checks = {
      odometer:        odometerIssues,
      duplicateSerial: duplicateSerial,
      missingTread:    missingTread,
      invalidPressure: invalidPressure,
      serialIssues:    serialIssues,
      unrealisticLife: unrealisticLife,
      missingInspect:  missingInspect,
    }
    if (Object.values(checks).some(check => check.error || check.notApplicable)) { setQualityScore(null); return }
    const score = computeQualityScore(checks, totalRecords)
    setQualityScore(score)
    if (score === null) return
    const now = new Date()

    // Keep the previous day's score so the page can show the movement.
    const stored = readCachedScore('tp_dq_score_current')
    if (stored?.ts && Number.isFinite(stored.score)) {
      const diffDays = (now.getTime() - new Date(stored.ts).getTime()) / 86400000
      if (diffDays >= 1) {
        writeCachedScore('tp_dq_score_prev', stored)
        setPrevScore(stored)
      }
    }
    writeCachedScore('tp_dq_score_current', { score, ts: now.toISOString() })
  }, [serialIssues, duplicateSerial, invalidPressure, missingTread, missingInspect, odometerIssues, unrealisticLife, totalRecords])

  // ── Bulk fix handlers ────────────────────────────────────────────────────────
  async function fixDuplicateSerial(group, serials) {
    const toUpdate = group.records.filter(record => serials[record.id]?.trim() && serials[record.id].trim() !== record.tyre_serial)
    if (!toUpdate.length || fixingDup) return
    setFixingDup(true)
    try {
      await dataCleaning.correctTyreRecords(toUpdate.map(record => ({
        id: record.id, patch: { tyre_serial: serials[record.id].trim() }, expected: { tyre_serial: record.tyre_serial },
      })), { country: activeCountry, action: 'serial' })
      setToast({ message: `Updated ${toUpdate.length} serial(s) successfully`, type: 'success' })
      setDupModal(null)
      await checkDuplicateSerials()
    } catch (e) {
      setToast({ message: `Update failed: ${toUserMessage(e, 'Please try again.')}`, type: 'error' })
    }
    setFixingDup(false)
  }

  async function fixOdometerRecord(record) {
    setFixingOdom(true)
    const edits = odomEdits[record.id] ?? {}
    try {
      const updates = {}
      if (edits.km_at_fitment !== undefined) updates.km_at_fitment = parseFloat(edits.km_at_fitment)
      if (edits.km_at_removal !== undefined) updates.km_at_removal = parseFloat(edits.km_at_removal)
      if (!Object.keys(updates).length) { setFixingOdom(false); return }
      if (Object.values(updates).some(value => !Number.isFinite(value) || value < 0)) throw new Error('Enter valid non-negative odometer values.')
      await dataCleaning.correctTyreRecords([{ id: record.id, patch: updates, expected: { km_at_fitment: record.km_at_fitment, km_at_removal: record.km_at_removal } }], { country: activeCountry, action: 'odometer' })
      setToast({ message: 'Odometer values updated', type: 'success' })
      setOdomModal(null)
      setOdomEdits({})
      await checkOdometerIssues()
    } catch (e) {
      setToast({ message: `Update failed: ${toUserMessage(e, 'Please try again.')}`, type: 'error' })
    }
    setFixingOdom(false)
  }

  async function markNeedsReview(record) {
    try {
      await dataCleaning.correctTyreRecords([{ id: record.id, patch: { remarks: `[NEEDS REVIEW] ${record.remarks ?? ''}`.trim() }, expected: { remarks: record.remarks ?? null } }], { country: activeCountry, action: 'review' })
      setToast({ message: `Record ${record.id} marked as Needs Review`, type: 'success' })
      await checkUnrealisticLife()
    } catch (e) {
      setToast({ message: `Update failed: ${toUserMessage(e, 'Please try again.')}`, type: 'error' })
    }
  }

  // ── Existing helpers ─────────────────────────────────────────────────────────
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

  async function saveCorrections(changes, action = 'classify') {
    let confirmed = 0
    try {
      for (let i = 0; i < changes.length; i += 200) {
        const ids = await dataCleaning.correctTyreRecords(changes.slice(i, i + 200), {
          country: activeCountry, site: filterSite || undefined, action,
        })
        confirmed += ids.length
        setApproveAllProgress({ done: confirmed, total: changes.length })
      }
      return confirmed
    } catch (error) {
      setToast({ message: `${confirmed} record(s) confirmed. Correction stopped: ${toUserMessage(error, 'Refresh the records before retrying.')}`, type: 'error' })
      throw error
    } finally {
      // Refresh even after a timeout: the server may have committed before the response was lost.
      setSaveCount(c => c + 1)
    }
  }

  async function approveSelected() {
    if (selected.size === 0 || saving) return
    setSaving(true)
    try {
      const changes = [...selected].map(id => dataCleaning.classificationChange(rawRecords.find(r => r.id === id), getResult(id)))
      await saveCorrections(changes)
      setOverrides({})
    } catch { /* saveCorrections reports the confirmed count and error. */ }
    finally { setSaving(false); setApproveAllProgress(null) }
  }

  async function approveAll() {
    if (saving) return
    setToast(null)
    setShowApproveAllConfirm(false)
    setSaving(true)
    try {
      const allPending = []
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await dataCleaning.listPendingForApproveAll({
          country: activeCountry, site: filterSite || undefined, from: offset, to: offset + 499,
        })
        if (error) throw error
        allPending.push(...(data ?? []))
        if (!data || data.length < 500) break
      }
      const results = batchClassify(allPending)
      const originals = new Map(allPending.map(record => [record.id, record]))
      const changes = results.map(result => dataCleaning.classificationChange(originals.get(result.id), result))
      setApproveAllProgress({ done: 0, total: changes.length })
      await saveCorrections(changes)
    } catch (error) {
      // Read failures occur before saveCorrections and must not look like an empty sweep.
      setToast(previous => previous?.type === 'error' ? previous : ({ message: `Approval stopped: ${toUserMessage(error, 'Refresh before retrying.')}`, type: 'error' }))
    } finally { setSaving(false); setApproveAllProgress(null) }
  }

  function runReclassify() {
    const toReclassify = cleanedRecords.filter(r => cleanedSelected.has(String(r.id)))
    const results      = batchClassify(toReclassify.map(r => ({ id: r.id, description: r.description, remarks: r.remarks })))
    const proposed     = results.map(r => {
      const orig = cleanedRecords.find(c => c.id === r.id)
      const changed = orig.category !== r.category || orig.risk_level !== r.risk_level
      return { ...r, orig_category: orig?.category, orig_risk: orig?.risk_level, changed }
    })
    setReclassifyProposed(proposed)
  }

  async function approveReclassify() {
    if (!reclassifyProposed || saving) return
    setSaving(true)
    try {
      const changes = reclassifyProposed.map(result => dataCleaning.classificationChange(cleanedRecords.find(r => r.id === result.id), result))
      await saveCorrections(changes)
      setReclassifyProposed(null)
      setCleanedSelected(new Set())
    } catch { /* saveCorrections reports the confirmed count and error. */ }
    finally { setSaving(false); setApproveAllProgress(null) }
  }

  async function undoClassification(record) {
    if (saving) return
    setSaving(true)
    try {
      await saveCorrections([dataCleaning.classificationChange(record, null, true)], 'undo')
      setToast({ message: 'Classification reverted; history retained', type: 'success' })
    } catch { /* saveCorrections reports the confirmed count and error. */ }
    finally { setSaving(false); setApproveAllProgress(null) }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const totalPages = Math.ceil(totalPending / PAGE_SIZE)
  const allSelected = classified.length > 0 && classified.every(r => selected.has(r.id))

  const cleanedFiltered = useMemo(() => searchCleaned(cleanedRecords, cleanedSearch), [cleanedRecords, cleanedSearch])
  const cleanedSummary = useMemo(() => summarizeCleaned(cleanedRecords), [cleanedRecords])
  const cleanedRowSelection = useMemo(() => {
    const o = {}
    cleanedSelected.forEach(id => { o[String(id)] = true })
    return o
  }, [cleanedSelected])
  const onCleanedSelection = useCallback(next => {
    setCleanedSelected(new Set(Object.keys(next).filter(k => next[k])))
  }, [])

  // Severity badge
  function severityBadge(s) {
    if (s === 'critical') return 'bg-red-900/40 text-red-300 border-red-700/50'
    if (s === 'high') return 'bg-orange-900/40 text-orange-300 border-orange-700/50'
    return 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50'
  }

  // ── Quality Intelligence tab ─────────────────────────────────────────────────
  const allChecksLoaded = !Object.values(checkLoading).some(Boolean)
  const qualityIncomplete = [serialIssues, duplicateSerial, invalidPressure, missingTread, missingInspect, odometerIssues, unrealisticLife].some(check => check?.error || check?.notApplicable)

  // ── Duplicate modal state ────────────────────────────────────────────────────
  const [dupNewSerial, setDupNewSerial] = useState({})
  useEffect(() => { if (dupModal) setDupNewSerial({}) }, [dupModal])

  const qualityChecks = {
    odometer: odometerIssues, duplicateSerial, missingTread, invalidPressure,
    serialIssues, unrealisticLife, missingInspect,
  }
  const shareCleaned = cleanedShare(stats.pending, stats.cleaned)
  const fmtCount = (v) => (v === null || v === undefined ? (statsError ? 'N/A' : '...') : Number(v).toLocaleString())

  async function exportQualityIssues(kind) {
    const rows = qualityIssueExportRows(qualityChecks)
    const keys = ['check', 'serial', 'asset_no', 'site', 'issue_date', 'issue']
    const headers = ['Check', 'Serial', 'Asset No', 'Site', 'Issue Date', 'Issue']
    const name = reportFileName('Data Quality Issues', activeCountry || 'All')
    try {
      const { exportToExcel, exportToPdf } = await import('../lib/exportUtils')
      if (kind === 'pdf') await exportToPdf(rows, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Data Quality Issues', name, 'landscape')
      else await exportToExcel(rows, keys, headers, name, 'Issues')
    } catch (e) {
      setToast({ message: toUserMessage(e, 'Export failed. Please try again.'), type: 'error' })
    }
  }

  const cleanedColumns = [
    { id: 'asset_no', header: 'Asset No', accessorFn: r => r.asset_no ?? 'N/A', size: 110,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no ?? 'N/A'}</span> },
    { id: 'brand', header: 'Brand', accessorFn: r => r.brand ?? 'N/A', size: 110, meta: { filterVariant: 'select' } },
    { id: 'site', header: 'Site', accessorFn: r => r.site ?? 'N/A', size: 110, meta: { filterVariant: 'select' } },
    { id: 'category', header: 'Category', accessorFn: r => r.category ?? 'N/A', size: 150, meta: { filterVariant: 'select' } },
    { id: 'risk_level', header: 'Risk Level', accessorFn: r => r.risk_level ?? 'N/A', size: 110, meta: { filterVariant: 'select' },
      cell: ({ row }) => row.original.risk_level
        ? <span className={`badge ${RISK_COLOUR[row.original.risk_level] ?? ''}`}>{row.original.risk_level}</span>
        : <span className="text-[var(--text-muted)]">N/A</span> },
    { id: 'remarks_cleaned', header: 'Cleaned Remarks', accessorFn: r => r.remarks_cleaned ?? 'N/A', size: 220,
      cell: ({ row }) => <span className="text-[var(--text-muted)] text-xs block max-w-xs truncate" title={row.original.remarks_cleaned ?? ''}>{row.original.remarks_cleaned ?? 'N/A'}</span> },
    { id: 'original', header: 'Original Remarks', accessorFn: r => r.remarks || r.description || 'N/A', size: 220,
      cell: ({ row }) => {
        const text = row.original.remarks || row.original.description || 'N/A'
        return <span className="text-[var(--text-muted)] text-xs block max-w-xs truncate" title={text}>{text}</span>
      } },
    { id: 'issue_date', header: 'Date', accessorFn: r => r.issue_date ?? null, size: 110,
      cell: ({ row }) => <span className="text-[var(--text-muted)] tabular-nums">{row.original.issue_date ? formatDate(row.original.issue_date) : 'N/A'}</span> },
    { id: 'undo', header: '', enableSorting: false, size: 90, meta: { export: false },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); undoClassification(row.original) }}
          disabled={saving}
          className="text-xs min-h-[36px] px-3 rounded bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/40 border border-yellow-700/40 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-40"
          title="Move back to Pending"
        >
          Undo
        </button>
      ) },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        title="Data Cleaning Engine"
        subtitle="Rule-based auto-classification + Quality Intelligence, zero AI tokens required"
        icon={Wand2}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Data cleaning summary">
        <StatTile label="Pending classification" value={fmtCount(stats.pending)} tone={stats.pending > 0 ? 'warn' : 'neutral'} icon={ClipboardList} index={0} />
        <StatTile label="Already cleaned" value={fmtCount(stats.cleaned)} tone="accent" icon={CheckCircle2} index={1} />
        <StatTile label="Classified share" value={shareCleaned === null ? 'N/A' : shareCleaned} unit={shareCleaned === null ? undefined : '%'}
          sub={shareCleaned === null ? (statsError ? 'Counts could not be read' : 'No tyre records in scope') : 'of all tyre records'} tone="info" icon={Layers} index={2} />
        <StatTile label="Data quality score" value={qualityScore === null ? 'N/A' : qualityScore} unit={qualityScore === null ? undefined : '%'}
          sub={qualityScore === null ? 'Open Quality Intelligence to score' : scoreVerdict(qualityScore)}
          tone={{ good: 'accent', warn: 'warn', crit: 'crit' }[scoreBand(qualityScore)] || 'neutral'} icon={Gauge} index={3} />
      </div>
      {statsError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-700/40 bg-red-900/20 px-4 py-2 text-sm text-red-300">
          <AlertTriangle size={15} aria-hidden="true" /> Record counts could not be read, so the totals above show N/A.
          <button type="button" onClick={loadStats} className="btn-secondary ml-auto min-h-[36px] text-xs">Retry</button>
        </div>
      )}

      {/* Info */}
      <div className="bg-green-900/20 border border-green-800/50 rounded-lg px-4 py-3 flex gap-3">
        <Info size={16} className="text-green-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-[var(--text-secondary)]">
          Matches tyre description + remarks against 13 failure categories using keyword patterns. Confidence reflects keyword match strength. Review, adjust dropdowns if needed, then approve.
        </p>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Data cleaning views" className="flex gap-0 border-b border-[var(--card-border)] overflow-x-auto">
        {[
          ['pending', 'Pending Classification'],
          ['cleaned', 'Already Cleaned'],
          ['quality', 'Quality Intelligence'],
        ].map(([val, label]) => (
          <button key={val} type="button" role="tab" aria-selected={tab === val} onClick={() => { setTab(val); setPage(0) }}
            className={`min-h-[44px] px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${tab === val ? 'border-green-500 text-green-400' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
            {val === 'quality' && qualityScore !== null ? (
              <span className="flex items-center gap-1.5">
                {label}
                <span className={`text-xs font-bold ${scoreColor(qualityScore)}`}>{qualityScore}%</span>
              </span>
            ) : label}
          </button>
        ))}
      </div>

      {/* ── Pending tab ───────────────────────────────────────────────────── */}
      {tab === 'pending' && (
        <>
          <div className="flex flex-wrap gap-3 items-center">
            <select aria-label="Filter by site" className="input w-auto min-h-[44px]" value={filterSite} onChange={e => { setFilterSite(e.target.value); setPage(0) }}>
              <option value="">All Sites</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select aria-label="Filter by confidence" className="input w-auto min-h-[44px]" value={filterConf} onChange={e => { setFilterConf(e.target.value); setPage(0) }}>
              <option value="">All Confidence</option>
              {['High', 'Medium', 'Low'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="flex-1" />
            {totalPending > 0 && !loadError && (
              <button type="button" onClick={() => setShowApproveAllConfirm(true)} disabled={saving}
                className="btn-secondary flex items-center gap-2 text-sm min-h-[44px] disabled:opacity-40">
                <CheckCheck size={15} className="text-green-400" aria-hidden="true" /> Approve All {totalPending.toLocaleString()}
              </button>
            )}
            <span className="text-sm text-[var(--text-muted)]" aria-live="polite">{selected.size} selected</span>
            <button type="button" onClick={() => allSelected ? setSelected(new Set()) : setSelected(new Set(classified.map(r => r.id)))}
              className="btn-secondary min-h-[44px] px-3 text-sm">
              {allSelected ? 'Clear' : 'Select All'}
            </button>
            <button type="button" onClick={approveSelected} disabled={selected.size === 0 || saving}
              className="btn-primary flex items-center gap-2 min-h-[44px] disabled:opacity-40">
              <Check size={15} aria-hidden="true" /> {saving ? 'Saving...' : `Approve ${selected.size > 0 ? selected.size : ''}`}
            </button>
          </div>

          {approveAllProgress && (
            <div className="card" role="status">
              <p className="text-[var(--text-primary)] font-medium mb-2">Approving all pending records...</p>
              <div className="h-3 bg-[var(--input-bg)] rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${approveAllProgress.total ? (approveAllProgress.done / approveAllProgress.total) * 100 : 0}%` }} />
              </div>
              <p className="text-[var(--text-muted)] text-sm mt-1">{approveAllProgress.done.toLocaleString()} / {approveAllProgress.total.toLocaleString()}</p>
            </div>
          )}

          {loading ? (
            <SkeletonTable rows={6} cols={4} />
          ) : loadError ? (
            <div role="alert" className="card text-center py-12 space-y-3">
              <p className="text-red-400">Pending records could not be loaded.</p>
              <button type="button" onClick={loadPending} className="btn-secondary min-h-[44px] inline-flex items-center gap-2"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
            </div>
          ) : classified.length === 0 ? (
            <div className="card text-center py-16 text-[var(--text-muted)]">
              {totalPending === 0
                ? <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-green-400" aria-hidden="true" /> All records have been classified.</span>
                : 'No records match the current filter.'}
            </div>
          ) : (
            <div className="space-y-2">
              {classified.map(r => {
                const result = getResult(r.id)
                const isSel  = selected.has(r.id)
                return (
                  <div key={r.id} role="checkbox" aria-checked={isSel} tabIndex={0}
                    aria-label={`Select ${r.asset_no || 'record'}: ${r.original_description || 'no description'}`}
                    className={`card cursor-pointer transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${isSel ? 'border-green-600/60 bg-green-950/20' : 'hover:border-[var(--card-border)]'}`}
                    onClick={() => toggleSelect(r.id)}
                    onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSelect(r.id) } }}>
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      <div className={`w-5 h-5 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${isSel ? 'bg-green-700 border-green-600' : 'border-[var(--input-border)]'}`} aria-hidden="true">
                        {isSel && <Check size={12} className="text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap gap-2 items-baseline">
                          <span className="font-medium text-[var(--text-primary)] break-words">{r.original_description || 'No description'}</span>
                          {r.original_remarks && r.original_remarks !== r.original_description && (
                            <span className="text-[var(--text-muted)] text-xs">"{r.original_remarks.slice(0, 80)}{r.original_remarks.length > 80 ? '...' : ''}"</span>
                          )}
                        </div>
                        <div className="flex gap-3 mt-1 text-xs text-[var(--text-muted)] flex-wrap">
                          {r.site && <span className="inline-flex items-center gap-1"><MapPin size={11} aria-hidden="true" /> {r.site}</span>}
                          {r.asset_no && <span className="inline-flex items-center gap-1"><Truck size={11} aria-hidden="true" /> {r.asset_no}</span>}
                          {r.brand && <span className="inline-flex items-center gap-1"><Tag size={11} aria-hidden="true" /> {r.brand}</span>}
                          {r.issue_date && <span className="inline-flex items-center gap-1"><Calendar size={11} aria-hidden="true" /> {formatDate(r.issue_date)}</span>}
                        </div>
                        {result?.matched_keywords?.length > 0 && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {result.matched_keywords.map((kw, i) => <span key={i} className="bg-[var(--input-bg)] text-[var(--text-muted)] text-xs px-1.5 py-0.5 rounded">{kw}</span>)}
                          </div>
                        )}
                        {result?.remarks_cleaned && (
                          <div className="mt-2 text-xs text-[var(--text-muted)] bg-[var(--input-bg)]/60 rounded px-3 py-1.5">
                            <span className="text-[var(--text-dim)] mr-1">Cleaned:</span>{result.remarks_cleaned}
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0 flex flex-row sm:flex-col flex-wrap gap-2 sm:items-end" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                        <span className={`text-xs font-medium ${CONFIDENCE_COLOUR[result?.confidence] ?? 'text-[var(--text-muted)]'}`}>{result?.confidence ?? 'Unknown'} confidence</span>
                        <select aria-label={`Category for ${r.asset_no || 'record'}`} className="bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-primary)] text-xs rounded px-2 min-h-[36px] focus:outline-none focus:ring-2 focus:ring-green-600"
                          value={result?.category ?? ''} onChange={e => setOverride(r.id, 'category', e.target.value)}>
                          {ALL_CATEGORY_LABELS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select aria-label={`Risk level for ${r.asset_no || 'record'}`} className="bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-primary)] text-xs rounded px-2 min-h-[36px] focus:outline-none focus:ring-2 focus:ring-green-600"
                          value={result?.risk_level ?? ''} onChange={e => setOverride(r.id, 'risk_level', e.target.value)}>
                          {['Critical', 'High', 'Medium', 'Low'].map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                        <span className={`badge text-xs ${RISK_COLOUR[result?.risk_level] ?? 'bg-[var(--input-bg)] text-[var(--text-muted)]'}`}>{result?.risk_level ?? 'Unrated'}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-[var(--text-muted)]">
                Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalPending)} of {totalPending.toLocaleString()} pending
              </p>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Previous page" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary min-h-[44px] min-w-[44px] px-3 disabled:opacity-40"><ChevronLeft size={16} aria-hidden="true" /></button>
                <span className="text-sm text-[var(--text-muted)]">Page {page + 1} of {totalPages}</span>
                <button type="button" aria-label="Next page" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn-secondary min-h-[44px] min-w-[44px] px-3 disabled:opacity-40"><ChevronRight size={16} aria-hidden="true" /></button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Cleaned tab ───────────────────────────────────────────────────── */}
      {tab === 'cleaned' && (
        <>
          {!loading && !loadError && cleanedRecords.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Cleaned register summary">
              <StatTile label="Cleaned records" value={cleanedSummary.total.toLocaleString()} tone="accent" icon={CheckCircle2} index={0} />
              <StatTile label="Critical or high risk" value={cleanedSummary.highRisk.toLocaleString()}
                sub={cleanedSummary.highRiskPct === null ? 'N/A' : `${cleanedSummary.highRiskPct}% of cleaned`} tone={cleanedSummary.highRisk > 0 ? 'crit' : 'neutral'} icon={ShieldAlert} index={1} />
              <StatTile label="Unrated" value={cleanedSummary.byRisk.Unrated.toLocaleString()} tone={cleanedSummary.byRisk.Unrated > 0 ? 'warn' : 'neutral'} icon={AlertTriangle} index={2} />
              <StatTile label="Top category" value={cleanedSummary.topCategory?.category ?? 'N/A'}
                sub={cleanedSummary.topCategory ? `${cleanedSummary.topCategory.count.toLocaleString()} records` : undefined} tone="info" icon={BarChart2} index={3} />
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex-1 min-w-48">
              <span className="sr-only">Search cleaned records</span>
              <input
                className="input w-full min-h-[44px]"
                placeholder="Search asset, brand, site, serial, category..."
                value={cleanedSearch}
                onChange={e => setCleanedSearch(e.target.value)}
              />
            </label>
            <select aria-label="Filter cleaned records by site" className="input w-auto min-h-[44px]" value={filterSite} onChange={e => setFilterSite(e.target.value)}>
              <option value="">All Sites</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-[var(--text-muted)]" aria-live="polite">{cleanedSelected.size} selected</span>
            {cleanedSelected.size > 0 && (
              <>
                <button type="button" onClick={runReclassify} disabled={saving}
                  className="btn-secondary flex items-center gap-2 text-sm min-h-[44px] disabled:opacity-40">
                  <RefreshCw size={14} aria-hidden="true" /> Re-classify {cleanedSelected.size} Selected
                </button>
                <button type="button" onClick={() => setCleanedSelected(new Set())} className="min-h-[44px] px-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm">Clear</button>
              </>
            )}
          </div>

          {reclassifyProposed && (
            <div className="card">
              <h3 className="font-semibold text-[var(--text-primary)] mb-3">Proposed Re-classification</h3>
              <div className="space-y-2 mb-4">
                {reclassifyProposed.map(r => (
                  <div key={r.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg text-sm ${r.changed ? 'bg-yellow-900/20 border border-yellow-700/40' : 'bg-[var(--input-bg)]/40'}`}>
                    <span className="text-[var(--text-secondary)] flex-1 min-w-0">{r.original_description?.slice(0, 60) ?? 'No description'}</span>
                    {r.changed ? (
                      <>
                        <span className="text-[var(--text-muted)] line-through text-xs">{r.orig_category ?? 'N/A'}</span>
                        <span className="text-yellow-500 text-xs">to {r.category}</span>
                        <span className="text-[var(--text-muted)] line-through text-xs">{r.orig_risk ?? 'N/A'}</span>
                        <span className="text-yellow-500 text-xs">to {r.risk_level}</span>
                      </>
                    ) : (
                      <span className="text-[var(--text-muted)] text-xs">No change</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={approveReclassify} disabled={saving} className="btn-primary flex items-center gap-2 min-h-[44px] disabled:opacity-50">
                  <Check size={15} aria-hidden="true" /> {saving ? 'Saving...' : 'Apply Changes'}
                </button>
                <button type="button" onClick={() => setReclassifyProposed(null)} className="btn-secondary min-h-[44px]">Cancel</button>
              </div>
            </div>
          )}

          <EnterpriseTable
            columns={cleanedColumns}
            data={cleanedFiltered}
            getRowId={r => String(r.id)}
            loading={loading}
            error={loadError ? 'Cleaned records could not be loaded.' : null}
            onRetry={loadCleaned}
            emptyMessage={cleanedSearch ? 'No cleaned records match this search.' : 'No cleaned records yet'}
            enableGlobalFilter={false}
            enableRowSelection
            rowSelection={cleanedRowSelection}
            onRowSelectionChange={onCleanedSelection}
            initialPageSize={50}
            viewKey="data-cleaning-cleaned"
            exportFileName={reportFileName('Cleaned Tyre Records', activeCountry || 'All')}
            reportMeta={{ title: 'Cleaned Tyre Records' }}
          />
        </>
      )}

      {/* ── Quality Intelligence tab ─────────────────────────────────────── */}
      {tab === 'quality' && (
        <div className="space-y-4">
          {/* Quality Score Dashboard */}
          <div className={`card border ${qualityScore !== null ? scoreBg(qualityScore) : 'border-[var(--card-border)]'}`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="relative w-20 h-20 flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90" role="img" aria-label={qualityScore === null ? 'Quality score not available' : `Quality score ${qualityScore} percent`}>
                    <circle cx="18" cy="18" r="15.9" fill="none" style={{ stroke: 'var(--input-bg)' }} strokeWidth="3.8" />
                    {qualityScore !== null && (
                      <circle
                        cx="18" cy="18" r="15.9" fill="none"
                        stroke={{ good: '#22c55e', warn: '#eab308', crit: '#ef4444' }[scoreBand(qualityScore)]}
                        strokeWidth="3.8"
                        strokeDasharray={`${qualityScore} ${100 - qualityScore}`}
                        strokeLinecap="round"
                      />
                    )}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    {qualityScore !== null ? (
                      <span className={`text-lg font-bold ${scoreColor(qualityScore)}`}>{qualityScore}%</span>
                    ) : (
                      <span className="text-[var(--text-muted)] text-sm">{qiLoading ? '...' : 'N/A'}</span>
                    )}
                  </div>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[var(--text-primary)]">Overall Data Quality Score</h2>
                  <p className="text-[var(--text-muted)] text-sm">
                    {qiLoading && qualityScore === null ? 'Computing across 7 quality checks...' : scoreVerdict(qualityScore, { incomplete: qualityIncomplete || totalRecords === null, totalRecords })}
                  </p>
                  {prevScore && qualityScore !== null && (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-[var(--text-muted)]">vs last cached:</span>
                      <span className={`text-xs font-semibold ${qualityScore > prevScore.score ? 'text-green-400' : qualityScore < prevScore.score ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
                        {qualityScore > prevScore.score ? `+${qualityScore - prevScore.score}` : qualityScore < prevScore.score ? `${qualityScore - prevScore.score}` : '0'} pts
                      </span>
                      <span className="text-xs text-[var(--text-dim)]">({formatDate(prevScore.ts)})</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {[
                  { label: 'Total Records', value: totalRecords === null ? (qiLoading ? '...' : 'N/A') : totalRecords.toLocaleString(), color: 'text-[var(--text-primary)]' },
                  { label: 'Serial Issues', value: serialIssues?.error ? 'N/A' : (serialIssues?.count ?? '...'), color: (serialIssues?.count ?? 0) > 0 ? 'text-yellow-400' : 'text-green-400' },
                  { label: 'Duplicates', value: duplicateSerial?.error ? 'N/A' : (duplicateSerial?.groupCount ?? '...'), color: (duplicateSerial?.groupCount ?? 0) > 0 ? 'text-orange-400' : 'text-green-400' },
                  { label: 'Odometer Errors', value: odometerIssues?.error ? 'N/A' : (odometerIssues?.count ?? '...'), color: (odometerIssues?.count ?? 0) > 0 ? 'text-red-400' : 'text-green-400' },
                ].map(s => (
                  <div key={s.label} className="card py-2 px-3 text-center bg-[var(--input-bg)]/60 border-[var(--card-border)] min-w-[90px]">
                    <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-[var(--text-muted)]">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={runAllChecks}
                  disabled={qiLoading}
                  className="btn-secondary flex items-center gap-2 text-sm min-h-[44px] disabled:opacity-40"
                >
                  <RefreshCw size={14} className={qiLoading ? 'animate-spin' : ''} aria-hidden="true" />
                  {qiLoading ? 'Scanning...' : 'Re-scan'}
                </button>
                <button type="button" onClick={() => exportQualityIssues('excel')} disabled={qiLoading}
                  className="btn-secondary flex items-center gap-2 text-sm min-h-[44px] disabled:opacity-40">
                  <FileSpreadsheet size={14} aria-hidden="true" /> Excel
                </button>
                <button type="button" onClick={() => exportQualityIssues('pdf')} disabled={qiLoading}
                  className="btn-secondary flex items-center gap-2 text-sm min-h-[44px] disabled:opacity-40">
                  <FileText size={14} aria-hidden="true" /> PDF
                </button>
              </div>
            </div>

            {/* Weight breakdown */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {QUALITY_CHECKS.map(w => {
                const check = qualityChecks[w.key]
                const count = check ? checkBadCount(w.key, check) : null
                const state = check?.error ? 'failed' : check?.notApplicable ? 'na' : count === null ? 'loading' : count > 0 ? 'issues' : 'clean'
                return (
                  <div key={w.key} className="bg-[var(--input-bg)]/60 rounded-lg px-2 py-2 text-center">
                    <p className={`text-sm font-semibold ${state === 'issues' ? 'text-yellow-500' : state === 'clean' ? 'text-green-500' : state === 'failed' ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
                      {state === 'loading' ? <span className="animate-pulse">...</span> : state === 'failed' || state === 'na' ? 'N/A' : count.toLocaleString()}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{w.label}</p>
                    <p className="text-xs text-[var(--text-dim)] mt-0.5">{state === 'failed' ? 'Could not check' : state === 'na' ? 'Not applicable' : `${w.weight}% weight`}</p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Check 1: Incorrect Tyre Serials ──────────────────────────── */}
          <IssueSection
            icon={Hash}
            title="Incorrect Tyre Serials"
            count={serialIssues?.count ?? 0}
            failed={!!serialIssues?.error}
            notApplicable={!!serialIssues?.notApplicable}
            onRetry={checkSerialIssues}
            loading={checkLoading.serialIssues}
            color="text-yellow-400"
            bgColor="bg-yellow-900/20 border-yellow-700/40"
          >
            <p className="text-xs text-[var(--text-muted)] mb-3">Flags: empty/null serials, fewer than 4 characters, non-alphanumeric patterns, serial reuse across vehicles.</p>
            {serialIssues?.issues && (
              <ExpandableList
                items={serialIssues.issues}
                renderItem={(r) => (
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-[var(--input-bg)]/50 rounded-lg text-xs">
                    <span className="text-[var(--text-primary)] font-mono">{r.tyre_serial || <span className="text-[var(--text-dim)] italic">empty</span>}</span>
                    <span className="text-[var(--text-muted)]">{r.asset_no ?? 'N/A'}</span>
                    <span className="text-[var(--text-muted)]">{r.site ?? 'N/A'}</span>
                    <span className="text-[var(--text-dim)]">{r.issue_date ?? ''}</span>
                    <span className="ml-auto text-yellow-400 font-medium">{r.issue_type}</span>
                  </div>
                )}
              />
            )}
          </IssueSection>

          {/* ── Check 2: Duplicate Tyre Numbers ──────────────────────────── */}
          <IssueSection
            icon={Layers}
            title="Duplicate Active Tyre Serials"
            count={duplicateSerial?.groupCount ?? 0}
            failed={!!duplicateSerial?.error}
            notApplicable={!!duplicateSerial?.notApplicable}
            onRetry={checkDuplicateSerials}
            loading={checkLoading.duplicateSerial}
            color="text-orange-400"
            bgColor="bg-orange-900/20 border-orange-700/40"
            action={isAdmin && duplicateSerial?.groupCount > 0 && (
              <span className="text-xs text-[var(--text-muted)]">{duplicateSerial.affectedCount} affected records</span>
            )}
          >
            <p className="text-xs text-[var(--text-muted)] mb-3">Active records (km_at_removal is null) sharing the same serial number across multiple vehicles.</p>
            {duplicateSerial?.groups && (
              <ExpandableList
                items={duplicateSerial.groups}
                renderItem={(g) => (
                  <div className="px-3 py-2 bg-[var(--input-bg)]/50 rounded-lg text-xs border border-orange-900/30">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-orange-300 font-semibold">{g.serial}</span>
                      <span className="text-[var(--text-muted)]">{g.count} records</span>
                      <span className="text-[var(--text-muted)]">Vehicles: {g.asset_nos.join(', ')}</span>
                      {isAdmin && (
                        <button
                          onClick={() => setDupModal({ group: g })}
                          className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-orange-900/30 text-orange-300 border border-orange-700/40 hover:bg-orange-900/60 transition-colors"
                        >
                          <Edit2 size={11} /> Assign Unique Serials
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {g.records.map(r => (
                        <span key={r.id} className="bg-gray-700/50 px-2 py-0.5 rounded text-[var(--text-muted)]">
                          {r.asset_no ?? 'N/A'} · {r.issue_date ?? 'no date'}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              />
            )}
          </IssueSection>

          {/* ── Check 3: Invalid Pressure Readings ───────────────────────── */}
          <IssueSection
            icon={Gauge}
            title="Invalid Pressure Readings"
            count={invalidPressure?.notApplicable ? 0 : (invalidPressure?.count ?? 0)}
            failed={!!invalidPressure?.error}
            notApplicable={!!invalidPressure?.notApplicable}
            onRetry={checkInvalidPressure}
            loading={checkLoading.invalidPressure}
            color="text-red-400"
            bgColor="bg-red-900/20 border-red-700/40"
          >
            {invalidPressure?.notApplicable ? (
              <p className="text-xs text-[var(--text-muted)]">pressure_reading column not found in tyre_records, not applicable for this dataset.</p>
            ) : (
              <>
                <p className="text-xs text-[var(--text-muted)] mb-3">Pressure readings outside the valid range of 20-200 PSI.</p>
                {invalidPressure?.records && (
                  <ExpandableList
                    items={invalidPressure.records}
                    renderItem={(r) => (
                      <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-[var(--input-bg)]/50 rounded-lg text-xs">
                        <span className="text-[var(--text-primary)] font-mono">{r.tyre_serial || 'N/A'}</span>
                        <span className="text-[var(--text-muted)]">{r.asset_no ?? 'N/A'}</span>
                        <span className="text-[var(--text-muted)]">{r.site ?? 'N/A'}</span>
                        <span className="ml-auto text-red-400 font-semibold">{r.pressure_reading} PSI</span>
                      </div>
                    )}
                  />
                )}
              </>
            )}
          </IssueSection>

          {/* ── Check 4: Missing Tread Depth Readings ────────────────────── */}
          <IssueSection
            icon={Activity}
            title="Missing Tread Depth Readings"
            count={missingTread?.notApplicable ? 0 : (missingTread?.count ?? 0)}
            failed={!!missingTread?.error}
            notApplicable={!!missingTread?.notApplicable}
            onRetry={checkMissingTread}
            loading={checkLoading.missingTread}
            color="text-yellow-400"
            bgColor="bg-yellow-900/20 border-yellow-700/40"
          >
            {missingTread?.notApplicable ? (
              <p className="text-xs text-[var(--text-muted)]">tread_depth column not found, not applicable for this dataset.</p>
            ) : (
              <>
                <div className="flex items-center gap-4 mb-3">
                  <p className="text-xs text-[var(--text-muted)]">Records where tread_depth is null or 0.</p>
                  {missingTread?.pct !== null && missingTread?.pct !== undefined && (
                    <span className="text-sm font-semibold text-yellow-400">{missingTread.pct}% missing</span>
                  )}
                </div>
                {missingTread?.bySite?.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-[var(--text-dim)] mb-1.5">By site:</p>
                    <div className="flex flex-wrap gap-2">
                      {missingTread.bySite.map(s => (
                        <span key={s.site} className="px-2 py-1 bg-yellow-900/20 border border-yellow-800/40 rounded text-xs text-yellow-300">
                          {s.site}: {s.count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {missingTread?.records && (
                  <ExpandableList
                    items={missingTread.records}
                    renderItem={(r) => (
                      <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-[var(--input-bg)]/50 rounded-lg text-xs">
                        <span className="text-[var(--text-primary)] font-mono">{r.tyre_serial || 'N/A'}</span>
                        <span className="text-[var(--text-muted)]">{r.asset_no ?? 'N/A'}</span>
                        <span className="text-[var(--text-muted)]">{r.site ?? 'N/A'}</span>
                        <span className="text-[var(--text-dim)]">{r.issue_date ?? ''}</span>
                        <span className="ml-auto text-yellow-400">tread: {r.tread_depth ?? 'null'}</span>
                      </div>
                    )}
                  />
                )}
              </>
            )}
          </IssueSection>

          {/* ── Check 5: Missing Inspection Records ──────────────────────── */}
          <IssueSection
            icon={ClipboardList}
            title="Vehicles Missing Inspections (Last 30 Days)"
            count={missingInspect?.notApplicable ? 0 : (missingInspect?.count ?? 0)}
            failed={!!missingInspect?.error}
            notApplicable={!!missingInspect?.notApplicable}
            onRetry={checkMissingInspections}
            loading={checkLoading.missingInspect}
            color="text-blue-400"
            bgColor="bg-blue-900/20 border-blue-700/40"
          >
            {missingInspect?.notApplicable ? (
              <p className="text-xs text-[var(--text-muted)]">Inspections table not found, check not applicable for this database configuration.</p>
            ) : (
              <>
                <p className="text-xs text-[var(--text-muted)] mb-3">Vehicles with active tyres that have no inspection record in the last 30 days.</p>
                {missingInspect?.asset_nos && (
                  <ExpandableList
                    items={missingInspect.asset_nos}
                    renderItem={(a) => (
                      <div className="flex items-center gap-3 px-3 py-2 bg-[var(--input-bg)]/50 rounded-lg text-xs">
                        <Truck size={13} className="text-blue-400 flex-shrink-0" />
                        <span className="text-[var(--text-primary)] font-medium">{a}</span>
                        <span className="ml-auto text-blue-400">No inspection in 30 days</span>
                      </div>
                    )}
                  />
                )}
              </>
            )}
          </IssueSection>

          {/* ── Check 6: Inconsistent Odometer Readings ──────────────────── */}
          <IssueSection
            icon={BarChart2}
            title="Inconsistent Odometer Readings"
            count={odometerIssues?.count ?? 0}
            failed={!!odometerIssues?.error}
            notApplicable={!!odometerIssues?.notApplicable}
            onRetry={checkOdometerIssues}
            loading={checkLoading.odometer}
            color="text-red-400"
            bgColor="bg-red-900/20 border-red-700/40"
          >
            <p className="text-xs text-[var(--text-muted)] mb-3">Covers: removal &lt; fitment (physically impossible), life &gt; 500,000 km, non-sequential fitment per vehicle.</p>
            {odometerIssues?.issues && (
              <ExpandableList
                items={odometerIssues.issues}
                renderItem={(r) => (
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-[var(--input-bg)]/50 rounded-lg text-xs border border-red-900/20">
                    <span className="text-[var(--text-primary)] font-mono">{r.tyre_serial || 'N/A'}</span>
                    <span className="text-[var(--text-muted)]">{r.asset_no ?? 'N/A'}</span>
                    <span className="text-[var(--text-muted)]">Fit: {parseFloat(r.km_at_fitment)?.toLocaleString() ?? 'N/A'}</span>
                    <span className="text-[var(--text-muted)]">Rem: {parseFloat(r.km_at_removal)?.toLocaleString() ?? 'N/A'}</span>
                    <span className={`ml-auto font-medium text-xs px-2 py-0.5 rounded border ${severityBadge(r.severity)}`}>{r.issue_type}</span>
                    {isAdmin && (
                      <button
                        onClick={() => { setOdomModal({ record: r }); setOdomEdits({ [r.id]: { km_at_fitment: r.km_at_fitment, km_at_removal: r.km_at_removal } }) }}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700/60 text-[var(--text-secondary)] border border-gray-600 hover:bg-gray-700 transition-colors"
                      >
                        <Edit2 size={11} /> Edit
                      </button>
                    )}
                  </div>
                )}
              />
            )}
          </IssueSection>

          {/* ── Check 7: Unrealistic Tyre Life Values ────────────────────── */}
          <IssueSection
            icon={ShieldAlert}
            title="Unrealistic Tyre Life Values"
            count={unrealisticLife?.count ?? 0}
            failed={!!unrealisticLife?.error}
            notApplicable={!!unrealisticLife?.notApplicable}
            onRetry={checkUnrealisticLife}
            loading={checkLoading.unrealisticLife}
            color="text-orange-400"
            bgColor="bg-orange-900/20 border-orange-700/40"
          >
            <p className="text-xs text-[var(--text-muted)] mb-3">Life &lt; 500 km or &gt; 400,000 km; cost outside 50-50,000 range (if column exists).</p>
            {unrealisticLife?.issues && (
              <ExpandableList
                items={unrealisticLife.issues}
                renderItem={(r) => (
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-[var(--input-bg)]/50 rounded-lg text-xs border border-orange-900/20">
                    <span className="text-[var(--text-primary)] font-mono">{r.tyre_serial || 'N/A'}</span>
                    <span className="text-[var(--text-muted)]">{r.asset_no ?? 'N/A'}</span>
                    {r.life !== undefined && <span className="text-[var(--text-muted)]">{r.life?.toLocaleString()} km life</span>}
                    {r.cost_per_tyre && <span className="text-[var(--text-muted)]">Cost: {parseFloat(r.cost_per_tyre)?.toLocaleString()}</span>}
                    <span className="text-orange-400 font-medium ml-auto text-right">{r.issue_type}</span>
                    {isAdmin && (
                      <button
                        onClick={() => markNeedsReview(r)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700/60 text-[var(--text-secondary)] border border-gray-600 hover:bg-gray-700 transition-colors"
                      >
                        <AlertTriangle size={11} /> Mark Review
                      </button>
                    )}
                  </div>
                )}
              />
            )}
          </IssueSection>
        </div>
      )}

      {/* ── Approve-all confirm modal ──────────────────────────────────────── */}
      <Modal
        open={showApproveAllConfirm}
        onClose={() => setShowApproveAllConfirm(false)}
        title="Approve All Pending Records"
        size="sm"
        footer={(
          <div className="flex flex-wrap gap-3 justify-end">
            <button type="button" onClick={() => setShowApproveAllConfirm(false)} className="btn-secondary min-h-[44px]">Cancel</button>
            <button type="button" onClick={approveAll} className="btn-primary flex items-center gap-2 min-h-[44px]">
              <CheckCheck size={15} aria-hidden="true" /> Approve All
            </button>
          </div>
        )}
      >
        <p className="text-[var(--text-muted)] text-sm mb-4">
          The classifier will run on all <strong className="text-[var(--text-primary)]">{totalPending.toLocaleString()}</strong> pending records and save the results automatically.
          {filterSite && ` Only records from "${filterSite}" will be processed.`}
        </p>
        <p className="text-yellow-500 text-sm">Low-confidence classifications will still be saved, with no manual review step.</p>
      </Modal>

      {/* ── Duplicate serial fix modal ──────────────────────────────────────── */}
      {dupModal && (
        <Modal open title={`Fix Duplicate Serial: ${dupModal.group.serial}`} onClose={() => setDupModal(null)} size="lg">
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-muted)]">
              This serial appears on <strong className="text-[var(--text-primary)]">{dupModal.group.count}</strong> active records across vehicles: <strong className="text-[var(--text-primary)]">{dupModal.group.asset_nos.join(', ')}</strong>.
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Enter the verified physical serial only for records that need correction. Blank fields keep the existing value.
            </p>
            <div className="bg-[var(--input-bg)]/60 rounded-lg p-3 space-y-1">
              {dupModal.group.records.map((r, i) => (
                <div key={r.id} className="flex items-center gap-3 text-xs">
                  <span className="text-[var(--text-muted)] w-5">{i + 1}.</span>
                  <span className="text-[var(--text-muted)]">{r.asset_no ?? 'N/A'}</span>
                  <span className="text-[var(--text-dim)]">{r.issue_date ?? ''}</span>
                  <input className="input ml-auto" aria-label={`Verified serial for ${r.asset_no ?? r.id}, record ${i + 1}`}
                    value={dupNewSerial[r.id] ?? ''} placeholder={r.tyre_serial ?? ''}
                    onChange={event => setDupNewSerial(previous => ({ ...previous, [r.id]: event.target.value }))} />
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => fixDuplicateSerial(dupModal.group, dupNewSerial)}
                disabled={fixingDup || !Object.values(dupNewSerial).some(value => value.trim())}
                className="btn-primary flex items-center gap-2 disabled:opacity-40"
              >
                <Check size={15} /> {fixingDup ? 'Saving...' : 'Apply'}
              </button>
              <button onClick={() => setDupModal(null)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Odometer edit modal ──────────────────────────────────────────────── */}
      {odomModal && (
        <Modal open title="Edit Odometer Values" onClose={() => { setOdomModal(null); setOdomEdits({}) }} size="md">
          <div className="space-y-4">
            <div className="bg-[var(--input-bg)]/60 rounded-lg p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Record ID</span><span className="text-[var(--text-primary)] font-mono">{odomModal.record.id}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Serial</span><span className="text-[var(--text-primary)]">{odomModal.record.tyre_serial || 'N/A'}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Asset</span><span className="text-[var(--text-primary)]">{odomModal.record.asset_no || 'N/A'}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Issue</span><span className="text-red-400">{odomModal.record.issue_type}</span></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="dc-odo-fit" className="block text-sm text-[var(--text-muted)] mb-1">km at Fitment</label>
                <input
                  id="dc-odo-fit"
                  type="number"
                  className="input w-full"
                  value={odomEdits[odomModal.record.id]?.km_at_fitment ?? odomModal.record.km_at_fitment ?? ''}
                  onChange={e => setOdomEdits(prev => ({ ...prev, [odomModal.record.id]: { ...(prev[odomModal.record.id] ?? {}), km_at_fitment: e.target.value } }))}
                />
              </div>
              <div>
                <label htmlFor="dc-odo-rem" className="block text-sm text-[var(--text-muted)] mb-1">km at Removal</label>
                <input
                  id="dc-odo-rem"
                  type="number"
                  className="input w-full"
                  value={odomEdits[odomModal.record.id]?.km_at_removal ?? odomModal.record.km_at_removal ?? ''}
                  onChange={e => setOdomEdits(prev => ({ ...prev, [odomModal.record.id]: { ...(prev[odomModal.record.id] ?? {}), km_at_removal: e.target.value } }))}
                />
              </div>
            </div>
            {(() => {
              const v = odometerEditVerdict(odomEdits[odomModal.record.id]?.km_at_fitment, odomEdits[odomModal.record.id]?.km_at_removal)
              if (!v) return null
              const tone = { crit: 'text-red-400', warn: 'text-yellow-500', good: 'text-green-500' }[v.tone]
              return <p className={`text-xs font-medium ${tone}`} aria-live="polite">Computed life: {v.life.toLocaleString()} km, {v.note}</p>
            })()}
            <div className="flex gap-3">
              <button
                onClick={() => fixOdometerRecord(odomModal.record)}
                disabled={fixingOdom}
                className="btn-primary flex items-center gap-2 disabled:opacity-40"
              >
                <Check size={15} /> {fixingOdom ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={() => { setOdomModal(null); setOdomEdits({}) }} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
