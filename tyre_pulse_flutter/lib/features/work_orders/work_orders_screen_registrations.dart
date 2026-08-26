/// Every screen this feature contributes to the shared screen registry.
///
/// Mirrors `features/inspections/inspections_screen_registrations.dart`'s
/// own two-route shape exactly - see that file's library comment for the
/// full reasoning. Registers [TpRouteId.workOrders] and
/// [TpRouteId.workOrderDetail]; both route ids, their path templates
/// (`/work-orders` and the nested `/work-orders/:workOrderId`) and their
/// guards (`ModuleGuarded(RouteModule.workorders)`) already exist in
/// `app/router/routes.dart`, `app/router/app_router.dart` and
/// `app/router/route_access.dart` - none of those files needed a change
/// for this feature to register its screens.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/work_orders/presentation/work_order_detail_screen.dart';
import 'package:tyre_pulse/features/work_orders/presentation/work_orders_list_screen.dart';

/// The routes this feature builds a screen for.
final Map<String, TpScreenBuilder> workOrdersScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.workOrders: _buildWorkOrdersListScreen,
  TpRouteId.workOrderDetail: _buildWorkOrderDetailScreen,
};

/// Guards the cast from the router's typed [TpRoute] union down to
/// [WorkOrdersRoute] - see `inspections_screen_registrations.dart`'s own
/// `_buildNewInspectionScreen` for why this defensive check, rather than a
/// bare cast, is the established convention.
Widget _buildWorkOrdersListScreen(BuildContext context, TpRoute route) {
  if (route is! WorkOrdersRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return WorkOrdersListScreen(route: route);
}

/// See [_buildWorkOrdersListScreen] - the same guard, for
/// [WorkOrderDetailRoute].
Widget _buildWorkOrderDetailScreen(BuildContext context, TpRoute route) {
  if (route is! WorkOrderDetailRoute) {
    return TpScreenNotAvailable(route: route);
  }
  return WorkOrderDetailScreen(route: route);
}
