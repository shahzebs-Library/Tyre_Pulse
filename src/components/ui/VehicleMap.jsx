import { useEffect, useRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import VehicleMarker from '../illustrations/marker/vehicle.illustration'
import AlertMarker from '../illustrations/marker/alert.illustration'
import WorkshopMarker from '../illustrations/marker/workshop.illustration'
import DepotMarker from '../illustrations/marker/depot.illustration'

/**
 * VehicleMap — a real interactive OpenStreetMap (Leaflet) with the vehicle's
 * position pinned. Falls back to a country overview (Riyadh) when no GPS is set
 * yet. The divIcon HTML is the branded, theme-aware marker/* SVG illustration
 * (rendered to static markup) so the pin matches the product design language and
 * adapts to Light/Dark + tenant brand. `kind` selects which marker to show
 * (vehicle | alert | workshop | depot).
 */
const MARKERS = { vehicle: VehicleMarker, alert: AlertMarker, workshop: WorkshopMarker, depot: DepotMarker }

// Static markup stays theme-aware — the marker's colours are CSS vars resolved
// against the live DOM once Leaflet injects the pin.
function pinHtml(label, kind) {
  const Marker = MARKERS[kind] || VehicleMarker
  const svg = renderToStaticMarkup(<Marker size={46} animate={false} decorative />)
  const safe = String(label).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
  return `<div style="position:relative;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))">
      <div style="background:var(--surface-raised,#0a160d);color:var(--text-primary,#f1f5f2);border:1px solid var(--border-bright,#2a5b38);font-size:11px;font-weight:700;padding:3px 9px;border-radius:8px;white-space:nowrap;margin-bottom:2px">${safe}</div>
      ${svg}
    </div>`
}

export default function VehicleMap({ lat, lng, label = 'Vehicle', kind = 'vehicle', height = 300 }) {
  const el = useRef(null)
  const map = useRef(null)
  const marker = useRef(null)

  useEffect(() => {
    if (!el.current) return
    const has = Number.isFinite(lat) && Number.isFinite(lng)
    const center = has ? [lat, lng] : [24.7136, 46.6753] // Riyadh
    const zoom = has ? 13 : 5

    if (!map.current) {
      map.current = L.map(el.current, { zoomControl: true }).setView(center, zoom)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map.current)
    } else {
      map.current.setView(center, zoom)
    }

    if (marker.current) { marker.current.remove(); marker.current = null }
    if (has) {
      marker.current = L.marker(center, {
        icon: L.divIcon({ className: 'tp-veh-pin', html: pinHtml(label, kind), iconSize: [0, 0] }),
      }).addTo(map.current)
    }
    const t = setTimeout(() => map.current && map.current.invalidateSize(), 120)
    return () => clearTimeout(t)
  }, [lat, lng, label, kind])

  useEffect(() => () => { if (map.current) { map.current.remove(); map.current = null } }, [])

  return <div ref={el} style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden', zIndex: 0 }} />
}
