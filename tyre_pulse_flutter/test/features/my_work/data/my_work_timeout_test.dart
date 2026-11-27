import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';

void main() {
  test('a source that never answers fails instead of loading forever',
      () async {
    final MyWorkGateway gateway = MyWorkGateway(
      inspectionApprovals: () =>
          Completer<MyWorkQueueCount>().future, // never completes
    );
    await expectLater(
      loadMyWork(
        gateway,
        now: DateTime(2026, 11, 28),
        sourceTimeout: const Duration(milliseconds: 20),
      ),
      throwsA(isA<MyWorkLoadFailure>()),
    );
  });

  test('a hung source beside a working one leaves a partial snapshot',
      () async {
    final MyWorkGateway gateway = MyWorkGateway(
      inspectionApprovals: () => Completer<MyWorkQueueCount>().future,
      checklistApprovals: () async => const MyWorkQueueCount(3),
    );
    final MyWorkSnapshot snapshot = await loadMyWork(
      gateway,
      now: DateTime(2026, 11, 28),
      sourceTimeout: const Duration(milliseconds: 20),
    );
    expect(snapshot.failed, contains(MyWorkSource.inspectionApprovals));
    expect(snapshot.checklistApprovals?.count, 3);
  });
}
