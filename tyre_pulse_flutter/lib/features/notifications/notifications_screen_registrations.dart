library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/notifications/presentation/notifications_screen.dart';

final Map<String, TpScreenBuilder> notificationsScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.notifications: (BuildContext context, TpRoute route) =>
      NotificationsScreen(backFallback: TpBackFallbacks.forRoute(route)),
};
