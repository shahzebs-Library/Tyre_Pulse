/// One vehicle in the Workshop Status report, plus the pure rules the list and
/// the update screen share.
///
/// MIRRORS the web engines `src/lib/workshopStatus/activeView.js` (days down,
/// freshness) and `src/lib/workshopStatus/updateForm.js` (patch building and
/// validation). The server (`workshop_status_update_record`) stays the
/// authority; these only save a round trip and keep the phone honest:
///
/// - days down is null when it cannot be measured, never an invented 0;
/// - freshness is judged on `last_manual_update_at` only - an Excel refresh is
///   not a person looking at the vehicle;
/// - a patch carries ONLY changed fields, trimmed, blank -> null, and never
///   who or when (the server stamps both);
/// - `updated_at` is kept as the exact server STRING, because a parsed
///   DateTime drops microseconds and every save would read as stale.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/workshop_status/domain/workshop_status_vocab.dart';

@immutable
final class WorkshopStatusRecord {
  const WorkshopStatusRecord({
    required this.id,
    required this.updatedAtRaw,
    this.assetNo,
    this.site,
    this.country,
    this.complaint,
    this.currentStage,
    this.delayReason,
    this.detailedReason,
    this.workDone,
    this.actionTaken,
    this.nextAction,
    this.partsStatus,
    this.mrNumber,
    this.poNumber,
    this.responsibleUserId,
    this.supportingUserId,
    this.expectedPartDate,
    this.expectedReleaseDate,
    this.blocker,
    this.remarks,
    this.oocSince,
    this.excelDownDays,
    this.lastUpdatedByName,
    this.lastManualUpdateAt,
  });

  factory WorkshopStatusRecord.fromRow(Map<String, dynamic> row) {
    return WorkshopStatusRecord(
      id: _text(row['id']) ?? '',
      // Kept verbatim: it is sent back as p_expected_updated_at.
      updatedAtRaw: row['updated_at']?.toString(),
      assetNo: _text(row['asset_no']),
      site: _text(row['site']),
      country: _text(row['country']),
      complaint: _text(row['complaint']),
      currentStage: _text(row['current_stage']),
      delayReason: _text(row['delay_reason']),
      detailedReason: _text(row['detailed_reason']),
      workDone: _text(row['work_done']),
      actionTaken: _text(row['action_taken']),
      nextAction: _text(row['next_action']),
      partsStatus: _text(row['parts_status']),
      mrNumber: _text(row['mr_number']),
      poNumber: _text(row['po_number']),
      responsibleUserId: _text(row['responsible_user_id']),
      supportingUserId: _text(row['supporting_user_id']),
      expectedPartDate: workshopDateOnly(row['expected_part_date']),
      expectedReleaseDate: workshopDateOnly(row['expected_release_date']),
      blocker: _text(row['blocker']),
      remarks: _text(row['remarks']),
      oocSince: workshopDateOnly(row['ooc_since']),
      excelDownDays: _number(row['excel_down_days']),
      lastUpdatedByName: _text(row['last_updated_by_name']),
      lastManualUpdateAt: _text(row['last_manual_update_at']),
    );
  }

  final String id;

  /// `updated_at` exactly as the server sent it. Null only on a malformed row.
  final String? updatedAtRaw;

  final String? assetNo;
  final String? site;
  final String? country;
  final String? complaint;
  final String? currentStage;
  final String? delayReason;
  final String? detailedReason;
  final String? workDone;
  final String? actionTaken;
  final String? nextAction;
  final String? partsStatus;
  final String? mrNumber;
  final String? poNumber;
  final String? responsibleUserId;
  final String? supportingUserId;

  /// `yyyy-mm-dd`, or null.
  final String? expectedPartDate;

  /// `yyyy-mm-dd`, or null.
  final String? expectedReleaseDate;
  final String? blocker;
  final String? remarks;

  /// `yyyy-mm-dd`, or null.
  final String? oocSince;
  final num? excelDownDays;
  final String? lastUpdatedByName;
  final String? lastManualUpdateAt;

  /// True when the upload marked this vehicle as having left the daily file.
  /// Owner rule: shown as Released, never as removed.
  bool get isReleased => currentStage == kWorkshopReleasedStage;

  /// Whether [userId] is the responsible person. Case-insensitive: the server
  /// lower-cases uuids it stores.
  bool isResponsible(String? userId) {
    final String me = (userId ?? '').trim().toLowerCase();
    if (me.isEmpty) return false;
    return (responsibleUserId ?? '').trim().toLowerCase() == me;
  }

  /// Whole days down, from `ooc_since`, falling back to the Excel's own figure.
  /// Null when neither is usable or the date is in the future.
  int? daysDown(DateTime now) {
    final DateTime? since = _parseDay(oocSince);
    if (since != null) {
      // Both sides as UTC midnights of their calendar day: no DST skew.
      final DateTime today = DateTime.utc(now.year, now.month, now.day);
      final int diff = today.difference(since).inDays;
      return diff >= 0 ? diff : null;
    }
    final num? x = excelDownDays;
    if (x == null || !x.isFinite || x < 0) return null;
    return x.floor();
  }

  /// Whether a PERSON updated this record today (local calendar day).
  WorkshopFreshness freshness(DateTime now) {
    final String raw = (lastManualUpdateAt ?? '').trim();
    if (raw.isEmpty) return WorkshopFreshness.never;
    final DateTime? parsed = DateTime.tryParse(raw);
    if (parsed == null) return WorkshopFreshness.never;
    final DateTime local = raw.length == 10 ? parsed : parsed.toLocal();
    final bool today = local.year == now.year &&
        local.month == now.month &&
        local.day == now.day;
    return today ? WorkshopFreshness.today : WorkshopFreshness.stale;
  }

  /// Case-insensitive match on asset, site, stage, delay reason, complaint,
  /// MR and PO numbers. A blank query matches everything.
  bool matches(String query) {
    final String q = query.trim().toLowerCase();
    if (q.isEmpty) return true;
    for (final String? field in <String?>[
      assetNo,
      site,
      currentStage,
      delayReason,
      complaint,
      mrNumber,
      poNumber,
      partsStatus,
    ]) {
      if ((field ?? '').toLowerCase().contains(q)) return true;
    }
    return false;
  }
}

enum WorkshopFreshness { today, stale, never }

/// The fields the update form edits. The SAME list the server accepts.
abstract final class WorkshopStatusFields {
  static const String currentStage = 'current_stage';
  static const String delayReason = 'delay_reason';
  static const String detailedReason = 'detailed_reason';
  static const String workDone = 'work_done';
  static const String actionTaken = 'action_taken';
  static const String nextAction = 'next_action';
  static const String partsStatus = 'parts_status';
  static const String mrNumber = 'mr_number';
  static const String poNumber = 'po_number';
  static const String responsibleUserId = 'responsible_user_id';
  static const String supportingUserId = 'supporting_user_id';
  static const String expectedPartDate = 'expected_part_date';
  static const String expectedReleaseDate = 'expected_release_date';
  static const String blocker = 'blocker';
  static const String remarks = 'remarks';

  static const List<String> all = <String>[
    currentStage,
    delayReason,
    detailedReason,
    workDone,
    actionTaken,
    nextAction,
    partsStatus,
    mrNumber,
    poNumber,
    responsibleUserId,
    supportingUserId,
    expectedPartDate,
    expectedReleaseDate,
    blocker,
    remarks,
  ];

  static const Set<String> dates = <String>{
    expectedPartDate,
    expectedReleaseDate,
  };

  static const Set<String> people = <String>{
    responsibleUserId,
    supportingUserId,
  };

  static const Set<String> longText = <String>{
    detailedReason,
    workDone,
    actionTaken,
    nextAction,
    blocker,
    remarks,
  };

  static const Set<String> refs = <String>{mrNumber, poNumber};

  static const int maxText = 4000;
  static const int maxRef = 100;
}

/// The record's current values, keyed by server field name.
Map<String, String?> workshopFormFromRecord(WorkshopStatusRecord r) =>
    <String, String?>{
      WorkshopStatusFields.currentStage: r.currentStage,
      WorkshopStatusFields.delayReason: r.delayReason,
      WorkshopStatusFields.detailedReason: r.detailedReason,
      WorkshopStatusFields.workDone: r.workDone,
      WorkshopStatusFields.actionTaken: r.actionTaken,
      WorkshopStatusFields.nextAction: r.nextAction,
      WorkshopStatusFields.partsStatus: r.partsStatus,
      WorkshopStatusFields.mrNumber: r.mrNumber,
      WorkshopStatusFields.poNumber: r.poNumber,
      WorkshopStatusFields.responsibleUserId: r.responsibleUserId,
      WorkshopStatusFields.supportingUserId: r.supportingUserId,
      WorkshopStatusFields.expectedPartDate: r.expectedPartDate,
      WorkshopStatusFields.expectedReleaseDate: r.expectedReleaseDate,
      WorkshopStatusFields.blocker: r.blocker,
      WorkshopStatusFields.remarks: r.remarks,
    };

/// Only the fields whose normalised value differs from [record]. A cleared
/// field is sent as null. An empty map means there is nothing to save.
///
/// Keys outside [WorkshopStatusFields.all] are ignored, so who/when can never
/// ride along by accident.
Map<String, String?> workshopDiffPatch(
  WorkshopStatusRecord record,
  Map<String, String?> form,
) {
  final Map<String, String?> before = workshopFormFromRecord(record);
  final Map<String, String?> patch = <String, String?>{};
  for (final String field in WorkshopStatusFields.all) {
    if (!form.containsKey(field)) continue;
    final String? next = _normField(field, form[field]);
    final String? prev = _normField(field, before[field]);
    if (next != prev) patch[field] = next;
  }
  return patch;
}

/// Why a form value cannot be saved.
enum WorkshopFieldError {
  detailRequired,
  notInList,
  invalidDate,
  dateRange,
  releaseBeforePart,
  tooLong,
}

/// Inline validation mirroring the server rules. Empty map = valid.
Map<String, WorkshopFieldError> workshopValidateForm(
  Map<String, String?> form,
) {
  final Map<String, WorkshopFieldError> errors = <String, WorkshopFieldError>{};
  String val(String k) => (form[k] ?? '').trim();

  final Map<String, List<String>> lists = <String, List<String>>{
    WorkshopStatusFields.currentStage: kWorkshopSelectableStages,
    WorkshopStatusFields.delayReason: kWorkshopDelayReasons,
    WorkshopStatusFields.partsStatus: kWorkshopPartsStatuses,
  };
  lists.forEach((String k, List<String> list) {
    final String v = val(k);
    if (v.isNotEmpty && !list.contains(v)) {
      errors[k] = WorkshopFieldError.notInList;
    }
  });

  if (workshopNeedsDetailedReason(val(WorkshopStatusFields.delayReason)) &&
      val(WorkshopStatusFields.detailedReason).isEmpty) {
    errors[WorkshopStatusFields.detailedReason] =
        WorkshopFieldError.detailRequired;
  }

  for (final String k in WorkshopStatusFields.dates) {
    final String v = val(k);
    if (v.isEmpty) continue;
    if (!workshopIsValidDate(v)) {
      errors[k] = WorkshopFieldError.invalidDate;
      continue;
    }
    final int y = int.parse(v.substring(0, 4));
    if (y < 2000 || y > 2100) errors[k] = WorkshopFieldError.dateRange;
  }
  final String part = val(WorkshopStatusFields.expectedPartDate);
  final String release = val(WorkshopStatusFields.expectedReleaseDate);
  if (part.isNotEmpty &&
      release.isNotEmpty &&
      !errors.containsKey(WorkshopStatusFields.expectedPartDate) &&
      !errors.containsKey(WorkshopStatusFields.expectedReleaseDate) &&
      release.compareTo(part) < 0) {
    errors[WorkshopStatusFields.expectedReleaseDate] =
        WorkshopFieldError.releaseBeforePart;
  }

  for (final String k in WorkshopStatusFields.longText) {
    if (!errors.containsKey(k) &&
        val(k).length > WorkshopStatusFields.maxText) {
      errors[k] = WorkshopFieldError.tooLong;
    }
  }
  for (final String k in WorkshopStatusFields.refs) {
    if (val(k).length > WorkshopStatusFields.maxRef) {
      errors[k] = WorkshopFieldError.tooLong;
    }
  }
  return errors;
}

/// True when [s] is a real calendar date written `yyyy-mm-dd`.
bool workshopIsValidDate(String s) {
  final RegExpMatch? m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(s);
  if (m == null) return false;
  final int y = int.parse(m.group(1)!);
  final int mo = int.parse(m.group(2)!);
  final int d = int.parse(m.group(3)!);
  final DateTime dt = DateTime.utc(y, mo, d);
  return dt.year == y && dt.month == mo && dt.day == d;
}

/// `yyyy-mm-dd` (or an ISO timestamp) -> `yyyy-mm-dd`, anything else null.
String? workshopDateOnly(Object? value) {
  final String raw = value?.toString().trim() ?? '';
  final RegExpMatch? m = RegExp(r'^(\d{4}-\d{2}-\d{2})').firstMatch(raw);
  return m?.group(1);
}

/// A DateTime as `yyyy-mm-dd` from its own (local) calendar fields.
/// Never `toIso8601String()` on a UTC value, which can roll the day.
String workshopDateString(DateTime d) => '${d.year.toString().padLeft(4, '0')}-'
    '${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';

String? _normField(String field, String? value) {
  if (value == null) return null;
  final String s = value.trim();
  if (s.isEmpty) return null;
  if (WorkshopStatusFields.dates.contains(field)) {
    return workshopDateOnly(s) ?? s;
  }
  if (WorkshopStatusFields.people.contains(field)) return s.toLowerCase();
  return s;
}

DateTime? _parseDay(String? v) {
  final String? d = workshopDateOnly(v);
  if (d == null) return null;
  return DateTime.utc(
    int.parse(d.substring(0, 4)),
    int.parse(d.substring(5, 7)),
    int.parse(d.substring(8, 10)),
  );
}

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

num? _number(Object? value) =>
    value is num ? value : num.tryParse(_text(value) ?? '');

/// The `workshop_status_my_permissions()` answer, failing CLOSED: any action
/// the server did not answer `true` is false.
@immutable
final class WorkshopStatusPermissions {
  const WorkshopStatusPermissions({
    this.view = false,
    this.update = false,
    this.assign = false,
  });

  factory WorkshopStatusPermissions.fromJson(Object? raw) {
    if (raw is! Map) return const WorkshopStatusPermissions();
    return WorkshopStatusPermissions(
      view: raw['view'] == true,
      update: raw['update'] == true,
      assign: raw['assign'] == true,
    );
  }

  final bool view;
  final bool update;
  final bool assign;
}
