import { getPatient } from '../repo/patients.js';
import { h } from '../ui/dom.js';
import { getPatientModeCode } from '../ui/mode.js';
import { patientProgressView } from './patient-view.js';

// Startscherm in patiëntmodus: de voortgang van de patiënt die de therapeut gekozen heeft.
export async function patientHomeView() {
  const code = await getPatientModeCode();
  if (code && (await getPatient(code))) return patientProgressView({ code });
  return h('section', { class: 'card empty-state' },
    h('h1', {}, 'Welkom'),
    h('p', { class: 'muted' }, 'Je therapeut zet zo meteen jouw voortgang klaar.'),
  );
}
