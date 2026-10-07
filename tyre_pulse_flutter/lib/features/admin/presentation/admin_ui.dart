/// Small shared pieces for the administration screens: localized labels for
/// module keys, statuses and groups, the error adapter, and the nav tile.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/features/admin/domain/admin_models.dart';

/// Turns anything a repository threw into a displayable [AppError].
AppError adminErrorOf(Object error, String fallback) => switch (error) {
      final SupabaseFailure failure => failure.error,
      final AppError appError => appError,
      _ => AppError(
          kind: AppErrorKind.unknown,
          message: fallback,
          cause: error,
          isRetryable: true,
        ),
    };

String adminModuleLabel(AppLocalizations l10n, ModuleKey key) => switch (key) {
      ModuleKey.inspect => l10n.adminModuleInspect,
      ModuleKey.scan => l10n.adminModuleScan,
      ModuleKey.serial => l10n.adminModuleSerial,
      ModuleKey.tyreChange => l10n.adminModuleTyreChange,
      ModuleKey.checklists => l10n.adminModuleChecklists,
      ModuleKey.meter => l10n.adminModuleMeter,
      ModuleKey.washing => l10n.adminModuleWashing,
      ModuleKey.reportIssue => l10n.adminModuleReportIssue,
      ModuleKey.repairRequest => l10n.adminModuleRepairRequest,
      ModuleKey.records => l10n.adminModuleRecords,
      ModuleKey.vehicles => l10n.adminModuleVehicles,
      ModuleKey.history => l10n.adminModuleHistory,
      ModuleKey.alerts => l10n.adminModuleAlerts,
      ModuleKey.calendar => l10n.adminModuleCalendar,
      ModuleKey.accidents => l10n.adminModuleAccidents,
      ModuleKey.reportAccident => l10n.adminModuleReportAccident,
      ModuleKey.workorders => l10n.adminModuleWorkorders,
      ModuleKey.rca => l10n.adminModuleRca,
      ModuleKey.tasks => l10n.adminModuleTasks,
      ModuleKey.stock => l10n.adminModuleStock,
      ModuleKey.pm => l10n.adminModulePm,
      ModuleKey.workshop => l10n.adminModuleWorkshop,
      ModuleKey.workshopStatus => l10n.adminModuleWorkshopStatus,
      ModuleKey.overview => l10n.adminModuleOverview,
      ModuleKey.reports => l10n.adminModuleReports,
      ModuleKey.analytics => l10n.adminModuleAnalytics,
      ModuleKey.stockManage => l10n.adminModuleStockManage,
      ModuleKey.ai => l10n.adminModuleAi,
      ModuleKey.team => l10n.adminModuleTeam,
      ModuleKey.approvals => l10n.adminModuleApprovals,
      ModuleKey.admin => l10n.adminModuleAdmin,
      ModuleKey.users => l10n.adminModuleUsers,
    };

String adminGroupLabel(AppLocalizations l10n, ModuleGroup group) =>
    switch (group) {
      ModuleGroup.field => l10n.adminAccessGroupField,
      ModuleGroup.fleet => l10n.adminAccessGroupFleet,
      ModuleGroup.maintenance => l10n.adminAccessGroupMaintenance,
      ModuleGroup.management => l10n.adminAccessGroupManagement,
      ModuleGroup.admin => l10n.adminAccessGroupAdmin,
    };

String adminStatusLabel(AppLocalizations l10n, AdminUserStatus status) =>
    switch (status) {
      AdminUserStatus.pending => l10n.adminUsersStatusPending,
      AdminUserStatus.active => l10n.adminUsersStatusActive,
      AdminUserStatus.locked => l10n.adminUsersStatusLocked,
    };

TpStatus adminStatusTone(AdminUserStatus status) => switch (status) {
      AdminUserStatus.pending => TpStatus.warning,
      AdminUserStatus.active => TpStatus.ok,
      AdminUserStatus.locked => TpStatus.critical,
    };

/// A tappable navigation row used on the console hub.
class AdminNavTile extends StatelessWidget {
  const AdminNavTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.badge,
    super.key,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  /// A count to show at the trailing edge. Null shows nothing.
  final int? badge;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return TpCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.lg,
        vertical: TpSpace.md,
      ),
      child: Row(
        children: <Widget>[
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: palette.primarySoft,
              borderRadius: BorderRadius.circular(TpRadius.md),
            ),
            child: Icon(icon, color: palette.primaryDark, size: 22),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title, style: text.titleSmall),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: text.bodySmall?.copyWith(
                    color: palette.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          if (badge != null && badge! > 0) ...<Widget>[
            const SizedBox(width: TpSpace.sm),
            TpStatusChip(
              status: TpStatus.warning,
              label: '${badge!}',
              isCompact: true,
            ),
          ],
          const SizedBox(width: TpSpace.xs),
          Icon(
            // Mirrors itself under RTL (matchTextDirection).
            Icons.chevron_right_rounded,
            color: palette.textMuted,
          ),
        ],
      ),
    );
  }
}

/// A compact section heading.
class AdminSectionHeader extends StatelessWidget {
  const AdminSectionHeader(this.label, {super.key});

  final String label;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsetsDirectional.only(
          top: TpSpace.lg,
          bottom: TpSpace.sm,
        ),
        child: Text(
          label,
          style: Theme.of(context).textTheme.labelLarge?.copyWith(
                color: TpPalette.of(context).textSecondary,
              ),
        ),
      );
}

/// A soft informational note, used for the read-only explanations.
class AdminNote extends StatelessWidget {
  const AdminNote(this.message, {this.icon = Icons.info_outline, super.key});

  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      background: palette.surfaceAlt,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, size: 18, color: palette.textSecondary),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: palette.textSecondary,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Shows a short confirmation of a finished action.
void adminShowSnack(BuildContext context, String message) {
  ScaffoldMessenger.maybeOf(context)
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}
