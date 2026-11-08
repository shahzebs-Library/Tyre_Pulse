/// Raises corrective actions from a recorded inspection - ONLINE ONLY.
///
/// Mirrors `src/lib/api/correctiveActions.js` `raiseActionsForInspection` and
/// `listAssignablePeople` on the web.
///
/// # Why this is online-only, not a queued command
///
/// 1. `corrective_actions.source_type / source_id / source_detail` (added by
///    MIGRATIONS_V496_ACTION_CHAIN.sql) are not on the `reportIssue` command's
///    field allow-list in `command_registry.dart` (a file no agent may edit),
///    so a queued raise would silently lose the link back to the inspection.
/// 2. Deduplication is a SERVER decision: V496's partial unique index
///    `ux_corrective_actions_open_source_defect` is the real guarantee, and a
///    `23505` from it means "already raised" - reported as skipped, never as a
///    failure. A blind offline queue could not tell the user that.
/// 3. `inspections.linked_action_id` (MIGRATIONS_V8.sql) is set to the first
///    created action when it is still null - best effort, never blocks.
///
/// Every call here throws a [SupabaseFailure] on a transport/RLS failure; RLS
/// on `corrective_actions` and `profiles` is the permission boundary.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';

/// Someone an action can be handed to.
final class AssignablePerson {
  const AssignablePerson({
    required this.id,
    required this.name,
    required this.role,
    required this.site,
  });

  factory AssignablePerson.fromRow(Map<String, dynamic> row) {
    String s(Object? v) => v?.toString().trim() ?? '';
    final String full = s(row['full_name']);
    final String user = s(row['username']);
    return AssignablePerson(
      id: s(row['id']),
      name: full.isNotEmpty ? full : (user.isNotEmpty ? user : 'Unnamed'),
      role: s(row['role']),
      site: s(row['site']),
    );
  }

  final String id;
  final String name;
  final String role;
  final String site;
}

/// The role filter chips, same groups as the web dialog. An empty list means
/// everyone.
abstract final class AssigneeRoleGroups {
  static const List<String> tyreMen = <String>[
    'Tyre Man',
    'Tyre Data Collector',
  ];
  static const List<String> drivers = <String>['Driver'];
  static const List<String> supervisors = <String>[
    'Workshop Supervisor',
    'Maintenance Supervisor',
    'Fleet Supervisor',
  ];
  static const List<String> everyone = <String>[];
}

/// Outcome of one raise. [failedKeys] carry only safe, already-classified
/// messages - never a raw driver message.
final class RaiseActionsResult {
  const RaiseActionsResult({
    required this.createdIds,
    required this.skipped,
    required this.failedMessages,
  });

  final List<String> createdIds;
  final int skipped;
  final List<String> failedMessages;

  int get created => createdIds.length;
}

abstract interface class InspectionActionRepository {
  /// `source_detail` keys already raised from this inspection, open or closed.
  Future<Set<String>> existingKeys(String inspectionId);

  Future<List<AssignablePerson>> listAssignablePeople({
    String search = '',
    List<String> roles = const <String>[],
    int limit = 40,
  });

  /// Inserts [rows] one at a time so a single duplicate cannot roll back the
  /// rest, then links the inspection to the first created action.
  Future<RaiseActionsResult> raise({
    required String inspectionId,
    required List<Map<String, Object?>> rows,
    required int skippedUpFront,
  });
}

/// Strips the PostgREST filter grammar characters so a typed name cannot
/// change the `or(...)` filter it is spliced into.
String sanitizePersonSearch(String raw) =>
    raw.replaceAll(RegExp(r'[%,()*\\.:"]'), ' ').trim();

final class SupabaseInspectionActionRepository
    with SupabaseGateway
    implements InspectionActionRepository {
  SupabaseInspectionActionRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<Set<String>> existingKeys(String inspectionId) async {
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () async => await _client
          .from(SupabaseTables.correctiveActions)
          .select('source_detail')
          .eq('source_type', 'inspection')
          .eq('source_id', inspectionId),
    );
    return <String>{
      for (final Map<String, dynamic> r in rows)
        if ((r['source_detail'] as Object?)?.toString().isNotEmpty ?? false)
          r['source_detail'].toString(),
    };
  }

  @override
  Future<List<AssignablePerson>> listAssignablePeople({
    String search = '',
    List<String> roles = const <String>[],
    int limit = 40,
  }) async {
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(() async {
      var q = _client
          .from(SupabaseTables.profiles)
          .select('id,full_name,username,role,site')
          .eq('approved', true)
          .eq('locked', false);
      if (roles.isNotEmpty) q = q.inFilter('role', roles);
      final String term = sanitizePersonSearch(search);
      if (term.isNotEmpty) {
        q = q.or('full_name.ilike.%$term%,username.ilike.%$term%');
      }
      return await q.order('full_name').order('id').limit(limit);
    });
    return <AssignablePerson>[
      for (final Map<String, dynamic> r in rows) AssignablePerson.fromRow(r),
    ];
  }

  @override
  Future<RaiseActionsResult> raise({
    required String inspectionId,
    required List<Map<String, Object?>> rows,
    required int skippedUpFront,
  }) async {
    final List<String> created = <String>[];
    final List<String> failed = <String>[];
    int skipped = skippedUpFront;
    for (final Map<String, Object?> row in rows) {
      try {
        final Map<String, dynamic> inserted = await guard<Map<String, dynamic>>(
          () async => await _client
              .from(SupabaseTables.correctiveActions)
              .insert(row)
              .select('id')
              .single(),
        );
        final String id = inserted['id']?.toString() ?? '';
        if (id.isNotEmpty) created.add(id);
      } on SupabaseFailure catch (f) {
        // 23505 = V496's uniqueness guard: already raised. A skip.
        if (f.isIdempotentReplay) {
          skipped += 1;
        } else {
          failed.add(f.error.message);
        }
      }
    }
    if (created.isNotEmpty) {
      try {
        await guard<void>(
          () async => await _client
              .from(SupabaseTables.inspections)
              .update(<String, Object?>{'linked_action_id': created.first})
              .eq('id', inspectionId)
              .isFilter('linked_action_id', null),
        );
      } on Object {
        // Best effort: a locked inspection (trg_lock_inspection_content) or
        // RLS may refuse; the actions themselves already exist.
      }
    }
    return RaiseActionsResult(
      createdIds: created,
      skipped: skipped,
      failedMessages: failed,
    );
  }
}
