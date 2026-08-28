/// Truthful, informational coverage of the PMV operations available after
/// sign-in.
///
/// This deliberately shows module names only. It never displays counts,
/// availability, permissions, or country scope before authentication because
/// those values are owned by the authenticated workspace and its live data.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';

@visibleForTesting
abstract final class LoginOperationsScopeKeys {
  static const Key panel = Key('login.operations.scope');
  static const Key fleetAssets = Key('login.operations.fleet_assets');
  static const Key tyres = Key('login.operations.tyres');
  static const Key inspectionsChecklists =
      Key('login.operations.inspections_checklists');
  static const Key maintenanceWorkshop =
      Key('login.operations.maintenance_workshop');
  static const Key accidents = Key('login.operations.accidents');
}

class LoginOperationsScope extends StatelessWidget {
  const LoginOperationsScope({super.key});

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final List<_OperationScopeItem> items = <_OperationScopeItem>[
      _OperationScopeItem(
        key: LoginOperationsScopeKeys.fleetAssets,
        icon: Icons.local_shipping_outlined,
        label: l10n.loginScopeFleetAssets,
      ),
      _OperationScopeItem(
        key: LoginOperationsScopeKeys.tyres,
        icon: Icons.tire_repair_outlined,
        label: l10n.globalSearchSectionTyres,
      ),
      _OperationScopeItem(
        key: LoginOperationsScopeKeys.inspectionsChecklists,
        icon: Icons.fact_check_outlined,
        label: l10n.loginScopeInspectionsChecklists,
      ),
      _OperationScopeItem(
        key: LoginOperationsScopeKeys.maintenanceWorkshop,
        icon: Icons.handyman_outlined,
        label: l10n.loginScopeMaintenanceWorkshop,
      ),
      _OperationScopeItem(
        key: LoginOperationsScopeKeys.accidents,
        icon: Icons.car_crash_outlined,
        label: l10n.tabAccidents,
      ),
    ];

    return Semantics(
      key: LoginOperationsScopeKeys.panel,
      container: true,
      child: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final bool useTwoColumns = constraints.maxWidth >= 420;
          final double itemWidth = useTwoColumns
              ? (constraints.maxWidth - TpSpace.sm) / 2
              : constraints.maxWidth;

          return Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              for (final _OperationScopeItem item in items)
                SizedBox(width: itemWidth, child: item),
            ],
          );
        },
      ),
    );
  }
}

class _OperationScopeItem extends StatelessWidget {
  const _OperationScopeItem({
    required super.key,
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);

    return Semantics(
      label: label,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: palette.primarySoft,
          borderRadius: BorderRadius.circular(TpRadius.pill),
          border: Border.all(
            color: palette.primary.withValues(alpha: 0.26),
            width: TpBorderWidth.hairline,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: TpSpace.sm,
            vertical: TpSpace.xs,
          ),
          child: Row(
            children: <Widget>[
              ExcludeSemantics(
                child: Icon(
                  icon,
                  size: TpSizing.iconSm,
                  color: palette.primaryDark,
                ),
              ),
              const SizedBox(width: TpSpace.xs),
              Expanded(
                child: Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: palette.primaryDark,
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
