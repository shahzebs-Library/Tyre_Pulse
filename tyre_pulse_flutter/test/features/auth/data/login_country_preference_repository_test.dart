import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/auth/data/login_country_preference_repository.dart';
import 'package:tyre_pulse/features/auth/domain/login_country.dart';

final class _MemoryStore implements LoginCountryPreferenceStore {
  _MemoryStore({this.value});

  String? value;
  Object? readFailure;
  Object? writeFailure;
  Object? clearFailure;
  int clearCalls = 0;

  @override
  Future<void> clear() async {
    clearCalls += 1;
    if (clearFailure case final Object error) {
      Error.throwWithStackTrace(error, StackTrace.current);
    }
    value = null;
  }

  @override
  Future<String?> read() async {
    if (readFailure case final Object error) {
      Error.throwWithStackTrace(error, StackTrace.current);
    }
    return value;
  }

  @override
  Future<void> write(String nextValue) async {
    if (writeFailure case final Object error) {
      Error.throwWithStackTrace(error, StackTrace.current);
    }
    value = nextValue;
  }
}

void main() {
  group('LocalLoginCountryPreferenceRepository', () {
    test('returns null when no preference exists', () async {
      final repository = LocalLoginCountryPreferenceRepository(_MemoryStore());

      expect(await repository.read(), isNull);
    });

    test('decodes every supported persisted country', () async {
      final store = _MemoryStore();
      final repository = LocalLoginCountryPreferenceRepository(store);

      for (final LoginCountry country in LoginCountry.values) {
        store.value = country.storageValue;
        expect(await repository.read(), same(country));
      }
    });

    test('unknown persisted values become unselected, never a default',
        () async {
      final repository = LocalLoginCountryPreferenceRepository(
        _MemoryStore(value: 'unsupported-country'),
      );

      expect(await repository.read(), isNull);
    });

    test('save writes the stable value and clear removes it', () async {
      final store = _MemoryStore();
      final repository = LocalLoginCountryPreferenceRepository(store);

      await repository.save(LoginCountry.unitedArabEmirates);
      expect(store.value, 'united_arab_emirates');

      await repository.clear();
      expect(store.value, isNull);
      expect(store.clearCalls, 1);
    });

    test('storage failures are surfaced instead of reported as absent',
        () async {
      final failure = StateError('preferences unreadable');
      final store = _MemoryStore()..readFailure = failure;
      final repository = LocalLoginCountryPreferenceRepository(store);

      await expectLater(repository.read(), throwsA(same(failure)));
    });

    test('failed writes leave the prior persisted value untouched', () async {
      final failure = StateError('preferences unwritable');
      final store = _MemoryStore(value: 'egypt')..writeFailure = failure;
      final repository = LocalLoginCountryPreferenceRepository(store);

      await expectLater(
        repository.save(LoginCountry.saudiArabia),
        throwsA(same(failure)),
      );
      expect(store.value, 'egypt');
    });
  });
}
