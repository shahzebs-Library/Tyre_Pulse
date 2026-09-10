import 'dart:convert';

/// Persists observations in the existing notes field. Photo indices refer to
/// the same ordered photos array sent to the queue, not local paths or URLs.
class WashEvidence {
  const WashEvidence({
    this.before = const <String>[],
    this.after = const <String>[],
    this.washCompleted = false,
    this.conditionChecked = false,
  });
  final List<String> before;
  final List<String> after;
  final bool washCompleted;
  final bool conditionChecked;

  List<String> get photos => <String>[
        ...before.where((p) => p.trim().isNotEmpty),
        ...after.where((p) => p.trim().isNotEmpty),
      ];
  bool get completionConfirmed => washCompleted && conditionChecked;

  String notesWithEvidence(String? notes) {
    final beforeCount = before.where((p) => p.trim().isNotEmpty).length;
    final afterCount = after.where((p) => p.trim().isNotEmpty).length;
    final record = jsonEncode(<String, Object>{
      'version': 1,
      'before_photo_indices': List<int>.generate(beforeCount, (i) => i),
      'after_photo_indices':
          List<int>.generate(afterCount, (i) => beforeCount + i),
      'selected_wash_completed': washCompleted,
      'final_condition_checked': conditionChecked,
    });
    final text = notes?.trim() ?? '';
    return '${text.isEmpty ? '' : '$text\n'}[Wash evidence]\n$record';
  }
}
