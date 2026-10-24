import { STATUS } from '../js/domain/criteria.js';
import { lsiFeedback, lsiSeries, progressFeedback } from '../js/domain/feedback.js';
import { earnedMilestones, milestoneOverview } from '../js/domain/milestones.js';
import { validateProtocol } from '../js/domain/protocol.js';
import { equal, ok } from './assert.js';

const protocol = {
  levels: [{}, {}],
  milestones: [
    { id: 'm-crit', label: 'Gestrekt', trigger: { type: 'criterion', criterion: 'c1' } },
    { id: 'm-lsi', label: 'Kracht 80', trigger: { type: 'lsi', test: 'quad', threshold: 80 } },
    { id: 'm-man', label: 'Eerste loopsessie', trigger: { type: 'manual' } },
    { id: 'm-end', label: 'Groen licht', trigger: { type: 'completion' } },
  ],
};
const base = { protocol, sessions: [], statuses: new Map(), history: [{ level: 1, date: '2026-08-01' }], manual: new Map() };
const ids = (data) => earnedMilestones(data).map((e) => e.id);

const quadTest = { id: 'quad', label: 'Quadriceps', patientLabel: 'Kracht van je dijspier', patientPhrase: 'kracht van je dijspier' };
const sessions = (...lsis) => lsis.map((lsi, i) => ({ date: `2026-09-0${i + 1}`, measurements: { quad: { lsi, left: 1, right: 2 } } }));

export const tests = {
  'Zonder gegevens is er niets behaald': () => {
    equal(ids(base), []);
  },
  'Criterium-mijlpaal: enkel als de therapeut het afvinkte als voldaan': () => {
    const met = new Map([['c1', { status: STATUS.MET, date: '2026-09-10' }]]);
    equal(earnedMilestones({ ...base, statuses: met }), [{ id: 'm-crit', date: '2026-09-10' }]);
    const nvt = new Map([['c1', { status: STATUS.NOT_APPLICABLE, date: '2026-09-10' }]]);
    equal(ids({ ...base, statuses: nvt }), []);
  },
  'LSI-mijlpaal: datum van de eerste meting die de grens haalt (ook als de reeks niet gesorteerd is)': () => {
    const unsorted = [...sessions(70, 82, 91)].reverse();
    equal(earnedMilestones({ ...base, sessions: unsorted }), [{ id: 'm-lsi', date: '2026-09-02' }]);
    equal(ids({ ...base, sessions: sessions(70, 79.9) }), []);
  },
  'Handmatige mijlpaal: enkel als de therapeut hem registreerde': () => {
    const manual = new Map([['m-man', { date: '2026-09-05' }]]);
    equal(earnedMilestones({ ...base, manual }), [{ id: 'm-man', date: '2026-09-05' }]);
  },
  'Groen licht pas na de bevestiging van het laatste level': () => {
    equal(ids({ ...base, history: [{ level: 1, date: 'a' }, { level: 2, date: 'b' }] }), []);
    const done = [{ level: 1, date: '2026-08-01' }, { level: 2, date: '2026-09-01' }, { level: 3, date: '2026-10-01' }];
    equal(earnedMilestones({ ...base, history: done }), [{ id: 'm-end', date: '2026-10-01' }]);
  },
  'milestoneOverview toont alle mijlpalen, ook de onbehaalde': () => {
    const overview = milestoneOverview(protocol, new Map([['m-crit', '2026-09-10']]));
    equal(overview.map((o) => o.date), ['2026-09-10', null, null, null]);
  },
  'lsiSeries: oudste eerst en enkel metingen met een LSI': () => {
    const mixed = [
      { date: '2026-09-03', measurements: { quad: { lsi: 85 } } },
      { date: '2026-09-01', measurements: { quad: { lsi: 70 } } },
      { date: '2026-09-02', measurements: { other: { lsi: 50 } } },
    ];
    equal(lsiSeries(mixed, 'quad').map((p) => p.lsi), [70, 85]);
  },
  'Feedback: stijging noemt beide waarden, specifiek en positief': () => {
    equal(lsiFeedback(quadTest, lsiSeries(sessions(72, 81), 'quad')), 'Je kracht van je dijspier ging van 72 % naar 81 %.');
  },
  'Feedback: eerste meting, stabiel en daling zijn vriendelijk en zonder druk': () => {
    equal(lsiFeedback(quadTest, lsiSeries(sessions(72), 'quad')), 'Eerste meting: je kracht van je dijspier staat op 72 %.');
    equal(lsiFeedback(quadTest, lsiSeries(sessions(80, 80), 'quad')), 'Je kracht van je dijspier blijft stabiel op 80 %.');
    const down = lsiFeedback(quadTest, lsiSeries(sessions(80, 76), 'quad'));
    ok(down.includes('76 %'), down);
    ok(!/achter|trager|langzamer|slechter|sneller|gemiddeld/i.test(down), `geen druk of vergelijking: ${down}`);
    equal(lsiFeedback(quadTest, []), null);
  },
  'Feedback: in de doelzone wordt dat positief benoemd, ook bij een lichte daling': () => {
    equal(lsiFeedback(quadTest, lsiSeries(sessions(80, 92), 'quad')), 'Je kracht van je dijspier ging van 80 % naar 92 %. Je zit in de doelzone.');
    equal(lsiFeedback(quadTest, lsiSeries(sessions(95, 92), 'quad')), 'Je kracht van je dijspier staat op 92 %. Je zit in de doelzone.');
    equal(lsiFeedback(quadTest, lsiSeries(sessions(95), 'quad')), 'Eerste meting: je kracht van je dijspier staat op 95 %. Je zit in de doelzone.');
    const custom = { ...quadTest, target: 80 };
    equal(lsiFeedback(custom, lsiSeries(sessions(70, 82), 'quad')), 'Je kracht van je dijspier ging van 70 % naar 82 %. Je zit in de doelzone.');
  },
  'Voortgangszin: nooit drukkend': () => {
    equal(progressFeedback({ met: 0, total: 6 }), 'Je start dit level. Stap voor stap kom je er.');
    equal(progressFeedback({ met: 4, total: 6 }), 'Je hebt al 4 van de 6 stappen behaald. Nog 2 te gaan.');
    ok(progressFeedback({ met: 6, total: 6 }).includes('Alle stappen'), 'alles behaald');
  },
  'Protocol: mijlpalen verwijzen naar bestaande criteria en tests': async () => {
    const vkb = validateProtocol(await (await fetch('../data/protocol-vkb.json')).json(), 'vkb');
    ok(vkb.milestones.length >= 10, 'mijlpalen aanwezig');
    ok(vkb.milestones.some((m) => m.trigger.type === 'level'), 'mijlpalen per afgerond level');
  },
  'Protocol: onbekend criterium in een mijlpaal wordt geweigerd': async () => {
    const vkb = await (await fetch('../data/protocol-vkb.json')).json();
    vkb.milestones[0].trigger.criterion = 'bestaat-niet';
    let message = '';
    try { validateProtocol(vkb, 'vkb'); } catch (error) { message = error.message; }
    ok(message.includes('bestaat niet'), message);
  },
  'Protocol: elk criterium en elke LSI-test heeft patiënttekst en een doelzone': async () => {
    const vkb = await (await fetch('../data/protocol-vkb.json')).json();
    const criteria = vkb.levels.flatMap((l) => l.criteria);
    ok(vkb.levels.every((l) => l.patientGoal && l.criteria.some((c) => c.patientLabel)), 'elk level heeft een doel en patiëntstappen');
    ok(criteria.some((c) => c.patientLabel), 'patientLabel bij criteria');
    const lsiTests = vkb.testGroups.flatMap((g) => g.tests).filter((t) => t.type === 'bilateral' && ['lsi', 'lsi-inverse'].includes(t.compare));
    ok(lsiTests.every((t) => t.patientLabel && t.patientPhrase && t.target), 'patientLabel, patientPhrase en target');
  },
};
