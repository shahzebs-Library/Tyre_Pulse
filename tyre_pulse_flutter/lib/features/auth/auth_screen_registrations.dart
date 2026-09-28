/// Every screen this feature contributes to the shared screen registry.
///
/// Mirrors `features/home/home_screen_registrations.dart`'s own shape
/// exactly - see that file's library comment for the full reasoning.
/// Registers [TpRouteId.login]. The route id, its path template (`/login`)
/// and its guard (`PublicRoute()`, in `app/router/route_access.dart`) already
/// exist in `app/router/routes.dart` / `app/router/app_router.dart` - none of
/// those files needed a change for this feature to register its screen.
///
/// Also registers [TpRouteId.register] (`/register`, `PublicRoute()`): the
/// self-registration screen, which shows the invite-only notice whenever the
/// administrator has closed registration.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/auth/presentation/login_screen.dart';
import 'package:tyre_pulse/features/auth/presentation/register_screen.dart';

/// The routes this feature builds a screen for.
final Map<String, TpScreenBuilder> authScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.login: _buildLoginScreen,
  TpRouteId.register: _buildRegisterScreen,
};

/// See `meter_logs_screen_registrations.dart`'s own `_buildMeterLogScreen`
/// for why this guard exists.
Widget _buildLoginScreen(BuildContext context, TpRoute route) {
  if (route is! LoginRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return LoginScreen(route: route);
}

Widget _buildRegisterScreen(BuildContext context, TpRoute route) {
  if (route is! RegisterRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return RegisterScreen(route: route);
}
