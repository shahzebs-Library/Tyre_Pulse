/// Raise a concern: pick what it is about (big icons), pick which one, write
/// it in your own words, add up to six photos, send. Works without signal: the
/// concern waits on the phone and is sent later (see the repository).
///
/// A Treatment concern (supervisor conduct, harassment, discrimination,
/// threats) shows that it is private and goes to HR. The server enforces it;
/// the note is only so the driver knows.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/features/driver_concerns/data/driver_concern_repository.dart';
import 'package:tyre_pulse/features/driver_concerns/domain/driver_concern_rules.dart';
import 'package:tyre_pulse/features/driver_concerns/driver_concerns_providers.dart';
import 'package:tyre_pulse/features/driver_concerns/presentation/driver_concerns_copy.dart';

abstract final class RaiseConcernKeys {
  static Key category(String k) => Key('dc.category.$k');
  static Key subtype(String k) => Key('dc.subtype.$k');
  static const Key text = Key('dc.text');
  static const Key send = Key('dc.send');
  static const Key sensitiveNote = Key('dc.sensitiveNote');
}

class RaiseConcernScreen extends ConsumerStatefulWidget {
  const RaiseConcernScreen({super.key});

  @override
  ConsumerState<RaiseConcernScreen> createState() => _RaiseConcernScreenState();
}

class _RaiseConcernScreenState extends ConsumerState<RaiseConcernScreen> {
  String? _category;
  String? _subtype;
  final TextEditingController _text = TextEditingController();
  final List<String> _photos = <String>[];
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _addPhoto(bool camera) async {
    final String? picked =
        await ref.read(concernPhotoPickerProvider)(camera: camera);
    if (picked == null) return;
    // Keep our own copy until it is uploaded; a cleared cache cannot lose it.
    String path = picked;
    try {
      path = await ref.read(concernPhotoKeeperProvider)(picked);
    } on Object {
      // Copy failed: keep the picked path; a missing file later fails the
      // item visibly (Retry / Discard), never silently.
    }
    if (mounted) setState(() => _photos.add(path));
  }

  Future<void> _send(DriverConcernsCopy c) async {
    if (_category == null || _subtype == null || _text.text.trim().isEmpty) {
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    final ConcernDraft draft = ConcernDraft(
      category: _category!,
      subtype: _subtype!,
      text: _text.text.trim(),
      lang: concernLanguages.contains(c.language) ? c.language : null,
      localPhotos: List<String>.of(_photos),
    );
    try {
      final String? caseNo =
          await ref.read(driverConcernRepositoryProvider).raise(draft);
      if (!mounted) return;
      final List<ConcernDraft> waiting = caseNo == null
          ? await ref.read(driverConcernRepositoryProvider).pending()
          : const <ConcernDraft>[];
      final bool failed = waiting.any(
        (ConcernDraft w) => w.clientUuid == draft.clientUuid && w.error != null,
      );
      if (!mounted) return;
      final String msg = caseNo == null
          ? (failed ? c('failedSend') : c('savedOffline'))
          : c.fill('sent', <String, String>{'case': caseNo});
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      Navigator.of(context).pop(true);
    } on ConcernRefused catch (e) {
      setState(
        () => _error =
            e.message.contains('not linked') ? c('notLinked') : e.message,
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final DriverConcernsCopy c = DriverConcernsCopy.of(context);
    final ThemeData theme = Theme.of(context);
    final ConcernCategory? cat =
        _category == null ? null : categoryFor(_category!);
    final bool ready = _category != null &&
        _subtype != null &&
        _text.text.trim().isNotEmpty &&
        !_sending;
    return Scaffold(
      appBar: AppBar(title: Text(c('raise'))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            Text(c('raiseHint'), style: theme.textTheme.bodyMedium),
            const SizedBox(height: 16),
            Text(c('pickCategory'), style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            GridView.count(
              crossAxisCount: 4,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              childAspectRatio: 0.82,
              children: <Widget>[
                for (final ConcernCategory k in concernCategories)
                  _CategoryTile(
                    key: RaiseConcernKeys.category(k.key),
                    icon: k.icon,
                    label: c('category.${k.key}'),
                    selected: _category == k.key,
                    onTap: () => setState(() {
                      _category = k.key;
                      _subtype =
                          k.subtypes.length == 1 ? k.subtypes.first : null;
                    }),
                  ),
              ],
            ),
            if (cat != null && cat.sensitive) ...<Widget>[
              const SizedBox(height: 12),
              Card(
                key: RaiseConcernKeys.sensitiveNote,
                color: theme.colorScheme.secondaryContainer,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: <Widget>[
                      const Icon(Icons.lock_outline),
                      const SizedBox(width: 8),
                      Expanded(child: Text(c('sensitiveNote'))),
                    ],
                  ),
                ),
              ),
            ],
            if (cat != null && cat.subtypes.length > 1) ...<Widget>[
              const SizedBox(height: 16),
              Text(c('pickSubtype'), style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: <Widget>[
                  for (final String s in cat.subtypes)
                    ChoiceChip(
                      key: RaiseConcernKeys.subtype(s),
                      label: Text(c('subtype.$s')),
                      selected: _subtype == s,
                      onSelected: (_) => setState(() => _subtype = s),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 16),
            Text(c('describe'), style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            TextField(
              key: RaiseConcernKeys.text,
              controller: _text,
              minLines: 4,
              maxLines: 10,
              maxLength: 4000,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: c('describeHint'),
                border: const OutlineInputBorder(),
              ),
            ),
            Text(
              c('voiceSoon'),
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.outline),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                OutlinedButton.icon(
                  onPressed: _photos.length >= 6 ? null : () => _addPhoto(true),
                  icon: const Icon(Icons.photo_camera_outlined),
                  label: Text(c('camera')),
                ),
                OutlinedButton.icon(
                  onPressed:
                      _photos.length >= 6 ? null : () => _addPhoto(false),
                  icon: const Icon(Icons.photo_library_outlined),
                  label: Text(c('gallery')),
                ),
                Text(
                  c.fill(
                    'photosCount',
                    <String, String>{'n': '${_photos.length}'},
                  ),
                ),
              ],
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: 12),
              Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
            ],
            const SizedBox(height: 20),
            FilledButton(
              key: RaiseConcernKeys.send,
              onPressed: ready ? () => _send(c) : null,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
              ),
              child: Text(_sending ? c('sending') : c('send')),
            ),
          ],
        ),
      ),
    );
  }
}

class _CategoryTile extends StatelessWidget {
  const _CategoryTile({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ColorScheme cs = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: Material(
        color: selected ? cs.primaryContainer : cs.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(6),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                Icon(
                  icon,
                  size: 30,
                  color: selected ? cs.onPrimaryContainer : cs.onSurfaceVariant,
                ),
                const SizedBox(height: 4),
                Text(
                  label,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
