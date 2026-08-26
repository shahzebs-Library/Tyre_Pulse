/// Where a notification tap goes. ONE mapping, for every caller.
///
/// Artifact 03 section 4.1: in production the in-app list and the push tap
/// handler used to carry SEPARATE copies of this rule, and they drifted. The
/// list covered every kind while the root layout hardcoded three, so an
/// approval, an assignment, a parts request or an accident tapped from the
/// notification shade DID NOTHING AT ALL. There is exactly one mapping here and
/// there must never be a second.
///
/// EVALUATION ORDER IS LOAD BEARING. Each rule below is ahead of the next for a
/// stated reason; reordering them changes where real notifications land.
///
/// WHAT IS WIDENED FROM PRODUCTION. The Expo mapping only receives
/// `{type, entityType}`, so it stops at a LIST even where a detail route
/// exists. Artifact 03 section 4.3 says to widen the signature to carry
/// `entityId` and route to the detail, keeping the list as the fallback when
/// there is no id - "a queue you can act from is a better landing than an id
/// that resolves to nothing".
///
/// The widening is applied CONSERVATIVELY, and this is the part worth reading:
/// an id is only used when the entity type names the SAME kind of record the
/// detail route expects. A parts request carries a parts request id, not a work
/// order id; a claim carries a claim id, not an accident id. Routing those to a
/// detail screen would open the wrong record or nothing at all, which is worse
/// than opening the list. So they keep the list.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/app/router/routes.dart';

/// The fields the mapping reads from a notification row.
///
/// A narrow view of `notifications`, so this rule does not depend on the shape
/// of whatever model the notifications feature eventually builds.
@immutable
class TpNotificationTarget {
  const TpNotificationTarget({this.type, this.entityType, this.entityId});

  /// `notifications.type`. Also the type of a local device notification.
  final String? type;

  /// `notifications.entity_type`.
  final String? entityType;

  /// `notifications.entity_id`. Null on local device notifications and on any
  /// row the server did not attribute.
  final String? entityId;

  /// The key the entity rules match on: the entity type, falling back to the
  /// type, lowercased. Mirrors the production `entity_type ?? type`.
  String get entityKey =>
      (entityType ?? type ?? '').toLowerCase().trim();

  /// The exact type, lowercased.
  String get typeKey => (type ?? '').toLowerCase().trim();

  /// A usable entity id, or null. Blank is treated as absent.
  String? get id {
    final String? raw = entityId;
    if (raw == null || raw.trim().isEmpty) return null;
    return raw.trim();
  }
}

/// Resolves a notification to a destination.
///
/// Returns null when nothing sensible can be opened. The tap then STAYS PUT and
/// the row is still marked read - it must never navigate to a location that
/// does not resolve, because that is what put the product owner on a raw
/// "Unmatched Route" developer screen complete with a link enumerating every
/// route in the app.
TpRoute? notificationDestination(TpNotificationTarget target) {
  final String type = target.typeKey;
  final String entity = target.entityKey;
  final String? id = target.id;

  // 1. LOCAL device notifications, matched on the EXACT type and matched
  //    FIRST. Their wording overlaps the entity buckets below:
  //    `inspection_reminder` contains "inspection" and would otherwise open
  //    somebody else's approval queue instead of a new inspection.
  if (type == 'inspection_reminder') return const NewInspectionRoute();
  if (type == 'sync_success' ||
      type == 'sync_failure' ||
      type == 'photo_failure') {
    // Profile carries the offline queue: sync, retry and clear all live there.
    return const ProfileRoute();
  }
  if (type == 'wash_due') return const WashingRoute();

  // 2. A decision on YOUR OWN submission goes to your own work, not to a
  //    generic hub or to somebody else's queue.
  if (type == 'approval_decision') {
    return entity.contains('checklist')
        ? const ChecklistsRoute()
        : const ActivityHistoryRoute();
  }

  // 3. Checklist before workshop: the workshop bucket below matches "assign",
  //    which would otherwise swallow `checklist_assignment`.
  if (entity.contains('checklist')) {
    return id == null
        ? const ChecklistApprovalsRoute()
        : ChecklistApprovalReviewRoute(submissionId: SubmissionId(id));
  }

  // 4. Workshop work, kept AHEAD of the inspection test on purpose: a
  //    "Quality Inspection" JOB CARD is workshop work, not a tyre inspection.
  if (entity.contains('assign') ||
      entity.contains('work_order') ||
      entity.contains('workorder') ||
      entity.contains('job') ||
      entity.contains('parts') ||
      entity.contains('qc') ||
      entity.contains('workshop')) {
    // Only an entity that names a work order carries a work order id. An
    // assignment, a parts request or a QC result does not, so those open the
    // board they can be acted on from.
    final bool namesWorkOrder =
        entity.contains('work_order') || entity.contains('workorder');
    if (namesWorkOrder && id != null) {
      return WorkOrderDetailRoute(workOrderId: WorkOrderId(id));
    }
    return const WorkshopRoute();
  }

  // 5. An inspection notification that is not a decision on your own work is
  //    somebody asking you to SIGN.
  if (entity.contains('inspection')) {
    return id == null
        ? const InspectionApprovalsRoute()
        : InspectionApprovalReviewRoute(inspectionId: InspectionId(id));
  }

  // 6. Accidents. A claim id is not an accident id, so a claim opens the
  //    register rather than a detail screen that would not find it.
  if (entity.contains('accident') || entity.contains('incident')) {
    return id == null
        ? const AccidentDashboardRoute()
        : AccidentDetailRoute(accidentId: AccidentId(id));
  }
  if (entity.contains('claim')) return const AccidentDashboardRoute();

  if (entity.contains('alert')) return const AlertsRoute();

  return null;
}
