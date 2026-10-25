/// [QueuedWorkforceTransition] serialisation and [FileWorkforceTransitionQueue]
/// against a real temporary directory: durability, per-user isolation, one
/// corrupt file degrading to one bad row, and path safety.
///
/// UNVERIFIED: written without a Flutter SDK; never compiled or run.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/my_work/data/queued_workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_transition_queue.dart';
import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';

const String userA = '11111111-1111-1111-1111-111111111111';
const String userB = '22222222-2222-2222-2222-222222222222';

QueuedWorkforceTransition item(
  String id, {
  String user = userA,
  int seq = 1,
  WorkforceAction action = WorkforceAction.start,
  String? note,
  WorkforceQueueStatus status = WorkforceQueueStatus.pending,
}) {
  return QueuedWorkforceTransition(
    id: id,
    userId: user,
    assignmentId: 'assignment-1',
    action: action,
    seq: seq,
    createdAt: DateTime.utc(2026, 10, 23, 8),
    clientAt: DateTime.utc(2026, 10, 23, 8, 5),
    baseStatus: 'assigned',
    note: note,
    status: status,
  );
}

void main() {
  group('QueuedWorkforceTransition', () {
    test('round-trips through JSON including a refusal', () {
      final QueuedWorkforceTransition original = item(
        'key-aaaaaaaa',
        action: WorkforceAction.block,
        note: 'no valve',
        status: WorkforceQueueStatus.rejected,
      ).copyWith(
        attempts: 2,
        error: 'moved on',
        serverStatus: 'cancelled',
        rejectionReason: 'invalid_transition',
      );
      final QueuedWorkforceTransition copy =
          QueuedWorkforceTransition.fromJsonString(original.toJsonString());
      expect(copy.id, original.id);
      expect(copy.action, WorkforceAction.block);
      expect(copy.note, 'no valve');
      expect(copy.status, WorkforceQueueStatus.rejected);
      expect(copy.attempts, 2);
      expect(copy.serverStatus, 'cancelled');
      expect(copy.rejectionReason, 'invalid_transition');
      expect(copy.clientAt, DateTime.utc(2026, 10, 23, 8, 5));
    });

    test('copyWith(clearError) returns a clean pending entry', () {
      final QueuedWorkforceTransition cleaned = item('key-aaaaaaaa')
          .copyWith(
            status: WorkforceQueueStatus.rejected,
            error: 'x',
            serverStatus: 'y',
            rejectionReason: 'z',
          )
          .copyWith(status: WorkforceQueueStatus.pending, clearError: true);
      expect(cleaned.error, isNull);
      expect(cleaned.serverStatus, isNull);
      expect(cleaned.rejectionReason, isNull);
    });

    test('unknown actions and garbage are rejected, not guessed', () {
      expect(
        () => QueuedWorkforceTransition.fromJsonString('{"action":"verify"}'),
        throwsA(anything),
      );
      expect(
        () => QueuedWorkforceTransition.fromJsonString('[1,2]'),
        throwsFormatException,
      );
    });
  });

  group('FileWorkforceTransitionQueue', () {
    late Directory root;
    late FileWorkforceTransitionQueue queue;

    setUp(() async {
      root = await Directory.systemTemp.createTemp('workforce_queue_test');
      queue = FileWorkforceTransitionQueue(overrideDirectory: root);
    });

    tearDown(() async {
      await root.delete(recursive: true);
    });

    test('persists, replaces and removes entries', () async {
      await queue.put(item('key-aaaaaaaa'));
      await queue.put(item('key-aaaaaaaa', note: 'changed'));
      WorkforceQueueRead read = await queue.list(userA);
      expect(read.isReadable, isTrue);
      expect(read.items, hasLength(1));
      expect(read.items.single.note, 'changed');

      await queue.remove(userA, 'key-aaaaaaaa');
      read = await queue.list(userA);
      expect(read.items, isEmpty);
      expect(read.isReadable, isTrue, reason: 'empty is not unreadable');
    });

    test('survives a new queue instance (process restart)', () async {
      await queue.put(item('key-aaaaaaaa'));
      final FileWorkforceTransitionQueue reopened =
          FileWorkforceTransitionQueue(overrideDirectory: root);
      expect((await reopened.list(userA)).items, hasLength(1));
    });

    test('orders by seq', () async {
      await queue.put(item('key-cccccccc', seq: 3));
      await queue.put(item('key-aaaaaaaa'));
      await queue.put(item('key-bbbbbbbb', seq: 2));
      final List<String> ids = (await queue.list(userA))
          .items
          .map((QueuedWorkforceTransition i) => i.id)
          .toList();
      expect(ids, <String>['key-aaaaaaaa', 'key-bbbbbbbb', 'key-cccccccc']);
    });

    test('is partitioned per user', () async {
      await queue.put(item('key-aaaaaaaa'));
      await queue.put(item('key-bbbbbbbb', user: userB));
      expect((await queue.list(userA)).items.single.id, 'key-aaaaaaaa');
      expect((await queue.list(userB)).items.single.id, 'key-bbbbbbbb');
    });

    test('a file copied into another user folder is never returned for them',
        () async {
      await queue.put(item('key-aaaaaaaa'));
      final Directory a = Directory(
        '${root.path}${Platform.pathSeparator}workforce_transitions'
        '${Platform.pathSeparator}$userA',
      );
      final Directory b = Directory(
        '${root.path}${Platform.pathSeparator}workforce_transitions'
        '${Platform.pathSeparator}$userB',
      )..createSync(recursive: true);
      File('${a.path}${Platform.pathSeparator}key-aaaaaaaa.json')
          .copySync('${b.path}${Platform.pathSeparator}key-aaaaaaaa.json');
      expect((await queue.list(userB)).items, isEmpty);
    });

    test('one corrupt file does not hide the others and is left on disk',
        () async {
      await queue.put(item('key-aaaaaaaa'));
      final Directory dir = Directory(
        '${root.path}${Platform.pathSeparator}workforce_transitions'
        '${Platform.pathSeparator}$userA',
      );
      final File corrupt =
          File('${dir.path}${Platform.pathSeparator}key-bbbbbbbb.json')
            ..writeAsStringSync('{not json');
      final WorkforceQueueRead read = await queue.list(userA);
      expect(
        read.items.map((QueuedWorkforceTransition i) => i.id),
        <String>['key-aaaaaaaa'],
      );
      expect(corrupt.existsSync(), isTrue);
    });

    test('refuses unsafe path segments', () async {
      // An unsafe user id reads as an unreadable store, never as an empty one.
      expect((await queue.list('../other')).isReadable, isFalse);
      await expectLater(
        queue.put(item('../escape-key')),
        throwsA(isA<ArgumentError>()),
      );
    });
  });
}
