import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_navigator_observer.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_service.dart';

/// A route with the given name, cheap to construct without pushing it into a
/// real Navigator - all this suite needs is `route.settings.name`.
Route<void> _routeNamed(String? name) => MaterialPageRoute<void>(
      settings: RouteSettings(name: name),
      builder: (_) => const SizedBox.shrink(),
    );

void main() {
  Map<String, String>? capturedTags;
  late TelemetryService service;
  late TelemetryNavigatorObserver observer;

  setUp(() {
    capturedTags = null;
    service = TelemetryService.forTesting(
      capture: (exception, {required tags, stackTrace}) async {
        capturedTags = tags;
      },
    );
    observer = TelemetryNavigatorObserver(reporter: service);
  });

  Future<void> captureAndReadRoute() async {
    await service.captureAppError(
      const AppError(kind: AppErrorKind.unknown, message: 'x'),
    );
  }

  test('didPush tags the reporter with the pushed route name', () async {
    observer.didPush(_routeNamed('InspectionDetail'), null);

    await captureAndReadRoute();

    expect(capturedTags!['route'], 'InspectionDetail');
  });

  test('didReplace tags the reporter with the new route name, not the old '
      'one', () async {
    observer.didPush(_routeNamed('Home'), null);
    observer.didReplace(
      newRoute: _routeNamed('WorkOrderList'),
      oldRoute: _routeNamed('Home'),
    );

    await captureAndReadRoute();

    expect(capturedTags!['route'], 'WorkOrderList');
  });

  test('didPop tags the reporter with the PREVIOUS route, since that is '
      'what is on screen once the pop completes', () async {
    observer.didPush(_routeNamed('Home'), null);
    observer.didPush(_routeNamed('InspectionDetail'), _routeNamed('Home'));
    observer.didPop(
      _routeNamed('InspectionDetail'),
      _routeNamed('Home'),
    );

    await captureAndReadRoute();

    expect(capturedTags!['route'], 'Home');
  });

  test('didRemove tags the reporter with the previous route, matching '
      'didPop', () async {
    observer.didRemove(
      _routeNamed('InspectionDetail'),
      _routeNamed('Home'),
    );

    await captureAndReadRoute();

    expect(capturedTags!['route'], 'Home');
  });

  test('a route with no name clears the tag rather than sending an empty '
      'one', () async {
    observer.didPush(_routeNamed('Home'), null);
    observer.didPush(_routeNamed(null), _routeNamed('Home'));

    await captureAndReadRoute();

    expect(capturedTags!.containsKey('route'), isFalse);
  });
}
