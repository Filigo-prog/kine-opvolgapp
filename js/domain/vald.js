// Import van een CSV-export uit VALD Hub (bv. DynaMo Max). Pure functies, geen DOM en geen opslag.
//
// Privacy: de kolom "Name" wordt enkel gebruikt om personen in het bestand uit elkaar te houden.
// De naam komt nooit in het resultaat: alleen initialen (om te herkennen wie het is) en de "External Id".
//
// Het bestand heeft één rij per test. Per meetwaarde staan er kolommen met een zijde ervoor,
// bv. "L Max Force (N)" en "R Max Force (N)". Elke zo'n waarde heet hier een "metric".

import { parseCsv, toRecords } from './csv.js';
import { isIsoDate } from './dates.js';
import { parseNumber } from './lsi.js';

const SIDE_COLUMN = /^([LR]) (.+)$/;

/** "Max Force (N)" → "N"; geen eenheid → null. */
export function metricUnit(metric) {
  const match = metric.match(/\(([^()]+)\)\s*$/);
  return match ? match[1].trim() : null;
}

function initialsOf(name) {
  const letters = name.split(/\s+/).filter(Boolean).map((word) => word[0].toUpperCase());
  return letters.length ? `${letters.join('. ')}.` : '?';
}

/** '02/09/2026' → { a: 2, b: 9, year: 2026 }; ISO-datums apart. */
function splitDate(text) {
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { iso: `${iso[1]}-${iso[2]}-${iso[3]}` };
  const match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  return match ? { a: Number(match[1]), b: Number(match[2]), year: Number(match[3]) } : null;
}

/**
 * Bepaalt de volgorde van dag en maand voor het hele bestand: een getal boven 12 verraadt het.
 * Is er niets te zien (bv. enkel 02/09/2026), dan gaan we uit van dag/maand en melden we dat.
 */
export function detectDateOrder(dateTexts) {
  const parts = dateTexts.map(splitDate).filter((part) => part && !part.iso);
  if (parts.some((part) => part.a > 12)) return { order: 'dmy', ambiguous: false };
  if (parts.some((part) => part.b > 12)) return { order: 'mdy', ambiguous: false };
  return { order: 'dmy', ambiguous: parts.length > 0 };
}

export function toIsoDate(text, order) {
  const part = splitDate(text);
  if (!part) return null;
  if (part.iso) return isIsoDate(part.iso) ? part.iso : null;
  const [day, month] = order === 'mdy' ? [part.b, part.a] : [part.a, part.b];
  const iso = `${part.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

/**
 * Leest het bestand. Geeft { rows, people, metrics, dateOrder, datesAmbiguous } of { errors }.
 * rows: [{ line, personId, date, time, device, region, movement, position, testKey, testLabel, values }]
 *   values = { 'Max Force (N)': { left: 518, right: 477 }, ... }
 */
export function parseValdExport(text) {
  const { columns, records } = toRecords(parseCsv(text));
  const missing = ['Date', 'Movement'].filter((name) => !columns.includes(name));
  if (!columns.length || missing.length) {
    const names = missing.map((name) => `"${name}"`).join(' en ') || '"Date"';
    return { errors: [`Dit lijkt geen VALD Hub-export: ${missing.length > 1 ? `de kolommen ${names} ontbreken` : `de kolom ${names} ontbreekt`}.`] };
  }

  const sideColumns = { L: new Map(), R: new Map() };
  for (const column of columns) {
    const match = column.match(SIDE_COLUMN);
    if (match) sideColumns[match[1]].set(match[2].trim(), column);
  }
  const metrics = [...sideColumns.L.keys()].filter((metric) => sideColumns.R.has(metric));
  if (!metrics.length) return { errors: ['Er staan geen kolommen per zijde in dit bestand (zoals "L Max Force (N)" en "R Max Force (N)").'] };

  const dateInfo = detectDateOrder(records.map((record) => record.Date));
  const personIds = new Map();
  const people = [];

  const rows = records.map((record, index) => {
    const name = record.Name ?? '';
    const externalId = (record['External Id'] ?? '').trim();
    const identity = externalId || name;
    if (!personIds.has(identity)) {
      const id = `p${personIds.size + 1}`;
      personIds.set(identity, id);
      people.push({ id, initials: initialsOf(name), externalId, rows: 0 });
    }
    const personId = personIds.get(identity);
    people.find((person) => person.id === personId).rows += 1;

    const values = {};
    for (const metric of metrics) {
      const left = parseNumber(record[sideColumns.L.get(metric)]);
      const right = parseNumber(record[sideColumns.R.get(metric)]);
      if (Number.isFinite(left) && Number.isFinite(right)) values[metric] = { left, right };
    }

    const region = record['Body Region'] ?? '';
    const movement = record.Movement ?? '';
    const position = record.Position ?? '';
    return {
      line: index + 2,
      personId,
      date: toIsoDate(record.Date, dateInfo.order),
      time: record.Time ?? '',
      device: (record.Device ?? '').split(';')[0],
      region,
      movement,
      position,
      testKey: [region, movement, position].join('|'),
      testLabel: [region, movement, position].filter(Boolean).join(' · '),
      values,
    };
  }).filter((row) => Object.keys(row.values).length > 0);

  if (!rows.length) return { errors: ['In dit bestand staan geen metingen met een waarde voor links en rechts.'] };
  return { rows, people, metrics, dateOrder: dateInfo.order, datesAmbiguous: dateInfo.ambiguous };
}

/**
 * Standaardkoppeling voor een rij: eerst een eerder bewaarde keuze van de therapeut, dan de koppeling
 * uit het protocol (`valdMapping`). Geeft { test, metric } of null.
 */
export function suggestMapping(row, { saved = {}, protocolMapping = [] }) {
  const own = saved[row.testKey];
  if (own) return own;
  const lower = (value) => String(value).toLowerCase();
  const match = protocolMapping.find((entry) => lower(entry.match.region) === lower(row.region)
    && lower(entry.match.movement) === lower(row.movement)
    && (!entry.match.position || lower(entry.match.position) === lower(row.position)));
  return match ? { test: match.test, metric: match.metric } : null;
}

/** Welke persoon uit het bestand hoort bij deze patiënt? De External Id wijst het duidelijkst. */
export function matchPerson(people, patientCode) {
  const byId = people.find((person) => person.externalId.toUpperCase() === patientCode.toUpperCase());
  if (byId) return byId.id;
  return people.length === 1 ? people[0].id : null;
}

/**
 * Zet de gekozen rijen om naar testmomenten: één per datum.
 * choices = [{ row, include, date, test, metric }]. Geeft { sessions: [{ date, entries }], problems }.
 * Twee gekozen metingen voor dezelfde test op dezelfde dag is een probleem (kies er één).
 */
export function buildImportSessions(choices) {
  const byDate = new Map();
  const problems = [];

  for (const choice of choices.filter((entry) => entry.include)) {
    if (!choice.test) { problems.push(`${choice.row.testLabel}: kies een test of vink de rij uit.`); continue; }
    if (!isIsoDate(choice.date)) { problems.push(`${choice.row.testLabel}: vul een geldige datum in.`); continue; }
    const value = choice.row.values[choice.metric];
    if (!value) { problems.push(`${choice.row.testLabel}: deze rij heeft geen waarde voor "${choice.metric}".`); continue; }

    const entries = byDate.get(choice.date) ?? {};
    if (entries[choice.test]) {
      problems.push(`${choice.row.testLabel}: er is al een meting voor dezelfde test op dezelfde dag. Vink er één uit.`);
      continue;
    }
    entries[choice.test] = { left: String(value.left), right: String(value.right), ...(choice.unit ? { unit: choice.unit } : {}) };
    byDate.set(choice.date, entries);
  }

  const sessions = [...byDate].map(([date, entries]) => ({ date, entries })).sort((a, b) => a.date.localeCompare(b.date));
  return { sessions, problems };
}
