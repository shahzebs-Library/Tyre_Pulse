library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/management/domain/management_models.dart';

void main() {
  test('team member provides stable initials and display fallback', () {
    expect(const TeamMember(id: '1', fullName: 'Fatima Ali').initials, 'FA');
    expect(
      const TeamMember(id: '2', username: 'vinay').displayName,
      'vinay',
    );
    expect(const TeamMember(id: '3').initials, 'U');
  });
}
