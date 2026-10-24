import { openDb, requestPersistentStorage } from './db.js';
import { startRouter } from './router.js';
import { h } from './ui/dom.js';
import { initMode } from './ui/mode.js';
import { patientDetailView } from './views/patient-detail.js';
import { patientFormView } from './views/patient-form.js';
import { patientHomeView } from './views/patient-home.js';
import { patientListView } from './views/patient-list.js';
import { settingsView } from './views/settings.js';
import { testEntryView } from './views/test-entry.js';

const routes = [
  { path: '/patienten', view: patientListView, therapistOnly: true },
  { path: '/patient/nieuw', view: () => patientFormView(), therapistOnly: true },
  { path: '/patient/:code/bewerken', view: patientFormView, therapistOnly: true },
  { path: '/patient/:code/test/nieuw', view: ({ code }) => testEntryView({ code }), therapistOnly: true },
  { path: '/patient/:code/test/:id', view: testEntryView, therapistOnly: true },
  { path: '/patient/:code', view: patientDetailView, therapistOnly: true },
  { path: '/instellingen', view: settingsView, therapistOnly: true },
  { path: '/start', view: patientHomeView },
];

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('./sw.js').catch((error) => {
    console.warn('Service worker niet geregistreerd:', error);
  });
}

async function start() {
  try {
    await openDb();
    await initMode();
    // Werkt vooral als de app vanaf het beginscherm geopend wordt; mislukken is geen fout.
    requestPersistentStorage().catch(() => {});
    await startRouter(routes, { fallback: '#/patienten', patientFallback: '#/start' });
  } catch (error) {
    console.error(error);
    document.getElementById('app').replaceChildren(
      h('div', { class: 'notice notice-danger', role: 'alert' },
        'De app kon niet starten. ', String(error?.message ?? error)),
    );
  }
  registerServiceWorker();
}

start();
