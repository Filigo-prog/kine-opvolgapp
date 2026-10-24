import { getSetting, setSetting } from './settings.js';

// Per testsoort uit VALD Hub (regio | beweging | positie) de test en meetwaarde die de therapeut koos.
// Wordt bewaard zodat de volgende import meteen goed staat.

export async function getValdMappings() {
  return getSetting('valdMappings', {});
}

export async function saveValdMappings(updates) {
  const current = await getValdMappings();
  await setSetting('valdMappings', { ...current, ...updates });
}
