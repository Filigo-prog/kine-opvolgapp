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
  'Knie-tot-muur: een verschil onder de grens voldoet, op de grens niet, en verder komen telt ook': async () => {
    const protocol = await enkel();
    const limit = criterion(protocol, 'enk-2-wblt').threshold; // staat in het protocol (en in Excel aan te passen)
    const run = async (difference) => evaluateCriterion(criterion(protocol, 'enk-2-wblt'), {
      patient: right, today, sessions: await sessionWith(right, { wblt: { left: '20', right: String(20 - difference) } }),
    }).suggestion;
    equal(await run(limit - 0.5), SUGGESTION.MET);
    equal(await run(limit), SUGGESTION.NOT_MET); // 'verschil < grens': op de grens voldoet niet
    equal(await run(-3), SUGGESTION.MET); // aangedane zijde komt verder dan de gezonde
  },
  'Y-balance: een verschil onder de grens voldoet, op de grens niet': async () => {
    const protocol = await enkel();
    for (const id of ['enk-3-ybal', 'enk-4-ybal']) {
      const limit = criterion(protocol, id).threshold;
      const run = async (difference) => evaluateCriterion(criterion(protocol, id), {
        patient: right, today, sessions: await sessionWith(right, { 'ybal-ant': { left: '100', right: String(100 - difference) } }),
      }).suggestion;
      equal(await run(limit - 0.5), SUGGESTION.MET, id);
      equal(await run(limit), SUGGESTION.NOT_MET, id);
    }
  },
  'Evenwicht: telt de aangedane zijde, links of rechts': async () => {
    const protocol = await enkel();
    const limit = criterion(protocol, 'enk-2-sls').threshold;
    const left = { side: 'L', injuryDate: '2026-10-01' };
    const entries = { 'sls-open': { left: String(limit - 5), right: String(limit) } };
    const run = async (patient) => evaluateCriterion(criterion(protocol, 'enk-2-sls'), {
      patient, today, sessions: await sessionWith(patient, entries),
    }).suggestion;
    equal(await run(left), SUGGESTION.NOT_MET); // aangedaan links: onder de grens
    equal(await run(right), SUGGESTION.MET); // aangedaan rechts: op de grens
  },
  'Hoptests: beide tests moeten de grens halen': async () => {
    const protocol = await enkel();
    for (const id of ['enk-3-hop', 'enk-4-hop']) {
      const limit = criterion(protocol, id).threshold;
      const lsiEntries = (single, side) => ({
        'single-hop': { left: String(2 * single), right: '200' }, // aangedaan links: LSI = waarde ÷ 200 × 100
        'side-hop': { left: String(0.8 * side), right: '80' },
      });
      const patient = { side: 'L', injuryDate: '2026-10-01' };
      const run = async (single, side) => evaluateCriterion(criterion(protocol, id), {
        patient, today, sessions: await sessionWith(patient, lsiEntries(single, side)),
      }).suggestion;
      equal(await run(limit, limit), SUGGESTION.MET, `${id} precies op de grens`);
      equal(await run(limit - 1, limit), SUGGESTION.NOT_MET, `${id} één test eronder`);
      equal(await run(limit, limit - 1), SUGGESTION.NOT_MET, `${id} de andere test eronder`);
    }
  },
  'Vragenlijst CAIT: op de grens voldoet, eronder niet': async () => {
    const protocol = await enkel();
    const limit = criterion(protocol, 'enk-4-vragenlijst').threshold;
    const run = async (value) => evaluateCriterion(criterion(protocol, 'enk-4-vragenlijst'), {
      patient: right, today, sessions: await sessionWith(right, { cait: { value: String(value) } }),
    }).suggestion;
    equal(await run(limit), SUGGESTION.MET);
    equal(await run(limit - 1), SUGGESTION.NOT_MET);
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
