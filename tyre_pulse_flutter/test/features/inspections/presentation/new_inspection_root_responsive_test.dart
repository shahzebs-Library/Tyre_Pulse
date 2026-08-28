import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_remote_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_record.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/inspections/presentation/controllers/inspection_wizard_controller.dart';
import 'package:tyre_pulse/features/inspections/presentation/new_inspection_screen.dart';
import 'package:tyre_pulse/features/inspections/presentation/state/inspection_wizard_state.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/tyre_position_editor_sheet.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_board.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/vehicle_tyre_diagram.dart';

const List<String> _tmPositions = <String>[
  'F1L',
  'F1R',
  'F2L',
  'F2R',
  'R1Lo',
  'R1Li',
  'R1Ri',
  'R1Ro',
  'R2Lo',
  'R2Li',
  'R2Ri',
  'R2Ro',
];

Future<void> _pumpScreen(
  WidgetTester tester, {
  Locale locale = const Locale('en'),
  Size size = const Size(320, 720),
  InspectionWizardState initialState = const InspectionWizardState(),
  List<Override> extraOverrides = const <Override>[],
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        inspectionWizardControllerProvider.overrideWithBuild(
          (ref, controller) => initialState,
        ),
        inspectionRemoteRepositoryProvider.overrideWithValue(
          const _FakeInspectionRemoteRepository(),
        ),
        ...extraOverrides,
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const NewInspectionScreen(route: NewInspectionRoute()),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets(
    'resume rows distinguish not started, in progress and ready for review',
    (WidgetTester tester) async {
      await _pumpScreen(
        tester,
        size: const Size(390, 1200),
        initialState: InspectionWizardState(
          unfinishedDrafts: <InspectionDraftSummary>[
            InspectionDraftSummary(
              draftKey: 'draft-tm749',
              assetNo: 'TM749',
              filled: 0,
              total: 12,
              updatedAt: DateTime.utc(2026, 8, 28),
            ),
            InspectionDraftSummary(
              draftKey: 'draft-lp201',
              assetNo: 'LP201',
              filled: 3,
              total: 12,
              updatedAt: DateTime.utc(2026, 8, 27),
            ),
            InspectionDraftSummary(
              draftKey: 'draft-mp300',
              assetNo: 'MP300',
              filled: 14,
              total: 14,
              updatedAt: DateTime.utc(2026, 8, 26),
            ),
          ],
        ),
      );

      expect(
        tester
            .widget<Text>(
              find.byKey(NewInspectionScreenKeys.resumeWorkflow('TM749')),
            )
            .data,
        'Not started • 0 of 12 checked',
      );
      expect(
        tester
            .widget<Text>(
              find.byKey(NewInspectionScreenKeys.resumeWorkflow('LP201')),
            )
            .data,
        'In progress • 3 of 12 checked',
      );
      expect(
        tester
            .widget<Text>(
              find.byKey(NewInspectionScreenKeys.resumeWorkflow('MP300')),
            )
            .data,
        'Ready for review • 14 of 14 checked',
      );
      expect(find.textContaining('tyres recorded'), findsNothing);
    },
  );

  testWidgets(
    'untouched TM749 is Not started and keeps its exact mixer topology',
    (WidgetTester tester) async {
      await _pumpScreen(
        tester,
        size: const Size(390, 900),
        initialState: InspectionWizardState(
          step: InspectionWizardStep.tyres,
          selectedAssetNo: 'TM749',
          selectedVehicleType: '',
          selectedSite: 'Site A',
          positions: _tmPositions,
          tyreConditions: <String, TyrePositionReading>{
            for (final String position in _tmPositions)
              position: TyrePositionReading.seed(position),
          },
        ),
      );

      final TpStatusChip status = tester.widget<TpStatusChip>(
        find.byKey(NewInspectionScreenKeys.tyreWorkflowStatus),
      );
      expect(status.status, TpStatus.unknown);
      expect(status.label, 'Not started');
      expect(
        tester
            .widget<Text>(
              find.byKey(NewInspectionScreenKeys.tyreWorkflowProgress),
            )
            .data,
        '0 of 12 checked',
      );
      expect(
        tester
            .widget<Text>(
              find.byKey(NewInspectionScreenKeys.tyreWorkflowHelper),
            )
            .data,
        'Tap a tyre to add inspection details.',
      );

      final TyreDiagramBoard board = tester.widget<TyreDiagramBoard>(
        find.byKey(NewInspectionScreenKeys.tyreDiagramBoard),
      );
      expect(board.vehicleType, 'Tri-mixer');
      expect(board.positions, _tmPositions);
      expect(board.tyreData, isEmpty);
      expect(find.textContaining('tyres recorded'), findsNothing);
    },
  );

  testWidgets('one checked TM749 tyre is In progress, not a result', (
    WidgetTester tester,
  ) async {
    await _pumpScreen(
      tester,
      size: const Size(390, 900),
      initialState: InspectionWizardState(
        step: InspectionWizardStep.tyres,
        selectedAssetNo: 'TM749',
        selectedVehicleType: '',
        selectedSite: 'Site A',
        positions: _tmPositions,
        tyreConditions: <String, TyrePositionReading>{
          for (final String position in _tmPositions)
            position: position == 'F1L'
                ? const TyrePositionReading(
                    position: 'F1L',
                    checked: true,
                  )
                : TyrePositionReading.seed(position),
        },
      ),
    );

    final TpStatusChip status = tester.widget<TpStatusChip>(
      find.byKey(NewInspectionScreenKeys.tyreWorkflowStatus),
    );
    expect(status.status, TpStatus.info);
    expect(status.label, 'In progress');
    expect(find.text('1 of 12 checked'), findsOneWidget);
    expect(
      tester
          .widget<Text>(
            find.byKey(NewInspectionScreenKeys.tyreWorkflowHelper),
          )
          .data,
      'Continue checking tyre positions until each has enough detail.',
    );
    final TyreDiagramBoard board = tester.widget<TyreDiagramBoard>(
      find.byKey(NewInspectionScreenKeys.tyreDiagramBoard),
    );
    expect(board.tyreData.keys, <String>['F1L']);
  });

  testWidgets(
    'map step follows the approved hierarchy with truthful selected data',
    (WidgetTester tester) async {
      await _pumpScreen(
        tester,
        size: const Size(390, 1100),
        initialState: InspectionWizardState(
          step: InspectionWizardStep.tyres,
          selectedAssetNo: 'TM749',
          selectedVehicleType: '',
          selectedSite: 'Site A',
          positions: _tmPositions,
          tyreConditions: <String, TyrePositionReading>{
            for (final String position in _tmPositions)
              position: position == 'F1L'
                  ? const TyrePositionReading(
                      position: 'F1L',
                      pressurePsi: 118,
                      treadDepthMm: 7.5,
                      condition: TyreReadingCondition.damaged,
                      checked: true,
                    )
                  : TyrePositionReading.seed(position),
          },
        ),
      );

      expect(find.text('Inspection'), findsOneWidget);
      expect(find.byKey(NewInspectionScreenKeys.tyreDraftChip), findsOneWidget);
      expect(find.text('12-Tyre Configuration'), findsOneWidget);
      expect(find.text('Step 2 of 4'), findsOneWidget);
      expect(find.text('FRONT'), findsOneWidget);
      expect(find.text('REAR'), findsOneWidget);
      expect(
        find.byKey(NewInspectionScreenKeys.tyreSelectedCard),
        findsOneWidget,
      );
      expect(find.text('118 PSI'), findsOneWidget);
      expect(find.text('7.5 mm'), findsOneWidget);
      expect(
        find.byKey(NewInspectionScreenKeys.tyreEvidenceRow),
        findsOneWidget,
      );
      expect(find.text('Add Evidence (Photo)'), findsOneWidget);
      expect(find.text('Save & Next'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'concrete pump keeps 14 real positions and visible inner outer labels',
    (WidgetTester tester) async {
      final List<String> positions = diagramPositions('Concrete pump');
      await _pumpScreen(
        tester,
        size: const Size(390, 1100),
        initialState: InspectionWizardState(
          step: InspectionWizardStep.tyres,
          selectedAssetNo: 'MP2104',
          selectedVehicleType: 'Concrete pump',
          selectedSite: 'Site A',
          positions: positions,
          tyreConditions: <String, TyrePositionReading>{
            for (final String position in positions)
              position: TyrePositionReading.seed(position),
          },
        ),
      );

      final TyreDiagramBoard board = tester.widget<TyreDiagramBoard>(
        find.byKey(NewInspectionScreenKeys.tyreDiagramBoard),
      );
      final Set<String> visibleIdentifiers = tester
          .widgetList<TpIdentifierText>(find.byType(TpIdentifierText))
          .map((TpIdentifierText text) => text.value)
          .toSet();
      expect(board.positions, hasLength(14));
      expect(board.captureMode, isTrue);
      expect(find.text('14-Tyre Configuration'), findsOneWidget);
      expect(
        visibleIdentifiers,
        containsAll(<String>['L1 I', 'L1 O', 'R1 I', 'R1 O']),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('fully checked TM749 is Ready for review', (
    WidgetTester tester,
  ) async {
    await _pumpScreen(
      tester,
      size: const Size(390, 900),
      initialState: InspectionWizardState(
        step: InspectionWizardStep.tyres,
        selectedAssetNo: 'TM749',
        selectedVehicleType: '',
        selectedSite: 'Site A',
        positions: _tmPositions,
        tyreConditions: <String, TyrePositionReading>{
          for (final String position in _tmPositions)
            position: TyrePositionReading(
              position: position,
              checked: true,
            ),
        },
      ),
    );

    final TpStatusChip status = tester.widget<TpStatusChip>(
      find.byKey(NewInspectionScreenKeys.tyreWorkflowStatus),
    );
    expect(status.status, TpStatus.ok);
    expect(status.label, 'Ready for review');
    expect(find.text('12 of 12 checked'), findsOneWidget);
    expect(
      find.text(
        'All tyre positions are checked. Review and sign is ready.',
      ),
      findsOneWidget,
    );
    final TpButton reviewButton = tester.widget<TpButton>(
      find.widgetWithText(TpButton, 'Save & Next'),
    );
    expect(reviewButton.onPressed, isNotNull);
  });

  testWidgets('compact root step stacks meter inputs without clipping', (
    WidgetTester tester,
  ) async {
    await _pumpScreen(tester);

    expect(find.byKey(NewInspectionScreenKeys.headerHero), findsOneWidget);
    expect(find.byKey(NewInspectionScreenKeys.vehicleSection), findsOneWidget);
    expect(find.byKey(NewInspectionScreenKeys.detailsSection), findsOneWidget);

    final Rect odometer = tester.getRect(
      find.byKey(NewInspectionScreenKeys.odometerField),
    );
    final Rect hourMeter = tester.getRect(
      find.byKey(NewInspectionScreenKeys.hourMeterField),
    );
    expect(hourMeter.top, greaterThan(odometer.bottom));
    expect(hourMeter.width, closeTo(odometer.width, 0.01));
    expect(tester.takeException(), isNull);
  });

  testWidgets('Arabic root step keeps responsive sections in RTL', (
    WidgetTester tester,
  ) async {
    await _pumpScreen(tester, locale: const Locale('ar'));

    final Finder hero = find.byKey(NewInspectionScreenKeys.headerHero);
    final Directionality directionality = tester.widget<Directionality>(
      find.ancestor(of: hero, matching: find.byType(Directionality)).first,
    );
    expect(directionality.textDirection, TextDirection.rtl);
    expect(find.byKey(NewInspectionScreenKeys.detailsSection), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'manual asset resolution keeps selected card and section icon consistent',
    (WidgetTester tester) async {
      await _pumpScreen(
        tester,
        initialState: const InspectionWizardState(
          selectedAssetNo: 'WL42',
          selectedVehicleType: '',
          selectedSite: 'Site A',
        ),
      );

      expect(
        find.byKey(NewInspectionScreenKeys.selectedVehicleClass),
        findsOneWidget,
      );
      expect(find.text('Wheel loader'), findsOneWidget);
      final Icon classIcon = tester.widget<Icon>(
        find.byKey(NewInspectionScreenKeys.vehicleSectionIcon),
      );
      expect(classIcon.icon, Icons.precision_manufacturing_outlined);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('resumed draft shows the class resolved from its asset number', (
    WidgetTester tester,
  ) async {
    await _pumpScreen(
      tester,
      initialState: InspectionWizardState(
        unfinishedDrafts: <InspectionDraftSummary>[
          InspectionDraftSummary(
            draftKey: 'draft-mp',
            assetNo: 'MP2104',
            filled: 3,
            total: 14,
            updatedAt: DateTime.utc(2026, 8, 28),
          ),
        ],
      ),
    );

    final Finder resolvedClass = find.byKey(
      NewInspectionScreenKeys.resumeVehicleClass('MP2104'),
    );
    expect(resolvedClass, findsOneWidget);
    expect(tester.widget<Text>(resolvedClass).data, 'Concrete pump');
  });

  testWidgets('fleet picker renders the same resolver class as the diagram', (
    WidgetTester tester,
  ) async {
    await _pumpScreen(
      tester,
      extraOverrides: <Override>[
        vehicleFleetListProvider.overrideWith(
          (ref) async => const VehicleFleetListLoaded(
            assets: <VehicleAsset>[
              VehicleAsset(
                id: 'pump-1',
                assetNo: 'MP2104',
                vehicleType: 'HEAVY EQP',
              ),
            ],
            truncated: false,
          ),
        ),
      ],
    );

    await tester.enterText(find.byType(TextField).first, 'MP2104');
    await tester.pumpAndSettle();

    final Finder resolvedClass = find.byKey(
      NewInspectionScreenKeys.pickerVehicleClass('MP2104'),
    );
    expect(resolvedClass, findsOneWidget);
    expect(tester.widget<Text>(resolvedClass).data, 'Concrete pump');
  });

  testWidgets('fleet picker collapses duplicate rows for one asset number', (
    WidgetTester tester,
  ) async {
    await _pumpScreen(
      tester,
      extraOverrides: <Override>[
        vehicleFleetListProvider.overrideWith(
          (ref) async => const VehicleFleetListLoaded(
            assets: <VehicleAsset>[
              VehicleAsset(
                id: 'mixer-primary',
                assetNo: 'TM749',
                vehicleType: 'Tr-Mixer',
              ),
              VehicleAsset(
                id: 'mixer-duplicate',
                assetNo: 'tm749',
                vehicleType: 'Tr-Mixer',
              ),
            ],
            truncated: false,
          ),
        ),
      ],
    );

    await tester.enterText(find.byType(TextField).first, 'TM749');
    await tester.pumpAndSettle();

    expect(
      find.byKey(NewInspectionScreenKeys.pickerVehicleClass('TM749')),
      findsOneWidget,
    );
    expect(find.text('TM749'), findsOneWidget);
    expect(find.text('tm749'), findsNothing);
  });

  testWidgets(
    'resumed tyre step passes one resolved class to context and diagram',
    (WidgetTester tester) async {
      const List<String> positions = <String>[
        'F1L',
        'F1R',
        'F2L',
        'F2R',
        'R1Lo',
        'R1Li',
        'R1Ri',
        'R1Ro',
        'R2Lo',
        'R2Li',
        'R2Ri',
        'R2Ro',
      ];
      await _pumpScreen(
        tester,
        size: const Size(390, 900),
        initialState: InspectionWizardState(
          step: InspectionWizardStep.tyres,
          selectedAssetNo: 'TM4271',
          selectedVehicleType: '',
          selectedSite: 'Qiddiya G2',
          positions: positions,
          tyreConditions: <String, TyrePositionReading>{
            for (final String position in positions)
              position: TyrePositionReading.seed(position),
          },
        ),
      );

      final Finder contextClass = find.byKey(
        NewInspectionScreenKeys.tyreContextVehicleClass,
      );
      expect(tester.widget<Text>(contextClass).data, 'Tri-mixer');
      final TyreDiagramBoard board = tester.widget<TyreDiagramBoard>(
        find.byKey(NewInspectionScreenKeys.tyreDiagramBoard),
      );
      expect(board.vehicleType, 'Tri-mixer');
      expect(board.onPositionTap, isNotNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('wide phone keeps the complete compact mixer map bounded', (
    WidgetTester tester,
  ) async {
    const List<String> positions = <String>[
      'F1L',
      'F1R',
      'F2L',
      'F2R',
      'R1Lo',
      'R1Li',
      'R1Ri',
      'R1Ro',
      'R2Lo',
      'R2Li',
      'R2Ri',
      'R2Ro',
    ];
    await _pumpScreen(
      tester,
      size: const Size(720, 1560),
      initialState: InspectionWizardState(
        step: InspectionWizardStep.tyres,
        selectedAssetNo: 'TM749',
        selectedVehicleType: '',
        selectedSite: 'Site A',
        positions: positions,
        tyreConditions: <String, TyrePositionReading>{
          for (final String position in positions)
            position: TyrePositionReading.seed(position),
        },
      ),
    );

    final TyreDiagramBoard board = tester.widget<TyreDiagramBoard>(
      find.byKey(NewInspectionScreenKeys.tyreDiagramBoard),
    );
    final VehicleTyreDiagram diagram = tester.widget<VehicleTyreDiagram>(
      find.byType(VehicleTyreDiagram),
    );
    expect(board.width, 380);
    expect(diagram.width, lessThanOrEqualTo(380));
    expect(
      tester.getBottomRight(find.byType(VehicleTyreDiagram)).dy,
      lessThan(tester.getTopLeft(find.text('Save & Next')).dy),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('an untouched wheel still opens the add-details sheet', (
    WidgetTester tester,
  ) async {
    const List<String> positions = <String>['FL', 'FR', 'RL', 'RR'];
    await _pumpScreen(
      tester,
      size: const Size(390, 900),
      initialState: InspectionWizardState(
        step: InspectionWizardStep.tyres,
        selectedAssetNo: 'PL101',
        selectedVehicleType: '',
        selectedSite: 'Site A',
        positions: positions,
        tyreConditions: <String, TyrePositionReading>{
          for (final String position in positions)
            position: TyrePositionReading.seed(position),
        },
      ),
    );

    final Finder wheelTargets = find.descendant(
      of: find.byKey(NewInspectionScreenKeys.tyreDiagramBoard),
      matching: find.byType(GestureDetector),
    );
    expect(wheelTargets, findsNWidgets(4));
    await tester.ensureVisible(wheelTargets.first);
    await tester.tap(wheelTargets.first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.byType(TyrePositionEditorSheet), findsOneWidget);
  });
}

final class _FakeInspectionRemoteRepository
    implements InspectionRemoteRepository {
  const _FakeInspectionRemoteRepository();

  @override
  Future<InspectionRecord?> byId(String id) async => null;

  @override
  Future<List<String>> listSites({String? country}) async =>
      const <String>['Site A'];

  @override
  Future<List<InspectionRecord>> myInspections({
    required String createdBy,
    int limit = 100,
  }) async =>
      const <InspectionRecord>[];

  @override
  Future<void> upsertInspection({
    required InspectionPayload payload,
    required String clientUuid,
  }) async {}
}
