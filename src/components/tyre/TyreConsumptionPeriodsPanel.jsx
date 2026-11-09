/**
 * TyreConsumptionPeriodsPanel - quarter to date, year to date and the same
 * period last year, from get_tyre_consumption_v2 (migration 20261110110000).
 *
 * Mounted inside TyreConsumptionSection, fed the SAME country and period, so the
 * two never describe different windows. Every figure is labelled with what it
 * counts: installations (fitment events) or physical tyres (each tyre once).
 * Shaping is in src/lib/tyreConsumptionPeriods.js; nothing is computed here.
 */
import { useEffect, useMemo, useState } from 'react'
import { CalendarRange, FileSpreadsheet, Info, AlertTriangle, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { getTyreConsumptionV2 } from '../../lib/api/tyreConsumption'
import {
  shapeConsumptionV2, consumptionV2Sheets, BREAKDOWN_DIMS, PERIOD_KEYS, PERIOD_LABEL, windowLabel,
} from '../../lib/tyreConsumptionPeriods'
import { exportSheetsToExcel } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import EnterpriseTable from '../ui/EnterpriseTable'
import { compareValues } from '../../lib/consoleTable'

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const sortable = { sortingFn: valueSort, sortUndefined: 'last' }
const fmt = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())
const fmtChange = (v) => (v == null ? 'N/A' : `${v > 0 ? '+' : ''}${v}%`)

function Change({ value }) {
  if (value == null) return <span style={{ color: 'var(--text-dim)' }}>No comparison</span>
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus
  return (
    <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
      <Icon size={12} /> {fmtChange(value)} vs last year
    </span>
  )
}

function PeriodCard({ c }) {
  return (
    <div className="rounded-lg p-4" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>{c.label}</div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-secondary)' }}>{c.window}</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Physical tyres consumed</div>
          <div className="text-xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmt(c.physical)}</div>
          <div className="text-[11px]"><Change value={c.physicalChangePct} /></div>
          <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Last year: {fmt(c.prevPhysical)}</div>
        </div>
        <div>
          <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Installations</div>
          <div className="text-xl font-semibold tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmt(c.installations)}</div>
          <div className="text-[11px]"><Change value={c.installationsChangePct} /></div>
          <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Last year: {fmt(c.prevInstallations)}</div>
        </div>
      </div>
      <div className="text-[10px] mt-2" style={{ color: 'var(--text-dim)' }}>Last year window: {c.prevWindow}</div>
    </div>
  )
}

const num = (key, header) => ({
  id: key, header, accessorFn: (r) => r[key], ...sortable, meta: { align: 'right', exportValue: (r) => (r[key] == null ? 'N/A' : r[key]) },
  cell: ({ row: { original: r } }) => <span className="tabular-nums">{fmt(r[key])}</span>,
})
const pct = (key, header) => ({
  id: key, header, accessorFn: (r) => (r[key] == null ? undefined : r[key]), ...sortable,
  meta: { align: 'right', exportValue: (r) => fmtChange(r[key]) },
  cell: ({ row: { original: r } }) => <span className="tabular-nums" style={{ color: 'var(--text-dim)' }}>{fmtChange(r[key])}</span>,
})

function eventColumns() {
  const cols = [{
    id: 'label', header: 'Measure', accessorFn: (r) => r.label, ...sortable,
    cell: ({ row: { original: r } }) => <span title={r.help} style={{ color: 'var(--text-secondary)' }}>{r.label}</span>,
  }]
  for (const k of PERIOD_KEYS) {
    cols.push(num(k, PERIOD_LABEL[k]), num(`${k}_prev`, 'Last year'), pct(`${k}_change`, 'Change'))
  }
  return cols
}

function dimColumns(label) {
  return [
    {
      id: 'key', header: label, accessorFn: (r) => r.key, ...sortable,
      cell: ({ row: { original: r } }) => (
        <span style={{ color: r.resolved ? 'var(--text-secondary)' : 'var(--text-dim)' }}>{r.key}</span>
      ),
    },
    num('installations', 'Installations'),
    num('physicalNew', 'Physical tyres (new)'),
    num('reused', 'Reused fitments'),
    num('removed', 'Tyres removed'),
    {
      id: 'sharePct', header: 'Share', accessorFn: (r) => (r.sharePct == null ? undefined : r.sharePct), ...sortable,
      meta: { align: 'right', exportValue: (r) => (r.sharePct == null ? 'N/A' : `${r.sharePct}%`) },
      cell: ({ row: { original: r } }) => <span className="tabular-nums">{r.sharePct == null ? 'N/A' : `${r.sharePct}%`}</span>,
    },
  ]
}

export default function TyreConsumptionPeriodsPanel({ country, from, to }) {
  const [state, setState] = useState({ loading: true, data: null, reason: '' })
  const [dim, setDim] = useState('site')
  const [xlsBusy, setXlsBusy] = useState(false)
  const [xlsError, setXlsError] = useState('')

  async function load() {
    setState((s) => ({ ...s, loading: true }))
    const payload = await getTyreConsumptionV2({ country, from, to })
    const shaped = shapeConsumptionV2(payload)
    setState({ loading: false, data: shaped.ok ? shaped : null, reason: shaped.ok ? '' : shaped.reason })
  }
  useEffect(() => { load() }, [country, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = state.data
  const evCols = useMemo(() => eventColumns(), [])
  const dimMeta = BREAKDOWN_DIMS.find((x) => x.key === dim) || BREAKDOWN_DIMS[0]
  const dCols = useMemo(() => dimColumns(dimMeta.label), [dimMeta.label])

  async function downloadExcel() {
    if (!d) return
    setXlsBusy(true); setXlsError('')
    try {
      await exportSheetsToExcel(consumptionV2Sheets(d), `Tyre consumption by period ${d.from} to ${d.to}`, {
        title: 'Tyre consumption: installations and physical tyres',
        dateRange: windowLabel({ from: d.from, to: d.to }),
        meta: { Country: country && country !== 'All' ? country : 'All countries' },
        notes: [
          'Installations count every fitment event. Physical tyres count each tyre once, on its first fitment.',
          'Periods use business dates (fitment and removal dates), never the upload date.',
          'Last-year windows shift both ends back one calendar year; 29 February becomes 28 February.',
        ],
      })
    } catch (e) {
      setXlsError(toUserMessage(e) || 'The workbook could not be created.')
    } finally {
      setXlsBusy(false)
    }
  }

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h4 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <CalendarRange size={15} /> Quarter, year and last year
        </h4>
        <button
          onClick={downloadExcel}
          disabled={!d || xlsBusy}
          className="px-3 py-1.5 text-xs rounded flex items-center gap-1.5 disabled:opacity-40"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-bright)', color: 'var(--text-secondary)' }}
        >
          <FileSpreadsheet size={13} /> Excel (all periods)
        </button>
      </div>
      {xlsError ? <p className="text-xs mb-2" style={{ color: '#b45309' }}>{xlsError}</p> : null}

      {state.loading ? (
        <p className="text-xs py-4" style={{ color: 'var(--text-dim)' }}>Loading period comparison...</p>
      ) : !d ? (
        <div className="flex gap-2 items-start rounded-lg p-3 text-xs" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
          <AlertTriangle size={14} style={{ color: '#b45309', flexShrink: 0 }} />
          <div>
            {toUserMessage(state.reason) || 'The period comparison could not be built.'}{' '}
            <button type="button" onClick={load} className="underline min-h-[44px]">Try again</button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid lg:grid-cols-3 gap-3 mb-3">
            {d.cards.map((c) => <PeriodCard key={c.key} c={c} />)}
          </div>
          <div className="flex gap-2 items-start text-[11px] mb-4" style={{ color: 'var(--text-dim)' }}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Physical tyres count each tyre once, on the day it is first fitted. Installations count every
              fitment event, so a tyre rotated, refitted or moved to another vehicle adds an installation but not
              a tyre consumed. The same fitment recorded twice (for example a file loaded twice) is counted once.
            </span>
          </div>

          <h5 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>What happened, by period</h5>
          <EnterpriseTable
            columns={evCols}
            data={d.eventRows}
            getRowId={(r) => r.key}
            enableColumnFilters={false}
            initialPageSize={20}
            exportFileName="Tyre events by period"
            emptyMessage="Nothing recorded."
          />

          <div className="flex flex-wrap items-center gap-1.5 mt-5 mb-2">
            <span className="text-xs font-semibold mr-1" style={{ color: 'var(--text-primary)' }}>Selected period by</span>
            {BREAKDOWN_DIMS.map((x) => (
              <button
                key={x.key}
                onClick={() => setDim(x.key)}
                className="px-2.5 py-1 text-[11px] rounded"
                style={{
                  background: dim === x.key ? 'var(--surface-3)' : 'var(--surface-2)',
                  border: `1px solid ${dim === x.key ? 'var(--border-bright)' : 'var(--border-subtle)'}`,
                  color: dim === x.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {x.label}
              </button>
            ))}
          </div>
          <EnterpriseTable
            columns={dCols}
            data={d.breakdowns[dim] || []}
            getRowId={(r) => r.key}
            searchPlaceholder={`Search ${dimMeta.label.toLowerCase()}...`}
            enableColumnFilters={false}
            initialPageSize={15}
            exportFileName={`Tyre consumption by ${dimMeta.label.toLowerCase()}`}
            emptyMessage="Nothing recorded in this period."
          />
          {dim === 'supplier' && d.supplierMissing ? (
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-dim)' }}>
              No tyre record carries a supplier yet, so every tyre reads Not recorded. The breakdown fills in as
              soon as the supplier is captured on the tyre records.
            </p>
          ) : null}
          {d.undatedFitments > 0 || d.undatedScrapped > 0 ? (
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-dim)' }}>
              Left out of every period because they carry no date: {fmt(d.undatedFitments)} fitment
              {d.undatedFitments === 1 ? '' : 's'} with no fitment date and {fmt(d.undatedScrapped)} scrapped
              tyre{d.undatedScrapped === 1 ? '' : 's'} with no removal date.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
