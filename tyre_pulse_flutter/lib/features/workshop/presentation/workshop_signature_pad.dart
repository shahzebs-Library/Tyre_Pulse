/// The technician's signature on a job completion.
///
/// A self-contained copy of the technique `meter_log_signature_pad.dart`
/// documents (features do not import each other's presentation layers): a
/// `signature` package drawing surface, exported as a PNG `data:` URL - the
/// one signature representation this Flutter port has settled on. A value
/// handed back in (the sheet rebuilt) shows as a static preview with
/// "Sign again", so a signature is never silently erased.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

class WorkshopSignaturePad extends StatefulWidget {
  const WorkshopSignaturePad({
    required this.onChanged,
    required this.clearLabel,
    required this.redrawLabel,
    this.value,
    this.height = 150,
    super.key,
  });

  final String? value;
  final ValueChanged<String?> onChanged;
  final String clearLabel;
  final String redrawLabel;
  final double height;

  @override
  State<WorkshopSignaturePad> createState() => _WorkshopSignaturePadState();
}

class _WorkshopSignaturePadState extends State<WorkshopSignaturePad> {
  late final SignatureController _controller;
  late bool _showingPreview;

  @override
  void initState() {
    super.initState();
    _controller = SignatureController(
      onDrawEnd: _onStrokeEnd,
      penStrokeWidth: 3,
      penColor: Colors.black,
      exportBackgroundColor: Colors.white,
    );
    _showingPreview = widget.value != null;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onStrokeEnd() async {
    if (_controller.isEmpty) return;
    final Uint8List? png = await _controller.toPngBytes();
    if (png == null || !mounted) return;
    widget.onChanged('data:image/png;base64,${base64Encode(png)}');
  }

  void _redraw() {
    widget.onChanged(null);
    _controller.clear();
    setState(() => _showingPreview = false);
  }

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final BoxDecoration frame = BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(TpRadius.md),
      border: Border.all(color: palette.controlBorder),
    );
    if (_showingPreview && widget.value != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Container(
            height: widget.height,
            decoration: frame,
            child: Image.memory(
              _decode(widget.value!),
              fit: BoxFit.contain,
              errorBuilder: (BuildContext c, Object e, StackTrace? s) =>
                  const Center(child: Icon(Icons.draw_outlined)),
            ),
          ),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: TpButton.text(
              label: widget.redrawLabel,
              icon: Icons.edit_outlined,
              onPressed: _redraw,
            ),
          ),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        // Ink on paper in both themes: a signature is always dark-on-white.
        DecoratedBox(
          decoration: frame,
          child: Signature(
            controller: _controller,
            height: widget.height,
            backgroundColor: Colors.white,
          ),
        ),
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: TpButton.text(
            label: widget.clearLabel,
            onPressed: () {
              _controller.clear();
              widget.onChanged(null);
            },
          ),
        ),
      ],
    );
  }

  static Uint8List _decode(String dataUrl) {
    final int comma = dataUrl.indexOf(',');
    try {
      return base64Decode(comma < 0 ? dataUrl : dataUrl.substring(comma + 1));
    } on Object {
      return Uint8List(0);
    }
  }
}
