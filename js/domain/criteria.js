// Criteria automatisch beoordelen op basis van metingen en tijd. Pure functies, geen DOM.
//
// Belangrijk: dit is enkel een SUGGESTIE ("lijkt voldaan"). Een criterium is pas voldaan
// als de therapeut het afvinkt. Deze module wijzigt nooit een status.

import { addDays, addMonths, daysBetween } from './dates.js';
import { injuredAndHealthy } from './lsi.js';

export const SUGGESTION = {
  MET: 'lijkt-voldaan',
  NOT_MET: 'lijkt-niet-voldaan',
  NO_DATA: 'geen-meting',
  JUDGEMENT: 'oordeel',
};

export const STATUS = {
  NOT_MET: 'niet-voldaan',
  MET: 'voldaan',
  NOT_APPLICABLE: 'nvt',
};

const OPERATORS = {
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
};

export const CRITERION_TYPES = ['measurement', 'minTime', 'judgement'];
export const METRICS = ['lsi', 'difference', 'injured', 'value'];
export const OPERATOR_NAMES = [...Object.keys(OPERATORS), 'in'];

export function criterionTests(criterion) {
  return criterion.tests ?? (criterion.test ? [criterion.test] : []);
}

/** De meest recente meting van een test, met de datum van het testmoment. sessions: nieuwste eerst. */
export function latestMeasurement(sessions, testId) {
  for (const session of sessions) {
    const measurement = session.measurements?.[testId];
    if (measurement) return { measurement, date: session.date };
  }
  return null;
}

export function metricValue(measurement, metric, side) {
  switch (metric) {
    case 'lsi': return measurement.lsi ?? null;
    case 'difference': return measurement.difference ?? null;
    case 'injured': return injuredAndHealthy(measurement.left, measurement.right, side).injured ?? null;
    case 'value': return measurement.value ?? null;
    default: return null;
  }
}

export function compareValue(value, criterion) {
  if (value === null || value === undefined) return false;
  if (criterion.operator === 'in') return criterion.values.includes(String(value));
  const compare = OPERATORS[criterion.operator];
  return Number.isFinite(value) && compare(value, criterion.threshold);
}

/** Datum waarop de minimumtermijn bereikt is. */
export function minTimeReachedOn(criterion, injuryDate) {
  if (criterion.months) return addMonths(injuryDate, criterion.months);
  return addDays(injuryDate, (criterion.weeks ?? 0) * 7);
}

/**
 * Suggestie voor één criterium.
 * ctx = { patient, sessions (nieuwste eerst), today }
 * → { suggestion, details }
 *   measurement: details = [{ testId, value, date, pass }]   (value null = niet gemeten)
 *   minTime:     details = { reachedOn, daysLeft }
 */
export function evaluateCriterion(criterion, { patient, sessions, today }) {
  if (criterion.type === 'judgement') return { suggestion: SUGGESTION.JUDGEMENT, details: null };

  if (criterion.type === 'minTime') {
    const reachedOn = minTimeReachedOn(criterion, patient.injuryDate);
    const daysLeft = Math.max(0, daysBetween(today, reachedOn));
    return {
      suggestion: today >= reachedOn ? SUGGESTION.MET : SUGGESTION.NOT_MET,
      details: { reachedOn, daysLeft },
    };
  }

  const details = criterionTests(criterion).map((testId) => {
    const latest = latestMeasurement(sessions, testId);
    if (!latest) return { testId, value: null, date: null, pass: false };
    const value = metricValue(latest.measurement, criterion.metric, patient.side);
    return { testId, value, date: latest.date, pass: compareValue(value, criterion) };
  });

  let suggestion;
  if (details.some((d) => d.value === null)) suggestion = SUGGESTION.NO_DATA;
  else suggestion = details.every((d) => d.pass) ? SUGGESTION.MET : SUGGESTION.NOT_MET;
  return { suggestion, details };
}
