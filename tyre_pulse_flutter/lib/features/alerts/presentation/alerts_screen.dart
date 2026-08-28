library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/alerts/alerts_providers.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';
import 'package:tyre_pulse/features/alerts/presentation/alerts_copy.dart';

class AlertsScreen extends ConsumerStatefulWidget {
  const AlertsScreen({required this.backFallback, super.key});

  final String backFallback;

  @override
  ConsumerState<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends ConsumerState<AlertsScreen> {
  TyreAlertFilter _filter = TyreAlertFilter.all;

  @override
  Widget build(BuildContext context) {
    final AlertsCopy copy = AlertsCopy.of(context);
    final AsyncValue<List<TyreAlert>> alerts = ref.watch(tyreAlertsProvider);

    return TpScaffold(
      backFallback: widget.backFallback,
      appBar: TpAppBar(
        title: copy('title'),
        showBack: false,
        actions: <Widget>[
          IconButton(
            key: const Key('alerts.filter.action'),
            tooltip: copy('all'),
            icon: const Icon(Icons.filter_alt_outlined),
            onPressed: () => unawaited(_openFilterSheet(copy)),
          ),
          const SizedBox(width: TpSpace.xs),
        ],
      ),
      body: Column(
        children: <Widget>[
          _AlertTabs(
            selected: _filter,
            copy: copy,
            onSelected: _selectFilter,
          ),
          Expanded(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 760),
              child: alerts.when(
                loading: () => const TpLoadingState(),
                error: (Object error, StackTrace stackTrace) => _AlertsFailure(
                  error: error,
                  copy: copy,
                  onRetry: _refresh,
                ),
                data: (List<TyreAlert> items) => _AlertsList(
                  items: items
                      .where((TyreAlert item) => item.matches(_filter))
                      .toList(growable: false),
                  hasFilter: _filter != TyreAlertFilter.all,
                  copy: copy,
                  onRefresh: _refresh,
                  onOpen: _openInspection,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _selectFilter(TyreAlertFilter filter) {
    if (_filter == filter) return;
    setState(() => _filter = filter);
  }

  Future<void> _refresh() => ref.refresh(tyreAlertsProvider.future);

  void _openInspection(TyreAlert alert) {
    final String? assetNo = alert.assetNo;
    if (assetNo == null) return;
    GoRouter.of(context).push(
      NewInspectionRoute(
        siteName: alert.site == null ? null : SiteName(alert.site!),
        assetNo: AssetNo(assetNo),
      ).location,
    );
  }

  Future<void> _openFilterSheet(AlertsCopy copy) async {
    final TyreAlertFilter? selected = await TpBottomSheet.show<TyreAlertFilter>(
      context: context,
      title: copy('title'),
      builder: (BuildContext sheetContext) => _AlertFilterSheet(
        selected: _filter,
        copy: copy,
      ),
    );
    if (!mounted || selected == null) return;
    _selectFilter(selected);
  }
}

class _AlertTabs extends StatelessWidget {
  const _AlertTabs({
    required this.selected,
    required this.copy,
    required this.onSelected,
  });

  final TyreAlertFilter selected;
  final AlertsCopy copy;
  final ValueChanged<TyreAlertFilter> onSelected;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return ColoredBox(
      color: palette.surface,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.md,
          TpSpace.sm,
          TpSpace.md,
          TpSpace.sm,
        ),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: palette.surfaceAlt,
            borderRadius: BorderRadius.circular(TpRadius.sm),
            border: Border.all(color: palette.border),
          ),
          child: Row(
            children: <Widget>[
              for (final TyreAlertFilter filter in TyreAlertFilter.values)
                Expanded(
                  child: _AlertTab(
                    filter: filter,
                    label: _filterLabel(copy, filter),
                    selected: selected == filter,
                    onTap: () => onSelected(filter),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AlertTab extends StatelessWidget {
  const _AlertTab({
    required this.filter,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final TyreAlertFilter filter;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected ? palette.primary : Colors.transparent,
        borderRadius: BorderRadius.circular(TpRadius.sm),
        child: InkWell(
          key: Key('alerts.filter.${filter.name}'),
          onTap: onTap,
          borderRadius: BorderRadius.circular(TpRadius.sm),
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: TpSizing.minTouchTarget,
            ),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: TpSpace.xs),
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: selected
                            ? palette.onPrimary
                            : palette.textSecondary,
                        fontWeight:
                            selected ? FontWeight.w800 : FontWeight.w600,
                      ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AlertsList extends StatelessWidget {
  const _AlertsList({
    required this.items,
    required this.hasFilter,
    required this.copy,
    required this.onRefresh,
    required this.onOpen,
  });

  final List<TyreAlert> items;
  final bool hasFilter;
  final AlertsCopy copy;
  final Future<void> Function() onRefresh;
  final ValueChanged<TyreAlert> onOpen;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: items.isEmpty
          ? ListView(
              key: const Key('alerts.empty.list'),
              physics: const AlwaysScrollableScrollPhysics(),
              children: <Widget>[
                SizedBox(
                  height: MediaQuery.sizeOf(context).height * 0.58,
                  child: TpEmptyState(
                    icon: Icons.notifications_none_rounded,
                    title: copy('emptyTitle'),
                    message:
                        hasFilter ? copy('emptyFilter') : copy('emptyTitle'),
                  ),
                ),
              ],
            )
          : ListView.separated(
              key: const Key('alerts.list'),
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(
                TpSpace.md,
                TpSpace.xs,
                TpSpace.md,
                TpSpace.xxxl,
              ),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: TpSpace.sm),
              itemBuilder: (BuildContext context, int index) {
                final TyreAlert alert = items[index];
                return _AlertCard(
                  alert: alert,
                  copy: copy,
                  onTap: alert.assetNo == null ? null : () => onOpen(alert),
                );
              },
            ),
    );
  }
}

class _AlertCard extends StatelessWidget {
  const _AlertCard({
    required this.alert,
    required this.copy,
    required this.onTap,
  });

  final TyreAlert alert;
  final AlertsCopy copy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors tone = palette.forStatus(alert.status);
    final String asset = alert.assetNo ?? copy('unknownAsset');
    final bool isRtl = TpDirection.isRtl(context);

    return Semantics(
      container: true,
      label: '${alert.riskLevel}, $asset',
      button: onTap != null,
      child: TpCard(
        onTap: onTap,
        padding: const EdgeInsets.all(TpSpace.md),
        background: palette.surfaceAlt,
        child: Row(
          children: <Widget>[
            DecoratedBox(
              decoration: BoxDecoration(
                color: tone.soft,
                shape: BoxShape.circle,
              ),
              child: SizedBox(
                width: 40,
                height: 40,
                child: Icon(
                  alert.isCritical
                      ? Icons.priority_high_rounded
                      : Icons.warning_amber_rounded,
                  size: 21,
                  color: tone.base,
                ),
              ),
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(
                        child: TpIdentifierText(
                          asset,
                          style:
                              Theme.of(context).textTheme.titleSmall?.copyWith(
                                    fontWeight: FontWeight.w800,
                                  ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (alert.issueDate != null) ...<Widget>[
                        const SizedBox(width: TpSpace.sm),
                        Text(
                          alert.issueDate!,
                          style:
                              Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: palette.textMuted,
                                  ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: TpSpace.xs),
                  _AlertDetailLine(alert: alert, copy: copy),
                  if (alert.treadDepthMm != null) ...<Widget>[
                    const SizedBox(height: TpSpace.xs),
                    Text(
                      '${_formatNumber(alert.treadDepthMm!)} mm',
                      key: Key('alerts.metric.${alert.id}'),
                      textDirection: TextDirection.ltr,
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                            color: tone.base,
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                  ],
                ],
              ),
            ),
            if (onTap != null) ...<Widget>[
              const SizedBox(width: TpSpace.xs),
              Icon(
                isRtl
                    ? Icons.chevron_left_rounded
                    : Icons.chevron_right_rounded,
                color: palette.textMuted,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _AlertDetailLine extends StatelessWidget {
  const _AlertDetailLine({required this.alert, required this.copy});

  final TyreAlert alert;
  final AlertsCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final List<Widget> parts = <Widget>[];
    final String? position = alert.position;
    if (position != null) {
      parts.add(
        Flexible(
          child: TpIdentifierText(
            position,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: palette.textSecondary,
                ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      );
    }
    if (alert.treadDepthMm != null) {
      if (parts.isNotEmpty) {
        parts.add(
          Text(' • ', style: TextStyle(color: palette.textMuted)),
        );
      }
      parts.add(
        Flexible(
          child: Text(
            copy('treadLow'),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: palette.textSecondary,
                ),
          ),
        ),
      );
    }
    final String? fallback = alert.site ?? alert.brand ?? alert.serialNo;
    if (parts.isEmpty && fallback != null) {
      parts.add(
        Flexible(
          child: Text(
            fallback,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: palette.textSecondary,
                ),
          ),
        ),
      );
    }
    if (parts.isEmpty) {
      parts.add(
        Text(
          alert.riskLevel,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: palette.textSecondary,
              ),
        ),
      );
    }
    return Row(children: parts);
  }
}

class _AlertsFailure extends StatelessWidget {
  const _AlertsFailure({
    required this.error,
    required this.copy,
    required this.onRetry,
  });

  final Object error;
  final AlertsCopy copy;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final AppError? source = switch (error) {
      final SupabaseFailure failure => failure.error,
      final AppError appError => appError,
      _ => null,
    };
    if (source?.kind == AppErrorKind.network ||
        (source?.kind == AppErrorKind.server && source!.isRetryable)) {
      return TpBackendUnavailableState(
        detail: copy('loadError'),
        onRetry: () => unawaited(onRetry()),
      );
    }
    return TpErrorState(
      error: AppError(
        kind: source?.kind ?? AppErrorKind.unknown,
        message: copy('loadError'),
        technical: source?.technical,
        cause: source?.cause ?? error,
        isRetryable: true,
      ),
      onRetry: () => unawaited(onRetry()),
    );
  }
}

class _AlertFilterSheet extends StatelessWidget {
  const _AlertFilterSheet({required this.selected, required this.copy});

  final TyreAlertFilter selected;
  final AlertsCopy copy;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          for (final TyreAlertFilter filter in TyreAlertFilter.values)
            ListTile(
              key: Key('alerts.sheet.${filter.name}'),
              contentPadding: EdgeInsets.zero,
              title: Text(_filterLabel(copy, filter)),
              trailing: filter == selected
                  ? Icon(
                      Icons.check_rounded,
                      color: TpPalette.of(context).primary,
                    )
                  : null,
              onTap: () => Navigator.of(context).pop(filter),
            ),
        ],
      ),
    );
  }
}

String _filterLabel(AlertsCopy copy, TyreAlertFilter filter) =>
    switch (filter) {
      TyreAlertFilter.all => copy('all'),
      TyreAlertFilter.critical => copy('critical'),
      TyreAlertFilter.warnings => copy('warnings'),
      TyreAlertFilter.info => copy('info'),
    };

String _formatNumber(num value) {
  final double decimal = value.toDouble();
  return decimal == decimal.truncateToDouble()
      ? decimal.toInt().toString()
      : decimal.toStringAsFixed(1);
}
