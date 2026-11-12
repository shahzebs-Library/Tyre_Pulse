/// A bottom sheet to add or edit one damage marker on a handover.
///
/// Captures the contract fields `view / type / level / note / photo` (x and y
/// stay null - this is the list editor, not a tap-on-diagram placement, so no
/// coordinate is invented). Returns the built [HandoverDamageMarker] on save,
/// or null when dismissed.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/handover/data/handover_photo_capture.dart';
import 'package:tyre_pulse/features/handover/domain/handover_damage_marker.dart';
import 'package:tyre_pulse/features/handover/handover_providers.dart';
import 'package:tyre_pulse/features/handover/presentation/handover_copy.dart';

/// Opens the add/edit damage sheet. [sessionKey] scopes any photo captured
/// into the draft folder. Returns the marker to add/replace, or null.
Future<HandoverDamageMarker?> showHandoverDamageSheet(
  BuildContext context, {
  required String sessionKey,
  HandoverDamageMarker? initial,
}) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  return TpBottomSheet.show<HandoverDamageMarker>(
    context: context,
    title: initial == null
        ? l10n.handoverDamageAddTitle
        : l10n.handoverDamageEditTitle,
    builder: (BuildContext sheetContext) => _HandoverDamageForm(
      sessionKey: sessionKey,
      initial: initial,
    ),
  );
}

class _HandoverDamageForm extends ConsumerStatefulWidget {
  const _HandoverDamageForm({required this.sessionKey, this.initial});

  final String sessionKey;
  final HandoverDamageMarker? initial;

  @override
  ConsumerState<_HandoverDamageForm> createState() =>
      _HandoverDamageFormState();
}

class _HandoverDamageFormState extends ConsumerState<_HandoverDamageForm> {
  late HandoverDamageView _view;
  late HandoverDamageType _type;
  late HandoverDamageLevel _level;
  late final TextEditingController _note;
  String? _photoLocalPath;
  String? _photoUrl;
  bool _capturing = false;

  @override
  void initState() {
    super.initState();
    _view = widget.initial?.view ?? HandoverDamageView.front;
    _type = widget.initial?.type ?? HandoverDamageType.scratch;
    _level = widget.initial?.level ?? HandoverDamageLevel.minor;
    _note = TextEditingController(text: widget.initial?.note ?? '');
    _photoLocalPath = widget.initial?.photoLocalPath;
    _photoUrl = widget.initial?.photoUrl;
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _capture(HandoverPhotoSource source) async {
    if (_capturing) return;
    setState(() => _capturing = true);
    try {
      final String? path = await ref.read(handoverPhotoCaptureProvider).capture(
            sessionKey: widget.sessionKey,
            source: source,
          );
      if (!mounted || path == null) return;
      setState(() {
        _photoLocalPath = path;
        // A freshly captured local photo replaces any earlier uploaded ref.
        _photoUrl = null;
      });
    } on Object {
      // Capture failures are surfaced by the picker itself; a declined pick is
      // a no-op here.
    } finally {
      if (mounted) setState(() => _capturing = false);
    }
  }

  void _save() {
    final String note = _note.text.trim();
    Navigator.of(context).pop(
      HandoverDamageMarker(
        view: _view,
        type: _type,
        level: _level,
        note: note.isEmpty ? null : note,
        photoLocalPath: _photoLocalPath,
        photoUrl: _photoUrl,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool hasPhoto = _photoLocalPath != null || _photoUrl != null;
    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.86,
      ),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          0,
          TpSpace.lg,
          TpSpace.lg,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              l10n.handoverDamageViewLabel,
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: TpSpace.sm),
            TpSegmented<HandoverDamageView>(
              expanded: true,
              value: _view,
              options: <TpSegmentedOption<HandoverDamageView>>[
                for (final HandoverDamageView v in HandoverDamageView.values)
                  TpSegmentedOption<HandoverDamageView>(
                    value: v,
                    label: handoverDamageViewLabel(l10n, v),
                  ),
              ],
              onChanged: (HandoverDamageView v) => setState(() => _view = v),
            ),
            const SizedBox(height: TpSpace.md),
            TpDropdown<HandoverDamageType>(
              label: l10n.handoverDamageTypeLabel,
              value: _type,
              items: <TpDropdownItem<HandoverDamageType>>[
                for (final HandoverDamageType t in HandoverDamageType.values)
                  TpDropdownItem<HandoverDamageType>(
                    value: t,
                    label: handoverDamageTypeLabel(l10n, t),
                  ),
              ],
              onChanged: (HandoverDamageType? t) =>
                  setState(() => _type = t ?? _type),
            ),
            const SizedBox(height: TpSpace.md),
            Text(
              l10n.handoverDamageLevelLabel,
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: TpSpace.sm),
            TpSegmented<HandoverDamageLevel>(
              expanded: true,
              value: _level,
              options: <TpSegmentedOption<HandoverDamageLevel>>[
                for (final HandoverDamageLevel lvl
                    in HandoverDamageLevel.values)
                  TpSegmentedOption<HandoverDamageLevel>(
                    value: lvl,
                    label: handoverDamageLevelLabel(l10n, lvl),
                  ),
              ],
              onChanged: (HandoverDamageLevel lvl) =>
                  setState(() => _level = lvl),
            ),
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: l10n.handoverDamageNoteLabel,
              controller: _note,
              hint: l10n.handoverDamageNoteHint,
              maxLines: 2,
              textCapitalization: TextCapitalization.sentences,
            ),
            const SizedBox(height: TpSpace.md),
            Text(
              l10n.handoverDamagePhotoLabel,
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: TpSpace.sm),
            if (hasPhoto && _photoLocalPath != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(TpRadius.md),
                child: AspectRatio(
                  aspectRatio: 4 / 3,
                  child: Image.file(
                    File(_photoLocalPath!),
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => ColoredBox(
                      color: TpPalette.of(context).surfaceSunken,
                      child: const Center(
                        child: Icon(Icons.broken_image_outlined),
                      ),
                    ),
                  ),
                ),
              ),
            if (hasPhoto && _photoLocalPath == null)
              Text(
                l10n.handoverDamagePhotoStored,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            const SizedBox(height: TpSpace.sm),
            Row(
              children: <Widget>[
                Expanded(
                  child: TpButton.secondary(
                    label: l10n.handoverPhotoCamera,
                    icon: Icons.photo_camera_outlined,
                    isBusy: _capturing,
                    onPressed: _capturing
                        ? null
                        : () => unawaited(_capture(HandoverPhotoSource.camera)),
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: TpButton.secondary(
                    label: l10n.handoverPhotoGallery,
                    icon: Icons.photo_library_outlined,
                    isBusy: _capturing,
                    onPressed: _capturing
                        ? null
                        : () =>
                            unawaited(_capture(HandoverPhotoSource.gallery)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.lg),
            TpButton.primary(
              label: l10n.handoverDamageSave,
              icon: Icons.check,
              onPressed: _save,
            ),
          ],
        ),
      ),
    );
  }
}
