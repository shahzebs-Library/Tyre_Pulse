library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/inventory/presentation/blind_count_screen.dart';
import 'package:tyre_pulse/features/inventory/presentation/my_audits_screen.dart';
import 'package:tyre_pulse/features/inventory/presentation/transfers_screen.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_count_screen.dart';

final Map<String, TpScreenBuilder> stockCountScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.stockCount: (BuildContext context, TpRoute route) =>
      route is StockCountRoute
          ? StockCountScreen(route: route)
          : TpScreenNotAvailable(route: route),
  TpRouteId.inventoryAudits: (BuildContext context, TpRoute route) =>
      route is InventoryAuditsRoute
          ? const MyAuditsScreen()
          : TpScreenNotAvailable(route: route),
  TpRouteId.inventoryCount: (BuildContext context, TpRoute route) =>
      route is InventoryCountRoute
          ? BlindCountScreen(auditId: route.auditId)
          : TpScreenNotAvailable(route: route),
  TpRouteId.inventoryTransfers: (BuildContext context, TpRoute route) =>
      route is InventoryTransfersRoute
          ? const TransfersScreen()
          : TpScreenNotAvailable(route: route),
};
