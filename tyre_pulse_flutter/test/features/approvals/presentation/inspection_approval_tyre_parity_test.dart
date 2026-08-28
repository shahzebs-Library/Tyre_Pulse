/// Regression coverage for the product rule that an inspection approval must
/// review the exact tyre map that the inspector submitted.
///
/// The approval screen must not own a second vehicle-layout interpretation:
/// it receives `vehicle_type` and `tyre_conditions` from the inspected row and
/// passes both through the shared [TyreDiagramBoard] used by inspection
/// capture/detail. The five-axle concrete-pump fixture is deliberate because
/// it catches the historical ten-wheel pump regression and makes both rear
/// dual assemblies observable.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/inspection_approvals_providers.dart';
import 'package:tyre_pulse/features/approvals/presentation/inspection_approval_review_screen.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_detail_screen.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_board.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/vehicle_tyre_diagram.dart';

const String _inspectionId = 'inspection-pump-5-axle';
const String _assetNo = 'MP083';

const Map<String, Object?> _submittedTyreConditions = <String, Object?>{
  'F1L': <String, Object?>{
    'condition': 'Good',
    'pressure_psi': 110,
    'tread_depth_mm': 12,
    'photo_url': 'https://evidence.example/inspection-pump-5-axle/F1L.jpg',
  },
  'F1R': <String, Object?>{
    'condition': 'Worn',
    'pressure_psi': 109,
    'tread_depth_mm': 8,
  },
  'F2L': <String, Object?>{
    'condition': 'Damaged',
    'pressure_psi': 102,
    'tread_depth_mm': 7,
  },
  'F2R': <String, Object?>{
    'condition': 'Flat',
    'pressure_psi': 0,
    'tread_depth_mm': 6,
  },
  'F3L': <String, Object?>{
    'condition': 'Puncture',
    'pressure_psi': 40,
    'tread_depth_mm': 5,
  },
  'F3R': <String, Object?>{
    'condition': 'Good',
    'pressure_psi': 111,
    'tread_depth_mm': 11,
  },
  'R1Lo': <String, Object?>{
    'condition': 'Good',
    'pressure_psi': 108,
    'tread_depth_mm': 10,
  },
  'R1Li': <String, Object?>{
    'condition': 'Worn',
    'pressure_psi': 107,
    'tread_depth_mm': 8,
  },
  'R1Ri': <String, Object?>{
    'condition': 'Good',
    'pressure_psi': 106,
    'tread_depth_mm': 9,
  },
  'R1Ro': <String, Object?>{
    'condition': 'Damaged',
    'pressure_psi': 101,
    'tread_depth_mm': 6,
  },
  'R2Lo': <String, Object?>{
    'condition': 'Good',
    'pressure_psi': 110,
    'tread_depth_mm': 12,
  },
  'R2Li': <String, Object?>{
    'condition': 'Good',
    'pressure_psi': 109,
    'tread_depth_mm': 11,
  },
  'R2Ri': <String, Object?>{
    'condition': 'Worn',
    'pressure_psi': 104,
    'tread_depth_mm': 7,
  },
  'R2Ro': <String, Object?>{
    'condition': 'Missing',
    'pressure_psi': 0,
    'tread_depth_mm': 0,
  },
};

const List<String> _concretePumpPositions = <String>[
  'F1L',
  'F1R',
  'F2L',
  'F2R',
  'F3L',
  'F3R',
  'R1Lo',
  'R1Li',
  'R1Ri',
  'R1Ro',
  'R2Lo',
  'R2Li',
  'R2Ri',
  'R2Ro',
];

InspectionApprovalItem _submittedInspection() =>
    InspectionApprovalItem.fromRow(<String, Object?>{
      'id': _inspectionId,
      'title': 'Concrete pump tyre inspection',
      'site': 'North Yard',
      'asset_no': _assetNo,
      'vehicle_type': 'Concrete pump',
      'inspector': 'Field Inspector',
      'created_at': '2026-08-28T08:30:00.000Z',
      'approval_status': 'pending_approval',
      'tyre_conditions': _submittedTyreConditions,
    });

Future<void> _pumpReview(
  WidgetTester tester, {
  InspectionApprovalItem? inspection,
  Size physicalSize = const Size(900, 3000),
}) async {
  final InspectionApprovalItem item = inspection ?? _submittedInspection();
  tester.view.physicalSize = physicalSize;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        inspectionApprovalRepositoryProvider.overrideWithValue(
          _FakeInspectionApprovalRepository(item),
        ),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: InspectionApprovalReviewScreen(
          route: InspectionApprovalReviewRoute(
            inspectionId: InspectionId(item.id),
          ),
        ),
      ),
    ),
  );

  // Flat/Puncture wheels deliberately keep their attention animation alive,
  // so this screen never reaches the global "no scheduled frames" state
  // `pumpAndSettle` waits for. Pump only until the repository result has
  // replaced the loading state with the shared board.
  for (int frame = 0;
      frame < 10 && find.byType(TyreDiagramBoard).evaluate().isEmpty;
      frame++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
  expect(find.byType(TyreDiagramBoard), findsOneWidget);
}

void main() {
  testWidgets(
    'approval reuses the submitted Concrete pump layout and all 14 readings',
    (WidgetTester tester) async {
      await _pumpReview(tester);

      final TyreDiagramBoard board = tester.widget<TyreDiagramBoard>(
        find.byType(TyreDiagramBoard),
      );
      expect(board.vehicleType, 'Concrete pump');
      expect(board.assetNo, _assetNo);
      expect(board.positions, _concretePumpPositions);
      expect(board.positions, diagramPositions('Concrete pump', _assetNo));
      expect(board.tyreData, _submittedTyreConditions);

      final VehicleTyreDiagram diagram = tester.widget<VehicleTyreDiagram>(
        find.descendant(
          of: find.byType(TyreDiagramBoard),
          matching: find.byType(VehicleTyreDiagram),
        ),
      );
      expect(diagram.vehicleType, board.vehicleType);
      expect(diagram.positions, board.positions);
      expect(diagram.tyreData, board.tyreData);
      expect(
        kTyreDiagramLayouts[resolveVehicleType(diagram.vehicleType)]!.bodyKey,
        TyreDiagramBodyKey.concretePump,
      );

      final TpStatusChip flat = tester.widget<TpStatusChip>(
        find.byKey(
          const Key('inspection-approval-tyre-finding-F2R'),
        ),
      );
      final TpStatusChip puncture = tester.widget<TpStatusChip>(
        find.byKey(
          const Key('inspection-approval-tyre-finding-F3L'),
        ),
      );
      expect(flat.label, contains('RHF2'));
      expect(flat.label, contains('Flat'));
      expect(puncture.label, contains('LHF3'));
      expect(puncture.label, contains('Puncture'));
    },
  );

  testWidgets(
    'approval resolves a generic submitted class from the asset and keeps '
    'the complete five-axle layout around partial rear-dual readings',
    (WidgetTester tester) async {
      const InspectionApprovalItem partial = InspectionApprovalItem(
        id: 'inspection-partial-pump',
        assetNo: _assetNo,
        vehicleType: 'HEAVY EQP',
        approvalStatus: 'pending_approval',
        tyreConditions: <String, Object?>{
          'R1Li': <String, Object?>{
            'condition': 'Flat',
            'pressure_psi': 0,
          },
          'R1Ri': <String, Object?>{
            'condition': 'Puncture',
            'pressure_psi': 0,
          },
        },
      );

      await _pumpReview(tester, inspection: partial);

      final TyreDiagramBoard board = tester.widget<TyreDiagramBoard>(
        find.byType(TyreDiagramBoard),
      );
      expect(
        resolveVehicleType(board.vehicleType, board.assetNo),
        'Concrete pump',
      );
      expect(board.positions, _concretePumpPositions);
      expect(board.positions.sublist(6, 10), const <String>[
        'R1Lo',
        'R1Li',
        'R1Ri',
        'R1Ro',
      ]);
      expect(board.tyreData['R1Li']?['condition'], 'Flat');
      expect(board.tyreData['R1Ri']?['condition'], 'Puncture');
      final TpStatusChip resolvedClass = tester.widget<TpStatusChip>(
        find.byKey(
          const Key('inspection-approval-resolved-vehicle-class'),
        ),
      );
      expect(resolvedClass.label, 'Concrete pump');
    },
  );

  testWidgets(
    '720x1560 can scroll the final rear dual above the approval action bar',
    (WidgetTester tester) async {
      final SemanticsHandle semantics = tester.ensureSemantics();
      await _pumpReview(
        tester,
        physicalSize: const Size(720, 1560),
      );

      final Finder lastRear = find.bySemanticsLabel(
        RegExp(r'RHR2-O.*Missing.*0'),
      );
      expect(lastRear, findsOneWidget);
      await tester.scrollUntilVisible(
        lastRear,
        240,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pump(const Duration(milliseconds: 100));

      final Rect lastRearRect = tester.getRect(lastRear);
      final Rect approveRect = tester.getRect(find.text('Approve'));
      expect(lastRearRect.bottom, lessThan(approveRect.top));
      expect(tester.takeException(), isNull);
      semantics.dispose();
    },
  );

  test(
    'approval Concrete pump contract is five axles with joined rear duals '
    'and Inner nearest the chassis',
    () {
      final DiagramLayout layout = kTyreDiagramLayouts['Concrete pump']!;
      expect(
        layout.tyres.map((TyreSlot slot) => slot.id),
        _concretePumpPositions,
      );
      expect(
        layout.tyres.map((TyreSlot slot) => slot.y).toSet(),
        <double>{40, 84, 128, 258, 300},
      );

      final Map<String, TyreSlot> byId = <String, TyreSlot>{
        for (final TyreSlot slot in layout.tyres) slot.id: slot,
      };
      for (int axle = 1; axle <= 2; axle++) {
        _expectJoinedPair(
          outer: byId['R${axle}Lo']!,
          inner: byId['R${axle}Li']!,
          leftSide: true,
        );
        _expectJoinedPair(
          outer: byId['R${axle}Ro']!,
          inner: byId['R${axle}Ri']!,
          leftSide: false,
        );
      }
    },
  );

  testWidgets(
    'tapping an approval wheel opens its exact submitted reading and photo',
    (WidgetTester tester) async {
      final SemanticsHandle semantics = tester.ensureSemantics();
      await _pumpReview(tester);

      final Finder submittedWheel = find.bySemanticsLabel(
        RegExp('LHF1.*Good.*110'),
      );
      expect(submittedWheel, findsOneWidget);
      await tester.tap(submittedWheel);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.byType(TyreDetailScreen), findsOneWidget);
      final TyreDetailScreen detail = tester.widget<TyreDetailScreen>(
        find.byType(TyreDetailScreen),
      );
      expect(detail.positionCode, 'F1L');
      expect(detail.vehicleType, 'Concrete pump');
      expect(detail.assetNo, _assetNo);
      expect(detail.entry, _submittedTyreConditions['F1L']);
      expect(
        detail.entry?['photo_url'],
        'https://evidence.example/inspection-pump-5-axle/F1L.jpg',
      );
      expect(find.text('Photo'), findsOneWidget);
      semantics.dispose();
    },
  );
}

void _expectJoinedPair({
  required TyreSlot outer,
  required TyreSlot inner,
  required bool leftSide,
}) {
  expect(inner.y, outer.y);
  expect(inner.h, outer.h);

  final double seam =
      leftSide ? inner.x - (outer.x + outer.w) : outer.x - (inner.x + inner.w);
  expect(seam, inInclusiveRange(0, 2));

  const double chassisCentreX = 100;
  final double outerDistance = (outer.x + outer.w / 2 - chassisCentreX).abs();
  final double innerDistance = (inner.x + inner.w / 2 - chassisCentreX).abs();
  expect(innerDistance, lessThan(outerDistance));
}

final class _FakeInspectionApprovalRepository
    implements InspectionApprovalRepository {
  const _FakeInspectionApprovalRepository(this.item);

  final InspectionApprovalItem item;

  @override
  Future<InspectionApprovalItem?> byId(String id) async =>
      id == item.id ? item : null;

  @override
  Future<String?> currentUserDisplayName(String userId) async => null;

  @override
  Future<void> decide(InspectionApprovalDecision input) async {}

  @override
  Future<List<InspectionApprovalItem>> listPending({String? country}) async =>
      <InspectionApprovalItem>[item];
}
