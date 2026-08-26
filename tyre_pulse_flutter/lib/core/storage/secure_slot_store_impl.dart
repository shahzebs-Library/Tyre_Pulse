/// The real [SecureSlotStore], backed by the platform keystore.
///
/// Everything that makes secure storage SAFE lives in `staged_secure_store.dart`,
/// which is pure Dart and tested against a fake. This file is deliberately
/// thin: it does exactly one thing, translating one slot read/write/delete
/// into a call on `flutter_secure_storage`, and adds no logic of its own that
/// could only be verified on a device.
///
/// ## UNVERIFIED - flutter_secure_storage 11.0.0 API
///
/// There is no Flutter SDK in this environment, so nothing below has been
/// compiled. The exact API was checked against the package's published
/// changelog rather than against installed source, and one finding from that
/// changelog materially changed this file - see [_androidOptions]. The
/// specific symbols this file depends on, and what would need re-checking if
/// `flutter analyze` disagrees, are listed in the class doc below.
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:tyre_pulse/core/storage/secure_slot_store.dart';

/// A [SecureSlotStore] backed by `flutter_secure_storage`: Android Keystore
/// via EncryptedSharedPreferences's successor cipher, iOS/macOS Keychain.
///
/// ## Symbols this file depends on, and their confidence
///
/// - `FlutterSecureStorage`, `.read(key:)`, `.write(key:, value:)`,
///   `.delete(key:)` - the package's central class and its three core calls.
///   Stable across every version of this package; effectively no risk.
/// - `AndroidOptions(resetOnError: false)` - confirmed against the package's
///   own published changelog for v10.0.0 and v11.0.0 (fetched during this
///   change, not recalled from training data). See [_androidOptions] for why
///   this parameter is set explicitly rather than left at its default.
/// - `IOSOptions(accessibility: KeychainAccessibility.first_unlock)` -
///   `KeychainAccessibility` and its five snake_case values (`passcode`,
///   `unlocked`, `unlocked_this_device`, `first_unlock`,
///   `first_unlock_this_device`) were confirmed against the published API
///   docs. Whether `IOSOptions` still accepts `accessibility` as a direct
///   constructor parameter in exactly 11.0.0 (as opposed to requiring
///   construction via a shared `AppleOptions` type it extends) was NOT
///   directly confirmed - the docs describe `IOSOptions` as carrying "only
///   shared options from AppleOptions", which a v10.1.0 changelog entry
///   ("Added `useSecureEnclave` option to `IOSOptions`") confirms still means
///   `IOSOptions` itself takes constructor parameters, not that
///   `accessibility` moved off it. If `flutter analyze` reports `accessibility`
///   as an unknown named parameter on `IOSOptions`, construct `AppleOptions`
///   directly (or the equivalent v11 macOS/iOS shared options type) instead
///   and pass it as `iOptions`.
/// - Whether `AndroidOptions(...)` and `IOSOptions(...)` accept `const`
///   construction in 11.0.0 was not confirmed, so this file constructs them
///   without `const` to avoid a hard compile error over a style preference;
///   `flutter analyze` may suggest adding it back.
///
/// ## Why `resetOnError: false` is not optional
///
/// The package's own v10.0.0 changelog states plainly: "ResetOnError will now
/// automatically be true, because most errors are unrecoverable due to key
/// storage problems." Read literally, that means the DEFAULT Android
/// behaviour, starting in v10, is to silently DELETE a slot it cannot decrypt
/// and hand back null - indistinguishable from a slot that was never written.
///
/// That is precisely the failure `secure_read.dart` exists to make
/// impossible. [SecureSlotStore.readSlot] promises "a resolved null is
/// authoritative... A throw is not." Left at its new default, this plugin
/// would silently violate that promise on Android: a value the app cannot
/// currently decrypt would come back as a clean, resolved `null`, and
/// `StagedSecureStore` would have no way to tell it apart from a device that
/// was genuinely never signed in - the exact conflation `SecureReadStatus`
/// was built to eliminate. `resetOnError: false` keeps the failure a THROW,
/// which `StagedSecureStore._readSlot` retries and, if it never clears,
/// reports as [SecureReadStatus.unreadable] - never `absent`.
final class FlutterSecureSlotStore implements SecureSlotStore {
  FlutterSecureSlotStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            FlutterSecureStorage(
              aOptions: _androidOptions,
              iOptions: _iosOptions,
            );

  final FlutterSecureStorage _storage;

  /// See the class doc: this is a correctness requirement, not a tuning
  /// choice. Never remove it and never flip it to `true`.
  static const AndroidOptions _androidOptions =
      AndroidOptions(resetOnError: false);

  /// Survives a device restart (the value is still readable once the device
  /// has been unlocked once since boot) but not a full device wipe or
  /// re-provisioning, which is the durability level a signed-in session
  /// belongs at - shorter than "forever" (`.unlocked`, which additionally
  /// requires the device to be unlocked on every read and is unnecessarily
  /// strict for a background sync queue), longer than "until next lock"
  /// (`.passcode`, which is wrong for a device with no passcode set at all).
  static const IOSOptions _iosOptions =
      IOSOptions(accessibility: KeychainAccessibility.first_unlock);

  @override
  Future<String?> readSlot(String key) => _storage.read(key: key);

  @override
  Future<void> writeSlot(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> deleteSlot(String key) => _storage.delete(key: key);
}
