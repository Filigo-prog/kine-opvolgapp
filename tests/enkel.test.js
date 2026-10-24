import { SUGGESTION, evaluateCriterion } from '../js/domain/criteria.js';
import { earnedMilestones } from '../js/domain/milestones.js';
import { validateProtocol } from '../js/domain/protocol.js';
import { buildSession } from '../js/domain/test-session.js';
import { equal, ok } from './assert.js';

let cached = null;
async function enkel() {
  cached ??= validateProtocol(await (await fetch('../data/protocol-enkel.json')).json(), 'enkel');
  return cached;
}

const criterion = (protocol, id) => protocol.levels.flatMap((l) => l.criteria).find((c) => c.id === id);
const today = '2026-10-24';
const right = { side: 'R', injuryDate: '2026-10-01' };

// Meting opbouwen via dezelfde logica als het formulier, zodat LSI en verschil kloppen.
async function sessionWith(patient, entries) {
  const protocol = await enkel();
  const { session, errors } = buildSession({ date: '2026-10-20', entries }, { protocol, patient, today });
  equal(errors, {});
  return [session];
}

export const tests = {
  'Enkelprotocol: 4 levels, 18 criteria, geldig volgens de validatie': async () => {
    const protocol = await enkel();
    equal(protocol.levels.map((l) => l.number), [1, 2, 3, 4]);
    equal(protocol.levels.reduce((n, l) => n + l.criteria.length, 0), 18);
  },
  'Enkelprotocol: elk level en criterium heeft patiënttekst': async () => {
    const protocol = await enkel();
    ok(protocol.levels.every((l) => l.patientGoal && l.patientFocus?.length), 'patientGoal en patientFocus per level');
    ok(protocol.levels.flatMap((l) => l.criteria).every((c) => c.patientLabel), 'patientLabel per criterium');
    ok(protocol.completion.title && protocol.completion.releaseLabel, 'afronding');
  },
  'Enkelprotocol: criteria die enkel jouw oordeel vragen krijgen geen automatische suggestie': async () => {
    const protocol = await enkel();
    for (const id of ['enk-1-ottawa', 'enk-1-belasten', 'enk-1-zwelling', 'enk-2-gang', 'enk-3-givingway', 'enk-4-drills', 'enk-4-beslissing']) {
      equal(evaluateCriterion(criterion(protocol, id), { patient: right, today, sessions: [] }).suggestion, SUGGESTION.JUDGEMENT, id);
    }
  },
  'Knie-tot-muur: verschil < 2 cm (aangedaan rechts), ook als de aangedane zijde verder komt': async () => {
    const protocol = await enkel();
    const run = async (left, rightValue) => evaluateCriterion(criterion(protocol, 'enk-2-wblt'), {
      patient: right, today, sessions: await sessionWith(right, { wblt: { left: String(left), right: String(rightValue) } }),
    }).suggestion;
    equal(await run(10, 9), SUGGESTION.MET); // verschil 1 cm
    equal(await run(10, 8), SUGGESTION.NOT_MET); // verschil 2 cm = niet < 2
    equal(await run(10, 12), SUGGESTION.MET); // aangedane zijde komt verder
  },
  'Y-balance: verschil < 4 cm': async () => {
    const protocol = await enkel();
    const run = async (healthy, injured) => evaluateCriterion(criterion(protocol, 'enk-3-ybal'), {
      patient: right, today, sessions: await sessionWith(right, { 'ybal-ant': { left: String(healthy), right: String(injured) } }),
    }).suggestion;
    equal(await run('60', '56,5'), SUGGESTION.MET);
    equal(await run('60', '56'), SUGGESTION.NOT_MET);
  },
  'Evenwicht 30 s: telt de aangedane zijde, links of rechts': async () => {
    const protocol = await enkel();
    const left = { side: 'L', injuryDate: '2026-10-01' };
    const entries = { 'sls-open': { left: '25', right: '30' } };
    const run = async (patient) => evaluateCriterion(criterion(protocol, 'enk-2-sls'), {
      patient, today, sessions: await sessionWith(patient, entries),
    }).suggestion;
    equal(await run(left), SUGGESTION.NOT_MET);
    equal(await run(right), SUGGESTION.MET);
  },
  'Hoptests: beide tests moeten de grens halen (85 % en 90 %)': async () => {
    const protocol = await enkel();
    const entries = { 'single-hop': { left: '180', right: '200' }, 'side-hop': { left: '40', right: '40' } };
    const sessions = await sessionWith({ side: 'L' }, entries); // 90 % en 100 %
    const ctx = { patient: { side: 'L', injuryDate: '2026-10-01' }, today, sessions };
    equal(evaluateCriterion(criterion(protocol, 'enk-3-hop'), ctx).suggestion, SUGGESTION.MET);
    equal(evaluateCriterion(criterion(protocol, 'enk-4-hop'), ctx).suggestion, SUGGESTION.MET);
    const weaker = await sessionWith({ side: 'L' }, { 'single-hop': { left: '170', right: '200' }, 'side-hop': { left: '40', right: '40' } }); // 85 %
    const ctx2 = { ...ctx, sessions: weaker };
    equal(evaluateCriterion(criterion(protocol, 'enk-3-hop'), ctx2).suggestion, SUGGESTION.MET);
    equal(evaluateCriterion(criterion(protocol, 'enk-4-hop'), ctx2).suggestion, SUGGESTION.NOT_MET);
  },
  'Vragenlijst CAIT ≥ 25': async () => {
    const protocol = await enkel();
    const run = async (value) => evaluateCriterion(criterion(protocol, 'enk-4-vragenlijst'), {
      patient: right, today, sessions: await sessionWith(right, { cait: { value: String(value) } }),
    }).suggestion;
    equal(await run(25), SUGGESTION.MET);
    equal(await run(24), SUGGESTION.NOT_MET);
  },
  'Enkelmijlpalen: criteria, handmatig en groen licht': async () => {
    const protocol = await enkel();
    const statuses = new Map([['enk-2-gang', { status: 'voldaan', date: '2026-10-10' }]]);
    const history = [{ level: 1, date: '2026-10-01' }, { level: 2, date: '2026-10-08' }];
    const manual = new Map([['enk-hop', { date: '2026-10-22' }]]);
    equal(earnedMilestones({ protocol, sessions: [], statuses, history, manual }).map((e) => e.id), ['enk-stappen', 'enk-hop']);
    const done = [...history, { level: 3, date: '2026-10-15' }, { level: 4, date: '2026-10-20' }, { level: 5, date: '2026-10-24' }];
    ok(earnedMilestones({ protocol, sessions: [], statuses, history: done, manual }).some((e) => e.id === 'enk-groenlicht'), 'groen licht na level 4');
  },
};
