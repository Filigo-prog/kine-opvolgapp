import { getAll } from '../db.js';
import { h } from '../ui/dom.js';

export async function patientListView() {
  const patients = await getAll('patients');

  return h('section', {},
    h('div', { class: 'page-head' },
      h('h1', {}, 'Patiënten'),
      // Aanmaken van een patiënt volgt in stap 2.
      h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Nieuwe patiënt'),
    ),
    patients.length === 0
      ? h('div', { class: 'card empty-state' },
        h('h2', {}, 'Nog geen patiënten'),
        h('p', { class: 'muted' }, 'Hier verschijnen je patiënten, met hun code, letsel, huidig level en het laatste testmoment.'),
      )
      : h('p', {}, `${patients.length} patiënt(en).`),
  );
}
