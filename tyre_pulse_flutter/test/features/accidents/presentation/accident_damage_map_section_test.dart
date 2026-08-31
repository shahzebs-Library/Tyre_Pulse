import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_damage_map_section.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_damage_zone_sheet.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/vehicle_damage_diagram.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_multiview_catalog.dart';

Future<void> _pump(
  WidgetTester tester, {
  required AccidentDamageMap map,
  required ValueChanged<AccidentDamageMap> onChanged,
  VehicleAsset? vehicle,
  AccidentDamageSuggestionResolver? suggestionResolver,
  AccidentDamagePhotoEditor? photoEditor,
  String? reviewerId,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: TpTheme.light,
      locale: const Locale('en'),
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: Scaffold(
        // The real host (`AccidentReportScreen`) is a `ListView`, so this
        // section never has to size an `AspectRatio` child against an
        // unconstrained-height `Scaffold.body` in production - match that
        // here with a `SingleChildScrollView` rather than a bare `Scaffold`.
        body: SingleChildScrollView(
          child: AccidentDamageMapSection(
            map: map,
            onChanged: onChanged,
            vehicle: vehicle,
            suggestionResolver: suggestionResolver,
            photoEditor: photoEditor,
            reviewerId: reviewerId,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Taps the point inside the rendered diagram that corresponds to the
/// centre of [zone], in the diagram's own normalised 0..1 space.
Future<void> _tapZoneCentre(
  WidgetTester tester,
  AccidentDamageZone zone,
) async {
  final Finder diagram = find.byKey(AccidentDamageMapSectionKeys.diagram);
  final Rect rect = tester.getRect(diagram);
  final Offset point = Offset(
    rect.left + (zone.left + zone.width / 2) * rect.width,
    rect.top + (zone.top + zone.height / 2) * rect.height,
  );
  await tester.tapAt(point);
  await tester.pumpAndSettle();
}

void main() {
  test('all 100 audited per-view files use isolated normalized canvases',
      () async {
    Future<(int, int)> dimensions(String asset) async {
      final ByteData bytes = await rootBundle.load(asset);
      final ui.Codec codec = await ui.instantiateImageCodec(
        bytes.buffer.asUint8List(),
      );
      final ui.FrameInfo frame = await codec.getNextFrame();
      final (int, int) size = (frame.image.width, frame.image.height);
      frame.image.dispose();
      codec.dispose();
      return size;
    }

    for (final VehicleMultiViewCatalogEntry entry in kVehicleMultiViewCatalog) {
      final String stem = entry.assetPath
          .replaceFirst('assets/vehicle_multiview/', '')
          .replaceFirst(RegExp(r'\.png$'), '');
      for (final AccidentDamageView view in AccidentDamageView.values) {
        final String path =
            'assets/vehicle_multiview_views/${stem}_${view.name}.png';
        expect(await dimensions(path), (768, 768), reason: path);
      }
    }
  });

  testWidgets(
    'side views use wide crops while tap and marker transforms stay aligned',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final AccidentDamageMap map = AccidentDamageMap.fromMarks(
        const <AccidentDamageMark>[
          AccidentDamageMark(
            zoneId: 'left_bucket',
            severity: AccidentDamageSeverity.moderate,
            view: AccidentDamageView.left,
            normalizedX: .23,
            normalizedY: .62,
            areaLabel: 'Bucket',
          ),
          AccidentDamageMark(
            zoneId: 'right_body',
            severity: AccidentDamageSeverity.severe,
            view: AccidentDamageView.right,
            normalizedX: .71,
            normalizedY: .43,
            areaLabel: 'Loader body',
          ),
        ],
      );
      await _pump(
        tester,
        map: map,
        onChanged: (_) {},
        vehicle: const VehicleAsset(
          id: 'loader',
          make: 'SANY',
          vehicleType: 'SANY Wheel Loader',
        ),
      );

      expect(accidentDamageMarkerRadius * 2, 24);
      await tester.drag(find.byType(ListView).first, const Offset(-180, 0));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(
          AccidentDamageMapSectionKeys.viewTab(AccidentDamageView.left),
        ),
      );
      await tester.pumpAndSettle();
      await tester.runAsync(
        () => precacheImage(
          const AssetImage(
            'assets/vehicle_multiview_views/'
            'sany_wheel_loader_five_view_v1_left.png',
          ),
          tester.element(
            find.byKey(const Key('accident.damage.multiview.left')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final Rect leftViewport = tester.getRect(
        find.byKey(AccidentDamageMapSectionKeys.diagram),
      );
      final Image leftImage = tester.widget<Image>(
        find.byKey(const Key('accident.damage.multiview.left')),
      );
      expect(leftViewport.width / leftViewport.height, closeTo(16 / 9, .01));
      expect(leftImage.fit, BoxFit.cover);
      expect(
        (leftImage.image as AssetImage).assetName,
        'assets/vehicle_multiview_views/'
        'sany_wheel_loader_five_view_v1_left.png',
      );
      final Size viewportSize = leftViewport.size;
      const Offset sourcePoint = Offset(.23, .62);
      final Offset paintedPoint = accidentDamageMarkerViewportPoint(
        view: AccidentDamageView.left,
        sourcePoint: sourcePoint,
        viewport: viewportSize,
        hasExactViewAsset: true,
      );
      final Offset recoveredPoint = accidentDamageTapSourcePoint(
        view: AccidentDamageView.left,
        viewportPoint: paintedPoint,
        viewport: viewportSize,
        hasExactViewAsset: true,
      );
      expect(recoveredPoint.dx, closeTo(sourcePoint.dx, .0001));
      expect(recoveredPoint.dy, closeTo(sourcePoint.dy, .0001));
      expect(paintedPoint.dy, inInclusiveRange(0, viewportSize.height));

      await tester.drag(find.byType(ListView).first, const Offset(-120, 0));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(
          AccidentDamageMapSectionKeys.viewTab(AccidentDamageView.right),
        ),
      );
      await tester.pumpAndSettle();
      await tester.runAsync(
        () => precacheImage(
          const AssetImage(
            'assets/vehicle_multiview_views/'
            'sany_wheel_loader_five_view_v1_right.png',
          ),
          tester.element(
            find.byKey(const Key('accident.damage.multiview.right')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final Rect rightViewport = tester.getRect(
        find.byKey(AccidentDamageMapSectionKeys.diagram),
      );
      final Image rightImage = tester.widget<Image>(
        find.byKey(const Key('accident.damage.multiview.right')),
      );
      expect(rightViewport.width / rightViewport.height, closeTo(16 / 9, .01));
      expect(rightImage.fit, BoxFit.cover);
      expect(
        (rightImage.image as AssetImage).assetName,
        'assets/vehicle_multiview_views/'
        'sany_wheel_loader_five_view_v1_right.png',
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('front is the default view and its chip reads selected', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      map: const AccidentDamageMap.empty(),
      onChanged: (_) {},
    );

    final ChoiceChip front = tester.widget<ChoiceChip>(
      find.descendant(
        of: find.byKey(
          AccidentDamageMapSectionKeys.viewTab(AccidentDamageView.front),
        ),
        matching: find.byType(ChoiceChip),
      ),
    );
    expect(front.selected, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tapping a different view chip switches the active view', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      map: const AccidentDamageMap.empty(),
      onChanged: (_) {},
    );

    await tester.tap(
      find.byKey(AccidentDamageMapSectionKeys.viewTab(AccidentDamageView.left)),
    );
    await tester.pumpAndSettle();

    final ChoiceChip left = tester.widget<ChoiceChip>(
      find.descendant(
        of: find.byKey(
          AccidentDamageMapSectionKeys.viewTab(AccidentDamageView.left),
        ),
        matching: find.byType(ChoiceChip),
      ),
    );
    expect(left.selected, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('selected fleet class uses the exact front multiview asset', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      map: const AccidentDamageMap.empty(),
      onChanged: (_) {},
      vehicle: const VehicleAsset(
        id: 'cp-1',
        assetNo: 'CP3012',
        make: 'SANY',
        vehicleType: 'SANY Concrete Pump 5 axle',
      ),
    );

    final Image image = tester.widget<Image>(
      find.byKey(const Key('accident.damage.multiview.front')),
    );
    expect(
      (image.image as AssetImage).assetName,
      'assets/vehicle_multiview_views/'
      'sany_concrete_pump_5axle_five_view_v1_front.png',
    );
    expect(image.fit, BoxFit.contain);
    final Rect viewport = tester.getRect(
      find.byKey(AccidentDamageMapSectionKeys.diagram),
    );
    expect(viewport.width / viewport.height, closeTo(1, .01));
  });

  testWidgets('each selector loads its own exact vehicle-view image', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      map: const AccidentDamageMap.empty(),
      onChanged: (_) {},
      vehicle: const VehicleAsset(
        id: 'cp-1',
        assetNo: 'CP3012',
        vehicleType: 'SANY Concrete Pump 5 axle',
      ),
    );

    for (final AccidentDamageView view in AccidentDamageView.values) {
      await tester.tap(
        find.byKey(AccidentDamageMapSectionKeys.viewTab(view)),
      );
      await tester.pumpAndSettle();
      final Image image = tester.widget<Image>(
        find.byKey(Key('accident.damage.multiview.${view.name}')),
      );
      expect(
        (image.image as AssetImage).assetName,
        'assets/vehicle_multiview_views/'
        'sany_concrete_pump_5axle_five_view_v1_${view.name}.png',
      );
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'tapping a real zone opens its editor, and Save reports the mark to the caller',
    (WidgetTester tester) async {
      AccidentDamageMap? reported;
      await _pump(
        tester,
        map: const AccidentDamageMap.empty(),
        onChanged: (AccidentDamageMap next) => reported = next,
      );

      final AccidentDamageZone bumper = accidentDamageZonesFor(
        AccidentDamageView.front,
      ).firstWhere((AccidentDamageZone z) => z.id == 'front_bumper');
      await _tapZoneCentre(tester, bumper);

      expect(find.text('X 50% / Y 79%'), findsOneWidget);
      expect(find.text('Vehicle body'), findsOneWidget);

      await tester.tap(find.text('Save mark'));
      await tester.pumpAndSettle();

      expect(reported, isNotNull);
      expect(reported!.count, 1);
      expect(
        reported!.marks.single.severity,
        AccidentDamageSeverity.minor,
      );
      expect(reported!.marks.single.view, AccidentDamageView.front);
      expect(reported!.marks.single.normalizedX, closeTo(.5, .01));
      expect(reported!.marks.single.normalizedY, closeTo(.79, .01));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
      'an already-marked zone offers Remove mark, and it clears the mark', (
    WidgetTester tester,
  ) async {
    AccidentDamageMap map = const AccidentDamageMap.empty().withMark(
      const AccidentDamageMark(
        zoneId: 'front_bumper',
        severity: AccidentDamageSeverity.severe,
        view: AccidentDamageView.front,
        normalizedX: .5,
        normalizedY: .79,
        areaLabel: 'Front bumper',
      ),
    );
    await _pump(
      tester,
      map: map,
      onChanged: (AccidentDamageMap next) => map = next,
    );

    final AccidentDamageZone bumper = accidentDamageZonesFor(
      AccidentDamageView.front,
    ).firstWhere((AccidentDamageZone z) => z.id == 'front_bumper');
    await _tapZoneCentre(tester, bumper);

    expect(find.text('Remove mark'), findsOneWidget);
    await tester.tap(find.text('Remove mark'));
    await tester.pumpAndSettle();

    expect(map.hasMark('front_bumper'), isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('saved severity and note remain visible after view changes', (
    WidgetTester tester,
  ) async {
    AccidentDamageMap map = const AccidentDamageMap.empty();
    await tester.pumpWidget(
      MaterialApp(
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Scaffold(
          body: StatefulBuilder(
            builder: (BuildContext context, StateSetter setState) {
              return SingleChildScrollView(
                child: AccidentDamageMapSection(
                  map: map,
                  onChanged: (AccidentDamageMap next) {
                    setState(() => map = next);
                  },
                ),
              );
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final AccidentDamageZone bumper = accidentDamageZonesFor(
      AccidentDamageView.front,
    ).firstWhere((AccidentDamageZone zone) => zone.id == 'front_bumper');
    await _tapZoneCentre(tester, bumper);
    await tester.tap(find.text('Severe'));
    await tester.enterText(find.byType(TextField).last, 'Cracked mounting');
    await tester.tap(find.text('Save mark'));
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(AccidentDamageMapSectionKeys.viewTab(AccidentDamageView.rear)),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(AccidentDamageMapSectionKeys.marksSummary),
      findsOneWidget,
    );
    expect(find.text('Front • Vehicle body'), findsOneWidget);
    expect(find.text('Cracked mounting'), findsOneWidget);
    expect(find.text('Severe'), findsOneWidget);
    expect(map.marks.single.severity, AccidentDamageSeverity.severe);
  });

  testWidgets('any exact point on the real view can be marked', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      map: const AccidentDamageMap.empty(),
      onChanged: (_) {},
    );

    final Finder diagram = find.byKey(AccidentDamageMapSectionKeys.diagram);
    final Rect rect = tester.getRect(diagram);
    await tester.tapAt(Offset(rect.left + 4, rect.top + 4));
    await tester.pumpAndSettle();

    expect(find.text('Save mark'), findsOneWidget);
    expect(find.textContaining('X 1% / Y 1%'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Finder suggestion requires explicit confirmation and is audited',
      (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    AccidentDamageMap? reported;
    await _pump(
      tester,
      map: const AccidentDamageMap.empty(),
      onChanged: (AccidentDamageMap next) => reported = next,
      reviewerId: 'fleet-user-7',
      suggestionResolver: (_, __) => const AccidentDamageSuggestion(
        source: 'finder-v2',
        confidence: .91,
        suggestedType: AccidentDamageType.scratch,
        suggestedArea: 'Front bumper',
      ),
    );

    await tester.tapAt(
      tester
          .getRect(
            find.byKey(AccidentDamageMapSectionKeys.diagram),
          )
          .center,
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(AccidentDamageZoneSheetKeys.selectedAreaPanel),
      findsOneWidget,
    );
    expect(find.text('Finder suggestion'), findsOneWidget);
    final FilledButton pendingSave = tester.widget<FilledButton>(
      find.descendant(
        of: find.byKey(AccidentDamageZoneSheetKeys.save),
        matching: find.byType(FilledButton),
      ),
    );
    expect(pendingSave.onPressed, isNull);

    await tester.tap(
      find.byKey(AccidentDamageZoneSheetKeys.confirmSuggestion),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(AccidentDamageZoneSheetKeys.save));
    await tester.tap(find.text('Save mark'));
    await tester.pumpAndSettle();

    expect(reported, isNotNull);
    final AccidentDamageMark mark = reported!.marks.single;
    expect(mark.damageType, AccidentDamageType.scratch);
    expect(mark.areaLabel, 'Front bumper');
    expect(
      mark.suggestion?.decision,
      AccidentDamageSuggestionDecision.confirmed,
    );
    expect(mark.suggestion?.reviewedBy, 'fleet-user-7');
    expect(mark.suggestion?.reviewedAt, isNotNull);
  });

  testWidgets('editing a Finder value records a correction without erasing it',
      (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    AccidentDamageMap? reported;
    await _pump(
      tester,
      map: const AccidentDamageMap.empty(),
      onChanged: (AccidentDamageMap next) => reported = next,
      suggestionResolver: (_, __) => const AccidentDamageSuggestion(
        source: 'finder-local',
        confidence: .64,
        suggestedType: AccidentDamageType.dent,
        suggestedArea: 'Cab',
      ),
    );

    await tester.tapAt(
      tester
          .getRect(
            find.byKey(AccidentDamageMapSectionKeys.diagram),
          )
          .center,
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Cargo bed');
    await tester.pumpAndSettle();
    expect(
      find.byKey(AccidentDamageZoneSheetKeys.correctSuggestion),
      findsNothing,
    );
    expect(find.text('Corrected by reporter'), findsOneWidget);

    await tester.ensureVisible(find.byKey(AccidentDamageZoneSheetKeys.save));
    await tester.tap(find.text('Save mark'));
    await tester.pumpAndSettle();

    final AccidentDamageMark mark = reported!.marks.single;
    expect(mark.areaLabel, 'Cargo bed');
    expect(mark.suggestion?.suggestedArea, 'Cab');
    expect(
      mark.suggestion?.decision,
      AccidentDamageSuggestionDecision.corrected,
    );
  });

  testWidgets('close-up damage photo hook stores references and count', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    AccidentDamageMap? reported;
    await _pump(
      tester,
      map: const AccidentDamageMap.empty(),
      onChanged: (AccidentDamageMap next) => reported = next,
      photoEditor: (_) async => <String>[
        'photo_damage_closeup:local-1',
        'photo_damage_closeup:local-2',
      ],
    );

    await tester.tapAt(
      tester
          .getRect(
            find.byKey(AccidentDamageMapSectionKeys.diagram),
          )
          .center,
    );
    await tester.pumpAndSettle();
    expect(find.text('Close-up damage photos'), findsOneWidget);
    expect(find.text('0 attached'), findsOneWidget);

    await tester.tap(find.byKey(AccidentDamageZoneSheetKeys.photoAction));
    await tester.pumpAndSettle();
    expect(find.text('2 attached'), findsOneWidget);
    await tester.ensureVisible(find.byKey(AccidentDamageZoneSheetKeys.save));
    await tester.tap(find.text('Save mark'));
    await tester.pumpAndSettle();

    expect(reported!.marks.single.photoCount, 2);
    expect(
      reported!.marks.single.photoReferences.first,
      'photo_damage_closeup:local-1',
    );
  });

  testWidgets('marked-area list exposes direct edit and remove actions', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    AccidentDamageMap? reported;
    const AccidentDamageMark mark = AccidentDamageMark(
      zoneId: 'front_500_500',
      view: AccidentDamageView.front,
      normalizedX: .5,
      normalizedY: .5,
      areaLabel: 'Front panel',
      damageType: AccidentDamageType.dent,
      severity: AccidentDamageSeverity.minor,
    );
    await _pump(
      tester,
      map: AccidentDamageMap.fromMarks(const <AccidentDamageMark>[mark]),
      onChanged: (AccidentDamageMap next) => reported = next,
    );

    expect(
      find.byKey(AccidentDamageMapSectionKeys.markRow(mark.zoneId)),
      findsOneWidget,
    );
    expect(find.text('1'), findsOneWidget);
    await tester.ensureVisible(
      find.byKey(AccidentDamageMapSectionKeys.editMark(mark.zoneId)),
    );
    await tester.tap(
      find.byKey(AccidentDamageMapSectionKeys.editMark(mark.zoneId)),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(AccidentDamageZoneSheetKeys.selectedAreaPanel),
      findsOneWidget,
    );
    expect(find.text('Selected area 1'), findsOneWidget);
    Navigator.of(
      tester.element(
        find.byKey(AccidentDamageZoneSheetKeys.selectedAreaPanel),
      ),
    ).pop();
    await tester.pumpAndSettle();

    await tester.ensureVisible(
      find.byKey(AccidentDamageMapSectionKeys.removeMark(mark.zoneId)),
    );
    await tester.tap(
      find.byKey(AccidentDamageMapSectionKeys.removeMark(mark.zoneId)),
    );
    await tester.pumpAndSettle();
    expect(reported?.isEmpty, isTrue);
  });

  testWidgets('exact-point area identity stays truthful across asset classes', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    const List<VehicleAsset> assets = <VehicleAsset>[
      VehicleAsset(
        id: 'pump',
        make: 'SANY',
        vehicleType: 'SANY Concrete Pump 5 axle',
      ),
      VehicleAsset(
        id: 'loader',
        make: 'SANY',
        vehicleType: 'SANY Wheel Loader',
      ),
      VehicleAsset(
        id: 'chiller',
        make: 'Snowkey',
        vehicleType: 'Snowkey Chiller',
      ),
    ];
    const List<String> expectedAreas = <String>[
      'Boom',
      'Bucket / running gear',
      'Equipment body',
    ];
    for (int i = 0; i < assets.length; i++) {
      final VehicleAsset asset = assets[i];
      await _pump(
        tester,
        map: const AccidentDamageMap.empty(),
        onChanged: (_) {},
        vehicle: asset,
      );
      final Rect diagram = tester.getRect(
        find.byKey(AccidentDamageMapSectionKeys.diagram),
      );
      await tester.tapAt(diagram.center);
      await tester.pumpAndSettle();
      expect(
        find.text(expectedAreas[i]),
        findsOneWidget,
      );
      Navigator.of(tester.element(find.byType(TextField).last)).pop();
      await tester.pumpAndSettle();
    }
    expect(tester.takeException(), isNull);
  });
}
