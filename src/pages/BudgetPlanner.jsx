import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
  ChevronDown, ChevronUp, Download, RefreshCw, Loader2, FileSpreadsheet,
  FileText, Edit2, Save, X, Sliders, BarChart2, PieChart as PieIcon,
  Calendar, Target, Zap, ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ────────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#ec4899','#14b8a6','#f97316','#6366f1','#84cc16',
]
const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', font: { size: 11 } } },
    tooltip: {
      backgroundColor: '#1f2937',
      titleColor: '#f3f4f6',
      bodyColor: '#9ca3af',
      borderColor: 'rgba(59,130,246,0.3)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
    y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v, cur = 'SAR') => {
  if (v == null || !isFinite(v)) return `${cur} 0`
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}${cur} ${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}${cur} ${(abs / 1_000).toFixed(1)}K`
  return `${sign}${cur} ${Math.round(abs).toLocaleString()}`
}
const fmtPct = v => (v == null || !isFinite(v) ? 'N/A' : `${v.toFixed(1)}%`)
const fmtCpk = (v, cur) => (v == null || !isFinite(v) ? 'N/A' : `${cur} ${v.toFixed(4)}/km`)

function linearRegression(data) {
  const n = data.length
  if (n < 2) return { slope: 0, intercept: data[0] ?? 0 }
  const xm = (n - 1) / 2
  const ym = data.reduce((s, v) => s + v, 0) / n
  const num = data.reduce((s, v, i) => s + (i - xm) * (v - ym), 0)
  const den = data.reduce((s, _, i) => s + (i - xm) ** 2, 0)
  const slope = den === 0 ? 0 : num / den
  return { slope, intercept: ym - slope * xm, predict: i => slope * i + ym - slope * xm }
}

function getQuarter(month) { return Math.floor(month / 3) }

// ── Main Component ────────────────────────────────────────────────────────────
export default function BudgetPlanner() {
  const { activeCurrency, activeCountry } = useSettings()
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'Admin'

  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(currentYear)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)

  // Site budget editing
  const [siteBudgets, setSiteBudgets] = useState({})
  const [editingSite, setEditingSite] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  // Annual budget inline edit
  const [editingAnnual, setEditingAnnual] = useState(false)
  const [annualEditValue, setAnnualEditValue] = useState('')

  // What-if
  const [cpkTarget, setCpkTarget] = useState(1.5)
  const [volumeChange, setVolumeChange] = useState(0)
  const [brandSwitchPct, setBrandSwitchPct] = useState(0)
  const [brandSwitchSaving, setBrandSwitchSaving] = useState(10)

  const storageKey = `tp_site_budgets_${selectedYear}`
  const annualStorageKey = `tp_annual_budget_${selectedYear}`

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchRecords = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let q = supabase
        .from('tyre_records')
        .select('id, asset_no, cost_per_tyre, issue_date, site, country, brand, position, risk_level, km_at_fitment, km_at_removal')
      if (activeCountry && activeCountry !== 'All') q = q.eq('country', activeCountry)
      const { data, error: err } = await q
      if (err) throw err
      setRecords(data ?? [])
    } catch (e) {
      setError(e.message ?? 'Failed to load tyre records')
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { fetchRecords() }, [fetchRecords])

  // Load persisted budgets
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      setSiteBudgets(stored ? JSON.parse(stored) : {})
    } catch { setSiteBudgets({}) }
  }, [storageKey])

  // ── Derived: normalise ─────────────────────────────────────────────────────
  const normalised = useMemo(() =>
    records.map(r => ({
      ...r,
      cost: parseFloat(r.cost_per_tyre) || 0,
      year: r.issue_date ? new Date(r.issue_date).getFullYear() : null,
      month: r.issue_date ? new Date(r.issue_date).getMonth() : null,
      kmFit: parseFloat(r.km_at_fitment) || 0,
      kmRem: parseFloat(r.km_at_removal) || 0,
    }))
  , [records])

  const yearRecords = useMemo(() => normalised.filter(r => r.year === selectedYear), [normalised, selectedYear])
  const prevYearRecords = useMemo(() => normalised.filter(r => r.year === selectedYear - 1), [normalised, selectedYear])

  // ── Monthly actuals ────────────────────────────────────────────────────────
  const monthlyActuals = useMemo(() => {
    const arr = Array(12).fill(0)
    yearRecords.forEach(r => { if (r.month != null) arr[r.month] += r.cost })
    return arr
  }, [yearRecords])

  const monthlyActualsPrev = useMemo(() => {
    const arr = Array(12).fill(0)
    prevYearRecords.forEach(r => { if (r.month != null) arr[r.month] += r.cost })
    return arr
  }, [prevYearRecords])

  // ── Sites ──────────────────────────────────────────────────────────────────
  const sites = useMemo(() => {
    const s = new Set(normalised.map(r => r.site).filter(Boolean))
    return [...s].sort()
  }, [normalised])

  // ── Annual budget ──────────────────────────────────────────────────────────
  const derivedAnnualFromHistorical = useMemo(() => {
    const yearsData = {}
    normalised.forEach(r => {
      if (r.year) yearsData[r.year] = (yearsData[r.year] || 0) + r.cost
    })
    const prevYears = Object.keys(yearsData)
      .map(Number)
      .filter(y => y < selectedYear)
      .sort()
      .slice(-3)
    if (prevYears.length === 0) return 0
    const avg = prevYears.reduce((s, y) => s + yearsData[y], 0) / prevYears.length
    return Math.round(avg * 1.05) // 5% growth assumption
  }, [normalised, selectedYear])

  const storedAnnual = useMemo(() => {
    try {
      const v = localStorage.getItem(annualStorageKey)
      return v ? parseFloat(v) : null
    } catch { return null }
  }, [annualStorageKey, selectedYear])

  const annualBudget = storedAnnual ?? derivedAnnualFromHistorical

  // ── YTD & projections ─────────────────────────────────────────────────────
  const currentMonth = selectedYear === currentYear ? new Date().getMonth() : 11
  const ytdActual = useMemo(() => monthlyActuals.slice(0, currentMonth + 1).reduce((s, v) => s + v, 0), [monthlyActuals, currentMonth])

  const monthlyBudget = annualBudget / 12
  const ytdBudget = monthlyBudget * (currentMonth + 1)
  const variance = ytdBudget - ytdActual
  const pctUsed = annualBudget > 0 ? (ytdActual / annualBudget) * 100 : 0
  const monthsElapsed = currentMonth + 1
  const monthlyRun = monthsElapsed > 0 ? ytdActual / monthsElapsed : 0
  const projectedYearEnd = monthlyRun * 12

  // ── Monthly budget array (even distribution) ───────────────────────────────
  const monthlyBudgets = useMemo(() => Array(12).fill(monthlyBudget), [monthlyBudget])

  // ── Site allocation ────────────────────────────────────────────────────────
  const siteData = useMemo(() => {
    const map = {}
    yearRecords.forEach(r => {
      if (!r.site) return
      if (!map[r.site]) map[r.site] = { site: r.site, actual: 0, count: 0 }
      map[r.site].actual += r.cost
      map[r.site].count += 1
    })
    const prevMap = {}
    prevYearRecords.forEach(r => {
      if (!r.site) return
      prevMap[r.site] = (prevMap[r.site] || 0) + r.cost
    })

    return Object.values(map).map(s => {
      const budget = siteBudgets[s.site]
        ? parseFloat(siteBudgets[s.site])
        : (annualBudget > 0 && Object.keys(map).length > 0 ? annualBudget / Object.keys(map).length : 0)
      const siteVariance = budget - s.actual
      const sitePct = budget > 0 ? (s.actual / budget) * 100 : 0
      const siteProj = monthsElapsed > 0 ? (s.actual / monthsElapsed) * 12 : 0
      const prevActual = prevMap[s.site] || 0
      const cpkRecords = yearRecords.filter(r => r.site === s.site && r.kmRem > r.kmFit && r.cost > 0)
      const cpk = cpkRecords.length > 0
        ? cpkRecords.reduce((sum, r) => sum + r.cost / (r.kmRem - r.kmFit), 0) / cpkRecords.length
        : null
      const prevCpkRecords = prevYearRecords.filter(r => r.site === s.site && r.kmRem > r.kmFit && r.cost > 0)
      const prevCpk = prevCpkRecords.length > 0
        ? prevCpkRecords.reduce((sum, r) => sum + r.cost / (r.kmRem - r.kmFit), 0) / prevCpkRecords.length
        : null
      const status = sitePct > 100 ? 'Over Budget' : sitePct >= 90 ? 'Warning' : 'On Track'
      return { ...s, budget, variance: siteVariance, pct: sitePct, projection: siteProj, prevActual, cpk, prevCpk, status }
    }).sort((a, b) => b.actual - a.actual)
  }, [yearRecords, prevYearRecords, siteBudgets, annualBudget, monthsElapsed])

  // ── CPK efficiency for over-budget sites ──────────────────────────────────
  const overBudgetSites = useMemo(() => siteData.filter(s => s.status === 'Over Budget'), [siteData])

  // ── Brand analysis ─────────────────────────────────────────────────────────
  const brandData = useMemo(() => {
    const thisYear = {}
    const lastYear = {}
    yearRecords.forEach(r => {
      const b = r.brand || 'Unknown'
      thisYear[b] = (thisYear[b] || 0) + r.cost
    })
    prevYearRecords.forEach(r => {
      const b = r.brand || 'Unknown'
      lastYear[b] = (lastYear[b] || 0) + r.cost
    })
    const allBrands = [...new Set([...Object.keys(thisYear), ...Object.keys(lastYear)])]
    return allBrands.map(b => {
      const ty = thisYear[b] || 0
      const ly = lastYear[b] || 0
      const change = ly > 0 ? ((ty - ly) / ly) * 100 : null
      const cpkRecords = yearRecords.filter(r => r.brand === b && r.kmRem > r.kmFit && r.cost > 0)
      const cpk = cpkRecords.length > 0
        ? cpkRecords.reduce((s, r) => s + r.cost / (r.kmRem - r.kmFit), 0) / cpkRecords.length
        : null
      const prevCpkRecs = prevYearRecords.filter(r => r.brand === b && r.kmRem > r.kmFit && r.cost > 0)
      const prevCpk = prevCpkRecs.length > 0
        ? prevCpkRecs.reduce((s, r) => s + r.cost / (r.kmRem - r.kmFit), 0) / prevCpkRecs.length
        : null
      const cpkChange = prevCpk && cpk ? ((cpk - prevCpk) / prevCpk) * 100 : null
      return { brand: b, thisYear: ty, lastYear: ly, change, cpk, prevCpk, cpkChange }
    }).sort((a, b) => b.thisYear - a.thisYear)
  }, [yearRecords, prevYearRecords])

  // ── Historical trend (last 3 years) ───────────────────────────────────────
  const historicalYears = useMemo(() => {
    const map = {}
    normalised.forEach(r => { if (r.year) map[r.year] = (map[r.year] || 0) + r.cost })
    return map
  }, [normalised])

  const trendYears = useMemo(() => {
    const years = Object.keys(historicalYears).map(Number).sort().slice(-4)
    return years
  }, [historicalYears])

  const trendValues = useMemo(() => trendYears.map(y => historicalYears[y] || 0), [trendYears, historicalYears])

  const nextYearProjection = useMemo(() => {
    if (trendValues.length < 2) return null
    const { predict } = linearRegression(trendValues)
    return Math.max(0, predict(trendValues.length))
  }, [trendValues])

  // ── What-if scenario ──────────────────────────────────────────────────────
  const scenarioProjection = useMemo(() => {
    if (projectedYearEnd <= 0) return null
    const currentCpkRecords = yearRecords.filter(r => r.kmRem > r.kmFit && r.cost > 0)
    const currentAvgCpk = currentCpkRecords.length > 0
      ? currentCpkRecords.reduce((s, r) => s + r.cost / (r.kmRem - r.kmFit), 0) / currentCpkRecords.length
      : null

    let adjusted = projectedYearEnd
    // CPK improvement
    if (currentAvgCpk && cpkTarget < currentAvgCpk) {
      const cpkFactor = cpkTarget / currentAvgCpk
      adjusted = adjusted * cpkFactor
    }
    // Volume change
    adjusted = adjusted * (1 + volumeChange / 100)
    // Brand switch saving
    adjusted = adjusted * (1 - (brandSwitchPct / 100) * (brandSwitchSaving / 100))

    return { projected: Math.max(0, adjusted), saving: projectedYearEnd - adjusted, currentAvgCpk }
  }, [projectedYearEnd, cpkTarget, volumeChange, brandSwitchPct, brandSwitchSaving, yearRecords])

  // ── Quarters ──────────────────────────────────────────────────────────────
  const quarters = useMemo(() => [0, 1, 2, 3].map(q => {
    const months = [q * 3, q * 3 + 1, q * 3 + 2]
    const qActual = months.reduce((s, m) => s + (monthlyActuals[m] || 0), 0)
    const qBudget = monthlyBudget * 3
    const qVar = qBudget - qActual
    const qPct = qBudget > 0 ? (qActual / qBudget) * 100 : 0
    const isComplete = selectedYear < currentYear || (selectedYear === currentYear && months[2] <= currentMonth)
    const inProgress = selectedYear === currentYear && months.some(m => m === currentMonth)
    const status = qPct > 100 ? 'Over' : qPct >= 90 ? 'Warning' : isComplete ? 'Complete' : inProgress ? 'Active' : 'Pending'
    return { label: `Q${q + 1}`, months, actual: qActual, budget: qBudget, variance: qVar, pct: qPct, status, isComplete }
  }), [monthlyActuals, monthlyBudget, currentMonth, selectedYear, currentYear])

  // ── Chart: Budget vs Actual monthly ───────────────────────────────────────
  const monthlyChartData = useMemo(() => {
    const cumActual = monthlyActuals.reduce((acc, v, i) => {
      acc.push((acc[i - 1] || 0) + v)
      return acc
    }, [])
    const cumBudget = monthlyBudgets.reduce((acc, v, i) => {
      acc.push((acc[i - 1] || 0) + v)
      return acc
    }, [])
    const barBgActual = monthlyActuals.map((v, i) => v > monthlyBudgets[i] ? 'rgba(239,68,68,0.75)' : 'rgba(16,185,129,0.75)')
    return {
      labels: MONTHS,
      datasets: [
        {
          type: 'bar',
          label: 'Budget',
          data: monthlyBudgets,
          backgroundColor: 'rgba(59,130,246,0.4)',
          borderColor: '#3b82f6',
          borderWidth: 1,
          yAxisID: 'y',
        },
        {
          type: 'bar',
          label: 'Actual',
          data: monthlyActuals,
          backgroundColor: barBgActual,
          borderColor: barBgActual.map(c => c.replace('0.75', '1')),
          borderWidth: 1,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'Cumulative Actual',
          data: cumActual,
          borderColor: '#10b981',
          borderWidth: 2,
          pointRadius: 2,
          fill: false,
          yAxisID: 'y1',
          tension: 0.3,
        },
        {
          type: 'line',
          label: 'Cumulative Budget',
          data: cumBudget,
          borderColor: '#3b82f6',
          borderWidth: 2,
          borderDash: [6, 3],
          pointRadius: 0,
          fill: false,
          yAxisID: 'y1',
          tension: 0,
        },
      ],
    }
  }, [monthlyActuals, monthlyBudgets])

  const monthlyChartOptions = useMemo(() => ({
    ...CHART_BASE,
    scales: {
      x: CHART_BASE.scales.x,
      y: { ...CHART_BASE.scales.y, type: 'linear', position: 'left', ticks: { ...CHART_BASE.scales.y.ticks, callback: v => fmt(v, '') } },
      y1: { ...CHART_BASE.scales.y, type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { ...CHART_BASE.scales.y.ticks, callback: v => fmt(v, '') } },
    },
  }), [])

  // ── Chart: Brand pie ───────────────────────────────────────────────────────
  const brandPieData = useMemo(() => {
    const top = brandData.slice(0, 8)
    return {
      labels: top.map(b => b.brand),
      datasets: [{
        data: top.map(b => b.thisYear),
        backgroundColor: PALETTE.slice(0, top.length),
        borderColor: '#111827',
        borderWidth: 2,
      }],
    }
  }, [brandData])

  const brandPieDataPrev = useMemo(() => {
    const top = brandData.slice(0, 8)
    return {
      labels: top.map(b => b.brand),
      datasets: [{
        data: top.map(b => b.lastYear),
        backgroundColor: PALETTE.slice(0, top.length),
        borderColor: '#111827',
        borderWidth: 2,
      }],
    }
  }, [brandData])

  // ── Chart: Historical trend ────────────────────────────────────────────────
  const trendChartData = useMemo(() => {
    const labels = [...trendYears.map(String)]
    const values = [...trendValues]
    if (nextYearProjection != null) {
      labels.push(`${Math.max(...trendYears, currentYear) + 1} (proj)`)
      values.push(nextYearProjection)
    }
    return {
      labels,
      datasets: [{
        label: 'Annual Spend',
        data: values,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.15)',
        borderWidth: 2,
        pointRadius: 4,
        fill: true,
        tension: 0.3,
        segment: {
          borderDash: ctx => ctx.p0DataIndex >= trendValues.length - 1 ? [6, 3] : undefined,
          borderColor: ctx => ctx.p0DataIndex >= trendValues.length - 1 ? '#f59e0b' : '#3b82f6',
        },
      }],
    }
  }, [trendYears, trendValues, nextYearProjection, currentYear])

  // ── Inline edit: site budget ───────────────────────────────────────────────
  function startEditSite(site, currentBudget) {
    setEditingSite(site)
    setEditValue(String(Math.round(currentBudget)))
  }
  function cancelEditSite() { setEditingSite(null); setEditValue('') }
  function saveEditSite(site) {
    setSaving(true)
    const val = parseFloat(editValue)
    if (!isNaN(val) && val >= 0) {
      const updated = { ...siteBudgets, [site]: val }
      setSiteBudgets(updated)
      try { localStorage.setItem(storageKey, JSON.stringify(updated)) } catch {}
    }
    setSaving(false)
    setEditingSite(null)
  }

  function saveAnnualBudget() {
    const val = parseFloat(annualEditValue)
    if (!isNaN(val) && val >= 0) {
      try { localStorage.setItem(annualStorageKey, String(val)) } catch {}
      setEditingAnnual(false)
    }
  }

  // ── Auto-recommendations ──────────────────────────────────────────────────
  const recommendations = useMemo(() => {
    const recs = []
    overBudgetSites.forEach(s => {
      recs.push(`Review ${s.site}: ${fmtPct(s.pct - 100)} over budget — prioritise CPK optimisation.`)
    })
    brandData.filter(b => b.cpkChange > 10).forEach(b => {
      recs.push(`${b.brand} CPK worsened by ${fmtPct(b.cpkChange)} YoY — consider vendor review or brand switch.`)
    })
    if (projectedYearEnd > annualBudget * 1.1) {
      recs.push(`Projected year-end (${fmt(projectedYearEnd, activeCurrency)}) exceeds budget by >10% — adjust procurement plan.`)
    }
    if (scenarioProjection?.saving > 0) {
      recs.push(`What-If scenario saves ${fmt(scenarioProjection.saving, activeCurrency)}/yr — validate CPK targets with engineering team.`)
    }
    return recs.slice(0, 5)
  }, [overBudgetSites, brandData, projectedYearEnd, annualBudget, activeCurrency, scenarioProjection])

  // ── PDF Export ────────────────────────────────────────────────────────────
  async function handleExportPdf() {
    setExporting(true)
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const W = doc.internal.pageSize.width
      const H = doc.internal.pageSize.height

      const addHeader = (title) => {
        doc.setFillColor(22, 101, 52)
        doc.rect(0, 0, W, 22, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(14)
        doc.setFont('helvetica', 'bold')
        doc.text('TYREPULSE · Annual Budget Planner', 14, 10)
        doc.setFontSize(10)
        doc.setFont('helvetica', 'normal')
        doc.text(title, 14, 17)
        doc.setTextColor(150, 150, 150)
        doc.setFontSize(8)
        doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')} | Year: ${selectedYear}`, W - 14, 17, { align: 'right' })
      }

      const addFooter = (pageNum) => {
        doc.setFontSize(7)
        doc.setTextColor(107, 114, 128)
        doc.text('Confidential · Internal Use Only | TyrePulse', 14, H - 6)
        doc.text(`Page ${pageNum}`, W - 14, H - 6, { align: 'right' })
      }

      // Page 1: KPIs + Status
      addHeader(`Budget Summary ${selectedYear}`)
      const kpiRows = [
        ['Annual Budget', fmt(annualBudget, activeCurrency)],
        ['Actual YTD', fmt(ytdActual, activeCurrency)],
        ['Variance', fmt(variance, activeCurrency)],
        ['% Budget Used', fmtPct(pctUsed)],
        ['Projected Year-End', fmt(projectedYearEnd, activeCurrency)],
      ]
      autoTable(doc, {
        startY: 28,
        head: [['KPI', 'Value']],
        body: kpiRows,
        styles: { fontSize: 10 },
        headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255] },
        margin: { left: 14, right: 14 },
      })
      addFooter(1)

      // Page 2: Site Allocation
      doc.addPage()
      addHeader('Site Budget Allocation')
      autoTable(doc, {
        startY: 28,
        head: [['Site', 'Annual Budget', 'YTD Actual', 'Variance', '% Used', 'Projection', 'Status']],
        body: siteData.map(s => [
          s.site,
          fmt(s.budget, activeCurrency),
          fmt(s.actual, activeCurrency),
          fmt(s.variance, activeCurrency),
          fmtPct(s.pct),
          fmt(s.projection, activeCurrency),
          s.status,
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 14, right: 14 },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 6) {
            const v = String(data.cell.raw)
            if (v === 'Over Budget') { data.cell.styles.fillColor = [127, 29, 29]; data.cell.styles.textColor = [255, 255, 255] }
            else if (v === 'Warning') { data.cell.styles.fillColor = [113, 63, 18]; data.cell.styles.textColor = [255, 255, 255] }
            else { data.cell.styles.fillColor = [20, 83, 45]; data.cell.styles.textColor = [255, 255, 255] }
          }
        },
      })
      addFooter(2)

      // Page 3: Brand analysis
      doc.addPage()
      addHeader('Brand Cost Analysis')
      autoTable(doc, {
        startY: 28,
        head: [['Brand', 'This Year', 'Last Year', 'Change %', 'CPK (curr)', 'CPK Change']],
        body: brandData.map(b => [
          b.brand,
          fmt(b.thisYear, activeCurrency),
          fmt(b.lastYear, activeCurrency),
          b.change != null ? fmtPct(b.change) : 'N/A',
          fmtCpk(b.cpk, activeCurrency),
          b.cpkChange != null ? fmtPct(b.cpkChange) : 'N/A',
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 14, right: 14 },
      })
      addFooter(3)

      // Page 4: Recommendations
      doc.addPage()
      addHeader('AI Recommendations')
      autoTable(doc, {
        startY: 28,
        head: [['#', 'Recommendation']],
        body: recommendations.map((r, i) => [i + 1, r]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255] },
        columnStyles: { 0: { cellWidth: 12 }, 1: { cellWidth: 250 } },
        margin: { left: 14, right: 14 },
      })
      addFooter(4)

      doc.save(`TyrePulse_BudgetPlanner_${selectedYear}.pdf`)
    } finally { setExporting(false) }
  }

  // ── Excel Export ──────────────────────────────────────────────────────────
  function handleExportExcel() {
    setExporting(true)
    try {
      const wb = XLSX.utils.book_new()

      // Sheet 1: Monthly budget vs actual
      const monthlyRows = MONTHS.map((m, i) => ({
        Month: m,
        Budget: Math.round(monthlyBudget),
        Actual: Math.round(monthlyActuals[i]),
        Variance: Math.round(monthlyBudget - monthlyActuals[i]),
        'Variance %': monthlyBudget > 0 ? ((monthlyActuals[i] / monthlyBudget) * 100).toFixed(1) + '%' : 'N/A',
      }))
      const ws1 = XLSX.utils.json_to_sheet(monthlyRows)
      ws1['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 }]
      XLSX.utils.book_append_sheet(wb, ws1, 'Monthly Budget vs Actual')

      // Sheet 2: Site allocation
      const siteRows = siteData.map(s => ({
        Site: s.site,
        'Annual Budget': Math.round(s.budget),
        'YTD Actual': Math.round(s.actual),
        Variance: Math.round(s.variance),
        '% Used': fmtPct(s.pct),
        'Projection': Math.round(s.projection),
        Status: s.status,
      }))
      const ws2 = XLSX.utils.json_to_sheet(siteRows)
      ws2['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 14 }]
      XLSX.utils.book_append_sheet(wb, ws2, 'Site Allocation')

      // Sheet 3: Brand analysis
      const brandRows = brandData.map(b => ({
        Brand: b.brand,
        'This Year': Math.round(b.thisYear),
        'Last Year': Math.round(b.lastYear),
        'Change %': b.change != null ? fmtPct(b.change) : 'N/A',
        'CPK (curr)': b.cpk != null ? b.cpk.toFixed(4) : 'N/A',
        'CPK Change %': b.cpkChange != null ? fmtPct(b.cpkChange) : 'N/A',
      }))
      const ws3 = XLSX.utils.json_to_sheet(brandRows)
      ws3['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }]
      XLSX.utils.book_append_sheet(wb, ws3, 'Brand Analysis')

      // Sheet 4: Recommendations
      const recRows = recommendations.map((r, i) => ({ '#': i + 1, Recommendation: r }))
      const ws4 = XLSX.utils.json_to_sheet(recRows)
      ws4['!cols'] = [{ wch: 4 }, { wch: 80 }]
      XLSX.utils.book_append_sheet(wb, ws4, 'Recommendations')

      XLSX.writeFile(wb, `TyrePulse_BudgetPlanner_${selectedYear}.xlsx`)
    } finally { setExporting(false) }
  }

  // ── Renderers ─────────────────────────────────────────────────────────────
  const statusBadge = (status) => {
    const map = {
      'On Track': 'bg-green-900/60 text-green-400 border border-green-800',
      'Warning': 'bg-amber-900/60 text-amber-400 border border-amber-800',
      'Over Budget': 'bg-red-900/60 text-red-400 border border-red-800',
      'Complete': 'bg-blue-900/60 text-blue-400 border border-blue-800',
      'Active': 'bg-purple-900/60 text-purple-400 border border-purple-800',
      'Over': 'bg-red-900/60 text-red-400 border border-red-800',
      'Pending': 'bg-gray-800 text-gray-400 border border-gray-700',
    }
    return (
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? 'bg-gray-800 text-gray-400'}`}>
        {status}
      </span>
    )
  }

  const varColor = (v) => v >= 0 ? 'text-green-400' : 'text-red-400'
  const varIcon = (v) => v >= 0
    ? <ArrowDownRight className="w-4 h-4 text-green-400 inline" />
    : <ArrowUpRight className="w-4 h-4 text-red-400 inline" />

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      <span className="ml-3 text-gray-400">Loading budget data…</span>
    </div>
  )

  if (error) return (
    <div className="flex items-center justify-center h-96">
      <div className="bg-red-900/30 border border-red-800 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-300 font-medium">Failed to load data</p>
        <p className="text-red-400/70 text-sm mt-1">{error}</p>
        <button onClick={fetchRecords} className="mt-4 px-4 py-2 bg-red-800 hover:bg-red-700 text-white rounded-lg text-sm">Retry</button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6 pb-10">

      {/* ── Header ── */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <DollarSign className="w-7 h-7 text-blue-400" />
            Annual Budget Planner
          </h1>
          <p className="text-gray-400 text-sm mt-1">What-if modeling · Actual vs Budget · Site allocation · Scenario analysis</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Year Selector */}
          <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5">
            <Calendar className="w-4 h-4 text-blue-400" />
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-white text-sm focus:outline-none"
            >
              {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map(y => (
                <option key={y} value={y} className="bg-gray-900">{y}</option>
              ))}
            </select>
          </div>
          <button onClick={fetchRecords} className="p-2 bg-gray-800 border border-gray-700 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleExportPdf}
            disabled={exporting}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg text-sm transition-colors"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            PDF
          </button>
          <button
            onClick={handleExportExcel}
            disabled={exporting}
            className="flex items-center gap-2 px-3 py-2 bg-green-900/50 border border-green-800 hover:bg-green-900 text-green-400 hover:text-green-300 rounded-lg text-sm transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Excel
          </button>
        </div>
      </motion.div>

      {/* ── Status Bar ── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}
        className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-3 flex flex-wrap items-center gap-4 text-sm">
        <span className="text-gray-500 font-medium">FY {selectedYear}</span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-400">Budget Set: <span className="text-blue-400 font-semibold">{fmt(annualBudget, activeCurrency)}</span></span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-400">Actual YTD: <span className="text-white font-semibold">{fmt(ytdActual, activeCurrency)}</span></span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-400">Variance: <span className={`font-semibold ${varColor(variance)}`}>{fmt(variance, activeCurrency)}</span></span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-400">% Used: <span className={`font-semibold ${pctUsed > 100 ? 'text-red-400' : pctUsed > 90 ? 'text-amber-400' : 'text-green-400'}`}>{fmtPct(pctUsed)}</span></span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-400">Projected YE: <span className={`font-semibold ${projectedYearEnd > annualBudget ? 'text-red-400' : 'text-green-400'}`}>{fmt(projectedYearEnd, activeCurrency)}</span></span>
      </motion.div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        {[
          {
            label: 'Annual Budget',
            value: editingAnnual ? null : fmt(annualBudget, activeCurrency),
            icon: Target,
            color: 'blue',
            editable: isAdmin,
            editing: editingAnnual,
            onEdit: () => { setAnnualEditValue(String(Math.round(annualBudget))); setEditingAnnual(true) },
          },
          { label: 'Actual YTD', value: fmt(ytdActual, activeCurrency), icon: BarChart2, color: 'purple' },
          {
            label: 'Budget Variance',
            value: fmt(variance, activeCurrency),
            icon: variance >= 0 ? TrendingDown : TrendingUp,
            color: variance >= 0 ? 'green' : 'red',
            sub: variance >= 0 ? 'Under budget' : 'Over budget',
          },
          {
            label: '% Budget Used',
            value: fmtPct(pctUsed),
            icon: PieIcon,
            color: pctUsed > 100 ? 'red' : pctUsed > 90 ? 'amber' : 'green',
          },
          {
            label: 'Projected YE',
            value: fmt(projectedYearEnd, activeCurrency),
            icon: Zap,
            color: projectedYearEnd > annualBudget ? 'red' : 'green',
            sub: projectedYearEnd > annualBudget ? 'Over trajectory' : 'On trajectory',
          },
        ].map((kpi, i) => {
          const colorMap = {
            blue: 'text-blue-400 bg-blue-900/20 border-blue-900',
            purple: 'text-purple-400 bg-purple-900/20 border-purple-900',
            green: 'text-green-400 bg-green-900/20 border-green-900',
            red: 'text-red-400 bg-red-900/20 border-red-900',
            amber: 'text-amber-400 bg-amber-900/20 border-amber-900',
          }
          const [textCls, bgCls, borderCls] = (colorMap[kpi.color] || colorMap.blue).split(' ')
          return (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`bg-gray-900 border ${borderCls} rounded-xl p-4 relative`}
            >
              <div className={`inline-flex p-2 rounded-lg ${bgCls} mb-3`}>
                <kpi.icon className={`w-5 h-5 ${textCls}`} />
              </div>
              <p className="text-gray-400 text-xs mb-1">{kpi.label}</p>
              {kpi.editing ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={annualEditValue}
                    onChange={e => setAnnualEditValue(e.target.value)}
                    className="w-full bg-gray-800 border border-blue-600 text-white rounded px-2 py-1 text-sm focus:outline-none"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') saveAnnualBudget(); if (e.key === 'Escape') setEditingAnnual(false) }}
                  />
                  <button onClick={saveAnnualBudget} className="p-1 text-green-400 hover:text-green-300"><Save className="w-4 h-4" /></button>
                  <button onClick={() => setEditingAnnual(false)} className="p-1 text-gray-500 hover:text-gray-300"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <p className={`text-xl font-bold ${textCls}`}>{kpi.value}</p>
              )}
              {kpi.sub && <p className="text-gray-500 text-xs mt-1">{kpi.sub}</p>}
              {kpi.editable && !kpi.editing && (
                <button onClick={kpi.onEdit} className="absolute top-3 right-3 p-1 text-gray-600 hover:text-gray-300 transition-colors">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
            </motion.div>
          )
        })}
      </div>

      {/* ── Budget vs Actual Chart ── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
        className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-blue-400" />
            Budget vs Actual — Monthly {selectedYear}
          </h2>
          <span className="text-xs text-gray-500">Red bars = actual exceeds budget</span>
        </div>
        <div className="h-72">
          <Bar data={monthlyChartData} options={monthlyChartOptions} />
        </div>
      </motion.div>

      {/* ── Quarterly Cards ── */}
      <div>
        <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-purple-400" />
          Quarterly Budget Tracking
        </h2>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {quarters.map((q, i) => (
            <motion.div
              key={q.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-white font-semibold">{q.label}</span>
                {statusBadge(q.status)}
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Budget</span>
                  <span className="text-blue-400 font-medium">{fmt(q.budget, activeCurrency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Actual</span>
                  <span className="text-white font-medium">{fmt(q.actual, activeCurrency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Variance</span>
                  <span className={`font-medium ${varColor(q.variance)}`}>{fmt(q.variance, activeCurrency)}</span>
                </div>
              </div>
              <div className="mt-3">
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${q.pct > 100 ? 'bg-red-500' : q.pct >= 90 ? 'bg-amber-500' : 'bg-green-500'}`}
                    style={{ width: `${Math.min(100, q.pct)}%` }}
                  />
                </div>
                <p className="text-gray-500 text-xs mt-1">{fmtPct(q.pct)} used</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── Site Budget Allocation ── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
        className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <Target className="w-5 h-5 text-green-400" />
            Site Budget Allocation
          </h2>
          {isAdmin && <span className="text-xs text-gray-500 flex items-center gap-1"><Edit2 className="w-3 h-3" />Click edit icon to adjust site budgets</span>}
        </div>
        {siteData.length === 0 ? (
          <div className="p-10 text-center text-gray-500">No site data available for {selectedYear}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Site', 'Annual Budget', 'YTD Actual', 'Variance', '% Used', 'Projection', 'CPK', 'Status', isAdmin ? '' : null]
                    .filter(Boolean)
                    .map(h => (
                      <th key={h} className="text-left text-gray-500 font-medium px-4 py-3 whitespace-nowrap">{h}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {siteData.map((s, i) => (
                  <motion.tr
                    key={s.site}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                  >
                    <td className="px-4 py-3 text-white font-medium">{s.site}</td>
                    <td className="px-4 py-3">
                      {editingSite === s.site ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            className="w-32 bg-gray-800 border border-blue-600 text-white rounded px-2 py-1 text-sm focus:outline-none"
                            autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') saveEditSite(s.site); if (e.key === 'Escape') cancelEditSite() }}
                          />
                          <button onClick={() => saveEditSite(s.site)} disabled={saving} className="p-1 text-green-400 hover:text-green-300">
                            <Save className="w-4 h-4" />
                          </button>
                          <button onClick={cancelEditSite} className="p-1 text-gray-500 hover:text-gray-300">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-blue-400 font-medium">{fmt(s.budget, activeCurrency)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white">{fmt(s.actual, activeCurrency)}</td>
                    <td className={`px-4 py-3 font-medium ${varColor(s.variance)}`}>{fmt(s.variance, activeCurrency)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${s.pct > 100 ? 'bg-red-500' : s.pct >= 90 ? 'bg-amber-500' : 'bg-green-500'}`}
                            style={{ width: `${Math.min(100, s.pct)}%` }} />
                        </div>
                        <span className={s.pct > 100 ? 'text-red-400' : s.pct >= 90 ? 'text-amber-400' : 'text-green-400'}>{fmtPct(s.pct)}</span>
                      </div>
                    </td>
                    <td className={`px-4 py-3 font-medium ${s.projection > s.budget ? 'text-red-400' : 'text-gray-300'}`}>{fmt(s.projection, activeCurrency)}</td>
                    <td className="px-4 py-3 text-gray-300">{fmtCpk(s.cpk, activeCurrency)}</td>
                    <td className="px-4 py-3">{statusBadge(s.status)}</td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        {editingSite !== s.site && (
                          <button onClick={() => startEditSite(s.site, s.budget)} className="p-1.5 text-gray-600 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    )}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {/* ── Budget vs CPK Efficiency ── */}
      {overBudgetSites.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="bg-gray-900 border border-red-900/50 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            CPK Efficiency — Over-Budget Sites
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {overBudgetSites.map(s => {
              const cpkImproved = s.cpk ? Math.max(0, s.cpk * 0.85) : null
              const saving = cpkImproved && s.cpk
                ? (s.actual / s.cpk) * (s.cpk - cpkImproved)
                : null
              return (
                <div key={s.site} className="bg-gray-800 rounded-xl p-4 border border-red-900/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white font-semibold">{s.site}</span>
                    {statusBadge('Over Budget')}
                  </div>
                  <p className="text-gray-400 text-xs mb-3">
                    Over budget by {fmt(Math.abs(s.variance), activeCurrency)} ({fmtPct(s.pct - 100)} excess)
                  </p>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Current CPK</span>
                      <span className="text-red-400 font-medium">{fmtCpk(s.cpk, activeCurrency)}</span>
                    </div>
                    {s.prevCpk && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Prior Year CPK</span>
                        <span className="text-gray-300">{fmtCpk(s.prevCpk, activeCurrency)}</span>
                      </div>
                    )}
                    {cpkImproved && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Target CPK (−15%)</span>
                        <span className="text-green-400 font-medium">{fmtCpk(cpkImproved, activeCurrency)}</span>
                      </div>
                    )}
                  </div>
                  {saving > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-700 bg-green-900/20 -mx-4 -mb-4 px-4 pb-4 rounded-b-xl">
                      <p className="text-green-400 text-sm font-medium">
                        Potential saving: {fmt(saving, activeCurrency)}/yr
                      </p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        If CPK improved from {fmtCpk(s.cpk, activeCurrency)} to {fmtCpk(cpkImproved, activeCurrency)}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* ── What-If Scenario Builder ── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
        className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-white font-semibold mb-5 flex items-center gap-2">
          <Sliders className="w-5 h-5 text-purple-400" />
          What-If Scenario Builder
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            {/* CPK Target */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-gray-300 text-sm font-medium">Fleet CPK Target</label>
                <span className="text-blue-400 font-semibold text-sm">{activeCurrency} {cpkTarget.toFixed(2)}/km</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="5.0"
                step="0.05"
                value={cpkTarget}
                onChange={e => setCpkTarget(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-800 rounded-full appearance-none cursor-pointer accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>{activeCurrency} 0.50</span>
                <span>{activeCurrency} 5.00</span>
              </div>
              {scenarioProjection?.currentAvgCpk && (
                <p className="text-gray-500 text-xs mt-1">Current fleet avg CPK: {fmtCpk(scenarioProjection.currentAvgCpk, activeCurrency)}</p>
              )}
            </div>

            {/* Volume change */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-gray-300 text-sm font-medium">Replacement Volume Change</label>
                <span className={`font-semibold text-sm ${volumeChange > 0 ? 'text-red-400' : volumeChange < 0 ? 'text-green-400' : 'text-gray-400'}`}>
                  {volumeChange > 0 ? '+' : ''}{volumeChange}%
                </span>
              </div>
              <input
                type="range"
                min="-30"
                max="30"
                step="1"
                value={volumeChange}
                onChange={e => setVolumeChange(Number(e.target.value))}
                className="w-full h-2 bg-gray-800 rounded-full appearance-none cursor-pointer accent-purple-500"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>−30% (fewer)</span>
                <span>+30% (more)</span>
              </div>
            </div>

            {/* Brand switch */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-gray-300 text-sm font-medium">Brand Switch Volume</label>
                  <span className="text-amber-400 font-semibold text-sm">{brandSwitchPct}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="80"
                  step="5"
                  value={brandSwitchPct}
                  onChange={e => setBrandSwitchPct(Number(e.target.value))}
                  className="w-full h-2 bg-gray-800 rounded-full appearance-none cursor-pointer accent-amber-500"
                />
                <p className="text-xs text-gray-600 mt-1">% of fleet switching brand</p>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-gray-300 text-sm font-medium">Brand Cost Saving</label>
                  <span className="text-green-400 font-semibold text-sm">{brandSwitchSaving}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="40"
                  step="1"
                  value={brandSwitchSaving}
                  onChange={e => setBrandSwitchSaving(Number(e.target.value))}
                  className="w-full h-2 bg-gray-800 rounded-full appearance-none cursor-pointer accent-green-500"
                />
                <p className="text-xs text-gray-600 mt-1">Cost reduction vs current brand</p>
              </div>
            </div>
          </div>

          {/* Scenario output */}
          <div className="bg-gray-800 rounded-xl p-5 flex flex-col justify-between border border-gray-700">
            <div>
              <p className="text-gray-400 text-sm mb-4">Scenario Projection</p>
              <div className="space-y-4">
                <div>
                  <p className="text-gray-500 text-xs">Current Trajectory</p>
                  <p className="text-xl font-bold text-red-400">{fmt(projectedYearEnd, activeCurrency)}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Under This Scenario</p>
                  <p className="text-2xl font-bold text-green-400">{scenarioProjection ? fmt(scenarioProjection.projected, activeCurrency) : 'N/A'}</p>
                </div>
              </div>
            </div>
            {scenarioProjection && scenarioProjection.saving !== 0 && (
              <div className={`mt-4 pt-4 border-t border-gray-700 rounded-lg p-3 ${scenarioProjection.saving > 0 ? 'bg-green-900/20' : 'bg-red-900/20'}`}>
                <p className={`font-bold text-lg ${scenarioProjection.saving > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {scenarioProjection.saving > 0 ? 'Saving' : 'Additional Cost'}: {fmt(Math.abs(scenarioProjection.saving), activeCurrency)}/yr
                </p>
                <p className="text-gray-500 text-xs mt-1">
                  Under this scenario, you {scenarioProjection.saving > 0 ? 'save' : 'spend an extra'} {fmt(Math.abs(scenarioProjection.saving), activeCurrency)} per year
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* ── Brand Cost Impact ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
          className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <PieIcon className="w-5 h-5 text-amber-400" />
            Brand Spend Distribution — {selectedYear}
          </h2>
          {brandData.some(b => b.thisYear > 0) ? (
            <div className="h-60">
              <Doughnut
                data={brandPieData}
                options={{
                  ...CHART_BASE,
                  scales: undefined,
                  plugins: { ...CHART_BASE.plugins, legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 10 } } } },
                }}
              />
            </div>
          ) : (
            <div className="h-60 flex items-center justify-center text-gray-600">No brand data for {selectedYear}</div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
          className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-gray-800">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-amber-400" />
              Brand Cost Analysis
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Brand', 'This Year', 'Last Year', 'Change', 'CPK', 'CPK Δ'].map(h => (
                    <th key={h} className="text-left text-gray-500 font-medium px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {brandData.slice(0, 10).map((b, i) => (
                  <tr key={b.brand} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-2.5 text-white font-medium">{b.brand}</td>
                    <td className="px-4 py-2.5 text-blue-400">{fmt(b.thisYear, activeCurrency)}</td>
                    <td className="px-4 py-2.5 text-gray-400">{fmt(b.lastYear, activeCurrency)}</td>
                    <td className={`px-4 py-2.5 font-medium ${b.change == null ? 'text-gray-500' : b.change > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {b.change != null ? (b.change > 0 ? '+' : '') + fmtPct(b.change) : 'N/A'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-300">{fmtCpk(b.cpk, activeCurrency)}</td>
                    <td className={`px-4 py-2.5 font-medium ${b.cpkChange == null ? 'text-gray-500' : b.cpkChange > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {b.cpkChange != null ? (b.cpkChange > 0 ? '+' : '') + fmtPct(b.cpkChange) : 'N/A'}
                    </td>
                  </tr>
                ))}
                {brandData.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-gray-600 py-8">No brand data available</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>

      {/* ── Budget Trend (last 3 years) ── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
        className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            Annual Spend Trend &amp; Projection
          </h2>
          {nextYearProjection != null && (
            <span className="text-xs text-amber-400 bg-amber-900/20 border border-amber-900 rounded-full px-3 py-1">
              {Math.max(...trendYears, currentYear) + 1} forecast: {fmt(nextYearProjection, activeCurrency)}
            </span>
          )}
        </div>
        {trendValues.length > 0 ? (
          <div className="h-56">
            <Line
              data={trendChartData}
              options={{
                ...CHART_BASE,
                plugins: { ...CHART_BASE.plugins, legend: { display: false } },
                scales: {
                  x: CHART_BASE.scales.x,
                  y: { ...CHART_BASE.scales.y, ticks: { ...CHART_BASE.scales.y.ticks, callback: v => fmt(v, '') } },
                },
              }}
            />
          </div>
        ) : (
          <div className="h-56 flex items-center justify-center text-gray-600">Insufficient historical data for trend analysis</div>
        )}
      </motion.div>

      {/* ── Recommendations ── */}
      {recommendations.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
          className="bg-gray-900 border border-blue-900/40 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            AI Budget Recommendations
          </h2>
          <div className="space-y-2">
            {recommendations.map((r, i) => (
              <div key={i} className="flex items-start gap-3 bg-gray-800/60 rounded-lg px-4 py-3 border border-gray-700/50">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                <p className="text-gray-300 text-sm">{r}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  )
}
