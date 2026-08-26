/// The paging state machine for the tyre records register.
///
/// # The three rules this file exists to keep true
///
/// `mobile/__tests__/listPagingLifecycle.test.ts` pins the production
/// register against exactly the defect class this file is built to make
/// structurally impossible, not merely avoided by discipline:
///
/// 1. **Page zero is fetched by exactly one call path.** The production
///    screen once had TWO effects that both fired on mount - a filter-reset
///    effect that already called `loadPage(0, true)`, and a bare
///    `useEffect(() => loadPage(page), [page])` that ALSO ran at `page ===
///    0` on first mount, appending page zero to itself so every record on
///    the first screen showed twice. Here, [loadMore] is a no-op unless
///    [TyreRecordsListState.phase] is already
///    [TyreRecordsListPhase.ready] - which cannot be true until [_reset]'s
///    OWN page-zero fetch has completed - so there is no second path that
///    can reach page zero at all.
/// 2. **A monotonic ticket, checked on both the success path and the
///    failure path.** Every fetch this file starts takes a fresh
///    `++_requestSeq` before awaiting the network, and every fetch's
///    continuation - success or failure - checks `seq != _requestSeq`
///    before touching `state` at all. A slower, superseded response
///    (typing past a search debounce, changing a filter while a
///    load-more is in flight) is dropped silently rather than repainting
///    the list underneath whatever query is now active.
/// 3. **A load-more failure never becomes "reached the end".** [_page] is
///    only advanced on a SUCCESSFUL fetch; a failed load-more rolls it back
///    to the page that actually loaded, so retrying re-requests the SAME
///    page rather than skipping the one that failed, and [hasMore] is left
///    exactly as it was rather than being forced to false. This is what
///    keeps "no more pages" and "the next page failed to load" two
///    genuinely distinguishable footer states.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/records/data/tyre_records_repository.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_page.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_query.dart';
import 'package:tyre_pulse/features/records/presentation/state/tyre_records_list_state.dart';
import 'package:tyre_pulse/features/records/records_providers.dart';

/// How long to wait after the last keystroke before searching. Matches the
/// production screen exactly: "350 ms is below the threshold where a
/// search feels laggy, and collapses a burst of keystrokes into one
/// request on a weak link".
const Duration kTyreRecordsSearchDebounce = Duration(milliseconds: 350);

final tyreRecordsListControllerProvider =
    NotifierProvider<TyreRecordsListController, TyreRecordsListState>(
      TyreRecordsListController.new,
    );

final class TyreRecordsListController extends Notifier<TyreRecordsListState> {
  Timer? _debounce;

  /// The zero-based index of the last page fetched SUCCESSFULLY. [loadMore]
  /// always requests `_page + 1`; it is reset to `-1` on every filter
  /// change so the next successful fetch becomes page zero again.
  int _page = -1;

  /// A ticket taken by every fetch this controller starts, whether it is
  /// page zero from [_reset] or a later page from [loadMore]. Only the
  /// fetch holding the CURRENT value of this field may write to [state]
  /// when it completes.
  int _requestSeq = 0;

  @override
  TyreRecordsListState build() {
    ref.onDispose(() {
      _debounce?.cancel();
    });

    final TyreRecordsQuery initialQuery = _scopedQuery(
      const TyreRecordsQuery(),
    );

    // Fired and left to run: `build()` itself must stay synchronous, and
    // `unawaited` is required here under this project's lint configuration
    // (`unawaited_futures: error`) - an un-awaited Future with no explicit
    // marker is exactly how a failed background fetch disappears silently.
    unawaited(_reset(initialQuery));
    unawaited(_loadAvailableSites(initialQuery));

    return TyreRecordsListState(query: initialQuery);
  }

  TyreRecordsRepository get _repository =>
      ref.read(tyreRecordsRepositoryProvider);

  /// Applies the workspace's country scope and, for a non-administrator who
  /// reaches this admin-only module only through an explicit per-user
  /// grant, the production screen's own "own site only" fallback - see
  /// `TyreRecordsQuery`'s library comment.
  TyreRecordsQuery _scopedQuery(TyreRecordsQuery base) {
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final String? country = ref.read(activeCountryProvider);
    final AccessDecision decision = ref.read(
      moduleAccessProvider(ModuleKey.records),
    );

    final bool isElevated =
        decision.reason == AccessReason.superAdmin ||
        decision.reason == AccessReason.adminRole;
    final String? restrictToSite = isElevated ? null : workspace?.legacySite;

    return base.copyWith(
      country: country,
      clearCountry: country == null,
      restrictToSite: restrictToSite,
      clearRestrictToSite: restrictToSite == null,
    );
  }

  /// Updates the raw search box text immediately, then debounces the actual
  /// query change. Cancelling the previous timer on every keystroke is what
  /// collapses a burst of typing into one request, exactly as the
  /// production screen's own `useEffect` cleanup does.
  void updateSearch(String text) {
    state = state.copyWith(searchInput: text);
    _debounce?.cancel();
    _debounce = Timer(kTyreRecordsSearchDebounce, () {
      _applyQueryChange(state.query.copyWith(search: text));
    });
  }

  /// Sets or clears the site filter. Passing null clears it.
  void setSiteFilter(String? site) {
    _applyQueryChange(
      state.query.copyWith(site: site, clearSite: site == null),
    );
  }

  /// Sets or clears the risk-level filter. Passing null clears it.
  void setRiskFilter(String? riskLevel) {
    _applyQueryChange(
      state.query.copyWith(
        riskLevel: riskLevel,
        clearRiskLevel: riskLevel == null,
      ),
    );
  }

  /// Clears the site and risk filters. Deliberately leaves the search text
  /// alone - the filter sheet's "Clear filters" is not "start over" on the
  /// search box, matching the production "Clear all" chip.
  void clearFilters() {
    _applyQueryChange(state.query.clearChosenFilters());
  }

  /// Re-fetches the current query from page zero. The pull-to-refresh
  /// entry point.
  Future<void> refresh() => _reset(state.query);

  /// Fetches the page after the last one that loaded successfully.
  ///
  /// A no-op unless the register is already showing a successful load
  /// (`TyreRecordsListPhase.ready`), already fetching more, or has no
  /// further page to fetch - each of those guards is load-bearing, not
  /// defensive padding: together they are what makes page zero reachable
  /// from exactly one place. See the library comment.
  Future<void> loadMore() async {
    if (state.phase != TyreRecordsListPhase.ready) return;
    if (state.isLoadingMore || !state.hasMore) return;

    final int nextPage = _page + 1;
    final int seq = ++_requestSeq;
    state = state.copyWith(isLoadingMore: true, clearLoadMoreError: true);
    await _fetchPage(seq: seq, pageIndex: nextPage, isFresh: false);
  }

  void _applyQueryChange(TyreRecordsQuery next) {
    if (next == state.query) return;
    unawaited(_reset(next));
  }

  Future<void> _reset(TyreRecordsQuery query) async {
    _page = -1;
    final int seq = ++_requestSeq;
    state = state.copyWith(
      phase: TyreRecordsListPhase.loading,
      items: const <TyreRecord>[],
      hasMore: true,
      isLoadingMore: false,
      clearLoadError: true,
      clearLoadMoreError: true,
      query: query,
    );
    await _fetchPage(seq: seq, pageIndex: 0, isFresh: true);
  }

  Future<void> _fetchPage({
    required int seq,
    required int pageIndex,
    required bool isFresh,
  }) async {
    try {
      final TyreRecordsPage page = await _repository.fetchPage(
        pageIndex: pageIndex,
        query: state.query,
      );

      // A newer request has started while this one was in flight. Its
      // answer, when it lands, is the only one that may paint - drop this
      // one rather than repaint a superseded query's rows underneath the
      // current filter chips.
      if (seq != _requestSeq) return;

      _page = pageIndex;
      final List<TyreRecord> merged = isFresh
          ? page.items
          : <TyreRecord>[...state.items, ...page.items];

      state = state.copyWith(
        phase: TyreRecordsListPhase.ready,
        items: merged,
        hasMore: page.hasMore,
        isLoadingMore: false,
        clearLoadError: true,
        clearLoadMoreError: true,
      );
    } on Object catch (error) {
      // Only the newest request's OWN failure may be shown. A stale error
      // must never blank a list a newer, successful request has already
      // filled.
      if (seq != _requestSeq) return;

      final AppError appError = classifySupabaseError(error).error;
      if (isFresh) {
        state = state.copyWith(
          phase: TyreRecordsListPhase.failed,
          items: const <TyreRecord>[],
          isLoadingMore: false,
          loadError: appError,
        );
      } else {
        // Roll back: the page that just failed is retried on the next
        // `loadMore`, never skipped.
        _page = pageIndex - 1;
        state = state.copyWith(isLoadingMore: false, loadMoreError: appError);
      }
    }
  }

  /// Loads the filter sheet's site options once, best-effort. Mirrors the
  /// production screen's own `useEffect(() => { loadSites() }, [])`: fired
  /// once on mount, never re-run when a filter changes, and a failure is
  /// swallowed rather than surfaced - an incomplete site picker is a much
  /// smaller problem than a register that cannot open because the option
  /// list failed to load.
  Future<void> _loadAvailableSites(TyreRecordsQuery query) async {
    try {
      final List<String> sites = await _repository.fetchDistinctSites(
        country: query.country,
        restrictToSite: query.restrictToSite,
      );
      state = state.copyWith(availableSites: sites);
    } on Object {
      // Deliberately swallowed - see the doc comment above.
    }
  }
}
