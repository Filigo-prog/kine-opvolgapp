// Minimale testrunner in de browser. Open tests/index.html via de lokale server.

import { tests as criteriaTests } from './criteria.test.js';
import { tests as dateTests } from './dates.test.js';
import { tests as lsiTests } from './lsi.test.js';
import { tests as patientTests } from './patient.test.js';
import { tests as sessionTests } from './test-session.test.js';

const suites = { criteria: criteriaTests, dates: dateTests, lsi: lsiTests, patient: patientTests, testmoment: sessionTests };
const results = document.getElementById('results');
let passed = 0;
let failed = 0;

for (const [suite, tests] of Object.entries(suites)) {
  for (const [name, fn] of Object.entries(tests)) {
    const li = document.createElement('li');
    try {
      await fn();
      li.className = 'pass';
      li.textContent = `✓ ${suite}: ${name}`;
      passed += 1;
    } catch (error) {
      li.className = 'fail';
      li.textContent = `✗ ${suite}: ${name}: ${error.message}`;
      failed += 1;
    }
    results.append(li);
  }
}

const summary = document.getElementById('summary');
summary.textContent = `${passed} geslaagd, ${failed} mislukt.`;
summary.className = failed ? 'fail' : 'pass';
window.testResult = { passed, failed };
