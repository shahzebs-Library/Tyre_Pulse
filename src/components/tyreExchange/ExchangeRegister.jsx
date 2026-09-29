/**
 * Exchange register: filter bar and the derived exchange table.
 * Rows come from tyreExchangeView.deriveExchanges; nothing is invented.
 */
import { useState } from 'react'
import {
  Search, SlidersHorizontal, X, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Eye, ArrowLeftRight,
} from 'lucide-react'
import { Card, KitTable, VehicleThumb, fmtInt } from '../commandCenter/kit'
import { EXCHANGE_TYPES, TYPE_TONE, STATUS_TONE, shiftRange } from '../../lib/tyreExchangeView'

function TyreCell({ tyre }) {
  if (!tyre) return <span className="cc-na">None</span>
  return (
    <span className="tx-tyre">
      <i aria-hidden="true" className="tx-tyre-glyph" />
      <span><b>{tyre.serial || 'Serial not recorded'}</b><small>{tyre.size || 'Size not recorded'}</small></span>
    </span>
  )
}

export default function ExchangeRegister({
  rows, total, options, filters, setFilter, setRange, clearFilters, filtersOn,
  state, onSelect, onExport, onOpenCustody,
}) {
  const [more, setMore] = useState(false)
  const columns = [
    { key: 'date', header: 'Date', cell: (e) => <span className="tx-dt">{e.date || 'N/A'}<small>Time not recorded</small></span> },
    { key: 'type', header: 'Type', cell: (e) => <span className={`cc-pill ${TYPE_TONE[e.type]}`}>{e.type}</span> },
    {
      key: 'asset', header: 'Vehicle / asset',
      cell: (e) => (
        <span className="tx-veh">
          <VehicleThumb row={{ asset_no: e.asset, vehicle_type: e.vehicleType }} size="sm" />
          <span><b>{e.asset || 'N/A'}</b><small>{e.vehicleType || 'Type not recorded'}</small></span>
        </span>
      ),
    },
    { key: 'position', header: 'Position', cell: (e) => e.position || <span className="cc-na">N/A</span> },
    { key: 'removed', header: 'Removed tyre', sortValue: (e) => e.removed?.serial || '', cell: (e) => <TyreCell tyre={e.removed} /> },
    { key: 'installed', header: 'Installed tyre', sortValue: (e) => e.installed?.serial || '', cell: (e) => <TyreCell tyre={e.installed} /> },
    { key: 'site', header: 'Site', cell: (e) => e.site || <span className="cc-na">N/A</span> },
    { key: 'status', header: 'Tyre status', cell: (e) => (e.status ? <span className={`cc-pill ${STATUS_TONE[e.status] || 'muted'}`}>{e.status}</span> : <span className="cc-na">N/A</span>) },
    {
      key: 'actions', header: 'Actions', sortable: false,
      cell: (e) => (
        <span className="tx-actions-cell" onClick={(ev) => ev.stopPropagation()}>
          <button type="button" className="cc-icon-btn" aria-label={`View movement for ${e.asset} ${e.position || ''}`} onClick={() => onSelect(e.id)}><Eye size={14} /></button>
          {(e.installed?.serial || e.removed?.serial) && (
            <button type="button" className="cc-icon-btn" aria-label="Open chain of custody" title="Open chain of custody" onClick={() => onOpenCustody(e.installed?.serial || e.removed?.serial)}><ArrowLeftRight size={14} /></button>
          )}
        </span>
      ),
    },
  ]

  return (
    <Card
      title="Exchange register"
      sub={`${fmtInt(rows.length)} of ${fmtInt(total)} exchanges derived from the tyre register. Time of day and technician are not recorded on tyre records.`}
      action={(
        <span className="tx-actions-cell">
          <button type="button" className="cc-btn-ghost" onClick={() => onExport('excel')} disabled={!rows.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
          <button type="button" className="cc-btn-ghost" onClick={() => onExport('pdf')} disabled={!rows.length}><FileText size={14} aria-hidden="true" /> PDF</button>
        </span>
      )}
    >
      <div className="tx-filters">
        <select className="cc-select" aria-label="Site" value={filters.site} onChange={(e) => setFilter('site', e.target.value)}>
          <option value="">All sites</option>{options.sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="cc-select" aria-label="Vehicle" value={filters.asset} onChange={(e) => setFilter('asset', e.target.value)}>
          <option value="">All vehicles</option>{options.assets.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="cc-select" aria-label="Tyre brand" value={filters.brand} onChange={(e) => setFilter('brand', e.target.value)}>
          <option value="">All tyre brands</option>{options.brands.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="cc-select" aria-label="Exchange type" value={filters.type} onChange={(e) => setFilter('type', e.target.value)}>
          <option value="">All exchange types</option>{EXCHANGE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="cc-select" aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All status</option>{options.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="tx-range">
          <button type="button" className="cc-icon-btn" aria-label="Previous period" onClick={() => setRange(shiftRange(filters, -1))}><ChevronLeft size={14} /></button>
          <input type="date" aria-label="From date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
          <span>to</span>
          <input type="date" aria-label="To date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
          <button type="button" className="cc-icon-btn" aria-label="Next period" onClick={() => setRange(shiftRange(filters, 1))}><ChevronRight size={14} /></button>
        </span>
      </div>
      <div className="tx-filters">
        <div className="cc-search">
          <Search size={15} aria-hidden="true" />
          <input value={filters.search} onChange={(e) => setFilter('search', e.target.value)} placeholder="Search by vehicle or serial" aria-label="Search by vehicle or serial" />
        </div>
        <button type="button" className="cc-btn-ghost" aria-expanded={more} onClick={() => setMore((v) => !v)}><SlidersHorizontal size={14} aria-hidden="true" /> More filters</button>
        {filtersOn && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={13} aria-hidden="true" /> Clear</button>}
      </div>
      {more && (
        <div className="tx-filters">
          <select className="cc-select" aria-label="Position" value={filters.position} onChange={(e) => setFilter('position', e.target.value)}>
            <option value="">All positions</option>{options.positions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" className="cc-btn-ghost" onClick={() => setRange({ from: '', to: '' })}>All dates</button>
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <KitTable
          className="tx-table"
          columns={columns}
          rows={rows}
          getRowId={(e) => e.id}
          loading={state.loading}
          error={state.error || null}
          onRetry={state.retry}
          enableRowSelection
          bulkActions={(sel, clear) => (
            <>
              <button type="button" className="cc-btn-ghost" onClick={() => onExport('excel', sel)}><FileSpreadsheet size={14} aria-hidden="true" /> Export selected ({sel.length})</button>
              <button type="button" className="cc-btn-ghost" onClick={clear}>Clear selection</button>
            </>
          )}
          onRowClick={(e) => onSelect(e.id)}
          empty={filtersOn ? 'No exchanges match these filters.' : 'No exchanges recorded in this period.'}
        />
      </div>
    </Card>
  )
}
