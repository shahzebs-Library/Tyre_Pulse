// Inventory deep links through the REAL router (guard, nesting, fallback).
// Complements inventory_routes_test.dart, which pins the route parsing.
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
import 'package:tyre_pulse/core/design_system/design_system.dart';

class _Resolver implements ModuleAccessResolver {
  const _Resolver({this.denied = const <String>{}});

  final Set<String> denied;

  @override
  ModuleAccessDecision decide(RouteGuard guard) => switch (guard) {
        ModuleGuarded(module: final RouteModule module) =>
          denied.contains(module.value)
              ? const ModuleAccessDenied(ModuleDenialReason.notGranted)
              : const ModuleAccessAllowed(),
        _ => const ModuleAccessAllowed(),
      };
}

/// Every screen renders its route id (and, for a count, the audit id).
TpScreenRegistry _registry() {
  Widget build(BuildContext context, TpRoute route) => Scaffold(
        body: Center(
          child: Text(
            route is InventoryCountRoute
                ? '${route.routeId}:${route.auditId}'
                : route.routeId,
          ),
        ),
      );
  return TpScreenRegistry(<String, TpScreenBuilder>{
    for (final String id in <String>[
      TpRouteId.login,
      TpRouteId.home,
      TpRouteId.stockCount,
      TpRouteId.inventoryAudits,
      TpRouteId.inventoryCount,
      TpRouteId.inventoryTransfers,
    ])
      id: build,
  });
}

Future<GoRouter> _pump(
  WidgetTester tester, {
  ModuleAccessResolver resolver = const _Resolver(),
}) async {
  final ProviderContainer container = ProviderContainer(
    overrides: [
      sessionProvider.overrideWith((Ref ref) => const TpSession.signedIn()),
      moduleAccessResolverProvider.overrideWith((Ref ref) => resolver),
      screenRegistryProvider.overrideWith((Ref ref) => _registry()),
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
  await tester.pumpAndSettle();
  return router;
}

void main() {
  const String id = '0b8a4c1e-2f3d-4a5b-9c6d-7e8f9a0b1c2d';

  testWidgets('a count deep link opens that audit when stock is granted',
      (WidgetTester tester) async {
    final GoRouter router = await _pump(tester);
    router.go('/stock/counts/$id');
    await tester.pumpAndSettle();
    expect(find.text('${TpRouteId.inventoryCount}:$id'), findsOneWidget);
  });

  testWidgets('the audit list and transfers resolve under /stock',
      (WidgetTester tester) async {
    final GoRouter router = await _pump(tester);
    router.go('/stock/counts');
    await tester.pumpAndSettle();
    expect(find.text(TpRouteId.inventoryAudits), findsOneWidget);
    router.go('/stock/transfers');
    await tester.pumpAndSettle();
    expect(find.text(TpRouteId.inventoryTransfers), findsOneWidget);
  });

  testWidgets('a non-uuid audit id falls back to the audit list',
      (WidgetTester tester) async {
    final GoRouter router = await _pump(tester);
    router.go('/stock/counts/not-a-uuid');
    await tester.pumpAndSettle();
    expect(find.text(TpRouteId.inventoryAudits), findsOneWidget);
    expect(
      find.textContaining('${TpRouteId.inventoryCount}:'),
      findsNothing,
    );
  });

  for (final String path in <String>[
    '/stock/counts',
    '/stock/counts/$id',
    '/stock/transfers',
  ]) {
    testWidgets('$path is refused without the stock module',
        (WidgetTester tester) async {
      final GoRouter router = await _pump(
        tester,
        resolver: const _Resolver(denied: <String>{'stock'}),
      );
      router.go(path);
      await tester.pumpAndSettle();
      expect(find.byKey(TpStateKeys.permissionDenied), findsOneWidget);
      expect(find.text(TpRouteId.inventoryAudits), findsNothing);
      expect(find.text(TpRouteId.inventoryTransfers), findsNothing);
      expect(find.textContaining('${TpRouteId.inventoryCount}:'), findsNothing);
    });
  }
}
