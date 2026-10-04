import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/telemetry/telemetry_user_binding.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_service.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_user.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';

void main() {
  group('telemetryUserFor', () {
    test('id, role token and country - never a name', () {
      final TelemetryUser user = telemetryUserFor(
        WorkspaceProfile(
          userId: 'u-1',
          role: UserRole.fromDatabase('Tyre Man'),
          countryScope: CountryScope.fromValues(<String>['KSA']),
          siteScope: SiteScope.fromJson(null),
          fullName: 'Someone Private',
        ),
      );
      expect(user.id, 'u-1');
      expect(user.role, isNotNull);
      expect(user.role, isNot(contains('Someone')));
      expect(user.country, 'KSA');
    });

    test('an all-countries scope is tagged all', () {
      final TelemetryUser user = telemetryUserFor(
        WorkspaceProfile(
          userId: 'u-2',
          role: UserRole.absent,
          countryScope: CountryScope.fromValues(<String>['ALL']),
          siteScope: SiteScope.fromJson(null),
        ),
      );
      expect(user.country, 'all');
      expect(user.role, isNull);
    });
  });

  group('TelemetryService.setUser', () {
    test('sets the id and tags, and clears them on sign-out', () async {
      final List<({String? userId, Map<String, String?> tags})> calls =
          <({String? userId, Map<String, String?> tags})>[];
      final TelemetryService service = TelemetryService.forTesting(
        capture: (Object e, {required tags, stackTrace}) async {},
        staticTags: const <String, String>{'app_version': '0.1.1'},
        userScope: ({required userId, required tags}) async {
          calls.add((userId: userId, tags: tags));
        },
      );
      await service.setUser(
        const TelemetryUser(id: 'u-1', role: 'tyre_man', country: 'KSA'),
      );
      await service.setUser(null);
      expect(calls, hasLength(2));
      expect(calls.first.userId, 'u-1');
      expect(calls.first.tags, <String, String?>{
        'role': 'tyre_man',
        'country': 'KSA',
        'app_version': '0.1.1',
      });
      expect(calls.last.userId, isNull);
      expect(calls.last.tags['role'], isNull);
      expect(calls.last.tags['country'], isNull);
    });

    test('an inactive reporter touches nothing', () async {
      bool called = false;
      final TelemetryService service = TelemetryService(
        userScope: ({required userId, required tags}) async => called = true,
      );
      await service.setUser(const TelemetryUser(id: 'u-1'));
      expect(called, isFalse);
    });

    test('a failing SDK never throws out of setUser', () async {
      final TelemetryService service = TelemetryService.forTesting(
        capture: (Object e, {required tags, stackTrace}) async {},
        userScope: ({required userId, required tags}) async =>
            throw StateError('sdk down'),
      );
      await expectLater(
        service.setUser(const TelemetryUser(id: 'u-1')),
        completes,
      );
    });
  });
}
