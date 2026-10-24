import { requestPersistentStorage, storageStatus } from '../db.js';
import { formatBytes, h, showToast } from '../ui/dom.js';
import { changePin, hasPin } from '../ui/mode.js';
import { navigate } from '../router.js';

export async function settingsView() {
  const [status, pinSet] = await Promise.all([storageStatus(), hasPin()]);

  const persistButton = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    onclick: async () => {
      const granted = await requestPersistentStorage();
      showToast(granted
        ? 'Opslag is nu beschermd.'
        : 'Niet toegestaan. Zet de app op je beginscherm en open hem van daaruit.');
      if (granted) navigate('#/instellingen');
    },
  }, 'Opslag beschermen');

  return h('section', {},
    h('div', { class: 'page-head' }, h('h1', {}, 'Instellingen')),
    h('div', { class: 'grid-2' },
      h('div', { class: 'card' },
        h('h2', {}, 'Opslag op dit toestel'),
        status.persisted
          ? h('p', { class: 'notice notice-success' }, 'Beschermd: de browser wist deze data niet automatisch.')
          : h('div', {},
            h('p', { class: 'notice notice-warning' },
              'Niet beschermd: Safari kan de data wissen als de app lang niet gebruikt wordt. Zet de app op je beginscherm en maak regelmatig een back-up.'),
            persistButton,
          ),
        h('p', { class: 'muted' }, `In gebruik: ${formatBytes(status.usage)}.`),
      ),
      h('div', { class: 'card' },
        h('h2', {}, 'Pincode patiëntmodus'),
        h('p', {}, pinSet
          ? 'Er is een pincode ingesteld.'
          : 'Nog geen pincode. Je kiest er een wanneer je voor het eerst naar de patiëntmodus gaat.'),
        h('button', {
          type: 'button',
          class: 'btn btn-secondary',
          onclick: async () => {
            if (await changePin()) navigate('#/instellingen');
          },
        }, pinSet ? 'Pincode wijzigen' : 'Pincode instellen'),
      ),
      h('div', { class: 'card' },
        h('h2', {}, 'Back-up'),
        h('p', { class: 'muted' }, 'Export en import van alle data als JSON-bestand volgen in een volgende stap.'),
      ),
    ),
  );
}
