/// The register screen, state by state.
///
/// Mirrors the harness `test/app/router/app_router_test.dart` already
/// establishes for asserting on [TpStateKeys] rather than on incidental
/// widget structure: `find.byKey(TpStateKeys.permissionDenied)` proves WHICH
/// of the seven states rendered without depending on its exact layout.
///
/// The permission-gate group is the proof the task specifically calls for:
/// a denied user sees the refusal, and the repository records ZERO fetch
/// calls, because the screen never reads the controller provider at all
/// when access is denied.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_page.dart';
import 'package:tyre_pulse/features/records/presentation/tyre_records_list_screen.dart';
import 'package:tyre_pulse/features/records/records_providers.dart';

import '../records_test_support.dart';

const AccessState _admin = AccessState(role: UserRole.known(RoleId.admin));
const AccessState _reporter =
    AccessState(role: UserRole.known(RoleId.reporter));

Future<FakeTyreRecordsRepository> _pump(
  WidgetTester tester, {
  required AccessState access,
  FakeTyreRecordsRepository? repo,
}) async {
  final FakeTyreRecordsRepository repository =
      repo ?? FakeTyreRecordsRepository();
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      accessStateProvider.overrideWithValue(access),
      tyreRecordsRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const TyreRecordsListScreen(backFallback: '/home'),
      ),
    ),
  );
  return repository;
}

void main() {
  group('the module gate runs before any fetch', () {
    testWidgets(
      'a denied user sees the refusal, never a spinner, and the '
      'repository is never called',
      (WidgetTester tester) async {
        final FakeTyreRecordsRepository repo =
            await _pump(tester, access: _reporter);
        await tester.pump();

        expect(find.byKey(TpStateKeys.permissionDenied), findsOneWidget);
        expect(find.byType(CircularProgressIndicator), findsNothing);
        expect(
          repo.fetchPageCalls,
          isEmpty,
          reason: 'ModuleKey.records is admin-only; a Reporter must be '
              'refused before the controller provider is ever read',
        );
      },
    );

    testWidgets('the refusal names a reason a person can read',
        (WidgetTester tester) async {
      await _pump(tester, access: _reporter);
      await tester.pump();

      final TpPermissionDeniedState widget = tester.widget<TpPermissionDeniedState>(
        find.byType(TpPermissionDeniedState),
      );
      expect(widget.reason, isNotEmpty);
    });

    testWidgets('an admin is allowed through to the register',
        (WidgetTester tester) async {
      await _pump(tester, access: _admin);
      await tester.pumpAndSettle();

      expect(find.byKey(TpStateKeys.permissionDenied), findsNothing);
    });
  });

  group('loading', () {
    testWidgets('renders while the first page is in flight',
        (WidgetTester tester) async {
      final FakeTyreRecordsRepository repo = FakeTyreRecordsRepository();
      final Completer<TyreRecordsPage> hold = Completer<TyreRecordsPage>();
      repo.queueResponder((_, __) => hold.future);

      await _pump(tester, access: _admin, repo: repo);
      await tester.pump();

      expect(find.byKey(TpStateKeys.loading), findsOneWidget);

      hold.complete(TyreRecordsPage.empty);
      await tester.pumpAndSettle();
    });
  });

  group('empty', () {
    testWidgets('renders when the query resolves with nothing',
        (WidgetTester tester) async {
      await _pump(
        tester,
        access: _admin,
        repo: FakeTyreRecordsRepository(),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(TpStateKeys.empty), findsOneWidget);
    });
  });

  group('error', () {
    testWidgets(
      'a validation failure on the first page renders the generic error '
      'state',
      (WidgetTester tester) async {
        final FakeTyreRecordsRepository repo = FakeTyreRecordsRepository();
        repo.queueFailure(
          const AppError(kind: AppErrorKind.validation, message: 'no'),
        );
        await _pump(tester, access: _admin, repo: repo);
        await tester.pumpAndSettle();

        expect(find.byKey(TpStateKeys.error), findsOneWidget);
        expect(find.byKey(TpStateKeys.backendUnavailable), findsNothing);
      },
    );

    testWidgets(
      'a network failure renders backend-unavailable, distinct from the '
      'generic error state',
      (WidgetTester tester) async {
        final FakeTyreRecordsRepository repo = FakeTyreRecordsRepository();
        repo.queueFailure(
          const AppError(kind: AppErrorKind.network, message: 'offline'),
        );
        await _pump(tester, access: _admin, repo: repo);
        await tester.pumpAndSettle();

        expect(find.byKey(TpStateKeys.backendUnavailable), findsOneWidget);
        expect(find.byKey(TpStateKeys.error), findsNothing);
      },
    );
  });

  group('content', () {
    testWidgets('a successful page renders one row per record',
        (WidgetTester tester) async {
      final List<TyreRecord> dataset = <TyreRecord>[
        buildTyreRecord(id: '1', assetNo: 'TM514', riskLevel: 'Critical'),
        buildTyreRecord(id: '2', assetNo: 'TM515', riskLevel: 'Low'),
      ];
      await _pump(
        tester,
        access: _admin,
        repo: FakeTyreRecordsRepository(dataset: dataset),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(TpStateKeys.empty), findsNothing);
      expect(find.byKey(TpStateKeys.loading), findsNothing);
      expect(find.text('TM514'), findsOneWidget);
      expect(find.text('TM515'), findsOneWidget);
    });

    testWidgets('tapping a row opens the detail sheet for that record',
        (WidgetTester tester) async {
      final List<TyreRecord> dataset = <TyreRecord>[
        buildTyreRecord(
          id: '1',
          assetNo: 'TM514',
          serialNo: 'SN001',
          brand: 'Bridgestone',
        ),
      ];
      await _pump(
        tester,
        access: _admin,
        repo: FakeTyreRecordsRepository(dataset: dataset),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('TM514'));
      await tester.pumpAndSettle();

      expect(find.text('SN001'), findsOneWidget);
    });
  });
}
