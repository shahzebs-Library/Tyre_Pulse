import 'package:tyre_pulse/core/database/app_database.dart' show RecentSearch;
import 'package:tyre_pulse/core/errors/app_error.dart';

import 'package:tyre_pulse/features/search/domain/search_result.dart';

/// Where a global search currently stands.
///
/// Deliberately NOT a single "found one thing" phase the way
/// `SerialSearchPhase` is - this feature can match several kinds of
/// identifier for the same term (an asset AND a work order can both start
/// with the same digits), so [results] means "the search ran and produced
/// SOME grouped results", not "found exactly one record". [empty] means
/// the search ran and matched nothing anywhere; that is a real, distinct
/// outcome from having never searched at all ([idle]).
enum GlobalSearchPhase { idle, searching, results, empty, error }

bool _listEquals<T>(List<T> a, List<T> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (int i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

bool _setEquals<T>(Set<T> a, Set<T> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  return a.containsAll(b);
}

/// An order-independent hash of a set's members - `Set` iteration order is
/// not guaranteed to be stable, so `Object.hashAll` (which is
/// order-sensitive) would make two equal sets sometimes hash differently.
int _hashSetUnordered<T>(Set<T> set) {
  int result = 0;
  for (final T item in set) {
    result ^= item.hashCode;
  }
  return result;
}

/// Pure, immutable state for the global search feature.
///
/// Lives inside a plain (non-autoDispose) `NotifierProvider` - see
/// `presentation/global_search_controller.dart`'s own library comment for
/// why that specific provider shape is what makes "search state must
/// survive back navigation" true by construction rather than by convention.
final class GlobalSearchState {
  const GlobalSearchState({
    this.query = '',
    this.phase = GlobalSearchPhase.idle,
    this.assets = const <AssetSearchResult>[],
    this.tyres = const <TyreSearchResult>[],
    this.workOrders = const <WorkOrderSearchResult>[],
    this.inspections = const <InspectionSearchResult>[],
    this.recentSearches = const <RecentSearch>[],
    this.failedSources = const <String>{},
    this.lastError,
  });

  /// The text currently in the search field. Kept in state (not local
  /// widget state) for the same back-navigation-survival reason as
  /// everything else here - reopening the screen must show the term the
  /// user last typed, not a blank box.
  final String query;

  final GlobalSearchPhase phase;

  final List<AssetSearchResult> assets;
  final List<TyreSearchResult> tyres;
  final List<WorkOrderSearchResult> workOrders;
  final List<InspectionSearchResult> inspections;

  /// Locally recorded past searches, shown when the field is empty or
  /// focused. Loaded via `CacheDao.recentSearchesFor` - see the
  /// controller's own doc comment for when this list is (re)populated.
  final List<RecentSearch> recentSearches;

  /// Which of `assets`/`tyres`/`workOrders`/`inspections` could not be
  /// checked on the last search, because that ONE source's lookup threw
  /// while the others succeeded.
  ///
  /// This is deliberately kept separate from an empty result list for that
  /// source. A source with no rows in it says so by being empty; a source
  /// this app could not reach says so by appearing here - collapsing the
  /// two would let "we could not check work orders" read as "there are
  /// no matching work orders", which is a different claim the app has no
  /// basis for making. See `presentation/global_search_controller.dart`'s
  /// own doc comment on why one failing source does not blank the other
  /// three that succeeded.
  final Set<String> failedSources;

  final AppError? lastError;

  /// Whether any grouped list holds at least one row. A phase of
  /// [GlobalSearchPhase.results] with every list empty would be a
  /// contradiction the controller must never produce - this getter exists
  /// so a test can assert that invariant directly rather than re-deriving
  /// it ad hoc.
  bool get hasResults =>
      assets.isNotEmpty ||
      tyres.isNotEmpty ||
      workOrders.isNotEmpty ||
      inspections.isNotEmpty;

  /// Total row count across every identifier type, for a result-count
  /// header ("12 results").
  int get totalResultCount =>
      assets.length + tyres.length + workOrders.length + inspections.length;

  GlobalSearchState copyWith({
    String? query,
    GlobalSearchPhase? phase,
    List<AssetSearchResult>? assets,
    List<TyreSearchResult>? tyres,
    List<WorkOrderSearchResult>? workOrders,
    List<InspectionSearchResult>? inspections,
    List<RecentSearch>? recentSearches,
    Set<String>? failedSources,
    AppError? lastError,
    bool clearError = false,
    bool clearResults = false,
  }) {
    return GlobalSearchState(
      query: query ?? this.query,
      phase: phase ?? this.phase,
      assets:
          clearResults ? const <AssetSearchResult>[] : (assets ?? this.assets),
      tyres: clearResults ? const <TyreSearchResult>[] : (tyres ?? this.tyres),
      workOrders: clearResults
          ? const <WorkOrderSearchResult>[]
          : (workOrders ?? this.workOrders),
      inspections: clearResults
          ? const <InspectionSearchResult>[]
          : (inspections ?? this.inspections),
      recentSearches: recentSearches ?? this.recentSearches,
      failedSources: clearResults
          ? const <String>{}
          : (failedSources ?? this.failedSources),
      lastError: clearError ? null : (lastError ?? this.lastError),
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is GlobalSearchState &&
        other.query == query &&
        other.phase == phase &&
        _listEquals(other.assets, assets) &&
        _listEquals(other.tyres, tyres) &&
        _listEquals(other.workOrders, workOrders) &&
        _listEquals(other.inspections, inspections) &&
        _listEquals(other.recentSearches, recentSearches) &&
        _setEquals(other.failedSources, failedSources) &&
        other.lastError == lastError;
  }

  @override
  int get hashCode => Object.hash(
        query,
        phase,
        Object.hashAll(assets),
        Object.hashAll(tyres),
        Object.hashAll(workOrders),
        Object.hashAll(inspections),
        Object.hashAll(recentSearches),
        _hashSetUnordered(failedSources),
        lastError,
      );

  @override
  String toString() => 'GlobalSearchState(query: $query, phase: $phase, '
      'assets: ${assets.length}, tyres: ${tyres.length}, '
      'workOrders: ${workOrders.length}, inspections: ${inspections.length}, '
      'recentSearches: ${recentSearches.length}, '
      'failedSources: $failedSources, lastError: $lastError)';
}
