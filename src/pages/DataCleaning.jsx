import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { batchClassify, RISK_COLOUR, CONFIDENCE_COLOUR, ALL_CATEGORY_LABELS } from '../lib/tyreClassifier'
import {
  Wand2, Info, ChevronLeft, ChevronRight, Check, X, RefreshCw, CheckCheck,
  ShieldAlert, AlertTriangle, BarChart2, Gauge, ClipboardList, Truck,
  Activity, ChevronDown, ChevronUp, Edit2, Hash, Layers, CheckCircle2,
} from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'

const PAGE_SIZE = 50

// ─── Quality Score helpers ────────────────────────────────────────────────────
const QUALITY_WEIGHTS = {
  odometer:        0.25,
  duplicateSerial: 0.20,
  missingTread:    0.15,
  invalidPressure: 0.15,
  serialIssues:    0.10,
  unrealisticLife: 0.10,
  missingInspect:  0.05,
}

function computeQualityScore(checks, totalRecords) {
  if (!totalRecords) return 100
  const ratios = {
    odometer:        checks.odometer?.issues?.length        ?? 0,
    duplicateSerial: checks.duplicateSerial?.affectedCount  ?? 0,
    missingTread:    checks.missingTread?.count             ?? 0,
    invalidPressure: checks.invalidPressure?.count          ?? 0,
    serialIssues:    checks.serialIssues?.count             ?? 0,
    unrealisticLife: checks.unrealisticLife?.count          ?? 0,
    missingInspect:  checks.missingInspect?.count           ?? 0,
  }
  let penalty = 0
  Object.entries(QUALITY_WEIGHTS).forEach(([k, w]) => {
    const badRatio = Math.min((ratios[k] ?? 0) / Math.max(totalRecords, 1), 1)
    penalty += w * badRatio
  })
  return Math.round(Math.max(0, (1 - penalty) * 100))
}

function scoreColor(s) {
  if (s >= 85) return 'text-green-400'
  if (s >= 70) return 'text-yellow-400'
  return 'text-red-400'
}
function scoreBg(s) {
  if (s >= 85) return 'bg-green-900/30 border-green-700/50'
  if (s >= 70) return 'bg-yellow-900/30 border-yellow-700/50'
  return 'bg-red-900/30 border-red-700/50'
}

// ─── IssueSection component ───────────────────────────────────────────────────
function IssueSection({ icon: Icon, title, count, color = 'text-yellow-400', bgColor = 'bg-yellow-900/20 border-yellow-700/40', children, loading, action }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="card">
      <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => count > 0 && setExpanded(e => !e)}>
        <div className="flex items-center gap-3">
          <Icon size={18} className={color} />
          <span className="font-medium text-white">{title}</span>
          {loading ? (
            <span className="text-xs text-gray-500 animate-pulse">Checking…</span>
          ) : (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${count > 0 ? bgColor + ' ' + color : 'bg-green-900/20 border-green-700/40 text-green-400'}`}>
              {count > 0 ? `${count} issue${count !== 1 ? 's' : ''}` : 'Clean'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {action}
          {count > 0 && (expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />)}
        </div>
      </div>
      {expanded && count > 0 && (
        <div className="mt-3 border-t border-gray-800 pt-3">
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
          onClick={() => setShow(s => s + pageSize)}
          className="mt-3 text-xs text-blue-400 hover:text-blue-300 underline"
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
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-xl text-sm font-medium
      ${type === 'error' ? 'bg-red-900/90 border-red-700 text-red-200' : 'bg-green-900/90 border-green-700 text-green-200'}`}>
      {type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
      {message}
      <button onClick={onClose}><X size={14} /></button>
    </div>
  )
}

// ─── Modal scaffold ────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
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
  const [saving, setSaving]                 = useState(false)
  const [saveCount, setSaveCount]           = useState(0)
  const [filterConf, setFilterConf]         = useState('')
  const [filterSite, setFilterSite]         = useState('')
  const [sites, setSites]                   = useState([])
  const [stats, setStats]                   = useState({ pending: 0, cleaned: 0 })
  const [cleanedSearch, setCleanedSearch]   = useState('')
  const [cleanedPage, setCleanedPage]       = useState(1)
  const CLEANED_PAGE_SIZE = 50

  const [approveAllProgress, setApproveAllProgress] = useState(null)
  const [showApproveAllConfirm, setShowApproveAllConfirm] = useState(false)

  const [cleanedSelected, setCleanedSelected]     = useState(new Set())
  const [reclassifyProposed, setReclassifyProposed] = useState(null)

  // ── Quality Intelligence state ──────────────────────────────────────────────
  const [qiLoading, setQiLoading]         = useState(false)
  const [totalRecords, setTotalRecords]   = useState(0)
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

  // ── Effects ─────────────────────────────────────────────────────────────────
  useEffect(() => { loadStats(); loadSites() }, [saveCount, activeCountry])
  useEffect(() => { tab === 'pending' ? loadPending() : tab === 'cleaned' ? loadCleaned() : null }, [tab, page, filterConf, filterSite, saveCount, activeCountry])
  useEffect(() => { if (tab === 'quality') runAllChecks() }, [tab, activeCountry])

  // Load previous score from localStorage
  useEffect(() => {
    const cached = localStorage.getItem('tp_dq_score_prev')
    if (cached) setPrevScore(JSON.parse(cached))
  }, [])

  // ── Existing loaders ─────────────────────────────────────────────────────────
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

  // ── Quality Intelligence checks ─────────────────────────────────────────────
  async function runAllChecks() {
    setQiLoading(true)
    setCheckLoading({ serialIssues: true, duplicateSerial: true, invalidPressure: true, missingTread: true, missingInspect: true, odometer: true, unrealisticLife: true })

    // Get total record count
    let countQ = supabase.from('tyre_records').select('id', { count: 'exact', head: true })
    if (activeCountry !== 'All') countQ = countQ.eq('country', activeCountry)
    const { count: total } = await countQ
    setTotalRecords(total ?? 0)

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
  }

  async function checkSerialIssues() {
    setCheckLoading(p => ({ ...p, serialIssues: true }))
    try {
      let q = supabase.from('tyre_records').select('id, tyre_serial, asset_no, site, issue_date')
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      const { data } = await q

      const issues = (data ?? []).filter(r => {
        const s = r.tyre_serial
        if (!s || s.trim() === '') return true
        if (s.trim().length < 4) return true
        if (!/[a-zA-Z0-9]/.test(s)) return true
        return false
      })

      // Detect serial reuse: same serial across different asset_nos
        const serialMap = {}
      ;(data ?? []).forEach(r => {
        if (!r.tyre_serial || r.tyre_serial.trim() === '') return
        const key = r.tyre_serial.trim()
        if (!serialMap[key]) serialMap[key] = new Set()
        serialMap[key].add(r.asset_no)
      })
      const reuseIssues = (data ?? []).filter(r => {
        if (!r.tyre_serial) return false
        const key = r.tyre_serial.trim()
        return serialMap[key] && serialMap[key].size > 1
      }).map(r => ({ ...r, issue_type: 'Serial reused across vehicles' }))

      const combined = [
        ...issues.map(r => ({ ...r, issue_type: !r.tyre_serial || r.tyre_serial.trim() === '' ? 'Empty/null serial' : r.tyre_serial.trim().length < 4 ? 'Too short (<4 chars)' : 'Non-alphanumeric pattern' })),
        ...reuseIssues.filter(r => !issues.find(i => i.id === r.id)),
      ]

      setSerialIssues({ count: combined.length, issues: combined })
    } catch {
      setSerialIssues({ count: 0, issues: [], error: true })
    }
    setCheckLoading(p => ({ ...p, serialIssues: false }))
  }

  async function checkDuplicateSerials() {
    setCheckLoading(p => ({ ...p, duplicateSerial: true }))
    try {
      let q = supabase.from('tyre_records').select('id, tyre_serial, asset_no, site, issue_date, km_at_removal').is('km_at_removal', null)
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      const { data } = await q

      const groups = {}
      ;(data ?? []).forEach(r => {
        if (!r.tyre_serial || r.tyre_serial.trim() === '') return
        const key = r.tyre_serial.trim()
        if (!groups[key]) groups[key] = []
        groups[key].push(r)
      })

      const dupeGroups = Object.entries(groups)
        .filter(([, records]) => records.length > 1)
        .map(([serial, records]) => ({
          serial,
          count: records.length,
          records,
          asset_nos: [...new Set(records.map(r => r.asset_no).filter(Boolean))],
          dates: records.map(r => r.issue_date).filter(Boolean),
        }))

      const affectedCount = dupeGroups.reduce((s, g) => s + g.count, 0)
      setDuplicateSerial({ groups: dupeGroups, affectedCount, groupCount: dupeGroups.length })
    } catch {
      setDuplicateSerial({ groups: [], affectedCount: 0, groupCount: 0, error: true })
    }
    setCheckLoading(p => ({ ...p, duplicateSerial: false }))
  }

  async function checkInvalidPressure() {
    setCheckLoading(p => ({ ...p, invalidPressure: true }))
    try {
      // Try pressure_reading column; gracefully handle if it doesn't exist
      let q = supabase.from('tyre_records').select('id, tyre_serial, asset_no, site, pressure_reading, issue_date').not('pressure_reading', 'is', null)
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      const { data, error } = await q

      if (error && error.message?.includes('column')) {
        setInvalidPressure({ count: 0, records: [], notApplicable: true })
        setCheckLoading(p => ({ ...p, invalidPressure: false }))
        return
      }

      const invalid = (data ?? []).filter(r => {
        const v = parseFloat(r.pressure_reading)
        return isNaN(v) || v < 20 || v > 200
      })
      setInvalidPressure({ count: invalid.length, records: invalid })
    } catch {
      setInvalidPressure({ count: 0, records: [], error: true })
    }
    setCheckLoading(p => ({ ...p, invalidPressure: false }))
  }

  async function checkMissingTread() {
    setCheckLoading(p => ({ ...p, missingTread: true }))
    try {
      // Records that look like inspections but lack tread depth
      let q = supabase.from('tyre_records').select('id, tyre_serial, asset_no, site, tread_depth, issue_date')
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      const { data, error } = await q

      if (error && error.message?.includes('column')) {
        setMissingTread({ count: 0, pct: 0, bySite: [], notApplicable: true })
        setCheckLoading(p => ({ ...p, missingTread: false }))
        return
      }

      const all = data ?? []
      const missing = all.filter(r => r.tread_depth === null || r.tread_depth === 0)
      const bySiteMap = {}
      missing.forEach(r => {
        const s = r.site ?? 'Unknown'
        bySiteMap[s] = (bySiteMap[s] ?? 0) + 1
      })
      const bySite = Object.entries(bySiteMap).sort((a, b) => b[1] - a[1]).map(([site, count]) => ({ site, count }))
      const pct = all.length > 0 ? ((missing.length / all.length) * 100).toFixed(1) : 0
      setMissingTread({ count: missing.length, pct, bySite, records: missing })
    } catch {
      setMissingTread({ count: 0, pct: 0, bySite: [], records: [], error: true })
    }
    setCheckLoading(p => ({ ...p, missingTread: false }))
  }

  async function checkMissingInspections() {
    setCheckLoading(p => ({ ...p, missingInspect: true }))
    try {
      // Get all distinct asset_nos from tyre_records
      let q = supabase.from('tyre_records').select('asset_no').not('asset_no', 'is', null)
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      const { data: tyreData } = await q
      const allAssets = [...new Set((tyreData ?? []).map(r => r.asset_no))]

      // Try inspections table - graceful fallback
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const cutoff = thirtyDaysAgo.toISOString().split('T')[0]

      const { data: inspData, error: inspError } = await supabase
        .from('inspections')
        .select('asset_no, inspection_date')
        .gte('inspection_date', cutoff)

      if (inspError) {
        // inspections table may not exist
        setMissingInspect({ count: 0, asset_nos: [], notApplicable: true })
        setCheckLoading(p => ({ ...p, missingInspect: false }))
        return
      }

      const inspectedAssets = new Set((inspData ?? []).map(r => r.asset_no))
      const missing = allAssets.filter(a => !inspectedAssets.has(a))
      setMissingInspect({ count: missing.length, asset_nos: missing })
    } catch {
      setMissingInspect({ count: 0, asset_nos: [], error: true })
    }
    setCheckLoading(p => ({ ...p, missingInspect: false }))
  }

  async function checkOdometerIssues() {
    setCheckLoading(p => ({ ...p, odometer: true }))
    try {
      let q = supabase.from('tyre_records')
        .select('id, tyre_serial, asset_no, site, km_at_fitment, km_at_removal, issue_date')
        .not('km_at_removal', 'is', null)
        .not('km_at_fitment', 'is', null)
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      const { data } = await q

      const issues = []

      ;(data ?? []).forEach(r => {
        const fit = parseFloat(r.km_at_fitment)
        const rem = parseFloat(r.km_at_removal)
        if (isNaN(fit) || isNaN(rem)) return
        if (rem < fit) {
          issues.push({ ...r, issue_type: 'Removal < Fitment (impossible)', severity: 'critical' })
        } else if (rem - fit > 500000) {
          issues.push({ ...r, issue_type: `Life ${(rem - fit).toLocaleString()} km exceeds 500,000 km`, severity: 'high' })
        }
      })

      // Non-sequential check: group by asset_no, sort by km_at_fitment
      const byAsset = {}
      ;(data ?? []).forEach(r => {
        if (!r.asset_no) return
        if (!byAsset[r.asset_no]) byAsset[r.asset_no] = []
        byAsset[r.asset_no].push(r)
      })
      Object.values(byAsset).forEach(records => {
        const sorted = [...records].sort((a, b) => parseFloat(a.km_at_fitment) - parseFloat(b.km_at_fitment))
        sorted.forEach((r, i) => {
          if (i === 0) return
          const prev = sorted[i - 1]
          const prevRem = parseFloat(prev.km_at_removal)
          const curFit = parseFloat(r.km_at_fitment)
          if (!isNaN(prevRem) && !isNaN(curFit) && curFit < prevRem) {
            if (!issues.find(x => x.id === r.id)) {
              issues.push({ ...r, issue_type: `Fitment (${curFit.toLocaleString()}) < previous removal (${prevRem.toLocaleString()})`, severity: 'medium' })
            }
          }
        })
      })

      setOdometerIssues({ count: issues.length, issues })
    } catch {
      setOdometerIssues({ count: 0, issues: [], error: true })
    }
    setCheckLoading(p => ({ ...p, odometer: false }))
  }

  async function checkUnrealisticLife() {
    setCheckLoading(p => ({ ...p, unrealisticLife: true }))
    try {
      let q = supabase.from('tyre_records')
        .select('id, tyre_serial, asset_no, site, km_at_fitment, km_at_removal, cost_per_tyre, issue_date')
        .not('km_at_removal', 'is', null)
        .not('km_at_fitment', 'is', null)
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      const { data } = await q

      const issues = [];
      ;(data ?? []).forEach(r => {
        const fit = parseFloat(r.km_at_fitment)
        const rem = parseFloat(r.km_at_removal)
        if (isNaN(fit) || isNaN(rem)) return
        const life = rem - fit
        if (life >= 0 && life < 500) {
          issues.push({ ...r, life, issue_type: `Life only ${life} km - likely entry error` })
        } else if (life > 400000) {
          issues.push({ ...r, life, issue_type: `Life ${life.toLocaleString()} km - unrealistically high` })
        }
      })

      // Cost anomalies if column exists
      const costIssues = (data ?? []).filter(r => {
        if (r.cost_per_tyre === null || r.cost_per_tyre === undefined) return false
        const c = parseFloat(r.cost_per_tyre)
        return !isNaN(c) && (c > 50000 || c < 50)
      }).map(r => ({ ...r, issue_type: `Cost ${parseFloat(r.cost_per_tyre).toLocaleString()} - outside normal range (50-50,000)` }))

      const combined = [...issues, ...costIssues.filter(r => !issues.find(i => i.id === r.id))]
      setUnrealisticLife({ count: combined.length, issues: combined })
    } catch {
      setUnrealisticLife({ count: 0, issues: [], error: true })
    }
    setCheckLoading(p => ({ ...p, unrealisticLife: false }))
  }

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
    const score = computeQualityScore(checks, totalRecords)
    const now = new Date().toISOString()

    // Cache previous before overwriting
    const storedThis = localStorage.getItem('tp_dq_score_current')
    if (storedThis) {
      const parsed = JSON.parse(storedThis)
      // If stored timestamp is more than 6 days ago treat as "last week"
      const diff = (Date.now() - new Date(parsed.ts).getTime()) / (1000 * 60 * 60 * 24)
      if (diff >= 1) {
        localStorage.setItem('tp_dq_score_prev', storedThis)
        setPrevScore(parsed)
      }
    }

    localStorage.setItem('tp_dq_score_current', JSON.stringify({ score, ts: now }))
    setQualityScore(score)
  }, [serialIssues, duplicateSerial, invalidPressure, missingTread, missingInspect, odometerIssues, unrealisticLife, totalRecords])

  // ── Bulk fix handlers ────────────────────────────────────────────────────────
  async function fixDuplicateSerial(group, newSerial) {
    if (!newSerial?.trim()) return
    setFixingDup(true)
    try {
      const ids = group.records.map(r => r.id)
      // Assign the new serial to all but the first (which keeps original)
      const toUpdate = ids.slice(1).map((id, i) => ({
        id,
        tyre_serial: `${newSerial.trim()}-${String(i + 2).padStart(2, '0')}`,
      }))
      for (const rec of toUpdate) {
        const { error } = await supabase.from('tyre_records').update({ tyre_serial: rec.tyre_serial }).eq('id', rec.id)
        if (error) throw error
      }
      setToast({ message: `Updated ${toUpdate.length} serial(s) successfully`, type: 'success' })
      setDupModal(null)
      await checkDuplicateSerials()
    } catch (e) {
      setToast({ message: `Update failed: ${e.message}`, type: 'error' })
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
      const { error } = await supabase.from('tyre_records').update(updates).eq('id', record.id)
      if (error) throw error
      setToast({ message: 'Odometer values updated', type: 'success' })
      setOdomModal(null)
      setOdomEdits({})
      await checkOdometerIssues()
    } catch (e) {
      setToast({ message: `Update failed: ${e.message}`, type: 'error' })
    }
    setFixingOdom(false)
  }

  async function markNeedsReview(record) {
    try {
      const { error } = await supabase.from('tyre_records').update({ remarks: `[NEEDS REVIEW] ${record.remarks ?? ''}`.trim() }).eq('id', record.id)
      if (error) throw error
      setToast({ message: `Record ${record.id} marked as Needs Review`, type: 'success' })
      await checkUnrealisticLife()
    } catch (e) {
      setToast({ message: `Update failed: ${e.message}`, type: 'error' })
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

  async function approveAll() {
    setShowApproveAllConfirm(false)
    setSaving(true)

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

  // ── Derived ─────────────────────────────────────────────────────────────────
  const totalPages = Math.ceil(totalPending / PAGE_SIZE)
  const allSelected = classified.length > 0 && classified.every(r => selected.has(r.id))

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

  // Severity badge
  function severityBadge(s) {
    if (s === 'critical') return 'bg-red-900/40 text-red-300 border-red-700/50'
    if (s === 'high') return 'bg-orange-900/40 text-orange-300 border-orange-700/50'
    return 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50'
  }

  // ── Quality Intelligence tab ─────────────────────────────────────────────────
  const allChecksLoaded = !Object.values(checkLoading).some(Boolean)

  // ── Duplicate modal state ────────────────────────────────────────────────────
  const [dupNewSerial, setDupNewSerial] = useState('')
  useEffect(() => { if (dupModal) setDupNewSerial(dupModal.group.serial) }, [dupModal])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Data Cleaning Engine"
          subtitle="Rule-based auto-classification + Quality Intelligence - zero AI tokens required"
          icon={Wand2}
        />
        <div className="flex gap-3">
          <div className="card py-2 px-4 text-center">
            <p className="text-xl font-bold text-yellow-400">{stats.pending.toLocaleString()}</p>
            <p className="text-xs text-gray-400">Pending</p>
          </div>
          <div className="card py-2 px-4 text-center">
            <p className="text-xl font-bold text-green-400">{stats.cleaned.toLocaleString()}</p>
            <p className="text-xs text-gray-400">Cleaned</p>
          </div>
          {qualityScore !== null && (
            <div className={`card py-2 px-4 text-center border ${scoreBg(qualityScore)}`}>
              <p className={`text-xl font-bold ${scoreColor(qualityScore)}`}>{qualityScore}%</p>
              <p className="text-xs text-gray-400">Quality</p>
            </div>
          )}
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
        {[
          ['pending', 'Pending Classification'],
          ['cleaned', 'Already Cleaned'],
          ['quality', 'Quality Intelligence'],
        ].map(([val, label]) => (
          <button key={val} onClick={() => { setTab(val); setPage(0) }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === val ? 'border-green-500 text-green-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
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

          {approveAllProgress && (
            <div className="card">
              <p className="text-white font-medium mb-2">Approving all pending records…</p>
              <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${(approveAllProgress.done / approveAllProgress.total) * 100}%` }} />
              </div>
              <p className="text-gray-400 text-sm mt-1">{approveAllProgress.done.toLocaleString()} / {approveAllProgress.total.toLocaleString()}</p>
            </div>
          )}

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
                          <span className="font-medium text-white">{r.original_description || '-'}</span>
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
                        <span className={`text-xs font-medium ${CONFIDENCE_COLOUR[result?.confidence] ?? 'text-gray-500'}`}>{result?.confidence ?? '-'} confidence</span>
                        <select className="bg-gray-800 border border-gray-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-600"
                          value={result?.category ?? ''} onChange={e => setOverride(r.id, 'category', e.target.value)}>
                          {ALL_CATEGORY_LABELS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select className="bg-gray-800 border border-gray-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-600"
                          value={result?.risk_level ?? ''} onChange={e => setOverride(r.id, 'risk_level', e.target.value)}>
                          {['Critical', 'High', 'Medium', 'Low'].map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                        <span className={`badge text-xs ${RISK_COLOUR[result?.risk_level] ?? 'bg-gray-800 text-gray-400'}`}>{result?.risk_level ?? '-'}</span>
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
                Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalPending)} of {totalPending.toLocaleString()} pending
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
          <div className="flex items-center gap-3 flex-wrap">
            <input
              className="input flex-1 min-w-48"
              placeholder="Search asset, brand, site…"
              value={cleanedSearch}
              onChange={e => { setCleanedSearch(e.target.value); setCleanedPage(1) }}
            />
          </div>

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

          {reclassifyProposed && (
            <div className="card">
              <h3 className="font-semibold text-white mb-3">Proposed Re-classification</h3>
              <div className="space-y-2 mb-4">
                {reclassifyProposed.map(r => (
                  <div key={r.id} className={`flex items-center gap-4 px-3 py-2 rounded-lg text-sm ${r.changed ? 'bg-yellow-900/20 border border-yellow-700/40' : 'bg-gray-800/40'}`}>
                    <span className="text-gray-300 flex-1">{r.original_description?.slice(0, 60) ?? '-'}</span>
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
                        <td className="table-cell font-medium text-white">{r.asset_no ?? '-'}</td>
                        <td className="table-cell">{r.brand ?? '-'}</td>
                        <td className="table-cell">{r.site ?? '-'}</td>
                        <td className="table-cell">{r.category ?? '-'}</td>
                        <td className="table-cell">{r.risk_level ? <span className={`badge ${RISK_COLOUR[r.risk_level]}`}>{r.risk_level}</span> : '-'}</td>
                        <td className="table-cell text-gray-400 text-xs max-w-xs truncate">{r.remarks_cleaned ?? '-'}</td>
                        <td className="py-2 pr-3 text-gray-500 text-xs max-w-48 truncate" title={r.remarks || r.description}>
                          {(r.remarks || r.description || '-').slice(0, 60)}{(r.remarks || r.description || '').length > 60 ? '…' : ''}
                        </td>
                        <td className="table-cell text-gray-500">{r.issue_date ?? '-'}</td>
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

      {/* ── Quality Intelligence tab ─────────────────────────────────────── */}
      {tab === 'quality' && (
        <div className="space-y-4">
          {/* Quality Score Dashboard */}
          <div className={`card border ${qualityScore !== null ? scoreBg(qualityScore) : 'border-gray-700'}`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="relative w-20 h-20 flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#374151" strokeWidth="3.8" />
                    {qualityScore !== null && (
                      <circle
                        cx="18" cy="18" r="15.9" fill="none"
                        stroke={qualityScore >= 85 ? '#22c55e' : qualityScore >= 70 ? '#eab308' : '#ef4444'}
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
                      <span className="text-gray-500 text-sm animate-pulse">…</span>
                    )}
                  </div>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Overall Data Quality Score</h2>
                  <p className="text-gray-400 text-sm">
                    {qualityScore === null ? 'Computing across 7 quality checks…' :
                      qualityScore >= 85 ? 'Fleet data quality is healthy' :
                      qualityScore >= 70 ? 'Moderate quality issues detected - action recommended' :
                      'Significant data quality problems - immediate attention required'}
                  </p>
                  {prevScore && qualityScore !== null && (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-gray-500">vs last cached:</span>
                      <span className={`text-xs font-semibold ${qualityScore > prevScore.score ? 'text-green-400' : qualityScore < prevScore.score ? 'text-red-400' : 'text-gray-400'}`}>
                        {qualityScore > prevScore.score ? `+${qualityScore - prevScore.score}` : qualityScore < prevScore.score ? `${qualityScore - prevScore.score}` : '0'} pts
                      </span>
                      <span className="text-xs text-gray-600">({new Date(prevScore.ts).toLocaleDateString()})</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {[
                  { label: 'Total Records', value: totalRecords.toLocaleString(), color: 'text-blue-400' },
                  { label: 'Serial Issues', value: serialIssues?.count ?? '…', color: (serialIssues?.count ?? 0) > 0 ? 'text-yellow-400' : 'text-green-400' },
                  { label: 'Duplicates', value: duplicateSerial?.groupCount ?? '…', color: (duplicateSerial?.groupCount ?? 0) > 0 ? 'text-orange-400' : 'text-green-400' },
                  { label: 'Odometer Errors', value: odometerIssues?.count ?? '…', color: (odometerIssues?.count ?? 0) > 0 ? 'text-red-400' : 'text-green-400' },
                ].map(s => (
                  <div key={s.label} className="card py-2 px-3 text-center bg-gray-800/60 border-gray-700 min-w-[90px]">
                    <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-gray-500">{s.label}</p>
                  </div>
                ))}
              </div>

              <button
                onClick={runAllChecks}
                disabled={qiLoading}
                className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-40"
              >
                <RefreshCw size={14} className={qiLoading ? 'animate-spin' : ''} />
                {qiLoading ? 'Scanning…' : 'Re-scan'}
              </button>
            </div>

            {/* Weight breakdown */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {[
                { key: 'odometer', label: 'Odometer', weight: 25, count: odometerIssues?.count },
                { key: 'duplicateSerial', label: 'Duplicates', weight: 20, count: duplicateSerial?.affectedCount },
                { key: 'missingTread', label: 'Tread', weight: 15, count: missingTread?.count },
                { key: 'invalidPressure', label: 'Pressure', weight: 15, count: invalidPressure?.count },
                { key: 'serialIssues', label: 'Serials', weight: 10, count: serialIssues?.count },
                { key: 'unrealisticLife', label: 'Tyre Life', weight: 10, count: unrealisticLife?.count },
                { key: 'missingInspect', label: 'Inspections', weight: 5, count: missingInspect?.count },
              ].map(w => (
                <div key={w.key} className="bg-gray-800/60 rounded-lg px-2 py-2 text-center">
                  <p className={`text-sm font-semibold ${(w.count ?? 0) > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {w.count === null || w.count === undefined ? <span className="text-gray-600 animate-pulse">…</span> : w.count}
                  </p>
                  <p className="text-xs text-gray-500">{w.label}</p>
                  <p className="text-xs text-gray-700 mt-0.5">{w.weight}% weight</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Check 1: Incorrect Tyre Serials ──────────────────────────── */}
          <IssueSection
            icon={Hash}
            title="Incorrect Tyre Serials"
            count={serialIssues?.count ?? 0}
            loading={checkLoading.serialIssues}
            color="text-yellow-400"
            bgColor="bg-yellow-900/20 border-yellow-700/40"
          >
            <p className="text-xs text-gray-500 mb-3">Flags: empty/null serials, fewer than 4 characters, non-alphanumeric patterns, serial reuse across vehicles.</p>
            {serialIssues?.issues && (
              <ExpandableList
                items={serialIssues.issues}
                renderItem={(r) => (
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-gray-800/50 rounded-lg text-xs">
                    <span className="text-white font-mono">{r.tyre_serial || <span className="text-gray-600 italic">empty</span>}</span>
                    <span className="text-gray-500">{r.asset_no ?? '-'}</span>
                    <span className="text-gray-500">{r.site ?? '-'}</span>
                    <span className="text-gray-600">{r.issue_date ?? ''}</span>
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
            loading={checkLoading.duplicateSerial}
            color="text-orange-400"
            bgColor="bg-orange-900/20 border-orange-700/40"
            action={isAdmin && duplicateSerial?.groupCount > 0 && (
              <span className="text-xs text-gray-500">{duplicateSerial.affectedCount} affected records</span>
            )}
          >
            <p className="text-xs text-gray-500 mb-3">Active records (km_at_removal is null) sharing the same serial number across multiple vehicles.</p>
            {duplicateSerial?.groups && (
              <ExpandableList
                items={duplicateSerial.groups}
                renderItem={(g) => (
                  <div className="px-3 py-2 bg-gray-800/50 rounded-lg text-xs border border-orange-900/30">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-orange-300 font-semibold">{g.serial}</span>
                      <span className="text-gray-500">{g.count} records</span>
                      <span className="text-gray-500">Vehicles: {g.asset_nos.join(', ')}</span>
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
                        <span key={r.id} className="bg-gray-700/50 px-2 py-0.5 rounded text-gray-400">
                          {r.asset_no ?? '-'} · {r.issue_date ?? 'no date'}
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
            loading={checkLoading.invalidPressure}
            color="text-red-400"
            bgColor="bg-red-900/20 border-red-700/40"
          >
            {invalidPressure?.notApplicable ? (
              <p className="text-xs text-gray-500">pressure_reading column not found in tyre_records - not applicable for this dataset.</p>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-3">Pressure readings outside the valid range of 20-200 PSI.</p>
                {invalidPressure?.records && (
                  <ExpandableList
                    items={invalidPressure.records}
                    renderItem={(r) => (
                      <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-gray-800/50 rounded-lg text-xs">
                        <span className="text-white font-mono">{r.tyre_serial || '-'}</span>
                        <span className="text-gray-500">{r.asset_no ?? '-'}</span>
                        <span className="text-gray-500">{r.site ?? '-'}</span>
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
            loading={checkLoading.missingTread}
            color="text-yellow-400"
            bgColor="bg-yellow-900/20 border-yellow-700/40"
          >
            {missingTread?.notApplicable ? (
              <p className="text-xs text-gray-500">tread_depth column not found - not applicable for this dataset.</p>
            ) : (
              <>
                <div className="flex items-center gap-4 mb-3">
                  <p className="text-xs text-gray-500">Records where tread_depth is null or 0.</p>
                  {missingTread?.pct !== undefined && (
                    <span className="text-sm font-semibold text-yellow-400">{missingTread.pct}% missing</span>
                  )}
                </div>
                {missingTread?.bySite?.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-600 mb-1.5">By site:</p>
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
                      <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-gray-800/50 rounded-lg text-xs">
                        <span className="text-white font-mono">{r.tyre_serial || '-'}</span>
                        <span className="text-gray-500">{r.asset_no ?? '-'}</span>
                        <span className="text-gray-500">{r.site ?? '-'}</span>
                        <span className="text-gray-600">{r.issue_date ?? ''}</span>
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
            loading={checkLoading.missingInspect}
            color="text-blue-400"
            bgColor="bg-blue-900/20 border-blue-700/40"
          >
            {missingInspect?.notApplicable ? (
              <p className="text-xs text-gray-500">Inspections table not found - check not applicable for this database configuration.</p>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-3">Vehicles with active tyres that have no inspection record in the last 30 days.</p>
                {missingInspect?.asset_nos && (
                  <ExpandableList
                    items={missingInspect.asset_nos}
                    renderItem={(a) => (
                      <div className="flex items-center gap-3 px-3 py-2 bg-gray-800/50 rounded-lg text-xs">
                        <Truck size={13} className="text-blue-400 flex-shrink-0" />
                        <span className="text-white font-medium">{a}</span>
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
            loading={checkLoading.odometer}
            color="text-red-400"
            bgColor="bg-red-900/20 border-red-700/40"
          >
            <p className="text-xs text-gray-500 mb-3">Covers: removal &lt; fitment (physically impossible), life &gt; 500,000 km, non-sequential fitment per vehicle.</p>
            {odometerIssues?.issues && (
              <ExpandableList
                items={odometerIssues.issues}
                renderItem={(r) => (
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-gray-800/50 rounded-lg text-xs border border-red-900/20">
                    <span className="text-white font-mono">{r.tyre_serial || '-'}</span>
                    <span className="text-gray-500">{r.asset_no ?? '-'}</span>
                    <span className="text-gray-400">Fit: {parseFloat(r.km_at_fitment)?.toLocaleString() ?? '-'}</span>
                    <span className="text-gray-400">Rem: {parseFloat(r.km_at_removal)?.toLocaleString() ?? '-'}</span>
                    <span className={`ml-auto font-medium text-xs px-2 py-0.5 rounded border ${severityBadge(r.severity)}`}>{r.issue_type}</span>
                    {isAdmin && (
                      <button
                        onClick={() => { setOdomModal({ record: r }); setOdomEdits({ [r.id]: { km_at_fitment: r.km_at_fitment, km_at_removal: r.km_at_removal } }) }}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700/60 text-gray-300 border border-gray-600 hover:bg-gray-700 transition-colors"
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
            loading={checkLoading.unrealisticLife}
            color="text-orange-400"
            bgColor="bg-orange-900/20 border-orange-700/40"
          >
            <p className="text-xs text-gray-500 mb-3">Life &lt; 500 km or &gt; 400,000 km; cost outside 50-50,000 range (if column exists).</p>
            {unrealisticLife?.issues && (
              <ExpandableList
                items={unrealisticLife.issues}
                renderItem={(r) => (
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-gray-800/50 rounded-lg text-xs border border-orange-900/20">
                    <span className="text-white font-mono">{r.tyre_serial || '-'}</span>
                    <span className="text-gray-500">{r.asset_no ?? '-'}</span>
                    {r.life !== undefined && <span className="text-gray-400">{r.life?.toLocaleString()} km life</span>}
                    {r.cost_per_tyre && <span className="text-gray-400">Cost: {parseFloat(r.cost_per_tyre)?.toLocaleString()}</span>}
                    <span className="text-orange-400 font-medium ml-auto text-right">{r.issue_type}</span>
                    {isAdmin && (
                      <button
                        onClick={() => markNeedsReview(r)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700/60 text-gray-300 border border-gray-600 hover:bg-gray-700 transition-colors"
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
      {showApproveAllConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowApproveAllConfirm(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-2">Approve All Pending Records</h2>
            <p className="text-gray-400 text-sm mb-4">
              The classifier will run on all <strong className="text-white">{stats.pending.toLocaleString()}</strong> pending records and save the results automatically.
              {filterSite && ` Only records from "${filterSite}" will be processed.`}
            </p>
            <p className="text-yellow-300 text-sm mb-4">Low-confidence classifications will still be saved - no manual review step.</p>
            <div className="flex gap-3">
              <button onClick={approveAll} className="btn-primary flex items-center gap-2">
                <CheckCheck size={15} /> Approve All
              </button>
              <button onClick={() => setShowApproveAllConfirm(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Duplicate serial fix modal ──────────────────────────────────────── */}
      {dupModal && (
        <Modal title={`Fix Duplicate Serial: ${dupModal.group.serial}`} onClose={() => setDupModal(null)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              This serial appears on <strong className="text-white">{dupModal.group.count}</strong> active records across vehicles: <strong className="text-white">{dupModal.group.asset_nos.join(', ')}</strong>.
            </p>
            <p className="text-xs text-gray-500">
              The first record keeps the original serial. All subsequent records will be assigned <code className="text-orange-300">{dupNewSerial}-02</code>, <code className="text-orange-300">{dupNewSerial}-03</code>, etc.
            </p>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Base Serial for Assignments</label>
              <input
                className="input w-full"
                value={dupNewSerial}
                onChange={e => setDupNewSerial(e.target.value)}
                placeholder="Enter base serial…"
              />
            </div>
            <div className="bg-gray-800/60 rounded-lg p-3 space-y-1">
              {dupModal.group.records.map((r, i) => (
                <div key={r.id} className="flex items-center gap-3 text-xs">
                  <span className="text-gray-500 w-5">{i + 1}.</span>
                  <span className="text-gray-400">{r.asset_no ?? '-'}</span>
                  <span className="text-gray-600">{r.issue_date ?? ''}</span>
                  <span className="ml-auto font-mono text-orange-300">
                    {i === 0 ? dupModal.group.serial : `${dupNewSerial}-${String(i + 1).padStart(2, '0')}`}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => fixDuplicateSerial(dupModal.group, dupNewSerial)}
                disabled={fixingDup || !dupNewSerial.trim()}
                className="btn-primary flex items-center gap-2 disabled:opacity-40"
              >
                <Check size={15} /> {fixingDup ? 'Saving…' : 'Apply'}
              </button>
              <button onClick={() => setDupModal(null)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Odometer edit modal ──────────────────────────────────────────────── */}
      {odomModal && (
        <Modal title="Edit Odometer Values" onClose={() => { setOdomModal(null); setOdomEdits({}) }}>
          <div className="space-y-4">
            <div className="bg-gray-800/60 rounded-lg p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-gray-500">Record ID</span><span className="text-white font-mono">{odomModal.record.id}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Serial</span><span className="text-white">{odomModal.record.tyre_serial || '-'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Asset</span><span className="text-white">{odomModal.record.asset_no || '-'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Issue</span><span className="text-red-400">{odomModal.record.issue_type}</span></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">km at Fitment</label>
                <input
                  type="number"
                  className="input w-full"
                  value={odomEdits[odomModal.record.id]?.km_at_fitment ?? odomModal.record.km_at_fitment ?? ''}
                  onChange={e => setOdomEdits(prev => ({ ...prev, [odomModal.record.id]: { ...(prev[odomModal.record.id] ?? {}), km_at_fitment: e.target.value } }))}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">km at Removal</label>
                <input
                  type="number"
                  className="input w-full"
                  value={odomEdits[odomModal.record.id]?.km_at_removal ?? odomModal.record.km_at_removal ?? ''}
                  onChange={e => setOdomEdits(prev => ({ ...prev, [odomModal.record.id]: { ...(prev[odomModal.record.id] ?? {}), km_at_removal: e.target.value } }))}
                />
              </div>
            </div>
            {(() => {
              const f = parseFloat(odomEdits[odomModal.record.id]?.km_at_fitment)
              const r = parseFloat(odomEdits[odomModal.record.id]?.km_at_removal)
              if (!isNaN(f) && !isNaN(r)) {
                const life = r - f
                return (
                  <p className={`text-xs font-medium ${life < 0 ? 'text-red-400' : life < 500 ? 'text-yellow-400' : life > 400000 ? 'text-yellow-400' : 'text-green-400'}`}>
                    Computed life: {life.toLocaleString()} km {life < 0 ? '- still invalid' : life >= 500 && life <= 400000 ? '- looks valid' : '- unusual value'}
                  </p>
                )
              }
              return null
            })()}
            <div className="flex gap-3">
              <button
                onClick={() => fixOdometerRecord(odomModal.record)}
                disabled={fixingOdom}
                className="btn-primary flex items-center gap-2 disabled:opacity-40"
              >
                <Check size={15} /> {fixingOdom ? 'Saving…' : 'Save Changes'}
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
