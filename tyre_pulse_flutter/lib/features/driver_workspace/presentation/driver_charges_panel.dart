/// "My charges" inside the driver workspace: every amount the company intends
/// to recover from the driver, linked to its source (a traffic fine sent from
/// the web, an accident, a handover, ...), with the full record, the signed
/// statements, the deduction schedule and the timeline.
///
/// The driver may only do what `driver_charge_detail.actions` allows, and only
/// the two driver actions (respond, appeal) are offered on the phone. Both are
/// legal acts: they are sent online only, with the exact server statement
/// shown and stored, and a client request id so a double tap cannot record
/// twice. Staff actions stay on the web; the phone shows them read only.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/documents/document_share.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/inspection_approval_signature_pad.dart';
import 'package:tyre_pulse/features/driver_workspace/data/driver_charge_repository.dart';
import 'package:tyre_pulse/features/driver_workspace/domain/driver_charge.dart';
import 'package:tyre_pulse/features/driver_workspace/domain/driver_workspace.dart';
import 'package:tyre_pulse/features/driver_workspace/presentation/driver_charge_l10n.dart';
import 'package:tyre_pulse/features/driver_workspace/presentation/driver_workspace_l10n.dart';
import 'package:uuid/uuid.dart';

String _errorText(AppLocalizations l10n, Object error, String offline) {
  if (error is ChargeOfflineFailure) return offline;
  if (error is AppError) return error.message;
  return l10n.driverChargeLoadError;
}

/// The list section, placed in the driver's own workspace page.
class DriverChargesSection extends ConsumerStatefulWidget {
  const DriverChargesSection({required this.driverId, super.key});
  final String driverId;

  @override
  ConsumerState<DriverChargesSection> createState() =>
      _DriverChargesSectionState();
}

class _DriverChargesSectionState extends ConsumerState<DriverChargesSection> {
  final List<DriverRow> _rows = <DriverRow>[];
  bool _loading = false;
  bool _hasMore = false;
  Object? _error;
  String? _status;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_load(reset: true));
  }

  @override
  void didUpdateWidget(DriverChargesSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.driverId != widget.driverId) unawaited(_load(reset: true));
  }

  Future<void> _load({required bool reset}) async {
    final int generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
      if (reset) _rows.clear();
    });
    try {
      final DriverChargePage page = await ref
          .read(driverChargeRepositoryProvider)
          .list(driverId: widget.driverId, offset: reset ? 0 : _rows.length);
      if (!mounted || generation != _generation) return;
      setState(() {
        _rows.addAll(page.rows);
        _hasMore = page.hasMore;
      });
    } on Object catch (error) {
      if (mounted && generation == _generation) setState(() => _error = error);
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _open(DriverRow row) async {
    final bool? changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (BuildContext context) =>
            DriverChargeDetailScreen(chargeId: '${row['id']}'),
      ),
    );
    if (changed == true && mounted) await _load(reset: true);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final List<ChargeOutstanding> outstanding =
        chargeOutstandingByCurrency(_rows);
    final List<String> statuses = <String>[
      for (final String s in driverChargeStatuses)
        if (_rows.any((DriverRow r) => r['status'] == s)) s,
    ];
    final List<DriverRow> visible = _status == null
        ? _rows
        : _rows.where((DriverRow r) => r['status'] == _status).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(l10n.driverChargeSectionTitle, style: theme.textTheme.titleMedium),
        const SizedBox(height: 4),
        if (outstanding.isNotEmpty)
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: <Widget>[
              for (final ChargeOutstanding o in outstanding)
                Chip(label: Text(l10n.driverChargeOutstanding('$o'))),
            ],
          ),
        if (statuses.length > 1)
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: <Widget>[
              ChoiceChip(
                label: Text(l10n.driverChargeFilterAll),
                selected: _status == null,
                onSelected: (_) => setState(() => _status = null),
              ),
              for (final String s in statuses)
                ChoiceChip(
                  label: Text(driverChargeStatusLabel(l10n, s)),
                  selected: _status == s,
                  onSelected: (_) => setState(() => _status = s),
                ),
            ],
          ),
        if (_loading && _rows.isEmpty) const LinearProgressIndicator(),
        if (_error != null)
          Card(
            child: ListTile(
              leading: Icon(Icons.error_outline, color: theme.colorScheme.error),
              title: Text(
                _errorText(l10n, _error!, l10n.driverChargeLoadError),
              ),
              trailing: TextButton(
                onPressed: _loading ? null : () => _load(reset: true),
                child: Text(l10n.actionRetry),
              ),
            ),
          ),
        if (!_loading && _error == null && _rows.isEmpty)
          Text(l10n.driverChargeNone),
        for (final DriverRow row in visible)
          Card(
            child: ListTile(
              onTap: () => _open(row),
              title: Text(
                '${row['charge_no'] ?? ''} · '
                '${driverChargeCategoryLabel(l10n, row['category'] as String?)}',
              ),
              subtitle: Text(
                <String>[
                  formatChargeMoney(row['amount'], row['currency']) ??
                      l10n.valueUnavailable,
                  driverChargeStatusLabel(l10n, row['status'] as String?),
                  if (row['source_label'] != null) '${row['source_label']}',
                  if (row['asset_no'] != null) '${row['asset_no']}',
                ].join(' · '),
              ),
              trailing: row['status'] == 'notified'
                  ? Icon(Icons.edit_note, color: theme.colorScheme.primary)
                  : const Icon(Icons.chevron_right),
            ),
          ),
        if (_hasMore)
          OutlinedButton(
            onPressed: _loading ? null : () => _load(reset: false),
            child: Text(l10n.driverChargeLoadMore),
          ),
      ],
    );
  }
}

/// One charge: the full record and the driver's actions.
class DriverChargeDetailScreen extends ConsumerStatefulWidget {
  const DriverChargeDetailScreen({required this.chargeId, super.key});
  final String chargeId;

  @override
  ConsumerState<DriverChargeDetailScreen> createState() =>
      _DriverChargeDetailScreenState();
}

class _DriverChargeDetailScreenState
    extends ConsumerState<DriverChargeDetailScreen> {
  DriverChargeDetail? _detail;
  Object? _error;
  bool _loading = true;
  bool _sharing = false;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final DriverChargeDetail detail =
          await ref.read(driverChargeRepositoryProvider).detail(widget.chargeId);
      if (mounted) setState(() => _detail = detail);
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _share() async {
    final DriverChargeDetail? detail = _detail;
    if (detail == null || _sharing) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() => _sharing = true);
    try {
      await shareChargeNoticePdf(detail.data);
    } on Object {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.driverChargePdfFailed)),
        );
      }
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  Future<void> _act(String action) async {
    final DriverChargeDetail? detail = _detail;
    if (detail == null) return;
    final bool? saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (BuildContext context) => FractionallySizedBox(
        heightFactor: 0.96,
        child: switch (action) {
          chargeActionRespond => DriverChargeResponseSheet(detail: detail),
          chargeActionWitnessConfirm =>
            DriverChargeWitnessSheet(detail: detail),
          _ => DriverChargeAppealSheet(detail: detail),
        },
      ),
    );
    if (saved == true && mounted) {
      _changed = true;
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final DriverChargeDetail? detail = _detail;
    final String number = '${detail?.charge['charge_no'] ?? ''}';
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (bool didPop, Object? _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.driverChargeDetailTitle(number)),
          leading: IconButton(
            tooltip: l10n.actionBack,
            icon: const BackButtonIcon(),
            onPressed: () => Navigator.of(context).pop(_changed),
          ),
          actions: <Widget>[
            if (detail != null)
              IconButton(
                tooltip: l10n.driverChargeSharePdf,
                onPressed: _sharing ? null : _share,
                icon: _sharing
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.picture_as_pdf_outlined),
              ),
          ],
        ),
        body: _body(l10n),
      ),
    );
  }

  Widget _body(AppLocalizations l10n) {
    if (_loading && _detail == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _detail == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                _errorText(l10n, _error!, l10n.driverChargeLoadError),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              FilledButton(onPressed: _load, child: Text(l10n.actionRetry)),
            ],
          ),
        ),
      );
    }
    final DriverChargeDetail detail = _detail!;
    final DriverRow c = detail.charge;
    final ThemeData theme = Theme.of(context);
    final String currency = '${c['currency'] ?? ''}';
    final Set<String> actions = detail.mobileActions;
    String money(Object? v) =>
        formatChargeMoney(v, currency) ?? l10n.valueUnavailable;
    String text(Object? v) =>
        v == null || '$v'.trim().isEmpty ? l10n.valueUnavailable : '$v';
    final DriverRow? summary = c['source_summary'] is Map
        ? Map<String, Object?>.from(c['source_summary']! as Map)
        : null;

    Widget heading(String value) => Padding(
          padding: const EdgeInsets.only(top: 16, bottom: 6),
          child: Text(value, style: theme.textTheme.titleMedium),
        );
    Widget fact(String label, String value) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(label, style: theme.textTheme.labelMedium),
              Text(value, style: theme.textTheme.bodyLarge),
            ],
          ),
        );

    final List<DriverRow> instalments = detail.rows('instalments');
    final DriverRow? appeal = detail.appeal;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: <Widget>[
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Text(
              _errorText(l10n, _error!, l10n.driverChargeLoadError),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(money(c['amount']), style: theme.textTheme.headlineSmall),
                  Text(driverChargeStatusLabel(l10n, c['status'] as String?)),
                  fact(
                    l10n.driverChargeCategoryLabel,
                    driverChargeCategoryLabel(l10n, c['category'] as String?),
                  ),
                  fact(l10n.driverChargeDeducted, money(c['deducted_amount'])),
                  fact(
                    l10n.driverChargeLinkedRecord,
                    <String>[
                      driverChargeSourceLabel(l10n, c['source_type'] as String?),
                      if (summary?['label'] != null) '${summary!['label']}',
                    ].join(' · '),
                  ),
                  fact(l10n.driverChargeVehicle, text(c['asset_no'])),
                  fact(
                    l10n.driverChargeIncident,
                    driverChargeTime(l10n, c['incident_at']),
                  ),
                  fact(
                    l10n.driverChargeIssuedAt,
                    driverChargeTime(l10n, c['created_at']),
                  ),
                  fact(
                    l10n.driverChargeNotifiedAt,
                    driverChargeTime(l10n, c['notified_at']),
                  ),
                ],
              ),
            ),
          ),
          if (chargeAwaitsWitness(c))
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(l10n.driverChargeWitnessPending),
              ),
            ),
          if (c['superseded_by_charge_id'] != null)
            Card(
              color: theme.colorScheme.errorContainer,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(l10n.driverChargeReplaced),
              ),
            ),
          for (final String action in actions)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: FilledButton.icon(
                onPressed: () => _act(action),
                icon: Icon(
                  switch (action) {
                    chargeActionRespond => Icons.draw_outlined,
                    chargeActionWitnessConfirm => Icons.how_to_reg_outlined,
                    _ => Icons.gavel_outlined,
                  },
                ),
                label: Text(
                  switch (action) {
                    chargeActionRespond => l10n.driverChargeRespond,
                    chargeActionWitnessConfirm =>
                      l10n.driverChargeWitnessConfirm,
                    _ => l10n.driverChargeAppealAction,
                  },
                ),
              ),
            ),
          if (actions.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(l10n.driverChargeNoActions),
            ),
          if (detail.actions.difference(actions).isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                l10n.driverChargeStaffReadOnly,
                style: theme.textTheme.bodySmall,
              ),
            ),
          heading(l10n.driverChargeBasis),
          Text(text(c['basis'])),
          heading(l10n.driverChargeEvidence),
          if (detail.rows('evidence').isEmpty) Text(l10n.driverChargeNoEvidence),
          for (final DriverRow e in detail.rows('evidence'))
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.attach_file),
              title: Text(text(e['label'])),
              subtitle: Text(
                '${driverWsEvidenceKindLabel(l10n, '${e['kind'] ?? ''}')} · '
                '${driverChargeTime(l10n, e['created_at'])}',
              ),
            ),
          heading(l10n.driverChargeSignatures),
          for (final DriverRow s in detail.rows('signatures'))
            _SignatureTile(row: s),
          heading(l10n.driverChargeDecisions),
          if (detail.rows('decisions').isEmpty)
            Text(l10n.driverChargeNoDecisions),
          for (final DriverRow d in detail.rows('decisions'))
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(
                '${driverWsTermLabel(l10n, '${d['stage'] ?? ''}')} · '
                '${driverWsTermLabel(l10n, '${d['decision'] ?? ''}')}',
              ),
              subtitle: Text(
                '${text(d['decided_by_name'])} · '
                '${driverChargeTime(l10n, d['created_at'])}'
                '${d['reason'] == null || '${d['reason']}'.isEmpty ? '' : '\n${d['reason']}'}',
              ),
            ),
          heading(l10n.driverChargeAppealTitle),
          if (appeal == null) Text(l10n.driverChargeNoAppeal),
          if (appeal != null) ...<Widget>[
            Text(
              l10n.driverChargeAppealFiled(
                driverChargeTime(l10n, appeal['filed_at']),
              ),
            ),
            Text(text(appeal['reason'])),
            Text(
              appeal['outcome'] == null
                  ? l10n.driverChargeAppealPending
                  : l10n.driverChargeAppealOutcome(
                      driverWsTermLabel(l10n, '${appeal['outcome']}'),
                    ),
            ),
          ],
          heading(l10n.driverChargeSchedule),
          if (instalments.isEmpty) Text(l10n.driverChargeNoSchedule),
          if (instalments.isNotEmpty && c['schedule_cap_pct'] != null)
            Text(l10n.driverChargeCapLine('${c['schedule_cap_pct']}')),
          for (final DriverRow i in instalments)
            Text(
              l10n.driverChargeInstalmentLine(
                '${i['due_month'] ?? ''}'.length >= 7
                    ? '${i['due_month']}'.substring(0, 7)
                    : text(i['due_month']),
                money(i['amount']),
                driverWsTermLabel(l10n, '${i['status'] ?? ''}'),
              ),
            ),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(l10n.driverChargeTimeline),
            children: <Widget>[
              for (final DriverRow e in detail.rows('events'))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    '${text(e['actor_name'])} · '
                    '${driverWsTermLabel(l10n, '${e['action'] ?? ''}')}',
                  ),
                  subtitle: Text(driverChargeTime(l10n, e['created_at'])),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SignatureTile extends StatelessWidget {
  const _SignatureTile({required this.row});
  final DriverRow row;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? image = row['signature'] as String?;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              driverWsTermLabel(l10n, '${row['kind'] ?? ''}'),
              style: Theme.of(context).textTheme.titleSmall,
            ),
            Text(
              l10n.driverChargeSignedBy(
                '${row['signer_name'] ?? l10n.valueUnavailable}',
                driverChargeTime(l10n, row['signed_at']),
              ),
            ),
            const SizedBox(height: 6),
            if (image != null && image.trimLeft().startsWith('<svg'))
              SvgPicture.string(image, height: 64)
            else if (image != null && image.startsWith('data:image/'))
              Image.memory(
                Uri.parse(image).data!.contentAsBytes(),
                height: 64,
                errorBuilder: (_, __, ___) =>
                    Text(l10n.driverChargeSignatureHidden),
              )
            else
              Text(l10n.driverChargeSignatureHidden),
            if (row['statement_text'] != null)
              Directionality(
                textDirection: TextDirection.ltr,
                child: Text(
                  '${row['statement_text']}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

String? _issueText(AppLocalizations l10n, DriverChargeIssue? issue) =>
    switch (issue) {
      DriverChargeIssue.explanation => l10n.driverChargeIssueExplanation,
      DriverChargeIssue.acknowledgement => l10n.driverChargeIssueAck,
      DriverChargeIssue.signature => l10n.driverChargeIssueSignature,
      DriverChargeIssue.reason => l10n.driverChargeIssueReason,
      null => null,
    };

/// Accept (written consent to deduction) or dispute (receipt only).
class DriverChargeResponseSheet extends ConsumerStatefulWidget {
  const DriverChargeResponseSheet({required this.detail, super.key});
  final DriverChargeDetail detail;

  @override
  ConsumerState<DriverChargeResponseSheet> createState() =>
      _DriverChargeResponseSheetState();
}

class _DriverChargeResponseSheetState
    extends ConsumerState<DriverChargeResponseSheet> {
  /// One id per distinct answer: a retry of the same answer replays the same
  /// request (the server returns the first result, never a second signature),
  /// while changing the answer after a failed send gets a fresh id.
  String _requestId = const Uuid().v4();
  String? _requestKey;

  String _idFor(String key) {
    if (_requestKey != null && _requestKey != key) {
      _requestId = const Uuid().v4();
    }
    _requestKey = key;
    return _requestId;
  }
  final TextEditingController _explanation = TextEditingController();
  DriverChargeResponse _response = DriverChargeResponse.accept;
  bool _acknowledged = false;
  String? _signature;
  String? _message;
  bool _busy = false;

  @override
  void dispose() {
    _explanation.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final DriverChargeIssue? issue = validateChargeResponse(
      response: _response,
      explanation: _explanation.text,
      acknowledged: _acknowledged,
      signature: _signature,
    );
    if (issue != null) {
      setState(() => _message = _issueText(l10n, issue));
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await ref.read(driverChargeRepositoryProvider).command(
            chargeActionRespond,
            chargeResponsePayload(
              charge: widget.detail.charge,
              response: _response,
              explanation: _response == DriverChargeResponse.dispute
                  ? _explanation.text
                  : '',
              signature: _signature!,
            ),
            _idFor('${_response.name}|${_explanation.text}|$_signature'),
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(l10n.driverChargeSaved)));
      Navigator.of(context).pop(true);
    } on Object catch (error) {
      if (mounted) {
        setState(
          () => _message = _errorText(l10n, error, l10n.driverChargeOffline),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? statement =
        widget.detail.statement(_response.statementVersion);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.driverChargeRespond)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          SegmentedButton<DriverChargeResponse>(
            segments: <ButtonSegment<DriverChargeResponse>>[
              ButtonSegment<DriverChargeResponse>(
                value: DriverChargeResponse.accept,
                label: Text(l10n.driverChargeAccept),
              ),
              ButtonSegment<DriverChargeResponse>(
                value: DriverChargeResponse.dispute,
                label: Text(l10n.driverChargeDispute),
              ),
            ],
            selected: <DriverChargeResponse>{_response},
            onSelectionChanged: _busy
                ? null
                : (Set<DriverChargeResponse> s) => setState(() {
                      _response = s.first;
                      // The statement changed: confirmation must be given
                      // again for the new wording.
                      _acknowledged = false;
                    }),
          ),
          const SizedBox(height: 16),
          Text(
            l10n.driverChargeStatementTitle,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          Text(
            l10n.driverChargeStatementEnglishOnly,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 6),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Directionality(
                textDirection: TextDirection.ltr,
                child: Text(statement ?? l10n.driverChargeStatementMissing),
              ),
            ),
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _acknowledged,
            onChanged: statement == null || _busy
                ? null
                : (bool? v) => setState(() => _acknowledged = v ?? false),
            title: Text(l10n.driverChargeAcknowledge),
          ),
          if (_response == DriverChargeResponse.dispute)
            TextField(
              controller: _explanation,
              minLines: 3,
              maxLines: 8,
              maxLength: 4000,
              enabled: !_busy,
              decoration:
                  InputDecoration(labelText: l10n.driverChargeExplanation),
            ),
          const SizedBox(height: 8),
          Text(l10n.driverChargeSignBelow),
          InspectionApprovalSignaturePad(
            onChanged: (InspectionApprovalSignatureCapture? capture) =>
                setState(() => _signature = capture?.dataUrl),
          ),
          if (_message != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _message!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _busy || statement == null ? null : _submit,
            child: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(l10n.driverChargeSubmit),
          ),
        ],
      ),
    );
  }
}

/// The driver's single appeal.
class DriverChargeAppealSheet extends ConsumerStatefulWidget {
  const DriverChargeAppealSheet({required this.detail, super.key});
  final DriverChargeDetail detail;

  @override
  ConsumerState<DriverChargeAppealSheet> createState() =>
      _DriverChargeAppealSheetState();
}

class _DriverChargeAppealSheetState
    extends ConsumerState<DriverChargeAppealSheet> {
  String _requestId = const Uuid().v4();
  String? _requestKey;

  String _idFor(String key) {
    if (_requestKey != null && _requestKey != key) {
      _requestId = const Uuid().v4();
    }
    _requestKey = key;
    return _requestId;
  }
  final TextEditingController _reason = TextEditingController();
  String? _message;
  bool _busy = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final DriverChargeIssue? issue = validateChargeAppeal(_reason.text);
    if (issue != null) {
      setState(() => _message = _issueText(l10n, issue));
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await ref.read(driverChargeRepositoryProvider).command(
            chargeActionAppeal,
            chargeAppealPayload(
              charge: widget.detail.charge,
              reason: _reason.text,
            ),
            _idFor(_reason.text),
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(l10n.driverChargeAppealSaved)));
      Navigator.of(context).pop(true);
    } on Object catch (error) {
      if (mounted) {
        setState(
          () => _message = _errorText(l10n, error, l10n.driverChargeOffline),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.driverChargeAppealAction)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          Text(l10n.driverChargeAppealOnce),
          const SizedBox(height: 12),
          TextField(
            controller: _reason,
            minLines: 4,
            maxLines: 10,
            maxLength: 4000,
            enabled: !_busy,
            decoration:
                InputDecoration(labelText: l10n.driverChargeAppealReason),
          ),
          if (_message != null)
            Text(
              _message!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(l10n.driverChargeAppealSubmit),
          ),
        ],
      ),
    );
  }
}


/// Step 2 of a refusal: the named witness reads the server statement,
/// confirms it and signs from their own account.
class DriverChargeWitnessSheet extends ConsumerStatefulWidget {
  const DriverChargeWitnessSheet({required this.detail, super.key});
  final DriverChargeDetail detail;

  @override
  ConsumerState<DriverChargeWitnessSheet> createState() =>
      _DriverChargeWitnessSheetState();
}

class _DriverChargeWitnessSheetState
    extends ConsumerState<DriverChargeWitnessSheet> {
  final String _requestId = const Uuid().v4();
  bool _acknowledged = false;
  String? _signature;
  String? _message;
  bool _busy = false;

  Future<void> _submit() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    if (!_acknowledged) {
      setState(() => _message = l10n.driverChargeIssueAck);
      return;
    }
    if (_signature == null || _signature!.isEmpty) {
      setState(() => _message = l10n.driverChargeIssueSignature);
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await ref.read(driverChargeRepositoryProvider).command(
            chargeActionWitnessConfirm,
            chargeWitnessPayload(
              charge: widget.detail.charge,
              signature: _signature!,
            ),
            _requestId,
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.driverChargeWitnessSaved)),
      );
      Navigator.of(context).pop(true);
    } on Object catch (error) {
      if (mounted) {
        setState(
          () => _message = _errorText(l10n, error, l10n.driverChargeOffline),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? statement =
        widget.detail.statement(chargeWitnessStatement);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.driverChargeWitnessConfirm)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          Text(l10n.driverChargeWitnessIntro),
          const SizedBox(height: 12),
          Text(
            l10n.driverChargeStatementTitle,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          Text(
            l10n.driverChargeStatementEnglishOnly,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Directionality(
                textDirection: TextDirection.ltr,
                child: Text(statement ?? l10n.driverChargeStatementMissing),
              ),
            ),
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _acknowledged,
            onChanged: statement == null || _busy
                ? null
                : (bool? v) => setState(() => _acknowledged = v ?? false),
            title: Text(l10n.driverChargeAcknowledge),
          ),
          Text(l10n.driverChargeSignBelow),
          InspectionApprovalSignaturePad(
            onChanged: (InspectionApprovalSignatureCapture? capture) =>
                setState(() => _signature = capture?.dataUrl),
          ),
          if (_message != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _message!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _busy || statement == null ? null : _submit,
            child: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(l10n.driverChargeSubmit),
          ),
        ],
      ),
    );
  }
}
