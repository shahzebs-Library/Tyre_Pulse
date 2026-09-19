import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/accidents/data/accident_dispatch_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_sla_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_handover_gating.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_dispatch_handover.dart';

const WorkspaceContext _workspace = WorkspaceContext(
  userId: 'user-1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.admin)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  activeCountry: 'KSA',
  fullName: 'Signed-in fleet officer',
);

const AccidentCaseSnapshot _snapshot = AccidentCaseSnapshot(
  accident: AccidentRecord(
    id: 'case-1',
    assetNo: 'CP-045',
    site: 'Incident yard',
    incidentDate: '2026-09-12',
    referenceNo: 'ACC-2026-0148',
    repairType: 'external',
  ),
  provisioned: true,
  workstreams: <AccidentWorkstream>[
    AccidentWorkstream(
      id: 'h',
      key: 'handover',
      status: 'in_progress',
      team: 'External workshop',
    ),
  ],
);

final DateTime _now = DateTime(2026, 9, 16, 15, 8);

class FakeDispatchRemote implements AccidentDispatchRemote {
  FakeDispatchRemote({
    this.dispatch,
    this.repairOrder,
    this.dispatchesMissing = false,
    this.vendorColumnsMissing = false,
  });

  Map<String, Object?>? dispatch;
  Map<String, Object?>? repairOrder;
  final bool dispatchesMissing;
  final bool vendorColumnsMissing;
  final List<Map<String, Object?>> inspections = <Map<String, Object?>>[];
  final List<String> uploads = <String>[];
  Map<String, Object?>? lastDispatchPatch;
  Map<String, Object?>? lastRepairPatch;

  @override
  Future<Map<String, Object?>?> latestDispatch(String accidentId) async {
    if (dispatchesMissing) {
      throw const PostgrestException(
        message: 'relation "public.accident_dispatches" does not exist',
        code: '42P01',
      );
    }
    return dispatch;
  }

  @override
  Future<Map<String, Object?>?> latestRepairOrder(
    String accidentId,
    List<String> columns,
  ) async {
    if (vendorColumnsMissing && columns.contains('vendor_city')) {
      throw const PostgrestException(
        message: 'column accident_repair_orders.vendor_city does not exist',
        code: '42703',
      );
    }
    return repairOrder;
  }

  @override
  Future<Map<String, Object?>> insertDispatch(Map<String, Object?> row) async {
    dispatch = <String, Object?>{'id': 'd-new', ...row};
    return dispatch!;
  }

  @override
  Future<Map<String, Object?>> updateDispatch(
    String id,
    Map<String, Object?> patch,
  ) async {
    lastDispatchPatch = patch;
    dispatch = <String, Object?>{...?dispatch, ...patch};
    return dispatch!;
  }

  @override
  Future<Map<String, Object?>> insertRepairOrder(
    Map<String, Object?> row,
  ) async {
    repairOrder = <String, Object?>{'id': 'ro-new', ...row};
    return repairOrder!;
  }

  @override
  Future<Map<String, Object?>> updateRepairOrder(
    String id,
    Map<String, Object?> patch,
  ) async {
    lastRepairPatch = patch;
    repairOrder = <String, Object?>{...?repairOrder, ...patch};
    return repairOrder!;
  }

  @override
  Future<void> insertHandoverInspection(Map<String, Object?> row) async {
    inspections.add(row);
  }

  @override
  Future<List<Map<String, Object?>>> slaInstances(String accidentId) async =>
      const <Map<String, Object?>>[];

  @override
  Future<String> uploadBytes({
    required String fileName,
    required Uint8List bytes,
    required String contentType,
  }) async {
    uploads.add(fileName);
    return 'tp-storage://accident-photos/accidents/user-1/$fileName';
  }

  @override
  Future<Uint8List> readLocalBytes(String path) async =>
      Uint8List.fromList(<int>[255, 216, 255, 224]);

  @override
  String? currentUserId() => 'user-1';
}

Map<String, Object?> _inTransitLeg() => <String, Object?>{
      'id': 'd1',
      'accident_id': 'case-1',
      'live_status': 'in_transit',
      'sent_by_name': 'Recorded sender',
      'departure_at': DateTime(2026, 9, 16, 14).toIso8601String(),
      'carrier': 'Recorded carrier',
      'driver_name': 'Recorded driver',
      'destination': 'Recorded workshop',
      'origin': 'Incident yard',
      'out_odometer_km': 41230,
      'keys_count': 2,
      'documents_sent': <Object?>['Registration', 'Insurance', 'Gate pass'],
      'accessories': <Object?>['Spare wheel', 'Jack'],
      'outgoing_photos': <Object?>['a', 'b', 'c'],
      'outgoing_signed_by': 'Recorded signer',
      'custody_accepted': false,
    };

Future<void> _pump(
  WidgetTester tester,
  FakeDispatchRemote remote, {
  Locale locale = const Locale('en'),
  List<String> navigated = const <String>[],
}) async {
  tester.view.physicalSize = const Size(400, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        workspaceContextProvider.overrideWithValue(_workspace),
        accidentSlaLoadProvider.overrideWith(
          (Ref ref, String id) async =>
              const AccidentSlaLoad(provisioned: true),
        ),
        accidentDispatchRepositoryProvider.overrideWithValue(
          AccidentDispatchRepository(remote, clock: () => _now),
        ),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Scaffold(
          body: SingleChildScrollView(
            child: AccidentDispatchHandoverMockWorkspace(
              snapshot: _snapshot,
              onNavigate: navigated.add,
              clock: () => _now,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('renders the M2 chips, sections and stepper from a live leg',
      (WidgetTester tester) async {
    final FakeDispatchRemote remote = FakeDispatchRemote(
      dispatch: _inTransitLeg(),
      repairOrder: <String, Object?>{
        'id': 'ro1',
        'repair_route': 'external',
        'external_workshop': 'Recorded workshop',
        'vendor_city': 'Recorded city',
        'vendor_contact_phone': '+966500000000',
      },
    );
    await _pump(tester, remote);
    expect(tester.takeException(), isNull);

    // Header chips.
    expect(find.text('Repair route'), findsOneWidget);
    expect(find.text('External workshop'), findsWidgets);
    expect(find.text('In transit'), findsWidgets);
    expect(find.text('1h 08m'), findsOneWidget);
    expect(find.text('Not started'), findsOneWidget);
    expect(
      find.text('Vendor SLA starts only after signed vehicle acceptance.'),
      findsOneWidget,
    );

    // Sections.
    for (final String title in <String>[
      'Destination and vendor',
      'Dispatch details',
      'Vehicle handover condition',
      'Workshop receipt',
    ]) {
      expect(find.text(title), findsOneWidget);
    }
    expect(find.text('Recorded city'), findsOneWidget);
    expect(find.text('Unassigned'), findsOneWidget);
    expect(find.text('3 documents'), findsOneWidget);
    expect(find.text('2 items'), findsOneWidget);
    expect(find.text('3 photos'), findsOneWidget);
    expect(find.text('Not set'), findsWidgets);

    // Stepper.
    expect(find.text('Dispatched'), findsOneWidget);
    expect(find.text('Complete'), findsOneWidget);
    expect(find.text('Next'), findsOneWidget);
    expect(find.text('Pending'), findsNWidgets(2));
    expect(
      find.text('Vendor assessment / quotation starts'),
      findsOneWidget,
    );

    // Receipt gate.
    final FilledButton accept = tester.widget<FilledButton>(
      find.byKey(const Key('accident.receipt.accept')),
    );
    expect(accept.onPressed, isNull);
    expect(
      find.text('Complete all required fields to enable'),
      findsOneWidget,
    );
    final OutlinedButton contact = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, 'Contact workshop'),
    );
    expect(contact.onPressed, isNotNull);
  });

  testWidgets('says so when the dispatch table is not provisioned yet',
      (WidgetTester tester) async {
    final FakeDispatchRemote remote = FakeDispatchRemote(
      dispatchesMissing: true,
      vendorColumnsMissing: true,
      repairOrder: <String, Object?>{
        'id': 'ro1',
        'external_workshop': 'Recorded workshop',
      },
    );
    await _pump(tester, remote);
    expect(tester.takeException(), isNull);
    expect(
      find.textContaining('Dispatch legs are not provisioned'),
      findsOneWidget,
    );
    expect(
      find.textContaining('Vendor contact fields are not provisioned'),
      findsOneWidget,
    );
    expect(find.text('Recorded workshop'), findsWidgets);
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'Record dispatch'),
          )
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const Key('accident.receipt.accept')),
          )
          .onPressed,
      isNull,
    );
  });

  testWidgets('edits vendor details inline and writes the vendor columns',
      (WidgetTester tester) async {
    final FakeDispatchRemote remote = FakeDispatchRemote(
      repairOrder: <String, Object?>{
        'id': 'ro1',
        'external_workshop': 'Recorded workshop',
      },
    );
    await _pump(tester, remote);
    await tester.ensureVisible(
      find.widgetWithText(OutlinedButton, 'Edit vendor details'),
    );
    await tester.tap(
      find.widgetWithText(OutlinedButton, 'Edit vendor details'),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Updated workshop');
    await tester.ensureVisible(find.text('Save vendor'));
    await tester.tap(find.text('Save vendor'));
    await tester.pumpAndSettle();
    expect(remote.lastRepairPatch?['external_workshop'], 'Updated workshop');
    expect(remote.lastRepairPatch?.containsKey('vendor_city'), isTrue);
    expect(find.text('Updated workshop'), findsWidgets);
  });

  testWidgets('remains readable at 400px in Arabic and Urdu',
      (WidgetTester tester) async {
    for (final String locale in <String>['ar', 'ur']) {
      await _pump(
        tester,
        FakeDispatchRemote(dispatch: _inTransitLeg()),
        locale: Locale(locale),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('1h 08m'), findsOneWidget);
    }
  });

  test('acceptCustody uploads, stamps custody and mirrors the legacy row',
      () async {
    final FakeDispatchRemote remote =
        FakeDispatchRemote(dispatch: _inTransitLeg());
    final AccidentDispatchRepository repo =
        AccidentDispatchRepository(remote, clock: () => _now);
    final AccidentDispatch leg = AccidentDispatch.fromRow(_inTransitLeg());
    final HandoverReceiptDraft receipt = HandoverReceiptDraft(
      arrivedAt: DateTime(2026, 9, 16, 15),
      receivedByName: 'Recorded receiver',
      receivedByDesignation: 'Workshop supervisor',
      conditionMatches: true,
      receivingPhotos: const <String>['/dev/photo1.jpg'],
      handoverPaperRef: '/dev/paper.jpg',
      receiverSignature: 'data:image/png;base64,iVBORw0KGgo=',
      custodyAccepted: true,
    );
    final AccidentDispatch saved =
        await repo.acceptCustody(dispatch: leg, receipt: receipt, site: 'Yard');
    expect(saved.custodyAccepted, isTrue);
    expect(saved.liveStatus, 'accepted');
    expect(remote.uploads.length, 3);
    expect(
      remote.lastDispatchPatch?['receiver_signature'],
      startsWith('tp-storage://accident-photos/'),
    );
    expect(remote.lastDispatchPatch?['accepted_by_id'], 'user-1');
    expect(remote.inspections.single['decision'], 'accepted');
    expect(remote.inspections.single['inspector_name'], 'Recorded receiver');
  });

  test('acceptCustody refuses an incomplete receipt and touches nothing',
      () async {
    final FakeDispatchRemote remote =
        FakeDispatchRemote(dispatch: _inTransitLeg());
    final AccidentDispatchRepository repo = AccidentDispatchRepository(remote);
    await expectLater(
      repo.acceptCustody(
        dispatch: AccidentDispatch.fromRow(_inTransitLeg()),
        receipt: const HandoverReceiptDraft(),
      ),
      throwsArgumentError,
    );
    expect(remote.uploads, isEmpty);
    expect(remote.inspections, isEmpty);
    expect(remote.lastDispatchPatch, isNull);
  });
}
