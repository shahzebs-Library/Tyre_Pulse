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
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_page.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_query.dart';
import 'package:tyre_pulse/features/records/presentation/tyre_detail_sheet.dart';
import 'package:tyre_pulse/features/records/presentation/tyre_records_list_screen.dart';
import 'package:tyre_pulse/features/records/records_providers.dart';

import '../records_test_support.dart';

const AccessState _admin = AccessState(role: UserRole.known(RoleId.admin));
const AccessState _reporter = AccessState(
  role: UserRole.known(RoleId.reporter),
);

Future<FakeTyreRecordsRepository> _pump(
  WidgetTester tester, {
  required AccessState access,
  FakeTyreRecordsRepository? repo,
}) async {
  final FakeTyreRecordsRepository repository =
      repo ?? FakeTyreRecordsRepository();
  final ProviderContainer container = ProviderContainer(
    overrides: [
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
        'repository is never called', (WidgetTester tester) async {
      final FakeTyreRecordsRepository repo = await _pump(
        tester,
        access: _reporter,
      );
      await tester.pump();

      expect(find.byKey(TpStateKeys.permissionDenied), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(
        repo.fetchPageCalls,
        isEmpty,
        reason: 'ModuleKey.records is admin-only; a Reporter must be '
            'refused before the controller provider is ever read',
      );
    });

    testWidgets('the refusal names a reason a person can read', (
      WidgetTester tester,
    ) async {
      await _pump(tester, access: _reporter);
      await tester.pump();

      final TpPermissionDeniedState widget =
          tester.widget<TpPermissionDeniedState>(
        find.byType(TpPermissionDeniedState),
      );
      expect(widget.reason, isNotEmpty);
    });

    testWidgets('an admin is allowed through to the register', (
      WidgetTester tester,
    ) async {
      await _pump(tester, access: _admin);
      await tester.pumpAndSettle();

      expect(find.byKey(TpStateKeys.permissionDenied), findsNothing);
    });
  });

  group('loading', () {
    testWidgets('renders while the first page is in flight', (
      WidgetTester tester,
    ) async {
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
    testWidgets('renders when the query resolves with nothing', (
      WidgetTester tester,
    ) async {
      await _pump(tester, access: _admin, repo: FakeTyreRecordsRepository());
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
    testWidgets('a successful page renders one row per record', (
      WidgetTester tester,
    ) async {
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
      // Not find.text: each card's identifier draws through
      // TpIdentifierText, which wraps the value in invisible bidi isolate
      // marks (U+2066/U+2069) so it can never be reordered next to Arabic
      // or Urdu text - see tp_direction.dart. find.text does an exact
      // match against the rendered string and would find nothing;
      // textContaining matches the substring inside the isolate marks.
      // When a serial is unavailable the asset number is the honest title,
      // and it remains repeated in the asset metadata line below it.
      expect(find.textContaining('TM514'), findsNWidgets(2));
      expect(find.textContaining('TM515'), findsNWidgets(2));
    });

    testWidgets('tapping a row opens the detail sheet for that record', (
      WidgetTester tester,
    ) async {
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

      // Not find.text: see the identifier-isolate note above. Tapping any
      // point inside the card's tappable area triggers its onTap, so
      // hitting the (wrapped) identifier text works the same as it would
      // for a real finger tap on the visible glyphs.
      await tester.tap(find.textContaining('TM514'));
      await tester.pumpAndSettle();

      // The detail sheet's serial row draws through TpIdentifierText too,
      // AND the card behind the sheet still renders its own "brand ·
      // serial" text (a plain, non-identifier Text), so a bare
      // find.textContaining('SN001') now matches two widgets. Scoping to
      // the sheet is both what actually needs proving here (the sheet
      // opened for the right record) and what disambiguates the two.
      expect(
        find.descendant(
          of: find.byType(TyreDetailSheet),
          matching: find.textContaining('SN001'),
        ),
        findsOneWidget,
      );
    });
  });

  group('mock parity', () {
    testWidgets(
        'opens on Installed, states the exact count, and a tab switch '
        're-queries by the stored status', (WidgetTester tester) async {
      final FakeTyreRecordsRepository repo = FakeTyreRecordsRepository(
        dataset: <TyreRecord>[
          buildTyreRecord(
            id: '1',
            assetNo: 'PUMP014',
            serialNo: 'BRG2488421',
            brand: 'Bridgestone',
            status: kTyreStatusInstalled,
            tyrePosition: 'LHR5O',
            issueDate: '2026-03-01',
            kmAtFitment: 12000,
            totalKm: 41250,
          ),
        ],
      );
      await _pump(tester, access: _admin, repo: repo);
      await tester.pumpAndSettle();

      expect(repo.fetchPageCalls.first.query.status, kTyreStatusInstalled);
      expect(find.text('1 tyre'), findsOneWidget);
      expect(find.byKey(TyreRecordsListKeys.statusTabs), findsOneWidget);
      expect(find.textContaining('Showing installed tyres'), findsOneWidget);
      // Real values or a dash, never an invented tread or pressure.
      expect(find.text('2026-03-01'), findsOneWidget);
      expect(find.text('12,000 km'), findsOneWidget);
      expect(find.text('41,250 km'), findsOneWidget);
      expect(find.textContaining('LHR5O'), findsOneWidget);
      expect(find.textContaining('PSI'), findsNothing);
      expect(find.byKey(TyreRecordsListKeys.scanBar), findsOneWidget);
      expect(find.text('Add tyre record'), findsNothing);

      await tester.tap(find.text('Scrapped'));
      await tester.pumpAndSettle();
      expect(repo.fetchPageCalls.last.query.status, kTyreStatusScrapped);
      expect(repo.fetchCountCalls.last.status, kTyreStatusScrapped);

      await tester.tap(find.text('All'));
      await tester.pumpAndSettle();
      expect(repo.fetchPageCalls.last.query.status, isNull);
    });

    testWidgets('an unreadable count leaves the header without a number', (
      WidgetTester tester,
    ) async {
      final FakeTyreRecordsRepository repo = FakeTyreRecordsRepository(
        dataset: <TyreRecord>[buildTyreRecord(id: '1')],
      )..countResult = null;
      await _pump(tester, access: _admin, repo: repo);
      await tester.pumpAndSettle();
      expect(find.text('1 tyre'), findsNothing);
      expect(find.text('1 tyre record shown'), findsOneWidget);
    });

    testWidgets('the sort menu re-queries oldest fitted first', (
      WidgetTester tester,
    ) async {
      final FakeTyreRecordsRepository repo = FakeTyreRecordsRepository(
        dataset: <TyreRecord>[buildTyreRecord(id: '1')],
      );
      await _pump(tester, access: _admin, repo: repo);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(TyreRecordsListKeys.sortButton));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Oldest fitted').last);
      await tester.pumpAndSettle();
      expect(repo.fetchPageCalls.last.query.sort, TyreRecordsSort.oldestFitted);
    });
  });

  group('the load time belongs to one query', () {
    testWidgets(
      'a filter change whose first page fails shows no stale load time',
      (WidgetTester tester) async {
        final FakeTyreRecordsRepository repo = FakeTyreRecordsRepository(
          dataset: <TyreRecord>[buildTyreRecord(id: '1')],
        );
        await _pump(tester, access: _admin, repo: repo);
        await tester.pumpAndSettle();
        expect(find.textContaining('Loaded '), findsOneWidget);

        repo.queueFailure(
          const AppError(kind: AppErrorKind.validation, message: 'no'),
        );
        await tester.tap(
          find.descendant(
            of: find.byKey(TyreRecordsListKeys.statusTabs),
            matching: find.text('Removed'),
          ),
        );
        await tester.pumpAndSettle();

        expect(repo.fetchPageCalls.last.query.status, kTyreStatusRemoved);
        expect(find.byKey(TpStateKeys.error), findsOneWidget);
        expect(find.textContaining('Loaded '), findsNothing);
      },
    );
  });

  group('export', () {
    IconButton exportButton(WidgetTester tester) => tester.widget<IconButton>(
          find.byKey(TyreRecordsListKeys.exportAction),
        );

    testWidgets('is disabled while nothing has loaded', (
      WidgetTester tester,
    ) async {
      await _pump(tester, access: _admin, repo: FakeTyreRecordsRepository());
      await tester.pumpAndSettle();

      expect(exportButton(tester).onPressed, isNull);
    });

    testWidgets('is enabled once rows are on screen', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        access: _admin,
        repo: FakeTyreRecordsRepository(
          dataset: <TyreRecord>[buildTyreRecord(id: '1')],
        ),
      );
      await tester.pumpAndSettle();

      expect(exportButton(tester).onPressed, isNotNull);
      expect(exportButton(tester).tooltip, 'Export');
    });
  });
}
