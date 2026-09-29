/// The tyre records register: the paged, filterable, admin-only list of
/// `tyre_records`.
///
/// # Gated before a single row is fetched
///
/// `ModuleKey.records` is `ModuleDef.adminOnly` in
/// `core/permissions/module_registry.dart` - a bulk listing with no role
/// default. This screen checks `moduleAccessProvider(ModuleKey.records)`
/// FIRST and returns [TpPermissionDeniedState] without ever reading
/// [tyreRecordsListControllerProvider] when access is denied. A
/// `NotifierProvider` does not run its `build()` - and therefore never
/// calls the repository - until something first reads it, so the gate
/// genuinely runs before any network request is attempted, not merely
/// alongside one. Repository rule (spec section 58, `AGENTS.md`): a refusal
/// is a sentence a person can read, never a spinner and never a redirect -
/// this screen stays put and offers Back.
///
/// # The seven states, and which of them this screen can honestly reach
///
/// - **Loading** - the first page of the active query is in flight.
/// - **Empty** - the query resolved and matched nothing.
/// - **Permission-denied** - see above.
/// - **Backend-unavailable** - the first page failed for a connectivity or
///   server reason (`AppError.kind` network, or server with
///   `isRetryable`). Reassures about queued work, exactly as
///   [TpBackendUnavailableState]'s own doc comment describes - though this
///   register has nothing OFFLINE queued, since it has no write path at
///   all, the wording is still correct: nothing has been lost, the read
///   simply has not succeeded yet.
/// - **Error** - the first page failed for any other reason (a genuine
///   validation, authorization or schema-mismatch failure the mapper in
///   `core/network/supabase_error_mapper.dart` produced).
///
/// [TpOfflineCachedState] and [TpNotConfiguredState] are deliberately NOT
/// reachable here, and that is a considered choice rather than an
/// oversight. This register has no local cache to fall back to - the
/// production inventory states its offline behaviour as "no" - so there is
/// no honest "showing saved data" condition to render; fabricating one
/// would show a timestamp for a snapshot that does not exist. And
/// `tyre_records` is a core table with nothing an organisation can leave
/// unconfigured, so there is no honest "not set up" condition either.
/// Forcing either state to be reachable would mean manufacturing a
/// situation that cannot really occur, which spec section 32's rule against
/// invented data forbids as much for a STATE as for a number.
///
/// # The paging footer
///
/// Once the first page has loaded, "no more pages", "loading the next
/// page" and "the next page failed" are three mutually exclusive FOOTER
/// conditions inside the same list, never full-screen states - see
/// `presentation/state/tyre_records_list_state.dart`'s library comment for
/// why, and `presentation/controllers/tyre_records_list_controller.dart`
/// for how the controller keeps them from ever overlapping.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart' show NumberFormat;
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_query.dart';
import 'package:tyre_pulse/features/records/domain/tyre_risk.dart';
import 'package:tyre_pulse/features/records/presentation/controllers/tyre_records_list_controller.dart';
import 'package:tyre_pulse/features/records/presentation/state/tyre_records_list_state.dart';
import 'package:tyre_pulse/features/records/presentation/tyre_detail_sheet.dart';
import 'package:tyre_pulse/features/records/presentation/tyre_records_export.dart';

/// How close to the bottom (in logical pixels of remaining scroll extent)
/// triggers the next page. Loading a little before the true bottom keeps the
/// list from ever visibly running out while still scrolling.
const double _kLoadMoreTriggerDistance = 240;

class TyreRecordsListScreen extends ConsumerWidget {
  const TyreRecordsListScreen({required this.backFallback, super.key});

  /// Where Back goes when there is no history to pop. Computed by the
  /// registration closure via `TpBackFallbacks.forRoute(route)`, so this
  /// screen never hardcodes its own parent.
  final String backFallback;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AccessDecision decision = ref.watch(
      moduleAccessProvider(ModuleKey.records),
    );

    if (decision.isDenied) {
      return TpScaffold(
        backFallback: backFallback,
        body: TpPermissionDeniedState(
          reason: decision.userMessage,
          onBack: () => Navigator.of(context).maybePop(),
        ),
      );
    }

    // Only reached once access is confirmed - this is the first point at
    // which the controller provider is read, and therefore the first point
    // at which any network call can happen.
    return _TyreRecordsListBody(backFallback: backFallback);
  }
}

class _TyreRecordsListBody extends ConsumerWidget {
  const _TyreRecordsListBody({required this.backFallback});

  final String backFallback;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TyreRecordsListState state = ref.watch(
      tyreRecordsListControllerProvider,
    );
    final TyreRecordsListController controller = ref.read(
      tyreRecordsListControllerProvider.notifier,
    );

    return TpScaffold(
      backFallback: backFallback,
      appBar: TpAppBar(
        title: l10n.recordsTitle,
        subtitle: _subtitle(l10n, state),
        backFallback: backFallback,
        actions: <Widget>[
          IconButton(
            key: TyreRecordsListKeys.scanAction,
            icon: const Icon(Icons.qr_code_scanner_rounded),
            tooltip: l10n.tyreMockScanSerial,
            onPressed: () => context.push(const SerialSearchRoute().location),
          ),
          _ExportButton(state: state),
          _FilterButton(
            activeCount: state.query.activeFilterCount,
            onPressed: () => _openFilterSheet(context),
          ),
        ],
      ),
      bottomNavigationBar: _ScanBar(
        onScan: () => context.push(const SerialSearchRoute().location),
      ),
      body: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(
              TpSpace.lg,
              TpSpace.sm,
              TpSpace.lg,
              0,
            ),
            child: TpSearchField(
              hint: l10n.recordsSearchHint,
              onChanged: controller.updateSearch,
            ),
          ),
          _FilterPillsRow(
            query: state.query,
            controller: controller,
            onOpenSheet: () => _openFilterSheet(context),
          ),
          _StatusTabs(
            selected: state.query.status,
            onSelected: controller.setStatusTab,
          ),
          _ListStatusLine(state: state, controller: controller),
          Expanded(child: _buildBody(state, controller)),
        ],
      ),
    );
  }

  String? _subtitle(AppLocalizations l10n, TyreRecordsListState state) {
    final int? total = state.totalCount;
    if (total != null) {
      final String count = l10n.tyreMockRecordsCount(total);
      final String? country = state.query.country;
      return country == null ? count : '$count · $country';
    }
    return switch (state.phase) {
      TyreRecordsListPhase.loading => l10n.stateLoading,
      TyreRecordsListPhase.failed => null,
      TyreRecordsListPhase.ready => l10n.recordsShownCount(state.items.length),
    };
  }

  /// A switch EXPRESSION rather than a switch statement: exhaustiveness over
  /// [TyreRecordsListPhase] is then enforced by the compiler itself, not by
  /// a reviewer confirming every enum value was covered.
  Widget _buildBody(
    TyreRecordsListState state,
    TyreRecordsListController controller,
  ) {
    return switch (state.phase) {
      TyreRecordsListPhase.loading => const TpLoadingState(),
      TyreRecordsListPhase.failed => _failedBody(state, controller),
      TyreRecordsListPhase.ready => RefreshIndicator(
          onRefresh: controller.refresh,
          child: state.isEmpty
              ? _EmptyBody(query: state.query, controller: controller)
              : _RecordsListView(state: state, controller: controller),
        ),
    };
  }

  Widget _failedBody(
    TyreRecordsListState state,
    TyreRecordsListController controller,
  ) {
    final AppError error = state.loadError ??
        const AppError(
          kind: AppErrorKind.unknown,
          message: 'Something went wrong. Please try again.',
        );
    // A network failure, or a server failure the mapper already marked
    // retryable, reads as "the server could not be reached" rather than as
    // a generic error - see the library comment on why this distinction
    // earns its own state rather than folding into TpErrorState.
    final bool looksLikeBackendUnavailable =
        error.kind == AppErrorKind.network ||
            (error.kind == AppErrorKind.server && error.isRetryable);
    if (looksLikeBackendUnavailable) {
      return TpBackendUnavailableState(onRetry: controller.refresh);
    }
    return TpErrorState(error: error, onRetry: controller.refresh);
  }

  Future<void> _openFilterSheet(BuildContext context) {
    return TpBottomSheet.show<void>(
      context: context,
      builder: (BuildContext sheetContext) => const _FilterSheet(),
    );
  }
}

class _EmptyBody extends ConsumerWidget {
  const _EmptyBody({required this.query, required this.controller});

  final TyreRecordsQuery query;
  final TyreRecordsListController controller;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return ListView(
      // A ListView, not a bare Center, so RefreshIndicator's pull gesture
      // has a scrollable to attach to even when there is nothing to show.
      // `AlwaysScrollableScrollPhysics` is required for that gesture to
      // register at all when the content is shorter than the viewport,
      // which the empty state always is.
      physics: const AlwaysScrollableScrollPhysics(),
      children: <Widget>[
        SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.6,
          child: TpEmptyState(
            title: l10n.recordsEmptyTitle,
            message: l10n.recordsEmptyMessage,
            icon: Icons.layers_outlined,
            actionLabel:
                query.hasActiveFilters ? l10n.recordsClearFilters : null,
            onAction: query.hasActiveFilters ? controller.clearFilters : null,
          ),
        ),
      ],
    );
  }
}

class _RecordsListView extends StatelessWidget {
  const _RecordsListView({required this.state, required this.controller});

  final TyreRecordsListState state;
  final TyreRecordsListController controller;

  @override
  Widget build(BuildContext context) {
    // A general ScrollNotification, not only ScrollEndNotification, so the
    // next page starts loading WHILE the person is still scrolling towards
    // the bottom rather than only once the scroll physically stops - the
    // same responsiveness the production screen gets from
    // `onEndReachedThreshold={0.3}`. Firing on every update this way is
    // safe only because `loadMore()` is idempotent while a fetch is already
    // in flight or none remains - see the controller's own guard.
    return NotificationListener<ScrollNotification>(
      onNotification: (ScrollNotification notification) {
        final ScrollMetrics metrics = notification.metrics;
        final double remaining = metrics.maxScrollExtent - metrics.pixels;
        if (remaining <= _kLoadMoreTriggerDistance) {
          unawaited(controller.loadMore());
        }
        return false;
      },
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.xl,
        ),
        itemCount: state.items.length + 1,
        separatorBuilder: (BuildContext context, int index) =>
            const SizedBox(height: TpSpace.sm),
        itemBuilder: (BuildContext context, int index) {
          if (index == state.items.length) {
            return _PagingFooter(state: state, controller: controller);
          }
          final TyreRecord record = state.items[index];
          return _TyreRecordCard(
            record: record,
            showStatus: state.query.status == null,
            onTap: () => showTyreDetailSheet(context, record),
          );
        },
      ),
    );
  }
}

/// The three mutually exclusive footer conditions: loading the next page,
/// the next page failed, or there is nothing further to load. Exactly one
/// of these (or none, while waiting for the scroll trigger) renders at a
/// time - see the library comment.
class _PagingFooter extends StatelessWidget {
  const _PagingFooter({required this.state, required this.controller});

  final TyreRecordsListState state;
  final TyreRecordsListController controller;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);

    if (state.isLoadingMore) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: TpSpace.lg),
        child: Center(
          child: SizedBox(
            width: TpSizing.iconLg,
            height: TpSizing.iconLg,
            child: CircularProgressIndicator(strokeWidth: 3),
          ),
        ),
      );
    }

    final AppError? loadMoreError = state.loadMoreError;
    if (loadMoreError != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
        child: Column(
          children: <Widget>[
            Text(
              l10n.recordsLoadMoreError,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: palette.textMuted),
            ),
            const SizedBox(height: TpSpace.xs),
            TpButton.text(
              label: l10n.actionRetry,
              onPressed: controller.loadMore,
            ),
          ],
        ),
      );
    }

    if (!state.hasMore) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.lg),
        child: Center(
          child: Text(
            l10n.recordsEndOfList,
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: palette.textMuted),
          ),
        ),
      );
    }

    // hasMore is true and nothing is in flight: about to be triggered by
    // the scroll listener. Nothing to show yet.
    return const SizedBox.shrink();
  }
}

/// Stable keys for the register's mock-parity controls.
abstract final class TyreRecordsListKeys {
  static const Key scanAction = Key('records.scan_action');
  static const Key scanBar = Key('records.scan_bar');
  static const Key exportAction = Key('records.export');
  static const Key statusTabs = Key('records.status_tabs');
  static const Key statusLine = Key('records.status_line');
  static const Key sortButton = Key('records.sort');
  static const Key sitePill = Key('records.site_pill');
  static const Key riskPill = Key('records.risk_pill');
}

final NumberFormat _kmFormat = NumberFormat.decimalPattern('en_US')
  ..maximumFractionDigits = 1;

String _fmtNumber(num value) => _kmFormat.format(value);

/// The tab label for a stored `tyre_records.status` value.
String _statusLabel(AppLocalizations l10n, String? status) => switch (status) {
      null => l10n.tyreMockTabAll,
      kTyreStatusInstalled => l10n.tyreMockTabInstalled,
      kTyreStatusRemoved => l10n.tyreMockTabRemoved,
      kTyreStatusScrapped => l10n.tyreMockTabScrapped,
      _ => status,
    };

TpStatus _statusTone(String? status) => switch (status) {
      kTyreStatusInstalled => TpStatus.ok,
      kTyreStatusScrapped => TpStatus.critical,
      kTyreStatusRemoved => TpStatus.neutral,
      _ => TpStatus.unknown,
    };

class _TyreRecordCard extends StatelessWidget {
  const _TyreRecordCard({
    required this.record,
    required this.showStatus,
    required this.onTap,
  });

  final TyreRecord record;

  /// True on the All tab, where the lifecycle status is not implied by the
  /// tab and has to be read off each row.
  final bool showStatus;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final TpStatus riskStatus = tyreRiskStatus(record.riskLevel);
    final String? code = record.tyrePosition;
    final String? legacyPosition =
        record.position != null && record.position != code
            ? record.position
            : null;
    final bool removedLike = record.status == kTyreStatusRemoved ||
        record.status == kTyreStatusScrapped;

    return TpCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              _TyreAvatar(record: record),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Flexible(
                          child: TpIdentifierText(
                            record.serialNo ??
                                record.assetNo ??
                                l10n.recordsDetailFallbackTitle,
                            style: text.titleMedium
                                ?.copyWith(fontWeight: FontWeight.w800),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (record.riskLevel != null) ...<Widget>[
                          const SizedBox(width: TpSpace.sm),
                          TpStatusChip(
                            status: riskStatus,
                            label: record.riskLevel,
                            isCompact: true,
                          ),
                        ],
                        if (showStatus && record.status != null) ...<Widget>[
                          const SizedBox(width: TpSpace.xs),
                          TpStatusChip(
                            status: _statusTone(record.status),
                            label: _statusLabel(l10n, record.status),
                            isCompact: true,
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _brandAndSize(record),
                      style: text.bodyMedium
                          ?.copyWith(color: palette.textSecondary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: TpSpace.xs),
                    if (record.assetNo != null)
                      _MetaItem(
                        icon: Icons.local_shipping_outlined,
                        text: record.assetNo!,
                        isIdentifier: true,
                      ),
                    if (code != null || legacyPosition != null) ...<Widget>[
                      const SizedBox(height: 2),
                      Row(
                        children: <Widget>[
                          Icon(
                            Icons.location_on_outlined,
                            size: TpSizing.iconSm,
                            color: palette.textMuted,
                          ),
                          const SizedBox(width: TpSpace.xs),
                          if (legacyPosition != null)
                            Flexible(
                              child: Text(
                                legacyPosition,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: text.labelMedium
                                    ?.copyWith(color: palette.textSecondary),
                              ),
                            ),
                          if (code != null) ...<Widget>[
                            if (legacyPosition != null)
                              const SizedBox(width: TpSpace.xs),
                            _CodeChip(code: code),
                          ],
                        ],
                      ),
                    ],
                    if (record.site != null) ...<Widget>[
                      const SizedBox(height: 2),
                      _MetaItem(
                        icon: Icons.business_outlined,
                        text: record.site!,
                      ),
                    ],
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(top: TpSpace.lg),
                child: Icon(
                  Icons.chevron_right,
                  color: palette.textMuted,
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Expanded(
                  child: _Metric(
                    label: l10n.tyreMockMetricFitted,
                    value: record.issueDate,
                  ),
                ),
                const _MetricDivider(),
                Expanded(
                  child: removedLike
                      ? _Metric(
                          label: l10n.tyreMockMetricRemoved,
                          value: record.removalDate,
                        )
                      : record.treadDepth != null
                          ? _Metric(
                              label: l10n.tyreMockMetricTread,
                              value: l10n.tyreDiagramListTreadValue(
                                _fmtNumber(record.treadDepth!),
                              ),
                            )
                          : _Metric(
                              label: l10n.recordsKmFitment,
                              value: record.kmAtFitment == null
                                  ? null
                                  : l10n.tyreMockKmValue(
                                      _fmtNumber(record.kmAtFitment!),
                                    ),
                            ),
                ),
                const _MetricDivider(),
                Expanded(
                  child: _Metric(
                    label: l10n.tyreMockMetricKmRun,
                    value: record.kmRun == null
                        ? null
                        : l10n.tyreMockKmValue(_fmtNumber(record.kmRun!)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _brandAndSize(TyreRecord record) {
    final List<String> parts = <String>[
      if (record.brand != null) record.brand!,
      if (record.size != null) record.size!,
      if (record.size == null && record.category != null) record.category!,
    ];
    return parts.isEmpty ? '-' : parts.join(' ');
  }
}

/// The circular tyre mark with the lifecycle badge on its corner: a check
/// while installed, a minus once removed, a cross once scrapped. The risk
/// level takes the badge instead when the tyre has been risk-scored.
class _TyreAvatar extends StatelessWidget {
  const _TyreAvatar({required this.record});

  final TyreRecord record;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatus tone = record.riskLevel != null
        ? tyreRiskStatus(record.riskLevel)
        : _statusTone(record.status);
    final IconData badge = switch (tone) {
      TpStatus.ok => Icons.check_rounded,
      TpStatus.critical when record.riskLevel == null => Icons.close_rounded,
      TpStatus.neutral => Icons.remove_rounded,
      TpStatus.unknown => Icons.remove_rounded,
      _ => Icons.priority_high_rounded,
    };
    return Stack(
      clipBehavior: Clip.none,
      children: <Widget>[
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: palette.surfaceAlt,
            border: Border.all(color: palette.border),
          ),
          alignment: Alignment.center,
          child: Icon(
            Icons.tire_repair_outlined,
            size: 36,
            color: palette.text,
          ),
        ),
        if (record.riskLevel != null || record.status != null)
          PositionedDirectional(
            end: -2,
            bottom: -2,
            child: Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                color: palette.forStatus(tone).base,
                shape: BoxShape.circle,
                border: Border.all(color: palette.surface, width: 2),
              ),
              alignment: Alignment.center,
              child: Icon(
                badge,
                size: 14,
                color: palette.forStatus(tone).onBase,
              ),
            ),
          ),
      ],
    );
  }
}

class _CodeChip extends StatelessWidget {
  const _CodeChip({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.info.soft,
        borderRadius: BorderRadius.circular(TpRadius.sm),
        border: Border.all(color: palette.info.base, width: 0.8),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
        child: TpIdentifierText(
          code,
          maxLines: 1,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: palette.info.onSoft,
                fontWeight: FontWeight.w700,
              ),
        ),
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});

  final String label;

  /// Null renders `-`: a value nobody recorded is never shown as zero.
  final String? value;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.xs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: text.labelSmall?.copyWith(color: palette.textMuted),
          ),
          const SizedBox(height: 2),
          Text(
            value ?? '-',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textDirection: TextDirection.ltr,
            style: text.titleSmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: value == null ? palette.textMuted : palette.text,
            ),
          ),
        ],
      ),
    );
  }
}

class _MetricDivider extends StatelessWidget {
  const _MetricDivider();

  @override
  Widget build(BuildContext context) => VerticalDivider(
        width: TpSpace.md,
        thickness: 1,
        color: TpPalette.of(context).border,
      );
}

/// Site and Risk as always-visible pills, like the mock's dropdown row.
/// Tapping either opens the filter sheet; a set filter shows its value and
/// "Clear filters" appears beside them.
class _FilterPillsRow extends StatelessWidget {
  const _FilterPillsRow({
    required this.query,
    required this.controller,
    required this.onOpenSheet,
  });

  final TyreRecordsQuery query;
  final TyreRecordsListController controller;
  final VoidCallback onOpenSheet;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(TpSpace.lg, TpSpace.sm, TpSpace.lg, 0),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: <Widget>[
            _DropdownPill(
              key: TyreRecordsListKeys.sitePill,
              label: l10n.tyreMockSitePill(query.site ?? l10n.tyreMockTabAll),
              isActive: query.site != null,
              onTap: onOpenSheet,
            ),
            const SizedBox(width: TpSpace.sm),
            _DropdownPill(
              key: TyreRecordsListKeys.riskPill,
              label: l10n.tyreMockRiskPill(
                query.riskLevel ?? l10n.tyreMockTabAll,
              ),
              isActive: query.riskLevel != null,
              onTap: onOpenSheet,
            ),
            if (query.hasActiveFilters) ...<Widget>[
              const SizedBox(width: TpSpace.xs),
              TpButton.text(
                label: l10n.recordsClearFilters,
                isCompact: true,
                onPressed: controller.clearFilters,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DropdownPill extends StatelessWidget {
  const _DropdownPill({
    required this.label,
    required this.isActive,
    required this.onTap,
    super.key,
  });

  final String label;
  final bool isActive;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color border = isActive ? palette.primary : palette.border;
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: Material(
        color: palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          side: BorderSide(color: border),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(TpRadius.md),
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: TpSizing.minTouchTarget,
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: TpSpace.md),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(
                    label,
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: isActive ? palette.primary : palette.text,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  const SizedBox(width: TpSpace.xs),
                  Icon(
                    Icons.keyboard_arrow_down_rounded,
                    size: TpSizing.iconMd,
                    color: palette.textSecondary,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Installed / Removed / Scrapped / All, over the statuses the table holds.
class _StatusTabs extends StatelessWidget {
  const _StatusTabs({required this.selected, required this.onSelected});

  final String? selected;
  final ValueChanged<String?> onSelected;

  static const List<String?> _tabs = <String?>[
    kTyreStatusInstalled,
    kTyreStatusRemoved,
    kTyreStatusScrapped,
    null,
  ];

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return Container(
      key: TyreRecordsListKeys.statusTabs,
      margin: const EdgeInsets.only(top: TpSpace.sm),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: palette.border)),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: TpSpace.md),
        child: Row(
          children: <Widget>[
            for (final String? status in _tabs)
              _StatusTab(
                label: _statusLabel(l10n, status),
                isSelected: selected == status,
                onTap: () => onSelected(status),
              ),
          ],
        ),
      ),
    );
  }
}

class _StatusTab extends StatelessWidget {
  const _StatusTab({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      button: true,
      selected: isSelected,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(
            minHeight: TpSizing.minTouchTarget,
          ),
          padding: const EdgeInsets.symmetric(horizontal: TpSpace.md),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: isSelected ? palette.primary : Colors.transparent,
                width: 3,
              ),
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  color: isSelected ? palette.text : palette.textSecondary,
                  fontWeight: isSelected ? FontWeight.w800 : FontWeight.w500,
                ),
          ),
        ),
      ),
    );
  }
}

/// "Showing installed tyres · Loaded 10:48" and the sort choice.
class _ListStatusLine extends StatelessWidget {
  const _ListStatusLine({required this.state, required this.controller});

  final TyreRecordsListState state;
  final TyreRecordsListController controller;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String showing = switch (state.query.status) {
      kTyreStatusInstalled => l10n.tyreMockShowingInstalled,
      kTyreStatusRemoved => l10n.tyreMockShowingRemoved,
      kTyreStatusScrapped => l10n.tyreMockShowingScrapped,
      _ => l10n.tyreMockShowingAll,
    };
    final DateTime? loadedAt = state.loadedAt;
    final String line = loadedAt == null
        ? showing
        : '$showing · ${l10n.tyreMockLoadedAt(
            MaterialLocalizations.of(context).formatTimeOfDay(
              TimeOfDay.fromDateTime(loadedAt),
            ),
          )}';
    final String sortLabel = state.query.sort == TyreRecordsSort.oldestFitted
        ? l10n.tyreMockSortOldest
        : l10n.tyreMockSortNewest;
    return Padding(
      key: TyreRecordsListKeys.statusLine,
      padding: const EdgeInsetsDirectional.fromSTEB(
        TpSpace.lg,
        TpSpace.xs,
        TpSpace.sm,
        0,
      ),
      child: Row(
        children: <Widget>[
          Icon(
            loadedAt == null
                ? Icons.cloud_queue_rounded
                : Icons.cloud_done_outlined,
            size: TpSizing.iconSm,
            color: loadedAt == null ? palette.textMuted : palette.ok.base,
          ),
          const SizedBox(width: TpSpace.xs),
          Expanded(
            child: Text(
              line,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: text.labelMedium?.copyWith(color: palette.textSecondary),
            ),
          ),
          PopupMenuButton<TyreRecordsSort>(
            key: TyreRecordsListKeys.sortButton,
            tooltip: l10n.tyreMockSortTooltip,
            initialValue: state.query.sort,
            onSelected: controller.setSort,
            itemBuilder: (BuildContext context) =>
                <PopupMenuEntry<TyreRecordsSort>>[
              PopupMenuItem<TyreRecordsSort>(
                value: TyreRecordsSort.newestFitted,
                child: Text(l10n.tyreMockSortNewest),
              ),
              PopupMenuItem<TyreRecordsSort>(
                value: TyreRecordsSort.oldestFitted,
                child: Text(l10n.tyreMockSortOldest),
              ),
            ],
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                minHeight: TpSizing.minTouchTarget,
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: TpSpace.sm),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      sortLabel,
                      style: text.labelLarge?.copyWith(
                        color: palette.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Icon(
                      Icons.keyboard_arrow_down_rounded,
                      size: TpSizing.iconMd,
                      color: palette.primary,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The fixed bottom action: scan a tyre serial. The mock's second button,
/// "Add tyre record", is deliberately absent: the app has no tyre-record
/// create path (tyres enter the register through tyre changes and imports),
/// and a button that could only fail would be a control that does nothing.
class _ScanBar extends StatelessWidget {
  const _ScanBar({required this.onScan});

  final VoidCallback onScan;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(top: BorderSide(color: palette.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.sm,
            TpSpace.lg,
            TpSpace.sm,
          ),
          child: TpButton.secondary(
            key: TyreRecordsListKeys.scanBar,
            label: l10n.tyreMockScanSerial,
            icon: Icons.qr_code_scanner_rounded,
            isFullWidth: true,
            onPressed: onScan,
          ),
        ),
      ),
    );
  }
}

class _MetaItem extends StatelessWidget {
  const _MetaItem({
    required this.icon,
    required this.text,
    this.isIdentifier = false,
  });

  final IconData icon;
  final String text;

  /// Asset numbers and serials draw through [TpIdentifierText] so they keep
  /// their left-to-right order under Arabic and Urdu.
  final bool isIdentifier;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: TpSizing.iconSm, color: palette.textMuted),
        const SizedBox(width: TpSpace.xs),
        if (isIdentifier)
          TpIdentifierText(
            text,
            maxLines: 1,
            style: Theme.of(context)
                .textTheme
                .labelMedium
                ?.copyWith(color: palette.textSecondary),
          )
        else
          Text(
            text,
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: palette.textMuted),
          ),
      ],
    );
  }
}

class _FilterButton extends StatelessWidget {
  const _FilterButton({required this.activeCount, required this.onPressed});

  final int activeCount;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool hasActive = activeCount > 0;

    return Semantics(
      button: true,
      label: l10n.recordsFilterTitle,
      value: l10n.recordsActiveFilters(activeCount),
      child: Padding(
        padding: const EdgeInsets.only(right: TpSpace.sm),
        child: Stack(
          clipBehavior: Clip.none,
          children: <Widget>[
            IconButton(
              icon: const Icon(Icons.tune),
              tooltip: l10n.recordsFilterTitle,
              onPressed: onPressed,
              color: hasActive ? palette.primary : palette.textSecondary,
            ),
            if (hasActive)
              Positioned(
                top: 4,
                right: 2,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: palette.critical.base,
                    shape: BoxShape.circle,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(3),
                    child: Text(
                      '$activeCount',
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        color: palette.critical.onBase,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _FilterSheet extends ConsumerWidget {
  const _FilterSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TyreRecordsListState state = ref.watch(
      tyreRecordsListControllerProvider,
    );
    final TyreRecordsListController controller = ref.read(
      tyreRecordsListControllerProvider.notifier,
    );

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            l10n.recordsFilterTitle,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: TpSpace.lg),
          Text(
            l10n.recordsRiskLevel,
            style: Theme.of(context).textTheme.labelMedium,
          ),
          const SizedBox(height: TpSpace.sm),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              for (final String level in kTyreRiskLevels)
                _TogglePill(
                  label: level,
                  status: tyreRiskStatus(level),
                  isSelected: state.query.riskLevel == level,
                  onTap: () => controller.setRiskFilter(
                    state.query.riskLevel == level ? null : level,
                  ),
                ),
            ],
          ),
          if (state.availableSites.isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.lg),
            Text(
              l10n.recordsSite,
              style: Theme.of(context).textTheme.labelMedium,
            ),
            const SizedBox(height: TpSpace.sm),
            SizedBox(
              height: 44,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: state.availableSites.length,
                separatorBuilder: (BuildContext context, int index) =>
                    const SizedBox(width: TpSpace.sm),
                itemBuilder: (BuildContext context, int index) {
                  final String site = state.availableSites[index];
                  return _TogglePill(
                    label: site,
                    status: TpStatus.info,
                    isSelected: state.query.site == site,
                    onTap: () => controller.setSiteFilter(
                      state.query.site == site ? null : site,
                    ),
                  );
                },
              ),
            ),
          ],
          const SizedBox(height: TpSpace.xl),
          TpButton.primary(
            label: l10n.recordsApplyFilters,
            isFullWidth: true,
            onPressed: () => Navigator.of(context).maybePop(),
          ),
          TpButton.text(
            label: l10n.recordsClearFilters,
            isFullWidth: true,
            onPressed: () {
              controller.clearFilters();
              unawaited(Navigator.of(context).maybePop());
            },
          ),
        ],
      ),
    );
  }
}

class _TogglePill extends StatelessWidget {
  const _TogglePill({
    required this.label,
    required this.status,
    required this.isSelected,
    required this.onTap,
  });

  final String label;
  final TpStatus status;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: isSelected,
      label: label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(TpRadius.pill),
        child: TpStatusChip(
          status: isSelected ? status : TpStatus.neutral,
          label: label,
          icon: isSelected ? Icons.check : null,
        ),
      ),
    );
  }
}

/// The app-bar Export action from the owner's mock. Shares a PDF of the rows
/// loaded on this device under the active filters, and the file says how many
/// of the server's total that is (see `tyre_records_export.dart`). Disabled
/// until at least one row has loaded - there is nothing honest to export
/// before that.
class _ExportButton extends StatefulWidget {
  const _ExportButton({required this.state});

  final TyreRecordsListState state;

  @override
  State<_ExportButton> createState() => _ExportButtonState();
}

class _ExportButtonState extends State<_ExportButton> {
  bool _busy = false;

  Future<void> _export() async {
    if (_busy) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ScaffoldMessengerState? messenger =
        ScaffoldMessenger.maybeOf(context);
    final List<TyreRecord> records = widget.state.items;
    final int? total = widget.state.totalCount;
    setState(() => _busy = true);
    try {
      final AppLocalizations en =
          await AppLocalizations.delegate.load(const Locale('en'));
      final pw.Document document = buildTyreRecordsPdf(
        records: records,
        totalCount: total,
        l10n: en,
      );
      await Printing.sharePdf(
        bytes: await document.save(),
        filename: 'tyre-records.pdf',
      );
    } on Object {
      messenger?.showSnackBar(
        SnackBar(content: Text(l10n.tyreRecordsExportError)),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return IconButton(
      key: TyreRecordsListKeys.exportAction,
      icon: const Icon(Icons.ios_share_rounded),
      tooltip: l10n.tyreRecordsExportAction,
      onPressed: widget.state.hasContent && !_busy ? _export : null,
    );
  }
}
