import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_approvals_screen.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_console_screen.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_sites_screen.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_users_screen.dart';
import 'package:tyre_pulse/features/fleet_ai/presentation/fleet_ai_screen.dart';

final Map<String, TpScreenBuilder> adminScreenRegistrations = {
  TpRouteId.adminApprovals: (context, route) => route is AdminApprovalsRoute
      ? const AdminApprovalsScreen()
      : TpScreenNotAvailable(route: route),
  TpRouteId.adminSites: (context, route) => route is AdminSitesRoute
      ? const AdminSitesScreen()
      : TpScreenNotAvailable(route: route),
  TpRouteId.adminAiChat: (context, route) => Consumer(
        builder: (context, ref, child) {
          if (route is! AdminAiChatRoute) {
            return TpScreenNotAvailable(route: route);
          }
          return ref.watch(canAccessModuleProvider(ModuleKey.ai))
              ? const FleetAiScreen()
              : TpPermissionDeniedState(
                  reason: AppLocalizations.of(context).deniedNotGranted,
                );
        },
      ),
  TpRouteId.adminAccess: (context, route) => route is AdminAccessRoute
      ? const AdminUsersScreen(accessMode: true)
      : TpScreenNotAvailable(route: route),
  TpRouteId.adminConsole: (context, route) => route is AdminConsoleRoute
      ? const AdminConsoleScreen()
      : TpScreenNotAvailable(route: route),
  TpRouteId.adminUsers: (context, route) => route is AdminUsersRoute
      ? const AdminUsersScreen()
      : TpScreenNotAvailable(route: route),
};
