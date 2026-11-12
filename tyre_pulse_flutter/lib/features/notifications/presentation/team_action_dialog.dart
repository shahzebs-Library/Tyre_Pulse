library;

import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:url_launcher/url_launcher.dart';

/// A refusal this dialog raises itself, carrying a sentence that is already
/// translated. Anything else that is thrown (a network or database failure)
/// is shown as a plain translated sentence and NEVER as the raw exception
/// text, which can name tables, columns and policies.
final class _TeamActionProblem implements Exception {
  const _TeamActionProblem(this.message);
  final String message;
}

String _problemText(Object error, String fallback) =>
    error is _TeamActionProblem ? error.message : fallback;

/// The translated label for an `action_items.status` value. An unknown value
/// is shown as written rather than hidden.
String teamActionStatusLabel(AppLocalizations l10n, String status) {
  return switch (status) {
    'open' => l10n.teamActionStatusOpen,
    'acknowledged' => l10n.teamActionStatusAcknowledged,
    'in_progress' => l10n.teamActionStatusInProgress,
    'blocked' => l10n.teamActionBlocked,
    'escalated' => l10n.teamActionStatusEscalated,
    'pending_approval' => l10n.teamActionStatusPendingApproval,
    'resolved' => l10n.teamActionStatusResolved,
    'dismissed' => l10n.teamActionStatusDismissed,
    _ => status.replaceAll('_', ' '),
  };
}

/// Action Center task assigned through Message the Team.
/// Every mutation runs through the employee-scoped backend RPC.
class TeamActionDialog extends StatefulWidget {
  const TeamActionDialog({required this.actionId, super.key});
  final String actionId;

  @override
  State<TeamActionDialog> createState() => _TeamActionDialogState();
}

class _TeamActionDialogState extends State<TeamActionDialog> {
  final TextEditingController _reason = TextEditingController();
  final TextEditingController _resolution = TextEditingController();
  Map<String, dynamic>? _action;
  bool _loading = true;
  bool _saving = false;
  bool _uploading = false;
  String? _evidenceMessage;
  List<Map<String, dynamic>> _evidence = <Map<String, dynamic>>[];
  bool _loadStarted = false;
  String? _error;
  SupabaseClient get _db => Supabase.instance.client;

  // The first load reads the translations, which are not available inside
  // initState, so it starts here, once.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_loadStarted) {
      _loadStarted = true;
      unawaited(_load());
    }
  }

  @override
  void dispose() {
    _reason.dispose();
    _resolution.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    try {
      final String? uid = _db.auth.currentUser?.id;
      if (uid == null || widget.actionId.isEmpty) {
        throw _TeamActionProblem(l10n.teamActionSignIn);
      }
      final Map<String, dynamic>? row = await _db
          .from('action_items')
          .select(
            'id,title,status,assigned_user_id,source,due_date,recommended_action,blocked_reason,resolution',
          )
          .eq('id', widget.actionId)
          .eq('assigned_user_id', uid)
          .maybeSingle();
      if (row == null) {
        throw _TeamActionProblem(l10n.teamActionNotYours);
      }
      final List<Map<String, dynamic>> evidence = await _db
          .from('team_action_evidence')
          .select('id,storage_path,mime_type,created_at')
          .eq('action_id', widget.actionId)
          .order('created_at', ascending: false)
          .limit(100);
      if (mounted) {
        setState(() {
          _evidence = evidence;
          _action = row;
          _reason.text = row['blocked_reason']?.toString() ?? '';
          _resolution.text = row['resolution']?.toString() ?? '';
          _error = null;
        });
      }
    } on Object catch (e) {
      if (mounted) {
        setState(() => _error = _problemText(e, l10n.teamActionLoadFailed));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _transition(String status) async {
    if (_saving || _action == null) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    if (status == 'blocked' && _reason.text.trim().length < 5) {
      setState(() => _error = l10n.teamActionBlockTooShort);
      return;
    }
    if (status == 'resolved' && _resolution.text.trim().length < 10) {
      setState(() => _error = l10n.teamActionResolutionTooShort);
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _db.rpc<void>(
        'tp_employee_action_transition',
        params: <String, dynamic>{
          'p_action_id': widget.actionId,
          'p_status': status,
          'p_reason': status == 'blocked' ? _reason.text.trim() : null,
          'p_resolution': status == 'resolved' ? _resolution.text.trim() : null,
        },
      );
      await _load();
    } on Object catch (e) {
      if (mounted) {
        setState(() => _error = _problemText(e, l10n.teamActionSaveFailed));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _uploadPhoto() async {
    if (_uploading || _action == null) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() {
      _uploading = true;
      _error = null;
    });
    try {
      final uid = _db.auth.currentUser?.id;
      if (uid == null) throw _TeamActionProblem(l10n.teamActionSignIn);
      final XFile? photo = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        imageQuality: 83,
        maxWidth: 2200,
      );
      if (photo == null) return;
      final bytes = await photo.readAsBytes();
      if (bytes.isEmpty || bytes.length > 10485760) {
        throw _TeamActionProblem(l10n.teamActionPhotoTooLarge);
      }
      final String path =
          '$uid/${widget.actionId}/${DateTime.now().microsecondsSinceEpoch}.jpg';
      await _db.storage.from('team-action-evidence').uploadBinary(
            path,
            bytes,
            fileOptions:
                const FileOptions(contentType: 'image/jpeg', upsert: false),
          );
      await _db.from('team_action_evidence').insert(<String, dynamic>{
        'action_id': widget.actionId,
        'uploaded_by': uid,
        'storage_path': path,
        'mime_type': 'image/jpeg',
      });
      if (mounted) {
        setState(() => _evidenceMessage = l10n.teamActionPhotoUploaded);
      }
      await _load();
    } on Object catch (error) {
      if (mounted) {
        setState(
          () => _error = _problemText(error, l10n.teamActionUploadFailed),
        );
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _attachDocument() async {
    if (_uploading || _action == null) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() {
      _uploading = true;
      _error = null;
    });
    String? uploadedPath;
    try {
      final uid = _db.auth.currentUser?.id;
      if (uid == null) throw _TeamActionProblem(l10n.teamActionSignIn);
      final PlatformFile? file = await FilePicker.pickFile(
        type: FileType.custom,
        allowedExtensions: <String>['pdf', 'jpg', 'jpeg', 'png', 'webp'],
      );
      if (file == null) return;
      final extension = (file.extension ?? '').toLowerCase();
      final mime = switch (extension) {
        'pdf' => 'application/pdf',
        'png' => 'image/png',
        'webp' => 'image/webp',
        'jpg' || 'jpeg' => 'image/jpeg',
        _ => throw _TeamActionProblem(l10n.teamActionFileType),
      };
      final bytes = await file.readAsBytes();
      if (bytes.isEmpty || bytes.length > 10485760) {
        throw _TeamActionProblem(l10n.teamActionFileSize);
      }
      final path =
          '$uid/${widget.actionId}/${DateTime.now().microsecondsSinceEpoch}.$extension';
      await _db.storage.from('team-action-evidence').uploadBinary(
            path,
            bytes,
            fileOptions: FileOptions(contentType: mime, upsert: false),
          );
      uploadedPath = path;
      await _db.from('team_action_evidence').insert(<String, dynamic>{
        'action_id': widget.actionId,
        'uploaded_by': uid,
        'storage_path': path,
        'mime_type': mime,
      });
      uploadedPath = null;
      if (mounted) {
        setState(() => _evidenceMessage = l10n.wfEvidenceUploaded);
      }
      await _load();
    } on Object catch (error) {
      // A failed metadata insert must not leave an accessible orphan in storage.
      if (uploadedPath != null) {
        try {
          await _db.storage
              .from('team-action-evidence')
              .remove(<String>[uploadedPath]);
        } on Object catch (_) {
          /* keep original error; server cleanup can reconcile */
        }
      }
      if (mounted) {
        setState(
          () => _error = _problemText(error, l10n.teamActionUploadFailed),
        );
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _openEvidence(Map<String, dynamic> item) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    try {
      final path = item['storage_path']?.toString() ?? '';
      if (path.isEmpty) return;
      final signed = await _db.storage
          .from('team-action-evidence')
          .createSignedUrl(path, 60);
      final uri = Uri.parse(signed);
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        throw _TeamActionProblem(l10n.teamActionOpenFailed);
      }
    } on Object catch (_) {
      if (mounted) setState(() => _error = l10n.teamActionOpenFailed);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final row = _action;
    final status = row?['status']?.toString() ?? '';
    final bool open = status == 'open';
    final bool accepted = status == 'acknowledged';
    final bool working = status == 'in_progress';
    final bool blocked = status == 'blocked';
    return AlertDialog(
      title: Text(l10n.teamActionTitle),
      content: SizedBox(
        width: 500,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (_loading) const LinearProgressIndicator(),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              if (_evidenceMessage != null) Text(_evidenceMessage!),
              if (row != null) ...<Widget>[
                Text(
                  row['title']?.toString() ?? l10n.teamActionFallbackTitle,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                Text(row['recommended_action']?.toString() ?? ''),
                const SizedBox(height: 8),
                Text(
                  l10n.teamActionStatusDue(
                    teamActionStatusLabel(l10n, status),
                    row['due_date']?.toString() ?? l10n.teamActionDueNotSet,
                  ),
                ),
                if (open || accepted || working || blocked) ...<Widget>[
                  const SizedBox(height: 12),
                  if (open || accepted || working)
                    TextField(
                      controller: _reason,
                      maxLength: 4000,
                      maxLines: 2,
                      decoration: InputDecoration(
                        labelText: l10n.teamActionBlockReason,
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  if (working)
                    TextField(
                      controller: _resolution,
                      maxLength: 4000,
                      maxLines: 3,
                      decoration: InputDecoration(
                        labelText: l10n.teamActionCompletionDetails,
                        border: const OutlineInputBorder(),
                      ),
                    ),
                ],
                if (_evidence.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 12),
                  Text(l10n.teamActionEvidenceCount(_evidence.length)),
                  for (final file in _evidence)
                    TextButton(
                      onPressed: () => _openEvidence(file),
                      child: Text(
                        file['storage_path']?.toString().split('/').last ??
                            l10n.teamActionEvidenceFallback,
                      ),
                    ),
                ],
                if (status == 'resolved')
                  Text(
                    l10n.teamActionResolution(
                      row['resolution']?.toString() ?? '',
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.actionClose),
        ),
        if (row != null && (open || accepted || working || blocked))
          TextButton(
            onPressed: _uploading ? null : _uploadPhoto,
            child: Text(
              _uploading
                  ? l10n.teamActionUploading
                  : l10n.teamActionSelectPhoto,
            ),
          ),
        if (row != null && (open || accepted || working || blocked))
          TextButton(
            onPressed: _uploading ? null : _attachDocument,
            child: Text(l10n.teamActionAttachFile),
          ),
        if (open)
          TextButton(
            onPressed: _saving ? null : () => _transition('acknowledged'),
            child: Text(l10n.wfActionAccept),
          ),
        if (open || accepted || blocked)
          TextButton(
            onPressed: _saving ? null : () => _transition('in_progress'),
            child: Text(l10n.teamActionStartWork),
          ),
        if (open || accepted || working)
          TextButton(
            onPressed: _saving ? null : () => _transition('blocked'),
            child: Text(l10n.teamActionBlocked),
          ),
        if (working)
          FilledButton(
            onPressed: _saving ? null : () => _transition('resolved'),
            child: Text(l10n.wfActionComplete),
          ),
      ],
    );
  }
}
