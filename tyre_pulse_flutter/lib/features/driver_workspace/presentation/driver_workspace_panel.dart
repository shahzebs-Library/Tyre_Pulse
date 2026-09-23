library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:image_picker/image_picker.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/inspection_approval_signature_pad.dart';
import 'package:tyre_pulse/features/driver_workspace/data/driver_workspace_repository.dart';
import 'package:tyre_pulse/features/driver_workspace/domain/driver_workspace.dart';
import 'package:tyre_pulse/features/driver_workspace/presentation/driver_workspace_copy.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:uuid/uuid.dart';

const Map<String, String> _names = <String, String>{
  'direct_payment': 'I will pay directly',
  'already_paid': 'Already paid',
  'dispute': 'Dispute / incorrect assignment',
  'company_recovery': 'Request company payment / recovery',
  'instalments': 'Request instalments',
  'create_driver': 'Add verified driver',
  'link_account': 'Link login account',
  'assign_team': 'Assign team and vehicle',
  'create_fine': 'Issue traffic fine',
  'link_record': 'Link work record',
  'respond_fine': 'Review and sign',
  'review_fine': 'Review response / payment',
};
String _human(String key) => _names[key] ?? key.replaceAll('_', ' ');

const Map<String, List<List<String>>> _fields = <String, List<List<String>>>{
  'create_driver': <List<String>>[
    ['driver_id', 'Employee ID'],
    ['driver_name', 'Driver name'],
    ['country', 'Country'],
    ['site', 'Site'],
  ],
  'link_account': <List<String>>[
    ['user_id', 'Login account (none removes link)', 'users'],
    ['reason', 'Identity verification / reason'],
  ],
  'assign_team': <List<String>>[
    ['supervisor_id', 'Supervisor', 'users'],
    ['manager_id', 'Manager', 'users'],
    ['vehicle_id', 'Vehicle', 'vehicles'],
    ['reason', 'Assignment reason'],
  ],
  'create_fine': <List<String>>[
    ['vehicle_id', 'Vehicle', 'vehicles'],
    ['authority', 'Issuing authority'],
    ['notice_reference', 'Notice reference'],
    ['incident_at', 'Incident date and time (YYYY-MM-DDTHH:mm)'],
    ['due_date', 'Due date (YYYY-MM-DD)'],
    ['amount', 'Fine amount', 'number'],
    ['currency', 'Currency code'],
    ['description', 'Notice details'],
    ['assignment_reason', 'Evidence confirming driver assignment'],
  ],
  'link_record': <List<String>>[
    ['source_type', 'Record type', 'record_type'],
    ['source_id', 'Existing record', 'records'],
    ['reason', 'How driver identity was verified'],
  ],
  'respond_fine': <List<String>>[
    ['resolution', 'Preferred resolution', 'resolution'],
    ['explanation', 'Explanation / proposed arrangement'],
    ['payment_reference', 'Payment reference (if paid)'],
    ['proposed_date', 'Proposed payment date (YYYY-MM-DD)'],
  ],
  'review_fine': <List<String>>[
    ['decision', 'Decision', 'decision'],
    ['reason', 'Review reason / approved arrangement'],
    ['payment_reference', 'Verified payment reference'],
    ['payment_amount', 'Verified payment amount', 'number'],
  ],
};

/// Uses the existing authenticated Profile surface. The router and offline
/// command registry remain owned by their existing infrastructure.
class DriverWorkspaceEntry extends StatelessWidget {
  const DriverWorkspaceEntry({super.key});
  @override
  Widget build(BuildContext context) => Card(
        child: ListTile(
          leading: const Icon(Icons.badge_outlined),
          title: const DriverText('Driver workspace'),
          subtitle:
              const DriverText('My fines, team assignments and verified work'),
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
  String? _error;
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
        setState(
          () => _error =
              'Workspace unavailable. Check connection, account linking and access, then refresh.',
        );
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
      final pw.Document document = pw.Document();
      document.addPage(
        pw.MultiPage(
          build: (pw.Context context) => <pw.Widget>[
            pw.Header(
              level: 0,
              text: 'Driver statement: ${data.driver!['driver_name']}',
            ),
            pw.Text('Employee ID: ${data.driver!['driver_id']}'),
            pw.TableHelper.fromTextArray(
              headers: <String>[
                'Notice',
                'Currency',
                'Amount',
                'Paid',
                'Status',
                'Response',
              ],
              data: data
                  .rows('fines')
                  .map(
                    (DriverRow f) => <String>[
                      '${f['notice_reference']}',
                      '${f['currency']}',
                      '${f['amount']}',
                      '${f['paid_amount']}',
                      '${f['status']}',
                      '${f['response_status']}',
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
        setState(() => _error = 'Report could not be shared. Try again.');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
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
          title: const DriverText('Driver workspace'),
          leading: IconButton(
            tooltip: 'Back',
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
              tooltip: 'Refresh',
              onPressed: _loading || owner.isEmpty ? null : _load,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: owner.isEmpty
            ? const Center(child: DriverText('Sign in to view your workspace.'))
            : ListView(
                padding: const EdgeInsets.all(16),
                children: <Widget>[
                  if (_loading) const LinearProgressIndicator(),
                  if (_error != null)
                    DriverText(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  if (data?.offline == true)
                    const DriverText(
                      'Offline cached view. Connect and refresh before responding or reviewing.',
                    ),
                  if (data?.truncated == true)
                    const DriverText(
                      'This view is incomplete because it reached the record limit. Export is disabled.',
                    ),
                  if (data != null && _driverId == null) ...<Widget>[
                    if (data.canManage)
                      FilledButton(
                        onPressed: () => _action('create_driver'),
                        child: const DriverText('Add verified driver'),
                      ),
                    TextField(
                      decoration: const InputDecoration(
                        labelText: 'Search drivers',
                      ),
                      onChanged: (String value) =>
                          setState(() => _search = value),
                    ),
                    if (data.rows('drivers').isEmpty)
                      const DriverText(
                        'No linked driver or assigned team is available. Ask an authorized manager to verify your account and assignment.',
                      ),
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
                              title: DriverText(
                                '${d['driver_name']} · ${d['driver_id']}',
                              ),
                              subtitle: DriverText(
                                '${d['site']} · ${d['open_fines']} open fines · ${d['awaiting_response']} awaiting response',
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
                    DriverText(
                      '${data!.driver!['driver_name']} · ${data.driver!['driver_id']}',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    DriverText(
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
                          child: DriverText(_human(action)),
                        ),
                      ),
                    if (data.canReview)
                      FilledButton(
                        onPressed: () => _action('create_fine'),
                        child: const DriverText('Issue traffic fine'),
                      ),
                    OutlinedButton(
                      onPressed: data.truncated ? null : _report,
                      child: const DriverText('Share fine statement PDF'),
                    ),
                    ...data.rows('balances').map(
                          (DriverRow b) => DriverText(
                            'Outstanding: ${b['outstanding']} ${b['currency']}',
                          ),
                        ),
                    const SizedBox(height: 16),
                    const DriverText('Traffic fines'),
                    if (data.rows('fines').isEmpty)
                      const DriverText('No fines recorded.'),
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
                    const DriverText('Team and vehicle assignment history'),
                    if (data.rows('assignments').isEmpty)
                      const DriverText('No assignment recorded.'),
                    ...data.rows('assignments').map(
                          (DriverRow a) => Card(
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: <Widget>[
                                  DriverText(
                                    '${a['ends_at'] == null ? 'Current' : 'Previous'} · ${a['asset_no'] ?? 'No vehicle'}',
                                  ),
                                  DriverText(
                                    'Supervisor: ${a['supervisor_name'] ?? 'Not assigned'}',
                                  ),
                                  DriverText(
                                    'Manager: ${a['manager_name'] ?? 'Not assigned'}',
                                  ),
                                  DriverText(
                                    '${a['starts_at']} → ${a['ends_at'] ?? 'Present'}',
                                  ),
                                  DriverText('${a['reason']}'),
                                ],
                              ),
                            ),
                          ),
                        ),
                    const SizedBox(height: 16),
                    const DriverText('Assigned work'),
                    ...data.rows('work').map(
                          (DriverRow work) => ListTile(
                            title: DriverText('${work['title']}'),
                            subtitle: DriverText(
                              _human('${work['status'] ?? 'Not supplied'}'),
                            ),
                          ),
                        ),
                    const DriverText('Verified work and driver records'),
                    const DriverText(
                      'Unmatched historical records require identity review before they appear here.',
                    ),
                    ...data.rows('records').map((DriverRow link) {
                      final DriverRow? row = link['record'] is Map
                          ? Map<String, Object?>.from(link['record']! as Map)
                          : null;
                      return Card(
                        child: ExpansionTile(
                          title: DriverText(_human('${link['source_type']}')),
                          subtitle: DriverText(driverRecordLabel(row)),
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
                                      title: DriverText(_human(entry.key)),
                                      subtitle: DriverText('${entry.value}'),
                                    ),
                                  ),
                          ],
                        ),
                      );
                    }),
                    ExpansionTile(
                      title: const DriverText('Activity history'),
                      children: data.rows('events').map((DriverRow e) {
                        final DriverRow details =
                            Map<String, Object?>.from(e['details']! as Map);
                        return ListTile(
                          title: DriverText(
                            '${e['actor_name'] ?? 'Recorded user'} · ${_human('${e['action']}')}',
                          ),
                          subtitle: DriverText(
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
  String? _error;
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
        setState(
          () => _error =
              'Photo could not be attached. Your local photo has not been deleted.',
        );
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final DriverRow f = widget.fine;
    return Card(
      child: ExpansionTile(
        title: DriverText(
          '${f['notice_reference']} · ${f['amount']} ${f['currency']}',
        ),
        subtitle: DriverText(
          '${_human('${f['status']}')} · ${_human('${f['response_status']}')}',
        ),
        childrenPadding: const EdgeInsets.all(12),
        children: <Widget>[
          DriverText(
            '${f['authority']} · ${f['asset_no']} · ${f['incident_at']}',
          ),
          DriverText('${f['description']}'),
          DriverText('Assignment: ${f['assignment_reason']}'),
          DriverText(
            'Due: ${f['due_date'] ?? 'Not supplied'} · Paid: ${f['paid_amount']}',
          ),
          if (widget.data.canRespond &&
              f['status'] == 'open' &&
              <String>['awaiting_response', 'returned']
                  .contains(f['response_status']))
            FilledButton(
              onPressed: () => widget.onAction('respond_fine', f),
              child: const DriverText('Acknowledge and respond'),
            ),
          if (widget.data.canReview)
            OutlinedButton(
              onPressed: () => widget.onAction('review_fine', f),
              child: const DriverText('Review / record payment'),
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
                    setState(() => _error = 'Evidence could not be opened.');
                  }
                }
              },
              child: DriverText('${_human('${e['kind']}')}: ${e['file_name']}'),
            ),
          ),
          if ((widget.data.canReview || widget.data.canRespond) &&
              f['status'] == 'open') ...<Widget>[
            OutlinedButton(
              onPressed: _uploading ? null : () => _photo('payment'),
              child: const DriverText('Attach receipt photo'),
            ),
            OutlinedButton(
              onPressed: _uploading ? null : () => _photo('supporting'),
              child: const DriverText('Attach supporting photo'),
            ),
            if (widget.data.canReview &&
                <String>['awaiting_response', 'returned']
                    .contains(f['response_status']))
              OutlinedButton(
                onPressed: _uploading ? null : () => _photo('notice'),
                child: const DriverText('Attach official notice photo'),
              ),
          ],
          ...driverRows(f['responses']).map(
            (DriverRow r) => Column(
              children: <Widget>[
                DriverText(
                  '${_human('${r['resolution']}')} · ${r['signed_at']}',
                ),
                DriverText('${r['explanation']}'),
                if (r['payment_reference'] != null)
                  DriverText('${r['payment_reference']}'),
                TextButton(
                  onPressed: () async {
                    try {
                      final String signature =
                          await repository.signature('${r['id']}');
                      if (mounted) setState(() => _signature = signature);
                    } catch (_) {
                      if (mounted) {
                        setState(() => _error = 'Signature unavailable.');
                      }
                    }
                  },
                  child: const DriverText('View signed acknowledgment'),
                ),
              ],
            ),
          ),
          if (_signature != null) ...<Widget>[
            const DriverText(driverReceiptStatement),
            ColoredBox(
              color: Colors.white,
              child: _signature!.startsWith('<svg')
                  ? SvgPicture.string(_signature!, height: 160)
                  : Image.memory(
                      base64Decode(_signature!.split(',').last),
                      height: 160,
                      errorBuilder: (_, __, ___) =>
                          const DriverText('Signature could not be displayed.'),
                    ),
            ),
          ],
          if (_error != null)
            DriverText(
              _error!,
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
  String? _message;
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
          () => _message =
              'Saved draft could not be read. Nothing has been overwritten.',
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
    final String? issue = widget.action == 'respond_fine'
        ? validateDriverFineResponse(_values)
        : null;
    if (issue != null) {
      setState(() => _message = issue);
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
        payload['statement_version'] = 'receipt-v1';
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
          () => _message =
              'Could not submit. Check the required fields and connection. Refresh if the notice changed.',
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: DriverText(_human(widget.action))),
        body: ListView(
          padding: EdgeInsets.fromLTRB(
            16,
            16,
            16,
            MediaQuery.viewInsetsOf(context).bottom + 24,
          ),
          children: <Widget>[
            const DriverText(
              'Submission requires a connection so the current notice and your access can be checked.',
            ),
            if (_ready)
              ..._fields[widget.action]!.map((List<String> field) {
                final String key = field[0];
                final String label = field[1];
                final String type = field.length > 2 ? field[2] : 'text';
                if (<String>['users', 'vehicles', 'records'].contains(type)) {
                  return DriverWorkspacePicker(
                    label: label,
                    kind:
                        type == 'records' ? '${_values['source_type']}' : type,
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
                            child: DriverText(_human(v)),
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
                title: const DriverText(driverReceiptStatement),
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
                            'Draft saved. It has not been submitted.',
                      );
                    }
                  } catch (_) {
                    if (mounted) {
                      setState(() => _message = 'Draft could not be saved.');
                    }
                  }
                },
                child: const DriverText('Save draft on this device'),
              ),
            ],
            if (widget.action == 'review_fine')
              const DriverText(
                'Approval records the reviewed arrangement. It does not execute payment or payroll deduction. Record only verified payments.',
              ),
            if (_message != null) DriverText(_message!),
            FilledButton(
              onPressed: !_ready || _saving ? null : _submit,
              child: DriverText(_saving ? 'Saving…' : 'Submit'),
            ),
          ],
        ),
      );
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
        child: DriverText('${widget.label}${widget.value == null ? '' : ' ✓'}'),
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
  String? _error;
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
          _error = null;
        });
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() => _error = 'Options unavailable. Try again.');
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: DriverText(widget.label)),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            TextField(
              decoration: const InputDecoration(labelText: 'Search'),
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
              child: const DriverText('Search'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(''),
              child: const DriverText('None / clear selection'),
            ),
            if (_error != null) DriverText(_error!),
            ..._rows.take(100).map(
                  (DriverRow r) => ListTile(
                    title: DriverText(
                      '${r['label'] ?? driverRecordLabel(r['record'] is Map ? Map<String, Object?>.from(r['record']! as Map) : null)}',
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
                child: const DriverText('Previous options'),
              ),
            if (_rows.length > 100)
              TextButton(
                onPressed: () {
                  _offset += 100;
                  _load();
                },
                child: const DriverText('More options'),
              ),
          ],
        ),
      );
}
