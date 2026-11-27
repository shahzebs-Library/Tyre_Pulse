/// Routes a rugged handheld's trigger press into the normal scan flow.
///
/// Handhelds and RFID readers in keyboard (wedge) mode type the code and
/// Enter in a few milliseconds. This widget watches hardware key events while
/// no text field has focus, hands the burst to [HidBurstDetector], and calls
/// [onScan] with the code - which the scanner screen sends through the exact
/// same `ScannerController.submit` a camera scan uses. When a text field DOES
/// have focus the keystrokes simply land in it, and its own submit runs.
///
/// Mounted only for people with device access; for everyone else it renders
/// its child untouched and listens to nothing.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/devices/device_providers.dart';
import 'package:tyre_pulse/core/devices/hid_burst_detector.dart';

class HidScanListener extends ConsumerStatefulWidget {
  const HidScanListener({
    required this.onScan,
    required this.child,
    this.clock,
    super.key,
  });

  final ValueChanged<String> onScan;
  final Widget child;

  /// Test seam for timestamps. Defaults to a monotonic stopwatch.
  final Duration Function()? clock;

  @override
  ConsumerState<HidScanListener> createState() => _HidScanListenerState();
}

class _HidScanListenerState extends ConsumerState<HidScanListener> {
  final HidBurstDetector _detector = HidBurstDetector();
  final Stopwatch _watch = Stopwatch()..start();
  bool _listening = false;

  Duration _now() => widget.clock?.call() ?? _watch.elapsed;

  bool _textFieldFocused() {
    final BuildContext? focused = FocusManager.instance.primaryFocus?.context;
    if (focused == null) return false;
    return focused.widget is EditableText ||
        focused.findAncestorWidgetOfExactType<EditableText>() != null;
  }

  bool _handle(KeyEvent event) {
    if (!mounted || event is KeyUpEvent) return false;
    if (_textFieldFocused()) {
      _detector.reset();
      return false;
    }
    final LogicalKeyboardKey key = event.logicalKey;
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter ||
        key == LogicalKeyboardKey.tab) {
      final String? code = _detector.addTerminator(_now());
      if (code != null) {
        widget.onScan(code);
        return true;
      }
      return false;
    }
    final String? character = event.character;
    if (character != null && character.isNotEmpty) {
      _detector.addCharacter(character, _now());
    }
    return false;
  }

  void _sync(bool enabled) {
    if (enabled == _listening) return;
    _listening = enabled;
    if (enabled) {
      HardwareKeyboard.instance.addHandler(_handle);
    } else {
      HardwareKeyboard.instance.removeHandler(_handle);
      _detector.reset();
    }
  }

  @override
  void dispose() {
    _sync(false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _sync(ref.watch(devicesAccessProvider));
    return widget.child;
  }
}
