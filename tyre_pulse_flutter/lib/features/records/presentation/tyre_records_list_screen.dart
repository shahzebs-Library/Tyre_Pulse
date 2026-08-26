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
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
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
          _FilterButton(
            activeCount: state.query.activeFilterCount,
            onPressed: () => _openFilterSheet(context),
          ),
        ],
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
          if (state.query.hasActiveFilters)
            _ActiveFilterChips(query: state.query, controller: controller),
          Expanded(child: _buildBody(state, controller)),
        ],
      ),
    );
  }

  String? _subtitle(AppLocalizations l10n, TyreRecordsListState state) {
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
    final AppError error =
        state.loadError ??
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
            actionLabel: query.hasActiveFilters
                ? l10n.recordsClearFilters
                : null,
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
              style: Theme.of(context).textTheme.bodyMedium
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
            style: Theme.of(context).textTheme.labelSmall
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

class _TyreRecordCard extends StatelessWidget {
  const _TyreRecordCard({required this.record, required this.onTap});

  final TyreRecord record;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TpStatus status = tyreRiskStatus(record.riskLevel);

    return TpCard(
      onTap: onTap,
      borderColor: record.riskLevel == null
          ? null
          : palette.forStatus(status).base,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: TpIdentifierText(
                        record.assetNo ?? l10n.recordsDetailFallbackTitle,
                        style: Theme.of(context).textTheme.titleMedium,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (record.riskLevel != null) ...<Widget>[
                      const SizedBox(width: TpSpace.sm),
                      TpStatusChip(
                        status: status,
                        label: record.riskLevel,
                        isCompact: true,
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: TpSpace.xs),
                Text(
                  _brandAndSerial(record),
                  style: Theme.of(context).textTheme.bodyMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: TpSpace.xs),
                Wrap(
                  spacing: TpSpace.md,
                  runSpacing: TpSpace.xs,
                  children: <Widget>[
                    if (record.site != null)
                      _MetaItem(
                        icon: Icons.location_on_outlined,
                        text: record.site!,
                      ),
                    if (record.issueDate != null)
                      _MetaItem(
                        icon: Icons.event_outlined,
                        text: record.issueDate!,
                      ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Icon(Icons.chevron_right, color: palette.textMuted),
        ],
      ),
    );
  }

  String _brandAndSerial(TyreRecord record) {
    final List<String> parts = <String>[
      if (record.brand != null) record.brand!,
      if (record.serialNo != null) record.serialNo!,
    ];
    return parts.isEmpty ? '-' : parts.join(' · ');
  }
}

class _MetaItem extends StatelessWidget {
  const _MetaItem({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: TpSizing.iconSm, color: palette.textMuted),
        const SizedBox(width: TpSpace.xs),
        Text(
          text,
          style: Theme.of(context).textTheme.labelSmall
              ?.copyWith(color: palette.textMuted),
        ),
      ],
    );
  }
}

class _ActiveFilterChips extends StatelessWidget {
  const _ActiveFilterChips({required this.query, required this.controller});

  final TyreRecordsQuery query;
  final TyreRecordsListController controller;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(TpSpace.lg, TpSpace.sm, TpSpace.lg, 0),
      child: Wrap(
        spacing: TpSpace.xs,
        runSpacing: TpSpace.xs,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          if (query.site != null)
            _RemovableChip(
              label: query.site!,
              onRemoved: () => controller.setSiteFilter(null),
            ),
          if (query.riskLevel != null)
            _RemovableChip(
              label: query.riskLevel!,
              status: tyreRiskStatus(query.riskLevel),
              onRemoved: () => controller.setRiskFilter(null),
            ),
          TpButton.text(
            label: l10n.recordsClearFilters,
            isCompact: true,
            onPressed: controller.clearFilters,
          ),
        ],
      ),
    );
  }
}

class _RemovableChip extends StatelessWidget {
  const _RemovableChip({
    required this.label,
    required this.onRemoved,
    this.status = TpStatus.neutral,
  });

  final String label;
  final TpStatus status;
  final VoidCallback onRemoved;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors colors = palette.forStatus(status);
    return InkWell(
      onTap: onRemoved,
      borderRadius: BorderRadius.circular(TpRadius.pill),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.soft,
          borderRadius: BorderRadius.circular(TpRadius.pill),
          border: Border.all(color: colors.base, width: TpBorderWidth.hairline),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: TpSpace.md,
            vertical: TpSpace.xs,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                label,
                style: Theme.of(context).textTheme.labelMedium
                    ?.copyWith(color: colors.onSoft),
              ),
              const SizedBox(width: TpSpace.xs),
              Icon(Icons.close, size: TpSizing.iconSm, color: colors.onSoft),
            ],
          ),
        ),
      ),
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
