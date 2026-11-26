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
const String chargeConsentStatement = 'deduction-consent-v3';
const String chargeDisputeStatement = 'receipt-dispute-v2';
const String chargeWitnessStatement = 'refusal-witness-v2';

/// Languages a driver or witness may sign in. The server stores the text of
/// the chosen language with the signature
/// (`docs/document-specs/driver-charge-statements.json`).
const List<String> chargeStatementLanguages = <String>['en', 'ar', 'ur'];

/// The app language when the server can store a statement in it, else English.
String defaultChargeStatementLanguage(String appLanguage) =>
    chargeStatementLanguages.contains(appLanguage) ? appLanguage : 'en';

/// Arabic and Urdu are read right to left.
bool chargeStatementIsRtl(String language) =>
    language == 'ar' || language == 'ur';

/// Country deduction rules. Mirror of `private.driver_charge_country_rule`
/// (and `chargeCountryRule` in `src/lib/driverCharges.js`); display only, the
/// server enforces every limit. KSA: Saudi Labour Law (Royal Decree M/51).
final class DriverChargeCountryRule {
  const DriverChargeCountryRule._(this.rule, {required this.statutory});
  final String rule;
  final bool statutory;

  /// Damage or loss: at most this many days of wage a month (wage / 30).
  int get daysPerMonth => 5;

  /// Days the driver has to object (KSA: working days, Sunday to Thursday).
  int get objectionWorkingDays => 15;

  /// All deductions together: at most this share of the wage (Art 93).
  int get totalPercent => 50;

  /// UAE and Egypt use the company setting until legally confirmed.
  bool get needsLegalConfirmation => !statutory;
}

const Map<String, Set<String>> _countryKeys = <String, Set<String>>{
  'KSA': <String>{
    'KSA',
    'SA',
    'SAU',
    'SAUDI',
    'SAUDIARABIA',
    'KINGDOMOFSAUDIARABIA',
  },
  'UAE': <String>{'UAE', 'AE', 'ARE', 'UNITEDARABEMIRATES', 'EMIRATES'},
  'EGYPT': <String>{'EGYPT', 'EG', 'EGY', 'ARABREPUBLICOFEGYPT'},
};

/// One spelling per country ("Saudi Arabia", "sa", "K.S.A." are all KSA).
/// Mirror of `private.driver_charge_country_key`.
String? driverChargeCountryKey(Object? country) {
  final String k =
      '${country ?? ''}'.toUpperCase().replaceAll(RegExp('[^A-Z]'), '');
  if (k.isEmpty) return null;
  for (final MapEntry<String, Set<String>> e in _countryKeys.entries) {
    if (e.value.contains(k)) return e.key;
  }
  return k;
}

DriverChargeCountryRule driverChargeCountryRule(Object? country) =>
    driverChargeCountryKey(country) == 'KSA'
        ? const DriverChargeCountryRule._('ksa_labour_law', statutory: true)
        : const DriverChargeCountryRule._('company_setting', statutory: false);

/// `damage` (Art 91) or `consent` (Art 92). A government traffic fine
/// recovered from the driver is an Art 92 deduction: it needs his consent.
String driverChargeBucket(Object? category) => switch ('${category ?? ''}') {
      'accident_damage' ||
      'tyre_damage' ||
      'missing_item' ||
      'handover_damage' =>
        'damage',
      _ => 'consent',
    };

/// Physical damage carries at least one photo before the driver is notified.
bool driverChargeNeedsPhoto(Object? category) => const <String>{
      'accident_damage',
      'tyre_damage',
      'handover_damage',
    }.contains('${category ?? ''}');

/// Mirror of `private.driver_charge_working_deadline`: the end of the
/// [days]-th working day (Sunday to Thursday) after the Riyadh date of
/// [from]. Riyadh is UTC+3 all year.
DateTime? chargeWorkingDeadline(DateTime? from, int days) {
  if (from == null || days < 1) return null;
  const Duration riyadh = Duration(hours: 3);
  final DateTime local = from.toUtc().add(riyadh);
  DateTime d = DateTime.utc(local.year, local.month, local.day);
  int n = 0;
  while (n < days) {
    d = d.add(const Duration(days: 1));
    if (d.weekday != DateTime.friday && d.weekday != DateTime.saturday) n++;
  }
  return d.add(const Duration(days: 1)).subtract(riyadh);
}

/// Why a deduction cannot be scheduled yet: `consent_required` (KSA Art 92),
/// `open_objection` or `window_open` (with the last objection day).
final class DriverChargeScheduleBlock {
  const DriverChargeScheduleBlock(this.code, {this.article, this.until});
  final String code;
  final String? article;
  final String? until;
}

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
  String language = 'en',
}) =>
    <String, Object?>{
      'driver_id': charge['driver_id'],
      'charge_id': charge['id'],
      'version': charge['version'],
      'response': response.key,
      'statement_version': response.statementVersion,
      'statement_language': language,
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
  String language = 'en',
}) =>
    <String, Object?>{
      'driver_id': charge['driver_id'],
      'charge_id': charge['id'],
      'version': charge['version'],
      'statement_version': chargeWitnessStatement,
      'statement_language': language,
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

  /// The signed-in person is the driver of this charge.
  bool get isDriver => data['access'] == 'driver';

  /// The exact statement text for [version] in [language], from the server
  /// (`statements[version][language]`). Null when the server did not send it:
  /// the phone never signs words the server did not supply.
  String? statement(String version, {String language = 'en'}) {
    final Object? statements = data['statements'];
    if (statements is! Map) return null;
    final Object? byLanguage = statements[version];
    final Object? text = byLanguage is Map ? byLanguage[language] : null;
    return text is String && text.trim().isNotEmpty ? text : null;
  }

  /// Photo evidence rows (private storage references), shown before answering.
  List<DriverRow> get photos => <DriverRow>[
        for (final DriverRow e in rows('evidence'))
          if (e['kind'] == 'photo' && '${e['ref'] ?? ''}'.isNotEmpty) e,
      ];

  /// The deduction rules of the charge country.
  DriverChargeCountryRule get countryRule =>
      driverChargeCountryRule(charge['country']);

  /// Why finance cannot schedule a deduction yet, or null. The server's own
  /// answer (`settings.schedule_block`) wins; otherwise it is worked out from
  /// the rule fields the detail returns. Mirror of `scheduleBlockFor`.
  DriverChargeScheduleBlock? scheduleBlock({DateTime? now}) {
    final DriverRow c = charge;
    if (c.isEmpty || c['driver_response'] == 'accepted') return null;
    final Object? settings = data['settings'];
    final Map<Object?, Object?> s =
        settings is Map ? settings : const <Object?, Object?>{};
    final Object? server = s['schedule_block'];
    if (server is Map) {
      return DriverChargeScheduleBlock(
        '${server['code'] ?? ''}',
        article: server['article'] as String?,
        until: server['until'] as String?,
      );
    }
    if (s.containsKey('schedule_block')) return null;
    final Object? rule = s['country_rule'];
    final bool statutory = rule is Map
        ? rule['statutory'] == true
        : driverChargeCountryRule(c['country']).statutory;
    final String? until = s['objection_last_day'] as String?;
    final DateTime? deadline =
        DateTime.tryParse('${s['objection_deadline'] ?? ''}');
    final bool windowOpen =
        deadline == null || deadline.isAfter(now ?? DateTime.now());
    final DriverRow? a = appeal;
    final bool appealOpen = a != null && a['outcome'] == null;
    if (statutory) {
      if ('${s['bucket'] ?? driverChargeBucket(c['category'])}' != 'damage') {
        return const DriverChargeScheduleBlock(
          'consent_required',
          article: '92',
        );
      }
      if (appealOpen) {
        return const DriverChargeScheduleBlock('open_objection', article: '91');
      }
      if (windowOpen) {
        return DriverChargeScheduleBlock(
          'window_open',
          article: '91',
          until: until,
        );
      }
      return null;
    }
    if (a != null && a['outcome'] == 'upheld') return null;
    if (appealOpen) return const DriverChargeScheduleBlock('open_objection');
    if (windowOpen) {
      return DriverChargeScheduleBlock('window_open', until: until);
    }
    return null;
  }

  /// Last day the driver may object (`YYYY-MM-DD`), once finance approved.
  String? get objectionLastDay {
    final Object? settings = data['settings'];
    if (settings is! Map) return null;
    final Object? day = settings['objection_last_day'];
    return day is String && day.isNotEmpty ? day : null;
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
