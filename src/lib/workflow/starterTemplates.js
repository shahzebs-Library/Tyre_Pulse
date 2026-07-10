/**
 * Starter workflow templates — ready-to-use approval chains for the four
 * reference flows in APPROVAL_WORKFLOW_ENGINE.md §1. An admin can load any of
 * these into the visual builder as a starting point and customise it before
 * saving. All steps use the extended step schema (assignee_type, requirement
 * flags, optional condition) documented in §4 of the spec.
 *
 * Each template is a plain object: {name, entity_type, trigger_event, steps[]}.
 * These are pure data (no side effects), so they can be imported anywhere and
 * are unit-tested in src/test/starterTemplates.test.js.
 */

/**
 * Build a step with sane defaults so templates stay concise and every step is
 * schema-complete (all requirement flags present, not undefined).
 * @param {object} overrides
 * @returns {object} a fully-formed workflow step
 */
function step({
  name,
  approver_role,
  assignee_type = 'role',
  approver_user_id = null,
  sla_hours = 24,
  require_signature = false,
  require_photo = false,
  require_gps = false,
  require_comment_on_return = true,
  allow_return = true,
  optional = false,
  condition = null,
} = {}) {
  return {
    name,
    assignee_type,
    approver_role,
    approver_user_id,
    sla_hours,
    require_signature,
    require_photo,
    require_gps,
    require_comment_on_return,
    allow_return,
    optional,
    condition,
  }
}

/**
 * Daily Vehicle Inspection — Tyre Man completes checklist with mandatory photos
 * and signature → Inspector review + signature → optional Fleet Supervisor
 * review → final approval (inspection locked).
 */
const dailyVehicleInspection = {
  name: 'Daily Vehicle Inspection',
  entity_type: 'inspection',
  trigger_event: 'inspection.completed',
  steps: [
    step({
      name: 'Tyre Man Checklist & Photos',
      approver_role: 'Tyre Man',
      sla_hours: 8,
      require_signature: true,
      require_photo: true,
    }),
    step({
      name: 'Inspector Review',
      approver_role: 'Inspector',
      sla_hours: 24,
      require_signature: true,
      allow_return: true,
    }),
    step({
      name: 'Fleet Supervisor Review',
      approver_role: 'Fleet Supervisor',
      sla_hours: 48,
      require_signature: true,
      optional: true,
    }),
  ],
}

/**
 * Tyre Replacement — Tyre Man requests with damage photos → Supervisor approval
 * → Store Keeper issues → installed with Tyre Man signature → Inspector
 * verification → optional Workshop Manager approval when cost is high.
 */
const tyreReplacement = {
  name: 'Tyre Replacement',
  entity_type: 'tyre_change',
  trigger_event: 'tyre.replacement_requested',
  steps: [
    step({
      name: 'Tyre Man Request & Damage Photos',
      approver_role: 'Tyre Man',
      sla_hours: 8,
      require_photo: true,
      require_comment_on_return: true,
    }),
    step({
      name: 'Fleet Supervisor Approval',
      approver_role: 'Fleet Supervisor',
      sla_hours: 24,
      require_signature: true,
    }),
    step({
      name: 'Store Keeper Issues Tyre',
      approver_role: 'Store Keeper',
      sla_hours: 24,
    }),
    step({
      name: 'Tyre Man Installation Sign-off',
      approver_role: 'Tyre Man',
      sla_hours: 12,
      require_signature: true,
      require_photo: true,
    }),
    step({
      name: 'Inspector Verification',
      approver_role: 'Inspector',
      sla_hours: 24,
      require_signature: true,
    }),
    step({
      name: 'Workshop Manager Approval (high cost)',
      approver_role: 'Workshop Manager',
      sla_hours: 48,
      require_signature: true,
      optional: true,
      condition: { field: 'replacement_cost', op: '>', value: 5000 },
    }),
  ],
}

/**
 * Accident — Driver reports with GPS + photos → workshop inspection → estimate
 * → insurance approval (only when major) → final inspection → vehicle released.
 */
const accident = {
  name: 'Accident',
  entity_type: 'accident',
  trigger_event: 'accident.reported',
  steps: [
    step({
      name: 'Driver Report (GPS + Photos)',
      approver_role: 'Tyre Man',
      sla_hours: 4,
      require_gps: true,
      require_photo: true,
      require_comment_on_return: true,
    }),
    step({
      name: 'Workshop Inspection & Estimate',
      approver_role: 'Workshop Manager',
      sla_hours: 24,
      require_signature: true,
      require_photo: true,
    }),
    step({
      name: 'Insurance / Finance Approval (major)',
      approver_role: 'Finance',
      sla_hours: 72,
      require_signature: true,
      optional: true,
      condition: { field: 'severity', op: '=', value: 'major' },
    }),
    step({
      name: 'Final Inspection & Release',
      approver_role: 'Fleet Supervisor',
      sla_hours: 24,
      require_signature: true,
    }),
  ],
}

/**
 * Purchase Request — Tyre Man → Store Keeper → Workshop Manager → Procurement →
 * Finance → GM → Purchase Order. Finance/GM steps gate on order value.
 */
const purchaseRequest = {
  name: 'Purchase Request',
  entity_type: 'purchase_order',
  trigger_event: 'purchase.request_created',
  steps: [
    step({
      name: 'Tyre Man Request',
      approver_role: 'Tyre Man',
      sla_hours: 24,
      require_comment_on_return: true,
    }),
    step({
      name: 'Store Keeper Stock Check',
      approver_role: 'Store Keeper',
      sla_hours: 24,
    }),
    step({
      name: 'Workshop Manager Approval',
      approver_role: 'Workshop Manager',
      sla_hours: 48,
      require_signature: true,
    }),
    step({
      name: 'Procurement Review',
      approver_role: 'Procurement',
      sla_hours: 48,
      require_signature: true,
    }),
    step({
      name: 'Finance Approval (high value)',
      approver_role: 'Finance',
      sla_hours: 72,
      require_signature: true,
      optional: true,
      condition: { field: 'total_cost', op: '>', value: 10000 },
    }),
    step({
      name: 'GM Final Sign-off',
      approver_role: 'GM',
      sla_hours: 72,
      require_signature: true,
      optional: true,
      condition: { field: 'total_cost', op: '>', value: 25000 },
    }),
  ],
}

/**
 * The four reference-flow starter templates, in rollout priority order.
 * @type {Array<{name:string, entity_type:string, trigger_event:string, steps:Array<object>}>}
 */
export const STARTER_TEMPLATES = [
  dailyVehicleInspection,
  tyreReplacement,
  accident,
  purchaseRequest,
]

export default STARTER_TEMPLATES
