import { get, getAll, transaction } from '../db.js';

// Stores met een index 'patientCode': die data verdwijnt mee als een patiënt gewist wordt.
const PATIENT_DATA_STORES = ['testSessions', 'criteriaStatus', 'levelHistory', 'milestones', 'homeLog'];

export async function listPatients() {
  const patients = await getAll('patients');
  return patients.sort((a, b) => a.code.localeCompare(b.code, 'nl', { numeric: true }));
}

export function getPatient(code) {
  return get('patients', code);
}

/** Nieuwe patiënt, meteen in level 1. Faalt als de code al bestaat. */
export async function createPatient(patient, { protocolVersion, today }) {
  const now = new Date().toISOString();
  const record = { ...patient, protocolVersion, createdAt: now, updatedAt: now };
  try {
    await transaction(['patients', 'levelHistory'], ({ patients, levelHistory }) => {
      patients.add(record);
      levelHistory.add({
        id: crypto.randomUUID(),
        patientCode: patient.code,
        level: 1,
        date: today,
        note: 'Start opvolging',
      });
    });
  } catch (error) {
    if (error?.name === 'ConstraintError') throw new Error(`De code ${patient.code} bestaat al.`);
    throw error;
  }
  return record;
}

/** Bewerken: code, letsel en protocolversie blijven ongewijzigd. */
export async function updatePatient(code, changes) {
  const existing = await getPatient(code);
  if (!existing) throw new Error(`Patiënt ${code} niet gevonden.`);
  const record = {
    ...existing,
    ...changes,
    code: existing.code,
    injury: existing.injury,
    protocolVersion: existing.protocolVersion,
    updatedAt: new Date().toISOString(),
  };
  await transaction(['patients'], ({ patients }) => {
    patients.put(record);
  });
  return record;
}

/** Wist de patiënt en al zijn gegevens, in één transactie. */
export function deletePatient(code) {
  return transaction(['patients', ...PATIENT_DATA_STORES], (stores) => {
    stores.patients.delete(code);
    for (const name of PATIENT_DATA_STORES) {
      const store = stores[name];
      store.index('patientCode').openKeyCursor(IDBKeyRange.only(code)).onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
    }
  });
}

/** Voor de patiëntenlijst: huidig level en datum van het laatste testmoment per patiënt. */
export async function listPatientSummaries() {
  const [patients, levels, sessions] = await Promise.all([
    listPatients(),
    getAll('levelHistory'),
    getAll('testSessions'),
  ]);

  // Huidig level = hoogste vrijgegeven level.
  const currentLevel = new Map();
  for (const entry of levels) {
    currentLevel.set(entry.patientCode, Math.max(currentLevel.get(entry.patientCode) ?? 1, entry.level));
  }

  const lastTest = new Map();
  for (const session of sessions) {
    const latest = lastTest.get(session.patientCode);
    if (!latest || session.date > latest) lastTest.set(session.patientCode, session.date);
  }

  return patients.map((patient) => ({
    patient,
    level: currentLevel.get(patient.code) ?? 1,
    lastTestDate: lastTest.get(patient.code) ?? null,
  }));
}
