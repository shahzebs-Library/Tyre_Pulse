/// The router, end to end.
///
/// Two behaviours are pinned here that cannot be tested any other way, and both
/// are defects the product owner reported:
///
/// 1. A REFUSAL IS NOT A SPINNER, and it does not navigate away. The production
///    test is called `deniedIsNotASpinner`; the guard used to call
///    `router.replace('/')` and throw the user back to Home with no
///    explanation.
/// 2. BACK RETURNS TO WHERE THE USER CAME FROM. In the Expo app every Back
///    press landed on Home, reported three times.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/app_router.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/app/router/session.dart';
import 'package:tyre_pulse/app/router/tp_back.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

/// Allows everything except the named modules.
class FakeResolver implements ModuleAccessResolver {
  const FakeResolver({this.denied = const <String>{}});

  final Set<String> denied;

  @override
  ModuleAccessDecision decide(RouteGuard guard) {
    return switch (guard) {
      PublicRoute() => const ModuleAccessAllowed(),
      AuthenticatedOnly() => const ModuleAccessAllowed(),
      ModuleGuarded(module: final RouteModule module) =>
        denied.contains(module.value)
            ? const ModuleAccessDenied(ModuleDenialReason.notGranted)
            : const ModuleAccessAllowed(),
      AdminOnly() => const ModuleAccessAllowed(),
      SuperAdminOnly() => const ModuleAccessAllowed(),
    };
  }
}

/// Every screen renders its own route id, so a test can name where it is.
TpScreenRegistry idRegistry() {
  Widget build(BuildContext context, TpRoute route) {
    return Scaffold(body: Center(child: Text(route.routeId)));
  }

  return TpScreenRegistry(<String, TpScreenBuilder>{
    for (final String id in <String>[
      TpRouteId.login,
      TpRouteId.register,
      TpRouteId.home,
      TpRouteId.tyreRecords,
      TpRouteId.tyreChange,
      TpRouteId.scanner,
      TpRouteId.activityHistory,
      TpRouteId.inspectionDetail,
      TpRouteId.newInspection,
      TpRouteId.meterLog,
      TpRouteId.accidentDashboard,
      TpRouteId.accidentDetail,
      TpRouteId.accidentCase,
      TpRouteId.profile,
      TpRouteId.workOrders,
      TpRouteId.workOrderDetail,
      TpRouteId.workshop,
    ])
      id: build,
  });
}

String locationOf(GoRouter router) =>
    router.routerDelegate.currentConfiguration.uri.toString();

Future<GoRouter> pumpApp(
  WidgetTester tester, {
  required TpSession session,
  ModuleAccessResolver resolver = const FakeResolver(),
  bool settle = true,
}) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      sessionProvider.overrideWith((Ref ref) => session),
      moduleAccessResolverProvider.overrideWith((Ref ref) => resolver),
      screenRegistryProvider.overrideWith((Ref ref) => idRegistry()),
    ],
  );
  addTearDown(container.dispose);

  final GoRouter router = container.read(routerProvider);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(
        routerConfig: router,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        theme: TpTheme.light,
      ),
    ),
  );

  // A spinner never settles, so a screen that shows one is pumped once.
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
  return router;
}

void main() {
  group('a refusal explains itself', () {
    testWidgets('denied is not a spinner', (WidgetTester tester) async {
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedIn(),
        resolver: const FakeResolver(denied: <String>{'records'}),
      );

      router.go(TpRoutePaths.tyreRecords);
      await tester.pumpAndSettle();

      expect(find.byKey(TpStateKeys.permissionDenied), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      // The screen behind the guard must not have been built.
      expect(find.text(TpRouteId.tyreRecords), findsNothing);
    });

    testWidgets('a refusal carries a reason a person can read', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedIn(),
        resolver: const FakeResolver(denied: <String>{'records'}),
      );

      router.go(TpRoutePaths.tyreRecords);
      await tester.pumpAndSettle();

      expect(
        find.text(
          'You do not have access to this module. Contact your administrator.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('a refusal does NOT navigate away', (
      WidgetTester tester,
    ) async {
      // The guard used to call replace('/'). A screen that vanishes and dumps
      // you on the main page reads as the app malfunctioning, not as a
      // permission boundary.
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedIn(),
        resolver: const FakeResolver(denied: <String>{'records'}),
      );

      router.go(TpRoutePaths.tyreRecords);
      await tester.pumpAndSettle();

      expect(locationOf(router), TpRoutePaths.tyreRecords);
    });

    testWidgets('an allowed route renders its screen', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedIn(),
      );

      router.go(TpRoutePaths.tyreRecords);
      await tester.pumpAndSettle();

      expect(find.text(TpRouteId.tyreRecords), findsOneWidget);
      expect(find.byKey(TpStateKeys.permissionDenied), findsNothing);
    });
  });

  group('back returns to where the user came from', () {
    testWidgets('a pushed detail pops back to the list, not to Home', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedIn(),
      );

      router.go(TpRoutePaths.activityHistory);
      await tester.pumpAndSettle();
      expect(find.text(TpRouteId.activityHistory), findsOneWidget);

      router.push(
        const InspectionDetailRoute(inspectionId: InspectionId('i-1')).location,
      );
      await tester.pumpAndSettle();
      expect(find.text(TpRouteId.inspectionDetail), findsOneWidget);

      final BackOutcome outcome = backTo(GoRouterBackAdapter(router));
      await tester.pumpAndSettle();

      expect(outcome, BackOutcome.popped);
      expect(locationOf(router), TpRoutePaths.activityHistory);
      expect(locationOf(router), isNot(TpRoutePaths.home));
    });

    testWidgets('scanner to inspection pops back to the scanner', (
      WidgetTester tester,
    ) async {
      // Spec section 5 draws this journey: Search, Vehicle, Inspection, and
      // Back must give Inspection, Scanner - not Inspection, Home. The push
      // stays in the branch the task started in.
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedIn(),
      );

      router.go(TpRoutePaths.scanner);
      await tester.pumpAndSettle();

      router.push(const NewInspectionRoute(assetNo: AssetNo('TM514')).location);
      await tester.pumpAndSettle();
      expect(find.text(TpRouteId.newInspection), findsOneWidget);

      backTo(GoRouterBackAdapter(router));
      await tester.pumpAndSettle();

      expect(locationOf(router), TpRoutePaths.scanner);
    });

    testWidgets('an accident case pops back to its own accident', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedIn(),
      );

      router.go(
        const AccidentCaseRoute(accidentId: AccidentId('acc-1')).location,
      );
      await tester.pumpAndSettle();
      expect(find.text(TpRouteId.accidentCase), findsOneWidget);

      // `go` to a nested route builds the whole stack, so there IS history and
      // the pop lands on the accident rather than on the register.
      final BackOutcome outcome = backTo(GoRouterBackAdapter(router));
      await tester.pumpAndSettle();

      expect(outcome, BackOutcome.popped);
      expect(locationOf(router), '/accidents/acc-1');
    });

    testWidgets('with no history at all, Back uses the fallback', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedIn(),
      );

      // `go` replaces the branch stack, which is the shape a deep link or a
      // notification tap produces.
      router.go(TpRoutePaths.tyreChange);
      await tester.pumpAndSettle();

      final BackOutcome outcome = backTo(
        GoRouterBackAdapter(router),
        fallback: TpBackFallbacks.forRoute(const TyreChangeRoute()),
      );
      await tester.pumpAndSettle();

      expect(outcome, BackOutcome.replaced);
      expect(locationOf(router), TpRoutePaths.home);
    });
  });

  group('the session gate', () {
    testWidgets('signed out lands on sign in', (WidgetTester tester) async {
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedOut(),
      );

      expect(locationOf(router), startsWith(TpRoutePaths.login));
    });

    testWidgets('a deep link survives the sign in gate', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedOut(),
      );

      router.go(TpRoutePaths.meterLog);
      await tester.pumpAndSettle();

      expect(locationOf(router), startsWith(TpRoutePaths.login));
      expect(locationOf(router), contains('from='));
      expect(
        Uri.parse(locationOf(router)).queryParameters['from'],
        TpRoutePaths.meterLog,
      );
    });

    testWidgets('signing in resumes the remembered destination', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedIn(),
      );

      router.go('${TpRoutePaths.login}?from=${TpRoutePaths.meterLog}');
      await tester.pumpAndSettle();

      expect(locationOf(router), TpRoutePaths.meterLog);
    });

    testWidgets('a hostile from target is ignored, not followed', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedIn(),
      );

      router.go(
        '${TpRoutePaths.login}?from=${Uri.encodeQueryComponent('https://evil.example')}',
      );
      await tester.pumpAndSettle();

      expect(locationOf(router), TpRoutePaths.home);
    });

    testWidgets('a session still resolving holds on the boot screen', (
      WidgetTester tester,
    ) async {
      // Deciding anything on a half-read session denies every role, admin
      // included.
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.resolving(),
        settle: false,
      );

      expect(locationOf(router), startsWith(TpRoutePaths.boot));
      expect(find.byKey(TpStateKeys.loading), findsOneWidget);
    });

    testWidgets('a timed out session is a third state, not a spinner', (
      WidgetTester tester,
    ) async {
      // Artifact 03 section 1.1: the keystore read stalls on low-end hardware
      // and this screen used to spin forever.
      await pumpApp(tester, session: const TpSession.timedOut());

      expect(find.text('This is taking longer than usual'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });
  });

  group('the shell gates run before the tabs', () {
    testWidgets('an update requirement blocks the whole app', (
      WidgetTester tester,
    ) async {
      await pumpApp(
        tester,
        session: const TpSession.signedIn(gate: TpShellGate.updateRequired),
      );

      expect(find.text('Update required'), findsOneWidget);
      // No tab bar behind it, and no screen.
      expect(find.text(TpRouteId.home), findsNothing);
    });

    testWidgets('a deep link cannot skip a shell gate', (
      WidgetTester tester,
    ) async {
      // The gates are states rather than routes precisely so this is true.
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedIn(gate: TpShellGate.accessBlocked),
      );

      router.go(TpRoutePaths.meterLog);
      await tester.pumpAndSettle();

      expect(find.text('Your account is not active'), findsOneWidget);
      expect(find.text(TpRouteId.meterLog), findsNothing);
    });

    testWidgets('a profile failure fails closed', (WidgetTester tester) async {
      await pumpApp(
        tester,
        session: const TpSession.signedIn(gate: TpShellGate.profileUnavailable),
      );

      expect(find.text('We could not load your profile'), findsOneWidget);
    });
  });

  group('a route that does not exist', () {
    testWidgets('renders an explanation, not a developer error page', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedIn(),
      );

      router.go('/a-screen-that-was-never-built');
      await tester.pumpAndSettle();

      expect(find.text('That screen does not exist'), findsOneWidget);
    });
  });

  group('an unregistered screen says so', () {
    testWidgets('a route with no screen renders the not-built state', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await pumpApp(
        tester,
        session: const TpSession.signedIn(),
      );

      // `/alerts` is a real, allowed route with no screen in the test registry.
      router.go(TpRoutePaths.alerts);
      await tester.pumpAndSettle();

      expect(find.byKey(TpStateKeys.screenNotAvailable), findsOneWidget);
      // Distinguishable from a refusal and from an empty list.
      expect(find.byKey(TpStateKeys.permissionDenied), findsNothing);
      expect(find.byKey(TpStateKeys.empty), findsNothing);
    });
  });
}
