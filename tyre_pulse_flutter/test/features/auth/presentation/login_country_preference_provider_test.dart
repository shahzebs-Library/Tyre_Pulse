import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/auth/data/login_country_preference_repository.dart';
import 'package:tyre_pulse/features/auth/domain/login_country.dart';
import 'package:tyre_pulse/features/auth/presentation/login_country_preference_provider.dart';

final class _FakeRepository implements LoginCountryPreferenceRepository {
  _FakeRepository({this.value});

  LoginCountry? value;
  Object? readFailure;
  Object? saveFailure;
  Object? clearFailure;
  Completer<void>? saveBlocker;

  @override
  Future<void> clear() async {
    if (clearFailure case final Object error) {
      Error.throwWithStackTrace(error, StackTrace.current);
    }
    value = null;
  }

  @override
  Future<LoginCountry?> read() async {
    if (readFailure case final Object error) {
      Error.throwWithStackTrace(error, StackTrace.current);
    }
    return value;
  }

  @override
  Future<void> save(LoginCountry country) async {
    await saveBlocker?.future;
    if (saveFailure case final Object error) {
      Error.throwWithStackTrace(error, StackTrace.current);
    }
    value = country;
  }
}

ProviderContainer _container(_FakeRepository repository) {
  final container = ProviderContainer(
    overrides: <Override>[
      loginCountryPreferenceRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  test('restores the remembered country', () async {
    final container = _container(
      _FakeRepository(value: LoginCountry.unitedArabEmirates),
    );

    expect(
      await container.read(loginCountryPreferenceProvider.future),
      LoginCountry.unitedArabEmirates,
    );
  });

  test('first launch resolves to unselected without inventing a default',
      () async {
    final container = _container(_FakeRepository());

    expect(
      await container.read(loginCountryPreferenceProvider.future),
      isNull,
    );
  });

  test('select publishes only after the durable write completes', () async {
    final blocker = Completer<void>();
    final repository = _FakeRepository()..saveBlocker = blocker;
    final container = _container(repository);
    await container.read(loginCountryPreferenceProvider.future);

    final Future<void> selection = container
        .read(loginCountryPreferenceProvider.notifier)
        .select(LoginCountry.egypt);

    expect(
      container.read(loginCountryPreferenceProvider).requireValue,
      isNull,
    );
    expect(repository.value, isNull);

    blocker.complete();
    await selection;

    expect(repository.value, LoginCountry.egypt);
    expect(
      container.read(loginCountryPreferenceProvider).requireValue,
      LoginCountry.egypt,
    );
  });

  test('clear removes only the visual preference and publishes null', () async {
    final repository = _FakeRepository(value: LoginCountry.saudiArabia);
    final container = _container(repository);
    await container.read(loginCountryPreferenceProvider.future);

    await container.read(loginCountryPreferenceProvider.notifier).clear();

    expect(repository.value, isNull);
    expect(
      container.read(loginCountryPreferenceProvider).requireValue,
      isNull,
    );
  });

  test('read failure is an explicit AsyncError, never null data', () async {
    final failure = StateError('preferences unreadable');
    final container = _container(_FakeRepository()..readFailure = failure);

    await expectLater(
      container.read(loginCountryPreferenceProvider.future),
      throwsA(same(failure)),
    );
    expect(container.read(loginCountryPreferenceProvider).hasError, isTrue);
  });

  test('failed selection keeps previous country and surfaces the error',
      () async {
    final failure = StateError('preferences unwritable');
    final repository = _FakeRepository(value: LoginCountry.egypt)
      ..saveFailure = failure;
    final container = _container(repository);
    await container.read(loginCountryPreferenceProvider.future);

    await expectLater(
      container
          .read(loginCountryPreferenceProvider.notifier)
          .select(LoginCountry.saudiArabia),
      throwsA(same(failure)),
    );

    final AsyncValue<LoginCountry?> state = container.read(
      loginCountryPreferenceProvider,
    );
    expect(state.hasError, isFalse);
    expect(state.requireValue, LoginCountry.egypt);
    expect(repository.value, LoginCountry.egypt);
  });
}
