import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/admin/data/approval_policy_repository.dart';
import 'package:tyre_pulse/features/admin/presentation/approval_matrix_screen.dart';

class _Repository extends ApprovalPolicyRepository {
  _Repository() : super(SupabaseClient('https://test.invalid', 'test-key'));
  int reads = 0;
  bool fail = false;
  @override
  Future<List<ApprovalPolicy>> list() async {
    reads++;
    if (fail) throw StateError('backend unavailable');
    return [
      {
        'id': 'policy',
        'name': 'Workshop approval',
        'entity_type': 'checklist',
        'state': 'draft',
        'version': 1,
        'priority': 4,
        'stages': [
          {
            'name': 'Supervisor',
            'approver_role': 'Supervisor',
            'require_signature': true,
            'prevent_self_approval': true,
            'distinct_reviewer': true,
            'sla_hours': 24
          }
        ]
      }
    ];
  }

  @override
  Future<List<ApprovalPolicy>> people() async => [
        {
          'id': 'reviewer',
          'full_name': 'Reviewer',
          'role': 'Supervisor',
          'sites': ['Site A']
        }
      ];
  @override
  Future<List<ApprovalPolicy>> sites() async => [
        {'id': 'site', 'name': 'Site A', 'country': 'KSA'}
      ];
}

void main() {
  Widget app(_Repository repository, {bool allowed = true}) =>
      ProviderScope(overrides: [
              workspaceContextProvider.overrideWithValue(null),
        accessStateProvider.overrideWithValue(AccessState(
            role: UserRole.known(allowed ? RoleId.admin : RoleId.driver))),
        approvalPolicyRepositoryProvider.overrideWithValue(repository),
      ], child: const MaterialApp(home: ApprovalMatrixScreen()));

  testWidgets('denied admin screen does not read configuration',
      (tester) async {
    final repository = _Repository();
    await tester.pumpWidget(app(repository, allowed: false));
    await tester.pumpAndSettle();
    expect(repository.reads, 0);
    expect(find.text('Administrator access required.'), findsOneWidget);

  });

  testWidgets(
      'backend failure is not an empty configuration or editable workspace',
      (tester) async {
    final repository = _Repository()..fail = true;
    await tester.pumpWidget(app(repository));
    await tester.pumpAndSettle();
    expect(repository.reads, 1);
    expect(find.text('Create draft'), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsNothing);

  });

  testWidgets('administrator can search and open a real policy',
      (tester) async {
    final repository = _Repository();
    await tester.pumpWidget(app(repository));
    await tester.pumpAndSettle();
    expect(find.text('Workshop approval'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'unmatched');
    await tester.pump();
    expect(find.text('Workshop approval'), findsNothing);
    await tester.enterText(find.byType(TextField).first, 'workshop');
    await tester.pump();
    await tester.tap(find.text('Workshop approval'));
    await tester.pumpAndSettle();
    expect(find.text('Approval policy'), findsOneWidget);
    expect(find.text('Sequential review stages'), findsOneWidget);
    expect(tester.takeException(), isNull);

  });
}
