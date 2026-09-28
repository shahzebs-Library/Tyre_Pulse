/// The state of the inspection capture wizard: header, tyres, review,
/// submit - matching `mobile/app/(app)/inspection/new.tsx`'s own four
/// named steps exactly.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_sync_engine.dart'
    show InspectionSubmitOutcome;
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_gps_fix.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/meter_reading_input.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';

enum InspectionWizardStep { header, tyres, review, submitted }

@immutable
class InspectionWizardState {
  const InspectionWizardState({
    this.step = InspectionWizardStep.header,
    this.draftKey,
    this.selectedSite = '',
    this.selectedAssetNo = '',
    this.selectedVehicleType = '',
    this.layoutVehicleType,
    this.inspectorName = '',
    this.useManualEntry = false,
    this.odometerText = '',
    this.hourMeterText = '',
    this.headerNotes = '',
    this.positions = const <String>[],
    this.tyreConditions = const <String, TyrePositionReading>{},
    this.installedTyres = const <String, TyreFitment>{},
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

  /// The fleet register's RAW vehicle type - what is recorded on the
  /// inspection row. See `inspection_vehicle_type.dart`.
  final String selectedVehicleType;

  /// The type the diagram, position list and completeness gate lay the
  /// wheels out by. Null means "same as [selectedVehicleType]".
  final String? layoutVehicleType;

  final String inspectorName;
  final bool useManualEntry;

  final String odometerText;
  final String hourMeterText;
  final String headerNotes;

  final List<String> positions;
  final Map<String, TyrePositionReading> tyreConditions;
  final Map<String, TyreFitment> installedTyres;
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

  String get effectiveLayoutType => layoutVehicleType ?? selectedVehicleType;

  MeterReadingInput get odometerInput => MeterReadingInput.parse(odometerText);
  MeterReadingInput get hourMeterInput =>
      MeterReadingInput.parse(hourMeterText);

  /// Whether the tyres step may move on to review. Tyreless equipment has
  /// nothing to record, so it is never held on the tyres step.
  bool get canAdvanceToReview {
    final TyreCompletenessResult result = completeness;
    if (!result.applicable) return true;
    return touchedCount > 0 && result.ok;
  }

  /// Either meter holds text that is not a readable number.
  bool get hasInvalidMeterReading =>
      odometerInput.isInvalid || hourMeterInput.isInvalid;

  int get touchedCount =>
      tyreConditions.values.where((r) => r.isTouched).length;

  TyreCompletenessResult get completeness => tyreCompleteness(
        effectiveLayoutType,
        selectedAssetNo,
        <String, Object?>{
          for (final MapEntry<String, TyrePositionReading> e
              in tyreConditions.entries)
            e.key: e.value.toEntry(),
        },
        kInspectionCompletenessOptions,
      );

  List<InspectionSubmitIssue> get submitIssues {
    final List<InspectionSubmitIssue> issues =
        validateInspectionForSubmit(_asPayload());
    if (hasInvalidMeterReading) {
      issues.insert(0, InspectionSubmitIssue.invalidMeterReading);
    }
    return issues;
  }

  /// Validation view only: completeness is judged on the LAYOUT type so the
  /// gate and the diagram cannot disagree. The submitted row carries the raw
  /// [selectedVehicleType] - see the controller's `submit`.
  InspectionPayload _asPayload() {
    final double? odometer = odometerInput.value;
    final double? hourMeter = hourMeterInput.value;
    return InspectionPayload(
      title: 'Inspection - $selectedSite - $selectedAssetNo',
      site: selectedSite,
      assetNo: selectedAssetNo,
      vehicleType: effectiveLayoutType,
      inspector: inspectorName,
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
    String? layoutVehicleType,
    bool clearLayoutVehicleType = false,
    String? inspectorName,
    bool? useManualEntry,
    String? odometerText,
    String? hourMeterText,
    String? headerNotes,
    List<String>? positions,
    Map<String, TyrePositionReading>? tyreConditions,
    Map<String, TyreFitment>? installedTyres,
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
      layoutVehicleType: clearLayoutVehicleType
          ? null
          : (layoutVehicleType ?? this.layoutVehicleType),
      inspectorName: inspectorName ?? this.inspectorName,
      useManualEntry: useManualEntry ?? this.useManualEntry,
      odometerText: odometerText ?? this.odometerText,
      hourMeterText: hourMeterText ?? this.hourMeterText,
      headerNotes: headerNotes ?? this.headerNotes,
      positions: positions ?? this.positions,
      tyreConditions: tyreConditions ?? this.tyreConditions,
      installedTyres: installedTyres ?? this.installedTyres,
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
