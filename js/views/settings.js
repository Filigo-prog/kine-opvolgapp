import { requestPersistentStorage, storageStatus } from '../db.js';
import {
  STORE_NAMES, backupReminder, backupReminderText, describeCount, describeLastBackup, parseBackup, planImport, summarizeBackup,
} from '../domain/backup.js';
import { formatDate } from '../domain/dates.js';
import { saveBackupFile, readFileText } from '../io/backup.js';
import { applyImport, exportAll, getLastBackupAt, setLastBackupAt } from '../repo/backup.js';
import { listPatients } from '../repo/patients.js';
import { navigate, render } from '../router.js';
import { confirmDialog, showDialog } from '../ui/dialog.js';
import { formatBytes, h, showToast } from '../ui/dom.js';
import { changePin, hasPin } from '../ui/mode.js';

export async function settingsView() {
  const [status, pinSet, lastBackupAt, patients] = await Promise.all([storageStatus(), hasPin(), getLastBackupAt(), listPatients()]);

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
      backupCard({ lastBackupAt, patients }),
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
    ),
  );
}

function backupCard({ lastBackupAt, patients }) {
  const reminder = backupReminderText(backupReminder({ lastBackupAt, hasData: patients.length > 0 }));
  const last = describeLastBackup(lastBackupAt);
  const problem = h('div', { class: 'import-problem', role: 'alert', hidden: true });

  const fileInput = h('input', {
    type: 'file',
    class: 'visually-hidden',
    accept: '.json,application/json',
    'aria-label': 'Back-upbestand kiezen',
    tabindex: '-1',
    onchange: async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (file) await startRestore(file);
    },
  });

  function showProblem(lines) {
    problem.hidden = false;
    problem.className = 'import-problem notice notice-danger';
    problem.replaceChildren(h('strong', {}, 'Het terugzetten is niet gelukt. Er is niets veranderd.'), h('ul', {}, lines.map((line) => h('li', {}, line))));
  }

  async function onBackup() {
    problem.hidden = true;
    const backup = await exportAll();
    if (backup.counts.patients === 0) {
      showToast('Er zijn nog geen patiënten om te bewaren.');
      return;
    }
    const result = await saveBackupFile(backup);
    if (result === 'cancelled') return;
    await setLastBackupAt(backup.exportedAt);
    showToast(result === 'shared' ? 'Back-up bewaard.' : 'Back-up gedownload. Bewaar het bestand op een veilige plek.');
    render();
  }

  async function startRestore(file) {
    problem.hidden = true;
    let parsed;
    try {
      parsed = parseBackup(await readFileText(file));
    } catch (error) {
      showProblem(['Het bestand kon niet gelezen worden.']);
      return;
    }
    if (parsed.errors) {
      showProblem(parsed.errors);
      return;
    }

    const local = await listPatients();
    const localCodes = local.map((patient) => patient.code);
    const summary = summarizeBackup(parsed.backup, localCodes);
    const mode = await chooseMode(summary, local.length);
    if (!mode) return;

    if (mode === 'replace' && local.length > 0) {
      const sure = await confirmDialog({
        title: 'Alles op dit toestel vervangen?',
        message: `De gegevens van ${describeCount('patients', local.length)} op dit toestel worden definitief gewist en vervangen door de back-up.`,
        confirmLabel: 'Ja, alles vervangen',
        danger: true,
      });
      if (!sure) return;
    }

    try {
      const plan = planImport(parsed.backup, mode, localCodes);
      await applyImport(plan);
      if (mode === 'replace') await setLastBackupAt(parsed.backup.exportedAt);
      showToast(`Teruggezet: ${describeCount('patients', plan.patientCount)}.`);
      navigate('#/patienten');
    } catch (error) {
      console.error(error);
      showProblem([`Er ging iets mis bij het wegschrijven: ${error.message ?? error}`]);
    }
  }

  return h('div', { class: 'card backup-card' },
    h('h2', {}, 'Back-up'),
    reminder ? h('p', { class: 'notice notice-warning', role: 'note' }, reminder) : null,
    h('p', {}, h('strong', {}, 'Laatste back-up: '),
      typeof last === 'string' ? last : `${formatDate(last.date)} (${last.when})`),
    h('p', { class: 'muted' },
      'Het bestand bevat de gezondheidsgegevens van je patiënten (zonder namen, enkel codes). Bewaar het op een veilige plek, bv. in iCloud Drive.'),
    h('div', { class: 'button-row' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: onBackup }, 'Back-up maken'),
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => fileInput.click() }, 'Back-up terugzetten'),
    ),
    fileInput,
    problem,
  );
}

/** Voorbeeld van de back-up, met een keuze als er al gegevens op dit toestel staan. Geeft 'add', 'replace' of null. */
function chooseMode(summary, localCount) {
  return showDialog((close) => {
    let mode = localCount > 0 ? 'add' : 'replace';
    const confirm = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close(mode) }, 'Terugzetten');

    function refresh() {
      const nothingToAdd = mode === 'add' && summary.newCodes.length === 0;
      confirm.disabled = nothingToAdd;
      confirm.className = `btn ${mode === 'replace' && localCount > 0 ? 'btn-danger' : 'btn-primary'}`;
      confirm.textContent = mode === 'replace' && localCount > 0 ? 'Alles vervangen' : 'Terugzetten';
    }

    const contents = STORE_NAMES.filter((name) => summary.counts[name] > 0).map((name) => describeCount(name, summary.counts[name]));
    const shownCodes = summary.codes.slice(0, 12).join(', ') + (summary.codes.length > 12 ? ` en ${summary.codes.length - 12} andere` : '');

    const option = (value, title, text) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'import-mode', value, checked: mode === value, onchange: () => { mode = value; refresh(); } }),
      h('span', {}, h('strong', {}, title), h('span', { class: 'choice-text' }, text)),
    );

    const dialogContent = h('div', {},
      h('h2', {}, 'Back-up terugzetten'),
      h('p', {}, `Back-up van ${formatDate(summary.exportedAt.slice(0, 10))}: ${contents.join(', ') || 'geen gegevens'}.`),
      shownCodes ? h('p', { class: 'muted' }, shownCodes) : null,
      localCount > 0
        ? h('fieldset', { class: 'choice-list' },
          h('legend', { class: 'visually-hidden' }, 'Wat wil je doen?'),
          option('add', 'Aanvullen',
            `${describeCount('patients', summary.newCodes.length)} toevoegen. ${summary.existingCodes.length === 1
              ? '1 bestaat al op dit toestel en blijft'
              : `${summary.existingCodes.length} bestaan al op dit toestel en blijven`} ongewijzigd.`),
          option('replace', 'Alles vervangen',
            `De ${describeCount('patients', localCount)} op dit toestel worden gewist en vervangen door de back-up.`),
        )
        : h('p', {}, 'Er staan nog geen patiënten op dit toestel. Alles uit de back-up wordt teruggezet.'),
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => close(null) }, 'Annuleren'),
        confirm,
      ),
    );
    refresh();
    return dialogContent;
  });
}
