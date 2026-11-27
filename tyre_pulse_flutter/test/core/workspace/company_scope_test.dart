import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/workspace/company_scope.dart';

void main() {
  const String org = '00000000-0000-0000-0000-000000000001';

  test('isCompanyId accepts a uuid and refuses blanks and junk', () {
    expect(isCompanyId(org), isTrue);
    expect(isCompanyId(' $org '), isTrue);
    expect(isCompanyId(null), isFalse);
    expect(isCompanyId(''), isFalse);
    expect(isCompanyId('ALL'), isFalse);
  });

  test('activeCompanyIdFor tolerates a missing workspace', () {
    expect(activeCompanyIdFor(null), isNull);
  });
}
