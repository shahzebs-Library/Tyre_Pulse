/// Every screen the administration console contributes to the shared screen
/// registry. Merged in at the composition root (`main.dart`), the same way
/// every other feature's map is - see `app/router/screen_registry.dart`.
///
/// All six route ids, paths and guards already exist in `routes.dart`,
/// `app_router.dart` and `route_access.dart`; none of those files changed.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_access_screen.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_ai_chat_screen.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_approvals_screen.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_hub_screen.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_sites_screen.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_users_screen.dart';

final Map<String, TpScreenBuilder> adminScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.adminConsole: (BuildContext context, TpRoute route) =>
      route is AdminConsoleRoute
          ? AdminHubScreen(route: route)
          : TpScreenNotAvailable(route: route),
  TpRouteId.adminUsers: (BuildContext context, TpRoute route) =>
      route is AdminUsersRoute
          ? AdminUsersScreen(route: route)
          : TpScreenNotAvailable(route: route),
  TpRouteId.adminAccess: (BuildContext context, TpRoute route) =>
      route is AdminAccessRoute
          ? AdminAccessScreen(route: route)
          : TpScreenNotAvailable(route: route),
  TpRouteId.adminApprovals: (BuildContext context, TpRoute route) =>
      route is AdminApprovalsRoute
          ? AdminApprovalsScreen(route: route)
          : TpScreenNotAvailable(route: route),
  TpRouteId.adminSites: (BuildContext context, TpRoute route) =>
      route is AdminSitesRoute
          ? AdminSitesScreen(route: route)
          : TpScreenNotAvailable(route: route),
  TpRouteId.adminAiChat: (BuildContext context, TpRoute route) =>
      route is AdminAiChatRoute
          ? AdminAiChatScreen(route: route)
          : TpScreenNotAvailable(route: route),
};
