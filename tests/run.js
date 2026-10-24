// Minimale testrunner in de browser. Open tests/index.html via de lokale server.

import { tests as backupTests } from './backup.test.js';
import { tests as criteriaTests } from './criteria.test.js';
import { tests as dateTests } from './dates.test.js';
import { tests as enkelTests } from './enkel.test.js';
import { tests as homeLogTests } from './home-log.test.js';
import { tests as lsiTests } from './lsi.test.js';
import { tests as milestoneTests } from './milestones.test.js';
import { tests as patientTests } from './patient.test.js';
import { tests as sessionTests } from './test-session.test.js';
import { tests as valdTests } from './vald.test.js';

const suites = { backup: backupTests, criteria: criteriaTests, dates: dateTests, enkel: enkelTests, thuislog: homeLogTests, lsi: lsiTests, mijlpalen: milestoneTests, patient: patientTests, testmoment: sessionTests, vald: valdTests };
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
