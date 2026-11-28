/// Reading the inspection approvals queue is wider than signing it (V606).
///
/// A Manager, Director, Inspector or Workshop Supervisor with the approvals
/// module may open the queue and a sheet to read them; only a signer is
/// offered bulk approve, Approve or Return.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/inspection_approvals_providers.dart';
import 'package:tyre_pulse/features/approvals/presentation/inspection_approval_review_screen.dart';
import 'package:tyre_pulse/features/approvals/presentation/inspection_approvals_queue_screen.dart';

const String _id = '11111111-2222-3333-4444-555555555555';

const InspectionApprovalItem _pending = InspectionApprovalItem(
  id: _id,
  assetNo: 'TM514',
  vehicleType: 'Transit Mixer',
  site: 'NHC',
  inspector: 'Field inspector',
  createdAt: '2026-11-27T08:30:00.000Z',
  approvalStatus: 'pending_approval',
  inspectorSignature: 'data:image/png;base64,signature',
);

const AccessState _manager = AccessState(role: UserRole.known(RoleId.manager));
const AccessState _pmvManager =
    AccessState(role: UserRole.known(RoleId.pmvManager));

Future<void> _pump(
  WidgetTester tester,
  AccessState access,
  Widget home,
) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        accessStateProvider.overrideWithValue(access),
        inspectionApprovalRepositoryProvider
            .overrideWithValue(const _FakeRepository()),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: home,
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

const Widget _queue =
    InspectionApprovalsQueueScreen(route: InspectionApprovalsRoute());
const Widget _review = InspectionApprovalReviewScreen(
  route: InspectionApprovalReviewRoute(inspectionId: InspectionId(_id)),
);

void main() {
  test('the signer rule: Manager reads, PMV Manager and super admin sign', () {
    final ProviderContainer reader = ProviderContainer(
      overrides: <Override>[accessStateProvider.overrideWithValue(_manager)],
    );
    addTearDown(reader.dispose);
    expect(reader.read(inspectionApprovalCanSignProvider), isFalse);

    final ProviderContainer signer = ProviderContainer(
      overrides: <Override>[
        accessStateProvider.overrideWithValue(_pmvManager),
      ],
    );
    addTearDown(signer.dispose);
    expect(signer.read(inspectionApprovalCanSignProvider), isTrue);

    final ProviderContainer superAdmin = ProviderContainer(
      overrides: <Override>[
        accessStateProvider.overrideWithValue(
          const AccessState(
            role: UserRole.known(RoleId.manager),
            isSuperAdmin: true,
          ),
        ),
      ],
    );
    addTearDown(superAdmin.dispose);
    expect(superAdmin.read(inspectionApprovalCanSignProvider), isTrue);
  });

  testWidgets('a non-signer Manager reads the queue with no bulk approve', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _manager, _queue);
    expect(find.byKey(InspectionApprovalsQueueKeys.row(_id)), findsOneWidget);
    expect(
      find.byKey(InspectionApprovalsQueueKeys.selectToggle),
      findsNothing,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a signer is offered bulk approve on the same queue', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _pmvManager, _queue);
    expect(
      find.byKey(InspectionApprovalsQueueKeys.selectToggle),
      findsOneWidget,
    );
  });

  testWidgets('a non-signer Manager reads a sheet with no Approve or Return', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _manager, _review);
    expect(find.byKey(InspectionApprovalReviewKeys.approve), findsNothing);
    expect(
      find.byKey(InspectionApprovalReviewKeys.returnForCorrection),
      findsNothing,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a signer gets Approve and Return on the same sheet', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _pmvManager, _review);
    expect(find.byKey(InspectionApprovalReviewKeys.approve), findsOneWidget);
    expect(
      find.byKey(InspectionApprovalReviewKeys.returnForCorrection),
      findsOneWidget,
    );
  });
}

final class _FakeRepository implements InspectionApprovalRepository {
  const _FakeRepository();

  @override
  Future<InspectionApprovalItem?> byId(String id) async =>
      id == _pending.id ? _pending : null;

  @override
  Future<String?> currentUserDisplayName(String userId) async => null;

  @override
  Future<void> decide(InspectionApprovalDecision input) async {}

  @override
  Future<List<InspectionApprovalItem>> listPending({String? country}) async =>
      const <InspectionApprovalItem>[_pending];

  @override
  Future<List<InspectionApprovalItem>> listByStatus(
    String status, {
    String? country,
  }) async =>
      const <InspectionApprovalItem>[];
}
