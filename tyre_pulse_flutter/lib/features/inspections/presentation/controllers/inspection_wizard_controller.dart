/// Drives the inspection capture wizard.
///
/// Every mutation that changes recorded data - a tyre reading, a photo, a
/// signature, the header fields - is written through to the draft
/// (`InspectionDraftRepository`) BEFORE this controller's own in-memory
/// [InspectionWizardState] is updated, so a process kill at any point
/// during a fill loses at most the in-flight write, never the sheet as a
/// whole. This is risk R2's actual fix, not merely this controller
/// remembering to call `saveHeader` occasionally.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/database/dao/drafts_dao.dart' show DraftsDao;
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_draft_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_gps_source.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_capture.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_remote_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_sync_engine.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_gps_fix.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_vehicle_type.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/inspections/presentation/state/inspection_wizard_state.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';
import 'package:tyre_pulse/features/tyres/presentation/serial_search_deps.dart';
import 'package:uuid/uuid.dart';

final NotifierProvider<InspectionWizardController, InspectionWizardState>
    inspectionWizardControllerProvider =
    NotifierProvider<InspectionWizardController, InspectionWizardState>(
  InspectionWizardController.new,
);

final class InspectionWizardController extends Notifier<InspectionWizardState> {
  Timer? _headerDebounce;
  static const Uuid _uuid = Uuid();

  /// Same interval `TyreRecordsListController` debounces search on -
  /// matches this codebase's own established feel for "not laggy, but
  /// collapses a burst of typing".
  static const Duration _kAutosaveDebounce = Duration(milliseconds: 350);

  Future<void>? _reconciled;

  @override
  InspectionWizardState build() {
    ref.onDispose(() => _headerDebounce?.cancel());
    unawaited(_loadUnfinishedDrafts());
    return const InspectionWizardState();
  }

  /// Moves any queued submission's draft off its live key before this
  /// wizard resolves or lists drafts - see
  /// `InspectionSyncEngine.reconcileQueuedDrafts`. Once per controller;
  /// best-effort (a failure here must never block starting an inspection).
  Future<void> _ensureQueuedDraftsDetached() {
    return _reconciled ??= () async {
      try {
        await ref.read(inspectionSyncEngineProvider).reconcileQueuedDrafts();
      } on Object {
        return;
      }
    }();
  }

  InspectionDraftRepository get _draftRepo =>
      ref.read(inspectionDraftRepositoryProvider);
  InspectionRemoteRepository get _remote =>
      ref.read(inspectionRemoteRepositoryProvider);
  InspectionPhotoCapture get _photoCapture =>
      ref.read(inspectionPhotoCaptureProvider);
  InspectionGpsSource get _gpsSource => ref.read(inspectionGpsSourceProvider);

  String get _userId => ref.read(workspaceContextProvider)?.userId ?? '';
  String get _workspaceId =>
      ref.read(workspaceContextProvider)?.companyId ??
      ref.read(workspaceContextProvider)?.tenantId ??
      '';
  String? get _country => ref.read(activeCountryProvider);

  /// Prefer the signed-in operator's display name for the audit record. The
  /// stable user id remains a truthful fallback for older cached profiles.
  String get _inspectorName {
    final String? name = ref.read(workspaceContextProvider)?.fullName?.trim();
    return (name == null || name.isEmpty) ? _userId : name;
  }

  // -- Entry ------------------------------------------------------------

  /// Called once, from the screen's `initState`. Resolves any resumable
  /// draft for [route]'s asset, seeds sites and, if a serial/position
  /// param arrived from a scan, pre-fills that one wheel exactly as
  /// `mobile/app/(app)/inspection/new.tsx`'s own scan-prefill effect
  /// does.
  Future<void> initialiseFromRoute(NewInspectionRoute route) async {
    // The site list is filtered by COUNTRY. The route's site name used to be
    // passed here, which filtered by a value no country column ever holds.
    unawaited(_loadSites(_country));

    if (route.siteName != null) {
      state = state.copyWith(selectedSite: route.siteName!.value);
    }

    final String? assetNo = route.assetNo?.value;
    if (assetNo != null && assetNo.trim().isNotEmpty) {
      await resumeOrStart(
        assetNo: assetNo,
        prefillSerial: route.tyreSerial?.value,
        prefillPosition: route.tyrePosition?.value,
      );
    }
  }

  /// Called when the SAME screen instance receives a different route - the
  /// router reuses the screen's State when only the query (the asset) changes,
  /// so `initState` does not run again. Without this, "Resume" from Home or
  /// "Inspect now" from an asset reopened whichever sheet was showing before.
  /// The sheet being left is already persisted as a draft, so nothing is
  /// discarded by switching.
  Future<void> reinitialiseFromRoute(NewInspectionRoute route) async {
    final String wanted = (route.assetNo?.value ?? '').trim();
    if (route.siteName != null) {
      state = state.copyWith(selectedSite: route.siteName!.value);
    }
    if (wanted.isEmpty) {
      if (state.hasVehicle) changeVehicle();
      return;
    }
    await resumeOrStart(
      assetNo: wanted,
      prefillSerial: route.tyreSerial?.value,
      prefillPosition: route.tyrePosition?.value,
    );
  }

  /// Resumes an existing draft for [assetNo], or starts a fresh one if
  /// none exists. Deterministic: the draft key is derived from
  /// `(userId, assetNo)`, so opening the same asset twice always reaches
  /// the same in-progress sheet - this is what lets the "resume
  /// unfinished work" list on My Inspections simply re-open this same
  /// route rather than needing a dedicated resume parameter.
  Future<void> resumeOrStart({
    required String assetNo,
    String? vehicleType,
    String? layoutVehicleType,
    String? site,
    String? prefillSerial,
    String? prefillPosition,
  }) async {
    if (_userId.isEmpty) return;
    if (assetNo.trim().isEmpty) {
      changeVehicle();
      return;
    }
    await _ensureQueuedDraftsDetached();
    final String draftKey = DraftsDao.inspectionDraftKey(
      userId: _userId,
      assetNo: assetNo,
    );

    final Map<String, TyrePositionReading> existingReadings =
        await _draftRepo.tyreReadingsWithPhotos(draftKey);
    final InspectionDraftSignature? existingSignature =
        await _draftRepo.signature(draftKey);
    final InspectionDraftHeader? savedHeader = await _draftRepo.header(
      draftKey,
    );

    // The RAW register type is recorded; the layout type only lays out the
    // wheels. A new pick never inherits the previous vehicle's type. An
    // entry by asset number alone (a route, a resume) takes the type from
    // the saved draft, else from the already-loaded fleet register.
    final VehicleAsset? fleetAsset =
        vehicleType == null ? _loadedFleetAsset(assetNo) : null;
    final String resolvedType = (vehicleType ??
            savedHeader?.vehicleType ??
            fleetAsset?.vehicleType ??
            '')
        .trim();
    final String layoutType = (layoutVehicleType ??
            inspectionLayoutVehicleType(
              vehicleType: resolvedType,
              assetNo: assetNo,
              make: fleetAsset?.make,
              model: fleetAsset?.model,
            ))
        .trim();
    final List<String> positions = diagramPositions(layoutType, assetNo);

    final Map<String, TyrePositionReading> seeded =
        <String, TyrePositionReading>{
      for (final String p in positions)
        p: existingReadings[p] ?? TyrePositionReading.seed(p),
    };

    Map<String, TyreFitment> installedTyres = const <String, TyreFitment>{};
    AppError? fitmentError;
    if (positions.isNotEmpty) {
      try {
        final List<TyreFitment> fitments = await ref
            .read(tyreFitmentRepositoryProvider)
            .activeForAsset(assetNo: assetNo, country: _country);
        installedTyres = fitmentsByInspectionSlot(
          vehicleType: layoutType,
          assetNo: assetNo,
          fitments: fitments,
        );
      } on AppError catch (error) {
        fitmentError = error;
      } on Object catch (error) {
        fitmentError = AppError(
          kind: AppErrorKind.unknown,
          message: 'The currently fitted tyre serials could not be loaded.',
          technical: 'activeForAsset($assetNo) failed: $error',
          isRetryable: true,
        );
      }
    }

    final String siteValue = site ??
        (savedHeader?.site?.trim().isNotEmpty == true
            ? savedHeader!.site!
            : state.selectedSite);

    String? seededActivePosition;
    if (prefillSerial != null && prefillSerial.trim().isNotEmpty) {
      final String wanted = (prefillPosition ?? '').trim().toLowerCase();
      final String target = positions.firstWhere(
        (p) => p.toLowerCase() == wanted,
        orElse: () => '',
      );
      if (target.isNotEmpty) {
        // A position row references its draft header (a real foreign key),
        // so a first scan of a machine with no draft yet must create the
        // header before the pre-filled wheel can be written.
        if (savedHeader == null) {
          await _draftRepo.saveHeader(
            userId: _userId,
            workspaceId: _workspaceId,
            assetNo: assetNo,
            filled: 0,
            total: positions.length,
            country: _country,
            vehicleType: resolvedType,
            site: siteValue,
          );
        }
        final TyrePositionReading updated = seeded[target]!.copyWith(
          serialNumber: prefillSerial,
        );
        seeded[target] = updated;
        // A scanned serial is filled in FOR the inspector - the wheel is not
        // yet attended to, so it must not satisfy the completeness gate.
        await _draftRepo.saveTyreReading(
          draftKey,
          updated,
          markChecked: false,
        );
        seededActivePosition = target;
      }
    }

    // A submitted sheet is finished work: its draft was detached on submit.
    // Reopening the same asset (Home, Inspect now) without pressing "New
    // inspection" must not carry the previous meters or notes forward.
    final bool sameDraft = state.draftKey == draftKey &&
        state.step != InspectionWizardStep.submitted;
    final String odometerText = sameDraft
        ? state.odometerText
        : (savedHeader?.odometerKm?.toString() ?? '');
    final String hourMeterText = sameDraft
        ? state.hourMeterText
        : _formatHours(savedHeader?.engineHours);
    final String headerNotes =
        sameDraft ? state.headerNotes : (savedHeader?.findings ?? '');

    state = state.copyWith(
      draftKey: draftKey,
      selectedAssetNo: assetNo,
      selectedVehicleType: resolvedType,
      layoutVehicleType: layoutType,
      inspectorName: _inspectorName,
      selectedSite: siteValue,
      odometerText: odometerText,
      hourMeterText: hourMeterText,
      headerNotes: headerNotes,
      positions: positions,
      tyreConditions: seeded,
      installedTyres: installedTyres,
      loadError: fitmentError,
      clearLoadError: fitmentError == null,
      inspectorSignature: existingSignature?.payload,
      clearInspectorSignature: existingSignature == null,
      activePosition: seededActivePosition,
      clearActivePosition: seededActivePosition == null,
      step: seededActivePosition != null
          ? InspectionWizardStep.tyres
          : (sameDraft ? state.step : InspectionWizardStep.header),
      clearSubmitOutcome: !sameDraft,
      clearSubmitWarning: !sameDraft,
    );

    // Re-save the header WITH what was restored - saving nulls here used
    // to wipe a resumed sheet's odometer, hour meter and findings.
    await _persistHeader();
  }

  /// Returns the wizard to "pick a vehicle", dropping everything that
  /// belonged to the previous vehicle - including its type, which a manual
  /// or unlisted pick used to inherit. The previous vehicle's draft is
  /// already persisted and stays resumable.
  void changeVehicle() {
    _headerDebounce?.cancel();
    state = InspectionWizardState(
      selectedSite: state.selectedSite,
      inspectorName: state.inspectorName,
      availableSites: state.availableSites,
      unfinishedDrafts: state.unfinishedDrafts,
      gpsStatus: state.gpsStatus,
      gpsFix: state.gpsFix,
    );
    unawaited(_loadUnfinishedDrafts());
  }

  /// The fleet register row for [assetNo] if the register is ALREADY
  /// loaded. Never waits on the network: an inspection must start offline.
  VehicleAsset? _loadedFleetAsset(String assetNo) {
    final String wanted = assetNo.trim().toUpperCase();
    try {
      final VehicleFleetListOutcome? outcome =
          ref.read(vehicleFleetListProvider).value;
      final List<VehicleAsset> assets = switch (outcome) {
        VehicleFleetListLoaded(:final assets) => assets,
        VehicleFleetListFromCache(:final assets) => assets,
        _ => const <VehicleAsset>[],
      };
      for (final VehicleAsset asset in assets) {
        if (asset.assetNo?.trim().toUpperCase() == wanted) return asset;
      }
    } on Object {
      return null;
    }
    return null;
  }

  static String _formatHours(double? hours) {
    if (hours == null) return '';
    return hours == hours.roundToDouble()
        ? hours.toInt().toString()
        : hours.toString();
  }

  Future<void> _loadSites(String? country) async {
    final List<String> sites = await _remote.listSites(country: country);
    state = state.copyWith(availableSites: sites);
  }

  Future<void> _loadUnfinishedDrafts() async {
    if (_userId.isEmpty) return;
    await _ensureQueuedDraftsDetached();
    if (!ref.mounted) return;
    final InspectionDraftRepository repo = _draftRepo;
    final List<InspectionDraftSummary> drafts =
        await repo.draftsForUser(_userId);
    final List<InspectionDraftSummary> unfinished = <InspectionDraftSummary>[];
    for (final InspectionDraftSummary draft in drafts) {
      if (await repo.hasContent(draft.draftKey)) {
        unfinished.add(draft);
      }
    }
    if (!ref.mounted) return;
    state = state.copyWith(unfinishedDrafts: unfinished);
  }

  // -- Header step --------------------------------------------------------

  void setSite(String site) {
    state = state.copyWith(selectedSite: site);
    _scheduleHeaderAutosave();
  }

  void setManualVehicle({
    required String assetNo,
    required String vehicleType,
  }) {
    unawaited(resumeOrStart(assetNo: assetNo, vehicleType: vehicleType));
  }

  /// [vehicleType] is the register's RAW type (recorded as-is);
  /// [layoutVehicleType] is optional and only set when the picker has
  /// make/model evidence - see `inspectionLayoutVehicleType`.
  void pickVehicleByAssetNo({
    required String assetNo,
    String? vehicleType,
    String? layoutVehicleType,
    String? site,
  }) {
    unawaited(
      resumeOrStart(
        assetNo: assetNo,
        vehicleType: vehicleType,
        layoutVehicleType: layoutVehicleType,
        site: site,
      ),
    );
  }

  void setOdometer(String text) {
    state = state.copyWith(odometerText: text);
    _scheduleHeaderAutosave();
  }

  void setHourMeter(String text) {
    state = state.copyWith(hourMeterText: text);
    _scheduleHeaderAutosave();
  }

  void setHeaderNotes(String text) {
    state = state.copyWith(headerNotes: text);
    _scheduleHeaderAutosave();
  }

  /// Debounced so a keystroke does not hammer the local database - the
  /// same discipline `checklists/[templateId].tsx`'s autosave already
  /// applies to the Android Keystore, applied here to Drift instead.
  void _scheduleHeaderAutosave() {
    _headerDebounce?.cancel();
    _headerDebounce = Timer(_kAutosaveDebounce, _persistHeader);
  }

  Future<void> _persistHeader() async {
    final String? key = state.draftKey;
    if (key == null) return;
    await _draftRepo.saveHeader(
      userId: _userId,
      workspaceId: _workspaceId,
      assetNo: state.selectedAssetNo,
      filled: state.touchedCount,
      total: state.positions.length,
      country: _country,
      vehicleType: state.selectedVehicleType,
      site: state.selectedSite,
      odometerKm: state.odometerInput.wholeValue,
      engineHours: state.hourMeterInput.value,
      findings:
          state.headerNotes.trim().isEmpty ? null : state.headerNotes.trim(),
    );
  }

  bool advanceToTyres() {
    if (state.selectedSite.trim().isEmpty ||
        !state.hasVehicle ||
        state.hasInvalidMeterReading) {
      return false;
    }
    state = state.copyWith(step: InspectionWizardStep.tyres);
    unawaited(_warmUpGps());
    return true;
  }

  // -- Tyres step -----------------------------------------------------------

  void openPosition(String position) {
    state = state.copyWith(activePosition: position);
  }

  void closePosition() {
    state = state.copyWith(clearActivePosition: true);
  }

  /// The SINGLE write path for a tyre edit. See
  /// `InspectionDraftRepository.saveTyreReading`'s own doc comment: every
  /// deliberate interaction, including confirming a default Good reading,
  /// must stamp `checked: true`, which is what lets a later completeness
  /// policy distinguish "attended to and fine" from "never looked at".
  Future<void> updateTyreReading(TyrePositionReading reading) async {
    final String? key = state.draftKey;
    final TyrePositionReading? previous =
        state.tyreConditions[reading.position];
    if (key != null &&
        previous != null &&
        previous.hasPhoto &&
        !reading.hasPhoto) {
      // The photo was removed in the editor. Its DraftPhotos row must go
      // too, or the photo reappears on resume and is uploaded on submit.
      await _removePhotos(key, reading.position);
    }
    final TyrePositionReading checked = reading.copyWith(checked: true);
    final Map<String, TyrePositionReading> updated =
        <String, TyrePositionReading>{...state.tyreConditions};
    updated[reading.position] = checked;
    state = state.copyWith(tyreConditions: updated, isSavingPosition: true);
    if (key != null) {
      await _draftRepo.saveTyreReading(key, checked);
      await _persistHeader();
    }
    state = state.copyWith(isSavingPosition: false);
  }

  Future<void> capturePhotoForActivePosition(PhotoCaptureSource source) async {
    final String? key = state.draftKey;
    final String? position = state.activePosition;
    if (key == null || position == null) return;

    state = state.copyWith(isCapturingPhoto: true);
    try {
      final CapturedPhoto? photo = await _photoCapture.captureAndStore(
        draftKey: key,
        position: position,
        source: source,
      );
      if (photo == null) return;

      await _draftRepo.addPhoto(
        draftKey: key,
        position: position,
        localPath: photo.localPath,
        capturedAt: photo.capturedAt,
        sizeBytes: photo.sizeBytes,
      );

      final TyrePositionReading current =
          state.tyreConditions[position] ?? TyrePositionReading.seed(position);
      await updateTyreReading(
        current.copyWith(photoLocalPath: photo.localPath),
      );
    } finally {
      state = state.copyWith(isCapturingPhoto: false);
    }
  }

  Future<void> _removePhotos(String draftKey, String position) async {
    final List<String> paths = await _draftRepo.removePhotos(
      draftKey,
      position,
    );
    for (final String path in paths) {
      try {
        final File file = File(path);
        if (file.existsSync()) await file.delete();
      } on Object {
        continue;
      }
    }
  }

  Future<void> _warmUpGps() async {
    if (state.gpsStatus != InspectionGpsStatus.idle) return;
    state = state.copyWith(gpsStatus: InspectionGpsStatus.capturing);
    final GpsCaptureResult result = await _gpsSource.captureFix();
    state = state.copyWith(gpsStatus: result.status, gpsFix: result.fix);
  }

  Future<void> retryGps() async {
    state = state.copyWith(gpsStatus: InspectionGpsStatus.capturing);
    final GpsCaptureResult result = await _gpsSource.captureFix();
    state = state.copyWith(gpsStatus: result.status, gpsFix: result.fix);
  }

  bool advanceToReview() {
    if (!state.canAdvanceToReview) return false;
    state = state.copyWith(step: InspectionWizardStep.review);
    return true;
  }

  void backToHeader() =>
      state = state.copyWith(step: InspectionWizardStep.header);
  void backToTyres() =>
      state = state.copyWith(step: InspectionWizardStep.tyres);

  // -- Review step --------------------------------------------------------

  Future<void> setSignature(String? svgOrDataUrl) async {
    state = state.copyWith(
      inspectorSignature: svgOrDataUrl,
      clearInspectorSignature: svgOrDataUrl == null,
    );
    final String? key = state.draftKey;
    if (key != null && svgOrDataUrl != null && svgOrDataUrl.isNotEmpty) {
      await _draftRepo.saveSignature(
        draftKey: key,
        payload: svgOrDataUrl,
        source: 'drawn',
        signerUserId: _userId,
      );
    }
  }

  // -- Submit ---------------------------------------------------------------

  Future<void> submit() async {
    final String? key = state.draftKey;
    if (key == null || state.submitIssues.isNotEmpty || state.isSubmitting) {
      return;
    }

    // A pending autosave firing AFTER the submit would recreate a header
    // under the live key the submission just vacated - a phantom
    // "unfinished" copy of work already queued.
    _headerDebounce?.cancel();
    state = state.copyWith(isSubmitting: true);
    try {
      final double? odometer = state.odometerInput.value;
      final double? hourMeter = state.hourMeterInput.value;
      final String observations = state.headerNotes.trim();
      // Mirrors `mobile/app/(app)/inspection/new.tsx`: the meter readings are
      // also folded into the free-text notes as typed, ahead of the
      // observations, so the record reads the same on every surface.
      final String odoText = state.odometerText.trim();
      final String hrsText = state.hourMeterText.trim();
      final String notes = <String>[
        if (odometer != null) 'Odometer: $odoText km',
        if (hourMeter != null) 'Hour meter: $hrsText h',
        if (observations.isNotEmpty) observations,
      ].join('\n');
      final DateTime now = DateTime.now();
      final String isoDate = _isoDate(now);

      final InspectionPayload payload = InspectionPayload(
        title: 'Daily Tyre Inspection - ${state.selectedSite} - $isoDate',
        site: state.selectedSite,
        assetNo: state.selectedAssetNo,
        vehicleType: state.selectedVehicleType,
        inspector: _inspectorName,
        createdBy: _userId.isEmpty ? null : _userId,
        inspectionDate: now,
        scheduledDate: now,
        tyreConditions: state.tyreConditions,
        notes: notes,
        findings: observations.isEmpty ? null : observations,
        odometerKm: odometer,
        hourMeter: hourMeter,
        inspectorSignature: state.inspectorSignature,
        approvalStatus: 'pending_approval',
        status: 'In Progress',
        country: _country,
        gpsFix: state.gpsFix,
      );

      final String clientUuid = _uuid.v4();
      final InspectionSubmitResult result = await ref
          .read(inspectionSyncEngineProvider)
          .submitNow(draftKey: key, payload: payload, clientUuid: clientUuid);

      // Opportunistic immediate re-attempt lives in the engine's own
      // `flushQueue`, triggered by the presentation layer on the next
      // screen that cares (My Inspections) - not repeated here, so this
      // method has exactly one job.
      state = state.copyWith(
        step: InspectionWizardStep.submitted,
        submitOutcome: result.outcome,
        submitWarning: result.warning,
        clearSubmitWarning: result.warning == null,
        lastClientUuid: result.clientUuid,
      );
      unawaited(_loadUnfinishedDrafts());
    } finally {
      state = state.copyWith(isSubmitting: false);
    }
  }

  /// Resets the wizard to start a genuinely new inspection - the "New
  /// inspection" action on the success screen.
  void startNew() {
    state = const InspectionWizardState();
    unawaited(_loadUnfinishedDrafts());
  }

  static String _isoDate(DateTime d) => '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';
}
