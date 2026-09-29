// Pins the fix for "the approval shows OLD data instead of what the
// inspector just filled":
//
// 1. The queue lives in a StatefulShellBranch, so its State survives tab
//    switches and reviews pushed over it. It must re-read when it comes back
//    into view, or a supervisor is offered a stale list (and, for a vehicle
//    that already had an older pending inspection, only that older sheet).
// 2. go_router keys the review page by its route PATTERN, so a navigation to
//    another inspection id can reuse the review State. The review must load
//    the NEW id and must never let a slow read of the previous id paint over
//    it.
import 'dart:async';

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
import 'package:tyre_pulse/features/approvals/presentation/inspection_approval_review_screen.dart';
import 'package:tyre_pulse/features/approvals/presentation/inspection_approvals_queue_screen.dart';

const InspectionApprovalItem _older = InspectionApprovalItem(
  id: 'inspection-older',
  title: 'Older sheet',
  assetNo: 'TM514',
  vehicleType: 'Pickup',
  inspector: 'Earlier inspector',
  createdAt: '2026-09-20T08:00:00.000Z',
  approvalStatus: 'pending_approval',
);

const InspectionApprovalItem _newer = InspectionApprovalItem(
  id: 'inspection-newer',
  title: 'Newer sheet',
  assetNo: 'TM514',
  vehicleType: 'Pickup',
  inspector: 'Todays inspector',
  createdAt: '2026-09-29T08:00:00.000Z',
  approvalStatus: 'pending_approval',
);

final class _MutableRepository implements InspectionApprovalRepository {
  _MutableRepository(this.pending);

  List<InspectionApprovalItem> pending;
  int listPendingCalls = 0;

  /// Per-id completers let a test hold one read open while another lands.
  final Map<String, Completer<InspectionApprovalItem?>> held =
      <String, Completer<InspectionApprovalItem?>>{};
  final Map<String, InspectionApprovalItem> byIdRows =
      <String, InspectionApprovalItem>{
    _older.id: _older,
    _newer.id: _newer,
  };

  @override
  Future<List<InspectionApprovalItem>> listPending({String? country}) async {
    listPendingCalls++;
    return List<InspectionApprovalItem>.of(pending);
  }

  @override
  Future<List<InspectionApprovalItem>> listByStatus(
    String status, {
    String? country,
  }) async =>
      const <InspectionApprovalItem>[];

  @override
  Future<InspectionApprovalItem?> byId(String id) {
    final Completer<InspectionApprovalItem?>? hold = held[id];
    if (hold != null) return hold.future;
    return Future<InspectionApprovalItem?>.value(byIdRows[id]);
  }

  @override
  Future<String?> currentUserDisplayName(String userId) async => null;

  @override
  Future<void> decide(InspectionApprovalDecision input) async {}
}

Widget _app(_MutableRepository repository, Widget home) {
  return ProviderScope(
    overrides: <Override>[
      inspectionApprovalRepositoryProvider.overrideWithValue(repository),
    ],
    child: MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: TpTheme.light,
      locale: const Locale('en'),
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: home,
    ),
  );
}

InspectionApprovalReviewScreen _review(String id) =>
    InspectionApprovalReviewScreen(
      route: InspectionApprovalReviewRoute(inspectionId: InspectionId(id)),
    );

void main() {
  testWidgets('queue re-reads when it comes back into view', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final _MutableRepository repository =
        _MutableRepository(<InspectionApprovalItem>[_older]);
    final ValueNotifier<bool> shown = ValueNotifier<bool>(true);
    addTearDown(shown.dispose);

    await tester.pumpWidget(
      _app(
        repository,
        ValueListenableBuilder<bool>(
          valueListenable: shown,
          // Exactly how an unselected shell branch hides its screen.
          builder: (BuildContext context, bool value, Widget? child) =>
              TickerMode(enabled: value, child: child!),
          child: const InspectionApprovalsQueueScreen(
            route: InspectionApprovalsRoute(),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(repository.listPendingCalls, 1);
    expect(
      find.byKey(InspectionApprovalsQueueKeys.row(_older.id)),
      findsOneWidget,
    );
    expect(
      find.byKey(InspectionApprovalsQueueKeys.row(_newer.id)),
      findsNothing,
    );

    // The supervisor switches tab; meanwhile the field submits a new sheet.
    shown.value = false;
    await tester.pump();
    repository.pending = <InspectionApprovalItem>[_newer, _older];
    expect(repository.listPendingCalls, 1);

    // Back to the Approvals tab: the queue must show the new submission.
    shown.value = true;
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(repository.listPendingCalls, 2);
    expect(
      find.byKey(InspectionApprovalsQueueKeys.row(_newer.id)),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('review reused for another id loads that id, not the old one', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final _MutableRepository repository =
        _MutableRepository(<InspectionApprovalItem>[]);
    await tester.pumpWidget(_app(repository, _review(_older.id)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Earlier inspector'), findsOneWidget);

    // Same widget type in the same slot = the State is reused, exactly as
    // go_router does for a new id under the same route pattern.
    await tester.pumpWidget(_app(repository, _review(_newer.id)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Todays inspector'), findsOneWidget);
    expect(find.text('Earlier inspector'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a slow read of the previous id never overwrites the new one', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final _MutableRepository repository =
        _MutableRepository(<InspectionApprovalItem>[]);
    final Completer<InspectionApprovalItem?> slowOlder =
        Completer<InspectionApprovalItem?>();
    repository.held[_older.id] = slowOlder;

    await tester.pumpWidget(_app(repository, _review(_older.id)));
    await tester.pump();

    await tester.pumpWidget(_app(repository, _review(_newer.id)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Todays inspector'), findsOneWidget);

    // The earlier, slower read finally lands. It must be discarded.
    slowOlder.complete(_older);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Todays inspector'), findsOneWidget);
    expect(find.text('Earlier inspector'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
