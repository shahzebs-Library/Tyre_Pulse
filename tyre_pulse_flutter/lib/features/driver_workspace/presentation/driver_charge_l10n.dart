/// Localized labels for driver charge tokens. The PDF keeps the spec's English
/// labels (it is the legal paper shared with the web); the screens use these.
library;

import 'package:tyre_pulse/app/localization/tp_localizations.dart';

String driverChargeStatusLabel(AppLocalizations l10n, String? status) =>
    switch (status) {
      'issued' => l10n.driverChargeStatusIssued,
      'notified' => l10n.driverChargeStatusNotified,
      'accepted' => l10n.driverChargeStatusAccepted,
      'disputed' => l10n.driverChargeStatusDisputed,
      'refused' => l10n.driverChargeStatusRefused,
      'supervisor_approved' => l10n.driverChargeStatusSupervisorApproved,
      'finance_approved' => l10n.driverChargeStatusFinanceApproved,
      'under_appeal' => l10n.driverChargeStatusUnderAppeal,
      'scheduled' => l10n.driverChargeStatusScheduled,
      'deducted' => l10n.driverChargeStatusDeducted,
      'waived' => l10n.driverChargeStatusWaived,
      'cancelled_wrongly_issued' => l10n.driverChargeStatusCancelled,
      _ => l10n.valueUnavailable,
    };

String driverChargeCategoryLabel(AppLocalizations l10n, String? category) =>
    switch (category) {
      'traffic_fine' => l10n.driverChargeCatTrafficFine,
      'accident_damage' => l10n.driverChargeCatAccidentDamage,
      'tyre_damage' => l10n.driverChargeCatTyreDamage,
      'missing_item' => l10n.driverChargeCatMissingItem,
      'handover_damage' => l10n.driverChargeCatHandoverDamage,
      'other' => l10n.driverChargeCatOther,
      _ => l10n.valueUnavailable,
    };

String driverChargeSourceLabel(AppLocalizations l10n, String? source) =>
    switch (source) {
      'accident' => l10n.driverChargeSrcAccident,
      'handover_report' => l10n.driverChargeSrcHandover,
      'inspection' => l10n.driverChargeSrcInspection,
      'checklist_submission' => l10n.driverChargeSrcChecklist,
      'tyre_record' => l10n.driverChargeSrcTyre,
      'driver_fine' => l10n.driverChargeSrcFine,
      _ => l10n.driverChargeSrcNone,
    };

/// `YYYY-MM-DD HH:mm` in the device zone, or "not available".
String driverChargeTime(AppLocalizations l10n, Object? value) {
  final DateTime? parsed =
      value is String && value.isNotEmpty ? DateTime.tryParse(value) : null;
  if (parsed == null) return l10n.valueUnavailable;
  final DateTime d = parsed.toLocal();
  String two(int v) => v.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)} ${two(d.hour)}:${two(d.minute)}';
}
