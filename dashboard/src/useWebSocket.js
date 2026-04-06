// src/useWebSocket.js
import { useEffect, useRef, useState, useCallback } from 'react';

const WS_URL = 'ws://localhost:8080';

function getAlertSeq(alert) {
  return alert.seq ?? alert.seq_id;
}

function isSameAlert(alert, seqId, compartment, alertTs = null) {
  const sameBase = getAlertSeq(alert) === seqId && alert.compartment === compartment;
  if (!sameBase) return false;
  if (alertTs == null) return true;
  return alert.ts === alertTs;
}

function normalizeAlert(alert) {
  return {
    ...alert,
    seq: alert.seq ?? alert.seq_id,
    type: alert.type ?? alert.event_type,
  };
}

export function useWebSocket() {
  const [connected, setConnected]       = useState(false);
  const [snapshot, setSnapshot]         = useState(null);
  const [sensorTicks, setSensorTicks]   = useState({});
  const [events, setEvents]             = useState([]);
  const [alerts, setAlerts]             = useState([]);
  const wsRef                           = useRef(null);
  const reconnectTimer                  = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[ws] connected');
      setConnected(true);
      clearTimeout(reconnectTimer.current);
    };

    ws.onmessage = (msg) => {
      const payload = JSON.parse(msg.data);

      switch (payload.type) {

        case 'SNAPSHOT':
          setSnapshot(payload.data);
          // Load any unresolved alerts from server on connect
          setAlerts((payload.data.unresolved || []).map(normalizeAlert));
          break;

        case 'SENSOR_TICK':
          setSensorTicks(prev => ({
            ...prev,
            [payload.data.compartment]: payload.data,
          }));
          break;

        case 'EVENT':
          setEvents(prev => [payload.data, ...prev].slice(0, 50));
          // If it's an alert type, add to alerts
          const ALERT_TYPES = [
            'DOSE_MISSED','PILL_JAM','LOW_REFILL',
            'DOSE_ESCALATED','WRONG_COMPARTMENT'
          ];
          if (ALERT_TYPES.includes(payload.data.type)) {
            setAlerts(prev => [normalizeAlert(payload.data), ...prev]);
          }
          break;

        case 'SNOOZED':
          setAlerts(prev => prev.map(a => {
            if (!isSameAlert(a, payload.data.seqId, payload.data.compartment, payload.data.alertTs)) return a;
            return { ...a, snoozed: true };
          }));
          break;

        case 'SNOOZE_EXPIRED':
          setAlerts(prev => prev.map(a => {
            if (!isSameAlert(a, payload.data.seqId, payload.data.compartment, payload.data.alertTs)) return a;
            return { ...a, snoozed: false };
          }));
          break;

        default:
          break;
      }
    };

    ws.onclose = () => {
      console.log('[ws] disconnected — retrying in 3s');
      setConnected(false);
      // Exponential backoff reconnect
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error('[ws] error', err);
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Send a message to the server
  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // ACK an alert
  const ackAlert = useCallback((seqId, compartment, alertTs = null) => {
    if (seqId == null) return;
    send({ type: 'ACK', seqId, compartment, alertTs });
    setAlerts(prev => prev.filter(a => !isSameAlert(a, seqId, compartment, alertTs)));
  }, [send]);

  // Snooze an alert
  const snoozeAlert = useCallback((seqId, compartment, alertTs = null, durationMs = 300000) => {
  if (seqId == null) return;
  send({ type: 'SNOOZE', seqId, compartment, alertTs, durationMs });
  setAlerts(prev => prev.map(a => {
    if (!isSameAlert(a, seqId, compartment, alertTs)) return a;
    return { ...a, snoozed: true };
  }));
  }, [send]);

  // Trigger a dose for testing
  const scheduleDose = useCallback((compartment) => {
    send({ type: 'SCHEDULE_DOSE', compartment });
  }, [send]);

  // Simulate IR sensor
  const simulateIR = useCallback((compartment) => {
    send({ type: 'SIMULATE_IR', compartment });
  }, [send]);

  // Simulate weight change
  const simulateWeight = useCallback((compartment, weight) => {
    send({ type: 'SIMULATE_WEIGHT', compartment, weight });
  }, [send]);

  // Simulate patient taking a pill amount in grams
  const simulatePillTaken = useCallback((compartment, grams) => {
    send({ type: 'SIMULATE_PILL_TAKEN', compartment, grams });
  }, [send]);

  // Add this function inside useWebSocket:
  const clearJam = useCallback((compartment) => {
    send({ type: 'CLEAR_JAM', compartment });
  }, [send]);

  // Add to return:


  return {
    connected,
    snapshot,
    sensorTicks,
    events,
    alerts,
    ackAlert,
    snoozeAlert,
    scheduleDose,
    simulateIR,
    simulateWeight,
    simulatePillTaken,
    clearJam,  // ← add clearJam to return
  };
}