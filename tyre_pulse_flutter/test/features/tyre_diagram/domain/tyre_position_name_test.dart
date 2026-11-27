import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_layout_spec.g.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_name.dart';

const TyrePositionNameSide l = TyrePositionNameSide.left;
const TyrePositionNameSide r = TyrePositionNameSide.right;

void main() {
  test('decodes every code shape the shared tyre map prints', () {
    final Map<String, TyrePositionName> cases = <String, TyrePositionName>{
      'LHF1': const TyrePositionName(
        side: l,
        axle: TyrePositionNameAxle.front,
        axleNumber: 1,
      ),
      'RHF3': const TyrePositionName(
        side: r,
        axle: TyrePositionNameAxle.front,
        axleNumber: 3,
      ),
      'LHR1': const TyrePositionName(
        side: l,
        axle: TyrePositionNameAxle.rearNumbered,
        axleNumber: 1,
      ),
      'RHR2-I': const TyrePositionName(
        side: r,
        axle: TyrePositionNameAxle.rearNumbered,
        axleNumber: 2,
        role: TyrePositionNameRole.inner,
      ),
      'LHR3-O': const TyrePositionName(
        side: l,
        axle: TyrePositionNameAxle.rearNumbered,
        axleNumber: 3,
        role: TyrePositionNameRole.outer,
      ),
      'LHRO': const TyrePositionName(
        side: l,
        axle: TyrePositionNameAxle.rear,
        role: TyrePositionNameRole.outer,
      ),
      'RHRI': const TyrePositionName(
        side: r,
        axle: TyrePositionNameAxle.rear,
        role: TyrePositionNameRole.inner,
      ),
      'LHCO': const TyrePositionName(
        side: l,
        axle: TyrePositionNameAxle.centre,
        role: TyrePositionNameRole.outer,
      ),
      'RHCI': const TyrePositionName(
        side: r,
        axle: TyrePositionNameAxle.centre,
        role: TyrePositionNameRole.inner,
      ),
      'LHRCO': const TyrePositionName(
        side: l,
        axle: TyrePositionNameAxle.rearCentre,
        role: TyrePositionNameRole.outer,
      ),
      'RHRRI': const TyrePositionName(
        side: r,
        axle: TyrePositionNameAxle.rearmost,
        role: TyrePositionNameRole.inner,
      ),
    };
    cases.forEach((String code, TyrePositionName want) {
      expect(parseTyrePositionName(code), want, reason: code);
    });
  });

  test('stored whitespace, case and separators are ignored', () {
    expect(
      parseTyrePositionName(' lhco  '),
      parseTyrePositionName('LHCO'),
    );
    expect(
      parseTyrePositionName('RH R2_I'),
      parseTyrePositionName('RHR2-I'),
    );
  });

  test('every code the tyre map can print has a name', () {
    final Set<String> codes = <String>{
      ...kTyreSpecCodesBase.values,
      for (final (List<String>, String, Map<String, String>) o
          in kTyreSpecCodeOverrides)
        ...o.$3.values,
    };
    for (final String code in codes) {
      expect(parseTyrePositionName(code), isNotNull, reason: code);
    }
  });

  test('every diagram slot resolves to a named code', () {
    for (final String layout in kTyreDiagramLayouts.keys) {
      for (final String slot in diagramPositions(layout, '')) {
        final String code = legacyPositionCode(layout, slot);
        expect(
          parseTyrePositionName(code),
          isNotNull,
          reason: '$layout $slot -> $code',
        );
      }
    }
  });

  test('anything else is null rather than a guess', () {
    for (final String bad in <String>[
      '',
      'SPARE',
      'F1L',
      'R2Ro',
      'LH',
      'XXF1',
      'LHF0',
      'LHZZ',
    ]) {
      expect(parseTyrePositionName(bad), isNull, reason: bad);
    }
    expect(parseTyrePositionName(null), isNull);
  });
}
