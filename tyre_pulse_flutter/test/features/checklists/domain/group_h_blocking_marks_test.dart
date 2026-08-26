/// Parity group H - blocking marks. Cases H1-H7.
///
/// `docs/flutter-migration/08-checklist-engine-parity-tests.md` section 10
/// group H. H1-H4 mirror `src/test/checklistMarks.test.js:44-101`'s
/// `markMeta`/`blockingMarks`/`blockingAnswers`/`canClose` tests, against
/// the SAME `LEGEND`/`TEMPLATE` fixture that file declares at its own
/// lines 12-42 (reproduced here rather than imported, matching how
/// `checklist_marks.dart`'s own note explains this file has no live
/// `option_sets` shape to decode from). H5 and H7 have no existing JS test
/// - the artifact derives them by reading `checklistMarks.ts:171-176` (the
/// `break` after the first matching array member) and `:111` (the icon
/// fallback) directly, so their expectations here are checked against that
/// source rather than an existing assertion. H6 mirrors the JS test's own
/// "an answer recorded before the meta existed still renders"
/// (`checklistMarks.test.js:54-61`).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_marks.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_option_set.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';

// The legend exactly as V595 wrote it to the live database, and the two
// fields checklistMarks.test.js exercises it through - reproduced verbatim
// from that file's own `LEGEND`/`TEMPLATE` fixture (lines 12-42) so this
// port is checked against the identical ground truth.
const ChecklistOptionSet _legend = ChecklistOptionSet(
  options: <String>[
    'OK',
    'Not OK',
    'Not applicable',
    'Changed',
    'Repaired',
    'Added / Top-Up',
    'Adjusted',
    'Lubricated',
  ],
  meta: <ChecklistOptionMeta>[
    ChecklistOptionMeta(
      value: 'OK',
      icon: 'ok',
      tone: 'good',
      meaning: 'Checked and correct. Nothing needed.',
    ),
    ChecklistOptionMeta(
      value: 'Not OK',
      icon: 'fault',
      tone: 'bad',
      meaning: 'A fault is present and has NOT been put right. Say what is wrong.',
    ),
    ChecklistOptionMeta(
      value: 'Not applicable',
      icon: 'na',
      tone: 'muted',
      meaning: 'This machine does not have this item.',
    ),
    ChecklistOptionMeta(
      value: 'Repaired',
      icon: 'repair',
      tone: 'fixed',
      meaning: 'The fault was found and repaired.',
    ),
    ChecklistOptionMeta(
      value: 'Adjusted',
      icon: 'adjust',
      tone: 'fixed',
      meaning: 'Set back within limits without replacing anything.',
    ),
    ChecklistOptionMeta(
      value: 'Lubricated',
      icon: 'lubricant',
      tone: 'fixed',
      meaning: 'Greased or oiled as part of the check.',
    ),
  ],
  blocking: <String>['Not OK'],
  requireNote: <String>['Not OK'],
);

final ChecklistTemplate _template = const ChecklistTemplate(
  optionSets: <String, ChecklistOptionSet>{'legend': _legend},
  fields: <ChecklistField>[
    ChecklistField(
      id: 'c1',
      type: 'select',
      label: 'Glasses and mirrors',
      optionsRef: 'legend',
      requireNoteWhen: <String>['Not OK'],
    ),
    ChecklistField(
      id: 'c2',
      type: 'select',
      label: 'Tyres and wheel bolts',
      optionsRef: 'legend',
      requireNoteWhen: <String>['Not OK'],
    ),
  ],
);

void main() {
  test('H1: blockingAnswers NAMES the lines', () {
    final List<BlockingAnswer> b = blockingAnswers(
      _template,
      <String, Object?>{'c1': 'Not OK', 'c2': 'OK'},
    );
    expect(b, hasLength(1));
    expect(b.single.id, 'c1');
    expect(b.single.label, 'Glasses and mirrors');
    expect(b.single.value, 'Not OK');
    expect(canClose(_template, <String, Object?>{'c1': 'Not OK'}).ok, isFalse);
  });

  test('H2: a corrected item stops blocking', () {
    expect(
      canClose(_template, <String, Object?>{'c1': 'Repaired', 'c2': 'Adjusted'}).ok,
      isTrue,
    );
    expect(canClose(_template, <String, Object?>{'c1': 'Lubricated'}).ok, isTrue);
  });

  test('H3: an unanswered sheet does not block', () {
    expect(canClose(_template, const <String, Object?>{}).ok, isTrue);
    expect(blockingAnswers(_template, const <String, Object?>{}), isEmpty);
  });

  test('H4: a legend with no blocking list blocks nothing', () {
    const ChecklistOptionSet bare = ChecklistOptionSet(options: <String>['a']);
    expect(blockingMarks(bare), isEmpty);
    expect(blockingMarks(_legend), <String>['Not OK']);

    final ChecklistTemplate untargeted = const ChecklistTemplate(
      fields: <ChecklistField>[
        ChecklistField(id: 'x', type: 'select', options: <String>['a', 'b']),
      ],
    );
    expect(canClose(untargeted, <String, Object?>{'x': 'a'}).ok, isTrue);
  });

  test('H5: an array answer blocks on ANY member, reported once', () {
    final List<BlockingAnswer> b = blockingAnswers(
      _template,
      <String, Object?>{
        'c1': <String>['OK', 'Not OK'],
      },
    );
    expect(b, hasLength(1));
    expect(b.single.id, 'c1');
    expect(b.single.value, 'Not OK');
    expect(
      canClose(_template, <String, Object?>{
        'c1': <String>['OK', 'Not OK'],
      }).ok,
      isFalse,
    );
  });

  test('H6: markMeta never returns null', () {
    // The six original marks were stored for months with no meta at all. A
    // row carrying an unknown value must degrade, never crash the line it
    // sits on.
    final MarkInfo r = markMeta(const ChecklistOptionSet(options: <String>['OK']), 'OK');
    expect(r.value, 'OK');
    expect(r.icon, 'na');
    expect(r.tone, MarkTone.muted);
    expect(r.meaning, '');
    expect(r.known, isFalse);
  });

  test('H7: an unknown icon token falls back to a real glyph', () {
    const ChecklistOptionSet set = ChecklistOptionSet(
      options: <String>['X'],
      meta: <ChecklistOptionMeta>[
        ChecklistOptionMeta(value: 'X', icon: 'invented', meaning: 'Something odd'),
      ],
    );
    final MarkInfo r = markMeta(set, 'X');
    expect(r.known, isTrue);
    expect(r.icon, 'na');
    // No stored tone survived validation either, so it falls back through
    // the (now-fallback) icon rather than being left unresolved.
    expect(r.tone, MarkTone.muted);
    expect(r.meaning, 'Something odd');
  });
}
