/// The routes the global search feature builds a screen for.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/search/presentation/global_search_screen.dart';

final Map<String, TpScreenBuilder> globalSearchScreenRegistrations =
    <String, TpScreenBuilder>{TpRouteId.globalSearch: _buildGlobalSearchScreen};

/// Narrows the router's [TpRoute] union to [GlobalSearchRoute]; a wiring
/// mistake renders the honest "not built yet" placeholder, not a crash.
Widget _buildGlobalSearchScreen(BuildContext context, TpRoute route) {
  if (route is! GlobalSearchRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return GlobalSearchScreen(route: route);
}
