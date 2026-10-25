// Criteria-checklist (therapeutweergave): criteria afvinken en het volgende level vrijgeven.
// De app doet enkel suggesties ("lijkt voldaan"); de therapeut beslist.

import { STATUS, SUGGESTION, evaluateCriterion } from '../domain/criteria.js';
import { formatDate, todayIso } from '../domain/dates.js';
import { currentStage, isCompleted, levelByNumber, levelProgress, releaseLabel, statusOf } from '../domain/progression.js';
import { loadProtocol } from '../domain/protocol.js';
import { findTest } from '../domain/test-session.js';
import { criterionText } from '../domain/text.js';
import { getCriteriaStatuses, setCriterionStatus } from '../repo/criteria-status.js';
import { getLevelHistory, releaseLevel, undoLastRelease } from '../repo/level-history.js';
import { getPatient } from '../repo/patients.js';
import { listTestSessions } from '../repo/test-sessions.js';
import { render } from '../router.js';
import { confirmDialog } from '../ui/dialog.js';
import { h, showToast } from '../ui/dom.js';
import { describeSingle, formatAsymmetry, formatDifference, formatLsi, formatNumber, withUnit } from '../ui/format.js';
import { notFound } from '../ui/not-found.js';

const STATUS_OPTIONS = [
  { value: STATUS.NOT_MET, label: 'Niet voldaan' },
  { value: STATUS.MET, label: 'Voldaan' },
  { value: STATUS.NOT_APPLICABLE, label: 'N.v.t.' },
];

const SUGGESTION_LABELS = {
  [SUGGESTION.MET]: 'Lijkt voldaan',
  [SUGGESTION.NOT_MET]: 'Lijkt nog niet voldaan',
  [SUGGESTION.NO_DATA]: 'Nog geen meting',
  [SUGGESTION.JUDGEMENT]: 'Jouw oordeel',
  [SUGGESTION.NO_BASELINE]: 'Geen baseline',
};

export async function criteriaChecklistView({ code }) {
  const patient = await getPatient(code);
  if (!patient) return notFound('Patiënt niet gevonden', `Er is geen patiënt met code ${code}.`);

  const [protocol, statuses, history, sessions] = await Promise.all([
    loadProtocol(patient.injury),
    getCriteriaStatuses(code),
    getLevelHistory(code),
    listTestSessions(code),
  ]);
  const today = todayIso();
  const detailHref = `#/patient/${encodeURIComponent(code)}`;
  const stage = currentStage(history);

  const head = h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, 'Criteria-checklist'),
      h('p', { class: 'muted page-subtitle' }, `${patient.code}, ${protocol.name}`),
    ),
    h('a', { class: 'btn btn-secondary', href: detailHref }, 'Terug naar patiënt'),
  );

  if (!protocol.levels.length) {
    return h('section', {}, head,
      h('div', { class: 'card empty-state' },
        h('h2', {}, 'Nog geen levels'),
        h('p', { class: 'muted' }, 'Voor dit letsel zijn de levels en criteria nog niet ingevuld in het protocolbestand.'),
      ));
  }

  const historyCard = levelHistoryCard(protocol, history, code);

  if (isCompleted(stage, protocol)) {
    const completedOn = history.at(-1)?.date;
    return h('section', {}, head,
      h('div', { class: 'card completion-card' },
        h('h2', {}, protocol.completion?.title ?? 'Afgerond'),
        h('p', {}, `Bevestigd op ${formatDate(completedOn)}.`),
      ),
      historyCard,
    );
  }

  const level = levelByNumber(protocol, stage);
  const context = { patient, sessions, today, protocol };

  const progressText = h('p', { class: 'progress-text' });
  const progressBar = h('span');
  const releaseButton = h('button', { type: 'button', class: 'btn btn-primary', onclick: onRelease }, releaseLabel(protocol, level));
  const releaseHint = h('p', { class: 'muted release-hint' });

  function refreshProgress() {
    const progress = levelProgress(level, statuses);
    progressText.textContent = `${progress.met} van ${progress.total} criteria voldaan`
      + (progress.notApplicable ? ` (${progress.notApplicable} n.v.t.)` : '');
    progressBar.style.width = `${progress.total ? (progress.met / progress.total) * 100 : 100}%`;
    releaseButton.disabled = !progress.canRelease;
    releaseHint.textContent = progress.canRelease
      ? 'Alle criteria zijn afgevinkt. Jij beslist of het volgende level open mag.'
      : 'Vink eerst alle criteria af als voldaan of n.v.t.';
  }

  async function onRelease() {
    const next = levelByNumber(protocol, level.number + 1);
    const confirmed = await confirmDialog({
      title: next ? `Level ${next.number} vrijgeven?` : `${protocol.completion?.title ?? 'Afronden'}?`,
      message: next
        ? `${patient.code} gaat naar level ${next.number}: ${next.title}. De patiënt ziet daarna dit nieuwe level.`
        : `Je bevestigt de return to sport voor ${patient.code}.`,
      confirmLabel: releaseLabel(protocol, level),
    });
    if (!confirmed) return;
    await releaseLevel(code, level.number + 1, { date: today });
    showToast(next ? `Level ${next.number} vrijgegeven.` : 'Return to sport bevestigd.');
    render();
  }

  const criteriaList = h('ol', { class: 'criteria-list' },
    level.criteria.map((criterion) => criterionItem(criterion)));

  function criterionItem(criterion) {
    const { suggestion, details } = evaluateCriterion(criterion, context);
    const record = statuses.get(criterion.id);
    const stamp = h('span', { class: 'criterion-stamp muted' }, stampText(record));
    const noteInput = h('input', {
      class: 'input criterion-note',
      value: record?.note ?? '',
      placeholder: 'Notitie (optioneel)',
      'aria-label': `Notitie bij ${criterionText(criterion, 'label')}`,
      onchange: () => save(statusOf(statuses, criterion.id), noteInput.value.trim()),
    });

    async function save(status, note) {
      const saved = { status, note, date: today };
      await setCriterionStatus(code, criterion.id, saved);
      statuses.set(criterion.id, { ...saved, criterionId: criterion.id });
      stamp.textContent = stampText(statuses.get(criterion.id));
      item.dataset.status = status;
      refreshProgress();
    }

    const item = h('li', { class: 'criterion', 'data-status': statusOf(statuses, criterion.id) },
      h('div', { class: 'criterion-main' },
        h('p', { class: 'criterion-label' }, criterionText(criterion, 'label')),
        criterion.note ? h('p', { class: 'criterion-note-text muted' }, criterionText(criterion, 'note')) : null,
        criterion.method ? h('p', { class: 'criterion-method muted' }, h('strong', {}, 'Testmethode: '), criterion.method) : null,
        h('p', { class: `suggestion suggestion-${suggestion}` },
          h('strong', {}, SUGGESTION_LABELS[suggestion]),
          suggestionDetail(criterion, details, protocol)),
        criterion.evidence || criterion.ifNotMet
          ? h('p', { class: 'criterion-help muted' },
            criterion.evidence ? h('span', { class: 'evidence-tag', title: 'Evidentieniveau (A = RCT of consensus, D = geleend uit een aangrenzend kader)' }, `Niveau ${criterion.evidence}`) : null,
            criterion.ifNotMet ? [h('strong', {}, 'Bij niet halen: '), criterion.ifNotMet] : null)
          : null,
      ),
      h('fieldset', { class: 'criterion-controls' },
        h('legend', { class: 'visually-hidden' }, `Status: ${criterionText(criterion, 'label')}`),
        h('div', { class: 'segmented' },
          STATUS_OPTIONS.map((option) => h('label', { class: 'segment' },
            h('input', {
              type: 'radio',
              name: `status-${criterion.id}`,
              value: option.value,
              checked: statusOf(statuses, criterion.id) === option.value,
              onchange: () => save(option.value, noteInput.value.trim()),
            }),
            h('span', {}, option.label),
          ))),
        noteInput,
        stamp,
      ),
    );
    return item;
  }

  refreshProgress();

  return h('section', {}, head,
    h('div', { class: 'card level-card' },
      h('p', { class: 'level-kicker' }, `Level ${level.number} van ${protocol.levels.length}`),
      h('h2', {}, level.title),
      level.subtitle ? h('p', { class: 'muted' }, level.subtitle) : null,
      level.focus ? h('p', {}, h('strong', {}, 'Focus: '), level.focus) : null,
      level.patientGoal ? h('p', {}, h('strong', {}, 'Doel: '), level.patientGoal) : null,
      h('div', { class: 'progress', role: 'presentation' }, progressBar),
      progressText,
      level.remarks?.length
        ? h('details', { class: 'level-remarks' },
          h('summary', {}, 'Opmerkingen en aandachtspunten van deze fase'),
          level.remarks.map((line) => h('p', {}, line)))
        : null,
    ),
    h('div', { class: 'card' },
      h('h2', {}, level.number < protocol.levels.length ? `Criteria om naar level ${level.number + 1} te gaan` : 'Criteria voor return to sport'),
      criteriaList,
      h('div', { class: 'release' }, releaseHint, releaseButton),
    ),
    historyCard,
  );
}

function stampText(record) {
  if (!record || record.status === STATUS.NOT_MET) return '';
  const label = record.status === STATUS.MET ? 'Afgevinkt' : 'N.v.t.';
  return `${label} op ${formatDate(record.date)}`;
}

/** Leesbare uitleg bij een suggestie, met de absolute waarden en de datum van de meting. */
function suggestionDetail(criterion, details, protocol) {
  if (criterion.type === 'judgement') return null;
  if (criterion.type === 'minTime') {
    return details.daysLeft > 0
      ? `: nog ${details.daysLeft} dagen (bereikt op ${formatDate(details.reachedOn)}).`
      : `: bereikt op ${formatDate(details.reachedOn)}.`;
  }
  const parts = details.map((detail) => {
    const test = findTest(protocol, detail.testId);
    const name = test?.label ?? detail.testId;
    if (detail.noBaseline) return `${name}: geen baseline ingevuld (vul ze in bij "Baseline" op het patiëntdetail, of kies "geen baseline")`;
    if (detail.unitMismatch) return `${name}: gemeten in ${detail.unit}, baseline in ${detail.baselineUnit}`;
    if (detail.value === null) return `${name}: niet gemeten`;
    return `${name}: ${formatMetric(criterion.metric, detail.value, test)} (${formatDate(detail.date)})`;
  });
  return `: ${parts.join('; ')}.`;
}

function formatMetric(metric, value, test) {
  switch (metric) {
    case 'lsi': return formatLsi(value);
    case 'difference': return formatDifference(value, test);
    case 'asymmetry': return formatAsymmetry(value);
    case 'baselinePct': return `${formatNumber(value, 0)} % van baseline`;
    case 'injured': return `aangedane zijde ${withUnit(formatNumber(value, test.decimals), test.unit)}`;
    default: return describeSingle(test, { value });
  }
}

function levelHistoryCard(protocol, history, code) {
  async function onUndo() {
    const last = history.at(-1);
    const confirmed = await confirmDialog({
      title: 'Laatste vrijgave ongedaan maken?',
      message: `De vrijgave van ${last.level > protocol.levels.length ? (protocol.completion?.title ?? 'de afronding') : `level ${last.level}`} op ${formatDate(last.date)} wordt geschrapt. De afgevinkte criteria blijven bewaard.`,
      confirmLabel: 'Ongedaan maken',
      danger: true,
    });
    if (!confirmed) return;
    await undoLastRelease(code);
    showToast('Vrijgave ongedaan gemaakt.');
    render();
  }

  return h('div', { class: 'card history-card' },
    h('h2', {}, 'Verloop'),
    h('ol', { class: 'history-list' },
      history.map((entry) => {
        const level = levelByNumber(protocol, entry.level);
        const title = level ? `Level ${level.number}: ${level.title}` : (protocol.completion?.title ?? `Level ${entry.level}`);
        return h('li', {}, h('strong', {}, title), ` · ${entry.level === 1 ? 'gestart' : 'vrijgegeven'} op ${formatDate(entry.date)}`);
      })),
    history.length > 1
      ? h('button', { type: 'button', class: 'btn btn-secondary btn-danger-outline', onclick: onUndo }, 'Laatste vrijgave ongedaan maken')
      : null,
  );
}
