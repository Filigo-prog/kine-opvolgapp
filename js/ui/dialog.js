// Modale vensters op basis van het native <dialog>-element.

import { h } from './dom.js';

function openDialog(build) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog' });
    let settled = false;
    // Rechtstreeks afronden: het 'close'-event komt niet altijd betrouwbaar (bv. in een achtergrondvenster).
    const close = (value) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.append(build(close));
    // Escape-toets of sluiten door de browser = annuleren.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(null);
    });
    dialog.addEventListener('close', () => close(null));
    document.body.append(dialog);
    dialog.showModal();
  });
}

export async function confirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Annuleren', danger = false }) {
  const result = await openDialog((close) => h('div', {},
    h('h2', {}, title),
    message ? h('p', {}, message) : null,
    h('div', { class: 'dialog-actions' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => close(false) }, cancelLabel),
      h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => close(true) }, confirmLabel),
    ),
  ));
  return result === true;
}

const PIN_PATTERN = /^\d{4,8}$/;

function pinInput(id, label) {
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('input', {
      id,
      class: 'input input-pin',
      type: 'password',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      autocomplete: 'off',
      maxlength: 8,
      required: true,
    }),
  );
}

/**
 * Vraagt een pincode. Geeft de pincode terug, of null bij annuleren.
 * repeat: laat de pincode twee keer ingeven (bij instellen).
 * validate(pin): async, geeft een foutboodschap terug of null; bij een fout blijft het venster open.
 */
export function pinDialog({ title, message, confirmLabel = 'OK', repeat = false, validate = null }) {
  return openDialog((close) => {
    const error = h('p', { class: 'dialog-error', role: 'alert' });
    const first = pinInput('pin-1', repeat ? 'Nieuwe pincode (4 tot 8 cijfers)' : 'Pincode');
    const second = repeat ? pinInput('pin-2', 'Herhaal de pincode') : null;
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, confirmLabel);

    const form = h('form', {
      method: 'dialog',
      onsubmit: async (event) => {
        event.preventDefault();
        const pin = first.querySelector('input').value.trim();
        error.textContent = '';
        if (!PIN_PATTERN.test(pin)) {
          error.textContent = 'Een pincode bestaat uit 4 tot 8 cijfers.';
          return;
        }
        if (second && second.querySelector('input').value.trim() !== pin) {
          error.textContent = 'De twee pincodes zijn niet gelijk.';
          return;
        }
        submit.disabled = true;
        const problem = validate ? await validate(pin) : null;
        submit.disabled = false;
        if (problem) {
          error.textContent = problem;
          for (const input of form.querySelectorAll('input')) input.value = '';
          first.querySelector('input').focus();
          return;
        }
        close(pin);
      },
    },
      h('h2', {}, title),
      message ? h('p', {}, message) : null,
      first,
      second,
      error,
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => close(null) }, 'Annuleren'),
        submit,
      ),
    );
    return form;
  });
}
