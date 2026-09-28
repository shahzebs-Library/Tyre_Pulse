/// The Vehicle 360 "Timeline" and "Costs" tab bodies.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/asset_insights_repository.dart';
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart';
import 'package:tyre_pulse/features/assets/domain/asset_timeline.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/asset_financial_report_screen.dart';
import 'package:tyre_pulse/features/assets/presentation/asset_insights_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/widgets/asset_cost_widgets.dart';

@visibleForTesting
abstract final class Vehicle360Keys {
  static const Key timeline = Key('vehicle_360.timeline');
  static const Key timelinePeriod = Key('vehicle_360.timeline.period');
  static const Key timelineFilter = Key('vehicle_360.timeline.filter');
  static const Key timelinePartial = Key('vehicle_360.timeline.partial');
  static const Key costs = Key('vehicle_360.costs');
  static const Key openReport = Key('vehicle_360.open_financial_report');
  static Key event(int index) => Key('vehicle_360.timeline.event.$index');
}

enum _TimelineWindow { last12Months, last90Days, last30Days }

AppError _fallbackError(AppLocalizations l10n) => AppError(
      kind: AppErrorKind.unknown,
      message: l10n.stateErrorMessage,
      isRetryable: true,
    );

class AssetTimelinePanel extends ConsumerStatefulWidget {
  const AssetTimelinePanel({required this.asset, this.clock, super.key});

  final VehicleAsset asset;
  final DateTime Function()? clock;

  @override
  ConsumerState<AssetTimelinePanel> createState() => _AssetTimelinePanelState();
}

class _AssetTimelinePanelState extends ConsumerState<AssetTimelinePanel> {
  _TimelineWindow _window = _TimelineWindow.last12Months;
  AssetTimelineFilter _filter = AssetTimelineFilter.all;
  late final DateTime _now = (widget.clock ?? DateTime.now)();

  DateTime get _from => switch (_window) {
        _TimelineWindow.last12Months =>
          DateTime(_now.year - 1, _now.month, _now.day),
        _TimelineWindow.last90Days =>
          DateTime(_now.year, _now.month, _now.day - 89),
        _TimelineWindow.last30Days =>
          DateTime(_now.year, _now.month, _now.day - 29),
      };

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AssetTimelineRequest request = (
      scope: assetScopeFor(widget.asset, ref.watch(activeCountryProvider)),
      from: _from,
    );
    final AsyncValue<AssetTimelineData> data =
        ref.watch(assetTimelineProvider(request));
    final bool canWorkOrders =
        ref.watch(canAccessModuleProvider(ModuleKey.workorders));
    final bool canInspections =
        ref.watch(canAccessModuleProvider(ModuleKey.inspect));
    final bool canAccidents =
        ref.watch(canAccessModuleProvider(ModuleKey.accidents));

    return Column(
      key: Vehicle360Keys.timeline,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: _Menu<_TimelineWindow>(
                key: Vehicle360Keys.timelinePeriod,
                icon: Icons.calendar_month_outlined,
                value: _window,
                values: _TimelineWindow.values,
                labelOf: (_TimelineWindow w) => switch (w) {
                  _TimelineWindow.last12Months => l10n.fleetMockPeriod12m,
                  _TimelineWindow.last90Days => l10n.fleetMockPeriod90d,
                  _TimelineWindow.last30Days => l10n.fleetMockPeriod30d,
                },
                onSelected: (_TimelineWindow w) => setState(() => _window = w),
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: _Menu<AssetTimelineFilter>(
                key: Vehicle360Keys.timelineFilter,
                icon: Icons.tune_rounded,
                value: _filter,
                values: AssetTimelineFilter.values,
                labelOf: (AssetTimelineFilter f) => _filterLabel(l10n, f),
                onSelected: (AssetTimelineFilter f) =>
                    setState(() => _filter = f),
              ),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        data.when(
          loading: () => const SizedBox(height: 200, child: TpLoadingState()),
          error: (Object error, StackTrace _) => SizedBox(
            height: 280,
            child: TpErrorState(
              error: error is AppError ? error : _fallbackError(l10n),
              onRetry: () => ref.invalidate(assetTimelineProvider(request)),
            ),
          ),
          data: (AssetTimelineData d) {
            final List<AssetTimelineEvent> events = d.events
                .where((AssetTimelineEvent e) => e.matches(_filter))
                .toList();
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                if (d.failedSources.isNotEmpty)
                  Padding(
                    key: Vehicle360Keys.timelinePartial,
                    padding: const EdgeInsets.only(bottom: TpSpace.sm),
                    child: TpStatusChip(
                      status: TpStatus.warning,
                      label: l10n.fleetMockTimelinePartial,
                    ),
                  ),
                if (events.isEmpty)
                  SizedBox(
                    height: 240,
                    child: TpEmptyState(
                      icon: Icons.history_rounded,
                      title: l10n.fleetMockTimelineEmptyTitle,
                      message: l10n.fleetMockTimelineEmptyBody,
                    ),
                  )
                else
                  TpCard(
                    padding: const EdgeInsets.symmetric(
                      horizontal: TpSpace.md,
                      vertical: TpSpace.xs,
                    ),
                    child: Column(
                      children: <Widget>[
                        for (int i = 0; i < events.length; i++)
                          _TimelineRow(
                            key: Vehicle360Keys.event(i),
                            event: events[i],
                            isLast: i == events.length - 1,
                            onTap: _tapFor(
                              events[i],
                              canWorkOrders: canWorkOrders,
                              canInspections: canInspections,
                              canAccidents: canAccidents,
                            ),
                          ),
                      ],
                    ),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }

  /// A row opens its record only when a real detail route exists AND the
  /// person may open it; otherwise it is not tappable at all (no chevron).
  VoidCallback? _tapFor(
    AssetTimelineEvent e, {
    required bool canWorkOrders,
    required bool canInspections,
    required bool canAccidents,
  }) {
    final String? id = e.recordId;
    if (id == null) return null;
    final String? location = switch (e.kind) {
      AssetTimelineKind.workOrder when canWorkOrders =>
        WorkOrderDetailRoute(workOrderId: WorkOrderId(id)).location,
      AssetTimelineKind.inspection when canInspections =>
        InspectionDetailRoute(inspectionId: InspectionId(id)).location,
      AssetTimelineKind.accident when canAccidents =>
        AccidentDetailRoute(accidentId: AccidentId(id)).location,
      _ => null,
    };
    if (location == null) return null;
    return () => context.push(location);
  }
}

String _filterLabel(AppLocalizations l10n, AssetTimelineFilter f) =>
    switch (f) {
      AssetTimelineFilter.all => l10n.fleetMockTimelineAll,
      AssetTimelineFilter.workOrders => l10n.fleetMockTimelineWorkOrders,
      AssetTimelineFilter.inspections => l10n.fleetMockTimelineInspections,
      AssetTimelineFilter.washes => l10n.fleetMockTimelineWashes,
      AssetTimelineFilter.tyres => l10n.fleetMockTimelineTyres,
      AssetTimelineFilter.accidents => l10n.fleetMockTimelineAccidents,
    };

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({
    required this.event,
    required this.isLast,
    required this.onTap,
    super.key,
  });

  final AssetTimelineEvent event;
  final bool isLast;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String locale = Localizations.localeOf(context).toString();
    final (IconData icon, TpStatus tone, String title) = switch (event.kind) {
      AssetTimelineKind.workOrder => (
          Icons.build_outlined,
          assetStatusIsOpen(event.status) == true
              ? TpStatus.warning
              : TpStatus.ok,
          l10n.fleetMockEventWorkOrder,
        ),
      AssetTimelineKind.inspection => (
          Icons.fact_check_outlined,
          TpStatus.info,
          l10n.fleetMockEventInspection,
        ),
      AssetTimelineKind.wash => (
          Icons.water_drop_outlined,
          TpStatus.info,
          l10n.fleetMockEventWash,
        ),
      AssetTimelineKind.tyreFitted => (
          Icons.tire_repair_outlined,
          TpStatus.ok,
          l10n.fleetMockEventTyreFitted,
        ),
      AssetTimelineKind.tyreRemoved => (
          Icons.tire_repair_outlined,
          TpStatus.warning,
          l10n.fleetMockEventTyreRemoved,
        ),
      AssetTimelineKind.accident => (
          Icons.report_gmailerrorred_outlined,
          TpStatus.critical,
          l10n.fleetMockEventAccident,
        ),
    };
    final TpStatusColors colors = palette.forStatus(tone);
    final List<String> meta = <String>[
      if (event.reference != null) event.reference!,
      if (event.detail != null) event.detail!,
      if (event.person != null) event.person!,
      if (event.status != null) event.status!,
      if (event.photoCount != null)
        l10n.fleetMockEventPhotos(event.photoCount!),
    ];
    final bool rtl = Directionality.of(context) == TextDirection.rtl;

    return InkWell(
      onTap: onTap,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            SizedBox(
              width: 40,
              child: Column(
                children: <Widget>[
                  const SizedBox(height: TpSpace.sm),
                  Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      color: colors.soft,
                      shape: BoxShape.circle,
                      border: Border.all(color: colors.base),
                    ),
                    child: Icon(icon, size: 18, color: colors.base),
                  ),
                  if (!isLast)
                    Expanded(
                      child: Container(width: 2, color: palette.border),
                    ),
                ],
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      DateFormat('d MMM yyyy', locale).format(event.date),
                      style: text.labelSmall
                          ?.copyWith(color: palette.textSecondary),
                    ),
                    Text(
                      title,
                      style: text.bodyMedium
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    if (meta.isNotEmpty)
                      Text(
                        meta.join(' · '),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: text.labelSmall
                            ?.copyWith(color: palette.textSecondary),
                      ),
                  ],
                ),
              ),
            ),
            if (onTap != null)
              Center(
                child: Icon(
                  rtl
                      ? Icons.chevron_left_rounded
                      : Icons.chevron_right_rounded,
                  color: palette.text,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Menu<T> extends StatelessWidget {
  const _Menu({
    required this.icon,
    required this.value,
    required this.values,
    required this.labelOf,
    required this.onSelected,
    super.key,
  });

  final IconData icon;
  final T value;
  final List<T> values;
  final String Function(T) labelOf;
  final ValueChanged<T> onSelected;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return PopupMenuButton<T>(
      onSelected: onSelected,
      itemBuilder: (BuildContext context) => <PopupMenuEntry<T>>[
        for (final T v in values)
          PopupMenuItem<T>(value: v, child: Text(labelOf(v))),
      ],
      child: Container(
        height: TpSizing.minTouchTarget,
        padding: const EdgeInsets.symmetric(horizontal: TpSpace.md),
        decoration: BoxDecoration(
          color: palette.surface,
          border: Border.all(color: palette.borderStrong),
          borderRadius: BorderRadius.circular(TpRadius.md),
        ),
        child: Row(
          children: <Widget>[
            Icon(icon, size: 18, color: palette.text),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                labelOf(value),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
            Icon(Icons.keyboard_arrow_down_rounded, color: palette.text),
          ],
        ),
      ),
    );
  }
}

/// The "Financial snapshot" card: year-to-date totals, cost per km,
/// downtime, the composition bar and the link to the full report.
class AssetCostSnapshotPanel extends ConsumerWidget {
  const AssetCostSnapshotPanel({required this.asset, this.clock, super.key});

  final VehicleAsset asset;
  final DateTime Function()? clock;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final DateTime now = (clock ?? DateTime.now)();
    final AssetFinancialRequest request = (
      scope: assetScopeFor(asset, ref.watch(activeCountryProvider)),
      period: AssetReportPeriod.yearToDate.resolve(now),
    );
    final AsyncValue<AssetFinancialData> data =
        ref.watch(assetFinancialsProvider(request));

    return TpCard(
      key: Vehicle360Keys.costs,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            '${l10n.fleetMockSnapshotTitle} · ${l10n.fleetMockPeriodYtd}',
            style: text.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: TpSpace.md),
          data.when(
            loading: () => const SizedBox(height: 120, child: TpLoadingState()),
            error: (Object error, StackTrace _) => SizedBox(
              height: 240,
              child: TpErrorState(
                error: error is AppError ? error : _fallbackError(l10n),
                onRetry: () => ref.invalidate(assetFinancialsProvider(request)),
              ),
            ),
            data: (AssetFinancialData d) {
              final AssetFinancialSummary s = d.summary;
              if (s.isMixed) {
                return Text(
                  l10n.fleetMockFinMixedBody(s.mixedCurrencies.join(', ')),
                  style: text.bodySmall,
                );
              }
              final String? currency = s.currency;
              if (!s.hasCost || currency == null) {
                return Text(
                  l10n.fleetMockFinNoCostBody,
                  style: text.bodySmall?.copyWith(color: palette.textMuted),
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(
                        child: AssetKpiTile(
                          label: l10n.fleetMockFinMaintenance,
                          value: assetMoneyLabel(currency, s.maintenance),
                        ),
                      ),
                      Expanded(
                        child: AssetKpiTile(
                          label: l10n.fleetMockFinCostPerKm,
                          value: s.costPerKm == null
                              ? l10n.fleetMockFinNotMeasurable
                              : assetMoneyLabel(
                                  currency,
                                  s.costPerKm!,
                                  decimals: 2,
                                ),
                        ),
                      ),
                      Expanded(
                        child: AssetKpiTile(
                          label: l10n.fleetMockFinDowntime,
                          value: s.downtimeHours == null
                              ? l10n.fleetMockFinNotRecorded
                              : l10n.fleetMockFinHours(
                                  formatAssetMoney(s.downtimeHours!),
                                ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: TpSpace.md),
                  AssetCompositionBar(summary: s, currency: currency),
                ],
              );
            },
          ),
          const Divider(height: TpSpace.xl),
          InkWell(
            key: Vehicle360Keys.openReport,
            onTap: asset.hasNavigableAssetNo
                ? () => Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (BuildContext _) =>
                            AssetFinancialReportScreen(asset: asset),
                      ),
                    )
                : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
              child: Row(
                children: <Widget>[
                  Icon(Icons.insights_outlined, color: palette.primary),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Text(
                      l10n.fleetMockOpenFinReport,
                      style: text.labelLarge?.copyWith(
                        color: palette.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  Icon(
                    Directionality.of(context) == TextDirection.rtl
                        ? Icons.chevron_left_rounded
                        : Icons.chevron_right_rounded,
                    color: palette.text,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
