/// The router.
///
/// One `StatefulShellRoute.indexedStack` with nine branches, per artifact 03
/// section 2.4. Each branch owns a Navigator, which is what gives per-tab
/// history for free - the thing the Expo tab navigator had to be coerced into
/// with `backBehavior="history"` after three partial fixes.
///
/// TWO RULES THIS FILE EXISTS TO HOLD:
///
/// 1. THE REDIRECT DECIDES SESSION, NEVER ACCESS. A redirect that returns
///    `/home` for a denied route makes the screen vanish and dumps the user on
///    the main page with no explanation. That was reported twice. Access is
///    decided in the route's builder by `TpModuleGuard`, which renders the
///    refusal in place.
/// 2. A PUSH THAT CONTINUES A TASK STAYS IN ITS BRANCH. Scanner to inspection
///    is a push inside the branch the scan started in, so popping returns to
///    the scanner. Only a bar tap switches branch. Pushing into the `inspect`
///    branch instead would cross branches and the scanner would be gone.
///
/// STATE RESTORATION IS DELIBERATELY OFF. Spec section 5 lists it and artifact
/// 03 section 6.2 says what may and may not be restored: not `/scan` (the
/// camera must be consented to again), not the shell gates (they must
/// re-evaluate against the live profile), and not an approval review screen (the
/// row may have been decided by somebody else while the app was dead, and
/// reopening it presents a stale decision as actionable). GoRouter's
/// `restorationScopeId` restores a location wholesale and cannot express those
/// exclusions, so turning it on today would restore exactly the three things
/// that must not be. See [kRestorationScopeId] for where it goes when the
/// screens exist to make the exclusion real.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/router/app_shell.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/deep_links.dart';
import 'package:tyre_pulse/app/router/module_guard.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/app/router/session.dart';
import 'package:tyre_pulse/app/router/shell_gates.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_navigator_observer.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_providers.dart';

/// Reserved. See the library comment: restoration is off until the exclusion
/// list in artifact 03 section 6.2 can be honoured.
const String kRestorationScopeId = 'tp_router';

/// The application router.
final Provider<GoRouter> routerProvider = Provider<GoRouter>((ref) {
  final _RouterRefresh refresh = _RouterRefresh();
  ref.onDispose(refresh.dispose);

  // The redirect reads the session, so the router has to re-run it when the
  // session changes. `listen` rather than `watch`: watching would rebuild the
  // provider and construct a NEW GoRouter on every sign in, throwing away the
  // navigation stack.
  ref.listen<TpSession>(
    sessionProvider,
    (TpSession? previous, TpSession next) => refresh.bump(),
  );

  final TelemetryNavigatorObserver telemetryObserver =
      ref.watch(telemetryNavigatorObserverProvider);

  final GoRouter router = GoRouter(
    initialLocation: TpRoutePaths.boot,
    refreshListenable: refresh,
    redirect: (BuildContext context, GoRouterState state) =>
        resolveRedirect(session: ref.read(sessionProvider), state: state),
    errorBuilder: (BuildContext context, GoRouterState state) =>
        TpRouteNotFoundScreen(
      attemptedLocation: state.uri.toString(),
      onGoHome: () => context.go(TpRoutePaths.home),
    ),
    // Tags every subsequently captured telemetry event with the active
    // route. See `telemetry_navigator_observer.dart`: never construct a
    // second one elsewhere, this is the only place a `GoRouter` is built.
    observers: <NavigatorObserver>[telemetryObserver],
    routes: _buildRoutes(),
  );
  ref.onDispose(router.dispose);

  return router;
});

/// The session half of routing, extracted so it can be tested without a router.
///
/// Returns the location to go to, or null to stay put.
///
/// The `from` parameter is how a deep link survives a gate: the requested
/// location is carried on the query string rather than stored in a provider,
/// because a redirect runs during route parsing and mutating state there
/// throws.
@visibleForTesting
String? resolveRedirect({
  required TpSession session,
  required GoRouterState state,
}) {
  final String location = state.matchedLocation;
  final String requested = state.uri.toString();
  final bool isBoot = location == TpRoutePaths.boot;
  final bool isLoginOrRegister =
      location == TpRoutePaths.login || location == TpRoutePaths.register;
  final bool isPublic = isBoot || isLoginOrRegister;

  switch (session.phase) {
    // Hold. Deciding anything on a half-read session denies every role,
    // including admin, on a cold start or a deep link.
    case TpSessionPhase.resolving:
    case TpSessionPhase.timedOut:
      if (isBoot) return null;
      return BootRoute(from: sanitizeInternalLocation(requested)).location;

    case TpSessionPhase.signedOut:
      // Deliberately NOT `isPublic`: /boot is only a safe place to sit
      // while the session is still being resolved (the branch above). Once
      // it has resolved to signedOut, staying there parks the router on
      // the boot screen forever with no further redirect ever fired -
      // only login/register are genuine public destinations to remain at.
      if (isLoginOrRegister) return null;
      return LoginRoute(from: sanitizeInternalLocation(requested)).location;

    case TpSessionPhase.signedIn:
      if (!isPublic) return null;
      final String? from = _resumableTarget(state);
      return from ?? TpRoutePaths.home;
  }
}

/// The location a user was heading for before a gate interrupted them.
///
/// Returns null for anything that is not a safe internal location, and for a
/// target that is itself a public route - resuming to `/login` after signing in
/// would loop.
String? _resumableTarget(GoRouterState state) {
  final String? raw = state.uri.queryParameters[TpRoutePaths.qFrom];
  final String? safe = sanitizeInternalLocation(raw);
  if (safe == null) return null;

  final String path = Uri.parse(safe).path;
  if (path == TpRoutePaths.boot ||
      path == TpRoutePaths.login ||
      path == TpRoutePaths.register) {
    return null;
  }
  return safe;
}

/// Notifies GoRouter that the redirect should run again.
class _RouterRefresh extends ChangeNotifier {
  void bump() => notifyListeners();
}

// ---------------------------------------------------------------------------
// Route tree
// ---------------------------------------------------------------------------

TpRouteParameters _paramsOf(GoRouterState state) => TpRouteParameters(
      path: state.pathParameters,
      query: state.uri.queryParameters,
    );

/// Declares one route.
///
/// The route id is used as the GoRoute name AND as the key into both the guard
/// table and the screen registry, so those three cannot disagree about which
/// route is which.
GoRoute _route(
  String path,
  String routeId,
  TpRoute Function(TpRouteParameters params) parse, {
  List<RouteBase> routes = const <RouteBase>[],
}) {
  return GoRoute(
    path: path,
    name: routeId,
    builder: (BuildContext context, GoRouterState state) =>
        _GuardedScreen(route: parse(_paramsOf(state))),
    routes: routes,
  );
}

/// Renders a route: guard first, screen second.
class _GuardedScreen extends ConsumerWidget {
  const _GuardedScreen({required this.route});

  final TpRoute route;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpScreenRegistry registry = ref.watch(screenRegistryProvider);
    return TpModuleGuard(
      guard: TpRouteGuards.forRouteId(route.routeId),
      backFallback: TpBackFallbacks.forRoute(route),
      // A Builder so the screen is only BUILT when the guard admits it. A
      // refused screen must not run its build method at all.
      child: Builder(
        builder: (BuildContext inner) => registry.build(inner, route),
      ),
    );
  }
}

/// The boot decider. Three states, not two.
class _BootScreen extends ConsumerWidget {
  const _BootScreen();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpSession session = ref.watch(sessionProvider);
    if (session.phase == TpSessionPhase.timedOut) {
      return const TpSessionTimedOutScreen();
    }
    return const TpBootScreen();
  }
}

/// Builds the route tree.
///
/// A FUNCTION rather than a shared constant, and that matters: a
/// StatefulShellBranch creates its own navigator GlobalKey, and a GlobalKey may
/// only be in one widget tree at a time. Sharing one route list between two
/// GoRouter instances - which a test suite does every time it builds a second
/// router - would put the same keys in two trees.
List<RouteBase> _buildRoutes() => <RouteBase>[
      GoRoute(
        path: TpRoutePaths.boot,
        name: TpRouteId.boot,
        builder: (BuildContext context, GoRouterState state) =>
            const _BootScreen(),
      ),
      _route(TpRoutePaths.login, TpRouteId.login, LoginRoute.parse),
      _route(
        TpRoutePaths.register,
        TpRouteId.register,
        (TpRouteParameters _) => const RegisterRoute(),
      ),
      StatefulShellRoute.indexedStack(
        builder: (
          BuildContext context,
          GoRouterState state,
          StatefulNavigationShell navigationShell,
        ) =>
            TpAppShell(navigationShell: navigationShell),
        branches: <StatefulShellBranch>[
          // 0 - Home. Every pushed screen with no branch of its own lives here, so
          // a task started from Home returns to Home when it is popped.
          StatefulShellBranch(
            routes: <RouteBase>[
              _route(
                TpRoutePaths.home,
                TpRouteId.home,
                (TpRouteParameters _) => const HomeRoute(),
              ),
              _route(
                TpRoutePaths.notifications,
                TpRouteId.notifications,
                (TpRouteParameters _) => const NotificationsRoute(),
              ),
              _route(
                TpRoutePaths.scanner,
                TpRouteId.scanner,
                (TpRouteParameters _) => const ScannerRoute(),
              ),
              _route(
                TpRoutePaths.serialSearch,
                TpRouteId.serialSearch,
                SerialSearchRoute.parse,
              ),
              _route(
                TpRoutePaths.tyreRecords,
                TpRouteId.tyreRecords,
                (TpRouteParameters _) => const TyreRecordsRoute(),
              ),
              _route(
                TpRoutePaths.vehicles,
                TpRouteId.vehicles,
                VehiclesRoute.parse,
              ),
              _route(
                TpRoutePaths.alerts,
                TpRouteId.alerts,
                (TpRouteParameters _) => const AlertsRoute(),
              ),
              _route(
                TpRoutePaths.calendar,
                TpRouteId.calendar,
                (TpRouteParameters _) => const CalendarRoute(),
              ),
              _route(
                TpRoutePaths.overview,
                TpRouteId.overview,
                (TpRouteParameters _) => const OverviewRoute(),
              ),
              _route(
                TpRoutePaths.reports,
                TpRouteId.reports,
                (TpRouteParameters _) => const ReportsRoute(),
              ),
              _route(
                TpRoutePaths.analytics,
                TpRouteId.analytics,
                (TpRouteParameters _) => const AnalyticsRoute(),
              ),
              _route(
                TpRoutePaths.fleetAi,
                TpRouteId.fleetAi,
                (TpRouteParameters _) => const FleetAiRoute(),
              ),
              _route(
                TpRoutePaths.team,
                TpRouteId.team,
                (TpRouteParameters _) => const TeamRoute(),
              ),
              _route(
                TpRoutePaths.tyreChange,
                TpRouteId.tyreChange,
                TyreChangeRoute.parse,
              ),
              _route(
                TpRoutePaths.reportIssue,
                TpRouteId.reportIssue,
                ReportIssueRoute.parse,
              ),
              _route(
                TpRoutePaths.repairRequest,
                TpRouteId.repairRequest,
                RepairRequestRoute.parse,
              ),
              _route(TpRoutePaths.rca, TpRouteId.rca, RcaRoute.parse),
              _route(
                TpRoutePaths.stockCount,
                TpRouteId.stockCount,
                (TpRouteParameters _) => const StockCountRoute(),
              ),
              _route(
                TpRoutePaths.tasks,
                TpRouteId.tasks,
                (TpRouteParameters _) => const TasksRoute(),
              ),
              _route(
                TpRoutePaths.preventiveMaintenance,
                TpRouteId.preventiveMaintenance,
                (TpRouteParameters _) => const PreventiveMaintenanceRoute(),
              ),
              _route(
                TpRoutePaths.workOrders,
                TpRouteId.workOrders,
                (TpRouteParameters _) => const WorkOrdersRoute(),
                routes: <RouteBase>[
                  // Nested so a notification that pushes here stacks the list
                  // beneath it, and Back gives Work Order, Workshop, Home exactly
                  // as spec section 5 draws it.
                  _route(
                    ':${TpRoutePaths.pWorkOrderId}',
                    TpRouteId.workOrderDetail,
                    WorkOrderDetailRoute.parse,
                  ),
                ],
              ),
              _route(
                TpRoutePaths.workshop,
                TpRouteId.workshop,
                (TpRouteParameters _) => const WorkshopRoute(),
              ),
              _route(
                TpRoutePaths.adminConsole,
                TpRouteId.adminConsole,
                (TpRouteParameters _) => const AdminConsoleRoute(),
                routes: <RouteBase>[
                  _route(
                    'users',
                    TpRouteId.adminUsers,
                    (TpRouteParameters _) => const AdminUsersRoute(),
                  ),
                  _route(
                    'access',
                    TpRouteId.adminAccess,
                    (TpRouteParameters _) => const AdminAccessRoute(),
                  ),
                  _route(
                    'approvals',
                    TpRouteId.adminApprovals,
                    (TpRouteParameters _) => const AdminApprovalsRoute(),
                  ),
                  _route(
                    'sites',
                    TpRouteId.adminSites,
                    (TpRouteParameters _) => const AdminSitesRoute(),
                  ),
                  _route(
                    'ai-chat',
                    TpRouteId.adminAiChat,
                    (TpRouteParameters _) => const AdminAiChatRoute(),
                  ),
                ],
              ),
            ],
          ),

          // 1 - Inspect.
          StatefulShellBranch(
            routes: <RouteBase>[
              _route(
                TpRoutePaths.newInspection,
                TpRouteId.newInspection,
                NewInspectionRoute.parse,
              ),
            ],
          ),

          // 2 - Approvals. Both queues and both review screens, so opening a review
          // and pressing Back returns to its queue.
          StatefulShellBranch(
            routes: <RouteBase>[
              _route(
                TpRoutePaths.inspectionApprovals,
                TpRouteId.inspectionApprovals,
                (TpRouteParameters _) => const InspectionApprovalsRoute(),
                routes: <RouteBase>[
                  _route(
                    ':${TpRoutePaths.pInspectionId}',
                    TpRouteId.inspectionApprovalReview,
                    InspectionApprovalReviewRoute.parse,
                  ),
                ],
              ),
              _route(
                TpRoutePaths.checklistApprovals,
                TpRouteId.checklistApprovals,
                (TpRouteParameters _) => const ChecklistApprovalsRoute(),
                routes: <RouteBase>[
                  _route(
                    ':${TpRoutePaths.pSubmissionId}',
                    TpRouteId.checklistApprovalReview,
                    ChecklistApprovalReviewRoute.parse,
                  ),
                ],
              ),
            ],
          ),

          // 3 - Accidents.
          StatefulShellBranch(
            routes: <RouteBase>[
              _route(
                TpRoutePaths.accidentDashboard,
                TpRouteId.accidentDashboard,
                (TpRouteParameters _) => const AccidentDashboardRoute(),
                routes: <RouteBase>[
                  // DECLARATION ORDER MATTERS. `report` is a literal segment and
                  // would also match `:accidentId`; GoRouter takes the first
                  // matching route, so the literal must come first.
                  _route(
                    'report',
                    TpRouteId.accidentReport,
                    (TpRouteParameters _) => const AccidentReportRoute(),
                  ),
                  _route(
                    ':${TpRoutePaths.pAccidentId}',
                    TpRouteId.accidentDetail,
                    AccidentDetailRoute.parse,
                    routes: <RouteBase>[
                      // Nested under the accident, so Back returns to the accident
                      // rather than to the register. In production the same id is a
                      // path segment here and a query parameter there, and both are
                      // called `id`.
                      _route(
                        'case',
                        TpRouteId.accidentCase,
                        AccidentCaseRoute.parse,
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),

          // 4 - Meter.
          StatefulShellBranch(
            routes: <RouteBase>[
              _route(
                TpRoutePaths.meterLog,
                TpRouteId.meterLog,
                MeterLogRoute.parse,
              ),
            ],
          ),

          // 5 - Washing.
          StatefulShellBranch(
            routes: <RouteBase>[
              _route(
                TpRoutePaths.washing,
                TpRouteId.washing,
                (TpRouteParameters _) => const WashingRoute(),
              ),
            ],
          ),

          // 6 - History. A branch because History is the only screen that opens an
          // inspection detail, and Back from that detail must return to it.
          StatefulShellBranch(
            routes: <RouteBase>[
              _route(
                TpRoutePaths.activityHistory,
                TpRouteId.activityHistory,
                (TpRouteParameters _) => const ActivityHistoryRoute(),
                routes: <RouteBase>[
                  _route(
                    'inspection/:${TpRoutePaths.pInspectionId}',
                    TpRouteId.inspectionDetail,
                    InspectionDetailRoute.parse,
                  ),
                ],
              ),
            ],
          ),

          // 7 - Checklists.
          StatefulShellBranch(
            routes: <RouteBase>[
              _route(
                TpRoutePaths.checklists,
                TpRouteId.checklists,
                (TpRouteParameters _) => const ChecklistsRoute(),
                routes: <RouteBase>[
                  // Literal before parameter, as with `report` above.
                  _route(
                    'history',
                    TpRouteId.checklistHistory,
                    (TpRouteParameters _) => const ChecklistHistoryRoute(),
                  ),
                  _route(
                    ':${TpRoutePaths.pTemplateId}',
                    TpRouteId.checklistFill,
                    ChecklistFillRoute.parse,
                  ),
                ],
              ),
            ],
          ),

          // 8 - Profile. Carries the offline queue: sync, retry and clear.
          StatefulShellBranch(
            routes: <RouteBase>[
              _route(
                TpRoutePaths.profile,
                TpRouteId.profile,
                (TpRouteParameters _) => const ProfileRoute(),
              ),
            ],
          ),
        ],
      ),
    ];
