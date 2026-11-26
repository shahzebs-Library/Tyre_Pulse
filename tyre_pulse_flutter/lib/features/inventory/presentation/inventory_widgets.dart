/// Shared pieces for the inventory screens: the scan input that accepts a
/// Bluetooth HID (keyboard-wedge) scanner, a camera scan, or typing; a big
/// glove-friendly quantity stepper; and the failure renderer that tells a
/// missing server object apart from a real error.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_copy.dart';
import 'package:tyre_pulse/features/scanning/presentation/asset_camera_scanner_dialog.dart';

/// Minimum touch target for gloved hands. Above Material's 48dp.
const double inventoryTouchTarget = 56;

/// The one scan entry point.
///
/// A wedge scanner "types" into whichever field has focus and ends with Enter,
/// so this field keeps focus (it re-requests it after every submit) and
/// submits on Enter. The camera button and manual typing feed the same
/// [onScan], so all three paths behave identically.
class InventoryScanField extends StatefulWidget {
  const InventoryScanField({
    required this.onScan,
    required this.hint,
    required this.copy,
    this.autofocus = true,
    super.key,
  });

  final ValueChanged<String> onScan;
  final String hint;
  final InventoryCopy copy;
  final bool autofocus;

  @override
  State<InventoryScanField> createState() => _InventoryScanFieldState();
}

class _InventoryScanFieldState extends State<InventoryScanField> {
  final TextEditingController _controller = TextEditingController();
  final FocusNode _focus = FocusNode(debugLabel: 'inventory.scan');

  void _submit(String value) {
    final String text = value.trim();
    _controller.clear();
    if (text.isNotEmpty) widget.onScan(text);
    // Keep focus so the next wedge burst lands here, not in another field.
    if (mounted) _focus.requestFocus();
  }

  Future<void> _camera() async {
    final String? code = await showAssetCameraScanner(context);
    if (code != null && code.trim().isNotEmpty) _submit(code);
  }

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Expanded(
          child: TextField(
            key: const Key('inventory.scan.field'),
            controller: _controller,
            focusNode: _focus,
            autofocus: widget.autofocus,
            textInputAction: TextInputAction.done,
            // Wedge scanners send printable ASCII; block line breaks so a CR
            // never ends up inside the code.
            inputFormatters: <TextInputFormatter>[
              FilteringTextInputFormatter.deny(RegExp(r'[\r\n\t]')),
            ],
            onSubmitted: _submit,
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.qr_code_2_rounded),
              hintText: widget.hint,
            ),
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        SizedBox(
          width: inventoryTouchTarget,
          height: inventoryTouchTarget,
          child: IconButton.filled(
            key: const Key('inventory.scan.camera'),
            tooltip: widget.copy('scanCamera'),
            onPressed: () => unawaited(_camera()),
            icon: const Icon(Icons.photo_camera_outlined),
          ),
        ),
      ],
    );
  }
}

/// A large quantity stepper: -10, -1, the value, +1, +10. Never goes below 0.
class InventoryQtyStepper extends StatelessWidget {
  const InventoryQtyStepper({
    required this.value,
    required this.onChanged,
    required this.copy,
    super.key,
  });

  final num? value;
  final ValueChanged<num> onChanged;
  final InventoryCopy copy;

  void _bump(num delta) {
    final num next = (value ?? 0) + delta;
    unawaited(HapticFeedback.selectionClick());
    onChanged(next < 0 ? 0 : next);
  }

  // At least a touch target, growing with the text so "+10" never clips at
  // large text sizes. The label is always laid out left to right, so "-10"
  // reads as minus ten in Arabic and Urdu instead of "10-".
  Widget _button(String label, num delta, String key) => ConstrainedBox(
        constraints: const BoxConstraints(
          minWidth: inventoryTouchTarget,
          minHeight: inventoryTouchTarget,
        ),
        child: OutlinedButton(
          key: Key(key),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            minimumSize: const Size(inventoryTouchTarget, inventoryTouchTarget),
          ),
          onPressed: () => _bump(delta),
          child: Text(label, textDirection: TextDirection.ltr),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: <Widget>[
        _button('-10', -10, 'inventory.qty.minus10'),
        _button('-1', -1, 'inventory.qty.minus1'),
        Expanded(
          child: Text(
            value == null ? '-' : '$value',
            key: const Key('inventory.qty.value'),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineMedium,
          ),
        ),
        _button('+1', 1, 'inventory.qty.plus1'),
        _button('+10', 10, 'inventory.qty.plus10'),
      ],
    );
  }
}

/// Renders a load failure. A missing server object (the `inv_*` migrations
/// are not applied yet) is NOT an error the user can retry and NOT an empty
/// list: it is "not set up yet", and it says so.
class InventoryFailureView extends StatelessWidget {
  const InventoryFailureView({
    required this.error,
    required this.copy,
    this.onRetry,
    super.key,
  });

  final Object error;
  final InventoryCopy copy;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final Object e = error;
    if (e is SupabaseFailure && e.isSchemaMismatch) {
      return TpNotConfiguredState(
        key: const Key('inventory.notProvisioned'),
        title: copy('notProvisionedTitle'),
        detail: copy('notProvisionedBody'),
      );
    }
    final AppError appError = switch (e) {
      final SupabaseFailure failure => failure.error,
      final AppError appError => appError,
      _ => AppError(
          kind: AppErrorKind.unknown,
          message: copy('loadFailed'),
          cause: e,
          isRetryable: true,
        ),
    };
    return TpErrorState(error: appError, onRetry: onRetry);
  }
}
