/// Why a read of secure storage came back empty.
///
/// A key-value store that can only answer `String?` conflates two opposite
/// facts. `mobile/lib/secureStorage.ts` records what that cost in production:
/// the Supabase client reads a null session as "there is no session on this
/// device" and signs the user out, which is the right reading for a phone that
/// has genuinely never been signed in and the WRONG one for a phone whose
/// Keystore just refused a call. The session bytes were still on the device
/// while a tyre man - whose account was created for him by an admin, who does
/// not know his own username and has never seen his password - was dropped onto
/// a login screen he could not pass, with his unsynced inspections stranded
/// behind it.
///
/// The same conflation destroyed data on the write side. Both offline queue
/// readers turned a null read into an empty list, and the next save wrote that
/// empty list back over work that was still there.
///
/// So a read reports WHY it was empty, and an empty read may be believed only
/// when nothing failed. This file is pure: no Flutter, no plugin, no platform.
library;

/// The four answers a read can give.
enum SecureReadStatus {
  /// The value was read in full.
  ok,

  /// Every read succeeded and there is genuinely nothing stored.
  ///
  /// This is the ONLY empty result a caller may act on. A first launch must
  /// still reach the login screen.
  absent,

  /// A read call failed after every retry.
  ///
  /// Usually transient - Android Keystore access is a binder IPC and this fleet
  /// has already been ANR-reported for slow ones. It says NOTHING about whether
  /// a value exists. Never treat it as absent.
  unreadable,

  /// Reads succeeded but a committed value is incomplete.
  ///
  /// Metadata was committed, so something WAS written here. Not recoverable,
  /// but still not evidence that this device was never signed in.
  torn,
}

/// The value, and the reason it is what it is.
class SecureRead {
  const SecureRead._(this.value, this.status);

  /// A complete read.
  const SecureRead.ok(String value) : this._(value, SecureReadStatus.ok);

  /// Nothing is stored, and we know that for certain.
  const SecureRead.absent() : this._(null, SecureReadStatus.absent);

  /// The store refused. We learned nothing.
  const SecureRead.unreadable() : this._(null, SecureReadStatus.unreadable);

  /// A committed value is incomplete.
  const SecureRead.torn() : this._(null, SecureReadStatus.torn);

  /// The stored text, or null for anything that is not a complete read.
  final String? value;

  /// Why [value] is what it is.
  final SecureReadStatus status;

  /// The read completed and returned a value.
  bool get isOk => status == SecureReadStatus.ok;

  /// The store could not answer. [unreadable] and [torn] both mean the emptiness
  /// is OUR failure, not a statement about the device.
  ///
  /// This is the predicate a caller checks before concluding anything from an
  /// empty result.
  bool get failed =>
      status == SecureReadStatus.unreadable || status == SecureReadStatus.torn;

  /// Emptiness that can be acted on: everything worked and there is nothing
  /// there.
  ///
  /// Deliberately NOT `value == null`. That expression is the bug this whole
  /// type exists to make unwritable.
  bool get provesNothingIsStored => status == SecureReadStatus.absent;

  @override
  bool operator ==(Object other) =>
      other is SecureRead && other.value == value && other.status == status;

  @override
  int get hashCode => Object.hash(value, status);

  @override
  String toString() {
    // The value is never printed. It is a session token, an offline queue or a
    // part-filled inspection; none of those belong in a log line.
    final length = value?.length;
    return 'SecureRead(status: ${status.name}, '
        'length: ${length == null ? 'none' : '$length'})';
  }
}
