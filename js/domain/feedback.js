// Feedbackteksten voor de patiënt: positief, specifiek en nooit drukkend.
// Geen vergelijking met andere patiënten, geen "sneller dan", geen "je loopt achter".

import { formatNumber } from '../ui/format.js';

/** Meetreeks van een test, oudste eerst: [{ date, lsi }] (enkel metingen met een LSI). */
export function lsiSeries(sessions, testId) {
  return [...sessions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((session) => ({ date: session.date, measurement: session.measurements?.[testId] }))
    .filter((point) => Number.isFinite(point.measurement?.lsi))
    .map((point) => ({ date: point.date, lsi: point.measurement.lsi, measurement: point.measurement }));
}

/** Eén zin bij een test, op basis van de laatste twee metingen. */
export function lsiFeedback(test, series) {
  if (!series.length) return null;
  const phrase = test.patientPhrase ?? test.patientLabel?.toLowerCase() ?? test.label.toLowerCase();
  const last = Math.round(series.at(-1).lsi);

  if (series.length === 1) {
    return `Eerste meting: je ${phrase} staat op ${formatNumber(last)} %.`;
  }

  const previous = Math.round(series.at(-2).lsi);
  if (last > previous) return `Je ${phrase} ging van ${formatNumber(previous)} % naar ${formatNumber(last)} %.`;
  if (last === previous) return `Je ${phrase} blijft stabiel op ${formatNumber(last)} %.`;
  return `Je ${phrase} staat nu op ${formatNumber(last)} %. Een meting kan schommelen; we bekijken samen wat je volgende stap is.`;
}

/** Zin bij de voortgang binnen een level. */
export function progressFeedback({ met, total }) {
  if (total === 0) return '';
  if (met === 0) return 'Je start dit level. Stap voor stap kom je er.';
  if (met >= total) return 'Alle stappen van dit level zijn behaald. Je therapeut bekijkt samen met jou het volgende level.';
  const left = total - met;
  return `Je hebt al ${met} van de ${total} stappen behaald. Nog ${left} te gaan.`;
}
