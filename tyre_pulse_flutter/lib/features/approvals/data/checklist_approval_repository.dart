/// Reads + the raw write primitive for checklist approval decisions.
///
/// Ported field-for-field from `mobile/lib/checklists.ts`'s
/// `listPendingApprovals`/`getSubmission`/`decideApproval` (`mobile/` is
/// READ-ONLY reference material - see `AGENTS.md`).
///
/// # This is a THIN Supabase-talking layer, not the offline orchestration
///
/// [applyDecision] is a single, ONLINE-ONLY write attempt - it never queues
/// anything and never retries. Whether to attempt it at all right now, what
/// to do when it cannot be attempted, and how a not-yet-delivered decision
/// is kept durable on this device belongs entirely to
/// `checklist_approval_sync_engine.dart`'s [ChecklistApprovalSyncEngine],
/// which is the ONLY caller of [applyDecision] in this feature - mirroring
/// how `features/inspections/data/inspection_sync_engine.dart`'s
/// `InspectionSyncEngine` is the only caller of
/// `InspectionRemoteRepository.upsertInspection`. This split (thin
/// repository + a separate orchestrating engine) is the shape THIS
/// feature's write needs, precisely because it is the one write in this
/// port explicitly required to be offline-safe while ALSO never being
/// blindly replayed against stale server state (AGENTS.md, "Approvals and
/// other decisions that depend on current server state are NOT blindly
/// queued") - a bundled read-and-decide repository, the shape
/// `InspectionApprovalRepository` uses for the SIBLING, online-only,
/// single-stage inspection-approval flow, would not be honest about that
/// difference.
///
/// # Why [applyDecision] writes directly, and never through
/// # `decide_checklist_approval`
///
/// `SupabaseRpcs.decideChecklistApproval` is a real, verified RPC name -
/// but it is the RPC the WEB approvals surface calls
/// (`docs/audit`/PROJECT_MEMORY records "V597 ... `decide_checklist_
/// approval`, the RPC the WEB approvals surface calls", and confirms mobile
/// never has: `mobile/lib/checklists.ts`'s `decideApproval` routes through
/// `saveCommand('CHECKLIST_APPROVAL', ...)`, a plain table write, not an
/// RPC call - grep of `mobile/` finds `decide_checklist_approval` nowhere
/// at all). This port follows the MOBILE architecture, per this whole
/// migration's stated preference for the mobile shape where the two stacks
/// diverge, and per `checklist_approval.dart`'s own library comment: "the
/// server independently re-checks every rule this file models" via the
/// database trigger `guard_checklist_approval_stages`, which the TS
/// source's raw `.update()` already relies on - this file's write is a
/// faithful port of THAT path, strengthened with an optimistic-concurrency
/// guard the TS source does not have (see [applyDecision]'s own doc
/// comment).
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_template_info.dart';
import 'package:tyre_pulse/features/approvals/data/queued_checklist_approval_decision.dart';

/// The `.or(...)` filter that scopes the pending queue to [country], or
/// `null` when the whole queue should be read unfiltered.
///
/// A copy of `inspection_approval_repository.dart`'s own
/// `inspectionApprovalCountryFilter`, over a different table, deliberately
/// NOT imported from that file - this feature does not depend on the
/// inspection-approvals feature at all (see this port's final report). A
/// null row `country` is visible to everyone under the RESTRICTIVE country
/// RLS policy, so a reviewer with no country of their own (or scoped to
/// several) must see the whole pending queue rather than an empty one -
/// this filter narrows, it never widens what RLS already permits. `'All'`
/// is also treated as "no filter", matching
/// `checklist_remote_repository.dart`'s own defensive check for the same
/// sentinel value reaching this layer from an upstream selector.
String? checklistApprovalCountryFilter(String? country) {
  final String trimmed = country?.trim() ?? '';
  if (trimmed.isEmpty || trimmed == 'All') return null;
  return 'country.eq.$trimmed,country.is.null';
}

/// How many DISTINCT templates one queue refresh will best-effort look up.
/// Matches `mobile/lib/checklists.ts`'s own `.slice(0, 20)` cap on the
/// identical lookup - a queue that can hold up to 200 rows must not turn
/// into 200 individual template reads on every refresh.
const int checklistApprovalTemplateLookupCap = 20;

/// What [ChecklistApprovalRepository.applyDecision] found when it tried to
/// write [QueuedChecklistApprovalDecision] to the server.
///
/// Deliberately NOT a boolean, and deliberately NOT expressed as a thrown
/// exception for the [conflict] case - mirrors
/// `supabase_command_pusher.dart`'s own documented reasoning for the
/// analogous `requiresOptimisticStatusMatch` write: "zero rows means
/// somebody else changed it first ... a legitimate outcome of the query,
/// not a failure of it."
enum ChecklistApprovalApplyResult {
  /// The conditional update matched the row and the columns were written.
  applied,

  /// The conditional update matched ZERO rows: `checklist_submissions.
  /// approval_status` no longer equals
  /// [QueuedChecklistApprovalDecision.priorApprovalStatus]. Somebody else
  /// changed this submission first. Nothing was written.
  conflict,
}

/// The narrow surface this feature needs from Supabase. Abstract so the
/// sync engine and the queue/review screens can all be tested against a
/// fake, mirroring `InspectionApprovalRepository`'s own
/// abstract-interface/concrete-implementation split.
abstract interface class ChecklistApprovalRepository {
  /// Submissions awaiting a decision (`require_approval` templates),
  /// newest first, bounded to 200 - matches
  /// `mobile/lib/checklists.ts`'s own `.limit(200)` on the identical read.
  /// BOTH waiting states are returned, never just `'pending'` - see
  /// [ChecklistApprovalItem.isWaiting]'s own doc comment for why a sheet a
  /// supervisor has already signed off must not vanish from every queue.
  Future<List<ChecklistApprovalItem>> listPending({String? country});

  /// One submission in full, for the review screen. `null` when the id
  /// does not exist, or is not readable under RLS.
  Future<ChecklistApprovalItem?> byId(String id);

  /// The narrow template facts the ladder engine and the answer-rendering
  /// section need, for ONE template. Best-effort: returns `null` on any
  /// failure or when the template no longer exists - a template that
  /// cannot be read must degrade to "labels read as field ids, treat as
  /// single-stage", never block the queue or the review screen.
  Future<ChecklistApprovalTemplateInfo?> templateInfo(String templateId);

  /// [templateInfo] for several submissions at once, bounded to
  /// [checklistApprovalTemplateLookupCap] DISTINCT ids - for the queue
  /// screen's per-row "who is this waiting on" wording and its "needs me"
  /// filter, which both need `require_area_manager` before a submission's
  /// own row can be interpreted at all. Best-effort per id: a template
  /// this cannot read is simply absent from the returned map, never a
  /// reason to fail the whole batch.
  Future<Map<String, ChecklistApprovalTemplateInfo>> templateInfoBatch(
    Iterable<String> templateIds,
  );

  /// The signed-in user's display name (`full_name` else `username`), for
  /// the "signing as" line and as the default typed name. Best-effort:
  /// returns `null` on any failure or when nothing is found - byte-
  /// identical in shape to `ChecklistRemoteRepository.
  /// currentUserDisplayName`'s own contract over the same `profiles`
  /// columns, reproduced here rather than imported because this feature
  /// does not depend on the checklists feature's data layer.
  Future<String?> currentUserDisplayName(String userId);

  /// Attempts, ONCE, to write [item] to `checklist_submissions`. Never
  /// queues and never retries - see the library comment.
  ///
  /// The write is conditioned on BOTH `id` AND `approval_status =
  /// item.priorApprovalStatus`: if the submission's status has already
  /// moved on, zero rows match and this returns
  /// [ChecklistApprovalApplyResult.conflict] with NOTHING written, rather
  /// than throwing - matching `supabase_command_pusher.dart`'s own
  /// established idiom for an optimistic-concurrency write elsewhere in
  /// this codebase. Throws (as a [SupabaseFailure], via
  /// [SupabaseGateway.guard]) for any other failure - connectivity, RLS, a
  /// server-side refusal from `guard_checklist_approval_stages` - so the
  /// caller can classify what actually went wrong.
  Future<ChecklistApprovalApplyResult> applyDecision(
    QueuedChecklistApprovalDecision item,
  );
}

final class SupabaseChecklistApprovalRepository
    with SupabaseGateway
    implements ChecklistApprovalRepository {
  SupabaseChecklistApprovalRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<ChecklistApprovalItem>> listPending({String? country}) async {
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(() async {
      // Two chained `.or()` calls, not a batched "IN" filter - this
      // codebase has no existing call site to check an "IN" method name
      // against (no resolvable pub cache in this environment - see this
      // port's final report), while `.or()` is already proven correct
      // elsewhere in this exact file (the country scope below) and in
      // `checklist_remote_repository.dart`. Chained filter calls combine
      // with AND, so this expresses exactly `(approval_status IN
      // ('pending','pending_area_manager')) AND (country condition)` -
      // both waiting states, matching `mobile/lib/checklists.ts`'s own
      // `.in('approval_status', ['pending', 'pending_area_manager'])`.
      var query = _client
          .from(SupabaseTables.checklistSubmissions)
          .select(checklistApprovalListColumns)
          .or('approval_status.eq.pending,'
              'approval_status.eq.pending_area_manager');
      final String? filter = checklistApprovalCountryFilter(country);
      if (filter != null) {
        query = query.or(filter);
      }
      return await query
              .order('submitted_at', ascending: false, nullsFirst: false)
              .limit(200)
          as List<Map<String, dynamic>>;
    });
    return <ChecklistApprovalItem>[
      for (final Map<String, dynamic> row in rows)
        ChecklistApprovalItem.fromRow(row),
    ];
  }

  @override
  Future<ChecklistApprovalItem?> byId(String id) async {
    final Map<String, dynamic>? row = await guard<Map<String, dynamic>?>(
      () => _client
          .from(SupabaseTables.checklistSubmissions)
          .select(checklistApprovalFullColumns)
          .eq('id', id)
          .maybeSingle(),
    );
    if (row == null) return null;
    return ChecklistApprovalItem.fromRow(row);
  }

  @override
  Future<ChecklistApprovalTemplateInfo?> templateInfo(
    String templateId,
  ) async {
    if (templateId.isEmpty) return null;
    try {
      final Map<String, dynamic>? row = await guard<Map<String, dynamic>?>(
        () => _client
            .from(SupabaseTables.checklistTemplates)
            .select(checklistApprovalTemplateColumns)
            .eq('id', templateId)
            .maybeSingle(),
      );
      if (row == null) return null;
      return ChecklistApprovalTemplateInfo.fromRow(row);
    } on Object {
      return null;
    }
  }

  @override
  Future<Map<String, ChecklistApprovalTemplateInfo>> templateInfoBatch(
    Iterable<String> templateIds,
  ) async {
    final List<String> distinct = <String>{
      for (final String id in templateIds)
        if (id.isNotEmpty) id,
    }.take(checklistApprovalTemplateLookupCap).toList(growable: false);
    if (distinct.isEmpty) {
      return const <String, ChecklistApprovalTemplateInfo>{};
    }

    // One `.or('id.eq.a,id.eq.b,...')` read rather than N individual
    // `.eq(...).maybeSingle()` calls - `.or()` is already proven correct
    // elsewhere in this file (see [listPending]) and in
    // `checklist_remote_repository.dart`, so this stays on verified API
    // surface while still costing one round trip for up to
    // [checklistApprovalTemplateLookupCap] templates rather than up to
    // that many. Safe to interpolate `id` directly: every value here is a
    // `checklist_submissions.template_id`, i.e. a uuid, which can never
    // contain a comma or any other character with meaning inside a
    // PostgREST filter expression.
    //
    // Best-effort as a whole: a template read that fails must never block
    // the queue screen - it just degrades every row it would have covered
    // to "labels read as field ids, treat as single-stage", exactly as a
    // single [templateInfo] failure already does.
    try {
      final List<Map<String, dynamic>> rows =
          await guard<List<Map<String, dynamic>>>(() async {
        return await _client
                .from(SupabaseTables.checklistTemplates)
                .select(checklistApprovalTemplateColumns)
                .or(
                  distinct.map((String id) => 'id.eq.$id').join(','),
                ) as List<Map<String, dynamic>>;
      });
      final Map<String, ChecklistApprovalTemplateInfo> out =
          <String, ChecklistApprovalTemplateInfo>{};
      for (final Map<String, dynamic> row in rows) {
        final ChecklistApprovalTemplateInfo? info =
            ChecklistApprovalTemplateInfo.fromRow(row);
        if (info != null) out[info.id] = info;
      }
      return out;
    } on Object {
      return const <String, ChecklistApprovalTemplateInfo>{};
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
  Future<ChecklistApprovalApplyResult> applyDecision(
    QueuedChecklistApprovalDecision item,
  ) async {
    final Map<String, Object?> patch = _patchFor(item);
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(() async {
      return await _client
              .from(SupabaseTables.checklistSubmissions)
              .update(patch)
              .eq('id', item.submissionId)
              .eq('approval_status', item.priorApprovalStatus)
              .select('id') as List<Map<String, dynamic>>;
    });
    return rows.isEmpty
        ? ChecklistApprovalApplyResult.conflict
        : ChecklistApprovalApplyResult.applied;
  }

  /// Field-for-field against `mobile/lib/checklists.ts:459-483`'s
  /// `decideApproval` - see [QueuedChecklistApprovalDecision]'s own library
  /// comment and this port's final report for the exact line-by-line
  /// comparison. A supervisor rung writes the SUPERVISOR columns; every
  /// other resulting status (both `'approved'` and `'rejected'`) writes
  /// the APPROVER columns - writing both would make one person look like
  /// two, which is the entire reason the two column sets exist at all.
  static Map<String, Object?> _patchFor(
    QueuedChecklistApprovalDecision item,
  ) {
    final String? nameOrNull = _blankToNull(item.approverName);
    final String nowIso = item.decidedAt.toIso8601String();

    final Map<String, Object?> stageFields =
        item.targetStatus == 'pending_area_manager'
            ? <String, Object?>{
                'supervisor_name': nameOrNull,
                'supervisor_signature': item.approverSignature,
                'supervisor_by': item.approverId,
                'supervisor_at': nowIso,
              }
            : <String, Object?>{
                'approver_name': nameOrNull,
                'approver_signature': item.approverSignature,
                'approved_by': item.approverId,
                'approved_at': nowIso,
              };

    return <String, Object?>{
      'approval_status': item.targetStatus,
      ...stageFields,
      'review_note': item.approved ? null : item.reviewNote,
      // Only a CLOSED sheet locks. A supervisor sign-off must leave it
      // editable, because the area manager may send it back.
      'locked': item.targetStatus == 'approved',
    };
  }

  static String? _blankToNull(String? raw) {
    final String trimmed = raw?.trim() ?? '';
    return trimmed.isEmpty ? null : trimmed;
  }
}
