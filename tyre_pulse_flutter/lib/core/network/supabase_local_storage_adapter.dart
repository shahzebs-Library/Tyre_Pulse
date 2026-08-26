/// Backs the Supabase client's own session persistence with the durable
/// staged secure store, instead of `supabase_flutter`'s default
/// `SharedPreferences`-backed storage.
///
/// # Why this file exists
///
/// `Supabase.initialize` accepts a `localStorage:` override precisely so the
/// session blob does not sit unencrypted in `SharedPreferences`. Spec
/// section 55, and the `SecureKeyValueStore` doc comment, both name the same
/// failure this closes: a plain key-value read that can only answer
/// `String?` conflates "there is no session" with "the store could not be
/// read". The production React Native app was caught doing exactly that - a
/// Keystore call was refused, the client read `null`, and a signed-in tyre
/// man whose account he did not create himself was dropped onto a login
/// screen he could not pass, with his unsynced inspections stranded behind
/// it.
///
/// # The one place the distinction is still lost, and why that is unavoidable
///
/// [SecureKeyValueStore.read] answers WHY a value is empty, via
/// `SecureReadStatus`. The `LocalStorage` interface this file implements
/// cannot: `hasAccessToken()` returns `bool` and `accessToken()` returns
/// `String?`, so a failed read and a genuinely absent session both surface to
/// the Supabase client as "nothing here". That is the SDK's contract, not a
/// choice made in this file, and it is exactly why
/// [SecureKeyValueStore.readValue] exists as the one named exception to "use
/// [SecureKeyValueStore.read] everywhere else" - this adapter is the caller
/// the storage layer's own doc comment names.
///
/// What this adapter DOES guarantee within that limit:
///
/// 1. **It never turns a failed read into a destructive write.** A read that
///    could not complete answers `null` and stops there - it does not delete
///    the slot, overwrite it, or "clean up" what it could not see. Whatever
///    the SDK does with that `null` (typically: conclude the session is
///    gone), the bytes on disk are untouched, so a later successful read can
///    still recover the real session.
/// 2. **The signal survives, one layer down.**
///    [SecureKeyValueStore.readFailureCount] is monotonic and lives on the
///    store this adapter wraps, not inside this adapter. A caller holding
///    that same [SecureKeyValueStore] - the session-restore logic that will
///    live in `core/auth` - can snapshot it around app start and learn
///    whether an observed "no session" was real or was a storage failure,
///    even though the Supabase client itself could not tell the difference.
///    [SupabaseLocalStorageAdapter.readFailureCount] is a thin passthrough to
///    that same count, for a caller that only has this adapter in hand.
///
/// # UNVERIFIED: the exact `LocalStorage` method signatures
///
/// No Flutter SDK and no pub cache exist in this environment (see
/// `docs/TOOLCHAIN.md`), so the abstract `LocalStorage` class implemented
/// below could not be read from the installed `supabase_flutter: ^2.17.2`
/// source. The five members - `initialize()`, `hasAccessToken()`,
/// `accessToken()`, `persistSession(String)`, `removePersistedSession()` -
/// are transcribed from this project's best-confidence knowledge of that
/// interface, which has been stable across `supabase_flutter` 1.x and 2.x and
/// matches the shape Supabase's own documentation shows for a custom
/// `flutter_secure_storage`-backed implementation. **CI confirms this
/// compiles against the pinned version; this comment does not.**
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';

/// Adapts a [SecureKeyValueStore] to the shape `Supabase.initialize`'s
/// `localStorage:` parameter expects.
///
/// Holds exactly one slot: the whole persisted-session string the Supabase
/// client hands over. It is not "the access token" despite the method name -
/// that is GoTrue's own historical naming - it is the full session blob GoTrue
/// later parses back into a session.
class SupabaseLocalStorageAdapter implements LocalStorage {
  SupabaseLocalStorageAdapter(this._store);

  /// The [SecureKeyValueStore] slot the session is written to.
  ///
  /// Public and stable so a diagnostics screen, or a test, can reference it
  /// symbolically instead of duplicating the string.
  static const String sessionStorageKey = 'supabase_session';

  final SecureKeyValueStore _store;

  /// How many underlying reads have failed since [_store] was created.
  ///
  /// Not part of the `LocalStorage` contract - see the library comment for
  /// why that interface cannot carry this signal on its own. A caller doing
  /// session restore reads this (or, better, holds the same
  /// [SecureKeyValueStore] and reads [SecureKeyValueStore.readFailureCount]
  /// directly) to tell "no session" from "could not read it".
  int get readFailureCount => _store.readFailureCount;

  @override
  Future<void> initialize() async {
    // Nothing to do. The `SecureKeyValueStore` this adapter wraps is already
    // open by the time this constructor runs - opening the platform keystore
    // is the storage layer's job, done before `Supabase.initialize` is ever
    // called. See `supabase_bootstrap.dart`.
  }

  @override
  Future<bool> hasAccessToken() async => await accessToken() != null;

  @override
  Future<String?> accessToken() => _store.readValue(sessionStorageKey);

  @override
  Future<void> persistSession(String persistSessionString) =>
      _store.write(sessionStorageKey, persistSessionString);

  @override
  Future<void> removePersistedSession() => _store.delete(sessionStorageKey);
}
