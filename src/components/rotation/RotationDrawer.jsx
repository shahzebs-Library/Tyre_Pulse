/**
 * Per-vehicle rotation history rail. Shared SideDrawer (keeps the
 * `tp-drawer-panel` contract dialogFit.test.jsx pins), body on the kit tokens.
 */
import { Truck, AlertTriangle, ArrowRight } from 'lucide-react'
import SideDrawer from '../ui/SideDrawer'
import { Card, KitTable } from '../commandCenter/kit'
import { normPos, LOW_TREAD_MM, WEAR_IMBALANCE_MM } from '../../lib/rotationScheduleAnalytics'
import { fmt, fmtDate, fmtKm, StatusBadge } from './rotationUi'

const TREAD_POSITIONS = ['Steer', 'Drive', 'Trailer', 'Lift', 'Tag']

function treadValue(t) {
  if (t.tread_depth === null || t.tread_depth === undefined || t.tread_depth === '') return null
  const n = Number(t.tread_depth)
  return Number.isFinite(n) ? n : null
}

const TYRE_COLUMNS = [
  { key: 'serial', header: 'Serial', sortValue: (t) => t.serial_number || t.serial_no || '', cell: (t) => <span className="rs-mono">{t.serial_number || t.serial_no || 'N/A'}</span> },
  { key: 'position', header: 'Position', sortValue: (t) => normPos(t.position), cell: (t) => normPos(t.position) },
  { key: 'brand', header: 'Brand', cell: (t) => t.brand || <span className="cc-na">N/A</span> },
  {
    key: 'tread', header: 'Tread (mm)', align: 'right', sortValue: (t) => treadValue(t) ?? -1,
    cell: (t) => {
      const v = treadValue(t)
      if (v == null) return <span className="cc-na">N/A</span>
      return <span style={v < LOW_TREAD_MM ? { color: 'var(--cc-red)', fontWeight: 600 } : undefined}>{v.toFixed(1)}{v < LOW_TREAD_MM ? ' low' : ''}</span>
    },
  },
  { key: 'km', header: 'Fitted km', align: 'right', sortValue: (t) => Number(t.km_at_fitment) || -1, cell: (t) => (Number(t.km_at_fitment) > 0 ? fmt(t.km_at_fitment) : <span className="cc-na">N/A</span>) },
]

export default function RotationDrawer({ vehicle, onClose }) {
  if (!vehicle) return null
  return (
    <SideDrawer
      open
      onClose={onClose}
      size="xl"
      closeLabel="Close rotation history"
      title={<span className="flex items-center gap-2"><Truck size={18} aria-hidden="true" />{vehicle.asset}</span>}
      subtitle={<span className="flex flex-wrap items-center gap-2">{vehicle.site}, rotation history <StatusBadge status={vehicle.status} /></span>}
    >
      <div className="cc rs-drawer">
        <div className="rs-facts">
          {[
            ['Latest odometer', fmtKm(vehicle.currentKm)],
            ['Last rotation', fmtDate(vehicle.lastRotationDate)],
            ['Since rotation', fmtKm(vehicle.sinceLastKm)],
            ['Rotations', fmt(vehicle.totalRotations)],
          ].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
        </div>

        <Card title="Tread depth by position">
          <div className="rs-tread">
            {TREAD_POSITIONS.map((pos) => {
              const depths = vehicle.treadByPos?.[pos]
              const avg = depths ? depths.reduce((s, v) => s + v, 0) / depths.length : null
              const low = avg != null && avg < LOW_TREAD_MM
              return (
                <div key={pos}>
                  <span>{pos}</span>
                  {avg != null ? (
                    <>
                      <b style={low ? { color: 'var(--cc-red)' } : undefined}>{avg.toFixed(1)} mm{low ? ' low' : ''}</b>
                      <span className="cc-bar-track" aria-hidden="true"><i style={{ width: `${Math.min(100, (avg / 12) * 100)}%`, background: low ? 'var(--cc-red)' : 'var(--cc-green)' }} /></span>
                    </>
                  ) : <b className="cc-na">Not measured</b>}
                </div>
              )
            })}
          </div>
          {vehicle.wearImbalance != null && vehicle.wearImbalance > WEAR_IMBALANCE_MM && (
            <p role="status" className="rs-warn"><AlertTriangle size={13} aria-hidden="true" /> Steer to drive tread imbalance of {vehicle.wearImbalance.toFixed(1)} mm. Rotation recommended.</p>
          )}
        </Card>

        <Card title="Detected rotation events">
          {vehicle.rotationEvents.length === 0 ? (
            <div className="cc-empty">No rotation detected for this vehicle. A rotation shows up when the same serial is recorded at a different axle group.</div>
          ) : (
            <ul className="cc-list">
              {vehicle.rotationEvents.map((ev, i) => (
                <li key={`${ev.serial}-${i}`} className="cc-row">
                  <div className="cc-row-main">
                    <div className="cc-row-title rs-mono">{ev.serial}</div>
                    <div className="cc-row-meta">{ev.from} <ArrowRight size={11} aria-label="moved to" /> {ev.to}, {ev.km != null ? `at ${fmt(ev.km)} km` : 'odometer not recorded'}</div>
                  </div>
                  <span className="cc-row-time">{fmtDate(ev.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Active tyres (${vehicle.activeTyreCount})`}>
          <KitTable columns={TYRE_COLUMNS} rows={vehicle.activeTyres} getRowId={(t) => String(t.id)} empty="No active tyres with a serial on this vehicle" />
        </Card>
      </div>
    </SideDrawer>
  )
}
