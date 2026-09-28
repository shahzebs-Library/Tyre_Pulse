/// `/admin` - the administration console hub.
///
/// Ported from `mobile/app/(app)/admin/index.tsx`. The React Native screen
/// swallowed a failed load and rendered zeros; here each count is its own
/// query and a failed one renders as unavailable, never as `0`.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/features/admin/admin_providers.dart';
import 'package:tyre_pulse/features/admin/data/admin_repository.dart';
import 'package:tyre_pulse/features/admin/domain/admin_models.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_ui.dart';

class AdminHubScreen extends ConsumerStatefulWidget {
  const AdminHubScreen({required this.route, super.key});

  final AdminConsoleRoute route;

  @override
  ConsumerState<AdminHubScreen> createState() => _AdminHubScreenState();
}

class _AdminHubScreenState extends ConsumerState<AdminHubScreen> {
  AdminHubCounts? _counts;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final AdminRepository repo = ref.read(adminRepositoryProvider);
    // Each read settles on its own: one refused count must not blank the rest.
    Future<int?> settle(Future<int> Function() read) async {
      try {
        return await read();
      } on Object {
        return null;
      }
    }

    final List<int?> values = await Future.wait(<Future<int?>>[
      settle(repo.countPendingInspectionApprovals),
      settle(repo.countPendingChecklistApprovals),
      settle(repo.countPendingSignups),
      settle(repo.countLockedUsers),
    ]);
    if (!mounted) return;
    setState(() {
      _counts = AdminHubCounts(
        pendingInspections: values[0],
        pendingChecklists: values[1],
        pendingSignups: values[2],
        lockedUsers: values[3],
      );
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final AccessState access = ref.watch(accessStateProvider);
    final Set<ModuleKey> allowed = ref.watch(allowedModulesProvider);
    final AdminHubCounts? counts = _counts;

    void open(TpRoute route) => unawaited(context.push(route.location));

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.adminHubTitle,
        subtitle: l10n.adminHubSubtitle,
        backFallback: fallback,
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          key: const Key('admin.hub.list'),
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.md,
            TpSpace.lg,
            TpSpace.xxxl,
          ),
          children: <Widget>[
            if (_loading && counts == null)
              const SizedBox(height: 96, child: TpLoadingState())
            else
              Row(
                children: <Widget>[
                  Expanded(
                    child: _count(
                      l10n,
                      l10n.adminHubPendingApprovals,
                      counts?.pendingApprovals,
                      Icons.fact_check_outlined,
                    ),
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: _count(
                      l10n,
                      l10n.adminHubPendingSignups,
                      counts?.pendingSignups,
                      Icons.person_add_alt_outlined,
                    ),
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: _count(
                      l10n,
                      l10n.adminHubLockedUsers,
                      counts?.lockedUsers,
                      Icons.lock_outline,
                    ),
                  ),
                ],
              ),
            AdminSectionHeader(l10n.adminHubSectionManage),
            AdminNavTile(
              key: const Key('admin.hub.users'),
              icon: Icons.manage_accounts_outlined,
              title: l10n.adminHubUsersTitle,
              subtitle: l10n.adminHubUsersSubtitle,
              badge: counts?.pendingSignups,
              onTap: () => open(const AdminUsersRoute()),
            ),
            if (access.isSuperAdmin) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              AdminNavTile(
                key: const Key('admin.hub.access'),
                icon: Icons.admin_panel_settings_outlined,
                title: l10n.adminHubAccessTitle,
                subtitle: l10n.adminHubAccessSubtitle,
                onTap: () => open(const AdminAccessRoute()),
              ),
            ],
            const SizedBox(height: TpSpace.sm),
            AdminNavTile(
              key: const Key('admin.hub.approvals'),
              icon: Icons.fact_check_outlined,
              title: l10n.adminHubApprovalsTitle,
              subtitle: l10n.adminHubApprovalsSubtitle,
              badge: counts?.pendingApprovals,
              onTap: () => open(const AdminApprovalsRoute()),
            ),
            const SizedBox(height: TpSpace.sm),
            AdminNavTile(
              key: const Key('admin.hub.sites'),
              icon: Icons.location_city_outlined,
              title: l10n.adminHubSitesTitle,
              subtitle: l10n.adminHubSitesSubtitle,
              onTap: () => open(const AdminSitesRoute()),
            ),
            const SizedBox(height: TpSpace.sm),
            AdminNavTile(
              key: const Key('admin.hub.ai'),
              icon: Icons.auto_awesome_outlined,
              title: l10n.adminHubAiTitle,
              subtitle: l10n.adminHubAiSubtitle,
              onTap: () => open(const AdminAiChatRoute()),
            ),
            ..._moreTiles(l10n, allowed, open),
          ],
        ),
      ),
    );
  }

  List<Widget> _moreTiles(
    AppLocalizations l10n,
    Set<ModuleKey> allowed,
    void Function(TpRoute) open,
  ) {
    final List<(ModuleKey, IconData, TpRoute)> entries =
        <(ModuleKey, IconData, TpRoute)>[
      (ModuleKey.team, Icons.groups_outlined, const TeamRoute()),
      (ModuleKey.overview, Icons.dashboard_outlined, const OverviewRoute()),
      (ModuleKey.analytics, Icons.insights_outlined, const AnalyticsRoute()),
      (ModuleKey.reports, Icons.summarize_outlined, const ReportsRoute()),
      (
        ModuleKey.alerts,
        Icons.notifications_active_outlined,
        const AlertsRoute(),
      ),
    ]
            .where(((ModuleKey, IconData, TpRoute) e) => allowed.contains(e.$1))
            .toList(growable: false);
    if (entries.isEmpty) return const <Widget>[];
    return <Widget>[
      AdminSectionHeader(l10n.adminHubSectionMore),
      for (final (ModuleKey, IconData, TpRoute) entry in entries) ...<Widget>[
        AdminNavTile(
          key: Key('admin.hub.${entry.$1.wireKey}'),
          icon: entry.$2,
          title: adminModuleLabel(l10n, entry.$1),
          subtitle: l10n.adminHubOpenModule,
          onTap: () => open(entry.$3),
        ),
        const SizedBox(height: TpSpace.sm),
      ],
    ];
  }

  Widget _count(
    AppLocalizations l10n,
    String label,
    int? value,
    IconData icon,
  ) {
    if (value == null) {
      return TpStatCard.unavailable(
        label: label,
        caption: l10n.adminHubCountUnavailable,
        icon: icon,
      );
    }
    return TpStatCard.count(
      label: label,
      count: value,
      icon: icon,
      status: value > 0 ? TpStatus.warning : null,
    );
  }
}
