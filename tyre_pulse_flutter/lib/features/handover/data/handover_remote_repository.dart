/// Everything this feature reads from or writes to Supabase directly: the site
/// list, pushing a completed handover, reading them back for the history and
/// detail screens, and the two-stage sign-off through
/// `decide_handover_approval`.
///
/// Modelled on `inspection_remote_repository.dart` and
/// `inspection_approval_repository.dart`. Vehicle picking is NOT duplicated
/// here - the wizard consumes `features/assets`' own fleet list, the same way
/// the inspection port does, rather than re-querying `vehicle_fleet` a second,
/// possibly-drifting way.
///
/// # Why the sign-off goes through an RPC, never a direct table update
///
/// `decide_handover_approval` (SECURITY DEFINER) derives the signer identity
/// from `auth.uid()`, enforces the rung order, refuses an unsigned or out-of-
/// order sign-off, and raises an "already decided" conflict when two signers
/// race the same row. A direct `.update()` would trust the client for who
/// signed and could skip a rung - the same reasoning the inspection and
/// checklist decisions use. The `guard_handover_approval_stages` BEFORE UPDATE
/// trigger additionally refuses a forged `approval_status` change made through
/// a plain PostgREST update, so the RPC is the only sign-off path.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/handover/domain/handover_payload.dart';
import 'package:tyre_pulse/features/handover/domain/handover_record.dart';

/// The `.or(...)` filter that scopes a queue to [country], or null for the
/// whole (RLS-bounded) queue. Mirrors `inspectionApprovalCountryFilter`: a null
/// row `country` is visible to everyone under the RESTRICTIVE country RLS, so a
/// signer with no country (or several) must see the whole queue rather than an
/// empty one. `'All'` is also treated as "no filter".
String? handoverCountryFilter(String? country) {
  final String trimmed = country?.trim() ?? '';
  if (trimmed.isEmpty || trimmed == 'All') return null;
  return 'country.eq.$trimmed,country.is.null';
}

/// What a supervisor or incharge decided, and what they typed while deciding.
final class HandoverDecision {
  const HandoverDecision({
    required this.handoverId,
    required this.approved,
    this.signatureDataUrl,
    this.note,
  });

  final String handoverId;
  final bool approved;

  /// A drawn signature `data:` URL. `decide_handover_approval` refuses an
  /// APPROVAL without one; a rejection needs none but DOES need a [note].
  final String? signatureDataUrl;

  /// The reason for a rejection (required by the RPC), optional on approval.
  final String? note;
}

/// The narrow surface this feature needs from Supabase. Abstract so the wizard,
/// the sync engine and the detail screen can be tested against a fake.
abstract interface class HandoverRemoteRepository {
  /// Distinct, active site names, optionally scoped to [country]. Best-effort:
  /// returns `[]` rather than throwing, so a field user is never blocked from
  /// starting because the site picker failed to populate.
  Future<List<String>> listSites({String? country});

  /// Pushes [payload] as a real `handover_reports` row, upserting on
  /// `client_uuid` so a retried write can never create a duplicate. Throws
  /// [SupabaseFailure] on any failure - the sync engine decides from there
  /// whether that means "queue it" or "genuinely rejected".
  Future<void> upsertHandover({
    required HandoverPayload payload,
    required String clientUuid,
  });

  /// One handover by its server row id. Null when it does not exist or is not
  /// readable under RLS.
  Future<HandoverRecord?> byId(String id);

  /// This user's own submitted handovers, newest first, bounded to [limit].
  Future<List<HandoverRecord>> myHandovers({
    required String createdBy,
    int limit = 100,
  });

  /// Handovers awaiting a sign-off (supervisor or incharge rung), newest first,
  /// bounded to [limit]. For a signer's queue. Country is a convenience scope,
  /// not a security boundary - RLS is.
  Future<List<HandoverRecord>> pendingHandovers({
    String? country,
    int limit = 100,
  });

  /// Approves, moves on, or returns the handover named by [input.handoverId]
  /// via `decide_handover_approval`. Throws on any failure - including a server
  /// refusal such as "already decided" - so the caller surfaces it as a
  /// decision that did NOT happen, never a silent success.
  Future<void> decide(HandoverDecision input);

  /// The signed-in user's display name (`full_name` else `username`), for the
  /// "signing as" line. Best-effort: null on any failure or nothing found.
  Future<String?> currentUserDisplayName(String userId);

  /// Active drivers in the register (RLS scoped), for the party pickers.
  /// Best-effort: `[]` on failure so the typed-name path still works.
  Future<List<HandoverDriverOption>> listDrivers({String? country});

  /// The row a queued submission created, found by its idempotency key.
  Future<HandoverRecord?> byClientUuid(String clientUuid);

  /// Records one party's signature through `sign_handover`. Online only:
  /// throws [SupabaseFailure] (cause `offline` when there is no connection).
  Future<HandoverSignResult> sign(HandoverSignInput input);
}

/// A driver from the register.
final class HandoverDriverOption {
  const HandoverDriverOption({
    required this.id,
    required this.name,
    this.employeeId,
    this.site,
  });
  final String id;
  final String name;
  final String? employeeId;
  final String? site;

  String get label =>
      employeeId == null || employeeId!.isEmpty ? name : '$name · $employeeId';
}

/// What the device collected for one signature.
final class HandoverSignInput {
  const HandoverSignInput({
    required this.handoverId,
    required this.party,
    required this.signature,
    this.signerName,
    this.latitude,
    this.longitude,
    this.accuracyMeters,
    this.locationStatus,
  });
  final String handoverId;
  final HandoverParty party;

  /// A `data:image/png;base64,...` URL from the signature pad.
  final String signature;
  final String? signerName;
  final double? latitude;
  final double? longitude;
  final double? accuracyMeters;

  /// `denied` or `unavailable` when there is no fix.
  final String? locationStatus;

  Map<String, Object?> toParams() => <String, Object?>{
        'p_id': handoverId,
        'p_party': party.key,
        'p_signature': signature,
        'p_signer_name': signerName,
        'p_latitude': latitude,
        'p_longitude': longitude,
        'p_accuracy_m': accuracyMeters,
        'p_location_status':
            latitude == null || longitude == null ? locationStatus : null,
      };
}

/// The server's answer: who it recorded and when (server time).
final class HandoverSignResult {
  const HandoverSignResult({this.signedName, this.signedAt, this.status});
  final String? signedName;
  final String? signedAt;
  final String? status;
}

final class SupabaseHandoverRemoteRepository
    with SupabaseGateway
    implements HandoverRemoteRepository {
  SupabaseHandoverRemoteRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<String>> listSites({String? country}) async {
    try {
      return await guard<List<String>>(() async {
        var query = _client
            .from(SupabaseTables.sites)
            .select('name')
            .eq('active', true);
        if (country != null && country.isNotEmpty) {
          query = query.eq('country', country);
        }
        final List<Map<String, dynamic>> rows = await query.order('name');
        final List<String> names = <String>[];
        final Set<String> seen = <String>{};
        for (final row in rows) {
          final Object? name = row['name'];
          if (name is String && name.trim().isNotEmpty && seen.add(name)) {
            names.add(name);
          }
        }
        return names;
      });
    } on Object {
      return const <String>[];
    }
  }

  @override
  Future<void> upsertHandover({
    required HandoverPayload payload,
    required String clientUuid,
  }) async {
    final Map<String, Object?> row = <String, Object?>{
      ...payload.toRow(),
      'client_uuid': clientUuid,
    };
    Future<void> write(Map<String, Object?> values) => guard<void>(() async {
          await _client.from(SupabaseTables.handoverReports).upsert(
            values,
            onConflict: 'client_uuid',
            ignoreDuplicates: true,
          );
        });
    try {
      await write(row);
    } on SupabaseFailure catch (failure) {
      // A server without the authorization-paper migration does not know the
      // driver id / hour meter / site columns and fails the WHOLE insert.
      // Retry once without them rather than leaving the handover stuck.
      final bool hasAuthKeys =
          HandoverPayload.authorizationKeys.any(row.containsKey);
      if (failure.cause != SupabaseFailureCause.schemaMismatch ||
          !hasAuthKeys) {
        rethrow;
      }
      await write(<String, Object?>{
        for (final MapEntry<String, Object?> e in row.entries)
          if (!HandoverPayload.authorizationKeys.contains(e.key)) e.key: e.value,
      });
    }
  }

  /// Runs [read] with the authorization columns, and once more with the
  /// legacy list when the server has not had that migration applied.
  Future<T> _withColumns<T>(Future<T> Function(String columns) read) async {
    try {
      return await guard<T>(
        () => read('$handoverRecordColumns,$handoverAuthorizationColumns'),
      );
    } on SupabaseFailure catch (failure) {
      if (failure.cause != SupabaseFailureCause.schemaMismatch) rethrow;
      return guard<T>(() => read(handoverRecordColumns));
    }
  }

  @override
  Future<HandoverRecord?> byId(String id) async {
    final Map<String, dynamic>? row = await _withColumns(
      (String columns) => _client
          .from(SupabaseTables.handoverReports)
          .select(columns)
          .eq('id', id)
          .maybeSingle(),
    );
    if (row == null) return null;
    return HandoverRecord.fromRow(row);
  }

  @override
  Future<HandoverRecord?> byClientUuid(String clientUuid) async {
    final Map<String, dynamic>? row = await _withColumns(
      (String columns) => _client
          .from(SupabaseTables.handoverReports)
          .select(columns)
          .eq('client_uuid', clientUuid)
          .maybeSingle(),
    );
    if (row == null) return null;
    return HandoverRecord.fromRow(row);
  }

  @override
  Future<List<HandoverDriverOption>> listDrivers({String? country}) async {
    try {
      return await guard<List<HandoverDriverOption>>(() async {
        var query = _client
            .from('drivers')
            .select('id,driver_id,driver_name,site,country,status');
        if (country != null && country.isNotEmpty && country != 'All') {
          query = query.eq('country', country);
        }
        final List<Map<String, dynamic>> rows = await query
            .order('driver_name', ascending: true)
            .order('id', ascending: true)
            .limit(500);
        return <HandoverDriverOption>[
          for (final Map<String, dynamic> r in rows)
            if ((r['driver_name'] as Object?)?.toString().trim().isNotEmpty ??
                false)
              if ('${r['status'] ?? 'active'}'.toLowerCase() != 'inactive')
                HandoverDriverOption(
                  id: '${r['id']}',
                  name: '${r['driver_name']}'.trim(),
                  employeeId: (r['driver_id'] as Object?)?.toString(),
                  site: (r['site'] as Object?)?.toString(),
                ),
        ];
      });
    } on Object {
      return const <HandoverDriverOption>[];
    }
  }

  @override
  Future<HandoverSignResult> sign(HandoverSignInput input) async {
    final Object? result = await guard<Object?>(
      () => _client.rpc<Object?>(
        SupabaseRpcs.signHandover,
        params: input.toParams(),
      ),
    );
    if (result is Map) {
      return HandoverSignResult(
        signedName: (result['signed_name'] as Object?)?.toString(),
        signedAt: (result['signed_at'] as Object?)?.toString(),
        status: (result['status'] as Object?)?.toString(),
      );
    }
    return const HandoverSignResult();
  }

  @override
  Future<List<HandoverRecord>> myHandovers({
    required String createdBy,
    int limit = 100,
  }) async {
    final List<Map<String, dynamic>> rows =
        await _withColumns<List<Map<String, dynamic>>>(
      (String columns) async => await _client
          .from(SupabaseTables.handoverReports)
          .select(columns)
          .eq('created_by', createdBy)
          .order('created_at', ascending: false)
          .limit(limit),
    );
    return <HandoverRecord>[
      for (final row in rows) HandoverRecord.fromRow(row),
    ];
  }

  @override
  Future<List<HandoverRecord>> pendingHandovers({
    String? country,
    int limit = 100,
  }) async {
    final List<Map<String, dynamic>> rows =
        await _withColumns<List<Map<String, dynamic>>>((String columns) async {
      var query = _client
          .from(SupabaseTables.handoverReports)
          .select(columns)
          .inFilter(
        'approval_status',
        <String>['pending_supervisor', 'pending_incharge'],
      );
      final String? filter = handoverCountryFilter(country);
      if (filter != null) {
        query = query.or(filter);
      }
      return await query.order('created_at', ascending: false).limit(limit);
    });
    return <HandoverRecord>[
      for (final row in rows) HandoverRecord.fromRow(row),
    ];
  }

  @override
  Future<void> decide(HandoverDecision input) async {
    final String? note = _trimmedOrNull(input.note);
    await guard<void>(() async {
      await _client.rpc<Object?>(
        SupabaseRpcs.decideHandoverApproval,
        params: <String, Object?>{
          'p_id': input.handoverId,
          'p_approved': input.approved,
          'p_signature': input.signatureDataUrl,
          'p_note': note,
        },
      );
    });
  }

  @override
  Future<String?> currentUserDisplayName(String userId) async {
    if (userId.isEmpty) return null;
    try {
      final Map<String, dynamic>? row = await guard<Map<String, dynamic>?>(
        () => _client
            .from(SupabaseTables.profiles)
            .select('full_name,username')
            .eq('id', userId)
            .maybeSingle(),
      );
      if (row == null) return null;
      final String full =
          (row['full_name'] as Object?)?.toString().trim() ?? '';
      if (full.isNotEmpty) return full;
      final String username =
          (row['username'] as Object?)?.toString().trim() ?? '';
      return username.isEmpty ? null : username;
    } on Object {
      return null;
    }
  }

  static String? _trimmedOrNull(String? raw) {
    final String trimmed = raw?.trim() ?? '';
    return trimmed.isEmpty ? null : trimmed;
  }
}
