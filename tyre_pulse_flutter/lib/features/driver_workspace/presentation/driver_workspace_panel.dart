library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:image_picker/image_picker.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/inspection_approval_signature_pad.dart';
import 'package:tyre_pulse/features/driver_workspace/data/driver_workspace_repository.dart';
import 'package:tyre_pulse/features/driver_workspace/domain/driver_workspace.dart';
import 'package:tyre_pulse/features/driver_workspace/presentation/driver_workspace_l10n.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:uuid/uuid.dart';

/// Uses the existing authenticated Profile surface. The router and offline
/// command registry remain owned by their existing infrastructure.
class DriverWorkspaceEntry extends StatelessWidget {
  const DriverWorkspaceEntry({super.key});
  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Card(
      child: ListTile(
        leading: const Icon(Icons.badge_outlined),
        title: Text(l10n.driverWsTitle),
        subtitle: Text(l10n.driverWsEntrySubtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          useSafeArea: true,
          builder: (BuildContext context) => const FractionallySizedBox(
            heightFactor: 0.96,
            child: DriverWorkspacePanel(),
          ),
        ),
      ),
    );
  }
}

class DriverWorkspacePanel extends ConsumerStatefulWidget {
  const DriverWorkspacePanel({super.key});
  @override
  ConsumerState<DriverWorkspacePanel> createState() =>
      _DriverWorkspacePanelState();
}

class _DriverWorkspacePanelState extends ConsumerState<DriverWorkspacePanel> {
  DriverWorkspaceSnapshot? _snapshot;
  String? _driverId;
  String _owner = '';
  String _search = '';
  String Function(AppLocalizations)? _error;
  bool _loading = false;
  int _generation = 0;
  DriverWorkspaceRepository get _repository =>
      ref.read(driverWorkspaceRepositoryProvider);

  Future<void> _load() async {
    final int generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
      _snapshot = null;
    });
    try {
      final DriverWorkspaceSnapshot data =
          await _repository.load(_owner, _driverId);
      if (mounted && generation == _generation) {
        setState(() => _snapshot = data);
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() => _error = (AppLocalizations l) => l.driverWsLoadError);
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _action(String action, [DriverRow? fine]) async {
    final bool? saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (BuildContext context) => FractionallySizedBox(
        heightFactor: 0.96,
        child: DriverWorkspaceForm(
          action: action,
          owner: _owner,
          driverId: _driverId,
          fine: fine,
        ),
      ),
    );
    if (saved == true && mounted) await _load();
  }

  Future<void> _report() async {
    final DriverWorkspaceSnapshot? data = _snapshot;
    if (data?.driver == null || data!.truncated) return;
    try {
      // The PDF is written in English on purpose: the default PDF font has no
      // Arabic or Urdu glyphs and no Arabic-capable font is bundled, so a
      // localized PDF would print empty boxes. The strings still come from
      // the ARB catalog (English locale), never from literals here.
      final AppLocalizations pdf =
          await AppLocalizations.delegate.load(const Locale('en'));
      final pw.Document document = pw.Document();
      document.addPage(
        pw.MultiPage(
          build: (pw.Context context) => <pw.Widget>[
            pw.Header(
              level: 0,
              text: pdf.driverWsPdfTitle('${data.driver!['driver_name']}'),
            ),
            pw.Text(pdf.driverWsPdfEmployeeId('${data.driver!['driver_id']}')),
            pw.TableHelper.fromTextArray(
              headers: <String>[
                pdf.driverWsPdfColNotice,
                pdf.driverWsPdfColCurrency,
                pdf.driverWsPdfColAmount,
                pdf.driverWsPdfColPaid,
                pdf.driverWsPdfColStatus,
                pdf.driverWsPdfColResponse,
              ],
              data: data
                  .rows('fines')
                  .map(
                    (DriverRow f) => <String>[
                      '${f['notice_reference']}',
                      '${f['currency']}',
                      '${f['amount']}',
                      '${f['paid_amount']}',
                      driverWsTermLabel(pdf, '${f['status']}'),
                      driverWsTermLabel(pdf, '${f['response_status']}'),
                    ],
                  )
                  .toList(),
            ),
          ],
        ),
      );
      await Printing.sharePdf(
        bytes: await document.save(),
        filename: 'driver-fine-statement.pdf',
      );
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = (AppLocalizations l) => l.driverWsReportShareError,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final workspace = ref.watch(workspaceContextProvider);
    final String owner =
        workspace == null ? '' : '${workspace.userId}_${workspace.tenantId}';
    if (owner != _owner) {
      _owner = owner;
      _driverId = null;
      _snapshot = null;
      _generation++;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _owner.isNotEmpty) _load();
      });
    }
    final DriverWorkspaceSnapshot? data = _snapshot;
    return PopScope(
      canPop: _driverId == null,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (!didPop && _driverId != null) {
          setState(() => _driverId = null);
          _load();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.driverWsTitle),
          leading: IconButton(
            tooltip: l10n.actionBack,
            icon: const Icon(Icons.arrow_back),
            onPressed: () {
              if (_driverId == null) {
                Navigator.of(context).pop();
              } else {
                setState(() => _driverId = null);
                _load();
              }
            },
          ),
          actions: <Widget>[
            IconButton(
              tooltip: l10n.driverWsRefresh,
              onPressed: _loading || owner.isEmpty ? null : _load,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: owner.isEmpty
            ? Center(child: Text(l10n.driverWsSignInRequired))
            : ListView(
                padding: const EdgeInsets.all(16),
                children: <Widget>[
                  if (_loading) const LinearProgressIndicator(),
                  if (_error != null)
                    Text(
                      _error!(l10n),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  if (data?.offline == true) Text(l10n.driverWsOfflineNotice),
                  if (data?.truncated == true)
                    Text(l10n.driverWsTruncatedNotice),
                  if (data != null && _driverId == null) ...<Widget>[
                    if (data.canManage)
                      FilledButton(
                        onPressed: () => _action('create_driver'),
                        child: Text(driverWsTermLabel(l10n, 'create_driver')),
                      ),
                    TextField(
                      decoration: InputDecoration(
                        labelText: l10n.driverWsSearchDrivers,
                      ),
                      onChanged: (String value) =>
                          setState(() => _search = value),
                    ),
                    if (data.rows('drivers').isEmpty)
                      Text(l10n.driverWsNoDrivers),
                    ...data
                        .rows('drivers')
                        .where(
                          (DriverRow d) =>
                              '${d['driver_name']} ${d['driver_id']} ${d['site']}'
                                  .toLowerCase()
                                  .contains(_search.toLowerCase()),
                        )
                        .map(
                          (DriverRow d) => Card(
                            child: ListTile(
                              title: Text(
                                '${d['driver_name']} · ${d['driver_id']}',
                              ),
                              subtitle: Text(
                                l10n.driverWsDriverSubtitle(
                                  '${d['site'] ?? l10n.driverWsNotSupplied}',
                                  '${d['open_fines'] ?? 0}',
                                  '${d['awaiting_response'] ?? 0}',
                                ),
                              ),
                              onTap: () {
                                setState(
                                  () => _driverId = d['id']! as String,
                                );
                                _load();
                              },
                            ),
                          ),
                        ),
                  ],
                  if (data?.driver != null) ...<Widget>[
                    Text(
                      '${data!.driver!['driver_name']} · ${data.driver!['driver_id']}',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    Text(
                      '${data.driver!['country']} · ${data.driver!['site']}',
                    ),
                    if (data.canManage)
                      ...<String>[
                        'link_account',
                        'assign_team',
                        'link_record',
                      ].map(
                        (String action) => OutlinedButton(
                          onPressed: () => _action(action),
                          child: Text(driverWsTermLabel(l10n, action)),
                        ),
                      ),
                    if (data.canReview)
                      FilledButton(
                        onPressed: () => _action('create_fine'),
                        child: Text(driverWsTermLabel(l10n, 'create_fine')),
                      ),
                    OutlinedButton(
                      onPressed: data.truncated ? null : _report,
                      child: Text(l10n.driverWsSharePdf),
                    ),
                    ...data.rows('balances').map(
                          (DriverRow b) => Text(
                            l10n.driverWsOutstanding(
                              '${b['outstanding']}',
                              '${b['currency']}',
                            ),
                          ),
                        ),
                    const SizedBox(height: 16),
                    Text(l10n.driverWsTrafficFines),
                    if (data.rows('fines').isEmpty) Text(l10n.driverWsNoFines),
                    ...data.rows('fines').map(
                          (DriverRow f) => DriverFineCard(
                            key: ValueKey<String>('${f['id']}-${f['version']}'),
                            fine: f,
                            data: data,
                            onAction: _action,
                            onChanged: _load,
                          ),
                        ),
                    const SizedBox(height: 16),
                    Text(l10n.driverWsAssignmentHistory),
                    if (data.rows('assignments').isEmpty)
                      Text(l10n.driverWsNoAssignment),
                    ...data.rows('assignments').map(
                          (DriverRow a) => Card(
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: <Widget>[
                                  Text(
                                    '${a['ends_at'] == null ? l10n.driverWsAssignmentCurrent : l10n.driverWsAssignmentPrevious} · ${a['asset_no'] ?? l10n.driverWsNoVehicle}',
                                  ),
                                  Text(
                                    l10n.driverWsSupervisorLine(
                                      '${a['supervisor_name'] ?? l10n.driverWsNotAssigned}',
                                    ),
                                  ),
                                  Text(
                                    l10n.driverWsManagerLine(
                                      '${a['manager_name'] ?? l10n.driverWsNotAssigned}',
                                    ),
                                  ),
                                  Text(
                                    l10n.driverWsAssignmentPeriod(
                                      '${a['starts_at']}',
                                      '${a['ends_at'] ?? l10n.driverWsPresent}',
                                    ),
                                  ),
                                  if (a['reason'] != null)
                                    Text('${a['reason']}'),
                                ],
                              ),
                            ),
                          ),
                        ),
                    const SizedBox(height: 16),
                    Text(l10n.driverWsAssignedWork),
                    ...data.rows('work').map(
                          (DriverRow work) => ListTile(
                            title: Text('${work['title']}'),
                            subtitle: Text(
                              work['status'] == null
                                  ? l10n.driverWsNotSupplied
                                  : driverWsTermLabel(
                                      l10n,
                                      '${work['status']}',
                                    ),
                            ),
                          ),
                        ),
                    Text(l10n.driverWsVerifiedRecords),
                    Text(l10n.driverWsUnmatchedNotice),
                    ...data.rows('records').map((DriverRow link) {
                      final DriverRow? row = link['record'] is Map
                          ? Map<String, Object?>.from(link['record']! as Map)
                          : null;
                      return Card(
                        child: ExpansionTile(
                          title: Text(
                            driverWsTermLabel(l10n, '${link['source_type']}'),
                          ),
                          subtitle: Text(
                            driverRecordLabel(row) ??
                                l10n.driverWsRecordUnavailable,
                          ),
                          children: <Widget>[
                            if (row != null)
                              ...row.entries
                                  .where(
                                    (entry) =>
                                        entry.key != 'id' &&
                                        entry.value != null,
                                  )
                                  .map(
                                    (entry) => ListTile(
                                      title: Text(
                                        driverWsRecordFieldLabel(
                                          l10n,
                                          entry.key,
                                        ),
                                      ),
                                      subtitle: Text('${entry.value}'),
                                    ),
                                  ),
                          ],
                        ),
                      );
                    }),
                    ExpansionTile(
                      title: Text(l10n.driverWsActivityHistory),
                      children: data.rows('events').map((DriverRow e) {
                        final DriverRow details =
                            Map<String, Object?>.from(e['details']! as Map);
                        return ListTile(
                          title: Text(
                            '${e['actor_name'] ?? l10n.driverWsRecordedUser} · ${driverWsTermLabel(l10n, '${e['action']}')}',
                          ),
                          subtitle: Text(
                            '${e['created_at']} · ${details['reason'] ?? details['explanation'] ?? ''}',
                          ),
                        );
                      }).toList(),
                    ),
                  ],
                ],
              ),
      ),
    );
  }
}

class DriverFineCard extends ConsumerStatefulWidget {
  const DriverFineCard({
    required this.fine,
    required this.data,
    required this.onAction,
    required this.onChanged,
    super.key,
  });
  final DriverRow fine;
  final DriverWorkspaceSnapshot data;
  final Future<void> Function(String, [DriverRow?]) onAction;
  final Future<void> Function() onChanged;
  @override
  ConsumerState<DriverFineCard> createState() => _DriverFineCardState();
}

class _DriverFineCardState extends ConsumerState<DriverFineCard> {
  String Function(AppLocalizations)? _error;
  String? _signature;
  bool _uploading = false;
  DriverWorkspaceRepository get repository =>
      ref.read(driverWorkspaceRepositoryProvider);
  Future<void> _photo(String kind) async {
    setState(() {
      _uploading = true;
      _error = null;
    });
    try {
      final XFile? file = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        maxWidth: 1800,
        imageQuality: 80,
      );
      if (file != null) {
        await repository.uploadPhoto(
          widget.fine,
          file.path,
          kind,
          const Uuid().v4(),
        );
        await widget.onChanged();
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = (AppLocalizations l) => l.driverWsPhotoError);
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final DriverRow f = widget.fine;
    return Card(
      child: ExpansionTile(
        title: Text(
          '${f['notice_reference']} · ${f['amount']} ${f['currency']}',
        ),
        subtitle: Text(
          '${driverWsTermLabel(l10n, '${f['status']}')} · ${driverWsTermLabel(l10n, '${f['response_status']}')}',
        ),
        childrenPadding: const EdgeInsets.all(12),
        children: <Widget>[
          Text(
            '${f['authority']} · ${f['asset_no']} · ${f['incident_at']}',
          ),
          if (f['description'] != null) Text('${f['description']}'),
          Text(
            l10n.driverWsAssignmentLine(
              '${f['assignment_reason'] ?? l10n.driverWsNotSupplied}',
            ),
          ),
          Text(
            l10n.driverWsDueLine(
              '${f['due_date'] ?? l10n.driverWsNotSupplied}',
              '${f['paid_amount']}',
            ),
          ),
          if (widget.data.canRespond &&
              f['status'] == 'open' &&
              <String>['awaiting_response', 'returned']
                  .contains(f['response_status']))
            FilledButton(
              onPressed: () => widget.onAction('respond_fine', f),
              child: Text(l10n.driverWsAcknowledgeRespond),
            ),
          if (widget.data.canReview)
            OutlinedButton(
              onPressed: () => widget.onAction('review_fine', f),
              child: Text(l10n.driverWsReviewPayment),
            ),
          ...driverRows(f['evidence']).map(
            (DriverRow e) => TextButton(
              onPressed: () async {
                try {
                  final String url =
                      await repository.evidenceUrl('${e['object_path']}');
                  if (!await launchUrl(
                    Uri.parse(url),
                    mode: LaunchMode.externalApplication,
                  )) {
                    throw const FormatException('Cannot open evidence');
                  }
                } catch (_) {
                  if (mounted) {
                    setState(
                      () => _error =
                          (AppLocalizations l) => l.driverWsEvidenceOpenError,
                    );
                  }
                }
              },
              child: Text(
                '${driverWsEvidenceKindLabel(l10n, '${e['kind']}')}: ${e['file_name']}',
              ),
            ),
          ),
          if ((widget.data.canReview || widget.data.canRespond) &&
              f['status'] == 'open') ...<Widget>[
            OutlinedButton(
              onPressed: _uploading ? null : () => _photo('payment'),
              child: Text(l10n.driverWsAttachReceipt),
            ),
            OutlinedButton(
              onPressed: _uploading ? null : () => _photo('supporting'),
              child: Text(l10n.driverWsAttachSupporting),
            ),
            if (widget.data.canReview &&
                <String>['awaiting_response', 'returned']
                    .contains(f['response_status']))
              OutlinedButton(
                onPressed: _uploading ? null : () => _photo('notice'),
                child: Text(l10n.driverWsAttachNotice),
              ),
          ],
          ...driverRows(f['responses']).map(
            (DriverRow r) => Column(
              children: <Widget>[
                Text(
                  '${driverWsTermLabel(l10n, '${r['resolution']}')} · ${r['signed_at']}',
                ),
                Text('${r['explanation']}'),
                if (r['payment_reference'] != null)
                  Text('${r['payment_reference']}'),
                TextButton(
                  onPressed: () async {
                    try {
                      final String signature =
                          await repository.signature('${r['id']}');
                      if (mounted) setState(() => _signature = signature);
                    } catch (_) {
                      if (mounted) {
                        setState(
                          () => _error = (AppLocalizations l) =>
                              l.driverWsSignatureUnavailable,
                        );
                      }
                    }
                  },
                  child: Text(l10n.driverWsViewSignature),
                ),
              ],
            ),
          ),
          if (_signature != null) ...<Widget>[
            Text(l10n.driverWsReceiptStatement),
            ColoredBox(
              color: Colors.white,
              child: _signature!.startsWith('<svg')
                  ? SvgPicture.string(_signature!, height: 160)
                  : Image.memory(
                      base64Decode(_signature!.split(',').last),
                      height: 160,
                      errorBuilder: (_, __, ___) =>
                          Text(l10n.driverWsSignatureDisplayError),
                    ),
            ),
          ],
          if (_error != null)
            Text(
              _error!(l10n),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
        ],
      ),
    );
  }
}

class DriverWorkspaceForm extends ConsumerStatefulWidget {
  const DriverWorkspaceForm({
    required this.action,
    required this.owner,
    required this.driverId,
    this.fine,
    super.key,
  });
  final String action;
  final String owner;
  final String? driverId;
  final DriverRow? fine;
  @override
  ConsumerState<DriverWorkspaceForm> createState() =>
      _DriverWorkspaceFormState();
}

class _DriverWorkspaceFormState extends ConsumerState<DriverWorkspaceForm> {
  DriverRow _values = <String, Object?>{
    'source_type': driverRecordTypes.first,
    'resolution': 'direct_payment',
    'decision': 'approve',
  };
  String _request = const Uuid().v4();
  bool _ready = false;
  bool _saving = false;
  String Function(AppLocalizations)? _message;
  DriverWorkspaceRepository get repository =>
      ref.read(driverWorkspaceRepositoryProvider);
  String get draftKey => 'draft_${widget.fine?['id'] ?? 'new'}';
  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    try {
      if (widget.action == 'respond_fine') {
        final DriverRow? draft =
            await repository.readSaved(widget.owner, draftKey);
        if (draft != null) {
          _values = Map<String, Object?>.from(draft['values']! as Map);
          _values['acknowledged'] = false;
          if (draft['version'] != widget.fine?['version']) {
            _values['signature'] = null;
          }
          _request = '${draft['requestId'] ?? const Uuid().v4()}';
        }
      }
      if (mounted) setState(() => _ready = true);
    } catch (_) {
      if (mounted) {
        setState(
          () => _message = (AppLocalizations l) => l.driverWsDraftReadError,
        );
      }
    }
  }

  void _set(String key, Object? value) {
    setState(() {
      _values[key] = value;
      _request = const Uuid().v4();
      if (key == 'source_type') _values['source_id'] = null;
    });
  }

  Future<void> _saveDraft() async {
    await repository.save(widget.owner, draftKey, <String, Object?>{
      'values': _values,
      'version': widget.fine?['version'],
      'requestId': _request,
    });
  }

  Future<void> _submit() async {
    if (!_ready || _saving) return;
    final DriverFineResponseIssue? issue = widget.action == 'respond_fine'
        ? validateDriverFineResponse(_values)
        : null;
    if (issue != null) {
      setState(
        () => _message = (AppLocalizations l) => driverWsIssueMessage(l, issue),
      );
      return;
    }
    setState(() {
      _saving = true;
      _message = null;
    });
    try {
      final DriverRow payload = <String, Object?>{
        ..._values,
        'driver_id': widget.action == 'create_driver'
            ? _values['driver_id']
            : widget.driverId,
        if (widget.fine != null) ...<String, Object?>{
          'fine_id': widget.fine!['id'],
          'version': widget.fine!['version'],
        },
      };
      if (widget.action == 'respond_fine') {
        payload['statement_version'] = driverReceiptStatementVersion;
        final String language = Localizations.localeOf(context).languageCode;
        payload['statement_language'] =
            <String>['en', 'ar', 'ur'].contains(language) ? language : 'en';
        await _saveDraft();
      }
      if (payload['incident_at'] != null) {
        payload['incident_at'] = DateTime.parse('${payload['incident_at']}')
            .toUtc()
            .toIso8601String();
      }
      for (final String key in <String>[
        'due_date',
        'proposed_date',
        'user_id',
        'supervisor_id',
        'manager_id',
        'vehicle_id',
      ]) {
        if (payload[key] == '') payload[key] = null;
      }
      await repository.command(widget.action, payload, _request);
      if (widget.action == 'respond_fine') {
        await repository.clear(widget.owner, draftKey);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) {
        setState(
          () => _message = (AppLocalizations l) => l.driverWsSubmitError,
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(driverWsTermLabel(l10n, widget.action))),
      body: ListView(
        padding: EdgeInsets.fromLTRB(
          16,
          16,
          16,
          MediaQuery.viewInsetsOf(context).bottom + 24,
        ),
        children: <Widget>[
          Text(l10n.driverWsConnectionRequired),
          if (_ready)
            ...driverWsFields[widget.action]!.map((DriverWsField field) {
              final String key = field.key;
              final String label = field.label(l10n);
              final String type = field.type;
              if (<String>['users', 'vehicles', 'records'].contains(type)) {
                return DriverWorkspacePicker(
                  label: label,
                  kind: type == 'records' ? '${_values['source_type']}' : type,
                  value: _values[key],
                  onChanged: (Object? v) => _set(key, v),
                );
              }
              if (<String>['resolution', 'decision', 'record_type']
                  .contains(type)) {
                final List<String> options = type == 'resolution'
                    ? driverFineResolutions
                    : type == 'record_type'
                        ? driverRecordTypes
                        : <String>[
                            'approve',
                            'return',
                            'payment',
                            'cancel',
                            'reopen',
                          ];
                return DropdownButtonFormField<String>(
                  initialValue: _values[key] as String?,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: label),
                  items: options
                      .map(
                        (String v) => DropdownMenuItem<String>(
                          value: v,
                          child: Text(driverWsTermLabel(l10n, v)),
                        ),
                      )
                      .toList(),
                  onChanged: (String? v) => _set(key, v),
                );
              }
              return TextFormField(
                initialValue: '${_values[key] ?? ''}',
                decoration: InputDecoration(labelText: label),
                maxLength: 4000,
                keyboardType: type == 'number'
                    ? const TextInputType.numberWithOptions(decimal: true)
                    : TextInputType.text,
                onChanged: (String v) => _set(key, v),
              );
            }),
          if (_ready && widget.action == 'respond_fine') ...<Widget>[
            CheckboxListTile(
              value: _values['acknowledged'] == true,
              onChanged: (bool? v) => _set('acknowledged', v),
              title: Text(l10n.driverWsReceiptStatement),
            ),
            InspectionApprovalSignaturePad(
              value: _values['signature'] as String?,
              onChanged: (InspectionApprovalSignatureCapture? capture) =>
                  _set('signature', capture?.dataUrl),
            ),
            OutlinedButton(
              onPressed: () async {
                try {
                  await _saveDraft();
                  if (mounted) {
                    setState(
                      () => _message =
                          (AppLocalizations l) => l.driverWsDraftSaved,
                    );
                  }
                } catch (_) {
                  if (mounted) {
                    setState(
                      () => _message =
                          (AppLocalizations l) => l.driverWsDraftSaveError,
                    );
                  }
                }
              },
              child: Text(l10n.driverWsSaveDraft),
            ),
          ],
          if (widget.action == 'review_fine')
            Text(l10n.driverWsReviewDisclaimer),
          if (_message != null) Text(_message!(l10n)),
          FilledButton(
            onPressed: !_ready || _saving ? null : _submit,
            child: Text(_saving ? l10n.driverWsSaving : l10n.driverWsSubmit),
          ),
        ],
      ),
    );
  }
}

class DriverWorkspacePicker extends ConsumerStatefulWidget {
  const DriverWorkspacePicker({
    required this.label,
    required this.kind,
    required this.value,
    required this.onChanged,
    super.key,
  });
  final String label;
  final String kind;
  final Object? value;
  final ValueChanged<Object?> onChanged;
  @override
  ConsumerState<DriverWorkspacePicker> createState() =>
      _DriverWorkspacePickerState();
}

class _DriverWorkspacePickerState extends ConsumerState<DriverWorkspacePicker> {
  Future<void> _choose() async {
    final Object? chosen = await showModalBottomSheet<Object>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (BuildContext context) => FractionallySizedBox(
        heightFactor: 0.8,
        child: _DriverOptions(kind: widget.kind, label: widget.label),
      ),
    );
    if (chosen != null) widget.onChanged(chosen == '' ? null : chosen);
  }

  @override
  Widget build(BuildContext context) => OutlinedButton(
        onPressed: _choose,
        child: Text('${widget.label}${widget.value == null ? '' : ' ✓'}'),
      );
}

class _DriverOptions extends ConsumerStatefulWidget {
  const _DriverOptions({required this.kind, required this.label});
  final String kind;
  final String label;
  @override
  ConsumerState<_DriverOptions> createState() => _DriverOptionsState();
}

class _DriverOptionsState extends ConsumerState<_DriverOptions> {
  List<DriverRow> _rows = <DriverRow>[];
  String _search = '';
  bool _error = false;
  int _offset = 0;
  int _generation = 0;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final int generation = ++_generation;
    try {
      final List<DriverRow> rows = await ref
          .read(driverWorkspaceRepositoryProvider)
          .options(widget.kind, _search, _offset);
      if (mounted && generation == _generation) {
        setState(() {
          _rows = rows;
          _error = false;
        });
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() => _error = true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(widget.label)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          TextField(
            decoration: InputDecoration(labelText: l10n.driverWsSearch),
            onChanged: (String value) => _search = value,
            onSubmitted: (_) {
              _offset = 0;
              _load();
            },
          ),
          OutlinedButton(
            onPressed: () {
              _offset = 0;
              _load();
            },
            child: Text(l10n.driverWsSearch),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(''),
            child: Text(l10n.driverWsClearSelection),
          ),
          if (_error) Text(l10n.driverWsOptionsError),
          ..._rows.take(100).map(
                (DriverRow r) => ListTile(
                  title: Text(
                    '${r['label'] ?? driverRecordLabel(r['record'] is Map ? Map<String, Object?>.from(r['record']! as Map) : null) ?? l10n.driverWsRecordUnavailable}',
                  ),
                  onTap: () => Navigator.of(context).pop(r['id']),
                ),
              ),
          if (_offset > 0)
            TextButton(
              onPressed: () {
                _offset -= 100;
                _load();
              },
              child: Text(l10n.driverWsPreviousOptions),
            ),
          if (_rows.length > 100)
            TextButton(
              onPressed: () {
                _offset += 100;
                _load();
              },
              child: Text(l10n.driverWsMoreOptions),
            ),
        ],
      ),
    );
  }
}
