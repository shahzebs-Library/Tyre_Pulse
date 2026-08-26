import 'package:tyre_pulse/core/storage/secure_slot_store.dart';

/// A controllable in-memory [SecureSlotStore].
///
/// A hand-written fake rather than a mock, matching the convention already
/// used for `FakeDependencies` in `workspace_switch_test.dart`: the durability
/// rules `StagedSecureStore` exists to enforce only matter in the moment
/// something fails, so every method here can be told to fail ON DEMAND, and
/// the recorded [calls] list lets a test assert not just what the result was
/// but what was and was not attempted.
///
/// `readSlot` THROWS to signal failure, never resolves an error value -
/// matching the real platform contract documented on [SecureSlotStore]: "A
/// resolved null is authoritative. A throw is not."
final class FakeSecureSlotStore implements SecureSlotStore {
  final Map<String, String> _slots = <String, String>{};

  /// Every call this fake received, in order, as `read:key`, `write:key` or
  /// `delete:key`. Lets a test assert an ORDER, not just an end state - which
  /// is the only way to test the write's commit-point and the delete's
  /// meta-then-plain-then-chunks ordering.
  final List<String> calls = <String>[];

  final Map<String, int> _failReadTimes = <String, int>{};
  final Set<String> _failWriteOnce = <String>{};
  final Set<String> _failDeleteOnce = <String>{};
  final Set<String> _writtenKeys = <String>{};

  /// Makes the next [times] reads of [key] throw, then lets reads through.
  /// `times` large enough to exceed any retry budget under test is how a
  /// test expresses "this slot never becomes readable".
  void failReadFor(String key, int times) => _failReadTimes[key] = times;

  /// Makes the NEXT write to [key] throw. Writes are not retried by
  /// [StagedSecureStore], so there is no counted form of this.
  void failNextWrite(String key) => _failWriteOnce.add(key);

  /// Makes the NEXT delete of [key] throw.
  void failNextDelete(String key) => _failDeleteOnce.add(key);

  /// True once [key] has ever been written, even if it was since deleted.
  /// Lets a test assert a slot was genuinely touched, not merely absent now.
  bool wasEverWritten(String key) => _writtenKeys.contains(key);

  /// The raw stored slots, for assertions only - production code never reads
  /// a `SecureSlotStore`'s contents this way.
  Map<String, String> get raw => Map<String, String>.unmodifiable(_slots);

  /// Removes [key] WITHOUT recording a call and without going through
  /// [deleteSlot], as if the platform lost it independently of anything the
  /// store did on purpose - a lost chunk, an OS-level eviction. This is how a
  /// test constructs a TORN value: commit the metadata for real via a normal
  /// [writeSlot], then take one chunk away from underneath it.
  void corrupt(String key) => _slots.remove(key);

  @override
  Future<String?> readSlot(String key) async {
    calls.add('read:$key');
    final int remaining = _failReadTimes[key] ?? 0;
    if (remaining > 0) {
      _failReadTimes[key] = remaining - 1;
      throw StateError('fake: forced read failure for "$key"');
    }
    return _slots[key];
  }

  @override
  Future<void> writeSlot(String key, String value) async {
    calls.add('write:$key');
    if (_failWriteOnce.remove(key)) {
      throw StateError('fake: forced write failure for "$key"');
    }
    _slots[key] = value;
    _writtenKeys.add(key);
  }

  @override
  Future<void> deleteSlot(String key) async {
    calls.add('delete:$key');
    if (_failDeleteOnce.remove(key)) {
      throw StateError('fake: forced delete failure for "$key"');
    }
    _slots.remove(key);
  }
}
