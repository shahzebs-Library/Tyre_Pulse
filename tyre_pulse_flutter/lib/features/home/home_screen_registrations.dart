/// Every screen this feature contributes to the shared screen registry.
///
/// Mirrors `features/washing/washing_screen_registrations.dart`'s own
/// shape exactly - see that file's library comment for the full reasoning.
/// Registers [TpRouteId.home]. The route id, its path template (`/home`)
/// and its shell branch already exist in `app/router/routes.dart` /
/// `app/router/app_router.dart` / `app/router/shell_tabs.dart` - branch 0,
/// guarded by `AuthenticatedOnly()` - none of those files needed a change
/// for this feature to register its screen. See
/// `presentation/home_screen.dart`'s own library comment for why this
/// screen is a deliberately minimal stopgap rather than a finished Home
/// hub.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/home/presentation/home_screen.dart';

/// The routes this feature builds a screen for.
final Map<String, TpScreenBuilder> homeScreenRegistrations =
    <String, TpScreenBuilder>{TpRouteId.home: _buildHomeScreen};

/// See `meter_logs_screen_registrations.dart`'s own
/// `_buildMeterLogScreen` for why this guard exists.
Widget _buildHomeScreen(BuildContext context, TpRoute route) {
  if (route is! HomeRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return HomeScreen(route: route);
}
