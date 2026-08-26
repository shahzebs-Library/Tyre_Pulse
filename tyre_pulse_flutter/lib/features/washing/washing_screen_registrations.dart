/// Every screen this feature contributes to the shared screen registry.
///
/// Mirrors `features/meter_logs/meter_logs_screen_registrations.dart`'s own
/// shape exactly - see that file's library comment for the full reasoning.
///
/// Registers [TpRouteId.washing]. The route id, its path template
/// (`/washing`) and its shell branch already exist in
/// `app/router/routes.dart` / `app/router/app_router.dart` /
/// `app/router/shell_tabs.dart` - branch index 5, guarded by
/// `ModuleGuarded(RouteModule.washing)` - none of those files needed a
/// change for this feature to register its screen.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/washing/presentation/washing_screen.dart';

/// The routes this feature builds a screen for.
final Map<String, TpScreenBuilder> washingScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.washing: _buildWashingScreen,
};

/// See `meter_logs_screen_registrations.dart`'s own
/// `_buildMeterLogScreen` for why this guard exists.
Widget _buildWashingScreen(BuildContext context, TpRoute route) {
  if (route is! WashingRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return WashingScreen(route: route);
}
