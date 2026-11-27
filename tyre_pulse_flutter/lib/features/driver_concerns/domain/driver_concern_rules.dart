/// Driver Concerns: the pure rules and the record shapes.
///
/// MIRRORS `src/lib/driverConcerns.js` (web) and
/// `supabase/migrations/20261127191000_driver_concerns.sql`. Change all three
/// together. The server decides what is allowed; this only decides what the
/// screen offers.
library;

import 'package:flutter/material.dart';

const List<String> concernLanguages = <String>[
  'en', 'ar', 'ur', 'hi', 'bn', 'ps', 'ne', 'tl', //
];

const Map<String, String> concernLanguageNames = <String, String>{
  'en': 'English',
  'ar': 'العربية',
  'ur': 'اردو',
  'hi': 'हिन्दी',
  'bn': 'বাংলা',
  'ps': 'پښتو',
  'ne': 'नेपाली',
  'tl': 'Tagalog',
};

final class ConcernCategory {
  const ConcernCategory(
    this.key,
    this.icon,
    this.subtypes, {
    this.sensitive = false,
  });
  final String key;
  final IconData icon;
  final List<String> subtypes;

  /// Decided by the server too: a treatment case is always sensitive.
  final bool sensitive;
}

const List<ConcernCategory> concernCategories = <ConcernCategory>[
  ConcernCategory('pay', Icons.payments_outlined, <String>[
    'salary_late', 'salary_short', 'overtime_unpaid', 'wrong_deduction', //
    'allowance_missing', 'final_settlement',
  ]),
  ConcernCategory(
    'housing',
    Icons.home_outlined,
    <String>['accommodation', 'food', 'transport', 'utilities'],
  ),
  ConcernCategory(
    'leave',
    Icons.flight_takeoff_outlined,
    <String>['annual_leave', 'ticket', 'emergency_leave', 'sick_leave'],
  ),
  ConcernCategory('documents', Icons.badge_outlined, <String>[
    'iqama_expiry', 'licence_renewal', 'passport_held', 'contract_visa', //
    'medical_card',
  ]),
  ConcernCategory(
    'work',
    Icons.schedule_outlined,
    <String>['excess_hours', 'roster', 'route', 'workload'],
  ),
  ConcernCategory(
    'safety',
    Icons.health_and_safety_outlined,
    <String>['unsafe_vehicle', 'unsafe_site', 'injury', 'ppe'],
  ),
  ConcernCategory(
    'treatment',
    Icons.front_hand_outlined,
    <String>['supervisor_conduct', 'harassment', 'discrimination', 'threats'],
    sensitive: true,
  ),
  ConcernCategory('other', Icons.help_outline, <String>['other']),
];

ConcernCategory? categoryFor(String key) {
  for (final ConcernCategory c in concernCategories) {
    if (c.key == key) return c;
  }
  return null;
}

bool isValidSubtype(String category, String subtype) =>
    categoryFor(category)?.subtypes.contains(subtype) ?? false;

int levelRank(String level) => switch (level) {
      'supervisor' => 1,
      'incharge' => 2,
      'hr' => 2,
      'manager' => 3,
      _ => 99,
    };

String? nextLevel(String level, {required bool sensitive}) {
  if (sensitive) return level == 'hr' ? 'manager' : null;
  if (level == 'supervisor') return 'incharge';
  if (level == 'incharge') return 'manager';
  return null;
}

const Set<String> terminalStatuses = <String>{
  'accepted', 'not_accepted', 'withdrawn', 'closed', //
};

enum ConcernDeadline { overdue, dueSoon, ok }

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;

/// One case as the list and the detail screen read it.
final class DriverConcern {
  const DriverConcern({
    required this.id,
    required this.caseNo,
    required this.category,
    required this.subtype,
    required this.status,
    required this.level,
    required this.sensitive,
    required this.version,
    this.originalText,
    this.originalLang,
    this.outcomeText,
    this.outcomeLang,
    this.outcomeSeenAt,
    this.ackDueAt,
    this.dueAt,
    this.acknowledgedAt,
    this.reopenDeadline,
    this.createdAt,
    this.enteredVerbally = false,
    this.escalationCount = 0,
    this.driverDecision,
    this.signedAt,
    this.photos = const <String>[],
  });

  factory DriverConcern.fromJson(Map<String, Object?> j) => DriverConcern(
        id: '${j['id']}',
        caseNo: '${j['case_no'] ?? ''}',
        category: '${j['category'] ?? 'other'}',
        subtype: '${j['subtype'] ?? 'other'}',
        status: '${j['status'] ?? 'open'}',
        level: '${j['level'] ?? 'supervisor'}',
        sensitive: j['sensitive'] == true,
        version: (j['version'] as num?)?.toInt() ?? 1,
        originalText: j['original_text'] as String?,
        originalLang: j['original_lang'] as String?,
        outcomeText: j['outcome_text'] as String?,
        outcomeLang: j['outcome_lang'] as String?,
        outcomeSeenAt: _date(j['outcome_seen_at']),
        ackDueAt: _date(j['ack_due_at']),
        dueAt: _date(j['due_at']),
        acknowledgedAt: _date(j['acknowledged_at']),
        reopenDeadline: _date(j['reopen_deadline']),
        createdAt: _date(j['created_at']),
        enteredVerbally: j['entered_verbally'] == true,
        escalationCount: (j['escalation_count'] as num?)?.toInt() ?? 0,
        driverDecision: j['driver_decision'] as String?,
        signedAt: _date(j['signed_at']),
        photos: (j['photos'] as List<Object?>?)
                ?.whereType<String>()
                .toList(growable: false) ??
            const <String>[],
      );

  final String id;
  final String caseNo;
  final String category;
  final String subtype;
  final String status;
  final String level;
  final bool sensitive;
  final int version;
  final String? originalText;
  final String? originalLang;
  final String? outcomeText;
  final String? outcomeLang;
  final DateTime? outcomeSeenAt;
  final DateTime? ackDueAt;
  final DateTime? dueAt;
  final DateTime? acknowledgedAt;
  final DateTime? reopenDeadline;
  final DateTime? createdAt;
  final bool enteredVerbally;
  final int escalationCount;
  final String? driverDecision;
  final DateTime? signedAt;
  final List<String> photos;

  bool get isTerminal => terminalStatuses.contains(status);
}

final class ConcernEvent {
  const ConcernEvent({
    required this.seq,
    required this.type,
    this.note,
    this.actorRole,
    this.at,
  });

  factory ConcernEvent.fromJson(Map<String, Object?> j) => ConcernEvent(
        seq: (j['seq'] as num?)?.toInt() ?? 0,
        type: '${j['event_type'] ?? ''}',
        note: j['note'] as String?,
        actorRole: j['actor_role'] as String?,
        at: _date(j['created_at']),
      );

  final int seq;
  final String type;
  final String? note;
  final String? actorRole;
  final DateTime? at;
}

final class ConcernTranslation {
  const ConcernTranslation({
    required this.source,
    required this.sourceId,
    required this.lang,
    required this.text,
    required this.model,
  });

  factory ConcernTranslation.fromJson(Map<String, Object?> j) =>
      ConcernTranslation(
        source: '${j['source'] ?? ''}',
        sourceId: '${j['source_id'] ?? ''}',
        lang: '${j['target_lang'] ?? ''}',
        text: '${j['text'] ?? ''}',
        model: '${j['model'] ?? ''}',
      );

  final String source;
  final String sourceId;
  final String lang;
  final String text;
  final String model;
}

/// The payload of `driver_concern_get`.
final class ConcernDetail {
  const ConcernDetail({
    required this.concern,
    required this.events,
    required this.translations,
    required this.isDriver,
    required this.myRank,
    this.driverName,
  });

  factory ConcernDetail.fromJson(Map<String, Object?> j) => ConcernDetail(
        concern: DriverConcern.fromJson(
          Map<String, Object?>.from(j['concern'] as Map? ?? const {}),
        ),
        events: ((j['events'] as List<Object?>?) ?? const <Object?>[])
            .whereType<Map<Object?, Object?>>()
            .map(
              (Map<Object?, Object?> m) =>
                  ConcernEvent.fromJson(Map<String, Object?>.from(m)),
            )
            .toList(growable: false),
        translations:
            ((j['translations'] as List<Object?>?) ?? const <Object?>[])
                .whereType<Map<Object?, Object?>>()
                .map(
                  (Map<Object?, Object?> m) =>
                      ConcernTranslation.fromJson(Map<String, Object?>.from(m)),
                )
                .toList(growable: false),
        isDriver: j['is_driver'] == true,
        myRank: (j['my_rank'] as num?)?.toInt() ?? 0,
        driverName: j['driver_name'] as String?,
      );

  final DriverConcern concern;
  final List<ConcernEvent> events;
  final List<ConcernTranslation> translations;
  final bool isDriver;
  final int myRank;
  final String? driverName;

  ConcernTranslation? translationFor(String source, String lang) {
    for (final ConcernTranslation t in translations) {
      if (t.source == source && t.sourceId.isEmpty && t.lang == lang) return t;
    }
    return null;
  }
}

/// Null for a closed case or one with no deadline: "no deadline" is not
/// "on time".
ConcernDeadline? deadlineState(DriverConcern c, DateTime now) {
  if (c.isTerminal) return null;
  if (c.acknowledgedAt == null &&
      c.ackDueAt != null &&
      c.ackDueAt!.isBefore(now)) {
    return ConcernDeadline.overdue;
  }
  final DateTime? due = c.dueAt;
  if (due == null) return null;
  if (due.isBefore(now)) return ConcernDeadline.overdue;
  if (due.difference(now) < const Duration(hours: 12)) {
    return ConcernDeadline.dueSoon;
  }
  return ConcernDeadline.ok;
}

bool canReopen(DriverConcern c, DateTime now) =>
    (c.status == 'accepted' || c.status == 'not_accepted') &&
    c.reopenDeadline != null &&
    !c.reopenDeadline!.isBefore(now);

/// What the detail screen offers. Same guards as `driver_concern_command`.
Set<String> allowedActions(ConcernDetail d, DateTime now) {
  final DriverConcern c = d.concern;
  final Set<String> out = <String>{};
  if (d.isDriver) {
    out.add('note');
    if (c.status == 'outcome_shared') {
      out.add('view_outcome');
      if (c.outcomeSeenAt != null) out.add('sign');
    }
    if (!c.isTerminal) out.add('withdraw');
    if (canReopen(c, now)) out.add('reopen');
    return out;
  }
  if (d.myRank <= 0) return out;
  out.add('note');
  if (c.isTerminal) return out;
  final int needed = levelRank(c.level) > 3 ? 3 : levelRank(c.level);
  if (d.myRank >= needed) {
    if (c.acknowledgedAt == null) out.add('acknowledge');
    if (nextLevel(c.level, sensitive: c.sensitive) != null) {
      out.add('escalate');
    }
    if (c.status != 'proposed' && c.status != 'outcome_shared') {
      out.add('propose');
    }
  }
  if (c.enteredVerbally && c.status == 'outcome_shared') {
    out.add('view_outcome');
    if (c.outcomeSeenAt != null) out.add('sign');
  }
  return out;
}

/// Storage path accepted by `private.dc_storage_access`.
String concernPhotoPath(
  String orgId,
  String userId,
  String clientUuid,
  int index,
) =>
    '$orgId/$userId/$clientUuid/$index.jpg';
