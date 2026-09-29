/**
 * Bottom row: exchange summary donut, tyre movement flow for the selected
 * exchange, and the photos recorded on that tyre record.
 */
import { useMemo, useState } from 'react'
import { ArrowRight, ImageOff } from 'lucide-react'
import { Card, CardState, Donut, Tabs } from '../commandCenter/kit'
import { summaryWindow, filterExchanges, typeSegments, TYPE_TONE } from '../../lib/tyreExchangeView'
import { safeImageSrc } from '../../lib/safeUrl'

const WINDOWS = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'Last 3 months' },
  { key: 'custom', label: 'Custom' },
]

function Stop({ title, spot, tyre }) {
  return (
    <div className="tx-stop">
      <small>{title}</small>
      <b>{spot?.asset || 'N/A'}{spot?.position ? ` ${spot.position}` : ''}</b>
      <span>{spot?.site || 'Site not recorded'}</span>
      {tyre && <span className="tx-stop-tyre">Tyre {tyre.serial || 'serial not recorded'}</span>}
    </div>
  )
}

export default function ExchangeInsights({ events, state, selected, custom, onPickType }) {
  const [win, setWin] = useState('month')
  const segments = useMemo(() => {
    const range = summaryWindow(win, new Date(), custom)
    return typeSegments(filterExchanges(events, range))
  }, [events, win, custom])
  const sum = segments.reduce((s, x) => s + x.count, 0)
  const photos = (selected?.photos || []).map((p) => safeImageSrc(typeof p === 'string' ? p : p?.url)).filter(Boolean)

  let flow = null
  if (selected) {
    if (selected.type === 'Removal') {
      flow = { from: selected.from, fromTyre: selected.removed, to: null, toTyre: null }
    } else if (selected.type === 'Transfer' || selected.type === 'Interchange') {
      flow = { from: selected.from, fromTyre: selected.installed, to: selected.to, toTyre: selected.installed }
    } else {
      flow = { from: selected.removed ? selected.to : null, fromTyre: selected.removed, to: selected.to, toTyre: selected.installed }
    }
  }

  return (
    <div className="tx-bottom">
      <Card title="Exchange summary" sub={win === 'custom' ? 'The date range set in the register filters.' : 'Counted from the exchange register.'}>
        <Tabs tabs={WINDOWS} value={win} onChange={setWin} label="Summary period" variant="line" />
        <div style={{ marginTop: 10 }}>
          <CardState state={state} empty={!state.loading && sum === 0 ? 'No exchanges in this period.' : null}>
            <Donut segments={segments} total={sum} centerLabel="Exchanges" onSelect={(s) => onPickType(s.label)} />
          </CardState>
        </div>
      </Card>

      <Card title="Tyre movement flow" sub={selected ? `${selected.type} on ${selected.date || 'an unrecorded date'}` : 'Select an exchange in the register.'}>
        {!selected && <div className="cc-empty">No exchange selected.</div>}
        {selected && (
          <div className="tx-flow">
            {flow.from ? <Stop title={selected.type === 'Replacement' ? 'Removed from' : 'From'} spot={flow.from} tyre={flow.fromTyre} /> : <div className="tx-stop"><small>From</small><b>Stock</b><span>No earlier record on this position</span></div>}
            <span className={`tx-flow-arrow cc-pill ${TYPE_TONE[selected.type]}`}><ArrowRight size={14} aria-hidden="true" /> {selected.type}</span>
            {flow.to ? <Stop title="Installed on" spot={flow.to} tyre={flow.toTyre} /> : <div className="tx-stop"><small>To</small><b>Off the vehicle</b><span>No later tyre recorded on this position</span></div>}
          </div>
        )}
      </Card>

      <Card title="Photos and documents" sub="Photos attached to the tyre record of the selected exchange.">
        {!selected && <div className="cc-empty">Select an exchange to see its photos.</div>}
        {selected && photos.length === 0 && <div className="cc-empty"><ImageOff size={18} aria-hidden="true" /> No photos were recorded for this tyre.</div>}
        {selected && photos.length > 0 && (
          <div className="tx-photos">
            {photos.slice(0, 8).map((src) => <a key={src} href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt="Tyre record" loading="lazy" /></a>)}
          </div>
        )}
      </Card>
    </div>
  )
}
