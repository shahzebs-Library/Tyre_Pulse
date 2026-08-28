library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';

void main() {
  test('Critical and High map to distinct honest alert bands', () {
    const TyreAlert critical = TyreAlert(id: 'c', riskLevel: 'Critical');
    const TyreAlert warning = TyreAlert(id: 'h', riskLevel: 'High');

    expect(critical.status, TpStatus.critical);
    expect(critical.matches(TyreAlertFilter.critical), isTrue);
    expect(critical.matches(TyreAlertFilter.warnings), isFalse);
    expect(warning.status, TpStatus.warning);
    expect(warning.matches(TyreAlertFilter.warnings), isTrue);
  });

  test('Info remains a working filter without inventing backend rows', () {
    const TyreAlert critical = TyreAlert(id: 'c', riskLevel: 'Critical');
    const TyreAlert warning = TyreAlert(id: 'h', riskLevel: 'High');

    expect(critical.matches(TyreAlertFilter.info), isFalse);
    expect(warning.matches(TyreAlertFilter.info), isFalse);
  });
}
