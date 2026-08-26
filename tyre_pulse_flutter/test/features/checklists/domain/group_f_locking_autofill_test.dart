/// Parity group F - locking and auto-fill merge. Cases F1-F5, plus a small
/// bonus block for `meterRegression` (documented in artifact section 4b,
/// not separately numbered in section 10).
///
/// `docs/flutter-migration/08-checklist-engine-parity-tests.md` section 10
/// group F. Fixtures mirror `src/test/checklistMarks.test.js:139-183`.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_asset_context.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_auto_fill.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';

final ChecklistTemplate _template = const ChecklistTemplate(
  fields: <ChecklistField>[
    ChecklistField(id: 's1', type: 'section', label: 'Identification'),
    ChecklistField(id: 'f_ws_date', type: 'date', label: 'Date', locked: true),
    ChecklistField(
      id: 'f_ws_site',
      type: 'site',
      label: 'Location',
      autoFrom: 'asset.site',
      readOnly: true,
    ),
    ChecklistField(
      id: 'f_ws_chassis',
      type: 'text',
      label: 'Chassis / serial No',
      autoFrom: 'asset.chassis_no',
    ),
  ],
);

const ChecklistAssetContext _asset = ChecklistAssetContext(
  site: 'NHC',
  fleetNumber: 'FL-4412',
  registrationNo: '8448 GXA',
  chassisNo: 'JTEB123456',
  currentKm: 120345,
  vehicleType: 'TR-MIXER',
);

void main() {
  test('F1: locked locks whatever the value', () {
    const ChecklistField f = ChecklistField(
      id: 'd',
      type: 'date',
      locked: true,
    );
    expect(isFieldLocked(f, ''), isTrue);
    expect(isFieldLocked(f, 'anything'), isTrue);
  });

  test('F2: readOnly locks only once a value exists', () {
    const ChecklistField f = ChecklistField(
      id: 'r',
      type: 'text',
      readOnly: true,
    );
    expect(isFieldLocked(f, ''), isFalse);
    expect(isFieldLocked(f, '   '), isFalse);
    expect(isFieldLocked(f, 'TM514'), isTrue);
  });

  test('F3: autoFill never overwrites what the user typed', () {
    final Map<String, String> patch = autoFillAnswers(
      _template,
      _asset,
      <String, Object?>{'f_ws_chassis': 'typed by hand'},
    );
    expect(patch.containsKey('f_ws_chassis'), isFalse);
    expect(patch['f_ws_site'], 'NHC');
  });

  test('F4: a read-only field DOES take the register value', () {
    final Map<String, String> patch = autoFillAnswers(
      _template,
      _asset,
      <String, Object?>{'f_ws_site': 'stale'},
    );
    expect(patch['f_ws_site'], 'NHC');
  });

  test('F5: an unknown asset fills nothing, silently', () {
    expect(
      autoFillAnswers(
        _template,
        const ChecklistAssetContext(site: ''),
        const <String, Object?>{},
      ),
      isEmpty,
    );
    expect(
      autoFillAnswers(_template, null, const <String, Object?>{}),
      isEmpty,
    );
  });

  group('bonus: meterRegression (artifact section 4b, undertested by '
      'section 10)', () {
    test('a lower reading is flagged', () {
      expect(meterRegression(90, 100), isTrue);
    });

    test('an equal or higher reading is not', () {
      expect(meterRegression(100, 100), isFalse);
      expect(meterRegression(110, 100), isFalse);
    });

    test('either side missing means nothing to compare - never flagged', () {
      expect(meterRegression(null, 100), isFalse);
      expect(meterRegression(90, null), isFalse);
      expect(meterRegression('', 100), isFalse);
      expect(meterRegression('abc', 100), isFalse);
    });
  });
}
