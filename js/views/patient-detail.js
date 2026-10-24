// Overzicht van één patiënt in de therapeutmodus. Vertrekpunt voor testmomenten en criteria.

import { getAllByIndex } from '../db.js';
import { describeTimeSince, formatDate } from '../domain/dates.js';
import { loadProtocol, optionLabel } from '../domain/protocol.js';
import { deletePatient, getPatient } from '../repo/patients.js';
import { navigate } from '../router.js';
import { confirmDialog } from '../ui/dialog.js';
import { h, showToast } from '../ui/dom.js';
import { notFound } from '../ui/not-found.js';

export async function patientDetailView({ code }) {
  const patient = await getPatient(code);
  if (!patient) return notFound('Patiënt niet gevonden', `Er is geen patiënt met code ${code}.`);

  const [protocol, levels] = await Promise.all([
    loadProtocol(patient.injury),
    getAllByIndex('levelHistory', 'patientCode', code),
  ]);
  const currentLevel = levels.reduce((max, entry) => Math.max(max, entry.level), 1);
  const editHref = `#/patient/${encodeURIComponent(code)}/bewerken`;

  const associated = [
    ...patient.associatedInjuries.map((value) => optionLabel(protocol, 'associatedInjuries', value)),
    patient.associatedInjuriesOther,
  ].filter(Boolean);

  const graft = patient.injury === 'vkb'
    ? (patient.graft === 'andere' ? `Andere: ${patient.graftOther}` : optionLabel(protocol, 'graft', patient.graft))
    : null;

  const rows = [
    ['Letsel', `${protocol.name}, ${patient.side === 'L' ? 'links' : 'rechts'}`],
    [protocol.dateLabel, `${formatDate(patient.injuryDate)} (${describeTimeSince(patient.injuryDate)} ${protocol.sinceLabel})`],
    graft ? [protocol.patientFields.graft.label, graft] : null,
    [protocol.patientFields.associatedInjuries?.label ?? 'Bijkomende letsels', associated.length ? associated.join(', ') : 'Geen'],
    ['Sport', [patient.sport, patient.sportLevel ? `niveau ${patient.sportLevel}` : ''].filter(Boolean).join(', ') || '–'],
    ['Doel', patient.goal || '–'],
    ['Lichaamsgewicht', patient.bodyWeightKg ? `${patient.bodyWeightKg.toLocaleString('nl-BE')} kg` : '–'],
    ['Protocolversie', patient.protocolVersion],
  ].filter(Boolean);

  async function onDelete() {
    const confirmed = await confirmDialog({
      title: `${code} verwijderen?`,
      message: 'Alle gegevens van deze patiënt worden definitief gewist van dit toestel: testmomenten, criteria, levels en thuisoefeningen. Dit kan niet ongedaan gemaakt worden.',
      confirmLabel: 'Definitief verwijderen',
      danger: true,
    });
    if (!confirmed) return;
    await deletePatient(code);
    showToast(`${code} verwijderd.`);
    navigate('#/patienten');
  }

  return h('section', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, patient.code),
        h('p', { class: 'muted page-subtitle' }, `${protocol.name}, level ${currentLevel}`),
      ),
      h('a', { class: 'btn btn-secondary', href: editHref }, 'Gegevens bewerken'),
    ),
    h('div', { class: 'grid-2' },
      h('div', { class: 'card' },
        h('h2', {}, 'Gegevens'),
        h('dl', { class: 'data-list' },
          rows.map(([term, value]) => [h('dt', {}, term), h('dd', {}, value)])),
      ),
      h('div', { class: 'card stack' },
        h('h2', {}, 'Opvolging'),
        // Deze knoppen worden actief in de volgende stappen.
        h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Testmoment ingeven'),
        h('button', { type: 'button', class: 'btn btn-secondary', disabled: true }, 'Criteria-checklist'),
        h('p', { class: 'muted' }, 'Testmomenten en criteria volgen in de volgende stappen.'),
      ),
    ),
    h('div', { class: 'danger-zone' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-danger-outline', onclick: onDelete }, 'Patiënt verwijderen'),
    ),
  );
}
