library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_count_screen.dart';

final Map<String, TpScreenBuilder> stockCountScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.stockCount: (BuildContext context, TpRoute route) =>
      route is StockCountRoute
          ? StockCountScreen(route: route)
          : TpScreenNotAvailable(route: route),
};
