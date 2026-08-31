import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/inspection_approvals_providers.dart';
import 'package:tyre_pulse/features/approvals/presentation/inspection_approvals_queue_screen.dart';

const InspectionApprovalItem _pendingItem = InspectionApprovalItem(
  id: 'approval-long-1',
  assetNo: 'PMV-ASSET-VERY-LONG-0001',
  vehicleType: 'Concrete pump with extended boom',
  site: 'North operations yard and external workshop receiving area',
  inspector: 'Field inspector with a deliberately long display name',
  createdAt: '2026-08-28T08:30:00.000Z',
  approvalStatus: 'pending_approval',
  inspectorSignature: 'data:image/png;base64,signature',
);

Future<void> _pumpQueue(
  WidgetTester tester, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(320, 720);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        inspectionApprovalRepositoryProvider.overrideWithValue(
          const _FakeApprovalRepository(),
        ),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const InspectionApprovalsQueueScreen(
          route: InspectionApprovalsRoute(),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets('compact queue wraps real approval metadata without ellipsis', (
    WidgetTester tester,
  ) async {
    await _pumpQueue(tester);

    expect(find.byKey(InspectionApprovalsQueueKeys.summary), findsOneWidget);
    expect(find.byKey(InspectionApprovalsQueueKeys.list), findsOneWidget);
    expect(
      find.byKey(InspectionApprovalsQueueKeys.row(_pendingItem.id)),
      findsOneWidget,
    );
    final Text heading = tester.widget<Text>(
      find.byKey(InspectionApprovalsQueueKeys.heading(_pendingItem.id)),
    );
    expect(heading.maxLines, isNull);
    expect(heading.overflow, isNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Arabic compact queue uses the RTL disclosure direction', (
    WidgetTester tester,
  ) async {
    await _pumpQueue(tester, locale: const Locale('ar'));

    final Finder row = find.byKey(
      InspectionApprovalsQueueKeys.row(_pendingItem.id),
    );
    expect(
      find.descendant(of: row, matching: find.byIcon(Icons.chevron_left)),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}

final class _FakeApprovalRepository implements InspectionApprovalRepository {
  const _FakeApprovalRepository();

  @override
  Future<InspectionApprovalItem?> byId(String id) async =>
      id == _pendingItem.id ? _pendingItem : null;

  @override
  Future<String?> currentUserDisplayName(String userId) async => null;

  @override
  Future<void> decide(InspectionApprovalDecision input) async {}

  @override
  Future<List<InspectionApprovalItem>> listPending({String? country}) async =>
      const <InspectionApprovalItem>[_pendingItem];

  @override
  Future<List<InspectionApprovalItem>> listByStatus(
    String status, {
    String? country,
  }) async =>
      const <InspectionApprovalItem>[];
}
