import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/features/inventory/data/count_draft_store.dart';
import 'package:tyre_pulse/features/inventory/data/count_submitter.dart';
import 'package:tyre_pulse/features/inventory/data/inventory_audit_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';

final class _Store extends SecureKeyValueStore {
  final Map<String, String> values = <String, String>{};
  bool failReads = false;

  @override
  int get readFailureCount => 0;

  @override
  Future<SecureRead> read(String key) async {
    if (failReads) return const SecureRead.unreadable();
    final String? v = values[key];
    return v == null ? const SecureRead.absent() : SecureRead.ok(v);
  }

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

SupabaseFailure _failure(SupabaseFailureCause cause) => SupabaseFailure(
      error: const AppError(kind: AppErrorKind.server, message: 'x'),
      cause: cause,
    );

final class _Repo implements InventoryAuditRepository {
  SupabaseFailure? submitFailure;
  SupabaseFailure? uploadFailure;
  CountSubmitResult? result;
  final List<List<CountLine>> submitted = <List<CountLine>>[];
  final List<String> uploads = <String>[];

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
  }) async {
    if (submitFailure != null) throw submitFailure!;
    submitted.add(lines);
    return result ??
        CountSubmitResult(
          accepted: <String>{for (final CountLine l in lines) l.clientUuid},
        );
  }

  @override
  Future<Object?> completeCounting({
    required String auditId,
    required String idempotencyKey,
  }) =>
      throw UnimplementedError();

  @override
  Future<String> uploadPhoto({
    required String auditId,
    required String clientUuid,
    required String localPath,
  }) async {
    if (uploadFailure != null) throw uploadFailure!;
    uploads.add(localPath);
    return 'tp-storage://tyre-photos/$localPath';
  }
}

CountSession _session(String user, {List<CountLine>? lines}) => CountSession(
      auditId: 'aud',
      userId: user,
      startedAt: DateTime.utc(2026, 11, 19),
      lines: lines ?? const <CountLine>[],
    );

CountLine _line(String id, {num? qty = 2, List<String> photos = const []}) =>
    CountLine(
      clientUuid: id,
      locationId: 'L1',
      scannedCode: 'X',
      countedAt: DateTime.utc(2026, 11, 19, 9),
      countedQty: qty,
      photoPaths: photos,
    );

void main() {
  group('CountDraftStore', () {
    test('each user has their own encrypted slot', () async {
      final _Store store = _Store();
      final CountDraftStore drafts = CountDraftStore(store);
      await drafts.save(_session('alice', lines: <CountLine>[_line('c1')]));
      await drafts.save(_session('bob'));
      expect((await drafts.loadAll('alice')).keys, <String>['aud']);
      expect((await drafts.load('bob', 'aud'))!.lines, isEmpty);
      expect(store.values.keys, hasLength(2));
      expect(
        store.values.keys.every((String k) => k.startsWith('inventory_count')),
        isTrue,
      );
    });

    test('a foreign session smuggled into a slot is never surfaced', () async {
      final _Store store = _Store();
      final CountDraftStore drafts = CountDraftStore(store);
      await drafts.save(_session('bob'));
      store.values[CountDraftStore.slotFor('alice')] =
          store.values[CountDraftStore.slotFor('bob')]!;
      expect(await drafts.loadAll('alice'), isEmpty);
    });

    test('an unreadable slot refuses to load and refuses to save', () async {
      final _Store store = _Store();
      final CountDraftStore drafts = CountDraftStore(store);
      await drafts.save(_session('alice', lines: <CountLine>[_line('c1')]));
      final String before = store.values.values.single;
      store.failReads = true;
      await expectLater(
        drafts.loadAll('alice'),
        throwsA(isA<StorageReadFailure>()),
      );
      await expectLater(
        drafts.save(_session('alice')),
        throwsA(isA<StorageReadFailure>()),
      );
      expect(store.values.values.single, before, reason: 'nothing overwritten');
    });

    test('prune keeps a session while anything is still unsent', () async {
      final _Store store = _Store();
      final CountDraftStore drafts = CountDraftStore(store);
      await drafts.save(_session('alice', lines: <CountLine>[_line('c1')]));
      expect(await drafts.prune('alice', 'aud'), isFalse);
      await drafts.save(
        _session('alice', lines: <CountLine>[_line('c1')]).applySubmitResult(
          const CountSubmitResult(accepted: <String>{'c1'}),
        ),
      );
      expect(await drafts.prune('alice', 'aud'), isTrue);
      expect(store.values, isEmpty);
    });
  });

  group('CountSubmitter', () {
    late _Store store;
    late CountDraftStore drafts;
    late _Repo repo;
    late List<String> discarded;
    late CountSubmitter submitter;

    setUp(() {
      store = _Store();
      drafts = CountDraftStore(store);
      repo = _Repo();
      discarded = <String>[];
      submitter = CountSubmitter(
        repository: repo,
        drafts: drafts,
        discardPhotos: (List<String> p) async => discarded.addAll(p),
      );
    });

    test('only complete draft lines are sent; accepted lines are marked',
        () async {
      final CountSession s = _session(
        'me',
        lines: <CountLine>[_line('c1'), _line('c2', qty: null)],
      );
      final SubmitOutcome out = await submitter.submit(s, deviceId: 'dev');
      expect(out.status, SubmitStatus.done);
      expect(
        repo.submitted.single.map((CountLine l) => l.clientUuid),
        <String>['c1'],
      );
      expect(
        out.session.lines
            .firstWhere((CountLine l) => l.clientUuid == 'c1')
            .state,
        CountLineState.submitted,
      );
      expect((await drafts.load('me', 'aud'))!.pending, hasLength(1));
    });

    test('photos upload first; local copies are removed only after accept',
        () async {
      final CountSession s = _session(
        'me',
        lines: <CountLine>[
          _line('c1', photos: <String>['/p/1.jpg']),
        ],
      );
      final SubmitOutcome out = await submitter.submit(s, deviceId: 'dev');
      expect(repo.uploads, <String>['/p/1.jpg']);
      final CountLine sent = repo.submitted.single.single;
      expect(sent.photoRefs, <String>['tp-storage://tyre-photos//p/1.jpg']);
      expect(sent.photoPaths, isEmpty);
      expect(discarded, <String>['/p/1.jpg']);
      expect(out.status, SubmitStatus.done);
    });

    test('offline keeps everything on the phone', () async {
      repo.submitFailure = _failure(SupabaseFailureCause.offline);
      final SubmitOutcome out = await submitter.submit(
        _session('me', lines: <CountLine>[_line('c1')]),
        deviceId: 'dev',
      );
      expect(out.status, SubmitStatus.offline);
      expect(out.session.pending, hasLength(1));
      expect(discarded, isEmpty);
    });

    test('a missing server object is reported as not provisioned', () async {
      repo.submitFailure = _failure(SupabaseFailureCause.schemaMismatch);
      final SubmitOutcome out = await submitter.submit(
        _session('me', lines: <CountLine>[_line('c1')]),
        deviceId: 'dev',
      );
      expect(out.status, SubmitStatus.notProvisioned);
      expect(out.session.lines.single.state, CountLineState.draft);
    });

    test('a refused line is marked rejected with the server reason', () async {
      repo.result = const CountSubmitResult(
        rejected: <String, String>{'c1': 'Audit is closed'},
      );
      final SubmitOutcome out = await submitter.submit(
        _session('me', lines: <CountLine>[_line('c1')]),
        deviceId: 'dev',
      );
      expect(out.status, SubmitStatus.partial);
      expect(out.session.lines.single.state, CountLineState.rejected);
      expect(out.session.lines.single.rejectReason, 'Audit is closed');
      expect(
        reopenRejected(out.session.lines.single).state,
        CountLineState.draft,
      );
    });

    test('a photo that cannot upload holds its line back, others go', () async {
      repo.uploadFailure = _failure(SupabaseFailureCause.storageNotFound);
      final SubmitOutcome out = await submitter.submit(
        _session(
          'me',
          lines: <CountLine>[
            _line('c1', photos: <String>['/p/1.jpg']),
            _line('c2'),
          ],
        ),
        deviceId: 'dev',
      );
      expect(
        repo.submitted.single.map((CountLine l) => l.clientUuid),
        <String>['c2'],
      );
      expect(out.status, SubmitStatus.partial);
      final CountLine held =
          out.session.lines.firstWhere((CountLine l) => l.clientUuid == 'c1');
      expect(held.state, CountLineState.draft);
      expect(held.photoPaths, <String>['/p/1.jpg']);
    });

    test('nothing finished means nothing sent', () async {
      final SubmitOutcome out = await submitter.submit(
        _session('me', lines: <CountLine>[_line('c1', qty: null)]),
        deviceId: 'dev',
      );
      expect(out.status, SubmitStatus.nothingToSend);
      expect(repo.submitted, isEmpty);
    });
  });
}
