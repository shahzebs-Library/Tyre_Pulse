/// Every state the tyre records list can be in.
///
/// # Loading, empty, error and permission-denied are FOUR different states
///
/// AGENTS.md and spec section 58: loading, empty, offline-cached,
/// permission-denied, backend-unavailable, not-configured and error are
/// seven different states with seven different renderings, and a spinner is
/// none of them. [TyreRecordsListPhase] carries three of those seven
/// directly (loading / ready / failed); permission-denied is decided
/// upstream by the SCREEN before this state machine is ever created (see
/// `../../data/tyre_records_repository.dart`'s library comment), and
/// [TyreRecordsListState.isEmpty] answers the fourth. The remaining two -
/// offline-cached and not-configured - are DELIBERATELY not modelled here:
/// this register has no local cache to show a stale copy of (the
/// production screen's own inventory entry states its offline behaviour as
/// "no"), and `tyre_records` is a core table with nothing to configure per
/// organisation. Forcing either of those two states to be reachable here
/// would mean fabricating a condition that can never honestly occur, which
/// is worse than leaving it unmodelled - see AGENTS.md's rule against
/// invented data.
///
/// # The paging footer has its OWN three-way state, separate from [phase]
///
/// Once the first page has loaded successfully, the register is in
/// [TyreRecordsListPhase.ready] for as long as the person keeps scrolling.
/// What happens at the bottom of the list - nothing more to load, a spinner
/// while the next page comes in, or a retry row because the next page
/// failed - are three MUTUALLY EXCLUSIVE conditions, and `../../data/`'s
/// controller is the file that keeps them exclusive by construction: it
/// never sets more than one of [isLoadingMore] and [loadMoreError] at once,
/// and a load-more failure leaves [hasMore] exactly as it was rather than
/// silently declaring the list finished. This is the "distinguishable
/// no-more-pages vs. load-failed-mid-scroll" state the task requires, and it
/// deliberately lives at the LIST-FOOTER level rather than as a fourth
/// full-screen state, because unlike loading/empty/error it can only ever
/// be reached once real content already fills the screen.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_query.dart';

/// The three whole-screen phases this list can be in.
enum TyreRecordsListPhase {
  /// The very first page of the CURRENT query is still in flight. Nothing
  /// has been shown yet.
  loading,

  /// At least one fetch of the current query has succeeded. [items] may
  /// still be empty - see [TyreRecordsListState.isEmpty].
  ready,

  /// The first page of the current query failed outright. [items] is empty
  /// and [TyreRecordsListState.loadError] carries the reason.
  failed,
}

@immutable
final class TyreRecordsListState {
  const TyreRecordsListState({
    this.phase = TyreRecordsListPhase.loading,
    this.items = const <TyreRecord>[],
    this.hasMore = true,
    this.isLoadingMore = false,
    this.loadError,
    this.loadMoreError,
    this.query = const TyreRecordsQuery(),
    this.searchInput = '',
    this.availableSites = const <String>[],
  });

  final TyreRecordsListPhase phase;
  final List<TyreRecord> items;

  /// Whether another page might exist beyond the one currently loaded.
  /// Meaningless while [phase] is not [TyreRecordsListPhase.ready].
  final bool hasMore;

  /// True while a page BEYOND the first is in flight. Never true at the
  /// same time as [phase] being [TyreRecordsListPhase.loading]: that is the
  /// initial fetch, this is every fetch after it.
  final bool isLoadingMore;

  /// Set only when [phase] is [TyreRecordsListPhase.failed].
  final AppError? loadError;

  /// Set when a page AFTER the first failed. [phase] stays
  /// [TyreRecordsListPhase.ready] and [items] keeps whatever loaded
  /// successfully so far - a failure to load MORE must never blank what is
  /// already on screen.
  final AppError? loadMoreError;

  /// The ACTIVE query: what the current [items] were actually fetched with.
  /// The search text inside it is the DEBOUNCED value - see [searchInput]
  /// for what the text field itself should show.
  final TyreRecordsQuery query;

  /// The raw text currently in the search box. May be ahead of
  /// `query.search` while the debounce timer has not yet fired, so the
  /// field never appears to lag behind what was typed.
  final String searchInput;

  /// Site names to offer in the filter sheet. Empty until the first load
  /// resolves; an empty list here is not distinguished from "administrator
  /// scoped to no sites yet" because the filter sheet simply omits the site
  /// picker when this is empty, exactly as the production screen does
  /// (`elevated && sites.length > 0`).
  final List<String> availableSites;

  /// A real, measured zero: the current query resolved and matched nothing.
  /// Distinct from [phase] being [TyreRecordsListPhase.failed], where
  /// nothing was measured at all.
  bool get isEmpty => phase == TyreRecordsListPhase.ready && items.isEmpty;

  /// True once real content fills the screen. While this is false the
  /// paging footer never applies - see the library comment.
  bool get hasContent => phase == TyreRecordsListPhase.ready && items.isNotEmpty;

  TyreRecordsListState copyWith({
    TyreRecordsListPhase? phase,
    List<TyreRecord>? items,
    bool? hasMore,
    bool? isLoadingMore,
    AppError? loadError,
    bool clearLoadError = false,
    AppError? loadMoreError,
    bool clearLoadMoreError = false,
    TyreRecordsQuery? query,
    String? searchInput,
    List<String>? availableSites,
  }) {
    return TyreRecordsListState(
      phase: phase ?? this.phase,
      items: items ?? this.items,
      hasMore: hasMore ?? this.hasMore,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      loadError: clearLoadError ? null : (loadError ?? this.loadError),
      loadMoreError:
          clearLoadMoreError ? null : (loadMoreError ?? this.loadMoreError),
      query: query ?? this.query,
      searchInput: searchInput ?? this.searchInput,
      availableSites: availableSites ?? this.availableSites,
    );
  }

  @override
  String toString() => 'TyreRecordsListState(phase: $phase, '
      'items: ${items.length}, hasMore: $hasMore, '
      'isLoadingMore: $isLoadingMore, loadError: $loadError, '
      'loadMoreError: $loadMoreError, query: $query)';
}
