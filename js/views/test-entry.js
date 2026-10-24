// Testmoment ingeven of bewerken (therapeutweergave), met live LSI-berekening.

import { todayIso } from '../domain/dates.js';
import { compareSides, parseNumber } from '../domain/lsi.js';
import { referenceForTest } from '../domain/references.js';
import { loadProtocol } from '../domain/protocol.js';
import { buildSession } from '../domain/test-session.js';
import { getPatient } from '../repo/patients.js';
import { deleteTestSession, getTestSession, listTestSessions, saveTestSession } from '../repo/test-sessions.js';
import { navigate } from '../router.js';
import { confirmDialog } from '../ui/dialog.js';
import { h, showToast } from '../ui/dom.js';
import { describePerKg, formatDifference, formatLsi, toInputValue } from '../ui/format.js';
import { notFound } from '../ui/not-found.js';

export async function testEntryView({ code, id }) {
  const patient = await getPatient(code);
  if (!patient) return notFound('Patiënt niet gevonden', `Er is geen patiënt met code ${code}.`);
  const existing = id ? await getTestSession(id) : null;
  if (id && (!existing || existing.patientCode !== code)) {
    return notFound('Testmoment niet gevonden', 'Dit testmoment bestaat niet (meer).');
  }

  const protocol = await loadProtocol(patient.injury);
  const today = todayIso();
  // Nieuw testmoment: begin met de eenheid van de vorige meting (bv. N als je met de DynaMo meet).
  const lastUnits = new Map();
  if (!existing) {
    for (const session of (await listTestSessions(code)).reverse()) {
      for (const [testId, measurement] of Object.entries(session.measurements)) {
        if (measurement.unit) lastUnits.set(testId, measurement.unit);
      }
    }
  }
  const detailHref = `#/patient/${encodeURIComponent(code)}`;
  const measurements = existing?.measurements ?? {};
  const sideName = (s) => (s === 'L' ? 'Links' : 'Rechts');
  const injuredLabel = (s) => (patient.side === s ? `${sideName(s)} (aangedaan)` : sideName(s));

  const form = h('form', { class: 'test-form', novalidate: true, onsubmit: onSubmit },
    h('div', { class: 'card' },
      h('div', { class: 'field', 'data-field': 'date' },
        h('label', { class: 'field-label', for: 'f-date' }, 'Datum testmoment'),
        h('input', { id: 'f-date', name: 'date', type: 'date', class: 'input input-date', value: existing?.date ?? today, max: today }),
        h('p', { class: 'field-error' }),
      ),
      h('p', { class: 'muted' }, 'Vul enkel in wat je gemeten hebt. Lege tests worden niet bewaard.'),
    ),
    (protocol.testGroups ?? []).map((group) => h('div', { class: 'card' },
      h('h2', {}, group.label),
      group.tests.some((test) => test.type === 'bilateral')
        ? h('div', { class: 'test-row test-row-head', 'aria-hidden': 'true' },
          h('span', {}),
          h('span', {}, injuredLabel('L')),
          h('span', {}, injuredLabel('R')),
          h('span', {}, 'Resultaat'))
        : null,
      group.tests.map((test) => testRow(test)),
    )),
    h('div', { class: 'card' },
      h('div', { class: 'field' },
        h('label', { class: 'field-label', for: 'f-note' }, 'Notitie (optioneel)'),
        h('textarea', { id: 'f-note', name: 'note', class: 'input textarea', rows: 3 }, existing?.note ?? ''),
      ),
    ),
    h('p', { class: 'form-error', role: 'alert', 'data-form-error': '' }),
    h('div', { class: 'form-actions' },
      existing
        ? h('button', { type: 'button', class: 'btn btn-secondary btn-danger-outline form-actions-left', onclick: onDelete }, 'Verwijderen')
        : null,
      h('a', { class: 'btn btn-secondary', href: detailHref }, 'Annuleren'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Testmoment opslaan'),
    ),
  );

  function testRow(test) {
    const m = measurements[test.id] ?? {};
    const label = h('div', { class: 'test-label' },
      h('span', { class: 'test-name' }, test.label),
      test.unit && test.type !== 'choice' && !test.units ? h('span', { class: 'muted' }, ` (${test.unit})`) : null,
      test.hint ? h('span', { class: 'test-hint muted' }, test.hint) : null,
      referenceForTest(protocol, test.id, patient.sex) ? h('span', { class: 'test-reference' }, `Referentie: ${referenceForTest(protocol, test.id, patient.sex)}`) : null,
    );
    const error = h('p', { class: 'field-error test-error' });

    if (test.type === 'bilateral') {
      const result = h('output', { class: 'test-result', 'aria-live': 'polite' });
      const input = (s, value) => h('input', {
        class: 'input input-number',
        name: `${test.id}.${s}`,
        inputmode: 'decimal',
        autocomplete: 'off',
        value: toInputValue(value),
        'aria-label': `${test.label}, ${injuredLabel(s === 'left' ? 'L' : 'R').toLowerCase()}`,
        oninput: update,
      });
      const left = input('left', m.left);
      const right = input('right', m.right);
      const perKgLine = h('span', { class: 'test-perkg muted' });

      // Eén test, meerdere eenheden (bv. Nm of N): de LSI is een verhouding en verandert niet.
      let unit = m.unit ?? lastUnits.get(test.id) ?? test.unit;
      const unitSwitch = test.units?.length > 1
        ? h('div', { class: 'segmented segmented-compact unit-switch', role: 'radiogroup', 'aria-label': `Eenheid van ${test.label}` },
          test.units.map((entry) => h('label', { class: 'segment' },
            h('input', { type: 'radio', name: `${test.id}.unit`, value: entry.unit, checked: entry.unit === unit,
              onchange: () => { unit = entry.unit; update(); } }),
            h('span', {}, entry.unit))))
        : null;

      function update() {
        const l = parseNumber(left.value);
        const r = parseNumber(right.value);
        if (!Number.isFinite(l) || !Number.isFinite(r)) {
          result.textContent = '';
          perKgLine.textContent = '';
          return;
        }
        const comparison = compareSides(test, l, r, patient.side);
        result.textContent = test.compare === 'difference'
          ? formatDifference(comparison.difference, test)
          : formatLsi(comparison.lsi);
        perKgLine.textContent = describePerKg(test, l, r, patient.side, patient.bodyWeightKg, unit) ?? '';
      }
      update();

      if (unitSwitch) label.append(unitSwitch);
      return h('div', { class: 'test-row', 'data-field': test.id },
        label,
        h('span', { class: 'test-side-label' }, injuredLabel('L')), left,
        h('span', { class: 'test-side-label' }, injuredLabel('R')), right,
        h('div', { class: 'test-result-wrap' }, result, perKgLine),
        error,
      );
    }

    if (test.type === 'single') {
      return h('div', { class: 'test-row test-row-single', 'data-field': test.id },
        label,
        h('input', {
          class: 'input input-number',
          name: `${test.id}.value`,
          inputmode: 'decimal',
          autocomplete: 'off',
          value: toInputValue(m.value),
          'aria-label': test.label,
        }),
        error,
      );
    }

    // choice
    return h('fieldset', { class: 'test-row test-row-choice', 'data-field': test.id },
      h('legend', { class: 'visually-hidden' }, test.label),
      label,
      h('div', { class: 'segmented' },
        [{ value: '', label: 'Niet gemeten' }, ...test.options].map((option) => h('label', { class: 'segment' },
          h('input', { type: 'radio', name: `${test.id}.value`, value: option.value, checked: (m.value ?? '') === option.value }),
          h('span', {}, option.label),
        ))),
      error,
    );
  }

  function readForm() {
    const data = new FormData(form);
    const entries = {};
    for (const [name, value] of data.entries()) {
      const [testId, part] = name.split('.');
      if (!part) continue;
      entries[testId] = { ...entries[testId], [part]: value };
    }
    return { date: data.get('date'), note: data.get('note'), entries };
  }

  async function onSubmit(event) {
    event.preventDefault();
    const { session, errors } = buildSession(readForm(), { protocol, patient, today });
    showErrors(errors);
    if (Object.keys(errors).length) return;

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await saveTestSession({ ...session, id: existing?.id }, { patientCode: code, protocolVersion: protocol.version });
      showToast('Testmoment opgeslagen.');
      navigate(detailHref);
    } catch (error) {
      console.error(error);
      form.querySelector('[data-form-error]').textContent = error.message;
      submit.disabled = false;
    }
  }

  function showErrors(errors) {
    for (const container of form.querySelectorAll('[data-field]')) {
      const message = errors[container.dataset.field] ?? '';
      container.querySelector('.field-error').textContent = message;
      container.classList.toggle('has-error', Boolean(message));
    }
    const count = Object.keys(errors).filter((key) => key !== 'form').length;
    form.querySelector('[data-form-error]').textContent = errors.form
      ?? (count ? 'Niet alles is correct ingevuld. Kijk de rode velden na.' : '');
    const first = form.querySelector('.has-error input');
    if (first) {
      first.focus();
      first.scrollIntoView({ block: 'center' });
    }
  }

  async function onDelete() {
    const confirmed = await confirmDialog({
      title: 'Testmoment verwijderen?',
      message: 'Alle metingen van dit testmoment worden definitief gewist. Dit kan niet ongedaan gemaakt worden.',
      confirmLabel: 'Definitief verwijderen',
      danger: true,
    });
    if (!confirmed) return;
    await deleteTestSession(existing.id);
    showToast('Testmoment verwijderd.');
    navigate(detailHref);
  }

  return h('section', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, existing ? 'Testmoment bewerken' : 'Nieuw testmoment'),
        h('p', { class: 'muted page-subtitle' }, `${patient.code}, ${protocol.name}, aangedane zijde ${sideName(patient.side).toLowerCase()}`),
      ),
    ),
    form,
  );
}
