/// Job completion - what a technician must hand over before a job can leave
/// their hands.
///
/// Pure Dart. The sheet (`workshop_completion_sheet.dart`) collects a
/// [WorkshopCompletionDraft]; [WorkshopCompletionDraft.missing] says what is
/// still required, and nothing is sent until that list is empty. The server
/// (`submit_job_completion`, migration 20261127150000) checks the same rules
/// again and moves the job to Quality Inspection for a SUPERVISOR - the
/// technician never closes their own job.
library;

/// Quick picks for "what was done". Stored as these tokens; the label comes
/// from the copy catalog (`qp_<token>`).
const List<String> kWorkshopQuickPicks = <String>[
  'replaced',
  'repaired',
  'adjusted',
  'inspected',
  'cleaned',
  'lubricated',
];

/// Photos per side, same ceiling as the other workshop evidence.
const int kWorkshopCompletionMaxPhotos = 3;

/// One part used on the job.
final class WorkshopPartUsed {
  const WorkshopPartUsed({
    required this.name,
    required this.qty,
    this.requestId,
  });

  final String name;
  final num qty;

  /// The `parts_requests.id` it came from, when picked from the job's own
  /// requests.
  final String? requestId;

  Map<String, Object?> toJson() => <String, Object?>{
        'name': name,
        'qty': qty,
        if (requestId != null) 'request_id': requestId,
      };
}

/// The things still missing before a completion may be sent. Each value is a
/// copy-catalog key (`need_<name>`).
enum WorkshopCompletionGap { workDone, afterPhoto, signature }

final class WorkshopCompletionDraft {
  const WorkshopCompletionDraft({
    this.workDone = '',
    this.quickPicks = const <String>{},
    this.parts = const <WorkshopPartUsed>[],
    this.beforePhotos = const <String>[],
    this.afterPhotos = const <String>[],
    this.km,
    this.engineHours,
    this.signature,
  });

  final String workDone;
  final Set<String> quickPicks;
  final List<WorkshopPartUsed> parts;

  /// Local paths until uploaded, then `tp-storage://` references.
  final List<String> beforePhotos;
  final List<String> afterPhotos;
  final num? km;
  final num? engineHours;

  /// `data:image/png;base64,...` from the signature pad.
  final String? signature;

  /// What the technician wrote, or - when only quick picks were tapped - a
  /// sentence built from them, so a pick alone still says what was done.
  String effectiveWorkDone(String Function(String token) label) {
    final String typed = workDone.trim();
    if (typed.isNotEmpty) return typed;
    return <String>[
      for (final String p in kWorkshopQuickPicks)
        if (quickPicks.contains(p)) label(p),
    ].join(', ');
  }

  List<WorkshopCompletionGap> missing(String Function(String token) label) =>
      <WorkshopCompletionGap>[
        if (effectiveWorkDone(label).trim().length < 3)
          WorkshopCompletionGap.workDone,
        if (afterPhotos.isEmpty) WorkshopCompletionGap.afterPhoto,
        if ((signature ?? '').length <= 30) WorkshopCompletionGap.signature,
      ];

  WorkshopCompletionDraft copyWith({
    String? workDone,
    Set<String>? quickPicks,
    List<WorkshopPartUsed>? parts,
    List<String>? beforePhotos,
    List<String>? afterPhotos,
    num? Function()? km,
    num? Function()? engineHours,
    String? Function()? signature,
  }) =>
      WorkshopCompletionDraft(
        workDone: workDone ?? this.workDone,
        quickPicks: quickPicks ?? this.quickPicks,
        parts: parts ?? this.parts,
        beforePhotos: beforePhotos ?? this.beforePhotos,
        afterPhotos: afterPhotos ?? this.afterPhotos,
        km: km == null ? this.km : km(),
        engineHours: engineHours == null ? this.engineHours : engineHours(),
        signature: signature == null ? this.signature : signature(),
      );
}

/// Parses a meter field: blank is "not read" (null), never zero; a negative
/// or unreadable value is null too.
num? parseWorkshopMeter(String raw) {
  final String t = raw.trim().replaceAll(',', '');
  if (t.isEmpty) return null;
  final num? v = num.tryParse(t);
  return v == null || !v.isFinite || v < 0 ? null : v;
}

/// Work-order statuses that mean "with the supervisor". Matches the canonical
/// web vocabulary (`src/lib/workOrderStatus.js`): Quality Inspection.
bool isWorkshopJobAwaitingQc(String? status, String? qcStatus) {
  final String s =
      (status ?? '').trim().toLowerCase().replaceAll(RegExp(r'[\s-]+'), '_');
  return s == 'quality_inspection' ||
      (qcStatus ?? '').trim().toLowerCase() == 'pending';
}

/// True when the supervisor sent the job back (web QC Fail -> qc_status
/// 'failed', status In Progress).
bool isWorkshopJobReturned(String? qcStatus) =>
    (qcStatus ?? '').trim().toLowerCase() == 'failed';
