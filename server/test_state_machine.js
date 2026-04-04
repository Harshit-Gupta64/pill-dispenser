// test_state_machine.js  — run with: node test_state_machine.js

const { createCompartment, STATES } = require('./stateMachine');

const comp = createCompartment('B');

console.log('--- Test 1: happy path ---');
let e = comp.scheduleDose();
console.log(e.type, '→', comp.getState());   // DOSE_SCHEDULED → SCHEDULED

comp.onIRDetected('B');
console.log(comp.getState());                 // PENDING

// With this — give it an initial weight first, then simulate the pill being taken:
comp.onWeightReading(15);          // initial weight in compartment
const events = comp.onWeightReading(5);  // weight drops → pill taken
console.log(events[0]?.type, '→', comp.getState()); // DOSE_DISPENSED → DISPENSED

console.log('\n--- Test 2: wrong compartment ---');
const comp2 = createCompartment('C');
comp2.scheduleDose();
const wrongEvt = comp2.onIRDetected('A');     // patient opened A, not C
console.log(wrongEvt?.type);                  // WRONG_COMPARTMENT

console.log('\n--- Test 3: jam detection ---');
const comp3 = createCompartment('D');
comp3.scheduleDose();
comp3.onIRDetected('D');                      // now PENDING
comp3.onWeightReading(10);                    // initial weight
// simulate weight stuck for 6 seconds
setTimeout(() => {
  comp3.onWeightReading(10);                  // same weight = stable
  setTimeout(() => {
    const jamEvents = comp3.onWeightReading(10);
    console.log(jamEvents[0]?.type);          // PILL_JAM
    console.log(comp3.getState());            // JAM
  }, 5100);
}, 100);