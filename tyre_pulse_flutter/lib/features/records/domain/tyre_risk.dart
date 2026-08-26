/// The tyre risk-level vocabulary and its mapping onto the design system's
/// status colours.
///
/// `tyre_records.risk_level` is a database-controlled vocabulary of exactly
/// four values, ported from `RISKS`/`RISK_KIND` in the production register
/// screen. The four production tiers (Critical, High, Medium, Low) do not
/// map one-to-one onto [TpStatus] (which has no separate "danger" tier
/// between warning and critical), so this compresses High and Medium onto
/// the same [TpStatus.warning] colour rather than inventing a fifth status
/// value the rest of the design system does not know about - see the
/// library comment on `tp_colors.dart`, "the single place semantic colour is
/// decided".
///
/// The compression does not lose the distinction: every call site that
/// draws a risk badge passes the raw `risk_level` STRING as the chip's
/// override label (never the status's own default wording), so a reader
/// always sees the literal word "High" or "Medium", coloured amber, rather
/// than a colour standing in for a word that was never shown.
///
/// Risk level values are never translated. They are fleet data with their
/// own vocabulary, the same category as an asset number or a brand -
/// `TpDropdownItem.label`'s own doc comment states this convention
/// explicitly for the rest of the design system.
library;

import 'package:tyre_pulse/app/theme/tp_colors.dart';

/// The four values `tyre_records.risk_level` can hold, in the order the
/// production filter sheet offers them.
const List<String> kTyreRiskLevels = <String>[
  'Critical',
  'High',
  'Medium',
  'Low',
];

/// Maps a risk level to a status colour.
///
/// A tyre that has never been risk-scored (`riskLevel` null, or a value
/// outside the four this file knows) maps to [TpStatus.unknown]
/// deliberately: [TpTyreChipData.status]'s own doc comment states the rule
/// this mirrors - "a tyre nobody has assessed must not default to looking
/// healthy".
TpStatus tyreRiskStatus(String? riskLevel) => switch (riskLevel) {
      'Critical' => TpStatus.critical,
      'High' || 'Medium' => TpStatus.warning,
      'Low' => TpStatus.ok,
      _ => TpStatus.unknown,
    };
