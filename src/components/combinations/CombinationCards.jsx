/**
 * The three cards under the Combination Manager table: axle tyre layout, load
 * distribution per axle, and the tyre configuration donut. All read the one
 * selected combination; nothing here fetches.
 */
import { Card, Donut, KitTable } from '../commandCenter/kit'
import VehicleTyreDiagram from '../VehicleTyreDiagram'
import {
  axleRows, normalizeTyreConfig, parseAxleConfig, tyreConfigSegments, TYRE_GROUP_COLORS,
} from '../../lib/combinationManagerView'
import { parseTrailerList } from '../../lib/combinations'

const NA = <span className="cc-na">N/A</span>
const GROUP_LABEL = { steer: 'Steer', drive: 'Drive', trailer: 'Trailer' }

function ComboPicker({ rows, value, onChange }) {
  return (
    <select className="cc-select cm-picker" aria-label="Combination shown in these cards" value={value} onChange={(e) => onChange(e.target.value)}>
      {rows.map((r) => (
        <option key={r.id} value={r.id}>{r.combination_no || r.name || r.prime_mover_no}</option>
      ))}
    </select>
  )
}

export function AxleTyreLayoutCard({ rows, combo, value, onChange, fleetMap }) {
  const norm = (v) => String(v ?? '').trim().toUpperCase()
  const prime = combo ? fleetMap.get(norm(combo.prime_mover_no)) : null
  const trailers = combo ? parseTrailerList(combo.trailer_nos) : []
  return (
    <Card title="Axle Tyre Layout" action={rows.length ? <ComboPicker rows={rows} value={value} onChange={onChange} /> : null}>
      {!combo ? <div className="cc-empty">No combination selected.</div> : (
        <>
          <div className="cm-layout">
            <figure className="cm-layout-unit">
              {prime?.vehicle_type
                ? <VehicleTyreDiagram vehicleType={prime.vehicle_type} width={150} />
                : <div className="cm-visual-empty">Prime mover {combo.prime_mover_no} has no vehicle type in the fleet register.</div>}
              <figcaption>{combo.prime_mover_no}{prime?.vehicle_type ? `, ${prime.vehicle_type}` : ''}</figcaption>
            </figure>
            {trailers.map((t) => {
              const f = fleetMap.get(norm(t))
              return (
                <figure key={t} className="cm-layout-unit">
                  {f?.vehicle_type
                    ? <VehicleTyreDiagram vehicleType={f.vehicle_type} width={150} />
                    : <div className="cm-visual-empty">{t} is not in the fleet register.</div>}
                  <figcaption>{t}{f?.vehicle_type ? `, ${f.vehicle_type}` : ''}</figcaption>
                </figure>
              )
            })}
          </div>
          <p className="cm-note">Wheel layouts come from each unit&apos;s vehicle type in the fleet register.</p>
          <ul className="cm-legend">
            {['steer', 'drive', 'trailer'].map((g) => (
              <li key={g}><i style={{ background: TYRE_GROUP_COLORS[g] }} aria-hidden="true" /> {GROUP_LABEL[g]} axle</li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

export function LoadDistributionCard({ combo }) {
  const rows = combo ? axleRows(combo) : []
  const parsed = combo ? parseAxleConfig(combo.axle_config) : null
  const load = combo?.max_load_tonnes
  return (
    <Card title="Load Distribution" sub={combo ? `Max load ${load != null ? `${Number(load).toLocaleString('en-US')} t` : 'not recorded'}` : undefined}>
      {!combo ? <div className="cc-empty">No combination selected.</div>
        : !parsed ? <div className="cc-empty">No axle configuration recorded for this combination.</div> : (
          <>
            <KitTable
              compact
              rows={rows}
              getRowId={(r) => r.axle}
              columns={[
                { key: 'axle', header: 'Axle', cell: (r) => <span><i className="cm-dot" style={{ background: TYRE_GROUP_COLORS[r.group] }} aria-hidden="true" /> {r.axle}</span> },
                { key: 'group', header: 'Type', cell: (r) => GROUP_LABEL[r.group] },
                { key: 'tyres', header: 'Tyres', numeric: true, cell: (r) => (r.tyres == null ? NA : r.tyres) },
                { key: 'axleLoad', header: 'Axle load', numeric: true, cell: () => NA },
                { key: 'tyreLoad', header: 'Tyre load', numeric: true, cell: () => NA },
                { key: 'legalLimit', header: 'Legal limit', numeric: true, cell: () => NA },
              ]}
            />
            <p className="cm-note">Axle loads, tyre loads and legal limits are not recorded anywhere yet, so they show N/A rather than an estimate.</p>
          </>
        )}
    </Card>
  )
}

export function TyreConfigCard({ combo }) {
  const t = combo ? normalizeTyreConfig(combo.tyre_config) : null
  const segs = combo ? tyreConfigSegments(combo.tyre_config, TYRE_GROUP_COLORS) : []
  return (
    <Card title="Tyre Configuration">
      {!combo ? <div className="cc-empty">No combination selected.</div>
        : !segs.length ? <div className="cc-empty">No tyre configuration recorded for this combination.</div>
          : <Donut segments={segs} total={t.total} centerLabel="Total tyres" />}
    </Card>
  )
}
