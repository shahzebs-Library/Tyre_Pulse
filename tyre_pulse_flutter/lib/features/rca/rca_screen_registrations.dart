library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/rca/presentation/rca_screen.dart';

final Map<String, TpScreenBuilder> rcaScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.rca: (BuildContext context, TpRoute route) => route is RcaRoute
      ? RcaScreen(route: route)
      : TpScreenNotAvailable(route: route),
};
