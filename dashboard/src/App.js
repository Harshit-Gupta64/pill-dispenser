// src/App.js
import React, { useState, useRef } from 'react';
import { useWebSocket } from './useWebSocket';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';

const COMPARTMENTS = ['A','B','C','D','E','F','G'];

const STATE_COLORS = {
  IDLE:              '#888780',
  SCHEDULED:         '#378ADD',
  PENDING:           '#EF9F27',
  DISPENSED:         '#639922',
  MISSED:            '#E24B4A',
  ESCALATED:         '#A32D2D',
  JAM:               '#D85A30',
  LOW_REFILL:        '#BA7517',
  WRONG_COMPARTMENT: '#993C1D',
};

const ALERT_LABELS = {
  DOSE_MISSED:       'Missed dose',
  PILL_JAM:          'Pill jam',
  LOW_REFILL:        'Low refill',
  DOSE_ESCALATED:    'Escalated',
  WRONG_COMPARTMENT: 'Wrong compartment',
};

const ALERT_SEVERITY = {
  DOSE_MISSED:       'danger',
  PILL_JAM:          'danger',
  DOSE_ESCALATED:    'danger',
  LOW_REFILL:        'warning',
  WRONG_COMPARTMENT: 'warning',
};

function App() {
  const {
    connected, sensorTicks, events, alerts,
    ackAlert, snoozeAlert, scheduleDose, simulateIR, simulateWeight,
  } = useWebSocket();

  const [selectedComp, setSelectedComp] = useState('A');
  const [weightInput,  setWeightInput]  = useState(20);

  // useRef so React never freezes it
  const weightHistoryRef = useRef({});
  COMPARTMENTS.forEach(id => {
    if (!weightHistoryRef.current[id]) weightHistoryRef.current[id] = [];
  });

  // Update weight history for chart
  COMPARTMENTS.forEach(id => {
    const tick = sensorTicks[id];
    if (tick) {
      const history = weightHistoryRef.current[id];
      history.push({ t: new Date(tick.ts).toLocaleTimeString(), w: tick.weight });
      if (history.length > 30) history.shift();
    }
  });

  const activeAlerts  = alerts.filter(a => !a.snoozed);
  const snoozedAlerts = alerts.filter(a =>  a.snoozed);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px', maxWidth: '1100px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 500 }}>Smart Pill Dispenser</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '10px', height: '10px', borderRadius: '50%',
            background: connected ? '#639922' : '#E24B4A',
          }}/>
          <span style={{ fontSize: '13px', color: connected ? '#639922' : '#E24B4A' }}>
            {connected ? 'Live' : 'Reconnecting...'}
          </span>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Active alerts',   value: activeAlerts.length,  color: '#E24B4A' },
          { label: 'Snoozed',         value: snoozedAlerts.length, color: '#EF9F27' },
          { label: 'Dispensed today', value: events.filter(e => e.type === 'DOSE_DISPENSED').length, color: '#639922' },
          { label: 'Compartments',    value: COMPARTMENTS.length,  color: '#378ADD' },
        ].map(card => (
          <div key={card.label} style={{ background: '#f5f5f2', borderRadius: '8px', padding: '14px 16px' }}>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px' }}>{card.label}</div>
            <div style={{ fontSize: '24px', fontWeight: 500, color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Compartment grid */}
      <h2 style={{ fontSize: '15px', fontWeight: 500, marginBottom: '12px' }}>Compartments</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '10px', marginBottom: '24px' }}>
        {COMPARTMENTS.map(id => {
          const tick  = sensorTicks[id];
          const state = tick?.state || 'IDLE';
          const color = STATE_COLORS[state] || '#888';
          return (
            <div
              key={id}
              onClick={() => setSelectedComp(id)}
              style={{
                border: `2px solid ${selectedComp === id ? color : '#e0e0d8'}`,
                borderRadius: '10px',
                padding: '12px 8px',
                textAlign: 'center',
                cursor: 'pointer',
                background: selectedComp === id ? `${color}18` : '#fff',
              }}
            >
              <div style={{ fontSize: '18px', fontWeight: 500, color }}>{id}</div>
              <div style={{ fontSize: '11px', color, marginTop: '4px' }}>{state}</div>
              <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                {tick ? `${tick.weight.toFixed(1)}g` : '—'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Weight chart */}
      <h2 style={{ fontSize: '15px', fontWeight: 500, marginBottom: '12px' }}>
        Compartment {selectedComp} — weight history
      </h2>
      <div style={{ background: '#fff', border: '0.5px solid #e0e0d8', borderRadius: '10px', padding: '16px', marginBottom: '24px' }}>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={[...weightHistoryRef.current[selectedComp]]}>
            <XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd"/>
            <YAxis domain={[0, 30]} tick={{ fontSize: 10 }} width={30}/>
            <Tooltip formatter={(v) => [`${Number(v).toFixed(2)}g`, 'weight']}/>
            <Line
              type="monotone" dataKey="w" dot={false}
              stroke={STATE_COLORS[sensorTicks[selectedComp]?.state] || '#378ADD'}
              strokeWidth={1.5}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Simulation controls */}
      <h2 style={{ fontSize: '15px', fontWeight: 500, marginBottom: '12px' }}>Simulation controls</h2>
      <div style={{ background: '#fff', border: '0.5px solid #e0e0d8', borderRadius: '10px', padding: '16px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={selectedComp}
            onChange={e => setSelectedComp(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: '6px', border: '0.5px solid #ccc', fontSize: '13px' }}
          >
            {COMPARTMENTS.map(id => <option key={id}>{id}</option>)}
          </select>

          <button onClick={() => scheduleDose(selectedComp)}
            style={{ padding: '6px 14px', borderRadius: '6px', border: '0.5px solid #378ADD', color: '#378ADD', background: '#fff', cursor: 'pointer', fontSize: '13px' }}>
            Schedule dose
          </button>

          <button onClick={() => simulateIR(selectedComp)}
            style={{ padding: '6px 14px', borderRadius: '6px', border: '0.5px solid #EF9F27', color: '#EF9F27', background: '#fff', cursor: 'pointer', fontSize: '13px' }}>
            Simulate IR
          </button>

          <input
            type="number" value={weightInput} min={0} max={100}
            onChange={e => setWeightInput(Number(e.target.value))}
            style={{ width: '70px', padding: '6px 8px', borderRadius: '6px', border: '0.5px solid #ccc', fontSize: '13px' }}
          />
         <button onClick={() => simulateWeight(selectedComp, weightInput)}
            style={{ padding: '6px 14px', borderRadius: '6px', border: '0.5px solid #639922', color: '#639922', background: '#fff', cursor: 'pointer', fontSize: '13px' }}>
            Set weight
          </button>

          {/* ADD THIS RIGHT HERE */}
          <button onClick={() => {
            simulateWeight(selectedComp, 15);
            setTimeout(() => simulateWeight(selectedComp, 5), 500);
          }}
            style={{ padding: '6px 14px', borderRadius: '6px', border: '0.5px solid #1D9E75', color: '#1D9E75', background: '#fff', cursor: 'pointer', fontSize: '13px' }}>
            Simulate pill taken
          </button>
        </div>
      </div>

      {/* Active alerts */}
      <h2 style={{ fontSize: '15px', fontWeight: 500, marginBottom: '12px' }}>
        Active alerts {activeAlerts.length > 0 &&
          <span style={{ color: '#E24B4A' }}>({activeAlerts.length})</span>}
      </h2>
      <div style={{ background: '#fff', border: '0.5px solid #e0e0d8', borderRadius: '10px', padding: '0 16px', marginBottom: '24px' }}>
        {activeAlerts.length === 0
          ? <p style={{ color: '#aaa', fontSize: '13px', padding: '16px 0' }}>No active alerts</p>
          : activeAlerts.map((a, i) => {
              const sev   = ALERT_SEVERITY[a.type] || 'info';
              const color = sev === 'danger' ? '#E24B4A' : '#EF9F27';
              const bg    = sev === 'danger' ? '#fcebeb' : '#faeeda';
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 0',
                  borderBottom: i < activeAlerts.length - 1 ? '0.5px solid #f0f0e8' : 'none',
                }}>
                  <div>
                    <span style={{ background: bg, color, fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '20px', marginRight: '10px' }}>
                      {sev}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 500 }}>
                      {ALERT_LABELS[a.type] || a.type} — Compartment {a.compartment}
                    </span>
                    <span style={{ fontSize: '12px', color: '#aaa', marginLeft: '10px' }}>
                      {new Date(a.ts).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => snoozeAlert(a.seq, a.compartment)}
                      style={{ padding: '4px 12px', borderRadius: '6px', border: '0.5px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: '12px' }}>
                      Snooze
                    </button>
                    <button onClick={() => ackAlert(a.seq, a.compartment)}
                      style={{ padding: '4px 12px', borderRadius: '6px', border: '0.5px solid #639922', color: '#639922', background: '#fff', cursor: 'pointer', fontSize: '12px' }}>
                      Acknowledge
                    </button>
                  </div>
                </div>
              );
            })
        }
      </div>

      {/* Event log */}
      <h2 style={{ fontSize: '15px', fontWeight: 500, marginBottom: '12px' }}>Event log</h2>
      <div style={{ background: '#fff', border: '0.5px solid #e0e0d8', borderRadius: '10px', padding: '0 16px' }}>
        {events.length === 0
          ? <p style={{ color: '#aaa', fontSize: '13px', padding: '16px 0' }}>No events yet</p>
          : events.slice(0, 20).map((e, i) => (
              <div key={i} style={{
                display: 'flex', gap: '12px', alignItems: 'center',
                padding: '8px 0',
                borderBottom: i < 19 ? '0.5px solid #f0f0e8' : 'none',
                fontSize: '13px',
              }}>
                <span style={{ color: '#aaa', minWidth: '70px' }}>{new Date(e.ts).toLocaleTimeString()}</span>
                <span style={{ color: STATE_COLORS[e.state] || '#888', minWidth: '60px' }}>{e.compartment}</span>
                <span style={{ fontWeight: 500 }}>{e.type}</span>
              </div>
            ))
        }
      </div>

    </div>
  );
}

export default App;