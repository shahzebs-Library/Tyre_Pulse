/// Parity group F - `matchPositionsToLayout`. Cases 53-60.
///
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 5, group
/// F. This is what lets one diagram accept either position vocabulary.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_matcher.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';

DiagramLayout get _triMixer => kTyreDiagramLayouts['Tri-mixer']!;

List<String> _allIds(DiagramLayout layout) =>
    <String>[for (final TyreSlot t in layout.tyres) t.id];

void main() {
  test('case 53: an empty list returns the whole layout, positionId == id', () {
    final List<MatchedTyreSlot> result = matchPositionsToLayout(
      _triMixer,
      <String>[],
    );
    expect(result.length, 12);
    for (final MatchedTyreSlot m in result) {
      expect(m.positionId, m.id);
    }
  });

  test('case 54: exact id match, case insensitive', () {
    final List<MatchedTyreSlot> result = matchPositionsToLayout(
      _triMixer,
      <String>['r1lo'],
    );
    expect(result.length, 1);
    expect(result.single.id, 'R1Lo');
    expect(result.single.positionId, 'r1lo');
  });

  test(
    "case 55: positionId preserves the CALLER's spelling while geometry "
    'comes from the structurally-matched slot',
    () {
      // The artifact's own literal input for this case is 'LHCO' (a V2
      // canonical code). Verified by executing parsePositionStruct's exact
      // 8-rule table (section 4.3) against it: no rule matches a string
      // starting with 'L', so it decodes to `unknown`, and
      // matchPositionsToLayout explicitly skips an unknown token rather
      // than routing it through the structural path this case is meant to
      // exercise - parsePositionStruct's own scope is documented as "BOTH
      // id vocabularies" (V1 diagram ids and V3 types.ts ids), which does
      // not include V2 canonical codes. 'LHCO' alone would therefore match
      // NOTHING and fall back to the whole-layout return (case 59's path),
      // not a single R1Lo match - the artifact's stated expectation for
      // this exact input does not hold against its own rule table.
      //
      // Substituted here with 'RL1' (a genuine V3-vocabulary id), verified
      // by the same rule table to structurally resolve onto R1Lo (both
      // parse to drive/left/axle-1/outer) without an exact id match - which
      // is precisely the "positionId preserved, geometry from the matched
      // slot" behaviour this case exists to pin. See the port's final
      // report for the full account of this substitution.
      final List<MatchedTyreSlot> result = matchPositionsToLayout(
        _triMixer,
        <String>['RL1'],
      );
      expect(result.length, 1);
      expect(result.single.positionId, 'RL1');
      expect(result.single.id, 'R1Lo');
      final TyreSlot expectedSlot = _triMixer.tyres.firstWhere(
        (TyreSlot t) => t.id == 'R1Lo',
      );
      expect(result.single.x, expectedSlot.x);
      expect(result.single.y, expectedSlot.y);
      expect(result.single.w, expectedSlot.w);
      expect(result.single.h, expectedSlot.h);
    },
  );

  test(
    'case 56: V3 ids map onto V1 slots on the first drive axle, roles '
    'mirrored',
    () {
      final List<MatchedTyreSlot> result = matchPositionsToLayout(
        _triMixer,
        <String>['RL1', 'RL2', 'RR1', 'RR2'],
      );
      expect(result.length, 4);
      final Map<String, String> byPositionId = <String, String>{
        for (final MatchedTyreSlot m in result) m.positionId: m.id,
      };
      expect(byPositionId['RL1'], 'R1Lo');
      expect(byPositionId['RL2'], 'R1Li');
      expect(byPositionId['RR1'], 'R1Ri');
      expect(byPositionId['RR2'], 'R1Ro');
    },
  );

  test('case 57: Spare is skipped, never a ghost slot', () {
    final List<MatchedTyreSlot> result = matchPositionsToLayout(_triMixer, <
      String
    >[
      ..._allIds(_triMixer),
      'Spare',
    ]);
    expect(result.length, 12);
    expect(
      result.any((MatchedTyreSlot m) => m.positionId == 'Spare'),
      isFalse,
    );
  });

  test('case 58: an unknown token is skipped', () {
    final List<MatchedTyreSlot> result = matchPositionsToLayout(_triMixer, <
      String
    >[
      ..._allIds(_triMixer),
      'WHEEL_ALPHA',
    ]);
    expect(result.length, 12);
  });

  test(
    'case 59: a fully foreign vocabulary returns the whole layout rather '
    'than a blank diagram',
    () {
      final List<MatchedTyreSlot> result = matchPositionsToLayout(
        _triMixer,
        <String>['WHEEL_ALPHA'],
      );
      expect(result.length, 12);
    },
  );

  test('case 60: output is sorted by y then x, ties broken by x', () {
    final List<MatchedTyreSlot> result = matchPositionsToLayout(
      _triMixer,
      <String>['R2Ro', 'F1L', 'R1Li'],
    );
    for (int i = 1; i < result.length; i++) {
      final MatchedTyreSlot prev = result[i - 1];
      final MatchedTyreSlot curr = result[i];
      final bool ordered =
          prev.y < curr.y || (prev.y == curr.y && prev.x <= curr.x);
      expect(ordered, isTrue, reason: '$prev then $curr');
    }
  });
}
