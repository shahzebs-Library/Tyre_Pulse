/// One encrypted slot on the device, and nothing else.
///
/// This is the narrowest possible surface over the platform keystore: read one
/// slot, write one slot, delete one slot. Everything that makes secure storage
/// SAFE - staging a write so a crash cannot destroy the previous value,
/// retrying a refused read, reporting why a read was empty - is built on top of
/// this in `staged_secure_store.dart`, which is pure Dart and therefore fully
/// testable against a fake.
///
/// Splitting it this way is the point. If the durability logic lived inside the
/// plugin adapter it could only be verified on a device, which is where it was
/// last got wrong.
library;

/// A single encrypted key-value slot.
///
/// Every method may throw. The layer above turns a thrown read into
/// [SecureReadStatus.unreadable] rather than letting it escape into a session
/// bootstrap, and turns a thrown write into a typed storage error so the caller
/// knows the write did not take effect.
abstract interface class SecureSlotStore {
  /// The stored text, or null when the slot is genuinely empty.
  ///
  /// A resolved null is authoritative. A throw is not: it means the platform
  /// refused, which says nothing about whether the slot holds anything.
  Future<String?> readSlot(String key);

  /// Replaces the contents of one slot.
  Future<void> writeSlot(String key, String value);

  /// Removes one slot. Deleting a slot that does not exist is not an error.
  Future<void> deleteSlot(String key);
}
