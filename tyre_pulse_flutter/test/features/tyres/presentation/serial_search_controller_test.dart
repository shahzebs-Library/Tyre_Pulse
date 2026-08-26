/// Tests [SerialSearchController] entirely through [ProviderContainer] -
/// no widget tree, no [BuildContext], no `flutter_test` pumping. The
/// controller's dependency is [FakeTyreLookupRepository], a plain Dart
/// class implementing [TyreLookupRepository], so nothing here touches
/// Supabase at all.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/tyres/data/tyre_lookup_repository.dart';
import 'package:tyre_pulse/features/tyres/domain/serial_search_state.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_lookup_record.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_scrap_mark.dart';
import 'package:tyre_pulse/features/tyres/presentation/'
    'serial_search_controller.dart';
import 'package:tyre_pulse/features/tyres/presentation/serial_search_deps.dart';

/// A fully scripted [TyreLookupRepository]. Every method records how many
/// times it was called and with what, so a test can assert the controller
/// called exactly the right thing exactly the right number of times.
class FakeTyreLookupRepository implements TyreLookupRepository {
  bool canScrapAnswer = true;
  bool canUnscrapAnswer = true;

  TyreLookupRecord? lookupResult;
  Object? lookupError;
  int lookupCalls = 0;
  String? lastLookupSerial;

  ScrapMark? scrapMarkResult;
  Object? scrapMarkError;
  int scrapMarkCalls = 0;

  Object? scrapError;
  int scrapCalls = 0;
  String? lastScrapSerial;
  String? lastScrapReason;

  Object? unscrapError;
  int unscrapCalls = 0;
  String? lastUnscrapSerial;

  @override
  Future<TyreLookupRecord?> lookupBySerial(String rawSerial) async {
    lookupCalls++;
    lastLookupSerial = rawSerial;
    final Object? error = lookupError;
    if (error != null) throw error;
    return lookupResult;
  }

  @override
  Future<ScrapMark?> getScrapMark(String rawSerial) async {
    scrapMarkCalls++;
    final Object? error = scrapMarkError;
    if (error != null) throw error;
    return scrapMarkResult;
  }

  @override
  Future<bool> canScrap() async => canScrapAnswer;

  @override
  Future<bool> canUnscrap() async => canUnscrapAnswer;

  @override
  Future<int> scrapBySerial(String rawSerial, {String? reason}) async {
    scrapCalls++;
    lastScrapSerial = rawSerial;
    lastScrapReason = reason;
    final Object? error = scrapError;
    if (error != null) throw error;
    return 1;
  }

  @override
  Future<void> unscrapBySerial(String rawSerial) async {
    unscrapCalls++;
    lastUnscrapSerial = rawSerial;
    final Object? error = unscrapError;
    if (error != null) throw error;
  }
}

/// Flushes the chained `await`s inside `_loadPermissions` (two calls, each
/// on a fake that itself awaits nothing real). Plain `Duration.zero` delays
/// rather than a `pumpEventQueue` helper, which this test avoids depending
/// on without being able to confirm it is re-exported by `flutter_test` in
/// the installed version.
Future<void> _settle() async {
  for (int i = 0; i < 4; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

({ProviderContainer container, FakeTyreLookupRepository repo}) _harness() {
  final FakeTyreLookupRepository repo = FakeTyreLookupRepository();
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      tyreLookupRepositoryProvider.overrideWithValue(repo),
    ],
  );
  return (container: container, repo: repo);
}

void main() {
  group('build() - permissions load on first read', () {
    test('canScrap and canUnscrap resolve from the repository', () async {
      final (:container, :repo) = _harness();
      addTearDown(container.dispose);
      repo
        ..canScrapAnswer = true
        ..canUnscrapAnswer = false;

      container.read(serialSearchControllerProvider); // triggers build()
      await _settle();

      final SerialSearchState state =
          container.read(serialSearchControllerProvider);
      expect(state.canScrap, isTrue);
      expect(state.canUnscrap, isFalse);
    });

    test('starts idle, with nothing searched', () {
      final (:container, :repo) = _harness();
      addTearDown(container.dispose);

      final SerialSearchState state =
          container.read(serialSearchControllerProvider);
      expect(state.isIdle, isTrue);
      expect(state.tyre, isNull);
      expect(state.resolvedSerial, isNull);
    });
  });

  group('search', () {
    test('a successful lookup moves to found and carries the tyre',
        () async {
      final (:container, :repo) = _harness();
      addTearDown(container.dispose);
      const TyreLookupRecord tyre = TyreLookupRecord(
        id: 'row-1',
        assetNo: 'TM514',
      );
      repo.lookupResult = tyre;

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.search('EP0604207');

      final SerialSearchState state =
          container.read(serialSearchControllerProvider);
      expect(state.isFound, isTrue);
      expect(state.tyre, tyre);
      expect(state.resolvedSerial, 'EP0604207');
      expect(repo.lookupCalls, 1);
    });

    test('no match moves to the empty phase, not an error', () async {
      final (:container, :repo) = _harness();
      addTearDown(container.dispose);
      repo.lookupResult = null;

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.search('DOES-NOT-EXIST');

      final SerialSearchState state =
          container.read(serialSearchControllerProvider);
      expect(state.isEmptyResult, isTrue);
      expect(state.tyre, isNull);
    });

    test('a lookup failure moves to the error phase with a safe message',
        () async {
      final (:container, :repo) = _harness();
      addTearDown(container.dispose);
      repo.lookupError = StateError('offline');

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.search('EP0604207');

      final SerialSearchState state =
          container.read(serialSearchControllerProvider);
      expect(state.isError, isTrue);
      expect(state.lastError, isNotNull);
    });

    test('a blank query is a no-op - the repository is never called',
        () async {
      final (:container, :repo) = _harness();
      addTearDown(container.dispose);

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.search('   ');

      expect(repo.lookupCalls, 0);
      expect(
        container.read(serialSearchControllerProvider).isIdle,
        isTrue,
      );
    });

    test('a scanned URL payload is unwrapped before it reaches the '
        'repository', () async {
      final (:container, :repo) = _harness();
      addTearDown(container.dispose);
      repo.lookupResult = const TyreLookupRecord(id: 'row-1');

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.search(
        'https://app.tyrepulse.app/scan?serial=EP0604207',
      );

      expect(repo.lastLookupSerial, 'EP0604207');
      expect(
        container.read(serialSearchControllerProvider).resolvedSerial,
        'EP0604207',
      );
    });

    test('a failed scrap-status lookup after a successful find does not '
        'hide the result - the tyre still shows as found', () async {
      final (:container, :repo) = _harness();
      addTearDown(container.dispose);
      repo
        ..lookupResult = const TyreLookupRecord(id: 'row-1')
        ..scrapMarkError = StateError('offline');

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.search('EP0604207');

      final SerialSearchState state =
          container.read(serialSearchControllerProvider);
      expect(state.isFound, isTrue);
      expect(state.scrapMark, isNull);
    });

    test('search reads state.query when called with no argument', () async {
      final (:container, :repo) = _harness();
      addTearDown(container.dispose);
      repo.lookupResult = const TyreLookupRecord(id: 'row-1');

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      controller.setQuery('EP0604207');
      await controller.search();

      expect(repo.lastLookupSerial, 'EP0604207');
    });
  });

  group('clear', () {
    test('returns to the idle default, discarding any prior result',
        () async {
      final (:container, :repo) = _harness();
      addTearDown(container.dispose);
      repo.lookupResult = const TyreLookupRecord(id: 'row-1');

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.search('EP0604207');
      expect(
        container.read(serialSearchControllerProvider).isFound,
        isTrue,
      );

      controller.clear();
      final SerialSearchState state =
          container.read(serialSearchControllerProvider);
      expect(state.isIdle, isTrue);
      expect(state.tyre, isNull);
      expect(state.query, isEmpty);
    });
  });

  group('confirmScrap', () {
    Future<(ProviderContainer, FakeTyreLookupRepository)>
        readyToScrap() async {
      final (:container, :repo) = _harness();
      repo.lookupResult = const TyreLookupRecord(id: 'row-1');
      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.search('EP0604207');
      return (container, repo);
    }

    test('calls the repository exactly once, with the resolved serial '
        'and the reason', () async {
      final (ProviderContainer container, FakeTyreLookupRepository repo) =
          await readyToScrap();
      addTearDown(container.dispose);

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.confirmScrap(reason: 'Worn beyond limit');

      expect(repo.scrapCalls, 1);
      expect(repo.lastScrapSerial, 'EP0604207');
      expect(repo.lastScrapReason, 'Worn beyond limit');
    });

    test('re-reads the scrap mark after a successful scrap', () async {
      final (ProviderContainer container, FakeTyreLookupRepository repo) =
          await readyToScrap();
      addTearDown(container.dispose);
      repo.scrapMarkResult = const ScrapMark(serial: 'EP0604207');

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.confirmScrap();

      final SerialSearchState state =
          container.read(serialSearchControllerProvider);
      expect(state.isScrapped, isTrue);
      expect(state.isScrapBusy, isFalse);
    });

    test('a refusal from the repository lands in lastError and clears '
        'the busy flag - the state is not left stuck mid-action',
        () async {
      final (ProviderContainer container, FakeTyreLookupRepository repo) =
          await readyToScrap();
      addTearDown(container.dispose);
      repo.scrapError = const AppError(
        kind: AppErrorKind.authorization,
        message: 'You do not have permission to mark a tyre as scrapped.',
      );

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.confirmScrap();

      final SerialSearchState state =
          container.read(serialSearchControllerProvider);
      expect(state.lastError, isNotNull);
      expect(state.isScrapBusy, isFalse);
      expect(
        state.isScrapped,
        isFalse,
        reason: 'a refused scrap must not be reflected as scrapped',
      );
    });

    test('is a no-op when nothing has been searched', () async {
      final (:container, :repo) = _harness();
      addTearDown(container.dispose);

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.confirmScrap(reason: 'Worn');

      expect(repo.scrapCalls, 0);
    });

    test('two overlapping presses reach the repository only ONCE - the '
        'busy guard is checked before the first await', () async {
      final (ProviderContainer container, FakeTyreLookupRepository repo) =
          await readyToScrap();
      addTearDown(container.dispose);

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);

      final Future<void> first = controller.confirmScrap(reason: 'A');
      final Future<void> second = controller.confirmScrap(reason: 'B');
      await Future.wait(<Future<void>>[first, second]);

      expect(
        repo.scrapCalls,
        1,
        reason: 'a double press must not scrap the same tyre twice',
      );
    });
  });

  group('undoScrap', () {
    Future<(ProviderContainer, FakeTyreLookupRepository)>
        readyToUndo() async {
      final (:container, :repo) = _harness();
      repo
        ..lookupResult = const TyreLookupRecord(id: 'row-1')
        ..scrapMarkResult = const ScrapMark(serial: 'EP0604207');
      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.search('EP0604207');
      return (container, repo);
    }

    test('calls the repository exactly once with the resolved serial',
        () async {
      final (ProviderContainer container, FakeTyreLookupRepository repo) =
          await readyToUndo();
      addTearDown(container.dispose);

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.undoScrap();

      expect(repo.unscrapCalls, 1);
      expect(repo.lastUnscrapSerial, 'EP0604207');
    });

    test('clears the scrap mark locally on success, without a second '
        'read - the caller already knows the outcome', () async {
      final (ProviderContainer container, FakeTyreLookupRepository repo) =
          await readyToUndo();
      addTearDown(container.dispose);

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.undoScrap();

      final SerialSearchState state =
          container.read(serialSearchControllerProvider);
      expect(state.isScrapped, isFalse);
      expect(state.isUnscrapBusy, isFalse);
    });

    test('a refusal leaves the tyre still showing as scrapped', () async {
      final (ProviderContainer container, FakeTyreLookupRepository repo) =
          await readyToUndo();
      addTearDown(container.dispose);
      repo.unscrapError = const AppError(
        kind: AppErrorKind.authorization,
        message: 'You do not have permission to undo a scrap.',
      );

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.undoScrap();

      final SerialSearchState state =
          container.read(serialSearchControllerProvider);
      expect(state.lastError, isNotNull);
      expect(state.isScrapped, isTrue);
      expect(state.isUnscrapBusy, isFalse);
    });

    test('is a no-op when nothing has been searched', () async {
      final (:container, :repo) = _harness();
      addTearDown(container.dispose);

      final SerialSearchController controller =
          container.read(serialSearchControllerProvider.notifier);
      await controller.undoScrap();

      expect(repo.unscrapCalls, 0);
    });
  });
}
