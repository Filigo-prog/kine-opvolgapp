import { h } from './dom.js';

export function notFound(title, message) {
  return h('div', { class: 'card empty-state' },
    h('h1', {}, title),
    h('p', { class: 'muted' }, message),
    h('a', { class: 'btn btn-secondary', href: '#/patienten' }, 'Naar de patiëntenlijst'),
  );
}
