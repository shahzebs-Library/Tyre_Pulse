export type UserRole = 'admin' | 'manager' | 'director' | 'inspector' | 'tyre_man' | 'reporter'

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

/**
 * Normalises any DB role string to a consistent lowercase_underscore UserRole.
 * DB values like "Admin", "Tyre Man", "tyre_man" all resolve correctly.
 */
export function normaliseRole(raw: string | null | undefined): UserRole {
  const key = (raw ?? 'reporter').trim().toLowerCase().replace(/\s+/g, '_')
  const valid: UserRole[] = ['admin', 'manager', 'director', 'inspector', 'tyre_man', 'reporter']
  return valid.includes(key as UserRole) ? (key as UserRole) : 'reporter'
}

/** Returns true for roles that have elevated management access */
export function isAdminOrAbove(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'manager' || role === 'director'
}

/** Returns true only for the admin role (hard deletes, full audit access) */
export function isAdmin(role: UserRole | null | undefined): boolean {
  return role === 'admin'
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

// ── Accident types ────────────────────────────────────────────────────────────

export type AccidentType =
  | 'collision' | 'rollover' | 'tyre_failure'
  | 'mechanical' | 'near_miss' | 'property_damage' | 'other'

export type AccidentSeverity = 'minor' | 'moderate' | 'severe' | 'fatal'

export type AccidentStatus = 'reported' | 'under_review' | 'closed'

export interface AccidentRecord {
  id: string
  site: string
  asset_no: string
  vehicle_id: string | null
  reported_by: string | null
  reporter_name: string | null
  incident_date: string          // ISO date YYYY-MM-DD
  incident_time: string | null   // HH:MM
  location: string | null
  accident_type: AccidentType
  severity: AccidentSeverity
  description: string | null
  injuries: boolean
  injury_count: number
  third_party_involved: boolean
  police_report_no: string | null
  damage_description: string | null
  estimated_damage_cost: number | null
  photos: string[]               // array of public Supabase Storage URLs
  status: AccidentStatus
  notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface AccidentDraft {
  site: string
  asset_no: string
  vehicle_id: string | null
  incident_date: string
  incident_time: string
  location: string
  accident_type: AccidentType
  severity: AccidentSeverity
  description: string
  injuries: boolean
  injury_count: string           // string for TextInput
  third_party_involved: boolean
  police_report_no: string
  damage_description: string
  estimated_damage_cost: string  // string for TextInput
  notes: string
}

export function emptyAccidentDraft(): AccidentDraft {
  const now = new Date()
  return {
    site: '',
    asset_no: '',
    vehicle_id: null,
    incident_date: now.toISOString().split('T')[0],
    incident_time: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
    location: '',
    accident_type: 'collision',
    severity: 'minor',
    description: '',
    injuries: false,
    injury_count: '0',
    third_party_involved: false,
    police_report_no: '',
    damage_description: '',
    estimated_damage_cost: '',
    notes: '',
  }
}

export const ACCIDENT_TYPE_LABELS: Record<AccidentType, string> = {
  collision:       'Vehicle Collision',
  rollover:        'Vehicle Rollover',
  tyre_failure:    'Tyre Failure',
  mechanical:      'Mechanical Failure',
  near_miss:       'Near Miss',
  property_damage: 'Property Damage',
  other:           'Other',
}

export const SEVERITY_COLORS: Record<AccidentSeverity, string> = {
  minor:    '#16a34a',
  moderate: '#f59e0b',
  severe:   '#ea580c',
  fatal:    '#dc2626',
}

export const STATUS_COLORS: Record<AccidentStatus, string> = {
  reported:     '#3b82f6',
  under_review: '#f59e0b',
  closed:       '#6b7280',
}

// Iconic representations — distinct glyphs so severity / status read at a glance.
export const SEVERITY_ICONS: Record<AccidentSeverity, string> = {
  minor:    'alert-circle-outline',
  moderate: 'warning-outline',
  severe:   'flame-outline',
  fatal:    'skull-outline',
}

export const STATUS_ICONS: Record<AccidentStatus, string> = {
  reported:     'ellipse-outline',
  under_review: 'hourglass-outline',
  closed:       'checkmark-done-outline',
}

// ── Tyre position constants ───────────────────────────────────────────────────

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
