/// `/admin/ai-chat` - a conversation with the existing `chat-ai` function.
///
/// Ported from `mobile/app/(app)/admin/ai-chat.tsx`. Two differences, both on
/// purpose: the conversation is sent as a real multi-turn `messages` array
/// (the edge function supports it), and a refusal is shown as a stated
/// failure next to the question, never written into the transcript as if the
/// model had said it. Nothing here generates an answer locally.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/admin/admin_providers.dart';
import 'package:tyre_pulse/features/admin/domain/admin_models.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_ui.dart';

class AdminAiChatScreen extends ConsumerStatefulWidget {
  const AdminAiChatScreen({required this.route, super.key});

  final AdminAiChatRoute route;

  @override
  ConsumerState<AdminAiChatScreen> createState() => _AdminAiChatScreenState();
}

class _AdminAiChatScreenState extends ConsumerState<AdminAiChatScreen> {
  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();
  final List<AdminChatMessage> _messages = <AdminChatMessage>[];
  bool _sending = false;
  String? _failure;
  String? _failedQuestion;

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  String _failureText(AppLocalizations l10n, Object error) {
    if (error is AdminAiException) {
      return switch (error.failure) {
        AdminAiFailure.disabled => l10n.adminAiErrorDisabled,
        AdminAiFailure.budget => l10n.adminAiErrorBudget,
        AdminAiFailure.rateLimited => l10n.adminAiErrorRateLimit,
        AdminAiFailure.empty => l10n.adminAiErrorEmpty,
        AdminAiFailure.unavailable => l10n.adminAiErrorUnavailable,
      };
    }
    return adminErrorOf(error, l10n.adminAiErrorUnavailable).message;
  }

  Future<void> _send([String? retry]) async {
    final String question = (retry ?? _input.text).trim();
    if (question.isEmpty || _sending) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() {
      if (retry == null) {
        _messages.add(
          AdminChatMessage(role: AdminChatRole.user, content: question),
        );
        _input.clear();
      }
      _sending = true;
      _failure = null;
      _failedQuestion = null;
    });
    _scrollToEnd();
    try {
      final String answer = await ref
          .read(adminRepositoryProvider)
          .askAi(List<AdminChatMessage>.unmodifiable(_messages));
      if (!mounted) return;
      setState(() {
        _messages.add(
          AdminChatMessage(role: AdminChatRole.assistant, content: answer),
        );
        _sending = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _failure = _failureText(l10n, error);
        _failedQuestion = question;
      });
    }
    _scrollToEnd();
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        unawaited(
          _scroll.animateTo(
            _scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
          ),
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final TpPalette palette = TpPalette.of(context);
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.adminAiTitle,
        subtitle: l10n.adminAiSubtitle,
        backFallback: fallback,
        actions: <Widget>[
          if (_messages.isNotEmpty)
            IconButton(
              key: const Key('admin.ai.clear'),
              tooltip: l10n.adminAiClear,
              icon: const Icon(Icons.delete_sweep_outlined),
              onPressed: _sending
                  ? null
                  : () => setState(() {
                        _messages.clear();
                        _failure = null;
                        _failedQuestion = null;
                      }),
            ),
        ],
      ),
      body: Column(
        children: <Widget>[
          Expanded(
            child: _messages.isEmpty && !_sending && _failure == null
                ? TpEmptyState(
                    icon: Icons.auto_awesome_outlined,
                    title: l10n.adminAiEmptyTitle,
                    message: l10n.adminAiEmptyMessage,
                  )
                : ListView(
                    key: const Key('admin.ai.messages'),
                    controller: _scroll,
                    padding: const EdgeInsets.all(TpSpace.lg),
                    children: <Widget>[
                      for (final AdminChatMessage message in _messages)
                        _Bubble(message: message),
                      if (_sending)
                        Padding(
                          padding: const EdgeInsets.only(top: TpSpace.sm),
                          child: Row(
                            children: <Widget>[
                              const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              ),
                              const SizedBox(width: TpSpace.sm),
                              Text(l10n.adminAiThinking),
                            ],
                          ),
                        ),
                      if (_failure != null)
                        Padding(
                          padding: const EdgeInsets.only(top: TpSpace.sm),
                          child: TpCard(
                            key: const Key('admin.ai.failure'),
                            borderColor: palette.critical.base,
                            padding: const EdgeInsets.all(TpSpace.md),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Text(_failure!),
                                const SizedBox(height: TpSpace.sm),
                                TpButton.secondary(
                                  label: l10n.actionRetry,
                                  isCompact: true,
                                  onPressed: () =>
                                      unawaited(_send(_failedQuestion)),
                                ),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
          ),
          DecoratedBox(
            decoration: BoxDecoration(
              color: palette.surface,
              border: Border(top: BorderSide(color: palette.border)),
            ),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: TextField(
                      key: const Key('admin.ai.input'),
                      controller: _input,
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => unawaited(_send()),
                      decoration: InputDecoration(hintText: l10n.adminAiHint),
                    ),
                  ),
                  const SizedBox(width: TpSpace.sm),
                  IconButton.filled(
                    key: const Key('admin.ai.send'),
                    tooltip: l10n.adminAiSend,
                    onPressed: _sending ? null : () => unawaited(_send()),
                    icon: const Icon(Icons.send_rounded),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});

  final AdminChatMessage message;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool mine = message.role == AdminChatRole.user;
    return Align(
      alignment: mine
          ? AlignmentDirectional.centerEnd
          : AlignmentDirectional.centerStart,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.82,
        ),
        child: Container(
          margin: const EdgeInsets.only(bottom: TpSpace.sm),
          padding: const EdgeInsets.all(TpSpace.md),
          decoration: BoxDecoration(
            color: mine ? palette.primarySoft : palette.surface,
            borderRadius: BorderRadius.circular(TpRadius.lg),
            border: Border.all(color: palette.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                mine ? l10n.adminAiYou : l10n.adminAiAssistant,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: palette.textSecondary,
                    ),
              ),
              const SizedBox(height: 2),
              SelectableText(message.content),
            ],
          ),
        ),
      ),
    );
  }
}
