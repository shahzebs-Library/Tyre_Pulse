/// The driver's OPTIONAL signature on the meter-log review step.
///
/// # Why this feature draws its own signature pad rather than importing one
/// # from a sibling feature
///
/// `features/approvals/presentation/widgets/inspection_approval_signature_
/// pad.dart` and `features/approvals/presentation/widgets/checklist_
/// approval_signature_pad.dart` do the exact same job (a `signature` package
/// drawing surface plus a pre-existing-value static preview with a "Draw a
/// new signature" action), and this file is deliberately a SEPARATE,
/// self-contained copy rather than an import of either - not an oversight.
/// `inspection_approval_signature_pad.dart`'s own library comment states the
/// rule this follows: "`lib/features/*` folders in this port do not depend
/// on each other's presentation layers... two such independent copies of
/// this same technique" already exist before this one, and this is a third.
///
/// # `data:image/png;base64,...`, not the reference's self-contained SVG
///
/// `mobile/lib/meterLogs.ts`'s own comment describes its signature field as
/// "Optional self-contained SVG signature (from SignaturePad), stored as
/// text" - the reference's `SignaturePad` component produces raw SVG
/// markup. This port instead follows the convention BOTH existing Flutter
/// signature pads in this codebase already established: a raster PNG `data:`
/// URL captured via the `signature` package's `toPngBytes()`, plus the raw
/// stroke points as a small JSON array (kept for the same reason
/// `inspection_approval_signature_pad.dart`'s own comment gives: "should a
/// future audit trail ever want it, the raw stroke points... reconstruct the
/// ACT, which is what makes a mark defensible if it is ever disputed"). This
/// is an intentional, disclosed deviation from the mobile source's SVG
/// format for INTERNAL consistency within this Flutter port - not a fresh
/// choice made for this feature alone - because porting the SVG-path
/// generation `signature` (a stroke-point package) does not provide, purely
/// to match a text ENCODING with no functional difference to the stored
/// column, would introduce a THIRD signature representation into a codebase
/// that has already settled on one.
///
/// # `value` re-hydration
///
/// [value] is supported for the same reason the two mirrored pads support
/// it: the review sheet this pad sits inside can rebuild (a locale change,
/// a parent `setState`), and without it a signature already drawn would
/// come back blank with Clear then erasing it. A raster payload cannot be
/// re-loaded into a LIVE drawing surface for further editing, so a
/// pre-existing value shows as a STATIC preview with a "Draw a new
/// signature" action - nothing is re-committed until the pad is drawn on
/// again.
///
/// # UNVERIFIED against real source
///
/// Same caveat as both mirrored pads: written against `signature`'s long
/// -stable, widely documented public surface; there is no resolvable pub
/// cache in this environment to check it against installed source.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

/// One captured signature, ready for [SubmitMeterLogInput.signatureDataUrl].
final class MeterLogSignatureCapture {
  const MeterLogSignatureCapture({required this.dataUrl, this.strokesJson});

  final String dataUrl;
  final String? strokesJson;
}

class MeterLogSignaturePad extends StatefulWidget {
  const MeterLogSignaturePad({
    required this.onChanged,
    this.value,
    this.height = 170,
    super.key,
  });

  /// A previously-captured `data:` URL, if any. See the library comment.
  final String? value;

  final ValueChanged<MeterLogSignatureCapture?> onChanged;
  final double height;

  @override
  State<MeterLogSignaturePad> createState() => _MeterLogSignaturePadState();
}

class _MeterLogSignaturePadState extends State<MeterLogSignaturePad> {
  late SignatureController _controller;

  /// See the library comment - starts `true` whenever a value was handed in.
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
      MeterLogSignatureCapture(dataUrl: dataUrl, strokesJson: strokesJson),
    );
  }

  void _startRedraw() {
    // Emits null FIRST - leaving it attached while the pad reads empty is
    // how a stale signature reaches a submitted reading nobody meant to
    // sign - mirrors both mirrored pads' own `_startRedraw`.
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
                  l10n.meterLogSignatureSavedLabel,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            ),
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.text(
            label: l10n.meterLogSignatureRedraw,
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
