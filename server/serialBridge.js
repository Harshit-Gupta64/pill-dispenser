// serialBridge.js
// Reads Wokwi serial output via their REST API simulation
// Since direct CLI is unavailable, we use manual serial bridge

'use strict';

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

function startSerialBridge(compartments, handleEvent, broadcast) {
  // List available ports
  SerialPort.list().then(ports => {
    console.log('[serial] Available ports:');
    ports.forEach(p => console.log(' -', p.path));
  });
}

module.exports = { startSerialBridge };