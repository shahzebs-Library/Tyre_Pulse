/// Shared fake wiring for tests that pump `AccidentCaseWorkspaceView` or the
/// whole case screen. Every repository the seven mock workspaces read is
/// replaced by an in-memory stand-in, so a test never reaches Supabase and a
/// table that "does not exist" is a deliberate choice, not an accident.
///
/// The individual `accident_ws_*_test.dart` suites keep their own richer
/// fakes; this file only carries what is needed for every workspace to render.
library;

import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_assessment_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_docs_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_claim_package_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_claim_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_dispatch_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_fleet_validation_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_liability_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_sla_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_timeline_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_workstream_repository.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';

import 'accident_ws_test_support.dart';

/// A 1x1 GIF so evidence thumbnails resolve without any network.
const String accidentCaseFakeImage =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

/// The frozen clock every time-aware fake shares.
final DateTime accidentCaseFakeNow = DateTime(2026, 9, 16, 15, 8);

/// In-memory secure store so the responsibility draft is real in tests.
final class MemorySecureStore extends SecureKeyValueStore {
  final Map<String, String> values = <String, String>{};

  @override
  int get readFailureCount => 0;

  @override
  Future<SecureRead> read(String key) async {
    final String? value = values[key];
    return value == null ? const SecureRead.absent() : SecureRead.ok(value);
  }

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

/// An empty, provisioned dispatch backend: no leg, no repair order.
final class EmptyDispatchRemote implements AccidentDispatchRemote {
  Map<String, Object?>? dispatch;
  Map<String, Object?>? repairOrder;

  @override
  Future<Map<String, Object?>?> latestDispatch(String accidentId) async =>
      dispatch;

  @override
  Future<Map<String, Object?>?> latestRepairOrder(
    String accidentId,
    List<String> columns,
  ) async =>
      repairOrder;

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
    repairOrder = <String, Object?>{...?repairOrder, ...patch};
    return repairOrder!;
  }

  @override
  Future<void> insertHandoverInspection(Map<String, Object?> row) async {}

  @override
  Future<List<Map<String, Object?>>> slaInstances(String accidentId) async =>
      const <Map<String, Object?>>[];

  @override
  Future<String> uploadBytes({
    required String fileName,
    required Uint8List bytes,
    required String contentType,
  }) async =>
      'tp-storage://accident-photos/accidents/user-1/$fileName';

  @override
  Future<Uint8List> readLocalBytes(String path) async =>
      Uint8List.fromList(<int>[255, 216, 255, 224]);

  @override
  String? currentUserId() => 'user-1';
}

/// An empty, provisioned timeline backend: no communications, evidence,
/// SLA clocks, dispatch leg or position.
final class EmptyTimelineRemote implements AccidentTimelineRemote {
  final List<Map<String, Object?>> inserted = <Map<String, Object?>>[];

  @override
  Future<List<Map<String, Object?>>> communications(String accidentId) async =>
      const <Map<String, Object?>>[];

  @override
  Future<List<Map<String, Object?>>> evidence(String accidentId) async =>
      const <Map<String, Object?>>[];

  @override
  Future<List<Map<String, Object?>>> slaInstances(String accidentId) async =>
      const <Map<String, Object?>>[];

  @override
  Future<Map<String, Object?>?> latestDispatch(String accidentId) async =>
      null;

  @override
  Future<Map<String, Object?>?> accidentPosition(String accidentId) async =>
      null;

  @override
  Future<Map<String, Object?>> insertCommunication(
    Map<String, Object?> row,
  ) async {
    inserted.add(row);
    return <String, Object?>{'id': 'new-${inserted.length}', ...row};
  }

  @override
  String? currentUserId() => 'user-1';
}

/// Every override the seven case workspaces need to render offline.
///
/// [rows] backs the assessment and claim-package repositories; seed it before
/// pumping when a test needs stored assessment or evidence rows.
List<Override> accidentCaseWorkspaceOverrides({
  WorkspaceContext workspace = testWorkspace,
  FakeAccidentCaseRows? rows,
}) {
  final FakeAccidentCaseRows caseRows = rows ?? FakeAccidentCaseRows();
  return <Override>[
    workspaceContextProvider.overrideWithValue(workspace),
    secureStoreProvider.overrideWithValue(MemorySecureStore()),
    privateStorageReferenceResolverProvider.overrideWithValue(
      PrivateStorageReferenceResolver(
        (String bucket, String path, int expiresIn) async =>
            accidentCaseFakeImage,
      ),
    ),
    vehicleDetailProvider.overrideWith(
      (Ref ref, String assetNo) async => const VehicleDetailNotFound(),
    ),
    accidentSlaRepositoryProvider.overrideWithValue(
      AccidentSlaRepository((_) async => <Map<String, dynamic>>[]),
    ),
    accidentSlaLoadProvider.overrideWith(
      (Ref ref, String id) async => const AccidentSlaLoad(provisioned: true),
    ),
    accidentFleetValidationRepositoryProvider.overrideWithValue(
      AccidentFleetValidationRepository(
        read: (_) async => <Map<String, dynamic>>[],
        upsert: (Map<String, Object?> row) async =>
            <String, dynamic>{...row, 'id': 'fv-1'},
      ),
    ),
    accidentCaseDocsRepositoryProvider.overrideWithValue(
      AccidentCaseDocsRepository(
        read: (_) async => <Map<String, dynamic>>[],
        insert: (String table, Map<String, Object?> row) async =>
            <String, dynamic>{...row, 'id': 'doc-1'},
        upload: (_, __, ___, ____) async {},
        currentUserId: () => 'user-1',
      ),
    ),
    accidentWorkstreamRepositoryProvider.overrideWithValue(
      AccidentWorkstreamRepository(
        (String name, Map<String, dynamic> params) =>
            Future<dynamic>.value(<String, dynamic>{'ok': true}),
      ),
    ),
    accidentLiabilityRepositoryProvider.overrideWithValue(
      AccidentLiabilityRepository(
        read: (String table, String columns, Map<String, Object> f) async =>
            <Map<String, dynamic>>[],
        insert: (String table, Map<String, Object?> row) async =>
            <String, dynamic>{...row, 'id': 'li-1'},
        update: (String table, String id, Map<String, Object?> patch) async =>
            <String, dynamic>{...patch, 'id': id},
      ),
    ),
    accidentClaimPackageRepositoryProvider.overrideWithValue(
      AccidentClaimPackageRepository(
        caseRows,
        AccidentClaimRepository(
          (String id) async => null,
          (String name, Map<String, dynamic> params) async =>
              <String, dynamic>{'ok': true},
        ),
      ),
    ),
    accidentAssessmentRepositoryProvider.overrideWithValue(
      AccidentAssessmentRepository(caseRows),
    ),
    accidentDispatchRepositoryProvider.overrideWithValue(
      AccidentDispatchRepository(
        EmptyDispatchRemote(),
        clock: () => accidentCaseFakeNow,
      ),
    ),
    accidentTimelineRepositoryProvider.overrideWithValue(
      AccidentTimelineRepository(
        EmptyTimelineRemote(),
        clock: () => accidentCaseFakeNow,
      ),
    ),
  ];
}
