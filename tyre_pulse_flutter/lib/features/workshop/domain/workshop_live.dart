/// Workshop Live Control - the technician-side engine.
///
/// Rule-for-rule port of `mobile/lib/workshopLive.ts` (itself a mirror of the
/// web engine `src/lib/workshopLive.js`). `mobile/` is READ-ONLY reference
/// material - see `AGENTS.md`. KEEP IN SYNC with both: the event vocabulary
/// is the `tech_activity_events.event_type` CHECK in
/// `MIGRATIONS_V291_WORKSHOP_LIVE_CONTROL.sql`, and the status switch is the
/// shared contract between the technician app and the foreman dashboard.
///
/// Pure Dart: no Flutter, no I/O, and never `DateTime.now()` - every clock
/// value is passed in, so every function is deterministic and testable.
library;

import 'dart:math' as math;

/// The `tech_activity_events.event_type` CHECK vocabulary, verbatim.
const List<String> kWorkshopEventTypes = <String>[
  'check_in',
  'check_out',
  'start_job',
  'pause_job',
  'resume_job',
  'complete_task',
  'request_parts',
  'request_assistance',
  'waiting_approval',
  'waiting_vehicle',
  'waiting_tools',
  'start_break',
  'end_break',
  'training',
  'report_problem',
];

/// Blocked reasons - waiting time that is NOT the technician's fault.
const List<String> kWorkshopBlockedReasons = <String>[
  'parts',
  'tools',
  'approval',
  'vehicle',
  'vendor',
  'support',
];

/// A technician's live status.
enum WorkshopStatus {
  working,
  available,
  waitingParts,
  waitingApproval,
  waitingTools,
  waitingVehicle,
  onBreak,
  training,
  awaitingInspection,
  offDuty,
  absent;

  /// The web/mobile wire token (`waiting_parts`, `on_break`, ...), also the
  /// copy-catalog key suffix.
  String get token => switch (this) {
        WorkshopStatus.working => 'working',
        WorkshopStatus.available => 'available',
        WorkshopStatus.waitingParts => 'waiting_parts',
        WorkshopStatus.waitingApproval => 'waiting_approval',
        WorkshopStatus.waitingTools => 'waiting_tools',
        WorkshopStatus.waitingVehicle => 'waiting_vehicle',
        WorkshopStatus.onBreak => 'on_break',
        WorkshopStatus.training => 'training',
        WorkshopStatus.awaitingInspection => 'awaiting_inspection',
        WorkshopStatus.offDuty => 'off_duty',
        WorkshopStatus.absent => 'absent',
      };
}

/// One large, thumb-first technician action button.
///
/// [reason] is the blocked reason the action implies (stored in
/// `reason_code`); [confirm] means the action asks before recording (a
/// completion is significant). Check in / out live in the header, not here.
final class WorkshopTechAction {
  const WorkshopTechAction({
    required this.key,
    required this.event,
    this.reason,
    this.confirm = false,
  });

  final String key;
  final String event;
  final String? reason;
  final bool confirm;

  /// Blocked reasons, a problem and an assistance request collect an
  /// optional note first. A break needs no note.
  bool get needsNote {
    if (event == 'report_problem' || event == 'request_assistance') {
      return true;
    }
    return reason != null && reason != 'break';
  }

  /// When the job is split into tasks, Start / Complete must name one.
  bool get requiresTask => event == 'start_job' || event == 'complete_task';
}

/// Mirrors mobile `TECH_ACTIONS`, same order.
const List<WorkshopTechAction> kWorkshopTechActions = <WorkshopTechAction>[
  WorkshopTechAction(key: 'start_job', event: 'start_job'),
  WorkshopTechAction(key: 'pause_job', event: 'pause_job'),
  WorkshopTechAction(key: 'resume_job', event: 'resume_job'),
  WorkshopTechAction(
    key: 'complete_task',
    event: 'complete_task',
    confirm: true,
  ),
  WorkshopTechAction(
    key: 'request_parts',
    event: 'request_parts',
    reason: 'parts',
  ),
  WorkshopTechAction(
    key: 'request_assistance',
    event: 'request_assistance',
    reason: 'support',
  ),
  WorkshopTechAction(
    key: 'waiting_approval',
    event: 'waiting_approval',
    reason: 'approval',
  ),
  WorkshopTechAction(
    key: 'waiting_vehicle',
    event: 'waiting_vehicle',
    reason: 'vehicle',
  ),
  WorkshopTechAction(
    key: 'waiting_tools',
    event: 'waiting_tools',
    reason: 'tools',
  ),
  WorkshopTechAction(
    key: 'start_break',
    event: 'start_break',
    reason: 'break',
  ),
  WorkshopTechAction(key: 'end_break', event: 'end_break'),
  WorkshopTechAction(key: 'report_problem', event: 'report_problem'),
];

/// The minimal event shape the engine reads.
final class WorkshopEventLike {
  const WorkshopEventLike({
    required this.eventType,
    this.reasonCode,
    this.at,
  });

  final String eventType;
  final String? reasonCode;

  /// The server timestamp (`tech_activity_events.at`), or the device time
  /// for an event recorded locally and not yet synced. Null never counts.
  final DateTime? at;
}

const Set<String> _annotations = <String>{
  'request_assistance',
  'report_problem',
};

List<WorkshopEventLike> _ordered(Iterable<WorkshopEventLike> events) {
  final List<WorkshopEventLike> out = <WorkshopEventLike>[
    for (final WorkshopEventLike e in events)
      if (e.at != null) e,
  ]..sort(
      (WorkshopEventLike a, WorkshopEventLike b) => a.at!.compareTo(b.at!),
    );
  return out;
}

/// Current live status from one stream of events. `request_assistance` and
/// `report_problem` are ANNOTATIONS and never change the status; a
/// `pause_job` resolves by its `reason_code`. No events -> available when
/// [present] (checked in), else absent.
WorkshopStatus workshopStatusFromEvents(
  Iterable<WorkshopEventLike> events, {
  bool present = false,
}) {
  final List<WorkshopEventLike> evs = _ordered(
    events.where((WorkshopEventLike e) => !_annotations.contains(e.eventType)),
  );
  if (evs.isEmpty) {
    return present ? WorkshopStatus.available : WorkshopStatus.absent;
  }
  final WorkshopEventLike last = evs.last;
  switch (last.eventType) {
    case 'check_out':
      return WorkshopStatus.offDuty;
    case 'start_job':
    case 'resume_job':
      return WorkshopStatus.working;
    case 'start_break':
      return WorkshopStatus.onBreak;
    case 'end_break':
    case 'check_in':
      return WorkshopStatus.available;
    case 'training':
      return WorkshopStatus.training;
    case 'request_parts':
      return WorkshopStatus.waitingParts;
    case 'waiting_tools':
      return WorkshopStatus.waitingTools;
    case 'waiting_approval':
      return WorkshopStatus.waitingApproval;
    case 'waiting_vehicle':
      return WorkshopStatus.waitingVehicle;
    case 'complete_task':
      return WorkshopStatus.awaitingInspection;
    case 'pause_job':
      switch ((last.reasonCode ?? '').toLowerCase()) {
        case 'parts':
          return WorkshopStatus.waitingParts;
        case 'tools':
          return WorkshopStatus.waitingTools;
        case 'approval':
          return WorkshopStatus.waitingApproval;
        case 'vehicle':
          return WorkshopStatus.waitingVehicle;
        case 'break':
          return WorkshopStatus.onBreak;
      }
      return WorkshopStatus.available;
  }
  return WorkshopStatus.available;
}

/// On duty = the last check_in / check_out event is a check_in.
bool workshopIsCheckedIn(Iterable<WorkshopEventLike> events) {
  final List<WorkshopEventLike> duty = _ordered(
    events.where(
      (WorkshopEventLike e) =>
          e.eventType == 'check_in' || e.eventType == 'check_out',
    ),
  );
  return duty.isNotEmpty && duty.last.eventType == 'check_in';
}

/// The technician's own compact rollup for today.
final class WorkshopProductivity {
  const WorkshopProductivity({
    required this.productiveMin,
    required this.blockedMin,
    required this.unassignedMin,
    required this.breakMin,
    required this.jobsCompleted,
  });

  final double productiveMin;
  final double blockedMin;
  final double unassignedMin;
  final double breakMin;
  final int jobsCompleted;
}

const Map<String, String> _eventState = <String, String>{
  'check_in': 'available',
  'start_job': 'productive',
  'resume_job': 'productive',
  'complete_task': 'available',
  'request_parts': 'blocked:parts',
  'waiting_tools': 'blocked:tools',
  'waiting_approval': 'blocked:approval',
  'waiting_vehicle': 'blocked:vehicle',
  'start_break': 'break',
  'end_break': 'available',
  'training': 'training',
  'check_out': 'off',
};

double _round1(double n) => (n * 10).roundToDouble() / 10;

/// Reduced port of mobile `myProductivityToday` (buildSegments +
/// rollupTechnician) with no shift bounds: the available duty is the sum of
/// classified time. [now] is passed in, never read here.
WorkshopProductivity workshopProductivityToday(
  Iterable<WorkshopEventLike> events, {
  required DateTime now,
}) {
  final List<WorkshopEventLike> evs = _ordered(events);
  final Map<String, double> bucket = <String, double>{
    'productive': 0,
    'blocked': 0,
    'break': 0,
    'training': 0,
    'unassigned': 0,
  };

  String? state;
  String? reason;
  DateTime? start;

  void close(DateTime end) {
    if (state == null || start == null || !end.isAfter(start)) return;
    final String kind = switch (state) {
      'productive' => 'productive',
      'break' => 'break',
      'training' => 'training',
      _ => reason != null ? 'blocked' : 'unassigned',
    };
    bucket[kind] = bucket[kind]! +
        end.difference(start).inMilliseconds / Duration.millisecondsPerMinute;
  }

  for (final WorkshopEventLike e in evs) {
    String nextState;
    String? nextReason;
    if (e.eventType == 'pause_job') {
      final String r = (e.reasonCode ?? '').toLowerCase();
      if (kWorkshopBlockedReasons.contains(r)) {
        nextState = 'blocked';
        nextReason = r;
      } else if (r == 'break') {
        nextState = 'break';
      } else {
        nextState = 'available';
      }
    } else if (e.eventType == 'report_problem') {
      continue; // annotation - inherit the current state
    } else {
      final String? mapped = _eventState[e.eventType];
      if (mapped == null) continue;
      if (mapped.startsWith('blocked:')) {
        nextState = 'blocked';
        nextReason = mapped.substring(8);
      } else {
        nextState = mapped;
      }
    }

    close(e.at!);
    if (nextState == 'off') {
      state = null;
      reason = null;
      start = null;
      continue;
    }
    state = nextState;
    reason = nextReason;
    start = e.at;
  }
  if (state != null && start != null) {
    close(now.isAfter(start) ? now : start);
  }

  final double duty =
      bucket.values.fold<double>(0, (double a, double b) => a + b);
  final double dutyForUtil =
      math.max(0.0, duty - bucket['break']! - bucket['training']!);
  final double leftover = math.max(
    0.0,
    dutyForUtil - bucket['productive']! - bucket['blocked']!,
  );
  final double unassigned = math.max(bucket['unassigned']!, leftover);

  return WorkshopProductivity(
    productiveMin: _round1(bucket['productive']!),
    blockedMin: _round1(bucket['blocked']!),
    unassignedMin: _round1(unassigned),
    breakMin: _round1(bucket['break']!),
    jobsCompleted: evs
        .where((WorkshopEventLike e) => e.eventType == 'complete_task')
        .length,
  );
}

/// "45m" / "1h 20m", never negative.
String formatWorkshopMinutes(double minutes) {
  final int mins = minutes.isFinite && minutes > 0 ? minutes.round() : 0;
  if (mins < 60) return '${mins}m';
  final int h = mins ~/ 60;
  final int r = mins % 60;
  return r == 0 ? '${h}h' : '${h}h ${r}m';
}

/// Work-order statuses with nothing left for a technician to do.
const Set<String> _closedStatuses = <String>{
  'completed',
  'complete',
  'closed',
  'cancelled',
  'canceled',
  'done',
  'rejected',
};

/// A job with no status yet is still actionable.
bool isOpenWorkshopJob(String? status) {
  final String s =
      (status ?? '').trim().toLowerCase().replaceAll(RegExp(r'\s+'), '_');
  return s.isEmpty || !_closedStatuses.contains(s);
}
