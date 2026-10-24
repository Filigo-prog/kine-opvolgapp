import { getAllByIndex, put, remove } from '../db.js';
import { normalizeLogEntry } from '../domain/home-log.js';

/** Map 'JJJJ-MM-DD' → { done, pain, swelling } voor één patiënt. */
export async function getHomeLog(patientCode) {
  const records = await getAllByIndex('homeLog', 'patientCode', patientCode);
  return new Map(records.map((record) => [record.date, { done: record.done, pain: record.pain ?? null, swelling: record.swelling ?? null }]));
}

/**
 * Bewaart één dag. Een dag zonder enige informatie (niet geoefend, geen pijn, geen zwelling)
 * wordt weggehaald. Geeft het bewaarde item terug (of null).
 */
export async function saveHomeLogEntry(patientCode, date, raw, options) {
  const entry = normalizeLogEntry(raw, options);
  if (!entry) {
    await remove('homeLog', [patientCode, date]);
    return null;
  }
  await put('homeLog', { patientCode, date, ...entry, updatedAt: new Date().toISOString() });
  return entry;
}
