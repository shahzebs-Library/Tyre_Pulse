/// Tests `globalSearchScreenRegistrations` and `GlobalSearchRoute`'s own
/// domain logic.
///
/// # Why the registration map has no entry to test
///
/// `TpScreenBuilder` is fixed as `Widget Function(BuildContext, TpRoute)`,
/// and `GlobalSearchRoute` cannot extend the sealed `TpRoute` from this
/// feature's own files (see `domain/global_search_route.dart`'s library
/// comment - confirmed by `flutter analyze`, not assumed:
/// `GlobalSearchRoute extends TpRoute` does not compile outside
/// `routes.dart`). So there is no builder this feature can register today
/// whose signature both satisfies `TpScreenBuilder` and does something real
/// with a `GlobalSearchRoute` - `globalSearchScreenRegistrations` is
/// genuinely empty, the same documented "nothing registered" state
/// `TpScreenRegistry.empty` already establishes as normal.
///
/// What IS real and worth testing here is `GlobalSearchRoute`'s own
/// standalone behaviour (routeId/location/parse/equality), since that
/// class is fully implemented and simply not yet reachable through the
/// router.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/search/domain/global_search_route.dart';
import 'package:tyre_pulse/features/search/global_search_screen_registrations.dart';

void main() {
  test('the registration map is empty, honestly, not accidentally', () {
    expect(globalSearchScreenRegistrations, isEmpty);
  });

  group('GlobalSearchRoute', () {
    test('routeId is stable regardless of the carried query', () {
      expect(
        const GlobalSearchRoute().routeId,
        const GlobalSearchRoute(initialQuery: 'TM514').routeId,
      );
    });

    test('location has no query string when initialQuery is absent', () {
      expect(const GlobalSearchRoute().location, isNot(contains('?')));
    });

    test('location carries the query term when present', () {
      expect(
        const GlobalSearchRoute(initialQuery: 'TM514').location,
        contains('q=TM514'),
      );
    });

    test('location omits the query key for an empty string', () {
      expect(
        const GlobalSearchRoute(initialQuery: '').location,
        isNot(contains('q=')),
      );
    });

    test('parse reads the q query parameter', () {
      final GlobalSearchRoute route = GlobalSearchRoute.parse(
        <String, String>{'q': 'TM514'},
      );
      expect(route.initialQuery, 'TM514');
    });

    test('parse treats a blank q as absent, matching the router convention',
        () {
      final GlobalSearchRoute route = GlobalSearchRoute.parse(
        <String, String>{'q': ''},
      );
      expect(route.initialQuery, isNull);
    });

    test('parse treats a missing q as absent', () {
      final GlobalSearchRoute route = GlobalSearchRoute.parse(
        <String, String>{},
      );
      expect(route.initialQuery, isNull);
    });

    test('two routes with the same query are equal', () {
      expect(
        const GlobalSearchRoute(initialQuery: 'TM514'),
        const GlobalSearchRoute(initialQuery: 'TM514'),
      );
    });

    test('two routes with different queries are not equal', () {
      expect(
        const GlobalSearchRoute(initialQuery: 'TM514'),
        isNot(const GlobalSearchRoute(initialQuery: 'BH021')),
      );
    });
  });
}
