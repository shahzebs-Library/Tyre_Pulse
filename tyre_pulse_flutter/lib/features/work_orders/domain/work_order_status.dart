/// The work order status ladder, priority vocabulary, and work type
/// vocabulary - the pure decision logic behind the Work Orders feature.
///
/// Ported from `mobile/app/(app)/work-orders.tsx` (`mobile/` is READ-ONLY
/// reference material - see `AGENTS.md` rule "Never edit them from this
/// project"). Note there are TWO "work orders" screens in the production
/// app that both claim the same name: `work-orders.tsx`, which reads the
/// real `work_orders` table this feature is built on, and
/// `workorders/index.tsx`, which is on the actual bottom tab bar but reads
/// `corrective_actions` - a different table entirely, with a different
/// status vocabulary and no relationship to a maintenance job card. This
/// port is `work-orders.tsx` only. `corrective_actions` is a deliberately
/// separate, deferred feature area - do not fold the two together.
///
/// # `work_orders.status` is free text, not an enum
///
/// Measured directly against the live database (recorded in this
/// repository's own PROJECT_MEMORY): `work_orders.status` carries NO CHECK
/// constraint and stores legacy tokens across a spread of casings -
/// `Closed`, `Completed`, `Open`, `In Progress`, `Cancelled` are all
/// observed live. So this file does not attempt to enumerate every value
/// the column can hold; it recognises the four the reference screen's own
/// `NEXT_STATUS`/`WO_STATUS_KIND` maps recognise (matched
/// case-insensitively, exactly as the reference does with
/// `.toLowerCase()`), and treats anything else as a genuine unknown -
/// [workOrderStatusTone] answers [WorkOrderTone.neutral] for it rather than
/// guessing, and [nextWorkOrderStatus] answers `null` (nothing this screen
/// knows how to advance further).
///
/// # Priority and work type ARE closed, app-level vocabularies
///
/// Unlike status, [kWorkOrderPriorities] and [kWorkOrderWorkTypes] are
/// fixed lists the reference screen itself defines and offers as the only
/// choices on its create form (`PRIORITIES`/`WORK_TYPES` in the TS source).
/// They are not a database CHECK constraint either, but the create form
/// only ever writes one of these values, so a row's own `priority`/
/// `work_type` is expected to be one of them even though the column itself
/// accepts free text.
library;

/// A domain-level severity/success tone, decoupled from the design
/// system's own `TpStatus` enum.
///
/// Mirrors `features/approvals/domain/checklist_approval.dart`'s own
/// `ApprovalStatusTone` - a pure Dart file must not import
/// `package:tyre_pulse/app/theme/tp_colors.dart`, so the tone-to-colour
/// mapping is a presentation-layer concern
/// (`presentation/widgets/work_order_badges.dart`) built ON TOP of this
/// enum, never inside it.
enum WorkOrderTone {
  /// Neutral information, not yet a judgement. The reference's `open`
  /// status.
  info,

  /// Healthy / finished cleanly. The reference's `completed` status and its
  /// `Low` priority.
  ok,

  /// Needs attention but is not stopping anything. The reference's
  /// `in progress` status and its `Medium` priority.
  warning,

  /// The strongest signal available. The reference's `High`/`Critical`
  /// priorities.
  critical,

  /// A value with no judgement attached - closed work, or a status this
  /// file does not recognise. Never invented as a stand-in for "unknown";
  /// see the library comment on why an unrecognised status lands here
  /// rather than on a guessed tone.
  neutral,
}

/// The reference screen's own six work types (`WORK_TYPES` in
/// `work-orders.tsx`), in the exact order the create form offers them.
const List<String> kWorkOrderWorkTypes = <String>[
  'Tyre Change',
  'Repair',
  'Rotation',
  'Alignment',
  'Inspection',
  'Other',
];

/// The default selected work type on a fresh create form.
const String kWorkOrderDefaultWorkType = 'Tyre Change';

/// The reference screen's own four priorities (`PRIORITIES` in
/// `work-orders.tsx`), in the exact order the create form offers them.
const List<String> kWorkOrderPriorities = <String>[
  'Low',
  'Medium',
  'High',
  'Critical',
];

/// The default selected priority on a fresh create form.
const String kWorkOrderDefaultPriority = 'Medium';

/// The status a freshly created work order carries, before anybody has
/// touched it. Matches the reference's own hard-coded `status: 'Open'` on
/// create.
const String kWorkOrderInitialStatus = 'Open';

/// The status [nextWorkOrderStatus] advances TO from `'open'`.
const String kWorkOrderStatusInProgress = 'In Progress';

/// The status [nextWorkOrderStatus] advances TO from `'in progress'`.
const String kWorkOrderStatusCompleted = 'Completed';

String _normalised(String? raw) => (raw ?? '').trim().toLowerCase();

/// The status this work order would move to if advanced one step, or
/// `null` when there is nothing further this screen offers.
///
/// #mirror: `NEXT_STATUS` in `mobile/app/(app)/work-orders.tsx` -
/// `{ open: 'In Progress', 'in progress': 'Completed' }`. Matched
/// case-insensitively against [current], exactly as the reference reads
/// `(wo.status ?? 'open').toLowerCase()` before the lookup - a blank or
/// null status is treated as `'open'`, never as "nothing to advance",
/// because a freshly created row that has not yet reached the server still
/// deserves an advance action once it is visible.
///
/// `'Completed'`, `'Closed'`, and anything this file does not recognise
/// all answer `null` - there is no forward step from a state the reference
/// screen itself does not offer to advance from, including a value it has
/// simply never seen before.
String? nextWorkOrderStatus(String? current) {
  final String normalised = _normalised(current).isEmpty
      ? 'open'
      : _normalised(current);
  switch (normalised) {
    case 'open':
      return kWorkOrderStatusInProgress;
    case 'in progress':
      return kWorkOrderStatusCompleted;
    default:
      return null;
  }
}

/// Whether [status] belongs in the "active" filter - i.e. it is neither
/// completed nor closed.
///
/// #mirror: the reference's own inline filter,
/// `!['completed', 'closed'].includes((w.status ?? '').toLowerCase())`. A
/// blank or null status is therefore active (an empty string is not in the
/// exclusion list either), matching the reference exactly - this is
/// DELIBERATELY not the same treatment as [nextWorkOrderStatus], which
/// coerces a blank status to `'open'` before its own lookup. Kept
/// separate rather than sharing one normalisation step because the
/// reference itself does not share one either.
bool isWorkOrderStatusOpenLike(String? status) {
  final String normalised = _normalised(status);
  return normalised != 'completed' && normalised != 'closed';
}

/// The tone a status badge should carry.
///
/// #mirror: `WO_STATUS_KIND` in `mobile/app/(app)/work-orders.tsx` -
/// `{ open: 'info', 'in progress': 'warning', completed: 'success',
/// closed: 'neutral' }`. Unlike [nextWorkOrderStatus], a blank/null status
/// is NOT coerced to `'open'` here: the reference's own fallback for that
/// case is the *label* `t('modules.workOrders.statusOpen')`
/// (`workOrderStatusLabel` in the presentation layer reproduces exactly
/// that), and its tone lookup on a blank key falls through to the `??
/// 'neutral'` default the same way an unrecognised non-blank value would -
/// so a genuinely blank status and a genuinely unrecognised one share the
/// same neutral tone here, matching the reference's own behaviour rather
/// than inventing a third rule for a case it never actually distinguishes.
WorkOrderTone workOrderStatusTone(String? status) {
  switch (_normalised(status)) {
    case 'open':
      return WorkOrderTone.info;
    case 'in progress':
      return WorkOrderTone.warning;
    case 'completed':
      return WorkOrderTone.ok;
    case 'closed':
      return WorkOrderTone.neutral;
    default:
      return WorkOrderTone.neutral;
  }
}

/// The tone a priority badge should carry.
///
/// #mirror: `PRI_KIND` in `mobile/app/(app)/work-orders.tsx` -
/// `{ Low: 'success', Medium: 'warning', High: 'danger', Critical:
/// 'critical' }`. This design system has no fifth "danger" tone distinct
/// from `TpStatus.critical` (`app/theme/tp_colors.dart`'s own `TpStatus`
/// enum carries exactly five judgement tones plus `unknown`), so High and
/// Critical both map to [WorkOrderTone.critical] here - a disclosed,
/// deliberate compression, not a bug. The two remain visually
/// distinguishable regardless: the badge always renders the row's own raw
/// priority text (`workOrderPriorityLabel`, presentation layer), so "High"
/// and "Critical" are never shown as the same word, only the same colour.
WorkOrderTone workOrderPriorityTone(String? priority) {
  switch (_normalised(priority)) {
    case 'low':
      return WorkOrderTone.ok;
    case 'medium':
      return WorkOrderTone.warning;
    case 'high':
    case 'critical':
      return WorkOrderTone.critical;
    default:
      return WorkOrderTone.neutral;
  }
}
