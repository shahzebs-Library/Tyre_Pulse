import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { ClipboardList, Plus, FileText, FileSpreadsheet, ChevronLeft, ChevronRight, Edit3, X, Trash2 } from 'lucide-react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useFeatureGate } from '../hooks/useFeatureFlags'
import { useEntityWorkflow } from '../hooks/useEntityWorkflow'
import { governingModuleKey } from '../lib/navAccess'
import { moduleAvailable } from '../lib/workspaceAccess'
import { severityRank } from '../lib/severity'
import { toUserMessage } from '../lib/safeError'
import { formatDate } from '../lib/formatters'
import { todayStr, addDays, monthBounds, getInspectionGap, getScheduleCompletion, getFleetCoverage } from '../lib/inspectionPlanner'
import { loadPlannerData, savePlannerSchedules, updateScheduleStatus, deletePlannerSchedule } from '../lib/api/inspectionPlanner'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme } from '../lib/exportUtils'
import { loadAutoTable } from '../lib/pdfEngine'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import PlannerWorkQueue from '../components/inspection-planner/PlannerWorkQueue'
import { ScheduleModal, BulkModal } from '../components/inspection-planner/PlannerDialogs'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)
const MODULE = governingModuleKey('/inspection-planner')
const assetKey = row => JSON.stringify([row.country || '', row.asset_no])
const pending = item => ['Scheduled', 'In Progress'].includes(item.status || 'Scheduled')
const emptyBundle = { inspections: [], tyreRecords: [], schedule: [], dataError: null, scheduleError: null, truncated: false }

export default function InspectionPlanner() {
  const auth = useAuth()
  const { activeCountry } = useSettings()
  const { orgId } = useTenant()
  const { language } = useLanguage()
  const allowed = moduleAvailable(auth, MODULE)
  const caps = ['create', 'edit', 'delete', 'export'].map(cap => auth.hasCapability?.(MODULE, cap) === true)
  const scope = JSON.stringify([activeCountry, orgId, auth.profile?.id, auth.profile?.role, auth.profile?.site, auth.profile?.sites, auth.profile?.country, auth.modulePerms, auth.grantedModules, auth.capabilities, caps])
  if (!allowed) return <p role="status" className="card text-sm">{language === 'ar' ? 'لا تتوفر صلاحية الوصول إلى مخطط الفحص.' : 'Inspection planner access is unavailable.'}</p>
  return <PlannerWorkspace key={scope} country={activeCountry} permissions={caps} />
}

function PlannerWorkspace({ country, permissions }) {
  const { appSettings } = useSettings()
  const { profile } = useAuth()
  const { branding } = useTenant()
  const { language, isRTL } = useLanguage()
  const vehicleFeature = useFeatureGate('vehicle_360')
  const copy = useCallback((en, ar) => language === 'ar' ? (ar || en) : en, [language])
  const [canCreate, canEdit, canDelete, canExport] = permissions
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const [bundle, setBundle] = useState(emptyBundle)
  const { inspections, tyreRecords, schedule, dataError, scheduleError, truncated } = bundle
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [interval, setIntervalDays] = useState(30)
  const [tab, setTab] = useState('queue')
  const [filterStatus, setFilterStatus] = useState('Overdue')
  const [selectedBulk, setSelectedBulk] = useState([])
  const [modal, setModal] = useState(null)
  const [target, setTarget] = useState(null)
  const [calendarPeriod, setCalendarPeriod] = useState(0)
  const [agendaStatus, setAgendaStatus] = useState('All')
  const [agendaInspector, setAgendaInspector] = useState('')
  const [agendaSearch, setAgendaSearch] = useState('')
  const [notice, setNotice] = useState('')
  const [today, setToday] = useState(todayStr)
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState('')
  const controller = useRef(null)
  const mounted = useRef(true)
  const fetchData = useCallback(async () => {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setRefreshing(true)
    try {
      const result = await loadPlannerData({ country, signal: request.signal })
      if (request.signal.aborted || !mounted.current) return
      setBundle({ ...emptyBundle, ...result })
      if (!result.dataError && !result.scheduleError) setUpdatedAt(new Date())
      setSelectedBulk([])
    } catch (err) {
      if (request.signal.aborted || !mounted.current) return
      const error = toUserMessage(err, 'Could not load the inspection planner. Please retry.')
      setBundle({ ...emptyBundle, dataError: error, scheduleError: error })
    } finally {
      if (!request.signal.aborted && mounted.current) { setLoading(false); setRefreshing(false) }
    }
  }, [country])
  useEffect(() => {
    mounted.current = true
    fetchData()
    return () => { mounted.current = false; controller.current?.abort() }
  }, [fetchData])
  useEffect(() => {
    const timer = window.setInterval(() => setToday(todayStr()), 60000)
    return () => window.clearInterval(timer)
  }, [])
  const thisMonth = monthBounds(today)
  const ready = !loading && !refreshing && !dataError && !scheduleError && !truncated
  const countrySelected = Boolean(country && country !== 'All')
  const canSchedule = canCreate && ready && countrySelected
  const distinctAssets = useMemo(() => {
    const map = new Map()
    for (const row of [...inspections, ...tyreRecords]) {
      if (!row.asset_no) continue
      const key = assetKey(row)
      if (!map.has(key)) map.set(key, { asset_no: row.asset_no, site: row.site, country: row.country, row_key: key })
    }
    return [...map.values()]
  }, [inspections, tyreRecords])
  const distinctInspectors = useMemo(() => [...new Set([...inspections, ...schedule].map(row => row.inspector_name).filter(Boolean))].sort(), [inspections, schedule])
  const workQueue = useMemo(() => {
    const lastByAsset = new Map()
    for (const row of inspections) {
      if (!row.inspection_date || row.inspection_date > today) continue
      const key = assetKey(row)
      if (!lastByAsset.has(key) || row.inspection_date > lastByAsset.get(key).inspection_date) lastByAsset.set(key, row)
    }
    const riskByAsset = new Map()
    for (const row of tyreRecords) {
      const key = assetKey(row)
      if (!riskByAsset.has(key) || severityRank(row.risk_level) > severityRank(riskByAsset.get(key))) riskByAsset.set(key, row.risk_level)
    }
    const nextByAsset = new Map()
    for (const item of schedule) {
      if (!pending(item) || item.inspection_date < today) continue
      const key = assetKey({ ...item, country: item.country || (countrySelected ? country : '') })
      const previous = nextByAsset.get(key)
      const order = `${item.inspection_date} ${item.inspection_time || ''}`
      if (!previous || order < `${previous.inspection_date} ${previous.inspection_time || ''}`) nextByAsset.set(key, item)
    }
    return distinctAssets.map(asset => {
      const last = lastByAsset.get(asset.row_key)
      const gap = getInspectionGap(last?.inspection_date, today, interval)
      const nextSchedule = nextByAsset.get(asset.row_key)
      return { ...asset, ...gap, due_date: last ? addDays(last.inspection_date, interval) : null,
        last_inspection: last?.inspection_date || null, recommended: interval, inspector: last?.inspector_name || '-',
        last_risk: riskByAsset.get(asset.row_key) || 'Unknown', nextSchedule }
    })
  }, [distinctAssets, inspections, tyreRecords, schedule, today, interval, countrySelected, country])
  const completion = getScheduleCompletion(schedule, { ...thisMonth, today })
  const coverage = getFleetCoverage(distinctAssets, inspections, { today, interval })
  const calendarStart = addDays(today, calendarPeriod * 7)
  const calendarEnd = addDays(calendarStart, 29)
  const agenda = schedule.filter(item => item.inspection_date >= calendarStart && item.inspection_date <= calendarEnd
    && (agendaStatus === 'All' || item.status === agendaStatus)
    && (!agendaInspector || item.inspector_name === agendaInspector)
    && (!agendaSearch.trim() || [item.asset_no, item.site].some(value => String(value || '').toLowerCase().includes(agendaSearch.trim().toLowerCase()))))
    .sort((a, b) => a.inspection_date.localeCompare(b.inspection_date) || String(a.inspection_time || '').localeCompare(String(b.inspection_time || '')))
  const inspectorBoard = distinctInspectors.map(name => {
    const assigned = schedule.filter(item => item.inspector_name === name && pending(item))
    return { name, upcoming: assigned.filter(item => item.inspection_date >= today).length,
      missed: assigned.filter(item => item.inspection_date < today).length,
      readings: inspections.filter(item => item.inspector_name === name && item.inspection_date >= thisMonth.start && item.inspection_date <= today).length,
      completion: getScheduleCompletion(schedule, { ...thisMonth, today, inspectorName: name }) }
  }).sort((a, b) => b.missed - a.missed || b.upcoming - a.upcoming)
  const frequency = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, index) => monthBounds(today, index - 5))
    const sites = new Map()
    for (const row of inspections) {
      if (!row.site || !row.inspection_date || row.inspection_date < months[0].start || row.inspection_date > today) continue
      const key = JSON.stringify([row.country || '', row.site])
      if (!sites.has(key)) sites.set(key, { site: [row.site, row.country].filter(Boolean).join(' · '), counts: months.map(() => 0) })
      const index = months.findIndex(month => row.inspection_date >= month.start && row.inspection_date <= month.end)
      if (index >= 0) sites.get(key).counts[index]++
    }
    return { months, sites: [...sites.values()].sort((a, b) => a.site.localeCompare(b.site)) }
  }, [inspections, today])
  const closeModal = () => { setModal(null); setTarget(null) }
  async function saveItems(items) {
    const editing = items.length === 1 && Boolean(items[0].id)
    if (!ready || (editing ? !canEdit || !countrySelected : !canSchedule)) throw new Error(copy('Scheduling is unavailable. Check the selected country and your access, then refresh.', 'الجدولة غير متاحة. تحقق من الدولة والصلاحيات ثم حدث الصفحة.'))
    await savePlannerSchedules(items, { country, profileId: profile?.id })
    if (!mounted.current) return
    closeModal()
    setSelectedBulk([])
    setNotice(copy('Inspection schedule saved.', 'تم حفظ موعد الفحص.'))
    await fetchData()
  }
  async function exportFile(kind) {
    if (!canExport || !ready || exportLoading) return
    setExportLoading(true)
    setExportError('')
    const exportRows = tab === 'agenda' ? agenda : schedule
    try {
      if (kind === 'excel') {
        const XLSX = await import('xlsx')
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows.map(item => ({ Asset: item.asset_no, Country: item.country || '', Date: item.inspection_date, Time: item.inspection_time, Inspector: item.inspector_name, Site: item.site, Type: item.type, Status: item.status, Notes: item.notes }))), 'Schedule')
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(workQueue.map(row => ({ Asset: row.asset_no, Country: row.country || '', Site: row.site, 'Days since inspection': row.days_since ?? 'Never inspected', 'Analysis interval': interval, Status: row.status, 'Last inspector': row.inspector }))), 'Inspection gaps')
        XLSX.writeFile(workbook, 'inspection_planner.xlsx')
      } else {
        const { default: jsPDF } = await import('jspdf')
        const autoTable = await loadAutoTable()
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
        const brand = await resolvePdfBrand(branding)
        pdfHeader(doc, 'Inspection Schedule', tab === 'agenda' ? `${calendarStart} - ${calendarEnd}` : formatDate(new Date()), company, brand)
        const rows = exportRows.map(item => [item.asset_no, item.country || '', item.inspection_date, item.inspection_time, item.inspector_name, item.site, item.type, item.status, item.notes])
        if (!rows.length) pdfEmptyState(doc, 'No scheduled inspections in this scope')
        else autoTable(doc, { ...pdfTableTheme(brand.accent), startY: 28, head: [['Asset', 'Country', 'Date', 'Time', 'Inspector', 'Site', 'Type', 'Status', 'Notes']], body: rows })
        const pages = doc.internal.getNumberOfPages()
        for (let page = 1; page <= pages; page++) { doc.setPage(page); pdfFooter(doc, page, pages, company, brand) }
        doc.save('inspection_schedule.pdf')
      }
    } catch (err) { if (mounted.current) setExportError(toUserMessage(err, copy('Could not export the inspection planner. Please try again.', 'تعذر تصدير مخطط الفحص. حاول مرة أخرى.'))) }
    finally { if (mounted.current) setExportLoading(false) }
  }
  const summaries = [
    ['Overdue', copy('Overdue', 'متأخر'), workQueue.filter(row => row.status === 'Overdue').length],
    ['Due Today', copy('Due today', 'مستحق اليوم'), workQueue.filter(row => row.due_date === today).length],
    ['Due Soon', copy('Due soon', 'مستحق قريباً'), workQueue.filter(row => row.status === 'Due Soon').length],
    ['No History', copy('Never inspected', 'لم يتم فحصها'), workQueue.filter(row => row.status === 'No History').length],
    ['Unassigned', copy('Unassigned', 'غير مسند'), workQueue.filter(row => row.nextSchedule && !row.nextSchedule.inspector_name).length],
  ]
  const navigation = [['queue', copy('Work queue', 'قائمة الأعمال')], ['agenda', copy('Agenda', 'جدول المواعيد')], ['inspectors', copy('Inspectors', 'الفاحصون')], ['analytics', copy('Analytics', 'التحليلات')]]
  return <div className="space-y-6 text-[var(--text-primary)]" dir={isRTL ? 'rtl' : 'ltr'}>
    <PageHeader title={copy('Inspection Planner', 'مخطط الفحص')} icon={ClipboardList}
      subtitle={copy(`${country || 'All'} · ${loading || dataError ? 'Asset data unavailable' : `${distinctAssets.length} known assets`}`, `${country || 'الكل'} · ${loading || dataError ? 'بيانات المركبات غير متاحة' : `${distinctAssets.length} مركبة معروفة`}`)}
      onRefresh={fetchData} refreshing={refreshing} updatedAt={updatedAt}
      actions={<div className="flex flex-wrap gap-2">{canExport && <details className="relative"><summary className="btn-secondary cursor-pointer">{copy('Export', 'تصدير')}</summary><div className="absolute end-0 z-20 mt-2 min-w-48 rounded-lg border border-[var(--input-border)] bg-[var(--panel)] p-2 shadow-lg"><button className="btn-secondary w-full" disabled={!ready || exportLoading} onClick={() => exportFile('pdf')}><FileText size={15} /> PDF</button><button className="btn-secondary mt-2 w-full" disabled={!ready || exportLoading} onClick={() => exportFile('excel')}><FileSpreadsheet size={15} /> Excel</button></div></details>}<button className="btn-primary" disabled={!canSchedule} onClick={() => { setNotice(''); setTarget(null); setModal('schedule') }}><Plus size={16} />{copy('Schedule inspection', 'جدولة فحص')}</button></div>} />
    {!countrySelected && <p className="text-sm text-[var(--text-secondary)]">{copy('Select a country to create or edit inspection appointments.', 'حدد دولة لإنشاء مواعيد الفحص أو تعديلها.')}</p>}
    {notice && <p role="status" className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm">{notice}</p>}
    {(dataError || scheduleError) && <div role="alert" className="card border-red-500/40 text-sm space-y-2">{dataError && <p>{dataError}</p>}{scheduleError && scheduleError !== dataError && <p>{scheduleError}</p>}<button className="btn-secondary" onClick={fetchData} disabled={refreshing}>{copy('Retry loading planner', 'إعادة تحميل المخطط')}</button></div>}
    {truncated && <p role="alert" className="card text-sm">{copy('The source limit was reached. Counts describe loaded records only; narrow the country scope before scheduling or exporting.', 'تم بلوغ حد البيانات. الأعداد تخص السجلات المحملة فقط؛ حدد نطاق الدولة قبل الجدولة أو التصدير.')}</p>}
    {exportError && <p role="alert" className="card text-sm">{exportError}</p>}
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{summaries.map(([status, label, count]) => <button key={status} type="button" aria-label={label} aria-pressed={tab === 'queue' && filterStatus === status} disabled={loading || Boolean(dataError) || (status === 'Unassigned' && Boolean(scheduleError))}
      className={`card text-start p-4 transition-colors ${tab === 'queue' && filterStatus === status ? 'ring-2 ring-[var(--brand)]' : ''}`} onClick={() => { setFilterStatus(status); setTab('queue') }}><span className="block text-sm text-[var(--panel-ink-3)]">{label}</span><strong className="mt-1 block text-2xl">{loading || dataError || (status === 'Unassigned' && scheduleError) ? '—' : count}</strong></button>)}</div>
    <div className="card flex flex-wrap items-center justify-between gap-3 p-4"><div><label className="font-medium text-sm" htmlFor="planner-interval">{copy('Analysis interval', 'فترة التحليل')}</label><p className="text-sm text-[var(--panel-ink-3)]">{copy('Temporary view setting; does not change saved inspection policies.', 'إعداد مؤقت للعرض؛ لا يغير سياسات الفحص المحفوظة.')}</p></div><select id="planner-interval" className="input w-auto text-sm" value={interval} onChange={event => setIntervalDays(Number(event.target.value))}>{[7, 14, 30, 60].map(days => <option key={days} value={days}>{copy(`${days} days`, `${days} يوم`)}</option>)}</select></div>
    <nav aria-label={copy('Planner views', 'عروض المخطط')} className="flex flex-wrap gap-2 border-b border-[var(--hairline)] pb-3">{navigation.map(([id, label]) => <button type="button" key={id} className={tab === id ? 'btn-primary' : 'btn-secondary'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'queue' && <PlannerWorkQueue rows={workQueue} today={today} filterStatus={filterStatus} onFilterStatusChange={setFilterStatus} selectedBulk={selectedBulk} onSelectionChange={setSelectedBulk}
      onSchedule={row => { setNotice(''); setTarget(row); setModal('schedule') }} onBulkSchedule={() => setModal('bulk')} copy={copy} loading={loading} error={dataError} onRetry={fetchData} canSchedule={canSchedule}
      canViewAsset={countrySelected && vehicleFeature} scheduleAvailable={!scheduleError} />}
    {tab === 'agenda' && <section className="card p-4 space-y-4"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">{copy('Scheduled inspection agenda', 'جدول الفحوصات المجدولة')}</h2><p className="text-sm text-[var(--text-secondary)]"><bdi>{calendarStart} — {calendarEnd}</bdi></p></div><div className="flex gap-2"><button className="btn-secondary" aria-label={copy('Previous week', 'الأسبوع السابق')} onClick={() => setCalendarPeriod(value => value - 1)}><ChevronLeft size={16} className="rtl:rotate-180" /></button><button className="btn-secondary" onClick={() => setCalendarPeriod(0)}>{copy('Today', 'اليوم')}</button><button className="btn-secondary" aria-label={copy('Next week', 'الأسبوع التالي')} onClick={() => setCalendarPeriod(value => value + 1)}><ChevronRight size={16} className="rtl:rotate-180" /></button></div></div>
      <p className="text-sm text-[var(--text-secondary)]">{copy('Appointment status is recorded on the schedule. Inspection readings are summarized separately in Analytics.', 'حالة الموعد مسجلة في الجدول. تلخص قراءات الفحص بشكل منفصل في التحليلات.')}</p>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">{copy('Search asset or site', 'البحث عن أصل أو موقع')}<input className="input text-sm" value={agendaSearch} onChange={event => setAgendaSearch(event.target.value)} /></label>
        <label className="text-sm">{copy('Appointment status', 'حالة الموعد')}<select className="input text-sm" value={agendaStatus} onChange={event => setAgendaStatus(event.target.value)}>{[['All', 'الكل'], ['Scheduled', 'مجدول'], ['In Progress', 'قيد التنفيذ'], ['Completed', 'مكتمل'], ['Cancelled', 'ملغى']].map(([value, ar]) => <option key={value} value={value}>{copy(value, ar)}</option>)}</select></label>
        <label className="text-sm">{copy('Appointment inspector', 'مفتش الموعد')}<select className="input text-sm" value={agendaInspector} onChange={event => setAgendaInspector(event.target.value)}><option value="">{copy('All inspectors', 'كل المفتشين')}</option>{distinctInspectors.map(name => <option key={name}>{name}</option>)}</select></label>
        <button className="btn-secondary self-end" onClick={() => { setAgendaSearch(''); setAgendaStatus('All'); setAgendaInspector('') }}>{copy('Clear filters', 'مسح المرشحات')}</button>
      </div>
      {loading ? <p>{copy('Loading schedule…', 'جار تحميل الجدول…')}</p> : scheduleError ? <p role="status">{copy('Schedule unavailable. Retry loading above.', 'الجدول غير متاح. أعد التحميل أعلاه.')}</p> : !agenda.length ? <p className="py-8 text-center text-sm">{copy('No inspections scheduled for this period.', 'لا توجد فحوصات مجدولة لهذه الفترة.')}</p> : <div className="space-y-3">{agenda.map(item => <article key={item.id} className="flex flex-wrap justify-between items-center gap-3 rounded-xl border border-[var(--hairline)] p-3"><div className="space-y-1"><div className="flex flex-wrap gap-2 items-center"><strong>{item.asset_no}</strong><span className="text-sm rounded-full border px-2 py-0.5" style={{ borderColor: item.status === 'Completed' ? 'var(--brand)' : item.status === 'Scheduled' ? '#3b82f6' : 'var(--hairline)' }}>{copy(item.status || 'Scheduled', { Scheduled: 'مجدول', Completed: 'مكتمل', Cancelled: 'ملغي', 'In Progress': 'قيد التنفيذ' }[item.status] || 'مجدول')}</span></div><p className="text-sm"><bdi>{item.inspection_date} {item.inspection_time?.slice(0, 5)}</bdi> · {item.inspector_name || copy('Unassigned', 'غير مسند')}</p><p className="text-sm text-[var(--text-secondary)]">{[item.site, item.country, item.type].filter(Boolean).join(' · ')}</p></div>{item.status !== 'Completed' && <div className="flex flex-wrap gap-2">{canEdit && <button className="btn-secondary" disabled={!ready || !countrySelected} aria-label={copy(`Edit ${item.asset_no}`, `تعديل ${item.asset_no}`)} onClick={() => { setTarget(item); setModal('edit') }}><Edit3 size={15} />{copy('Edit', 'تعديل')}</button>}{canEdit && pending(item) && <button className="btn-secondary" disabled={!ready} onClick={() => { setTarget(item); setModal('cancel') }}><X size={15} />{copy('Cancel appointment', 'إلغاء الموعد')}</button>}{canDelete && <button className="btn-secondary" disabled={!ready} onClick={() => { setTarget(item); setModal('delete') }}><Trash2 size={15} />{copy('Delete', 'حذف')}</button>}</div>}</article>)}</div>}
    </section>}
    {tab === 'inspectors' && <section className="space-y-4"><p className="text-sm text-[var(--text-secondary)]">{copy('Upcoming assignments and missed appointments. Availability and working-hour capacity are not recorded here.', 'التكليفات القادمة والمواعيد الفائتة. التوفر وسعة ساعات العمل غير مسجلين هنا.')}</p>{loading || dataError || scheduleError ? <p>{copy('Inspector metrics unavailable until all sources load.', 'مؤشرات الفاحصين غير متاحة حتى تحميل جميع المصادر.')}</p> : !inspectorBoard.length ? <p className="card">{copy('No inspector data yet.', 'لا توجد بيانات فاحصين بعد.')}</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{inspectorBoard.map(inspector => <article className="card p-4 space-y-3" key={inspector.name}><h2 className="font-semibold">{inspector.name}</h2><dl className="space-y-2 text-sm">{[[copy('Upcoming jobs', 'الأعمال القادمة'), inspector.upcoming], [copy('Missed appointments', 'المواعيد الفائتة'), inspector.missed], [copy('Inspection readings this month', 'قراءات الفحص هذا الشهر'), inspector.readings], [copy('Schedule completion this month', 'إنجاز الجدول هذا الشهر'), inspector.completion.rate === null ? '—' : `${inspector.completion.rate}%`]].map(([label, value]) => <div className="flex justify-between gap-2" key={label}><dt className="text-[var(--text-secondary)]">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl><button className="btn-secondary" onClick={() => { setTarget({ inspector_name: inspector.name }); setModal('schedule') }} disabled={!canSchedule}>{copy('Assign inspection', 'إسناد فحص')}</button></article>)}</div>}</section>}
    {tab === 'analytics' && <section className="space-y-4"><div className="grid gap-4 md:grid-cols-2"><div className="card p-4"><h2 className="font-semibold">{copy('Schedule completion this month', 'إنجاز الجدول هذا الشهر')}</h2><p className="text-2xl font-bold my-2">{loading || scheduleError || completion.rate === null ? '—' : `${completion.rate}%`}</p><p className="text-sm text-[var(--text-secondary)]">{copy('Recorded Completed appointments ÷ non-cancelled appointments due this month through today. This does not measure on-time completion.', 'المواعيد المسجلة كمكتملة ÷ المواعيد غير الملغاة المستحقة هذا الشهر حتى اليوم. لا يقيس الالتزام بوقت الإنجاز.')}</p></div><div className="card p-4"><h2 className="font-semibold">{copy('Known-asset inspection coverage', 'تغطية فحص المركبات المعروفة')}</h2><p className="text-2xl font-bold my-2">{loading || dataError || coverage.rate === null ? '—' : `${coverage.rate}%`}</p><p className="text-sm text-[var(--text-secondary)]">{copy(`Known assets with a reading in the last ${interval} days. The asset list comes from inspection and tyre records, not the full fleet register.`, `المركبات المعروفة ذات قراءة خلال آخر ${interval} يوم. القائمة من سجلات الفحص والإطارات وليست سجل الأسطول الكامل.`)}</p></div></div>
      <div className="card p-4"><h2 className="font-semibold mb-4">{copy('Inspection readings by site · Last 6 months', 'قراءات الفحص حسب الموقع · آخر ٦ أشهر')}</h2>{loading || dataError ? <p>{copy('Inspection analytics unavailable.', 'تحليلات الفحص غير متاحة.')}</p> : !frequency.sites.length ? <p>{copy('No site data available.', 'لا توجد بيانات للمواقع.')}</p> : <SiteAnalytics frequency={frequency} copy={copy} language={language} />}</div>
    </section>}
    {(modal === 'schedule' || modal === 'edit') && <ScheduleModal key={`${modal}:${target?.id || target?.row_key || 'new'}`} prefill={target} assets={distinctAssets} inspectors={distinctInspectors} schedule={schedule} canSchedule={modal === 'edit' ? canEdit && ready && countrySelected : canSchedule} t={copy} onClose={closeModal} onSave={item => saveItems([item])} />}
    {modal === 'bulk' && <BulkModal selected={selectedBulk} inspectors={distinctInspectors} schedule={schedule} canSchedule={canSchedule} t={copy} onClose={closeModal} onSave={saveItems} />}
    {(modal === 'cancel' || modal === 'delete') && target && <ScheduleConfirmation key={`${modal}:${target.id}`} mode={modal} item={target} copy={copy} onClose={closeModal} enabled={ready && (modal === 'cancel' ? canEdit : canDelete)} onConfirm={async () => {
      if (!ready || (modal === 'cancel' ? !canEdit : !canDelete)) throw new Error(copy('This action is unavailable.', 'هذا الإجراء غير متاح.'))
      if (modal === 'cancel') await updateScheduleStatus(target.id, 'Cancelled')
      else await deletePlannerSchedule(target.id)
      if (!mounted.current) return
      closeModal()
      await fetchData()
    }} />}
  </div>
}

function ScheduleConfirmation({ mode, item, copy, onClose, onConfirm, enabled }) {
  const workflow = useEntityWorkflow('pm_service', item.id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const locked = workflow.loading || Boolean(workflow.error) || workflow.isActive || workflow.isLocked
  async function confirm() {
    if (saving || locked || !enabled) return
    setSaving(true)
    setError('')
    try { await onConfirm() }
    catch (err) { setError(toUserMessage(err, copy('Could not update this appointment. Please retry.', 'تعذر تحديث الموعد. أعد المحاولة.'))) }
    finally { setSaving(false) }
  }
  return <Modal open title={mode === 'delete' ? copy('Delete scheduled inspection', 'حذف الفحص المجدول') : copy('Cancel scheduled inspection', 'إلغاء الفحص المجدول')} onClose={saving ? undefined : onClose}
    footer={<><button className="btn-secondary" disabled={saving} onClick={onClose}>{copy('Keep appointment', 'الاحتفاظ بالموعد')}</button><button className="btn-primary" disabled={saving || locked || !enabled} onClick={confirm}>{saving ? copy('Saving…', 'جار الحفظ…') : mode === 'delete' ? copy('Delete inspection', 'حذف الفحص') : copy('Confirm cancellation', 'تأكيد الإلغاء')}</button></>}>
    <p className="text-sm">{item.asset_no} · <bdi>{item.inspection_date}</bdi></p><p className="mt-3 text-sm text-[var(--text-secondary)]">{mode === 'delete' ? copy('This permanently removes the scheduled appointment. Inspection readings are retained.', 'يحذف هذا الموعد المجدول نهائياً. تبقى قراءات الفحص محفوظة.') : copy('This marks the appointment as Cancelled and keeps its record.', 'يضع هذا الموعد في حالة ملغي مع الاحتفاظ بسجله.')}</p>
    {locked && <p role="status" className="mt-3 text-sm">{workflow.loading ? copy('Checking approval…', 'جار التحقق من الاعتماد…') : workflow.error ? copy('Approval state unavailable. Close and retry.', 'حالة الاعتماد غير متاحة. أغلق وأعد المحاولة.') : copy('This appointment is locked by its approval workflow.', 'هذا الموعد مقفل بواسطة دورة الاعتماد.')}</p>}
    {error && <p role="alert" className="mt-3 text-sm">{error}</p>}
  </Modal>
}

function SiteAnalytics({ frequency, copy, language }) {
  const rootStyles = getComputedStyle(document.documentElement)
  const ink = rootStyles.getPropertyValue('--text-secondary').trim() || '#667085'
  const border = rootStyles.getPropertyValue('--input-border').trim() || '#94a3b8'
  const brand = rootStyles.getPropertyValue('--brand').trim() || '#16a34a'
  const labels = frequency.months.map(month => new Date(`${month.start}T00:00:00Z`).toLocaleDateString(language === 'ar' ? 'ar' : 'en', { month: 'short', year: 'numeric', timeZone: 'UTC' }))
  const chartSites = frequency.sites.slice(0, 6)
  const colors = [brand, '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#0891b2']
  return <><p className="mb-3 text-sm text-[var(--text-secondary)]">{copy('Counts are inspection readings, which may include multiple tyres per vehicle. Chart shows up to six sites; the table includes every site.', 'الأعداد هي قراءات فحص وقد تتضمن عدة إطارات للمركبة. يعرض الرسم حتى ستة مواقع؛ يشمل الجدول جميع المواقع.')}</p><div className="h-72"><Bar data={{ labels, datasets: chartSites.map((site, index) => ({ label: site.site, data: site.counts, backgroundColor: colors[index], borderRadius: 4 })) }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: ink } } }, scales: { x: { ticks: { color: ink }, grid: { color: border } }, y: { beginAtZero: true, ticks: { color: ink, precision: 0 }, grid: { color: border } } } }} /></div><div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">{copy('Monthly inspection readings by site', 'قراءات الفحص الشهرية حسب الموقع')}</caption><thead><tr><th className="p-2 text-start">{copy('Site', 'الموقع')}</th>{labels.map(label => <th key={label} className="p-2 text-end">{label}</th>)}</tr></thead><tbody>{frequency.sites.map(site => <tr key={site.site} className="border-t border-[var(--hairline)]"><th scope="row" className="p-2 text-start font-medium">{site.site}</th>{site.counts.map((count, index) => <td key={index} className="p-2 text-end">{count}</td>)}</tr>)}</tbody></table></div></>
}
