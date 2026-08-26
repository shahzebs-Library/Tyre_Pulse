/// Riverpod wiring for secure storage.
///
/// This is the only file in `core/storage` that imports Flutter or Riverpod.
/// Everything that decides HOW storage behaves - chunking, commit points,
/// retry, the meaning of an empty read - lives in `staged_secure_store.dart`
/// and `secure_slot_store_impl.dart`, both pure enough (or narrow enough) to
/// be reasoned about on their own. This file only assembles them.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_slot_store_impl.dart';
import 'package:tyre_pulse/core/storage/staged_secure_store.dart';

/// The application's encrypted key-value store: the session, the offline
/// queues, and captured work not yet reached the server.
///
/// Every consumer should depend on [SecureKeyValueStore], never on
/// [StagedSecureStore] or [FlutterSecureSlotStore] directly - that is what
/// keeps a test able to substitute a fake without touching this provider.
///
/// No override is required to use the app for real: this already builds the
/// genuine, durable implementation. A test that wants a fake overrides this
/// provider with one built over a controllable `SecureSlotStore` instead of
/// [FlutterSecureSlotStore].
final Provider<SecureKeyValueStore> secureStoreProvider =
    Provider<SecureKeyValueStore>(
  (ref) => StagedSecureStore(slots: FlutterSecureSlotStore()),
);
