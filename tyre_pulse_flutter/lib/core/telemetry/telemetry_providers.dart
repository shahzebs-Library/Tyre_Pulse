/// Riverpod wiring for telemetry.
///
/// This is the only file in `core/telemetry` that imports Riverpod. Everything
/// that decides what gets sent, when, and how it is sanitised lives in
/// `telemetry_service.dart`, which this only assembles.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_navigator_observer.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_reporter.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_service.dart';

/// The active [TelemetryReporter] for the running app.
///
/// Defaults to a freshly constructed, INACTIVE [TelemetryService] rather than
/// throwing until overridden - a deliberate departure from the pattern
/// `workspaceDependenciesProvider` uses. An inactive reporter is a genuinely
/// safe default: every capture method on it is a no-op. Telemetry's whole
/// purpose is to never be the reason the app breaks, and a provider that
/// throws before the composition root remembers to override it would do
/// exactly that to any early screen that tries to report through it.
///
/// **Should still be overridden at the composition root**, with the SAME
/// [TelemetryService] instance that had [TelemetryService.initialize] called
/// on it - and that had `FlutterError.onError` and
/// `PlatformDispatcher.instance.onError` assigned to its
/// `reportFlutterError` and `reportPlatformDispatcherError` methods - in
/// `main()`, before `runApp`:
/// ```dart
/// final telemetry = TelemetryService();
/// await telemetry.initialize(config: config);
/// FlutterError.onError = telemetry.reportFlutterError;
/// PlatformDispatcher.instance.onError = telemetry.reportPlatformDispatcherError;
/// runApp(
///   ProviderScope(
///     overrides: [telemetryReporterProvider.overrideWithValue(telemetry)],
///     child: const TyrePulseApp(),
///   ),
/// );
/// ```
/// Without that override, telemetry stays inactive for the whole app even on
/// a build that has a DSN - the fallback is safe, not silently correct.
final Provider<TelemetryReporter> telemetryReporterProvider =
    Provider<TelemetryReporter>((ref) => TelemetryService());

/// The navigator observer that tags every subsequently captured event with
/// the active route, and gives Sentry its screen-performance instrumentation.
///
/// Add the value this exposes to the router's `observers` list. It reads
/// [telemetryReporterProvider], so it automatically follows whatever reporter
/// is active - including the override installed at the composition root.
final Provider<TelemetryNavigatorObserver> telemetryNavigatorObserverProvider =
    Provider<TelemetryNavigatorObserver>(
      (ref) => TelemetryNavigatorObserver(
        reporter: ref.watch(telemetryReporterProvider),
      ),
    );
