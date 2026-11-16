/// A [TurnstileViewFactory] that needs no platform view: each created view is
/// a plain box, and a test drives it by calling [FakeTurnstileHandle.emit].
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/core/auth/captcha/turnstile_captcha.dart';

final class FakeTurnstileFactory implements TurnstileViewFactory {
  final List<FakeTurnstileHandle> handles = <FakeTurnstileHandle>[];

  FakeTurnstileHandle get latest => handles.last;

  @override
  TurnstileViewHandle create({
    required String siteKey,
    required bool dark,
    required TurnstileEventSink onEvent,
  }) {
    final FakeTurnstileHandle handle =
        FakeTurnstileHandle(siteKey: siteKey, dark: dark, onEvent: onEvent);
    handles.add(handle);
    return handle;
  }
}

final class FakeTurnstileHandle implements TurnstileViewHandle {
  FakeTurnstileHandle({
    required this.siteKey,
    required this.dark,
    required TurnstileEventSink onEvent,
  }) : _onEvent = onEvent;

  final String siteKey;
  final bool dark;
  final TurnstileEventSink _onEvent;
  int resets = 0;
  bool disposed = false;

  void emit(TurnstileEvent event) => _onEvent(event);

  @override
  Widget get view => const SizedBox.expand(key: Key('fake.turnstile.view'));

  @override
  Future<void> reset() async => resets++;

  @override
  void dispose() => disposed = true;
}
