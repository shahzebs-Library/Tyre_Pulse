import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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

const String _inspectionId = 'inspection-evidence-gate';
const String _assetNo = 'TM001';

Map<String, Object?> _mixerConditions({required int checked}) {
  final List<String> positions = diagramPositions('Tri-mixer', _assetNo);
  return <String, Object?>{
    for (int index = 0; index < positions.length; index++)
      positions[index]: <String, Object?>{
        'position': positions[index],
        'condition': 'Good',
        'checked': index < checked,
      },
  };
}

InspectionApprovalItem _mixer({required int checked}) {
  return InspectionApprovalItem(
    id: _inspectionId,
    assetNo: _assetNo,
    vehicleType: 'Tri-mixer',
    approvalStatus: 'pending_approval',
    tyreConditions: _mixerConditions(checked: checked),
  );
}

Future<void> _pump(
  WidgetTester tester,
  InspectionApprovalItem item,
) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        inspectionApprovalRepositoryProvider.overrideWithValue(
          _FakeRepository(item),
        ),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const InspectionApprovalReviewScreen(
          route: InspectionApprovalReviewRoute(
            inspectionId: InspectionId(_inspectionId),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

TpButton _button(WidgetTester tester, Key key) {
  return tester.widget<TpButton>(find.byKey(key));
}

void main() {
  testWidgets('seeded 0 of 12 is Not measured and cannot be approved', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _mixer(checked: 0));

    expect(find.text('Tyre conditions (0)'), findsOneWidget);
    expect(find.text('Not measured'), findsOneWidget);
    expect(find.text('0/12'), findsOneWidget);
    expect(
      find.text('12 of 12 tyres still need details before you can continue.'),
      findsWidgets,
    );
    expect(
      _button(tester, InspectionApprovalReviewKeys.approve).onPressed,
      isNull,
    );
    expect(
      _button(
        tester,
        InspectionApprovalReviewKeys.returnForCorrection,
      ).onPressed,
      isNotNull,
    );
  });

  testWidgets('partial 1 of 12 reports checked truth and blocks only Approve', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _mixer(checked: 1));

    expect(find.text('Tyre conditions (1)'), findsOneWidget);
    expect(find.text('1 of 12 tyre positions recorded'), findsOneWidget);
    expect(find.text('1/12'), findsOneWidget);
    expect(
      find.text('11 of 12 tyres still need details before you can continue.'),
      findsWidgets,
    );
    expect(
      _button(tester, InspectionApprovalReviewKeys.approve).onPressed,
      isNull,
    );
    expect(
      _button(
        tester,
        InspectionApprovalReviewKeys.returnForCorrection,
      ).onPressed,
      isNotNull,
    );
  });

  testWidgets('complete 12 of 12 keeps approval available', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _mixer(checked: 12));

    expect(find.text('Tyre conditions (12)'), findsOneWidget);
    expect(find.text('12 of 12 tyre positions recorded'), findsOneWidget);
    expect(find.text('12/12'), findsOneWidget);
    expect(
      find.byKey(InspectionApprovalReviewKeys.approvalBlockedReason),
      findsNothing,
    );
    expect(
      _button(tester, InspectionApprovalReviewKeys.approve).onPressed,
      isNotNull,
    );
  });

  testWidgets('unknown legacy layout stays honest and is not guessed blocked', (
    WidgetTester tester,
  ) async {
    const InspectionApprovalItem unknown = InspectionApprovalItem(
      id: _inspectionId,
      assetNo: 'ZZ001',
      vehicleType: 'Forklift legacy import',
      approvalStatus: 'pending_approval',
      tyreConditions: <String, Object?>{
        'LEGACY_FRONT': <String, Object?>{
          'condition': 'Worn',
          'checked': true,
        },
      },
    );
    await _pump(tester, unknown);

    expect(find.text('Tyre conditions (1)'), findsOneWidget);
    expect(find.text('Not measured'), findsOneWidget);
    expect(
      find.byKey(InspectionApprovalReviewKeys.approvalBlockedReason),
      findsNothing,
    );
    expect(
      _button(tester, InspectionApprovalReviewKeys.approve).onPressed,
      isNotNull,
    );
  });
}

final class _FakeRepository implements InspectionApprovalRepository {
  const _FakeRepository(this.item);

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
