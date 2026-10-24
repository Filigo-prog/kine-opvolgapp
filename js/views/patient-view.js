// Patiëntweergave: level, voortgang, mijlpalen en LSI-grafieken.
// Vakjargon blijft in het therapeutscherm; hier staan korte, positieve zinnen.
// Geen ranglijsten en geen vergelijking met andere patiënten.

import { STATUS } from '../domain/criteria.js';
import { formatDate, todayIso } from '../domain/dates.js';
import { lsiFeedback, lsiSeries, progressFeedback } from '../domain/feedback.js';
import { milestoneOverview } from '../domain/milestones.js';
import { currentStage, isCompleted, levelByNumber, levelProgress, statusOf } from '../domain/progression.js';
import { loadProtocol } from '../domain/protocol.js';
import { allTests } from '../domain/test-session.js';
import { getCriteriaStatuses } from '../repo/criteria-status.js';
import { getHomeLog } from '../repo/home-log.js';
import { getLevelHistory } from '../repo/level-history.js';
import { refreshMilestonesDetailed } from '../repo/milestones.js';
import { getPatient } from '../repo/patients.js';
import { listTestSessions } from '../repo/test-sessions.js';
import { render } from '../router.js';
import { h, showToast } from '../ui/dom.js';
import { homeLogCard } from '../ui/home-log.js';
import { destroyCharts, lsiChartCard } from '../ui/lsi-chart.js';
import { notFound } from '../ui/not-found.js';

/** preview = de therapeut bekijkt wat de patiënt te zien krijgt (met een knop terug). */
export async function patientProgressView({ code }, { preview = false } = {}) {
  destroyCharts();
  const patient = await getPatient(code);
  if (!patient) return notFound('Patiënt niet gevonden', `Er is geen patiënt met code ${code}.`);

  const [protocol, statuses, history, sessions, homeLog] = await Promise.all([
    loadProtocol(patient.injury),
    getCriteriaStatuses(code),
    getLevelHistory(code),
    listTestSessions(code),
    getHomeLog(code),
  ]);
  const stage = currentStage(history);
  const completed = isCompleted(stage, protocol);
  const level = levelByNumber(protocol, stage);
  const { dates } = await refreshMilestonesDetailed(code, { protocol, sessions, statuses, history, homeLog });

  // Na elke bewaarde dag kan er een mijlpaal bijgekomen zijn (bv. Preventiekampioen).
  async function onLogSaved() {
    const { fresh } = await refreshMilestonesDetailed(code, { protocol, sessions, statuses, history, homeLog });
    if (!fresh.length) return;
    const names = protocol.milestones.filter((m) => fresh.includes(m.id)).map((m) => m.label);
    showToast(`Nieuwe mijlpaal: ${names.join(', ')}!`, 5000);
    render();
  }

  return h('div', { class: 'patient-view' },
    preview
      ? h('div', { class: 'preview-bar' },
        h('span', {}, 'Zo ziet de patiënt dit scherm.'),
        h('a', { class: 'btn btn-secondary', href: `#/patient/${encodeURIComponent(code)}` }, 'Terug naar patiënt'))
      : null,
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Jouw voortgang'),
        h('p', { class: 'muted page-subtitle' }, `${patient.code} · ${protocol.name}`),
      ),
    ),
    levelPath(protocol, stage, completed),
    completed ? completionCard(protocol, history) : (level ? levelCard(level, protocol, statuses) : null),
    homeLogSection({ patient, protocol, homeLog, stage, completed, onSaved: onLogSaved }),
    milestoneSection(protocol, dates),
    chartSection(protocol, patient, sessions),
  );
}

function levelPath(protocol, stage, completed) {
  if (!protocol.levels.length) return null;
  const steps = [
    ...protocol.levels.map((level) => ({
      key: level.number,
      title: level.title,
      state: level.number < stage ? 'done' : (level.number === stage && !completed ? 'current' : 'todo'),
    })),
    { key: 'end', title: protocol.completion?.title ?? 'Klaar', state: completed ? 'done' : 'todo' },
  ];
  return h('ol', { class: 'level-path', 'aria-label': 'Jouw levels' },
    steps.map((step, index) => h('li', { class: `level-step level-step-${step.state}`, 'aria-current': step.state === 'current' ? 'step' : null },
      h('span', { class: 'level-dot', 'aria-hidden': 'true' }, step.state === 'done' ? '✓' : String(index + 1)),
      h('span', { class: 'level-step-title' }, step.title),
      h('span', { class: 'visually-hidden' }, step.state === 'done' ? ' (behaald)' : (step.state === 'current' ? ' (hier ben je nu)' : '')),
    )));
}

function levelCard(level, protocol, statuses) {
  const progress = levelProgress(level, statuses);
  const steps = level.criteria
    .filter((criterion) => criterion.patientLabel && statusOf(statuses, criterion.id) !== STATUS.NOT_APPLICABLE);

  return h('div', { class: 'card level-card' },
    h('p', { class: 'level-kicker' }, `Level ${level.number} van ${protocol.levels.length}`),
    h('h2', {}, level.title),
    level.patientGoal ? h('p', { class: 'level-goal' }, level.patientGoal) : null,
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': progress.total, 'aria-valuenow': progress.met, 'aria-label': 'Voortgang in dit level' },
      h('span', { style: `width: ${progress.total ? (progress.met / progress.total) * 100 : 100}%` })),
    h('p', { class: 'progress-text' }, progressFeedback(progress)),
    level.patientFocus?.length
      ? h('div', { class: 'focus-block' },
        h('h3', {}, 'Wat doen we nu?'),
        h('ul', { class: 'focus-list' }, level.patientFocus.map((line) => h('li', {}, line))))
      : null,
    steps.length
      ? h('div', { class: 'focus-block' },
        h('h3', {}, 'Jouw stappen'),
        h('ul', { class: 'step-list' }, steps.map((criterion) => {
          const done = statusOf(statuses, criterion.id) === STATUS.MET;
          return h('li', { class: `step ${done ? 'step-done' : 'step-todo'}` },
            h('span', { class: 'step-mark', 'aria-hidden': 'true' }, done ? '✓' : ''),
            h('span', {}, criterion.patientLabel),
            h('span', { class: 'visually-hidden' }, done ? ' (behaald)' : ' (nog bezig)'));
        })))
      : null,
  );
}

function completionCard(protocol, history) {
  return h('div', { class: 'card completion-card' },
    h('h2', {}, protocol.completion?.title ?? 'Klaar'),
    h('p', {}, protocol.completion?.patientText ?? ''),
    h('p', { class: 'muted' }, `Bevestigd op ${formatDate(history.at(-1)?.date)}.`),
  );
}

function milestoneSection(protocol, dates) {
  const overview = milestoneOverview(protocol, dates);
  if (!overview.length) return null;
  const earnedCount = overview.filter((entry) => entry.date).length;

  return h('section', { class: 'milestone-section' },
    h('h2', {}, 'Jouw mijlpalen'),
    h('p', { class: 'muted' }, `${earnedCount} van de ${overview.length} behaald.`),
    h('ul', { class: 'badge-grid' }, overview.map(({ milestone, date }) => h('li', { class: `badge ${date ? 'badge-earned' : 'badge-locked'}` },
      h('span', { class: 'badge-mark', 'aria-hidden': 'true' }, date ? '✓' : ''),
      h('span', { class: 'badge-text' },
        h('strong', {}, milestone.label),
        h('span', { class: 'badge-desc' }, milestone.description ?? ''),
        h('span', { class: 'badge-date' }, date ? `Behaald op ${formatDate(date)}` : 'Nog te behalen')),
    ))),
  );
}

function chartSection(protocol, patient, sessions) {
  const labels = protocol.patientSideLabels ?? { injured: 'Aangedaan been', healthy: 'Ander been' };
  const sideLabels = { ...labels, side: patient.side };
  const cards = allTests(protocol)
    .filter((test) => test.type === 'bilateral' && test.compare !== 'difference')
    .map((test) => ({ test, series: lsiSeries(sessions, test.id) }))
    .filter(({ series }) => series.length)
    .map(({ test, series }) => lsiChartCard({
      test,
      series,
      target: test.target ?? 90,
      feedback: lsiFeedback(test, series),
      sideLabels,
    }));

  return h('section', { class: 'chart-section' },
    h('h2', {}, 'Jouw cijfers'),
    cards.length
      ? [
        h('p', { class: 'muted' }, 'Hoe sterk of vaardig is je aangedane been vergeleken met je andere been? 100 % betekent evenveel. De groene zone is het doel.'),
        h('div', { class: 'grid-2' }, cards),
      ]
      : h('div', { class: 'card empty-state' },
        h('p', { class: 'muted' }, 'Na je eerste testmoment verschijnen hier je grafieken.')),
  );
}

/** Thuisoefenlog met streak; na de return to sport (enkel) wordt het het preventieschema. */
function homeLogSection({ patient, protocol, homeLog, stage, completed, onSaved }) {
  const config = protocol.homeLog;
  if (!config) return null;
  const prevention = protocol.prevention;
  const preventionActive = Boolean(prevention) && (completed || stage >= prevention.fromLevel);

  const support = protocol.patientFields.sportSupport;
  const supportLabel = support?.options.find((option) => option.value === patient.sportSupport)?.label;
  const reminder = preventionActive && supportLabel
    ? support.reminderText.replace('{support}', `${supportLabel.toLowerCase()}`)
    : null;

  return h('section', { class: 'home-log-section' },
    reminder ? h('p', { class: 'notice notice-warning', role: 'note' }, reminder) : null,
    homeLogCard({
      patient,
      log: homeLog,
      config,
      today: todayIso(),
      title: preventionActive ? prevention.title : config.title,
      intro: preventionActive ? prevention.patientText : 'Tik op een dag en vul in of je geoefend hebt.',
      onSaved,
    }),
  );
}
