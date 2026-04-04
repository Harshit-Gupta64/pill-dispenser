// db.js
// Handles all SQLite persistence.
// Two tables: dose_log and alert_queue.

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const db = new Database(path.join(__dirname, 'dispenser.db'));

// Run once on startup — creates tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS dose_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    compartment TEXT    NOT NULL,
    event_type  TEXT    NOT NULL,
    state       TEXT    NOT NULL,
    weight      REAL,
    seq_id      INTEGER,
    ts          INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alert_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    compartment TEXT    NOT NULL,
    event_type  TEXT    NOT NULL,
    seq_id      INTEGER NOT NULL,
    ts          INTEGER NOT NULL,
    resolved    INTEGER DEFAULT 0,
    resolved_ts INTEGER
  );
`);

// Prepared statements — compiled once, fast to reuse
const insertDoseLog = db.prepare(`
  INSERT INTO dose_log (compartment, event_type, state, weight, seq_id, ts)
  VALUES (@compartment, @type, @state, @weight, @seq, @ts)
`);

const insertAlert = db.prepare(`
  INSERT INTO alert_queue (compartment, event_type, seq_id, ts)
  VALUES (@compartment, @type, @seq, @ts)
`);

const resolveAlert = db.prepare(`
  UPDATE alert_queue
  SET resolved = 1, resolved_ts = @resolved_ts
  WHERE seq_id = @seq_id AND compartment = @compartment
`);

const getUnresolvedAlerts = db.prepare(`
  SELECT * FROM alert_queue
  WHERE resolved = 0
  ORDER BY ts ASC
`);

const getRecentDoseLog = db.prepare(`
  SELECT * FROM dose_log
  ORDER BY ts DESC
  LIMIT 100
`);

// Alert event types that need to go into alert_queue
const ALERT_TYPES = new Set([
  'DOSE_MISSED',
  'PILL_JAM',
  'LOW_REFILL',
  'DOSE_ESCALATED',
  'WRONG_COMPARTMENT',
]);

function saveEvent(event) {
  // Always log everything to dose_log
  insertDoseLog.run({
    compartment: event.compartment,
    type:        event.type,
    state:       event.state,
    weight:      event.weight ?? null,
    seq:         event.seq,
    ts:          event.ts,
  });

  // If it's an alert type, also add to alert_queue
  if (ALERT_TYPES.has(event.type)) {
    insertAlert.run({
      compartment: event.compartment,
      type:        event.type,
      seq:         event.seq,
      ts:          event.ts,
    });
  }
}

function resolveAlertBySeq(seqId, compartment) {
  resolveAlert.run({
    seq_id:      seqId,
    compartment,
    resolved_ts: Date.now(),
  });
}

function getUnresolved() {
  return getUnresolvedAlerts.all();
}

function getRecentLog() {
  return getRecentDoseLog.all();
}

module.exports = { saveEvent, resolveAlertBySeq, getUnresolved, getRecentLog };