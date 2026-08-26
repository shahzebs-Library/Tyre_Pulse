/// Every screen this feature contributes to the shared screen registry.
///
/// Merged in at the composition root, alongside every other feature's own
/// map, via
/// `screenRegistryProvider.overrideWithValue(TpScreenRegistry.empty
/// .withAll(tyresScreenRegistrations).withAll(inspectionsScreenRegistrations)
/// .withAll(checklistsScreenRegistrations).withAll(...))` - see
/// `app/router/screen_registry.dart` and
/// `features/inspections/inspections_screen_registrations.dart`, whose shape
/// this mirrors exactly. Deliberately the ONE file in this feature that the
/// router-owning layer needs to import; nothing else here is reached from
/// outside `features/checklists/`.
///
/// Registers all three route ids this feature's task brief names:
/// [TpRouteId.checklists], [TpRouteId.checklistHistory] and
/// [TpRouteId.checklistFill].
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/checklists/presentation/'
    'checklist_fill_screen.dart';
import 'package:tyre_pulse/features/checklists/presentation/'
    'checklist_history_screen.dart';
import 'package:tyre_pulse/features/checklists/presentation/'
    'checklists_home_screen.dart';

/// The routes this feature builds a screen for.
final Map<String, TpScreenBuilder> checklistsScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.checklists: _buildChecklistsHomeScreen,
  TpRouteId.checklistHistory: _buildChecklistHistoryScreen,
  TpRouteId.checklistFill: _buildChecklistFillScreen,
};

/// Guards the cast from the router's typed [TpRoute] union down to
/// [ChecklistsRoute]. The registry is keyed by [TpRouteId.checklists], so
/// [route] should always already be a [ChecklistsRoute] by construction -
/// but a screen builder that assumes that with a bare cast turns a future
/// wiring mistake elsewhere into a crash here, rather than into the honest
/// "not built yet" placeholder the registry already has for exactly this
/// situation.
Widget _buildChecklistsHomeScreen(BuildContext context, TpRoute route) {
  if (route is! ChecklistsRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return const ChecklistsHomeScreen();
}

/// See [_buildChecklistsHomeScreen] - the same guard, for
/// [ChecklistHistoryRoute].
Widget _buildChecklistHistoryScreen(BuildContext context, TpRoute route) {
  if (route is! ChecklistHistoryRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return const ChecklistHistoryScreen();
}

/// See [_buildChecklistsHomeScreen] - the same guard, for
/// [ChecklistFillRoute].
Widget _buildChecklistFillScreen(BuildContext context, TpRoute route) {
  if (route is! ChecklistFillRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return ChecklistFillScreen(route: route);
}
