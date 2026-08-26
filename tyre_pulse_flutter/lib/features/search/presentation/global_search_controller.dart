/// Controller for global cross-entity search - spec section 34: "asset
/// number, registration, chassis, fleet number, tyre serial, work order,
/// accident reference, inspection reference" in one box, with recent
/// searches saved locally and state that survives back navigation.
///
/// # Why every identifier type is tried in parallel, not detected first
///
/// A typed term carries no tag saying which of the seven kinds it is, and
/// guessing wrong would mean either asking the user to pick a category
/// first (extra friction the spec does not ask for) or committing to one
/// guess and missing a real match of a different kind. So this controller
/// does not classify the term at all - `GlobalSearchRepository`'s FOUR
/// methods are called TOGETHER, each against its own already-verified,
/// server- or cache-indexed lookup (see that file's own library comment
/// for exactly which mechanism backs which identifier type), and whatever
/// comes back is grouped by kind for display. That is what keeps this an
/// indexed multi-lookup and not "a raw client-side substring scan of
/// everything", which is the one thing this feature was explicitly told
/// not to build.
///
/// # Why one failing source does not blank the other three
///
/// The four lookups are independent data sources with independent failure
/// modes - a debounced live-search box fires on every keystroke, so a
/// single transient failure in ONE of the four (say, the work-order query,
/// which is the one identifier type with no pre-existing repository method
/// backing it - see `data/global_search_repository.dart`) should not wipe
/// out three perfectly good result groups and paint a scary error banner
/// mid-typing. So each source's failure is caught INDIVIDUALLY and
/// recorded in [GlobalSearchState.failedSources] rather than propagated as
/// a whole-search error; the search is only reported as failed
/// ([GlobalSearchPhase.error]) when EVERY source failed, which in practice
/// means "no connection" or "no signed-in workspace" rather than one
/// source being briefly unavailable. A failed source is never silently
/// folded into "no matches" - see [GlobalSearchState.failedSources]'s own
/// doc comment for why that distinction matters.
///
/// # Why this is a plain `NotifierProvider`, not `.autoDispose`
///
/// This is the mechanism spec section 34's "search state must survive
/// back navigation" rests on, and it is a PROPERTY OF THE PROVIDER SHAPE,
/// not a convention this file has to remember to uphold. A plain
/// [NotifierProvider]'s state lives in the `ProviderContainer`, which
/// outlives any one widget's build/dispose cycle - `SerialSearchController`
/// / `serialSearchControllerProvider` in the tyres feature already proves
/// this pattern out for the same requirement over the same kind of
/// screen. An `.autoDispose` provider would reset the instant the search
/// screen's last listener (its own widget, on pop) went away, which is
/// exactly the behaviour spec section 34 rules out. See
/// `test/features/search/global_search_controller_test.dart` for a test
/// that proves this by mutating state, simulating the widget tearing
/// down its subscription, and reading the SAME state back from the SAME
/// container afterwards.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart' show RecentSearch;
import 'package:tyre_pulse/core/database/dao/cache_dao.dart';
import 'package:tyre_pulse/core/database/query_scope.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart'
    show vehicleCacheScopeFor;

import 'package:tyre_pulse/features/search/data/global_search_repository.dart';
import 'package:tyre_pulse/features/search/domain/global_search_state.dart';
import 'package:tyre_pulse/features/search/domain/search_result.dart';
import 'package:tyre_pulse/features/search/presentation/global_search_deps.dart';

/// How long the input waits after the last keystroke before a search
/// actually runs. Long enough that a fast typist does not fire four
/// separate lookups per word; short enough that the result still feels
/// live.
const Duration _debounceDelay = Duration(milliseconds: 350);

class GlobalSearchController extends Notifier<GlobalSearchState> {
  Timer? _debounce;

  /// Bumped on every search attempt so a slower, superseded lookup can
  /// detect it is no longer the most recent one and discard its own
  /// result instead of overwriting a newer, already-displayed one -
  /// the debounce timer alone only prevents a SECOND search from being
  /// SCHEDULED while typing continues; it does nothing about two already
  /// in-flight network calls completing out of order.
  int _generation = 0;

  @override
  GlobalSearchState build() {
    ref.onDispose(() => _debounce?.cancel());
    unawaited(_loadRecentSearches());
    return const GlobalSearchState();
  }

  /// Called on every keystroke in the search field. Updates [state.query]
  /// immediately so the field's own text is never out of sync with what
  /// the user typed, then debounces the actual search.
  void onQueryChanged(String raw) {
    _debounce?.cancel();
    state = state.copyWith(query: raw);

    final String trimmed = raw.trim();
    if (trimmed.isEmpty) {
      // An empty field shows recent searches, not a stale result list from
      // whatever was typed a moment ago.
      _generation++;
      state = state.copyWith(
        phase: GlobalSearchPhase.idle,
        clearResults: true,
        clearError: true,
      );
      unawaited(_loadRecentSearches());
      return;
    }

    _debounce = Timer(_debounceDelay, () => unawaited(_runSearch(trimmed)));
  }

  /// Runs a search immediately, skipping the debounce - used when the user
  /// explicitly submits the field, and when tapping a recent search.
  void searchNow(String raw) {
    _debounce?.cancel();
    final String trimmed = raw.trim();
    state = state.copyWith(query: raw);
    if (trimmed.isEmpty) {
      _generation++;
      state = state.copyWith(
        phase: GlobalSearchPhase.idle,
        clearResults: true,
        clearError: true,
      );
      unawaited(_loadRecentSearches());
      return;
    }
    unawaited(_runSearch(trimmed));
  }

  /// Re-runs a previously recorded search from [entry], exactly as if the
  /// user had retyped it.
  void selectRecent(RecentSearch entry) => searchNow(entry.term);

  Future<void> _runSearch(String term) async {
    final int myGeneration = ++_generation;
    state = state.copyWith(
      phase: GlobalSearchPhase.searching,
      clearError: true,
    );

    final GlobalSearchRepository repository =
        ref.read(globalSearchRepositoryProvider);
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final WorkspaceScopeFilter? scope = vehicleCacheScopeFor(workspace);

    // All four identifier types are looked up TOGETHER, not one after
    // another - see the library comment. Each future is CREATED here,
    // starting its own async work immediately; they are only AWAITED
    // below, so the four lookups genuinely overlap in flight instead of
    // running in series.
    final Future<_SourceOutcome<AssetSearchResult>> assetsFuture =
        _runSource<AssetSearchResult>(
      'assets',
      () => repository.searchAssets(term, scope: scope),
    );
    final Future<_SourceOutcome<TyreSearchResult>> tyresFuture =
        _runSource<TyreSearchResult>(
      'tyres',
      () => repository.searchTyres(term),
    );
    final Future<_SourceOutcome<WorkOrderSearchResult>> workOrdersFuture =
        _runSource<WorkOrderSearchResult>(
      'workOrders',
      () => repository.searchWorkOrders(term),
    );
    final Future<_SourceOutcome<InspectionSearchResult>> inspectionsFuture =
        _runSource<InspectionSearchResult>(
      'inspections',
      () => repository.searchInspections(term),
    );

    final _SourceOutcome<AssetSearchResult> assetsOutcome = await assetsFuture;
    final _SourceOutcome<TyreSearchResult> tyresOutcome = await tyresFuture;
    final _SourceOutcome<WorkOrderSearchResult> workOrdersOutcome =
        await workOrdersFuture;
    final _SourceOutcome<InspectionSearchResult> inspectionsOutcome =
        await inspectionsFuture;

    if (myGeneration != _generation) return;

    final Set<String> failed = <String>{
      if (assetsOutcome.failed) assetsOutcome.source,
      if (tyresOutcome.failed) tyresOutcome.source,
      if (workOrdersOutcome.failed) workOrdersOutcome.source,
      if (inspectionsOutcome.failed) inspectionsOutcome.source,
    };

    if (failed.length == 4) {
      // Every source failed - this is not "no matches", this is "could
      // not search at all" (no connection, or no signed-in workspace).
      state = state.copyWith(
        phase: GlobalSearchPhase.error,
        clearResults: true,
        lastError: assetsOutcome.error ??
            const AppError(
              kind: AppErrorKind.unknown,
              message: 'Could not search right now. Check your connection '
                  'and try again.',
            ),
      );
      return;
    }

    final bool anyResults = assetsOutcome.items.isNotEmpty ||
        tyresOutcome.items.isNotEmpty ||
        workOrdersOutcome.items.isNotEmpty ||
        inspectionsOutcome.items.isNotEmpty;

    state = state.copyWith(
      phase: anyResults ? GlobalSearchPhase.results : GlobalSearchPhase.empty,
      assets: assetsOutcome.items,
      tyres: tyresOutcome.items,
      workOrders: workOrdersOutcome.items,
      inspections: inspectionsOutcome.items,
      failedSources: failed,
    );

    if (anyResults) {
      unawaited(_recordSearch(term));
    }
  }

  /// Runs one source's lookup, catching its failure locally rather than
  /// letting it take down the other three - see the library comment.
  Future<_SourceOutcome<T>> _runSource<T>(
    String name,
    Future<List<T>> Function() run,
  ) async {
    try {
      final List<T> items = await run();
      return _SourceOutcome<T>.ok(name, items);
    } on Object catch (error) {
      return _SourceOutcome<T>.failed(name, mapSupabaseError(error));
    }
  }

  /// Loads the locally saved recent searches for the signed-in user in the
  /// active workspace, shown when the search field is empty or focused.
  Future<void> _loadRecentSearches() async {
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;

    try {
      final CacheDao cacheDao = ref.read(cacheDaoProvider);
      final List<RecentSearch> rows = await cacheDao.recentSearchesFor(
        userId: workspace.userId,
        workspaceId: workspace.companyId ?? '',
      );
      state = state.copyWith(recentSearches: rows);
    } on Object {
      // A failure to load recent searches is not worth surfacing as a
      // search error - the field is simply shown with no recent-search
      // list, which is the same honest degradation `CacheDao
      // .recentSearchesFor`'s own no-signed-in-user branch already
      // produces.
    }
  }

  Future<void> _recordSearch(String term) async {
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;

    try {
      final CacheDao cacheDao = ref.read(cacheDaoProvider);
      await cacheDao.recordSearch(
        userId: workspace.userId,
        workspaceId: workspace.companyId ?? '',
        term: term,
        now: DateTime.now(),
      );
      await _loadRecentSearches();
    } on Object {
      // Recording history is a convenience, not the search itself - a
      // failure here must never surface as if the search that just
      // succeeded had failed.
    }
  }
}

/// One identifier type's lookup result: either the rows it found (possibly
/// none - a genuine "no matches"), or the fact that it could not be
/// checked at all.
final class _SourceOutcome<T> {
  const _SourceOutcome.ok(this.source, this.items)
      : failed = false,
        error = null;

  const _SourceOutcome.failed(this.source, this.error)
      : failed = true,
        items = const <Never>[];

  /// Which of the four identifier types this outcome is for - 'assets',
  /// 'tyres', 'workOrders' or 'inspections', the same tokens
  /// [GlobalSearchState.failedSources] carries.
  final String source;
  final List<T> items;
  final bool failed;
  final AppError? error;
}

final NotifierProvider<GlobalSearchController, GlobalSearchState>
    globalSearchControllerProvider =
    NotifierProvider<GlobalSearchController, GlobalSearchState>(
  GlobalSearchController.new,
);
