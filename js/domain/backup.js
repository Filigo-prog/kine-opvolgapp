// Back-up: formaat, validatie, voorbeeld en importplan. Pure functies, geen DOM en geen opslag.
//
// Een back-up bevat enkel de gegevens van patiënten (geen instellingen): zo komt de pincode
// nooit in een bestand terecht en blijft elk toestel zijn eigen modus en patiënt onthouden.

import { STATUS } from './criteria.js';
import { daysBetween, isIsoDate, todayIso } from './dates.js';
import { CODE_PATTERN, SIDES } from './patient.js';
import { INJURIES } from './protocol.js';

export const APP_ID = 'kine-opvolging';
export const FORMAT_VERSION = 1;
export const REMINDER_DAYS = 14;

/** De stores die in een back-up zitten, met een controle per record. */
const STORE_RULES = {
  patients: (r) => CODE_PATTERN.test(r.code) && INJURIES.includes(r.injury) && SIDES.includes(r.side) && isIsoDate(r.injuryDate),
  testSessions: (r) => isText(r.id) && isText(r.patientCode) && isIsoDate(r.date) && isObject(r.measurements),
  criteriaStatus: (r) => isText(r.patientCode) && isText(r.criterionId) && Object.values(STATUS).includes(r.status),
  levelHistory: (r) => isText(r.id) && isText(r.patientCode) && Number.isInteger(r.level) && r.level >= 1 && isIsoDate(r.date),
  milestones: (r) => isText(r.patientCode) && isText(r.milestoneId) && isIsoDate(r.date),
  homeLog: (r) => isText(r.patientCode) && isIsoDate(r.date) && typeof r.done === 'boolean',
};

export const STORE_NAMES = Object.keys(STORE_RULES);

export const STORE_LABELS = {
  patients: ['patiënt', 'patiënten'],
  testSessions: ['testmoment', 'testmomenten'],
  criteriaStatus: ['afgevinkt criterium', 'afgevinkte criteria'],
  levelHistory: ['levelvrijgave', 'levelvrijgaves'],
  milestones: ['mijlpaal', 'mijlpalen'],
  homeLog: ['oefendag', 'oefendagen'],
};

function isText(value) {
  return typeof value === 'string' && value.length > 0;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function countRecords(data) {
  return Object.fromEntries(STORE_NAMES.map((name) => [name, data[name]?.length ?? 0]));
}

/** data = { patients: [...], testSessions: [...], ... } → back-upobject. */
export function buildBackup(data, now = new Date()) {
  const cleaned = Object.fromEntries(STORE_NAMES.map((name) => [name, data[name] ?? []]));
  return {
    app: APP_ID,
    formatVersion: FORMAT_VERSION,
    exportedAt: now.toISOString(),
    counts: countRecords(cleaned),
    data: cleaned,
  };
}

/** Leest en controleert een back-upbestand. Geeft { backup } of { errors }. */
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { errors: ['Dit is geen geldig back-upbestand (het is geen JSON).'] };
  }
  if (!isObject(parsed) || parsed.app !== APP_ID) {
    return { errors: ['Dit bestand komt niet uit deze app.'] };
  }
  if (!Number.isInteger(parsed.formatVersion) || parsed.formatVersion < 1) {
    return { errors: ['Dit back-upbestand is beschadigd (de versie ontbreekt).'] };
  }
  if (parsed.formatVersion > FORMAT_VERSION) {
    return { errors: ['Deze back-up komt uit een nieuwere versie van de app. Werk de app eerst bij.'] };
  }
  if (!isObject(parsed.data)) {
    return { errors: ['Dit back-upbestand is beschadigd (de gegevens ontbreken).'] };
  }

  const errors = [];
  const data = {};
  for (const name of STORE_NAMES) {
    const records = parsed.data[name] ?? [];
    if (!Array.isArray(records)) {
      errors.push(`"${name}" moet een lijst zijn.`);
      continue;
    }
    const bad = records.findIndex((record) => !isObject(record) || !STORE_RULES[name](record));
    if (bad !== -1) errors.push(`Onbruikbaar record in "${name}" (nummer ${bad + 1}).`);
    data[name] = records;
  }

  const codes = (data.patients ?? []).map((patient) => patient.code);
  if (new Set(codes).size !== codes.length) errors.push('Dezelfde patiëntcode komt meer dan één keer voor.');

  if (errors.length) return { errors: errors.slice(0, 5) };
  return { backup: { ...parsed, data } };
}

/**
 * Voorbeeld voor de gebruiker: wat zit er in, en wat is nieuw of bestaat al.
 * Records zonder bijhorende patiënt (wezen) worden bij het terugzetten genegeerd.
 */
export function summarizeBackup(backup, localCodes) {
  const codes = backup.data.patients.map((patient) => patient.code).sort((a, b) => a.localeCompare(b, 'nl', { numeric: true }));
  const local = new Set(localCodes);
  return {
    exportedAt: backup.exportedAt,
    counts: countRecords(backup.data),
    codes,
    newCodes: codes.filter((code) => !local.has(code)),
    existingCodes: codes.filter((code) => local.has(code)),
  };
}

/**
 * Bepaalt welke records bij het terugzetten geschreven worden.
 * mode 'replace': alles van het toestel wordt vervangen door de back-up.
 * mode 'add':     enkel patiënten die op dit toestel nog niet bestaan worden toegevoegd.
 */
export function planImport(backup, mode, localCodes) {
  if (!['replace', 'add'].includes(mode)) throw new Error(`Onbekende importmodus: ${mode}`);
  const local = new Set(localCodes);
  const inBackup = new Set(backup.data.patients.map((patient) => patient.code));
  const allowed = mode === 'replace' ? inBackup : new Set([...inBackup].filter((code) => !local.has(code)));

  const records = {};
  let skipped = 0;
  for (const name of STORE_NAMES) {
    const key = name === 'patients' ? 'code' : 'patientCode';
    records[name] = backup.data[name].filter((record) => allowed.has(record[key]));
    skipped += backup.data[name].length - records[name].length;
  }
  return { mode, records, counts: countRecords(records), skipped, patientCount: allowed.size };
}

/** "3 patiënten" / "1 patiënt" */
export function describeCount(storeName, count) {
  const [one, many] = STORE_LABELS[storeName];
  return `${count} ${count === 1 ? one : many}`;
}

/** Wanneer is er een herinnering nodig? null = niet. */
export function backupReminder({ lastBackupAt, hasData, now = new Date() }) {
  if (!hasData) return null;
  if (!lastBackupAt) return { kind: 'never', days: null };
  const days = daysBetween(todayIso(new Date(lastBackupAt)), todayIso(now));
  return days >= REMINDER_DAYS ? { kind: 'old', days } : null;
}

export function backupReminderText(reminder) {
  if (!reminder) return null;
  if (reminder.kind === 'never') return 'Je hebt nog geen back-up gemaakt. Alle gegevens staan enkel op dit toestel.';
  return `Je laatste back-up is ${reminder.days} dagen oud. Maak een nieuwe, zodat je niets kwijtraakt.`;
}

/** "24 okt 2026 (vandaag)" of "10 okt 2026 (14 dagen geleden)". */
export function describeLastBackup(lastBackupAt, now = new Date()) {
  if (!lastBackupAt) return 'Nog nooit een back-up gemaakt.';
  const date = todayIso(new Date(lastBackupAt));
  const days = daysBetween(date, todayIso(now));
  const when = days <= 0 ? 'vandaag' : (days === 1 ? 'gisteren' : `${days} dagen geleden`);
  return { date, when };
}
