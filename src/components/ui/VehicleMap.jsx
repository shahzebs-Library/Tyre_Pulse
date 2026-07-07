import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

/**
 * VehicleMap — a real interactive OpenStreetMap (Leaflet) with the vehicle's
 * position pinned. Falls back to a country overview (Riyadh) when no GPS is set
 * yet. Uses a divIcon pin so no bundler image assets are needed. Leaflet only
 * loads inside the lazily-routed Vehicle 360 page.
 */
export default function VehicleMap({ lat, lng, label = 'Vehicle', height = 300 }) {
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
      const pin = `<div style="position:relative;transform:translate(-50%,-100%)">
        <div style="background:#dc2626;color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:8px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.3)">${label}</div>
        <div style="width:10px;height:10px;background:#dc2626;transform:rotate(45deg);margin:-4px auto 0;box-shadow:0 2px 4px rgba(0,0,0,.2)"></div>
        <div style="width:12px;height:12px;border-radius:50%;background:rgba(220,38,38,.25);margin:2px auto 0"></div>
      </div>`
      marker.current = L.marker(center, {
        icon: L.divIcon({ className: 'tp-veh-pin', html: pin, iconSize: [0, 0] }),
      }).addTo(map.current)
    }
    const t = setTimeout(() => map.current && map.current.invalidateSize(), 120)
    return () => clearTimeout(t)
  }, [lat, lng, label])

  useEffect(() => () => { if (map.current) { map.current.remove(); map.current = null } }, [])

  return <div ref={el} style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden', zIndex: 0 }} />
}
