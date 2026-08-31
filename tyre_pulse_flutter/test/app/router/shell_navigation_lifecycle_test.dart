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

TpScreenRegistry _lifecycleRegistry() {
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
      TpRouteId.accidentDashboard,
      TpRouteId.accidentReport,
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
      screenRegistryProvider.overrideWith(
        (Ref ref) => _lifecycleRegistry(),
      ),
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
  testWidgets(
    'accident branch can deactivate and reactivate without shell lifecycle errors',
    (WidgetTester tester) async {
      // Matches the branch churn from the attached-device failure: enter the
      // Accidents branch, push its report child, leave the branch, then return
      // to both the branch root and child. The shell must not leak inherited
      // dependants or duplicate navigator GlobalKeys while doing this.
      final (GoRouter router, ProviderContainer container) =
          await _pumpShell(tester);
      addTearDown(container.dispose);

      router.go(TpRoutePaths.accidentDashboard);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Profile'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(
        find.byKey(const ValueKey<String>(TpRouteId.profile)),
        findsOneWidget,
      );

      await tester.tap(find.text('Accidents'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      for (final String location in <String>[
        TpRoutePaths.accidentReport,
        TpRoutePaths.profile,
        TpRoutePaths.accidentDashboard,
        TpRoutePaths.accidentReport,
        TpRoutePaths.home,
        TpRoutePaths.accidentDashboard,
      ]) {
        router.go(location);
        await tester.pumpAndSettle();
        expect(
          tester.takeException(),
          isNull,
          reason: 'shell lifecycle error while navigating to $location',
        );
      }

      expect(
        find.byKey(const ValueKey<String>(TpRouteId.accidentDashboard)),
        findsOneWidget,
      );
    },
  );
}
