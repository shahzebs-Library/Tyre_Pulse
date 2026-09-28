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
/// with a blank pad they can still sign on - so [mine] returns null on any
/// failure. [save] and [clear] are explicit actions, so they throw: a silent
/// failure would leave someone believing their signature is stored when it
/// is not.
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

abstract interface class SavedSignatureRepository {
  /// The caller's saved signature, or null when none is saved OR it could
  /// not be read. Never throws.
  Future<SavedSignature?> mine();

  /// Stores [signature] as the caller's signature, replacing any earlier
  /// one. Throws on refusal, on an unusable mark, or with no session.
  Future<SavedSignature> save(String signature);

  /// Forgets the caller's saved signature. Throws on failure.
  Future<void> clear();
}

final class SupabaseSavedSignatureRepository
    with SupabaseGateway
    implements SavedSignatureRepository {
  SupabaseSavedSignatureRepository(this._client);

  final SupabaseClient _client;

  String? get _uid {
    final String? id = _client.auth.currentUser?.id;
    return (id == null || id.isEmpty) ? null : id;
  }

  @override
  Future<SavedSignature?> mine() async {
    final String? uid = _uid;
    if (uid == null) return null;
    try {
      final List<Map<String, dynamic>> rows =
          await guard<List<Map<String, dynamic>>>(
        () => _client
            .from(SupabaseTables.userSignatures)
            .select('signature,updated_at')
            .eq('user_id', uid)
            .limit(1),
      );
      if (rows.isEmpty) return null;
      return savedSignatureFromRow(rows.first);
    } on Object {
      return null;
    }
  }

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
    if (uid == null) return;
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
