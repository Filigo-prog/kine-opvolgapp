// Het huidige overzicht van een patiënt, in patiëntentaal, als lijst van blokken voor de PDF.
// Geen naam en geen geboortedatum: enkel de patiëntcode. Geen vergelijking met andere patiënten.

import { formatDate } from './dates.js';
import { lsiFeedback, lsiSeries, progressFeedback } from './feedback.js';
import { milestoneOverview } from './milestones.js';
import { currentStage, isCompleted, levelByNumber, levelProgress, statusOf } from './progression.js';
import { allTests, unitOf } from './test-session.js';
import { STATUS } from './criteria.js';
import { criterionText, milestoneText } from './text.js';
import { formatNumber, withUnit } from '../ui/format.js';

const sideValue = (measurement, side, injured) => {
  const mine = side === 'L' ? measurement.left : measurement.right;
  const other = side === 'L' ? measurement.right : measurement.left;
  return injured ? mine : other;
};

/** Bestandsnaam voor het delen, bv. "overzicht-VKB-024-2026-10-25.pdf". */
export function overviewFileName(patient, today) {
  return `overzicht-${patient.code}-${today}.pdf`;
}

/**
 * Bouwt de blokken van het overzicht.
 * Ingrediënten zijn dezelfde als bij de patiëntweergave: protocol, criteriastatussen, levelgeschiedenis,
 * testmomenten (nieuwste eerst) en de behaalde mijlpalen (id → datum).
 */
export function buildOverview({ patient, protocol, statuses, history, sessions, dates, today }) {
  const stage = currentStage(history);
  const completed = isCompleted(stage, protocol);
  const level = levelByNumber(protocol, stage);
  const blocks = [
    { type: 'title', text: 'Jouw voortgang' },
    { type: 'subtitle', text: `${patient.code} · ${protocol.name} · overzicht van ${formatDate(today)}` },
    { type: 'rule' },
  ];

  if (completed) {
    blocks.push({ type: 'heading', text: protocol.completion?.title ?? 'Klaar' });
    if (protocol.completion?.patientText) blocks.push({ type: 'text', text: protocol.completion.patientText });
    blocks.push({ type: 'muted', text: `Bevestigd op ${formatDate(history.at(-1)?.date)}.` });
  } else if (level) {
    const progress = levelProgress(level, statuses);
    blocks.push({ type: 'muted', text: `Level ${level.number} van ${protocol.levels.length}` });
    blocks.push({ type: 'heading', text: level.title });
    if (level.patientGoal) blocks.push({ type: 'text', text: level.patientGoal });
    blocks.push({ type: 'progress', met: progress.met, total: progress.total });
    const sentence = progressFeedback(progress);
    if (sentence) blocks.push({ type: 'text', text: sentence });

    if (level.patientFocus?.length) {
      blocks.push({ type: 'subheading', text: 'Wat doen we nu?' }, { type: 'bullets', items: level.patientFocus });
    }
    const steps = level.criteria
      .filter((criterion) => criterion.patientLabel && statusOf(statuses, criterion.id) !== STATUS.NOT_APPLICABLE)
      .map((criterion) => ({ text: criterionText(criterion, 'patientLabel'), done: statusOf(statuses, criterion.id) === STATUS.MET }));
    if (steps.length) blocks.push({ type: 'subheading', text: 'Jouw stappen' }, { type: 'checklist', items: steps });
  }

  const milestones = milestoneOverview(protocol, dates);
  if (milestones.length) {
    const earned = milestones.filter((entry) => entry.date);
    blocks.push({ type: 'heading', text: 'Jouw mijlpalen' });
    blocks.push({ type: 'text', text: `${earned.length} van de ${milestones.length} behaald.` });
    if (earned.length) {
      blocks.push({
        type: 'bullets',
        items: earned.map(({ milestone, date }) => `${milestoneText(milestone, 'label')} (${formatDate(date)})`),
      });
    }
  }

  const labels = protocol.patientSideLabels ?? { injured: 'Aangedaan been', healthy: 'Ander been' };
  const charted = allTests(protocol)
    .filter((test) => test.type === 'bilateral' && ['lsi', 'lsi-inverse'].includes(test.compare))
    .map((test) => ({ test, series: lsiSeries(sessions, test.id) }))
    .filter(({ series }) => series.length);
  if (charted.length) {
    blocks.push({ type: 'heading', text: 'Jouw cijfers' });
    blocks.push({ type: 'muted', text: 'Hoe sterk of vaardig is je aangedane been vergeleken met je andere been? 100 % betekent evenveel. De groene zone is het doel.' });
    for (const { test, series } of charted) {
      const last = series.at(-1);
      const unit = unitOf(test, last.measurement);
      const decimals = test.decimals;
      blocks.push({ type: 'ensure', height: 230 }); // titel, zin en grafiek blijven samen
      blocks.push({ type: 'subheading', text: test.patientLabel ?? test.label });
      const feedback = lsiFeedback(test, series);
      if (feedback) blocks.push({ type: 'text', text: feedback });
      blocks.push({
        type: 'chart',
        points: series.map((point) => ({ label: formatDate(point.date), value: point.lsi })),
        target: test.target ?? 90,
      });
      blocks.push({
        type: 'muted',
        text: `Laatste meting (${formatDate(last.date)}): ${labels.injured} ${withUnit(formatNumber(sideValue(last.measurement, patient.side, true), decimals), unit)}, ${labels.healthy} ${withUnit(formatNumber(sideValue(last.measurement, patient.side, false), decimals), unit)}. Doelzone vanaf ${formatNumber(test.target ?? 90)} %.`,
      });
    }
  }

  blocks.push({ type: 'rule' });
  blocks.push({ type: 'muted', text: 'Dit overzicht is een momentopname van je opvolging. Je therapeut beslist samen met jou wanneer je naar het volgende level gaat.' });
  return blocks;
}
