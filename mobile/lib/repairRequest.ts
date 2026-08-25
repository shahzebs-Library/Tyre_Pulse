/**
 * repairRequest - pure logic for a driver-raised RFR (Request For Repair).
 *
 * WHAT AN RFR IS
 * --------------
 * An RFR is what a driver raises when a machine has a fault, BEFORE any job card
 * exists. The workshop then converts it into a job card. The chain is:
 *
 *     RFR  ->  Job Card  ->  MIS store issue  ->  parts lines
 *
 * THE NUMBER IS NOT OURS TO INVENT. `work_orders.rfr_no` carries values shaped
 * like `GC/RFR/0948/1225` (entity / RFR / 4-digit sequence / MMYY) and it is
 * minted SERVER-SIDE. A phone that is offline for a day cannot know the next
 * sequence, so this module never produces one and the screen never displays one
 * before it syncs - it says the office issues it. Showing an invented number
 * would put a reference on a driver's screen that matches nothing in the ERP.
 *
 * Pure and deterministic by design: no I/O, no React, no `Date.now()` (the
 * caller passes `now`), so the ts-jest suite runs it in plain Node with zero
 * native mocking - and the screen and the tests share ONE definition of what a
 * valid request is.
 */

// ── Vocabulary ───────────────────────────────────────────────────────────────
// Tokens are stored VERBATIM in English (they are matched by the workshop and
// by any future DB CHECK); only the display label is translated, exactly as
// WASH_TYPES does in the washing screen. Never store a translated token.

/**
 * Fault categories, ordered roughly by how often a driver reports them.
 * `icon` is an Ionicons name verified against the installed glyphmap - an
 * invented name renders as `?` with no build error.
 */
export const RFR_FAULT_CATEGORIES = [
  { token: 'Engine', icon: 'cog-outline' },
  { token: 'Transmission', icon: 'git-compare-outline' },
  { token: 'Brakes', icon: 'disc-outline' },
  { token: 'Tyres', icon: 'ellipse-outline' },
  { token: 'Hydraulics', icon: 'water-outline' },
  { token: 'Electrical', icon: 'flash-outline' },
  { token: 'Body', icon: 'cube-outline' },
  { token: 'Drum/Mixer', icon: 'sync-outline' },
  { token: 'Pump', icon: 'git-merge-outline' },
  { token: 'Air System', icon: 'cloud-outline' },
  { token: 'Cooling', icon: 'thermometer-outline' },
  { token: 'Other', icon: 'help-circle-outline' },
] as const

export type RfrFaultCategory = (typeof RFR_FAULT_CATEGORIES)[number]['token']

/** Every fault token, for validation and for the locale-key sweep. */
export const RFR_FAULT_TOKENS: readonly RfrFaultCategory[] =
  RFR_FAULT_CATEGORIES.map((c) => c.token)

/**
 * Priority ladder. MUST match the web / DB vocabulary exactly
 * (`repair_requests.priority` CHECK: Low | Medium | High | Critical, the same
 * four words `modules.priority.*` already translates).
 */
export const RFR_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const
export type RfrPriority = (typeof RFR_PRIORITIES)[number]

/** Default when the driver does not choose - the honest middle of the ladder. */
export const RFR_DEFAULT_PRIORITY: RfrPriority = 'Medium'

/**
 * Priority -> design-system status kind.
 *
 * This is the ONE place on the screen where colour is spent on a chip, and it is
 * spent because a priority ladder genuinely means something. Only the SELECTED
 * chip takes its colour; the rest stay neutral, so at most one coloured chip is
 * ever on screen. (Colouring all four would make the red one mean nothing - the
 * confetti defect the Home screen already had to unpick.)
 */
export const RFR_PRIORITY_KIND: Record<
  RfrPriority, 'neutral' | 'info' | 'warning' | 'danger'
> = {
  Low: 'neutral',
  Medium: 'info',
  High: 'warning',
  Critical: 'danger',
}

/**
 * The status a phone may write. A driver raises a request; acknowledging,
 * converting and rejecting are the workshop's transitions and are never sent
 * from here.
 */
export const RFR_STATUS_SUBMITTED = 'submitted'

// ── Draft + payload shapes ───────────────────────────────────────────────────

/** What the screen holds while the driver fills the form. All strings, as typed. */
export interface RepairRequestDraft {
  assetNo: string
  plateNo?: string | null
  assetDescription?: string | null
  site?: string | null
  /** Raw text from the numeric inputs - "" means the driver left it blank. */
  odometer?: string
  engineHours?: string
  faultCategory?: RfrFaultCategory | '' | null
  priority?: RfrPriority
  description: string
  photos?: string[]
  /** Self-contained SVG from SignaturePad, or null when unsigned. */
  signature?: string | null
}

/** The signed-in person, as the screen already has them from AuthContext. */
export interface RepairRequestReporter {
  id?: string | null
  fullName?: string | null
  username?: string | null
  country?: string | null
  site?: string | null
}

/**
 * The exact object handed to `saveCommand('REPAIR_REQUEST', ...)`.
 *
 * Every key here MUST appear in the command's field allow-list in
 * lib/recordQueue.ts, because `sanitize()` silently DROPS any key it does not
 * name - a field forgotten there is not an error, it is missing data.
 *
 * Deliberately absent: `rfr_no` (server-minted), `work_order_no` /
 * `converted_at` / `converted_by` / `rejected_reason` (workshop transitions),
 * `organisation_id` (server default), `created_at` / `updated_at`.
 */
export interface RepairRequestPayload {
  asset_no: string
  plate_no: string | null
  asset_description: string | null
  site: string | null
  country: string | null
  odometer: number | null
  engine_hours: number | null
  fault_category: string | null
  description: string
  priority: RfrPriority
  status: string
  reported_by: string | null
  reported_by_name: string | null
  reported_at: string
  photos: string[] | null
  signature: string | null
  /**
   * Offline idempotency. The record queue ALSO stamps this from the
   * `idempotencyKey` argument, and the screen passes the SAME value to both, so
   * the two can never disagree. Carrying it in the payload keeps the id visible
   * on the queued row itself, which is what makes a replayed insert provably the
   * same request rather than a second one.
   */
  client_uuid: string
}

// ── Meter input parsing ──────────────────────────────────────────────────────

/**
 * Result of reading a meter text field.
 *
 * Three states, kept apart on purpose: `Number('')` is 0 and 0 IS finite, so a
 * blank box collapsed into a real reading of zero is exactly how a fleet ends up
 * with an asset that has "driven 0 km". Never fold these together.
 */
export type MeterInput =
  | { state: 'blank' }
  | { state: 'invalid' }
  | { state: 'value'; value: number }

/** Parse a meter text box. Accepts thousands separators and surrounding space. */
export function parseMeterInput(raw: string | number | null | undefined): MeterInput {
  if (raw === null || raw === undefined) return { state: 'blank' }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { state: 'value', value: raw } : { state: 'invalid' }
  }
  const s = String(raw).trim().replace(/,/g, '')
  if (s === '') return { state: 'blank' }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { state: 'invalid' }
  const n = Number(s)
  return Number.isFinite(n) ? { state: 'value', value: n } : { state: 'invalid' }
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Error / warning CODES, never English sentences.
 *
 * The screen maps a code to a `t()` key. A pure module that returned prose would
 * put an untranslatable English string in front of an Arabic reader, which is
 * the same class of defect as a hardcoded label.
 */
export type RepairRequestError =
  | 'asset_required'
  | 'description_required'
  | 'odometer_invalid'
  | 'odometer_negative'
  | 'engine_hours_invalid'
  | 'engine_hours_negative'

/**
 * A WARNING never blocks the submit.
 *
 * A meter reading below the last one is accepted and flagged, not refused: a
 * meter can genuinely be replaced, and the fleet already learned (V340) that
 * blocking a rollback loses real corrections. Blocking here would also strand a
 * driver whose machine has a swapped cluster with no way to report its fault.
 */
export type RepairRequestWarning =
  | 'odometer_below_last'
  | 'engine_hours_below_last'

export interface RepairRequestValidation {
  ok: boolean
  errors: RepairRequestError[]
  warnings: RepairRequestWarning[]
}

/**
 * Last known meter readings, when the register happens to carry them.
 *
 * `vehicle_fleet.current_km` is populated on only a fraction of the fleet and
 * there is NO engine-hours column on that table at all, so both are optional and
 * an absent value simply produces no warning. Comparing against a value we do
 * not have would invent a fault.
 */
export interface LastMeterReadings {
  odometer?: number | null
  engineHours?: number | null
}

/** Minimum length of a fault description worth sending to a workshop. */
export const RFR_MIN_DESCRIPTION = 3

/**
 * Validate a draft.
 *
 * Required: an asset (the workshop must know which machine) and a description of
 * the fault. Everything else is optional, because a driver standing beside a
 * stopped machine should never be blocked from reporting it by a field the
 * register could have filled in itself.
 */
export function validateRepairRequest(
  draft: RepairRequestDraft,
  last: LastMeterReadings = {},
): RepairRequestValidation {
  const errors: RepairRequestError[] = []
  const warnings: RepairRequestWarning[] = []

  if (!String(draft.assetNo ?? '').trim()) errors.push('asset_required')
  if (String(draft.description ?? '').trim().length < RFR_MIN_DESCRIPTION) {
    errors.push('description_required')
  }

  const odo = parseMeterInput(draft.odometer)
  if (odo.state === 'invalid') errors.push('odometer_invalid')
  if (odo.state === 'value' && odo.value < 0) errors.push('odometer_negative')
  if (
    odo.state === 'value' && odo.value >= 0
    && typeof last.odometer === 'number' && Number.isFinite(last.odometer)
    && odo.value < last.odometer
  ) warnings.push('odometer_below_last')

  const hrs = parseMeterInput(draft.engineHours)
  if (hrs.state === 'invalid') errors.push('engine_hours_invalid')
  if (hrs.state === 'value' && hrs.value < 0) errors.push('engine_hours_negative')
  if (
    hrs.state === 'value' && hrs.value >= 0
    && typeof last.engineHours === 'number' && Number.isFinite(last.engineHours)
    && hrs.value < last.engineHours
  ) warnings.push('engine_hours_below_last')

  return { ok: errors.length === 0, errors, warnings }
}

// ── Asset description ────────────────────────────────────────────────────────

/** The shape of a `vehicle_fleet` row as `lookupAssetByCode` returns it. */
export interface AssetContext {
  vehicle_type?: string | null
  make?: string | null
  model?: string | null
  fleet_number?: string | null
  registration_no?: string | null
  current_km?: number | null
}

/**
 * Compose a human description of the machine from what the register actually
 * carries. `vehicle_fleet` has no `asset_description` column, so this is a
 * COMPOSITION, not a read - and it returns null rather than an empty string when
 * the register knows nothing, so the field stays honestly blank.
 *
 * ASCII separator on purpose: no en/em dashes or middle dots anywhere in
 * user-facing output (project-wide rule).
 */
export function assetDescriptionFrom(asset: AssetContext | null | undefined): string | null {
  if (!asset) return null
  const parts = [asset.vehicle_type, asset.make, asset.model]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
  return parts.length ? parts.join(' / ') : null
}

// ── Payload ──────────────────────────────────────────────────────────────────

const trimOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? null : s
}

const meterOrNull = (raw: string | undefined): number | null => {
  const p = parseMeterInput(raw)
  return p.state === 'value' && p.value >= 0 ? p.value : null
}

/**
 * Build the exact queue payload.
 *
 * @param draft      the form as filled
 * @param reporter   the signed-in person (AuthContext profile)
 * @param clientUuid stable id for this attempt; the SAME value is passed to
 *                   `saveCommand` as its idempotency key, so an immediate insert
 *                   and any offline replay upsert onto one row
 * @param now        ISO timestamp for `reported_at`, injected so this is
 *                   deterministic under test
 */
export function buildRepairRequestPayload(
  draft: RepairRequestDraft,
  reporter: RepairRequestReporter | null | undefined,
  clientUuid: string,
  now: string,
): RepairRequestPayload {
  const photos = (draft.photos ?? []).filter(
    (p): p is string => typeof p === 'string' && p.trim() !== '',
  )
  const category = trimOrNull(draft.faultCategory ?? '')
  const priority = (RFR_PRIORITIES as readonly string[]).includes(draft.priority ?? '')
    ? (draft.priority as RfrPriority)
    : RFR_DEFAULT_PRIORITY

  return {
    asset_no: String(draft.assetNo ?? '').trim(),
    plate_no: trimOrNull(draft.plateNo),
    asset_description: trimOrNull(draft.assetDescription),
    // The driver's own site is the fallback, never a guess about the machine.
    site: trimOrNull(draft.site) ?? trimOrNull(reporter?.site),
    country: trimOrNull(reporter?.country),
    odometer: meterOrNull(draft.odometer),
    engine_hours: meterOrNull(draft.engineHours),
    fault_category: category,
    description: String(draft.description ?? '').trim(),
    priority,
    status: RFR_STATUS_SUBMITTED,
    reported_by: trimOrNull(reporter?.id),
    reported_by_name: trimOrNull(reporter?.fullName) ?? trimOrNull(reporter?.username),
    reported_at: now,
    photos: photos.length ? photos : null,
    signature: trimOrNull(draft.signature),
    client_uuid: clientUuid,
  }
}
