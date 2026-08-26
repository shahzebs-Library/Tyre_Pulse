/// Every screen this feature contributes to the shared screen registry.
///
/// Merged in at the composition root, alongside every other feature's own
/// map - see `app/router/screen_registry.dart` and
/// `features/approvals/inspection_approvals_screen_registrations.dart`'s own
/// library comment, whose shape this mirrors exactly. Deliberately the ONE
/// file in this feature that the router-owning layer needs to import;
/// nothing else here is reached from outside `features/meter_logs/`.
///
/// Registers [TpRouteId.meterLog]. The route id, its path template
/// (`/meter`) and its shell branch already exist in `app/router/routes.dart`
/// / `app/router/app_router.dart` / `app/router/shell_tabs.dart` - branch
/// index 4, guarded by `ModuleGuarded(RouteModule.meter)` - none of those
/// files needed a change for this feature to register its screen.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/meter_logs/presentation/meter_log_screen.dart';

/// The routes this feature builds a screen for.
final Map<String, TpScreenBuilder> meterLogsScreenRegistrations =
    <String, TpScreenBuilder>{TpRouteId.meterLog: _buildMeterLogScreen};

/// Guards the cast from the router's typed [TpRoute] union down to
/// [MeterLogRoute]. The registry is keyed by [TpRouteId.meterLog], so
/// [route] should always already be a [MeterLogRoute] by construction - but
/// a screen builder that assumes that with a bare cast turns a future wiring
/// mistake elsewhere into a crash here, rather than into the honest "not
/// built yet" placeholder the registry already has for exactly this
/// situation - mirrors
/// `inspection_approvals_screen_registrations.dart`'s own guard exactly.
Widget _buildMeterLogScreen(BuildContext context, TpRoute route) {
  if (route is! MeterLogRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return MeterLogScreen(route: route);
}
