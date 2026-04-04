// src/useWebSocket.js
import { useEffect, useRef, useState, useCallback } from 'react';

const WS_URL = 'ws://localhost:8080';

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
          setAlerts(payload.data.unresolved || []);
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
            setAlerts(prev => [payload.data, ...prev]);
          }
          break;

        case 'SNOOZED':
          setAlerts(prev => prev.map(a =>
            a.seq === payload.data.seqId ? { ...a, snoozed: true } : a
          ));
          break;

        case 'SNOOZE_EXPIRED':
          setAlerts(prev => prev.map(a =>
            a.seq === payload.data.seqId ? { ...a, snoozed: false } : a
          ));
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
  const ackAlert = useCallback((seqId, compartment) => {
    send({ type: 'ACK', seqId, compartment });
    setAlerts(prev => prev.filter(a => a.seq !== seqId));
  }, [send]);

  // Snooze an alert
  const snoozeAlert = useCallback((seqId, compartment, durationMs = 300000) => {
    send({ type: 'SNOOZE', seqId, compartment, durationMs });
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
  };
}