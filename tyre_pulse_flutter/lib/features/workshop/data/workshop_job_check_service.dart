/// Supervisor side of job completion: the completions waiting to be checked
/// (and the returned ones the data desk reassigns), and the pass / return
/// decision through `decide_job_completion` (migration 20261127150000).
///
/// Online only by design: a decision closes or reopens a work order and the
/// server answers with "already decided by X" when two supervisors race, so
/// it must never be replayed from a queue. Reads go through RLS: a
/// supervisor sees completions on jobs they may quality-check, the data desk
/// (Data Monitor Officer, Tyre Data Collector) sees returned ones.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:uuid/uuid.dart';

/// `work_order_completions` is new with this feature and not yet in the
/// shared [SupabaseTables] registry (owned elsewhere).
const String kWorkOrderCompletionsTable = 'work_order_completions';

enum WorkshopCheckQueue { toCheck, returned }

/// One completion as the supervisor reads it.
final class WorkshopCheckItem {
  const WorkshopCheckItem({
    required this.id,
    required this.jobId,
    required this.status,
    required this.workDone,
    required this.completedAt,
    this.workOrderNo,
    this.assetNo,
    this.site,
    this.technicianName,
    this.kind = 'primary',
    this.quickPicks = const <String>[],
    this.parts = const <({String name, num qty})>[],
    this.beforePhotos = const <String>[],
    this.afterPhotos = const <String>[],
    this.km,
    this.engineHours,
    this.signature,
    this.meterHeld = const <String>[],
    this.decisionNote,
    this.decidedByName,
  });

  factory WorkshopCheckItem.fromRow(
    Map<String, dynamic> row, {
    Map<String, String> names = const <String, String>{},
  }) {
    final Object? wo = row['work_orders'];
    final Map<String, dynamic> job =
        wo is Map<String, dynamic> ? wo : const <String, dynamic>{};
    List<String> strings(Object? v) => v is List
        ? <String>[
            for (final Object? x in v)
              if (x is String && x.isNotEmpty) x,
          ]
        : const <String>[];
    return WorkshopCheckItem(
      id: row['id'] as String,
      jobId: row['job_id'] as String,
      status: (row['status'] as String?) ?? 'submitted',
      workDone: (row['work_done'] as String?) ?? '',
      completedAt:
          DateTime.tryParse((row['completed_at'] as String?) ?? '')?.toLocal(),
      workOrderNo: job['work_order_no'] as String?,
      assetNo: row['asset_no'] as String?,
      site: row['site'] as String?,
      technicianName: names[row['submitted_by']],
      kind: (row['kind'] as String?) ?? 'primary',
      quickPicks: strings(row['quick_picks']),
      parts: <({String name, num qty})>[
        if (row['parts_used'] is List)
          for (final Object? p in row['parts_used'] as List)
            if (p is Map && p['name'] is String)
              (
                name: p['name'] as String,
                qty: p['qty'] is num ? p['qty'] as num : 1,
              ),
      ],
      beforePhotos: strings(row['before_photos']),
      afterPhotos: strings(row['after_photos']),
      km: row['km'] is num ? row['km'] as num : null,
      engineHours:
          row['engine_hours'] is num ? row['engine_hours'] as num : null,
      signature: row['signature'] as String?,
      meterHeld: <String>[
        if (row['meter_held'] is Map)
          for (final String k in const <String>['km', 'hours'])
            if ((row['meter_held'] as Map)[k] is String &&
                ((row['meter_held'] as Map)[k] as String).isNotEmpty)
              (row['meter_held'] as Map)[k] as String,
      ],
      decisionNote: row['decision_note'] as String?,
      decidedByName: names[row['decided_by']],
    );
  }

  final String id;
  final String jobId;
  final String status;
  final String workDone;
  final DateTime? completedAt;
  final String? workOrderNo;
  final String? assetNo;
  final String? site;
  final String? technicianName;
  final String kind;
  final List<String> quickPicks;
  final List<({String name, num qty})> parts;
  final List<String> beforePhotos;
  final List<String> afterPhotos;
  final num? km;
  final num? engineHours;

  /// Null in the list (the image is fetched when the item is opened, see
  /// [WorkshopCheckSignatureSource]).
  final String? signature;

  /// Server reasons for meter readings held for review instead of logged.
  final List<String> meterHeld;
  final String? decisionNote;
  final String? decidedByName;

  bool get isExtra => kind == 'extra';

  /// One task finished while other tasks of the job are still open: it can
  /// be returned but not passed yet.
  bool get isPartial => kind == 'partial';
}

/// The server's answer to a decision.
final class WorkshopCheckDecision {
  const WorkshopCheckDecision({required this.ok, this.reason, this.status});

  final bool ok;

  /// The server's own plain sentence when [ok] is false.
  final String? reason;
  final String? status;
}

abstract interface class WorkshopJobCheckService {
  Future<List<WorkshopCheckItem>> list(WorkshopCheckQueue queue);

  /// [decision] is `pass` or `return`; a return needs [note].
  Future<WorkshopCheckDecision> decide({
    required String completionId,
    required String decision,
    String? note,
  });
}

/// Reads one completion's signature on demand. The list query leaves the
/// signature image out (up to ~400 KB each); the detail screen asks for it.
abstract interface class WorkshopCheckSignatureSource {
  Future<String?> signature(String completionId);
}

/// No `signature` here on purpose; see [WorkshopCheckSignatureSource].
const String kWorkshopCheckListCols = 'id,job_id,task_id,asset_no,site,kind,'
    'work_done,quick_picks,parts_used,before_photos,after_photos,km,'
    'engine_hours,meter_held,completed_at,status,decision_note,decided_at,'
    'decided_by,submitted_by,work_orders(work_order_no,status)';

final class SupabaseWorkshopJobCheckService
    with SupabaseGateway
    implements WorkshopJobCheckService, WorkshopCheckSignatureSource {
  SupabaseWorkshopJobCheckService(this._client);

  final SupabaseClient _client;
  static const Uuid _uuid = Uuid();

  @override
  Future<List<WorkshopCheckItem>> list(WorkshopCheckQueue queue) async {
    final String status =
        queue == WorkshopCheckQueue.toCheck ? 'submitted' : 'returned';
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(kWorkOrderCompletionsTable)
          .select(kWorkshopCheckListCols)
          .eq('status', status)
          .order(
            queue == WorkshopCheckQueue.toCheck ? 'completed_at' : 'decided_at',
            ascending: queue == WorkshopCheckQueue.toCheck,
          )
          .limit(100),
    );
    final Set<String> ids = <String>{
      for (final Map<String, dynamic> r in rows) ...<String>[
        if (r['submitted_by'] is String) r['submitted_by'] as String,
        if (r['decided_by'] is String) r['decided_by'] as String,
      ],
    };
    Map<String, String> names = const <String, String>{};
    if (ids.isNotEmpty) {
      try {
        final List<Map<String, dynamic>> people =
            await guard<List<Map<String, dynamic>>>(
          () => _client
              .from(SupabaseTables.profiles)
              .select('id,full_name')
              .inFilter('id', ids.toList()),
        );
        names = <String, String>{
          for (final Map<String, dynamic> p in people)
            if (p['full_name'] is String &&
                (p['full_name'] as String).trim().isNotEmpty)
              p['id'] as String: (p['full_name'] as String).trim(),
        };
      } on Object {
        // Names are a courtesy; the list still shows without them.
      }
    }
    return <WorkshopCheckItem>[
      for (final Map<String, dynamic> r in rows)
        WorkshopCheckItem.fromRow(r, names: names),
    ];
  }

  @override
  Future<String?> signature(String completionId) async {
    final Map<String, dynamic>? row = await guard<Map<String, dynamic>?>(
      () => _client
          .from(kWorkOrderCompletionsTable)
          .select('signature')
          .eq('id', completionId)
          .maybeSingle(),
    );
    final Object? sig = row?['signature'];
    return sig is String && sig.isNotEmpty ? sig : null;
  }

  @override
  Future<WorkshopCheckDecision> decide({
    required String completionId,
    required String decision,
    String? note,
  }) async {
    final Object? answer = await guard<Object?>(
      () => _client.rpc<Object?>(
        'decide_job_completion',
        params: <String, Object?>{
          'p_completion_id': completionId,
          'p_decision': decision,
          'p_note': note,
          'p_client_uuid': 'jobcheck_${_uuid.v4()}',
        },
      ),
    );
    return workshopCheckDecisionFrom(answer);
  }
}

/// Reads the RPC's `{ok, reason, status}` answer. Anything unreadable is a
/// failure with no reason (the screen shows its generic sentence).
WorkshopCheckDecision workshopCheckDecisionFrom(Object? answer) {
  if (answer is! Map) return const WorkshopCheckDecision(ok: false);
  final String? reason =
      answer['reason'] is String ? (answer['reason'] as String).trim() : null;
  return WorkshopCheckDecision(
    ok: answer['ok'] == true,
    reason: reason == null || reason.isEmpty ? null : reason,
    status: answer['status'] as String?,
  );
}
