import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/tyres/domain/serial_search_state.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_lookup_record.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_scrap_mark.dart';

const TyreLookupRecord _tyre = TyreLookupRecord(id: 'row-1');
const ScrapMark _mark = ScrapMark(serial: 'EP0604207');
const AppError _error = AppError(
  kind: AppErrorKind.network,
  message: 'No connection to the server.',
);

void main() {
  group('phase predicates', () {
    test('the default state is idle', () {
      const SerialSearchState state = SerialSearchState();
      expect(state.isIdle, isTrue);
      expect(state.isSearching, isFalse);
      expect(state.isFound, isFalse);
      expect(state.isEmptyResult, isFalse);
      expect(state.isError, isFalse);
    });

    test('found requires BOTH the phase and a non-null tyre', () {
      const SerialSearchState phaseOnly = SerialSearchState(
        phase: SerialSearchPhase.found,
      );
      expect(
        phaseOnly.isFound,
        isFalse,
        reason: 'a found phase with no tyre is not really found',
      );

      const SerialSearchState withTyre = SerialSearchState(
        phase: SerialSearchPhase.found,
        tyre: _tyre,
      );
      expect(withTyre.isFound, isTrue);
    });

    test('isScrapped reflects whether a scrap mark is present', () {
      const SerialSearchState scrapped = SerialSearchState(scrapMark: _mark);
      const SerialSearchState notScrapped = SerialSearchState();
      expect(scrapped.isScrapped, isTrue);
      expect(notScrapped.isScrapped, isFalse);
    });
  });

  group('offerScrap / offerUnscrap', () {
    const SerialSearchState found = SerialSearchState(
      phase: SerialSearchPhase.found,
      tyre: _tyre,
    );

    test('offerScrap is false until the server has answered true', () {
      expect(found.offerScrap, isFalse, reason: 'canScrap is null');
      expect(found.copyWith(canScrap: false).offerScrap, isFalse);
      expect(found.copyWith(canScrap: true).offerScrap, isTrue);
    });

    test('offerScrap is false once the tyre is already scrapped', () {
      final SerialSearchState scrapped = found.copyWith(
        canScrap: true,
        scrapMark: _mark,
      );
      expect(scrapped.offerScrap, isFalse);
    });

    test('offerUnscrap is false until canUnscrap is explicitly true', () {
      final SerialSearchState scrapped = found.copyWith(scrapMark: _mark);
      expect(scrapped.offerUnscrap, isFalse);
      expect(scrapped.copyWith(canUnscrap: true).offerUnscrap, isTrue);
    });

    test('offerUnscrap is false when the tyre is not scrapped, even if '
        'canUnscrap is true', () {
      final SerialSearchState notScrapped = found.copyWith(canUnscrap: true);
      expect(notScrapped.offerUnscrap, isFalse);
    });

    test('neither action is offered before a result is found', () {
      const SerialSearchState idle = SerialSearchState();
      expect(idle.copyWith(canScrap: true).offerScrap, isFalse);
      expect(idle.copyWith(canUnscrap: true).offerUnscrap, isFalse);
    });
  });

  group('copyWith', () {
    test('an unspecified field is carried over unchanged', () {
      const SerialSearchState original = SerialSearchState(query: 'ABC');
      final SerialSearchState copy = original.copyWith(isScrapBusy: true);
      expect(copy.query, 'ABC');
      expect(copy.isScrapBusy, isTrue);
    });

    test('clearTyre sets tyre to null even though tyre was not passed', () {
      const SerialSearchState withTyre = SerialSearchState(tyre: _tyre);
      final SerialSearchState cleared = withTyre.copyWith(clearTyre: true);
      expect(cleared.tyre, isNull);
    });

    test('clearScrapMark, clearError and clearResolvedSerial each clear '
        'independently of the others', () {
      const SerialSearchState full = SerialSearchState(
        resolvedSerial: 'EP0604207',
        scrapMark: _mark,
        lastError: _error,
      );

      final SerialSearchState clearedMark = full.copyWith(clearScrapMark: true);
      expect(clearedMark.scrapMark, isNull);
      expect(clearedMark.resolvedSerial, 'EP0604207');
      expect(clearedMark.lastError, _error);

      final SerialSearchState clearedError = full.copyWith(clearError: true);
      expect(clearedError.lastError, isNull);
      expect(clearedError.scrapMark, _mark);

      final SerialSearchState clearedSerial = full.copyWith(
        clearResolvedSerial: true,
      );
      expect(clearedSerial.resolvedSerial, isNull);
      expect(clearedSerial.scrapMark, _mark);
    });

    test('passing a new value together with its clear flag is dominated '
        'by the clear flag', () {
      const SerialSearchState withTyre = SerialSearchState(tyre: _tyre);
      final SerialSearchState result = withTyre.copyWith(
        tyre: const TyreLookupRecord(id: 'row-2'),
        clearTyre: true,
      );
      expect(
        result.tyre,
        isNull,
        reason:
            'copyWith checks the clear flag before the replacement '
            'value, matching WorkspaceContext.copyWith',
      );
    });
  });

  group('equality', () {
    test('two states built the same way are equal', () {
      SerialSearchState build() => const SerialSearchState(
        phase: SerialSearchPhase.found,
        tyre: _tyre,
        canScrap: true,
      );
      expect(build(), build());
      expect(build().hashCode, build().hashCode);
    });

    test('a different phase makes two states unequal', () {
      const SerialSearchState a = SerialSearchState(
        phase: SerialSearchPhase.idle,
      );
      const SerialSearchState b = SerialSearchState(
        phase: SerialSearchPhase.searching,
      );
      expect(a, isNot(b));
    });
  });
}
