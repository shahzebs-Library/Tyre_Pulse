/// The reviewer's own signature pad, on the checklist approval review
/// screen.
///
/// # Why this feature draws its own signature pad rather than importing
/// # a sibling one
///
/// `features/inspections/presentation/widgets/inspection_signature_pad.dart`,
/// `features/checklists/presentation/widgets/checklist_signature_pad.dart`
/// and `features/approvals/presentation/widgets/inspection_approval_
/// signature_pad.dart` (this feature's own sibling, for INSPECTION
/// approvals) all do the exact same job, and each is its own self-
/// contained copy rather than a shared import - `inspection_approval_
/// signature_pad.dart`'s own library comment states the convention
/// directly: "`lib/features/*` folders in this port do not depend on each
/// other's presentation layers ... small pure value type, no Flutter
/// dependency wanted [is the analogous reasoning for domain types]". This
/// file is a fourth, equally self-contained copy of the same technique,
/// for the SAME reason that pad gives for not reusing the checklist fill
/// screen's own pad: a checklist approval decision's signature is a
/// genuinely different thing from a checklist FILL signature (one signs a
/// DECISION, the other signs an OBSERVATION), captured by a different
/// feature under a different persistence contract - see
/// `queued_checklist_approval_decision.dart`'s library comment on why a
/// decision's signature is NEVER written through `MediaDao`/
/// `CapturedSignatures` the way a checklist-fill signature is.
///
/// Same package choice and the same two payload shapes as every sibling
/// copy, for the same reasons: `signature` package, `toPngBytes()` ->
/// `data:image/png;base64,` URL, and `.points` -> a small JSON array of raw
/// strokes (kept for parity with the sibling pads' contract, even though
/// this feature's own persistence - [QueuedChecklistApprovalDecision] -
/// only carries the `data:` URL onward; the strokes are available to a
/// future audit-trail feature without this file needing to change).
///
/// # `value` re-hydration
///
/// [value] is supported for the same reason every sibling pad supports it:
/// this pad sits inside a scroll view that can rebuild (a pull-to-refresh
/// after a load error, a reload after retrying a decision), and without it
/// a signature already drawn would come back blank with Clear then erasing
/// it. A raster payload cannot be re-loaded into a LIVE drawing surface for
/// further editing, so a pre-existing value shows as a STATIC preview with
/// a "Draw a new signature" action - nothing is re-committed until the pad
/// is drawn on again and confirmed, mirroring the "pre-filling is not
/// signing" rule this codebase applies to a saved signature everywhere
/// else.
///
/// # UNVERIFIED against real source
///
/// Written against `signature`'s long-stable, widely documented public
/// surface, exactly as every sibling pad's own note states - there is no
/// resolvable pub cache in this environment to check it against installed
/// source.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

/// One captured signature, ready for [ChecklistApprovalSyncEngine.decideNow]'s
/// `approverSignature` argument.
class ChecklistApprovalSignatureCapture {
  const ChecklistApprovalSignatureCapture({
    required this.dataUrl,
    this.strokesJson,
  });

  final String dataUrl;
  final String? strokesJson;
}

class ChecklistApprovalSignaturePad extends StatefulWidget {
  const ChecklistApprovalSignaturePad({
    required this.onChanged,
    this.value,
    this.height = 180,
    super.key,
  });

  /// A previously-captured `data:` URL, if any. See the library comment.
  final String? value;

  final ValueChanged<ChecklistApprovalSignatureCapture?> onChanged;
  final double height;

  @override
  State<ChecklistApprovalSignaturePad> createState() =>
      _ChecklistApprovalSignaturePadState();
}

class _ChecklistApprovalSignaturePadState
    extends State<ChecklistApprovalSignaturePad> {
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
      ChecklistApprovalSignatureCapture(
        dataUrl: dataUrl,
        strokesJson: strokesJson,
      ),
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
                  l10n.checklistApprovalSignatureSavedLabel,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            ),
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.text(
            label: l10n.checklistApprovalSignatureRedraw,
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
