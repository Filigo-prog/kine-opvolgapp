// Laadt de klinische protocollen uit /data. De inhoud staat in JSON, niet in de code.

export const INJURIES = ['vkb', 'enkel'];

const cache = new Map();

export async function loadProtocol(injury) {
  if (!INJURIES.includes(injury)) throw new Error(`Onbekend letsel: ${injury}`);
  if (!cache.has(injury)) {
    const promise = fetch(`./data/protocol-${injury}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Protocol ${injury} niet gevonden (${response.status}).`);
        return response.json();
      })
      .then((protocol) => validateProtocol(protocol, injury));
    // Bij een fout niet in de cache houden, zodat een volgende poging opnieuw laadt.
    promise.catch(() => cache.delete(injury));
    cache.set(injury, promise);
  }
  return cache.get(injury);
}

export async function loadAllProtocols() {
  const protocols = await Promise.all(INJURIES.map(loadProtocol));
  return Object.fromEntries(protocols.map((protocol) => [protocol.id, protocol]));
}

export function validateProtocol(protocol, expectedId) {
  const problems = [];
  if (protocol?.id !== expectedId) problems.push(`id moet "${expectedId}" zijn`);
  for (const key of ['version', 'name', 'codePrefix', 'dateLabel', 'sinceLabel']) {
    if (typeof protocol?.[key] !== 'string' || !protocol[key]) problems.push(`"${key}" ontbreekt`);
  }
  if (!/^[A-Z]{2,5}$/.test(protocol?.codePrefix ?? '')) problems.push('"codePrefix" moet 2 tot 5 hoofdletters zijn');
  if (typeof protocol?.patientFields !== 'object') problems.push('"patientFields" ontbreekt');
  if (problems.length) throw new Error(`Protocol ${expectedId} is ongeldig: ${problems.join('; ')}.`);
  return protocol;
}

/** Het label van een optie, bv. graft "HT" → "Hamstrings (HT)". */
export function optionLabel(protocol, field, value) {
  const option = protocol.patientFields?.[field]?.options?.find((o) => o.value === value);
  return option ? option.label : value;
}
