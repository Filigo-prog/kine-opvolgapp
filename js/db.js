// Lokale opslag in IndexedDB. Alle data blijft op het toestel.
// Schemawijziging? Verhoog DB_VERSION en voeg een stap toe in upgrade().

const DB_NAME = 'kine-opvolging';
const DB_VERSION = 1;

let dbPromise = null;

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    const patients = db.createObjectStore('patients', { keyPath: 'code' });
    patients.createIndex('injury', 'injury');

    const sessions = db.createObjectStore('testSessions', { keyPath: 'id' });
    sessions.createIndex('patientCode', 'patientCode');

    const criteria = db.createObjectStore('criteriaStatus', { keyPath: ['patientCode', 'criterionId'] });
    criteria.createIndex('patientCode', 'patientCode');

    const levels = db.createObjectStore('levelHistory', { keyPath: 'id' });
    levels.createIndex('patientCode', 'patientCode');

    const milestones = db.createObjectStore('milestones', { keyPath: ['patientCode', 'milestoneId'] });
    milestones.createIndex('patientCode', 'patientCode');

    const homeLog = db.createObjectStore('homeLog', { keyPath: ['patientCode', 'date'] });
    homeLog.createIndex('patientCode', 'patientCode');

    db.createObjectStore('settings', { keyPath: 'key' });
  }
}

export const STORES = [
  'patients',
  'testSessions',
  'criteriaStatus',
  'levelHistory',
  'milestones',
  'homeLog',
  'settings',
];

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => upgrade(request.result, event.oldVersion);
    request.onsuccess = () => {
      const db = request.result;
      // Een nieuwere versie van de app in een ander tabblad: deze verbinding loslaten.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('De database is in gebruik door een ander venster. Sluit dat venster en probeer opnieuw.'));
  });
  return dbPromise;
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  const tx = db.transaction(storeName, mode);
  const result = await fn(tx.objectStore(storeName));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return result;
}

export function get(storeName, key) {
  return withStore(storeName, 'readonly', (store) => promisify(store.get(key)));
}

export function getAll(storeName) {
  return withStore(storeName, 'readonly', (store) => promisify(store.getAll()));
}

export function getAllByIndex(storeName, indexName, value) {
  return withStore(storeName, 'readonly', (store) => promisify(store.index(indexName).getAll(value)));
}

export function put(storeName, value) {
  return withStore(storeName, 'readwrite', (store) => promisify(store.put(value)));
}

export function remove(storeName, key) {
  return withStore(storeName, 'readwrite', (store) => promisify(store.delete(key)));
}

/**
 * Meerdere stores in één transactie: alles slaagt of niets.
 * fn krijgt een object { storeName: IDBObjectStore } en mag enkel synchroon requests starten.
 */
export async function transaction(storeNames, fn) {
  const db = await openDb();
  const tx = db.transaction(storeNames, 'readwrite');
  const stores = Object.fromEntries(storeNames.map((name) => [name, tx.objectStore(name)]));
  try {
    fn(stores);
  } catch (error) {
    // Een fout halverwege mag nooit een half resultaat bewaren (bv. gewist maar niet teruggezet).
    try { tx.abort(); } catch { /* al afgerond */ }
    throw error;
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Vraag de browser om de data niet automatisch te wissen. */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function storageStatus() {
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  return { persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null };
}
