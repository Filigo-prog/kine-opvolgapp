// Criteria automatisch beoordelen op basis van metingen en tijd. Pure functies, geen DOM.
//
// Belangrijk: dit is enkel een SUGGESTIE ("lijkt voldaan"). Een criterium is pas voldaan
// als de therapeut het afvinkt. Deze module wijzigt nooit een status.

import { addDays, addMonths, daysBetween } from './dates.js';
import { injuredAndHealthy, round } from './lsi.js';

export const SUGGESTION = {
  MET: 'lijkt-voldaan',
  NOT_MET: 'lijkt-niet-voldaan',
  NO_DATA: 'geen-meting',
  JUDGEMENT: 'oordeel',
  NO_BASELINE: 'geen-baseline',
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
export const METRICS = ['lsi', 'difference', 'injured', 'value', 'asymmetry', 'baselinePct'];
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
    case 'asymmetry': return measurement.asymmetry ?? null;
    default: return null;
  }
}

/**
 * Huidige waarde van het aangedane been als % van de baseline (de waarde van vóór het letsel).
 * baseline = { value, unit } of { none: true }. Geeft { value } of een reden waarom het niet kan.
 */
export function baselinePercent(measurement, baseline, side, defaultUnit = null) {
  if (!baseline || baseline.none) return { noBaseline: true };
  const unit = measurement.unit ?? defaultUnit;
  if (baseline.unit && unit && baseline.unit !== unit) return { unitMismatch: true, unit, baselineUnit: baseline.unit };
  const { injured } = injuredAndHealthy(measurement.left, measurement.right, side);
  if (!Number.isFinite(injured) || !(baseline.value > 0)) return { value: null };
  return { value: round((injured / baseline.value) * 100, 1) };
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
 * ctx = { patient, sessions (nieuwste eerst), today, protocol? }  (protocol: voor de standaardeenheid van een test)
 * → { suggestion, details }
 *   measurement: details = [{ testId, value, date, pass }]   (value null = niet gemeten)
 *   minTime:     details = { reachedOn, daysLeft }
 */
export function evaluateCriterion(criterion, { patient, sessions, today, protocol = null }) {
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
    if (criterion.metric === 'baselinePct') {
      const defaultUnit = protocol?.testGroups?.flatMap((g) => g.tests).find((t) => t.id === testId)?.unit ?? null;
      const result = baselinePercent(latest.measurement, patient.baselines?.[testId], patient.side, defaultUnit);
      const value = result.value ?? null;
      return { testId, value, date: latest.date, pass: compareValue(value, criterion), ...(value === null ? result : {}) };
    }
    const value = metricValue(latest.measurement, criterion.metric, patient.side);
    return { testId, value, date: latest.date, pass: compareValue(value, criterion) };
  });

  let suggestion;
  if (details.some((d) => d.date === null)) suggestion = SUGGESTION.NO_DATA;
  else if (details.some((d) => d.noBaseline)) suggestion = SUGGESTION.NO_BASELINE;
  else if (details.some((d) => d.value === null)) suggestion = SUGGESTION.NO_DATA;
  else suggestion = details.every((d) => d.pass) ? SUGGESTION.MET : SUGGESTION.NOT_MET;
  return { suggestion, details };
}
