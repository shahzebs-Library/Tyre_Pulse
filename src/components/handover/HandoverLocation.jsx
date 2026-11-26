import { lazy, Suspense } from 'react'
import { MapPin, ExternalLink } from 'lucide-react'
import { formatCoords, openStreetMapUrl, LOCATION_LABEL } from '../../lib/handoverAuthorization'

// Leaflet is heavy; it only loads when a handover with coordinates is shown.
const VehicleMap = lazy(() => import('../ui/VehicleMap'))

/**
 * Where the handover took place: an OpenStreetMap view of the recorded point
 * with a link that opens it on openstreetmap.org (no API key involved), or an
 * honest line saying why there is no location.
 *
 * @param {{ location: {lat:number,lng:number,accuracy:number|null}|null, status?:string, label?:string, height?:number }} props
 */
export default function HandoverLocation({ location, status, label = 'Handover', height = 200 }) {
  if (!location) {
    return (
      <p className="vh-note" data-testid="handover-location-none">
        <MapPin size={14} aria-hidden="true" /> {LOCATION_LABEL[status] || 'No location recorded'}
      </p>
    )
  }
  const href = openStreetMapUrl(location)
  return (
    <div className="vh-location" data-testid="handover-location">
      <Suspense fallback={<div className="vh-note">Loading map...</div>}>
        <VehicleMap lat={location.lat} lng={location.lng} label={label} kind="depot" height={height} />
      </Suspense>
      <p className="vh-hint">
        <MapPin size={13} aria-hidden="true" /> {formatCoords(location)}
        {location.accuracy != null ? ` (within ${Math.round(location.accuracy)} m)` : ''}
        {' '}
        <a href={href} target="_blank" rel="noopener noreferrer">Open in map <ExternalLink size={12} aria-hidden="true" /></a>
      </p>
    </div>
  )
}
