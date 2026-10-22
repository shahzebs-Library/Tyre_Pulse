library;

import 'dart:async';
import 'package:image_picker/image_picker.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

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
  String? _error;
  SupabaseClient get _db => Supabase.instance.client;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _reason.dispose();
    _resolution.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final String? uid = _db.auth.currentUser?.id;
      if (uid == null || widget.actionId.isEmpty) {
        throw StateError('Sign in to view this assignment.');
      }
      final Map<String, dynamic>? row = await _db.from('action_items')
          .select('id,title,status,assigned_user_id,source,due_date,recommended_action,blocked_reason,resolution')
          .eq('id', widget.actionId).eq('assigned_user_id', uid).maybeSingle();
      if (row == null) throw StateError('This action is not assigned to your account.');
      if (mounted) setState(() {
        _action = row;
        _reason.text = row['blocked_reason']?.toString() ?? '';
        _resolution.text = row['resolution']?.toString() ?? '';
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _transition(String status) async {
    if (_saving || _action == null) return;
    if (status == 'blocked' && _reason.text.trim().length < 5) {
      setState(() => _error = 'Enter at least five characters explaining the blockage.');
      return;
    }
    if (status == 'resolved' && _resolution.text.trim().length < 10) {
      setState(() => _error = 'Describe the completed work (at least ten characters).');
      return;
    }
    setState(() { _saving = true; _error = null; });
    try {
      await _db.rpc('tp_employee_action_transition', params: <String, dynamic>{
        'p_action_id': widget.actionId,
        'p_status': status,
        'p_reason': status == 'blocked' ? _reason.text.trim() : null,
        'p_resolution': status == 'resolved' ? _resolution.text.trim() : null,
      });
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _uploadPhoto() async {
    if (_uploading || _action == null) return;
    setState(() { _uploading = true; _error = null; });
    try {
      final uid = _db.auth.currentUser?.id;
      if (uid == null) throw StateError('Please sign in.');
      final XFile? photo = await ImagePicker().pickImage(
        source: ImageSource.camera, imageQuality: 83, maxWidth: 2200,
      );
      if (photo == null) return;
      final bytes = await photo.readAsBytes();
      if (bytes.isEmpty || bytes.length > 10485760) {
        throw StateError('Photo must be below 10 MB.');
      }
      final String path = '$uid/${widget.actionId}/${DateTime.now().microsecondsSinceEpoch}.jpg';
      await _db.storage.from('team-action-evidence').uploadBinary(path, bytes,
        fileOptions: const FileOptions(contentType: 'image/jpeg', upsert: false));
      await _db.from('team_action_evidence').insert(<String, dynamic>{
        'action_id': widget.actionId, 'uploaded_by': uid,
        'storage_path': path, 'mime_type': 'image/jpeg',
      });
      if (mounted) setState(() => _evidenceMessage = 'Photo uploaded securely.');
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final row = _action;
    final status = row?['status']?.toString() ?? '';
    final bool open = status == 'open';
    final bool accepted = status == 'acknowledged';
    final bool working = status == 'in_progress';
    final bool blocked = status == 'blocked';
    return AlertDialog(
      title: const Text('Assigned follow-up'),
      content: SizedBox(
        width: 500,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (_loading) const LinearProgressIndicator(),
              if (_error != null) Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
              if (_evidenceMessage != null) Text(_evidenceMessage!),
              if (row != null) ...<Widget>[
                Text(row['title']?.toString() ?? 'Action', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                Text(row['recommended_action']?.toString() ?? ''),
                const SizedBox(height: 8),
                Text('Status: $status · Due: ${row['due_date'] ?? 'Not set'}'),
                if (open || accepted || working || blocked) ...<Widget>[
                  const SizedBox(height: 12),
                  if (open || accepted || working)
                    TextField(controller: _reason, maxLength: 4000, maxLines: 2,
                      decoration: const InputDecoration(labelText: 'Block reason', border: OutlineInputBorder())),
                  if (working)
                    TextField(controller: _resolution, maxLength: 4000, maxLines: 3,
                      decoration: const InputDecoration(labelText: 'Completion details', border: OutlineInputBorder())),
                ],
                if (status == 'resolved') Text('Resolution: ${row['resolution'] ?? ''}'),
              ],
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Close')),
        if (row != null && (open || accepted || working || blocked))
          TextButton(onPressed: _uploading ? null : _uploadPhoto,
            child: Text(_uploading ? 'Uploading…' : 'Attach photo evidence')),
        if (open) TextButton(onPressed: _saving ? null : () => _transition('acknowledged'),
            child: const Text('Accept')),
        if (open || accepted || blocked)
          TextButton(onPressed: _saving ? null : () => _transition('in_progress'),
              child: const Text('Start work')),
        if (open || accepted || working)
          TextButton(onPressed: _saving ? null : () => _transition('blocked'),
              child: const Text('Blocked')),
        if (working) FilledButton(onPressed: _saving ? null : () => _transition('resolved'),
            child: const Text('Complete')),
      ],
    );
  }
}
