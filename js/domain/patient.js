// Patiëntgegevens: code voorstellen, invoer opschonen en valideren. Geen DOM, geen opslag.
// Privacy: een patiënt is enkel een code. Namen en geboortedatum horen hier niet.

import { isIsoDate } from './dates.js';

export const CODE_PATTERN = /^[A-Z]{2,5}-\d{3,4}$/;
export const SIDES = ['L', 'R'];

/** Volgende vrije code met dit voorvoegsel, bv. VKB-001, VKB-002, … */
export function suggestCode(prefix, existingCodes) {
  const used = new Set(existingCodes);
  const numbers = existingCodes
    .filter((code) => code.startsWith(`${prefix}-`))
    .map((code) => Number(code.slice(prefix.length + 1)))
    .filter(Number.isInteger);
  let next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  while (used.has(formatCode(prefix, next))) next += 1;
  return formatCode(prefix, next);
}

function formatCode(prefix, number) {
  return `${prefix}-${String(number).padStart(3, '0')}`;
}

/** Ruwe formulierwaarden → patiëntobject. */
export function normalizePatient(raw) {
  const text = (value) => String(value ?? '').trim();
  const weight = text(raw.bodyWeightKg).replace(',', '.');
  const patient = {
    code: text(raw.code).toUpperCase(),
    injury: text(raw.injury),
    side: text(raw.side),
    injuryDate: text(raw.injuryDate),
    associatedInjuries: [...new Set((raw.associatedInjuries ?? []).map(text).filter(Boolean))],
    associatedInjuriesOther: text(raw.associatedInjuriesOther),
    sport: text(raw.sport),
    sportLevel: text(raw.sportLevel),
    goal: text(raw.goal),
    bodyWeightKg: weight === '' ? null : Number(weight),
  };
  if (patient.injury === 'vkb') {
    patient.graft = text(raw.graft);
    patient.graftOther = patient.graft === 'andere' ? text(raw.graftOther) : '';
  }
  return patient;
}

/**
 * Geeft een object { veld: foutboodschap } terug; leeg = geldig.
 * context: { protocol, existingCodes, isNew, today }
 */
export function validatePatient(patient, { protocol, existingCodes = [], isNew = true, today }) {
  const errors = {};
  const options = (field) => (protocol?.patientFields?.[field]?.options ?? []).map((o) => o.value);

  if (!CODE_PATTERN.test(patient.code)) {
    errors.code = 'Gebruik de vorm VKB-024: 2 tot 5 hoofdletters, een streepje en 3 of 4 cijfers.';
  } else if (isNew && existingCodes.includes(patient.code)) {
    errors.code = 'Deze code bestaat al.';
  }

  if (!protocol || patient.injury !== protocol.id) errors.injury = 'Kies het letsel.';
  if (!SIDES.includes(patient.side)) errors.side = 'Kies de aangedane zijde.';

  if (!isIsoDate(patient.injuryDate)) {
    errors.injuryDate = 'Vul een geldige datum in.';
  } else if (today && patient.injuryDate > today) {
    errors.injuryDate = 'De datum mag niet in de toekomst liggen.';
  }

  if (patient.injury === 'vkb') {
    if (!options('graft').includes(patient.graft)) errors.graft = 'Kies het transplantaat.';
    else if (patient.graft === 'andere' && !patient.graftOther) errors.graftOther = 'Omschrijf het transplantaat.';
  }

  const allowedInjuries = options('associatedInjuries');
  if (patient.associatedInjuries.some((value) => !allowedInjuries.includes(value))) {
    errors.associatedInjuries = 'Onbekende keuze bij bijkomende letsels.';
  }

  if (patient.sportLevel && !options('sportLevel').includes(patient.sportLevel)) {
    errors.sportLevel = 'Kies een geldig sportniveau.';
  }

  if (patient.bodyWeightKg !== null) {
    if (!Number.isFinite(patient.bodyWeightKg) || patient.bodyWeightKg < 20 || patient.bodyWeightKg > 250) {
      errors.bodyWeightKg = 'Vul een gewicht tussen 20 en 250 kg in, of laat leeg.';
    }
  }

  return errors;
}
