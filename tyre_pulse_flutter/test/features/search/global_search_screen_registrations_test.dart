/// Tests `globalSearchScreenRegistrations` and `GlobalSearchRoute`.
library;

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/features/search/global_search_screen_registrations.dart';
import 'package:tyre_pulse/features/search/presentation/global_search_screen.dart';

class _FakeBuildContext extends Fake implements BuildContext {}

void main() {
  final BuildContext context = _FakeBuildContext();

  test('registers exactly the global search route', () {
    expect(globalSearchScreenRegistrations.keys, <String>[
      TpRouteId.globalSearch,
    ]);
  });

  test('a GlobalSearchRoute builds a GlobalSearchScreen carrying it', () {
    const GlobalSearchRoute route = GlobalSearchRoute(initialQuery: 'TM514');
    final Widget widget =
        globalSearchScreenRegistrations[TpRouteId.globalSearch]!(
      context,
      route,
    );
    expect(widget, isA<GlobalSearchScreen>());
    expect((widget as GlobalSearchScreen).route, route);
  });

  test('a mismatched route degrades to the placeholder, not a throw', () {
    final Widget widget =
        globalSearchScreenRegistrations[TpRouteId.globalSearch]!(
      context,
      const HomeRoute(),
    );
    expect(widget, isNot(isA<GlobalSearchScreen>()));
  });

  test('search is behind the serial module, not open to every session', () {
    expect(
      TpRouteGuards.byRouteId[TpRouteId.globalSearch],
      isA<ModuleGuarded>(),
    );
  });

  group('GlobalSearchRoute', () {
    test('routeId and path are the registered ones', () {
      expect(const GlobalSearchRoute().routeId, TpRouteId.globalSearch);
      expect(const GlobalSearchRoute().location, '/search');
    });

    test('location carries the query term when present', () {
      expect(
        const GlobalSearchRoute(initialQuery: 'TM514').location,
        '/search?q=TM514',
      );
    });

    test('equal routes compare equal', () {
      expect(
        const GlobalSearchRoute(initialQuery: 'a'),
        const GlobalSearchRoute(initialQuery: 'a'),
      );
    });
  });
}
