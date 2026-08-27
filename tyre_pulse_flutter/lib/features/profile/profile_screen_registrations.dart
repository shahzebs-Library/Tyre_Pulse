/// Every screen this feature contributes to the shared screen registry.
///
/// Mirrors `features/home/home_screen_registrations.dart`'s own shape
/// exactly - see that file's library comment for the full reasoning.
/// Registers [TpRouteId.profile]. The route id, its path template
/// (`/profile`) and its shell branch already exist in
/// `app/router/routes.dart` / `app/router/app_router.dart` /
/// `app/router/shell_tabs.dart` - branch 8, anchored, guarded by
/// `AuthenticatedOnly()` - none of those files needed a change for this
/// feature to register its screen. See `presentation/profile_screen.dart`'s
/// own library comment for why this screen exists and what it does.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/profile/presentation/profile_screen.dart';

/// The routes this feature builds a screen for.
final Map<String, TpScreenBuilder> profileScreenRegistrations =
    <String, TpScreenBuilder>{TpRouteId.profile: _buildProfileScreen};

/// See `meter_logs_screen_registrations.dart`'s own `_buildMeterLogScreen`
/// for why this guard exists.
Widget _buildProfileScreen(BuildContext context, TpRoute route) {
  if (route is! ProfileRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return ProfileScreen(route: route);
}
