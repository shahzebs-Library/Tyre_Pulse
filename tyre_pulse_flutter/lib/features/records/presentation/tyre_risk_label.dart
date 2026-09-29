import 'package:tyre_pulse/app/localization/tp_localizations.dart';

/// The risk level in the reader's language, for the tyre card, the risk
/// filter and the tyre detail sheet.
///
/// The stored `tyre_records.risk_level` value stays English (it is also the
/// filter value sent to the server). An unknown spelling is shown as stored
/// rather than guessed.
String tyreRiskLabel(AppLocalizations l10n, String level) => switch (level) {
      'Low' => l10n.recordsRiskLow,
      'Medium' => l10n.recordsRiskMedium,
      'High' => l10n.recordsRiskHigh,
      'Critical' => l10n.recordsRiskCritical,
      _ => level,
    };
