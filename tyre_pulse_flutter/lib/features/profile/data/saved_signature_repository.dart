/// The signed-in person's own saved signature (V601 `user_signatures`).
///
/// Ported from `mobile/lib/userSignature.ts` + `mobile/lib/savedSignature.ts`
/// (READ-ONLY reference). The row is keyed on `auth.uid()` and the table's
/// only policies are "this row is mine" (see
/// `MIGRATIONS_V601_USER_SAVED_SIGNATURE.sql`), so the user id is never taken
/// from a caller: it is resolved from the live session every time.
///
/// # Reads degrade, writes throw
///
/// A signature that cannot be loaded on a weak signal must leave a reviewer
/// with a blank pad they can still sign on - so `mine()` returns null on any
/// failure. Profile, which SHOWS the saved state and offers Remove, reads
/// `lookup()` instead: it never throws either, but it keeps "nothing is
/// saved" and "we could not check" apart, because a failed read shown as
/// "Not saved" hides a signature that is really stored and the Remove action
/// with it. `save()` and `clear()` are explicit actions, so they throw: a
/// silent failure would leave someone believing their signature is stored
/// (or removed) when it is not.
///
/// # Online-only, on purpose
///
/// Saving a signature is not a field observation and has no command in the
/// offline registry (`command_registry.dart`, which this feature must not
/// edit). It is a deliberate profile action taken with signal; the UI says
/// so when it fails.
///
/// # Pre-filling is not signing
///
/// The approval screen loads this value into its pad as a visible preview.
/// The reviewer still presses Approve, and can draw a new mark instead.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';

/// Mirrors `user_signatures_len_chk` in V601.
const int kSavedSignatureMaxLength = 200000;

/// The one place that decides whether [value] is a signature this app can
/// store or hand to an approval. Mirrors `normaliseSignature` in
/// `mobile/lib/savedSignature.ts`: `<svg` markup (checklist path) or a
/// `data:` URL (canvas pads) - anything else is not a mark and is refused.
String? normaliseSavedSignature(Object? value) {
  if (value is! String) return null;
  final String s = value.trim();
  if (s.isEmpty || s.length > kSavedSignatureMaxLength) return null;
  final String head = s.length >= 5 ? s.substring(0, 5).toLowerCase() : s;
  if (head.startsWith('<svg')) return s;
  if (head == 'data:') return s;
  return null;
}

/// A stored signature and when it was last replaced.
final class SavedSignature {
  const SavedSignature({required this.value, this.updatedAt});

  final String value;

  /// `user_signatures.updated_at`, or null when it did not parse.
  final DateTime? updatedAt;
}

/// What a read of the caller's saved signature found.
enum SavedSignatureStatus {
  /// A usable signature is stored.
  found,

  /// The read succeeded and nothing usable is stored.
  none,

  /// The read could not be made (no session, no signal, refused). Nothing
  /// is known about what is stored.
  unavailable,
}

/// The result of [SavedSignatureRepository.lookup].
final class SavedSignatureLookup {
  const SavedSignatureLookup.found(SavedSignature this.signature)
      : status = SavedSignatureStatus.found;

  const SavedSignatureLookup.none()
      : status = SavedSignatureStatus.none,
        signature = null;

  const SavedSignatureLookup.unavailable()
      : status = SavedSignatureStatus.unavailable,
        signature = null;

  final SavedSignatureStatus status;

  /// Set only when [status] is [SavedSignatureStatus.found].
  final SavedSignature? signature;
}

abstract interface class SavedSignatureRepository {
  /// The caller's saved signature, keeping a failed read distinct from
  /// "nothing saved". Never throws.
  Future<SavedSignatureLookup> lookup();

  /// The caller's saved signature, or null when none is saved OR it could
  /// not be read. Never throws. For the approval pad pre-fill, where both
  /// cases mean the same thing: start from a blank pad.
  Future<SavedSignature?> mine();

  /// Stores [signature] as the caller's signature, replacing any earlier
  /// one. Throws on refusal, on an unusable mark, or with no session.
  Future<SavedSignature> save(String signature);

  /// Forgets the caller's saved signature. Throws on failure, and with no
  /// session (nothing was removed, so it must not look as though it was).
  Future<void> clear();
}

final class SupabaseSavedSignatureRepository
    with SupabaseGateway
    implements SavedSignatureRepository {
  SupabaseSavedSignatureRepository(
    this._client, {
    String? Function()? currentUserId,
  }) : _currentUserId = currentUserId;

  final SupabaseClient _client;

  /// Test seam: resolves the signed-in user id. Defaults to the live
  /// session, which is the only source the app ever uses.
  final String? Function()? _currentUserId;

  String? get _uid {
    final String? Function()? resolve = _currentUserId;
    final String? id =
        resolve != null ? resolve() : _client.auth.currentUser?.id;
    return (id == null || id.isEmpty) ? null : id;
  }

  @override
  Future<SavedSignatureLookup> lookup() async {
    final String? uid = _uid;
    if (uid == null) return const SavedSignatureLookup.unavailable();
    try {
      final List<Map<String, dynamic>> rows =
          await guard<List<Map<String, dynamic>>>(
        () => _client
            .from(SupabaseTables.userSignatures)
            .select('signature,updated_at')
            .eq('user_id', uid)
            .limit(1),
      );
      if (rows.isEmpty) return const SavedSignatureLookup.none();
      final SavedSignature? found = savedSignatureFromRow(rows.first);
      return found == null
          ? const SavedSignatureLookup.none()
          : SavedSignatureLookup.found(found);
    } on Object {
      return const SavedSignatureLookup.unavailable();
    }
  }

  @override
  Future<SavedSignature?> mine() async => (await lookup()).signature;

  @override
  Future<SavedSignature> save(String signature) async {
    final String? value = normaliseSavedSignature(signature);
    if (value == null) {
      throw ArgumentError.value(signature, 'signature', 'not a usable mark');
    }
    final String? uid = _uid;
    if (uid == null) {
      throw StateError('No signed-in session');
    }
    final DateTime now = DateTime.now().toUtc();
    await guard<void>(
      () => _client.from(SupabaseTables.userSignatures).upsert(
        <String, Object?>{
          'user_id': uid,
          'signature': value,
          'updated_at': now.toIso8601String(),
        },
        onConflict: 'user_id',
      ),
    );
    return SavedSignature(value: value, updatedAt: now);
  }

  @override
  Future<void> clear() async {
    final String? uid = _uid;
    if (uid == null) {
      throw StateError('No signed-in session');
    }
    await guard<void>(
      () => _client
          .from(SupabaseTables.userSignatures)
          .delete()
          .eq('user_id', uid),
    );
  }
}

/// Decodes one `user_signatures` row. Null when the stored value is not a
/// usable mark - it must never be shown as though it were a signature.
SavedSignature? savedSignatureFromRow(Map<String, dynamic> row) {
  final String? value = normaliseSavedSignature(row['signature']);
  if (value == null) return null;
  final Object? rawAt = row['updated_at'];
  return SavedSignature(
    value: value,
    updatedAt: rawAt is String ? DateTime.tryParse(rawAt) : null,
  );
}
