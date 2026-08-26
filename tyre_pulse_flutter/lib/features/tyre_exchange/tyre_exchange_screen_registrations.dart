/// Every screen this feature contributes to the shared screen registry.
///
/// Merged in at the composition root, alongside every other feature's own
/// map - see `app/router/screen_registry.dart` and
/// `features/washing/washing_screen_registrations.dart`'s own library
/// comment, whose shape this mirrors exactly. Deliberately the ONE file in
/// this feature that the router-owning layer needs to import; nothing else
/// here is reached from outside `features/tyre_exchange/`.
///
/// Registers [TpRouteId.tyreChange]. The route id, its path template
/// (`/tyre-change`) and its `TyreChangeRoute` class (carrying `assetNo`,
/// `siteName` and `tyrePosition` deep-link query parameters) already exist
/// in `app/router/routes.dart` / `app/router/app_router.dart` /
/// `app/router/route_access.dart` (guarded there as `ModuleGuarded
/// (RouteModule.tyreChange)`) - none of those files needed a change for
/// this feature to register its screen.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/tyre_exchange/presentation/tyre_replacement_screen.dart';

/// The routes this feature builds a screen for.
final Map<String, TpScreenBuilder> tyreExchangeScreenRegistrations =
    <String, TpScreenBuilder>{
      TpRouteId.tyreChange: _buildTyreReplacementScreen,
    };

/// Guards the cast from the router's typed [TpRoute] union down to
/// [TyreChangeRoute]. The registry is keyed by [TpRouteId.tyreChange], so
/// [route] should always already be a [TyreChangeRoute] by construction -
/// but a screen builder that assumes that with a bare cast turns a future
/// wiring mistake elsewhere into a crash here, rather than into the honest
/// "not built yet" placeholder the registry already has for exactly this
/// situation - mirrors `meter_logs_screen_registrations.dart`'s own guard
/// exactly.
Widget _buildTyreReplacementScreen(BuildContext context, TpRoute route) {
  if (route is! TyreChangeRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return TyreReplacementScreen(route: route);
}
