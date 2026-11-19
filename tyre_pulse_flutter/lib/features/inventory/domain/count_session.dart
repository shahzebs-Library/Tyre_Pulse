/// A counter's in-progress work on one audit, and the rules that govern it.
///
/// Pure and immutable: every change returns a new [CountSession], which the
/// draft store persists after each step, so a phone that dies, is closed or
/// loses signal mid-count resumes exactly where it stopped.
///
/// Rules (docs/inventory/07, inventory_count_lines):
/// - a location must be scanned before anything is counted there;
/// - a serial-tracked code can be counted once per audit: a second scan of
///   the same serial anywhere is refused, never silently doubled;
/// - a bulk item scanned again at the same location reopens its line rather
///   than creating a second one;
/// - a code not in the location's prompts is kept as an UNEXPECTED line,
///   never dropped;
/// - zero is only a count when the counter explicitly confirms it, so an
///   untouched line cannot be mistaken for "counted, none found";
/// - every line carries a stable `client_uuid` and the moment it was counted,
///   so a late (offline) submission is reconciled by the server against the
///   audit cutoff instead of by arrival time.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/inventory_scan.dart';

@immutable
final class CountLine {
  const CountLine({
    required this.clientUuid,
    required this.locationId,
    required this.scannedCode,
    required this.countedAt,
    this.itemId,
    this.serialNo,
    this.countedQty,
    this.confirmedZero = false,
    this.condition = CountCondition.good,
    this.photoPaths = const <String>[],
    this.photoRefs = const <String>[],
    this.remarks,
    this.unexpected = false,
    this.round = 1,
    this.state = CountLineState.draft,
    this.rejectReason,
  });

  factory CountLine.fromJson(Map<String, Object?> json) {
    List<String> strings(Object? v) => <String>[
          if (v is List)
            for (final Object? s in v)
              if (s != null && '$s'.isNotEmpty) '$s',
        ];
    return CountLine(
      clientUuid: '${json['client_uuid']}',
      locationId: '${json['location_id']}',
      scannedCode: '${json['scanned_code'] ?? ''}',
      countedAt: DateTime.tryParse('${json['counted_at']}')?.toUtc() ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      itemId: json['item_id'] as String?,
      serialNo: json['serial_no'] as String?,
      countedQty: json['counted_qty'] as num?,
      confirmedZero: json['confirmed_zero'] == true,
      condition: CountCondition.fromWire(json['condition'] as String?),
      photoPaths: strings(json['photo_paths']),
      photoRefs: strings(json['photo_refs']),
      remarks: json['remarks'] as String?,
      unexpected: json['unexpected'] == true,
      round: (json['round'] as num?)?.toInt() ?? 1,
      state: CountLineState.values.firstWhere(
        (CountLineState s) => s.name == json['state'],
        orElse: () => CountLineState.draft,
      ),
      rejectReason: json['reject_reason'] as String?,
    );
  }

  final String clientUuid;
  final String locationId;
  final String scannedCode;
  final DateTime countedAt;
  final String? itemId;
  final String? serialNo;
  final num? countedQty;
  final bool confirmedZero;
  final CountCondition condition;

  /// Compressed photos on this device, not yet uploaded.
  final List<String> photoPaths;

  /// `tp-storage://` references of photos already uploaded.
  final List<String> photoRefs;
  final String? remarks;
  final bool unexpected;
  final int round;
  final CountLineState state;
  final String? rejectReason;

  bool get isSerial => serialNo != null;

  /// A line is complete when it carries a positive count, or zero that the
  /// counter explicitly confirmed.
  bool get isComplete =>
      (countedQty != null && countedQty! > 0) ||
      (confirmedZero && (countedQty == null || countedQty == 0));

  CountLine copyWith({
    String? itemId,
    num? countedQty,
    bool clearQty = false,
    bool? confirmedZero,
    CountCondition? condition,
    List<String>? photoPaths,
    List<String>? photoRefs,
    String? remarks,
    DateTime? countedAt,
    CountLineState? state,
    String? rejectReason,
    bool clearReject = false,
  }) =>
      CountLine(
        clientUuid: clientUuid,
        locationId: locationId,
        scannedCode: scannedCode,
        countedAt: countedAt ?? this.countedAt,
        itemId: itemId ?? this.itemId,
        serialNo: serialNo,
        countedQty: clearQty ? null : (countedQty ?? this.countedQty),
        confirmedZero: confirmedZero ?? this.confirmedZero,
        condition: condition ?? this.condition,
        photoPaths: photoPaths ?? this.photoPaths,
        photoRefs: photoRefs ?? this.photoRefs,
        remarks: remarks ?? this.remarks,
        unexpected: unexpected,
        round: round,
        state: state ?? this.state,
        rejectReason: clearReject ? null : (rejectReason ?? this.rejectReason),
      );

  /// Local persistence shape (includes device-only fields).
  Map<String, Object?> toJson() => <String, Object?>{
        'client_uuid': clientUuid,
        'location_id': locationId,
        'scanned_code': scannedCode,
        'counted_at': countedAt.toUtc().toIso8601String(),
        'item_id': itemId,
        'serial_no': serialNo,
        'counted_qty': countedQty,
        'confirmed_zero': confirmedZero,
        'condition': condition.wire,
        'photo_paths': photoPaths,
        'photo_refs': photoRefs,
        'remarks': remarks,
        'unexpected': unexpected,
        'round': round,
        'state': state.name,
        'reject_reason': rejectReason,
      };

  /// The `inv_count_submit` line. Never includes an expected quantity, local
  /// file paths or device-only state.
  Map<String, Object?> toSubmitJson() => <String, Object?>{
        'client_uuid': clientUuid,
        'location_id': locationId,
        'item_id': itemId,
        'serial_no': serialNo,
        'scanned_code': scannedCode,
        'counted_qty': confirmedZero ? 0 : countedQty,
        'confirmed_zero': confirmedZero,
        'condition': condition.wire,
        'photos': photoRefs,
        'remarks': (remarks ?? '').trim().isEmpty ? null : remarks!.trim(),
        'unexpected': unexpected,
        'counted_at': countedAt.toUtc().toIso8601String(),
        'round': round,
      };
}

/// The outcome of a scan inside a session.
enum ScanOutcome {
  /// A location label: it is now the active location.
  locationSelected,

  /// A serial-tracked item was selected; the next scans are its units.
  serialItemSelected,

  /// A location label that is not in this audit's scope.
  locationOutOfScope,

  /// A new line was created.
  lineAdded,

  /// The code was already counted at this location; that line is reopened.
  lineReopened,

  /// A serial already counted in this audit. Refused.
  duplicateSerial,

  /// An item code scanned before any location.
  needsLocation,

  /// The identical code arrived again within the debounce window (wedge
  /// scanners and camera frames repeat). Ignored.
  ignoredRepeat,

  /// Nothing usable in the payload.
  empty,
}

@immutable
final class ScanResult {
  const ScanResult(this.session, this.outcome, {this.line});
  final CountSession session;
  final ScanOutcome outcome;
  final CountLine? line;
}

@immutable
final class CountSession {
  const CountSession({
    required this.auditId,
    required this.userId,
    required this.startedAt,
    this.activeLocationId,
    this.activeSerialItemId,
    this.lines = const <CountLine>[],
    this.lastScanKey,
    this.lastScanAt,
  });

  factory CountSession.fromJson(Map<String, Object?> json) => CountSession(
        auditId: '${json['audit_id']}',
        userId: '${json['user_id']}',
        startedAt: DateTime.tryParse('${json['started_at']}')?.toUtc() ??
            DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        activeLocationId: json['active_location_id'] as String?,
        activeSerialItemId: json['active_serial_item_id'] as String?,
        lines: <CountLine>[
          if (json['lines'] is List)
            for (final Object? line in json['lines']! as List<Object?>)
              if (line is Map)
                CountLine.fromJson(Map<String, Object?>.from(line)),
        ],
      );

  /// Repeat window for an identical scan.
  static const Duration repeatWindow = Duration(milliseconds: 1500);

  final String auditId;
  final String userId;
  final DateTime startedAt;
  final String? activeLocationId;

  /// The serial-tracked item the counter is currently scanning units of. Set
  /// by scanning (or picking) a serial-tracked item at the active location;
  /// cleared by a location change. While set, a code that is not another
  /// item code of this location is that item's serial.
  final String? activeSerialItemId;
  final List<CountLine> lines;
  final String? lastScanKey;
  final DateTime? lastScanAt;

  Map<String, Object?> toJson() => <String, Object?>{
        'audit_id': auditId,
        'user_id': userId,
        'started_at': startedAt.toUtc().toIso8601String(),
        'active_location_id': activeLocationId,
        'active_serial_item_id': activeSerialItemId,
        'lines': <Map<String, Object?>>[
          for (final CountLine l in lines) l.toJson(),
        ],
      };

  CountSession _copy({
    String? activeLocationId,
    String? activeSerialItemId,
    bool clearSerialItem = false,
    List<CountLine>? lines,
    String? lastScanKey,
    DateTime? lastScanAt,
  }) =>
      CountSession(
        auditId: auditId,
        userId: userId,
        startedAt: startedAt,
        activeLocationId: activeLocationId ?? this.activeLocationId,
        activeSerialItemId: clearSerialItem
            ? null
            : (activeSerialItemId ?? this.activeSerialItemId),
        lines: lines ?? this.lines,
        lastScanKey: lastScanKey ?? this.lastScanKey,
        lastScanAt: lastScanAt ?? this.lastScanAt,
      );

  /// Lines on this device not yet accepted by the server.
  List<CountLine> get pending => lines
      .where((CountLine l) => l.state != CountLineState.submitted)
      .toList(growable: false);

  /// Draft lines ready to send (complete).
  List<CountLine> get submittable => lines
      .where(
        (CountLine l) => l.state == CountLineState.draft && l.isComplete,
      )
      .toList(growable: false);

  List<CountLine> linesAt(String locationId) => lines
      .where((CountLine l) => l.locationId == locationId)
      .toList(growable: false);

  /// Locations with at least one complete line.
  Set<String> get countedLocationIds => <String>{
        for (final CountLine l in lines)
          if (l.isComplete) l.locationId,
      };

  CountSession selectLocation(String locationId) =>
      locationId == activeLocationId
          ? this
          : _copy(activeLocationId: locationId, clearSerialItem: true);

  /// Stops scanning serials for the active serial-tracked item.
  CountSession clearSerialItem() => _copy(clearSerialItem: true);

  /// Applies a scan. [newId] mints the line's `client_uuid`; [now] is the
  /// counting moment (injected so tests are deterministic).
  ScanResult applyScan({
    required String raw,
    required AuditCounterView view,
    required String Function() newId,
    required DateTime now,
  }) {
    final InventoryScan? scan = parseInventoryScan(raw);
    if (scan == null) return ScanResult(this, ScanOutcome.empty);
    final String key = '${scan.kind.name}:${scanIdentityKey(scan.value)}';
    if (key == lastScanKey &&
        lastScanAt != null &&
        now.difference(lastScanAt!).abs() < repeatWindow) {
      return ScanResult(this, ScanOutcome.ignoredRepeat);
    }
    final CountSession stamped = _copy(lastScanKey: key, lastScanAt: now);

    if (scan.kind == InventoryScanKind.location) {
      final AuditLocation? location = view.locationById(scan.value);
      if (location == null) {
        return ScanResult(stamped, ScanOutcome.locationOutOfScope);
      }
      return ScanResult(
        stamped.selectLocation(location.id),
        ScanOutcome.locationSelected,
      );
    }

    final String? locationId = activeLocationId;
    if (locationId == null) {
      return ScanResult(stamped, ScanOutcome.needsLocation);
    }

    final String code = normaliseScannedText(scan.value);
    final String identity = scanIdentityKey(code);
    final AuditItemPrompt? prompt =
        _matchPrompt(view, locationId, scan, identity);

    // Scanning a serial-tracked item's own code selects it: the next scans
    // are its units.
    if (prompt != null && prompt.serialTracked) {
      return ScanResult(
        stamped._copy(activeSerialItemId: prompt.itemId),
        ScanOutcome.serialItemSelected,
      );
    }

    // A code that is not an item code, while a serial-tracked item is
    // selected, is one unit of that item. A unit is counted once per audit.
    if (prompt == null && activeSerialItemId != null) {
      for (final CountLine l in lines) {
        if (l.serialNo != null && scanIdentityKey(l.serialNo!) == identity) {
          return ScanResult(stamped, ScanOutcome.duplicateSerial, line: l);
        }
      }
      final CountLine line = CountLine(
        clientUuid: newId(),
        locationId: locationId,
        scannedCode: code,
        countedAt: now.toUtc(),
        itemId: activeSerialItemId,
        serialNo: code,
        countedQty: 1,
      );
      return ScanResult(
        stamped._copy(lines: <CountLine>[...lines, line]),
        ScanOutcome.lineAdded,
        line: line,
      );
    }

    // Bulk: one line per item per location. A repeat scan reopens it. A code
    // matching no prompt is an UNEXPECTED line the counter quantifies; it is
    // never dropped and never guessed to be a serial.
    for (final CountLine l in lines) {
      if (l.locationId == locationId &&
          l.serialNo == null &&
          ((prompt != null && l.itemId == prompt.itemId) ||
              scanIdentityKey(l.scannedCode) == identity)) {
        return ScanResult(stamped, ScanOutcome.lineReopened, line: l);
      }
    }
    final CountLine line = CountLine(
      clientUuid: newId(),
      locationId: locationId,
      scannedCode: code,
      countedAt: now.toUtc(),
      itemId: prompt?.itemId,
      unexpected: prompt == null,
    );
    return ScanResult(
      stamped._copy(lines: <CountLine>[...lines, line]),
      ScanOutcome.lineAdded,
      line: line,
    );
  }

  /// Picks a prompt from the list instead of scanning it. A serial-tracked
  /// prompt is selected for serial scanning; a bulk prompt opens its line.
  ScanResult pickPrompt({
    required AuditItemPrompt prompt,
    required String Function() newId,
    required DateTime now,
  }) {
    final CountSession here = selectLocation(prompt.locationId);
    if (prompt.serialTracked) {
      return ScanResult(
        here._copy(activeSerialItemId: prompt.itemId),
        ScanOutcome.serialItemSelected,
      );
    }
    for (final CountLine l in lines) {
      if (l.locationId == prompt.locationId &&
          l.serialNo == null &&
          l.itemId == prompt.itemId) {
        return ScanResult(here, ScanOutcome.lineReopened, line: l);
      }
    }
    final CountLine line = CountLine(
      clientUuid: newId(),
      locationId: prompt.locationId,
      scannedCode: prompt.itemCode ?? prompt.itemId,
      countedAt: now.toUtc(),
      itemId: prompt.itemId,
    );
    return ScanResult(
      here._copy(lines: <CountLine>[...lines, line]),
      ScanOutcome.lineAdded,
      line: line,
    );
  }

  /// Replaces a line. A submitted line is immutable on the phone: a change
  /// after acceptance is a recount the reviewer assigns, not an edit.
  CountSession updateLine(CountLine updated) => _copy(
        lines: <CountLine>[
          for (final CountLine l in lines)
            if (l.clientUuid == updated.clientUuid &&
                l.state != CountLineState.submitted)
              updated
            else
              l,
        ],
      );

  /// Removes an unsent line (a mis-scan). Submitted lines stay.
  CountSession removeLine(String clientUuid) => _copy(
        lines: <CountLine>[
          for (final CountLine l in lines)
            if (l.clientUuid != clientUuid ||
                l.state == CountLineState.submitted)
              l,
        ],
      );

  /// Applies the server's per-line answer.
  CountSession applySubmitResult(CountSubmitResult result) => _copy(
        lines: <CountLine>[
          for (final CountLine l in lines)
            if (result.accepted.contains(l.clientUuid))
              l.copyWith(state: CountLineState.submitted, clearReject: true)
            else if (result.rejected.containsKey(l.clientUuid))
              l.copyWith(
                state: CountLineState.rejected,
                rejectReason: result.rejected[l.clientUuid],
              )
            else
              l,
        ],
      );

  /// Marks lines the server already holds (from the counter view) as
  /// submitted, so a resumed draft never sends them twice.
  /// Returns the SAME instance when nothing changes, so a caller can compare
  /// by identity and avoid a write loop.
  CountSession reconcileWithServer(Set<String> serverClientUuids) => lines.any(
        (CountLine l) =>
            l.state != CountLineState.submitted &&
            serverClientUuids.contains(l.clientUuid),
      )
          ? applySubmitResult(CountSubmitResult(accepted: serverClientUuids))
          : this;

  AuditItemPrompt? _matchPrompt(
    AuditCounterView view,
    String locationId,
    InventoryScan scan,
    String identity,
  ) {
    for (final AuditItemPrompt p in view.promptsAt(locationId)) {
      if (scan.kind == InventoryScanKind.stockRow && p.itemId == scan.value) {
        return p;
      }
      if (p.itemCode != null && scanIdentityKey(p.itemCode!) == identity) {
        return p;
      }
    }
    return null;
  }
}

/// Progress of a counter through an audit. Counts locations and lines only:
/// it never reveals how many units are expected.
@immutable
final class CountProgress {
  const CountProgress({
    required this.locationsCounted,
    required this.locationsTotal,
    required this.linesComplete,
    required this.linesPending,
    required this.linesSubmitted,
    required this.unexpected,
  });

  factory CountProgress.of(CountSession session, AuditCounterView view) {
    final Set<String> scope = <String>{
      for (final AuditLocation l in view.locations) l.id,
    };
    return CountProgress(
      locationsCounted: session.countedLocationIds.where(scope.contains).length,
      locationsTotal: scope.length,
      linesComplete: session.lines.where((CountLine l) => l.isComplete).length,
      linesPending: session.pending.length,
      linesSubmitted: session.lines
          .where((CountLine l) => l.state == CountLineState.submitted)
          .length,
      unexpected: session.lines.where((CountLine l) => l.unexpected).length,
    );
  }

  final int locationsCounted;
  final int locationsTotal;
  final int linesComplete;
  final int linesPending;
  final int linesSubmitted;
  final int unexpected;

  /// 0..1, or null when the audit has no locations in scope (nothing to
  /// measure is not 0% done).
  double? get fraction =>
      locationsTotal == 0 ? null : locationsCounted / locationsTotal;
}

/// The server's per-line answer to `inv_count_submit`.
@immutable
final class CountSubmitResult {
  const CountSubmitResult({
    this.accepted = const <String>{},
    this.rejected = const <String, String>{},
  });

  /// Parses `{accepted:[uuid], duplicates:[uuid], rejected:[{client_uuid,
  /// reason}]}`. A duplicate is an idempotent replay of a line the server
  /// already holds, so it counts as accepted.
  factory CountSubmitResult.fromJson(Object? raw) {
    final Map<String, Object?> json =
        raw is Map ? Map<String, Object?>.from(raw) : <String, Object?>{};
    Set<String> ids(Object? v) => <String>{
          if (v is List)
            for (final Object? id in v)
              if (id != null && '$id'.isNotEmpty) '$id',
        };
    final Map<String, String> rejected = <String, String>{};
    final Object? r = json['rejected'];
    if (r is List) {
      for (final Object? row in r) {
        if (row is Map && row['client_uuid'] != null) {
          rejected['${row['client_uuid']}'] = '${row['reason'] ?? 'refused'}';
        }
      }
    }
    return CountSubmitResult(
      accepted: <String>{...ids(json['accepted']), ...ids(json['duplicates'])},
      rejected: rejected,
    );
  }

  final Set<String> accepted;
  final Map<String, String> rejected;
}
