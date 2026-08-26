/// Payload-assembly coverage for [DefaultChecklistSubmissionRepository],
/// against the REAL [QueuedCommandRepository] and
/// [DriftChecklistDraftRepository] over a shared in-memory database -
/// mirroring `test/core/sync/queued_command_repository_test.dart`'s own
/// `WorkspaceContext` fixture, per this phase's instruction to reuse that
/// established pattern rather than a mock.
///
/// Asserts exactly the allow-listed fields survive
/// (`CommandRegistry.specFor(CommandType.checklistSubmission).fieldAllowList`,
/// 18 keys), that `photos`/`signatures`/`notes` are shaped correctly (a map
/// keyed by field id, never a flattened list - see
/// `checklist_submission_repository.dart`'s own library comment on why), and
/// that the draft's bookkeeping rows are gone afterwards while the photo
/// FILES are handed off to the queue rather than deleted.
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_submission_repository.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';

import '../../../core/database/database_test_support.dart';

const UserRole _testRole = UserRole.known(RoleId.reporter);
const AccessState _testAccess = AccessState(role: _testRole);

WorkspaceContext _workspace({String? activeCountry = 'KSA'}) {
  return WorkspaceContext(
    userId: testUser,
    role: _testRole,
    effectivePermissions: _testAccess,
    countryScope: CountryScope.none,
    siteScope: SiteScope.none,
    companyId: workspaceA,
    tenantId: workspaceA,
    activeCountry: activeCountry,
  );
}

ChecklistTemplateRecord _template({
  bool requireApproval = false,
  bool requireSignature = false,
}) {
  return ChecklistTemplateRecord(
    template: const ChecklistTemplate(
      id: 't1',
      name: 'Workshop Daily Checklist',
      fields: <ChecklistField>[
        ChecklistField(id: 'brakes', type: 'select', label: 'Brakes'),
      ],
    ),
    version: 3,
    requireApproval: requireApproval,
    requireSignature: requireSignature,
    country: 'KSA',
  );
}

void main() {
  late AppDatabase db;
  late DriftChecklistDraftRepository drafts;
  late QueuedCommandRepository commands;
  late DefaultChecklistSubmissionRepository repository;

  setUp(() {
    db = newMemoryDatabase();
    drafts = DriftChecklistDraftRepository(db.draftsDao, db.mediaDao);
    commands = QueuedCommandRepository(db.queueDao);
    repository = DefaultChecklistSubmissionRepository(
      commandRepository: commands,
      draftRepository: drafts,
    );
  });

  tearDown(() async {
    await db.close();
  });

  /// The queued row for a submission's OWN command - [submit] always passes
  /// its minted `submissionId` through as the command's `id`, so this is the
  /// direct, unambiguous way to find it rather than assuming list ordering
  /// or that only one command was ever enqueued.
  Future<PendingCommand> checklistCommandFor(String submissionId) async {
    final PendingCommand? row = await db.queueDao.commandById(submissionId);
    expect(row, isNotNull, reason: 'no queued command for $submissionId');
    return row!;
  }

  Map<String, Object?> decode(PendingCommand row) =>
      jsonDecode(row.payloadJson) as Map<String, Object?>;

  test('the stored payload carries exactly the 18 allow-listed fields, no '
      'more and no fewer', () async {
    final ChecklistSubmissionResult result = await repository.submit(
      workspace: _workspace(),
      templateRecord: _template(),
      draftKey: 'irrelevant-empty-draft',
      answers: <String, Object?>{'brakes': 'OK'},
      notes: const <String, Object?>{},
      site: 'NHC',
      assetNo: 'TM514',
    );

    final PendingCommand stored = await checklistCommandFor(result.submissionId);
    final Map<String, Object?> payload = decode(stored);

    expect(
      payload.keys.toSet(),
      CommandRegistry.specFor(CommandType.checklistSubmission).fieldAllowList,
    );
    expect(payload['id'], result.submissionId);
    expect(payload['site'], 'NHC');
    expect(payload['asset_no'], 'TM514');
    expect(payload['country'], 'KSA');
    expect(payload['status'], 'submitted');
    expect(result.droppedFields, isEmpty);
    expect(stored.entityType, SupabaseTables.checklistSubmissions);
  });

  test('a title falls back to the template name when none is supplied', () async {
    final ChecklistSubmissionResult result = await repository.submit(
      workspace: _workspace(),
      templateRecord: _template(),
      draftKey: 'draft-title',
      answers: const <String, Object?>{},
      notes: const <String, Object?>{},
    );
    final Map<String, Object?> payload =
        decode(await checklistCommandFor(result.submissionId));
    expect(payload['title'], 'Workshop Daily Checklist');
  });

  test('require_approval true submits approval_status pending', () async {
    final ChecklistSubmissionResult result = await repository.submit(
      workspace: _workspace(),
      templateRecord: _template(requireApproval: true),
      draftKey: 'draft-a',
      answers: const <String, Object?>{},
      notes: const <String, Object?>{},
    );
    final Map<String, Object?> payload =
        decode(await checklistCommandFor(result.submissionId));
    expect(payload['approval_status'], 'pending');
  });

  test('require_approval false submits approval_status not_required, never '
      'consulting require_area_manager', () async {
    final ChecklistSubmissionResult result = await repository.submit(
      workspace: _workspace(),
      templateRecord: _template(),
      draftKey: 'draft-b',
      answers: const <String, Object?>{},
      notes: const <String, Object?>{},
    );
    final Map<String, Object?> payload =
        decode(await checklistCommandFor(result.submissionId));
    expect(payload['approval_status'], 'not_required');
  });

  test('photos are keyed by field id, one array per field, never flattened '
      'into a single list', () async {
    final ChecklistTemplateRecord template = _template();
    final String draftKey = drafts.draftKeyFor(
      userId: testUser,
      templateId: template.template.id!,
      assetNo: 'TM514',
    );
    await drafts.saveHeader(
      userId: testUser,
      workspaceId: workspaceA,
      templateId: template.template.id!,
      templateName: template.template.name!,
      templateVersion: template.version,
      assetNo: 'TM514',
      answers: <String, Object?>{'brakes': 'Not OK'},
      notes: const <String, Object?>{},
      filled: 1,
      total: 1,
    );
    await drafts.addPhoto(
      draftKey: draftKey,
      fieldKey: 'brakes',
      localPath: '/tmp/brakes-1.jpg',
      capturedAt: DateTime.utc(2026, 8, 20, 9),
    );
    await drafts.addPhoto(
      draftKey: draftKey,
      fieldKey: 'brakes',
      localPath: '/tmp/brakes-2.jpg',
      capturedAt: DateTime.utc(2026, 8, 20, 9, 5),
    );
    await drafts.addPhoto(
      draftKey: draftKey,
      fieldKey: 'engine_bay',
      localPath: '/tmp/engine.jpg',
      capturedAt: DateTime.utc(2026, 8, 20, 9, 10),
    );

    final ChecklistSubmissionResult result = await repository.submit(
      workspace: _workspace(),
      templateRecord: template,
      draftKey: draftKey,
      answers: <String, Object?>{'brakes': 'Not OK'},
      notes: const <String, Object?>{},
      assetNo: 'TM514',
    );

    final PendingCommand pending = await checklistCommandFor(result.submissionId);
    final Map<String, Object?> payload = decode(pending);
    final Map<String, Object?> photos =
        payload['photos']! as Map<String, Object?>;

    expect((photos['brakes']! as List<Object?>), hasLength(2));
    expect((photos['engine_bay']! as List<Object?>), hasLength(1));

    // The photo files were genuinely handed to the queue, not just recorded
    // in the payload JSON: pending_media_uploads carries one row per photo,
    // referencing the SAME local paths, against the queued command's id.
    final List<PendingMediaUpload> uploads =
        await db.mediaDao.mediaForCommand(pending.id);
    expect(uploads, hasLength(3));
    expect(
      uploads.map((PendingMediaUpload u) => u.localPath).toSet(),
      <String>{'/tmp/brakes-1.jpg', '/tmp/brakes-2.jpg', '/tmp/engine.jpg'},
    );
  });

  test('signatures: the template-level pad is the primary sign-off and is '
      'excluded from the per-field signatures map', () async {
    final ChecklistTemplateRecord template = _template(requireSignature: true);
    final String draftKey = drafts.draftKeyFor(
      userId: testUser,
      templateId: template.template.id!,
      assetNo: 'TM514',
    );
    await drafts.saveSignature(
      draftKey: draftKey,
      fieldKey: primaryField,
      payload: '<svg><path d="M9 9"/></svg>',
      source: 'drawn',
    );
    await drafts.saveSignature(
      draftKey: draftKey,
      fieldKey: 'sign_mechanic',
      payload: '<svg><path d="M2 2"/></svg>',
      source: 'drawn',
    );

    final ChecklistSubmissionResult result = await repository.submit(
      workspace: _workspace(),
      templateRecord: template,
      draftKey: draftKey,
      answers: const <String, Object?>{},
      notes: const <String, Object?>{},
    );

    final Map<String, Object?> payload =
        decode(await checklistCommandFor(result.submissionId));

    expect(payload['signature_data'], contains('M9 9'));
    final Map<String, Object?> signatures =
        payload['signatures']! as Map<String, Object?>;
    expect(signatures.keys, <String>['sign_mechanic']);
    expect(signatures.containsKey(primaryField), isFalse);
  });

  test('with no template-level pad, the FIRST field signature becomes the '
      'primary sign-off - mirroring the mobile fallback', () async {
    final ChecklistTemplateRecord template = _template();
    final String draftKey = drafts.draftKeyFor(
      userId: testUser,
      templateId: template.template.id!,
      assetNo: 'TM514',
    );
    await drafts.saveSignature(
      draftKey: draftKey,
      fieldKey: 'sign_mechanic',
      payload: '<svg><path d="M3 3"/></svg>',
      source: 'drawn',
    );

    final ChecklistSubmissionResult result = await repository.submit(
      workspace: _workspace(),
      templateRecord: template,
      draftKey: draftKey,
      answers: const <String, Object?>{},
      notes: const <String, Object?>{},
    );

    final Map<String, Object?> payload =
        decode(await checklistCommandFor(result.submissionId));
    expect(payload['signature_data'], contains('M3 3'));
  });

  test('with no signature captured at all, signature_data is null', () async {
    final ChecklistSubmissionResult result = await repository.submit(
      workspace: _workspace(),
      templateRecord: _template(),
      draftKey: 'draft-no-signature',
      answers: const <String, Object?>{},
      notes: const <String, Object?>{},
    );
    final Map<String, Object?> payload =
        decode(await checklistCommandFor(result.submissionId));
    expect(payload['signature_data'], isNull);
    expect(payload['signatures'], isEmpty);
  });

  test('notes and answers pass through verbatim', () async {
    final ChecklistSubmissionResult result = await repository.submit(
      workspace: _workspace(),
      templateRecord: _template(),
      draftKey: 'draft-notes',
      answers: <String, Object?>{'brakes': 'Not OK'},
      notes: <String, Object?>{'brakes': 'Pad worn to the wear line'},
    );
    final Map<String, Object?> payload =
        decode(await checklistCommandFor(result.submissionId));
    expect(payload['answers'], <String, Object?>{'brakes': 'Not OK'});
    expect(
      payload['notes'],
      <String, Object?>{'brakes': 'Pad worn to the wear line'},
    );
  });

  test('after submit, the draft bookkeeping rows are gone but the photo '
      'FILES are never deleted by this repository - ownership has passed '
      'to the queue', () async {
    final ChecklistTemplateRecord template = _template();
    final String draftKey = drafts.draftKeyFor(
      userId: testUser,
      templateId: template.template.id!,
      assetNo: 'TM514',
    );
    await drafts.saveHeader(
      userId: testUser,
      workspaceId: workspaceA,
      templateId: template.template.id!,
      templateName: template.template.name!,
      templateVersion: template.version,
      assetNo: 'TM514',
      answers: <String, Object?>{'brakes': 'OK'},
      notes: const <String, Object?>{},
      filled: 1,
      total: 1,
    );
    await drafts.addPhoto(
      draftKey: draftKey,
      fieldKey: 'brakes',
      localPath: '/tmp/still-owned.jpg',
      capturedAt: DateTime.utc(2026, 8, 20, 9),
    );

    final ChecklistSubmissionResult result = await repository.submit(
      workspace: _workspace(),
      templateRecord: template,
      draftKey: draftKey,
      answers: <String, Object?>{'brakes': 'OK'},
      notes: const <String, Object?>{},
    );

    // The draft's own bookkeeping is gone...
    expect(await drafts.header(draftKey), isNull);
    expect(await drafts.photosFor(draftKey), isEmpty);

    // ...but the queue now references the SAME file, proving it was handed
    // off rather than orphaned or duplicated.
    final PendingCommand pending = await checklistCommandFor(result.submissionId);
    final List<PendingMediaUpload> uploads =
        await db.mediaDao.mediaForCommand(pending.id);
    expect(uploads.single.localPath, '/tmp/still-owned.jpg');
  });

  test('the assignment-completion follow-up is attempted, best-effort, and '
      'a failure there never prevents the checklist submission itself from '
      'succeeding', () async {
    // No real assignment row exists for this id; the linked best-effort
    // enqueue may succeed structurally or silently drop its special
    // `_expectedPriorStatus` key (a confirmed, documented platform gap -
    // see the repository's own library comment). Either way, `submit` must
    // still return a real result for the checklist itself, and the
    // checklist's OWN command must still be queued correctly.
    final ChecklistSubmissionResult result = await repository.submit(
      workspace: _workspace(),
      templateRecord: _template(),
      draftKey: 'draft-with-assignment',
      answers: const <String, Object?>{},
      notes: const <String, Object?>{},
      assignmentId: 'assignment-1',
      assignmentPriorStatus: 'pending',
    );

    expect(result.submissionId, isNotEmpty);
    final PendingCommand checklistCommand =
        await checklistCommandFor(result.submissionId);
    expect(
      checklistCommand.commandType,
      CommandType.checklistSubmission.wireName,
    );
  });

  test('with no assignmentId, the best-effort follow-up is skipped and only '
      'the checklist command is queued', () async {
    final ChecklistSubmissionResult result = await repository.submit(
      workspace: _workspace(),
      templateRecord: _template(),
      draftKey: 'draft-no-assignment',
      answers: const <String, Object?>{},
      notes: const <String, Object?>{},
    );

    final List<PendingCommand> all =
        await db.queueDao.outstandingCommands(workspaceId: workspaceA);
    expect(all, hasLength(1));
    expect(all.single.id, result.submissionId);
  });
}
