/// Every screen this feature contributes to the shared screen registry.
///
/// Merged in at the composition root, alongside every other feature's own
/// map, via
/// `screenRegistryProvider.overrideWithValue(TpScreenRegistry.empty
/// .withAll(tyresScreenRegistrations).withAll(inspectionsScreenRegistrations)
/// .withAll(...))` - see `app/router/screen_registry.dart` and
/// `features/tyres/tyres_screen_registrations.dart`, whose shape this
/// mirrors exactly. Deliberately the ONE file in this feature that the
/// router-owning layer needs to import; nothing else here is reached from
/// outside `features/inspections/`.
///
/// Registers the inspection capture/detail routes and the existing
/// [TpRouteId.activityHistory] destination. The latter is production's merged
/// queued-and-synced inspection history from artifact 01 section 2.11; the
/// same screen also remains reachable from inside [NewInspectionScreen].
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/inspections/presentation/'
    'inspection_detail_screen.dart';
import 'package:tyre_pulse/features/inspections/presentation/'
    'inspection_history_screen.dart';
import 'package:tyre_pulse/features/inspections/presentation/'
    'new_inspection_screen.dart';

/// The routes this feature builds a screen for.
final Map<String, TpScreenBuilder> inspectionsScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.newInspection: _buildNewInspectionScreen,
  TpRouteId.inspectionDetail: _buildInspectionDetailScreen,
  TpRouteId.activityHistory: _buildActivityHistoryScreen,
};

/// Guards the cast from the router's typed [TpRoute] union down to
/// [NewInspectionRoute]. The registry is keyed by [TpRouteId.newInspection],
/// so [route] should always already be a [NewInspectionRoute] by
/// construction - but a screen builder that assumes that with a bare cast
/// turns a future wiring mistake elsewhere into a crash here, rather than
/// into the honest "not built yet" placeholder the registry already has
/// for exactly this situation.
Widget _buildNewInspectionScreen(BuildContext context, TpRoute route) {
  if (route is! NewInspectionRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return NewInspectionScreen(route: route);
}

/// See [_buildNewInspectionScreen] - the same guard, for
/// [InspectionDetailRoute].
Widget _buildInspectionDetailScreen(BuildContext context, TpRoute route) {
  if (route is! InspectionDetailRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return InspectionDetailScreen(route: route);
}

Widget _buildActivityHistoryScreen(BuildContext context, TpRoute route) {
  if (route is! ActivityHistoryRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return const InspectionHistoryScreen();
}
