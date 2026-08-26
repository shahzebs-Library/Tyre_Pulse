/// A signature capture surface for one checklist signing slot (a
/// `signature`-type field, or the template-level pad).
///
/// A close mirror of
/// `features/inspections/presentation/widgets/inspection_signature_pad.dart`
/// (read there, never imported from here - every feature owns its own copy
/// of this small, self-contained technique per this port's boundary rules,
/// and this feature genuinely needs a DIFFERENT shape: an inspection has
/// exactly one signing slot, a checklist sheet can carry several - one per
/// `signature`-type field, plus an optional template-level pad - each of
/// which gets its OWN instance of this widget).
///
/// Same package choice and the same two payload shapes, for the same
/// reasons: `signature` package, `toPngBytes()` -> `data:image/png;base64,`
/// URL for [MediaDao.saveSignature]'s `payload`/`format` columns, and
/// `.points` -> a small JSON array for `strokesJson` ("the raw strokes
/// reconstruct the ACT, which is what makes a mark defensible if it is ever
/// disputed").
///
/// [value] re-hydration and the "pre-filling is not signing" redraw flow are
/// carried over verbatim from the inspection pad.
///
/// # UNVERIFIED against real source
///
/// Same caveat as the file this mirrors: there is no resolvable pub cache in
/// this environment, so `signature`'s exact API surface is written against
/// this project's best understanding of a long-stable, widely-documented
/// package rather than against installed source.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

/// One captured signature, ready for [ChecklistDraftRepository.saveSignature].
class ChecklistSignatureCapture {
  const ChecklistSignatureCapture({required this.dataUrl, this.strokesJson});

  final String dataUrl;
  final String? strokesJson;
}

class ChecklistSignaturePad extends StatefulWidget {
  const ChecklistSignaturePad({
    required this.onChanged,
    this.value,
    this.height = 170,
    super.key,
  });

  /// A previously-captured `data:` URL, if any.
  final String? value;

  final ValueChanged<ChecklistSignatureCapture?> onChanged;
  final double height;

  @override
  State<ChecklistSignaturePad> createState() => _ChecklistSignaturePadState();
}

class _ChecklistSignaturePadState extends State<ChecklistSignaturePad> {
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
      ChecklistSignatureCapture(dataUrl: dataUrl, strokesJson: strokesJson),
    );
  }

  void _startRedraw() {
    // Emits null FIRST - leaving it attached while the pad reads empty is
    // how a stale signature reaches a decision nobody meant to sign with.
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
                  l10n.checklistSignatureSavedLabel,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            ),
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.text(
            label: l10n.checklistSignatureRedraw,
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
