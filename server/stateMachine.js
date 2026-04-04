// stateMachine.js
// Pure state machine for one pill dispenser compartment.
// No I/O, no WebSocket, no DB — just logic.
// Each compartment gets its own instance.

'use strict';

const STATES = {
  IDLE:               'IDLE',
  SCHEDULED:          'SCHEDULED',
  PENDING:            'PENDING',
  DISPENSED:          'DISPENSED',
  MISSED:             'MISSED',
  ESCALATED:          'ESCALATED',
  JAM:                'JAM',
  LOW_REFILL:         'LOW_REFILL',
  WRONG_COMPARTMENT:  'WRONG_COMPARTMENT',
};

const CONFIG = {
  DOSE_WINDOW_MS:        15 * 60 * 1000,  // 15 min real
  JAM_DETECT_MS:         30  * 1000,        // 30 sec real
  ESCALATE_AFTER_MISSED: 3,
  LOW_REFILL_GRAMS:      2,
  NOISE_THRESHOLD_GRAMS: 0.5,
};

function createCompartment(id, scheduledTimes = []) {
  let state           = STATES.IDLE;
  let missedStreak    = 0;
  let lastWeight      = null;
  let weightStableAt  = null;   // timestamp when weight last changed
  let windowTimer     = null;   // clearTimeout handle for dose window
  let eventLog        = [];     // append-only, never mutated
  let seqId           = 0;      // monotonic sequence for dedup / ordering
  let lastEventKey    = null;   // dedup guard: block identical event within 1s

  // ── helpers ──────────────────────────────────────────────────────────────

  function emit(type, extra = {}) {
    const key = `${type}:${state}`;
    const now = Date.now();

    // Duplicate guard: same event type+state within 1 second → skip
    if (lastEventKey && lastEventKey.key === key &&
        now - lastEventKey.ts < 1000) return null;
    lastEventKey = { key, ts: now };

    const event = {
      seq:         ++seqId,
      compartment: id,
      type,
      state,
      ts:          now,
      ...extra,
    };
    eventLog.push(event);
    return event;                // caller broadcasts this over WebSocket
  }

  function transition(newState) {
    state = newState;
  }

  function clearWindow() {
    if (windowTimer) { clearTimeout(windowTimer); windowTimer = null; }
  }

  // ── public API ────────────────────────────────────────────────────────────

  // Called by cron/scheduler when a dose is due
  function scheduleDose() {
    if (state !== STATES.IDLE) return null;   // already active
    transition(STATES.SCHEDULED);
    const evt = emit('DOSE_SCHEDULED');

    // Start the 15-min window. If no IR fires → MISSED
    windowTimer = setTimeout(() => {
      if (state === STATES.SCHEDULED || state === STATES.PENDING) {
        transition(STATES.MISSED);
        missedStreak++;
        const missed = emit('DOSE_MISSED', { missedStreak });

        if (missedStreak >= CONFIG.ESCALATE_AFTER_MISSED) {
          transition(STATES.ESCALATED);
          emit('DOSE_ESCALATED', { missedStreak });
        }
        // Automatically return to IDLE for next cycle
        setTimeout(() => { transition(STATES.IDLE); }, 500);
      }
    }, CONFIG.DOSE_WINDOW_MS);

    return evt;
  }

// In onWeightReading(), replace the entire function with this:
function onWeightReading(grams) {
    const events = [];
    const previousWeight = lastWeight;  // capture BEFORE any mutation

    // Noise filter
    if (previousWeight !== null &&
        Math.abs(grams - previousWeight) < CONFIG.NOISE_THRESHOLD_GRAMS) {
      
      // Jam detection: weight stable while PENDING
      if (state === STATES.PENDING) {
        const now = Date.now();
        if (!weightStableAt) weightStableAt = now;
        else if (now - weightStableAt > CONFIG.JAM_DETECT_MS) {
          transition(STATES.JAM);
          const e = emit('PILL_JAM', { weight: grams });
          if (e) events.push(e);
          weightStableAt = null;
        }
      }
      return events;  // weight unchanged, nothing else to do
    }

    // Weight meaningfully changed — reset jam timer and update lastWeight
    weightStableAt = null;
    lastWeight = grams;

    // Pill dispensed: weight drops while PENDING
    if (state === STATES.PENDING && previousWeight !== null && grams < previousWeight) {
      clearWindow();
      missedStreak = 0;
      transition(STATES.DISPENSED);
      const e = emit('DOSE_DISPENSED', { weight: grams });
      if (e) events.push(e);

      setTimeout(() => {
        if (state === STATES.DISPENSED || state === STATES.LOW_REFILL) {
          transition(STATES.IDLE);
          emit('RESET_IDLE');
        }
      }, 3000);
    }

    // Low refill: check AFTER dispensed transition so state is correct
    if (grams < CONFIG.LOW_REFILL_GRAMS && state === STATES.DISPENSED) {
      transition(STATES.LOW_REFILL);
      const e = emit('LOW_REFILL', { weight: grams });
      if (e) events.push(e);
    }

    return events;
}

  // Called when IR sensor fires (patient hand near compartment)
  function onIRDetected(detectedCompartmentId) {
    // Edge case: wrong compartment opened
    if (detectedCompartmentId !== id) {
      if (state === STATES.SCHEDULED || state === STATES.PENDING) {
        transition(STATES.WRONG_COMPARTMENT);
        const e = emit('WRONG_COMPARTMENT', {
          opened: detectedCompartmentId,
          expected: id,
        });
        // Re-alert after a moment — go back to SCHEDULED so they try again
        setTimeout(() => {
          transition(STATES.SCHEDULED);
          emit('DOSE_SCHEDULED');
        }, 2000);
        return e;
      }
      return null;
    }

    // Correct compartment
    if (state === STATES.SCHEDULED) {
      transition(STATES.PENDING);
      return emit('PATIENT_REACHED', { compartment: id });
    }

    // Edge case: IR fires on IDLE (not a scheduled time) — ignore silently
    return null;
  }

  // Called by caregiver dashboard: ACK an alert
  function onAck(alertSeq) {
    // Edge case: stale ACK — seq already resolved
    const target = eventLog.find(e => e.seq === alertSeq);
    if (!target) return emit('ACK_STALE', { alertSeq });

    return emit('ACK_RECEIVED', { alertSeq, forState: target.state });
  }

  // Called when jar is physically cleared
  function onJamCleared() {
    if (state !== STATES.JAM) return null;
    transition(STATES.PENDING);
    return emit('JAM_CLEARED');
  }

  // Called when compartment is refilled (weight jumps significantly)
  function onRefill(newWeight) {
    lastWeight = newWeight;
    if (state === STATES.LOW_REFILL || state === STATES.IDLE) {
      transition(STATES.IDLE);
      return emit('REFILL_CONFIRMED', { weight: newWeight });
    }
    return null;
  }

  // Snapshot for persistence / reconnect replay
  function getSnapshot() {
    return {
      compartment: id,
      state,
      missedStreak,
      lastWeight,
      seqId,
      unresolvedEvents: eventLog.filter(e =>
        ['DOSE_MISSED','PILL_JAM','LOW_REFILL',
         'DOSE_ESCALATED','WRONG_COMPARTMENT'].includes(e.type)
      ),
    };
  }

  return {
    id,
    getState:       () => state,
    scheduleDose,
    onWeightReading,
    onIRDetected,
    onAck,
    onJamCleared,
    onRefill,
    getSnapshot,
    getLog:         () => [...eventLog],
  };
}

module.exports = { createCompartment, STATES, CONFIG };