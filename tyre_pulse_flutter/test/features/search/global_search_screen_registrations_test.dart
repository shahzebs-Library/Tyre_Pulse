/// Tests the routing logic in `globalSearchScreenRegistrations` WITHOUT
/// pumping a widget tree - mirrors
/// `features/tyres/tyres_screen_registrations_test.dart`'s own approach
/// exactly (see that file's library comment for the full reasoning:
/// [_buildGlobalSearchScreen] never actually reads its [BuildContext]
/// argument on the success path, so a [Fake] `BuildContext` that is never
/// invoked is enough to drive it).
///
/// The registration key asserted below is [GlobalSearchRoute]'s own
/// `.routeId`, NOT a `TpRouteId.globalSearch` constant - no such constant
/// exists yet, because the forbidden router files have not been wired for
/// this feature. See `domain/global_search_route.dart`'s own doc comment.
/// This test proves the registrations map is internally CONSISTENT with
/// that route class today; it cannot prove the map is reachable through the
/// real router, because it is not, yet.
library;

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/search/domain/global_search_route.dart';
import 'package:tyre_pulse/features/search/global_search_screen_registrations.dart';
import 'package:tyre_pulse/features/search/presentation/'
    'global_search_screen.dart';

class _FakeBuildContext extends Fake implements BuildContext {}

void main() {
  final BuildContext context = _FakeBuildContext();

  test(
      'registers exactly one route, keyed on GlobalSearchRoute\'s own '
      'routeId', () {
    expect(
      globalSearchScreenRegistrations.keys,
      containsAll(<String>[const GlobalSearchRoute().routeId]),
    );
    expect(globalSearchScreenRegistrations, hasLength(1));
  });

  group('the global search builder', () {
    test('a GlobalSearchRoute builds a GlobalSearchScreen carrying it', () {
      const GlobalSearchRoute route = GlobalSearchRoute(
        initialQuery: 'TM514',
      );
      final TpScreenBuilder builder =
          globalSearchScreenRegistrations[const GlobalSearchRoute().routeId]!;

      final Widget widget = builder(context, route);

      expect(widget, isA<GlobalSearchScreen>());
      expect((widget as GlobalSearchScreen).route, route);
    });

    test(
        'a mismatched route type degrades to the honest "not built yet" '
        'placeholder rather than throwing', () {
      const HomeRoute wrongRoute = HomeRoute();
      final TpScreenBuilder builder =
          globalSearchScreenRegistrations[const GlobalSearchRoute().routeId]!;

      final Widget widget = builder(context, wrongRoute);

      expect(widget, isA<TpScreenNotAvailable>());
    });
  });
}
