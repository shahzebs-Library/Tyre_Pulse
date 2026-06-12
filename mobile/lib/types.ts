export type UserRole = 'admin' | 'manager' | 'director' | 'inspector' | 'tyre_man'

export interface Profile {
  id: string
  full_name: string | null
  username: string | null
  employee_id: string | null
  role: UserRole
  site: string | null
  country: string | null
  approved: boolean
}

export interface VehicleFleet {
  id: string
  site: string
  asset_no: string
  vehicle_type: string
  make?: string
  model?: string
}

export type TyreCondition = 'Good' | 'Worn' | 'Damaged' | 'Flat' | 'Missing'

export interface TyrePositionData {
  position: string
  serial_number: string
  pressure_psi: string
  tread_depth_mm: string
  condition: TyreCondition
  /** Local file URI — used for immediate on-device preview only */
  photo_uri: string | null
  /** Permanent public Supabase Storage URL — persists after reinstall */
  photo_url: string | null
  notes: string
}

// Mirrors the actual `inspections` table columns so rows insert directly.
export interface InspectionPayload {
  title: string
  site: string
  asset_no: string
  vehicle_type: string
  inspector: string
  created_by: string | null
  inspection_date: string
  scheduled_date: string
  inspection_type: string
  tyre_conditions: Record<string, TyrePositionData>
  notes: string
  status: string
}

export interface OfflineInspection {
  id: string
  payload: InspectionPayload
  sync_status: 'pending' | 'synced' | 'failed'
  created_at: string
  synced_at: string | null
  error: string | null
}

export const TYRE_POSITIONS: Record<string, string[]> = {
  '4-Wheeler':  ['FL', 'FR', 'RL', 'RR', 'Spare'],
  '6-Wheeler':  ['FL', 'FR', 'RL1', 'RL2', 'RR1', 'RR2', 'Spare'],
  '8-Wheeler':  ['FL', 'FR', 'RL1', 'RL2', 'RL3', 'RR1', 'RR2', 'RR3', 'Spare'],
  '10-Wheeler': ['FL', 'FR', 'RL1', 'RL2', 'RL3', 'RR1', 'RR2', 'RR3', 'SL', 'SR'],
  'Trailer':    ['AxleL1', 'AxleL2', 'AxleR1', 'AxleR2', 'Spare'],
  'Default':    ['FL', 'FR', 'RL1', 'RL2', 'RR1', 'RR2', 'Spare'],
}

export function getPositionsForVehicle(vehicleType: string): string[] {
  const key = Object.keys(TYRE_POSITIONS).find(k =>
    vehicleType?.toLowerCase().includes(k.toLowerCase().replace('-wheeler', ''))
  )
  return TYRE_POSITIONS[key ?? 'Default']
}

export function emptyTyrePosition(position: string): TyrePositionData {
  return {
    position,
    serial_number: '',
    pressure_psi: '',
    tread_depth_mm: '',
    condition: 'Good',
    photo_uri: null,
    photo_url: null,
    notes: '',
  }
}
