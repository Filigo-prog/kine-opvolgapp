// Overzicht van één patiënt in de therapeutmodus. Vertrekpunt voor testmomenten en criteria.

import { describeTimeSince, formatDate, todayIso } from '../domain/dates.js';
import { feedbackNames } from '../domain/milestones.js';
import { milestoneOverview } from '../domain/milestones.js';
import { currentStage, isCompleted, levelByNumber, levelProgress, stageLabel } from '../domain/progression.js';
import { loadProtocol, optionLabel } from '../domain/protocol.js';
import { findTest } from '../domain/test-session.js';
import { getCriteriaStatuses } from '../repo/criteria-status.js';
import { getLevelHistory } from '../repo/level-history.js';
import { getHomeLog } from '../repo/home-log.js';
import { getMilestones, refreshMilestonesDetailed, removeManualMilestone, setManualMilestone } from '../repo/milestones.js';
import { deletePatient, getPatient } from '../repo/patients.js';
import { listTestSessions } from '../repo/test-sessions.js';
import { navigate, render } from '../router.js';
import { confirmDialog } from '../ui/dialog.js';
import { h, showToast } from '../ui/dom.js';
import { homeLogCard } from '../ui/home-log.js';
import { enterPatientMode } from '../ui/mode.js';
import { describeBilateral, describeSingle } from '../ui/format.js';
import { notFound } from '../ui/not-found.js';

export async function patientDetailView({ code }) {
  const patient = await getPatient(code);
  if (!patient) return notFound('Patiënt niet gevonden', `Er is geen patiënt met code ${code}.`);

  const [protocol, history, sessions, statuses, homeLog] = await Promise.all([
    loadProtocol(patient.injury),
    getLevelHistory(code),
    listTestSessions(code),
    getCriteriaStatuses(code),
    getHomeLog(code),
  ]);
  const stage = currentStage(history);
  const level = levelByNumber(protocol, stage);
  const progress = level ? levelProgress(level, statuses) : null;
  const { dates } = await refreshMilestonesDetailed(code, { protocol, sessions, statuses, history, homeLog });
  const storedMilestones = await getMilestones(code);
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
    protocol.patientFields.sportSupport && patient.sportSupport
      ? [protocol.patientFields.sportSupport.label, optionLabel(protocol, 'sportSupport', patient.sportSupport)]
      : null,
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
        h('div', { class: 'button-row' },
          h('a', { class: 'btn btn-secondary', href: `#/patient/${encodeURIComponent(code)}/voortgang` }, 'Bekijk patiëntweergave'),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => enterPatientMode(code) }, 'Toon aan patiënt'),
        ),
      ),
    ),
    protocol.homeLog
      ? homeLogCard({
        patient,
        log: homeLog,
        config: protocol.homeLog,
        today: todayIso(),
        title: 'Thuisoefeningen',
        intro: 'Wat de patiënt thuis deed. Je kan dagen hier ook zelf invullen of verbeteren.',
        onSaved: async () => {
          const { fresh } = await refreshMilestonesDetailed(code, { protocol, sessions, statuses, history, homeLog });
          if (fresh.length) {
            showToast(`Nieuwe mijlpaal: ${feedbackNames(protocol, fresh)}!`, 5000);
            render();
          }
        },
      })
      : null,
    milestoneCard(protocol, dates, storedMilestones, code),
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

/** Mijlpalen voor de therapeut: wat is behaald, en handmatige mijlpalen registreren. */
function milestoneCard(protocol, dates, stored, code) {
  const overview = milestoneOverview(protocol, dates);
  if (!overview.length) return null;

  return h('div', { class: 'card sessions-card' },
    h('h2', {}, 'Mijlpalen'),
    h('ul', { class: 'milestone-admin' }, overview.map(({ milestone, date }) => {
      const manual = milestone.trigger.type === 'manual';
      const isManualEarned = date && stored.get(milestone.id)?.source === 'manual';
      return h('li', { class: 'milestone-admin-item' },
        h('span', {},
          h('strong', {}, milestone.label),
          h('span', { class: 'muted' }, date ? ` · behaald op ${formatDate(date)}` : ' · nog niet behaald')),
        manual && !date
          ? h('button', {
            type: 'button',
            class: 'btn btn-secondary',
            onclick: async () => {
              await setManualMilestone(code, milestone.id, todayIso());
              showToast(`${milestone.label} geregistreerd.`);
              render();
            },
          }, 'Behaald vandaag')
          : null,
        isManualEarned
          ? h('button', {
            type: 'button',
            class: 'btn btn-secondary',
            onclick: async () => {
              await removeManualMilestone(code, milestone.id);
              render();
            },
          }, 'Ongedaan maken')
          : null,
      );
    })),
  );
}
