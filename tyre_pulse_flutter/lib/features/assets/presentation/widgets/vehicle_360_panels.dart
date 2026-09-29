/// The Vehicle 360 "Timeline", "Costs" and "Documents" tab bodies.
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
import 'package:tyre_pulse/features/assets/domain/asset_360_facts.dart';
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
  static const Key costsIncomplete = Key('vehicle_360.costs.incomplete');
  static const Key openReport = Key('vehicle_360.open_financial_report');
  static const Key documents = Key('vehicle_360.documents');
  static const Key documentsEmpty = Key('vehicle_360.documents.empty');
  static Key document(int index) => Key('vehicle_360.documents.$index');
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
    final Set<AssetTimelineFilter> visibleSources =
        ref.watch(assetTimelineSourcesProvider);
    // A filter for a source the person may not see is not offered at all.
    final List<AssetTimelineFilter> filters = <AssetTimelineFilter>[
      AssetTimelineFilter.all,
      for (final AssetTimelineFilter f in AssetTimelineFilter.values)
        if (f != AssetTimelineFilter.all && visibleSources.contains(f)) f,
    ];
    final AssetTimelineFilter filter =
        filters.contains(_filter) ? _filter : AssetTimelineFilter.all;

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
                value: filter,
                values: filters,
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
                .where((AssetTimelineEvent e) => e.matches(filter))
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
    final bool? open = assetStatusIsOpen(event.status);
    final (IconData icon, TpStatus tone) = switch (event.kind) {
      AssetTimelineKind.workOrder => (
          Icons.build_outlined,
          open == true ? TpStatus.critical : TpStatus.ok,
        ),
      AssetTimelineKind.inspection => (
          Icons.tire_repair_outlined,
          TpStatus.warning,
        ),
      AssetTimelineKind.wash => (Icons.water_drop_outlined, TpStatus.info),
      AssetTimelineKind.tyreFitted => (
          Icons.tire_repair_outlined,
          TpStatus.ok,
        ),
      AssetTimelineKind.tyreRemoved => (
          Icons.tire_repair_outlined,
          TpStatus.warning,
        ),
      AssetTimelineKind.accident => (
          Icons.shield_outlined,
          open == false ? TpStatus.info : TpStatus.critical,
        ),
    };
    final TpStatusColors colors = palette.forStatus(tone);
    final String title = assetTimelineTitle(l10n, event);
    final List<_Meta> meta = _assetTimelineMeta(l10n, event);
    final String date = DateFormat('d MMM yyyy', locale).format(event.date);
    final String spoken = <String>[
      date,
      title,
      for (final _Meta m in meta) m.text,
    ].join(', ');

    return Semantics(
      button: onTap != null,
      label: spoken,
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: TpSizing.minTouchTarget),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                SizedBox(
                  width: 44,
                  child: Column(
                    children: <Widget>[
                      const SizedBox(height: TpSpace.sm),
                      Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: palette.surface,
                          shape: BoxShape.circle,
                          border: Border.all(color: colors.base, width: 1.5),
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
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
                    decoration: isLast
                        ? null
                        : BoxDecoration(
                            border: Border(
                              bottom: BorderSide(color: palette.border),
                            ),
                          ),
                    child: Row(
                      children: <Widget>[
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(
                                date,
                                style: text.labelSmall
                                    ?.copyWith(color: palette.textSecondary),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                title,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: text.bodyMedium?.copyWith(
                                  fontWeight: FontWeight.w800,
                                  color: palette.text,
                                ),
                              ),
                              if (meta.isNotEmpty) ...<Widget>[
                                const SizedBox(height: 2),
                                _MetaLine(meta: meta),
                              ],
                            ],
                          ),
                        ),
                        // The document icon and chevron are drawn only on a
                        // row that really opens its record: they are part of
                        // the row's tap target, never a second control.
                        if (onTap != null) ...<Widget>[
                          const SizedBox(width: TpSpace.sm),
                          Icon(
                            Icons.description_outlined,
                            size: 22,
                            color: palette.info.base,
                          ),
                          const SizedBox(width: TpSpace.xs),
                          Icon(
                            Icons.chevron_right_rounded,
                            color: palette.text,
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One item on a timeline row's meta line. [dot] paints the status dot the
/// mock shows before an open work order; [icon] a leading glyph.
@immutable
class _Meta {
  const _Meta(this.text, {this.dot, this.icon});

  final String text;
  final TpStatus? dot;
  final IconData? icon;
}

class _MetaLine extends StatelessWidget {
  const _MetaLine({required this.meta});

  final List<_Meta> meta;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextStyle? style = Theme.of(context).textTheme.labelSmall?.copyWith(
          color: palette.textSecondary,
        );
    return Text.rich(
      TextSpan(
        style: style,
        children: <InlineSpan>[
          for (int i = 0; i < meta.length; i++) ...<InlineSpan>[
            if (i > 0) const TextSpan(text: '  |  '),
            if (meta[i].dot != null)
              WidgetSpan(
                alignment: PlaceholderAlignment.middle,
                child: Padding(
                  padding: const EdgeInsetsDirectional.only(end: 4),
                  child: Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: palette.forStatus(meta[i].dot!).base,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
              ),
            if (meta[i].icon != null)
              WidgetSpan(
                alignment: PlaceholderAlignment.middle,
                child: Padding(
                  padding: const EdgeInsetsDirectional.only(end: 3),
                  child: Icon(
                    meta[i].icon,
                    size: 13,
                    color: palette.textSecondary,
                  ),
                ),
              ),
            TextSpan(text: meta[i].text),
          ],
        ],
      ),
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
    );
  }
}

/// The row title, built from the record itself: a work order's own
/// description, "Tyre inspection completed", "Tyre fitted at LHF1",
/// "Accident case ACC-2026-0148 closed". Falls back to the kind label when
/// the record carries nothing more specific.
@visibleForTesting
String assetTimelineTitle(AppLocalizations l10n, AssetTimelineEvent e) {
  final bool done = assetStatusIsOpen(e.status) == false;
  return switch (e.kind) {
    AssetTimelineKind.workOrder =>
      e.description ?? e.detail ?? l10n.fleetMockEventWorkOrder,
    AssetTimelineKind.inspection =>
      done ? l10n.fleet360EventInspectionDone : l10n.fleetMockEventInspection,
    AssetTimelineKind.wash =>
      done ? l10n.fleet360EventWashDone : l10n.fleetMockEventWash,
    AssetTimelineKind.tyreFitted => e.detail == null
        ? l10n.fleetMockEventTyreFitted
        : l10n.fleet360EventTyreFittedAt(e.detail!),
    AssetTimelineKind.tyreRemoved => e.detail == null
        ? l10n.fleetMockEventTyreRemoved
        : l10n.fleet360EventTyreRemovedFrom(e.detail!),
    AssetTimelineKind.accident => e.reference == null
        ? l10n.fleetMockEventAccident
        : (done
            ? l10n.fleet360EventAccidentCaseClosed(e.reference!)
            : l10n.fleet360EventAccidentCase(e.reference!)),
  };
}

/// The meta line under the title. Only recorded values appear; money is
/// deliberately absent here because none of these rows carries a currency.
List<_Meta> _assetTimelineMeta(AppLocalizations l10n, AssetTimelineEvent e) {
  final bool? open = assetStatusIsOpen(e.status);
  return switch (e.kind) {
    AssetTimelineKind.workOrder => <_Meta>[
        if (e.status != null)
          _Meta(e.status!, dot: open == null ? null : _dot(open)),
        if (e.reference != null)
          _Meta(e.reference!, icon: Icons.description_outlined),
        // A work order titled by its description still shows its type.
        if (e.description != null && e.detail != null) _Meta(e.detail!),
        if (e.person != null) _Meta(e.person!),
        if (e.hours != null)
          _Meta(
            l10n.fleetMockFinHours(_hours(e.hours!)),
            icon: Icons.hourglass_empty_rounded,
          ),
      ],
    AssetTimelineKind.inspection => <_Meta>[
        if (e.person != null) _Meta(e.person!),
        if (e.reference != null)
          _Meta(e.reference!, icon: Icons.description_outlined),
        if (e.status != null && open != false) _Meta(e.status!),
      ],
    AssetTimelineKind.wash => <_Meta>[
        if (e.detail != null) _Meta(e.detail!),
        if (e.person != null) _Meta(e.person!),
        if (e.photoCount != null)
          _Meta(
            l10n.fleetMockEventPhotos(e.photoCount!),
            icon: Icons.image_outlined,
          ),
      ],
    AssetTimelineKind.tyreFitted || AssetTimelineKind.tyreRemoved => <_Meta>[
        if (e.reference != null) _Meta(l10n.fleet360EventSerial(e.reference!)),
        if (e.status != null) _Meta(e.status!),
      ],
    AssetTimelineKind.accident => <_Meta>[
        if (e.status != null && open != false)
          _Meta(e.status!, dot: open == null ? null : _dot(open)),
        if (e.detail != null) _Meta(e.detail!),
      ],
  };
}

/// The status dot: red while open, green once closed.
TpStatus _dot(bool open) => open ? TpStatus.critical : TpStatus.ok;

/// Hours without a trailing ".0" for a whole figure.
String _hours(double hours) => formatAssetMoney(
      hours,
      decimals: hours == hours.roundToDouble() ? 0 : 1,
    );

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
            l10n.fleet360SnapshotTitle(now.year.toString()),
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
              if (d.isIncomplete) {
                // A capped read totals a prefix of the ledger; publishing it
                // would understate the asset's cost. Refuse the figures.
                return Text(
                  key: Vehicle360Keys.costsIncomplete,
                  l10n.assetsFixFinIncompleteBody(d.truncatedAt!),
                  style: text.bodySmall?.copyWith(
                    color: palette.warning.onSoft,
                  ),
                );
              }
              if (s.hasUnlabelledCurrency) {
                return Text(
                  l10n.assetsFixFinUnlabelledBody(s.unlabelledLineCount),
                  style: text.bodySmall,
                );
              }
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
                          label: l10n.fleet360TotalMaintenance,
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
                    Icons.chevron_right_rounded,
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

/// The "Documents" tab: the permits recorded on this asset's
/// `vehicle_fleet` row (registration, insurance, operating card, driver
/// licence), each with its issue and expiry date and an expiry state.
///
/// Only recorded permits are listed. A permit with no number and no dates is
/// left out, and an asset with none shows an honest empty state rather than
/// four blank rows that would read as documents on file. No uploaded files
/// are listed: no per-asset document store exists in the schema.
class AssetDocumentsPanel extends ConsumerWidget {
  const AssetDocumentsPanel({required this.asset, this.clock, super.key});

  final VehicleAsset asset;
  final DateTime Function()? clock;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<Map<String, dynamic>?> row =
        ref.watch(assetDocumentsRowProvider(asset.id));
    final DateTime now = (clock ?? DateTime.now)();
    return KeyedSubtree(
      key: Vehicle360Keys.documents,
      child: row.when(
        loading: () => const SizedBox(height: 160, child: TpLoadingState()),
        error: (Object error, StackTrace _) => SizedBox(
          height: 280,
          child: TpErrorState(
            error: error is AppError ? error : _fallbackError(l10n),
            onRetry: () => ref.invalidate(assetDocumentsRowProvider(asset.id)),
          ),
        ),
        data: (Map<String, dynamic>? data) {
          final List<AssetDocument> docs = data == null
              ? const <AssetDocument>[]
              : assetDocumentsFromRow(data);
          if (docs.isEmpty) {
            return SizedBox(
              key: Vehicle360Keys.documentsEmpty,
              height: 240,
              child: TpEmptyState(
                icon: Icons.folder_open_outlined,
                title: l10n.fleet360DocsEmptyTitle,
                message: l10n.fleet360DocsEmptyBody,
              ),
            );
          }
          return TpCard(
            padding: const EdgeInsets.symmetric(
              horizontal: TpSpace.md,
              vertical: TpSpace.xs,
            ),
            child: Column(
              children: <Widget>[
                for (int i = 0; i < docs.length; i++)
                  _DocumentRow(
                    key: Vehicle360Keys.document(i),
                    document: docs[i],
                    now: now,
                    showDivider: i < docs.length - 1,
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _DocumentRow extends StatelessWidget {
  const _DocumentRow({
    required this.document,
    required this.now,
    required this.showDivider,
    super.key,
  });

  final AssetDocument document;
  final DateTime now;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String locale = Localizations.localeOf(context).toString();
    final DateFormat day = DateFormat('d MMM yyyy', locale);
    final String title = switch (document.kind) {
      AssetDocumentKind.registration => l10n.fleet360DocRegistration,
      AssetDocumentKind.insurance => l10n.fleet360DocInsurance,
      AssetDocumentKind.operatingCard => l10n.fleet360DocOperatingCard,
      AssetDocumentKind.driverLicence => l10n.fleet360DocDriverLicence,
    };
    final AssetDocumentState state = document.stateOn(now);
    final (TpStatus tone, String stateLabel) = switch (state) {
      AssetDocumentState.valid => (TpStatus.ok, l10n.fleet360DocValid),
      AssetDocumentState.expiringSoon => (
          TpStatus.warning,
          l10n.fleet360DocExpiringSoon,
        ),
      AssetDocumentState.expired => (
          TpStatus.critical,
          l10n.fleet360DocExpired,
        ),
      AssetDocumentState.noExpiry => (
          TpStatus.unknown,
          l10n.fleet360DocNoExpiry,
        ),
    };
    final List<String> lines = <String>[
      if (document.reference != null) document.reference!,
      if (document.issued != null)
        l10n.fleet360DocIssued(day.format(document.issued!)),
      if (document.expires != null)
        l10n.fleet360DocExpires(day.format(document.expires!)),
    ];
    return Container(
      constraints: const BoxConstraints(minHeight: TpSizing.minTouchTarget),
      padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
      decoration: showDivider
          ? BoxDecoration(
              border: Border(bottom: BorderSide(color: palette.border)),
            )
          : null,
      child: Row(
        children: <Widget>[
          Icon(Icons.description_outlined, color: palette.info.base),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  title,
                  style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w800),
                ),
                for (final String line in lines)
                  Text(
                    line,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: text.labelSmall?.copyWith(
                      color: palette.textSecondary,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          TpStatusChip(status: tone, label: stateLabel, isCompact: true),
        ],
      ),
    );
  }
}
