/// The approving supervisor's signature pad, on the inspection review
/// screen.
///
/// # Why this feature draws its own signature pad rather than importing
/// # `features/inspections`' one
///
/// `features/inspections/presentation/widgets/inspection_signature_pad.dart`
/// does the exact same job (a `signature` package drawing surface plus a
/// pre-existing-value static preview with a "Draw a new signature"
/// action), and this file is deliberately a SEPARATE, self-contained copy
/// rather than an import of it. That is not an oversight: `lib/features/*`
/// folders in this port do not depend on each other's presentation layers
/// - `checklist_signature_pad.dart` and `inspection_signature_pad.dart`
/// already are two such independent copies of this same technique (see
/// `test/app/localization/arb_key_parity_test.dart`'s own running-key-count
/// comment: "the signature pad's saved-preview/redraw pair (its own copy,
/// mirroring but not sharing the inspection pad's keys)" - said explicitly
/// of the checklist feature's copy, and equally true of this one). This
/// file mirrors both of them in shape, including their two `data:` URL /
/// raw-strokes payload for exactly the reasons
/// `inspection_signature_pad.dart`'s own comment gives (a raster PNG for
/// `p_signature` and, should a future audit trail ever want it, the raw
/// stroke points that "reconstruct the ACT, which is what makes a mark
/// defensible if it is ever disputed").
///
/// # `value` re-hydration
///
/// [value] is supported for the same reason `inspection_signature_pad.
/// dart`'s own comment gives: this pad sits inside a scroll view that can
/// rebuild (a pull-to-refresh, a reload after deciding), and without it a
/// signature already drawn would come back blank with Clear then erasing
/// it. A raster payload cannot be re-loaded into a LIVE drawing surface for
/// further editing, so a pre-existing value shows as a STATIC preview with
/// a "Draw a new signature" action - nothing is re-committed until the pad
/// is drawn on again and confirmed, mirroring the "pre-filling is not
/// signing" rule this codebase already applies to a saved signature
/// elsewhere.
///
/// # UNVERIFIED against real source
///
/// Written against `signature`'s long-stable, widely documented public
/// surface, exactly as `inspection_signature_pad.dart`'s own note states -
/// there is no resolvable pub cache in this environment to check it
/// against installed source.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

/// One captured signature, ready for
/// `InspectionApprovalDecision.approverSignature`.
class InspectionApprovalSignatureCapture {
  const InspectionApprovalSignatureCapture({
    required this.dataUrl,
    this.strokesJson,
  });

  final String dataUrl;
  final String? strokesJson;
}

class InspectionApprovalSignaturePad extends StatefulWidget {
  const InspectionApprovalSignaturePad({
    required this.onChanged,
    this.value,
    this.height = 180,
    super.key,
  });

  /// A previously-captured `data:` URL, if any. See the library comment.
  final String? value;

  final ValueChanged<InspectionApprovalSignatureCapture?> onChanged;
  final double height;

  @override
  State<InspectionApprovalSignaturePad> createState() =>
      _InspectionApprovalSignaturePadState();
}

class _InspectionApprovalSignaturePadState
    extends State<InspectionApprovalSignaturePad> {
  late SignatureController _controller;

  /// Whether the pad is showing a pre-existing signature as a static
  /// preview rather than a live drawing surface. Starts true whenever a
  /// value was handed in - "pre-filling is not signing".
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
    if (!mounted || pngBytes == null) return;
    final String dataUrl = 'data:image/png;base64,${base64Encode(pngBytes)}';
    final String strokesJson = jsonEncode(
      _controller.points
          .map(
            (point) => <String, Object?>{
              'x': point.offset.dx,
              'y': point.offset.dy,
            },
          )
          .toList(growable: false),
    );
    widget.onChanged(
      InspectionApprovalSignatureCapture(
        dataUrl: dataUrl,
        strokesJson: strokesJson,
      ),
    );
  }

  void _startRedraw() {
    // Emits null FIRST - leaving it attached while the pad reads empty is
    // how a stale signature reaches a decision nobody meant to sign with -
    // mirrors `inspection_signature_pad.dart`'s own `_startRedraw`.
    widget.onChanged(null);
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
              errorBuilder: (context, error, stack) => Center(
                child: Text(
                  l10n.inspectionApprovalSignatureSavedLabel,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            ),
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.text(
            label: l10n.inspectionApprovalSignatureRedraw,
            icon: Icons.edit_outlined,
            onPressed: _startRedraw,
          ),
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
          child: Signature(
            controller: _controller,
            height: widget.height,
            backgroundColor: Colors.white,
          ),
        ),
        const SizedBox(height: TpSpace.sm),
        Align(
          alignment: Alignment.centerRight,
          child: TpButton.text(
            label: l10n.actionClear,
            onPressed: () {
              _controller.clear();
              widget.onChanged(null);
            },
          ),
        ),
      ],
    );
  }

  static Uint8List _decodeDataUrl(String dataUrl) {
    final int comma = dataUrl.indexOf(',');
    final String b64 = comma < 0 ? dataUrl : dataUrl.substring(comma + 1);
    return base64Decode(b64);
  }
}
