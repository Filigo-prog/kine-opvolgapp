// Overzicht van één patiënt in de therapeutmodus. Vertrekpunt voor testmomenten en criteria.

import { describeTimeSince, formatDate, todayIso } from '../domain/dates.js';
import { feedbackNames } from '../domain/milestones.js';
import { milestoneOverview } from '../domain/milestones.js';
import { groupedReferences } from '../domain/references.js';
import { STATES, scheduleStatus, weekLabel } from '../domain/schedule.js';
import { milestoneText } from '../domain/text.js';
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
    patient.sex ? ['Geslacht', patient.sex === 'M' ? 'Man' : 'Vrouw'] : null,
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
        protocol.valdMapping
          ? h('a', { class: 'btn btn-secondary', href: `#/patient/${encodeURIComponent(code)}/import` }, 'Importeren uit VALD Hub')
          : null,
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
    scheduleCard(protocol, patient, sessions),
    referencesCard(protocol, patient),
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
          h('strong', {}, milestoneText(milestone, 'label')),
          h('span', { class: 'muted' }, date ? ` · behaald op ${formatDate(date)}` : ' · nog niet behaald')),
        manual && !date
          ? h('button', {
            type: 'button',
            class: 'btn btn-secondary',
            onclick: async () => {
              await setManualMilestone(code, milestone.id, todayIso());
              showToast(`${milestoneText(milestone, 'label')} geregistreerd.`);
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

const STATE_LABELS = {
  [STATES.DONE]: 'Gedaan',
  [STATES.NEXT]: 'Volgende',
  [STATES.PLANNED]: 'Gepland',
  [STATES.MISSED]: 'Niet gemeten',
};

/** Het testschema uit het protocol, met de datums voor deze patiënt (operatiedatum + weken). */
function scheduleCard(protocol, patient, sessions) {
  if (!protocol.testSchedule) return null;
  const rows = scheduleStatus(protocol.testSchedule, patient.injuryDate, sessions, todayIso());
  return h('details', { class: 'card sessions-card collapsible', open: true },
    h('summary', {}, h('h2', {}, 'Testschema')),
    h('p', { class: 'muted' }, `Datums vanaf ${formatDate(patient.injuryDate)}. Een moment geldt als gedaan met een testmoment binnen de periode, met ${protocol.testSchedule.toleranceWeeks ?? 0} ${(protocol.testSchedule.toleranceWeeks ?? 0) === 1 ? 'week' : 'weken'} speling ervoor en erna.`),
    h('ol', { class: 'schedule-list' }, rows.map((row) => h('li', { class: `schedule-row schedule-${row.state}` },
      h('span', { class: 'schedule-week' }, weekLabel(row.moment)),
      h('span', { class: 'schedule-label' }, row.moment.label, h('span', { class: 'muted' }, ` · ${formatDate(row.from)}${row.to !== row.from ? ` tot ${formatDate(row.to)}` : ''}`)),
      h('span', { class: 'schedule-state' }, STATE_LABELS[row.state], row.sessionDate ? h('span', { class: 'muted' }, ` (${formatDate(row.sessionDate)})`) : null),
    ))),
  );
}

/** Referentiewaarden (cutoffs) uit het protocol, voor het geslacht van de patiënt. */
function referencesCard(protocol, patient) {
  const groups = groupedReferences(protocol, patient.sex);
  if (!groups.length) return null;
  return h('details', { class: 'card sessions-card collapsible' },
    h('summary', {}, h('h2', {}, 'Referentiewaarden')),
    h('p', { class: 'muted' }, patient.sex
      ? `Voor een ${patient.sex === 'M' ? 'man' : 'vrouw'}. De app beslist hier niet mee: het zijn richtwaarden voor jou.`
      : 'Geslacht is niet ingevuld, dus mannen en vrouwen staan naast elkaar. Vul het geslacht in via "Gegevens bewerken".'),
    groups.map(({ group, rows }) => h('div', { class: 'reference-group' },
      h('h3', {}, group),
      h('dl', { class: 'data-list' }, rows.map(({ row, text }) => [h('dt', {}, row.label), h('dd', {}, text)])),
    )),
  );
}
