// Overzicht van één patiënt in de therapeutmodus. Vertrekpunt voor testmomenten en criteria.

import { describeTimeSince, formatDate } from '../domain/dates.js';
import { currentStage, isCompleted, levelByNumber, levelProgress, stageLabel } from '../domain/progression.js';
import { loadProtocol, optionLabel } from '../domain/protocol.js';
import { findTest } from '../domain/test-session.js';
import { getCriteriaStatuses } from '../repo/criteria-status.js';
import { getLevelHistory } from '../repo/level-history.js';
import { deletePatient, getPatient } from '../repo/patients.js';
import { listTestSessions } from '../repo/test-sessions.js';
import { navigate } from '../router.js';
import { confirmDialog } from '../ui/dialog.js';
import { h, showToast } from '../ui/dom.js';
import { describeBilateral, describeSingle } from '../ui/format.js';
import { notFound } from '../ui/not-found.js';

export async function patientDetailView({ code }) {
  const patient = await getPatient(code);
  if (!patient) return notFound('Patiënt niet gevonden', `Er is geen patiënt met code ${code}.`);

  const [protocol, history, sessions, statuses] = await Promise.all([
    loadProtocol(patient.injury),
    getLevelHistory(code),
    listTestSessions(code),
    getCriteriaStatuses(code),
  ]);
  const stage = currentStage(history);
  const level = levelByNumber(protocol, stage);
  const progress = level ? levelProgress(level, statuses) : null;
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
        h('p', { class: 'muted page-subtitle' }, `${protocol.name}, ${stageLabel(protocol, stage).toLowerCase()}`),
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
        level
          ? h('div', {},
            h('p', { class: 'level-kicker' }, `Level ${level.number} van ${protocol.levels.length}`),
            h('p', { class: 'level-title' }, level.title),
            h('div', { class: 'progress', role: 'presentation' },
              h('span', { style: `width: ${progress.total ? (progress.met / progress.total) * 100 : 100}%` })),
            h('p', { class: 'muted progress-text' }, `${progress.met} van ${progress.total} criteria voldaan`))
          : null,
        isCompleted(stage, protocol)
          ? h('p', { class: 'notice notice-success' }, `${protocol.completion?.title ?? 'Afgerond'}: bevestigd op ${formatDate(history.at(-1).date)}.`)
          : null,
        h('a', { class: 'btn btn-primary', href: `#/patient/${encodeURIComponent(code)}/test/nieuw` }, 'Testmoment ingeven'),
        h('a', { class: 'btn btn-secondary', href: `#/patient/${encodeURIComponent(code)}/criteria` }, 'Criteria-checklist'),
      ),
    ),
    h('div', { class: 'card sessions-card' },
      h('h2', {}, 'Testmomenten'),
      sessions.length
        ? h('ul', { class: 'session-list' }, sessions.map((session) => sessionItem(session, protocol, code)))
        : h('p', { class: 'muted' }, 'Nog geen testmomenten.'),
    ),
    h('div', { class: 'danger-zone' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-danger-outline', onclick: onDelete }, 'Patiënt verwijderen'),
    ),
  );
}

function sessionItem(session, protocol, code) {
  const chips = Object.entries(session.measurements).map(([testId, measurement]) => {
    const test = findTest(protocol, testId);
    if (!test) return h('li', { class: 'result-chip' }, testId);
    if (test.type === 'bilateral') {
      const { result, values } = describeBilateral(test, measurement);
      return h('li', { class: 'result-chip', title: values }, `${test.label}: `, h('strong', {}, result), ` (${values})`);
    }
    return h('li', { class: 'result-chip' }, `${test.label}: `, h('strong', {}, describeSingle(test, measurement)));
  });

  return h('li', { class: 'session-item' },
    h('div', { class: 'session-head' },
      h('span', { class: 'session-date' }, formatDate(session.date)),
      h('a', { class: 'btn btn-secondary', href: `#/patient/${encodeURIComponent(code)}/test/${session.id}` }, 'Bekijken of bewerken'),
    ),
    session.note ? h('p', { class: 'muted session-note' }, session.note) : null,
    h('ul', { class: 'result-chips' }, chips),
  );
}
