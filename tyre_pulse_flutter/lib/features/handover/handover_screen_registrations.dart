/// Every screen the vehicle handover feature contributes to the shared screen
/// registry.
///
/// Merged in at the composition root alongside every other feature's own map
/// via `TpScreenRegistry.empty.withAll(...).withAll(handoverScreenRegistrations)`
/// - see `features/inspections/inspections_screen_registrations.dart`, whose
/// shape this mirrors exactly. This is the ONE file in `features/handover/`
/// the router-owning layer imports; nothing else here is reached from outside
/// the feature.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/handover/presentation/'
    'handover_detail_screen.dart';
import 'package:tyre_pulse/features/handover/presentation/'
    'handover_history_screen.dart';
import 'package:tyre_pulse/features/handover/presentation/'
    'new_handover_screen.dart';

/// The routes this feature builds a screen for.
final Map<String, TpScreenBuilder> handoverScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.handover: _buildHistory,
  TpRouteId.newHandover: _buildNew,
  TpRouteId.handoverDetail: _buildDetail,
};

/// Guards the cast from the router's typed [TpRoute] union down to the concrete
/// route. The registry is keyed by the matching [TpRouteId], so [route] should
/// already be the right subtype; a bare cast would turn a future wiring mistake
/// into a crash here instead of the registry's honest "not built" placeholder.
Widget _buildHistory(BuildContext context, TpRoute route) {
  if (route is! HandoverRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return const HandoverHistoryScreen();
}

Widget _buildNew(BuildContext context, TpRoute route) {
  if (route is! NewHandoverRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return NewHandoverScreen(route: route);
}

Widget _buildDetail(BuildContext context, TpRoute route) {
  if (route is! HandoverDetailRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return HandoverDetailScreen(route: route);
}
