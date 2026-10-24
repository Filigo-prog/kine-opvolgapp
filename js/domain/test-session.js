// Een testmoment: ruwe invoer → gevalideerde metingen. Pure functies, geen DOM.

import { isIsoDate } from './dates.js';
import { compareSides, parseNumber } from './lsi.js';

export function allTests(protocol) {
  return (protocol.testGroups ?? []).flatMap((group) => group.tests);
}

export function findTest(protocol, testId) {
  return allTests(protocol).find((test) => test.id === testId) ?? null;
}

function checkRange(test, value) {
  if (Number.isNaN(value)) return 'Geen geldig getal.';
  if (value < test.min || value > test.max) return `Kies een waarde van ${test.min} tot ${test.max}.`;
  return null;
}

/**
 * raw = { date, note, entries: { testId: { left, right } | { value } } } met tekst uit het formulier.
 * Geeft { session, errors } terug. errors: { date?, form?, [testId]: boodschap }.
 */
export function buildSession(raw, { protocol, patient, today }) {
  const errors = {};
  const measurements = {};

  if (!isIsoDate(raw.date)) errors.date = 'Vul een geldige datum in.';
  else if (today && raw.date > today) errors.date = 'De datum mag niet in de toekomst liggen.';

  for (const test of allTests(protocol)) {
    const entry = raw.entries?.[test.id] ?? {};

    if (test.type === 'bilateral') {
      const left = parseNumber(entry.left);
      const right = parseNumber(entry.right);
      if (left === null && right === null) continue;
      if (left === null || right === null) {
        errors[test.id] = 'Vul beide zijden in.';
        continue;
      }
      const problem = checkRange(test, left) ?? checkRange(test, right);
      if (problem) {
        errors[test.id] = problem;
        continue;
      }
      measurements[test.id] = { left, right, ...compareSides(test, left, right, patient.side) };
    } else if (test.type === 'single') {
      const value = parseNumber(entry.value);
      if (value === null) continue;
      const problem = checkRange(test, value);
      if (problem) {
        errors[test.id] = problem;
        continue;
      }
      measurements[test.id] = { value };
    } else if (test.type === 'choice') {
      const value = String(entry.value ?? '');
      if (value === '') continue;
      if (!test.options.some((option) => option.value === value)) {
        errors[test.id] = 'Onbekende keuze.';
        continue;
      }
      measurements[test.id] = { value };
    }
  }

  if (!Object.keys(errors).length && !Object.keys(measurements).length) {
    errors.form = 'Vul minstens één meting in.';
  }

  return {
    session: {
      date: raw.date,
      note: String(raw.note ?? '').trim(),
      measurements,
    },
    errors,
  };
}
