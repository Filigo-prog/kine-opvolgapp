// Testmomenten importeren uit een VALD Hub-export (bv. DynaMo Max), met een voorbeeld vóór het bewaren.
// De therapeut bevestigt welke meting bij welke test hoort; die keuze wordt bewaard voor de volgende keer.
// Namen uit het bestand worden nooit bewaard of getoond: enkel initialen en de External Id.

import { formatDate, todayIso } from '../domain/dates.js';
import { compareSides } from '../domain/lsi.js';
import { loadProtocol } from '../domain/protocol.js';
import { buildSession, allTests } from '../domain/test-session.js';
import { buildImportSessions, matchPerson, metricUnit, parseValdExport, suggestMapping } from '../domain/vald.js';
import { testUnits } from '../domain/test-session.js';
import { readFileText } from '../io/backup.js';
import { getPatient } from '../repo/patients.js';
import { importTestSessions } from '../repo/test-sessions.js';
import { getSetting, setSetting } from '../repo/settings.js';
import { getValdMappings, saveValdMappings } from '../repo/vald-mappings.js';
import { navigate } from '../router.js';
import { h, showToast } from '../ui/dom.js';
import { describePerKg, formatComparison, formatNumber, withUnit } from '../ui/format.js';
import { notFound } from '../ui/not-found.js';
import { CODE_PATTERN } from '../domain/patient.js';

export async function valdImportView({ code }) {
  const patient = await getPatient(code);
  if (!patient) return notFound('Patiënt niet gevonden', `Er is geen patiënt met code ${code}.`);
  const protocol = await loadProtocol(patient.injury);
  const detailHref = `#/patient/${encodeURIComponent(code)}`;

  if (!protocol.valdMapping) {
    return h('section', {},
      h('div', { class: 'page-head' }, h('h1', {}, 'Importeren uit VALD Hub')),
      h('div', { class: 'card empty-state' },
        h('p', { class: 'muted' }, 'Voor dit letsel is er nog geen koppeling met VALD-metingen ingesteld.'),
        h('a', { class: 'btn btn-secondary', href: detailHref }, 'Terug naar patiënt')));
  }

  const savedMappings = await getValdMappings();
  // Heb je bevestigd dat je VALD Hub dag/maand gebruikt, dan waarschuwen we daar niet meer voor.
  let dateOrderConfirmed = await getSetting('valdDateOrderConfirmed', false);
  const bilateralTests = allTests(protocol).filter((test) => test.type === 'bilateral');
  const today = todayIso();

  const root = h('div', { class: 'vald-import' });
  const content = h('div');
  let parsed = null;
  let personId = null;
  let choices = [];

  const fileInput = h('input', {
    type: 'file', class: 'visually-hidden', accept: '.csv,text/csv', tabindex: '-1', 'aria-label': 'VALD Hub-bestand kiezen',
    onchange: async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (file) await load(file);
    },
  });

  async function load(file) {
    let result;
    try {
      result = parseValdExport(await readFileText(file));
    } catch {
      result = { errors: ['Het bestand kon niet gelezen worden.'] };
    }
    if (result.errors) {
      parsed = null;
      renderStart(result.errors);
      return;
    }
    parsed = result;
    personId = matchPerson(result.people, code);
    buildChoices();
    renderPreview();
  }

  function buildChoices() {
    const rows = parsed.rows.filter((row) => row.personId === personId);
    choices = rows.map((row) => {
      const mapping = suggestMapping(row, { saved: savedMappings, protocolMapping: protocol.valdMapping });
      const test = mapping && bilateralTests.some((t) => t.id === mapping.test) ? mapping.test : '';
      const metric = mapping && row.values[mapping.metric] ? mapping.metric : (Object.keys(row.values).find((m) => /max force/i.test(m)) ?? Object.keys(row.values)[0]);
      return { row, include: Boolean(test), date: row.date ?? '', test, metric };
    });
    // Dezelfde test twee keer op dezelfde dag: standaard enkel de laatste in het bestand.
    const seen = new Set();
    for (const choice of [...choices].reverse()) {
      if (!choice.include) continue;
      const key = `${choice.date}|${choice.test}`;
      if (seen.has(key)) choice.include = false;
      seen.add(key);
    }
  }

  function renderStart(errors = []) {
    content.replaceChildren(
      h('div', { class: 'card stack' },
        h('h2', {}, 'Kies een bestand'),
        h('p', {}, 'Exporteer de metingen als CSV in VALD Hub en kies het bestand hier. Je ziet eerst een voorbeeld; er wordt niets bewaard voor je bevestigt.'),
        h('p', { class: 'muted' }, 'De naam van de persoon in het bestand wordt genegeerd. Je ziet enkel initialen, en je kiest zelf bij welke patiënt de metingen horen. Tip: zet in VALD Hub de patiëntcode (bv. VKB-024) bij "External Id", dan herkent de app de patiënt vanzelf.'),
        errors.length
          ? h('div', { class: 'notice notice-danger', role: 'alert' }, h('strong', {}, 'Dit bestand kan niet gebruikt worden.'), h('ul', {}, errors.map((e) => h('li', {}, e))))
          : null,
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => fileInput.click() }, 'Bestand kiezen'),
      ));
  }

  function renderPreview() {
    const person = parsed.people.find((p) => p.id === personId);
    const picker = parsed.people.length > 1
      ? h('div', { class: 'field' },
        h('label', { class: 'field-label', for: 'f-person' }, 'Welke persoon uit het bestand is deze patiënt?'),
        h('select', {
          id: 'f-person', class: 'input',
          onchange: (event) => { personId = event.target.value || null; buildChoices(); renderPreview(); },
        },
        h('option', { value: '' }, 'Kies…'),
        parsed.people.map((p) => h('option', { value: p.id, selected: p.id === personId },
          `${p.initials}${p.externalId ? ` (${p.externalId})` : ''} · ${p.rows} ${p.rows === 1 ? 'meting' : 'metingen'}`))))
      : null;

    const otherCode = person && person.externalId && CODE_PATTERN.test(person.externalId.toUpperCase()) && person.externalId.toUpperCase() !== code.toUpperCase();

    const summary = h('p', { class: 'muted import-summary', 'aria-live': 'polite' });
    const problems = h('div', { class: 'notice notice-danger', role: 'alert', hidden: true });
    const importButton = h('button', { type: 'button', class: 'btn btn-primary', onclick: doImport }, 'Importeren');

    function refreshSummary() {
      const { sessions } = buildImportSessions(choices);
      const count = choices.filter((c) => c.include).length;
      summary.textContent = count
        ? `${count} ${count === 1 ? 'meting' : 'metingen'} in ${sessions.length} ${sessions.length === 1 ? 'testmoment' : 'testmomenten'}. Bestaat er al een testmoment op dezelfde datum, dan worden de metingen daaraan toegevoegd.`
        : 'Er is niets aangevinkt om te importeren.';
      importButton.disabled = count === 0;
    }

    async function doImport() {
      const { sessions, problems: found } = buildImportSessions(choices.map((choice) => ({ ...choice, unit: metricUnit(choice.metric) })));
      const lines = [...found];
      const items = [];
      for (const entry of sessions) {
        const { session, errors } = buildSession(
          { date: entry.date, note: 'Geïmporteerd uit VALD Hub.', entries: entry.entries },
          { protocol, patient, today },
        );
        for (const [testId, message] of Object.entries(errors)) {
          lines.push(`${formatDate(entry.date)}: ${allTests(protocol).find((t) => t.id === testId)?.label ?? testId}: ${message}`);
        }
        items.push({ date: entry.date, measurements: session.measurements, note: session.note });
      }
      if (lines.length) {
        problems.hidden = false;
        problems.replaceChildren(h('strong', {}, 'Er is nog niets bewaard. Pas dit aan:'), h('ul', {}, lines.map((line) => h('li', {}, line))));
        problems.scrollIntoView({ block: 'center' });
        return;
      }
      importButton.disabled = true;
      try {
        const result = await importTestSessions(code, protocol.version, items);
        const updates = {};
        for (const choice of choices.filter((c) => c.include)) updates[choice.row.testKey] = { test: choice.test, metric: choice.metric };
        await saveValdMappings(updates);
        const parts = [];
        if (result.created) parts.push(result.created === 1 ? '1 nieuw testmoment' : `${result.created} nieuwe testmomenten`);
        if (result.merged) parts.push(result.merged === 1 ? '1 testmoment aangevuld' : `${result.merged} testmomenten aangevuld`);
        showToast(`Geïmporteerd: ${parts.join(', ')}.`);
        navigate(detailHref);
      } catch (error) {
        console.error(error);
        problems.hidden = false;
        problems.replaceChildren(h('strong', {}, `Het bewaren is niet gelukt: ${error.message ?? error}`));
        importButton.disabled = false;
      }
    }

    content.replaceChildren(...[
      h('div', { class: 'card stack' },
        h('h2', {}, 'Voorbeeld'),
        picker,
        person ? h('p', { class: 'muted' }, `Persoon ${person.initials}${person.externalId ? ` · External Id ${person.externalId}` : ' · geen External Id'}`) : null,
        otherCode ? h('p', { class: 'notice notice-danger', role: 'alert' }, `Let op: in het bestand staat deze persoon als ${person.externalId}, niet als ${code}. Controleer of dit de juiste patiënt is.`) : null,
        parsed.datesAmbiguous && !dateOrderConfirmed ? dateNotice() : null,
      ),
      person
        ? choices.map((choice, index) => rowCard(choice, index, refreshSummary))
        : h('p', { class: 'muted' }, 'Kies eerst de persoon om de metingen te zien.'),
      person
        ? h('div', { class: 'card stack' },
          summary, problems,
          h('div', { class: 'form-actions' },
            h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { parsed = null; renderStart(); } }, 'Ander bestand'),
            importButton))
        : null,
    ].flat().filter(Boolean));
    refreshSummary();
  }

  function dateNotice() {
    const notice = h('div', { class: 'notice notice-warning', role: 'note' },
      h('p', {}, 'De datums in dit bestand kunnen dag/maand of maand/dag zijn. We gaan uit van dag/maand. Controleer de datums hieronder.'),
      h('button', {
        type: 'button', class: 'btn btn-secondary',
        onclick: async () => {
          dateOrderConfirmed = true;
          await setSetting('valdDateOrderConfirmed', true);
          notice.remove();
          showToast('Onthouden: VALD Hub gebruikt dag/maand.');
        },
      }, 'Dag/maand klopt, niet meer vragen'),
    );
    return notice;
  }

  function rowCard(choice, index, onChange) {
    const resultLine = h('p', { class: 'import-result', 'aria-live': 'polite' });
    const unitNote = h('p', { class: 'field-error import-unit', hidden: true });

    const includeBox = h('input', { type: 'checkbox', checked: choice.include, 'aria-label': `Importeren: ${choice.row.testLabel}`,
      onchange: () => { choice.include = includeBox.checked; onChange(); } });
    const dateInput = h('input', { type: 'date', class: 'input', value: choice.date, max: today, 'aria-label': 'Datum van de meting',
      oninput: () => { choice.date = dateInput.value; onChange(); } });
    const testSelect = h('select', { class: 'input', 'aria-label': 'Welke test is dit?',
      onchange: () => {
        choice.test = testSelect.value;
        if (!choice.test) { choice.include = false; includeBox.checked = false; } else if (!choice.include) { choice.include = true; includeBox.checked = true; }
        refresh(); onChange();
      } },
    h('option', { value: '' }, '— niet importeren —'),
    bilateralTests.map((test) => h('option', { value: test.id, selected: test.id === choice.test },
      `${test.label} (${testUnits(test).map((entry) => entry.unit).join(' of ')})`)));
    const metricSelect = h('select', { class: 'input', 'aria-label': 'Welke meetwaarde?',
      onchange: () => { choice.metric = metricSelect.value; refresh(); onChange(); } },
    Object.keys(choice.row.values).map((metric) => h('option', { value: metric, selected: metric === choice.metric }, metric)));

    function refresh() {
      const value = choice.row.values[choice.metric];
      const test = bilateralTests.find((t) => t.id === choice.test);
      if (!value) { resultLine.textContent = ''; return; }
      const unit = metricUnit(choice.metric);
      const shown = (n) => withUnit(formatNumber(n, 1), unit ?? '');
      let text = `Links ${shown(value.left)} · Rechts ${shown(value.right)}`;
      unitNote.hidden = true;
      if (test) {
        const comparison = compareSides(test, value.left, value.right, patient.side);
        text += ` → ${formatComparison(test, comparison)}`;
        const allowed = testUnits(test).map((entry) => entry.unit);
        const perKg = describePerKg(test, value.left, value.right, patient.side, patient.bodyWeightKg, unit ?? test.unit);
        if (perKg) text += ` · ${perKg}`;
        if (unit && allowed[0] && !allowed.includes(unit)) {
          unitNote.hidden = false;
          unitNote.textContent = `Let op: de meetwaarde is in ${unit}, de test kent ${allowed.join(' en ')}.`;
        }
      }
      resultLine.textContent = text;
    }
    refresh();

    return h('div', { class: 'card import-row' },
      h('div', { class: 'import-row-head' },
        h('label', { class: 'checkbox import-include' }, includeBox, h('span', {}, h('strong', {}, choice.row.testLabel || 'Onbekende test'))),
        h('span', { class: 'muted' }, [choice.row.device, choice.row.time].filter(Boolean).join(' · '))),
      h('div', { class: 'import-fields' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Datum'), dateInput),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Test'), testSelect),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Meetwaarde'), metricSelect)),
      resultLine, unitNote,
      choice.row.date === null ? h('p', { class: 'field-error' }, 'De datum in het bestand is niet te lezen. Vul ze hier in.') : null,
    );
  }

  renderStart();
  return h('section', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Importeren uit VALD Hub'),
        h('p', { class: 'muted page-subtitle' }, `${patient.code}, ${protocol.name}`)),
      h('a', { class: 'btn btn-secondary', href: detailHref }, 'Annuleren')),
    root, content, fileInput,
  );
}
