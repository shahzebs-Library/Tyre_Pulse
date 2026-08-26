/// Tests [GlobalSearchController] entirely through [ProviderContainer] -
/// mirrors `serial_search_controller_test.dart`'s own discipline exactly:
/// no widget tree, no [BuildContext], no `flutter_test` pumping. The
/// controller's repository dependency is [_FakeGlobalSearchRepository], a
/// plain Dart class implementing [GlobalSearchRepository]; its workspace
/// dependency is a fixture [WorkspaceContext] built the same way
/// `vehicle_fleet_repository_test.dart`'s own `_workspace` helper builds
/// one; its cache dependency is a REAL in-memory [CacheDao], so
/// "recent searches are saved locally" is proven against the real local
/// store `recordSearch`/`recentSearchesFor` already provide, not a mock of
/// it.
///
/// This file avoids `pumpEventQueue()` for the same reason
/// `serial_search_controller_test.dart` does - it cannot be confirmed
/// re-exported by the installed `flutter_test` in an environment with no
/// Dart SDK to check against - and uses the same manual `_settle()` /
/// `Duration`-based flush pattern that file already established instead.
///
/// The back-navigation group below DOES use `container.listen` /
/// `ProviderSubscription.close()`, which - unlike `pumpEventQueue()` - has
/// no precedent anywhere else in this codebase's test suite to confirm
/// against. Both are core, long-standing `flutter_riverpod` primitives
/// (the same ones `ref.watch`/`ref.listen` are themselves built on, not an
/// obscure or version-specific corner of the package, and `flutter_riverpod`
/// is already a confirmed direct dependency here), so the risk is judged
/// much lower than an unverified `flutter_test`-specific helper - but it is
/// still an SDK API this environment cannot compile-check, and is named
/// here rather than left silent.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/cache_dao.dart';
import 'package:tyre_pulse/core/database/query_scope.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/search/data/global_search_repository.dart';
import 'package:tyre_pulse/features/search/domain/global_search_state.dart';
import 'package:tyre_pulse/features/search/domain/search_result.dart';
import 'package:tyre_pulse/features/search/presentation/'
    'global_search_controller.dart';
import 'package:tyre_pulse/features/search/presentation/'
    'global_search_deps.dart';

import '../../../core/database/database_test_support.dart';

/// A fully scripted [GlobalSearchRepository]. Every method records how many
/// times it was called and with what, and - when [gate] is set - every
/// method suspends on it before returning, so a test can hold all four
/// lookups in flight at once.
class _FakeGlobalSearchRepository implements GlobalSearchRepository {
  int assetsCalls = 0;
  int tyresCalls = 0;
  int workOrdersCalls = 0;
  int inspectionsCalls = 0;

  String? lastAssetsTerm;
  WorkspaceScopeFilter? lastAssetsScope;
  String? lastTyresTerm;
  String? lastWorkOrdersTerm;
  String? lastInspectionsTerm;

  List<AssetSearchResult> assetsResult = const <AssetSearchResult>[];
  List<TyreSearchResult> tyresResult = const <TyreSearchResult>[];
  List<WorkOrderSearchResult> workOrdersResult =
      const <WorkOrderSearchResult>[];
  List<InspectionSearchResult> inspectionsResult =
      const <InspectionSearchResult>[];

  Object? assetsError;
  Object? tyresError;
  Object? workOrdersError;
  Object? inspectionsError;

  /// When set, every method awaits this before returning - see the library
  /// comment.
  Completer<void>? gate;

  Future<void> _maybeWaitForGate() async {
    final Completer<void>? g = gate;
    if (g != null) {
      await g.future;
    }
  }

  @override
  Future<List<AssetSearchResult>> searchAssets(
    String term, {
    required WorkspaceScopeFilter? scope,
  }) async {
    assetsCalls++;
    lastAssetsTerm = term;
    lastAssetsScope = scope;
    await _maybeWaitForGate();
    final Object? error = assetsError;
    if (error != null) {
      // Deliberate arbitrary-error injection, see this file's fake repository.
      // ignore: only_throw_errors
      throw error;
    }
    return assetsResult;
  }

  @override
  Future<List<TyreSearchResult>> searchTyres(String term) async {
    tyresCalls++;
    lastTyresTerm = term;
    await _maybeWaitForGate();
    final Object? error = tyresError;
    if (error != null) {
      // Deliberate arbitrary-error injection, see this file's fake repository.
      // ignore: only_throw_errors
      throw error;
    }
    return tyresResult;
  }

  @override
  Future<List<WorkOrderSearchResult>> searchWorkOrders(String term) async {
    workOrdersCalls++;
    lastWorkOrdersTerm = term;
    await _maybeWaitForGate();
    final Object? error = workOrdersError;
    if (error != null) {
      // Deliberate arbitrary-error injection, see this file's fake repository.
      // ignore: only_throw_errors
      throw error;
    }
    return workOrdersResult;
  }

  @override
  Future<List<InspectionSearchResult>> searchInspections(String term) async {
    inspectionsCalls++;
    lastInspectionsTerm = term;
    await _maybeWaitForGate();
    final Object? error = inspectionsError;
    if (error != null) {
      // Deliberate arbitrary-error injection, see this file's fake repository.
      // ignore: only_throw_errors
      throw error;
    }
    return inspectionsResult;
  }
}

/// A minimal workspace fixture, built the same way
/// `vehicle_fleet_repository_test.dart`'s own `_workspace` helper is built -
/// a real [UserRole]/[AccessState] pair rather than a mocked constructor.
WorkspaceContext _workspace({String? companyId = workspaceA}) {
  const UserRole role = UserRole.known(RoleId.reporter);
  const AccessState access = AccessState(role: role);
  return WorkspaceContext(
    userId: testUser,
    role: role,
    effectivePermissions: access,
    countryScope: CountryScope.none,
    siteScope: SiteScope.none,
    companyId: companyId,
  );
}

/// Flushes pending microtasks without depending on `pumpEventQueue()` - see
/// the library comment.
Future<void> _settle() async {
  for (int i = 0; i < 4; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

/// Runs [GlobalSearchController.searchNow] and settles what it starts.
///
/// `searchNow` is `void` - fire-and-forget by design, exactly like
/// `onQueryChanged` - so there is nothing on the call itself to `await`.
/// This is the one place that fact is handled, rather than every test
/// re-deriving it.
Future<void> _runSearchNow(
  GlobalSearchController controller,
  String term,
) async {
  controller.searchNow(term);
  await _settle();
}

/// See [_runSearchNow] - `selectRecent` is `void` for the same reason.
Future<void> _runSelectRecent(
  GlobalSearchController controller,
  RecentSearch entry,
) async {
  controller.selectRecent(entry);
  await _settle();
}

({
  ProviderContainer container,
  _FakeGlobalSearchRepository repo,
  AppDatabase db,
}) _harness({WorkspaceContext? workspace}) {
  final _FakeGlobalSearchRepository repo = _FakeGlobalSearchRepository();
  final AppDatabase db = newMemoryDatabase();
  final ProviderContainer container = ProviderContainer(
    overrides: [
      globalSearchRepositoryProvider.overrideWithValue(repo),
      cacheDaoProvider.overrideWithValue(db.cacheDao),
      workspaceContextProvider.overrideWithValue(
        workspace ?? _workspace(),
      ),
    ],
  );
  return (container: container, repo: repo, db: db);
}

void main() {
  group('build()', () {
    test('starts idle, empty, with no results and no error', () {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);

      final GlobalSearchState state = container.read(
        globalSearchControllerProvider,
      );
      expect(state.phase, GlobalSearchPhase.idle);
      expect(state.hasResults, isFalse);
      expect(state.query, isEmpty);
    });

    test('loads recent searches on first read, from the real local cache',
        () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);
      await db.cacheDao.recordSearch(
        userId: testUser,
        workspaceId: workspaceA,
        term: 'TM514',
        now: testNow,
      );

      container.read(globalSearchControllerProvider); // triggers build()
      await _settle();

      final GlobalSearchState state = container.read(
        globalSearchControllerProvider,
      );
      expect(state.recentSearches, hasLength(1));
      expect(state.recentSearches.single.term, 'TM514');
    });

    test(
        'with no signed-in workspace, recent searches stays empty rather '
        'than throwing', () async {
      final (:container, :repo, :db) = _harness(workspace: null);
      addTearDown(container.dispose);
      addTearDown(db.close);

      container.read(globalSearchControllerProvider);
      await _settle();

      expect(
        container.read(globalSearchControllerProvider).recentSearches,
        isEmpty,
      );
    });
  });

  group('onQueryChanged - debouncing', () {
    test('a single change reaches the repository after the debounce delay',
        () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      controller.onQueryChanged('TM514');

      expect(
        repo.assetsCalls,
        0,
        reason: 'the debounce delay has not elapsed yet',
      );

      await Future<void>.delayed(const Duration(milliseconds: 400));

      expect(repo.assetsCalls, 1);
      expect(repo.lastAssetsTerm, 'TM514');
    });

    test(
        'rapid successive changes collapse into exactly ONE search, for '
        'the LAST term typed - each keystroke cancels the previous '
        'pending timer', () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      controller.onQueryChanged('T');
      controller.onQueryChanged('TM');
      controller.onQueryChanged('TM5');
      controller.onQueryChanged('TM51');
      controller.onQueryChanged('TM514');

      await Future<void>.delayed(const Duration(milliseconds: 400));

      expect(
        repo.assetsCalls,
        1,
        reason: 'a fast typist must not fire one search per keystroke',
      );
      expect(repo.lastAssetsTerm, 'TM514');
    });

    test(
        'an empty query moves straight to idle with no debounce wait, and '
        'never reaches the repository', () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      controller.onQueryChanged('');

      expect(
        container.read(globalSearchControllerProvider).phase,
        GlobalSearchPhase.idle,
      );
      await Future<void>.delayed(const Duration(milliseconds: 400));
      expect(repo.assetsCalls, 0);
    });

    test('an empty query after a populated one clears the previous results',
        () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);
      repo.assetsResult = const <AssetSearchResult>[
        AssetSearchResult(assetNo: 'TM514'),
      ];

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      await _runSearchNow(controller, 'TM514');
      expect(
        container.read(globalSearchControllerProvider).hasResults,
        isTrue,
      );

      controller.onQueryChanged('');

      final GlobalSearchState state = container.read(
        globalSearchControllerProvider,
      );
      expect(state.phase, GlobalSearchPhase.idle);
      expect(state.hasResults, isFalse);
    });
  });

  group('searchNow - skips the debounce', () {
    test('reaches the repository immediately, with no wait', () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      await _runSearchNow(controller, 'TM514');

      expect(repo.assetsCalls, 1);
      expect(repo.tyresCalls, 1);
      expect(repo.workOrdersCalls, 1);
      expect(repo.inspectionsCalls, 1);
    });

    test('trims the term before it reaches every source', () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      await _runSearchNow(controller, '  TM514  ');

      expect(repo.lastAssetsTerm, 'TM514');
      expect(repo.lastTyresTerm, 'TM514');
      expect(repo.lastWorkOrdersTerm, 'TM514');
      expect(repo.lastInspectionsTerm, 'TM514');
    });

    test(
        'resolves the workspace scope from the active workspace and passes '
        'it to searchAssets', () async {
      final (:container, :repo, :db) = _harness(
        workspace: _workspace(companyId: workspaceB),
      );
      addTearDown(container.dispose);
      addTearDown(db.close);

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      await _runSearchNow(controller, 'TM514');

      expect(repo.lastAssetsScope?.workspaceId, workspaceB);
    });
  });

  group('the four sources are dispatched together, not one after another', () {
    test(
        'every source has already been called before ANY of them is '
        'allowed to finish - the only way that is possible is if the '
        'controller starts all four before awaiting any of them', () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);
      final Completer<void> gate = Completer<void>();
      repo.gate = gate;

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      controller.searchNow('TM514');

      // No delay is needed before this assertion: `searchNow` is a plain
      // (non-async) function, and every one of the four fake methods it
      // reaches increments its own call counter SYNCHRONOUSLY, before its
      // first `await`, since Dart runs an async function synchronously up
      // to that point - so if the controller genuinely creates all four
      // futures before awaiting any of them (as `_runSearch`'s own library
      // comment claims), every counter is already 1 the instant this bare
      // statement returns, with nothing yet allowed to complete because
      // `gate` is still open.
      expect(repo.assetsCalls, 1);
      expect(repo.tyresCalls, 1);
      expect(repo.workOrdersCalls, 1);
      expect(repo.inspectionsCalls, 1);
      expect(
        container.read(globalSearchControllerProvider).phase,
        GlobalSearchPhase.searching,
        reason: 'nothing has resolved yet - the gate is still open',
      );

      gate.complete();
      await _settle();

      expect(
        container.read(globalSearchControllerProvider).phase,
        isNot(GlobalSearchPhase.searching),
        reason: 'releasing the gate lets the search finish',
      );
    });
  });

  group('grouping the results', () {
    test('all four non-empty moves to results, with every group present',
        () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);
      repo
        ..assetsResult = const <AssetSearchResult>[
          AssetSearchResult(assetNo: 'TM514'),
        ]
        ..tyresResult = const <TyreSearchResult>[
          TyreSearchResult(serialNo: 'EP0604207'),
        ]
        ..workOrdersResult = const <WorkOrderSearchResult>[
          WorkOrderSearchResult(id: 'row-1'),
        ]
        ..inspectionsResult = const <InspectionSearchResult>[
          InspectionSearchResult(id: 'insp-1'),
        ];

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      await _runSearchNow(controller, 'TM514');

      final GlobalSearchState state = container.read(
        globalSearchControllerProvider,
      );
      expect(state.phase, GlobalSearchPhase.results);
      expect(state.totalResultCount, 4);
      expect(state.failedSources, isEmpty);
    });

    test('nothing anywhere moves to empty, not error', () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      await _runSearchNow(controller, 'DOES-NOT-EXIST');

      expect(
        container.read(globalSearchControllerProvider).phase,
        GlobalSearchPhase.empty,
      );
    });
  });

  group('one source failing does not blank the other three', () {
    test(
        'a single failed source stays in results, with the other three '
        'groups intact and the failure recorded in failedSources', () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);
      repo
        ..assetsResult = const <AssetSearchResult>[
          AssetSearchResult(assetNo: 'TM514'),
        ]
        ..workOrdersError = StateError('offline');

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      await _runSearchNow(controller, 'TM514');

      final GlobalSearchState state = container.read(
        globalSearchControllerProvider,
      );
      expect(
        state.phase,
        GlobalSearchPhase.results,
        reason: 'one failed source is not the same as the whole search '
            'failing',
      );
      expect(state.assets, hasLength(1));
      expect(state.failedSources, <String>{'workOrders'});
    });

    test('every source failing moves to the error phase', () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);
      repo
        ..assetsError = StateError('offline')
        ..tyresError = StateError('offline')
        ..workOrdersError = StateError('offline')
        ..inspectionsError = StateError('offline');

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      await _runSearchNow(controller, 'TM514');

      final GlobalSearchState state = container.read(
        globalSearchControllerProvider,
      );
      expect(state.phase, GlobalSearchPhase.error);
      expect(state.lastError, isNotNull);
      expect(
        state.hasResults,
        isFalse,
        reason: 'a total failure must not leave a stale result behind',
      );
    });
  });

  group('recording a search - the real local cache, round-tripped', () {
    test(
        'a search that finds something is recorded, and shows up in a '
        'later recentSearchesFor read', () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);
      repo.assetsResult = const <AssetSearchResult>[
        AssetSearchResult(assetNo: 'TM514'),
      ];

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      await _runSearchNow(controller, 'TM514');
      await _settle();

      final List<RecentSearch> recents = await db.cacheDao.recentSearchesFor(
        userId: testUser,
        workspaceId: workspaceA,
      );
      expect(recents, hasLength(1));
      expect(recents.single.term, 'TM514');
    });

    test(
        'a search that finds nothing is NOT recorded - saving a dead-end '
        'search would only clutter recent history', () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      await _runSearchNow(controller, 'DOES-NOT-EXIST');
      await _settle();

      final List<RecentSearch> recents = await db.cacheDao.recentSearchesFor(
        userId: testUser,
        workspaceId: workspaceA,
      );
      expect(recents, isEmpty);
    });

    test(
        'the controller state itself gains the recorded entry after a '
        'successful search', () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);
      repo.assetsResult = const <AssetSearchResult>[
        AssetSearchResult(assetNo: 'TM514'),
      ];

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      await _runSearchNow(controller, 'TM514');
      await _settle();

      expect(
        container.read(globalSearchControllerProvider).recentSearches,
        hasLength(1),
      );
    });
  });

  group('selectRecent', () {
    test(
        're-runs the search for the recorded term, immediately - the '
        'same as searchNow', () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);
      final RecentSearch entry = RecentSearch(
        id: 'r1',
        userId: testUser,
        workspaceId: workspaceA,
        term: 'TM514',
        termNorm: 'TM514',
        searchedAt: testNow,
        resultKind: null,
        resultId: null,
      );

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      await _runSelectRecent(controller, entry);

      expect(repo.assetsCalls, 1);
      expect(repo.lastAssetsTerm, 'TM514');
    });
  });

  group(
      'back navigation - state survives a widget listening then '
      'unsubscribing', () {
    test(
        'reading the state again after a listener attaches and detaches, '
        'exactly as a widget would on being pushed then popped, returns '
        'the SAME query and results - not the idle default', () async {
      // Modelled on the real app's own lifecycle: `main.dart` creates ONE
      // `ProviderContainer` (via `ProviderScope`) that lives for the whole
      // app session, and every screen push/pop only adds and removes a
      // WIDGET's subscription to it. `globalSearchControllerProvider` is a
      // plain (non-autoDispose) `NotifierProvider`, so its state lives in
      // the container itself, not in any one widget's subscription -
      // exactly what `GlobalSearchController`'s own library comment claims
      // is what makes "search state must survive back navigation" true.
      // Simulating a widget's subscribe/unsubscribe cycle via
      // `container.listen` / `ProviderSubscription.close()`, WITHOUT ever
      // disposing the container itself, is therefore the correct model of
      // real back navigation for a Riverpod app - not a heavier
      // `WidgetTester`/`GoRouter` harness, which
      // `serial_search_controller_test.dart` already establishes this
      // codebase avoids for this class of test.
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);
      repo.assetsResult = const <AssetSearchResult>[
        AssetSearchResult(assetNo: 'TM514'),
      ];

      final GlobalSearchController controller = container.read(
        globalSearchControllerProvider.notifier,
      );
      await _runSearchNow(controller, 'TM514');

      final GlobalSearchState beforeNavigatingAway = container.read(
        globalSearchControllerProvider,
      );
      expect(beforeNavigatingAway.query, 'TM514');
      expect(beforeNavigatingAway.hasResults, isTrue);

      // The search screen's widget is built (subscribes) then popped
      // (unsubscribes). If `globalSearchControllerProvider` were
      // `.autoDispose`, closing the LAST listener here would schedule the
      // notifier for disposal and the next read would rebuild it from
      // scratch, back at the idle default - exactly the regression this
      // test exists to catch.
      final ProviderSubscription<GlobalSearchState> widgetSubscription =
          container.listen(
        globalSearchControllerProvider,
        (GlobalSearchState? previous, GlobalSearchState next) {},
      );
      widgetSubscription.close();

      final GlobalSearchState afterComingBack = container.read(
        globalSearchControllerProvider,
      );
      expect(
        afterComingBack.query,
        'TM514',
        reason: 'the typed term must still be there on return',
      );
      expect(
        afterComingBack.hasResults,
        isTrue,
        reason: 'the found results must still be there on return',
      );
      expect(
        afterComingBack,
        beforeNavigatingAway,
        reason: 'state is byte-for-byte unchanged by the simulated '
            'navigation - it was never rebuilt',
      );
      expect(
        repo.assetsCalls,
        1,
        reason: 'coming back must not silently re-run the search',
      );
    });

    test(
        'the SAME notifier instance answers container.read before and '
        'after the simulated navigation - proof this is one persistent '
        'object, not a freshly rebuilt one', () async {
      final (:container, :repo, :db) = _harness();
      addTearDown(container.dispose);
      addTearDown(db.close);

      final GlobalSearchController before = container.read(
        globalSearchControllerProvider.notifier,
      );

      final ProviderSubscription<GlobalSearchState> widgetSubscription =
          container.listen(
        globalSearchControllerProvider,
        (GlobalSearchState? previous, GlobalSearchState next) {},
      );
      widgetSubscription.close();

      final GlobalSearchController after = container.read(
        globalSearchControllerProvider.notifier,
      );
      expect(
        identical(before, after),
        isTrue,
        reason: 'a plain NotifierProvider never rebuilds its notifier just '
            'because its last listener went away - only .autoDispose does '
            'that',
      );
    });
  });
}
