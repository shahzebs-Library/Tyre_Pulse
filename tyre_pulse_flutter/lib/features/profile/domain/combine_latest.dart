/// Combines two streams into one that emits [combine] of the latest value of
/// each, once both have emitted. An error from either is forwarded as an
/// error (never swallowed into a partial value), and the result closes when
/// both inputs have closed. Cancelling the result cancels both inputs.
library;

import 'dart:async';

Stream<R> combineLatestPair<A, B, R>(
  Stream<A> first,
  Stream<B> second,
  R Function(A a, B b) combine,
) {
  late StreamController<R> controller;
  StreamSubscription<A>? subA;
  StreamSubscription<B>? subB;
  A? latestA;
  B? latestB;
  bool hasA = false;
  bool hasB = false;
  int open = 2;

  void emit() {
    if (hasA && hasB) controller.add(combine(latestA as A, latestB as B));
  }

  void done() {
    open -= 1;
    if (open == 0) unawaited(controller.close());
  }

  controller = StreamController<R>(
    onListen: () {
      subA = first.listen(
        (A value) {
          latestA = value;
          hasA = true;
          emit();
        },
        onError: controller.addError,
        onDone: done,
      );
      subB = second.listen(
        (B value) {
          latestB = value;
          hasB = true;
          emit();
        },
        onError: controller.addError,
        onDone: done,
      );
    },
    onCancel: () async {
      await subA?.cancel();
      await subB?.cancel();
    },
  );
  return controller.stream;
}
