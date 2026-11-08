/// One tyre/finding photo on a recorded inspection: an inline thumbnail that
/// opens a full-screen viewer with Save and Share.
///
/// A server reference (`tp-storage://...` or a legacy URL) is resolved to a
/// short-lived signed URL through [privateStorageImageUrlProvider] - Storage
/// RLS still decides access. A local path shows only while the file exists on
/// this device. Nothing else is drawn as a broken image.
///
/// Save uses `file_picker`'s save dialog (already a dependency) so the person
/// chooses where the photo lands; Share hands the photo to the system share
/// sheet wrapped in a one-page PDF through `printing` (already a dependency) -
/// no new package was added for either.
library;

import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_submission_detail.dart'
    show isServerPhotoReference;

/// A photo source: exactly one of [url] (already signed) or [file].
@immutable
class InspectionPhotoSource {
  const InspectionPhotoSource.network(String this.url) : file = null;
  const InspectionPhotoSource.file(File this.file) : url = null;

  final String? url;
  final File? file;

  ImageProvider<Object> get image =>
      url != null ? NetworkImage(url!) : FileImage(file!);

  Future<Uint8List> readBytes() async {
    if (file != null) return file!.readAsBytes();
    final String u = url!;
    final ByteData data = await NetworkAssetBundle(Uri.parse(u)).load(u);
    return data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
  }
}

/// Inline thumbnail for [value] (a stored reference or local path). A blank
/// or unusable value renders the "No photo taken" / "not available" text,
/// never a broken image.
class InspectionFindingPhoto extends ConsumerWidget {
  const InspectionFindingPhoto({
    required this.value,
    required this.fileNameStem,
    this.size = 72,
    super.key,
  });

  /// `photo_url` (server reference) or `photo_uri` (local path); may be null.
  final String? value;

  /// Used for the saved/shared file name, e.g. `TM514_LHF1`.
  final String fileNameStem;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String raw = value?.trim() ?? '';

    Widget box(Widget child) => ClipRRect(
          borderRadius: BorderRadius.circular(TpRadius.md),
          child: SizedBox(width: size, height: size, child: child),
        );
    Widget message(String text, IconData icon) => box(
          ColoredBox(
            color: palette.surfaceAlt,
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.xs),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Icon(icon, size: TpSizing.iconSm, color: palette.textMuted),
                  const SizedBox(height: 2),
                  Text(
                    text,
                    textAlign: TextAlign.center,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(color: palette.textMuted),
                  ),
                ],
              ),
            ),
          ),
        );

    if (raw.isEmpty) {
      return message(l10n.inspectionPhotoNone, Icons.no_photography_outlined);
    }
    final Widget unavailable = message(
      l10n.inspectionPhotoUnavailable,
      Icons.image_not_supported_outlined,
    );

    if (isServerPhotoReference(raw)) {
      final AsyncValue<String> url =
          ref.watch(privateStorageImageUrlProvider(raw));
      return url.when(
        data: (String u) => _tappable(
          context,
          InspectionPhotoSource.network(u),
          box(
            Image.network(
              u,
              fit: BoxFit.cover,
              errorBuilder: (BuildContext c, Object e, StackTrace? s) =>
                  unavailable,
            ),
          ),
        ),
        loading: () => box(
          const Center(
            child: SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ),
        ),
        error: (Object e, StackTrace s) => unavailable,
      );
    }
    final File file = File(raw);
    final bool exists = !kIsWeb && file.existsSync();
    if (!exists) return unavailable;
    return _tappable(
      context,
      InspectionPhotoSource.file(file),
      box(
        Image.file(
          file,
          fit: BoxFit.cover,
          errorBuilder: (BuildContext c, Object e, StackTrace? s) =>
              unavailable,
        ),
      ),
    );
  }

  Widget _tappable(
    BuildContext context,
    InspectionPhotoSource source,
    Widget child,
  ) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Semantics(
      button: true,
      label: l10n.inspectionPhotoOpenLabel,
      child: InkWell(
        borderRadius: BorderRadius.circular(TpRadius.md),
        onTap: () => unawaited(
          showInspectionPhotoViewer(
            context,
            source: source,
            fileNameStem: fileNameStem,
          ),
        ),
        child: child,
      ),
    );
  }
}

/// Full-screen photo with pinch-zoom, Save and Share.
Future<void> showInspectionPhotoViewer(
  BuildContext context, {
  required InspectionPhotoSource source,
  required String fileNameStem,
}) {
  return showDialog<void>(
    context: context,
    builder: (BuildContext dialogContext) =>
        _PhotoViewerDialog(source: source, fileNameStem: fileNameStem),
  );
}

class _PhotoViewerDialog extends StatefulWidget {
  const _PhotoViewerDialog({required this.source, required this.fileNameStem});

  final InspectionPhotoSource source;
  final String fileNameStem;

  @override
  State<_PhotoViewerDialog> createState() => _PhotoViewerDialogState();
}

enum _PhotoBusy { none, save, share }

class _PhotoViewerDialogState extends State<_PhotoViewerDialog> {
  _PhotoBusy _busy = _PhotoBusy.none;
  String? _status;
  bool _statusIsError = false;

  String get _stem {
    final String cleaned =
        widget.fileNameStem.replaceAll(RegExp(r'[^A-Za-z0-9_-]+'), '_');
    return cleaned.isEmpty ? 'inspection_photo' : cleaned;
  }

  Future<void> _run(_PhotoBusy kind) async {
    if (_busy != _PhotoBusy.none) return; // double-tap guard
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() {
      _busy = kind;
      _status = null;
    });
    try {
      final Uint8List bytes = await widget.source.readBytes();
      if (kind == _PhotoBusy.save) {
        final Uri? saved = await FilePicker.saveFile(
          fileName: '$_stem.jpg',
          bytes: bytes,
          mimeType: 'image/jpeg',
          type: FileType.image,
          dialogTitle: l10n.inspectionPhotoSaveAction,
        );
        if (!mounted) return;
        setState(() {
          _status = saved == null ? null : l10n.inspectionPhotoSaved;
          _statusIsError = false;
        });
      } else {
        final pw.Document doc = pw.Document();
        final pw.MemoryImage image = pw.MemoryImage(bytes);
        doc.addPage(
          pw.Page(
            pageFormat: PdfPageFormat.a4,
            build: (pw.Context c) =>
                pw.Center(child: pw.Image(image, fit: pw.BoxFit.contain)),
          ),
        );
        await Printing.sharePdf(
          bytes: await doc.save(),
          filename: '$_stem.pdf',
        );
      }
    } on Object {
      if (!mounted) return;
      setState(() {
        _status = l10n.inspectionPhotoActionFailed;
        _statusIsError = true;
      });
    } finally {
      if (mounted) setState(() => _busy = _PhotoBusy.none);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool busy = _busy != _PhotoBusy.none;
    return Dialog(
      insetPadding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Flexible(
            child: InteractiveViewer(
              child: Image(
                image: widget.source.image,
                fit: BoxFit.contain,
                errorBuilder: (BuildContext c, Object e, StackTrace? s) =>
                    Padding(
                  padding: const EdgeInsets.all(TpSpace.xl),
                  child: Text(l10n.inspectionPhotoUnavailable),
                ),
              ),
            ),
          ),
          if (_status != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                TpSpace.md,
                TpSpace.sm,
                TpSpace.md,
                0,
              ),
              child: Text(
                _status!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: _statusIsError
                          ? palette.forStatus(TpStatus.critical).base
                          : palette.forStatus(TpStatus.ok).base,
                    ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(TpSpace.sm),
            child: Wrap(
              alignment: WrapAlignment.end,
              spacing: TpSpace.sm,
              runSpacing: TpSpace.xs,
              children: <Widget>[
                TpButton.text(
                  label: l10n.inspectionPhotoSaveAction,
                  icon: Icons.download_outlined,
                  isBusy: _busy == _PhotoBusy.save,
                  onPressed:
                      busy ? null : () => unawaited(_run(_PhotoBusy.save)),
                ),
                TpButton.text(
                  label: l10n.inspectionPhotoShareAction,
                  icon: Icons.share_outlined,
                  isBusy: _busy == _PhotoBusy.share,
                  onPressed:
                      busy ? null : () => unawaited(_run(_PhotoBusy.share)),
                ),
                TpButton.text(
                  label: l10n.actionClose,
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
