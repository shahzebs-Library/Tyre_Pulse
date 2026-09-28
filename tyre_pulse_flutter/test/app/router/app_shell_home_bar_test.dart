/// The shared shell bar is Home's bottom navigation.
///
/// Owner decision for mock 07: Home no longer draws its own bar, so
/// `TpAppShell` must SHOW the shared bar (Home / Inspect / Approvals /
/// Accidents / Profile) on Home, and keep hiding it only on the full-screen
/// New Inspection flow, which owns a persistent Back/Next action row.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/app_router.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/app/router/session.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';

final class _AllowAllResolver implements ModuleAccessResolver {
  const _AllowAllResolver();

  @override
  ModuleAccessDecision decide(RouteGuard guard) => const ModuleAccessAllowed();
}

TpScreenRegistry _registry() {
  Widget screen(BuildContext context, TpRoute route) {
    return Scaffold(
      body: Center(
        child: Text(route.routeId, key: ValueKey<String>(route.routeId)),
      ),
    );
  }

  return TpScreenRegistry(<String, TpScreenBuilder>{
    for (final String routeId in <String>{
      TpRouteId.home,
      TpRouteId.newInspection,
      TpRouteId.inspectionApprovals,
      TpRouteId.accidentDashboard,
      TpRouteId.profile,
    })
      routeId: screen,
  });
}

Future<(GoRouter, ProviderContainer)> _pumpShell(WidgetTester tester) async {
  final ProviderContainer container = ProviderContainer(
    overrides: [
      sessionProvider.overrideWith((Ref ref) => const TpSession.signedIn()),
      moduleAccessResolverProvider.overrideWith(
        (Ref ref) => const _AllowAllResolver(),
      ),
      screenRegistryProvider.overrideWith((Ref ref) => _registry()),
    ],
  );
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
  await tester.pumpAndSettle();
  return (router, container);
}

void main() {
  testWidgets('Home shows the shared shell bar with its five destinations', (
    WidgetTester tester,
  ) async {
    final (GoRouter router, ProviderContainer container) =
        await _pumpShell(tester);
    addTearDown(container.dispose);

    router.go(TpRoutePaths.home);
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey<String>(TpRouteId.home)),
      findsOneWidget,
    );
    for (final String label in <String>[
      'Home',
      'Inspect',
      'Approvals',
      'Accidents',
      'Profile',
    ]) {
      expect(find.text(label), findsOneWidget, reason: '$label tab');
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('the New Inspection flow still owns its screen height', (
    WidgetTester tester,
  ) async {
    final (GoRouter router, ProviderContainer container) =
        await _pumpShell(tester);
    addTearDown(container.dispose);

    router.go(TpRoutePaths.newInspection);
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey<String>(TpRouteId.newInspection)),
      findsOneWidget,
    );
    expect(find.text('Profile'), findsNothing);
    expect(find.text('Accidents'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a shell tab tapped from Home switches branch', (
    WidgetTester tester,
  ) async {
    final (GoRouter router, ProviderContainer container) =
        await _pumpShell(tester);
    addTearDown(container.dispose);

    router.go(TpRoutePaths.home);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Profile'));
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey<String>(TpRouteId.profile)),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
