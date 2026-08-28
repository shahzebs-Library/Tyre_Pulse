library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/management/presentation/management_screens.dart';

final Map<String, TpScreenBuilder> managementScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.overview: (BuildContext context, TpRoute route) =>
      route is OverviewRoute
          ? OverviewScreen(route: route)
          : TpScreenNotAvailable(route: route),
  TpRouteId.analytics: (BuildContext context, TpRoute route) =>
      route is AnalyticsRoute
          ? AnalyticsScreen(route: route)
          : TpScreenNotAvailable(route: route),
  TpRouteId.reports: (BuildContext context, TpRoute route) =>
      route is ReportsRoute
          ? ReportsScreen(route: route)
          : TpScreenNotAvailable(route: route),
  TpRouteId.team: (BuildContext context, TpRoute route) => route is TeamRoute
      ? TeamScreen(route: route)
      : TpScreenNotAvailable(route: route),
};
