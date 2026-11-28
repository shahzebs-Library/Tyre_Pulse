/**
 * Tyre Pulse - Workshop vehicle intake from a shared Google Sheet.
 *
 * Every 5 minutes this script sends ONLY the rows that are new or changed
 * since the last send to Tyre Pulse. Unchanged rows are never sent.
 *
 * Sheet layout (first row = headers, exactly these names, any order):
 *   Row ID | Asset code | Workshop site | Job card no | Complaint |
 *   Work type | Priority | Production out | Remarks | Entered by | Sent hash | Tyre Pulse result
 * "Row ID", "Sent hash" and "Tyre Pulse result" are filled by the script. Do not type in them.
 *
 * SETUP (the sheet owner does this once; see INTAKE_SHEET_SETUP.md):
 *   1. Extensions > Apps Script, paste this file, save.
 *   2. Project Settings > Script Properties, add:
 *        TP_ENDPOINT = https://<project>.supabase.co/functions/v1/workshop-sheet-ingest
 *        TP_SHEET_ID = the sheet id shown in Tyre Pulse (Workshop Status > Intake > Sheets)
 *        TP_SECRET   = the same long secret you set as WORKSHOP_SHEET_SECRET in Supabase
 *   3. Run installTrigger() once and accept the permissions.
 * Nothing secret is written in this file.
 */
var HEADERS = ['Row ID', 'Asset code', 'Workshop site', 'Job card no', 'Complaint', 'Work type',
  'Priority', 'Production out', 'Remarks', 'Entered by', 'Sent hash', 'Tyre Pulse result'];
var BATCH = 200;

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pushChanges') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pushChanges').timeBased().everyMinutes(5).create();
}

function col_(header, name) {
  var i = header.indexOf(name);
  if (i < 0) throw new Error('Missing column: ' + name);
  return i;
}

function iso_(v) {
  if (v instanceof Date) return v.toISOString();
  return v === null || v === undefined ? '' : String(v).trim();
}

function hash_(parts) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts.join('|'), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function pushChanges() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var endpoint = props.getProperty('TP_ENDPOINT');
    var sheetId = props.getProperty('TP_SHEET_ID');
    var secret = props.getProperty('TP_SECRET');
    if (!endpoint || !sheetId || !secret) throw new Error('Script Properties are not set');

    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var values = sh.getDataRange().getValues();
    if (values.length < 2) { send_(endpoint, sheetId, secret, []); return; }
    var h = values[0].map(function (x) { return String(x).trim(); });
    var c = {};
    HEADERS.forEach(function (name) { c[name] = col_(h, name); });

    var changed = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var asset = iso_(row[c['Asset code']]);
      if (!asset) continue;
      var id = iso_(row[c['Row ID']]);
      if (!id) {
        id = Utilities.getUuid();
        sh.getRange(r + 1, c['Row ID'] + 1).setValue(id);
      }
      var item = {
        source_key: id,
        asset_no: asset,
        site: iso_(row[c['Workshop site']]),
        job_card_ref: iso_(row[c['Job card no']]),
        complaint: iso_(row[c['Complaint']]),
        work_type: iso_(row[c['Work type']]),
        priority: iso_(row[c['Priority']]),
        production_out_at: iso_(row[c['Production out']]),
        remarks: iso_(row[c['Remarks']]),
        entered_by: iso_(row[c['Entered by']]),
        client_entered_at: new Date().toISOString(),
      };
      var digest = hash_([item.asset_no, item.site, item.job_card_ref, item.complaint, item.work_type,
        item.priority, item.production_out_at, item.remarks]);
      if (digest === iso_(row[c['Sent hash']])) continue;  // unchanged since the last send
      changed.push({ rowIndex: r + 1, digest: digest, item: item });
    }

    if (changed.length === 0) { send_(endpoint, sheetId, secret, []); return; }  // heartbeat only
    for (var i = 0; i < changed.length; i += BATCH) {
      var part = changed.slice(i, i + BATCH);
      var result = send_(endpoint, sheetId, secret, part.map(function (x) { return x.item; }));
      var byKey = {};
      (result.rows || []).forEach(function (x) { byKey[x.source_key] = x; });
      part.forEach(function (x) {
        var res = byKey[x.item.source_key];
        var outcome = res ? res.outcome : 'not saved';
        sh.getRange(x.rowIndex, c['Tyre Pulse result'] + 1).setValue(outcome + (res && res.message ? ': ' + res.message : ''));
        if (res && outcome !== 'invalid') sh.getRange(x.rowIndex, c['Sent hash'] + 1).setValue(x.digest);
      });
    }
  } finally {
    lock.releaseLock();
  }
}

function send_(endpoint, sheetId, secret, rows) {
  var body = JSON.stringify({ sheet_id: sheetId, rows: rows });
  var ts = String(Date.now());
  var sig = Utilities.computeHmacSha256Signature(ts + '.' + body, secret, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  var res = UrlFetchApp.fetch(endpoint, {
    method: 'post', contentType: 'application/json', payload: body, muteHttpExceptions: true,
    headers: { 'x-tp-timestamp': ts, 'x-tp-signature': sig },
  });
  if (res.getResponseCode() !== 200) throw new Error('Tyre Pulse refused: ' + res.getResponseCode() + ' ' + res.getContentText());
  return JSON.parse(res.getContentText());
}
