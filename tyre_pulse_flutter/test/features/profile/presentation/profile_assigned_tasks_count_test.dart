import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/profile/presentation/profile_screen.dart';

void main() {
  final MyWorkSnapshot empty = MyWorkSnapshot(
    items: const [],
    loadedAt: DateTime(2026, 11, 28),
  );

  test('a loaded snapshot shows its open count, 0 included', () {
    expect(
      profileAssignedTasksCount(AsyncData<MyWorkSnapshot>(empty)),
      (value: '0', failed: false),
    );
  });

  test('a refresh keeps showing the last count instead of a dash', () async {
    int calls = 0;
    final Completer<MyWorkSnapshot> second = Completer<MyWorkSnapshot>();
    final FutureProvider<MyWorkSnapshot> provider =
        FutureProvider<MyWorkSnapshot>((Ref ref) {
      calls++;
      return calls == 1 ? Future<MyWorkSnapshot>.value(empty) : second.future;
    });
    final ProviderContainer container = ProviderContainer();
    addTearDown(container.dispose);
    final ProviderSubscription<AsyncValue<MyWorkSnapshot>> sub =
        container.listen(provider, (_, __) {});
    addTearDown(sub.close);
    await container.read(provider.future);
    container.invalidate(provider);
    final AsyncValue<MyWorkSnapshot> reloading = container.read(provider);
    expect(reloading.isLoading, isTrue);
    expect(profileAssignedTasksCount(reloading).value, '0');
    second.complete(empty);
  });

  test('a failed read says so (tap to retry), never a silent dash', () {
    final AsyncValue<MyWorkSnapshot> failed =
        AsyncError<MyWorkSnapshot>(Exception('x'), StackTrace.empty);
    expect(profileAssignedTasksCount(failed).failed, isTrue);
  });

  test('a read still running shows an ellipsis, not a dash', () {
    expect(
      profileAssignedTasksCount(const AsyncLoading<MyWorkSnapshot>()).value,
      '…',
    );
  });
}
