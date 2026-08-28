library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_case_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_dashboard_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_detail_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_report_screen.dart';

final Map<String, TpScreenBuilder> accidentsScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.accidentDashboard: _dashboard,
  TpRouteId.accidentReport: _report,
  TpRouteId.accidentDetail: _detail,
  TpRouteId.accidentCase: _case,
};

Widget _dashboard(BuildContext context, TpRoute route) =>
    route is AccidentDashboardRoute
        ? AccidentDashboardScreen(route: route)
        : TpScreenNotAvailable(route: route);

Widget _report(BuildContext context, TpRoute route) =>
    route is AccidentReportRoute
        ? AccidentReportScreen(route: route)
        : TpScreenNotAvailable(route: route);

Widget _detail(BuildContext context, TpRoute route) =>
    route is AccidentDetailRoute
        ? AccidentDetailScreen(route: route)
        : TpScreenNotAvailable(route: route);

Widget _case(BuildContext context, TpRoute route) => route is AccidentCaseRoute
    ? AccidentCaseScreen(route: route)
    : TpScreenNotAvailable(route: route);
