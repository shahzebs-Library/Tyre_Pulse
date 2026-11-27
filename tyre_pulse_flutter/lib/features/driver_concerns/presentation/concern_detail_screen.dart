/// One concern: what was written, the answer in the driver's own language
/// (machine translation, labelled, the original one tap away), the mandatory
/// "I have seen this" step, then a signature and Accept / Not accepted.
/// Not accepted moves the case up a level; the driver keeps the right to go to
/// the labour office and the screen says so. Withdraw and reopen (inside the
/// window) are here too. A fleet pool role sees the minimal handler actions.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show Supabase;
import 'package:tyre_pulse/features/driver_concerns/data/driver_concern_repository.dart';
import 'package:tyre_pulse/features/driver_concerns/domain/driver_concern_rules.dart';
import 'package:tyre_pulse/features/driver_concerns/presentation/driver_concerns_copy.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/inspection_signature_pad.dart';

abstract final class ConcernDetailKeys {
  static const Key seen = Key('dc.detail.seen');
  static const Key accept = Key('dc.detail.accept');
  static const Key notAccept = Key('dc.detail.notAccept');
  static const Key withdraw = Key('dc.detail.withdraw');
  static const Key reopen = Key('dc.detail.reopen');
  static const Key translate = Key('dc.detail.translate');
}

class ConcernDetailScreen extends ConsumerStatefulWidget {
  const ConcernDetailScreen({required this.concernId, super.key});
  final String concernId;

  @override
  ConsumerState<ConcernDetailScreen> createState() =>
      _ConcernDetailScreenState();
}

class _ConcernDetailScreenState extends ConsumerState<ConcernDetailScreen> {
  ConcernDetail? _detail;
  Object? _error;
  bool _busy = false;
  bool _showOriginalOutcome = false;
  String? _signature;
  bool _driverPresent = false;
  final TextEditingController _reason = TextEditingController();
  final TextEditingController _note = TextEditingController();
  final Map<String, String> _fresh = <String, String>{};
  List<String> _photoUrls = const <String>[];

  DriverConcernRepository get _repo =>
      ref.read(driverConcernRepositoryProvider);

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _reason.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final ConcernDetail d = await _repo.get(widget.concernId);
      final List<String?> urls = await Future.wait(
        d.concern.photos.map(_repo.signedPhotoUrl),
      );
      if (!mounted) return;
      setState(() {
        _detail = d;
        _error = null;
        _photoUrls = urls.whereType<String>().toList();
      });
      unawaited(_autoTranslateOutcome(d));
    } on Object catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  /// The driver reads the answer in their own language without asking.
  Future<void> _autoTranslateOutcome(ConcernDetail d) async {
    final String lang = DriverConcernsCopy.of(context).language;
    final String? text = d.concern.outcomeText;
    if (!d.isDriver || text == null || d.concern.outcomeLang == lang) return;
    if (d.translationFor('outcome', lang) != null) return;
    final String? t =
        await _repo.translate(d.concern.id, 'outcome', text, lang);
    if (t != null && mounted) setState(() => _fresh['outcome'] = t);
  }

  Future<void> _translateMine(String lang) async {
    final ConcernDetail? d = _detail;
    final String? text = d?.concern.originalText;
    if (d == null || text == null) return;
    setState(() => _busy = true);
    final String? t =
        await _repo.translate(d.concern.id, 'concern', text, lang);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (t != null) _fresh['concern'] = t;
    });
    if (t == null) _snack(DriverConcernsCopy.of(context)('translateFailed'));
  }

  void _snack(String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _run(
    String action, [
    Map<String, Object?> payload = const <String, Object?>{},
  ]) async {
    final DriverConcernsCopy c = DriverConcernsCopy.of(context);
    final ConcernDetail? d = _detail;
    if (d == null) return;
    setState(() => _busy = true);
    try {
      await _repo.command(
        d.concern.id,
        action,
        payload: payload,
        expectedVersion: d.concern.version,
      );
      _snack(c('done'));
      _signature = null;
      _reason.clear();
      _note.clear();
    } on ConcernStaleFailure {
      _snack(c('stale'));
    } on ConcernOfflineFailure {
      _snack(c('error'));
    } on ConcernRefused catch (e) {
      _snack(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
      await _load();
    }
  }

  Future<void> _sign(String decision) async {
    final DriverConcernsCopy c = DriverConcernsCopy.of(context);
    if (_signature == null) {
      _snack(c('signFirst'));
      return;
    }
    await _run('sign', <String, Object?>{
      'decision': decision,
      'signature': _signature,
      if (!(_detail?.isDriver ?? true)) 'driver_present': _driverPresent,
      'text': _reason.text.trim().isEmpty ? null : _reason.text.trim(),
      'lang': c.language,
    });
  }

  Future<void> _withdraw() async {
    final DriverConcernsCopy c = DriverConcernsCopy.of(context);
    final bool? ok = await showDialog<bool>(
      context: context,
      builder: (BuildContext ctx) => AlertDialog(
        content: Text(c('withdrawConfirm')),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(MaterialLocalizations.of(ctx).cancelButtonLabel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(c('withdraw')),
          ),
        ],
      ),
    );
    if (ok == true) await _run('withdraw');
  }

  Future<void> _reopen() async {
    final DriverConcernsCopy c = DriverConcernsCopy.of(context);
    final TextEditingController reason = TextEditingController();
    final String? text = await showDialog<String>(
      context: context,
      builder: (BuildContext ctx) => AlertDialog(
        title: Text(c('reopenReason')),
        content: TextField(controller: reason, maxLines: 4, autofocus: true),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(MaterialLocalizations.of(ctx).cancelButtonLabel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, reason.text.trim()),
            child: Text(c('reopen')),
          ),
        ],
      ),
    );
    reason.dispose();
    if (text != null && text.isNotEmpty) {
      await _run('reopen', <String, Object?>{'text': text, 'lang': c.language});
    }
  }

  @override
  Widget build(BuildContext context) {
    final DriverConcernsCopy c = DriverConcernsCopy.of(context);
    final ThemeData theme = Theme.of(context);
    final ConcernDetail? d = _detail;
    if (d == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: _error == null
              ? const CircularProgressIndicator()
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(c('error')),
                    TextButton(onPressed: _load, child: Text(c('retry'))),
                  ],
                ),
        ),
      );
    }
    final DriverConcern k = d.concern;
    final Set<String> can = allowedActions(
      d,
      DateTime.now(),
      userId: _currentUserId(),
    );
    final String lang = c.language;
    final String? concernTr =
        _fresh['concern'] ?? d.translationFor('concern', lang)?.text;
    final String? outcomeTr =
        _fresh['outcome'] ?? d.translationFor('outcome', lang)?.text;
    final String? outcomeShown =
        (_showOriginalOutcome || outcomeTr == null) ? k.outcomeText : outcomeTr;

    Widget section(String title, List<Widget> children) => Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(title, style: theme.textTheme.titleMedium),
              const SizedBox(height: 6),
              ...children,
            ],
          ),
        );

    return Scaffold(
      appBar: AppBar(
        title: Text(c.fill('caseLabel', <String, String>{'case': k.caseNo})),
      ),
      body: SafeArea(
        child: AbsorbPointer(
          absorbing: _busy,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: <Widget>[
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: <Widget>[
                  Chip(
                    avatar: Icon(categoryFor(k.category)?.icon, size: 18),
                    label: Text(
                      '${c('category.${k.category}')} · ${c('subtype.${k.subtype}')}',
                    ),
                  ),
                  Chip(label: Text(c('status.${k.status}'))),
                  if (!d.isDriver) Chip(label: Text(c('level.${k.level}'))),
                  if (k.sensitive)
                    Chip(
                      avatar: const Icon(Icons.lock_outline, size: 18),
                      label: Text(c('category.treatment')),
                    ),
                ],
              ),
              section(c('youWrote'), <Widget>[
                Text(
                  k.originalText ?? '',
                  textDirection: _dirOf(k.originalText),
                ),
                if (!d.isDriver) ...<Widget>[
                  const SizedBox(height: 6),
                  if (concernTr != null) ...<Widget>[
                    Text(concernTr, textDirection: _dirOf(concernTr)),
                    Text(c('machine'), style: theme.textTheme.labelSmall),
                  ] else
                    TextButton.icon(
                      key: ConcernDetailKeys.translate,
                      onPressed: () => _translateMine(lang),
                      icon: const Icon(Icons.translate),
                      label:
                          Text(_busy ? c('translating') : c('showTranslation')),
                    ),
                ],
                if (_photoUrls.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: <Widget>[
                        for (final String u in _photoUrls)
                          ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: Image.network(
                              u,
                              width: 88,
                              height: 88,
                              fit: BoxFit.cover,
                            ),
                          ),
                      ],
                    ),
                  ),
              ]),
              if (k.outcomeText != null)
                section(c('answer'), <Widget>[
                  Text(
                    outcomeShown ?? '',
                    style: theme.textTheme.bodyLarge,
                    textDirection: _dirOf(outcomeShown),
                  ),
                  if (outcomeTr != null)
                    Row(
                      children: <Widget>[
                        Text(
                          _showOriginalOutcome ? '' : c('machine'),
                          style: theme.textTheme.labelSmall,
                        ),
                        const Spacer(),
                        TextButton(
                          onPressed: () => setState(
                            () => _showOriginalOutcome = !_showOriginalOutcome,
                          ),
                          child: Text(
                            _showOriginalOutcome
                                ? c('showTranslation')
                                : c('showOriginal'),
                          ),
                        ),
                      ],
                    ),
                ]),
              if (can.contains('view_outcome') && k.outcomeSeenAt == null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: FilledButton.tonalIcon(
                    key: ConcernDetailKeys.seen,
                    onPressed: () => _run('view_outcome'),
                    icon: const Icon(Icons.visibility_outlined),
                    label: Text(c('seenConfirm')),
                  ),
                ),
              if (k.status == 'outcome_shared' &&
                  k.outcomeSeenAt == null &&
                  d.isDriver)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(c('mustSee'), style: theme.textTheme.bodySmall),
                ),
              if (can.contains('sign'))
                section(c('signHere'), <Widget>[
                  if (!d.isDriver)
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: _driverPresent,
                      onChanged: (bool? v) =>
                          setState(() => _driverPresent = v ?? false),
                      title: Text(c('driverPresent')),
                    ),
                  InspectionSignaturePad(
                    height: 160,
                    onChanged: (InspectionSignatureCapture? s) =>
                        setState(() => _signature = s?.dataUrl),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _reason,
                    maxLines: 3,
                    decoration: InputDecoration(
                      labelText: c('reason'),
                      border: const OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(c('notAcceptHint'), style: theme.textTheme.bodySmall),
                  const SizedBox(height: 8),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: FilledButton(
                          key: ConcernDetailKeys.accept,
                          onPressed: () => _sign('accepted'),
                          child: Text(c('accept')),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton(
                          key: ConcernDetailKeys.notAccept,
                          onPressed: () => _sign('not_accepted'),
                          child: Text(c('notAccept')),
                        ),
                      ),
                    ],
                  ),
                ]),
              if (d.isDriver)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    c('labourOffice'),
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              if (can.contains('reopen') && k.reopenDeadline != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Row(
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          c.fill('reopenUntil', <String, String>{
                            'date': MaterialLocalizations.of(context)
                                .formatMediumDate(k.reopenDeadline!.toLocal()),
                          }),
                        ),
                      ),
                      OutlinedButton(
                        key: ConcernDetailKeys.reopen,
                        onPressed: _reopen,
                        child: Text(c('reopen')),
                      ),
                    ],
                  ),
                ),
              if (!d.isDriver &&
                  (can.contains('acknowledge') ||
                      can.contains('escalate') ||
                      can.contains('propose')))
                section(c('handlerTitle'), <Widget>[
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: <Widget>[
                      if (can.contains('acknowledge'))
                        OutlinedButton(
                          onPressed: () => _run('acknowledge'),
                          child: Text(c('acknowledge')),
                        ),
                      if (can.contains('escalate'))
                        OutlinedButton(
                          onPressed: () => _run('escalate'),
                          child: Text(c('escalate')),
                        ),
                    ],
                  ),
                  if (can.contains('propose')) ...<Widget>[
                    const SizedBox(height: 8),
                    TextField(
                      controller: _reason,
                      maxLines: 3,
                      decoration: InputDecoration(
                        hintText: c('proposeHint'),
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 6),
                    FilledButton(
                      onPressed: () {
                        if (_reason.text.trim().isNotEmpty) {
                          _run('propose', <String, Object?>{
                            'text': _reason.text.trim(),
                            'lang': lang,
                          });
                        }
                      },
                      child: Text(c('propose')),
                    ),
                  ],
                ]),
              if (can.contains('note'))
                section(c('note'), <Widget>[
                  TextField(
                    controller: _note,
                    maxLines: 3,
                    decoration: InputDecoration(
                      hintText: c('noteHint'),
                      border: const OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: OutlinedButton(
                      onPressed: () {
                        if (_note.text.trim().isNotEmpty) {
                          _run('note', <String, Object?>{
                            'text': _note.text.trim(),
                            'lang': lang,
                          });
                        }
                      },
                      child: Text(c('save')),
                    ),
                  ),
                ]),
              section(c('timeline'), <Widget>[
                for (final ConcernEvent e in d.events)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: const Icon(Icons.radio_button_checked, size: 16),
                    title: Text(c('event.${e.type}')),
                    subtitle: Text(
                      <String>[
                        if (e.at != null)
                          MaterialLocalizations.of(context)
                              .formatShortDate(e.at!.toLocal()),
                        if (e.note != null) e.note!,
                      ].join(' · '),
                    ),
                  ),
              ]),
              if (can.contains('withdraw'))
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: TextButton.icon(
                    key: ConcernDetailKeys.withdraw,
                    onPressed: _withdraw,
                    icon: const Icon(Icons.undo),
                    label: Text(c('withdraw')),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  static String? _currentUserId() {
    try {
      return Supabase.instance.client.auth.currentUser?.id;
    } on Object {
      return null; // not initialised (tests)
    }
  }

  static TextDirection? _dirOf(String? t) {
    if (t == null) return null;
    return RegExp(r'[֐-ࣿﭐ-﻿]').hasMatch(t) ? TextDirection.rtl : null;
  }
}
