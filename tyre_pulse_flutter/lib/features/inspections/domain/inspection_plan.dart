/// One planned inspection: a vehicle this person is supposed to inspect on a
/// given day, and whether that has actually happened.
///
/// # Why the state is PARSED and never computed here
///
/// "Done / Started / Missed / Due / Upcoming" is defined once, in SQL
/// `public.inspection_plan_state()`, and mirrored once in the web engine
/// (`src/lib/schedulePlan.js`). Those two are already a mirror pair that has
/// to be changed together, and the pairing earned its keep immediately: a null
/// `grace_days` became a zero-day window on the JS side while SQL coalesced to
/// 2, so a plan read Missed a full day early.
///
/// A THIRD copy in Dart would be a third thing to keep in step, and the rule it
/// would have to reproduce is the subtle one - a plan counts as done when that
/// VEHICLE has an inspection dated inside `[scheduled_date, scheduled_date +
/// grace_days]`, because an inspection carries no link back to the plan that
/// asked for it. So the phone calls `get_schedule_adherence`, which does the
/// join server-side, and this file only parses the answer.
///
/// [InspectionPlanState.unknown] exists for exactly that reason: if the server
/// ever grows a state this build does not know, the row is still shown, still
/// sorted, and simply not claimed to mean anything - which is the honest
/// outcome, and far better than silently bucketing it as Upcoming.
library;

import 'package:flutter/foundation.dart';

/// The lifecycle of a plan, as the server reports it.
///
/// Order is deliberate and load-bearing: it is the order a crew needs to act
/// in, worst first, and [comparePlansForCrew] relies on it.
enum InspectionPlanState {
  /// The window closed with no inspection on this vehicle.
  missed,

  /// Inside its window today and not yet inspected.
  due,

  /// An inspection exists but is not finished.
  started,

  /// Planned for a date still ahead.
  upcoming,

  /// A finished inspection landed inside the window.
  done,

  /// Called off by a planner.
  cancelled,

  /// A state this build does not recognise. Shown, never interpreted.
  unknown;

  /// Parses the server's `plan_state` text.
  ///
  /// Unrecognised input returns [unknown] rather than a default, so a server
  /// that grows a new state cannot be silently mis-bucketed by an old build.
  static InspectionPlanState parse(Object? raw) {
    switch (raw?.toString().trim().toLowerCase()) {
      case 'missed':
        return InspectionPlanState.missed;
      case 'due':
        return InspectionPlanState.due;
      case 'started':
        return InspectionPlanState.started;
      case 'upcoming':
        return InspectionPlanState.upcoming;
      case 'done':
        return InspectionPlanState.done;
      case 'cancelled':
      case 'canceled':
        return InspectionPlanState.cancelled;
      default:
        return InspectionPlanState.unknown;
    }
  }

  /// Work the crew still has to do. Drives the badge on the home tile, so it
  /// must not count a plan that is finished, called off, or not yet due.
  bool get isOutstanding =>
      this == InspectionPlanState.missed || this == InspectionPlanState.due;

  /// Whether this state means somebody has already been to the vehicle.
  bool get isSettled =>
      this == InspectionPlanState.done || this == InspectionPlanState.cancelled;
}

@immutable
class InspectionPlan {
  const InspectionPlan({
    required this.id,
    required this.assetNo,
    required this.scheduledDate,
    required this.state,
    this.site,
    this.team,
    this.vehicleType,
    this.inspectionTime,
    this.inspectionType,
    this.priority,
    this.notes,
    this.assignedTo,
    this.assignedName,
    this.matchedDate,
    this.matchedInspector,
    this.daysLate = 0,
  });

  /// Parses one `get_schedule_adherence` row.
  ///
  /// Every field is read defensively. This RPC is young, and a row that
  /// arrives with an unexpected shape should degrade to a plan the crew can
  /// still read rather than crash the only screen that tells them what to do.
  factory InspectionPlan.fromRow(Map<String, dynamic> row) {
    return InspectionPlan(
      id: _text(row['id']) ?? '',
      assetNo: _text(row['asset_no']) ?? '',
      scheduledDate: _date(row['scheduled_date']),
      state: InspectionPlanState.parse(row['plan_state']),
      site: _text(row['site']),
      team: _text(row['team']),
      vehicleType: _text(row['vehicle_type']),
      inspectionTime: _text(row['inspection_time']),
      inspectionType: _text(row['inspection_type']),
      priority: _text(row['priority']),
      notes: _text(row['notes']),
      assignedTo: _text(row['assigned_to']),
      assignedName: _text(row['assigned_name']),
      matchedDate: _nullableDate(row['matched_date']),
      matchedInspector: _text(row['matched_inspector']),
      daysLate: _int(row['days_late']),
    );
  }

  /// The `inspection_schedules` row id. NOT an inspection id - nothing may
  /// open an inspection detail screen with it.
  final String id;

  final String assetNo;

  /// The day the work is planned for. Date-only; the server column is a
  /// `date`, so this carries no meaningful time component.
  final DateTime scheduledDate;

  final InspectionPlanState state;
  final String? site;
  final String? team;
  final String? vehicleType;

  /// `HH:MM`, a planning hint rather than an appointment.
  final String? inspectionTime;

  final String? inspectionType;
  final String? priority;
  final String? notes;

  /// The profile this plan belongs to.
  final String? assignedTo;
  final String? assignedName;

  /// When the fulfilling inspection actually happened, if one did.
  final DateTime? matchedDate;
  final String? matchedInspector;

  /// How late the work was, or how overdue it now is. Server-computed.
  final int daysLate;

  bool get isOutstanding => state.isOutstanding;

  /// True when somebody OTHER than the assignee did the work. Worth surfacing:
  /// it is not a problem, but a crew member seeing their plan closed by a
  /// colleague should be able to tell that is what happened.
  bool coveredBySomeoneElse(String? myName) {
    final String? actual = matchedInspector?.trim();
    final String? mine = myName?.trim();
    if (actual == null || actual.isEmpty || mine == null || mine.isEmpty) {
      return false;
    }
    return actual.toLowerCase() != mine.toLowerCase();
  }
}

/// Sorts the way a crew reads their day: worst state first, then soonest.
///
/// Within a state the earlier date comes first, because that is the one to do
/// next; ties break on asset number purely so the order is stable between
/// refreshes and a row does not appear to jump around.
int comparePlansForCrew(InspectionPlan a, InspectionPlan b) {
  final int byState = a.state.index.compareTo(b.state.index);
  if (byState != 0) return byState;
  final int byDate = a.scheduledDate.compareTo(b.scheduledDate);
  if (byDate != 0) return byDate;
  return a.assetNo.compareTo(b.assetNo);
}

/// Groups plans by day, newest-work-first within each day.
///
/// Returns a [LinkedHashMap] so iteration order is the sorted day order, which
/// the screen renders directly rather than re-sorting keys.
Map<DateTime, List<InspectionPlan>> groupPlansByDay(
  List<InspectionPlan> plans,
) {
  final List<InspectionPlan> sorted = List<InspectionPlan>.of(plans)
    ..sort((InspectionPlan a, InspectionPlan b) {
      final int byDate = a.scheduledDate.compareTo(b.scheduledDate);
      if (byDate != 0) return byDate;
      return comparePlansForCrew(a, b);
    });
  final Map<DateTime, List<InspectionPlan>> byDay =
      <DateTime, List<InspectionPlan>>{};
  for (final InspectionPlan plan in sorted) {
    final DateTime day = DateTime.utc(
      plan.scheduledDate.year,
      plan.scheduledDate.month,
      plan.scheduledDate.day,
    );
    byDay.putIfAbsent(day, () => <InspectionPlan>[]).add(plan);
  }
  return byDay;
}

/// Headline counts for the list header and the home badge.
@immutable
class InspectionPlanSummary {
  const InspectionPlanSummary({
    required this.total,
    required this.missed,
    required this.due,
    required this.upcoming,
    required this.done,
  });

  factory InspectionPlanSummary.of(List<InspectionPlan> plans) {
    int missed = 0;
    int due = 0;
    int upcoming = 0;
    int done = 0;
    for (final InspectionPlan plan in plans) {
      switch (plan.state) {
        case InspectionPlanState.missed:
          missed++;
        case InspectionPlanState.due:
          due++;
        case InspectionPlanState.upcoming:
          upcoming++;
        case InspectionPlanState.done:
          done++;
        case InspectionPlanState.started:
        case InspectionPlanState.cancelled:
        case InspectionPlanState.unknown:
          break;
      }
    }
    return InspectionPlanSummary(
      total: plans.length,
      missed: missed,
      due: due,
      upcoming: upcoming,
      done: done,
    );
  }

  final int total;
  final int missed;
  final int due;
  final int upcoming;
  final int done;

  /// What the home badge shows. Missed work counts as outstanding - it has not
  /// stopped needing doing just because its day passed.
  int get outstanding => missed + due;

  bool get isEmpty => total == 0;
}

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

/// Date-only parse. Falls back to the epoch rather than throwing: a plan with
/// an unreadable date is still a plan the crew should see, and sorting it to
/// the top is the behaviour that gets it looked at.
DateTime _date(Object? value) =>
    _nullableDate(value) ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);

DateTime? _nullableDate(Object? value) {
  final String? text = _text(value);
  if (text == null) return null;
  final DateTime? parsed = DateTime.tryParse(text);
  if (parsed == null) return null;
  return DateTime.utc(parsed.year, parsed.month, parsed.day);
}

int _int(Object? value) {
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse(value?.toString().trim() ?? '') ?? 0;
}
