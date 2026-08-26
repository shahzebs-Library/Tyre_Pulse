/// Back navigation. The ONE way this application leaves a screen.
///
/// Spec section 5 and repository rule 15.
///
/// > Back means return to where the user actually came from.
///
/// And the corollary the production code enforces:
///
/// > A Back control can never be a dead press. With history it pops; without
/// > history it REPLACES to the screen's real parent.
///
/// WHY A BARE POP IS NOT ENOUGH. `mobile/lib/goBack.ts` states it plainly: a
/// bare `router.back()` does nothing at all when there is no history to pop -
/// after a deep link, after a push notification tap, after a replace, or on a
/// cold start straight into a route. The user presses Back and the screen does
/// not move. That is the defect the product owner reported on the Tyre Records
/// filters screen.
///
/// WHY THREE EARLIER FIXES MISSED IT. Each one tuned the FALLBACK, and the
/// fallback branch was never reached: the Expo tab router defaulted
/// `backBehavior` to `firstRoute`, so `canGoBack()` was true on every screen
/// and Back always popped to Home whatever the fallback said. In Flutter the
/// structural half is `StatefulShellRoute`, which gives each branch its own
/// Navigator and therefore its own real history. This function is the other
/// half.
///
/// This file imports no router package on purpose, so the rule is unit testable
/// in isolation. `tp_back.dart` adapts GoRouter onto [TpBackRouter].
library;

import 'package:tyre_pulse/app/router/routes.dart';

/// What [backTo] actually did. Returned so callers and tests can assert it,
/// exactly as the production helper does.
enum BackOutcome {
  /// There was history and it was popped.
  popped,

  /// There was no history, so the fallback was navigated to.
  replaced,

  /// No usable router was supplied. Nothing was called.
  unavailable,
}

/// The slice of a router this rule needs.
abstract interface class TpBackRouter {
  /// Whether there is history to pop.
  bool canPop();

  /// Pop one entry.
  void pop();

  /// Replace the current location. Deliberately a replace and not a push: the
  /// parent must not be stacked on top of the screen the user is leaving.
  void go(String location);
}

/// Leaves the current screen.
///
/// [fallback] is where to go when there is no history. Pass the screen's real
/// parent; the default is Home, which is right only for a top level screen.
///
/// A router that throws from [TpBackRouter.canPop] is treated as having NO
/// history, so the fallback is used rather than firing a call that does
/// nothing. A blank or whitespace-only fallback would navigate to nowhere, so
/// it degrades to Home.
BackOutcome backTo(
  TpBackRouter? router, {
  String fallback = TpRoutePaths.home,
}) {
  if (router == null) return BackOutcome.unavailable;

  bool hasHistory;
  try {
    hasHistory = router.canPop();
  } on Object {
    hasHistory = false;
  }

  if (hasHistory) {
    router.pop();
    return BackOutcome.popped;
  }

  final String target = fallback.trim().isEmpty
      ? TpRoutePaths.home
      : fallback.trim();
  router.go(target);
  return BackOutcome.replaced;
}

/// Where each screen goes when it has no history to pop.
///
/// Ported from the production fallback table (artifact 03 section 3.4). Three
/// entries encode a product decision and must survive:
///
/// - an inspection detail falls back to History, NOT to an inspection list,
///   because History is the only screen that opens one;
/// - an accident case names its OWN accident first and only degrades to the
///   register when it has no id;
/// - an admin sub page falls back to the admin console, not to Home.
abstract final class TpBackFallbacks {
  /// Fallbacks that are a fixed location.
  static const Map<String, String> byRouteId = <String, String>{
    // Checklists.
    TpRouteId.checklistFill: TpRoutePaths.checklists,
    TpRouteId.checklistHistory: TpRoutePaths.checklists,
    TpRouteId.checklistApprovals: TpRoutePaths.checklists,
    TpRouteId.checklistApprovalReview: TpRoutePaths.checklistApprovals,
    TpRouteId.checklists: TpRoutePaths.home,

    // Inspections.
    TpRouteId.inspectionDetail: TpRoutePaths.activityHistory,
    TpRouteId.inspectionApprovalReview: TpRoutePaths.inspectionApprovals,
    TpRouteId.inspectionApprovals: TpRoutePaths.home,
    TpRouteId.newInspection: TpRoutePaths.home,

    // Accidents. `accidentCase` is computed - see [forRoute].
    TpRouteId.accidentDetail: TpRoutePaths.accidentDashboard,
    TpRouteId.accidentReport: TpRoutePaths.accidentDashboard,

    // Work orders. New surface: spec section 5 draws Back as
    // Work Order, Workshop, Home, and the list is this screen's real parent.
    TpRouteId.workOrderDetail: TpRoutePaths.workOrders,

    // Admin sub pages.
    TpRouteId.adminAccess: TpRoutePaths.adminConsole,
    TpRouteId.adminAiChat: TpRoutePaths.adminConsole,
    TpRouteId.adminApprovals: TpRoutePaths.adminConsole,
    TpRouteId.adminSites: TpRoutePaths.adminConsole,
    TpRouteId.adminUsers: TpRoutePaths.adminConsole,
  };

  /// The fallback for [route].
  ///
  /// Takes the route rather than the id so a fallback can be derived from the
  /// route's own parameters. The accident case screen is the reason: it goes
  /// back to ITS accident, and only degrades to the register when it somehow
  /// has no id.
  static String forRoute(TpRoute route) {
    if (route is AccidentCaseRoute) {
      final AccidentId id = route.accidentId;
      if (id.isEmpty) return TpRoutePaths.accidentDashboard;
      return AccidentDetailRoute(accidentId: id).location;
    }
    return byRouteId[route.routeId] ?? TpRoutePaths.home;
  }
}
