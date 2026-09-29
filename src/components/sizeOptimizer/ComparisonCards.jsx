/**
 * Size Optimizer bottom row: Size Comparison, Performance Impact and a
 * five-year tyre cost view for the selected asset (a table row or the last
 * optimization run). Published data comes from the tyre specification
 * catalogue; anything it does not hold reads "Not in the catalogue".
 * Fuel and downtime have no linked source and read N/A.
 */
import { Card } from '../commandCenter/kit'
import TyreTreadImage from '../tyre/TyreTreadImage'
import { catalogueFor, loadIndexOf, fiveYearCost } from '../../lib/sizeOptimizerView'
import { fmtKm, fmtMoney, fmtSigned } from './sizeFormat'

const NOT_IN = 'Not in the catalogue'

function specLine(spec, key, suffix = '') {
  const v = spec?.[key]
  return v == null || v === '' ? <span className="cc-na">{NOT_IN}</span> : `${v}${suffix}`
}

function SizeColumn({ tag, size, spec }) {
  return (
    <div className="tsz-cmp-col">
      <span className="tsz-cmp-tag">{tag}</span>
      <b className="tsz-cmp-size">{size || 'N/A'}</b>
      {size && <TyreTreadImage size={size} catalogue={spec ? [spec] : undefined} width={96} />}
      <dl className="tsz-spec">
        <dt>Section width</dt><dd>{specLine(spec, spec?.section_width_mm != null ? 'section_width_mm' : 'width_mm', ' mm')}</dd>
        <dt>Overall diameter</dt><dd>{specLine(spec, 'overall_diameter_mm', ' mm')}</dd>
        <dt>Load index</dt><dd>{specLine(spec, 'load_index_single')}</dd>
        <dt>Speed rating</dt><dd>{specLine(spec, 'speed_rating')}</dd>
        <dt>Tread depth</dt><dd>{specLine(spec, 'tread_depth_new_mm', ' mm')}</dd>
      </dl>
    </div>
  )
}

function PairBar({ label, cur, rec, fmt, lowerBetter }) {
  const max = Math.max(cur ?? 0, rec ?? 0)
  const w = (v) => (v == null || !max ? 0 : Math.max(4, (v / max) * 100))
  const better = cur != null && rec != null ? (lowerBetter ? rec < cur : rec > cur) : null
  return (
    <div className="tsz-pair">
      <div className="tsz-pair-head"><span>{label}</span>{better != null && <span className={`cc-pill ${better ? 'good' : 'warn'}`}>{better ? 'Better' : 'Worse'}</span>}</div>
      <div className="tsz-bar-row"><span>Current</span><span className="tsz-bar"><i style={{ width: `${w(cur)}%` }} className="cur" /></span><b>{cur == null ? 'N/A' : fmt(cur)}</b></div>
      <div className="tsz-bar-row"><span>Recommended</span><span className="tsz-bar"><i style={{ width: `${w(rec)}%` }} className="rec" /></span><b>{rec == null ? 'N/A' : fmt(rec)}</b></div>
    </div>
  )
}

export default function ComparisonCards({ selection, catalogue, catalogueError }) {
  if (!selection) {
    return (
      <div className="tsz-bottom">
        <Card title="Size Comparison"><div className="cc-empty">Select a vehicle in the table, or run an optimization, to compare sizes.</div></Card>
        <Card title="Performance Impact"><div className="cc-empty">Nothing selected yet.</div></Card>
        <Card title="Cost Analysis (5 years)"><div className="cc-empty">Nothing selected yet.</div></Card>
      </div>
    )
  }
  const { assetNo, currency, current, rec, annualKm } = selection
  const curSpec = catalogueError ? null : catalogueFor(catalogue, current?.size)[0] || null
  const recSpec = catalogueError ? null : catalogueFor(catalogue, rec?.size)[0] || null
  const lifeDelta = current?.avgLife && rec?.avgLife ? ((rec.avgLife - current.avgLife) / current.avgLife) * 100 : null
  const curCost = fiveYearCost(current?.avgCpk, annualKm)
  const recCost = fiveYearCost(rec?.avgCpk, annualKm)
  const saving = curCost != null && recCost != null ? curCost - recCost : null
  const money = (v) => (currency ? fmtMoney(v, currency) : 'N/A')
  return (
    <div className="tsz-bottom">
      <Card title="Size Comparison" sub={`Asset ${assetNo}${catalogueError ? '. Catalogue could not be read.' : ''}`}
        action={lifeDelta != null ? <span className={`cc-pill ${lifeDelta >= 0 ? 'good' : 'warn'}`}>{fmtSigned(lifeDelta)} tyre life</span> : null}>
        <div className="tsz-cmp">
          <SizeColumn tag="Current" size={current?.size} spec={curSpec} />
          <SizeColumn tag="Recommended" size={rec?.size} spec={recSpec} />
        </div>
      </Card>
      <Card title="Performance Impact" sub="Measured from tyre records and the catalogue">
        <PairBar label="Tyre life" cur={current?.avgLife ?? null} rec={rec?.avgLife ?? null} fmt={fmtKm} />
        <PairBar label="Load capacity (load index)" cur={loadIndexOf(curSpec)} rec={loadIndexOf(recSpec)} fmt={(v) => String(v)} />
        <PairBar label="Cost per km" cur={current?.avgCpk ?? null} rec={rec?.avgCpk ?? null} fmt={(v) => `${currency || ''} ${v.toFixed(4)}`} lowerBetter />
        <div className="tsz-pair"><div className="tsz-pair-head"><span>Fuel efficiency</span><span className="cc-na" title="No fuel source is linked to tyre sizes">N/A</span></div></div>
      </Card>
      <Card title="Cost Analysis (5 years)" sub={annualKm ? `Based on ${fmtKm(annualKm)} of tyre-km recorded per year on this asset` : 'Needs at least 90 days of dated tyre records with measured km'}>
        <dl className="tsz-cost">
          <dt>Current size</dt><dd>{money(curCost)}</dd>
          <dt>Recommended size</dt><dd>{money(recCost)}</dd>
          <dt className="strong">Estimated savings</dt><dd className={`strong ${saving != null && saving > 0 ? 'good' : ''}`}>{money(saving)}</dd>
        </dl>
        <p className="tsz-sub-h">Breakdown</p>
        <dl className="tsz-cost">
          <dt>Tyre cost</dt><dd>{money(saving)}</dd>
          <dt>Fuel cost</dt><dd><span className="cc-na" title="No fuel source is linked">N/A</span></dd>
          <dt>Downtime cost</dt><dd><span className="cc-na" title="No downtime cost per size is recorded">N/A</span></dd>
        </dl>
      </Card>
    </div>
  )
}
