import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/features/admin/admin_screen_registrations.dart';

void main() {
  test('registers every admin route id', () {
    expect(adminScreenRegistrations.keys.toSet(), <String>{
      TpRouteId.adminConsole,
      TpRouteId.adminUsers,
      TpRouteId.adminAccess,
      TpRouteId.adminApprovals,
      TpRouteId.adminSites,
      TpRouteId.adminAiChat,
    });
  });
}
