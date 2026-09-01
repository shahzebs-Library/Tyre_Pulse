/// Read-only rendering for signatures stored on approval records.
///
/// The verified signature contract accepts either a self-contained `<svg>`
/// document or a base64 `data:` URL. Decoding synchronously in a screen is
/// unsafe: a valid SVG is not base64 and an old malformed value must degrade to
/// an unavailable state rather than escape into the app error boundary.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

class ApprovalSignaturePreview extends StatelessWidget {
  const ApprovalSignaturePreview({
    required this.value,
    required this.fallback,
    this.height,
    super.key,
  });

  final String? value;
  final Widget fallback;
  final double? height;

  @override
  Widget build(BuildContext context) {
    final String signature = value?.trimLeft() ?? '';
    final Widget preview;
    if (signature.startsWith('<svg')) {
      preview = SvgPicture.string(
        signature,
        fit: BoxFit.contain,
        errorBuilder: (context, error, stackTrace) => fallback,
      );
    } else {
      final Uint8List? bytes = approvalSignatureBytes(signature);
      preview = bytes == null
          ? fallback
          : Image.memory(
              bytes,
              fit: BoxFit.contain,
              errorBuilder: (context, error, stackTrace) => fallback,
            );
    }
    return height == null ? preview : SizedBox(height: height, child: preview);
  }
}

@visibleForTesting
Uint8List? approvalSignatureBytes(String value) {
  final int comma = value.indexOf(',');
  if (comma < 0) return null;
  final String metadata = value.substring(0, comma).toLowerCase();
  if (!metadata.startsWith('data:image/') || !metadata.contains(';base64')) {
    return null;
  }
  try {
    return base64Decode(value.substring(comma + 1));
  } on FormatException {
    return null;
  }
}
