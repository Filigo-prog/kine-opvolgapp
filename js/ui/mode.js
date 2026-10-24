// Therapeut- of patiëntmodus. De patiëntmodus is vergrendeld met een pincode,
// zodat een patiënt met de iPad in de hand niet in de therapeutschermen terechtkomt.
// De modus wordt bewaard: herladen of de app opnieuw openen ontgrendelt niets.

import { getSetting, setSetting } from '../repo/settings.js';
import { pinDialog } from './dialog.js';
import { showToast } from './dom.js';

const THERAPIST = 'therapist';
const PATIENT = 'patient';

let mode = THERAPIST;

export function isPatientMode() {
  return mode === PATIENT;
}

export async function initMode() {
  mode = (await getSetting('mode', THERAPIST)) === PATIENT ? PATIENT : THERAPIST;
  applyMode();
  document.getElementById('mode-toggle').addEventListener('click', () => {
    if (isPatientMode()) {
      exitPatientMode();
      return;
    }
    // De patiënt van het scherm waar je nu bent; zonder open patiënt is er niets om te tonen.
    const code = patientCodeFromHash();
    if (!code) {
      showToast('Open eerst een patiënt om de patiëntmodus te starten.');
      return;
    }
    enterPatientMode(code);
  });
}

function applyMode() {
  document.body.classList.toggle('mode-patient', isPatientMode());
  const toggle = document.getElementById('mode-toggle');
  toggle.textContent = isPatientMode() ? 'Therapeut' : 'Patiëntmodus';
  toggle.setAttribute('aria-label', isPatientMode()
    ? 'Terug naar therapeutmodus (pincode nodig)'
    : 'Naar patiëntmodus');
}

async function setMode(next, hash) {
  mode = next;
  await setSetting('mode', next);
  applyMode();
  location.hash = hash;
}

export async function hasPin() {
  return Boolean(await getSetting('pin'));
}

function patientCodeFromHash() {
  const match = location.hash.match(/^#\/patient\/([^/]+)/);
  return match && match[1] !== 'nieuw' ? decodeURIComponent(match[1]) : null;
}

/** De patiënt die in patiëntmodus getoond wordt (of null). */
export function getPatientModeCode() {
  return getSetting('patientCode', null);
}

export async function enterPatientMode(code) {
  if (!(await hasPin())) {
    const created = await createPin('Kies eerst een pincode. Die heb je nodig om de patiëntmodus te verlaten.');
    if (!created) return;
  }
  await setSetting('patientCode', code);
  await setMode(PATIENT, '#/start');
}

export async function exitPatientMode() {
  const pin = await pinDialog({
    title: 'Therapeutmodus',
    message: 'Geef je pincode in.',
    confirmLabel: 'Ontgrendelen',
    validate: async (value) => ((await checkPin(value)) ? null : 'Verkeerde pincode.'),
  });
  if (pin === null) return;
  await setMode(THERAPIST, '#/patienten');
}

/** Pincode instellen of wijzigen (enkel in therapeutmodus). */
export async function changePin() {
  if (await hasPin()) {
    const current = await pinDialog({
      title: 'Pincode wijzigen',
      message: 'Geef eerst je huidige pincode in.',
      confirmLabel: 'Verder',
      validate: async (value) => ((await checkPin(value)) ? null : 'Verkeerde pincode.'),
    });
    if (current === null) return false;
  }
  return createPin();
}

async function createPin(message) {
  const pin = await pinDialog({
    title: 'Pincode instellen',
    message,
    confirmLabel: 'Opslaan',
    repeat: true,
  });
  if (pin === null) return false;
  const salt = randomHex(16);
  await setSetting('pin', { salt, hash: await hashPin(pin, salt) });
  showToast('Pincode opgeslagen.');
  return true;
}

async function checkPin(pin) {
  const stored = await getSetting('pin');
  if (!stored) return false;
  return (await hashPin(pin, stored.salt)) === stored.hash;
}

async function hashPin(pin, salt) {
  if (!crypto.subtle) {
    throw new Error('Deze pagina moet via https (of localhost) geopend worden om een pincode te gebruiken.');
  }
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
