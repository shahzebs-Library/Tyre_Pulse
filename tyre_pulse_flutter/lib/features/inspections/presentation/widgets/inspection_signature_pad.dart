/// The inspector's signature pad on the review step.
///
/// # Package choice and the two payload shapes it must produce
///
/// `signature` is the package used - a real drawing surface plus a
/// `SignatureController` that exports both a raster PNG (`toPngBytes()`)
/// and the raw stroke points (`.points`). Both are needed:
/// `MediaDao.saveSignature` requires a payload that is either an `<svg`
/// document or a `data:` URL (see `signaturePayloadFormat` in
/// `media_dao.dart`), and separately accepts an optional `strokesJson` -
/// "the raw strokes reconstruct the ACT, which is what makes a mark
/// defensible if it is ever disputed". A raster PNG re-encoded as a
/// `data:image/png;base64,...` URL satisfies the payload/format columns;
/// the serialised point list satisfies `strokesJson`. Together they
/// satisfy exactly the pair of columns that table was designed to carry -
/// see that table's own doc comment.
///
/// # `value` re-hydration
///
/// [value] is deliberately supported (a pre-existing signature can be
/// shown, matching `SignaturePad`'s own load-bearing `value` prop in
/// production: "this pad lives on one step of a wizard, so stepping back
/// and forward unmounts it. Without it the inspector returned to a blank
/// pad over a signature they had already given"). A raster payload cannot
/// be re-loaded into a LIVE drawing surface for further editing - the
/// `signature` package draws from strokes, not from a decoded image - so
/// re-opening this step with an existing signature shows it as a STATIC
/// preview with a "Draw a new signature" action, exactly mirroring the
/// production pattern this codebase already uses for a saved mark
/// (`savedSignature.ts`'s "pre-filling is not signing" rule): nothing is
/// re-committed until the pad is drawn on again and confirmed.
///
/// # UNVERIFIED against real source
///
/// Written against `signature`'s long-stable, widely documented public
/// surface (`SignatureController(penStrokeWidth:, penColor:,
/// exportBackgroundColor:)`, the `Signature` widget's `controller` /
/// `height` / `backgroundColor` parameters, `toPngBytes()`, `.points`,
/// `.isEmpty`, `.isNotEmpty`, `.clear()`) rather than against installed
/// source - see `inspection_photo_capture.dart`'s note on the same
/// limitation.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

/// One captured signature, ready for [InspectionDraftRepository.
/// saveSignature] and, ultimately, `inspections.inspector_signature`.
class InspectionSignatureCapture {
  const InspectionSignatureCapture({required this.dataUrl, this.strokesJson});

  final String dataUrl;
  final String? strokesJson;
}

class InspectionSignaturePad extends StatefulWidget {
  const InspectionSignaturePad({
    this.onChanged,
    this.value,
    this.height = 180,
    this.readOnly = false,
    super.key,
  }) : assert(readOnly || onChanged != null);

  /// A previously-captured `data:` URL, if any. See the library comment.
  final String? value;

  final ValueChanged<InspectionSignatureCapture?>? onChanged;
  final double height;

  /// Shows a recorded signature without offering redraw/clear controls.
  ///
  /// Detail and approval readers have no draft to persist an edit into, so
  /// presenting an editable pad there would create controls whose changes are
  /// discarded as soon as the screen closes.
  final bool readOnly;

  @override
  State<InspectionSignaturePad> createState() => _InspectionSignaturePadState();
}

class _InspectionSignaturePadState extends State<InspectionSignaturePad> {
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
    final pngBytes = await _controller.toPngBytes();
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
    widget.onChanged?.call(
      InspectionSignatureCapture(dataUrl: dataUrl, strokesJson: strokesJson),
    );
  }

  void _startRedraw() {
    // Emits null FIRST - "leaving it attached while the pad reads empty
    // is how a stale signature reaches a decision nobody meant to sign
    // with it" (the production `startRedraw` rule, ported verbatim).
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
              errorBuilder: (context, error, stack) => Center(
                child: Text(
                  l10n.inspectionSignatureSavedLabel,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            ),
          ),
          if (!widget.readOnly) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            TpButton.text(
              label: l10n.inspectionSignatureRedraw,
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
