/// Presentation-layer mapping of the handover domain enums to localised labels
/// and semantic tones, in one place so every handover screen labels a type,
/// rating, cleanliness, status or damage identically.
library;

import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/handover/domain/handover_approval.dart';
import 'package:tyre_pulse/features/handover/domain/handover_damage_marker.dart';
import 'package:tyre_pulse/features/handover/domain/handover_payload.dart';

String handoverTypeLabel(AppLocalizations l10n, HandoverType type) =>
    switch (type) {
      HandoverType.checkout => l10n.handoverTypeCheckout,
      HandoverType.checkin => l10n.handoverTypeCheckin,
    };

String handoverConditionLabel(
  AppLocalizations l10n,
  HandoverConditionRating rating,
) =>
    switch (rating) {
      HandoverConditionRating.excellent => l10n.handoverConditionExcellent,
      HandoverConditionRating.good => l10n.handoverConditionGood,
      HandoverConditionRating.fair => l10n.handoverConditionFair,
      HandoverConditionRating.poor => l10n.handoverConditionPoor,
    };

TpStatus handoverConditionTone(HandoverConditionRating rating) =>
    switch (rating) {
      HandoverConditionRating.excellent => TpStatus.ok,
      HandoverConditionRating.good => TpStatus.ok,
      HandoverConditionRating.fair => TpStatus.warning,
      HandoverConditionRating.poor => TpStatus.critical,
    };

String handoverCleanlinessLabel(
  AppLocalizations l10n,
  HandoverCleanliness cleanliness,
) =>
    switch (cleanliness) {
      HandoverCleanliness.clean => l10n.handoverCleanlinessClean,
      HandoverCleanliness.acceptable => l10n.handoverCleanlinessAcceptable,
      HandoverCleanliness.dirty => l10n.handoverCleanlinessDirty,
    };

TpStatus handoverCleanlinessTone(HandoverCleanliness cleanliness) =>
    switch (cleanliness) {
      HandoverCleanliness.clean => TpStatus.ok,
      HandoverCleanliness.acceptable => TpStatus.warning,
      HandoverCleanliness.dirty => TpStatus.critical,
    };

String handoverDamageViewLabel(AppLocalizations l10n, HandoverDamageView view) =>
    switch (view) {
      HandoverDamageView.front => l10n.handoverViewFront,
      HandoverDamageView.rear => l10n.handoverViewRear,
      HandoverDamageView.left => l10n.handoverViewLeft,
      HandoverDamageView.right => l10n.handoverViewRight,
      HandoverDamageView.top => l10n.handoverViewTop,
    };

String handoverDamageTypeLabel(AppLocalizations l10n, HandoverDamageType type) =>
    switch (type) {
      HandoverDamageType.scratch => l10n.handoverDamageScratch,
      HandoverDamageType.dent => l10n.handoverDamageDent,
      HandoverDamageType.crack => l10n.handoverDamageCrack,
      HandoverDamageType.chip => l10n.handoverDamageChip,
      HandoverDamageType.broken => l10n.handoverDamageBroken,
      HandoverDamageType.missing => l10n.handoverDamageMissing,
      HandoverDamageType.rust => l10n.handoverDamageRust,
      HandoverDamageType.other => l10n.handoverDamageOther,
    };

String handoverDamageLevelLabel(
  AppLocalizations l10n,
  HandoverDamageLevel level,
) =>
    switch (level) {
      HandoverDamageLevel.minor => l10n.handoverLevelMinor,
      HandoverDamageLevel.moderate => l10n.handoverLevelModerate,
      HandoverDamageLevel.severe => l10n.handoverLevelSevere,
    };

TpStatus handoverDamageLevelTone(HandoverDamageLevel level) => switch (level) {
      HandoverDamageLevel.minor => TpStatus.info,
      HandoverDamageLevel.moderate => TpStatus.warning,
      HandoverDamageLevel.severe => TpStatus.critical,
    };

/// The localised one-line status for a handover, derived from its approval
/// status. Pairs with [handoverStatusTone].
String handoverStatusText(AppLocalizations l10n, String? approvalStatus) {
  return switch (approvalStatus) {
    'approved' => l10n.handoverStatusApproved,
    'rejected' => l10n.handoverStatusRejected,
    'pending_incharge' => l10n.handoverStatusPendingIncharge,
    'pending_supervisor' => l10n.handoverStatusPendingSupervisor,
    'draft' => l10n.handoverStatusDraft,
    _ => l10n.handoverStatusDraft,
  };
}

TpStatus handoverStatusTone(String? approvalStatus) {
  return switch (statusSummary(HandoverApprovalLike(approvalStatus: approvalStatus)).tone) {
    HandoverStatusTone.good => TpStatus.ok,
    HandoverStatusTone.bad => TpStatus.critical,
    HandoverStatusTone.warn => TpStatus.warning,
    HandoverStatusTone.muted => TpStatus.neutral,
  };
}
