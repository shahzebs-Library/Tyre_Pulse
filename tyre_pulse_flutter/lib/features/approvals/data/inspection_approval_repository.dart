/// Supervisor sign-off over the `inspections` table.
///
/// Ported field-for-field from `mobile/lib/inspectionApprovals.ts`
/// (`mobile/` is READ-ONLY reference material - see `AGENTS.md` rule "Never
/// edit them from this project"). That file's own library comment explains
/// the design better than a summary could, so its reasoning is repeated
/// here rather than paraphrased:
///
/// When a field inspection is submitted it is stored with
/// `approval_status = 'pending_approval'` and the inspector's drawn
/// signature. A supervisor/manager reviews the recorded tyre conditions and
/// signature and either APPROVES (capturing their own signature, locking
/// the record) or RETURNS it to the field with a note. Country isolation
/// and role gating are enforced server side by the `inspections` RLS and by
/// the `decide_inspection_approval` RPC itself; the client-side country
/// filter in [listPending] is a convenience scope, not a security boundary.
///
/// This is a SINGLE-STAGE decision - unlike checklist approvals
/// (`lib/features/approvals/domain/checklist_approval.dart`), there is no
/// two-rung ladder here and no state machine worth a domain file of its
/// own: [InspectionApprovalItem.approvalStatus] is either
/// `'pending_approval'` or it is decided.
///
/// # Why the decision goes through an RPC, never a direct table update
///
/// `mobile/lib/inspectionApprovals.ts`'s own comment on `decideInspection`,
/// reproduced because it is the reason [decide] exists at all rather than a
/// plain `.update()`:
///
///  1. NO "ALREADY DECIDED" GUARD on a direct update - two supervisors
///     opening the same pending inspection would both write, the second
///     silently overwriting the first one's signature and timestamp. The
///     RPC updates `WHERE approval_status = 'pending_approval'` and
///     otherwise raises a message naming who decided it.
///  2. A DIRECT UPDATE TRUSTS THE CLIENT FOR WHO APPROVED. The RPC uses
///     `auth.uid()` and the caller's own profile, so the record can never
///     be attributed to someone who did not press the button - see
///     [InspectionApprovalDecision.approverName]'s own doc comment.
///  3. THE WRONG RULE WOULD ENFORCE IT. A permissive
///     `role_update_inspections` policy admits Admin/Manager/Inspector,
///     which would let an inspector stamp their own approval; only a
///     screen-level gate would stop that. The RPC refuses anyone outside
///     Admin/Manager/Director/Maintenance Supervisor server side.
///  4. A DIRECT UPDATE WOULD BLOCK A DIRECTOR. The policy above does not
///     list Director, who both the approvals module and the RPC admit. The
///     RPC is SECURITY DEFINER and lets them through.
///
/// `MIGRATIONS_V602_INSPECTION_APPROVAL_REQUIRES_SIGNATURE.sql` (repo
/// root) additionally makes an unsigned APPROVAL of a still-pending, never
/// -signed row a database-level refusal - server-side, not merely a screen
/// gate - while leaving a REJECTION, an already-decided row, and a
/// re-approval of a row that already carries a signature untouched.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';

/// The `.or(...)` filter that scopes the pending queue to [country], or
/// `null` when the whole queue should be read unfiltered.
///
/// Mirrors `mobile/lib/inspectionApprovals.ts`'s own handling exactly: a
/// null row `country` is visible to everyone under the RESTRICTIVE country
/// RLS policy, so an approver with no country of their own (or scoped to
/// several) must see the WHOLE pending queue rather than an empty one -
/// this filter narrows, it never widens what RLS already permits.
/// `'All'` is also treated as "no filter", matching
/// `checklist_remote_repository.dart`'s own defensive check for the same
/// sentinel value reaching this layer from an upstream selector.
String? inspectionApprovalCountryFilter(String? country) {
  final String trimmed = country?.trim() ?? '';
  if (trimmed.isEmpty || trimmed == 'All') return null;
  return 'country.eq.$trimmed,country.is.null';
}

/// What a supervisor decided, and what they typed while deciding it.
///
/// #mirror: `DecideInspectionInput`.
final class InspectionApprovalDecision {
  const InspectionApprovalDecision({
    required this.inspectionId,
    required this.approved,
    this.approverSignature,
    this.reviewNote,
    this.approverName,
    this.existingNotes,
  });

  final String inspectionId;
  final bool approved;

  /// A drawn signature `data:` URL, or `null`. `decide_inspection_approval`
  /// refuses an APPROVAL that would leave a still-unsigned row with no
  /// signature at all (V602); a rejection needs none.
  final String? approverSignature;

  /// The reason for a rejection. Not required to approve.
  final String? reviewNote;

  /// A display name used ONLY to word the note the inspector reads back on
  /// a rejection (see [buildReturnedNote]) - it is NEVER the authoritative
  /// approver. The server derives that from the caller's own session
  /// (`auth.uid()`), so this field cannot be used to attribute a decision
  /// to somebody else.
  final String? approverName;

  /// The row's own `notes` before this decision, so a rejection reason can
  /// be appended without a read round trip.
  final String? existingNotes;
}

/// Builds the note a rejection echoes back into `inspections.notes`.
///
/// `decide_inspection_approval` records the reason in
/// `inspection_audit_log`, which no screen in this app reads; the
/// inspector's own detail screen renders `notes`, so without this echo a
/// returned inspection would come back with no visible explanation of what
/// to fix. Mirrors `mobile/lib/inspectionApprovals.ts`'s `merged`
/// construction exactly: the existing notes (trimmed, dropped entirely
/// when blank) then a new "Returned by <name>: <reason>" line, joined by a
/// blank line. [approverName] falls back to `'supervisor'` when blank -
/// never to an empty string, which would read as an anonymous return.
/// [note] is the already-trimmed, already-non-empty reason - callers only
/// reach this once they know one was given.
String buildReturnedNote({
  required String? existingNotes,
  required String? approverName,
  required String note,
}) {
  final String trimmedExisting = existingNotes?.trim() ?? '';
  final String trimmedApprover = approverName?.trim() ?? '';
  final String approver = trimmedApprover.isEmpty
      ? 'supervisor'
      : trimmedApprover;
  final String returnedLine = 'Returned by $approver: $note';
  return <String>[
    if (trimmedExisting.isNotEmpty) trimmedExisting,
    returnedLine,
  ].join('\n\n');
}

String? _trimmedOrNull(String? raw) {
  final String trimmed = raw?.trim() ?? '';
  return trimmed.isEmpty ? null : trimmed;
}

/// The narrow surface this feature needs from Supabase. Abstract so the
/// review screen can be tested against a fake, mirroring
/// `inspection_remote_repository.dart`'s own
/// `InspectionRemoteRepository`/`SupabaseInspectionRemoteRepository` split.
abstract interface class InspectionApprovalRepository {
  /// Pending inspections awaiting supervisor sign-off, newest first,
  /// bounded to 100 (matches the TS source's own `.limit(100)` - this is a
  /// live queue for a shift, never an unbounded fleet-wide read).
  Future<List<InspectionApprovalItem>> listPending({String? country});

  /// One inspection in full, for the review screen. `null` when the id does
  /// not exist, or is not readable under RLS.
  Future<InspectionApprovalItem?> byId(String id);

  /// Approves or returns the inspection named by [input.inspectionId].
  ///
  /// Throws on any failure - including a server refusal such as "already
  /// approved by X" or "an inspection approval needs a signature" - so the
  /// caller can surface it as a decision that did NOT happen, never a
  /// silent success. A rejection that carries a reason best-effort echoes
  /// it into `inspections.notes` afterwards; a failure of THAT echo is
  /// swallowed, matching `mobile/lib/inspectionApprovals.ts`'s own comment:
  /// the decision above is already committed by the time the echo runs, so
  /// an approver whose role cannot write `notes` directly must not be told
  /// their decision failed when it did not.
  Future<void> decide(InspectionApprovalDecision input);

  /// The signed-in user's display name (`full_name` else `username`), for
  /// the "signing as" line and for [InspectionApprovalDecision.
  /// approverName]. Best-effort: returns `null` on any failure or when
  /// nothing is found, mirroring
  /// `ChecklistRemoteRepository.currentUserDisplayName`'s own contract over
  /// the same `profiles` columns - a missing display name must never block
  /// signing off an inspection.
  Future<String?> currentUserDisplayName(String userId);
}

final class SupabaseInspectionApprovalRepository
    with SupabaseGateway
    implements InspectionApprovalRepository {
  SupabaseInspectionApprovalRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<InspectionApprovalItem>> listPending({String? country}) async {
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(() async {
      var query = _client
          .from(SupabaseTables.inspections)
          .select(inspectionApprovalListColumns)
          .eq('approval_status', 'pending_approval');
      final String? filter = inspectionApprovalCountryFilter(country);
      if (filter != null) {
        query = query.or(filter);
      }
      return await query.order('created_at', ascending: false).limit(100)
          as List<Map<String, dynamic>>;
    });
    return <InspectionApprovalItem>[
      for (final Map<String, dynamic> row in rows)
        InspectionApprovalItem.fromRow(row),
    ];
  }

  @override
  Future<InspectionApprovalItem?> byId(String id) async {
    final Map<String, dynamic>? row = await guard<Map<String, dynamic>?>(
      () => _client
          .from(SupabaseTables.inspections)
          .select(inspectionApprovalFullColumns)
          .eq('id', id)
          .maybeSingle(),
    );
    if (row == null) return null;
    return InspectionApprovalItem.fromRow(row);
  }

  @override
  Future<void> decide(InspectionApprovalDecision input) async {
    final String? note = _trimmedOrNull(input.reviewNote);

    await guard<void>(() async {
      await _client.rpc(
        SupabaseRpcs.decideInspectionApproval,
        params: <String, Object?>{
          'p_inspection_id': input.inspectionId,
          'p_decision': input.approved ? 'approved' : 'rejected',
          'p_note': note,
          'p_signature': input.approverSignature,
        },
      );
    });

    // Best effort, and deliberately AFTER the RPC has already committed -
    // see the library comment and this class's own [decide] doc comment.
    if (!input.approved && note != null) {
      final String merged = buildReturnedNote(
        existingNotes: input.existingNotes,
        approverName: input.approverName,
        note: note,
      );
      try {
        await guard<void>(() async {
          await _client
              .from(SupabaseTables.inspections)
              .update(<String, Object?>{'notes': merged})
              .eq('id', input.inspectionId);
        });
      } on Object {
        // The decision stands; the reason is preserved in
        // inspection_audit_log even when this echo is refused.
      }
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
}
