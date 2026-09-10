import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/admin/data/admin_approvals_repository.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_approvals_screen.dart';

const _admin = WorkspaceContext(
  userId: 'admin',
  tenantId: 'org',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.admin)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
);
const _upload = AdminApprovalItem(
  id: 'upload',
  title: 'Tyres.csv',
  detail: '',
  kind: AdminApprovalKind.upload,
  uploadType: 'tyres',
  rowCount: 1,
);

class _Source implements AdminApprovalsSource {
  Object? result = {'ok': true};
  int decisions = 0;
  bool? approved;
  String? reason;
  @override
  Future<List<Map<String, dynamic>>> page(
    WorkspaceContext workspace,
    AdminApprovalKind kind,
    int offset,
  ) async =>
      kind == AdminApprovalKind.upload
          ? [
              {
                'id': 'upload',
                'file_name': 'Tyres.csv',
                'upload_type': 'tyres',
                'row_count': 1,
              }
            ]
          : [
              {
                'id': 'case',
                'asset_no': 'ASSET-2',
                'close_request_note': 'Repairs complete',
              }
            ];
  @override
  Future<List<dynamic>> uploadRows(String id) async => [
        {'serial': 'REAL-1'},
      ];
  @override
  Future<Object?> decide(String id, bool approve, String? note) async {
    decisions++;
    approved = approve;
    reason = note;
    return result;
  }
}

void main() {
  Widget queueApp(_Source source) => ProviderScope(
        overrides: [
          workspaceContextProvider.overrideWithValue(_admin),
          accessStateProvider.overrideWithValue(_admin.effectivePermissions),
          adminApprovalsRepositoryProvider
              .overrideWithValue(AdminApprovalsRepository(source)),
        ],
        child: MaterialApp(
          theme: TpTheme.light,
          localizationsDelegates: TpLocalizations.delegates,
          supportedLocales: TpLocalizations.supportedLocales,
          home: const AdminApprovalsScreen(),
        ),
      );

  testWidgets('unknown decision outcome requires refresh before another review',
      (tester) async {
    final source = _Source()..result = {'ok': false};
    await tester.pumpWidget(queueApp(source));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tyres.csv'));
    // The queue remains busy while its review dialog is open.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    await tester.tap(find.text('Approve import'));
    await tester.pumpAndSettle();
    expect(source.decisions, 1);
    expect(find.text('Tyres.csv'), findsNothing);
    expect(find.text('Refresh'), findsOneWidget);
    await tester.tap(find.text('Refresh'));
    await tester.pumpAndSettle();
    expect(find.text('Tyres.csv'), findsOneWidget);
    expect(source.decisions, 1);
  });

  testWidgets('workspace loss closes the exact review dialog without deciding',
      (tester) async {
    final source = _Source();
    await tester.pumpWidget(queueApp(source));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tyres.csv'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.textContaining('REAL-1'), findsOneWidget);
    final container = ProviderScope.containerOf(
      tester.element(find.byType(AdminApprovalsScreen)),
    );
    container.updateOverrides([
      workspaceContextProvider.overrideWithValue(null),
      accessStateProvider.overrideWithValue(_admin.effectivePermissions),
      adminApprovalsRepositoryProvider
          .overrideWithValue(AdminApprovalsRepository(source)),
    ]);
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.textContaining('REAL-1'), findsNothing);
    expect(find.byType(AdminApprovalsScreen), findsOneWidget);
    expect(source.decisions, 0);
    expect(tester.takeException(), isNull);
  });

  test('rejection requires a reason before any request', () {
    final source = _Source();
    final repository = AdminApprovalsRepository(source);
    expect(
      () => repository.decide(_admin, _upload, false, '  '),
      throwsA(isA<AppError>()),
    );
    expect(source.decisions, 0);
  });
  test('unsupported imports and non-atomic closure decisions cannot be sent',
      () {
    final source = _Source();
    final repository = AdminApprovalsRepository(source);
    for (final item in [
      const AdminApprovalItem(
        id: 'bad',
        title: 'Other',
        detail: '',
        kind: AdminApprovalKind.upload,
        uploadType: 'unknown',
      ),
      const AdminApprovalItem(
        id: 'case',
        title: 'Case',
        detail: '',
        kind: AdminApprovalKind.closure,
      ),
    ]) {
      expect(
        () => repository.decide(_admin, item, true, ''),
        throwsA(isA<AppError>()),
      );
    }
    expect(source.decisions, 0);
  });
  test('decision waits for server confirmation and never auto-retries',
      () async {
    final source = _Source()..result = {'ok': false};
    await expectLater(
      AdminApprovalsRepository(source).decide(_admin, _upload, true, ''),
      throwsA(
        isA<SupabaseFailure>().having(
          (failure) => failure.error.kind,
          'kind',
          AppErrorKind.conflict,
        ),
      ),
    );
    expect(source.decisions, 1);
  });
  test('successful rejection passes its reviewed reason once', () async {
    final source = _Source();
    await AdminApprovalsRepository(source)
        .decide(_admin, _upload, false, ' Wrong file ');
    expect(source.approved, false);
    expect(source.reason, 'Wrong file');
    expect(source.decisions, 1);
  });
  testWidgets('upload rows are reviewable and closures remain a separate queue',
      (tester) async {
    final source = _Source();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          workspaceContextProvider.overrideWithValue(_admin),
          accessStateProvider.overrideWithValue(_admin.effectivePermissions),
          adminApprovalsRepositoryProvider
              .overrideWithValue(AdminApprovalsRepository(source)),
        ],
        child: MaterialApp(
          theme: TpTheme.light,
          localizationsDelegates: TpLocalizations.delegates,
          supportedLocales: TpLocalizations.supportedLocales,
          home: const AdminApprovalsScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tyres.csv'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.textContaining('REAL-1'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(source.decisions, 0);
    await tester.tap(find.text('Closure requests'));
    await tester.pumpAndSettle();
    expect(find.text('ASSET-2'), findsOneWidget);
    expect(find.text('Approve import'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
