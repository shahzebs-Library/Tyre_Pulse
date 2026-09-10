/// Server-issued authority for the exact content shown to a reviewer.
final class ApprovalReviewContext {
  const ApprovalReviewContext({
    required this.revision,
    required this.stageToken,
    required this.canDecide,
    required this.mode,
    required this.status,
    this.stages = const [],
    this.history = const [],
    this.currentStage = 0,
    this.canRecover = false,
    this.canReturn = false,
    this.canReassign = false,
    this.canDelegate = false,
    this.delegations = const [],
  });

  factory ApprovalReviewContext.fromJson(Map<String, dynamic> json) {
    final revision = json['revision'];
    final token = json['stage_token'];
    if (revision is! num || token is! String || token.isEmpty) {
      throw const FormatException('Approval review context is incomplete.');
    }
    return ApprovalReviewContext(
      revision: revision.toInt(),
      canRecover: json['can_recover'] == true,
      canReturn: json['can_return'] == true,
      canReassign: json['can_reassign'] == true,
      canDelegate: json['can_delegate'] == true,
      delegations: (json['delegations'] as List? ?? [])
          .whereType<Map<String, dynamic>>()
          .toList(),
      stageToken: token,
      canDecide: json['can_decide'] == true,
      mode: json['mode'] as String? ?? 'legacy',
      status: json['status'] as String? ?? '',
      stages: (json['stages'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList(),
      history: (json['history'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList(),
      currentStage: (json['current_stage'] as num?)?.toInt() ?? 0,
    );
  }

  final int revision;
  final bool canRecover, canReassign, canDelegate, canReturn;
  final List<Map<String, dynamic>> delegations;
  final String stageToken;
  final bool canDecide;
  final String mode;
  final String status;
  final int currentStage;
  final List<Map<String, dynamic>> stages;
  final List<Map<String, dynamic>> history;
}

/// An HTTP success without the accepted operation is not a confirmed decision.
void validateApprovalReceipt(Object? raw, String operationId) {
  if (raw is! Map ||
      raw['ok'] != true ||
      raw['operation_id'] != operationId ||
      raw['status'] is! String ||
      DateTime.tryParse(raw['accepted_at']?.toString() ?? '') == null) {
    throw const FormatException(
      'The server did not confirm this approval operation.',
    );
  }
}
