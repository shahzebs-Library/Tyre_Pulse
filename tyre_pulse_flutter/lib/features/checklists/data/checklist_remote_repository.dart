/// Everything this feature reads directly from Supabase: published
/// role-targeted templates, the operator's own assignments, site options for
/// a `site`-type reference field, a best-effort display name for
/// `autoValue: 'current_user'`, the best-effort "not due yet" check, and the
/// operator's own already-synced submission history.
///
/// The only WRITE this feature performs goes through the generic offline
/// command queue (`checklist_submission_repository.dart`), never through this
/// file - matching artifact 06's rule that `QueuedCommandRepository` is the
/// one place a queued write is constructed.
///
/// Query construction deliberately never names `PostgrestFilterBuilder` (or
/// any other postgrest builder type) explicitly - it mirrors
/// `inspection_remote_repository.dart`'s own proven `var query = ...` idiom
/// (build with `.from().select()`, conditionally reassign with `.eq()`/
/// `.or()`, cast the awaited result), the same caution that file's own doc
/// comment on `image_picker` names: this project has no resolvable pub cache
/// to check an exact generic builder signature against, so the safest choice
/// is the pattern already proven to compile elsewhere in this codebase.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_history_row.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_targeting.dart';

/// The last-submission advisory result for the "not due yet" warning.
final class ChecklistLastSubmissionInfo {
  const ChecklistLastSubmissionInfo({
    this.found = false,
    this.daysAgo,
    this.documentNo,
    this.submittedAt,
  });

  final bool found;
  final int? daysAgo;
  final String? documentNo;
  final String? submittedAt;
}

/// The narrow surface this feature needs from Supabase. Abstract so the fill
/// controller and history repository can both be tested against a fake.
abstract interface class ChecklistRemoteRepository {
  /// Published templates this operator should be OFFERED, narrowed to
  /// [role] via [templateAllowsRole] - see that function's own doc comment:
  /// this is TARGETING, not a security boundary, and runs client-side by
  /// design. `role == null` skips the role filter entirely (every published
  /// template for the country is returned).
  Future<List<ChecklistTemplateRecord>> listTemplates({
    String? country,
    String? role,
    bool isSuperAdmin = false,
  });

  /// One template by id, or `null` when it does not exist / is not
  /// readable under RLS.
  Future<ChecklistTemplateRecord?> getTemplate(String id);

  /// The operator's due assignments, narrowed to [role] via
  /// [assignmentAllowsRole].
  Future<List<ChecklistAssignmentRecord>> listAssignments({
    String? country,
    String? role,
    bool isSuperAdmin = false,
  });

  /// Distinct active site names, optionally scoped to [country]. Best-effort:
  /// an operator must never be blocked from filling a sheet because the site
  /// picker failed to populate - returns `[]` on any failure.
  Future<List<String>> listSiteOptions({String? country});

  /// The signed-in user's display name (`full_name` else `username`), for
  /// `autoValue: 'current_user'` and as the default `printed_name`.
  /// Best-effort: returns `null` on any failure or when nothing is found.
  Future<String?> currentUserDisplayName(String userId);

  /// The previous visit for this machine on this sheet, for the "it is not
  /// due yet" warning. Deliberately best-effort in every sense: the RPC's
  /// exact argument signature is UNVERIFIED
  /// ([SupabaseRpcs.checklistLastSubmission]'s own doc comment), so ANY
  /// failure here - including a wrong argument name - degrades to "no
  /// warning shown" rather than surfacing an error or blocking the fill
  /// screen.
  Future<ChecklistLastSubmissionInfo?> lastSubmission({
    required String templateId,
    required String assetNo,
  });

  /// This user's own already-synced submissions, newest first, with an `id`
  /// tiebreak (a batch of offline sheets synced together can share a
  /// `submitted_at` timestamp - an order that is not total drops or repeats
  /// a row at a page boundary).
  Future<List<ChecklistHistoryRow>> myHistory({
    required String submittedBy,
    int limit = 200,
  });
}

final class SupabaseChecklistRemoteRepository
    with SupabaseGateway
    implements ChecklistRemoteRepository {
  SupabaseChecklistRemoteRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<ChecklistTemplateRecord>> listTemplates({
    String? country,
    String? role,
    bool isSuperAdmin = false,
  }) async {
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(() async {
          var query = _client
              .from(SupabaseTables.checklistTemplates)
              .select(checklistTemplateColumns)
              .eq('status', 'published');
          if (country != null && country.isNotEmpty && country != 'All') {
            query = query.or('country.eq.$country,country.is.null');
          }
          return await query.order('name') as List<Map<String, dynamic>>;
        });

    final List<ChecklistTemplateRecord> all = <ChecklistTemplateRecord>[
      for (final Map<String, dynamic> row in rows)
        ChecklistTemplateRecord.fromRow(row),
    ];
    if (role == null) return all;
    return <ChecklistTemplateRecord>[
      for (final ChecklistTemplateRecord r in all)
        if (templateAllowsRole(r.template, role, isSuperAdmin: isSuperAdmin)) r,
    ];
  }

  @override
  Future<ChecklistTemplateRecord?> getTemplate(String id) async {
    final Map<String, dynamic>? row = await guard<Map<String, dynamic>?>(
      () => _client
          .from(SupabaseTables.checklistTemplates)
          .select(checklistTemplateColumns)
          .eq('id', id)
          .maybeSingle(),
    );
    if (row == null) return null;
    return ChecklistTemplateRecord.fromRow(row);
  }

  @override
  Future<List<ChecklistAssignmentRecord>> listAssignments({
    String? country,
    String? role,
    bool isSuperAdmin = false,
  }) async {
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(() async {
          var query = _client
              .from(SupabaseTables.checklistAssignments)
              .select(checklistAssignmentColumns);
          if (country != null && country.isNotEmpty && country != 'All') {
            query = query.or('country.eq.$country,country.is.null');
          }
          return await query.order('due_date') as List<Map<String, dynamic>>;
        });

    final List<ChecklistAssignmentRecord> all = <ChecklistAssignmentRecord>[];
    for (final Map<String, dynamic> row in rows) {
      final ChecklistAssignmentRecord? decoded =
          ChecklistAssignmentRecord.fromRow(row);
      if (decoded != null) all.add(decoded);
    }
    if (role == null) return all;
    return <ChecklistAssignmentRecord>[
      for (final ChecklistAssignmentRecord a in all)
        if (assignmentAllowsRole(
          ChecklistAssignment(assigneeRole: a.assigneeRole),
          role,
          isSuperAdmin: isSuperAdmin,
        ))
          a,
    ];
  }

  @override
  Future<List<String>> listSiteOptions({String? country}) async {
    try {
      return await guard<List<String>>(() async {
        var query = _client
            .from(SupabaseTables.sites)
            .select('name')
            .eq('active', true);
        if (country != null && country.isNotEmpty && country != 'All') {
          query = query.eq('country', country);
        }
        final List<Map<String, dynamic>> rows =
            await query.order('name') as List<Map<String, dynamic>>;
        final List<String> names = <String>[];
        final Set<String> seen = <String>{};
        for (final Map<String, dynamic> row in rows) {
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

  @override
  Future<ChecklistLastSubmissionInfo?> lastSubmission({
    required String templateId,
    required String assetNo,
  }) async {
    if (templateId.isEmpty || assetNo.trim().isEmpty) return null;
    try {
      final Object? data = await guard<Object?>(
        () => _client.rpc(
          SupabaseRpcs.checklistLastSubmission,
          params: <String, Object?>{
            'p_template_id': templateId,
            'p_asset_no': assetNo,
          },
        ),
      );
      if (data is! Map) return null;
      final bool found = data['found'] == true;
      if (!found) return const ChecklistLastSubmissionInfo();
      final Object? daysAgo = data['days_ago'];
      return ChecklistLastSubmissionInfo(
        found: true,
        daysAgo: daysAgo is num ? daysAgo.toInt() : null,
        documentNo: (data['document_no'] as Object?)?.toString(),
        submittedAt: (data['submitted_at'] as Object?)?.toString(),
      );
    } on Object {
      // UNVERIFIED RPC signature - see the interface doc comment. Any
      // failure at all, including "function does not exist" /
      // "unknown argument", degrades to "no warning shown".
      return null;
    }
  }

  @override
  Future<List<ChecklistHistoryRow>> myHistory({
    required String submittedBy,
    int limit = 200,
  }) async {
    if (submittedBy.isEmpty) return const <ChecklistHistoryRow>[];
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
          () async =>
              await _client
                      .from(SupabaseTables.checklistSubmissions)
                      .select(checklistHistoryColumns)
                      .eq('submitted_by', submittedBy)
                      .order('submitted_at', ascending: false)
                      .order('id')
                      .limit(limit)
                  as List<Map<String, dynamic>>,
        );
    final List<ChecklistHistoryRow> out = <ChecklistHistoryRow>[];
    for (final Map<String, dynamic> row in rows) {
      final ChecklistHistoryRow? decoded = ChecklistHistoryRow.fromRow(row);
      if (decoded != null) out.add(decoded);
    }
    return out;
  }
}
