/// A grid of handover evidence photos, each a local device path or a durable
/// `tp-storage://` reference, with optional add and per-photo remove controls.
///
/// A `tp-storage://` reference is resolved to a short-lived signed URL through
/// the shared `privateStorageImageUrlProvider`; a local path renders straight
/// from the file. An unreadable reference stays visible as an explicit
/// "unavailable" tile so evidence never silently vanishes.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';

class HandoverPhotoGrid extends StatelessWidget {
  const HandoverPhotoGrid({
    required this.references,
    this.onAdd,
    this.onRemove,
    super.key,
  });

  /// Photo references: local device paths, `tp-storage://` refs, `data:` URLs
  /// or http(s) URLs.
  final List<String> references;

  /// Shows an "add" tile when non-null.
  final VoidCallback? onAdd;

  /// Shows a remove control on each tile when non-null.
  final ValueChanged<int>? onRemove;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        const double spacing = TpSpace.sm;
        final int columns = constraints.maxWidth >= 360 ? 3 : 2;
        final double tile =
            (constraints.maxWidth - spacing * (columns - 1)) / columns;
        return Wrap(
          spacing: spacing,
          runSpacing: spacing,
          children: <Widget>[
            for (int i = 0; i < references.length; i++)
              SizedBox(
                width: tile,
                height: tile,
                child: _PhotoTile(
                  reference: references[i],
                  onRemove: onRemove == null ? null : () => onRemove!(i),
                ),
              ),
            if (onAdd != null)
              SizedBox(
                width: tile,
                height: tile,
                child: _AddTile(onTap: onAdd!),
              ),
          ],
        );
      },
    );
  }
}

class _AddTile extends StatelessWidget {
  const _AddTile({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return Material(
      color: palette.surfaceSunken,
      borderRadius: BorderRadius.circular(TpRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(TpRadius.md),
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(TpRadius.md),
            border: Border.all(color: palette.border),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Icon(Icons.add_a_photo_outlined, color: palette.textMuted),
              const SizedBox(height: TpSpace.xs),
              Text(
                l10n.handoverAddPhoto,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.labelSmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PhotoTile extends ConsumerWidget {
  const _PhotoTile({required this.reference, this.onRemove});

  final String reference;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpPalette palette = TpPalette.of(context);
    return ClipRRect(
      borderRadius: BorderRadius.circular(TpRadius.md),
      child: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          ColoredBox(
            color: palette.surfaceSunken,
            child: _image(context, ref),
          ),
          if (onRemove != null)
            Positioned(
              top: 4,
              right: 4,
              child: Material(
                color: Colors.black54,
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: onRemove,
                  child: const Padding(
                    padding: EdgeInsets.all(4),
                    child: Icon(Icons.close, size: 16, color: Colors.white),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _image(BuildContext context, WidgetRef ref) {
    final String value = reference.trim();
    final String lower = value.toLowerCase();

    if (lower.startsWith('data:')) {
      final Uri? uri = Uri.tryParse(value);
      final UriData? data = uri?.data;
      if (data != null && data.mimeType.toLowerCase().startsWith('image/')) {
        return Image.memory(
          data.contentAsBytes(),
          fit: BoxFit.cover,
          errorBuilder: _broken,
        );
      }
      return _unavailable(context);
    }
    if (needsPrivateStorageResolution(value)) {
      final AsyncValue<String> resolved =
          ref.watch(privateStorageImageUrlProvider(value));
      return resolved.when(
        data: (String url) =>
            Image.network(url, fit: BoxFit.cover, errorBuilder: _broken),
        loading: () => const Center(
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
        error: (_, __) => _unavailable(context),
      );
    }
    if (lower.startsWith('http://') || lower.startsWith('https://')) {
      return Image.network(value, fit: BoxFit.cover, errorBuilder: _broken);
    }
    // A local filesystem path.
    return Image.file(File(value), fit: BoxFit.cover, errorBuilder: _broken);
  }

  Widget _broken(BuildContext context, Object error, StackTrace? stack) =>
      _unavailable(context);

  Widget _unavailable(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(Icons.broken_image_outlined, color: palette.textMuted),
          const SizedBox(height: 2),
          Text(
            l10n.valueUnavailable,
            style: Theme.of(context).textTheme.labelSmall,
          ),
        ],
      ),
    );
  }
}
