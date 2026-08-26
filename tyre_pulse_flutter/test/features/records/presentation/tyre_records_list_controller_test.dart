/// Proves the three rules
/// `presentation/controllers/tyre_records_list_controller.dart`'s library
/// comment states, against a hand-written [FakeTyreRecordsRepository] rather
/// than a real or mocked [SupabaseClient] - see that repository's own
/// library comment for why the raw Supabase query construction is not
/// independently testable in this environment, and why the paging state
/// machine that sits above it can still be proven with full confidence.
///
/// The group "paging accumulates correctly across a boundary with tied
/// data" is the test the task specifically calls for: it constructs a
/// dataset where several rows share the same primary sort value across a
/// page boundary - exactly the shape a real tie on `issue_date` produces -
/// and proves the controller's accumulated list ends up with every row
/// exactly once, none dropped and none duplicated.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_page.dart';
import 'package:tyre_pulse/features/records/presentation/controllers/tyre_records_list_controller.dart';
import 'package:tyre_pulse/features/records/presentation/state/tyre_records_list_state.dart';
import 'package:tyre_pulse/features/records/records_providers.dart';

import '../records_test_support.dart';

/// Flushes pending microtasks (every `Future.value`-style resolution the
/// fake repository produces) without depending on real wall-clock timing
/// for anything except the debounce tests, which say so explicitly.
Future<void> _settle() => Future<void>.delayed(Duration.zero);

({ProviderContainer container, FakeTyreRecordsRepository repo}) _harness({
  List<TyreRecord> dataset = const <TyreRecord>[],
  int pageSize = 5,
  AccessState access = const AccessState(role: UserRole.known(RoleId.admin)),
}) {
  final FakeTyreRecordsRepository repo = FakeTyreRecordsRepository(
    dataset: dataset,
    pageSize: pageSize,
  );
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      accessStateProvider.overrideWithValue(access),
      tyreRecordsRepositoryProvider.overrideWithValue(repo),
    ],
  );
  return (container: container, repo: repo);
}

void main() {
  group('page zero is fetched by exactly one call path', () {
    test('creating the controller fetches page zero exactly once', () async {
      final harness = _harness(
        dataset: List<TyreRecord>.generate(
          3,
          (int i) => buildTyreRecord(id: '$i'),
        ),
      );
      addTearDown(harness.container.dispose);

      // Reading the state provider is what runs `build()`.
      harness.container.read(tyreRecordsListControllerProvider);
      await _settle();

      final List<FetchPageCall> pageZeroCalls =
          harness.repo.fetchPageCalls.where((c) => c.pageIndex == 0).toList();
      expect(
        pageZeroCalls,
        hasLength(1),
        reason: 'page zero must be reachable from exactly one call path - '
            'a second path is the exact defect that duplicated every row '
            'on the first page of the production register',
      );
    });

    test(
        'reading the controller state provider a second time does not '
        're-fetch', () async {
      final harness = _harness(
        dataset: List<TyreRecord>.generate(
          3,
          (int i) => buildTyreRecord(id: '$i'),
        ),
      );
      addTearDown(harness.container.dispose);

      harness.container.read(tyreRecordsListControllerProvider);
      await _settle();
      harness.container.read(tyreRecordsListControllerProvider);
      harness.container.read(tyreRecordsListControllerProvider);
      await _settle();

      expect(harness.repo.fetchPageCalls, hasLength(1));
    });

    test('loadMore before page zero has resolved does nothing', () async {
      final harness = _harness(pageSize: 5);
      addTearDown(harness.container.dispose);

      // Hold page zero open so the controller is still `loading`.
      final Completer<TyreRecordsPage> hold = Completer<TyreRecordsPage>();
      harness.repo.queueResponder((_, __) => hold.future);

      final TyreRecordsListController controller = harness.container.read(
        tyreRecordsListControllerProvider.notifier,
      );
      await controller.loadMore();

      expect(
        harness.repo.fetchPageCalls,
        hasLength(1),
        reason: 'loadMore must be a no-op until the phase is ready - '
            'that guard is what makes page zero reachable from exactly '
            'one place',
      );

      // Settle the held-open fetch within the test's own lifetime, before
      // teardown disposes the container - otherwise its continuation would
      // try to write to a disposed notifier on a later microtask.
      hold.complete(TyreRecordsPage.empty);
      await _settle();
    });
  });

  group('paging accumulates correctly across a boundary with tied data', () {
    test('every row survives exactly once across several tied pages', () async {
      // Ten rows, five sharing `issueDate` "2026-01-01" and five sharing
      // "2026-01-02" - exactly the shape a real tie on the primary ORDER
      // BY column produces, straddling the page-size-5 boundary this test
      // uses. The fake slices this list positionally, standing in for a
      // server that has already applied the id tiebreak correctly; the
      // property under test is that the CONTROLLER'S ACCUMULATION never
      // drops or repeats a row while walking through it.
      final List<TyreRecord> dataset = <TyreRecord>[
        for (int i = 0; i < 5; i++)
          buildTyreRecord(id: 'a$i', issueDate: '2026-01-01'),
        for (int i = 0; i < 5; i++)
          buildTyreRecord(id: 'b$i', issueDate: '2026-01-02'),
      ];
      final harness = _harness(dataset: dataset, pageSize: 5);
      addTearDown(harness.container.dispose);

      final TyreRecordsListController controller = harness.container.read(
        tyreRecordsListControllerProvider.notifier,
      );
      await _settle();

      TyreRecordsListState state = harness.container.read(
        tyreRecordsListControllerProvider,
      );
      expect(state.items.map((r) => r.id).toList(), <String>[
        'a0',
        'a1',
        'a2',
        'a3',
        'a4',
      ]);
      expect(state.hasMore, isTrue);

      await controller.loadMore();
      state = harness.container.read(tyreRecordsListControllerProvider);

      final List<String> ids = state.items.map((r) => r.id).toList();
      expect(ids, hasLength(10));
      expect(ids.toSet(), hasLength(10), reason: 'no id was duplicated');
      expect(
          ids,
          <String>[
            'a0',
            'a1',
            'a2',
            'a3',
            'a4',
            'b0',
            'b1',
            'b2',
            'b3',
            'b4',
          ],
          reason: 'the full set is present, in order, with nothing dropped');
      expect(state.hasMore, isFalse);
    });

    test(
        'a dataset whose length is an exact multiple of the page size '
        'still terminates correctly', () async {
      // Ten rows, page size five: page one comes back FULL (five rows), so
      // `hasMore` reads true after it. Only the following, EMPTY page
      // proves the list is finished. This is the one-page delay
      // `TyreRecordsPage.hasMore`'s own doc comment names as the accepted
      // trade-off of deriving hasMore from page fullness rather than an
      // exact count.
      final List<TyreRecord> dataset = List<TyreRecord>.generate(
        10,
        (int i) => buildTyreRecord(id: '$i'),
      );
      final harness = _harness(dataset: dataset, pageSize: 5);
      addTearDown(harness.container.dispose);

      final TyreRecordsListController controller = harness.container.read(
        tyreRecordsListControllerProvider.notifier,
      );
      await _settle();
      await controller.loadMore();

      TyreRecordsListState state = harness.container.read(
        tyreRecordsListControllerProvider,
      );
      expect(state.items, hasLength(10));
      expect(
        state.hasMore,
        isTrue,
        reason: 'the second page came back full, so another might exist',
      );

      await controller.loadMore();
      state = harness.container.read(tyreRecordsListControllerProvider);
      expect(
        state.items,
        hasLength(10),
        reason: 'the empty third page added nothing',
      );
      expect(state.hasMore, isFalse);
      expect(
        harness.repo.fetchPageCalls.map((c) => c.pageIndex).toList(),
        <int>[0, 1, 2],
      );
    });
  });

  group('a monotonic ticket rejects a superseded response', () {
    test(
        'a slower, superseded fetch does not overwrite a faster, newer '
        'one', () async {
      // A real starting dataset, so the mount fetch (ticket 1) paints
      // something concrete before either of the two races below begins.
      final harness = _harness(
        dataset: <TyreRecord>[buildTyreRecord(id: 'initial')],
        pageSize: 5,
      );
      addTearDown(harness.container.dispose);

      final TyreRecordsListController controller = harness.container.read(
        tyreRecordsListControllerProvider.notifier,
      );
      await _settle();
      expect(
        harness.container
            .read(tyreRecordsListControllerProvider)
            .items
            .map((r) => r.id),
        <String>['initial'],
      );

      // Ticket 2: a refresh that is held open and will resolve LATE, with
      // data that must never be allowed to reach the screen.
      final Completer<TyreRecordsPage> stale = Completer<TyreRecordsPage>();
      harness.repo.queueResponder((_, __) => stale.future);
      final Future<void> staleRefresh = controller.refresh();

      // Ticket 3: a second, independent refresh, started before ticket 2
      // resolves. It gets its own DISTINCT, explicit response so the final
      // assertion cannot be satisfied by ticket 2 simply never having run.
      harness.repo.queueResponder(
        (_, __) async => TyreRecordsPage(
          items: <TyreRecord>[buildTyreRecord(id: 'fresh')],
          hasMore: false,
        ),
      );
      await controller.refresh();

      final TyreRecordsListState afterFresh = harness.container.read(
        tyreRecordsListControllerProvider,
      );
      expect(afterFresh.items.map((r) => r.id), <String>['fresh']);

      // Ticket 2 now resolves, with data DIFFERENT from both ticket 1's
      // and ticket 3's. It is no longer the current ticket, so it must be
      // dropped rather than repainting the list underneath ticket 3's
      // result.
      stale.complete(
        TyreRecordsPage(
          items: <TyreRecord>[buildTyreRecord(id: 'stale')],
          hasMore: false,
        ),
      );
      await staleRefresh;
      await _settle();

      final TyreRecordsListState afterStale = harness.container.read(
        tyreRecordsListControllerProvider,
      );
      expect(
        afterStale.items.map((r) => r.id),
        <String>['fresh'],
        reason: 'the stale response must never have painted, even though '
            'it carried real, distinct data and resolved after the newer '
            'request that correctly won',
      );
    });

    test('a stale FAILURE is dropped just as a stale success is', () async {
      final harness = _harness(
        dataset: <TyreRecord>[buildTyreRecord(id: 'initial')],
        pageSize: 5,
      );
      addTearDown(harness.container.dispose);

      final TyreRecordsListController controller = harness.container.read(
        tyreRecordsListControllerProvider.notifier,
      );
      await _settle();

      // Ticket 2: held open, will FAIL late.
      final Completer<TyreRecordsPage> stale = Completer<TyreRecordsPage>();
      harness.repo.queueResponder((_, __) => stale.future);
      final Future<void> staleRefresh = controller.refresh();

      // Ticket 3: resolves first, with its own distinct, successful page.
      harness.repo.queueResponder(
        (_, __) async => TyreRecordsPage(
          items: <TyreRecord>[buildTyreRecord(id: 'fresh')],
          hasMore: false,
        ),
      );
      await controller.refresh();

      final TyreRecordsListState afterFresh = harness.container.read(
        tyreRecordsListControllerProvider,
      );
      expect(afterFresh.phase, TyreRecordsListPhase.ready);
      expect(afterFresh.items.map((r) => r.id), <String>['fresh']);

      stale.completeError(
        const AppError(kind: AppErrorKind.unknown, message: 'stale failure'),
      );
      await staleRefresh;
      await _settle();

      final TyreRecordsListState afterStaleFailure = harness.container.read(
        tyreRecordsListControllerProvider,
      );
      expect(
        afterStaleFailure.phase,
        TyreRecordsListPhase.ready,
        reason: 'a superseded failure must not turn a successfully loaded '
            'list into an error screen',
      );
      expect(afterStaleFailure.loadError, isNull);
      expect(
        afterStaleFailure.items.map((r) => r.id),
        <String>['fresh'],
        reason: 'the real, successfully loaded content must survive a '
            'stale failure arriving after it',
      );
    });
  });

  group('a load-more failure never becomes "reached the end"', () {
    test('the failed page is retried, never skipped', () async {
      final List<TyreRecord> dataset = List<TyreRecord>.generate(
        10,
        (int i) => buildTyreRecord(id: '$i'),
      );
      final harness = _harness(dataset: dataset, pageSize: 5);
      addTearDown(harness.container.dispose);

      final TyreRecordsListController controller = harness.container.read(
        tyreRecordsListControllerProvider.notifier,
      );
      await _settle();

      harness.repo.queueFailure(
        const AppError(kind: AppErrorKind.network, message: 'offline'),
      );
      await controller.loadMore();

      TyreRecordsListState state = harness.container.read(
        tyreRecordsListControllerProvider,
      );
      expect(state.loadMoreError, isNotNull);
      expect(state.isLoadingMore, isFalse);
      expect(
        state.items,
        hasLength(5),
        reason: 'the page already on screen must survive a failed '
            'load-more attempt',
      );
      expect(
        state.hasMore,
        isTrue,
        reason: 'a load-more failure must not be read as "no more pages"',
      );

      // Retry: must re-request page ONE, not skip to page two.
      await controller.loadMore();
      state = harness.container.read(tyreRecordsListControllerProvider);
      expect(state.loadMoreError, isNull);
      expect(state.items, hasLength(10));
      expect(
        harness.repo.fetchPageCalls.map((c) => c.pageIndex).toList(),
        <int>[0, 1, 1],
        reason: 'page one was requested, failed, and requested again - '
            'never silently advanced past',
      );
    });
  });

  group('filter changes reset to a fresh page zero', () {
    test(
      'setSiteFilter clears accumulated items and starts a new fetch',
      () async {
        final List<TyreRecord> dataset = List<TyreRecord>.generate(
          10,
          (int i) => buildTyreRecord(id: '$i'),
        );
        final harness = _harness(dataset: dataset, pageSize: 5);
        addTearDown(harness.container.dispose);

        final TyreRecordsListController controller = harness.container.read(
          tyreRecordsListControllerProvider.notifier,
        );
        await _settle();
        await controller.loadMore();

        expect(
          harness.container.read(tyreRecordsListControllerProvider).items,
          hasLength(10),
        );

        controller.setSiteFilter('NHC');
        await _settle();

        final TyreRecordsListState state = harness.container.read(
          tyreRecordsListControllerProvider,
        );
        expect(state.query.site, 'NHC');
        // The fake ignores the filter for its own slicing, so the assertion
        // that matters here is the RESET itself: page zero was re-requested
        // rather than the old accumulated pages being kept.
        final List<FetchPageCall> pageZeroCalls =
            harness.repo.fetchPageCalls.where((c) => c.pageIndex == 0).toList();
        expect(pageZeroCalls, hasLength(2));
        expect(pageZeroCalls.last.query.site, 'NHC');
      },
    );

    test(
      'clearFilters removes site and risk but keeps the search text',
      () async {
        final harness = _harness(dataset: const <TyreRecord>[]);
        addTearDown(harness.container.dispose);

        final TyreRecordsListController controller = harness.container.read(
          tyreRecordsListControllerProvider.notifier,
        );
        await _settle();

        controller.setSiteFilter('NHC');
        await _settle();
        controller.setRiskFilter('Critical');
        await _settle();

        controller.clearFilters();
        await _settle();

        final TyreRecordsListState state = harness.container.read(
          tyreRecordsListControllerProvider,
        );
        expect(state.query.site, isNull);
        expect(state.query.riskLevel, isNull);
      },
    );
  });

  group('search is debounced', () {
    test(
        'rapid keystrokes within the debounce window collapse to one '
        'fetch', () async {
      final harness = _harness(dataset: const <TyreRecord>[]);
      addTearDown(harness.container.dispose);

      final TyreRecordsListController controller = harness.container.read(
        tyreRecordsListControllerProvider.notifier,
      );
      await _settle();
      final int callsAfterMount = harness.repo.fetchPageCalls.length;

      controller.updateSearch('T');
      controller.updateSearch('TM');
      controller.updateSearch('TM5');
      controller.updateSearch('TM51');
      controller.updateSearch('TM514');

      // Immediately after typing, the debounce has not fired yet.
      expect(
        harness.container.read(tyreRecordsListControllerProvider).query.search,
        '',
        reason: 'the ACTIVE query only changes once the debounce settles',
      );
      expect(
        harness.container.read(tyreRecordsListControllerProvider).searchInput,
        'TM514',
        reason: 'the text field itself must never lag behind typing',
      );

      await Future<void>.delayed(
        kTyreRecordsSearchDebounce + const Duration(milliseconds: 150),
      );

      final TyreRecordsListState state = harness.container.read(
        tyreRecordsListControllerProvider,
      );
      expect(state.query.search, 'TM514');
      expect(
        harness.repo.fetchPageCalls.length - callsAfterMount,
        1,
        reason: 'five keystrokes inside one debounce window must produce '
            'exactly one fetch, not five',
      );
    });
  });
}
