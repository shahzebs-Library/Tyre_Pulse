import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_submission_detail.dart';

Map<String, dynamic> _row({Object? snapshot}) => <String, dynamic>{
      'id': 'sub-1',
      'template_id': 'tpl-live',
      'template_name': 'Workshop Daily Checklist',
      'template_snapshot': snapshot,
      'site': 'NHC',
      'asset_no': 'TM514',
      'answers': <String, dynamic>{'brakes': 'OK', 'tyres': 'Not OK'},
      'photos': <String, dynamic>{
        'tyres': <dynamic>['a.jpg', '', 42],
        'brakes': 'not-a-list',
      },
      'notes': <String, dynamic>{'tyres': 'Cut on sidewall'},
      'signatures': <String, dynamic>{'sig1': '<svg></svg>', 'blank': '  '},
      'signature_data': 'data:image/png;base64,AAAA',
      'submitted_at': '2026-10-05T08:12:00Z',
      'score_pct': 87.6,
      'score_passed': true,
      'approval_status': 'approved',
      'document_no': 'WDC-TM514-2026-0007',
      'approver_name': 'Vinay',
      'review_note': '  ',
      'locked': true,
    };

void main() {
  group('ChecklistSubmissionDetail.fromRow', () {
    test('decodes every column the details screen shows', () {
      final ChecklistSubmissionDetail d =
          ChecklistSubmissionDetail.fromRow(_row())!;
      expect(d.id, 'sub-1');
      expect(d.documentNo, 'WDC-TM514-2026-0007');
      expect(d.answers['tyres'], 'Not OK');
      expect(d.notes['tyres'], 'Cut on sidewall');
      expect(d.scorePct, 87);
      expect(d.scorePassed, isTrue);
      expect(d.locked, isTrue);
      // A blank review note is "no note", never an empty card.
      expect(d.reviewNote, isNull);
    });

    test('keeps only real photo paths and non-blank signatures', () {
      final ChecklistSubmissionDetail d =
          ChecklistSubmissionDetail.fromRow(_row())!;
      expect(d.photos['tyres'], <String>['a.jpg']);
      expect(d.photos.containsKey('brakes'), isFalse);
      expect(d.signatures.keys, <String>['sig1']);
    });

    test('a row with no id is rejected rather than half-decoded', () {
      expect(ChecklistSubmissionDetail.fromRow(<String, dynamic>{}), isNull);
      expect(
        ChecklistSubmissionDetail.fromRow(<String, dynamic>{'id': '  '}),
        isNull,
      );
    });
  });

  group('snapshotTemplate', () {
    test('decodes the template the sheet was filled against', () {
      final ChecklistSubmissionDetail d = ChecklistSubmissionDetail.fromRow(
        _row(
          snapshot: <String, dynamic>{
            'template_id': 'tpl-snap',
            'name': 'Workshop Daily Checklist v2',
            'require_area_manager': true,
            'fields': <dynamic>[
              <String, dynamic>{'id': 'brakes', 'type': 'select'},
            ],
          },
        ),
      )!;
      final ChecklistTemplateRecord? t = d.snapshotTemplate;
      expect(t, isNotNull);
      expect(t!.template.id, 'tpl-snap');
      expect(t.template.name, 'Workshop Daily Checklist v2');
      expect(t.template.fields.single.id, 'brakes');
      expect(t.requireAreaManager, isTrue);
    });

    test('no snapshot, or one with no fields, falls back to null', () {
      expect(
        ChecklistSubmissionDetail.fromRow(_row())!.snapshotTemplate,
        isNull,
      );
      expect(
        ChecklistSubmissionDetail.fromRow(
          _row(snapshot: <String, dynamic>{'name': 'x'}),
        )!
            .snapshotTemplate,
        isNull,
      );
    });
  });

  group('signatureForField', () {
    test('a field signature wins; the primary is used only when none exist',
        () {
      final ChecklistSubmissionDetail withField =
          ChecklistSubmissionDetail.fromRow(_row())!;
      expect(withField.signatureForField('sig1'), '<svg></svg>');
      expect(withField.signatureForField('other'), isNull);

      final ChecklistSubmissionDetail primaryOnly =
          ChecklistSubmissionDetail.fromRow(
        <String, dynamic>{..._row(), 'signatures': null},
      )!;
      expect(
        primaryOnly.signatureForField('anything'),
        'data:image/png;base64,AAAA',
      );
    });
  });

  group('isServerPhotoReference', () {
    test('storage refs and URLs are server photos; paths are local', () {
      expect(
        isServerPhotoReference('tp-storage://tyre-photos/a/b.jpg'),
        isTrue,
      );
      expect(
        isServerPhotoReference(
          'https://x.supabase.co/storage/v1/object/public/tyre-photos/a.jpg',
        ),
        isTrue,
      );
      expect(isServerPhotoReference('/data/user/0/app/files/p.jpg'), isFalse);
      expect(isServerPhotoReference(''), isFalse);
    });
  });

  group('fallbackFieldKeys', () {
    test('includes evidence-only fields, not just answered ones', () {
      final ChecklistSubmissionDetail d = ChecklistSubmissionDetail.fromRow(
        <String, dynamic>{
          'id': 's',
          'answers': <String, dynamic>{'b': 'OK'},
          'photos': <String, dynamic>{
            'c': <dynamic>['tp-storage://tyre-photos/c.jpg'],
            'empty': <dynamic>[],
          },
          'signatures': <String, dynamic>{'a': '<svg></svg>'},
        },
      )!;
      expect(fallbackFieldKeys(d), <String>['a', 'b', 'c']);
    });
  });
}
