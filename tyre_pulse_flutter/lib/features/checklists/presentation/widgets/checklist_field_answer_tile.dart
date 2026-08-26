/// Renders ONE checklist field and its current answer, for the given type.
///
/// # Deliberately reusable, read-only capable
///
/// This is the single per-field rendering widget for the whole feature - the
/// fill screen uses it in EDIT mode; a later approvals/checklist-review
/// screen (a separate phase, dispatched after this one) is expected to reuse
/// it in READ-ONLY mode rather than re-implementing per-type rendering a
/// second time. Every mutation callback ([onChanged], [onNoteChanged],
/// [onCapturePhoto], [onRemovePhoto], [onSignatureChanged]) is independently
/// nullable: passing `null` for all of them renders every field type as a
/// plain, non-interactive read-out (still showing its label, its resolved
/// value, its photos and its signature) with no code path that could mutate
/// anything - the correct shape for a reviewer looking at an already
/// submitted sheet.
///
/// # What this widget does NOT decide
///
/// It never computes whether a field is REQUIRED, whether it is VISIBLE
/// (the caller filters with `visibleChecklistFields`/`isFieldVisible`
/// before ever building one of these), whether a value is
/// VALID (`checklist_validation.dart`), or whether a note is demanded
/// (`checklist_marks.dart`). All of that is the caller's responsibility;
/// this widget only renders whatever it is told, plus the `errorText`/
/// `noteRequired` flags a caller (which HAS already asked those questions)
/// hands it.
///
/// # Text-input state, and why this is a [StatefulWidget]
///
/// `text`/`textarea`/`number` fields own an internal [TextEditingController]
/// so the caret and selection survive a parent rebuild triggered by
/// answering a DIFFERENT field (a `ListView` of these tiles rebuilds on
/// every keystroke in a dynamic-form screen, and a fresh `TextField` per
/// build would lose focus/caret position). The controller only re-syncs
/// its text from [value] when [value] genuinely changed AND does not
/// already match what the controller holds - the guard that stops an
/// external auto-fill/resume from fighting the operator's own typing on the
/// common path (where a keystroke round-trips back down as the identical
/// value it just sent up).
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_i18n.dart';

/// Where a photo answer should come from - mirrors
/// `data/checklist_photo_capture.dart`'s own enum without this presentation
/// widget depending on that data-layer file directly (it only needs a
/// two-value choice to hand back through [onCapturePhoto]).
enum ChecklistPhotoPickSource { camera, gallery }

class ChecklistFieldAnswerTile extends StatefulWidget {
  const ChecklistFieldAnswerTile({
    required this.field,
    required this.label,
    required this.value,
    this.options = const <ChecklistFieldOption>[],
    this.onChanged,
    this.readOnly = false,
    this.locked = false,
    this.errorText,
    this.note,
    this.onNoteChanged,
    this.noteRequired = false,
    this.showNoteField = true,
    this.photos = const <String>[],
    this.onCapturePhoto,
    this.onRemovePhoto,
    this.signatureBuilder,
    super.key,
  });

  final ChecklistField field;

  /// The already-translated label to show - see `checklist_i18n.dart`'s
  /// `fieldLabel`.
  final String label;

  /// The current answer, in the SAME shape [ChecklistField] stores it:
  /// `String` for text/number/select/date, `List<Object?>` for multiselect,
  /// `bool?` for boolean, `num` for rating.
  final Object? value;

  /// The resolved English-value/translated-label pairs for select/
  /// multiselect, from `checklist_i18n.dart`'s `fieldOptions`.
  final List<ChecklistFieldOption> options;

  /// Null renders this field's value control as read-only.
  final ValueChanged<Object?>? onChanged;

  /// True renders the value read-only even when [onChanged] is supplied -
  /// see `checklist_auto_fill.dart`'s `isFieldLocked`.
  final bool readOnly;

  /// True renders the value read-only UNCONDITIONALLY, with no way to ever
  /// unlock it in this screen.
  final bool locked;

  final String? errorText;

  /// The remark currently recorded for this field, if any.
  final String? note;

  final ValueChanged<String>? onNoteChanged;

  /// Highlights the note field as required right now (a mark demands one
  /// and none has been given) - see `checklist_marks.dart`'s
  /// `missingNotes`.
  final bool noteRequired;

  /// Whether a note control should render at all for this field (the
  /// caller has already checked `field.allowNote != false`).
  final bool showNoteField;

  final List<String> photos;

  /// Null hides the "add a photo" control entirely (read-only mode).
  final Future<void> Function(ChecklistPhotoPickSource source)? onCapturePhoto;

  final ValueChanged<String>? onRemovePhoto;

  /// Builds the signature capture/preview surface for a `signature`-type
  /// field. Kept as an injected builder (rather than this widget owning a
  /// concrete pad widget) so this presentation-only file has no dependency
  /// on the `signature` package or on `checklist_signature_pad.dart` - the
  /// caller supplies the pad, this widget only lays it out with the field's
  /// label and error text around it. `null` renders nothing beyond the
  /// label for a signature field, which only happens if a caller genuinely
  /// has no pad to offer.
  final WidgetBuilder? signatureBuilder;

  @override
  State<ChecklistFieldAnswerTile> createState() =>
      _ChecklistFieldAnswerTileState();
}

class _ChecklistFieldAnswerTileState extends State<ChecklistFieldAnswerTile> {
  TextEditingController? _controller;
  TextEditingController? _noteController;

  bool get _isTextLike =>
      widget.field.type == 'text' ||
      widget.field.type == 'textarea' ||
      widget.field.type == 'number' ||
      widget.field.type == 'date' ||
      widget.field.type == 'asset' ||
      widget.field.type == 'user';

  @override
  void initState() {
    super.initState();
    if (_isTextLike) {
      _controller = TextEditingController(text: _asText(widget.value));
    }
    _noteController = TextEditingController(text: widget.note ?? '');
  }

  @override
  void didUpdateWidget(covariant ChecklistFieldAnswerTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    final TextEditingController? c = _controller;
    if (c != null && oldWidget.value != widget.value) {
      final String incoming = _asText(widget.value);
      if (c.text != incoming) c.text = incoming;
    }
    final TextEditingController? n = _noteController;
    if (n != null && oldWidget.note != widget.note) {
      final String incoming = widget.note ?? '';
      if (n.text != incoming) n.text = incoming;
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    _noteController?.dispose();
    super.dispose();
  }

  static String _asText(Object? value) => value == null ? '' : value.toString();

  bool get _isEditable =>
      !widget.locked && !widget.readOnly && widget.onChanged != null;

  @override
  Widget build(BuildContext context) {
    if (widget.field.type == 'section') {
      return _SectionHeader(label: widget.label);
    }

    final Widget valueControl = switch (widget.field.type) {
      'text' => _textField(context, maxLines: 1),
      'textarea' => _textField(context, maxLines: 4),
      'number' => _numberField(context),
      'date' => _dateField(context),
      'select' => _selectField(context),
      'multiselect' => _multiselectField(context),
      'boolean' => _booleanField(context),
      'rating' => _ratingField(context),
      'asset' || 'user' => _referenceTextField(context),
      'site' => _siteField(context),
      'photo' => _photoField(context),
      'signature' => _signatureField(context),
      _ => _unknownTypeField(context),
    };

    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          valueControl,
          if (widget.showNoteField &&
              widget.field.type != 'photo' &&
              widget.field.type != 'signature')
            Padding(
              padding: const EdgeInsets.only(top: TpSpace.sm),
              child: _noteField(context),
            ),
        ],
      ),
    );
  }

  // -- Text-like -------------------------------------------------------

  Widget _textField(BuildContext context, {required int maxLines}) {
    return TpInput(
      label: widget.label,
      controller: _controller,
      isRequired: widget.field.required,
      enabled: _isEditable,
      maxLines: maxLines,
      errorText: widget.errorText,
      helperText: widget.field.help,
      onChanged: _isEditable ? (String v) => widget.onChanged?.call(v) : null,
    );
  }

  Widget _numberField(BuildContext context) {
    final String? helper = widget.field.unit == null
        ? widget.field.help
        : '${widget.field.help ?? ''}${(widget.field.help ?? '').isEmpty ? '' : ' '}'
            '(${widget.field.unit})';
    return TpInput(
      label: widget.label,
      controller: _controller,
      isRequired: widget.field.required,
      enabled: _isEditable,
      keyboardType: const TextInputType.numberWithOptions(
        decimal: true,
        signed: true,
      ),
      errorText: widget.errorText,
      helperText: helper,
      suffix: widget.field.unit == null
          ? null
          : Padding(
              padding: const EdgeInsets.only(right: TpSpace.md),
              child: Center(widthFactor: 1, child: Text(widget.field.unit!)),
            ),
      onChanged: _isEditable ? (String v) => widget.onChanged?.call(v) : null,
    );
  }

  Widget _dateField(BuildContext context) {
    return TpInput(
      label: widget.label,
      controller: _controller,
      isRequired: widget.field.required,
      enabled: false,
      errorText: widget.errorText,
      hint: 'YYYY-MM-DD',
      suffix: _isEditable
          ? IconButton(
              icon: const Icon(Icons.calendar_today_outlined),
              onPressed: () => _pickDate(context),
            )
          : null,
    );
  }

  Future<void> _pickDate(BuildContext context) async {
    final DateTime now = DateTime.now();
    final DateTime initial = DateTime.tryParse(_controller?.text ?? '') ?? now;
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(now.year - 10),
      lastDate: DateTime(now.year + 10),
    );
    if (picked == null) return;
    final String iso = '${picked.year.toString().padLeft(4, '0')}-'
        '${picked.month.toString().padLeft(2, '0')}-'
        '${picked.day.toString().padLeft(2, '0')}';
    _controller?.text = iso;
    widget.onChanged?.call(iso);
  }

  // -- Choice ------------------------------------------------------------

  Widget _selectField(BuildContext context) {
    final String? current = widget.value?.toString();
    final bool hasCurrent =
        current != null && widget.options.any((o) => o.value == current);
    return TpDropdown<String>(
      label: widget.label,
      isRequired: widget.field.required,
      value: hasCurrent ? current : null,
      items: <TpDropdownItem<String>>[
        for (final ChecklistFieldOption o in widget.options)
          TpDropdownItem<String>(value: o.value, label: o.label),
      ],
      errorText: widget.errorText,
      onChanged: _isEditable ? (String? v) => widget.onChanged?.call(v) : null,
    );
  }

  Widget _multiselectField(BuildContext context) {
    final List<Object?> current = widget.value is List
        ? widget.value! as List<Object?>
        : const <Object?>[];
    final Set<String> selected = <String>{
      for (final Object? v in current) v?.toString() ?? '',
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Flexible(
              child: Text(
                widget.label,
                style: Theme.of(context).textTheme.labelMedium,
              ),
            ),
            if (widget.field.required) ...<Widget>[
              const SizedBox(width: TpSpace.xs),
              Text(
                AppLocalizations.of(context).fieldRequired,
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: TpPalette.of(context).critical.base),
              ),
            ],
          ],
        ),
        const SizedBox(height: TpSpace.xs),
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (final ChecklistFieldOption o in widget.options)
              FilterChip(
                label: Text(o.label),
                selected: selected.contains(o.value),
                onSelected: _isEditable
                    ? (bool isSelected) {
                        final Set<String> next = <String>{...selected};
                        if (isSelected) {
                          next.add(o.value);
                        } else {
                          next.remove(o.value);
                        }
                        widget.onChanged?.call(next.toList(growable: false));
                      }
                    : null,
              ),
          ],
        ),
        if (widget.errorText != null) ...<Widget>[
          const SizedBox(height: TpSpace.xs),
          Text(
            widget.errorText!,
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: TpPalette.of(context).critical.base),
          ),
        ],
      ],
    );
  }

  Widget _booleanField(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool? current = widget.value is bool ? widget.value! as bool : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Flexible(
              child: Text(
                widget.label,
                style: Theme.of(context).textTheme.labelMedium,
              ),
            ),
            if (widget.field.required) ...<Widget>[
              const SizedBox(width: TpSpace.xs),
              Text(
                l10n.fieldRequired,
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: TpPalette.of(context).critical.base),
              ),
            ],
          ],
        ),
        const SizedBox(height: TpSpace.xs),
        Row(
          children: <Widget>[
            ChoiceChip(
              label: Text(l10n.checklistYes),
              selected: current == true,
              onSelected:
                  _isEditable ? (bool _) => widget.onChanged?.call(true) : null,
            ),
            const SizedBox(width: TpSpace.sm),
            ChoiceChip(
              label: Text(l10n.checklistNo),
              selected: current == false,
              onSelected: _isEditable
                  ? (bool _) => widget.onChanged?.call(false)
                  : null,
            ),
          ],
        ),
      ],
    );
  }

  Widget _ratingField(BuildContext context) {
    final int current =
        widget.value is num ? (widget.value! as num).round() : 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(widget.label, style: Theme.of(context).textTheme.labelMedium),
        const SizedBox(height: TpSpace.xs),
        Row(
          children: <Widget>[
            for (int i = 1; i <= 5; i++)
              IconButton(
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                icon: Icon(
                  i <= current ? Icons.star : Icons.star_border,
                  color: TpPalette.of(context).primary,
                ),
                onPressed: _isEditable ? () => widget.onChanged?.call(i) : null,
              ),
          ],
        ),
      ],
    );
  }

  // -- Reference -----------------------------------------------------------

  Widget _referenceTextField(BuildContext context) {
    return TpInput(
      label: widget.label,
      controller: _controller,
      isRequired: widget.field.required,
      enabled: _isEditable,
      errorText: widget.errorText,
      helperText: widget.field.help,
      onChanged: _isEditable ? (String v) => widget.onChanged?.call(v) : null,
    );
  }

  Widget _siteField(BuildContext context) {
    // The controller-backed text field is the honest fallback when no live
    // site list is available; the fill screen may instead pass a resolved
    // dropdown by supplying `options` (site names re-used as
    // value==label pairs) - handled the same as `select` in that case.
    if (widget.options.isNotEmpty) {
      return _selectField(context);
    }
    return _referenceTextField(context);
  }

  // -- Media -----------------------------------------------------------

  Widget _photoField(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Flexible(
              child: Text(
                widget.label,
                style: Theme.of(context).textTheme.labelMedium,
              ),
            ),
            if (widget.field.required) ...<Widget>[
              const SizedBox(width: TpSpace.xs),
              Text(
                l10n.fieldRequired,
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: TpPalette.of(context).critical.base),
              ),
            ],
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (final String path in widget.photos)
              _PhotoThumbnail(
                path: path,
                onRemove: widget.onRemovePhoto == null
                    ? null
                    : () => widget.onRemovePhoto!(path),
              ),
            if (widget.onCapturePhoto != null)
              _AddPhotoButton(onTap: () => _pickPhotoSource(context)),
          ],
        ),
        if (widget.errorText != null) ...<Widget>[
          const SizedBox(height: TpSpace.xs),
          Text(
            widget.errorText!,
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: TpPalette.of(context).critical.base),
          ),
        ],
      ],
    );
  }

  Future<void> _pickPhotoSource(BuildContext context) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ChecklistPhotoPickSource? source =
        await TpBottomSheet.show<ChecklistPhotoPickSource>(
      context: context,
      title: l10n.checklistAddPhotoTitle,
      builder: (BuildContext sheetContext) {
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text(l10n.checklistPhotoSourceCamera),
              onTap: () => Navigator.of(sheetContext)
                  .pop(ChecklistPhotoPickSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(l10n.checklistPhotoSourceGallery),
              onTap: () => Navigator.of(sheetContext)
                  .pop(ChecklistPhotoPickSource.gallery),
            ),
          ],
        );
      },
    );
    if (source == null) return;
    await widget.onCapturePhoto?.call(source);
  }

  Widget _signatureField(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Flexible(
              child: Text(
                widget.label,
                style: Theme.of(context).textTheme.labelMedium,
              ),
            ),
            if (widget.field.required) ...<Widget>[
              const SizedBox(width: TpSpace.xs),
              Text(
                AppLocalizations.of(context).fieldRequired,
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: TpPalette.of(context).critical.base),
              ),
            ],
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        if (widget.signatureBuilder != null) widget.signatureBuilder!(context),
        if (widget.errorText != null) ...<Widget>[
          const SizedBox(height: TpSpace.xs),
          Text(
            widget.errorText!,
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: TpPalette.of(context).critical.base),
          ),
        ],
      ],
    );
  }

  Widget _unknownTypeField(BuildContext context) {
    // An unrecognised type token (a template from a newer app version, or a
    // genuinely malformed field) is still rendered, never dropped - see
    // `checklist_field_type.dart`'s own library comment: every predicate
    // answers false/null for it rather than throwing, and the field is
    // still a real element of the array a caller needs to be able to
    // round-trip.
    return _referenceTextField(context);
  }

  Widget _noteField(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpInput(
      label: widget.noteRequired
          ? l10n.checklistNoteRequiredLabel
          : l10n.checklistNoteLabel,
      controller: _noteController,
      enabled: widget.onNoteChanged != null,
      maxLines: 2,
      isRequired: widget.noteRequired,
      onChanged: widget.onNoteChanged,
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: TpSpace.lg, bottom: TpSpace.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: TpSpace.xs),
          Divider(color: TpPalette.of(context).border, height: 1),
        ],
      ),
    );
  }
}

class _PhotoThumbnail extends StatelessWidget {
  const _PhotoThumbnail({required this.path, this.onRemove});

  final String path;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Stack(
      children: <Widget>[
        ClipRRect(
          borderRadius: BorderRadius.circular(TpRadius.md),
          child: SizedBox(
            width: 72,
            height: 72,
            child: Image.file(
              File(path),
              fit: BoxFit.cover,
              errorBuilder: (context, error, stack) => ColoredBox(
                color: palette.surfaceAlt,
                child: Icon(
                  Icons.broken_image_outlined,
                  color: palette.textMuted,
                ),
              ),
            ),
          ),
        ),
        if (onRemove != null)
          Positioned(
            top: -TpSpace.xs,
            right: -TpSpace.xs,
            child: InkWell(
              onTap: onRemove,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: palette.critical.base,
                  shape: BoxShape.circle,
                ),
                child: const Padding(
                  padding: EdgeInsets.all(2),
                  child: Icon(Icons.close, size: 14, color: Colors.white),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _AddPhotoButton extends StatelessWidget {
  const _AddPhotoButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(TpRadius.md),
      child: Container(
        width: 72,
        height: 72,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(TpRadius.md),
          border: Border.all(color: palette.borderStrong),
        ),
        child: Icon(Icons.add_a_photo_outlined, color: palette.textSecondary),
      ),
    );
  }
}
