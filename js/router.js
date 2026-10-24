// Eenvoudige hash-router: #/patienten, #/patient/VKB-024, …
// Werkt zonder serverconfiguratie, dus ook op GitHub Pages.

import { clear, h } from './ui/dom.js';
import { isPatientMode } from './ui/mode.js';

let routes = [];
let fallback = '#/patienten';
let patientFallback = '#/start';

/**
 * route = { path: '/patient/:code', view: async (params) => Node, therapistOnly: true }
 */
export function startRouter(routeList, options = {}) {
  routes = routeList.map((route) => ({ ...route, ...compile(route.path) }));
  fallback = options.fallback ?? fallback;
  patientFallback = options.patientFallback ?? patientFallback;
  window.addEventListener('hashchange', render);
  return render();
}

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function compile(path) {
  const keys = [];
  const pattern = path.replace(/:([a-zA-Z]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { regex: new RegExp(`^${pattern}$`), keys };
}

function match(path) {
  for (const route of routes) {
    const result = route.regex.exec(path);
    if (result) {
      const params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(result[i + 1])]));
      return { route, params };
    }
  }
  return null;
}

let renderToken = 0;

export async function render() {
  const path = location.hash.replace(/^#/, '') || '/';
  const found = match(path);

  if (!found) {
    location.replace(isPatientMode() ? patientFallback : fallback);
    return;
  }
  if (found.route.therapistOnly && isPatientMode()) {
    location.replace(patientFallback);
    return;
  }

  const token = ++renderToken;
  const main = document.getElementById('app');
  let content;
  try {
    content = await found.route.view(found.params);
  } catch (error) {
    console.error(error);
    content = h('div', { class: 'notice notice-danger', role: 'alert' },
      'Er ging iets mis bij het laden van dit scherm. ', String(error?.message ?? error));
  }
  // Intussen al naar een ander scherm genavigeerd: dit resultaat negeren.
  if (token !== renderToken) return;

  clear(main);
  main.append(content);
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  markActiveNav(path);
}

function markActiveNav(path) {
  for (const link of document.querySelectorAll('.nav-link')) {
    const target = link.getAttribute('href').replace(/^#/, '');
    if (path === target || path.startsWith(`${target}/`)) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}
