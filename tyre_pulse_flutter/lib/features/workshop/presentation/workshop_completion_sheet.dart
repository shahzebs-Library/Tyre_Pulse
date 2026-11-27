/// "Finish job" - the completion sheet behind Complete.
///
/// Nothing leaves this sheet until [WorkshopCompletionDraft.missing] is
/// empty: what was done (typed, or quick picks), at least one AFTER photo,
/// and the technician's signature. Parts used (one tap from the job's own
/// parts requests, or typed), a BEFORE photo and the meter readings the
/// asset actually carries are optional. The primary action says what
/// happens next - "Send for supervisor approval" - because the job goes to
/// Quality Inspection, not to closed.
///
/// The sheet returns the draft with LOCAL photo paths; the screen uploads
/// them and queues the command. Cancelling hands the draft back through
/// [onDraftChanged] so a half-filled completion is not lost.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_completion_service.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_photo_capture.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_completion.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_copy.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_signature_pad.dart';

abstract final class WorkshopCompletionKeys {
  static const Key sheet = ValueKey<String>('workshop.completion');
  static const Key workDone = ValueKey<String>('workshop.completion.work-done');
  static Key quickPick(String p) =>
      ValueKey<String>('workshop.completion.pick.$p');
  static Key requestedPart(int i) =>
      ValueKey<String>('workshop.completion.requested-part.$i');
  static const Key partName = ValueKey<String>('workshop.completion.part-name');
  static const Key partQty = ValueKey<String>('workshop.completion.part-qty');
  static const Key addPart = ValueKey<String>('workshop.completion.add-part');
  static const Key afterCamera =
      ValueKey<String>('workshop.completion.after-camera');
  static const Key afterGallery =
      ValueKey<String>('workshop.completion.after-gallery');
  static const Key beforeCamera =
      ValueKey<String>('workshop.completion.before-camera');
  static const Key km = ValueKey<String>('workshop.completion.km');
  static const Key hours = ValueKey<String>('workshop.completion.hours');
  static const Key signature = ValueKey<String>('workshop.completion.sign');
  static const Key submit = ValueKey<String>('workshop.completion.submit');
  static const Key missing = ValueKey<String>('workshop.completion.missing');
}

/// Opens the sheet full screen. Returns the finished draft, or null when the
/// technician backed out.
Future<WorkshopCompletionDraft?> showWorkshopCompletionSheet({
  required BuildContext context,
  required WorkshopCopy copy,
  required WorkshopJob job,
  required WorkshopPhotoPicker picker,
  required Future<List<WorkshopPartUsed>> requestedParts,
  required Future<WorkshopAssetMeters> meters,
  required WorkshopCompletionDraft initial,
  required ValueChanged<WorkshopCompletionDraft> onDraftChanged,
}) {
  return Navigator.of(context).push<WorkshopCompletionDraft>(
    MaterialPageRoute<WorkshopCompletionDraft>(
      fullscreenDialog: true,
      builder: (BuildContext _) => WorkshopCompletionSheet(
        copy: copy,
        job: job,
        picker: picker,
        requestedParts: requestedParts,
        meters: meters,
        initial: initial,
        onDraftChanged: onDraftChanged,
      ),
    ),
  );
}

class WorkshopCompletionSheet extends StatefulWidget {
  const WorkshopCompletionSheet({
    required this.copy,
    required this.job,
    required this.picker,
    required this.requestedParts,
    required this.meters,
    required this.initial,
    required this.onDraftChanged,
    super.key,
  });

  final WorkshopCopy copy;
  final WorkshopJob job;
  final WorkshopPhotoPicker picker;
  final Future<List<WorkshopPartUsed>> requestedParts;
  final Future<WorkshopAssetMeters> meters;
  final WorkshopCompletionDraft initial;
  final ValueChanged<WorkshopCompletionDraft> onDraftChanged;

  @override
  State<WorkshopCompletionSheet> createState() =>
      _WorkshopCompletionSheetState();
}

class _WorkshopCompletionSheetState extends State<WorkshopCompletionSheet> {
  late WorkshopCompletionDraft _draft;
  late final TextEditingController _workDone;
  late final TextEditingController _km;
  late final TextEditingController _hours;
  final TextEditingController _partName = TextEditingController();
  final TextEditingController _partQty = TextEditingController(text: '1');
  List<WorkshopPartUsed> _requested = const <WorkshopPartUsed>[];
  WorkshopAssetMeters _meters = WorkshopAssetMeters.unknown;
  bool _capturing = false;

  WorkshopCopy get _copy => widget.copy;

  @override
  void initState() {
    super.initState();
    _draft = widget.initial;
    _workDone = TextEditingController(text: _draft.workDone);
    _km = TextEditingController(text: _draft.km?.toString() ?? '');
    _hours = TextEditingController(text: _draft.engineHours?.toString() ?? '');
    unawaited(_loadContext());
  }

  Future<void> _loadContext() async {
    try {
      final List<WorkshopPartUsed> parts = await widget.requestedParts;
      if (mounted) setState(() => _requested = parts);
    } on Object {
      // Nothing to pick from; parts can still be typed.
    }
    try {
      final WorkshopAssetMeters m = await widget.meters;
      if (mounted) setState(() => _meters = m);
    } on Object {
      // Unknown: both meter fields stay on offer.
    }
  }

  @override
  void dispose() {
    _workDone.dispose();
    _km.dispose();
    _hours.dispose();
    _partName.dispose();
    _partQty.dispose();
    super.dispose();
  }

  void _update(WorkshopCompletionDraft next) {
    setState(() => _draft = next);
    widget.onDraftChanged(next);
  }

  Future<void> _addPhoto({
    required bool after,
    required WorkshopPhotoSource source,
  }) async {
    final List<String> current =
        after ? _draft.afterPhotos : _draft.beforePhotos;
    if (_capturing || current.length >= kWorkshopCompletionMaxPhotos) return;
    setState(() => _capturing = true);
    String? path;
    try {
      path = await widget.picker.capture(source);
    } on Object {
      path = null;
    }
    if (!mounted) return;
    setState(() => _capturing = false);
    if (path == null) return;
    final List<String> next = <String>[...current, path];
    _update(
      after
          ? _draft.copyWith(afterPhotos: next)
          : _draft.copyWith(beforePhotos: next),
    );
  }

  void _removePhoto({required bool after, required int index}) {
    final List<String> next = <String>[
      ...(after ? _draft.afterPhotos : _draft.beforePhotos),
    ];
    final String removed = next.removeAt(index);
    unawaited(widget.picker.discard(removed));
    _update(
      after
          ? _draft.copyWith(afterPhotos: next)
          : _draft.copyWith(beforePhotos: next),
    );
  }

  void _togglePick(String pick) {
    final Set<String> next = <String>{..._draft.quickPicks};
    if (!next.remove(pick)) next.add(pick);
    _update(_draft.copyWith(quickPicks: next));
  }

  void _toggleRequested(WorkshopPartUsed part) {
    final bool has =
        _draft.parts.any((WorkshopPartUsed p) => p.requestId == part.requestId);
    _update(
      _draft.copyWith(
        parts: has
            ? <WorkshopPartUsed>[
                for (final WorkshopPartUsed p in _draft.parts)
                  if (p.requestId != part.requestId) p,
              ]
            : <WorkshopPartUsed>[..._draft.parts, part],
      ),
    );
  }

  void _addTypedPart() {
    final String name = _partName.text.trim();
    if (name.isEmpty) return;
    final num? qty = num.tryParse(_partQty.text.trim().replaceAll(',', '.'));
    _update(
      _draft.copyWith(
        parts: <WorkshopPartUsed>[
          ..._draft.parts,
          WorkshopPartUsed(
            name: name,
            qty: qty == null || qty <= 0 ? 1 : qty,
          ),
        ],
      ),
    );
    _partName.clear();
    _partQty.text = '1';
  }

  String _label(String pick) => _copy('qp_$pick');

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    final TpPalette palette = TpPalette.of(context);
    final List<WorkshopCompletionGap> missing = _draft.missing(_label);
    final String title =
        widget.job.workOrderNo ?? widget.job.assetNo ?? widget.job.id;

    Widget section(String heading, List<Widget> children, {bool req = false}) =>
        Padding(
          padding: const EdgeInsets.only(bottom: TpSpace.lg),
          child: TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(child: Text(heading, style: text.titleSmall)),
                    if (req)
                      Text(
                        _copy('c_required'),
                        style: text.labelSmall
                            ?.copyWith(color: palette.critical.base),
                      ),
                  ],
                ),
                const SizedBox(height: TpSpace.sm),
                ...children,
              ],
            ),
          ),
        );

    Widget photoRow({required bool after}) {
      final List<String> photos =
          after ? _draft.afterPhotos : _draft.beforePhotos;
      final bool full = photos.length >= kWorkshopCompletionMaxPhotos;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (photos.isNotEmpty)
            SizedBox(
              height: 84,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: photos.length,
                separatorBuilder: (_, __) => const SizedBox(width: TpSpace.sm),
                itemBuilder: (BuildContext c, int i) => _Thumb(
                  path: photos[i],
                  label: '${i + 1}',
                  removeTooltip: _copy('removePhoto'),
                  onRemove: () => _removePhoto(after: after, index: i),
                ),
              ),
            ),
          if (photos.isNotEmpty) const SizedBox(height: TpSpace.sm),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              // Camera first: the evidence is the work in front of them. The
              // optional BEFORE row stays secondary so the required one leads.
              (after ? TpButton.primary : TpButton.secondary)(
                key: after
                    ? WorkshopCompletionKeys.afterCamera
                    : WorkshopCompletionKeys.beforeCamera,
                label: _copy('takePhoto'),
                icon: Icons.photo_camera_outlined,
                isBusy: _capturing,
                onPressed: _capturing || full
                    ? null
                    : () => unawaited(
                          _addPhoto(
                            after: after,
                            source: WorkshopPhotoSource.camera,
                          ),
                        ),
              ),
              TpButton.secondary(
                key: after ? WorkshopCompletionKeys.afterGallery : null,
                label: _copy('pickPhoto'),
                icon: Icons.photo_library_outlined,
                onPressed: _capturing || full
                    ? null
                    : () => unawaited(
                          _addPhoto(
                            after: after,
                            source: WorkshopPhotoSource.gallery,
                          ),
                        ),
              ),
            ],
          ),
        ],
      );
    }

    return Scaffold(
      key: WorkshopCompletionKeys.sheet,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(_copy('completeTitle')),
            Text(title, style: text.bodySmall),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(TpSpace.lg),
        children: <Widget>[
          section(
            _copy('c_whatDone'),
            req: true,
            <Widget>[
              Wrap(
                spacing: TpSpace.sm,
                runSpacing: TpSpace.sm,
                children: <Widget>[
                  for (final String p in kWorkshopQuickPicks)
                    FilterChip(
                      key: WorkshopCompletionKeys.quickPick(p),
                      label: Text(_label(p)),
                      selected: _draft.quickPicks.contains(p),
                      onSelected: (_) => _togglePick(p),
                    ),
                ],
              ),
              const SizedBox(height: TpSpace.sm),
              TextField(
                key: WorkshopCompletionKeys.workDone,
                controller: _workDone,
                maxLines: 3,
                maxLength: 2000,
                decoration: InputDecoration(hintText: _copy('c_whatDoneHint')),
                onChanged: (String v) => _update(_draft.copyWith(workDone: v)),
              ),
            ],
          ),
          section(
            _copy('c_parts'),
            <Widget>[
              if (_requested.isNotEmpty) ...<Widget>[
                Text(_copy('c_partsFromRequests'), style: text.bodySmall),
                const SizedBox(height: TpSpace.xs),
                Wrap(
                  spacing: TpSpace.sm,
                  runSpacing: TpSpace.sm,
                  children: <Widget>[
                    for (int i = 0; i < _requested.length; i++)
                      FilterChip(
                        key: WorkshopCompletionKeys.requestedPart(i),
                        label: Text(
                          '${_requested[i].name} x${_fmt(_requested[i].qty)}',
                        ),
                        selected: _draft.parts.any(
                          (WorkshopPartUsed p) =>
                              p.requestId == _requested[i].requestId,
                        ),
                        onSelected: (_) => _toggleRequested(_requested[i]),
                      ),
                  ],
                ),
                const SizedBox(height: TpSpace.sm),
              ],
              for (final WorkshopPartUsed p in _draft.parts)
                if (p.requestId == null)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: const Icon(Icons.inventory_2_outlined),
                    title: Text('${p.name} x${_fmt(p.qty)}'),
                    trailing: IconButton(
                      tooltip: _copy('c_removePart'),
                      icon: const Icon(Icons.close_rounded),
                      onPressed: () => _update(
                        _draft.copyWith(
                          parts: <WorkshopPartUsed>[
                            for (final WorkshopPartUsed q in _draft.parts)
                              if (!identical(q, p)) q,
                          ],
                        ),
                      ),
                    ),
                  ),
              Row(
                children: <Widget>[
                  Expanded(
                    flex: 3,
                    child: TextField(
                      key: WorkshopCompletionKeys.partName,
                      controller: _partName,
                      decoration: InputDecoration(labelText: _copy('partName')),
                    ),
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: TextField(
                      key: WorkshopCompletionKeys.partQty,
                      controller: _partQty,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: InputDecoration(labelText: _copy('partQty')),
                    ),
                  ),
                  IconButton(
                    key: WorkshopCompletionKeys.addPart,
                    tooltip: _copy('c_addPart'),
                    icon: const Icon(Icons.add_circle_outline),
                    onPressed: _addTypedPart,
                  ),
                ],
              ),
            ],
          ),
          section(
            _copy('c_after'),
            req: true,
            <Widget>[
              Text(_copy('c_afterHint'), style: text.bodySmall),
              const SizedBox(height: TpSpace.sm),
              photoRow(after: true),
            ],
          ),
          section(
            _copy('c_before'),
            <Widget>[photoRow(after: false)],
          ),
          if (_meters.hasKm || _meters.hasHours)
            section(
              _copy('c_meters'),
              <Widget>[
                if (_meters.hasKm)
                  TextField(
                    key: WorkshopCompletionKeys.km,
                    controller: _km,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      labelText: _copy('c_km'),
                      helperText: _meters.lastKm == null
                          ? null
                          : '${_copy('c_last')} ${_fmt(_meters.lastKm!)}',
                    ),
                    onChanged: (String v) => _update(
                      _draft.copyWith(km: () => parseWorkshopMeter(v)),
                    ),
                  ),
                if (_meters.hasHours)
                  TextField(
                    key: WorkshopCompletionKeys.hours,
                    controller: _hours,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      labelText: _copy('c_hours'),
                      helperText: _meters.lastHours == null
                          ? null
                          : '${_copy('c_last')} ${_fmt(_meters.lastHours!)}',
                    ),
                    onChanged: (String v) => _update(
                      _draft.copyWith(engineHours: () => parseWorkshopMeter(v)),
                    ),
                  ),
              ],
            ),
          section(
            _copy('c_signature'),
            req: true,
            <Widget>[
              WorkshopSignaturePad(
                key: WorkshopCompletionKeys.signature,
                value: _draft.signature,
                clearLabel: _copy('c_signClear'),
                redrawLabel: _copy('c_signRedraw'),
                onChanged: (String? v) =>
                    _update(_draft.copyWith(signature: () => v)),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.xxl),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.sm,
            TpSpace.lg,
            TpSpace.md,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              if (missing.isNotEmpty)
                Padding(
                  key: WorkshopCompletionKeys.missing,
                  padding: const EdgeInsets.only(bottom: TpSpace.sm),
                  child: Text(
                    '${_copy('c_stillNeeded')} '
                    '${missing.map((WorkshopCompletionGap g) => _copy('need_${g.name}')).join(' · ')}',
                    style:
                        text.bodySmall?.copyWith(color: palette.textSecondary),
                  ),
                ),
              TpButton.primary(
                key: WorkshopCompletionKeys.submit,
                label: _copy('c_submit'),
                icon: Icons.send_rounded,
                onPressed: missing.isEmpty
                    ? () => Navigator.of(context).pop(_draft)
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _fmt(num v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();
}

class _Thumb extends StatelessWidget {
  const _Thumb({
    required this.path,
    required this.label,
    required this.removeTooltip,
    required this.onRemove,
  });

  final String path;
  final String label;
  final String removeTooltip;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Stack(
      children: <Widget>[
        ClipRRect(
          borderRadius: BorderRadius.circular(TpRadius.md),
          child: Container(
            width: 84,
            height: 84,
            color: palette.surfaceAlt,
            child: Image.file(
              File(path),
              fit: BoxFit.cover,
              errorBuilder: (BuildContext c, Object e, StackTrace? s) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    const Icon(Icons.photo_outlined),
                    Text(label),
                  ],
                ),
              ),
            ),
          ),
        ),
        PositionedDirectional(
          top: 0,
          end: 0,
          child: IconButton(
            visualDensity: VisualDensity.compact,
            tooltip: removeTooltip,
            icon: const Icon(Icons.cancel_rounded),
            onPressed: onRemove,
          ),
        ),
      ],
    );
  }
}
