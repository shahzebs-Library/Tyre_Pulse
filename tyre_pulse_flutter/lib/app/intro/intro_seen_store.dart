/// Remembers whether this install has already played the first-run intro.
///
/// Same pattern as `tp_display_settings.dart`: a SYNCHRONOUS interface, an
/// in-memory default for tests, and a durable store that is loaded once
/// before `runApp` (`main.dart`) so the first frame already knows whether to
/// show the intro. No flash of the intro on the second launch.
///
/// Storage is never allowed to block the app. An unreadable or slow read at
/// boot counts as "already seen": skipping a six-second animation is
/// harmless, showing it on every launch because storage is broken is not.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Reads and writes the "intro already played" flag.
abstract interface class IntroSeenStore {
  /// True once the intro has finished or been skipped on this install.
  bool readSeen();

  /// Records that the intro has been seen.
  void writeSeen();
}

/// The fallback store for tests.
///
/// Defaults to SEEN, so every existing widget test that pumps the app shell
/// is unaffected. A test that wants the intro builds `InMemoryIntroSeenStore(
/// seen: false)` and overrides [introSeenStoreProvider] with it.
class InMemoryIntroSeenStore implements IntroSeenStore {
  InMemoryIntroSeenStore({bool seen = true}) : _seen = seen;

  bool _seen;

  @override
  bool readSeen() => _seen;

  @override
  void writeSeen() => _seen = true;
}

/// Durable store on `shared_preferences`, loaded before `runApp`.
class SharedPreferencesIntroSeenStore implements IntroSeenStore {
  SharedPreferencesIntroSeenStore._(this._preferences, {required bool seen})
      : _seen = seen;

  /// Versioned and namespaced like the display settings keys.
  static const String seenKey = 'tyre_pulse.intro.seen.v1';

  /// How long boot waits for storage before giving up (and skipping).
  static const Duration loadTimeout = Duration(seconds: 2);

  /// Reads the flag once. Never throws.
  static Future<SharedPreferencesIntroSeenStore> load({
    SharedPreferencesAsync? preferences,
    Duration timeout = loadTimeout,
  }) async {
    final SharedPreferencesAsync prefs =
        preferences ?? SharedPreferencesAsync();
    bool seen;
    try {
      seen = (await prefs.getBool(seenKey).timeout(timeout)) ?? false;
    } on Object {
      // Unreadable storage: do not risk replaying the intro every launch.
      seen = true;
    }
    return SharedPreferencesIntroSeenStore._(prefs, seen: seen);
  }

  final SharedPreferencesAsync _preferences;
  bool _seen;

  @override
  bool readSeen() => _seen;

  @override
  void writeSeen() {
    if (_seen) return;
    _seen = true;
    unawaited(
      _preferences.setBool(seenKey, true).catchError((Object _) {
        // A failed write only means the intro may play once more.
      }),
    );
  }
}

/// Overridden in the root `ProviderScope` with the durable store.
final Provider<IntroSeenStore> introSeenStoreProvider =
    Provider<IntroSeenStore>((Ref ref) => InMemoryIntroSeenStore());

/// Whether the intro is showing right now.
///
/// True on the first launch of an install. Profile's "Replay intro" sets it
/// again; finishing or skipping clears it and records the flag.
class IntroController extends Notifier<bool> {
  @override
  bool build() => !ref.read(introSeenStoreProvider).readSeen();

  /// The intro ended (played out, skipped, or the reduce-motion pause).
  void finish() {
    ref.read(introSeenStoreProvider).writeSeen();
    state = false;
  }

  /// Plays the intro again over the current screen.
  void replay() => state = true;
}

final NotifierProvider<IntroController, bool> introVisibleProvider =
    NotifierProvider<IntroController, bool>(IntroController.new);
