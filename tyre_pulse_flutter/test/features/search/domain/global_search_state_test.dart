import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart' show RecentSearch;
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/search/domain/global_search_state.dart';
import 'package:tyre_pulse/features/search/domain/search_result.dart';

const AssetSearchResult _asset = AssetSearchResult(assetNo: 'TM514');
const TyreSearchResult _tyre = TyreSearchResult(serialNo: 'EP0604207');
const WorkOrderSearchResult _workOrder = WorkOrderSearchResult(id: 'row-1');
const InspectionSearchResult _inspection = InspectionSearchResult(
  id: 'insp-1',
);

void main() {
  group('the default state', () {
    test('is idle, empty, and carries no error', () {
      const GlobalSearchState state = GlobalSearchState();
      expect(state.query, isEmpty);
      expect(state.phase, GlobalSearchPhase.idle);
      expect(state.assets, isEmpty);
      expect(state.tyres, isEmpty);
      expect(state.workOrders, isEmpty);
      expect(state.inspections, isEmpty);
      expect(state.recentSearches, isEmpty);
      expect(state.failedSources, isEmpty);
      expect(state.lastError, isNull);
      expect(state.hasResults, isFalse);
      expect(state.totalResultCount, 0);
    });
  });

  group('hasResults and totalResultCount', () {
    test('hasResults is true when any one of the four lists is non-empty', () {
      const GlobalSearchState state = GlobalSearchState(
        phase: GlobalSearchPhase.results,
        tyres: <TyreSearchResult>[_tyre],
      );
      expect(state.hasResults, isTrue);
    });

    test('totalResultCount sums across every identifier type', () {
      const GlobalSearchState state = GlobalSearchState(
        phase: GlobalSearchPhase.results,
        assets: <AssetSearchResult>[_asset],
        tyres: <TyreSearchResult>[_tyre],
        workOrders: <WorkOrderSearchResult>[_workOrder, _workOrder],
        inspections: <InspectionSearchResult>[_inspection],
      );
      expect(state.totalResultCount, 5);
    });

    test(
        'a results phase with every list empty is never produced by a real '
        'transition, but the getters answer honestly about it if it were', () {
      const GlobalSearchState state = GlobalSearchState(
        phase: GlobalSearchPhase.results,
      );
      expect(state.hasResults, isFalse);
      expect(state.totalResultCount, 0);
    });
  });

  group('copyWith', () {
    test('an untouched field keeps its previous value', () {
      const GlobalSearchState original = GlobalSearchState(
        query: 'TM514',
        phase: GlobalSearchPhase.results,
        assets: <AssetSearchResult>[_asset],
      );
      final GlobalSearchState next = original.copyWith(
        phase: GlobalSearchPhase.searching,
      );
      expect(next.query, 'TM514');
      expect(next.assets, <AssetSearchResult>[_asset]);
      expect(next.phase, GlobalSearchPhase.searching);
    });

    test(
        'clearResults empties all four result lists AND failedSources, '
        'but leaves recentSearches and query untouched', () {
      // Not `const`: nothing here relies on `RecentSearch` (a drift
      // -generated row class) supporting a const constructor, which is not
      // something this environment can verify without a Dart SDK.
      final RecentSearch recent = RecentSearch(
        id: 'r1',
        userId: 'u1',
        workspaceId: 'w1',
        term: 'TM514',
        termNorm: 'tm514',
        searchedAt: DateTime.utc(2026),
        resultKind: null,
        resultId: null,
      );
      final GlobalSearchState original = GlobalSearchState(
        query: 'TM514',
        phase: GlobalSearchPhase.results,
        assets: const <AssetSearchResult>[_asset],
        tyres: const <TyreSearchResult>[_tyre],
        workOrders: const <WorkOrderSearchResult>[_workOrder],
        inspections: const <InspectionSearchResult>[_inspection],
        recentSearches: <RecentSearch>[recent],
        failedSources: const <String>{'tyres'},
      );

      final GlobalSearchState next = original.copyWith(clearResults: true);

      expect(next.assets, isEmpty);
      expect(next.tyres, isEmpty);
      expect(next.workOrders, isEmpty);
      expect(next.inspections, isEmpty);
      expect(next.failedSources, isEmpty);
      expect(next.recentSearches, <RecentSearch>[recent]);
      expect(next.query, 'TM514');
    });

    test(
        'clearError discards lastError even when a new one is also '
        'supplied - clearError wins', () {
      const AppError original = AppError(
        kind: AppErrorKind.network,
        message: 'offline',
      );
      const AppError replacement = AppError(
        kind: AppErrorKind.unknown,
        message: 'ignored',
      );
      final GlobalSearchState state = const GlobalSearchState(
        lastError: original,
      ).copyWith(clearError: true, lastError: replacement);

      expect(state.lastError, isNull);
    });

    test(
        'supplying a new lastError with clearError false replaces the old '
        'one', () {
      const AppError first = AppError(
        kind: AppErrorKind.network,
        message: 'offline',
      );
      const AppError second = AppError(
        kind: AppErrorKind.server,
        message: 'server error',
      );
      final GlobalSearchState state = const GlobalSearchState(
        lastError: first,
      ).copyWith(lastError: second);

      expect(state.lastError, second);
    });

    test('failedSources can be set directly without clearResults', () {
      final GlobalSearchState state = const GlobalSearchState().copyWith(
        failedSources: const <String>{'workOrders', 'inspections'},
      );
      expect(state.failedSources, <String>{'workOrders', 'inspections'});
    });
  });

  group('equality and hashCode', () {
    test(
        'two states built from the same values are equal and hash the '
        'same', () {
      const GlobalSearchState a = GlobalSearchState(
        query: 'TM514',
        phase: GlobalSearchPhase.results,
        assets: <AssetSearchResult>[_asset],
        failedSources: <String>{'tyres'},
      );
      const GlobalSearchState b = GlobalSearchState(
        query: 'TM514',
        phase: GlobalSearchPhase.results,
        assets: <AssetSearchResult>[_asset],
        failedSources: <String>{'tyres'},
      );
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test(
        'failedSources equality is order-independent - a Set has no '
        'guaranteed iteration order', () {
      const GlobalSearchState a = GlobalSearchState(
        failedSources: <String>{'assets', 'tyres'},
      );
      const GlobalSearchState b = GlobalSearchState(
        failedSources: <String>{'tyres', 'assets'},
      );
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('a difference in any single field breaks equality', () {
      const GlobalSearchState a = GlobalSearchState(query: 'TM514');
      const GlobalSearchState b = GlobalSearchState(query: 'TM515');
      expect(a == b, isFalse);
    });
  });
}
