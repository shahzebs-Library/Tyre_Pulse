/// Pure feed builder for the M1 "Case timeline & notifications" workspace.
///
/// Merges four live ledgers (the accident row + workstreams, case
/// communications, evidence, SLA instances) and the dispatch leg into ONE
/// ordered feed, plus the notification delivery log. No I/O, no locale.
///
/// # Honesty rules this file enforces
///
/// - A row's time is the time the ledger recorded. An undated ledger row is
///   dropped, never stamped with "now" or the incident date.
/// - "Delivered n/n" appears ONLY when a per-recipient delivery record was
///   supplied for that communication. The `accident_case_communications`
///   table records that an email was SENT; it does not know whether it
///   arrived. Without a receipt the status is Sent (email), Logged (note,
///   in-app, call) or "Scheduled in x" (a future SLA warning).
/// - "SLA met" is a badge, and it is attached only when an SLA instance for
///   the same workstream is in state `met`.
library;

import 'package:flutter/foundation.dart' show immutable;
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_handover_gating.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

/// One `accident_case_communications` row.
@immutable
final class AccidentCommunication {
  const AccidentCommunication({
    required this.id,
    required this.channel,
    required this.direction,
    required this.occurredAt,
    this.subject,
    this.body,
    this.fromParty,
    this.toParty,
    this.externalPartyType,
    this.authorName,
    this.workstreamKey,
    this.attachmentCount = 0,
  });

  factory AccidentCommunication.fromRow(Map<String, Object?> row) {
    final Object? attachments = row['attachments'];
    return AccidentCommunication(
      id: _text(row['id']) ?? '',
      channel: _text(row['channel']) ?? 'comment',
      direction: _text(row['direction']) ?? 'internal',
      occurredAt: _time(row['occurred_at']) ?? _time(row['created_at']),
      subject: _text(row['subject']),
      body: _text(row['body']),
      fromParty: _text(row['from_party']),
      toParty: _text(row['to_party']),
      externalPartyType: _text(row['external_party_type']),
      authorName: _text(row['author_name']),
      workstreamKey: _text(row['workstream_key']),
      attachmentCount: attachments is List<Object?> ? attachments.length : 0,
    );
  }

  final String id;

  /// in_app | email_out | email_in | comment | call | external_portal
  final String channel;

  /// outbound | inbound | internal
  final String direction;
  final DateTime? occurredAt;
  final String? subject;
  final String? body;
  final String? fromParty;
  final String? toParty;
  final String? externalPartyType;
  final String? authorName;
  final String? workstreamKey;
  final int attachmentCount;

  bool get isEmail => channel == 'email_out' || channel == 'email_in';
  bool get isNotification => channel == 'in_app' || channel == 'email_out';
}

/// One `accident_evidence` row, narrowed to counting and verification.
@immutable
final class AccidentEvidenceRow {
  const AccidentEvidenceRow({
    required this.id,
    required this.verificationStatus,
    this.requirementKey,
    this.kind = 'document',
    this.workstreamKey,
    this.fileName,
    this.uploadedAt,
    this.mandatory = false,
  });

  factory AccidentEvidenceRow.fromRow(Map<String, Object?> row) =>
      AccidentEvidenceRow(
        id: _text(row['id']) ?? '',
        verificationStatus: _text(row['verification_status']) ?? 'unverified',
        requirementKey: _text(row['requirement_key']),
        kind: _text(row['kind']) ?? 'document',
        workstreamKey: _text(row['workstream_key']),
        fileName: _text(row['file_name']),
        uploadedAt: _time(row['uploaded_at']) ?? _time(row['created_at']),
        mandatory: row['mandatory'] == true,
      );

  final String id;

  /// unverified | verified | rejected
  final String verificationStatus;
  final String? requirementKey;
  final String kind;
  final String? workstreamKey;
  final String? fileName;
  final DateTime? uploadedAt;
  final bool mandatory;

  bool get isVerified => verificationStatus == 'verified';
  bool get isPhoto => kind == 'photo';
}

/// One `accident_sla_instances` row.
@immutable
final class AccidentSlaRow {
  const AccidentSlaRow({
    required this.id,
    required this.state,
    this.slaKey,
    this.name,
    this.workstreamKey,
    this.team,
    this.startAt,
    this.dueAt,
    this.warningAt,
    this.completedAt,
  });

  factory AccidentSlaRow.fromRow(Map<String, Object?> row) => AccidentSlaRow(
        id: _text(row['id']) ?? '',
        state: _text(row['state']) ?? 'running',
        slaKey: _text(row['sla_key']),
        name: _text(row['name']),
        workstreamKey: _text(row['workstream_key']),
        team: _text(row['team']),
        startAt: _time(row['start_at']),
        dueAt: _time(row['due_at']),
        warningAt: _time(row['warning_at']),
        completedAt: _time(row['completed_at']),
      );

  final String id;

  /// running | paused | met | breached | cancelled
  final String state;
  final String? slaKey;
  final String? name;
  final String? workstreamKey;
  final String? team;
  final DateTime? startAt;
  final DateTime? dueAt;
  final DateTime? warningAt;
  final DateTime? completedAt;

  bool get isRunning => state == 'running';

  VendorSlaSnapshot toSnapshot() => VendorSlaSnapshot(
        state: state,
        name: name,
        dueAt: dueAt,
        startAt: startAt,
      );
}

/// A per-recipient delivery record for one communication. The live schema
/// has no table for this; a caller that obtains one from a provider hands it
/// in, and only then does the log print "Delivered n/n".
@immutable
final class DeliveryReceipt {
  const DeliveryReceipt({required this.delivered, required this.total});
  final int delivered;
  final int total;
}

enum TimelineCategory { actions, documents, sla, emails }

enum TimelineStatus { completed, inTransit, pending }

/// One row of the feed.
@immutable
final class TimelineEntry {
  const TimelineEntry({
    required this.id,
    required this.at,
    required this.title,
    required this.category,
    this.actor,
    this.audience,
    this.details = const <String>[],
    this.warnings = const <String>[],
    this.status,
    this.elapsed,
    this.slaMet = false,
    this.body,
  });

  final String id;
  final DateTime at;
  final String title;
  final TimelineCategory category;

  /// Rendered as "by `<actor>`".
  final String? actor;

  /// Rendered as "to `<audience>`".
  final String? audience;
  final List<String> details;

  /// Amber sub-details such as "Vendor SLA not started".
  final List<String> warnings;
  final TimelineStatus? status;
  final Duration? elapsed;
  final bool slaMet;

  /// Long text for the detail sheet only.
  final String? body;
}

/// One row of the notification delivery log table.
@immutable
final class DeliveryLogRow {
  const DeliveryLogRow({
    required this.id,
    required this.trigger,
    required this.recipients,
    required this.recipientCount,
    required this.channel,
    required this.status,
    this.at,
  });

  final String id;
  final String trigger;

  /// The recipient group or address as recorded.
  final String recipients;
  final int recipientCount;

  /// "Email", "In-app", "Email + in-app".
  final String channel;

  /// "Delivered n/n" only with a receipt; else "Sent", "Logged",
  /// "Scheduled in x".
  final String status;
  final DateTime? at;
}

/// Everything the feed is built from.
@immutable
final class TimelineFeedInput {
  const TimelineFeedInput({
    required this.snapshot,
    required this.now,
    this.communications = const <AccidentCommunication>[],
    this.evidence = const <AccidentEvidenceRow>[],
    this.slas = const <AccidentSlaRow>[],
    this.dispatch,
    this.deliveries = const <String, DeliveryReceipt>{},
    this.gps,
  });

  final AccidentCaseSnapshot snapshot;
  final DateTime now;
  final List<AccidentCommunication> communications;
  final List<AccidentEvidenceRow> evidence;
  final List<AccidentSlaRow> slas;
  final AccidentDispatch? dispatch;
  final Map<String, DeliveryReceipt> deliveries;

  /// "lat, lng" as recorded on `accidents.latitude/longitude`, or null.
  final String? gps;
}

/// Builds the merged feed, newest first.
List<TimelineEntry> buildTimelineFeed(TimelineFeedInput input) {
  final List<TimelineEntry> rows = <TimelineEntry>[];
  final AccidentRecord record = input.snapshot.accident;
  final Set<String> metWorkstreams = <String>{
    for (final AccidentSlaRow s in input.slas)
      if (s.state == 'met' && s.workstreamKey != null) s.workstreamKey!,
  };

  // 1. Accident reported.
  final DateTime? reportedAt =
      record.createdAt ?? DateTime.tryParse(record.incidentDate.trim());
  if (reportedAt != null) {
    final int photos = record.photos.length;
    rows.add(
      TimelineEntry(
        id: 'reported:${record.id}',
        at: reportedAt,
        title: 'Accident reported',
        category: TimelineCategory.actions,
        actor: record.reporterName,
        details: <String>[
          if (input.gps != null) 'GPS ${input.gps}',
          if (photos > 0) '$photos photos attached',
        ],
        status: TimelineStatus.completed,
        slaMet: metWorkstreams.contains('incident_evidence'),
      ),
    );
  }

  // 2. Evidence, grouped per workstream at the latest upload time.
  final Map<String, List<AccidentEvidenceRow>> byWorkstream =
      <String, List<AccidentEvidenceRow>>{};
  for (final AccidentEvidenceRow e in input.evidence) {
    if (e.uploadedAt == null) continue;
    byWorkstream
        .putIfAbsent(e.workstreamKey ?? '', () => <AccidentEvidenceRow>[])
        .add(e);
  }
  for (final MapEntry<String, List<AccidentEvidenceRow>> group
      in byWorkstream.entries) {
    final List<AccidentEvidenceRow> items = group.value;
    DateTime latest = items.first.uploadedAt!;
    for (final AccidentEvidenceRow e in items) {
      if (e.uploadedAt!.isAfter(latest)) latest = e.uploadedAt!;
    }
    final int verified =
        items.where((AccidentEvidenceRow e) => e.isVerified).length;
    final int photos = items.where((AccidentEvidenceRow e) => e.isPhoto).length;
    final int docs = items.length - photos;
    final String ws = group.key;
    rows.add(
      TimelineEntry(
        id: 'evidence:$ws',
        at: latest,
        title: docs > 0 && photos == 0
            ? 'Documents uploaded'
            : photos > 0 && docs == 0
                ? 'Photos uploaded'
                : 'Evidence uploaded',
        category: TimelineCategory.documents,
        audience: ws.isEmpty ? null : _workstreamName(ws),
        details: <String>[
          if (photos > 0) '$photos photos attached',
          if (docs > 0) '$docs documents',
          'Verified $verified/${items.length}',
        ],
        status: verified == items.length
            ? TimelineStatus.completed
            : TimelineStatus.pending,
        slaMet: ws.isNotEmpty && metWorkstreams.contains(ws),
      ),
    );
  }

  // 3. Workstream updates with a recorded time.
  for (final AccidentWorkstream w in input.snapshot.workstreams) {
    final DateTime? at = w.updatedAt;
    if (at == null) continue;
    final String owner = _owner(w) ?? '';
    rows.add(
      TimelineEntry(
        id: 'workstream:${w.key}',
        at: at,
        title: _workstreamName(w.key),
        category: TimelineCategory.actions,
        actor: owner.isEmpty ? null : owner,
        details: <String>[
          if (w.notes?.trim().isNotEmpty == true) w.notes!.trim(),
          if (w.naReason?.trim().isNotEmpty == true) w.naReason!.trim(),
        ],
        status: switch (w.chip) {
          AccidentWorkstreamChip.done => TimelineStatus.completed,
          AccidentWorkstreamChip.inProgress => TimelineStatus.pending,
          AccidentWorkstreamChip.pending => TimelineStatus.pending,
          AccidentWorkstreamChip.notRequired => TimelineStatus.completed,
        },
        slaMet: metWorkstreams.contains(w.key),
      ),
    );
  }

  // 4. Communications.
  for (final AccidentCommunication c in input.communications) {
    final DateTime? at = c.occurredAt;
    if (at == null) continue;
    final DeliveryReceipt? receipt = input.deliveries[c.id];
    final int recipients = _recipientCount(c.toParty);
    rows.add(
      TimelineEntry(
        id: 'comm:${c.id}',
        at: at,
        title: c.subject ??
            switch (c.channel) {
              'email_out' => 'Email sent',
              'email_in' => 'Email received',
              'in_app' => 'Notification sent',
              'call' => 'Call logged',
              'external_portal' => 'Portal update',
              _ => 'Timeline note',
            },
        category: c.isEmail || c.channel == 'in_app'
            ? TimelineCategory.emails
            : TimelineCategory.actions,
        actor: c.direction == 'inbound'
            ? c.fromParty
            : (c.authorName ?? c.fromParty),
        audience: c.direction == 'outbound' ? c.toParty : null,
        details: <String>[
          if (recipients > 1) '$recipients recipients',
          if (receipt != null)
            'Delivered ${receipt.delivered}/${receipt.total}'
          else if (c.channel == 'email_out')
            'Sent'
          else if (c.channel == 'in_app')
            'Logged',
          if (c.attachmentCount > 0) '${c.attachmentCount} attachments',
        ],
        status: TimelineStatus.completed,
        body: c.body,
        slaMet:
            c.workstreamKey != null && metWorkstreams.contains(c.workstreamKey),
      ),
    );
  }

  // 5. Dispatch leg.
  final AccidentDispatch? d = input.dispatch;
  if (d != null) {
    final DateTime? departed = d.departureAt;
    if (departed != null && d.liveStatus != 'preparing') {
      final bool running = transitTimerRunning(d);
      rows.add(
        TimelineEntry(
          id: 'dispatch:${d.id}',
          at: departed,
          title: 'Vehicle dispatched to workshop',
          category: TimelineCategory.actions,
          actor: d.sentByName,
          audience: d.destination,
          details: <String>[
            if (d.outgoingPhotos.isNotEmpty)
              '${d.outgoingPhotos.length} photos attached',
            if (running) 'Transit timer running',
          ],
          warnings: <String>[
            if (!d.custodyAccepted) 'Vendor SLA not started',
          ],
          status: running ? TimelineStatus.inTransit : TimelineStatus.completed,
          elapsed: transitElapsed(d, input.now),
        ),
      );
    }
    final DateTime? accepted = d.acceptedAt;
    if (d.custodyAccepted && accepted != null) {
      rows.add(
        TimelineEntry(
          id: 'accepted:${d.id}',
          at: accepted,
          title: 'Vehicle acceptance signed',
          category: TimelineCategory.documents,
          actor: d.receivedByName,
          details: <String>[
            if (d.receivingPhotos.isNotEmpty)
              '${d.receivingPhotos.length} photos attached',
            if (d.handoverPaperRef != null) 'Signed handover paper',
          ],
          status: TimelineStatus.completed,
          slaMet: metWorkstreams.contains('handover'),
        ),
      );
    }
  }

  // 6. SLA outcomes (met / breached) as their own rows.
  for (final AccidentSlaRow s in input.slas) {
    final DateTime? at =
        s.completedAt ?? (s.state == 'breached' ? s.dueAt : null);
    if (at == null || (s.state != 'met' && s.state != 'breached')) continue;
    rows.add(
      TimelineEntry(
        id: 'sla:${s.id}',
        at: at,
        title: s.state == 'met' ? 'SLA met' : 'SLA breached',
        category: TimelineCategory.sla,
        audience: s.team ??
            (s.workstreamKey == null
                ? null
                : _workstreamName(s.workstreamKey!)),
        details: <String>[if (s.name != null) s.name!],
        status: TimelineStatus.completed,
        elapsed: s.startAt == null ? null : at.difference(s.startAt!),
        slaMet: s.state == 'met',
      ),
    );
  }

  rows.sort((TimelineEntry a, TimelineEntry b) => b.at.compareTo(a.at));
  return List<TimelineEntry>.unmodifiable(rows);
}

/// Applies one of [timelineFilters].
List<TimelineEntry> filterTimeline(List<TimelineEntry> rows, String filter) {
  if (filter == 'all') return rows;
  final TimelineCategory? category = switch (filter) {
    'actions' => TimelineCategory.actions,
    'documents' => TimelineCategory.documents,
    'sla' => TimelineCategory.sla,
    'emails' => TimelineCategory.emails,
    _ => null,
  };
  if (category == null) return rows;
  return List<TimelineEntry>.unmodifiable(
    rows.where((TimelineEntry r) => r.category == category),
  );
}

/// The notification delivery log: every outbound in-app/email communication
/// plus every SLA warning still in the future, newest first.
List<DeliveryLogRow> buildDeliveryLog(TimelineFeedInput input) {
  final List<DeliveryLogRow> rows = <DeliveryLogRow>[];
  for (final AccidentCommunication c in input.communications) {
    if (!c.isNotification || c.direction == 'inbound') continue;
    final DeliveryReceipt? receipt = input.deliveries[c.id];
    rows.add(
      DeliveryLogRow(
        id: c.id,
        trigger:
            c.subject ?? (c.channel == 'email_out' ? 'Email' : 'Notification'),
        recipients: c.toParty ?? '',
        recipientCount: _recipientCount(c.toParty),
        channel: c.channel == 'email_out' ? 'Email' : 'In-app',
        status: receipt != null
            ? 'Delivered ${receipt.delivered}/${receipt.total}'
            : c.channel == 'email_out'
                ? 'Sent'
                : 'Logged',
        at: c.occurredAt,
      ),
    );
  }
  for (final AccidentSlaRow s in input.slas) {
    final DateTime? warn = s.warningAt;
    if (!s.isRunning || warn == null || !warn.isAfter(input.now)) continue;
    rows.add(
      DeliveryLogRow(
        id: 'sla-warning:${s.id}',
        trigger: 'SLA warning: ${s.name ?? s.slaKey ?? ''}'.trim(),
        recipients: s.team ?? '',
        recipientCount: s.team == null ? 0 : 1,
        channel: 'Email + in-app',
        status: 'Scheduled in ${formatElapsed(warn.difference(input.now))}',
        at: warn,
      ),
    );
  }
  rows.sort((DeliveryLogRow a, DeliveryLogRow b) {
    final DateTime? x = a.at;
    final DateTime? y = b.at;
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return y.compareTo(x);
  });
  return List<DeliveryLogRow>.unmodifiable(rows);
}

/// Header chip: how long the case has been open. Null when no open time is
/// recorded; zero-length when the case is closed with a recorded release.
Duration? caseOpenAge(AccidentRecord record, DateTime now) {
  final DateTime? opened =
      record.createdAt ?? DateTime.tryParse(record.incidentDate.trim());
  if (opened == null) return null;
  final String status = record.displayStatus.toLowerCase();
  final DateTime? closedAt =
      status.contains('closed') && record.releaseDate != null
          ? DateTime.tryParse(record.releaseDate!.trim())
          : null;
  final Duration age = (closedAt ?? now).difference(opened);
  return age.isNegative ? Duration.zero : age;
}

/// Header chip: the SLA instance due soonest among the running ones.
AccidentSlaRow? nextSla(List<AccidentSlaRow> slas, DateTime now) {
  AccidentSlaRow? best;
  for (final AccidentSlaRow s in slas) {
    if (!s.isRunning || s.dueAt == null) continue;
    if (best == null || s.dueAt!.isBefore(best.dueAt!)) best = s;
  }
  return best;
}

/// "52m", or "Overdue 1h 05m" once passed. Null without a due time.
String? dueInLabel(AccidentSlaRow? sla, DateTime now) {
  final DateTime? due = sla?.dueAt;
  if (due == null) return null;
  final Duration left = due.difference(now);
  return left.isNegative
      ? 'Overdue ${formatElapsed(-left)}'
      : formatElapsed(left);
}

/// The team (then owner role) of the first in-progress workstream.
String? currentOwner(AccidentCaseSnapshot snapshot) {
  AccidentWorkstream? active;
  for (final AccidentWorkstream w in snapshot.workstreams) {
    if (w.chip == AccidentWorkstreamChip.inProgress) {
      active = w;
      break;
    }
  }
  active ??= snapshot.workstreams
      .where((AccidentWorkstream w) => w.chip == AccidentWorkstreamChip.pending)
      .firstOrNull;
  return _owner(active);
}

/// Participants: every distinct team / owner role recorded on the case,
/// plus every notify role from the vocabulary (roles, never people).
List<(String, String)> participantRows(AccidentCaseSnapshot snapshot) {
  final List<(String, String)> rows = <(String, String)>[];
  for (final AccidentWorkstream w in snapshot.workstreams) {
    final String? owner = _owner(w);
    if (owner != null) rows.add((_workstreamName(w.key), owner));
  }
  for (final NotifyRole r in notifyRoles) {
    rows.add((r.label, r.roles.join(', ')));
  }
  return List<(String, String)>.unmodifiable(rows);
}

String _workstreamName(String key) {
  final NumberedStep? step = caseFlowStep(key);
  if (step != null) return step.label;
  return humaniseAccidentToken(key);
}

String? _owner(AccidentWorkstream? w) {
  if (w == null) return null;
  final String text = <String?>[w.team, w.ownerRole]
      .whereType<String>()
      .map((String v) => v.trim())
      .where((String v) => v.isNotEmpty)
      .join(' / ');
  return text.isEmpty ? null : text;
}

int _recipientCount(String? toParty) {
  final String t = toParty?.trim() ?? '';
  if (t.isEmpty) return 0;
  return t
      .split(RegExp(r'[,;]'))
      .where((String p) => p.trim().isNotEmpty)
      .length;
}

String? _text(Object? value) {
  final String s = value?.toString().trim() ?? '';
  return s.isEmpty ? null : s;
}

DateTime? _time(Object? value) {
  if (value is DateTime) return value;
  if (value is String && value.trim().isNotEmpty) {
    return DateTime.tryParse(value.trim());
  }
  return null;
}
