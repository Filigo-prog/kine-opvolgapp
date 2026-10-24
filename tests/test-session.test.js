import { validateProtocol } from '../js/domain/protocol.js';
import { allTests, buildSession } from '../js/domain/test-session.js';
import { equal, ok } from './assert.js';

const protocol = {
  testGroups: [{
    id: 'g',
    label: 'Groep',
    tests: [
      { id: 'quad', label: 'Quadriceps', type: 'bilateral', unit: 'Nm', compare: 'lsi', min: 0, max: 1000, decimals: 0 },
      { id: 'nprs', label: 'NPRS', type: 'single', unit: '/10', min: 0, max: 10, decimals: 0 },
      { id: 'stroke', label: 'Stroke test', type: 'choice', options: [{ value: '0' }, { value: 'spoor' }] },
    ],
  }],
};
const patient = { side: 'L' };
const context = { protocol, patient, today: '2026-10-24' };

export const tests = {
  'Een volledig testmoment wordt correct opgebouwd': () => {
    const { session, errors } = buildSession({
      date: '2026-10-20',
      note: ' na 12 weken ',
      entries: { quad: { left: '145', right: '179' }, nprs: { value: '2' }, stroke: { value: 'spoor' } },
    }, context);
    equal(errors, {});
    equal(session, {
      date: '2026-10-20',
      note: 'na 12 weken',
      measurements: {
        quad: { left: 145, right: 179, lsi: 81, difference: null },
        nprs: { value: 2 },
        stroke: { value: 'spoor' },
      },
    });
  },
  'Lege tests worden overgeslagen': () => {
    const { session, errors } = buildSession({
      date: '2026-10-20', entries: { quad: { left: '', right: '' }, nprs: { value: '3' }, stroke: { value: '' } },
    }, context);
    equal(errors, {});
    equal(Object.keys(session.measurements), ['nprs']);
  },
  'Eén zijde ingevuld geeft een fout': () => {
    const { errors } = buildSession({ date: '2026-10-20', entries: { quad: { left: '145', right: '' } } }, context);
    equal(errors.quad, 'Vul beide zijden in.');
  },
  'Waarde buiten bereik of geen getal geeft een fout': () => {
    ok(buildSession({ date: '2026-10-20', entries: { nprs: { value: '11' } } }, context).errors.nprs, 'te hoog');
    ok(buildSession({ date: '2026-10-20', entries: { quad: { left: 'abc', right: '10' } } }, context).errors.quad, 'tekst');
  },
  'Leeg testmoment en datum in de toekomst worden geweigerd': () => {
    ok(buildSession({ date: '2026-10-20', entries: {} }, context).errors.form, 'leeg');
    ok(buildSession({ date: '2026-11-01', entries: { nprs: { value: '1' } } }, context).errors.date, 'toekomst');
  },
  'De echte protocolbestanden zijn geldig': async () => {
    for (const id of ['vkb', 'enkel']) {
      const protocol = await (await fetch(`../data/protocol-${id}.json`)).json();
      validateProtocol(protocol, id);
      ok(allTests(protocol).length > 0, `${id} heeft tests`);
    }
  },
  'validateProtocol weigert een onbekend vergelijkingstype': () => {
    const broken = {
      id: 'vkb', version: '1', name: 'x', codePrefix: 'VKB', dateLabel: 'd', sinceLabel: 's', patientFields: {},
      testGroups: [{ tests: [{ id: 't', label: 'T', type: 'bilateral', compare: 'ratio', min: 0, max: 1 }] }],
    };
    let failed = false;
    try { validateProtocol(broken, 'vkb'); } catch { failed = true; }
    ok(failed, 'moet falen');
  },
};
