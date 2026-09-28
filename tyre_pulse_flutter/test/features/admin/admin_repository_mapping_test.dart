import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/features/admin/data/admin_repository.dart';
import 'package:tyre_pulse/features/admin/domain/admin_models.dart';

void main() {
  test('mobile grants keep known mobile keys and let revoke win', () {
    final Map<ModuleKey, AdminMobileGrant> grants =
        mobileGrantsFromRows(<Map<String, dynamic>>[
      <String, dynamic>{
        'id': 'a',
        'module_key': 'mobile:scan',
        'effect': 'grant',
      },
      <String, dynamic>{
        'id': 'b',
        'module_key': 'mobile:scan',
        'effect': 'revoke',
      },
      <String, dynamic>{
        'id': 'c',
        'module_key': 'tyre_records',
        'effect': 'grant',
      },
      <String, dynamic>{
        'id': 'd',
        'module_key': 'mobile:nope',
        'effect': 'grant',
      },
      <String, dynamic>{
        'id': 'e',
        'module_key': 'mobile:inspect',
        'effect': 'x',
      },
    ]);
    expect(grants.keys, <ModuleKey>[ModuleKey.scan]);
    expect(grants[ModuleKey.scan]!.effect, AdminGrantEffect.revoke);
    expect(grants[ModuleKey.scan]!.id, 'b');
  });

  test('profile rows read country as an array and nulls stay null', () {
    final AdminUser user = adminUserFromRow(<String, dynamic>{
      'id': 'u1',
      'full_name': '  ',
      'username': 'sam',
      'country': <String>['KSA', 'UAE'],
      'approved': null,
      'locked': true,
    });
    expect(user.countries, <String>['KSA', 'UAE']);
    expect(user.displayName, 'sam');
    expect(user.approved, isNull);
    expect(user.status, AdminUserStatus.locked);
  });

  test('chat-ai answers and failures', () {
    expect(aiAnswerFrom(<String, dynamic>{'content': ' ok '}), 'ok');
    expect(
      () => aiAnswerFrom(<String, dynamic>{'error': 'x'}),
      throwsA(isA<AdminAiException>()),
    );
    expect(
      () => aiAnswerFrom(<String, dynamic>{'content': ''}),
      throwsA(
        isA<AdminAiException>().having(
          (AdminAiException e) => e.failure,
          'failure',
          AdminAiFailure.empty,
        ),
      ),
    );
    expect(aiFailureForStatus(403), AdminAiFailure.disabled);
    expect(aiFailureForStatus(402), AdminAiFailure.budget);
    expect(aiFailureForStatus(429), AdminAiFailure.rateLimited);
    expect(aiFailureForStatus(500), AdminAiFailure.unavailable);
  });

  test('hub total is unknown unless both approval counts were measured', () {
    expect(
      const AdminHubCounts(pendingInspections: 2).pendingApprovals,
      isNull,
    );
    expect(
      const AdminHubCounts(pendingInspections: 2, pendingChecklists: 3)
          .pendingApprovals,
      5,
    );
  });
}
