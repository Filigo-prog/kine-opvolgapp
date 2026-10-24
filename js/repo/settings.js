import { get, put } from '../db.js';

export async function getSetting(key, fallback = null) {
  const record = await get('settings', key);
  return record ? record.value : fallback;
}

export function setSetting(key, value) {
  return put('settings', { key, value });
}
