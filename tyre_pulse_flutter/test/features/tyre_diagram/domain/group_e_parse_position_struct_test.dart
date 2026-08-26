/// Parity group E - `parsePositionStruct`. Cases 41-52.
///
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 5, group
/// E. Every case asserts the FULL `{kind, side, axle, role}` record, not
/// one field - a struct that gets one field right and another wrong is
/// still a wrong wheel.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_struct.dart';

void main() {
  test('case 41: FL -> steer, L, axle 1, single', () {
    expect(
      parsePositionStruct('FL'),
      const PositionStruct(
        kind: PositionKind.steer,
        side: PositionSide.left,
        axle: 1,
        role: PositionRole.single,
      ),
    );
  });

  test('case 42: FL2 -> steer, L, axle 2, single', () {
    expect(
      parsePositionStruct('FL2'),
      const PositionStruct(
        kind: PositionKind.steer,
        side: PositionSide.left,
        axle: 2,
        role: PositionRole.single,
      ),
    );
  });

  test('case 43: F1L -> steer, L, axle 1, single', () {
    expect(
      parsePositionStruct('F1L'),
      const PositionStruct(
        kind: PositionKind.steer,
        side: PositionSide.left,
        axle: 1,
        role: PositionRole.single,
      ),
    );
  });

  test('case 44: F3R -> steer, R, axle 3, single', () {
    expect(
      parsePositionStruct('F3R'),
      const PositionStruct(
        kind: PositionKind.steer,
        side: PositionSide.right,
        axle: 3,
        role: PositionRole.single,
      ),
    );
  });

  test('case 45: RLo -> drive, L, axle 1, outer', () {
    expect(
      parsePositionStruct('RLo'),
      const PositionStruct(
        kind: PositionKind.drive,
        side: PositionSide.left,
        axle: 1,
        role: PositionRole.outer,
      ),
    );
  });

  test('case 46: R2Ri -> drive, R, axle 2, inner', () {
    expect(
      parsePositionStruct('R2Ri'),
      const PositionStruct(
        kind: PositionKind.drive,
        side: PositionSide.right,
        axle: 2,
        role: PositionRole.inner,
      ),
    );
  });

  test('case 47: RL -> drive, L, axle 1, single', () {
    expect(
      parsePositionStruct('RL'),
      const PositionStruct(
        kind: PositionKind.drive,
        side: PositionSide.left,
        axle: 1,
        role: PositionRole.single,
      ),
    );
  });

  test('case 48: RL1 -> drive/L/1/outer, RL2 -> drive/L/1/inner', () {
    expect(
      parsePositionStruct('RL1'),
      const PositionStruct(
        kind: PositionKind.drive,
        side: PositionSide.left,
        axle: 1,
        role: PositionRole.outer,
      ),
    );
    expect(
      parsePositionStruct('RL2'),
      const PositionStruct(
        kind: PositionKind.drive,
        side: PositionSide.left,
        axle: 1,
        role: PositionRole.inner,
      ),
    );
  });

  test(
      'case 49: the mirroring trap - RR1 -> drive/R/1/inner, '
      'RR2 -> drive/R/1/outer', () {
    expect(
      parsePositionStruct('RR1'),
      const PositionStruct(
        kind: PositionKind.drive,
        side: PositionSide.right,
        axle: 1,
        role: PositionRole.inner,
      ),
    );
    expect(
      parsePositionStruct('RR2'),
      const PositionStruct(
        kind: PositionKind.drive,
        side: PositionSide.right,
        axle: 1,
        role: PositionRole.outer,
      ),
    );
  });

  test('case 50: RL4 -> drive, L, axle 2, inner', () {
    expect(
      parsePositionStruct('RL4'),
      const PositionStruct(
        kind: PositionKind.drive,
        side: PositionSide.left,
        axle: 2,
        role: PositionRole.inner,
      ),
    );
  });

  test('case 51: SL -> lift/L/1/single, AxleL1 -> axle/L/1/single', () {
    expect(
      parsePositionStruct('SL'),
      const PositionStruct(
        kind: PositionKind.lift,
        side: PositionSide.left,
        axle: 1,
        role: PositionRole.single,
      ),
    );
    expect(
      parsePositionStruct('AxleL1'),
      const PositionStruct(
        kind: PositionKind.axle,
        side: PositionSide.left,
        axle: 1,
        role: PositionRole.single,
      ),
    );
  });

  test(
      'case 52: Spare, SP, SP2 all parse as spare; an unrecognised token '
      'parses as unknown', () {
    for (final String id in <String>['Spare', 'SP', 'SP2']) {
      expect(
        parsePositionStruct(id),
        const PositionStruct(
          kind: PositionKind.spare,
          side: null,
          axle: 0,
          role: PositionRole.single,
        ),
        reason: id,
      );
    }
    expect(
      parsePositionStruct('WHEEL_ALPHA'),
      const PositionStruct(
        kind: PositionKind.unknown,
        side: null,
        axle: 0,
        role: PositionRole.single,
      ),
    );
  });

  test(
      'normalisation: r2ri, R2-RI and " R2_Ri " all parse identically to '
      'case 46', () {
    const PositionStruct expected = PositionStruct(
      kind: PositionKind.drive,
      side: PositionSide.right,
      axle: 2,
      role: PositionRole.inner,
    );
    expect(parsePositionStruct('r2ri'), expected);
    expect(parsePositionStruct('R2-RI'), expected);
    expect(parsePositionStruct(' R2_Ri '), expected);
  });
}
