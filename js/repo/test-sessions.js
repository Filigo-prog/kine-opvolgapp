import { get, getAllByIndex, put, remove } from '../db.js';

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
