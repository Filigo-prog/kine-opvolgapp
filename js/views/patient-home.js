import { h } from '../ui/dom.js';

// Startscherm in patiëntmodus. Vanaf stap 5 toont dit de voortgang van de gekozen patiënt.
export async function patientHomeView() {
  return h('section', { class: 'card empty-state' },
    h('h1', {}, 'Welkom'),
    h('p', { class: 'muted' }, 'Je therapeut zet zo meteen jouw voortgang klaar.'),
  );
}
