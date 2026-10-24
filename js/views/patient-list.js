import { describeTimeSince, formatDate } from '../domain/dates.js';
import { loadAllProtocols } from '../domain/protocol.js';
import { listPatientSummaries } from '../repo/patients.js';
import { h } from '../ui/dom.js';

export async function patientListView() {
  const [summaries, protocols] = await Promise.all([listPatientSummaries(), loadAllProtocols()]);

  return h('section', {},
    h('div', { class: 'page-head' },
      h('h1', {}, 'Patiënten'),
      h('a', { class: 'btn btn-primary', href: '#/patient/nieuw' }, 'Nieuwe patiënt'),
    ),
    summaries.length === 0
      ? h('div', { class: 'card empty-state' },
        h('h2', {}, 'Nog geen patiënten'),
        h('p', { class: 'muted' }, 'Maak een patiënt aan met een code, bv. VKB-001. Gebruik nooit een naam.'),
      )
      : h('ul', { class: 'patient-list', role: 'list' },
        summaries.map((summary) => patientRow(summary, protocols[summary.patient.injury]))),
  );
}

function patientRow({ patient, level, lastTestDate }, protocol) {
  const sideLabel = patient.side === 'L' ? 'links' : 'rechts';
  return h('li', {},
    h('a', { class: 'patient-row', href: `#/patient/${encodeURIComponent(patient.code)}` },
      h('span', { class: 'patient-row-main' },
        h('span', { class: 'patient-code' }, patient.code),
        h('span', { class: 'muted' }, `${protocol?.name ?? patient.injury}, ${sideLabel}`),
      ),
      h('span', { class: 'patient-row-meta' },
        h('span', { class: 'level-pill' }, `Level ${level}`),
        h('span', { class: 'muted' }, `${describeTimeSince(patient.injuryDate)} ${protocol?.sinceLabel ?? ''}`.trim()),
        h('span', { class: 'muted' }, lastTestDate ? `Laatste test: ${formatDate(lastTestDate)}` : 'Nog geen testmoment'),
      ),
    ),
  );
}
