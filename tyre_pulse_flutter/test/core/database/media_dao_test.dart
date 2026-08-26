import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';

import 'database_test_support.dart';

void main() {
  late AppDatabase db;

  setUp(() {
    db = newMemoryDatabase();
  });

  tearDown(() async {
    await db.close();
  });

  /// Attaches a photo to a part-filled checklist, in the DRAFT media folder.
  Future<void> seedDraftPhoto(String fileName) async {
    await db.draftsDao.saveChecklistDraft(
      userId: testUser,
      workspaceId: workspaceA,
      templateId: 'tpl-1',
      templateName: 'Workshop Daily Checklist',
      templateVersion: 2,
      assetNo: 'TM514',
      answersJson: '{}',
      notesJson: '{}',
      filled: 0,
      total: 49,
      now: testNow,
    );
    await db.mediaDao.addDraftPhoto(
      ownerKind: OwnerKind.checklistDraft,
      ownerKey: '$testUser|tpl-1|TM514',
      localPath: '/data/user/0/app/files/draft-media/$fileName',
      fileName: fileName,
      capturedAt: testNow,
    );
  }

  group('the orphan sweep', () {
    // This group is the whole reason the two media tables are separate. The
    // recorded incident: the queue sweep deletes every file the QUEUE does not
    // reference, a draft is not a queue entry, and a previous attempt at draft
    // photos therefore had its evidence deleted by the next sync.
    test('KEEPS a photo referenced only by a draft', () async {
      await seedDraftPhoto('d_1.jpg');

      final List<String> orphans = await db.mediaDao.orphanFileNames(<String>[
        'd_1.jpg',
      ]);

      expect(
        orphans,
        isEmpty,
        reason:
            'a draft is not a queue entry, so a sweep that only consults '
            'the queue deletes the operator part-filled sheet photographs',
      );
    });

    test('KEEPS a photo referenced only by an unconfirmed queue row', () async {
      await seedCommand(
        db,
        id: 'cmd-1',
        attachments: <QueuedMediaAttachment>[queuedPhoto('q_1.jpg')],
      );

      final List<String> orphans = await db.mediaDao.orphanFileNames(<String>[
        'q_1.jpg',
      ]);

      expect(
        orphans,
        isEmpty,
        reason:
            'a sweep that only consults drafts deletes evidence an '
            'inspection is still waiting to upload',
      );
    });

    test('consults BOTH sources in one pass', () async {
      // If either half of the check were dropped, exactly one of these two
      // files would be reported as an orphan and deleted.
      await seedDraftPhoto('d_1.jpg');
      await seedCommand(
        db,
        id: 'cmd-1',
        attachments: <QueuedMediaAttachment>[queuedPhoto('q_1.jpg')],
      );

      final Set<String> referenced = await db.mediaDao.referencedFileNames(
        <String>['d_1.jpg', 'q_1.jpg', 'stray.jpg'],
      );

      expect(referenced, containsAll(<String>['d_1.jpg', 'q_1.jpg']));
      expect(referenced, isNot(contains('stray.jpg')));
    });

    test('deletes a file nothing references at all', () async {
      await seedDraftPhoto('d_1.jpg');

      final List<String> orphans = await db.mediaDao.orphanFileNames(<String>[
        'd_1.jpg',
        'left_behind.jpg',
      ]);

      expect(orphans, <String>['left_behind.jpg']);
    });

    test('a confirmed queue photo becomes deletable', () async {
      await seedCommand(
        db,
        id: 'cmd-1',
        attachments: <QueuedMediaAttachment>[queuedPhoto('q_1.jpg')],
      );
      final media = await db.mediaDao.mediaForCommand('cmd-1');
      await db.mediaDao.markUploaded(
        media.single.id,
        bucket: 'tyre-photos',
        remotePath: 'org-a/q_1.jpg',
        remoteRef: 'tp-storage://tyre-photos/org-a/q_1.jpg',
        at: testNow,
      );

      expect(
        await db.mediaDao.orphanFileNames(<String>['q_1.jpg']),
        isEmpty,
        reason:
            'uploaded is not far enough: an object in a bucket that no '
            'database row references is unreachable',
      );

      await db.mediaDao.markCommandMediaVerified('cmd-1');

      expect(await db.mediaDao.orphanFileNames(<String>['q_1.jpg']), <String>[
        'q_1.jpg',
      ]);
    });

    test('sweeping nothing asks the database nothing', () async {
      expect(await db.mediaDao.orphanFileNames(const <String>[]), isEmpty);
      expect(await db.mediaDao.referencedFileNames(const <String>[]), isEmpty);
    });

    test('handles more candidates than SQLite will bind at once', () async {
      await seedDraftPhoto('d_1.jpg');
      final List<String> candidates = <String>[
        for (int i = 0; i < 950; i++) 'noise_$i.jpg',
        'd_1.jpg',
      ];

      final List<String> orphans = await db.mediaDao.orphanFileNames(
        candidates,
      );

      expect(orphans, hasLength(950));
      expect(orphans, isNot(contains('d_1.jpg')));
    });
  });

  group('upload lifecycle', () {
    test('claims are bounded so a fan-out cannot crash the handset', () async {
      await seedCommand(
        db,
        id: 'cmd-1',
        attachments: <QueuedMediaAttachment>[
          for (int i = 0; i < 13; i++) queuedPhoto('q_$i.jpg', orderIndex: i),
        ],
      );

      final claimed = await db.mediaDao.claimNextUploads();

      expect(
        claimed,
        hasLength(uploadConcurrency),
        reason:
            'thirteen simultaneous full-size decodes is a hard native '
            'out-of-memory crash on a 2 GB handset',
      );
      expect(claimed.first.state, MediaUploadState.uploading);
    });

    test(
      'a photo that keeps failing is reported, not retried forever',
      () async {
        await seedCommand(
          db,
          id: 'cmd-1',
          attachments: <QueuedMediaAttachment>[queuedPhoto('q_1.jpg')],
        );
        final String id = (await db.mediaDao.mediaForCommand('cmd-1'))
            .single
            .id;

        late PendingMediaUpload latest;
        for (int attempt = 0; attempt < maxUploadAttempts; attempt++) {
          latest = await db.mediaDao.markUploadAttemptFailed(
            id,
            messageSafe: 'The photo could not be uploaded.',
          );
        }

        expect(latest.attempts, maxUploadAttempts);
        expect(latest.state, MediaUploadState.failed);
        expect(await db.mediaDao.claimNextUploads(), isEmpty);
      },
    );

    test('a command is not ready while any photo is unconfirmed', () async {
      await seedCommand(
        db,
        id: 'cmd-1',
        attachments: <QueuedMediaAttachment>[
          queuedPhoto('q_1.jpg'),
          queuedPhoto('q_2.jpg', orderIndex: 1),
        ],
      );
      final media = await db.mediaDao.mediaForCommand('cmd-1');

      expect(await db.mediaDao.commandMediaReady('cmd-1'), isFalse);

      await db.mediaDao.markUploaded(
        media.first.id,
        bucket: 'tyre-photos',
        remotePath: 'a/1.jpg',
        remoteRef: 'tp-storage://tyre-photos/a/1.jpg',
        at: testNow,
      );
      expect(await db.mediaDao.commandMediaReady('cmd-1'), isFalse);

      await db.mediaDao.markUploaded(
        media.last.id,
        bucket: 'tyre-photos',
        remotePath: 'a/2.jpg',
        remoteRef: 'tp-storage://tyre-photos/a/2.jpg',
        at: testNow,
      );
      expect(
        await db.mediaDao.commandMediaReady('cmd-1'),
        isTrue,
        reason: 'the business row must not be written without its evidence',
      );
    });

    test('healing repoints a row when iOS moves the container', () async {
      await seedDraftPhoto('d_1.jpg');

      await db.mediaDao.healDraftPhotoPath(
        fileName: 'd_1.jpg',
        localPath: '/var/mobile/Containers/NEW/Documents/draft-media/d_1.jpg',
      );

      final photos = await db.mediaDao.draftPhotosFor(
        ownerKind: OwnerKind.checklistDraft,
        ownerKey: '$testUser|tpl-1|TM514',
      );
      expect(
        photos.single.localPath,
        '/var/mobile/Containers/NEW/Documents/draft-media/d_1.jpg',
      );
      expect(
        photos.single.fileName,
        'd_1.jpg',
        reason: 'the basename is the stable handle; the absolute path is not',
      );
    });
  });

  group('signatures', () {
    test('accepts an SVG mark and records where it came from', () async {
      final signature = await db.mediaDao.saveSignature(
        ownerKind: OwnerKind.inspectionDraft,
        ownerKey: 'draft-1',
        fieldKey: primaryField,
        payload: testSignatureSvg,
        source: SignatureSource.drawn,
        signedAt: testNow,
        signerName: 'V. Kumar',
        signerRole: 'PMV Manager',
      );

      expect(signature.format, SignatureFormat.svg);
      expect(signature.source, SignatureSource.drawn);
      expect(signature.signerName, 'V. Kumar');
    });

    test('accepts a data URL from the canvas pad', () async {
      final signature = await db.mediaDao.saveSignature(
        ownerKind: OwnerKind.inspectionDraft,
        ownerKey: 'draft-1',
        fieldKey: 'sig-mechanic',
        payload: 'data:image/png;base64,iVBORw0KGgo=',
        source: SignatureSource.saved,
        signedAt: testNow,
      );

      expect(signature.format, SignatureFormat.dataUrl);
    });

    test('refuses a placeholder string where a signature belongs', () async {
      await expectLater(
        db.mediaDao.saveSignature(
          ownerKind: OwnerKind.inspectionDraft,
          ownerKey: 'draft-1',
          fieldKey: primaryField,
          // The recorded defect: one implementation stored a placeholder
          // instead of an actual signature.
          payload: 'signed',
          source: SignatureSource.drawn,
          signedAt: testNow,
        ),
        throwsA(isA<ArgumentError>()),
      );

      expect(
        await db.mediaDao.hasAnySignature(
          ownerKind: OwnerKind.inspectionDraft,
          ownerKey: 'draft-1',
        ),
        isFalse,
      );
    });

    test('refuses a mark the server column would throw away', () async {
      final String tooLong = '<svg>${'a' * signatureMaxLength}</svg>';

      await expectLater(
        db.mediaDao.saveSignature(
          ownerKind: OwnerKind.inspectionDraft,
          ownerKey: 'draft-1',
          fieldKey: primaryField,
          payload: tooLong,
          source: SignatureSource.drawn,
          signedAt: testNow,
        ),
        throwsA(isA<ArgumentError>()),
      );
    });

    test(
      'one mark per FIELD, so three trades do not overwrite each other',
      () async {
        await db.mediaDao.saveSignature(
          ownerKind: OwnerKind.checklistDraft,
          ownerKey: 'draft-1',
          fieldKey: 'sig-mechanic',
          payload: testSignatureSvg,
          source: SignatureSource.drawn,
          signedAt: testNow,
        );
        await db.mediaDao.saveSignature(
          ownerKind: OwnerKind.checklistDraft,
          ownerKey: 'draft-1',
          fieldKey: 'sig-electrician',
          payload: testSignatureSvg,
          source: SignatureSource.drawn,
          signedAt: testNow,
        );
        await db.mediaDao.saveSignature(
          ownerKind: OwnerKind.checklistDraft,
          ownerKey: 'draft-1',
          fieldKey: primaryField,
          payload: testSignatureSvg,
          source: SignatureSource.drawn,
          signedAt: testNow,
        );

        final signatures = await db.mediaDao.signaturesFor(
          ownerKind: OwnerKind.checklistDraft,
          ownerKey: 'draft-1',
        );
        expect(
          signatures,
          hasLength(3),
          reason:
              'a shared slot let only the last signature reach the database '
              'while every tile read signed',
        );
        expect(
          signatures.map((CapturedSignature s) => s.fieldKey),
          unorderedEquals(<String>[
            'sig-mechanic',
            'sig-electrician',
            primaryField,
          ]),
        );
      },
    );

    test('re-signing one field replaces that field and nothing else', () async {
      await db.mediaDao.saveSignature(
        ownerKind: OwnerKind.checklistDraft,
        ownerKey: 'draft-1',
        fieldKey: 'sig-mechanic',
        payload: testSignatureSvg,
        source: SignatureSource.saved,
        signedAt: testNow,
      );
      await db.mediaDao.saveSignature(
        ownerKind: OwnerKind.checklistDraft,
        ownerKey: 'draft-1',
        fieldKey: 'sig-electrician',
        payload: testSignatureSvg,
        source: SignatureSource.drawn,
        signedAt: testNow,
      );

      await db.mediaDao.saveSignature(
        ownerKind: OwnerKind.checklistDraft,
        ownerKey: 'draft-1',
        fieldKey: 'sig-mechanic',
        payload: '<svg id="redrawn"><path d="M1 1"/></svg>',
        source: SignatureSource.drawn,
        signedAt: testNow.add(const Duration(minutes: 1)),
      );

      final signatures = await db.mediaDao.signaturesFor(
        ownerKind: OwnerKind.checklistDraft,
        ownerKey: 'draft-1',
      );
      expect(signatures, hasLength(2));

      final CapturedSignature mechanic = signatures.firstWhere(
        (CapturedSignature s) => s.fieldKey == 'sig-mechanic',
      );
      expect(mechanic.payload, contains('redrawn'));
      expect(
        mechanic.source,
        SignatureSource.drawn,
        reason:
            'a mark drawn now always beats the saved one, and the screen '
            'must be able to say which',
      );
    });

    test('the template requirement is satisfied by any signed field', () async {
      expect(
        await db.mediaDao.hasAnySignature(
          ownerKind: OwnerKind.checklistDraft,
          ownerKey: 'draft-1',
        ),
        isFalse,
      );

      await db.mediaDao.saveSignature(
        ownerKind: OwnerKind.checklistDraft,
        ownerKey: 'draft-1',
        fieldKey: 'sig-mechanic',
        payload: testSignatureSvg,
        source: SignatureSource.drawn,
        signedAt: testNow,
      );

      expect(
        await db.mediaDao.hasAnySignature(
          ownerKind: OwnerKind.checklistDraft,
          ownerKey: 'draft-1',
        ),
        isTrue,
        reason:
            'a template with require_signature and no signature FIELD was '
            'unsubmittable, and the work was lost on back-out',
      );
    });
  });
}
