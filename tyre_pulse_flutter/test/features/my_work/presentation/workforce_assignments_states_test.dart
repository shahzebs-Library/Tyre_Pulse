/// The assignment lane's honest states (loading, empty, error with Retry,
/// offline cache) and localisation, kept from the workforce hardening branch.
/// Status changes themselves are covered by workforce_assignments_panel_test.dart
/// (durable offline queue).
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignments_repository.dart';
import 'package:tyre_pulse/features/my_work/presentation/workforce_assignments_panel.dart';
import 'package:tyre_pulse/features/my_work/workforce_sync_providers.dart';

const WorkforceAssignment _assigned = WorkforceAssignment(
  id: 'a1',
  title: 'Replace tyre TM-214',
  status: 'assigned',
  priority: 'high',
  site: 'NHC',
);

final class _FakeSource implements WorkforceAssignmentsSource {
  _FakeSource(this.snapshots);

  /// Each call to [listMine] consumes one entry; the last one repeats.
  final List<Object> snapshots;
  int listCalls = 0;
  Future<void>? hold;

  @override
  Future<WorkforceAssignmentSnapshot> listMine() async {
    if (hold != null) await hold;
    final Object next = snapshots[
        listCalls < snapshots.length ? listCalls : snapshots.length - 1];
    listCalls++;
    if (next is WorkforceAssignmentSnapshot) return next;
    if (next is Error) throw next;
    throw next as Exception;
  }

  @override
  Future<void> advance(WorkforceAssignment item) async {}
}

Future<void> _pump(
  WidgetTester tester,
  _FakeSource source, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(390, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workforceAssignmentsRepositoryProvider.overrideWithValue(source),
        workforceUserIdProvider.overrideWithValue(null),
      ],
      child: MaterialApp(
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const Scaffold(
          body: SingleChildScrollView(child: WorkforceAssignmentsPanel()),
        ),
      ),
    ),
  );
}

WorkforceAssignmentSnapshot _snap(
  List<WorkforceAssignment> items, {
  bool offline = false,
}) =>
    WorkforceAssignmentSnapshot(items: items, offline: offline);

void main() {
  testWidgets('shows a loading indicator, then the assignment', (tester) async {
    final Completer<void> hold = Completer<void>();
    final _FakeSource source = _FakeSource(<Object>[
      _snap(<WorkforceAssignment>[_assigned]),
    ])
      ..hold = hold.future;
    await _pump(tester, source);
    expect(find.byKey(WorkforceAssignmentsPanelKeys.loading), findsOneWidget);

    hold.complete();
    await tester.pumpAndSettle();
    expect(find.text('Replace tyre TM-214'), findsOneWidget);
    expect(find.byKey(WorkforceAssignmentsPanelKeys.loading), findsNothing);
  });

  testWidgets('empty state', (tester) async {
    await _pump(
      tester,
      _FakeSource(<Object>[_snap(const <WorkforceAssignment>[])]),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(WorkforceAssignmentsPanelKeys.empty), findsOneWidget);
  });

  testWidgets('error state offers Retry which reloads, with no raw text',
      (tester) async {
    final _FakeSource source = _FakeSource(<Object>[
      StateError('boom'),
      _snap(<WorkforceAssignment>[_assigned]),
    ]);
    await _pump(tester, source);
    await tester.pumpAndSettle();
    expect(find.byKey(WorkforceAssignmentsPanelKeys.error), findsOneWidget);
    expect(find.text('boom'), findsNothing, reason: 'no raw error text');

    await tester.tap(find.byKey(WorkforceAssignmentsPanelKeys.retry));
    await tester.pumpAndSettle();
    expect(source.listCalls, 2);
    expect(find.text('Replace tyre TM-214'), findsOneWidget);
  });

  testWidgets('offline cache is labelled', (tester) async {
    await _pump(
      tester,
      _FakeSource(<Object>[
        _snap(<WorkforceAssignment>[_assigned], offline: true),
      ]),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(WorkforceAssignmentsPanelKeys.offline), findsOneWidget);
    expect(find.text('Replace tyre TM-214'), findsOneWidget);
  });

  testWidgets('Arabic renders the translated title and RTL direction',
      (tester) async {
    await _pump(
      tester,
      _FakeSource(<Object>[
        _snap(<WorkforceAssignment>[_assigned]),
      ]),
      locale: const Locale('ar'),
    );
    await tester.pumpAndSettle();
    expect(find.text('مهام الشركة'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text('مهام الشركة'))),
      TextDirection.rtl,
    );
  });
}
