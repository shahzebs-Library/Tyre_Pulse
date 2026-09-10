import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { TablePagination, usePagedRows } from '../ui/TablePagination'

const english = en => en
const EMPTY = []
const STATUS = {
  All: ['All', 'الكل'], Overdue: ['Overdue', 'متأخر'],
  'Due Today': ['Due today', 'مستحق اليوم'], 'Due Soon': ['Due soon', 'مستحق قريباً'],
  'On Track': ['On track', 'ضمن الموعد'], 'No History': ['Never inspected', 'لم يتم فحصها'],
  Unassigned: ['Unassigned', 'غير مسند'],
}
const RISK = { Critical: 4, High: 3, Medium: 2, Low: 1, Unknown: 0 }
const inputClass = 'input text-sm w-full'
const rowKey = row => row.row_key || row.asset_no
const rowLabel = row => row.country ? `${row.asset_no} (${row.country})` : row.asset_no

function localToday() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export default function PlannerWorkQueue({
  rows = EMPTY, filterStatus = 'All', onFilterStatusChange,
  selectedBulk = EMPTY, onSelectionChange, onSchedule, onBulkSchedule,
  loading = false, error, onRetry, copy = english, today = localToday(), canViewAsset = false, canSchedule = true, scheduleAvailable = true,
}) {
  const [search, setSearch] = useState('')
  const [site, setSite] = useState('')
  const [risk, setRisk] = useState('')
  const [sort, setSort] = useState('urgency')
  const sites = useMemo(() => [...new Set(rows.map(row => row.site).filter(Boolean))].sort(), [rows])
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rows.filter(row => {
      const statusMatch = filterStatus === 'All'
        || (filterStatus === 'Due Today' ? row.due_date === today
          : filterStatus === 'Unassigned' ? row.nextSchedule && !row.nextSchedule.inspector_name
            : row.status === filterStatus)
      return statusMatch && (!site || row.site === site) && (!risk || row.last_risk === risk)
        && (!query || [row.asset_no, row.site, row.inspector, row.nextSchedule?.inspector_name]
          .some(value => String(value || '').toLowerCase().includes(query)))
    }).sort((a, b) => {
      if (sort === 'site') return String(a.site || '').localeCompare(String(b.site || '')) || String(a.asset_no).localeCompare(String(b.asset_no))
      if (sort === 'risk') return (RISK[b.last_risk] || 0) - (RISK[a.last_risk] || 0) || String(a.asset_no).localeCompare(String(b.asset_no))
      if (sort === 'date') return String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || String(a.asset_no).localeCompare(String(b.asset_no))
      return (b.days_overdue ?? -Infinity) - (a.days_overdue ?? -Infinity) || String(a.asset_no).localeCompare(String(b.asset_no))
    })
  }, [rows, search, site, risk, sort, filterStatus, today])
  const pager = usePagedRows(filtered)
  const selectedIds = new Set(selectedBulk.map(rowKey))
  const visibleSelected = pager.pageRows.filter(row => selectedIds.has(rowKey(row))).length
  const allVisible = pager.pageRows.length > 0 && visibleSelected === pager.pageRows.length
  const togglePage = () => {
    const visibleIds = new Set(pager.pageRows.map(rowKey))
    onSelectionChange(allVisible ? selectedBulk.filter(row => !visibleIds.has(rowKey(row)))
      : [...selectedBulk, ...pager.pageRows.filter(row => !selectedIds.has(rowKey(row)))])
  }
  const changeFilter = setter => event => { setter(event.target.value); pager.setPage(0) }
  const label = status => copy(...(STATUS[status] || [status, status]))

  return <section className="card overflow-hidden" aria-label={copy('Inspection work queue', 'قائمة أعمال الفحص')} aria-busy={loading}>
    <div className="p-4 space-y-4">
      <div><h2 className="text-lg font-semibold text-[var(--panel-ink)]">{copy('Inspection work queue', 'قائمة أعمال الفحص')}</h2>
        <p className="text-sm text-[var(--panel-ink-3)]">{copy('Prioritize due inspections and check existing assignments before scheduling.', 'حدد أولوية الفحوصات المستحقة وتحقق من التكليفات الحالية قبل الجدولة.')}</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <label className="text-sm text-[var(--panel-ink-2)]">{copy('Search assets or inspectors', 'البحث عن مركبة أو فاحص')}<input className={inputClass} value={search} onChange={changeFilter(setSearch)} type="search" /></label>
        <label className="text-sm text-[var(--panel-ink-2)]">{copy('Status', 'الحالة')}<select className={inputClass} value={filterStatus} onChange={changeFilter(onFilterStatusChange)}>{Object.keys(STATUS).map(status => <option key={status} value={status}>{label(status)}</option>)}</select></label>
        <label className="text-sm text-[var(--panel-ink-2)]">{copy('Site', 'الموقع')}<select className={inputClass} value={site} onChange={changeFilter(setSite)}><option value="">{copy('All sites', 'كل المواقع')}</option>{sites.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm text-[var(--panel-ink-2)]">{copy('Risk', 'المخاطر')}<select className={inputClass} value={risk} onChange={changeFilter(setRisk)}><option value="">{copy('All risks', 'كل المخاطر')}</option>{Object.keys(RISK).map(value => <option key={value} value={value}>{copy(value, { Critical: 'حرج', High: 'مرتفع', Medium: 'متوسط', Low: 'منخفض', Unknown: 'غير معروف' }[value])}</option>)}</select></label>
        <label className="text-sm text-[var(--panel-ink-2)]">{copy('Sort by', 'ترتيب حسب')}<select className={inputClass} value={sort} onChange={changeFilter(setSort)}><option value="urgency">{copy('Most overdue', 'الأكثر تأخراً')}</option><option value="date">{copy('Due date', 'تاريخ الاستحقاق')}</option><option value="site">{copy('Site', 'الموقع')}</option><option value="risk">{copy('Highest risk', 'الأعلى خطورة')}</option></select></label>
      </div>
      <p className="text-sm text-[var(--panel-ink-3)]" role="status">{copy(`${filtered.length} matching assets · ${visibleSelected} selected on this page`, `${filtered.length} مركبة مطابقة · ${visibleSelected} محددة في هذه الصفحة`)}</p>
    </div>
    {error ? <div role="alert" className="p-4 text-sm text-[var(--panel-ink)]">{error}{onRetry && <button type="button" className="btn-secondary ms-3" onClick={onRetry}>{copy('Retry', 'إعادة المحاولة')}</button>}</div>
      : loading ? <p className="p-8 text-center text-sm text-[var(--panel-ink-3)]">{copy('Loading inspection queue…', 'جار تحميل قائمة الفحص…')}</p>
        : filtered.length === 0 ? <div className="p-8 text-center"><p className="text-[var(--panel-ink)]">{copy('No assets match these filters.', 'لا توجد مركبات تطابق عوامل التصفية.')}</p><button className="btn-secondary mt-3" type="button" onClick={() => { setSearch(''); setSite(''); setRisk(''); onFilterStatusChange('All') }}>{copy('Clear filters', 'مسح عوامل التصفية')}</button></div>
          : <><div className="overflow-x-auto"><table className="w-full text-sm text-start text-[var(--panel-ink-2)]"><thead className="bg-[var(--panel-2)]"><tr>
            <th className="p-3"><input type="checkbox" aria-label={copy('Select visible page', 'تحديد الصفحة الحالية')} checked={allVisible} ref={node => { if (node) node.indeterminate = visibleSelected > 0 && !allVisible }} onChange={togglePage} /></th>
            {[[ 'Asset / site', 'المركبة / الموقع' ], ['Inspection status', 'حالة الفحص'], ['Due date', 'تاريخ الاستحقاق'], ['Last inspection', 'آخر فحص'], ['Risk', 'المخاطر'], ['Next appointment / inspector', 'الموعد القادم / الفاحص'], ['Action', 'الإجراء']].map(([en, ar]) => <th scope="col" className="p-3 text-start whitespace-nowrap" key={en}>{copy(en, ar)}</th>)}
          </tr></thead><tbody>{pager.pageRows.map(row => <tr key={rowKey(row)} className="border-t border-[var(--hairline)] hover:bg-[var(--panel-2)]">
            <td className="p-3"><input type="checkbox" aria-label={copy(`Select ${rowLabel(row)}`, `تحديد ${rowLabel(row)}`)} checked={selectedIds.has(rowKey(row))} onChange={() => onSelectionChange(selectedIds.has(rowKey(row)) ? selectedBulk.filter(value => rowKey(value) !== rowKey(row)) : [...selectedBulk, row])} /></td>
            <td className="p-3 whitespace-nowrap">{canViewAsset ? <Link className="font-semibold underline text-[var(--brand-on-tint)]" to={`/vehicle/${encodeURIComponent(row.asset_no)}`}>{row.asset_no}</Link> : <span className="font-semibold text-[var(--panel-ink)]">{row.asset_no}</span>}<div className="text-[var(--panel-ink-3)]">{[row.site, row.country].filter(Boolean).join(' · ') || '—'}</div></td>
            <td className="p-3 whitespace-nowrap"><span className="inline-flex rounded-full border px-2 py-1 text-[var(--panel-ink)]" style={{ borderColor: row.status === 'Overdue' ? '#ef4444' : row.status === 'Due Soon' || row.due_date === today ? '#f59e0b' : row.status === 'On Track' ? 'var(--brand)' : 'var(--hairline)' }}>{label(row.due_date === today ? 'Due Today' : row.status)}</span>{row.days_overdue > 0 && <div className="mt-1">{copy(`${row.days_overdue} days overdue`, `متأخر ${row.days_overdue} يوم`)}</div>}</td>
            <td className="p-3 whitespace-nowrap"><bdi>{row.due_date || '—'}</bdi></td>
            <td className="p-3 whitespace-nowrap"><bdi>{row.last_inspection?.slice(0, 10) || copy('Never inspected', 'لم يتم فحصها')}</bdi><div className="text-[var(--panel-ink-3)]">{row.inspector && row.inspector !== '-' ? copy(`Last inspector: ${row.inspector}`, `الفاحص السابق: ${row.inspector}`) : '—'}</div></td>
            <td className="p-3">{copy(row.last_risk || 'Unknown', { Critical: 'حرج', High: 'مرتفع', Medium: 'متوسط', Low: 'منخفض', Unknown: 'غير معروف' }[row.last_risk] || 'غير معروف')}</td>
            <td className="p-3 whitespace-nowrap">{!scheduleAvailable ? <span>{copy('Schedule unavailable', 'الجدول غير متاح')}</span> : row.nextSchedule ? <><bdi>{row.nextSchedule.inspection_date} {row.nextSchedule.inspection_time?.slice(0, 5)}</bdi><div className="text-[var(--panel-ink-3)]">{row.nextSchedule.inspector_name || copy('Unassigned', 'غير مسند')}</div></> : <span className="text-[var(--panel-ink-3)]">{copy('Not scheduled', 'غير مجدول')}</span>}</td>
            <td className="p-3"><button type="button" className="btn-secondary whitespace-nowrap" disabled={!canSchedule} onClick={() => onSchedule(row)} aria-label={copy(`Schedule ${rowLabel(row)}`, `جدولة ${rowLabel(row)}`)}>{copy('Schedule', 'جدولة')}</button></td>
          </tr>)}</tbody></table></div><TablePagination {...pager} /></>}
    {selectedBulk.length > 0 && <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hairline)] bg-[var(--panel)] p-4 shadow-lg">
      <span className="text-sm text-[var(--panel-ink)]">{copy(`${selectedBulk.length} selected across all pages and filters`, `${selectedBulk.length} محددة عبر كل الصفحات وعوامل التصفية`)}</span>
      <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={() => onSelectionChange([])}>{copy('Clear selection', 'مسح التحديد')}</button><button type="button" className="btn-primary" onClick={onBulkSchedule} disabled={!canSchedule || loading || Boolean(error)}>{copy(`Schedule selected (${selectedBulk.length})`, `جدولة المحدد (${selectedBulk.length})`)}</button></div>
    </div>}
  </section>
}
