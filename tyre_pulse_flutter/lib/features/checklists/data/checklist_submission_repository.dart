/// Assembles a completed checklist into the exact payload
/// `CommandRegistry.specFor(CommandType.checklistSubmission)` allows,
/// enqueues it through the SHARED offline command queue, and hands photo
/// ownership from the draft over to that queue.
///
/// # Checklist submission does NOT get its own dedicated sync engine
///
/// Unlike `features/inspections/data/inspection_sync_engine.dart` (a
/// feature-owned engine built because `CHECKLIST_APPROVAL` - a DECISION -
/// was deliberately excluded from the generic queue), a checklist
/// SUBMISSION is an observation like any other queueable write, and
/// `lib/core/sync/command_registry.dart` already declares
/// [CommandType.checklistSubmission] with `requiresMediaReady: true`. This
/// file therefore does exactly one thing: build the payload, call
/// [QueuedCommandRepository.enqueue] once, and stop. Actually pushing the
/// command to Supabase, waiting for its photos, and retrying on failure is
/// `lib/core/sync/sync_engine.dart`'s job - a shared, already-built piece
/// this feature does not duplicate or drive directly.
///
/// # Photo ownership: draft folder -> queue, never both
///
/// [MediaDao.addDraftPhoto] wrote every captured photo into this feature's
/// OWN durable folder (`checklist_draft_photos/<draftKey>/`), never the
/// queue's. At submit time those SAME files are handed to
/// [QueuedCommandRepository.enqueue] as [QueuedMediaAttachment]s - so
/// `pending_media_uploads` now references the physical files too - and only
/// THEN is [ChecklistDraftRepository.discardDraft] called, which deletes the
/// draft's bookkeeping ROWS (`checklist_drafts`, `draft_photos`,
/// `captured_signatures`) but returns the photo paths without this
/// repository deleting the underlying FILES: ownership has moved to the
/// queue, and deleting them now would be the exact incident this port's
/// brief calls out by name in reverse - the queue's own sweep already
/// protects a file any `pending_media_uploads` row still references
/// (`MediaDao.referencedFileNames`), but only a file whose OWNING draft row
/// has genuinely gone can ever be swept, and only once the queue itself has
/// verified it (`markCommandMediaVerified`, run only after this command
/// reaches `synced`).
///
/// # A confirmed, pre-existing gap in the SHARED sync layer - not
/// # introduced or fixable here
///
/// `SyncEngine._pushOne` and `SupabaseCommandPusher.push` (both read, never
/// edited, from this feature) send a claimed command's stored JSON payload
/// to Supabase VERBATIM (filtered by allow-list, with the match column and
/// `client_uuid` handled specially) - NEITHER rewrites a `photos` field's
/// local file paths into the `tp-storage://...` remote refs
/// `PendingMediaUploads.remoteRef` documents. `requiresMediaReady: true`
/// correctly HOLDS the command back until every attached photo has reached
/// `uploaded`/`verified`, and the upload pipeline itself
/// (`MediaDao.claimNextUploads`/`markUploaded`) genuinely puts the objects
/// in storage - but the JSON VALUE that ends up in the real
/// `checklist_submissions.photos` column, once this command is pushed, is
/// still this device's LOCAL file paths, not the resolved remote refs. This
/// is a real, structural gap in `lib/core/sync/`, shared by every other
/// `requiresMediaReady` command ([CommandType.tyreChange] included), not
/// something specific to checklists and not something this single-feature
/// phase is scoped to fix (doing so correctly touches `sync_engine.dart`,
/// `command_registry.dart` and `supabase_command_pusher.dart`, all outside
/// this phase's boundary, and would change behaviour for a feature this
/// phase does not own). [submit] still attaches every photo correctly so
/// the objects genuinely reach storage; only the final JSON value written
/// back into the row's `photos` column is affected, and only until that
/// later integration pass lands.
///
/// # A second, separate confirmed gap: [CommandType.checklistAssignmentStatus]
/// # can never actually reach the server today
///
/// `CommandSpec.requiresOptimisticStatusMatch` (true for
/// [CommandType.checklistAssignmentStatus]) makes `SyncEngine._pushOne`
/// require `sync_engine.dart`'s own `expectedPriorStatusPayloadKey`
/// (`'_expectedPriorStatus'`) to be present in the CLAIMED command's decoded
/// payload. But `CommandRegistry.specFor(CommandType.checklistAssignmentStatus)
/// .fieldAllowList` is `{'id','status','submission_id','completed_at'}` -
/// it does NOT include that key, unlike [CommandSpec.matchColumn] (`'id'`),
/// which `queued_command_repository.dart`'s own doc comment confirms is
/// DELIBERATELY kept in the allow-list for exactly this reason ("the
/// repository that enqueues a command keeps the full allow-listed
/// payload... only the sync engine, at push time, excludes [it]").
/// `QueuedCommandRepository.enqueue` therefore silently DROPS
/// `_expectedPriorStatus` before the row is ever stored, and every attempt
/// to push it afterwards fails permanently with "This update is missing
/// the information needed to avoid overwriting a change made elsewhere" -
/// the exact same failure for [CommandType.workOrderStatus] and
/// [CommandType.correctiveActionStatus] too, since neither of THEIR
/// allow-lists carries the key either. This is confirmed by reading
/// `command_registry.dart` and `sync_engine.dart` side by side, not
/// assumed. The one-line fix (adding `'_expectedPriorStatus'` to those
/// three `fieldAllowList`s) is outside this phase's boundary
/// (`command_registry.dart` may not be edited here).
///
/// Given that, [submit] still ATTEMPTS the assignment-completion command
/// when it has enough information to - the moment that one-line fix lands
/// elsewhere, this starts working with no change on this feature's side -
/// but treats it as best-effort exactly as `mobile/lib/checklists.ts`'s
/// `submitChecklist` does its own linked `CHECKLIST_ASSIGNMENT_STATUS` call
/// ("Best-effort — a failure here still leaves the submission recorded"):
/// any failure, including this permanent one, never prevents or reports as
/// a failure of the checklist submission itself, which is this file's one
/// essential deliverable.
library;

import 'package:tyre_pulse/core/database/dao/queue_dao.dart'
    show QueuedMediaAttachment;
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart'
    show expectedPriorStatusPayloadKey;
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:uuid/uuid.dart';

/// What a caller needs after a submit call returns.
final class ChecklistSubmissionResult {
  const ChecklistSubmissionResult({
    required this.submissionId,
    required this.droppedFields,
  });

  /// `checklist_submissions.id` - minted here, before any network attempt,
  /// so it is known even offline (for navigation, and for linking the
  /// assignment).
  final String submissionId;

  /// Payload keys this feature sent that the queue's allow-list dropped.
  /// Non-empty is worth logging as telemetry; it is never shown to the
  /// user, matching [EnqueueResult.droppedFields]'s own contract.
  final Set<String> droppedFields;
}

/// Submits a completed checklist. Never throws for an ordinary offline
/// condition - [QueuedCommandRepository.enqueue] itself only throws for a
/// genuine caller bug (a blank workspace, a missing update target neither of
/// which apply to this insert-only command).
abstract interface class ChecklistSubmissionRepository {
  Future<ChecklistSubmissionResult> submit({
    required WorkspaceContext workspace,
    required ChecklistTemplateRecord templateRecord,
    required String draftKey,
    required Map<String, Object?> answers,
    required Map<String, Object?> notes,
    String? assignmentId,
    String? assignmentPriorStatus,
    String? site,
    String? assetNo,
    String? title,
    String? printedName,
    int? scorePct,
    bool? scorePassed,
  });
}

final class DefaultChecklistSubmissionRepository
    implements ChecklistSubmissionRepository {
  DefaultChecklistSubmissionRepository({
    required QueuedCommandRepository commandRepository,
    required ChecklistDraftRepository draftRepository,
  })  : _commands = commandRepository,
        _drafts = draftRepository;

  final QueuedCommandRepository _commands;
  final ChecklistDraftRepository _drafts;

  static const Uuid _uuid = Uuid();

  @override
  Future<ChecklistSubmissionResult> submit({
    required WorkspaceContext workspace,
    required ChecklistTemplateRecord templateRecord,
    required String draftKey,
    required Map<String, Object?> answers,
    required Map<String, Object?> notes,
    String? assignmentId,
    String? assignmentPriorStatus,
    String? site,
    String? assetNo,
    String? title,
    String? printedName,
    int? scorePct,
    bool? scorePassed,
  }) async {
    final String submissionId = _uuid.v4();
    final DateTime now = DateTime.now();

    final List<ChecklistDraftPhoto> photos = await _drafts.photosFor(draftKey);
    final List<ChecklistDraftSignature> signatures =
        await _drafts.signaturesFor(draftKey);

    // Keyed by field id, mirroring `mobile/lib/checklists.ts`'s
    // `Record<string, string[]>` photo shape exactly - never flattened to a
    // bare list, which would silently merge two different fields' evidence.
    final Map<String, List<String>> photosPayload = <String, List<String>>{};
    final Map<String, int> orderByField = <String, int>{};
    final List<QueuedMediaAttachment> attachments = <QueuedMediaAttachment>[];
    for (final ChecklistDraftPhoto photo in photos) {
      final String key = photo.fieldKey.isEmpty ? '_unfiled' : photo.fieldKey;
      photosPayload.putIfAbsent(key, () => <String>[]).add(photo.localPath);
      final int index = orderByField[key] ?? 0;
      orderByField[key] = index + 1;
      attachments.add(
        QueuedMediaAttachment(
          localPath: photo.localPath,
          fileName: _basename(photo.localPath),
          orderIndex: index,
          fieldKey: photo.fieldKey.isEmpty ? null : photo.fieldKey,
        ),
      );
    }

    final Map<String, String> signaturesPayload = <String, String>{};
    String? primarySignature;
    for (final ChecklistDraftSignature sig in signatures) {
      if (sig.fieldKey == primarySignatureFieldKey) {
        primarySignature = sig.payload;
      } else if (sig.fieldKey.isNotEmpty) {
        signaturesPayload[sig.fieldKey] = sig.payload;
      }
    }
    // `signature_data` stays the PRIMARY sign-off column every existing
    // reader already reads: the template-level pad when there is one, else
    // the first captured FIELD signature - mirrors
    // `mobile/app/(app)/checklists/[templateId].tsx`'s own
    // `primary = primarySignature || firstFieldSignature` fallback.
    final String? signatureData = primarySignature ??
        (signaturesPayload.isEmpty ? null : signaturesPayload.values.first);

    final Map<String, Object?> payload = <String, Object?>{
      'id': submissionId,
      'template_id': templateRecord.template.id,
      'template_name': templateRecord.template.name,
      'template_version': templateRecord.version,
      'country': workspace.activeCountry ?? templateRecord.country,
      'site': site,
      'asset_no': assetNo,
      'title': title ?? templateRecord.template.name,
      'status': 'submitted',
      'answers': answers,
      'photos': photosPayload,
      'signature_data': signatureData,
      'printed_name': printedName,
      'score_pct': scorePct,
      'score_passed': scorePassed,
      // Approval lifecycle: a template flagged `require_approval` starts
      // `pending`; otherwise `not_required`. See
      // [ChecklistTemplateRecord.freshApprovalStatus]'s own doc comment for
      // why this NEVER consults `require_area_manager` - that decision
      // belongs entirely to the separate, already-built
      // `lib/features/approvals/` feature.
      'approval_status': templateRecord.freshApprovalStatus,
      'signatures': signaturesPayload,
      'notes': notes,
    };

    final EnqueueResult result = await _commands.enqueue(
      type: CommandType.checklistSubmission,
      payload: payload,
      workspace: workspace,
      now: now,
      id: submissionId,
      entityId: submissionId,
      attachments: attachments,
      country: workspace.activeCountry ?? templateRecord.country,
    );

    // Best-effort: mark the assignment completed. See the library comment
    // on why this is currently unable to reach the server at all, and why
    // that must never surface as a failure of the checklist submission
    // itself.
    if (assignmentId != null &&
        assignmentId.isNotEmpty &&
        assignmentPriorStatus != null &&
        assignmentPriorStatus.isNotEmpty) {
      try {
        await _commands.enqueue(
          type: CommandType.checklistAssignmentStatus,
          payload: <String, Object?>{
            'id': assignmentId,
            'status': 'completed',
            'submission_id': submissionId,
            'completed_at': now.toIso8601String(),
            expectedPriorStatusPayloadKey: assignmentPriorStatus,
          },
          workspace: workspace,
          now: now,
          entityId: assignmentId,
          dependsOn: result.command.id,
          country: workspace.activeCountry,
        );
      } on Object {
        // Non-blocking - the submission above is already durably recorded.
      }
    }

    // Hand-off complete: the queue now owns these files (via the
    // attachments above). Discard the draft's BOOKKEEPING ROWS only - do
    // NOT delete the returned photo paths, they are the same files
    // `pending_media_uploads` now references.
    await _drafts.discardDraft(draftKey);

    return ChecklistSubmissionResult(
      submissionId: submissionId,
      droppedFields: result.droppedFields,
    );
  }

  static String _basename(String path) {
    final int slash = path.lastIndexOf(RegExp(r'[\\/]'));
    return slash < 0 ? path : path.substring(slash + 1);
  }
}
