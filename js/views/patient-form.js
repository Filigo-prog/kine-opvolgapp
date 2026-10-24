import { todayIso } from '../domain/dates.js';
import { normalizePatient, suggestCode, validatePatient } from '../domain/patient.js';
import { loadAllProtocols } from '../domain/protocol.js';
import { createPatient, listPatients, updatePatient } from '../repo/patients.js';
import { navigate } from '../router.js';
import { h, showToast } from '../ui/dom.js';
import { notFound } from '../ui/not-found.js';

/** Nieuwe patiënt (geen code) of bestaande patiënt bewerken (met code). */
export async function patientFormView({ code } = {}) {
  const [protocols, patients] = await Promise.all([loadAllProtocols(), listPatients()]);
  const existing = code ? patients.find((p) => p.code === code) : null;
  if (code && !existing) return notFound('Patiënt niet gevonden', `Er is geen patiënt met code ${code}.`);

  const isNew = !existing;
  const existingCodes = patients.map((p) => p.code);
  const today = todayIso();
  let injury = existing?.injury ?? 'vkb';
  let codeTouched = false;

  const values = existing ?? {};
  const injurySection = h('div');
  const sportLevelSlot = h('div');
  const codeInput = h('input', {
    id: 'f-code',
    name: 'code',
    class: 'input input-code',
    value: existing?.code ?? suggestCode(protocols[injury].codePrefix, existingCodes),
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: 'false',
    readonly: !isNew,
    oninput: () => { codeTouched = true; },
  });

  const renderInjurySection = () => {
    // Een al ingevulde datum niet verliezen bij het wisselen van letsel.
    const typedDate = injurySection.querySelector('[name="injuryDate"]')?.value;
    if (typedDate) values.injuryDate = typedDate;
    injurySection.replaceChildren(injuryFields(protocols[injury], values));
    sportLevelSlot.replaceChildren(sportLevelField(protocols[injury], values));
  };

  const form = h('form', { class: 'patient-form', novalidate: true, onsubmit: onSubmit },
    h('div', { class: 'card stack' },
      h('h2', {}, 'Identificatie'),
      field('code', 'Code', codeInput,
        isNew ? 'Gebruik nooit een naam. De koppeling met de naam staat enkel in je praktijksoftware.' : 'De code kan niet meer gewijzigd worden.'),
      isNew
        ? segmented('injury', 'Letsel', Object.values(protocols).map((p) => ({ value: p.id, label: p.name })), injury, (value) => {
          injury = value;
          if (!codeTouched) codeInput.value = suggestCode(protocols[injury].codePrefix, existingCodes);
          renderInjurySection();
        })
        : h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Letsel'), h('span', {}, protocols[injury].name)),
      segmented('side', 'Aangedane zijde', [{ value: 'L', label: 'Links' }, { value: 'R', label: 'Rechts' }], values.side),
    ),
    injurySection,
    h('div', { class: 'card stack' },
      h('h2', {}, 'Sport en doel'),
      h('div', { class: 'grid-2' },
        field('sport', 'Sport', h('input', { id: 'f-sport', name: 'sport', class: 'input', value: values.sport ?? '', placeholder: 'bv. voetbal' })),
        field('bodyWeightKg', 'Lichaamsgewicht (kg, optioneel)', h('input', {
          id: 'f-bodyWeightKg', name: 'bodyWeightKg', class: 'input', inputmode: 'decimal', value: values.bodyWeightKg == null ? '' : String(values.bodyWeightKg).replace('.', ','),
        }), 'Voor relatieve kracht (Nm/kg).'),
      ),
      sportLevelSlot,
      field('goal', 'Doel', h('input', {
        id: 'f-goal', name: 'goal', class: 'input', value: values.goal ?? '', placeholder: 'bv. terug naar voetbal in competitie',
      })),
    ),
    h('p', { class: 'form-error', role: 'alert', 'data-form-error': '' }),
    h('div', { class: 'form-actions' },
      h('a', { class: 'btn btn-secondary', href: isNew ? '#/patienten' : `#/patient/${encodeURIComponent(code)}` }, 'Annuleren'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, isNew ? 'Patiënt aanmaken' : 'Opslaan'),
    ),
  );

  renderInjurySection();

  async function onSubmit(event) {
    event.preventDefault();
    const data = new FormData(form);
    const raw = Object.fromEntries(data.entries());
    raw.associatedInjuries = data.getAll('associatedInjuries');
    raw.injury = injury;
    if (!isNew) raw.code = existing.code;

    const patient = normalizePatient(raw);
    const errors = validatePatient(patient, { protocol: protocols[injury], existingCodes, isNew, today });
    showErrors(form, errors);
    if (Object.keys(errors).length) return;

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      if (isNew) {
        await createPatient(patient, { protocolVersion: protocols[injury].version, today });
        showToast(`${patient.code} aangemaakt.`);
      } else {
        await updatePatient(existing.code, patient);
        showToast('Wijzigingen opgeslagen.');
      }
      navigate(`#/patient/${encodeURIComponent(patient.code)}`);
    } catch (error) {
      console.error(error);
      form.querySelector('[data-form-error]').textContent = error.message;
      submit.disabled = false;
    }
  }

  return h('section', {},
    h('div', { class: 'page-head' }, h('h1', {}, isNew ? 'Nieuwe patiënt' : `${existing.code} bewerken`)),
    form,
  );
}

function injuryFields(protocol, values) {
  const fields = protocol.patientFields;
  const selected = new Set(values.associatedInjuries ?? []);
  const sameInjury = values.injury === protocol.id;

  const graftOther = h('div', { class: 'graft-other' },
    field('graftOther', 'Welk transplantaat?', h('input', { id: 'f-graftOther', name: 'graftOther', class: 'input', value: values.graftOther ?? '' })));
  graftOther.hidden = values.graft !== 'andere';

  const section = h('div', { class: 'card stack' },
    h('h2', {}, protocol.name),
    field('injuryDate', protocol.dateLabel, h('input', {
      id: 'f-injuryDate', name: 'injuryDate', type: 'date', class: 'input', value: values.injuryDate ?? '', max: todayIso(),
    })),
    fields.graft
      ? segmented('graft', fields.graft.label, fields.graft.options, sameInjury ? values.graft : undefined, (value) => {
        graftOther.hidden = value !== 'andere';
      })
      : null,
    fields.graft ? graftOther : null,
    fields.associatedInjuries
      ? h('fieldset', { class: 'field', 'data-field': 'associatedInjuries' },
        h('legend', { class: 'field-label' }, fields.associatedInjuries.label),
        h('div', { class: 'checkbox-list' },
          fields.associatedInjuries.options.map((option) => h('label', { class: 'checkbox' },
            h('input', {
              type: 'checkbox',
              name: 'associatedInjuries',
              value: option.value,
              checked: sameInjury && selected.has(option.value),
            }),
            h('span', {}, option.label),
          ))),
        h('p', { class: 'field-error' }),
      )
      : null,
    field('associatedInjuriesOther', 'Andere (optioneel)', h('input', {
      id: 'f-associatedInjuriesOther', name: 'associatedInjuriesOther', class: 'input', value: sameInjury ? (values.associatedInjuriesOther ?? '') : '',
    })),
    fields.sportSupport
      ? segmented('sportSupport', fields.sportSupport.label,
        [{ value: '', label: 'Geen advies' }, ...fields.sportSupport.options], sameInjury ? (values.sportSupport ?? '') : '')
      : null,
  );
  return section;
}

function sportLevelField(protocol, values) {
  const config = protocol.patientFields.sportLevel;
  if (!config) return null;
  return field('sportLevel', config.label, h('select', { id: 'f-sportLevel', name: 'sportLevel', class: 'input' },
    h('option', { value: '' }, 'Kies…'),
    config.options.map((option) => h('option', { value: option.value, selected: values.sportLevel === option.value }, option.label))));
}

function field(name, label, control, hint) {
  return h('div', { class: 'field', 'data-field': name },
    h('label', { class: 'field-label', for: control.id }, label),
    control,
    hint ? h('p', { class: 'field-hint muted' }, hint) : null,
    h('p', { class: 'field-error' }),
  );
}

/** Grote aanraakvriendelijke keuzeknoppen (radio's). */
function segmented(name, label, options, selected, onChange) {
  return h('fieldset', { class: 'field', 'data-field': name },
    h('legend', { class: 'field-label' }, label),
    h('div', { class: 'segmented' },
      options.map((option) => h('label', { class: 'segment' },
        h('input', {
          type: 'radio',
          name,
          value: option.value,
          checked: option.value === selected,
          onchange: onChange ? () => onChange(option.value) : null,
        }),
        h('span', {}, option.label),
      ))),
    h('p', { class: 'field-error' }),
  );
}

function showErrors(form, errors) {
  for (const container of form.querySelectorAll('[data-field]')) {
    const message = errors[container.dataset.field] ?? '';
    container.querySelector('.field-error').textContent = message;
    container.classList.toggle('has-error', Boolean(message));
  }
  form.querySelector('[data-form-error]').textContent = Object.keys(errors).length
    ? 'Niet alles is correct ingevuld. Kijk de rode velden na.'
    : '';
  form.querySelector('.has-error input, .has-error select')?.focus();
}
