// server.js
// WebSocket server — bridges state machine to dashboard.
// Run with: node server.js

'use strict';

const WebSocket = require('ws');
const { createCompartment, STATES, CONFIG } = require('./stateMachine');
const db = require('./db');

const PORT = 8080;
const wss  = new WebSocket.Server({ port: PORT });

// ── Setup: 7 compartments A–G, each its own state machine instance ─────────

const COMPARTMENT_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const compartments    = {};

COMPARTMENT_IDS.forEach(id => {
  compartments[id] = createCompartment(id);
});

console.log(`WebSocket server running on ws://localhost:${PORT}`);

// ── Broadcast to all connected dashboard clients ───────────────────────────

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ── Save and broadcast an event ────────────────────────────────────────────

function handleEvent(event) {
  if (!event) return;
  db.saveEvent(event);
  broadcast({ type: 'EVENT', data: event });
}

// ── Sensor simulator: runs every 1 second ─────────────────────────────────
// Simulates weight readings for each compartment.
// Replace this with real serial port data in Step 3 (Wokwi).

const simulatedWeights = {};
COMPARTMENT_IDS.forEach(id => { simulatedWeights[id] = 20; });

setInterval(() => {
  COMPARTMENT_IDS.forEach(id => {
    const comp   = compartments[id];
    const weight = simulatedWeights[id];

    // Add small random noise ±0.1g to simulate real sensor
    const noisy = weight + (Math.random() * 0.2 - 0.1);
    const events = comp.onWeightReading(parseFloat(noisy.toFixed(2)));
    events.forEach(handleEvent);

    // Broadcast sensor tick to dashboard every second
    broadcast({
      type: 'SENSOR_TICK',
      data: {
        compartment: id,
        weight:      parseFloat(noisy.toFixed(2)),
        state:       comp.getState(),
        ts:          Date.now(),
      },
    });
  });
}, 1000);

// ── Dose scheduler: fires a dose for a compartment ────────────────────────
// In production this would be driven by RTC clock / cron.
// For simulation, dashboard can trigger it, or auto-fire every 30s.

function scheduleDose(compartmentId) {
  const comp = compartments[compartmentId];
  if (!comp) return;
  const event = comp.scheduleDose();
  handleEvent(event);
}

// ── WebSocket connection handler ───────────────────────────────────────────

wss.on('connection', (ws) => {
  console.log('[ws] Dashboard connected');

  // On connect: send current state snapshot + all unresolved alerts
  // This handles the reconnect edge case — dashboard never misses alerts
  const snapshot = {
    type: 'SNAPSHOT',
    data: {
      compartments: COMPARTMENT_IDS.map(id => compartments[id].getSnapshot()),
      unresolved:   db.getUnresolved(),
      recentLog:    db.getRecentLog(),
    },
  };
  ws.send(JSON.stringify(snapshot));

  // Handle messages from dashboard
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { console.error('[ws] Bad JSON from client'); return; }

    switch (msg.type) {

      // Caregiver acknowledged an alert
      case 'ACK': {
        const { seqId, compartment } = msg;
        const comp = compartments[compartment];
        if (!comp) break;
        const event = comp.onAck(seqId);
        db.resolveAlertBySeq(seqId, compartment);
        handleEvent(event);
        break;
      }

      // Caregiver snoozed an alert — server holds the timer
      case 'SNOOZE': {
        const { seqId, compartment, durationMs = 300000 } = msg;
        console.log(`[snooze] compartment ${compartment} seq ${seqId} for ${durationMs}ms`);
        broadcast({ type: 'SNOOZED', data: { seqId, compartment, durationMs } });

        // Re-broadcast the alert after snooze expires
        setTimeout(() => {
          const unresolved = db.getUnresolved();
          const still = unresolved.find(a =>
            a.seq_id === seqId && a.compartment === compartment
          );
          if (still) {
            console.log(`[snooze] expired for compartment ${compartment}`);
            broadcast({ type: 'SNOOZE_EXPIRED', data: { seqId, compartment } });
          }
        }, durationMs);
        break;
      }

      // Dashboard manually triggers a dose (for testing)
      case 'SCHEDULE_DOSE': {
        scheduleDose(msg.compartment);
        break;
      }

      // Dashboard simulates IR sensor (for testing)
      case 'SIMULATE_IR': {
        const comp  = compartments[msg.compartment];
        if (!comp) break;
        const event = comp.onIRDetected(msg.compartment);
        handleEvent(event);
        break;
      }

      // Dashboard simulates weight change (for testing)
      case 'SIMULATE_WEIGHT': {
        simulatedWeights[msg.compartment] = msg.weight;
        console.log(`[sim] compartment ${msg.compartment} weight set to ${msg.weight}g`);
        break;
      }

      // Dashboard simulates a jam being cleared
      case 'CLEAR_JAM': {
        const comp  = compartments[msg.compartment];
        if (!comp) break;
        const event = comp.onJamCleared();
        handleEvent(event);
        break;
      }

      default:
        console.warn('[ws] Unknown message type:', msg.type);
    }
  });

  ws.on('close', () => {
    console.log('[ws] Dashboard disconnected');
  });

  ws.on('error', (err) => {
    console.error('[ws] Error:', err.message);
  });
});