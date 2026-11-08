import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_action_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_previous_meters.dart';

void main() {
  test('a lower typed reading warns; equal, higher or unknown does not', () {
    expect(isBelowPrevious(900, 1000), isTrue);
    expect(isBelowPrevious(1000, 1000), isFalse);
    expect(isBelowPrevious(1200, 1000), isFalse);
    expect(isBelowPrevious(null, 1000), isFalse);
    expect(isBelowPrevious(900, null), isFalse);
  });

  test('a typed name cannot change the PostgREST or() filter', () {
    expect(sanitizePersonSearch('Ali,role.eq.Admin'), 'Ali role eq Admin');
    expect(sanitizePersonSearch('  (x)%*  '), 'x');
  });
}
