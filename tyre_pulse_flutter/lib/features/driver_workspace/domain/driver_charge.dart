/// Driver charge cases (migration `20261126170000_driver_charge_cases.sql`).
///
/// A charge is any amount the company intends to recover from a driver:
/// traffic fine, accident damage, tyre damage, missing item, handover damage.
/// Contract: `docs/document-specs/driver-charge-contract.md`. Everything here
/// is pure; the server enforces every rule again and decides which actions the
/// caller may take (`driver_charge_detail.actions`). The phone never invents
/// an action the server did not return.
library;

import 'package:tyre_pulse/features/driver_workspace/domain/driver_workspace.dart';

/// Statuses after which a charge never moves again.
const Set<String> driverChargeTerminalStatuses = <String>{
  'deducted',
  'waived',
  'cancelled_wrongly_issued',
};

/// Every status token, in workflow order, for filter chips.
const List<String> driverChargeStatuses = <String>[
  'issued',
  'notified',
  'accepted',
  'disputed',
  'refused',
  'supervisor_approved',
  'finance_approved',
  'under_appeal',
  'scheduled',
  'deducted',
  'waived',
  'cancelled_wrongly_issued',
];

/// The actions the driver app performs. Staff and finance actions (issue,
/// notify, reviews, scheduling, deductions, waiver, reversal) stay on the web:
/// they need the evidence picker, the payroll schedule and the separation of
/// duties screens, so the phone shows them read only.
const String chargeActionRespond = 'charge_respond';
const String chargeActionAppeal = 'charge_appeal';

/// Step 2 of a refusal: only the named witness, signed in as themselves.
/// Offered only when the server lists it for the caller.
const String chargeActionWitnessConfirm = 'charge_witness_confirm';
const Set<String> driverChargeMobileActions = <String>{
  chargeActionRespond,
  chargeActionAppeal,
  chargeActionWitnessConfirm,
};

/// Statement versions the server stores verbatim with each signature.
const String chargeConsentStatement = 'deduction-consent-v1';
const String chargeDisputeStatement = 'receipt-dispute-v1';
const String chargeWitnessStatement = 'refusal-witness-v1';

/// The one statement language the server accepts today. Arabic and Urdu need
/// owner-approved legal wording before the server adds a new version.
const String chargeStatementLanguage = 'en';

enum DriverChargeResponse {
  accept('accept', chargeConsentStatement),
  dispute('dispute', chargeDisputeStatement);

  const DriverChargeResponse(this.key, this.statementVersion);
  final String key;
  final String statementVersion;
}

/// Why a response or appeal cannot be sent yet.
enum DriverChargeIssue { explanation, acknowledgement, signature, reason }

/// One outstanding total. Different currencies are never added together.
final class ChargeOutstanding {
  const ChargeOutstanding(this.currency, this.amount);
  final String currency;
  final double amount;

  @override
  bool operator ==(Object other) =>
      other is ChargeOutstanding &&
      other.currency == currency &&
      other.amount == amount;

  @override
  int get hashCode => Object.hash(currency, amount);

  @override
  String toString() => '$currency ${amount.toStringAsFixed(2)}';
}

double? _number(Object? raw) {
  if (raw is num) return raw.toDouble();
  if (raw is String) return double.tryParse(raw.trim());
  return null;
}

/// Mirror of `outstandingByCurrency` in `src/lib/driverCharges.js`.
List<ChargeOutstanding> chargeOutstandingByCurrency(List<DriverRow> rows) {
  final Map<String, double> totals = <String, double>{};
  for (final DriverRow row in rows) {
    final String status = '${row['status'] ?? ''}';
    if (driverChargeTerminalStatuses.contains(status) && status != 'deducted') {
      continue;
    }
    final double? value = _number(row['outstanding']) ??
        (() {
          final double? amount = _number(row['amount']);
          if (amount == null) return null;
          return amount - (_number(row['deducted_amount']) ?? 0);
        })();
    if (value == null || !value.isFinite || value <= 0) continue;
    final String currency = '${row['currency'] ?? ''}';
    totals[currency] = (totals[currency] ?? 0) + value;
  }
  return <ChargeOutstanding>[
    for (final MapEntry<String, double> e in totals.entries)
      ChargeOutstanding(e.key, (e.value * 100).round() / 100),
  ];
}

/// `250.5, SAR` -> `SAR 250.50`; null amounts stay null (never 0).
String? formatChargeMoney(Object? amount, Object? currency) {
  final double? n = _number(amount);
  if (n == null || !n.isFinite) return null;
  return '${currency ?? ''} ${n.toStringAsFixed(2)}'.trim();
}

/// Mirror of `validateResponse` in `src/lib/driverCharges.js`.
DriverChargeIssue? validateChargeResponse({
  required DriverChargeResponse response,
  required String explanation,
  required bool acknowledged,
  required String? signature,
}) {
  if (response == DriverChargeResponse.dispute &&
      explanation.trim().length < 10) {
    return DriverChargeIssue.explanation;
  }
  if (!acknowledged) return DriverChargeIssue.acknowledgement;
  if (signature == null || signature.isEmpty) {
    return DriverChargeIssue.signature;
  }
  return null;
}

/// An appeal needs at least ten characters of grounds (server: `reason (10+)`).
DriverChargeIssue? validateChargeAppeal(String reason) =>
    reason.trim().length < 10 ? DriverChargeIssue.reason : null;

/// The `charge_respond` payload, exactly as the contract lists it.
DriverRow chargeResponsePayload({
  required DriverRow charge,
  required DriverChargeResponse response,
  required String explanation,
  required String signature,
}) =>
    <String, Object?>{
      'driver_id': charge['driver_id'],
      'charge_id': charge['id'],
      'version': charge['version'],
      'response': response.key,
      'statement_version': response.statementVersion,
      'statement_language': chargeStatementLanguage,
      'acknowledged': true,
      'signature': signature,
      if (explanation.trim().isNotEmpty) 'explanation': explanation.trim(),
    };

/// The `charge_appeal` payload.
DriverRow chargeAppealPayload({
  required DriverRow charge,
  required String reason,
}) =>
    <String, Object?>{
      'driver_id': charge['driver_id'],
      'charge_id': charge['id'],
      'version': charge['version'],
      'reason': reason.trim(),
    };

/// The `charge_witness_confirm` payload.
DriverRow chargeWitnessPayload({
  required DriverRow charge,
  required String signature,
}) =>
    <String, Object?>{
      'driver_id': charge['driver_id'],
      'charge_id': charge['id'],
      'version': charge['version'],
      'statement_version': chargeWitnessStatement,
      'acknowledged': true,
      'signature': signature,
    };

/// A refusal was recorded (step 1) and waits for the witness (step 2).
bool chargeAwaitsWitness(DriverRow charge) =>
    charge['status'] == 'notified' && charge['refusal_witness_id'] != null;

/// One charge's detail as returned by `driver_charge_detail`.
final class DriverChargeDetail {
  const DriverChargeDetail(this.data);
  final DriverRow data;

  DriverRow get charge => data['charge'] is Map
      ? Map<String, Object?>.from(data['charge']! as Map)
      : <String, Object?>{};
  DriverRow get driver => data['driver'] is Map
      ? Map<String, Object?>.from(data['driver']! as Map)
      : <String, Object?>{};
  DriverRow? get appeal => data['appeal'] is Map
      ? Map<String, Object?>.from(data['appeal']! as Map)
      : null;
  List<DriverRow> rows(String key) => driverRows(data[key]);

  /// Actions the server allows the caller now.
  Set<String> get actions => <String>{
        if (data['actions'] is List)
          for (final Object? a in data['actions']! as List) '$a',
      };

  /// Actions this app offers on the phone: the server list, narrowed to the
  /// driver actions. Never widened.
  Set<String> get mobileActions {
    final Set<String> allowed = actions.intersection(driverChargeMobileActions);
    // The server refuses an appeal once any deduction is recorded; never
    // offer a button that can only fail.
    final double deducted = _number(charge['deducted_amount']) ?? 0;
    if (deducted > 0) allowed.remove(chargeActionAppeal);
    return allowed;
  }

  bool get isViewer => data['access'] == 'viewer';

  /// The exact statement text for [version], from the server.
  String? statement(String version) {
    final Object? statements = data['statements'];
    if (statements is! Map) return null;
    final Object? text = statements[version];
    return text is String && text.trim().isNotEmpty ? text : null;
  }

  int? get appealWindowDays {
    final Object? settings = data['settings'];
    if (settings is! Map) return null;
    return _number(settings['appeal_window_days'])?.round();
  }

  int? get capPct {
    final Object? settings = data['settings'];
    if (settings is! Map) return null;
    return _number(settings['cap_pct'])?.round();
  }
}
