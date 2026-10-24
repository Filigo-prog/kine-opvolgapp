import { getAll, transaction } from '../db.js';
import { STORE_NAMES, buildBackup } from '../domain/backup.js';
import { getSetting, setSetting } from './settings.js';

/** Leest alle patiëntgegevens van dit toestel en bouwt een back-upobject. */
export async function exportAll(now = new Date()) {
  const lists = await Promise.all(STORE_NAMES.map((name) => getAll(name)));
  return buildBackup(Object.fromEntries(STORE_NAMES.map((name, i) => [name, lists[i]])), now);
}

/**
 * Schrijft een importplan weg in één transactie: lukt het niet helemaal, dan verandert er niets.
 * Instellingen (pincode, modus) blijven altijd zoals ze waren.
 */
export function applyImport(plan) {
  return transaction(STORE_NAMES, (stores) => {
    if (plan.mode === 'replace') {
      for (const name of STORE_NAMES) stores[name].clear();
    }
    for (const name of STORE_NAMES) {
      for (const record of plan.records[name]) stores[name].put(record);
    }
  });
}

export function getLastBackupAt() {
  return getSetting('lastBackupAt', null);
}

export function setLastBackupAt(isoString) {
  return setSetting('lastBackupAt', isoString);
}
