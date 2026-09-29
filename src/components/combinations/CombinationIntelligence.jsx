/**
 * Unit intelligence tab: the selected combination read as one unit. Members
 * resolved against the fleet register, blended tyre KPIs from the canonical
 * rollup (src/lib/combinations.js), and the position-class breakdown.
 */
import { useMemo } from 'react'
import { CircleDot, Gauge, DollarSign, Recycle, CheckCircle2, XCircle } from 'lucide-react'
import { Card, Kpi, KitTable, VehicleThumb, fmtInt } from '../commandCenter/kit'
import { formatCurrency, fmt } from '../../lib/formatters'
import { parseTrailerList } from '../../lib/combinations'
import { scrapSharePct, positionRows, memberCoverage } from '../../lib/combinationsAnalytics'

const NA = <span className="cc-na">N/A</span>

export default function CombinationIntelligence({
  rows, selectedId, setSelectedId, selectedCombo, intelLoading, intelError, onRetryIntel, rollup, currency, onExportPositions,
}) {
  const posRows = useMemo(() => positionRows(rollup), [rollup])
  const coverage = useMemo(() => memberCoverage(rollup), [rollup])
  const scrapPct = scrapSharePct(rollup)

  if (!rows.length) {
    return <Card><div className="cc-empty">No combinations yet. Add one in the Registry tab to analyse it as a combined unit.</div></Card>
  }

  return (
    <div className="cm-stack">
      <Card title="Combined unit" action={
        <select className="cc-select cm-picker" aria-label="Combination to analyse" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {rows.map((r) => {
            const n = parseTrailerList(r.trailer_nos).length
            return <option key={r.id} value={r.id}>{r.combination_no || r.name || r.prime_mover_no} | {r.prime_mover_no} ({n} trailer{n === 1 ? '' : 's'})</option>
          })}
        </select>
      }>
        {selectedCombo?.site && <p className="cm-note">Site: {selectedCombo.site}</p>}
      </Card>

      {intelError ? (
        <Card><div className="cc-empty" role="alert"><div>{intelError}<br /><button type="button" className="cc-btn" onClick={onRetryIntel}>Try again</button></div></div></Card>
      ) : intelLoading || !rollup ? (
        <Card><div className="cc-skel" style={{ height: 120 }} aria-label="Loading combined-unit data" /></Card>
      ) : (
        <>
          <div className="cc-kpis cm-kpis-4">
            <Kpi icon={CircleDot} tone="t-blue" value={rollup.fittedTyres} label="Fitted tyres" title={`${rollup.tyreCount} tyre records across the unit`} />
            <Kpi icon={Gauge} tone="t-green" display={rollup.blendedCpk != null ? `${currency} ${fmt(rollup.blendedCpk, 3)}` : 'N/A'} label="Unit cost per km (blended)" />
            <Kpi icon={DollarSign} tone="t-amber" display={formatCurrency(rollup.totalSpend, currency, 0)} label="Unit tyre spend"
              title={rollup.avgTyreLifeKm != null ? `Average life ${fmtInt(rollup.avgTyreLifeKm)} km` : 'No km data'} />
            <Kpi icon={Recycle} tone="t-red" value={rollup.scrapTyres} label={scrapPct == null ? 'Scrapped tyres' : `Scrapped tyres (${scrapPct}%)`} danger={rollup.scrapTyres > 0} />
          </div>

          <Card title="Member assets" sub={`${coverage.resolved} of ${coverage.total} found in the fleet register${coverage.pct == null ? '' : ` (${coverage.pct}%)`}`}>
            {rollup.resolution.unresolvedCount > 0 && (
              <p className="cm-warn">Not in the fleet register: {rollup.resolution.unresolved.join(', ')}. Add them to Fleet Master for complete figures.</p>
            )}
            <ul className="cm-members">
              {rollup.members.map((m) => (
                <li key={`${m.role}-${m.asset_no}`} className={m.resolved ? '' : 'is-missing'}>
                  <VehicleThumb row={m} size="sm" />
                  <div>
                    <b>{m.asset_no}</b>
                    <small>{m.role === 'prime_mover' ? 'Prime mover' : 'Trailer'} | {m.resolved ? ([m.make, m.model].filter(Boolean).join(' ') || m.vehicle_type || 'N/A') : 'Not in fleet register'}</small>
                  </div>
                  {m.resolved
                    ? <CheckCircle2 size={15} className="cm-ok" aria-label="Found" />
                    : <XCircle size={15} className="cm-miss" aria-label="Missing" />}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Position-class breakdown" sub="Positions that do not read as steer, drive or trailer are grouped as Other."
            action={<button type="button" className="cc-btn-ghost" onClick={() => onExportPositions(posRows)} disabled={!posRows.length}>Export</button>}>
            <KitTable
              compact
              rows={posRows}
              getRowId={(p) => p.positionClass}
              empty="No tyre records found for this unit's members."
              columns={[
                { key: 'label', header: 'Position class' },
                { key: 'count', header: 'Tyres', numeric: true },
                { key: 'spend', header: 'Spend', numeric: true, cell: (p) => formatCurrency(p.spend, currency, 0) },
                { key: 'share', header: 'Share of spend', numeric: true, sortValue: (p) => p.spendSharePct, cell: (p) => (p.spendSharePct == null ? NA : `${p.spendSharePct}%`) },
                { key: 'cpk', header: 'Cost per km', numeric: true, cell: (p) => (p.cpk != null ? `${currency} ${fmt(p.cpk, 3)}` : NA) },
              ]}
            />
          </Card>

          <Card title="Live telemetry">
            <p className="cm-note">Per-tyre pressure and temperature need a TPMS feed. None is connected for these units, so no readings are shown.</p>
          </Card>
        </>
      )}
    </div>
  )
}
