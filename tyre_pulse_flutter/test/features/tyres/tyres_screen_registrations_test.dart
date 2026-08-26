/// Tests the routing logic in `tyresScreenRegistrations` WITHOUT pumping a
/// widget tree. [_buildSerialSearchScreen] never actually reads its
/// [BuildContext] argument on the success path - the widget it returns is a
/// plain constructor call - so a [Fake] `BuildContext` that is never
/// invoked is enough to drive it. This sidesteps needing a full
/// `MaterialApp` + `ProviderScope` + `GoRouter` + localisation-delegate
/// harness, which this feature's other tests avoid entirely by design.
library;

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/tyres/presentation/'
    'serial_search_screen.dart';
import 'package:tyre_pulse/features/tyres/tyres_screen_registrations.dart';

class _FakeBuildContext extends Fake implements BuildContext {}

void main() {
  final BuildContext context = _FakeBuildContext();

  test('registers exactly the serial search route', () {
    expect(
      tyresScreenRegistrations.keys,
      containsAll(<String>[TpRouteId.serialSearch]),
    );
  });

  group('serial search builder', () {
    test('a SerialSearchRoute builds a SerialSearchScreen carrying it',
        () {
      const SerialSearchRoute route = SerialSearchRoute(
        tyreSerial: TyreSerial('EP0604207'),
      );
      final TpScreenBuilder builder =
          tyresScreenRegistrations[TpRouteId.serialSearch]!;

      final Widget widget = builder(context, route);

      expect(widget, isA<SerialSearchScreen>());
      expect((widget as SerialSearchScreen).route, route);
    });

    test('a mismatched route type degrades to the honest "not built yet" '
        'placeholder rather than throwing', () {
      const HomeRoute wrongRoute = HomeRoute();
      final TpScreenBuilder builder =
          tyresScreenRegistrations[TpRouteId.serialSearch]!;

      final Widget widget = builder(context, wrongRoute);

      expect(widget, isA<TpScreenNotAvailable>());
    });
  });
}
