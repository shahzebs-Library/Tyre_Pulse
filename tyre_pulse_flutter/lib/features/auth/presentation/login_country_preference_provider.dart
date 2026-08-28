/// Riverpod state for the remembered visual country on the login screen.
///
/// The provider intentionally exposes `LoginCountry?`, never a workspace
/// model. Null means first launch/no choice. Loading and errors remain explicit
/// through [AsyncValue], so storage failure is never mistaken for "Saudi",
/// "UAE", or "Egypt" and never changes authenticated access.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/features/auth/data/login_country_preference_repository.dart';
import 'package:tyre_pulse/features/auth/domain/login_country.dart';

/// Overridable persistence boundary for tests and alternate host platforms.
final Provider<LoginCountryPreferenceRepository>
    loginCountryPreferenceRepositoryProvider =
    Provider<LoginCountryPreferenceRepository>((Ref ref) {
  return LocalLoginCountryPreferenceRepository(
    SharedPreferencesLoginCountryPreferenceStore(),
  );
});

/// Owns initial restore and durable mutations of the login presentation.
final class LoginCountryPreferenceController
    extends AsyncNotifier<LoginCountry?> {
  @override
  Future<LoginCountry?> build() =>
      ref.watch(loginCountryPreferenceRepositoryProvider).read();

  /// Saves a visual login country and publishes it only after persistence
  /// succeeds. A failed write restores the previous state and surfaces the
  /// storage error to the caller, which can show a retry message without
  /// visually switching country.
  Future<void> select(LoginCountry country) async {
    await _mutate(
      mutation: () =>
          ref.read(loginCountryPreferenceRepositoryProvider).save(country),
      nextValue: country,
    );
  }

  /// Returns to first-launch country selection without affecting any session,
  /// profile, workspace, permission, or offline business record.
  Future<void> clear() async {
    await _mutate(
      mutation: () =>
          ref.read(loginCountryPreferenceRepositoryProvider).clear(),
      nextValue: null,
    );
  }

  Future<void> _mutate({
    required Future<void> Function() mutation,
    required LoginCountry? nextValue,
  }) async {
    final AsyncValue<LoginCountry?> previous = state;

    try {
      await mutation();
      state = AsyncData<LoginCountry?>(nextValue);
    } on Object catch (error, stackTrace) {
      state = previous;
      Error.throwWithStackTrace(error, stackTrace);
    }
  }
}

/// UI contract:
///
/// * `ref.watch(loginCountryPreferenceProvider)` renders loading/data/error;
/// * null data renders the first-launch country picker;
/// * call `.select(country)` to save a choice;
/// * call `.clear()` for an explicit "Change country" action.
final AsyncNotifierProvider<LoginCountryPreferenceController, LoginCountry?>
    loginCountryPreferenceProvider =
    AsyncNotifierProvider<LoginCountryPreferenceController, LoginCountry?>(
  LoginCountryPreferenceController.new,
);
