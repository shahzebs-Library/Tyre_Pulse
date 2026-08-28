/// Parity group H - `tyreCompleteness` and `classifyEntry`. Cases 68-83.
///
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 5, group
/// H. Fixtures mirror `mobile/__tests__/tyreCompleteness.test.ts:16-25`
/// exactly, per the artifact.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';

const List<String> _kMixerSlots = <String>[
  'F1L',
  'F1R',
  'F2L',
  'F2R',
  'R1Lo',
  'R1Li',
  'R1Ri',
  'R1Ro',
  'R2Lo',
  'R2Li',
  'R2Ri',
  'R2Ro',
];

Map<String, Object?> _filled() => <String, Object?>{
      'condition': 'Good',
      'pressure_psi': '110',
    };

Map<String, Object?> _seeded() => <String, Object?>{
      'position': '',
      'serial_number': '',
      'pressure_psi': '',
      'tread_depth_mm': '',
      'condition': 'Good',
      'photo_uri': null,
      'photo_url': null,
      'notes': '',
    };

TyreCompletenessResult _mixer(
  Object? tc, [
  TyreCompletenessOptions opts = const TyreCompletenessOptions(),
]) {
  return tyreCompleteness('TR-MIXER', 'TM123', tc, opts);
}

void main() {
  test('case 68: the seed is blank, not recorded', () {
    expect(classifyEntry(_seeded()).state, TyreSlotState.blank);
    expect(
      classifyEntry(<String, Object?>{'condition': 'Good'}).state,
      TyreSlotState.blank,
    );
  });

  test(
      'case 69: a deliberate condition is evidence (incomplete without '
      'pressure)', () {
    expect(
      classifyEntry(<String, Object?>{'condition': 'Damaged'}).state,
      TyreSlotState.incomplete,
    );
  });

  test('case 70: evidence plus pressure is complete', () {
    expect(classifyEntry(_filled()).state, TyreSlotState.complete);
  });

  test('case 71: a pressure of 0 is a real reading', () {
    expect(
      classifyEntry(<String, Object?>{'pressure_psi': 0}).state,
      TyreSlotState.complete,
    );
  });

  test('case 72: an empty string is not a reading', () {
    expect(
      classifyEntry(<String, Object?>{'pressure_psi': ''}).state,
      TyreSlotState.blank,
    );
  });

  test('case 73: the checked marker - only an explicit true counts', () {
    expect(
      classifyEntry(<String, Object?>{'checked': true}).state,
      TyreSlotState.incomplete,
    );
    expect(
      classifyEntry(<String, Object?>{'checked': false}).state,
      TyreSlotState.blank,
    );
  });

  test('case 74: missing wheels are named', () {
    final Map<String, Object?> tc = <String, Object?>{
      for (final String slot in _kMixerSlots)
        if (slot != 'R2Ri' && slot != 'R2Ro') slot: _filled(),
    };
    final TyreCompletenessResult res = _mixer(tc);
    expect(res.expected, 12);
    expect(res.ok, isFalse);
    expect(res.missing.map((TyreSlotStatus s) => s.slot).toList(), <String>[
      'R2Ri',
      'R2Ro',
    ]);
    expect(pendingCodes(res), <String>['RHRI', 'RHRO']);
    expect(res.summary, '2 of 12 tyres still need details.');
  });

  test('case 75: blank reports but does not block, unless requireEvidence', () {
    final Map<String, Object?> tc = <String, Object?>{
      for (final String slot in _kMixerSlots)
        slot: slot == 'R2Ro' ? _seeded() : _filled(),
    };
    final TyreCompletenessResult res = _mixer(tc);
    expect(res.ok, isTrue);
    expect(res.pending.length, 1);

    final TyreCompletenessResult blocked = _mixer(
      tc,
      const TyreCompletenessOptions(requireEvidence: true),
    );
    expect(blocked.ok, isFalse);
  });

  test('case 76: missing pressure is advisory, unless requirePressure', () {
    final Map<String, Object?> tc = <String, Object?>{
      for (final String slot in _kMixerSlots)
        slot:
            slot == 'R2Ro' ? <String, Object?>{'condition': 'Worn'} : _filled(),
    };
    final TyreCompletenessResult res = _mixer(tc);
    expect(res.ok, isTrue);
    expect(res.incomplete.length, 1);

    final TyreCompletenessResult blocked = _mixer(
      tc,
      const TyreCompletenessOptions(requirePressure: true),
    );
    expect(blocked.ok, isFalse);
  });

  test('case 77: an unknown layout blocks nothing', () {
    final TyreCompletenessResult res = tyreCompleteness(
      'SOMETHING NOBODY CATALOGUED',
      null,
      <String, Object?>{},
    );
    expect(res.known, isFalse);
    expect(res.expected, isNull);
    expect(res.ok, isTrue);
  });

  test('case 78: tyreless is "not applicable", never "0 of 0"', () {
    final TyreCompletenessResult res = tyreCompleteness(
      'STATIONARY PUMP',
      null,
      <String, Object?>{},
    );
    expect(res.applicable, isFalse);
    expect(res.ok, isTrue);
    expect(res.pending, isEmpty);
    expect(res.summary, 'No tyres to inspect on this equipment.');
  });

  test('case 79: layoutIsKnown needs something to have said Pickup', () {
    expect(layoutIsKnown('HEAVY EQP', 'TM640'), isTrue);
    expect(layoutIsKnown('HEAVY EQP', 'LP003'), isTrue);
    expect(layoutIsKnown('HEAVY EQP', 'BH-037'), isTrue);
    expect(layoutIsKnown('HEAVY EQP', 'PL-090'), isTrue);
    expect(layoutIsKnown('HEAVY EQP', null), isFalse);
    // A forklift resolves to Pickup by fallback, so its wheel count is a
    // guess and must not gate.
    expect(layoutIsKnown('FORKLIFT', null), isFalse);
  });

  test('case 80: a spare is extra and cannot block', () {
    final Map<String, Object?> tc = <String, Object?>{
      for (final String slot in _kMixerSlots) slot: _filled(),
      'SP': _filled(),
    };
    final TyreCompletenessResult res = _mixer(tc);
    expect(res.extra, <String>['SP']);
    expect(res.ok, isTrue);
  });

  test('case 81: a foreign vocabulary is reported, not called empty', () {
    final TyreCompletenessResult res = _mixer(<String, Object?>{
      'WHEEL_ALPHA': _filled(),
    });
    expect(res.matched, isFalse);
    expect(res.ok, isTrue);
    expect(res.missing, isEmpty);
  });

  test('case 82: V2 canonical codes are accepted as keys', () {
    final Map<String, Object?> tc = <String, Object?>{
      'LHF1': _filled(),
      'RHF1': _filled(),
      'LHF2': _filled(),
      'RHF2': _filled(),
      'LHCO': _filled(),
      'LHCI': _filled(),
      'RHCI': _filled(),
      'RHCO': _filled(),
      'LHRO': _filled(),
      'LHRI': _filled(),
      'RHRI': _filled(),
      'RHRO': _filled(),
    };
    final TyreCompletenessResult res = _mixer(tc);
    expect(res.ok, isTrue);
  });

  test('case 83: lookup answers both vocabularies', () {
    final Map<String, Object?> tc = <String, Object?>{
      for (final String slot in _kMixerSlots)
        if (slot != 'R2Ro') slot: _filled(),
    };
    final TyreCompletenessResult res = _mixer(tc);
    final Map<String, TyreSlotState> map = slotStateMap(res);
    expect(map['R2Ro'], TyreSlotState.missing);
    expect(map['RHRO'], TyreSlotState.missing);
    expect(isPendingPosition(res, 'F1L'), isFalse);
    expect(isPendingPosition(res, 'NOT_A_WHEEL'), isFalse);
  });
}
