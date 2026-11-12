/// Loads the two permission inputs the web console writes: the per-user
/// overrides (`get_my_access_grants`) and the role matrix
/// (`get_user_module_permissions`).
///
/// Until this file existed the phone never read either one, so every change an
/// administrator made in the web Access Manager - a Mobile App role toggle, a
/// per-user Allow or Deny - had no effect on the phone at all, and the three
/// sensitive modules (Approvals, Admin, Users) stayed closed for everyone but
/// administrators because the adopted [AccessState] was always flagged
/// `permissionsError`.
///
/// The two reads fail INDEPENDENTLY (artifact 04 section 8.2): a grants
/// failure must not discard a matrix that loaded, and vice versa. Each failed
/// read comes back as null so the caller can keep what it already had.
///
/// A third, OPTIONAL read carries Module Control: the web console's
/// Live / Maintenance / Off switch per module (`public.modules.status`). It
/// fails OPEN - a failed read comes back as null, is never counted as a
/// permission failure, and leaves every module available, exactly as the web
/// treats an unreadable status as `live`.
library;

import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';

/// The server already drops expired grants and collapses a revoke over a grant
/// for the same key (`get_my_access_grants`, V225), so nothing here re-applies
/// those rules - it only reads.
const Duration accessPermissionsReadTimeout = Duration(seconds: 12);

/// The two raw maps, each null when its read failed.
final class AccessPermissionsSnapshot {
  const AccessPermissionsSnapshot({
    this.grantsRaw,
    this.roleMatrixRaw,
    this.moduleStatusRaw,
  });

  /// `{module_key: 'grant' | 'revoke'}` or null when the read failed.
  final Map<String, Object?>? grantsRaw;

  /// `{module_key: bool}` or null when the read failed.
  final Map<String, Object?>? roleMatrixRaw;

  /// `{web module_id: status}` from Module Control, or null when the read
  /// failed. Null means "unknown", which is treated as every module live.
  final Map<String, Object?>? moduleStatusRaw;

  /// Deliberately ignores [moduleStatusRaw]: Module Control fails open and
  /// must never flag the session's permissions as failed.
  bool get anyFailed => grantsRaw == null || roleMatrixRaw == null;
}

/// The narrow surface the auth controller needs.
abstract interface class AccessPermissionsRepository {
  /// Never throws.
  Future<AccessPermissionsSnapshot> load();
}

/// The real implementation over a live [SupabaseClient].
final class SupabaseAccessPermissionsRepository
    implements AccessPermissionsRepository {
  SupabaseAccessPermissionsRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<AccessPermissionsSnapshot> load() async {
    final List<Map<String, Object?>?> results =
        await Future.wait(<Future<Map<String, Object?>?>>[
      _readMap(SupabaseRpcs.getMyAccessGrants),
      _readMap(SupabaseRpcs.getUserModulePermissions),
      _readModuleStatuses(),
    ]);
    return AccessPermissionsSnapshot(
      grantsRaw: results[0],
      roleMatrixRaw: results[1],
      moduleStatusRaw: results[2],
    );
  }

  /// One small page: the table holds one row per web module (about 200) and
  /// only two narrow columns are read. The explicit limit keeps the read
  /// bounded if the catalogue ever grows.
  Future<Map<String, Object?>?> _readModuleStatuses() async {
    try {
      final List<Map<String, dynamic>> rows = await _client
          .from(SupabaseTables.modules)
          .select('module_id,status')
          .order('module_id')
          .limit(1000)
          .timeout(accessPermissionsReadTimeout);
      return <String, Object?>{
        for (final Map<String, dynamic> row in rows)
          if (row['module_id'] != null)
            row['module_id'].toString(): row['status'],
      };
    } on Object {
      return null;
    }
  }

  Future<Map<String, Object?>?> _readMap(String rpc) async {
    try {
      final Object? raw =
          await _client.rpc<Object?>(rpc).timeout(accessPermissionsReadTimeout);
      if (raw == null) {
        return const <String, Object?>{};
      }
      if (raw is Map) {
        return raw.map(
          (Object? key, Object? value) =>
              MapEntry<String, Object?>(key.toString(), value),
        );
      }
      return null;
    } on Object {
      return null;
    }
  }
}
