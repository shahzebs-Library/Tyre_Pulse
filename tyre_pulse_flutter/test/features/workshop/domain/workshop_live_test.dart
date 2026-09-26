// Parity with mobile/lib/workshopLive.ts (statusFromEvents, isCheckedIn,
// myProductivityToday) and the V291 event vocabulary.
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_live.dart';

WorkshopEventLike _e(String type, int minute, {String? reason}) =>
    WorkshopEventLike(
      eventType: type,
      reasonCode: reason,
      at: DateTime.utc(2026, 9, 26, 8).add(Duration(minutes: minute)),
    );

void main() {
  group('workshopStatusFromEvents', () {
    test('no events: available when present, else absent', () {
      expect(
        workshopStatusFromEvents(const <WorkshopEventLike>[], present: true),
        WorkshopStatus.available,
      );
      expect(
        workshopStatusFromEvents(const <WorkshopEventLike>[]),
        WorkshopStatus.absent,
      );
    });

    test('the latest meaningful event decides, by time not list order', () {
      expect(
        workshopStatusFromEvents(<WorkshopEventLike>[
          _e('request_parts', 30),
          _e('start_job', 10),
        ]),
        WorkshopStatus.waitingParts,
      );
      expect(
        workshopStatusFromEvents(<WorkshopEventLike>[_e('complete_task', 5)]),
        WorkshopStatus.awaitingInspection,
      );
      expect(
        workshopStatusFromEvents(<WorkshopEventLike>[_e('check_out', 5)]),
        WorkshopStatus.offDuty,
      );
    });

    test('annotations never change the status', () {
      expect(
        workshopStatusFromEvents(<WorkshopEventLike>[
          _e('start_job', 0),
          _e('report_problem', 5),
          _e('request_assistance', 6),
        ]),
        WorkshopStatus.working,
      );
    });

    test('pause_job resolves by its reason code', () {
      WorkshopStatus pause(String? r) => workshopStatusFromEvents(
            <WorkshopEventLike>[_e('pause_job', 0, reason: r)],
          );
      expect(pause('parts'), WorkshopStatus.waitingParts);
      expect(pause('tools'), WorkshopStatus.waitingTools);
      expect(pause('approval'), WorkshopStatus.waitingApproval);
      expect(pause('vehicle'), WorkshopStatus.waitingVehicle);
      expect(pause('break'), WorkshopStatus.onBreak);
      expect(pause(null), WorkshopStatus.available);
    });
  });

  test('workshopIsCheckedIn reads only duty events', () {
    expect(
      workshopIsCheckedIn(<WorkshopEventLike>[
        _e('check_in', 0),
        _e('start_job', 5),
      ]),
      isTrue,
    );
    expect(
      workshopIsCheckedIn(<WorkshopEventLike>[
        _e('check_in', 0),
        _e('check_out', 60),
      ]),
      isFalse,
    );
    expect(workshopIsCheckedIn(const <WorkshopEventLike>[]), isFalse);
  });

  test('productivity splits productive, blocked and break time', () {
    final WorkshopProductivity p = workshopProductivityToday(
      <WorkshopEventLike>[
        _e('check_in', 0),
        _e('start_job', 10),
        _e('request_parts', 70),
        _e('resume_job', 100),
        _e('start_break', 130),
        _e('end_break', 145),
        _e('complete_task', 160),
        _e('check_out', 170),
      ],
      now: DateTime.utc(2026, 9, 26, 12),
    );
    expect(p.productiveMin, 90);
    expect(p.blockedMin, 30);
    expect(p.breakMin, 15);
    expect(p.unassignedMin, 35);
    expect(p.jobsCompleted, 1);
  });

  test('every action is in the V291 CHECK vocabulary', () {
    for (final WorkshopTechAction a in kWorkshopTechActions) {
      expect(kWorkshopEventTypes, contains(a.event));
    }
    expect(
      kWorkshopTechActions
          .where((WorkshopTechAction a) => a.needsNote)
          .map((WorkshopTechAction a) => a.key),
      <String>[
        'request_parts',
        'request_assistance',
        'waiting_approval',
        'waiting_vehicle',
        'waiting_tools',
        'report_problem',
      ],
    );
  });

  test('formatWorkshopMinutes', () {
    expect(formatWorkshopMinutes(0), '0m');
    expect(formatWorkshopMinutes(45), '45m');
    expect(formatWorkshopMinutes(80), '1h 20m');
    expect(formatWorkshopMinutes(120), '2h');
    expect(formatWorkshopMinutes(-5), '0m');
  });

  test('isOpenWorkshopJob', () {
    expect(isOpenWorkshopJob(null), isTrue);
    expect(isOpenWorkshopJob('In Progress'), isTrue);
    expect(isOpenWorkshopJob('Completed'), isFalse);
    expect(isOpenWorkshopJob(' closed '), isFalse);
  });

  test('a synced row replaces its local copy by client_uuid', () {
    final List<WorkshopEventRecord> merged = mergeWorkshopEvents(
      <WorkshopEventRecord>[
        WorkshopEventRecord(
          eventType: 'start_job',
          clientUuid: 'ws_a',
          at: DateTime.utc(2026, 9, 26, 8),
        ),
      ],
      <WorkshopEventRecord>[
        WorkshopEventRecord(
          eventType: 'start_job',
          clientUuid: 'ws_a',
          localAt: DateTime.utc(2026, 9, 26, 8),
        ),
        WorkshopEventRecord(
          eventType: 'pause_job',
          clientUuid: 'ws_b',
          localAt: DateTime.utc(2026, 9, 26, 9),
        ),
      ],
    );
    expect(merged.map((WorkshopEventRecord e) => e.clientUuid), <String>[
      'ws_a',
      'ws_b',
    ]);
  });
}
