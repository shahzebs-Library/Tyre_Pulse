/// Fleet AI domain: the conversation model, the live fleet snapshot the
/// assistant is grounded on, and the system prompt that forbids it from
/// inventing anything.
///
/// WHY A SNAPSHOT. `chat-ai` (supabase/functions/chat-ai) is a plain proxy to
/// the model: it holds no database tools. A question sent with no data gets
/// an answer made of nothing. The Expo screen solves that by fetching live
/// context first; this port does the same with a small set of exact server
/// counts, each read independently so one failed count is reported as
/// unavailable instead of silently becoming zero.
library;

/// Who said a message.
enum FleetAiRole { user, assistant }

/// One turn of the conversation.
final class FleetAiMessage {
  const FleetAiMessage({required this.role, required this.content});

  final FleetAiRole role;
  final String content;

  Map<String, String> toWire() => <String, String>{
        'role': role == FleetAiRole.user ? 'user' : 'assistant',
        'content': content,
      };
}

/// Live counts the assistant may quote. A null field means that count could
/// not be read, NOT that it is zero.
final class FleetAiSnapshot {
  const FleetAiSnapshot({
    this.vehicles,
    this.criticalTyres,
    this.highRiskTyres,
    this.openCorrectiveActions,
    this.accidentsLast30Days,
  });

  final int? vehicles;
  final int? criticalTyres;
  final int? highRiskTyres;
  final int? openCorrectiveActions;
  final int? accidentsLast30Days;

  /// True when not one count could be read.
  bool get isEmpty =>
      vehicles == null &&
      criticalTyres == null &&
      highRiskTyres == null &&
      openCorrectiveActions == null &&
      accidentsLast30Days == null;

  /// How many of the five counts were read.
  int get readCount => <int?>[
        vehicles,
        criticalTyres,
        highRiskTyres,
        openCorrectiveActions,
        accidentsLast30Days,
      ].whereType<int>().length;

  /// The data block handed to the model. Unreadable counts are named as
  /// unavailable so the model cannot fill them in.
  String toPromptBlock() {
    String v(int? n) => n == null ? 'unavailable' : '$n';
    return <String>[
      'Vehicles in the fleet register: ${v(vehicles)}',
      'Tyres rated Critical risk: ${v(criticalTyres)}',
      'Tyres rated High risk: ${v(highRiskTyres)}',
      'Open corrective actions: ${v(openCorrectiveActions)}',
      'Accidents reported in the last 30 days: ${v(accidentsLast30Days)}',
    ].join('\n');
  }
}

/// The last turns sent with each question. Mirrors the Expo screen's window.
const int kFleetAiHistoryWindow = 8;

/// Upper bound on one question, so a pasted wall of text cannot run up cost.
const int kFleetAiMaxQuestionLength = 1000;

/// The system prompt. The grounding rules are the point of this function.
String buildFleetAiSystemPrompt(FleetAiSnapshot snapshot) {
  return '''
You are Tyre Pulse Fleet AI, a fleet and tyre operations assistant for fleet managers.

Live fleet data (exact counts read from the database just now, scoped to what this user may see):
${snapshot.toPromptBlock()}

Rules:
- Use ONLY the figures above. Never invent numbers, assets, sites, brands, costs or dates.
- If a question needs data that is not listed above, say plainly that this data is not available here and suggest which screen in the app holds it.
- A figure marked unavailable could not be read. Do not estimate it.
- Be concise: lead with the key finding, then at most three short, prioritised recommendations.
- Plain text only. No tables, no markdown headings.
- If the question is outside fleet, tyre or maintenance scope, redirect politely.''';
}

/// Builds the wire message list: the last [kFleetAiHistoryWindow] turns.
List<Map<String, String>> fleetAiWireHistory(List<FleetAiMessage> history) {
  final int start = history.length > kFleetAiHistoryWindow
      ? history.length - kFleetAiHistoryWindow
      : 0;
  return <Map<String, String>>[
    for (final FleetAiMessage message in history.sublist(start))
      message.toWire(),
  ];
}

/// Why a question produced no answer.
enum FleetAiFailureKind {
  /// The administrator switched AI off (edge function 403).
  disabled,

  /// The monthly AI budget is spent (402).
  budget,

  /// Too many requests (429).
  rateLimited,

  /// No connection.
  offline,

  /// The service answered with nothing usable, or an error.
  unavailable,
}

/// Thrown by the repository; the screen maps [kind] to localized copy.
final class FleetAiFailure implements Exception {
  const FleetAiFailure(this.kind);
  final FleetAiFailureKind kind;

  @override
  String toString() => 'FleetAiFailure($kind)';
}

/// Maps an edge-function HTTP status to a failure kind.
FleetAiFailureKind fleetAiFailureForStatus(int status) {
  switch (status) {
    case 0:
      return FleetAiFailureKind.offline;
    case 402:
      return FleetAiFailureKind.budget;
    case 403:
      return FleetAiFailureKind.disabled;
    case 429:
      return FleetAiFailureKind.rateLimited;
    default:
      return FleetAiFailureKind.unavailable;
  }
}
