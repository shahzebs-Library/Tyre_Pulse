/// Every screen this feature contributes to the shared screen registry.
///
/// Merged in at the composition root, alongside every other feature's own
/// map, via
/// `screenRegistryProvider.overrideWithValue(TpScreenRegistry.empty
/// .withAll(tyresScreenRegistrations).withAll(...))` - see
/// `app/router/screen_registry.dart`. Deliberately the ONE file in this
/// feature that the router-owning layer needs to import; nothing else here
/// is reached from outside `features/tyres/`.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/tyres/presentation/'
    'serial_search_screen.dart';

/// The routes this feature builds a screen for.
final Map<String, TpScreenBuilder> tyresScreenRegistrations =
    <String, TpScreenBuilder>{TpRouteId.serialSearch: _buildSerialSearchScreen};

/// Guards the cast from the router's typed [TpRoute] union down to
/// [SerialSearchRoute]. The registry is keyed by [TpRouteId.serialSearch], so
/// [route] should always already be a [SerialSearchRoute] by construction -
/// but a screen builder that assumes that with a bare cast turns a future
/// wiring mistake elsewhere into a crash here, rather than into the honest
/// "not built yet" placeholder the registry already has for exactly this
/// situation.
Widget _buildSerialSearchScreen(BuildContext context, TpRoute route) {
  if (route is! SerialSearchRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return SerialSearchScreen(route: route);
}
