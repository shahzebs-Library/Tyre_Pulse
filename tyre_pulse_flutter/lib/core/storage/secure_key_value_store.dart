/// The contract every consumer of secure storage codes against, plus the
/// read-modify-write guard that makes one whole class of data loss unwritable.
///
/// This file is pure: no Flutter, no plugin, no platform.
library;

import 'dart:async';

import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';

/// A read of secure storage failed, so the caller may not act on the emptiness.
///
/// Thrown by [SecureKeyValueStore.updateValue]. It exists so a failed read is
/// impossible to mistake for an empty store: an exception cannot be silently
/// folded into `?? []` the way a null can.
class StorageReadFailure implements Exception {
  const StorageReadFailure({required this.key, required this.status});

  /// The slot that could not be read. Slot names are declared constants, not
  /// user data, so this is safe to log.
  final String key;

  /// [SecureReadStatus.unreadable] or [SecureReadStatus.torn]. Never
  /// [SecureReadStatus.ok] or [SecureReadStatus.absent].
  final SecureReadStatus status;

  /// The user-facing form. The message deliberately does not say "empty" or
  /// "not found": we do not know that, and saying it is how the original bug
  /// reached the screen.
  AppError toAppError() => AppError(
    kind: AppErrorKind.storage,
    message:
        'This device could not read its saved data just now. '
        'Nothing has been changed. Try again in a moment.',
    technical:
        'secure storage read failed for slot "$key" '
        '(${status.name})',
    cause: this,
    isRetryable: true,
  );

  @override
  String toString() => 'StorageReadFailure($key, ${status.name})';
}

/// Encrypted storage for values the app cannot afford to lose: the session, the
/// offline queues, and captured work that has not reached the server.
///
/// Implementations must never let a read throw. A read that fails answers
/// [SecureReadStatus.unreadable].
abstract class SecureKeyValueStore {
  /// The value together with the reason it is what it is.
  ///
  /// Prefer this anywhere the difference between "nothing stored" and "could
  /// not read" changes what the user is shown - above all, deciding whether
  /// somebody is signed out.
  Future<SecureRead> read(String key);

  /// Replaces the value at [key].
  ///
  /// A write either takes effect completely or leaves the previous value
  /// intact. It never leaves a partial one. Throws [AppError] with
  /// [AppErrorKind.storage] when it did not take effect.
  Future<void> write(String key, String value);

  /// Removes [key]. Throws [AppError] when the removal did not take effect,
  /// because a sign-out that quietly failed leaves a session on the device.
  Future<void> delete(String key);

  /// How many reads have ended [SecureReadStatus.unreadable] or
  /// [SecureReadStatus.torn] for the life of this store.
  ///
  /// Monotonic. A caller that saw only an empty value can snapshot this before
  /// and after its own read and learn whether the emptiness was a storage
  /// failure. That is the signal a session restore needs, because the Supabase
  /// client's own storage interface can only hand back `String?`.
  int get readFailureCount;

  /// The bare value, or null for anything that is not a complete read.
  ///
  /// Provided for the one caller that genuinely cannot express more - the
  /// Supabase session storage interface. Everything else should use [read].
  Future<String?> readValue(String key) async => (await read(key)).value;

  /// Read, transform, write - and REFUSE when the read did not succeed.
  ///
  /// **Why this method exists.** Artifact 05 section 1.4 records the shape of
  /// the loss it prevents: `getQueue()` and `getRecordQueue()` answered `[]`
  /// for both "nothing is queued" and "the Keystore refused", and ten callers
  /// then saved what they read - replacing an inspector's unsynced field work
  /// with an empty list, silently, with the only copy on that device.
  ///
  /// Any read-modify-write on this store goes through here. [update] is only
  /// ever called with a value we actually read: either the stored text, or null
  /// when the store proved there is nothing stored. On
  /// [SecureReadStatus.unreadable] or [SecureReadStatus.torn] it throws
  /// [StorageReadFailure] and writes nothing.
  ///
  /// **THE DELIBERATE TRADE.** This risks failing to save ONE new item rather
  /// than silently destroying ALL of them. A refused save is visible and
  /// retryable; an overwritten queue is neither. `torn` refuses for the same
  /// reason as `unreadable`: something was committed at that key, and treating
  /// the remains as "nothing" would write over them.
  ///
  /// Returning null from [update] deletes the key, so "clear this queue" is
  /// expressible without a second unguarded path.
  Future<void> updateValue(
    String key,
    FutureOr<String?> Function(String? current) update,
  ) async {
    final current = await read(key);
    if (current.failed) {
      throw StorageReadFailure(key: key, status: current.status);
    }

    final next = await update(current.value);
    if (next == null) {
      await delete(key);
      return;
    }
    await write(key, next);
  }
}
