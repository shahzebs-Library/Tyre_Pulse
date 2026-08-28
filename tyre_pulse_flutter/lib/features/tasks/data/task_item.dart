library;

/// The columns read by the verified React Native My Work screen.
const String taskListColumns = 'id,title,priority,status,site,asset_no,'
    'description,assigned_to,due_date,created_at';

String? _text(Object? value) {
  if (value is! String) return null;
  final String trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

DateTime? _date(Object? value) {
  final String? text = _text(value);
  return text == null ? null : DateTime.tryParse(text);
}

final class TaskItem {
  factory TaskItem.fromRow(Map<String, Object?> row) {
    final String? id = _text(row['id']);
    final String? title = _text(row['title']);
    if (id == null || title == null) {
      throw const FormatException('Task row has no usable id or title.');
    }
    return TaskItem(
      id: id,
      title: title,
      priority: _text(row['priority']),
      status: _text(row['status']),
      site: _text(row['site']),
      assetNo: _text(row['asset_no']),
      description: _text(row['description']),
      assignedTo: _text(row['assigned_to']),
      dueDate: _date(row['due_date']),
      createdAt: _date(row['created_at']),
    );
  }

  const TaskItem({
    required this.id,
    required this.title,
    this.priority,
    this.status,
    this.site,
    this.assetNo,
    this.description,
    this.assignedTo,
    this.dueDate,
    this.createdAt,
  });

  final String id;
  final String title;
  final String? priority;
  final String? status;
  final String? site;
  final String? assetNo;
  final String? description;
  final String? assignedTo;
  final DateTime? dueDate;
  final DateTime? createdAt;
}
