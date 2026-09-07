import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_report_draft_store.dart';
import 'package:tyre_pulse/features/accidents/data/accident_report_repository.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_report_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_report_intake_widgets.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';

const WorkspaceContext _workspace = WorkspaceContext(
  userId: 'reporter-1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.admin)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  tenantId: 'workspace-1',
  companyId: 'workspace-1',
  activeCountry: 'KSA',
  fullName: 'Fleet Reporter',
);

const VehicleAsset _pump = VehicleAsset(
  id: 'pump-5-axle',
  assetNo: 'CP3012',
  make: 'SANY',
  model: 'SYG5360THB',
  vehicleType: 'SANY Concrete Pump 5 axle',
  site: 'Diriyah',
  status: 'Active',
  operatorName: 'Driver One',
  currentKm: 128400,
  registrationNo: 'ABC 1234',
);

void main() {
  testWidgets('inline fleet search selects real asset without a picker sheet',
      (WidgetTester tester) async {
    await _pumpReport(
      tester,
      store: _MemorySecureStore(),
      reports: _FakeReportRepository(),
    );
    final Finder search =
        find.byKey(const ValueKey<String>('accident.report.assetSearch'));
    await tester.ensureVisible(search);
    await tester.enterText(search, 'NO-MATCH');
    await tester.pump();
    expect(find.text('No matching fleet asset'), findsOneWidget);
    await tester.enterText(search, 'CP3012');
    await tester.pump();
    final Finder result = find.widgetWithText(ListTile, 'CP3012');
    await tester.ensureVisible(result);
    await tester.tap(result);
    await tester.pumpAndSettle();
    expect(tester.widget<ListTile>(result).selected, isTrue);
    expect(find.byKey(AccidentReportIntakeKeys.assetMaster), findsOneWidget);
    expect(find.text('Country'), findsOneWidget);
    expect(find.text('Where did the incident occur?'), findsOneWidget);
  });

  for (final bool failSave in <bool>[false, true]) {
    testWidgets('Save and exit preserves draft; failure=$failSave',
        (WidgetTester tester) async {
      final _MemorySecureStore store = _MemorySecureStore();
      final _FakeReportRepository reports = _FakeReportRepository();
      await _pumpReport(tester, store: store, reports: reports, pushed: true);
      store.failWrites = failSave;
      await tester.tap(
        find.byKey(const ValueKey<String>('accident.report.saveAndExit')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byType(AccidentReportScreen),
        failSave ? findsOneWidget : findsNothing,
      );
      if (failSave) {
        expect(find.text('Draft save failed'), findsOneWidget);
      } else {
        expect(
          store.values.containsKey(AccidentReportDraftStore.storageKey),
          isTrue,
        );
      }
      expect(reports.submitCalls, 0);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('all seven sections are visible and documents stay separate',
      (WidgetTester tester) async {
    await _pumpReport(
      tester,
      store: _MemorySecureStore(),
      reports: _FakeReportRepository(),
    );
    for (final AccidentIntakePage page in AccidentIntakePage.values) {
      final Finder step = find.byKey(AccidentReportIntakeKeys.step(page));
      expect(step.hitTestable(), findsOneWidget);
    }
    await tester.tap(
      find.byKey(AccidentReportIntakeKeys.step(AccidentIntakePage.documents)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Step 6 of 7'), findsOneWidget);
    expect(find.byType(AccidentOptionalDocumentList), findsOneWidget);
    expect(find.byType(AccidentEvidenceChecklist), findsNothing);
    await tester
        .tap(find.byKey(const ValueKey<String>('accident.report.continue')));
    await tester.pumpAndSettle();
    expect(find.text('Step 7 of 7'), findsOneWidget);
    expect(find.text('Submit accident'), findsOneWidget);
  });

  testWidgets('fleet photo and all master fields fit a narrow RTL phone',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(320, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    bool changed = false;
    await tester.pumpWidget(
      MaterialApp(
        theme: TpTheme.light,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            body: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: AccidentFleetMasterCard(
                asset: _pump,
                onChange: () => changed = true,
                changeLabel: 'Change asset',
                unavailableLabel: 'Not recorded',
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final Finder photo = find.byKey(
      const ValueKey<String>('accident.report.assetPhoto'),
    );
    expect(tester.getSize(photo).height, 164);
    final Image image = tester.widget<Image>(
      find.descendant(of: photo, matching: find.byType(Image)),
    );
    expect(
      (image.image as AssetImage).assetName,
      'assets/vehicle_photos/concrete_pump.png',
    );
    expect(find.text('Assigned driver'), findsOneWidget);
    await tester.tap(find.text('Change asset'));
    expect(changed, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('seven-step intake selects a real fleet master and saves draft',
      (WidgetTester tester) async {
    final _MemorySecureStore store = _MemorySecureStore();
    final _FakeReportRepository reports = _FakeReportRepository();
    await _pumpReport(tester, store: store, reports: reports);

    for (final AccidentIntakePage step in AccidentIntakePage.values) {
      expect(
        find.byKey(AccidentReportIntakeKeys.step(step)),
        findsOneWidget,
      );
    }
    expect(find.text('Step 1 of 7'), findsOneWidget);
    expect(find.text('Scan QR / barcode'), findsOneWidget);

    await tester.ensureVisible(find.text('Select fleet asset'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Select fleet asset'));
    await tester.pumpAndSettle();
    final Image vehicleImage = tester.widget<Image>(
      find.byType(Image).first,
    );
    expect(
      (vehicleImage.image as AssetImage).assetName,
      'assets/vehicle_photos/concrete_pump.png',
    );
    await tester.tap(find.widgetWithText(ListTile, 'CP3012').last);
    await tester.pumpAndSettle();

    expect(
      find.byKey(AccidentReportIntakeKeys.assetMaster),
      findsOneWidget,
    );
    expect(find.text('Asset no.'), findsOneWidget);
    expect(find.text('Plate'), findsOneWidget);
    expect(find.text('Vehicle type'), findsOneWidget);
    expect(find.text('Home site'), findsOneWidget);
    expect(find.text('Current meter'), findsOneWidget);
    expect(find.text('Fleet status'), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 800));
    await tester.pumpAndSettle();
    expect(find.textContaining('Draft saved'), findsOneWidget);
    expect(
      store.values.containsKey(AccidentReportDraftStore.storageKey),
      isTrue,
    );
    expect(reports.submitCalls, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Save and Continue validates then advances without submitting',
      (WidgetTester tester) async {
    final _MemorySecureStore store = _MemorySecureStore();
    final _FakeReportRepository reports = _FakeReportRepository();
    await _pumpReport(tester, store: store, reports: reports);

    await tester
        .tap(find.byKey(const ValueKey<String>('accident.report.continue')));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Select a fleet asset or enter an asset number.'),
      findsWidgets,
    );

    await tester.ensureVisible(find.text('Select fleet asset'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Select fleet asset'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'CP3012').last);
    await tester.pumpAndSettle();
    await tester
        .tap(find.byKey(const ValueKey<String>('accident.report.continue')));
    await tester.pumpAndSettle();
    expect(find.text('Step 2 of 7'), findsOneWidget);
    await tester.ensureVisible(
      find.byType(DropdownButtonFormField<String>).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Collision').last);
    await tester.pumpAndSettle();
    final Finder narrative = find.byWidgetPredicate(
      (Widget widget) =>
          widget is TextField &&
          widget.decoration?.hintText ==
              'Describe the sequence of events and immediate conditions',
    );
    await tester.drag(find.byType(ListView), const Offset(0, -500));
    await tester.pumpAndSettle();
    await tester.enterText(
      narrative,
      'Vehicle contacted a fixed barrier while reversing.',
    );
    await tester
        .tap(find.byKey(const ValueKey<String>('accident.report.continue')));
    await tester.pumpAndSettle();

    expect(find.text('Step 3 of 7'), findsOneWidget);
    expect(find.text('Driver name'), findsOneWidget);
    expect(find.text('Incident site'), findsNothing);
    expect(reports.submitCalls, 0);
    expect(tester.takeException(), isNull);
  });
}

Future<void> _pumpReport(
  WidgetTester tester, {
  required _MemorySecureStore store,
  required _FakeReportRepository reports,
  bool pushed = false,
}) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workspaceContextProvider.overrideWithValue(_workspace),
        secureStoreProvider.overrideWithValue(store),
        accidentReportRepositoryProvider.overrideWithValue(reports),
        vehicleFleetListProvider.overrideWith(
          (Ref ref) async => const VehicleFleetListLoaded(
            assets: <VehicleAsset>[_pump],
            truncated: false,
          ),
        ),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: pushed
            ? Builder(
                builder: (BuildContext context) => Scaffold(
                  body: TextButton(
                    onPressed: () async {
                      await Navigator.of(context).push<void>(
                        MaterialPageRoute<void>(
                          builder: (_) => const AccidentReportScreen(
                            route: AccidentReportRoute(),
                          ),
                        ),
                      );
                    },
                    child: const Text('Open report'),
                  ),
                ),
              )
            : const AccidentReportScreen(route: AccidentReportRoute()),
      ),
    ),
  );
  await tester.pumpAndSettle();
  if (pushed) {
    await tester.tap(find.text('Open report'));
    await tester.pumpAndSettle();
  }
}

final class _FakeReportRepository implements AccidentReportRepository {
  int submitCalls = 0;

  @override
  Future<Set<String>> submit({
    required WorkspaceContext workspace,
    required SubmitAccidentReportInput input,
  }) async {
    submitCalls++;
    return const <String>{};
  }
}

final class _MemorySecureStore extends SecureKeyValueStore {
  final Map<String, String> values = <String, String>{};
  bool failWrites = false;

  @override
  int get readFailureCount => 0;

  @override
  Future<SecureRead> read(String key) async {
    final String? value = values[key];
    return value == null ? const SecureRead.absent() : SecureRead.ok(value);
  }

  @override
  Future<void> write(String key, String value) async {
    if (failWrites) throw StateError('Device storage unavailable');
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    values.remove(key);
  }
}
