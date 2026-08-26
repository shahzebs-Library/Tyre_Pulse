/// Every screen this feature contributes to the shared screen registry.
///
/// Merged in at the composition root, alongside every other feature's own
/// map, exactly the way `features/inspections/inspections_screen_
/// registrations.dart` and `features/checklists/checklists_screen_
/// registrations.dart` already are - see `app/router/screen_registry.dart`
/// and those two files' own library comments, whose shape this mirrors
/// exactly. Deliberately the ONE file in this feature that the
/// router-owning layer needs to import; nothing else here is reached from
/// outside `features/approvals/`.
///
/// Registers the two route ids this feature builds a screen for:
/// [TpRouteId.inspectionApprovals] and [TpRouteId.inspectionApprovalReview].
/// Both routes, their path templates and their back-navigation fallbacks
/// already exist in `app/router/routes.dart` / `app/router/route_access.dart`
/// / `app/router/back_navigation.dart` - none of those files needed a
/// change for this feature to register its screens.
///
/// Checklist approvals ([TpRouteId.checklistApprovals] /
/// [TpRouteId.checklistApprovalReview]) are a SEPARATE, more complex flow
/// (a two-rung sign-off ladder, modelled in `domain/checklist_approval.
/// dart`) and are deliberately NOT registered here - this feature covers
/// inspection approvals only, a single-stage decision with no domain engine
/// of its own.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/approvals/presentation/'
    'inspection_approval_review_screen.dart';
import 'package:tyre_pulse/features/approvals/presentation/'
    'inspection_approvals_queue_screen.dart';

/// The routes this feature builds a screen for.
final Map<String, TpScreenBuilder> inspectionApprovalsScreenRegistrations =
    <String, TpScreenBuilder>{
      TpRouteId.inspectionApprovals: _buildInspectionApprovalsQueueScreen,
      TpRouteId.inspectionApprovalReview: _buildInspectionApprovalReviewScreen,
    };

/// Guards the cast from the router's typed [TpRoute] union down to
/// [InspectionApprovalsRoute]. The registry is keyed by
/// [TpRouteId.inspectionApprovals], so [route] should always already be an
/// [InspectionApprovalsRoute] by construction - but a screen builder that
/// assumes that with a bare cast turns a future wiring mistake elsewhere
/// into a crash here, rather than into the honest "not built yet"
/// placeholder the registry already has for exactly this situation.
Widget _buildInspectionApprovalsQueueScreen(
  BuildContext context,
  TpRoute route,
) {
  if (route is! InspectionApprovalsRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return InspectionApprovalsQueueScreen(route: route);
}

/// See [_buildInspectionApprovalsQueueScreen] - the same guard, for
/// [InspectionApprovalReviewRoute].
Widget _buildInspectionApprovalReviewScreen(
  BuildContext context,
  TpRoute route,
) {
  if (route is! InspectionApprovalReviewRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return InspectionApprovalReviewScreen(route: route);
}
