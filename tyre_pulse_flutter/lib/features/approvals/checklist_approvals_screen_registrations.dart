/// Every screen this feature contributes to the shared screen registry, for
/// the checklist-approvals flow specifically.
///
/// Merged in at the composition root, alongside every other feature's own
/// map - see `app/router/screen_registry.dart` and
/// `inspection_approvals_screen_registrations.dart`'s own library comment,
/// whose shape this mirrors exactly. Deliberately the ONE file this
/// sub-feature contributes for the router-owning layer to import; nothing
/// else under `features/approvals/` for the checklist side is reached from
/// outside this feature.
///
/// Registers the two route ids [TpRouteId.checklistApprovals] and
/// [TpRouteId.checklistApprovalReview]. Both routes, their path templates
/// and their back-navigation fallbacks already exist in
/// `app/router/routes.dart` / `app/router/route_access.dart` /
/// `app/router/back_navigation.dart` - none of those files needed a change
/// for this feature to register its screens.
///
/// This is a SEPARATE map from [inspectionApprovalsScreenRegistrations]
/// rather than one shared registration file, for the same reason that
/// file's own library comment gives for keeping checklist approvals out of
/// it: this is a distinct, more complex flow (a two-rung sign-off ladder,
/// modelled in `domain/checklist_approval.dart`) with its own data layer,
/// its own queue and its own pair of screens.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/approvals/presentation/'
    'checklist_approval_review_screen.dart';
import 'package:tyre_pulse/features/approvals/presentation/'
    'checklist_approvals_queue_screen.dart';

/// The routes this sub-feature builds a screen for.
final Map<String, TpScreenBuilder> checklistApprovalsScreenRegistrations =
    <String, TpScreenBuilder>{
      TpRouteId.checklistApprovals: _buildChecklistApprovalsQueueScreen,
      TpRouteId.checklistApprovalReview: _buildChecklistApprovalReviewScreen,
    };

/// Guards the cast from the router's typed [TpRoute] union down to
/// [ChecklistApprovalsRoute]. The registry is keyed by
/// [TpRouteId.checklistApprovals], so [route] should always already be a
/// [ChecklistApprovalsRoute] by construction - but a screen builder that
/// assumes that with a bare cast turns a future wiring mistake elsewhere
/// into a crash here, rather than into the honest "not built yet"
/// placeholder the registry already has for exactly this situation.
Widget _buildChecklistApprovalsQueueScreen(
  BuildContext context,
  TpRoute route,
) {
  if (route is! ChecklistApprovalsRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return ChecklistApprovalsQueueScreen(route: route);
}

/// See [_buildChecklistApprovalsQueueScreen] - the same guard, for
/// [ChecklistApprovalReviewRoute].
Widget _buildChecklistApprovalReviewScreen(
  BuildContext context,
  TpRoute route,
) {
  if (route is! ChecklistApprovalReviewRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return ChecklistApprovalReviewScreen(route: route);
}
