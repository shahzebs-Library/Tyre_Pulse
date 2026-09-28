/// Pure due-date and cadence classification for the checklist hub's
/// "Required for this asset" rows.
///
/// Everything here reads real columns only: `checklist_assignments.due_date`
/// and `.status`, and `checklist_templates.min_interval_days`. Nothing is
/// estimated - there is no "minutes to complete" column anywhere, so the
/// hub does not show one.
library;

/// How urgent one assignment is, relative to the device's own calendar day.
enum ChecklistDueKind {
  /// The server marked it overdue, or its due day is already past.
  overdue,

  /// Due today.
  today,

  /// Due tomorrow.
  tomorrow,

  /// Due on a later day ([ChecklistDue.date]).
  later,

  /// A due value that is not a date. Shown verbatim ([ChecklistDue.raw]),
  /// never guessed at.
  unparsed,

  /// No due date and no overdue status.
  none,
}

final class ChecklistDue {
  const ChecklistDue(this.kind, {this.date, this.raw});

  final ChecklistDueKind kind;

  /// The due calendar day (local), when one was parsed.
  final DateTime? date;

  /// The stored value, for [ChecklistDueKind.unparsed].
  final String? raw;

  /// Whether the row should lead with a filled Start button.
  bool get isActionableNow =>
      kind == ChecklistDueKind.overdue || kind == ChecklistDueKind.today;
}

DateTime _day(DateTime value) => DateTime(value.year, value.month, value.day);

/// Classifies one assignment against [now] (injected for tests).
ChecklistDue classifyChecklistDue({
  required String? dueDate,
  required String? status,
  required DateTime now,
}) {
  final String normalisedStatus = status?.trim().toLowerCase() ?? '';
  final String raw = dueDate?.trim() ?? '';
  final DateTime? parsed = raw.isEmpty ? null : DateTime.tryParse(raw);
  if (parsed == null) {
    if (normalisedStatus == 'overdue') {
      return const ChecklistDue(ChecklistDueKind.overdue);
    }
    if (raw.isEmpty) return const ChecklistDue(ChecklistDueKind.none);
    return ChecklistDue(ChecklistDueKind.unparsed, raw: raw);
  }
  // A bare `YYYY-MM-DD` is the ASSIGNED calendar day, not an instant: read
  // it as that day, never shifted through UTC.
  final DateTime due = raw.length <= 10
      ? DateTime(parsed.year, parsed.month, parsed.day)
      : _day(parsed.toLocal());
  final DateTime today = _day(now);
  // Calendar-day difference measured on UTC midnights: two LOCAL midnights
  // either side of a daylight-saving change are 23 or 25 hours apart, and
  // `inDays` would truncate the 23-hour gap to 0 (tomorrow read as today).
  final int delta = DateTime.utc(due.year, due.month, due.day)
      .difference(DateTime.utc(today.year, today.month, today.day))
      .inDays;
  if (normalisedStatus == 'overdue' || delta < 0) {
    return ChecklistDue(ChecklistDueKind.overdue, date: due);
  }
  if (delta == 0) return ChecklistDue(ChecklistDueKind.today, date: due);
  if (delta == 1) return ChecklistDue(ChecklistDueKind.tomorrow, date: due);
  return ChecklistDue(ChecklistDueKind.later, date: due);
}

/// A template's cadence, from `checklist_templates.min_interval_days`.
enum ChecklistCadence { daily, weekly, monthly, everyNDays, none }

ChecklistCadence cadenceFor(int? minIntervalDays) {
  if (minIntervalDays == null || minIntervalDays <= 0) {
    return ChecklistCadence.none;
  }
  if (minIntervalDays == 1) return ChecklistCadence.daily;
  if (minIntervalDays == 7) return ChecklistCadence.weekly;
  if (minIntervalDays >= 28 && minIntervalDays <= 31) {
    return ChecklistCadence.monthly;
  }
  return ChecklistCadence.everyNDays;
}
