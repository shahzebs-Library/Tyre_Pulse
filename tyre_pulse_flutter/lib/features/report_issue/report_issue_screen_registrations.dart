library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/report_issue/presentation/report_issue_screen.dart';

final Map<String, TpScreenBuilder> reportIssueScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.reportIssue: (BuildContext context, TpRoute route) =>
      route is ReportIssueRoute
          ? ReportIssueScreen(route: route)
          : TpScreenNotAvailable(route: route),
};
