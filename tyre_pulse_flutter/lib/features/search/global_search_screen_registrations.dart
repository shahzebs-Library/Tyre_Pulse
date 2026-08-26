/// This feature's one contribution to the shared screen registry.
///
/// Mirrors `features/work_orders/work_orders_screen_registrations.dart`'s own
/// one-route shape - see that file's library comment for the general
/// reasoning behind this map-of-builders pattern.
///
/// # This entry is dormant, and dormant for a DIFFERENT reason than usual
///
/// Every other `*_screen_registrations.dart` file in this codebase (Phase 5
/// onward, per `main.dart`'s own composition-root comment) was, at worst,
/// dormant only until ITS OWN `.withAll(...)` call joined the chain there -
/// the route id, its path template and its `GoRoute` entry already existed
/// in `app/router/routes.dart`/`app_router.dart`/`route_access.dart` before
/// the screen was written.
///
/// This one is dormant for a STRONGER reason: no `TpRouteId.globalSearch`,
/// no `TpRoutePaths.globalSearch` and no `GoRoute` entry exist yet at all -
/// see `domain/global_search_route.dart`'s own doc comment for exactly what
/// a human needs to add to the forbidden router files. Joining THIS map into
/// `main.dart`'s chain is still correct to do now, and still safe: it costs
/// nothing (an unreachable key in [TpScreenRegistry] is simply never looked
/// up) and it means the ONLY remaining step, once the router side is wired,
/// is the router side - this file will not need touching again.
///
/// The map key is deliberately NOT a hardcoded string literal - it is
/// [GlobalSearchRoute.routeId], read off a real instance. So if a human
/// later changes that getter to return a new `TpRouteId.globalSearch`
/// constant instead of the current local placeholder (see that file's own
/// comment for why it is a placeholder today), this key updates itself with
/// it. Nothing here needs to change in step.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';

import 'domain/global_search_route.dart';
import 'presentation/global_search_screen.dart';

/// The route this feature builds a screen for.
final Map<String, TpScreenBuilder> globalSearchScreenRegistrations =
    <String, TpScreenBuilder>{
  const GlobalSearchRoute().routeId: _buildGlobalSearchScreen,
};

/// Guards the cast from the router's typed [TpRoute] union down to
/// [GlobalSearchRoute] - the same defensive check every other
/// `*_screen_registrations.dart` file in this codebase uses, rather than a
/// bare cast, so a mismatched registration degrades to
/// [TpScreenNotAvailable] instead of throwing.
Widget _buildGlobalSearchScreen(BuildContext context, TpRoute route) {
  if (route is! GlobalSearchRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return GlobalSearchScreen(route: route);
}
