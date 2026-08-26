library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/records/domain/tyre_risk.dart';

void main() {
  group('kTyreRiskLevels', () {
    test('carries exactly the four database-controlled values', () {
      expect(kTyreRiskLevels, <String>['Critical', 'High', 'Medium', 'Low']);
    });
  });

  group('tyreRiskStatus', () {
    test('Critical maps to TpStatus.critical', () {
      expect(tyreRiskStatus('Critical'), TpStatus.critical);
    });

    test('High and Medium both map to TpStatus.warning', () {
      // TpStatus has no separate "danger" tier between warning and
      // critical - see the library comment on why the two compress onto
      // one colour without losing the distinction (every call site still
      // passes the raw string as the chip's label).
      expect(tyreRiskStatus('High'), TpStatus.warning);
      expect(tyreRiskStatus('Medium'), TpStatus.warning);
    });

    test('Low maps to TpStatus.ok', () {
      expect(tyreRiskStatus('Low'), TpStatus.ok);
    });

    test('a null risk level maps to TpStatus.unknown, never a healthy '
        'colour', () {
      expect(tyreRiskStatus(null), TpStatus.unknown);
    });

    test('an unrecognised value maps to TpStatus.unknown rather than '
        'throwing', () {
      expect(tyreRiskStatus('Severe'), TpStatus.unknown);
      expect(tyreRiskStatus(''), TpStatus.unknown);
    });

    test('is case sensitive, matching the database vocabulary exactly', () {
      // risk_level is a controlled server vocabulary, not free text - a
      // lower-cased variant is not a value this column actually holds, and
      // silently accepting one would mask a real data problem.
      expect(tyreRiskStatus('critical'), TpStatus.unknown);
    });
  });
}
