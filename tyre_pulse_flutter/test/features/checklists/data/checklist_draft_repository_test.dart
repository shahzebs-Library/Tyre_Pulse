/// Coverage for [DriftChecklistDraftRepository] against a real in-memory
/// Drift database, mirroring
/// `test/features/inspections/data/inspection_draft_repository_test.dart`'s
/// established pattern (`mobile/` is read-only reference material; this file
/// exercises this feature's OWN repository, never that one).
///
/// The one thing this test suite covers that the inspection equivalent does
/// not need to: MULTIPLE independent signature slots on one draft, keyed by
/// field id (or [primaryField] for the template-level pad) - see
/// `checklist_draft_repository.dart`'s own library comment for why a
/// checklist sheet needs this and an inspection does not.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';

import '../../../core/database/database_test_support.dart';

void main() {
  late AppDatabase db;
  late DriftChecklistDraftRepository repo;

  setUp(() {
    db = newMemoryDatabase();
    repo = DriftChecklistDraftRepository(db.draftsDao, db.mediaDao);
  });

  tearDown(() async {
    await db.close();
  });

  group('draftKeyFor', () {
    test('is deterministic for the same user, template and asset', () {
      final String a = repo.draftKeyFor(
        userId: 'user-1',
        templateId: 't1',
        assetNo: 'TM514',
      );
      final String b = repo.draftKeyFor(
        userId: 'user-1',
        templateId: 't1',
        assetNo: 'TM514',
      );
      expect(a, b);
    });

    test('differs for a different template on the same asset', () {
      final String a = repo.draftKeyFor(
        userId: 'user-1',
        templateId: 't1',
        assetNo: 'TM514',
      );
      final String b = repo.draftKeyFor(
        userId: 'user-1',
        templateId: 't2',
        assetNo: 'TM514',
      );
      expect(a, isNot(b));
    });
  });

  group('saveHeader / answers / notes', () {
    test('a saved header round-trips its answers and notes JSON', () async {
      final String key = repo.draftKeyFor(
        userId: 'user-1',
        templateId: 't1',
        assetNo: 'TM514',
      );
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: workspaceA,
        templateId: 't1',
        templateName: 'Workshop Daily Checklist',
        templateVersion: 2,
        assetNo: 'TM514',
        answers: <String, Object?>{'brakes': 'OK', 'km': 1500},
        notes: <String, Object?>{'brakes': 'Checked pads'},
        filled: 2,
        total: 12,
        site: 'NHC',
        printedName: 'A. Mechanic',
      );

      expect(await repo.answers(key), <String, Object?>{
        'brakes': 'OK',
        'km': 1500,
      });
      expect(await repo.notes(key), <String, Object?>{
        'brakes': 'Checked pads',
      });

      final ChecklistDraftHeader? header = await repo.header(key);
      expect(header, isNotNull);
      expect(header!.templateName, 'Workshop Daily Checklist');
      expect(header.templateVersion, 2);
      expect(header.filled, 2);
      expect(header.total, 12);
      expect(header.site, 'NHC');
      expect(header.printedName, 'A. Mechanic');
    });

    test('answers/notes for a draft that does not exist decode to an empty '
        'map rather than throwing', () async {
      expect(await repo.answers('never-existed'), isEmpty);
      expect(await repo.notes('never-existed'), isEmpty);
      expect(await repo.header('never-existed'), isNull);
    });

    test('saving the header twice for the same user+template+asset updates '
        'the same row rather than creating a second one', () async {
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: workspaceA,
        templateId: 't1',
        templateName: 'Workshop Daily Checklist',
        templateVersion: 1,
        assetNo: 'TM514',
        answers: const <String, Object?>{},
        notes: const <String, Object?>{},
        filled: 1,
        total: 12,
      );
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: workspaceA,
        templateId: 't1',
        templateName: 'Workshop Daily Checklist',
        templateVersion: 1,
        assetNo: 'TM514',
        answers: <String, Object?>{'brakes': 'OK'},
        notes: const <String, Object?>{},
        filled: 5,
        total: 12,
      );

      final List<ChecklistDraftHeader> drafts = await repo.draftsForUser(
        'user-1',
      );
      expect(drafts, hasLength(1));
      expect(drafts.single.filled, 5);
    });

    test('a draft for a different user is invisible to this one', () async {
      await repo.saveHeader(
        userId: 'user-2',
        workspaceId: workspaceA,
        templateId: 't1',
        templateName: 'Workshop Daily Checklist',
        templateVersion: 1,
        assetNo: 'TM514',
        answers: const <String, Object?>{},
        notes: const <String, Object?>{},
        filled: 0,
        total: 12,
      );
      expect(await repo.draftsForUser('user-1'), isEmpty);
    });
  });

  group('resumeCandidates', () {
    test('narrows to one machine once an asset is known', () async {
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: workspaceA,
        templateId: 't1',
        templateName: 'Workshop Daily Checklist',
        templateVersion: 1,
        assetNo: 'TM514',
        answers: const <String, Object?>{},
        notes: const <String, Object?>{},
        filled: 0,
        total: 12,
      );
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: workspaceA,
        templateId: 't1',
        templateName: 'Workshop Daily Checklist',
        templateVersion: 1,
        assetNo: 'TM520',
        answers: const <String, Object?>{},
        notes: const <String, Object?>{},
        filled: 0,
        total: 12,
      );

      final List<ChecklistDraftHeader> forAsset = await repo.resumeCandidates(
        userId: 'user-1',
        templateId: 't1',
        assetNo: 'TM514',
      );
      expect(forAsset, hasLength(1));
      expect(forAsset.single.assetNo, 'TM514');

      final List<ChecklistDraftHeader> everySheet = await repo.resumeCandidates(
        userId: 'user-1',
        templateId: 't1',
      );
      expect(everySheet, hasLength(2));
    });
  });

  group('photos - keyed per field', () {
    test(
      'a photo attached to one field does not appear under another',
      () async {
        final String key = repo.draftKeyFor(
          userId: 'user-1',
          templateId: 't1',
          assetNo: 'TM514',
        );
        await repo.addPhoto(
          draftKey: key,
          fieldKey: 'engine_bay',
          localPath: '/tmp/engine.jpg',
          capturedAt: DateTime.utc(2026, 8, 20, 9),
        );
        await repo.addPhoto(
          draftKey: key,
          fieldKey: 'brakes',
          localPath: '/tmp/brakes.jpg',
          capturedAt: DateTime.utc(2026, 8, 20, 9, 5),
        );

        final List<ChecklistDraftPhoto> photos = await repo.photosFor(key);
        expect(photos, hasLength(2));
        expect(
          photos.map((ChecklistDraftPhoto p) => p.fieldKey),
          containsAll(<String>['engine_bay', 'brakes']),
        );
        expect(
          photos
              .firstWhere((ChecklistDraftPhoto p) => p.fieldKey == 'engine_bay')
              .localPath,
          '/tmp/engine.jpg',
        );
      },
    );
  });

  group('signatures - multiple independent slots', () {
    test('signing two different fields on the same draft keeps both, '
        'independently', () async {
      final String key = repo.draftKeyFor(
        userId: 'user-1',
        templateId: 't1',
        assetNo: 'TM514',
      );
      await repo.saveSignature(
        draftKey: key,
        fieldKey: 'sign_mechanic',
        payload: '<svg><path d="M0 0"/></svg>',
        source: 'drawn',
        signerName: 'Mechanic One',
      );
      await repo.saveSignature(
        draftKey: key,
        fieldKey: 'sign_electrician',
        payload: '<svg><path d="M1 1"/></svg>',
        source: 'drawn',
        signerName: 'Electrician One',
      );

      final List<ChecklistDraftSignature> signatures = await repo.signaturesFor(
        key,
      );
      expect(signatures, hasLength(2));

      final ChecklistDraftSignature mechanic = signatures.firstWhere(
        (ChecklistDraftSignature s) => s.fieldKey == 'sign_mechanic',
      );
      final ChecklistDraftSignature electrician = signatures.firstWhere(
        (ChecklistDraftSignature s) => s.fieldKey == 'sign_electrician',
      );

      expect(mechanic.payload, contains('M0 0'));
      expect(electrician.payload, contains('M1 1'));
    });

    test('the template-level pad uses the reserved primary field key and '
        'does not collide with a real field of the same template', () async {
      final String key = repo.draftKeyFor(
        userId: 'user-1',
        templateId: 't1',
        assetNo: 'TM514',
      );
      await repo.saveSignature(
        draftKey: key,
        fieldKey: primaryField,
        payload: '<svg><path d="M9 9"/></svg>',
        source: 'drawn',
      );
      await repo.saveSignature(
        draftKey: key,
        fieldKey: 'sign_mechanic',
        payload: '<svg><path d="M2 2"/></svg>',
        source: 'drawn',
      );

      final List<ChecklistDraftSignature> signatures = await repo.signaturesFor(
        key,
      );
      expect(signatures, hasLength(2));
      expect(
        signatures.any(
          (ChecklistDraftSignature s) => s.fieldKey == primaryField,
        ),
        isTrue,
      );
    });

    test('re-saving the SAME field replaces its own value only, leaving a '
        'sibling field untouched', () async {
      final String key = repo.draftKeyFor(
        userId: 'user-1',
        templateId: 't1',
        assetNo: 'TM514',
      );
      await repo.saveSignature(
        draftKey: key,
        fieldKey: 'sign_mechanic',
        payload: '<svg><path d="M0 0"/></svg>',
        source: 'drawn',
      );
      await repo.saveSignature(
        draftKey: key,
        fieldKey: 'sign_electrician',
        payload: '<svg><path d="M5 5"/></svg>',
        source: 'drawn',
      );
      await repo.saveSignature(
        draftKey: key,
        fieldKey: 'sign_mechanic',
        payload: '<svg><path d="M7 7"/></svg>',
        source: 'drawn',
      );

      final List<ChecklistDraftSignature> signatures = await repo.signaturesFor(
        key,
      );
      expect(signatures, hasLength(2));
      expect(
        signatures
            .firstWhere(
              (ChecklistDraftSignature s) => s.fieldKey == 'sign_mechanic',
            )
            .payload,
        contains('M7 7'),
      );
      expect(
        signatures
            .firstWhere(
              (ChecklistDraftSignature s) => s.fieldKey == 'sign_electrician',
            )
            .payload,
        contains('M5 5'),
      );
    });
  });

  group('hasContent', () {
    test('a header with no filled fields, photos or signatures has no '
        'content', () async {
      final String key = repo.draftKeyFor(
        userId: 'user-1',
        templateId: 't1',
        assetNo: 'TM514',
      );
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: workspaceA,
        templateId: 't1',
        templateName: 'Workshop Daily Checklist',
        templateVersion: 1,
        assetNo: 'TM514',
        answers: const <String, Object?>{},
        notes: const <String, Object?>{},
        filled: 0,
        total: 12,
      );
      expect(await repo.hasContent(key), isFalse);
    });

    test('a header with at least one filled field has content', () async {
      final String key = repo.draftKeyFor(
        userId: 'user-1',
        templateId: 't1',
        assetNo: 'TM514',
      );
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: workspaceA,
        templateId: 't1',
        templateName: 'Workshop Daily Checklist',
        templateVersion: 1,
        assetNo: 'TM514',
        answers: <String, Object?>{'brakes': 'OK'},
        notes: const <String, Object?>{},
        filled: 1,
        total: 12,
      );
      expect(await repo.hasContent(key), isTrue);
    });

    test('a sheet with zero filled fields but a photo already attached is '
        'real work, not merely opened', () async {
      final String key = repo.draftKeyFor(
        userId: 'user-1',
        templateId: 't1',
        assetNo: 'TM514',
      );
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: workspaceA,
        templateId: 't1',
        templateName: 'Workshop Daily Checklist',
        templateVersion: 1,
        assetNo: 'TM514',
        answers: const <String, Object?>{},
        notes: const <String, Object?>{},
        filled: 0,
        total: 12,
      );
      await repo.addPhoto(
        draftKey: key,
        fieldKey: 'engine_bay',
        localPath: '/tmp/fault.jpg',
        capturedAt: DateTime.utc(2026, 8, 20),
      );
      expect(await repo.hasContent(key), isTrue);
    });

    test('a sheet with a signature already captured but nothing else is '
        'real work too', () async {
      final String key = repo.draftKeyFor(
        userId: 'user-1',
        templateId: 't1',
        assetNo: 'TM514',
      );
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: workspaceA,
        templateId: 't1',
        templateName: 'Workshop Daily Checklist',
        templateVersion: 1,
        assetNo: 'TM514',
        answers: const <String, Object?>{},
        notes: const <String, Object?>{},
        filled: 0,
        total: 12,
      );
      await repo.saveSignature(
        draftKey: key,
        fieldKey: primaryField,
        payload: testSignatureSvg,
        source: 'drawn',
      );
      expect(await repo.hasContent(key), isTrue);
    });
  });

  group('discardDraft', () {
    test('removes the header, answers, photos and every signature slot, and '
        'hands back the removed photo paths', () async {
      final String key = repo.draftKeyFor(
        userId: 'user-1',
        templateId: 't1',
        assetNo: 'TM514',
      );
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: workspaceA,
        templateId: 't1',
        templateName: 'Workshop Daily Checklist',
        templateVersion: 1,
        assetNo: 'TM514',
        answers: <String, Object?>{'brakes': 'OK'},
        notes: const <String, Object?>{},
        filled: 1,
        total: 12,
      );
      await repo.addPhoto(
        draftKey: key,
        fieldKey: 'engine_bay',
        localPath: '/tmp/to-delete.jpg',
        capturedAt: DateTime.utc(2026, 8, 20),
      );
      await repo.saveSignature(
        draftKey: key,
        fieldKey: 'sign_mechanic',
        payload: testSignatureSvg,
        source: 'drawn',
      );
      await repo.saveSignature(
        draftKey: key,
        fieldKey: primaryField,
        payload: testSignatureSvg,
        source: 'drawn',
      );

      final List<String> orphaned = await repo.discardDraft(key);
      expect(orphaned, contains('/tmp/to-delete.jpg'));

      expect(await repo.draftsForUser('user-1'), isEmpty);
      expect(await repo.header(key), isNull);
      expect(await repo.photosFor(key), isEmpty);
      expect(await repo.signaturesFor(key), isEmpty);
    });

    test('discarding a draft that never existed is a safe no-op', () async {
      final List<String> orphaned = await repo.discardDraft('never-existed');
      expect(orphaned, isEmpty);
    });
  });

  group('pruneToCap', () {
    test('trims this user\'s drafts to the checklist retention cap, oldest '
        'first, and returns the discarded photo paths', () async {
      const int cap = RetentionLimits.checklistDrafts;
      for (int i = 0; i < cap + 2; i++) {
        await repo.saveHeader(
          userId: 'user-1',
          workspaceId: workspaceA,
          templateId: 't1',
          templateName: 'Workshop Daily Checklist',
          templateVersion: 1,
          assetNo: 'TM${500 + i}',
          answers: const <String, Object?>{},
          notes: const <String, Object?>{},
          filled: 1,
          total: 12,
        );
      }

      final List<ChecklistDraftHeader> before = await repo.draftsForUser(
        'user-1',
      );
      expect(before, hasLength(cap + 2));

      await repo.pruneToCap('user-1');

      final List<ChecklistDraftHeader> after = await repo.draftsForUser(
        'user-1',
      );
      expect(after, hasLength(cap));
    });
  });
}
