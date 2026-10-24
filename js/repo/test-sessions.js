import { get, getAllByIndex, put, remove, transaction } from '../db.js';

/** Testmomenten van een patiënt, nieuwste eerst. */
export async function listTestSessions(patientCode) {
  const sessions = await getAllByIndex('testSessions', 'patientCode', patientCode);
  return sessions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function getTestSession(id) {
  return get('testSessions', id);
}

/** Nieuw (zonder id) of bestaand testmoment opslaan. */
export async function saveTestSession(session, { patientCode, protocolVersion }) {
  const now = new Date().toISOString();
  const existing = session.id ? await getTestSession(session.id) : null;
  const record = existing
    ? { ...existing, ...session, updatedAt: now }
    : { ...session, id: crypto.randomUUID(), patientCode, protocolVersion, createdAt: now, updatedAt: now };
  await put('testSessions', record);
  return record;
}

export function deleteTestSession(id) {
  return remove('testSessions', id);
}

/**
 * Bewaart geïmporteerde testmomenten in één transactie. Bestaat er al een testmoment op dezelfde datum,
 * dan worden de nieuwe metingen daarin gezet (dezelfde test wordt overschreven, andere blijven staan).
 * items = [{ date, measurements, note }]. Geeft { created, merged } terug.
 */
export async function importTestSessions(patientCode, protocolVersion, items) {
  const existing = await listTestSessions(patientCode);
  const now = new Date().toISOString();
  let created = 0;
  let merged = 0;

  const records = items.map((item) => {
    const same = existing.find((session) => session.date === item.date);
    if (same) {
      merged += 1;
      return { ...same, measurements: { ...same.measurements, ...item.measurements }, updatedAt: now };
    }
    created += 1;
    return {
      id: crypto.randomUUID(), patientCode, protocolVersion, date: item.date, note: item.note ?? '',
      measurements: item.measurements, createdAt: now, updatedAt: now,
    };
  });

  await transaction(['testSessions'], ({ testSessions }) => {
    for (const record of records) testSessions.put(record);
  });
  return { created, merged };
}
