/// The state of the inspection capture wizard: header, tyres, review,
/// submit - matching `mobile/app/(app)/inspection/new.tsx`'s own four
/// named steps exactly.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_gps_fix.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_sync_engine.dart'
    show InspectionSubmitOutcome;
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';

enum InspectionWizardStep { header, tyres, review, submitted }

@immutable
class InspectionWizardState {
  const InspectionWizardState({
    this.step = InspectionWizardStep.header,
    this.draftKey,
    this.selectedSite = '',
    this.selectedAssetNo = '',
    this.selectedVehicleType = '',
    this.useManualEntry = false,
    this.odometerText = '',
    this.hourMeterText = '',
    this.headerNotes = '',
    this.positions = const <String>[],
    this.tyreConditions = const <String, TyrePositionReading>{},
    this.activePosition,
    this.inspectorSignature,
    this.gpsStatus = InspectionGpsStatus.idle,
    this.gpsFix,
    this.availableSites = const <String>[],
    this.unfinishedDrafts = const <InspectionDraftSummary>[],
    this.isSavingPosition = false,
    this.isSubmitting = false,
    this.isCapturingPhoto = false,
    this.loadError,
    this.submitOutcome,
    this.submitWarning,
    this.lastClientUuid,
  });

  final InspectionWizardStep step;

  /// Set as soon as an asset (and therefore a user + asset pair) is
  /// known - see `DraftsDao.inspectionDraftKey`. Null only on the header
  /// step before any vehicle has been picked.
  final String? draftKey;

  final String selectedSite;
  final String selectedAssetNo;
  final String selectedVehicleType;
  final bool useManualEntry;

  final String odometerText;
  final String hourMeterText;
  final String headerNotes;

  final List<String> positions;
  final Map<String, TyrePositionReading> tyreConditions;
  final String? activePosition;

  final String? inspectorSignature;

  final InspectionGpsStatus gpsStatus;
  final InspectionGpsFix? gpsFix;

  final List<String> availableSites;
  final List<InspectionDraftSummary> unfinishedDrafts;

  final bool isSavingPosition;
  final bool isSubmitting;
  final bool isCapturingPhoto;

  final AppError? loadError;

  final InspectionSubmitOutcome? submitOutcome;
  final AppError? submitWarning;
  final String? lastClientUuid;

  bool get hasVehicle => selectedAssetNo.trim().isNotEmpty;

  int get touchedCount =>
      tyreConditions.values.where((r) => r.isTouched).length;

  TyreCompletenessResult get completeness =>
      tyreCompleteness(selectedVehicleType, selectedAssetNo, <String, Object?>{
        for (final MapEntry<String, TyrePositionReading> e
            in tyreConditions.entries)
          e.key: e.value.toEntry(),
      });

  List<InspectionSubmitIssue> get submitIssues =>
      validateInspectionForSubmit(_asPayload());

  InspectionPayload _asPayload() {
    final int? odometer = int.tryParse(odometerText.trim());
    final double? hourMeter = double.tryParse(hourMeterText.trim());
    return InspectionPayload(
      title: 'Inspection - $selectedSite - $selectedAssetNo',
      site: selectedSite,
      assetNo: selectedAssetNo,
      vehicleType: selectedVehicleType,
      inspector: '',
      inspectionDate: DateTime.now(),
      scheduledDate: DateTime.now(),
      tyreConditions: tyreConditions,
      notes: headerNotes,
      odometerKm: odometer,
      hourMeter: hourMeter,
      inspectorSignature: inspectorSignature,
      gpsFix: gpsFix,
    );
  }

  InspectionWizardState copyWith({
    InspectionWizardStep? step,
    String? draftKey,
    String? selectedSite,
    String? selectedAssetNo,
    String? selectedVehicleType,
    bool? useManualEntry,
    String? odometerText,
    String? hourMeterText,
    String? headerNotes,
    List<String>? positions,
    Map<String, TyrePositionReading>? tyreConditions,
    String? activePosition,
    bool clearActivePosition = false,
    String? inspectorSignature,
    bool clearInspectorSignature = false,
    InspectionGpsStatus? gpsStatus,
    InspectionGpsFix? gpsFix,
    List<String>? availableSites,
    List<InspectionDraftSummary>? unfinishedDrafts,
    bool? isSavingPosition,
    bool? isSubmitting,
    bool? isCapturingPhoto,
    AppError? loadError,
    bool clearLoadError = false,
    InspectionSubmitOutcome? submitOutcome,
    bool clearSubmitOutcome = false,
    AppError? submitWarning,
    bool clearSubmitWarning = false,
    String? lastClientUuid,
  }) {
    return InspectionWizardState(
      step: step ?? this.step,
      draftKey: draftKey ?? this.draftKey,
      selectedSite: selectedSite ?? this.selectedSite,
      selectedAssetNo: selectedAssetNo ?? this.selectedAssetNo,
      selectedVehicleType: selectedVehicleType ?? this.selectedVehicleType,
      useManualEntry: useManualEntry ?? this.useManualEntry,
      odometerText: odometerText ?? this.odometerText,
      hourMeterText: hourMeterText ?? this.hourMeterText,
      headerNotes: headerNotes ?? this.headerNotes,
      positions: positions ?? this.positions,
      tyreConditions: tyreConditions ?? this.tyreConditions,
      activePosition:
          clearActivePosition ? null : (activePosition ?? this.activePosition),
      inspectorSignature: clearInspectorSignature
          ? null
          : (inspectorSignature ?? this.inspectorSignature),
      gpsStatus: gpsStatus ?? this.gpsStatus,
      gpsFix: gpsFix ?? this.gpsFix,
      availableSites: availableSites ?? this.availableSites,
      unfinishedDrafts: unfinishedDrafts ?? this.unfinishedDrafts,
      isSavingPosition: isSavingPosition ?? this.isSavingPosition,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      isCapturingPhoto: isCapturingPhoto ?? this.isCapturingPhoto,
      loadError: clearLoadError ? null : (loadError ?? this.loadError),
      submitOutcome:
          clearSubmitOutcome ? null : (submitOutcome ?? this.submitOutcome),
      submitWarning:
          clearSubmitWarning ? null : (submitWarning ?? this.submitWarning),
      lastClientUuid: lastClientUuid ?? this.lastClientUuid,
    );
  }
}
