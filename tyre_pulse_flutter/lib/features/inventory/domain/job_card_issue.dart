/// Issue stock to a job card, or take it back from one, on the phone.
///
/// Pure rules and payload shapes for the two ledger writes the store floor
/// needs against a job card:
///
/// * issue: `inv_issue {idempotency_key, stock_id, qty, reason,
///   source_doc_type: 'job_card', source_doc_id}` (the same call the web
///   Stock > Issue and pick confirmation make, `src/lib/api/inventory.js`
///   issueStock);
/// * return: `inv_post_movement {movement_type: 'issue_return', qty_change,
///   source_doc_type: 'job_card', source_doc_id, reason}` (web
///   returnIssuedStock). The server bounds a return by what that job card
///   took from this stock line and values it at the issued cost; the phone
///   never sends a unit cost.
///
/// Online only, by the same rule as transfers: whether an issue is allowed
/// depends on the CURRENT balance (stock never goes negative), so it is not
/// blindly queued. The form keeps one idempotency key per distinct request
/// ([JobCardMoveDraft.signature]), so pressing Send again after a timeout
/// repeats the same request and can never post the movement twice.
library;

/// Which way the stock moves.
enum JobCardMove { issue, issueReturn }

/// Folds a typed or scanned job card number onto the stored form: trimmed,
/// upper case, inner whitespace collapsed. Null when nothing usable is left.
String? normalizeJobCard(String? raw) {
  final String s = (raw ?? '').trim().replaceAll(RegExp(r'\s+'), ' ');
  return s.isEmpty ? null : s.toUpperCase();
}

/// Escapes `%`, `_` and `\` so an `ilike` filter matches the text exactly
/// (case-insensitive equality, never a pattern).
String escapeLikeExact(String value) =>
    value.replaceAllMapped(RegExp(r'[\\%_]'), (Match m) => '\\${m[0]}');

/// Parses a typed quantity ("2", "2.5", "2,5"). Null unless above zero.
num? parseMoveQty(String text) {
  final num? v = num.tryParse(text.trim().replaceAll(',', '.'));
  if (v == null || v.isNaN || v.isInfinite || v <= 0) return null;
  return v;
}

/// A job card found in `work_orders` (read through RLS).
final class JobCardRef {
  const JobCardRef({
    required this.workOrderNo,
    this.id,
    this.assetNo,
    this.site,
    this.country,
    this.status,
  });

  factory JobCardRef.fromJson(Map<String, Object?> j) => JobCardRef(
        workOrderNo: '${j['work_order_no'] ?? ''}',
        id: j['id']?.toString(),
        assetNo: j['asset_no']?.toString(),
        site: j['site']?.toString(),
        country: j['country']?.toString(),
        status: j['status']?.toString(),
      );

  final String workOrderNo;
  final String? id;
  final String? assetNo;
  final String? site;
  final String? country;
  final String? status;

  /// A closed or cancelled job card should not take more material.
  bool get isClosed {
    final String s = (status ?? '').toLowerCase();
    return s.contains('closed') ||
        s.contains('cancel') ||
        s.contains('complete');
  }
}

/// An open `stock_reservations` row holding this stock line for a job card
/// (read through RLS). Issuing against it consumes the hold, so the reserved
/// units stop counting as taken and the reservation closes when used up.
final class JobCardReservation {
  const JobCardReservation({
    required this.id,
    required this.qty,
    required this.qtyReleased,
    required this.qtyConsumed,
    this.createdAt,
  });

  factory JobCardReservation.fromJson(Map<String, Object?> j) =>
      JobCardReservation(
        id: '${j['id'] ?? ''}',
        qty: _num(j['qty']) ?? 0,
        qtyReleased: _num(j['qty_released']) ?? 0,
        qtyConsumed: _num(j['qty_consumed']) ?? 0,
        createdAt: DateTime.tryParse('${j['created_at'] ?? ''}'),
      );

  final String id;
  final num qty;
  final num qtyReleased;
  final num qtyConsumed;
  final DateTime? createdAt;

  /// What is still held (never below zero).
  num get remaining {
    final num r = qty - qtyReleased - qtyConsumed;
    return r > 0 ? r : 0;
  }
}

/// The reservation an issue consumes: the OLDEST one that still holds
/// something (first reserved, first used). Null when none is open. Rows
/// without a date sort after dated ones; ties break on id so the choice is
/// stable between calls.
JobCardReservation? pickReservation(Iterable<JobCardReservation> rows) {
  final List<JobCardReservation> open = <JobCardReservation>[
    for (final JobCardReservation r in rows)
      if (r.id.isNotEmpty && r.remaining > 0) r,
  ];
  if (open.isEmpty) return null;
  open.sort((JobCardReservation a, JobCardReservation b) {
    final DateTime? x = a.createdAt;
    final DateTime? y = b.createdAt;
    if (x != null && y != null && x != y) return x.compareTo(y);
    if (x == null && y != null) return 1;
    if (x != null && y == null) return -1;
    return a.id.compareTo(b.id);
  });
  return open.first;
}

/// What the person filled in. [validate] returns the copy key of the first
/// problem, or null when the draft can be sent.
final class JobCardMoveDraft {
  const JobCardMoveDraft({
    required this.move,
    required this.stockId,
    required this.jobCard,
    required this.qty,
    this.reason,
    this.available,
    this.reservationId,
    this.reserved,
  });

  final JobCardMove move;
  final String stockId;
  final String? jobCard;
  final num? qty;
  final String? reason;

  /// What the stock line showed when the form opened (a hint only; the
  /// server decides with the live balance).
  final num? available;

  /// The job card's reservation on this stock line to consume (issue only).
  final String? reservationId;

  /// What that reservation still holds. Those units are already set aside
  /// for this job card, so they count towards what can be issued.
  final num? reserved;

  String? validate() {
    if (stockId.trim().isEmpty) return 'jc_needStock';
    if (normalizeJobCard(jobCard) == null) return 'jc_needJobCard';
    final num? q = qty;
    if (q == null || q <= 0) return 'jc_needQty';
    if (move == JobCardMove.issue &&
        available != null &&
        q > available! + (reservationId == null ? 0 : (reserved ?? 0))) {
      return 'jc_moreThanOnHand';
    }
    if (move == JobCardMove.issueReturn && (reason ?? '').trim().isEmpty) {
      return 'jc_needReason';
    }
    return null;
  }

  /// Identifies the request. A new idempotency key is minted whenever it
  /// changes; an identical retry reuses the key.
  String get signature =>
      '${move.name}|$stockId|${normalizeJobCard(jobCard)}|$qty|'
      '${(reason ?? '').trim()}|${reservationId ?? ''}';

  /// The RPC name this draft is sent to.
  String get rpc => switch (move) {
        JobCardMove.issue => 'inv_issue',
        JobCardMove.issueReturn => 'inv_post_movement',
      };

  /// The `p_payload` for [rpc]. Never carries a cost or an actor: the server
  /// stamps who and when from the session, and values the movement itself.
  Map<String, Object?> toPayload(String idempotencyKey) {
    final String? r = (reason ?? '').trim().isEmpty ? null : reason!.trim();
    final String jc = normalizeJobCard(jobCard)!;
    return switch (move) {
      JobCardMove.issue => <String, Object?>{
          'idempotency_key': idempotencyKey,
          'stock_id': stockId,
          'qty': qty,
          'reason': r,
          'source_doc_type': 'job_card',
          'source_doc_id': jc,
          if (reservationId != null) 'reservation_id': reservationId,
        },
      JobCardMove.issueReturn => <String, Object?>{
          'idempotency_key': idempotencyKey,
          'stock_id': stockId,
          'movement_type': 'issue_return',
          'qty_change': qty,
          'reason': r,
          'source_doc_type': 'job_card',
          'source_doc_id': jc,
        },
    };
  }
}

/// The server's answer to a move.
sealed class JobCardMoveOutcome {
  const JobCardMoveOutcome();
}

/// The movement is in the ledger ([replayed] when this was a retry of a
/// request the server had already posted).
final class JobCardMovePosted extends JobCardMoveOutcome {
  const JobCardMovePosted({this.movementId, this.replayed = false});
  final String? movementId;
  final bool replayed;
}

/// Not enough stock: nothing was posted. The ledger logged the shortage.
final class JobCardMoveShortage extends JobCardMoveOutcome {
  const JobCardMoveShortage({this.available, this.requested});
  final num? available;
  final num? requested;
}

num? _num(Object? v) => v is num ? v : num.tryParse('${v ?? ''}');

/// Reads the RPC answer. The ledger answers a shortage with
/// `{status: 'refused_shortage', qty_available, qty_requested}` instead of an
/// error, so it must be read, never assumed to be a success.
JobCardMoveOutcome parseJobCardMoveResponse(Object? data) {
  final Map<Object?, Object?> m =
      data is Map ? data : const <Object?, Object?>{};
  if (m['status'] == 'refused_shortage') {
    return JobCardMoveShortage(
      available: _num(m['qty_available']),
      requested: _num(m['qty_requested']),
    );
  }
  return JobCardMovePosted(
    movementId: m['movement_id']?.toString(),
    replayed: m['replayed'] == true,
  );
}
