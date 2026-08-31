/// One vehicle, in full.
///
/// # This screen has NO route, and that is deliberate
///
/// `routes.dart` declares [VehiclesRoute] and never a `vehicleDetail`
/// counterpart - verified by reading the whole file and `app_router.dart`'s
/// route tree, where every OTHER list (`workOrders`, `accidentDashboard`,
/// `checklists`, `activityHistory`) declares a nested detail route and
/// `vehicles` does not. Registering a new route id was outside this change's
/// remit - the task that produced this file was explicit that `routes.dart`
/// is not to be edited, and that a missing route should be noted rather than
/// invented. So this screen is reached the same way the equivalent inline
/// expansion works in the production `mobile/app/(app)/vehicles.tsx`: pushed
/// directly from [VehiclesListScreen] with a plain [Navigator.push], onto
/// the Home branch's own nested Navigator (branch 0 in `app_router.dart`),
/// rather than through a named go_router location.
///
/// # Why that changes how Back is wired here
///
/// A screen reached via `context.go`/`context.push` gets its guard AND its
/// system-back handling from `app_router.dart`'s `_GuardedScreen` and
/// `TpScaffold`'s `backFallback`, both of which resolve through
/// [TpBack.of], i.e. through the ambient [GoRouter]. This screen was never
/// declared to that router, so:
///
/// - [TpModuleGuard] is applied EXPLICITLY here, because there is no
///   `_GuardedScreen` wrapper doing it automatically the way there is for
///   [VehiclesListScreen]. Permissions can change while this screen is
///   already open - an administrator revoking `vehicles` access mid-session
///   - and without its own guard this screen would keep rendering after
///   that.
/// - The page's own [TpScaffold] carries NO `backFallback`. A real
///   [Navigator] push put this screen on screen, so real history already
///   exists on the nearest Navigator, and Flutter's own default Back
///   handling (hardware button, predictive-back gesture, and the framework
///   default an omitted `backFallback` leaves in place - see
///   `tp_scaffold.dart`'s own doc) already pops it correctly. Setting
///   `backFallback` here would route that through [TpBack]/[GoRouter]
///   instead, and this environment has no way to compile-run the app and
///   confirm how `GoRouter.canPop()` behaves for a route it was never told
///   about - safer to rely on the plain Flutter mechanism that is
///   unambiguously correct for a plainly-pushed screen with real history.
/// - The app bar's chevron is wired explicitly to
///   `Navigator.of(context).maybePop()` for the same reason, using
///   [TpAppBar.onBack] - the override hook that file's own doc says exists
///   for exactly a screen that needs to run Back itself.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/module_guard.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:tyre_pulse/features/assets/presentation/widgets/vehicle_multiview_board.dart';
import 'package:tyre_pulse/features/report_issue/presentation/report_issue_copy.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/vehicle_tyre_diagram.dart';
import 'package:tyre_pulse/features/work_orders/presentation/widgets/create_work_order_sheet.dart';

class VehicleDetailScreen extends StatelessWidget {
  const VehicleDetailScreen({required this.assetNo, super.key});

  /// `vehicle_fleet.asset_no`, exact. See the library comment: this is the
  /// only identifier a re-fetchable detail screen can be keyed by.
  final String assetNo;

  @override
  Widget build(BuildContext context) {
    return TpModuleGuard(
      guard: TpRouteGuards.forRouteId(TpRouteId.vehicles),
      backFallback: TpRoutePaths.vehicles,
      child: _VehicleDetailBody(assetNo: assetNo),
    );
  }
}

class _VehicleDetailBody extends ConsumerWidget {
  const _VehicleDetailBody({required this.assetNo});

  final String assetNo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<VehicleDetailOutcome> outcomeAsync = ref.watch(
      vehicleDetailProvider(assetNo),
    );

    return TpScaffold(
      appBar: TpAppBar(
        title: l10n.vehiclesDetailSubtitle,
        onBack: () => Navigator.of(context).maybePop(),
      ),
      body: _buildBody(context, ref, l10n, outcomeAsync),
    );
  }

  /// The same seven-state policy as [VehiclesListScreen]'s
  /// `_buildBody` - see that method's doc for the full reasoning, repeated
  /// here only where it differs:
  ///
  /// - [VehicleDetailNotFound] maps to [TpEmptyState], not [TpErrorState].
  ///   The query ran and answered "no such row", which is a fact about the
  ///   fleet register, not a malfunction - mirroring
  ///   `SupabaseFailure.isNoRowsFound`'s own distinction. Rendering it as an
  ///   error would tell a technician something is broken when the honest
  ///   answer is that the asset number does not exist in this scope.
  Widget _buildBody(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
    AsyncValue<VehicleDetailOutcome> outcomeAsync,
  ) {
    return outcomeAsync.when(
      loading: () => const TpLoadingState(),
      error: (Object error, StackTrace stackTrace) => TpErrorState(
        error: error is AppError ? error : _unexpectedError(l10n),
        onRetry: () => ref.invalidate(vehicleDetailProvider(assetNo)),
      ),
      data: (VehicleDetailOutcome outcome) => switch (outcome) {
        VehicleDetailLoaded(asset: final VehicleAsset asset) => _DetailView(
            asset: asset,
            l10n: l10n,
          ),
        VehicleDetailFromCache(cachedAt: final DateTime? cachedAt) =>
          TpOfflineCachedState(
            cachedAtLabel: _formatCachedAt(cachedAt),
            onRetry: () => ref.invalidate(vehicleDetailProvider(assetNo)),
          ),
        VehicleDetailNotFound() => TpEmptyState(
            title: l10n.vehiclesNotFoundTitle,
            message: l10n.vehiclesNotFoundMessage,
          ),
        VehicleDetailFailed(error: final AppError error) =>
          isBackendUnavailableError(error)
              ? TpBackendUnavailableState(
                  onRetry: () => ref.invalidate(vehicleDetailProvider(assetNo)),
                )
              : TpErrorState(
                  error: error,
                  onRetry: () => ref.invalidate(vehicleDetailProvider(assetNo)),
                ),
      },
    );
  }

  static AppError _unexpectedError(AppLocalizations l10n) => AppError(
        kind: AppErrorKind.unknown,
        message: l10n.stateErrorMessage,
        isRetryable: true,
      );

  static String? _formatCachedAt(DateTime? cachedAt) {
    if (cachedAt == null) {
      return null;
    }
    final DateTime local = cachedAt.toLocal();
    final String hh = local.hour.toString().padLeft(2, '0');
    final String mm = local.minute.toString().padLeft(2, '0');
    return '${local.year}-${local.month.toString().padLeft(2, '0')}-'
        '${local.day.toString().padLeft(2, '0')} $hh:$mm';
  }
}

@visibleForTesting
abstract final class VehicleDetailScreenKeys {
  static const Key overviewTab = Key('vehicle_detail.tab.overview');
  static const Key tyresTab = Key('vehicle_detail.tab.tyres');
  static const Key historyTab = Key('vehicle_detail.tab.history');
  static const Key tyreMap = Key('vehicle_detail.tyre_map');
  static const Key details = Key('vehicle_detail.details');
  static const Key reportIssue = Key('vehicle_detail.report_issue');
  static const Key createWorkOrder = Key('vehicle_detail.create_work_order');
  static const Key multiViewBoard = Key('vehicle_detail.multi_view_board');
}

enum _AssetDetailTab { overview, tyres, history }

/// The approved asset overview keeps the high-value identity, two compact
/// facts, tabs, vehicle-specific tyre map and primary action in the first
/// phone composition. The complete twelve-field master record remains below
/// the fold, so visual parity never removes operational data.
class _DetailView extends ConsumerStatefulWidget {
  const _DetailView({required this.asset, required this.l10n});

  final VehicleAsset asset;
  final AppLocalizations l10n;

  @override
  ConsumerState<_DetailView> createState() => _DetailViewState();
}

class _DetailViewState extends ConsumerState<_DetailView> {
  _AssetDetailTab _selectedTab = _AssetDetailTab.overview;

  VehicleAsset get asset => widget.asset;
  AppLocalizations get l10n => widget.l10n;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String? photo = vehiclePhotoAsset(asset);
    final String? assetCode = _present(asset.assetNo);
    final bool canReportIssue = ref.watch(
      canAccessModuleProvider(ModuleKey.reportIssue),
    );
    final bool canCreateWorkOrder = ref.watch(
      canAccessModuleProvider(ModuleKey.workorders),
    );
    final List<(String, String?)> fields = _assetFields();
    final List<({String label, String value})> metrics = <({
      String label,
      String value,
    })>[
      (
        label: l10n.vehiclesFieldCurrentKm,
        value: asset.currentKm == null
            ? l10n.valueNotMeasured
            : '${formatVehicleOdometer(asset.currentKm!)} km',
      ),
      (
        label: l10n.vehiclesFieldFleetNo,
        value: _present(asset.fleetNumber) ?? l10n.valueNotMeasured,
      ),
    ];

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double horizontalPadding =
            constraints.maxWidth >= 720 ? TpSpace.xxl : TpSpace.lg;
        return Stack(
          children: <Widget>[
            Positioned.fill(
              child: ListView(
                padding: EdgeInsets.fromLTRB(
                  horizontalPadding,
                  TpSpace.md,
                  horizontalPadding,
                  assetCode == null ? TpSpace.xxxl : 92,
                ),
                children: <Widget>[
                  Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 760),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: <Widget>[
                              Container(
                                width: 146,
                                height: 104,
                                clipBehavior: Clip.antiAlias,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  color: palette.surfaceAlt,
                                  borderRadius:
                                      BorderRadius.circular(TpRadius.lg),
                                ),
                                child: photo == null
                                    ? Icon(
                                        vehicleFallbackIcon(asset),
                                        size: 58,
                                        color: palette.primary,
                                      )
                                    : Image.asset(
                                        photo,
                                        width: double.infinity,
                                        height: double.infinity,
                                        fit: BoxFit.cover,
                                        filterQuality: FilterQuality.high,
                                        semanticLabel: asset.displayIdentity,
                                      ),
                              ),
                              const SizedBox(width: TpSpace.lg),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: <Widget>[
                                    TpIdentifierText(
                                      asset.displayIdentity ??
                                          l10n.vehiclesUnknownAsset,
                                      style: text.headlineSmall,
                                    ),
                                    const SizedBox(height: 2),
                                    Row(
                                      children: <Widget>[
                                        if (_present(asset.vehicleType) != null)
                                          Flexible(
                                            child: Text(
                                              asset.vehicleType!.trim(),
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: text.bodyMedium,
                                            ),
                                          ),
                                        if (_present(asset.vehicleType) !=
                                                null &&
                                            _present(asset.status) != null)
                                          const SizedBox(width: TpSpace.sm),
                                        if (_present(asset.status) != null)
                                          TpStatusChip(
                                            status:
                                                vehicleStatusTone(asset.status),
                                            label: asset.status!.trim(),
                                            isCompact: true,
                                          ),
                                      ],
                                    ),
                                    if (_present(asset.site) !=
                                        null) ...<Widget>[
                                      const SizedBox(height: TpSpace.xs),
                                      Text(
                                        asset.site!.trim(),
                                        style: text.labelMedium?.copyWith(
                                          color: palette.textSecondary,
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: TpSpace.md),
                          _AssetMetricGrid(metrics: metrics),
                          const SizedBox(height: TpSpace.md),
                          _AssetTabs(
                            selected: _selectedTab,
                            overviewLabel: l10n.tyreDetailSectionOverview,
                            tyresLabel: l10n.globalSearchSectionTyres,
                            historyLabel: l10n.tabHistory,
                            onSelect: (_AssetDetailTab tab) =>
                                setState(() => _selectedTab = tab),
                          ),
                          const SizedBox(height: TpSpace.md),
                          AnimatedSwitcher(
                            duration: const Duration(milliseconds: 160),
                            child: switch (_selectedTab) {
                              _AssetDetailTab.overview => _OverviewPanel(
                                  key: const ValueKey<String>('overview'),
                                  asset: asset,
                                  fields: fields,
                                  l10n: l10n,
                                ),
                              _AssetDetailTab.tyres => _TyresPanel(
                                  key: const ValueKey<String>('tyres'),
                                  asset: asset,
                                  l10n: l10n,
                                ),
                              _AssetDetailTab.history => _HistoryPanel(
                                  key: const ValueKey<String>('history'),
                                  l10n: l10n,
                                ),
                            },
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (assetCode != null)
              Align(
                alignment: Alignment.bottomCenter,
                child: _StickyAssetActions(
                  reportLabel: ReportIssueCopy.of(context)('title'),
                  workOrderLabel: l10n.workOrderNewTitle,
                  onReportIssue:
                      canReportIssue ? () => _reportIssue(context) : null,
                  onCreateWorkOrder: canCreateWorkOrder
                      ? () => unawaited(
                            showCreateWorkOrderSheet(
                              context,
                              initialAssetNo: assetCode,
                            ),
                          )
                      : null,
                ),
              ),
          ],
        );
      },
    );
  }

  List<(String, String?)> _assetFields() => <(String, String?)>[
        (l10n.vehiclesFieldFleetNo, asset.fleetNumber),
        (l10n.vehiclesFieldType, asset.vehicleType),
        (
          l10n.vehiclesFieldMakeModel,
          _join(<String?>[asset.make, asset.model]),
        ),
        (l10n.vehiclesFieldYear, asset.year?.toString()),
        (
          l10n.vehiclesFieldCurrentKm,
          asset.currentKm == null
              ? null
              : '${formatVehicleOdometer(asset.currentKm!)} km',
        ),
        (l10n.vehiclesFieldOperator, asset.operatorName),
        (l10n.vehiclesFieldDepartment, asset.department),
        (l10n.vehiclesFieldSite, asset.site),
        (l10n.vehiclesFieldRegion, asset.region),
        (l10n.vehiclesFieldCountry, asset.country),
        (l10n.vehiclesFieldTyreSize, asset.tyreSize),
        (l10n.vehiclesFieldRegistration, asset.registrationNo),
      ];

  void _reportIssue(BuildContext context) {
    final String? code = asset.assetNo;
    if (code == null || code.trim().isEmpty) return;
    context.push(
      ReportIssueRoute(
        assetNo: AssetNo(code),
        siteName: asset.site?.trim().isEmpty == false
            ? SiteName(asset.site!.trim())
            : null,
      ).location,
    );
  }

  static String? _join(List<String?> parts) {
    final List<String> present = parts
        .whereType<String>()
        .map((String value) => value.trim())
        .where((String value) => value.isNotEmpty)
        .toList(growable: false);
    return present.isEmpty ? null : present.join(' ');
  }

  static String? _present(String? value) {
    final String trimmed = value?.trim() ?? '';
    return trimmed.isEmpty ? null : trimmed;
  }
}

class _AssetMetricGrid extends StatelessWidget {
  const _AssetMetricGrid({required this.metrics});

  final List<({String label, String value})> metrics;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        for (int i = 0; i < metrics.length; i++) ...<Widget>[
          if (i > 0) const SizedBox(width: TpSpace.sm),
          Expanded(child: _AssetMetricCard(metric: metrics[i])),
        ],
      ],
    );
  }
}

class _AssetMetricCard extends StatelessWidget {
  const _AssetMetricCard({required this.metric});

  final ({String label, String value}) metric;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return TpCard(
      background: palette.surfaceAlt,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(metric.label, maxLines: 1, style: text.labelSmall),
          const SizedBox(height: TpSpace.sm),
          Text(
            metric.value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: text.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _AssetTabs extends StatelessWidget {
  const _AssetTabs({
    required this.selected,
    required this.overviewLabel,
    required this.tyresLabel,
    required this.historyLabel,
    required this.onSelect,
  });

  final _AssetDetailTab selected;
  final String overviewLabel;
  final String tyresLabel;
  final String historyLabel;
  final ValueChanged<_AssetDetailTab> onSelect;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: palette.border)),
      ),
      child: Row(
        children: <Widget>[
          _AssetTabButton(
            key: VehicleDetailScreenKeys.overviewTab,
            label: overviewLabel,
            selected: selected == _AssetDetailTab.overview,
            onTap: () => onSelect(_AssetDetailTab.overview),
          ),
          _AssetTabButton(
            key: VehicleDetailScreenKeys.tyresTab,
            label: tyresLabel,
            selected: selected == _AssetDetailTab.tyres,
            onTap: () => onSelect(_AssetDetailTab.tyres),
          ),
          _AssetTabButton(
            key: VehicleDetailScreenKeys.historyTab,
            label: historyLabel,
            selected: selected == _AssetDetailTab.history,
            onTap: () => onSelect(_AssetDetailTab.history),
          ),
        ],
      ),
    );
  }
}

class _AssetTabButton extends StatelessWidget {
  const _AssetTabButton({
    required this.label,
    required this.selected,
    required this.onTap,
    super.key,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: TpSizing.minTouchTarget),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: selected ? palette.primary : Colors.transparent,
                width: 2,
              ),
            ),
          ),
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: selected ? palette.primary : palette.textSecondary,
                ),
          ),
        ),
      ),
    );
  }
}

class _OverviewPanel extends StatelessWidget {
  const _OverviewPanel({
    required this.asset,
    required this.fields,
    required this.l10n,
    super.key,
  });

  final VehicleAsset asset;
  final List<(String, String?)> fields;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        KeyedSubtree(
          key: VehicleDetailScreenKeys.multiViewBoard,
          child: VehicleMultiViewBoard(
            asset: asset,
            title: l10n.vehiclesMultiViewTitle,
            hint: l10n.vehiclesMultiViewHint,
            zoomLabel: l10n.vehiclesMultiViewZoom,
            closeLabel: l10n.actionClose,
          ),
        ),
        const SizedBox(height: TpSpace.lg),
        _SectionHeading(label: l10n.inspectionConditionLabel),
        const SizedBox(height: TpSpace.sm),
        _AssetTyreMap(asset: asset),
        const SizedBox(height: TpSpace.md),
        _SectionHeading(label: l10n.tabHistory),
        const SizedBox(height: TpSpace.sm),
        TpCard(
          padding: const EdgeInsets.all(TpSpace.md),
          child: Row(
            children: <Widget>[
              Icon(Icons.history_rounded, color: palette.textMuted),
              const SizedBox(width: TpSpace.sm),
              Text(l10n.valueUnavailable),
            ],
          ),
        ),
        const SizedBox(height: TpSpace.lg),
        _SectionHeading(label: l10n.tyreDetailSectionOverview),
        const SizedBox(height: TpSpace.sm),
        TpCard(
          key: VehicleDetailScreenKeys.details,
          padding: EdgeInsets.zero,
          child: Column(
            children: <Widget>[
              for (int i = 0; i < fields.length; i++)
                _FieldRow(
                  label: fields[i].$1,
                  value: fields[i].$2,
                  showDivider: i < fields.length - 1,
                  borderColor: palette.border,
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _TyresPanel extends StatelessWidget {
  const _TyresPanel({required this.asset, required this.l10n, super.key});

  final VehicleAsset asset;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _SectionHeading(label: l10n.inspectionConditionLabel),
        const SizedBox(height: TpSpace.sm),
        _AssetTyreMap(asset: asset),
      ],
    );
  }
}

class _HistoryPanel extends StatelessWidget {
  const _HistoryPanel({required this.l10n, super.key});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      padding: const EdgeInsets.all(TpSpace.lg),
      child: Row(
        children: <Widget>[
          Icon(Icons.history_rounded, color: palette.textMuted),
          const SizedBox(width: TpSpace.sm),
          Text(l10n.valueUnavailable),
        ],
      ),
    );
  }
}

class _AssetTyreMap extends StatelessWidget {
  const _AssetTyreMap({required this.asset});

  final VehicleAsset asset;

  @override
  Widget build(BuildContext context) {
    final String vehicleType = asset.vehicleType?.trim() ?? '';
    final List<String> positions = diagramPositions(vehicleType, asset.assetNo);
    return KeyedSubtree(
      key: VehicleDetailScreenKeys.tyreMap,
      child: VehicleTyreDiagram(
        vehicleType: vehicleType,
        assetNo: asset.assetNo,
        positions: positions,
        tyreData: const <String, Map<String, Object?>>{},
        width: 150,
        compact: true,
      ),
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label.toUpperCase(),
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: TpPalette.of(context).text,
            fontWeight: FontWeight.w800,
          ),
    );
  }
}

class _StickyAssetActions extends StatelessWidget {
  const _StickyAssetActions({
    required this.reportLabel,
    required this.workOrderLabel,
    required this.onReportIssue,
    required this.onCreateWorkOrder,
  });

  final String reportLabel;
  final String workOrderLabel;
  final VoidCallback? onReportIssue;
  final VoidCallback? onCreateWorkOrder;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.sm,
        TpSpace.lg,
        TpSpace.md,
      ),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(top: BorderSide(color: palette.border)),
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: TpButton.secondary(
              key: VehicleDetailScreenKeys.reportIssue,
              label: reportLabel,
              icon: Icons.warning_amber_rounded,
              onPressed: onReportIssue,
            ),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: TpButton.primary(
              key: VehicleDetailScreenKeys.createWorkOrder,
              label: workOrderLabel,
              icon: Icons.add_box_outlined,
              onPressed: onCreateWorkOrder,
            ),
          ),
        ],
      ),
    );
  }
}

class _FieldRow extends StatelessWidget {
  const _FieldRow({
    required this.label,
    required this.value,
    required this.showDivider,
    required this.borderColor,
  });

  final String label;
  final String? value;
  final bool showDivider;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    // A genuinely unmeasured field renders the design system's own
    // placeholder rather than a blank line or an invented value - spec
    // section 32: a dash, never a fabricated "0" or empty space that reads
    // as a rendering fault.
    final String display = value?.trim().isNotEmpty == true
        ? value!.trim()
        : l10n.valueNotMeasured;

    return Container(
      decoration: showDivider
          ? BoxDecoration(
              border: Border(bottom: BorderSide(color: borderColor)),
            )
          : null,
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.lg,
        vertical: TpSpace.md,
      ),
      child: Row(
        children: <Widget>[
          Expanded(flex: 2, child: Text(label, style: text.labelMedium)),
          Expanded(
            flex: 3,
            child: Text(
              display,
              style: text.bodyLarge,
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }
}
