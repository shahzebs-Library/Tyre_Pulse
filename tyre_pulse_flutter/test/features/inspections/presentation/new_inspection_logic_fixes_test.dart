/// Widget-level pins for the New Inspection fixes that live in the screen:
/// state-seeded inputs (P1-10), the meter validation message (P0-4), the
/// manual vehicle-type choice (P1-8) and the fitted serial shown as a hint
/// rather than as a value the reading never carried (P1-11).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_capture.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_remote_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_record.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/inspections/presentation/controllers/inspection_wizard_controller.dart';
import 'package:tyre_pulse/features/inspections/presentation/new_inspection_screen.dart';
import 'package:tyre_pulse/features/inspections/presentation/state/inspection_wizard_state.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/tyre_position_editor_sheet.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';

final class _Remote implements InspectionRemoteRepository {
  const _Remote();

  @override
  Future<List<String>> listSites({String? country}) async => const <String>[];

  @override
  Future<void> upsertInspection({
    required InspectionPayload payload,
    required String clientUuid,
  }) async {}

  @override
  Future<InspectionRecord?> byId(String id) async => null;

  @override
  Future<List<InspectionRecord>> myInspections({
    required String createdBy,
    int limit = 100,
  }) async =>
      const <InspectionRecord>[];
}

Future<void> _pump(
  WidgetTester tester,
  InspectionWizardState initial,
) async {
  tester.view.physicalSize = const Size(420, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        inspectionWizardControllerProvider.overrideWithBuild(
          (ref, controller) => initial,
        ),
        inspectionRemoteRepositoryProvider.overrideWithValue(const _Remote()),
        vehicleFleetListProvider.overrideWith(
          (ref) async => const VehicleFleetListLoaded(
            assets: <VehicleAsset>[],
            truncated: false,
          ),
        ),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const NewInspectionScreen(route: NewInspectionRoute()),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

String _fieldText(WidgetTester tester, Key key) {
  final TextField field = tester.widget<TextField>(
    find.descendant(of: find.byKey(key), matching: find.byType(TextField)),
  );
  return field.controller!.text;
}

void main() {
  testWidgets(
      'P1-10 odometer and hour meter show the values held in state (resume / '
      'coming back to the step), not a blank box', (WidgetTester tester) async {
    await _pump(
      tester,
      const InspectionWizardState(
        draftKey: 'u|TM514',
        selectedAssetNo: 'TM514',
        selectedVehicleType: 'TR-MIXER',
        selectedSite: 'NHC',
        odometerText: '145200',
        hourMeterText: '812.5',
      ),
    );

    expect(_fieldText(tester, NewInspectionScreenKeys.odometerField), '145200');
    expect(_fieldText(tester, NewInspectionScreenKeys.hourMeterField), '812.5');
  });

  testWidgets('P0-4 an unreadable odometer shows a validation message',
      (WidgetTester tester) async {
    await _pump(
      tester,
      const InspectionWizardState(
        draftKey: 'u|TM514',
        selectedAssetNo: 'TM514',
        selectedVehicleType: 'TR-MIXER',
        selectedSite: 'NHC',
        odometerText: '12km',
      ),
    );

    expect(find.text('That reading does not look right'), findsOneWidget);
  });

  testWidgets('P1-8 manual entry offers an explicit vehicle-type choice',
      (WidgetTester tester) async {
    await _pump(tester, const InspectionWizardState());

    await tester.tap(find.text('Enter an asset number manually'));
    await tester.pumpAndSettle();

    expect(
      find.byKey(NewInspectionScreenKeys.manualVehicleTypes),
      findsOneWidget,
    );
    expect(
      tester
          .widget<ChoiceChip>(
            find.byKey(NewInspectionScreenKeys.manualVehicleType('Truck')),
          )
          .selected,
      isTrue,
    );
  });

  testWidgets(
      'P1-11 the fitted serial is a hint, never a value the reading does not '
      'carry', (WidgetTester tester) async {
    TyrePositionReading reading = TyrePositionReading.seed('F1L');
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: TpTheme.light,
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: Scaffold(
            body: StatefulBuilder(
              builder: (BuildContext context, StateSetter setState) {
                return TyrePositionEditorSheet(
                  reading: reading,
                  installedTyre: const TyreFitment(
                    id: 't1',
                    serialNo: 'FITTED-123',
                    positionCode: 'LHF1',
                  ),
                  onChanged: (TyrePositionReading next) =>
                      setState(() => reading = next),
                  onCapturePhoto: (PhotoCaptureSource source) {},
                );
              },
            ),
          ),
        ),
      ),
    );

    final Iterable<TextField> fields =
        tester.widgetList<TextField>(find.byType(TextField));
    final TextField serial = fields.firstWhere(
      (TextField f) => f.decoration?.hintText == 'FITTED-123',
    );
    expect(serial.controller!.text, isEmpty);
    expect(reading.serialNumber, isNull);
  });
}
