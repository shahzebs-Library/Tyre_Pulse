import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_handover_gating.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_timeline_feed.dart';

void main() {
  final DateTime now = DateTime.utc(2026, 9, 16, 15, 8);
  final AccidentCaseSnapshot snapshot = AccidentCaseSnapshot(
    accident: AccidentRecord(
      id: 'a1',
      assetNo: 'CP-045',
      site: 'Yard',
      incidentDate: '2026-09-12',
      reporterName: 'Recorded reporter',
      photos: const <String>['p1', 'p2', 'p3'],
      createdAt: DateTime.utc(2026, 9, 12, 9, 8),
    ),
    provisioned: true,
    workstreams: <AccidentWorkstream>[
      AccidentWorkstream(
        id: 'w1',
        key: 'fleet_validation',
        status: 'completed',
        team: 'Fleet',
        updatedAt: DateTime.utc(2026, 9, 12, 10, 30),
      ),
      const AccidentWorkstream(
        id: 'w2',
        key: 'handover',
        status: 'in_progress',
        team: 'External workshop',
      ),
    ],
  );

  final AccidentCommunication email = AccidentCommunication(
    id: 'c1',
    channel: 'email_out',
    direction: 'outbound',
    occurredAt: DateTime.utc(2026, 9, 13, 8),
    subject: 'Claim package sent',
    toParty: 'Insurance, Fleet',
  );
  final AccidentCommunication note = AccidentCommunication(
    id: 'c2',
    channel: 'comment',
    direction: 'internal',
    occurredAt: DateTime.utc(2026, 9, 14, 8),
    body: 'Called the vendor',
    authorName: 'Recorded author',
  );
  const AccidentCommunication undated = AccidentCommunication(
    id: 'c3',
    channel: 'comment',
    direction: 'internal',
    occurredAt: null,
    body: 'never shown',
  );
  final AccidentSlaRow running = AccidentSlaRow(
    id: 's1',
    state: 'running',
    name: 'Vendor receipt',
    workstreamKey: 'handover',
    team: 'External workshop',
    startAt: DateTime.utc(2026, 9, 16, 14),
    dueAt: now.add(const Duration(minutes: 52)),
    warningAt: now.add(const Duration(minutes: 30)),
  );
  final AccidentSlaRow met = AccidentSlaRow(
    id: 's2',
    state: 'met',
    name: 'Fleet validation',
    workstreamKey: 'fleet_validation',
    startAt: DateTime.utc(2026, 9, 12, 9),
    completedAt: DateTime.utc(2026, 9, 12, 10),
  );
  final AccidentDispatch dispatch = AccidentDispatch(
    id: 'd1',
    accidentId: 'a1',
    departureAt: DateTime.utc(2026, 9, 16, 14),
    liveStatus: 'in_transit',
    sentByName: 'Recorded sender',
    destination: 'Vendor workshop',
    outgoingPhotos: const <String>['o1', 'o2'],
  );

  TimelineFeedInput input({
    Map<String, DeliveryReceipt> deliveries = const <String, DeliveryReceipt>{},
  }) =>
      TimelineFeedInput(
        snapshot: snapshot,
        now: now,
        communications: <AccidentCommunication>[email, note, undated],
        evidence: <AccidentEvidenceRow>[
          AccidentEvidenceRow(
            id: 'e1',
            verificationStatus: 'verified',
            kind: 'document',
            workstreamKey: 'insurance',
            uploadedAt: DateTime.utc(2026, 9, 13, 7),
          ),
          AccidentEvidenceRow(
            id: 'e2',
            verificationStatus: 'unverified',
            kind: 'document',
            workstreamKey: 'insurance',
            uploadedAt: DateTime.utc(2026, 9, 13, 7, 30),
          ),
        ],
        slas: <AccidentSlaRow>[running, met],
        dispatch: dispatch,
        deliveries: deliveries,
        gps: '24.71000, 46.67000',
      );

  test('feed is newest first, drops undated rows, keeps recorded facts', () {
    final List<TimelineEntry> rows = buildTimelineFeed(input());
    expect(rows.map((TimelineEntry r) => r.id).toList(), <String>[
      'dispatch:d1',
      'comm:c2',
      'comm:c1',
      'evidence:insurance',
      'workstream:fleet_validation',
      'sla:s2',
      'reported:a1',
    ]);
    for (int i = 1; i < rows.length; i++) {
      expect(rows[i - 1].at.isAfter(rows[i].at), isTrue);
    }
    final TimelineEntry reported = rows.last;
    expect(reported.actor, 'Recorded reporter');
    expect(reported.details, contains('GPS 24.71000, 46.67000'));
    expect(reported.details, contains('3 photos attached'));
  });

  test('the dispatch row carries the transit timer and the SLA warning', () {
    final TimelineEntry row = buildTimelineFeed(input()).first;
    expect(row.status, TimelineStatus.inTransit);
    expect(row.details, contains('Transit timer running'));
    expect(row.details, contains('2 photos attached'));
    expect(row.warnings, contains('Vendor SLA not started'));
    expect(row.elapsed, const Duration(hours: 1, minutes: 8));
  });

  test('Delivered n/n appears only with a per-recipient receipt', () {
    final TimelineEntry sent = buildTimelineFeed(input())
        .firstWhere((TimelineEntry r) => r.id == 'comm:c1');
    expect(sent.details, contains('Sent'));
    expect(sent.details, contains('2 recipients'));
    expect(sent.details.any((String d) => d.startsWith('Delivered')), isFalse);

    final TimelineEntry delivered = buildTimelineFeed(
      input(
        deliveries: <String, DeliveryReceipt>{
          'c1': const DeliveryReceipt(delivered: 2, total: 2),
        },
      ),
    ).firstWhere((TimelineEntry r) => r.id == 'comm:c1');
    expect(delivered.details, contains('Delivered 2/2'));
  });

  test('evidence groups verified n/n and SLA met badges attach by workstream',
      () {
    final List<TimelineEntry> rows = buildTimelineFeed(input());
    final TimelineEntry evidence =
        rows.firstWhere((TimelineEntry r) => r.id == 'evidence:insurance');
    expect(evidence.category, TimelineCategory.documents);
    expect(evidence.details, contains('Verified 1/2'));
    expect(evidence.status, TimelineStatus.pending);
    final TimelineEntry fleet = rows
        .firstWhere((TimelineEntry r) => r.id == 'workstream:fleet_validation');
    expect(fleet.slaMet, isTrue);
    expect(fleet.status, TimelineStatus.completed);
  });

  test('filters map onto the five chips', () {
    final List<TimelineEntry> rows = buildTimelineFeed(input());
    expect(filterTimeline(rows, 'all').length, rows.length);
    expect(
      filterTimeline(rows, 'emails').map((TimelineEntry r) => r.id),
      <String>['comm:c1'],
    );
    expect(
      filterTimeline(rows, 'sla').map((TimelineEntry r) => r.id),
      <String>['sla:s2'],
    );
    expect(
      filterTimeline(rows, 'documents').map((TimelineEntry r) => r.id),
      <String>['evidence:insurance'],
    );
    expect(filterTimeline(rows, 'actions').length, 4);
  });

  test('delivery log is honest about status', () {
    final List<DeliveryLogRow> log = buildDeliveryLog(input());
    expect(log.length, 2);
    final DeliveryLogRow scheduled = log.first;
    expect(scheduled.status, 'Scheduled in 30m');
    expect(scheduled.channel, 'Email + in-app');
    expect(scheduled.trigger, 'SLA warning: Vendor receipt');
    final DeliveryLogRow sent = log.last;
    expect(sent.status, 'Sent');
    expect(sent.recipientCount, 2);
    expect(sent.channel, 'Email');
    final List<DeliveryLogRow> withReceipt = buildDeliveryLog(
      input(
        deliveries: <String, DeliveryReceipt>{
          'c1': const DeliveryReceipt(delivered: 1, total: 2),
        },
      ),
    );
    expect(withReceipt.last.status, 'Delivered 1/2');
  });

  test('header chips derive from recorded times only', () {
    expect(
      caseOpenAge(snapshot.accident, now),
      const Duration(days: 4, hours: 6),
    );
    expect(nextSla(<AccidentSlaRow>[running, met], now)?.id, 's1');
    expect(dueInLabel(running, now), '52m');
    expect(dueInLabel(null, now), isNull);
    expect(currentOwner(snapshot), 'External workshop');
    expect(
      caseOpenAge(
        const AccidentRecord(
          id: 'x',
          assetNo: 'x',
          site: 'x',
          incidentDate: 'not a date',
        ),
        now,
      ),
      isNull,
    );
  });

  test('participants list roles, never invented people', () {
    final List<(String, String)> rows = participantRows(snapshot);
    expect(rows.first, ('Fleet validation', 'Fleet'));
    expect(
      rows.any((r) => r.$1 == 'Insurance' && r.$2 == 'Insurance Officer'),
      isTrue,
    );
  });

  test('fromRow readers cope with jsonb and strings', () {
    final AccidentCommunication c =
        AccidentCommunication.fromRow(<String, Object?>{
      'id': 'c9',
      'channel': 'in_app',
      'direction': 'outbound',
      'occurred_at': '2026-09-16T10:00:00Z',
      'attachments': <Object?>['a', 'b'],
      'to_party': 'Fleet; Workshop',
    });
    expect(c.attachmentCount, 2);
    expect(c.isNotification, isTrue);
    final AccidentSlaRow s = AccidentSlaRow.fromRow(<String, Object?>{
      'id': 's9',
      'state': 'breached',
      'due_at': '2026-09-16T10:00:00Z',
    });
    expect(s.state, 'breached');
    expect(s.toSnapshot().dueAt, DateTime.utc(2026, 9, 16, 10));
  });
}
