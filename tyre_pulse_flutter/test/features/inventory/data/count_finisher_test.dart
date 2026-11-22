// "Finish counting" on the phone: the gate, the online-only rule and the
// one-key-per-press call (docs/inventory/90 blocker B3).
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/inventory/data/count_finisher.dart';
import 'package:tyre_pulse/features/inventory/data/inventory_audit_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';
import 'package:tyre_pulse/features/inventory/domain/finish_counting.dart';

final class _Repo implements InventoryAuditRepository {
  SupabaseFailure? failure;
  final List<(String, String)> calls = <(String, String)>[];

  @override
  Future<Object?> completeCounting({
    required String auditId,
    required String idempotencyKey,
  }) async {
    calls.add((auditId, idempotencyKey));
    if (failure != null) throw failure!;
    return <String, Object?>{'id': auditId, 'status': 'counting_completed'};
  }

  @override
  Future<AuditCounterView> counterView(String auditId) =>
      throw UnimplementedError();

  @override
  Future<List<InventoryAuditSummary>> myAudits() => throw UnimplementedError();

  @override
  Future<CountSubmitResult> submit({
    required String auditId,
    required List<CountLine> lines,
    required String deviceId,
  }) =>
      throw UnimplementedError();

  @override
  Future<String> uploadPhoto({
    required String auditId,
    required String clientUuid,
    required String localPath,
  }) =>
      throw UnimplementedError();
}

SupabaseFailure _failure(SupabaseFailureCause cause, [String msg = 'x']) =>
    SupabaseFailure(
      error: AppError(kind: AppErrorKind.server, message: msg),
      cause: cause,
    );

InventoryAuditSummary _audit(String? status) =>
    InventoryAuditSummary(id: 'aud-1', status: status);

CountLine _line(String id, CountLineState state) => CountLine(
      clientUuid: id,
      locationId: 'L1',
      scannedCode: 'X',
      countedAt: DateTime.utc(2026, 11, 20, 9),
      countedQty: 1,
      state: state,
    );

CountSession _session(List<CountLine> lines) => CountSession(
      auditId: 'aud-1',
      userId: 'u1',
      startedAt: DateTime.utc(2026, 11, 20),
      lines: lines,
    );

void main() {
  group('finishCountingGate', () {
    test('only in_progress and recount can be finished', () {
      for (final String s in <String>['in_progress', 'recount']) {
        expect(
          finishCountingGate(audit: _audit(s), session: null),
          FinishGate.allowed,
        );
        expect(offersFinishCounting(_audit(s)), isTrue);
      }
      for (final String? s in <String?>[
        null,
        'assigned',
        'scheduled',
        'counting_completed',
        'reconciliation',
        'closed',
      ]) {
        expect(
          finishCountingGate(audit: _audit(s), session: null),
          FinishGate.notOpen,
        );
        expect(offersFinishCounting(_audit(s)), isFalse);
      }
    });

    test('a draft, incomplete or rejected line on the phone blocks it', () {
      for (final CountLineState st in <CountLineState>[
        CountLineState.draft,
        CountLineState.rejected,
      ]) {
        expect(
          finishCountingGate(
            audit: _audit('in_progress'),
            session: _session(<CountLine>[
              _line('a', CountLineState.submitted),
              _line('b', st),
            ]),
          ),
          FinishGate.unsentLines,
        );
      }
    });

    test('every line sent (or none counted) allows it', () {
      expect(
        finishCountingGate(
          audit: _audit('recount'),
          session: _session(<CountLine>[
            _line('a', CountLineState.submitted),
            _line('b', CountLineState.submitted),
          ]),
        ),
        FinishGate.allowed,
      );
      expect(
        finishCountingGate(
          audit: _audit('in_progress'),
          session: _session(const <CountLine>[]),
        ),
        FinishGate.allowed,
      );
    });
  });

  group('CountFinisher', () {
    late _Repo repo;
    late bool online;
    late CountFinisher finisher;

    setUp(() {
      repo = _Repo();
      online = true;
      finisher = CountFinisher(repository: repo, isOnline: () async => online);
    });

    test('sends audit_id with the caller key, exactly once', () async {
      final FinishOutcome out = await finisher.finish(
        audit: _audit('in_progress'),
        session: _session(<CountLine>[_line('a', CountLineState.submitted)]),
        idempotencyKey: 'press-1',
      );
      expect(out.status, FinishStatus.done);
      expect(repo.calls, <(String, String)>[('aud-1', 'press-1')]);
    });

    test('unsent lines refuse without calling the server', () async {
      final FinishOutcome out = await finisher.finish(
        audit: _audit('in_progress'),
        session: _session(<CountLine>[
          _line('a', CountLineState.draft),
          _line('b', CountLineState.rejected),
        ]),
        idempotencyKey: 'press-1',
      );
      expect(out.status, FinishStatus.unsentLines);
      expect(out.unsent, 2);
      expect(repo.calls, isEmpty);
    });

    test('offline refuses without calling the server', () async {
      online = false;
      final FinishOutcome out = await finisher.finish(
        audit: _audit('in_progress'),
        session: null,
        idempotencyKey: 'press-1',
      );
      expect(out.status, FinishStatus.offline);
      expect(repo.calls, isEmpty);
    });

    test('a status that cannot finish refuses without calling', () async {
      final FinishOutcome out = await finisher.finish(
        audit: _audit('counting_completed'),
        session: null,
        idempotencyKey: 'press-1',
      );
      expect(out.status, FinishStatus.notOpen);
      expect(repo.calls, isEmpty);
    });

    test('a connection lost during the call reads as offline', () async {
      repo.failure = _failure(SupabaseFailureCause.timeout);
      final FinishOutcome out = await finisher.finish(
        audit: _audit('in_progress'),
        session: null,
        idempotencyKey: 'press-1',
      );
      expect(out.status, FinishStatus.offline);
      expect(repo.calls, hasLength(1));
    });

    test('a missing server object is not provisioned', () async {
      repo.failure = _failure(SupabaseFailureCause.schemaMismatch);
      final FinishOutcome out = await finisher.finish(
        audit: _audit('in_progress'),
        session: null,
        idempotencyKey: 'press-1',
      );
      expect(out.status, FinishStatus.notProvisioned);
    });

    test('a server refusal carries its message', () async {
      repo.failure = _failure(
        SupabaseFailureCause.invalidInput,
        'Counting is not open.',
      );
      final FinishOutcome out = await finisher.finish(
        audit: _audit('in_progress'),
        session: null,
        idempotencyKey: 'press-1',
      );
      expect(out.status, FinishStatus.refused);
      expect(out.failure?.error.message, 'Counting is not open.');
    });
  });
}
