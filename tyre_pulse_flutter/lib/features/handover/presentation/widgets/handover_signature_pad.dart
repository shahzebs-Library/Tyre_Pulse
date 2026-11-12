/// A drawing surface for a handover signature - the driver's field signature in
/// the wizard, and a signer's mark on the detail sign-off.
///
/// Emits a self-contained `data:image/png;base64,...` URL (what
/// `handover_reports.signature_url` and `decide_handover_approval`'s
/// `p_signature` both accept). Sibling top-level features do not share
/// presentation code, so this is the handover feature's own pad rather than an
/// import of `inspection_signature_pad.dart` - the same convention the
/// approvals feature followed with its `inspection_approval_signature_pad.dart`.
///
/// # `value` re-hydration
///
/// A pad on a wizard step unmounts when the step is left, so a previously drawn
/// signature is shown as a STATIC preview with a "Draw a new signature" action
/// (`value` prop), mirroring the production "pre-filling is not signing" rule:
/// nothing is re-committed until the pad is drawn on again. `readOnly` shows a
/// captured signature with no controls, for a decided record.
///
/// Written against `signature`'s long-stable public surface, not installed
/// source - see `inspection_signature_pad.dart`'s note on the same limitation.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

class HandoverSignaturePad extends StatefulWidget {
  const HandoverSignaturePad({
    this.onChanged,
    this.value,
    this.height = 180,
    this.readOnly = false,
    super.key,
  }) : assert(readOnly || onChanged != null);

  /// A previously-captured `data:` URL, if any.
  final String? value;

  /// Emits the `data:` URL of the drawn mark, or null when cleared / redrawing.
  final ValueChanged<String?>? onChanged;
  final double height;

  /// Shows a recorded signature with no redraw/clear controls.
  final bool readOnly;

  @override
  State<HandoverSignaturePad> createState() => _HandoverSignaturePadState();
}

class _HandoverSignaturePadState extends State<HandoverSignaturePad> {
  late SignatureController _controller;
  late bool _showingSavedPreview;

  @override
  void initState() {
    super.initState();
    _controller = SignatureController(
      onDrawEnd: _onStrokeEnd,
      penStrokeWidth: 3,
      penColor: Colors.black,
      exportBackgroundColor: Colors.white,
    );
    _showingSavedPreview = widget.value != null;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onStrokeEnd() async {
    if (_controller.isEmpty) return;
    final Uint8List? pngBytes = await _controller.toPngBytes();
    if (pngBytes == null) return;
    final String dataUrl = 'data:image/png;base64,${base64Encode(pngBytes)}';
    widget.onChanged?.call(dataUrl);
  }

  void _startRedraw() {
    // Emit null FIRST so a stale signature cannot reach a decision nobody meant
    // to sign with it (the production startRedraw rule).
    widget.onChanged?.call(null);
    _controller.clear();
    setState(() => _showingSavedPreview = false);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);

    if (_showingSavedPreview && widget.value != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Container(
            height: widget.height,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(TpRadius.md),
              border: Border.all(color: palette.border),
            ),
            child: Image.memory(
              _decodeDataUrl(widget.value!),
              fit: BoxFit.contain,
              errorBuilder:
                  (BuildContext context, Object error, StackTrace? s) => Center(
                child: Text(
                  l10n.handoverSignatureSaved,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            ),
          ),
          if (!widget.readOnly) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            TpButton.text(
              label: l10n.handoverSignatureRedraw,
              icon: Icons.edit_outlined,
              onPressed: _startRedraw,
            ),
          ],
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        DecoratedBox(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(TpRadius.md),
            border: Border.all(color: palette.border),
          ),
          child: AbsorbPointer(
            absorbing: widget.readOnly,
            child: Signature(
              controller: _controller,
              height: widget.height,
              backgroundColor: Colors.white,
            ),
          ),
        ),
        if (!widget.readOnly) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Align(
            alignment: Alignment.centerRight,
            child: TpButton.text(
              label: l10n.actionClear,
              onPressed: () {
                _controller.clear();
                widget.onChanged?.call(null);
              },
            ),
          ),
        ],
      ],
    );
  }

  static Uint8List _decodeDataUrl(String dataUrl) {
    final int comma = dataUrl.indexOf(',');
    final String b64 = comma < 0 ? dataUrl : dataUrl.substring(comma + 1);
    return base64Decode(b64);
  }
}

/// Renders a stored handover signature (`data:` URL or a resolved image) as a
/// read-only preview, falling back to [fallback] when there is nothing to show.
class HandoverSignaturePreview extends StatelessWidget {
  const HandoverSignaturePreview({
    required this.value,
    required this.fallback,
    this.height = 110,
    super.key,
  });

  final String? value;
  final Widget fallback;
  final double height;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Uint8List? bytes = _dataBytes(value);
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: palette.border),
      ),
      alignment: Alignment.center,
      child: bytes == null
          ? fallback
          : Image.memory(
              bytes,
              fit: BoxFit.contain,
              errorBuilder: (_, __, ___) => fallback,
            ),
    );
  }

  static Uint8List? _dataBytes(String? value) {
    if (value == null || value.isEmpty) return null;
    final Uri? uri = Uri.tryParse(value);
    if (uri == null || uri.scheme.toLowerCase() != 'data') return null;
    try {
      final UriData? data = uri.data;
      if (data == null || !data.mimeType.toLowerCase().startsWith('image/')) {
        return null;
      }
      return Uint8List.fromList(data.contentAsBytes());
    } on FormatException {
      return null;
    }
  }
}
