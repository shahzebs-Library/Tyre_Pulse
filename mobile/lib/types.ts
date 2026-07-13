export type UserRole = 'admin' | 'manager' | 'director' | 'inspector' | 'tyre_man' | 'reporter' | 'driver'

/** Countries the platform operates in - mirrors the web SettingsContext list.
 *  A user's country drives data isolation and stamps their mobile-created rows. */
export const COUNTRIES = ['KSA', 'UAE', 'Egypt'] as const
export type Country = (typeof COUNTRIES)[number]

export interface Profile {
  id: string
  full_name: string | null
  username: string | null
  employee_id: string | null
  role: UserRole
  site: string | null
  country: string | null
  approved: boolean
  locked?: boolean | null
}

/**
 * Normalises any DB role string to a consistent lowercase_underscore UserRole.
 * DB values like "Admin", "Tyre Man", "tyre_man" all resolve correctly.
 */
export function normaliseRole(raw: string | null | undefined): UserRole {
  const key = (raw ?? 'reporter').trim().toLowerCase().replace(/\s+/g, '_')
  const valid: UserRole[] = ['admin', 'manager', 'director', 'inspector', 'tyre_man', 'reporter', 'driver']
  return valid.includes(key as UserRole) ? (key as UserRole) : 'reporter'
}

/**
 * Normalises the DB `profiles.country` value to a single scalar the mobile app
 * can use for client-side scoping and row stamping.
 *
 * IMPORTANT: since V114 (server-side country RLS) `profiles.country` is a
 * `text[]` ARRAY, not a scalar. Passing that array straight into a PostgREST
 * filter (`country.eq.${arr}`) or stamping it onto a `text` column silently
 * breaks: an empty "see-all" array coerces to "" (hiding every country-tagged
 * row) and a multi-country array coerces to "A,B" (an invalid filter). We
 * collapse it to:
 *   • single assigned country            → that country string (client filter ok)
 *   • empty / null / "All" / multi-country → null  (no client filter; the V114
 *     RESTRICTIVE RLS already returns exactly the countries the user may see)
 */
export function normaliseCountry(raw: unknown): string | null {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  const cleaned = arr
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .filter((v) => v.toLowerCase() !== 'all')
  return cleaned.length === 1 ? cleaned[0] : null
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

export type TyreCondition = 'Good' | 'Worn' | 'Damaged' | 'Puncture' | 'Flat' | 'Missing'

export interface TyrePositionData {
  position: string
  serial_number: string
  pressure_psi: string
  tread_depth_mm: string
  condition: TyreCondition
  /** Local file URI - used for immediate on-device preview only */
  photo_uri: string | null
  /** Permanent public Supabase Storage URL - persists after reinstall */
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
  /** Stamped from the creator's profile so records never mix across countries */
  country: string | null
  /** GPS latitude of where the inspection was recorded (WGS84). Null when the
   *  device fix was denied/unavailable — the inspection is never blocked on it. */
  gps_lat?: number | null
  /** GPS longitude of where the inspection was recorded (WGS84). */
  gps_lng?: number | null
  /** Horizontal accuracy of the fix in metres, as reported by the OS. */
  gps_accuracy?: number | null
  /** ISO-8601 timestamp of when the GPS fix was captured. */
  gps_captured_at?: string | null
}

/** A resolved GPS fix folded into the inspection payload. Field names mirror the
 *  `inspections` table columns 1:1 so it spreads directly into the insert. */
export interface GpsFix {
  gps_lat: number
  gps_lng: number
  gps_accuracy: number | null
  gps_captured_at: string
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

  // ── Deep claims module (MIGRATIONS_V19) ───────────────────────────────────
  responsible_party?: string | null     // who is at fault
  liable_party?: string | null          // who is liable
  payer?: string | null                 // who will pay
  driver_name?: string | null
  insurer?: string | null
  policy_no?: string | null
  claim_status?: ClaimStatus | null
  claim_amount?: number | null
  claim_approved_amount?: number | null
  deductible?: number | null
  parts_cost?: number | null
  closure_status?: ClosureStatus | null
  close_requested_by?: string | null
  close_requested_at?: string | null
  close_request_note?: string | null
  closure_approved_by?: string | null
  closure_approved_at?: string | null
  closure_rejected_reason?: string | null

  // Recovery (MIGRATIONS_V20)
  recovered_amount?: number | null
  recovery_date?: string | null
  recovery_source?: RecoverySource | null
  recovery_status?: RecoveryStatus | null
  recovery_reference?: string | null
}

export type RecoverySource = 'none' | 'insurer' | 'third_party' | 'driver' | 'warranty'
export type RecoveryStatus = 'pending' | 'partial' | 'recovered' | 'written_off'

export const RECOVERY_SOURCE_LABELS: Record<RecoverySource, string> = {
  none: 'None', insurer: 'Insurer', third_party: 'Third Party', driver: 'Driver', warranty: 'Warranty',
}

export const RECOVERY_STATUS_LABELS: Record<RecoveryStatus, string> = {
  pending: 'Pending', partial: 'Partial', recovered: 'Recovered', written_off: 'Written Off',
}

export const RECOVERY_STATUS_COLORS: Record<RecoveryStatus, string> = {
  pending: '#f59e0b', partial: '#3b82f6', recovered: '#16a34a', written_off: '#dc2626',
}

// ── Claims module supporting types ──────────────────────────────────────────────

export type ClaimStatus = 'none' | 'filed' | 'approved' | 'rejected' | 'settled'
export type ClosureStatus = 'open' | 'pending_closure' | 'closed'
export type PartStatus = 'needed' | 'ordered' | 'received' | 'fitted'

export type RemarkType =
  | 'note' | 'insurance' | 'repair' | 'responsibility'
  | 'status_change' | 'closure_request' | 'closure_approved' | 'closure_rejected'

export interface AccidentRemark {
  id: string
  accident_id: string
  author_id: string | null
  author_name: string | null
  remark: string
  remark_type: RemarkType
  created_at: string
}

export interface AccidentPart {
  id: string
  accident_id: string
  part_name: string
  part_number: string | null
  quantity: number
  unit_cost: number
  total_cost: number
  supplier: string | null
  status: PartStatus
  created_at: string
}

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  none:     'No Claim',
  filed:    'Filed',
  approved: 'Approved',
  rejected: 'Rejected',
  settled:  'Settled',
}

export const CLAIM_STATUS_COLORS: Record<ClaimStatus, string> = {
  none:     '#6b7280',
  filed:    '#3b82f6',
  approved: '#16a34a',
  rejected: '#dc2626',
  settled:  '#7c3aed',
}

export const PART_STATUS_LABELS: Record<PartStatus, string> = {
  needed:   'Needed',
  ordered:  'Ordered',
  received: 'Received',
  fitted:   'Fitted',
}

export const PART_STATUS_COLORS: Record<PartStatus, string> = {
  needed:   '#f59e0b',
  ordered:  '#3b82f6',
  received: '#7c3aed',
  fitted:   '#16a34a',
}

export const REMARK_TYPE_META: Record<RemarkType, { icon: string; color: string }> = {
  note:             { icon: 'chatbubble-ellipses-outline', color: '#64748b' },
  insurance:        { icon: 'shield-outline',              color: '#3b82f6' },
  repair:           { icon: 'construct-outline',           color: '#f59e0b' },
  responsibility:   { icon: 'person-outline',              color: '#7c3aed' },
  status_change:    { icon: 'swap-horizontal-outline',     color: '#0ea5e9' },
  closure_request:  { icon: 'lock-closed-outline',         color: '#f59e0b' },
  closure_approved: { icon: 'checkmark-done-outline',      color: '#16a34a' },
  closure_rejected: { icon: 'close-circle-outline',        color: '#dc2626' },
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
  driver_name: string
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
    driver_name: '',
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

// Iconic representations - distinct glyphs so severity / status read at a glance.
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
//
// The REAL `vehicle_fleet.vehicle_type` values are equipment names (Tr-Mixer,
// Generator, Wheel_Loader …), NOT generic "6-Wheeler" strings. Each real type is
// mapped to a complete, correct position set below. Position ids keep the
// L/R + axle-indexed scheme (FL1, RR4, AxleL2, Spare) so both the inspection
// capture loop and the SVG diagram can reason about side + axle deterministically.

export const TYRE_POSITIONS: Record<string, string[]> = {
  // ── Real-fleet equipment configurations ────────────────────────────────────
  // Transit / concrete mixer, 8x4: 4 steer + 8 drive + spare = 12 running tyres.
  'Tr-Mixer':  ['FL1', 'FR1', 'FL2', 'FR2', 'RL1', 'RL2', 'RL3', 'RL4', 'RR1', 'RR2', 'RR3', 'RR4', 'Spare'],
  // Heavy 6x4 truck (D Tanker, spider/line pump, placing boom, generic truck/crane):
  // 2 steer + 8 drive (dual) + spare = 10 running tyres.
  'Truck6x4':  ['FL', 'FR', 'RL1', 'RL2', 'RL3', 'RL4', 'RR1', 'RR2', 'RR3', 'RR4', 'Spare'],
  // Bus, 6 running tyres (dual rear) + spare.
  'Bus6':      ['FL', 'FR', 'RL1', 'RL2', 'RR1', 'RR2', 'Spare'],
  // Light pickup / SUV, 4 + spare.
  'Pickup':    ['FL', 'FR', 'RL', 'RR', 'Spare'],
  // Wheeled plant (wheel/skid loader, forklift, reclaimer, excavator): 4 wheels,
  // no spare carried.
  'Loader4':   ['FL', 'FR', 'RL', 'RR'],
  // Stationary / skid / small trailer-mounted equipment (generator, pumps,
  // batch plant, chiller, ice plant, water treatment): 2-axle equipment frame.
  'Equipment': ['AxleL1', 'AxleR1', 'AxleL2', 'AxleR2', 'Spare'],

  // ── Generic N-Wheeler aliases (kept for manual entry + back-compat) ─────────
  '4-Wheeler':  ['FL', 'FR', 'RL', 'RR', 'Spare'],
  '6-Wheeler':  ['FL', 'FR', 'RL1', 'RL2', 'RR1', 'RR2', 'Spare'],
  '8-Wheeler':  ['FL', 'FR', 'RL1', 'RL2', 'RL3', 'RR1', 'RR2', 'RR3', 'Spare'],
  '10-Wheeler': ['FL', 'FR', 'RL1', 'RL2', 'RL3', 'RR1', 'RR2', 'RR3', 'SL', 'SR'],
  'Trailer':    ['AxleL1', 'AxleR1', 'AxleL2', 'AxleR2', 'Spare'],
  'Default':    ['FL', 'FR', 'RL1', 'RL2', 'RR1', 'RR2', 'Spare'],
}

/** Collapse a vehicle-type string to a comparison key: lowercase, no spaces/-/_. */
function normalizeVehicleType(raw: string | null | undefined): string {
  return (raw ?? '').toLowerCase().replace(/[\s\-_]+/g, '')
}

/**
 * Maps normalized real/manual vehicle-type names → a TYRE_POSITIONS config key.
 * Keys are already normalized (no spaces/dashes). Matched first by exact
 * equality, then by longest-substring, so "spiderpump" wins over "pump".
 */
const VEHICLE_TYPE_ALIASES: Record<string, string> = {
  // Transit / concrete mixer → 12-tyre 8x4
  trmixer: 'Tr-Mixer', mixer: 'Tr-Mixer', transitmixer: 'Tr-Mixer',
  transit: 'Tr-Mixer', concretemixer: 'Tr-Mixer', tm: 'Tr-Mixer',
  // Heavy 6x4 trucks & truck-mounted plant → 10-tyre truck
  dtanker: 'Truck6x4', tanker: 'Truck6x4', watertanker: 'Truck6x4', fueltanker: 'Truck6x4',
  spiderpump: 'Truck6x4', linepump: 'Truck6x4', placingboom: 'Truck6x4',
  boom: 'Truck6x4', concretepump: 'Truck6x4', boompump: 'Truck6x4',
  truck: 'Truck6x4', crane: 'Truck6x4', mixertruck: 'Truck6x4',
  // Bus
  bus: 'Bus6', coach: 'Bus6', minibus: 'Bus6',
  // Light vehicles
  pickup: 'Pickup', pickuptruck: 'Pickup', suv: 'Pickup', car: 'Pickup', van: 'Pickup',
  // Wheeled plant → 4 wheels, no spare
  wheelloader: 'Loader4', skidloader: 'Loader4', skidsteer: 'Loader4', loader: 'Loader4',
  forklift: 'Loader4', reclaimer: 'Loader4', excavator: 'Loader4', backhoe: 'Loader4',
  // Stationary / skid / trailer-mounted equipment → 2-axle equipment frame
  generator: 'Equipment', genset: 'Equipment', pumps: 'Equipment', pump: 'Equipment',
  stationarypump: 'Equipment', btplant: 'Equipment', batchplant: 'Equipment',
  batchingplant: 'Equipment', chiller: 'Equipment', iceplant: 'Equipment', icemaker: 'Equipment',
  watertreatmentplant: 'Equipment', treatmentplant: 'Equipment', waterplant: 'Equipment',
  compressor: 'Equipment', towerlight: 'Equipment', lighttower: 'Equipment', silo: 'Equipment',
  // Generic
  trailer: 'Trailer',
}

/**
 * Resolves a fleet vehicle_type to its complete tyre-position set.
 *
 * Robust matching order:
 *   1. exact TYRE_POSITIONS config key (normalized)
 *   2. exact alias table hit
 *   3. longest-substring alias hit (handles compound names)
 *   4. explicit N-Wheeler number in the name
 *   5. safe Default (only when truly unknown)
 */
export function getPositionsForVehicle(vehicleType: string | null | undefined): string[] {
  const norm = normalizeVehicleType(vehicleType)
  if (!norm) return TYRE_POSITIONS['Default']

  // 1. exact config key (e.g. "Pickup" → "pickup", "Trailer" → "trailer")
  for (const key of Object.keys(TYRE_POSITIONS)) {
    if (normalizeVehicleType(key) === norm) return TYRE_POSITIONS[key]
  }

  // 2. exact alias
  const exact = VEHICLE_TYPE_ALIASES[norm]
  if (exact) return TYRE_POSITIONS[exact]

  // 3. longest-substring alias (so "spiderpumptruck" hits "spiderpump" not "pump")
  const aliasKeys = Object.keys(VEHICLE_TYPE_ALIASES).sort((a, b) => b.length - a.length)
  for (const alias of aliasKeys) {
    if (norm.includes(alias)) return TYRE_POSITIONS[VEHICLE_TYPE_ALIASES[alias]]
  }

  // 4. explicit wheel count in the name
  if (norm.includes('10')) return TYRE_POSITIONS['10-Wheeler']
  if (norm.includes('8'))  return TYRE_POSITIONS['8-Wheeler']
  if (norm.includes('6'))  return TYRE_POSITIONS['6-Wheeler']
  if (norm.includes('4'))  return TYRE_POSITIONS['4-Wheeler']

  // 5. safe fallback
  return TYRE_POSITIONS['Default']
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
