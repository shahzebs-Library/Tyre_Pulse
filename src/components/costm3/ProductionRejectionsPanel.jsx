/**
 * ProductionRejectionsPanel - "how many m3 of concrete were sent but NOT approved,
 * by site and by reason" (per the customer's rejection comments). Own country +
 * period controls (default current month), by-site and by-reason tables, and Excel
 * export. Reads get_production_rejections; degrades to an honest empty state.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Ban, RefreshCcw, FileSpreadsheet } from 'lucide-react'
import { useSettings, COUNTRIES } from '../../contexts/SettingsContext'
import { CPK_PERIODS, DEFAULT_PERIOD, periodBounds, periodLabel } from '../../lib/cpkModule'
import { getProductionRejections, listRejectedProduction } from '../../lib/api/costPerM3'
import { rejectedRowsDetail } from '../../lib/costPerM3'
import { exportToExcel } from '../../lib/exportUtils'
import CostM3Table, { MEASURE_COLUMNS } from './CostM3Table'

const REJECT_DETAIL_LIMIT = 1000

const int = (v) => Math.round(Number(v) || 0).toLocaleString()

export default function ProductionRejectionsPanel() {
  const { activeCountry } = useSettings()
  const initialCountry = activeCountry && activeCountry !== 'All' ? activeCountry : COUNTRIES[0]
  const [country, setCountry] = useState(initialCountry)
  const [periodKey, setPeriodKey] = useState(DEFAULT_PERIOD)
  const bounds = useMemo(() => periodBounds(periodKey, new Date()), [periodKey])

  const [data, setData] = useState({ ok: false, total: null, by_site: [], by_reason: [] })
  const [detailRows, setDetailRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      getProductionRejections({ country, from: bounds.from, to: bounds.to }),
      listRejectedProduction({ country, from: bounds.from, to: bounds.to, limit: REJECT_DETAIL_LIMIT }).catch(() => []),
    ])
      .then(([res, rej]) => {
        if (cancelled) return
        setData(res || { ok: false, total: null, by_site: [], by_reason: [] })
        setDetailRows(rejectedRowsDetail(rej))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country, bounds.from, bounds.to])

  useEffect(() => load(), [load])

  const total = data?.total || {}
  const notApproved = Number(total.not_approved_m3) || 0

  function exportExcel() {
    const rows = [
      ...(data.by_site || []).map((r) => ({ group: 'Site', name: r.site, not_approved_m3: Math.round(r.not_approved_m3 || 0), loads: r.loads })),
      ...(data.by_reason || []).map((r) => ({ group: 'Reason', name: r.reason, not_approved_m3: Math.round(r.not_approved_m3 || 0), loads: r.loads })),
    ]
    if (!rows.length) return
    exportToExcel(rows, ['group', 'name', 'not_approved_m3', 'loads'],
      ['Group', 'Name', 'Not Approved M3', 'Loads'], `TyrePulse_Rejections_${country}`, 'Concrete rejections')
  }

  function exportDetailExcel() {
    if (!detailRows.length) return
    const rows = detailRows.map((r) => ({
      period_date: r.period_date ?? '', site: r.site ?? '', dn_number: r.dn_number ?? '',
      supplied_m3: r.supplied_m3 ?? '', approved_m3: r.approved_m3 ?? '', not_approved_m3: r.not_approved_m3 ?? '',
      reason: r.reason ?? '', remarks: r.remarks ?? '',
    }))
    exportToExcel(rows,
      ['period_date', 'site', 'dn_number', 'supplied_m3', 'approved_m3', 'not_approved_m3', 'reason', 'remarks'],
      ['Date', 'Site', 'DN Number', 'Supplied M3', 'Approved M3', 'Not Approved M3', 'Reason', 'Remarks'],
      `TyrePulse_RejectedLoads_${country}`, 'Rejected loads')
  }

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Ban size={16} /> Rejections (concrete not approved)</h3>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportExcel} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs"><FileSpreadsheet size={12} /> Export</button>
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs"><RefreshCcw size={12} /> Refresh</button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border-subtle)] p-0.5">
          {COUNTRIES.map((c) => (
            <button key={c} type="button" onClick={() => setCountry(c)}
              className={`px-3 py-1 text-sm rounded-md ${country === c ? 'bg-[var(--accent)] text-white' : ''}`}
              style={country === c ? undefined : { color: 'var(--text-secondary)' }}>{c}</button>
          ))}
        </div>
        <select value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} className="rounded-md border border-[var(--border-subtle)] bg-transparent px-3 py-1 text-sm">
          {CPK_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{periodLabel(bounds)}</span>
      </div>

      {/* Headline figures */}
      <div className="mb-4">
        <CostM3Table
          dense
          columns={MEASURE_COLUMNS}
          rows={[
            { key: 'supplied', label: 'Supplied M3', value: int(total.supplied_m3) },
            { key: 'approved', label: 'Approved M3', value: int(total.approved_m3) },
            { key: 'not_approved', label: 'Not approved M3', value: int(total.not_approved_m3), strong: true },
            { key: 'rejected_loads', label: 'Rejected loads', value: int(total.rejected_loads) },
          ]}
          rowKey="key"
        />
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      ) : notApproved <= 0 && detailRows.length === 0 ? (
        <p className="py-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          No rejected concrete for {country} in this period (all supplied m3 approved).
        </p>
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            <CostM3Table dense title="By site" columns={groupColumns('Site')} rows={data.by_site} rowKey="site" empty="None" />
            <CostM3Table dense title="By reason" columns={groupColumns('Reason')} rows={data.by_reason} rowKey="reason" empty="None" />
          </div>

          {/* Row-level rejected loads with their Reason + Remarks (owner ask). */}
          <div className="mt-4">
            <CostM3Table
              title={`Rejected loads (detail) - ${detailRows.length.toLocaleString()}${detailRows.length >= REJECT_DETAIL_LIMIT ? ` (showing the newest ${REJECT_DETAIL_LIMIT.toLocaleString()})` : ''}`}
              actions={
                <button type="button" onClick={exportDetailExcel} disabled={!detailRows.length}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs disabled:opacity-50">
                  <FileSpreadsheet size={12} /> Export detail
                </button>
              }
              columns={DETAIL_COLUMNS}
              rows={detailRows}
              rowKey={(r, i) => r.id || i}
              empty="None"
            />
          </div>
        </>
      )}
    </section>
  )
}

/**
 * By-site and by-reason are the same question grouped two ways, so they share
 * one column set; only the name column's header and source field differ.
 */
function groupColumns(nameHeader) {
  const nameKey = nameHeader.toLowerCase()
  return [
    { key: 'name', header: nameHeader, align: 'left', render: (r) => r[nameKey] || 'Not stated' },
    { key: 'not_approved_m3', header: 'Not approved M3', align: 'right', render: (r) => <span className="font-medium">{int(r.not_approved_m3)}</span> },
    { key: 'loads', header: 'Loads', align: 'right' },
  ]
}

const DETAIL_COLUMNS = [
  { key: 'period_date', header: 'Date', align: 'left', cellClass: 'whitespace-nowrap', render: (r) => r.period_date || 'N/A' },
  { key: 'site', header: 'Site', align: 'left', render: (r) => r.site || 'N/A' },
  { key: 'dn_number', header: 'DN Number', align: 'left', cellClass: 'whitespace-nowrap', render: (r) => r.dn_number || 'N/A' },
  { key: 'supplied_m3', header: 'Supplied M3', align: 'right', render: (r) => (r.supplied_m3 == null ? 'N/A' : int(r.supplied_m3)) },
  { key: 'approved_m3', header: 'Approved M3', align: 'right', render: (r) => (r.approved_m3 == null ? 'N/A' : int(r.approved_m3)) },
  { key: 'not_approved_m3', header: 'Not Approved M3', align: 'right', render: (r) => <span className="font-medium">{r.not_approved_m3 == null ? 'N/A' : int(r.not_approved_m3)}</span> },
  { key: 'reason', header: 'Reason', align: 'left', render: (r) => r.reason || 'Not stated' },
  { key: 'remarks', header: 'Remarks', align: 'left', cellClass: 'max-w-[320px]', render: (r) => r.remarks || 'N/A' },
]
