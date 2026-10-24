import { getAllByIndex, put, remove, transaction } from '../db.js';
import { earnedMilestones } from '../domain/milestones.js';
import { getHomeLog } from './home-log.js';

/** Map milestoneId → { date, source } voor één patiënt. */
export async function getMilestones(patientCode) {
  const records = await getAllByIndex('milestones', 'patientCode', patientCode);
  return new Map(records.map((record) => [record.milestoneId, record]));
}

/**
 * Bewaart nieuw behaalde mijlpalen en verwijdert er nooit: een behaalde mijlpaal blijft behaald,
 * ook als de therapeut achteraf een criterium aanpast. Geeft de nieuwe id's terug.
 */
export async function syncMilestones(patientCode, earned, stored) {
  const fresh = earned.filter((entry) => !stored.has(entry.id));
  if (!fresh.length) return [];
  await transaction(['milestones'], ({ milestones }) => {
    for (const entry of fresh) {
      milestones.put({ patientCode, milestoneId: entry.id, date: entry.date, source: 'auto', createdAt: new Date().toISOString() });
    }
  });
  return fresh.map((entry) => entry.id);
}

/** Handmatige mijlpaal registreren door de therapeut. */
export function setManualMilestone(patientCode, milestoneId, date) {
  return put('milestones', { patientCode, milestoneId, date, source: 'manual', createdAt: new Date().toISOString() });
}

/** Handmatige mijlpaal weer weghalen (vergissing). */
export function removeManualMilestone(patientCode, milestoneId) {
  return remove('milestones', [patientCode, milestoneId]);
}

/**
 * Bepaalt de behaalde mijlpalen en bewaart nieuwe. Geeft { dates, fresh } terug:
 * dates = Map id → datum (wat al bewaard was, aangevuld met wat nu behaald is),
 * fresh = id's die nu voor het eerst behaald zijn.
 */
export async function refreshMilestonesDetailed(patientCode, { protocol, sessions, statuses, history, homeLog }) {
  const stored = await getMilestones(patientCode);
  const manual = new Map([...stored].filter(([, record]) => record.source === 'manual'));
  const log = homeLog ?? await getHomeLog(patientCode);
  const earned = earnedMilestones({ protocol, sessions, statuses, history, manual, homeLog: log });
  const fresh = await syncMilestones(patientCode, earned, stored);

  const dates = new Map([...stored].map(([id, record]) => [id, record.date]));
  for (const entry of earned) if (!dates.has(entry.id)) dates.set(entry.id, entry.date);
  return { dates, fresh };
}

/** Zoals refreshMilestonesDetailed, maar geeft enkel de Map id → datum terug. */
export async function refreshMilestones(patientCode, data) {
  return (await refreshMilestonesDetailed(patientCode, data)).dates;
}
