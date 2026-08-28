library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/calendar/presentation/calendar_screen.dart';

final Map<String, TpScreenBuilder> calendarScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.calendar: (BuildContext context, TpRoute route) =>
      route is CalendarRoute
          ? CalendarScreen(route: route)
          : TpScreenNotAvailable(route: route),
};
