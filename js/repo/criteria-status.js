import { getAllByIndex, put } from '../db.js';

/** Map criterionId → { status, date, note } voor één patiënt. */
export async function getCriteriaStatuses(patientCode) {
  const records = await getAllByIndex('criteriaStatus', 'patientCode', patientCode);
  return new Map(records.map((record) => [record.criterionId, record]));
}

export function setCriterionStatus(patientCode, criterionId, { status, note, date }) {
  return put('criteriaStatus', {
    patientCode,
    criterionId,
    status,
    note: note ?? '',
    date,
    updatedAt: new Date().toISOString(),
  });
}
