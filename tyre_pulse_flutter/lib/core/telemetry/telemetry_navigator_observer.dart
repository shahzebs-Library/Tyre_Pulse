/// Screen-performance and route tagging (spec section 59: "screen
/// performance" and "route").
///
/// [TelemetryNavigatorObserver] extends `SentryNavigatorObserver` rather than
/// re-exporting it. That keeps the router lane depending on `core/telemetry`
/// - a module it already needs for capturing errors - instead of reaching
/// into `package:sentry_flutter` directly for one extra widget. If the
/// vendor behind screen-performance instrumentation ever changed, only this
/// file would need to.
///
/// UNVERIFIED: `SentryNavigatorObserver`'s constructor was confirmed to exist
/// and to accept no arguments in this package's own usage example, but its
/// full set of optional named parameters in exactly sentry_flutter 9.27.0 was
/// not checked. This file deliberately calls `super()` with nothing, so it
/// cannot be wrong about a parameter it never names.
library;

import 'package:flutter/widgets.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_reporter.dart';

/// Add the VALUE this class exposes to the router's `observers` list. Do not
/// construct a second one elsewhere: every instance would tag the SAME
/// [TelemetryReporter] it is given, so a second observer would only mean
/// duplicate, harmless work, never a reason to have one.
///
/// Screen-performance instrumentation is entirely inherited from
/// `SentryNavigatorObserver` and none of it is overridden here. What this
/// class ADDS is calling [TelemetryReporter.setCurrentRoute] on every
/// navigation, so a later [TelemetryReporter.captureAppError] or
/// [TelemetryReporter.captureSupabaseFailure] call - which may happen from
/// anywhere, long after the navigation that led there - is tagged with where
/// the user actually was, without depending on Sentry's own ambient scope
/// state to have been set correctly.
final class TelemetryNavigatorObserver extends SentryNavigatorObserver {
  TelemetryNavigatorObserver({required TelemetryReporter reporter})
    : _reporter = reporter,
      super();

  final TelemetryReporter _reporter;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPush(route, previousRoute);
    _reporter.setCurrentRoute(route.settings.name);
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    super.didReplace(newRoute: newRoute, oldRoute: oldRoute);
    _reporter.setCurrentRoute(newRoute?.settings.name);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPop(route, previousRoute);
    // The popped route is gone; whatever sits beneath it is what the user is
    // looking at now.
    _reporter.setCurrentRoute(previousRoute?.settings.name);
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didRemove(route, previousRoute);
    _reporter.setCurrentRoute(previousRoute?.settings.name);
  }
}
