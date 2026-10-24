import { getAllByIndex, put, remove } from '../db.js';

/** Levelhistoriek van een patiënt, oudste eerst. */
export async function getLevelHistory(patientCode) {
  const entries = await getAllByIndex('levelHistory', 'patientCode', patientCode);
  return entries.sort((a, b) => a.level - b.level || a.date.localeCompare(b.date));
}

/** Volgend level vrijgeven. Enkel aanroepen na bevestiging door de therapeut. */
export function releaseLevel(patientCode, level, { date, note = '' }) {
  return put('levelHistory', {
    id: crypto.randomUUID(),
    patientCode,
    level,
    date,
    note,
    createdAt: new Date().toISOString(),
  });
}

/** Laatste vrijgave ongedaan maken (bv. bij een vergissing). Level 1 blijft altijd staan. */
export async function undoLastRelease(patientCode) {
  const history = await getLevelHistory(patientCode);
  const last = history.at(-1);
  if (!last || last.level <= 1) return null;
  await remove('levelHistory', last.id);
  return last;
}
