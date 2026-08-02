/**
 * accidentFormVisibility.js - who sees which section of the accident incident form.
 *
 * THE JOB. An accident case is worked by several teams (Fleet, HSE/Safety,
 * Insurance, Workshop, Finance). Each team owns a slice of the incident form and
 * should only be shown the sections it is responsible for, so a Workshop user is
 * not asked for insurer/claim details and an Insurance officer is not asked for a
 * root-cause investigation. On top of that, a stage that was switched OFF in
 * "Which teams this case needs" (a stage waiver) removes that stage's section from
 * the case entirely.
 *
 * DESIGN CONTRACT: pure and deterministic (no I/O, no React, no clock). Two
 * dimensions decide visibility, in order:
 *   1. STAGE GATE (absolute) - a section tied to a stage is hidden for EVERYONE,
 *      including admins, when that stage is waived (required === false). This
 *      matches the customer rule "a stage that is switched off hides its section".
 *   2. ROLE GATE - once the stage is in scope, admins / super-admins / managers /
 *      directors / the case creator always see the section; every other role sees
 *      it only when its role matches the section's owning team.
 *
 * The real app has no literal "Insurance"/"HSE"/"Workshop"/"Fleet" role token
 * (built-in roles are Admin/Manager/Director/Reporter/Inspector/Tyre Man/Driver
 * plus custom roles like "Fleet Supervisor" or "Insurance Officer"). So role
 * matching is by KEYWORD against the role string, which works for both a custom
 * role named after the team and the closest built-in role.
 */

// Roles that manage the whole case and therefore see every section (subject only
// to the absolute stage gate). Matched case-insensitively against the exact role.
const ADMIN_ROLES = ['admin', 'manager', 'director']

/**
 * SECTION_ROLES - each form section maps to the team(s) that own it and, where
 * relevant, the workflow STAGE it depends on.
 *   - stage: the stage key (src/lib/accidentWorkflow.js STAGE_FLOW). When that
 *     stage is waived the whole section is hidden. null = never stage-gated.
 *   - roles: keyword list matched against the user's role string. '*' (or null)
 *     means the section is visible to everyone (still admin/creator aware).
 */
export const SECTION_ROLES = Object.freeze({
  // "Which teams this case needs" - the stage toggles. Only the Fleet team (who
  // scope the case) and the creator/admins decide which teams are involved.
  stageWaivers: { stage: null, roles: ['fleet'] },
  // Safety investigation (HSE) - root cause / corrective / preventive / closure.
  hse: { stage: 'hse_investigation', roles: ['hse', 'safety'] },
  // Insurance & Claim - insurer / policy / claim / deductible / recovered.
  insurance: { stage: 'insurance_claim', roles: ['insurance', 'claims'] },
  // Repair & Release - repair type / workshop / quotation / release.
  repair: { stage: 'repair_in_progress', roles: ['workshop', 'repair', 'mechanic'] },
  // Cost Recovery - recovery source / date / reference / amount transfer.
  costRecovery: { stage: 'cost_recovery', roles: ['finance', 'cost', 'fleet'] },
  // Workflow & Investigation - broadly visible; the Fleet team and all can change it.
  workflow: { stage: null, roles: '*' },
})

/** True when `stage` was explicitly waived (required === false) on the record. */
export function isStageWaived(stageWaivers, stage) {
  if (!stage || !stageWaivers) return false
  const w = stageWaivers[stage]
  return !!w && w.required === false
}

/**
 * Whether the current user can see a given form section.
 *
 * @param {string} sectionKey  a key of SECTION_ROLES
 * @param {object} ctx
 * @param {string} ctx.role          the user's role string (profile.role)
 * @param {boolean} ctx.isSuperAdmin profile.is_super_admin
 * @param {boolean} ctx.isCreator    the user filed this case (new incident, or
 *                                    the row's reported_by is this user)
 * @param {object} ctx.stageWaivers  form.stage_waivers { [stage]: { required } }
 * @returns {boolean}
 */
export function canSeeSection(sectionKey, ctx = {}) {
  const spec = SECTION_ROLES[sectionKey]
  // Unknown section: never hide (fail open - a missing mapping must not blank a
  // section that other parts of the form rely on).
  if (!spec) return true

  const { role, isSuperAdmin = false, isCreator = false, stageWaivers = {} } = ctx

  // 1. Absolute stage gate. A waived stage removes its section from the case for
  //    everyone, matching the existing HSE-block behaviour and the customer rule.
  if (spec.stage && isStageWaived(stageWaivers, spec.stage)) return false

  // 2. Everyone-visible section (still passed the stage gate above).
  if (spec.roles === '*' || spec.roles == null) return true

  // 3. Admins / super-admins / the case creator always see the section (role
  //    bypass). Never lock the creator out of a case they own.
  if (isSuperAdmin || isCreator) return true
  const r = String(role || '').toLowerCase().trim()
  if (ADMIN_ROLES.includes(r)) return true

  // 4. Role keyword match against the owning team.
  return spec.roles.some((kw) => r.includes(kw))
}

export const SECTION_KEYS = Object.keys(SECTION_ROLES)
