import * as Location from 'expo-location'
import { GpsFix } from './types'

/** Outcome of a location-capture attempt. `unavailable` covers every
 *  non-success path (permission denied, services off, fix timed out, error) so
 *  the caller only ever branches on captured-vs-not — an inspection is never
 *  blocked on GPS. */
export type LocationStatus = 'idle' | 'capturing' | 'captured' | 'unavailable'

export interface LocationResult {
  status: 'captured' | 'unavailable'
  fix: GpsFix | null
}

// Hard ceiling on the whole capture so a slow/absent fix never stalls submit.
const CAPTURE_TIMEOUT_MS = 8000

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('location_timeout')), ms),
    ),
  ])
}

/**
 * Requests foreground location permission and resolves a single GPS fix.
 *
 * Guarantees graceful degradation: any failure (permission denied, location
 * services disabled, timeout, or a native error) resolves to
 * `{ status: 'unavailable', fix: null }` instead of throwing, so the inspection
 * submit path can proceed without GPS. Balanced accuracy keeps the fix fast and
 * power-cheap while remaining precise enough to tag a yard/site location.
 */
export async function captureInspectionLocation(): Promise<LocationResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== Location.PermissionStatus.GRANTED) {
      return { status: 'unavailable', fix: null }
    }

    const position = await timeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      CAPTURE_TIMEOUT_MS,
    )

    const { latitude, longitude, accuracy } = position.coords
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { status: 'unavailable', fix: null }
    }

    return {
      status: 'captured',
      fix: {
        gps_lat: latitude,
        gps_lng: longitude,
        gps_accuracy: Number.isFinite(accuracy as number) ? (accuracy as number) : null,
        gps_captured_at: new Date(position.timestamp || Date.now()).toISOString(),
      },
    }
  } catch {
    // Timeout, denied services, or native error — degrade silently.
    return { status: 'unavailable', fix: null }
  }
}
