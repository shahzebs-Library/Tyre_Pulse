import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_copy.dart';
import 'package:tyre_pulse/features/admin/presentation/approval_matrix_screen.dart';

/// Operational shortcuts only; each linked page owns its live data and gate.
class AdminConsoleScreen extends ConsumerWidget {
  const AdminConsoleScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final copy = AdminCopy(context);
    final l10n = AppLocalizations.of(context);
    final access = ref.watch(accessStateProvider);
    final admin = ref.watch(canAccessModuleProvider(ModuleKey.admin)) &&
        (access.isSuperAdmin || access.role.isAdministrator);
    return TpScaffold(
      backFallback: TpRoutePaths.home,
      appBar: TpAppBar(title: copy.title, backFallback: TpRoutePaths.home),
      body: !admin
          ? TpPermissionDeniedState(reason: l10n.deniedAdminOnly)
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                ListTile(
                  leading: const Icon(Icons.account_tree_outlined),
                  title: Text(
                    copy.pick(
                      'Approval Matrix',
                      '?????? ?????????',
                      '?????? ??????',
                    ),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push<void>(
                    MaterialPageRoute(
                      builder: (_) => const ApprovalMatrixScreen(),
                    ),
                  ),
                ),
                ListTile(
                  leading: const Icon(Icons.approval_outlined),
                  title: Text(
                    copy.pick(
                      'Upload and closure approvals',
                      'موافقات الرفع والإغلاق',
                      'اپ لوڈ اور بندش کی منظوری',
                    ),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () =>
                      context.push(const AdminApprovalsRoute().location),
                ),
                ListTile(
                  leading: const Icon(Icons.location_city_outlined),
                  title: Text(copy.sites),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push(const AdminSitesRoute().location),
                ),
                if (ref.watch(canAccessModuleProvider(ModuleKey.ai)))
                  ListTile(
                    leading: const Icon(Icons.auto_awesome_outlined),
                    title: Text(copy.module(ModuleKey.ai)),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () =>
                        context.push(const AdminAiChatRoute().location),
                  ),
                if (access.isSuperAdmin)
                  ListTile(
                    leading: const Icon(Icons.admin_panel_settings_outlined),
                    title: Text(copy.access),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () =>
                        context.push(const AdminAccessRoute().location),
                  ),
                if (ref.watch(canAccessModuleProvider(ModuleKey.users)))
                  ListTile(
                    leading: const Icon(Icons.manage_accounts_outlined),
                    title: Text(copy.users),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push(const AdminUsersRoute().location),
                  ),
                if (ref.watch(canAccessModuleProvider(ModuleKey.approvals)))
                  ListTile(
                    leading: const Icon(Icons.fact_check_outlined),
                    title: Text(
                      copy.pick(
                        'Inspection approvals',
                        'موافقات الفحص',
                        'معائنہ کی منظوری',
                      ),
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () =>
                        context.push(const InspectionApprovalsRoute().location),
                  ),
                if (ref.watch(canAccessModuleProvider(ModuleKey.workshop)))
                  ListTile(
                    leading: const Icon(Icons.build_outlined),
                    title: Text(copy.pick('Workshop', 'الورشة', 'ورکشاپ')),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push(const WorkshopRoute().location),
                  ),
                if (ref.watch(canAccessModuleProvider(ModuleKey.accidents)))
                  ListTile(
                    leading: const Icon(Icons.car_crash_outlined),
                    title: Text(
                      copy.pick(
                        'Accident cases',
                        'حالات الحوادث',
                        'حادثات کے کیس',
                      ),
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () =>
                        context.push(const AccidentDashboardRoute().location),
                  ),
              ],
            ),
    );
  }
}
