/// Reading the minimum-supported-version configuration and resolving the
/// gate.
///
/// The decision rule itself - what counts as "too old", and the FAIL-OPEN
/// guarantee on every unreadable or unparseable case - is entirely in
/// `app_version.dart`, already complete and NOT modified here. This file is
/// purely the I/O half: read `system_config`, hand the raw value to
/// [normaliseMinimumVersion] and [resolveVersionGate], and turn any failure to
/// reach the server into [VersionGateReason.minimumUnreadable] rather than a
/// thrown exception - a version check must never be the reason a sign-in
/// throws.
///
/// # Verification, per AGENTS.md rule 3 and spec section 62
///
/// `system_config` is `SupabaseTables.systemConfig`. Its `key`/`value` shape
/// and the exact query - `.select('value').eq('key',
/// minVersionConfigKey).maybeSingle()` - are transcribed from the verified,
/// shipped `fetchMinVersion` in `mobile/lib/appVersionGate.ts`, cross-checked
/// against `docs/flutter-migration/02-backend-table-rpc-map.md` section 2
/// ("`system_config` | 1 | Minimum-version gate, public config") and against
/// the index `idx_system_config_updated_by` created on that table in
/// `MIGRATIONS_V74_FK_INDEXES.sql`. No `CREATE TABLE system_config` migration
/// exists in this repository - the table predates the migration-file
/// convention - so this is the strongest verification available without a live
/// database connection; there is no reasonable alternative reading of a table
/// three independent, already-shipped call sites agree on.
///
/// # Why this is checked AFTER sign-in
///
/// `app_version.dart`'s own library comment records it: `mobile_min_version`
/// lives in `system_config`, and V281 revoked every anon table grant, so an
/// unauthenticated device cannot read it at all. [AuthController] only calls
/// this once a session exists, matching the production app.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/auth/app_version.dart';
import 'package:tyre_pulse/core/auth/auth_lifecycle.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';

/// The narrow surface [AuthController] needs to check the version gate.
abstract interface class VersionGateRepository {
  /// Reads the configured minimum and resolves the gate for this build. Never
  /// throws.
  Future<VersionGateResult> check();
}

/// The real implementation, over a live [SupabaseClient].
final class SupabaseVersionGateRepository implements VersionGateRepository {
  SupabaseVersionGateRepository(this._client, {required this.currentVersion});

  final SupabaseClient _client;

  /// This build's own version string, e.g. `1.4.0`.
  ///
  /// Deliberately supplied by the caller rather than read from a package here:
  /// `package_info_plus` is not a declared dependency, and spec section 64
  /// forbids adding one "to shorten five lines". The composition root is
  /// expected to supply this - see the accompanying report for exactly what it
  /// needs to wire.
  final String currentVersion;

  @override
  Future<VersionGateResult> check() async {
    try {
      final Map<String, dynamic>? row = await _client
          .from(SupabaseTables.systemConfig)
          .select('value')
          .eq('key', minVersionConfigKey)
          .maybeSingle()
          .timeout(versionGateReadTimeout);
      final String? minimum =
          row == null ? null : normaliseMinimumVersion(row['value']);
      return resolveVersionGate(
        currentVersion: currentVersion,
        minimumVersion: minimum,
      );
    } on Object {
      // Offline, RLS, a server error, or a timeout - all fold to "could not
      // check". `resolveVersionGate` FAILS OPEN on this by construction; see
      // `app_version.dart`. A version check must never be why a sign-in fails.
      return resolveVersionGate(
        currentVersion: currentVersion,
        configurationReadFailed: true,
      );
    }
  }
}
