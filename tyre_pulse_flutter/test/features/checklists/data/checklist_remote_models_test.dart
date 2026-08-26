/// Decode tolerance for `checklist_templates` and `checklist_assignments`
/// rows: a malformed `option_sets`, `assignee_roles` or `fields` value must
/// never throw - it degrades to an empty map/list, exactly like
/// [ChecklistField.fromJson]'s own documented tolerance.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_option_set.dart';

void main() {
  group('ChecklistTemplateRecord.fromRow', () {
    test('decodes a well-formed row', () {
      final ChecklistTemplateRecord record = ChecklistTemplateRecord.fromRow(
        <String, dynamic>{
          'id': 't1',
          'name': 'Workshop Daily Checklist',
          'description': 'Daily workshop sheet',
          'category': 'workshop',
          'icon': 'wrench',
          'status': 'published',
          'version': 2,
          'require_signature': true,
          'require_approval': true,
          'require_area_manager': true,
          'doc_prefix': 'WDC',
          'min_interval_days': 10,
          'scored': true,
          'pass_threshold': 80,
          'country': 'KSA',
          'assignee_roles': <String>['Mechanic', 'Electrician'],
          'fields': <Map<String, dynamic>>[
            <String, dynamic>{'id': 'f1', 'type': 'text', 'label': 'Notes'},
          ],
          'option_sets': <String, dynamic>{
            'legend': <String, dynamic>{
              'options': <String>['OK', 'Not OK'],
              'blocking': <String>['Not OK'],
              'require_note': <String>['Not OK'],
              'meta': <Map<String, dynamic>>[
                <String, dynamic>{
                  'value': 'Not OK',
                  'icon': 'fault',
                  'tone': 'bad',
                },
              ],
              'i18n': <String, dynamic>{
                'ar': <String>['جيد', 'غير جيد'],
              },
            },
          },
        },
      );

      expect(record.template.id, 't1');
      expect(record.template.name, 'Workshop Daily Checklist');
      expect(record.template.fields, hasLength(1));
      expect(record.template.fields.single.id, 'f1');
      expect(record.template.assigneeRoles, <String>[
        'Mechanic',
        'Electrician',
      ]);
      expect(record.version, 2);
      expect(record.requireSignature, isTrue);
      expect(record.requireApproval, isTrue);
      expect(record.requireAreaManager, isTrue);
      expect(record.minIntervalDays, 10);
      expect(record.scored, isTrue);
      expect(record.passThreshold, 80);
      expect(record.country, 'KSA');
      expect(record.freshApprovalStatus, 'pending');

      final ChecklistOptionSet legend = record.template.optionSets['legend']!;
      expect(legend.options, <String>['OK', 'Not OK']);
      expect(legend.blocking, <String>['Not OK']);
      expect(legend.requireNote, <String>['Not OK']);
      expect(legend.meta.single.icon, 'fault');
      expect(legend.i18n['ar'], <String>['جيد', 'غير جيد']);
    });

    test('require_approval false yields not_required as the fresh status', () {
      final ChecklistTemplateRecord record = ChecklistTemplateRecord.fromRow(
        <String, dynamic>{'id': 't1', 'require_approval': false},
      );
      expect(record.freshApprovalStatus, 'not_required');
    });

    test('require_approval absent also yields not_required', () {
      final ChecklistTemplateRecord record = ChecklistTemplateRecord.fromRow(
        <String, dynamic>{'id': 't1'},
      );
      expect(record.freshApprovalStatus, 'not_required');
    });

    test('a malformed option_sets (not a map) degrades to empty, never '
        'throws', () {
      expect(
        () => ChecklistTemplateRecord.fromRow(<String, dynamic>{
          'id': 't1',
          'option_sets': 'garbage',
        }),
        returnsNormally,
      );
      final ChecklistTemplateRecord record = ChecklistTemplateRecord.fromRow(
        <String, dynamic>{'id': 't1', 'option_sets': 'garbage'},
      );
      expect(record.template.optionSets, isEmpty);
    });

    test('an option_sets entry whose value is not a map is skipped, not '
        'thrown', () {
      final ChecklistTemplateRecord record = ChecklistTemplateRecord.fromRow(
        <String, dynamic>{
          'id': 't1',
          'option_sets': <String, dynamic>{
            'legend': 'garbage',
            'ok_one': <String, dynamic>{
              'options': <String>['A'],
            },
          },
        },
      );
      expect(record.template.optionSets.containsKey('legend'), isFalse);
      expect(record.template.optionSets['ok_one']!.options, <String>['A']);
    });

    test('a malformed assignee_roles (a string, not a list) degrades to '
        'null - "every role"', () {
      final ChecklistTemplateRecord record = ChecklistTemplateRecord.fromRow(
        <String, dynamic>{'id': 't1', 'assignee_roles': 'Mechanic'},
      );
      expect(record.template.assigneeRoles, isNull);
    });

    test('a malformed fields value (not a list) degrades to an empty list', () {
      final ChecklistTemplateRecord record = ChecklistTemplateRecord.fromRow(
        <String, dynamic>{'id': 't1', 'fields': 'garbage'},
      );
      expect(record.template.fields, isEmpty);
    });

    test('a non-map entry inside fields is skipped rather than thrown', () {
      final ChecklistTemplateRecord record = ChecklistTemplateRecord.fromRow(
        <String, dynamic>{
          'id': 't1',
          'fields': <dynamic>[
            'not a map',
            <String, dynamic>{'id': 'f1', 'type': 'text'},
          ],
        },
      );
      expect(record.template.fields, hasLength(1));
      expect(record.template.fields.single.id, 'f1');
    });

    test('a missing version falls back to 1', () {
      final ChecklistTemplateRecord record = ChecklistTemplateRecord.fromRow(
        <String, dynamic>{'id': 't1'},
      );
      expect(record.version, 1);
    });
  });

  group('ChecklistAssignmentRecord.fromRow', () {
    test('decodes a well-formed row', () {
      final ChecklistAssignmentRecord? record =
          ChecklistAssignmentRecord.fromRow(<String, dynamic>{
            'id': 'a1',
            'template_id': 't1',
            'template_name': 'Workshop Daily Checklist',
            'site': 'NHC',
            'asset_no': 'TM514',
            'assignee_role': 'Mechanic',
            'due_date': '2026-08-26',
            'status': 'pending',
            'submission_id': null,
          });
      expect(record, isNotNull);
      expect(record!.id, 'a1');
      expect(record.templateId, 't1');
      expect(record.assetNo, 'TM514');
      expect(record.isOpen, isTrue);
    });

    test('a row with no usable id decodes to null rather than a garbage '
        'record', () {
      expect(
        ChecklistAssignmentRecord.fromRow(<String, dynamic>{
          'template_id': 't1',
        }),
        isNull,
      );
    });

    test('completed and skipped are not open', () {
      final ChecklistAssignmentRecord completed =
          ChecklistAssignmentRecord.fromRow(<String, dynamic>{
            'id': 'a1',
            'status': 'completed',
          })!;
      final ChecklistAssignmentRecord skipped =
          ChecklistAssignmentRecord.fromRow(<String, dynamic>{
            'id': 'a2',
            'status': 'skipped',
          })!;
      expect(completed.isOpen, isFalse);
      expect(skipped.isOpen, isFalse);
    });

    test('overdue and a null status are both open', () {
      final ChecklistAssignmentRecord overdue =
          ChecklistAssignmentRecord.fromRow(<String, dynamic>{
            'id': 'a1',
            'status': 'overdue',
          })!;
      final ChecklistAssignmentRecord noStatus =
          ChecklistAssignmentRecord.fromRow(<String, dynamic>{'id': 'a2'})!;
      expect(overdue.isOpen, isTrue);
      expect(noStatus.isOpen, isTrue);
    });
  });
}
