/// Localised text for the workforce assignment lane: blocker causes, server
/// refusal reasons and operational-record kinds. Pure functions over
/// [AppLocalizations] so they are testable without a widget tree.
library;

import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_sync_engine.dart';
import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';

String workforceBlockCauseLabel(
  AppLocalizations l10n,
  WorkforceBlockReason? reason,
) {
  switch (reason) {
    case WorkforceBlockReason.waitingStock:
      return l10n.wfBlockCauseWaitingStock;
    case WorkforceBlockReason.waitingEquipment:
      return l10n.wfBlockCauseWaitingEquipment;
    case WorkforceBlockReason.vehicleUnavailable:
      return l10n.wfBlockCauseVehicleUnavailable;
    case WorkforceBlockReason.safetyHold:
      return l10n.wfBlockCauseSafetyHold;
    case WorkforceBlockReason.waitingApproval:
      return l10n.wfBlockCauseWaitingApproval;
    case WorkforceBlockReason.waitingManpower:
      return l10n.wfBlockCauseWaitingManpower;
    case WorkforceBlockReason.other:
      return l10n.wfBlockCauseOther;
    case null:
      // A block queued by an older build that never asked for a cause.
      return l10n.wfBlockCauseNotRecorded;
  }
}

/// The localised sentence for a server refusal [reason], with the current
/// status appended when the server reported one. `null` when [reason] is not
/// a server refusal code (a client-side classification), in which case the
/// caller shows the stored sentence instead.
String? workforceRefusalText(
  AppLocalizations l10n,
  String? reason, {
  String? currentStatus,
  String Function(String status)? statusLabel,
}) {
  if (reason == null || !workforceServerRefusalReasons.contains(reason)) {
    return null;
  }
  final String base = switch (reason) {
    'invalid_transition' => l10n.wfRefusedInvalidTransition,
    'not_found' => l10n.wfRefusedNotFound,
    'forbidden' => l10n.wfRefusedForbidden,
    'note_required' => l10n.wfRefusedNoteRequired,
    'key_reuse' => l10n.wfRefusedKeyReuse,
    'self_review' => l10n.wfRefusedSelfReview,
    'evidence_required' => l10n.wfRefusedEvidenceRequired,
    'record_required' => l10n.wfRefusedRecordRequired,
    'review_note_required' => l10n.wfRefusedReviewNoteRequired,
    'record_not_found' => l10n.wfRefusedRecordNotFound,
    'asset_mismatch' => l10n.wfRefusedAssetMismatch,
    'record_already_linked' => l10n.wfRefusedRecordAlreadyLinked,
    'record_type_mismatch' => l10n.wfRefusedRecordTypeMismatch,
    _ => l10n.wfRefusedUnknown,
  };
  if (reason != 'invalid_transition' || currentStatus == null) return base;
  final String status =
      statusLabel?.call(currentStatus) ?? currentStatus.replaceAll('_', ' ');
  return '$base ${l10n.wfRefusedCurrentStatus(status)}';
}

/// The localised noun for an operational record table, or `null` for an
/// unknown one.
String? workforceRecordLabel(AppLocalizations l10n, String? table) {
  return switch (table) {
    'tyre_records' => l10n.wfRecordTyreRecord,
    'tyre_service_events' => l10n.wfRecordTyreServiceEvent,
    'work_orders' => l10n.wfRecordWorkOrder,
    'inspections' => l10n.wfRecordInspection,
    _ => null,
  };
}
