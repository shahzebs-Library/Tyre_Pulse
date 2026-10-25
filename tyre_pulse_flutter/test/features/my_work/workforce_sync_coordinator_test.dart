/// When queued assignment updates are delivered: sign-in, app resume,
/// connectivity regained. The engine's own behaviour is covered in
/// `data/workforce_sync_engine_test.dart`.
///
/// UNVERIFIED: written without a Flutter SDK; never compiled or run.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_sync_engine.dart';
import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/workforce_sync_providers.dart';

import 'data/workforce_test_fakes.dart';

const String userA = '11111111-1111-1111-1111-111111111111';

void main() {
  late FakeWorkforceQueue queue;
  late FakeWorkforceRemote remote;
  late WorkforceTransitionEngine engine;
  late int settled;
  late WorkforceSyncCoordinator coordinator;

  setUp(() async {
    queue = FakeWorkforceQueue();
    // The tap that queued the update failed offline.
    remote = FakeWorkforceRemote(<Object>[const SocketException('offline')]);
    int n = 0;
    engine = WorkforceTransitionEngine(
      queue: queue,
      remote: remote,
      newId: () => 'key-${++n}-0000000000',
    );
    await engine.submit(
      userId: userA,
      assignmentId: 'assignment-1',
      serverStatus: 'assigned',
      action: WorkforceAction.start,
    );
    remote.calls.clear();
    settled = 0;
    coordinator =
        WorkforceSyncCoordinator(engine: engine, onSettled: () => settled++);
  });

  test('nothing is sent while nobody is signed in', () async {
    final WorkforceFlushSummary summary = await coordinator.resumed();
    expect(summary.attempted, 0);
    expect(remote.calls, isEmpty);
    expect(queue.of(userA), hasLength(1));
  });

  test('sign-in delivers the queue and tells the screens to refresh', () async {
    final WorkforceFlushSummary summary = await coordinator.signedIn(userA);
    expect(summary.delivered, 1);
    expect(settled, 1);
    expect(queue.of(userA), isEmpty);
  });

  test('app resume delivers', () async {
    await coordinator.signedIn(userA); // delivers the setUp entry
    remote.script.add(const SocketException('offline'));
    await engine.submit(
      userId: userA,
      assignmentId: 'assignment-2',
      serverStatus: 'assigned',
      action: WorkforceAction.accept,
    );
    remote.calls.clear();
    final WorkforceFlushSummary summary = await coordinator.resumed();
    expect(summary.delivered, 1);
  });

  test('going offline does not flush; coming online does', () async {
    await coordinator.signedIn(userA); // delivers the setUp entry
    remote.script.add(const SocketException('offline'));
    await engine.submit(
      userId: userA,
      assignmentId: 'assignment-2',
      serverStatus: 'assigned',
      action: WorkforceAction.accept,
    );
    remote.calls.clear();

    final WorkforceFlushSummary off =
        await coordinator.connectivityChanged(online: false);
    expect(off.attempted, 0);
    expect(remote.calls, isEmpty);

    final WorkforceFlushSummary on =
        await coordinator.connectivityChanged(online: true);
    expect(on.delivered, 1);
  });

  test('a flush that changes nothing does not trigger a refresh', () async {
    remote.script.add(const SocketException('still offline'));
    final WorkforceFlushSummary summary = await coordinator.signedIn(userA);
    expect(summary.offline, isTrue);
    expect(settled, 0);
  });

  test('sign-out stops delivery', () async {
    coordinator.signedOut();
    await coordinator.connectivityChanged(online: true);
    expect(remote.calls, isEmpty);
    expect(coordinator.userId, isNull);
  });
}
