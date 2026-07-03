import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  ChevronLeft, ChevronRight, CalendarDays, RefreshCw,
  AlertOctagon, AlertTriangle, Clock, CheckCircle2, XCircle,
  CircleDot, ClipboardList, ShieldAlert, Wrench,
  TrendingUp, TrendingDown, Minus, DollarSign, Activity,
  Truck, FileText, Printer, ChevronDown, ChevronUp,
  ZapOff, Building2, BarChart2, Bell, Eye,
} from 'lucide-react'
import * as dailyOpsApi from '../lib/api/dailyOps'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { exportDailyOpsBriefingPdf } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 10, font: { size: 10 } } },
    tooltip: { backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1, titleColor: '#f9fafb', bodyColor: '#d1d5db' },
  },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: '#1f2937' } },
  },
}
const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right', labels: { color: '#9ca3af', boxWidth: 10, font: { size: 10 } } },
    tooltip: { backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1, titleColor: '#f9fafb', bodyColor: '#d1d5db' },
  },
}

const SEV = {
  Critical: { bg: 'bg-red-900/40', border: 'border-red-700', text: 'text-red-300', dot: 'bg-red-500', icon: AlertOctagon, order: 0 },
  High:     { bg: 'bg-orange-900/30', border: 'border-orange-700', text: 'text-orange-300', dot: 'bg-orange-500', icon: AlertTriangle, order: 1 },
  Medium:   { bg: 'bg-yellow-900/30', border: 'border-yellow-700', text: 'text-yellow-300', dot: 'bg-yellow-500', icon: Clock, order: 2 },
  Low:      { bg: 'bg-blue-900/20', border: 'border-blue-700', text: 'text-blue-300', dot: 'bg-blue-400', icon: Activity, order: 3 },
}

const EVENT_COLORS = {
  'New Fitment': 'text-green-400',
  'Removal':     'text-orange-400',
  'Inspection':  'text-blue-400',
  'Alert':       'text-red-400',
  'Work Order':  'text-purple-400',
}

function pad(n) { return String(n).padStart(2, '0') }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` }
function fmtDisp(iso) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}
function fmtShort(iso) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtTime(ts) {
  if (!ts) return '--:--'
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function weekRange(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7))
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  return { start: fmtDate(mon), end: fmtDate(sun) }
}
function prevWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() - 7)
  return weekRange(fmtDate(d))
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n)
  return fmtDate(d)
}

export default function DailyOps() {
  const { activeCurrency, appSettings } = useSettings()
  const { branding } = useTenant()
  const [selectedDate, setSelectedDate] = useState(fmtDate(new Date()))
  const [loading, setLoading] = useState(true)
  const [weekOpen, setWeekOpen] = useState(true)

  const [tyreRecords, setTyreRecords] = useState([])
  const [inspections, setInspections]  = useState([])
  const [workOrders, setWorkOrders]    = useState([])
  const [alerts, setAlerts]            = useState([])
  const [allTyres30, setAllTyres30]    = useState([])

  const fetchData = useCallback(async (date) => {
    setLoading(true)
    const { start: wStart, end: wEnd } = weekRange(date)
    const thirtyDaysAgo = addDays(date, -30)

    const [trRes, insRes, woRes, alRes, t30Res] = await Promise.allSettled([
      dailyOpsApi.listDailyTyreRecords({ thirtyDaysAgo, wEnd }),
      dailyOpsApi.listDailyInspections({ thirtyDaysAgo, wEnd }),
      dailyOpsApi.listDailyWorkOrders({ thirtyDaysAgo, wEnd }),
      dailyOpsApi.listDailyAlerts({ thirtyDaysAgo, wEnd }),
      dailyOpsApi.listDailyTyreFitments({ thirtyDaysAgo, date }),
    ])

    setTyreRecords(trRes.status === 'fulfilled' && trRes.value.data ? trRes.value.data : [])
    setInspections(insRes.status === 'fulfilled' && insRes.value.data ? insRes.value.data : [])
    setWorkOrders(woRes.status === 'fulfilled' && woRes.value.data ? woRes.value.data : [])
    setAlerts(alRes.status === 'fulfilled' && alRes.value.data ? alRes.value.data : [])
    setAllTyres30(t30Res.status === 'fulfilled' && t30Res.value.data ? t30Res.value.data : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData(selectedDate) }, [selectedDate, fetchData])

  function navigate(dir) {
    const d = new Date(selectedDate + 'T00:00:00')
    d.setDate(d.getDate() + dir)
    setSelectedDate(fmtDate(d))
  }

  const todayRecs    = useMemo(() => tyreRecords.filter(r => r.issue_date === selectedDate), [tyreRecords, selectedDate])
  const todayIns     = useMemo(() => inspections.filter(r => r.inspection_date === selectedDate), [inspections, selectedDate])
  const todayWO      = useMemo(() => workOrders.filter(r => r.created_at?.startsWith(selectedDate)), [workOrders, selectedDate])
  const todayAlerts  = useMemo(() => alerts.filter(r => r.created_at?.startsWith(selectedDate)), [alerts, selectedDate])

  const { start: thisWeekStart, end: thisWeekEnd } = useMemo(() => weekRange(selectedDate), [selectedDate])
  const { start: lastWeekStart, end: lastWeekEnd } = useMemo(() => prevWeek(selectedDate), [selectedDate])

  const thisWeekRecs = useMemo(() => tyreRecords.filter(r => r.issue_date >= thisWeekStart && r.issue_date <= thisWeekEnd), [tyreRecords, thisWeekStart, thisWeekEnd])
  const lastWeekRecs = useMemo(() => tyreRecords.filter(r => r.issue_date >= lastWeekStart && r.issue_date <= lastWeekEnd), [tyreRecords, lastWeekStart, lastWeekEnd])
  const thisWeekIns  = useMemo(() => inspections.filter(r => r.inspection_date >= thisWeekStart && r.inspection_date <= thisWeekEnd), [inspections, thisWeekStart, thisWeekEnd])
  const lastWeekIns  = useMemo(() => inspections.filter(r => r.inspection_date >= lastWeekStart && r.inspection_date <= lastWeekEnd), [inspections, lastWeekStart, lastWeekEnd])
  const thisWeekWO   = useMemo(() => workOrders.filter(r => r.created_at >= thisWeekStart + 'T00:00:00' && r.created_at <= thisWeekEnd + 'T23:59:59'), [workOrders, thisWeekStart, thisWeekEnd])
  const lastWeekWO   = useMemo(() => workOrders.filter(r => r.created_at >= lastWeekStart + 'T00:00:00' && r.created_at <= lastWeekEnd + 'T23:59:59'), [workOrders, lastWeekStart, lastWeekEnd])
  const thisWeekCrit = useMemo(() => thisWeekRecs.filter(r => r.risk_level === 'Critical').length, [thisWeekRecs])
  const lastWeekCrit = useMemo(() => lastWeekRecs.filter(r => r.risk_level === 'Critical').length, [lastWeekRecs])

  const thisWeekCost = useMemo(() => thisWeekRecs.reduce((s, r) => s + (Number(r.cost_per_tyre) || 0) * (r.qty || 1), 0), [thisWeekRecs])
  const lastWeekCost = useMemo(() => lastWeekRecs.reduce((s, r) => s + (Number(r.cost_per_tyre) || 0) * (r.qty || 1), 0), [lastWeekRecs])

  const todayCost = useMemo(() => todayRecs.reduce((s, r) => s + (Number(r.cost_per_tyre) || 0) * (r.qty || 1), 0), [todayRecs])

  const dailyBudget = useMemo(() => {
    try {
      const targets = JSON.parse(localStorage.getItem('tp_kpi_targets') || '{}')
      const annual = parseFloat(targets.annual_budget) || 0
      return annual > 0 ? annual / 365 : 0
    } catch { return 0 }
  }, [])

  const priorityQueue = useMemo(() => {
    const items = []

    todayRecs.filter(r => r.risk_level === 'Critical').forEach(r => {
      items.push({
        id: `crit-${r.id}`,
        severity: 'Critical',
        type: 'Critical Tyre Fitted',
        description: `Critical risk tyre fitted today on ${r.asset_no}`,
        asset: r.asset_no,
        detail: `Serial: ${r.serial_number || 'N/A'} | Position: ${r.position || 'N/A'} | Site: ${r.site || 'N/A'}`,
        link: '/tyres',
      })
    })

    const overdueWOs = workOrders.filter(r => {
      if (!r.scheduled_date || r.status === 'Completed' || r.status === 'Cancelled') return false
      return r.scheduled_date < selectedDate
    })
    overdueWOs.forEach(r => {
      const daysPast = Math.floor((new Date(selectedDate) - new Date(r.scheduled_date)) / 86400000)
      items.push({
        id: `wo-${r.id}`,
        severity: daysPast > 7 ? 'Critical' : 'High',
        type: 'Overdue Work Order',
        description: `Work order ${r.work_order_no || r.id} overdue by ${daysPast}d`,
        asset: r.asset_no,
        detail: `Status: ${r.status} | Priority: ${r.priority || 'N/A'} | Site: ${r.site || 'N/A'}`,
        link: '/work-orders',
      })
    })

    const recentAssets = new Set([
      ...tyreRecords.filter(r => r.issue_date >= addDays(selectedDate, -14) && r.issue_date <= selectedDate).map(r => r.asset_no),
      ...inspections.filter(r => r.inspection_date >= addDays(selectedDate, -14) && r.inspection_date <= selectedDate).map(r => r.asset_no),
    ])
    const allAssets = new Set([...allTyres30.map(r => r.asset_no)])
    allAssets.forEach(asset => {
      if (!recentAssets.has(asset)) {
        items.push({
          id: `inactive-${asset}`,
          severity: 'Medium',
          type: 'No Inspection (14d)',
          description: `Vehicle ${asset} has no inspection in last 14 days`,
          asset,
          detail: 'Inspection overdue - last activity >14 days ago',
          link: '/inspections',
        })
      }
    })

    return items.sort((a, b) => (SEV[a.severity]?.order ?? 9) - (SEV[b.severity]?.order ?? 9))
  }, [todayRecs, workOrders, selectedDate, tyreRecords, inspections, allTyres30])

  const activityFeed = useMemo(() => {
    const events = []
    todayRecs.forEach(r => {
      events.push({
        id: `tr-${r.id}`,
        time: r.created_at || r.issue_date,
        type: r.km_at_removal ? 'Removal' : 'New Fitment',
        asset: r.asset_no,
        site: r.site,
        detail: `${r.brand || 'Unknown'} | ${r.position || '-'} | ${r.serial_number || 'No Serial'}`,
      })
    })
    todayIns.forEach(r => {
      const tc = Array.isArray(r.tyre_conditions)
        ? r.tyre_conditions
        : (r.tyre_conditions ? Object.values(r.tyre_conditions) : [])
      const flagged = tc.filter(p => p && p.condition && p.condition !== 'Good').length
      events.push({
        id: `ins-${r.id}`,
        time: r.created_at || r.inspection_date,
        type: 'Inspection',
        asset: r.asset_no,
        site: r.site,
        detail: `Inspector: ${r.inspector || 'N/A'} | Tyres: ${tc.length}${flagged ? ` | ${flagged} flagged` : ''}`,
      })
    })
    todayAlerts.forEach(r => {
      events.push({
        id: `al-${r.id}`,
        time: r.created_at,
        type: 'Alert',
        asset: r.asset_no,
        site: '',
        detail: r.message || r.alert_type || 'Alert raised',
      })
    })
    todayWO.forEach(r => {
      events.push({
        id: `wo-${r.id}`,
        time: r.created_at,
        type: 'Work Order',
        asset: r.asset_no,
        site: r.site,
        detail: `WO: ${r.work_order_no || r.id} | ${r.status} | Priority: ${r.priority || 'N/A'}`,
      })
    })
    return events.sort((a, b) => new Date(b.time) - new Date(a.time))
  }, [todayRecs, todayIns, todayAlerts, todayWO])

  const siteActivity = useMemo(() => {
    const map = {}
    todayRecs.forEach(r => { map[r.site || 'Unknown'] = (map[r.site || 'Unknown'] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [todayRecs])

  const vehiclesActiveToday = useMemo(() => new Set([
    ...todayRecs.map(r => r.asset_no),
    ...todayIns.map(r => r.asset_no),
  ]).size, [todayRecs, todayIns])

  const vehiclesCritical = useMemo(() => new Set(todayRecs.filter(r => r.risk_level === 'Critical').map(r => r.asset_no)).size, [todayRecs])
  const vehiclesDormant  = useMemo(() => {
    const active = new Set([...allTyres30.map(r => r.asset_no)])
    const recent = new Set([...tyreRecords.filter(r => r.issue_date >= addDays(selectedDate, -30) && r.issue_date <= selectedDate).map(r => r.asset_no)])
    return [...active].filter(a => !recent.has(a)).length
  }, [allTyres30, tyreRecords, selectedDate])

  const fleetStatusData = useMemo(() => ({
    labels: ['Active Today', 'Critical Risk', 'Dormant (30d)'],
    datasets: [{
      data: [vehiclesActiveToday, vehiclesCritical, vehiclesDormant],
      backgroundColor: ['rgba(34,197,94,0.7)', 'rgba(239,68,68,0.7)', 'rgba(107,114,128,0.7)'],
      borderColor: ['#22c55e', '#ef4444', '#6b7280'],
      borderWidth: 1,
    }],
  }), [vehiclesActiveToday, vehiclesCritical, vehiclesDormant])

  const sitesChartData = useMemo(() => ({
    labels: siteActivity.map(([s]) => s),
    datasets: [{
      label: 'Tyre Events',
      data: siteActivity.map(([, c]) => c),
      backgroundColor: 'rgba(22,163,74,0.65)',
      borderColor: '#16a34a',
      borderWidth: 1,
    }],
  }), [siteActivity])

  const costDoughnutData = useMemo(() => {
    const spent = todayCost
    const budget = dailyBudget
    const remaining = Math.max(budget - spent, 0)
    const over = spent > budget && budget > 0 ? spent - budget : 0
    if (budget <= 0) {
      return {
        labels: ['Today\'s Spend'],
        datasets: [{ data: [Math.max(spent, 1)], backgroundColor: ['rgba(22,163,74,0.7)'], borderColor: ['#16a34a'], borderWidth: 1 }],
      }
    }
    return {
      labels: over > 0 ? ['Spent (Budget)', 'Over Budget'] : ['Spent', 'Remaining'],
      datasets: [{
        data: over > 0 ? [budget, over] : [spent, remaining],
        backgroundColor: over > 0 ? ['rgba(22,163,74,0.65)', 'rgba(239,68,68,0.65)'] : ['rgba(22,163,74,0.65)', 'rgba(31,41,55,0.9)'],
        borderColor: over > 0 ? ['#16a34a', '#ef4444'] : ['#16a34a', '#374151'],
        borderWidth: 1,
      }],
    }
  }, [todayCost, dailyBudget])

  const upcomingWOs = useMemo(() => {
    const nextWeekEnd = addDays(selectedDate, 7)
    return workOrders.filter(r => r.scheduled_date && r.scheduled_date > selectedDate && r.scheduled_date <= nextWeekEnd && r.status !== 'Completed' && r.status !== 'Cancelled')
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
  }, [workOrders, selectedDate])

  function weekDelta(curr, prev) {
    if (prev === 0 && curr === 0) return { val: 0, pct: 0 }
    if (prev === 0) return { val: curr, pct: 100 }
    const pct = Math.round(((curr - prev) / prev) * 100)
    return { val: curr - prev, pct }
  }

  function WeekTrend({ curr, prev, label, prefix = '' }) {
    const { val, pct } = weekDelta(curr, prev)
    return (
      <div className="card p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
        <p className="text-2xl font-bold text-white">{prefix}{typeof curr === 'number' ? curr.toLocaleString() : curr}</p>
        <div className={`flex items-center gap-1 mt-1 text-xs font-semibold ${val > 0 ? 'text-red-400' : val < 0 ? 'text-green-400' : 'text-gray-500'}`}>
          {val > 0 ? <TrendingUp size={11} /> : val < 0 ? <TrendingDown size={11} /> : <Minus size={11} />}
          {val !== 0 ? `${val > 0 ? '+' : ''}${prefix}${Math.abs(typeof val === 'number' ? val : val).toLocaleString()} (${pct > 0 ? '+' : ''}${pct}%) vs last week` : 'Same as last week'}
        </div>
      </div>
    )
  }

  async function generatePDF() {
    await exportDailyOpsBriefingPdf(
      {
        date: fmtDisp(selectedDate),
        kpis: {
          tyreChanges: todayRecs.length,
          inspections: todayIns.length,
          workOrders:  todayWO.length,
          alerts:      todayAlerts.length,
          cost:        todayCost,
        },
        priorityQueue: priorityQueue.slice(0, 15).map(i => ({
          severity: i.severity, type: i.type, asset: i.asset, description: i.description,
        })),
        siteActivity,
      },
      {
        company: branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse',
        branding,
        currency: activeCurrency,
        filename: `DailyOps_${selectedDate}`,
      },
    )
  }

  function printBriefing() {
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) return
    const rows = [
      ['Tyre Changes', todayRecs.length],
      ['Inspections', todayIns.length],
      ['Work Orders', todayWO.length],
      ['Alerts', todayAlerts.length],
      [`Cost (${activeCurrency})`, todayCost.toLocaleString(undefined, { maximumFractionDigits: 0 })],
    ]
    win.document.write(`<!DOCTYPE html><html><head><title>Daily Ops - ${selectedDate}</title>
<style>body{font-family:Arial,sans-serif;margin:0;padding:20px;background:#fff;color:#111}
h1{font-size:18px;color:#16a34a;margin-bottom:4px}p.sub{color:#666;font-size:12px;margin:0 0 16px}
table{border-collapse:collapse;width:100%;margin-bottom:20px}
th{background:#16a34a;color:#fff;padding:7px 10px;text-align:left;font-size:12px}
td{border:1px solid #e5e7eb;padding:6px 10px;font-size:12px}
tr:nth-child(even)td{background:#f9fafb}
h2{font-size:14px;color:#16a34a;margin:16px 0 6px}
.sev-Critical{color:#dc2626}
.sev-High{color:#ea580c}
.sev-Medium{color:#ca8a04}
.sev-Low{color:#2563eb}
</style></head><body>
<h1>Tyre Pulse - Daily Operations Briefing</h1>
<p class="sub">${fmtDisp(selectedDate)}</p>
<h2>Today's Activity Summary</h2>
<table><tr>${rows.map(([k]) => `<th>${k}</th>`).join('')}</tr>
<tr>${rows.map(([, v]) => `<td>${v}</td>`).join('')}</tr></table>
${priorityQueue.length > 0 ? `<h2>Priority Action Queue (${priorityQueue.length})</h2>
<table><tr><th>Severity</th><th>Type</th><th>Asset</th><th>Description</th></tr>
${priorityQueue.slice(0, 20).map(i => `<tr><td class="sev-${i.severity}">${i.severity}</td><td>${i.type}</td><td>${i.asset || '-'}</td><td>${i.description}</td></tr>`).join('')}
</table>` : ''}
${siteActivity.length > 0 ? `<h2>Site Activity</h2>
<table><tr><th>Site</th><th>Events</th></tr>
${siteActivity.map(([s, c]) => `<tr><td>${s}</td><td>${c}</td></tr>`).join('')}
</table>` : ''}
<p style="font-size:10px;color:#9ca3af;margin-top:20px">Generated by Tyre Pulse · ${new Date().toLocaleString()}</p>
</body></html>`)
    win.document.close()
    win.print()
  }

  const critCount = priorityQueue.filter(i => i.severity === 'Critical').length
  const highCount = priorityQueue.filter(i => i.severity === 'High').length

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">

      {/* Header + Navigator */}
      <PageHeader
        title="Daily Ops"
        subtitle={fmtDisp(selectedDate)}
        icon={CalendarDays}
        actions={<>
          <button onClick={() => navigate(-1)} className="p-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:border-gray-600 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => setSelectedDate(fmtDate(new Date()))}
            className="px-3 py-2 rounded-lg bg-green-900/30 border border-green-700/50 text-green-300 text-sm font-medium hover:bg-green-900/50 transition-colors">
            Today
          </button>
          <button onClick={() => navigate(1)} className="p-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:border-gray-600 transition-colors">
            <ChevronRight size={16} />
          </button>
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-300 text-sm focus:outline-none focus:border-green-700" />
          <button onClick={() => fetchData(selectedDate)} className="p-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-green-400 transition-colors">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={generatePDF} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-300 text-sm hover:text-white hover:border-gray-600 transition-colors">
            <FileText size={14} /> PDF
          </button>
          <button onClick={printBriefing} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-900/30 border border-green-700/50 text-green-300 text-sm font-medium hover:bg-green-900/50 transition-colors">
            <Printer size={14} /> Print Briefing
          </button>
        </>}
      />

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-gray-400">
            <RefreshCw size={18} className="animate-spin text-green-400" />
            <span>Loading daily operations data...</span>
          </div>
        </div>
      )}

      {!loading && (
        <>
          {/* Priority Action Queue */}
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert size={16} className="text-red-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Priority Action Queue</h2>
              {priorityQueue.length > 0 && (
                <div className="flex gap-1.5">
                  {critCount > 0 && <span className="px-1.5 py-0.5 rounded text-xs bg-red-900/50 text-red-300 border border-red-700/50">{critCount} Critical</span>}
                  {highCount > 0 && <span className="px-1.5 py-0.5 rounded text-xs bg-orange-900/30 text-orange-300 border border-orange-700/50">{highCount} High</span>}
                </div>
              )}
            </div>

            {priorityQueue.length === 0 ? (
              <div className="card p-6 flex items-center gap-3 text-green-400">
                <CheckCircle2 size={20} />
                <span className="text-sm font-medium">No priority actions for this date. All clear.</span>
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence>
                  {priorityQueue.slice(0, 12).map((item, i) => {
                    const cfg = SEV[item.severity] || SEV.Low
                    const Icon = cfg.icon
                    return (
                      <motion.div key={item.id}
                        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                        className={`flex items-start gap-3 p-3 rounded-xl border ${cfg.bg} ${cfg.border}`}>
                        <span className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${cfg.dot}`} />
                        <Icon size={15} className={`mt-0.5 flex-shrink-0 ${cfg.text}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-bold uppercase ${cfg.text}`}>{item.severity}</span>
                            <span className="text-xs text-gray-400">{item.type}</span>
                            {item.asset && <span className="text-xs font-mono text-white bg-gray-800 px-1.5 py-0.5 rounded">{item.asset}</span>}
                          </div>
                          <p className="text-sm text-gray-200 mt-0.5">{item.description}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{item.detail}</p>
                        </div>
                        {item.link && (
                          <a href={item.link} className={`flex-shrink-0 text-xs px-2.5 py-1.5 rounded-lg border ${cfg.border} ${cfg.text} hover:opacity-80 transition-opacity font-medium`}>
                            View
                          </a>
                        )}
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
                {priorityQueue.length > 12 && (
                  <p className="text-xs text-gray-500 text-center py-1">+{priorityQueue.length - 12} more items</p>
                )}
              </div>
            )}
          </motion.section>

          {/* Stat Cards */}
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
              <Activity size={14} className="text-green-400" /> Today's Activity Summary
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Tyre Changes', value: todayRecs.length, icon: CircleDot, color: 'text-green-400', bg: 'bg-green-900/20', border: 'border-green-800/40' },
                { label: 'Inspections', value: todayIns.length, icon: ClipboardList, color: 'text-blue-400', bg: 'bg-blue-900/20', border: 'border-blue-800/40' },
                { label: 'Work Orders', value: todayWO.length, icon: Wrench, color: 'text-purple-400', bg: 'bg-purple-900/20', border: 'border-purple-800/40' },
                { label: 'Alerts Raised', value: todayAlerts.length, icon: Bell, color: 'text-red-400', bg: 'bg-red-900/20', border: 'border-red-800/40' },
              ].map(({ label, value, icon: Icon, color, bg, border }) => (
                <motion.div key={label} whileHover={{ y: -2 }} className={`card p-4 ${bg} border ${border}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{label}</p>
                    <Icon size={14} className={color} />
                  </div>
                  <p className={`text-3xl font-bold ${color}`}>{value.toLocaleString()}</p>
                </motion.div>
              ))}
            </div>
          </motion.section>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

            {/* Activity Feed */}
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
              className="xl:col-span-2">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                <Activity size={14} className="text-green-400" /> Today's Activity Feed
              </h2>
              <div className="card p-0 overflow-hidden">
                {activityFeed.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-sm">No tyre activity recorded for this date.</div>
                ) : (
                  <div className="overflow-y-auto max-h-[420px]">
                    {activityFeed.map((ev, i) => (
                      <div key={ev.id} className={`flex items-start gap-3 px-4 py-3 border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors ${i === 0 ? '' : ''}`}>
                        <span className="text-[11px] font-mono text-gray-500 w-10 flex-shrink-0 mt-0.5">{fmtTime(ev.time)}</span>
                        <span className={`text-xs font-semibold w-24 flex-shrink-0 mt-0.5 ${EVENT_COLORS[ev.type] || 'text-gray-400'}`}>{ev.type}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-white">{ev.asset || '-'}</span>
                            {ev.site && <span className="text-xs text-gray-500">{ev.site}</span>}
                          </div>
                          <p className="text-xs text-gray-400 truncate">{ev.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.section>

            {/* Fleet Status Snapshot */}
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                <Truck size={14} className="text-green-400" /> Fleet Status Snapshot
              </h2>
              <div className="card p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { label: 'Active Today', value: vehiclesActiveToday, color: 'text-green-400' },
                    { label: 'Critical Risk', value: vehiclesCritical, color: 'text-red-400' },
                    { label: 'Dormant 30d', value: vehiclesDormant, color: 'text-gray-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="text-center p-2 rounded-lg bg-gray-800/40">
                      <p className={`text-xl font-bold ${color}`}>{value}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="h-48">
                  <Doughnut data={fleetStatusData} options={DOUGHNUT_OPTS} />
                </div>
              </div>
            </motion.section>
          </div>

          {/* Site Activity + Cost Tracker */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                <Building2 size={14} className="text-green-400" /> Site Activity Comparison
              </h2>
              <div className="card p-4">
                {siteActivity.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-gray-500 text-sm gap-2">
                    <ZapOff size={22} />
                    <span>No site activity for this date.</span>
                  </div>
                ) : (
                  <div className="h-52">
                    <Bar data={sitesChartData} options={CHART_OPTS} />
                  </div>
                )}
              </div>
            </motion.section>

            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                <DollarSign size={14} className="text-green-400" /> Daily Cost Tracker
              </h2>
              <div className="card p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[11px] text-gray-500 uppercase tracking-wider">Today's Spend</p>
                    <p className="text-2xl font-bold text-green-400">{activeCurrency} {todayCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                  </div>
                  {dailyBudget > 0 && (
                    <div className="text-right">
                      <p className="text-[11px] text-gray-500 uppercase tracking-wider">Daily Budget</p>
                      <p className="text-lg font-semibold text-gray-300">{activeCurrency} {dailyBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                      {todayCost > dailyBudget && <p className="text-xs text-red-400 font-medium mt-0.5">Over budget by {activeCurrency} {(todayCost - dailyBudget).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>}
                    </div>
                  )}
                </div>
                <div className="h-40">
                  <Doughnut data={costDoughnutData} options={DOUGHNUT_OPTS} />
                </div>
                {dailyBudget === 0 && <p className="text-xs text-gray-500 text-center">Set annual budget in KPI Targets to enable budget tracking.</p>}
              </div>
            </motion.section>
          </div>

          {/* This Week Summary (collapsible) */}
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <button onClick={() => setWeekOpen(p => !p)}
              className="w-full flex items-center justify-between text-sm font-bold text-white uppercase tracking-wider mb-3 group">
              <span className="flex items-center gap-2">
                <BarChart2 size={14} className="text-green-400" /> This Week Summary
                <span className="text-xs text-gray-500 normal-case font-normal">({fmtShort(thisWeekStart)} - {fmtShort(thisWeekEnd)})</span>
              </span>
              {weekOpen ? <ChevronUp size={14} className="text-gray-500 group-hover:text-white transition-colors" /> : <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />}
            </button>
            <AnimatePresence>
              {weekOpen && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }}>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <WeekTrend curr={thisWeekRecs.length} prev={lastWeekRecs.length} label="Tyre Changes" />
                    <WeekTrend curr={Math.round(thisWeekCost)} prev={Math.round(lastWeekCost)} label={`Cost (${activeCurrency})`} prefix="" />
                    <WeekTrend curr={thisWeekIns.length} prev={lastWeekIns.length} label="Inspections" />
                    <WeekTrend curr={thisWeekCrit} prev={lastWeekCrit} label="Critical Incidents" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>

          {/* Upcoming This Week */}
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
              <Clock size={14} className="text-green-400" /> Upcoming This Week
              <span className="text-xs text-gray-500 normal-case font-normal">(next 7 days)</span>
            </h2>
            {upcomingWOs.length === 0 ? (
              <div className="card p-5 text-center text-gray-500 text-sm">
                No upcoming work orders in the next 7 days.
              </div>
            ) : (
              <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {['Date', 'Asset', 'WO No.', 'Status', 'Priority', 'Site'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {upcomingWOs.map((wo, i) => {
                        const pc = { Critical: 'text-red-400', High: 'text-orange-400', Medium: 'text-yellow-400', Low: 'text-blue-400' }
                        return (
                          <tr key={wo.id} className={`border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}>
                            <td className="px-4 py-2.5 text-gray-300 font-mono text-xs">{fmtShort(wo.scheduled_date)}</td>
                            <td className="px-4 py-2.5 text-white font-medium">{wo.asset_no || '-'}</td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">{wo.work_order_no || wo.id?.slice(0, 8)}</td>
                            <td className="px-4 py-2.5">
                              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300">{wo.status}</span>
                            </td>
                            <td className={`px-4 py-2.5 text-xs font-semibold ${pc[wo.priority] || 'text-gray-400'}`}>{wo.priority || '-'}</td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">{wo.site || '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </motion.section>
        </>
      )}
    </div>
  )
}
