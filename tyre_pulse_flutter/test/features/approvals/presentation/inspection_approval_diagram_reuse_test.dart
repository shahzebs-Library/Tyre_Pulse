/// Regression coverage for the inspection-approval tyre review.
///
/// The approval screen must not own a second vehicle drawing or position
/// model. It renders the submitted `tyre_conditions` through the same
/// [TyreDiagramBoard]/[VehicleTyreDiagram] used by inspection capture and
/// inspection detail, preserving the submitted V1 inner/outer storage keys.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/inspection_approvals_providers.dart';
import 'package:tyre_pulse/features/approvals/presentation/inspection_approval_review_screen.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_detail_screen.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_board.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/vehicle_tyre_diagram.dart';

const List<String> _pumpPositions = <String>[
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

Map<String, Object?> _reading(
  String position, {
  String condition = 'Good',
  num pressure = 110,
}) =>
    <String, Object?>{
      'position': position,
      'checked': true,
      'condition': condition,
      'pressure_psi': pressure,
      'tread_depth_mm': 12,
    };

InspectionApprovalItem _pendingPumpInspection() {
  return InspectionApprovalItem(
    id: 'inspection-pump-1',
    assetNo: 'MP083',
    vehicleType: 'Concrete pump',
    site: 'Site A',
    inspector: 'Inspector',
    createdAt: '2026-08-28T09:00:00.000Z',
    approvalStatus: 'pending_approval',
    tyreConditions: <String, Object?>{
      for (final String position in _pumpPositions)
        position: _reading(
          position,
          condition: switch (position) {
            'R1Li' => 'Flat',
            'R1Ri' => 'Puncture',
            'R1Ro' => 'Worn',
            _ => 'Good',
          },
          pressure: switch (position) {
            'R1Li' || 'R1Ri' => 0,
            'R1Ro' => 92,
            _ => 110,
          },
        ),
    },
  );
}

Future<void> _pumpScreen(
  WidgetTester tester, {
  Locale locale = const Locale('en'),
}) async {
  final _FakeInspectionApprovalRepository repository =
      _FakeInspectionApprovalRepository(_pendingPumpInspection());
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        inspectionApprovalRepositoryProvider.overrideWithValue(repository),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const InspectionApprovalReviewScreen(
          route: InspectionApprovalReviewRoute(
            inspectionId: InspectionId('inspection-pump-1'),
          ),
        ),
      ),
    ),
  );
  // The signature pad has a continuously repainting cursor on this screen,
  // so `pumpAndSettle` cannot become idle. Two frames are enough for the
  // repository futures and their `setState` calls to complete.
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets(
    'approval reuses the inspection board at the same width and preserves '
    'submitted pump inner/outer readings',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pumpScreen(tester);

      expect(find.byType(TyreDiagramBoard), findsOneWidget);
      expect(find.byType(VehicleTyreDiagram), findsOneWidget);

      final TyreDiagramBoard board = tester.widget<TyreDiagramBoard>(
        find.byType(TyreDiagramBoard),
      );
      expect(board.positions, _pumpPositions);
      expect(board.width, 900 - (TpSpace.lg * 2));
      expect(board.onPositionTap, isNotNull);
      expect(board.tyreData['R1Li']?['condition'], 'Flat');
      expect(board.tyreData['R1Li']?['pressure_psi'], 0);
      expect(board.tyreData['R1Ri']?['condition'], 'Puncture');
      expect(board.tyreData['R1Ro']?['condition'], 'Worn');

      // A 5-axle pump is 6 single steer tyres plus two rear dual axles.
      // These four ids are axle 1's outer/inner/inner/outer sequence and
      // must remain separate submitted storage keys on approval.
      expect(
        board.positions.sublist(6, 10),
        const <String>['R1Lo', 'R1Li', 'R1Ri', 'R1Ro'],
      );

      // Decision controls remain part of the same review after replacing
      // the old, smaller nested rendering.
      await tester.scrollUntilVisible(
        find.text('Approve'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Approve'), findsOneWidget);
      expect(find.text('Return'), findsOneWidget);
    },
  );

  testWidgets(
    'approval keeps the vehicle coordinate system LTR in Arabic and a tyre '
    'tap opens the submitted read-only PSI details',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final SemanticsHandle semantics = tester.ensureSemantics();

      await _pumpScreen(tester, locale: const Locale('ar'));

      final Finder boardFinder = find.byType(TyreDiagramBoard);
      final Iterable<Directionality> directions =
          tester.widgetList<Directionality>(
        find.descendant(
          of: boardFinder,
          matching: find.byType(Directionality),
        ),
      );
      expect(
        directions.any(
          (Directionality value) => value.textDirection == TextDirection.ltr,
        ),
        isTrue,
      );

      final Finder innerFlat = find.bySemanticsLabel(
        RegExp(r'LHR1-I.*0'),
      );
      expect(innerFlat, findsOneWidget);
      final TyreDiagramBoard board = tester.widget<TyreDiagramBoard>(
        boardFinder,
      );
      board.onPositionTap!('R1Li');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(find.byType(TyreDetailScreen), findsOneWidget);
      expect(find.textContaining('R1Li'), findsWidgets);
      expect(find.textContaining('0'), findsWidgets);

      semantics.dispose();
    },
  );

  testWidgets('design QA capture: compact English approval', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpScreen(tester);

    expect(find.byType(TyreDiagramBoard), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('design QA capture: wide Arabic RTL approval', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(1024, 768);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpScreen(tester, locale: const Locale('ar'));

    expect(find.byType(TyreDiagramBoard), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

final class _FakeInspectionApprovalRepository
    implements InspectionApprovalRepository {
  _FakeInspectionApprovalRepository(this.item);

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
