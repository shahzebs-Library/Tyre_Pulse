/// Goods received on the phone by a store keeper, against one open purchase
/// order line (`inv_store_receipt_*`, migration 20261126180000).
///
/// The phone only RECORDS the delivery. Every rule is the server's: the PO
/// must be approved or ordered, the site must be named in the keeper's own
/// list (never "all sites"), the quantity cannot exceed what is open, no price
/// is ever sent, and stock moves only when a different person approves.
library;

num? _num(Object? v) => v is num ? v : num.tryParse(v?.toString() ?? '');
String? _str(Object? v) {
  final String s = v?.toString().trim() ?? '';
  return s.isEmpty ? null : s;
}

/// One open purchase order line the keeper may receive for.
final class OpenPoLine {
  const OpenPoLine({
    required this.poLineId,
    required this.poNumber,
    required this.qtyOrdered,
    required this.qtyOpen,
    this.poId,
    this.supplier,
    this.site,
    this.lineNo,
    this.itemCode,
    this.itemName,
    this.uom,
    this.qtyAccepted = 0,
    this.locationId,
  });

  factory OpenPoLine.fromJson(Map<String, dynamic> j) => OpenPoLine(
        poLineId: j['po_line_id']?.toString() ?? '',
        poId: _str(j['po_id']),
        poNumber: _str(j['po_number']) ?? '-',
        supplier: _str(j['supplier']),
        site: _str(j['site']),
        lineNo: _num(j['line_no'])?.toInt(),
        itemCode: _str(j['item_code']),
        itemName: _str(j['item_name']),
        uom: _str(j['uom']),
        qtyOrdered: _num(j['qty_ordered']) ?? 0,
        qtyAccepted: _num(j['qty_accepted']) ?? 0,
        qtyOpen: _num(j['qty_open']) ?? 0,
        locationId: _str(j['location_id']),
      );

  final String poLineId;
  final String? poId;
  final String poNumber;
  final String? supplier;
  final String? site;
  final int? lineNo;
  final String? itemCode;
  final String? itemName;
  final String? uom;
  final num qtyOrdered;
  final num qtyAccepted;
  final num qtyOpen;
  final String? locationId;

  String get itemLabel => <String>[
        if (itemCode != null) itemCode!,
        if (itemName != null) itemName!,
      ].join(' ');
}

/// A receiving location at one of the keeper's named sites.
final class ReceivingLocation {
  const ReceivingLocation({
    required this.id,
    required this.code,
    this.name,
    this.site,
  });

  factory ReceivingLocation.fromJson(Map<String, dynamic> j) =>
      ReceivingLocation(
        id: j['id']?.toString() ?? '',
        code: _str(j['code']) ?? '-',
        name: _str(j['name']),
        site: _str(j['site']),
      );

  final String id;
  final String code;
  final String? name;
  final String? site;

  String get label => name == null ? code : '$code · $name';
}

/// A receipt this keeper recorded, with its decision.
final class MyStoreReceipt {
  const MyStoreReceipt({
    required this.id,
    required this.status,
    this.poNumber,
    this.itemCode,
    this.itemName,
    this.qtyReceived = 0,
    this.qtyRejected = 0,
    this.site,
    this.decisionNote,
  });

  factory MyStoreReceipt.fromJson(Map<String, dynamic> j) => MyStoreReceipt(
        id: j['id']?.toString() ?? '',
        status: _str(j['status']) ?? 'pending',
        poNumber: _str(j['po_number']),
        itemCode: _str(j['item_code']),
        itemName: _str(j['item_name']),
        qtyReceived: _num(j['qty_received']) ?? 0,
        qtyRejected: _num(j['qty_rejected']) ?? 0,
        site: _str(j['site']),
        decisionNote: _str(j['decision_note']),
      );

  final String id;
  final String status;
  final String? poNumber;
  final String? itemCode;
  final String? itemName;
  final num qtyReceived;
  final num qtyRejected;
  final String? site;
  final String? decisionNote;

  bool get isPending => status == 'pending';
}

/// What `inv_store_receipt_open_lines` returns.
final class StoreReceiptBoard {
  const StoreReceiptBoard({
    this.lines = const <OpenPoLine>[],
    this.locations = const <ReceivingLocation>[],
    this.mine = const <MyStoreReceipt>[],
  });

  factory StoreReceiptBoard.fromJson(Object? value) {
    final Map<String, dynamic> m =
        value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
    List<T> list<T>(String key, T Function(Map<String, dynamic>) f) => <T>[
          if (m[key] is List)
            for (final Object? row in m[key] as List)
              if (row is Map) f(Map<String, dynamic>.from(row)),
        ];
    return StoreReceiptBoard(
      lines: list('lines', OpenPoLine.fromJson)
          .where((OpenPoLine l) => l.poLineId.isNotEmpty)
          .toList(growable: false),
      locations: list('locations', ReceivingLocation.fromJson)
          .where((ReceivingLocation l) => l.id.isNotEmpty)
          .toList(growable: false),
      mine: list('mine', MyStoreReceipt.fromJson),
    );
  }

  final List<OpenPoLine> lines;
  final List<ReceivingLocation> locations;
  final List<MyStoreReceipt> mine;

  /// Locations at [line]'s site, the line's own location first.
  List<ReceivingLocation> locationsFor(OpenPoLine line) {
    final List<ReceivingLocation> at = <ReceivingLocation>[
      for (final ReceivingLocation l in locations)
        if (line.site == null || l.site == line.site) l,
    ];
    at.sort((ReceivingLocation a, ReceivingLocation b) {
      if (a.id == line.locationId) return -1;
      if (b.id == line.locationId) return 1;
      return a.code.compareTo(b.code);
    });
    return at;
  }
}

/// The form the keeper fills for one line. No price field exists on purpose.
final class StoreReceiptDraft {
  const StoreReceiptDraft({
    required this.line,
    required this.qtyReceived,
    this.qtyRejected = 0,
    this.locationId,
    this.rejectionReason = '',
    this.deliveryNoteNo = '',
    this.notes = '',
    this.deliveryNotePath,
    this.receivedInvalid = false,
    this.rejectedInvalid = false,
  });

  /// Builds a draft from the form's text fields. An empty rejected field is
  /// 0; rejected text that is not a number is an error, never 0.
  factory StoreReceiptDraft.fromText({
    required OpenPoLine line,
    required String received,
    required String rejected,
    String? locationId,
    String rejectionReason = '',
    String deliveryNoteNo = '',
    String notes = '',
    String? deliveryNotePath,
  }) {
    final ReceiptQtyInput r = readReceiptQty(received);
    final ReceiptQtyInput x = readReceiptQty(rejected);
    final num? rej = switch (x) {
      ReceiptQtyEmpty() => 0,
      ReceiptQtyValue(:final num value) => value,
      ReceiptQtyInvalid() => null,
    };
    return StoreReceiptDraft(
      line: line,
      qtyReceived: r is ReceiptQtyValue ? r.value : null,
      qtyRejected: rej,
      receivedInvalid: r is ReceiptQtyInvalid,
      rejectedInvalid: x is ReceiptQtyInvalid,
      locationId: locationId,
      // A reason only means something while goods are rejected.
      rejectionReason: (rej ?? 0) > 0 ? rejectionReason : '',
      deliveryNoteNo: deliveryNoteNo,
      notes: notes,
      deliveryNotePath: deliveryNotePath,
    );
  }

  final OpenPoLine line;
  final num? qtyReceived;
  final num? qtyRejected;
  final String? locationId;
  final String rejectionReason;
  final String deliveryNoteNo;
  final String notes;

  /// Storage path of an uploaded delivery-note photo, if any.
  final String? deliveryNotePath;

  /// The received / rejected text was not a number.
  final bool receivedInvalid;
  final bool rejectedInvalid;

  num get accepted => (qtyReceived ?? 0) - (qtyRejected ?? 0);

  /// A copy key for the first problem, or null when it can be sent. The
  /// server repeats every check; this only saves a round trip.
  String? validate() {
    final num? q = qtyReceived;
    if (receivedInvalid) return 'sr_qtyInvalid';
    if (q == null) return 'sr_qtyRequired';
    if (q <= 0) return 'sr_qtyPositive';
    if (q > 100000) return 'sr_qtyTooLarge';
    if (rejectedInvalid || qtyRejected == null) return 'sr_rejectedInvalid';
    final num r = qtyRejected!;
    if (r < 0 || r > q) return 'sr_rejectedRange';
    if (r > 0 && rejectionReason.trim().isEmpty) return 'sr_reasonRequired';
    if (accepted > line.qtyOpen) return 'sr_overOpen';
    if ((locationId ?? '').isEmpty) return 'sr_locationRequired';
    if (deliveryNoteNo.trim().length > 120) return 'sr_noteTooLong';
    return null;
  }

  /// Identity of the request, for "same request -> same key" retries.
  String get signature => <Object?>[
        line.poLineId,
        qtyReceived,
        qtyRejected,
        locationId,
        rejectionReason.trim(),
        deliveryNoteNo.trim(),
        notes.trim(),
        deliveryNotePath,
      ].join('|');

  Map<String, Object?> toPayload(String clientUuid) => <String, Object?>{
        'client_uuid': clientUuid,
        'po_line_id': line.poLineId,
        'location_id': locationId,
        'qty_received': qtyReceived,
        'qty_rejected': qtyRejected ?? 0,
        if (rejectionReason.trim().isNotEmpty)
          'rejection_reason': rejectionReason.trim(),
        if (deliveryNoteNo.trim().isNotEmpty)
          'delivery_note_no': deliveryNoteNo.trim(),
        if (notes.trim().isNotEmpty) 'notes': notes.trim(),
        if (deliveryNotePath != null) 'delivery_note_path': deliveryNotePath,
      };
}

/// Where a delivery-note photo is stored: the company folder first, so the
/// storage company folder wall applies. The server checks the exact path and
/// that the caller uploaded it.
String storeReceiptPhotoPath(String orgId, String clientUuid) =>
    '$orgId/store_receipts/$clientUuid.jpg';

/// The result of reading a typed quantity.
sealed class ReceiptQtyInput {
  const ReceiptQtyInput();
}

/// Nothing typed.
final class ReceiptQtyEmpty extends ReceiptQtyInput {
  const ReceiptQtyEmpty();
}

/// Text that is not a plain decimal number (letters, hex, `1,000`, NaN).
final class ReceiptQtyInvalid extends ReceiptQtyInput {
  const ReceiptQtyInvalid();
}

final class ReceiptQtyValue extends ReceiptQtyInput {
  const ReceiptQtyValue(this.value);
  final num value;
}

const Map<String, String> _digitMap = <String, String>{
  // Arabic-Indic
  '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3', '\u0664': '4',
  '\u0665': '5', '\u0666': '6', '\u0667': '7', '\u0668': '8', '\u0669': '9',
  // Extended Arabic-Indic (Persian / Urdu)
  '\u06F0': '0', '\u06F1': '1', '\u06F2': '2', '\u06F3': '3', '\u06F4': '4',
  '\u06F5': '5', '\u06F6': '6', '\u06F7': '7', '\u06F8': '8', '\u06F9': '9',
  // Arabic decimal separator
  '\u066B': '.',
};

final RegExp _plainDecimal = RegExp(r'^\d{1,7}(\.\d{1,4})?$');

/// Reads a typed quantity. Accepts Western, Arabic-Indic and Persian digits
/// and `.` or the Arabic decimal separator. A comma (or the Arabic thousands
/// separator) is refused: `1,000` could mean one thousand or one, so it is
/// never guessed. Signs, exponents, hex, NaN and infinity are refused too.
ReceiptQtyInput readReceiptQty(String text) {
  final String t = text.trim();
  if (t.isEmpty) return const ReceiptQtyEmpty();
  final StringBuffer b = StringBuffer();
  for (final int rune in t.runes) {
    final String ch = String.fromCharCode(rune);
    b.write(_digitMap[ch] ?? ch);
  }
  final String n = b.toString();
  if (!_plainDecimal.hasMatch(n)) return const ReceiptQtyInvalid();
  final num? v = num.tryParse(n);
  if (v == null || !v.isFinite) return const ReceiptQtyInvalid();
  return ReceiptQtyValue(v);
}

/// The value, or null when empty or not a number.
num? parseReceiptQty(String text) => switch (readReceiptQty(text)) {
      ReceiptQtyValue(:final num value) => value,
      _ => null,
    };
