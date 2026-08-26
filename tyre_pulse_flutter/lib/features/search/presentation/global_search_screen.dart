/// The global cross-entity search screen - spec section 34.
///
/// One box that resolves a typed term against asset number, registration,
/// chassis number, fleet number, tyre serial, work order number and
/// inspection reference all at once, backed by
/// `GlobalSearchController`/`GlobalSearchState` - see that controller's own
/// library comment for why a plain (non-autoDispose) `NotifierProvider` is
/// what makes "search state must survive back navigation" true by
/// construction, and why one failing identifier-type lookup does not blank
/// the other three.
///
/// # Accident reference is not here, and that is expected
///
/// The spec also names "accident reference" as a seventh identifier type.
/// No Flutter accidents feature or repository exists yet in this port, so
/// there is nothing verified for this screen to call - see
/// `data/global_search_repository.dart`'s own library comment for why a
/// bespoke direct query against the `accidents` table was deliberately not
/// written to fill that gap. This screen's UI has no accident section
/// because the state it reads never carries accident results; that is a
/// scope boundary, not an oversight.
///
/// # This screen is not reachable through the real router yet
///
/// `widget.route` is a [GlobalSearchRoute], which is presently a structurally
/// complete but functionally INERT route class - see
/// `domain/global_search_route.dart`'s own doc comment for exactly what a
/// human needs to add to the forbidden router files to make it live, and
/// `global_search_screen_registrations.dart` for the (also inert until then)
/// screen-registry entry this screen ships under.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/database/app_database.dart' show RecentSearch;
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';

import 'package:tyre_pulse/features/search/domain/global_search_route.dart';
import 'package:tyre_pulse/features/search/domain/global_search_state.dart';
import 'package:tyre_pulse/features/search/domain/search_result.dart';
import 'package:tyre_pulse/features/search/presentation/global_search_controller.dart';

class GlobalSearchScreen extends ConsumerStatefulWidget {
  const GlobalSearchScreen({required this.route, super.key});

  final GlobalSearchRoute route;

  @override
  ConsumerState<GlobalSearchScreen> createState() => _GlobalSearchScreenState();
}

class _GlobalSearchScreenState extends ConsumerState<GlobalSearchScreen> {
  final TextEditingController _searchController = TextEditingController();
  bool _didAutoSearch = false;

  @override
  void initState() {
    super.initState();

    // The persisted controller state is the source of truth for what to
    // show - a plain return visit to this screen must repaint whatever was
    // already typed and already found, not a blank box. `widget.route
    // .initialQuery` only matters when it names something DIFFERENT from
    // what state already holds, which is the "deep-linked into a fresh
    // term" case, not the "user pressed back and came here again" case.
    final GlobalSearchState persisted = ref.read(
      globalSearchControllerProvider,
    );
    final String? routeQuery = widget.route.initialQuery;
    final bool hasRouteQuery =
        routeQuery != null && routeQuery.trim().isNotEmpty;
    final String seed = hasRouteQuery ? routeQuery : persisted.query;
    if (seed.isNotEmpty) {
      _searchController.text = seed;
    }

    if (hasRouteQuery && routeQuery.trim() != persisted.query.trim()) {
      // Deferred to after the first frame for the same reason
      // `SerialSearchScreen.initState` defers its own prefill search:
      // mutating provider state synchronously from initState risks
      // Riverpod's "modified a provider while the widget tree was
      // building" assertion. `mounted`/`_didAutoSearch` stop a stray
      // extra frame from re-running the search a second time.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || _didAutoSearch) return;
        _didAutoSearch = true;
        // `searchNow` is synchronous (`void`, not `Future<void>` - see
        // `global_search_controller.dart`), so there is nothing here to
        // `unawaited(...)`; that wrapper does not accept a `void`
        // expression.
        ref.read(globalSearchControllerProvider.notifier).searchNow(routeQuery);
      });
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _handleQueryChanged(String value) {
    ref.read(globalSearchControllerProvider.notifier).onQueryChanged(value);
  }

  void _runSearch([String? raw]) {
    ref
        .read(globalSearchControllerProvider.notifier)
        .searchNow(raw ?? _searchController.text);
  }

  void _selectRecent(RecentSearch entry) {
    setState(() {
      _searchController
        ..text = entry.term
        ..selection = TextSelection.collapsed(offset: entry.term.length);
    });
    ref.read(globalSearchControllerProvider.notifier).selectRecent(entry);
  }

  /// Navigates to the real, already-registered destination for a tapped
  /// result. Every branch reuses an existing route class exactly as
  /// `SerialSearchScreen._inspectTyre` already does for
  /// `NewInspectionRoute` - none of these are invented here.
  ///
  /// Tyres deliberately land on [SerialSearchRoute] rather than a
  /// standalone tyre detail screen, because no such screen exists in this
  /// port - `SerialSearchRoute` is that identifier type's own real
  /// destination, which is exactly the spec's own fallback rule: "if an
  /// entity type has no detail screen, route to its list/search screen
  /// with the term available rather than a dead end."
  void _openResult(SearchResultItem item) {
    if (item is AssetSearchResult) {
      final VehiclesRoute target = VehiclesRoute(
        assetNo: AssetNo(item.assetNo),
      );
      GoRouter.of(context).go(target.location);
      return;
    }
    if (item is TyreSearchResult) {
      final SerialSearchRoute target = SerialSearchRoute(
        tyreSerial: TyreSerial(item.serialNo),
      );
      GoRouter.of(context).go(target.location);
      return;
    }
    if (item is WorkOrderSearchResult) {
      final WorkOrderDetailRoute target = WorkOrderDetailRoute(
        workOrderId: WorkOrderId(item.id),
      );
      GoRouter.of(context).go(target.location);
      return;
    }
    if (item is InspectionSearchResult) {
      final InspectionDetailRoute target = InspectionDetailRoute(
        inspectionId: InspectionId(item.id),
      );
      GoRouter.of(context).go(target.location);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final GlobalSearchState state = ref.watch(globalSearchControllerProvider);

    ref.listen<GlobalSearchState>(globalSearchControllerProvider, (
      GlobalSearchState? previous,
      GlobalSearchState next,
    ) {
      final AppError? error = next.lastError;
      if (error == null || identical(error, previous?.lastError)) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(error.message)));
    });

    return TpScaffold(
      backFallback: TpRoutePaths.home,
      appBar: TpAppBar(
        title: l10n.globalSearchTitle,
        subtitle: l10n.globalSearchSubtitle,
        backFallback: TpRoutePaths.home,
      ),
      body: ListView(
        padding: const EdgeInsets.all(TpSpace.lg),
        children: <Widget>[
          _SearchBar(
            controller: _searchController,
            onChanged: _handleQueryChanged,
            onSubmitted: (String value) => _runSearch(value),
          ),
          const SizedBox(height: TpSpace.lg),
          _ResultArea(
            state: state,
            onRetry: () => _runSearch(),
            onSelectRecent: _selectRecent,
            onOpenResult: _openResult,
          ),
        ],
      ),
    );
  }
}

class _SearchBar extends StatelessWidget {
  const _SearchBar({
    required this.controller,
    required this.onChanged,
    required this.onSubmitted,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final ValueChanged<String> onSubmitted;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          TpSearchField(
            controller: controller,
            hint: l10n.globalSearchPlaceholder,
            autofocus: true,
            onChanged: onChanged,
            onSubmitted: onSubmitted,
          ),
          const SizedBox(height: TpSpace.sm),
          Text(
            l10n.globalSearchHelp,
            style: Theme.of(context).textTheme.labelSmall,
          ),
        ],
      ),
    );
  }
}

class _ResultArea extends StatelessWidget {
  const _ResultArea({
    required this.state,
    required this.onRetry,
    required this.onSelectRecent,
    required this.onOpenResult,
  });

  final GlobalSearchState state;
  final VoidCallback onRetry;
  final ValueChanged<RecentSearch> onSelectRecent;
  final ValueChanged<SearchResultItem> onOpenResult;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    switch (state.phase) {
      case GlobalSearchPhase.searching:
        return TpLoadingState(message: l10n.globalSearchSearching);
      case GlobalSearchPhase.error:
        return TpErrorState(
          error: state.lastError ?? _unknownError,
          onRetry: onRetry,
        );
      case GlobalSearchPhase.empty:
        return TpEmptyState(
          icon: Icons.search_off,
          title: l10n.globalSearchEmptyTitle,
          message: l10n.globalSearchEmptyMessage,
        );
      case GlobalSearchPhase.results:
        return _ResultsList(state: state, onOpenResult: onOpenResult);
      case GlobalSearchPhase.idle:
        if (state.recentSearches.isEmpty) {
          return TpEmptyState(
            icon: Icons.search,
            title: l10n.globalSearchIdleTitle,
            message: l10n.globalSearchIdleMessage,
          );
        }
        return _RecentSearchesList(
          entries: state.recentSearches,
          onSelect: onSelectRecent,
        );
    }
  }
}

/// Only reachable if [GlobalSearchState.phase] is
/// [GlobalSearchPhase.error] without [GlobalSearchState.lastError] set,
/// which the controller never actually does - kept as a last-resort
/// fallback rather than a null assertion, mirroring
/// `serial_search_screen.dart`'s own `_unknownError` for the same reason.
const AppError _unknownError = AppError(
  kind: AppErrorKind.unknown,
  message: 'Something went wrong. Please try again.',
);

class _RecentSearchesList extends StatelessWidget {
  const _RecentSearchesList({required this.entries, required this.onSelect});

  final List<RecentSearch> entries;
  final ValueChanged<RecentSearch> onSelect;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.only(bottom: TpSpace.sm),
          child: Text(
            l10n.globalSearchRecentSectionTitle,
            style: text.labelMedium,
          ),
        ),
        for (final RecentSearch entry in entries) ...<Widget>[
          TpCard(
            padding: const EdgeInsets.symmetric(
              horizontal: TpSpace.lg,
              vertical: TpSpace.md,
            ),
            onTap: () => onSelect(entry),
            child: Row(
              children: <Widget>[
                const Icon(Icons.history, size: TpSizing.iconMd),
                const SizedBox(width: TpSpace.md),
                Expanded(
                  child: TpIdentifierText(entry.term, style: text.bodyLarge),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.sm),
        ],
      ],
    );
  }
}

class _ResultsList extends StatelessWidget {
  const _ResultsList({required this.state, required this.onOpenResult});

  final GlobalSearchState state;
  final ValueChanged<SearchResultItem> onOpenResult;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.only(bottom: TpSpace.md),
          child: Text(
            l10n.globalSearchResultsCount(state.totalResultCount),
            style: text.labelMedium,
          ),
        ),
        if (state.failedSources.isNotEmpty) ...<Widget>[
          _SourcesFailedNotice(message: l10n.globalSearchSourceFailedNotice),
          const SizedBox(height: TpSpace.md),
        ],
        if (state.assets.isNotEmpty)
          _ResultSection<AssetSearchResult>(
            title: l10n.globalSearchSectionAssets,
            icon: Icons.local_shipping_outlined,
            items: state.assets,
            onOpenResult: onOpenResult,
          ),
        if (state.tyres.isNotEmpty)
          _ResultSection<TyreSearchResult>(
            title: l10n.globalSearchSectionTyres,
            icon: Icons.confirmation_number_outlined,
            items: state.tyres,
            onOpenResult: onOpenResult,
          ),
        if (state.workOrders.isNotEmpty)
          _ResultSection<WorkOrderSearchResult>(
            title: l10n.globalSearchSectionWorkOrders,
            icon: Icons.build_circle_outlined,
            items: state.workOrders,
            onOpenResult: onOpenResult,
          ),
        if (state.inspections.isNotEmpty)
          _ResultSection<InspectionSearchResult>(
            title: l10n.globalSearchSectionInspections,
            icon: Icons.assignment_outlined,
            items: state.inspections,
            onOpenResult: onOpenResult,
          ),
      ],
    );
  }
}

class _ResultSection<T extends SearchResultItem> extends StatelessWidget {
  const _ResultSection({
    required this.title,
    required this.icon,
    required this.items,
    required this.onOpenResult,
  });

  final String title;
  final IconData icon;
  final List<T> items;
  final ValueChanged<SearchResultItem> onOpenResult;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.only(bottom: TpSpace.sm),
            child: Text(title, style: text.labelMedium),
          ),
          for (final T item in items) ...<Widget>[
            _ResultRow(icon: icon, item: item, onTap: () => onOpenResult(item)),
            const SizedBox(height: TpSpace.sm),
          ],
        ],
      ),
    );
  }
}

class _ResultRow extends StatelessWidget {
  const _ResultRow({
    required this.icon,
    required this.item,
    required this.onTap,
  });

  final IconData icon;
  final SearchResultItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    final TpPalette palette = TpPalette.of(context);

    return TpCard(
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.lg,
        vertical: TpSpace.md,
      ),
      onTap: onTap,
      child: Row(
        children: <Widget>[
          Icon(icon, size: TpSizing.iconMd, color: palette.textSecondary),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TpIdentifierText(item.title, style: text.bodyLarge),
                Text(item.subtitle, style: text.labelSmall),
              ],
            ),
          ),
          Icon(
            Icons.chevron_right,
            size: TpSizing.iconMd,
            color: palette.textSecondary,
          ),
        ],
      ),
    );
  }
}

class _SourcesFailedNotice extends StatelessWidget {
  const _SourcesFailedNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors colors = palette.forStatus(TpStatus.warning);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              Icons.info_outline,
              size: TpSizing.iconMd,
              color: colors.onSoft,
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                message,
                style: Theme.of(
                  context,
                ).textTheme.bodyMedium?.copyWith(color: colors.onSoft),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
