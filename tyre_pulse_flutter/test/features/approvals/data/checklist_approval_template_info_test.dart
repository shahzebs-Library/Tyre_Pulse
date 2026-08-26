/// Coverage for [ChecklistApprovalTemplateInfo.fromRow] and
/// [ChecklistApprovalTemplateInfo.asTemplateLike] - the narrow
/// `checklist_templates` read this feature needs to resolve the ladder
/// engine's [ApprovalTemplateLike] and to render a submission's answers.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_template_info.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart'
    show ApprovalTemplateLike;
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';

void main() {
  group('ChecklistApprovalTemplateInfo.fromRow', () {
    test('decodes every column', () {
      final ChecklistApprovalTemplateInfo? info =
          ChecklistApprovalTemplateInfo.fromRow(<String, Object?>{
        'id': 'tpl-1',
        'require_area_manager': true,
        'require_signature': true,
        'fields': <Object?>[
          <String, Object?>{'id': 'q1', 'type': 'select', 'label': 'Tyres OK?'},
          <String, Object?>{'id': 'sec1', 'type': 'section', 'label': 'Body'},
        ],
      });

      expect(info, isNotNull);
      expect(info!.id, 'tpl-1');
      expect(info.requireAreaManager, isTrue);
      expect(info.requireSignature, isTrue);
      expect(info.fields, hasLength(2));
      expect(info.fields[0].id, 'q1');
      expect(info.fields[0].type, 'select');
      expect(info.fields[1].type, 'section');
    });

    test(
        'a missing require_area_manager decodes to null, not false - a '
        'single-stage template and an unreadable flag must remain '
        'distinguishable to isTwoStage even though both currently behave '
        'the same way', () {
      final ChecklistApprovalTemplateInfo? info =
          ChecklistApprovalTemplateInfo.fromRow(<String, Object?>{
        'id': 'tpl-2',
      });
      expect(info, isNotNull);
      expect(info!.requireAreaManager, isNull);
      expect(info.requireSignature, isFalse);
      expect(info.fields, isEmpty);
    });

    test(
        'a non-boolean require_area_manager decodes to null rather than '
        'guessing', () {
      final ChecklistApprovalTemplateInfo? info =
          ChecklistApprovalTemplateInfo.fromRow(<String, Object?>{
        'id': 'tpl-3',
        'require_area_manager': 'yes',
      });
      expect(info!.requireAreaManager, isNull);
    });

    test('a non-list fields column decodes to an empty list, not a throw', () {
      final ChecklistApprovalTemplateInfo? info =
          ChecklistApprovalTemplateInfo.fromRow(<String, Object?>{
        'id': 'tpl-4',
        'fields': 'not a list',
      });
      expect(info!.fields, isEmpty);
    });

    test('a non-map entry inside fields is skipped, not fatal to the rest', () {
      final ChecklistApprovalTemplateInfo? info =
          ChecklistApprovalTemplateInfo.fromRow(<String, Object?>{
        'id': 'tpl-5',
        'fields': <Object?>[
          'not a map',
          <String, Object?>{'id': 'q1', 'type': 'text'},
        ],
      });
      expect(info!.fields, hasLength(1));
      expect(info.fields.single.id, 'q1');
    });

    test('a missing id returns null - not actionable, not invented', () {
      expect(
        ChecklistApprovalTemplateInfo.fromRow(<String, Object?>{'x': 1}),
        isNull,
      );
    });

    test('an empty-string id returns null', () {
      expect(
        ChecklistApprovalTemplateInfo.fromRow(<String, Object?>{'id': ''}),
        isNull,
      );
    });

    test('a non-string id returns null', () {
      expect(
        ChecklistApprovalTemplateInfo.fromRow(<String, Object?>{'id': 7}),
        isNull,
      );
    });
  });

  group('asTemplateLike', () {
    test(
        'carries only requireAreaManager, matching what the ladder engine '
        'needs', () {
      const ChecklistApprovalTemplateInfo info = ChecklistApprovalTemplateInfo(
        id: 'tpl-1',
        requireAreaManager: true,
        requireSignature: true,
        fields: <ChecklistField>[],
      );
      final ApprovalTemplateLike like = info.asTemplateLike;
      expect(like.requireAreaManager, isTrue);
    });

    test(
        'a null requireAreaManager on the info produces a null on the '
        'template-like view too', () {
      const ChecklistApprovalTemplateInfo info = ChecklistApprovalTemplateInfo(
        id: 'tpl-2',
      );
      expect(info.asTemplateLike.requireAreaManager, isNull);
    });
  });
}
