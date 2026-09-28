import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_review_outcome.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';

const ChecklistField _hasTrailer = ChecklistField(
  id: 'has_trailer',
  type: 'boolean',
  label: 'Trailer attached',
);

const ChecklistField _trailerTyres = ChecklistField(
  id: 'trailer_tyres',
  type: 'select',
  label: 'Trailer tyres',
  required: true,
  options: <String>['Pass', 'Fail', 'NOK'],
  passValues: <Object?>['Pass'],
  visibleWhen: <ChecklistVisibleCondition>[
    ChecklistVisibleCondition(field: 'has_trailer', op: '=', value: true),
  ],
);

const ChecklistField _operator = ChecklistField(
  id: 'operator',
  type: 'text',
  label: 'Operator',
  required: true,
);

void main() {
  group('buildChecklistReviewOutcome - hidden fields', () {
    test('a required field hidden by visibleWhen is not counted', () {
      final ChecklistReviewOutcome o = buildChecklistReviewOutcome(
        fields: const <ChecklistField>[_hasTrailer, _trailerTyres, _operator],
        answers: const <String, Object?>{
          'has_trailer': true,
          'operator': 'Ali',
        },
      );
      // Visible: trailer tyres required and unanswered.
      expect(o.requiredTotal, 2);
      expect(o.requiredAnswered, 1);

      final ChecklistReviewOutcome hidden = buildChecklistReviewOutcome(
        fields: const <ChecklistField>[_hasTrailer, _trailerTyres, _operator],
        answers: const <String, Object?>{
          'has_trailer': 'no-trailer',
          'operator': 'Ali',
        },
      );
      expect(hidden.requiredTotal, 1);
      expect(hidden.requiredAnswered, 1);
      final Iterable<ReviewItem> items =
          hidden.sections.expand((ReviewSection s) => s.items);
      expect(
        items.where((ReviewItem i) => i.verdict == ReviewVerdict.unanswered),
        isEmpty,
      );
      expect(items.any((ReviewItem i) => i.field.id == 'trailer_tyres'), false);
    });

    test('a leftover non-blocking answer on a hidden field is not scored', () {
      final ChecklistReviewOutcome o = buildChecklistReviewOutcome(
        fields: const <ChecklistField>[_hasTrailer, _trailerTyres],
        answers: const <String, Object?>{
          'has_trailer': 'no-trailer',
          'trailer_tyres': 'Fail',
        },
      );
      expect(o.fails, 0);
      expect(
        o.findings.any((ReviewItem i) => i.field.id == 'trailer_tyres'),
        isFalse,
      );
    });

    test('a legend blocking mark on a hidden field is still a finding', () {
      final ChecklistReviewOutcome o = buildChecklistReviewOutcome(
        fields: const <ChecklistField>[_hasTrailer, _trailerTyres],
        answers: const <String, Object?>{
          'has_trailer': false,
          'trailer_tyres': 'NOK',
        },
        legendBlocking: const <String>['NOK'],
      );
      expect(
        o.findings.map((ReviewItem i) => i.field.id),
        contains('trailer_tyres'),
      );
      expect(o.requiredTotal, 0);
    });
  });

  group('classifyReviewAnswer', () {
    test('boolean false is a fault, true is a pass', () {
      expect(
        classifyReviewAnswer(_hasTrailer, false),
        ReviewVerdict.fail,
      );
      expect(classifyReviewAnswer(_hasTrailer, true), ReviewVerdict.pass);
      expect(classifyReviewAnswer(_hasTrailer, null), ReviewVerdict.unanswered);
    });

    test('with passValues, an explicit N/A mark reads N/A, not fail', () {
      const ChecklistField f = ChecklistField(
        id: 'lights',
        type: 'select',
        passValues: <Object?>['OK'],
      );
      expect(classifyReviewAnswer(f, 'OK'), ReviewVerdict.pass);
      expect(classifyReviewAnswer(f, 'N/A'), ReviewVerdict.notApplicable);
      expect(classifyReviewAnswer(f, 'Broken'), ReviewVerdict.fail);
    });

    test('a pass value wins over an N/A word in the same answer', () {
      const ChecklistField f = ChecklistField(
        id: 'lights',
        type: 'multiselect',
        passValues: <Object?>['OK'],
      );
      expect(
        classifyReviewAnswer(f, <Object?>['OK', 'N/A']),
        ReviewVerdict.pass,
      );
    });

    test('a legend blocking mark fails even a non-check field', () {
      expect(
        classifyReviewAnswer(
          _operator,
          'NOK',
          legendBlocking: const <String>['NOK'],
        ),
        ReviewVerdict.fail,
      );
      expect(classifyReviewAnswer(_operator, 'Ali'), ReviewVerdict.notACheck);
    });
  });
}
