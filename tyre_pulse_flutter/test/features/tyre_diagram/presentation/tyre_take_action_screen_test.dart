/// Widget coverage for [TyreTakeActionScreen] - the screen's own library
/// comment states its contract precisely: every row is either backed by a
/// real write path or honestly disabled, never a control that looks live
/// and does nothing (repository rule 7).
///
/// [TpCard] renders NO `InkWell` at all when its `onTap` is null (see
/// `tp_card.dart`), so "the four rows nothing backs are honestly disabled"
/// is provable directly: the count of `InkWell`s INSIDE THE ACTION LIST
/// must equal the count of ENABLED rows, exactly, or an honestly-disabled
/// row would have picked up a live tap surface by accident. Scoped to the
/// list body rather than the whole tree because [TpAppBar]'s own back
/// button is itself an `InkWell` and is not one of the action rows this
/// test is counting.
///
/// Remove tyre, Send to retread and Mark as spare have no real server
/// path for a field user and are therefore not rendered at all (see the
/// screen's library comment); Rotate tyre records a real
/// `tyre_service_events` row through an overridden repository here.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/tyre_diagram/data/tyre_service_event_repository.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_take_action_screen.dart';
import 'package:tyre_pulse/features/tyre_diagram/tyre_diagram_providers.dart';

import '../../../core/database/database_test_support.dart';

/// Captures every rotation instead of reaching Supabase; can be told to
/// fail with a given [AppError].
final class _FakeServiceEvents implements TyreServiceEventRepository {
  final List<RecordTyreRotationInput> rotations = <RecordTyreRotationInput>[];
  AppError? failWith;

  @override
  Future<void> recordRotation({
    required WorkspaceContext workspace,
    required RecordTyreRotationInput input,
  }) async {
    final AppError? error = failWith;
    if (error != null) throw error;
    rotations.add(input);
  }
}

const UserRole _testRole = UserRole.known(RoleId.tyreMan);
const AccessState _testAccess = AccessState(role: _testRole);

WorkspaceContext _workspace() {
  return const WorkspaceContext(
    userId: testUser,
    role: _testRole,
    effectivePermissions: _testAccess,
    countryScope: CountryScope.none,
    siteScope: SiteScope.none,
    companyId: workspaceA,
    tenantId: workspaceA,
    activeCountry: 'KSA',
  );
}

/// `/take-action` hosts the screen under test; `/tyre-change` is a stub
/// standing in for the real tyre-exchange flow (a different top-level
/// feature - out of this file's package boundary, same reasoning
/// `scanner_screen_test.dart`'s own library comment gives). It echoes back
/// the query parameters it was pushed with so a test can assert on them.
GoRouter _testRouter({
  VoidCallback? onAdjustReading,
  String? assetNo = 'TM514',
  String? tyreSerial = 'YMA55312',
}) {
  return GoRouter(
    initialLocation: '/take-action',
    routes: <RouteBase>[
      GoRoute(
        path: '/take-action',
        builder: (BuildContext context, GoRouterState state) =>
            TyreTakeActionScreen(
          positionCode: 'LHF1',
          assetNo: assetNo,
          siteName: 'NHC',
          tyreSerial: tyreSerial,
          onAdjustReading: onAdjustReading,
        ),
      ),
      GoRoute(
        path: '/tyre-change',
        builder: (BuildContext context, GoRouterState state) => Scaffold(
          body: Text('tyre change screen ${state.uri.queryParameters}'),
        ),
      ),
    ],
  );
}

/// A finder for [InkWell]s inside the action list itself, excluding the
/// app bar's own back-button InkWell. See the library comment.
final Finder _actionListInkWells = find.descendant(
  of: find.byType(ListView),
  matching: find.byType(InkWell),
);

Future<AppDatabase> _pumpTakeAction(
  WidgetTester tester, {
  VoidCallback? onAdjustReading,
  _FakeServiceEvents? serviceEvents,
  String? assetNo = 'TM514',
  String? tyreSerial = 'YMA55312',
}) async {
  // Seven rows plus an app bar do not all fit the default 800x600 test
  // surface, and `ListView` is a sliver - unlike the `Column`+
  // `SingleChildScrollView` combination elsewhere in this suite, a sliver
  // only BUILDS the rows that intersect the viewport plus its cache
  // extent, so a row genuinely below the fold does not exist as an
  // Element yet and cannot be found by any finder. Widen the surface
  // rather than the widget.
  tester.view.physicalSize = const Size(900, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  final AppDatabase db = newMemoryDatabase();
  addTearDown(db.close);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appDatabaseProvider.overrideWithValue(db),
        workspaceContextProvider.overrideWithValue(_workspace()),
        tyreServiceEventRepositoryProvider.overrideWithValue(
          serviceEvents ?? _FakeServiceEvents(),
        ),
      ],
      child: MaterialApp.router(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        routerConfig: _testRouter(
          onAdjustReading: onAdjustReading,
          assetNo: assetNo,
          tyreSerial: tyreSerial,
        ),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return db;
}

void main() {
  testWidgets(
      'the four backed action rows render, and the three with no real '
      'server path are not shown at all', (WidgetTester tester) async {
    await _pumpTakeAction(tester);

    expect(find.text('Replace tyre'), findsOneWidget);
    expect(find.text('Repair (Puncture / Damage)'), findsOneWidget);
    expect(find.text('Adjust reading'), findsOneWidget);
    expect(find.text('Rotate tyre'), findsOneWidget);
    expect(find.text('Remove tyre'), findsNothing);
    expect(find.text('Send to retread'), findsNothing);
    expect(find.text('Mark as spare'), findsNothing);
    expect(find.text('Not available in this build yet'), findsNothing);
  });

  testWidgets(
      'with no onAdjustReading, Replace, Report defect and Rotate are '
      'live and Adjust reading is honestly disabled', (
    WidgetTester tester,
  ) async {
    await _pumpTakeAction(tester);

    expect(
      find.text('Only available while filling in this inspection'),
      findsOneWidget,
    );
    expect(_actionListInkWells, findsNWidgets(3));
    expect(find.byIcon(Icons.chevron_right), findsNWidgets(3));
  });

  testWidgets(
      'Rotate tyre is hidden when the screen knows neither a serial nor '
      'an asset, because such an event could not be recorded', (
    WidgetTester tester,
  ) async {
    await _pumpTakeAction(tester, assetNo: null, tyreSerial: null);

    expect(find.text('Rotate tyre'), findsNothing);
    expect(_actionListInkWells, findsNWidgets(2));
  });

  testWidgets(
      'Rotate tyre records one rotation with the current position, the '
      'chosen destination and the caller context', (
    WidgetTester tester,
  ) async {
    final _FakeServiceEvents events = _FakeServiceEvents();
    await _pumpTakeAction(tester, serviceEvents: events);

    await tester.tap(find.text('Rotate tyre'));
    await tester.pumpAndSettle();

    final Finder toField = find.descendant(
      of: find.widgetWithText(TpInput, 'New position'),
      matching: find.byType(EditableText),
    );
    await tester.enterText(toField, 'RHF1');
    await tester.tap(find.text('Record rotation'));
    await tester.pump();
    await tester.pump();

    expect(find.text('Rotation recorded'), findsOneWidget);
    expect(events.rotations, hasLength(1));
    final RecordTyreRotationInput input = events.rotations.single;
    expect(input.fromPosition, 'LHF1');
    expect(input.toPosition, 'RHF1');
    expect(input.assetNo, 'TM514');
    expect(input.tyreSerial, 'YMA55312');
    expect(input.site, 'NHC');

    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
  });

  testWidgets('Rotate tyre refuses a blank or unchanged destination', (
    WidgetTester tester,
  ) async {
    final _FakeServiceEvents events = _FakeServiceEvents();
    await _pumpTakeAction(tester, serviceEvents: events);

    await tester.tap(find.text('Rotate tyre'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Record rotation'));
    await tester.pumpAndSettle();
    expect(find.text('New position needed'), findsOneWidget);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();

    final Finder toField = find.descendant(
      of: find.widgetWithText(TpInput, 'New position'),
      matching: find.byType(EditableText),
    );
    await tester.enterText(toField, 'lhf1');
    await tester.tap(find.text('Record rotation'));
    await tester.pumpAndSettle();
    expect(
      find.text('The new position must be different from the current one.'),
      findsOneWidget,
    );
    expect(events.rotations, isEmpty);
  });

  testWidgets('a rotation that fails offline says honestly it was NOT saved', (
    WidgetTester tester,
  ) async {
    final _FakeServiceEvents events = _FakeServiceEvents()
      ..failWith = const AppError.network();
    await _pumpTakeAction(tester, serviceEvents: events);

    await tester.tap(find.text('Rotate tyre'));
    await tester.pumpAndSettle();
    final Finder toField = find.descendant(
      of: find.widgetWithText(TpInput, 'New position'),
      matching: find.byType(EditableText),
    );
    await tester.enterText(toField, 'RHF1');
    await tester.tap(find.text('Record rotation'));
    await tester.pump();
    await tester.pump();

    expect(find.text('Rotation not saved'), findsOneWidget);
    expect(
      find.textContaining('Rotations are saved online only'),
      findsOneWidget,
    );
    expect(events.rotations, isEmpty);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
  });

  testWidgets(
      'supplying onAdjustReading makes that ONE row live too, and only '
      'that one', (WidgetTester tester) async {
    bool invoked = false;
    await _pumpTakeAction(
      tester,
      onAdjustReading: () => invoked = true,
    );

    expect(
      find.text('Update pressure, tread depth or condition'),
      findsOneWidget,
    );
    expect(_actionListInkWells, findsNWidgets(4));

    await tester.tap(
      find.ancestor(
        of: find.text('Adjust reading'),
        matching: find.byType(TpCard),
      ),
    );
    await tester.pump();

    expect(invoked, isTrue);
  });

  testWidgets(
      'tapping Replace tyre pushes the real tyre-change route with '
      'the asset, site and position this screen was opened with', (
    WidgetTester tester,
  ) async {
    await _pumpTakeAction(tester);

    await tester.tap(find.text('Replace tyre'));
    await tester.pumpAndSettle();

    expect(
      find.text(
        'tyre change screen '
        '{assetNo: TM514, siteName: NHC, tyrePosition: LHF1}',
      ),
      findsOneWidget,
    );
  });

  testWidgets(
      'tapping Report defect opens a pre-filled form, and a real '
      'defect report queues through the same command the repository test '
      'pins', (WidgetTester tester) async {
    final AppDatabase db = await _pumpTakeAction(tester);

    await tester.tap(find.text('Repair (Puncture / Damage)'));
    await tester.pumpAndSettle();

    expect(find.text('Report a defect'), findsOneWidget);
    // Pre-filled from the caller's own asset + position, per
    // `_ReportDefectFormState.initState`.
    expect(find.widgetWithText(TpInput, 'Title'), findsOneWidget);
    expect(find.text('TM514 LHF1'), findsOneWidget);

    // NOT `pumpAndSettle`: `_submit` sets `isBusy: true` on the submit
    // button while the write + confirmation dialog are in flight, and an
    // indeterminate `CircularProgressIndicator` never stops animating on
    // its own - `pumpAndSettle` would spin until it times out. Pump the
    // frame the tap schedules, then the frame the (near-instant, in-memory)
    // repository write's completion schedules.
    await tester.tap(find.text('Submit repair request'));
    await tester.pump();
    await tester.pump();

    expect(find.text('Repair request saved'), findsOneWidget);

    final List<PendingCommand> queued = await db.queueDao.outstandingCommands(
      workspaceId: workspaceA,
    );
    expect(queued, hasLength(1));
    expect(queued.single.entityType, 'corrective_actions');

    // Dismissing the confirmation is what actually clears `_submitting` -
    // only now is it safe to let every animation run to rest.
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
  });

  testWidgets('an empty title is refused rather than silently queued', (
    WidgetTester tester,
  ) async {
    final AppDatabase db = await _pumpTakeAction(tester);

    await tester.tap(find.text('Repair (Puncture / Damage)'));
    await tester.pumpAndSettle();

    final Finder titleField = find.descendant(
      of: find.widgetWithText(TpInput, 'Title'),
      matching: find.byType(EditableText),
    );
    await tester.enterText(titleField, '   ');
    await tester.tap(find.text('Submit repair request'));
    await tester.pumpAndSettle();

    expect(find.text('Title needed'), findsOneWidget);
    final List<PendingCommand> queued = await db.queueDao.outstandingCommands(
      workspaceId: workspaceA,
    );
    expect(queued, isEmpty);
  });
}
