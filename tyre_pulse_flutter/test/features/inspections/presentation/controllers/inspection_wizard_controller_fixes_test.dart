/// Behaviour pins for the New Inspection logic fixes, run against a REAL
/// in-memory Drift draft store (no fake that could drift from the schema).
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_draft_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_uploader.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_remote_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_submission_queue.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_record.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/inspections/presentation/controllers/inspection_wizard_controller.dart';
import 'package:tyre_pulse/features/inspections/presentation/state/inspection_wizard_state.dart';
import 'package:tyre_pulse/features/tyres/data/tyre_fitment_repository.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';
import 'package:tyre_pulse/features/tyres/presentation/serial_search_deps.dart';

import '../../../../core/database/database_test_support.dart';

const String _userId = 'inspector-1';

const WorkspaceContext _workspace = WorkspaceContext(
  userId: _userId,
  role: UserRole.known(RoleId.inspector),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.inspector)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  companyId: 'company-1',
  activeCountry: 'KSA',
  fullName: 'A. Inspector',
);

final class _Remote implements InspectionRemoteRepository {
  final List<String?> siteCountries = <String?>[];
  final List<InspectionPayload> upserted = <InspectionPayload>[];

  @override
  Future<List<String>> listSites({String? country}) async {
    siteCountries.add(country);
    return <String>['NHC', 'DIRIYAH'];
  }

  @override
  Future<void> upsertInspection({
    required InspectionPayload payload,
    required String clientUuid,
  }) async =>
      upserted.add(payload);

  @override
  Future<InspectionRecord?> byId(String id) async => null;

  @override
  Future<List<InspectionRecord>> myInspections({
    required String createdBy,
    int limit = 100,
  }) async =>
      const <InspectionRecord>[];
}

final class _Queue implements InspectionSubmissionQueue {
  final Map<String, QueuedInspection> store = <String, QueuedInspection>{};

  @override
  Future<void> enqueue(QueuedInspection item) async => store[item.id] = item;

  @override
  Future<InspectionQueueReadResult> list() async =>
      InspectionQueueReadResult.ok(store.values.toList());

  @override
  Future<QueuedInspection?> byId(String id) async => store[id];

  @override
  Future<void> markSynced(String id, DateTime at) async {
    store[id] = store[id]!.copyWith(status: InspectionQueueStatus.synced);
  }

  @override
  Future<void> markFailed(String id, {required String error}) async {
    store[id] = store[id]!.copyWith(status: InspectionQueueStatus.failed);
  }

  @override
  Future<void> remove(String id) async => store.remove(id);

  @override
  Future<int> pendingCount() async => store.length;
}

final class _Uploader implements InspectionPhotoUploader {
  @override
  Future<String> upload({
    required String localPath,
    required String inspectionId,
    required String position,
  }) async =>
      'https://example.test/$position.jpg';
}

final class _NoFitments implements TyreFitmentRepository {
  @override
  Future<List<TyreFitment>> activeForAsset({
    required String assetNo,
    String? country,
  }) async =>
      const <TyreFitment>[];
}

Future<void> _settle() async {
  for (int i = 0; i < 10; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  late AppDatabase db;
  late DriftInspectionDraftRepository repo;
  late _Remote remote;
  late _Queue queue;
  late ProviderContainer container;

  InspectionWizardController controller() =>
      container.read(inspectionWizardControllerProvider.notifier);
  InspectionWizardState state() =>
      container.read(inspectionWizardControllerProvider);

  setUp(() {
    db = newMemoryDatabase();
    repo = DriftInspectionDraftRepository(db.draftsDao, db.mediaDao);
    remote = _Remote();
    queue = _Queue();
    container = ProviderContainer(
      overrides: [
        workspaceContextProvider.overrideWithValue(_workspace),
        inspectionDraftRepositoryProvider.overrideWithValue(repo),
        inspectionRemoteRepositoryProvider.overrideWithValue(remote),
        inspectionSubmissionQueueProvider.overrideWithValue(queue),
        inspectionPhotoUploaderProvider.overrideWithValue(_Uploader()),
        tyreFitmentRepositoryProvider.overrideWithValue(_NoFitments()),
        vehicleFleetListProvider.overrideWith(
          (ref) async => const VehicleFleetListLoaded(
            assets: <VehicleAsset>[],
            truncated: false,
          ),
        ),
      ],
    );
    container.read(inspectionWizardControllerProvider);
  });

  tearDown(() async {
    // Let fire-and-forget draft reads finish before the database closes.
    await _settle();
    container.dispose();
    await db.close();
  });

  test('P1-7 the site list is filtered by the active COUNTRY, not a site name',
      () async {
    await controller().initialiseFromRoute(
      const NewInspectionRoute(siteName: SiteName('NHC')),
    );
    await _settle();
    expect(remote.siteCountries, <String?>['KSA']);
    expect(state().selectedSite, 'NHC');
  });

  test(
      'P1-6 resuming restores the saved odometer, hour meter and findings '
      'and does not wipe them from the draft', () async {
    await repo.saveHeader(
      userId: _userId,
      workspaceId: 'company-1',
      assetNo: 'TM514',
      filled: 1,
      total: 12,
      vehicleType: 'TR-MIXER',
      site: 'NHC',
      odometerKm: 145200,
      engineHours: 812.5,
      findings: 'Mud on steer axle',
    );

    await controller().resumeOrStart(assetNo: 'TM514');

    expect(state().odometerText, '145200');
    expect(state().hourMeterText, '812.5');
    expect(state().headerNotes, 'Mud on steer axle');
    expect(state().selectedSite, 'NHC');
    expect(state().selectedVehicleType, 'TR-MIXER');

    final InspectionDraftHeader header =
        (await repo.header(state().draftKey!))!;
    expect(header.odometerKm, 145200);
    expect(header.engineHours, 812.5);
    expect(header.findings, 'Mud on steer axle');
  });

  test(
      'P0-2 tyreless equipment records its raw type, has no wheels and can '
      'move on to review', () async {
    await controller().resumeOrStart(
      assetNo: 'GN103',
      vehicleType: 'GENERATOR',
      site: 'NHC',
    );

    expect(state().selectedVehicleType, 'GENERATOR');
    expect(state().positions, isEmpty);
    expect(state().completeness.applicable, isFalse);
    expect(state().canAdvanceToReview, isTrue);
    expect(controller().advanceToTyres(), isTrue);
    expect(controller().advanceToReview(), isTrue);
    expect(
      (await repo.header(state().draftKey!))!.vehicleType,
      'GENERATOR',
    );
  });

  test(
      'P1-8 Change clears the previous vehicle; an unlisted asset does not '
      'inherit its type', () async {
    await controller().resumeOrStart(assetNo: 'TM514', vehicleType: 'TR-MIXER');
    expect(state().positions, isNotEmpty);

    controller().changeVehicle();
    expect(state().hasVehicle, isFalse);
    expect(state().selectedVehicleType, '');
    expect(state().draftKey, isNull);
    expect(state().positions, isEmpty);

    await controller().resumeOrStart(assetNo: 'ZZ999');
    expect(state().selectedVehicleType, '');
  });

  test('P1-9 removing a wheel photo removes it from the draft too', () async {
    await controller().resumeOrStart(assetNo: 'TM514', vehicleType: 'TR-MIXER');
    final String key = state().draftKey!;
    final String position = state().positions.first;
    await repo.addPhoto(
      draftKey: key,
      position: position,
      localPath: '/does/not/exist.jpg',
      capturedAt: DateTime.utc(2026, 9, 1),
    );
    await controller().resumeOrStart(assetNo: 'TM514', vehicleType: 'TR-MIXER');
    final TyrePositionReading withPhoto = state().tyreConditions[position]!;
    expect(withPhoto.hasPhoto, isTrue);

    await controller().updateTyreReading(
      withPhoto.copyWith(clearPhotoLocalPath: true, clearPhotoUrl: true),
    );

    expect(await repo.photosFor(key), isEmpty);
    await controller().resumeOrStart(assetNo: 'TM514', vehicleType: 'TR-MIXER');
    expect(state().tyreConditions[position]!.hasPhoto, isFalse);
  });

  test(
      'P0-4 an unreadable meter reading blocks and is reported; a formatted '
      'decimal is accepted', () async {
    await controller().resumeOrStart(
      assetNo: 'GN103',
      vehicleType: 'GENERATOR',
      site: 'NHC',
    );
    controller().setOdometer('12km');
    expect(state().hasInvalidMeterReading, isTrue);
    expect(
      state().submitIssues.first,
      InspectionSubmitIssue.invalidMeterReading,
    );
    expect(controller().advanceToTyres(), isFalse);

    controller().setOdometer('12,345.5');
    expect(state().hasInvalidMeterReading, isFalse);
    expect(state().odometerInput.value, 12345.5);
    expect(controller().advanceToTyres(), isTrue);
  });

  test(
      'P0-3 a queued submission is not offered for resume, and the next '
      'inspection of that machine starts a fresh sheet', () async {
    await controller().resumeOrStart(
      assetNo: 'GN103',
      vehicleType: 'GENERATOR',
      site: 'NHC',
    );
    controller().setOdometer('12,345');
    controller().setHourMeter('88.5');
    controller().setHeaderNotes('Guard rail loose');
    await controller().setSignature('<svg></svg>');
    expect(state().submitIssues, isEmpty);

    await controller().submit();
    expect(state().step, InspectionWizardStep.submitted);

    // Delivered: raw type recorded, meters folded into notes like RN.
    final InspectionPayload sent = remote.upserted.single;
    expect(sent.vehicleType, 'GENERATOR');
    expect(sent.odometerKm, 12345);
    expect(sent.hourMeter, 88.5);
    expect(sent.findings, 'Guard rail loose');
    expect(
      sent.notes,
      'Odometer: 12,345 km\nHour meter: 88.5 h\nGuard rail loose',
    );

    controller().startNew();
    await _settle();
    expect(state().unfinishedDrafts, isEmpty);
    await controller()
        .resumeOrStart(assetNo: 'GN103', vehicleType: 'GENERATOR');
    expect(state().odometerText, '');
    expect(state().inspectorSignature, isNull);
  });

  test(
      'P0-3 an entry queued by an older build under the live key is '
      'detached before the wizard lists or resumes drafts', () async {
    await repo.saveHeader(
      userId: _userId,
      workspaceId: 'company-1',
      assetNo: 'TM514',
      filled: 3,
      total: 12,
      odometerKm: 999,
    );
    final String live = repo.draftKeyFor(userId: _userId, assetNo: 'TM514');
    final DateTime now = DateTime.utc(2026, 9, 1);
    await queue.enqueue(
      QueuedInspection(
        id: 'legacy-1',
        draftKey: live,
        payload: InspectionPayload(
          title: 't',
          site: 'NHC',
          assetNo: 'TM514',
          vehicleType: 'TR-MIXER',
          inspector: 'A',
          inspectionDate: now,
          scheduledDate: now,
          tyreConditions: const <String, TyrePositionReading>{},
        ),
        createdAt: now,
        status: InspectionQueueStatus.failed,
      ),
    );

    final ProviderContainer fresh = ProviderContainer(
      overrides: [
        workspaceContextProvider.overrideWithValue(_workspace),
        inspectionDraftRepositoryProvider.overrideWithValue(repo),
        inspectionRemoteRepositoryProvider.overrideWithValue(remote),
        inspectionSubmissionQueueProvider.overrideWithValue(queue),
        inspectionPhotoUploaderProvider.overrideWithValue(_Uploader()),
        tyreFitmentRepositoryProvider.overrideWithValue(_NoFitments()),
        vehicleFleetListProvider.overrideWith(
          (ref) async => const VehicleFleetListLoaded(
            assets: <VehicleAsset>[],
            truncated: false,
          ),
        ),
      ],
    );
    addTearDown(fresh.dispose);
    fresh.read(inspectionWizardControllerProvider);
    await _settle();

    expect(
      fresh.read(inspectionWizardControllerProvider).unfinishedDrafts,
      isEmpty,
    );
    expect(queue.store['legacy-1']!.draftKey, '$live#submitted:legacy-1');

    await fresh
        .read(inspectionWizardControllerProvider.notifier)
        .resumeOrStart(assetNo: 'TM514', vehicleType: 'TR-MIXER');
    expect(fresh.read(inspectionWizardControllerProvider).odometerText, '');
  });

  test('P1-12 a new route on the same screen re-initialises to that asset',
      () async {
    await controller().resumeOrStart(assetNo: 'TM514', vehicleType: 'TR-MIXER');
    controller().advanceToTyres();

    await controller().reinitialiseFromRoute(
      const NewInspectionRoute(assetNo: AssetNo('GN103')),
    );
    expect(state().selectedAssetNo, 'GN103');
    expect(state().step, InspectionWizardStep.header);

    await controller().reinitialiseFromRoute(const NewInspectionRoute());
    expect(state().hasVehicle, isFalse);
  });

  test('P2 a scan pre-filled serial does not mark the wheel checked', () async {
    await controller().resumeOrStart(
      assetNo: 'TM514',
      vehicleType: 'TR-MIXER',
      prefillSerial: 'SN-77',
      prefillPosition: 'F1L',
    );
    final TyrePositionReading reading = state().tyreConditions['F1L']!;
    expect(reading.serialNumber, 'SN-77');
    expect(reading.checked, isFalse);
    expect(
      (await repo.tyreReadings(state().draftKey!))['F1L']!.checked,
      isFalse,
    );
  });
}
