// Een testmoment: ruwe invoer → gevalideerde metingen. Pure functies, geen DOM.

import { isIsoDate } from './dates.js';
import { compareSides, parseNumber } from './lsi.js';

export function allTests(protocol) {
  return (protocol.testGroups ?? []).flatMap((group) => group.tests);
}

export function findTest(protocol, testId) {
  return allTests(protocol).find((test) => test.id === testId) ?? null;
}

/**
 * Een test kan meerdere eenheden toelaten (bv. kracht in Nm of N): `units: [{ unit, min, max }]`.
 * De LSI is een verhouding en hangt niet van de eenheid af. Zonder `units` geldt `unit`, `min` en `max` van de test.
 */
export function testUnits(test) {
  return test.units?.length ? test.units : [{ unit: test.unit, min: test.min, max: test.max }];
}

/** De eenheid waarin een bewaarde meting genoteerd is (oudere metingen hebben geen eigen eenheid). */
export function unitOf(test, measurement) {
  return measurement?.unit ?? test.unit;
}

function checkRange(test, value, unit = test.unit) {
  if (Number.isNaN(value)) return 'Geen geldig getal.';
  const range = testUnits(test).find((entry) => entry.unit === unit) ?? testUnits(test)[0];
  if (value < range.min || value > range.max) return `Kies een waarde van ${range.min} tot ${range.max}${test.units?.length ? ` ${range.unit}` : ''}.`;
  return null;
}

/**
 * raw = { date, note, entries: { testId: { left, right, unit? } | { value } } } met tekst uit het formulier.
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
      let unit = null;
      if (test.units?.length) {
        unit = entry.unit || test.unit;
        if (!test.units.some((entry2) => entry2.unit === unit)) {
          errors[test.id] = `Onbekende eenheid "${unit}".`;
          continue;
        }
      }
      const problem = checkRange(test, left, unit ?? test.unit) ?? checkRange(test, right, unit ?? test.unit);
      if (problem) {
        errors[test.id] = problem;
        continue;
      }
      measurements[test.id] = { left, right, ...compareSides(test, left, right, patient.side), ...(unit ? { unit } : {}) };
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
