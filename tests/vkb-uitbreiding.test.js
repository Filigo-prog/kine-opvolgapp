// Criteria die uit het ACL-hulpmiddel (Phase Gates) aan het VKB-protocol zijn toegevoegd.
// De grenzen komen uit het protocol, zodat deze tests blijven kloppen als een grens in Excel verandert.

import { SUGGESTION, evaluateCriterion } from '../js/domain/criteria.js';
import { validateProtocol } from '../js/domain/protocol.js';
import { buildSession } from '../js/domain/test-session.js';
import { equal, ok } from './assert.js';

let cached = null;
async function vkb() {
  cached ??= validateProtocol(await (await fetch('../data/protocol-vkb.json')).json(), 'vkb');
  return cached;
}

const today = '2026-10-24';
const links = { side: 'L', injuryDate: '2026-07-15' }; // aangedaan links
const rechts = { side: 'R', injuryDate: '2026-07-15' };
const criterion = (protocol, id) => protocol.levels.flatMap((l) => l.criteria).find((c) => c.id === id);
const levelOf = (protocol, id) => protocol.levels.find((l) => l.criteria.some((c) => c.id === id)).number;

async function suggestion(id, patient, entries) {
  const protocol = await vkb();
  const { session, errors } = buildSession({ date: '2026-10-20', entries }, { protocol, patient, today });
  equal(errors, {}, `invoer voor ${id}`);
  return evaluateCriterion(criterion(protocol, id), { patient, today, sessions: [session] }).suggestion;
}

const NEW = {
  'vkb-2-ham': [2, 'measurement'], 'vkb-2-flexie': [2, 'measurement'], 'vkb-2-loopgang': [2, 'judgement'],
  'vkb-3-snelheid': [3, 'measurement'], 'vkb-3-coord': [3, 'measurement'], 'vkb-3-aeroob': [3, 'judgement'],
  'vkb-4-vhop': [4, 'measurement'], 'vkb-4-loopsnelheid': [4, 'judgement'], 'vkb-4-excentrisch': [4, 'judgement'],
};

export const tests = {
  'Nieuwe criteria staan in het juiste level met het juiste type': async () => {
    const protocol = await vkb();
    for (const [id, [level, type]] of Object.entries(NEW)) {
      equal(levelOf(protocol, id), level, `${id}: level`);
      equal(criterion(protocol, id).type, type, `${id}: type`);
      ok(criterion(protocol, id).patientLabel, `${id}: tekst voor de patiënt`);
    }
  },
  'Het bestaande hoptest-criterium blijft ongewijzigd (vertical hop is een apart criterium)': async () => {
    const protocol = await vkb();
    const four = ['single-hop', 'triple-hop', 'crossover-hop', 'timed-hop'];
    equal(criterion(protocol, 'vkb-3-hop').tests, four);
    equal(criterion(protocol, 'vkb-4-hop').tests, four);
    equal(criterion(protocol, 'vkb-4-vhop').test, 'vertical-hop');
  },
  'Hamstring-LSI in level 2: op de grens voldoet, eronder niet, in Nm en in N': async () => {
    const protocol = await vkb();
    const limit = criterion(protocol, 'vkb-2-ham').threshold;
    const nm = (lsi) => ({ 'ham-iso': { left: String(lsi * 2), right: '200' } }); // aangedaan links
    const newton = (lsi) => ({ 'ham-iso': { left: String(lsi * 20), right: '2000', unit: 'N' } });
    equal(await suggestion('vkb-2-ham', links, nm(limit)), SUGGESTION.MET);
    equal(await suggestion('vkb-2-ham', links, nm(limit - 1)), SUGGESTION.NOT_MET);
    equal(await suggestion('vkb-2-ham', links, newton(limit)), SUGGESTION.MET, 'de eenheid verandert de LSI niet');
    equal(await suggestion('vkb-2-ham', links, newton(limit - 1)), SUGGESTION.NOT_MET);
    equal(await suggestion('vkb-2-ham', rechts, { 'ham-iso': { left: '200', right: String(limit * 2) } }), SUGGESTION.MET, 'aangedaan rechts');
  },
  'Flexiedeficit: tot en met de grens voldoet, verder niet; verder plooien dan de andere knie telt ook': async () => {
    const protocol = await vkb();
    const limit = criterion(protocol, 'vkb-2-flexie').threshold;
    const run = (deficit) => suggestion('vkb-2-flexie', links, { flexie: { left: String(150 - deficit), right: '150' } });
    equal(await run(limit), SUGGESTION.MET);
    equal(await run(limit + 1), SUGGESTION.NOT_MET);
    equal(await run(0), SUGGESTION.MET);
    equal(await run(-5), SUGGESTION.MET);
  },
  'Loopsnelheid en coördinatie in % van het maximum': async () => {
    const protocol = await vkb();
    for (const [id, test] of [['vkb-3-snelheid', 'run-speed-pct'], ['vkb-3-coord', 'coord-pct']]) {
      const limit = criterion(protocol, id).threshold;
      equal(await suggestion(id, links, { [test]: { value: String(limit) } }), SUGGESTION.MET, `${id} op de grens`);
      equal(await suggestion(id, links, { [test]: { value: String(limit - 1) } }), SUGGESTION.NOT_MET, `${id} eronder`);
    }
  },
  'Vertical hop: LSI op de grens voldoet, eronder niet (beide zijden, met decimalen)': async () => {
    const protocol = await vkb();
    const limit = criterion(protocol, 'vkb-4-vhop').threshold;
    const entries = (injured, healthy, side) => ({ 'vertical-hop': side === 'L' ? { left: injured, right: healthy } : { left: healthy, right: injured } });
    equal(await suggestion('vkb-4-vhop', links, entries(String((limit / 100) * 40), '40', 'L')), SUGGESTION.MET);
    equal(await suggestion('vkb-4-vhop', links, entries(String(((limit - 1) / 100) * 40), '40', 'L')), SUGGESTION.NOT_MET);
    equal(await suggestion('vkb-4-vhop', rechts, entries(String((limit / 100) * 40), '40', 'R')), SUGGESTION.MET);
    // decimalen met een komma: één procentpunt onder de grens voldoet niet, op de grens wel
    const comma = (lsi) => ((lsi / 100) * 40.5).toFixed(2).replace('.', ',');
    equal(await suggestion('vkb-4-vhop', links, entries(comma(limit - 1), '40,5', 'L')), SUGGESTION.NOT_MET, 'komma, eronder');
    equal(await suggestion('vkb-4-vhop', links, entries(comma(limit + 1), '40,5', 'L')), SUGGESTION.MET, 'komma, erboven');
  },
  'Zonder meting krijgt een nieuw meetcriterium geen "lijkt voldaan"': async () => {
    const protocol = await vkb();
    for (const id of ['vkb-2-ham', 'vkb-2-flexie', 'vkb-3-snelheid', 'vkb-3-coord', 'vkb-4-vhop']) {
      equal(evaluateCriterion(criterion(protocol, id), { patient: links, today, sessions: [] }).suggestion, SUGGESTION.NO_DATA, id);
    }
  },
  'Criteria die enkel jouw oordeel vragen krijgen geen suggestie': async () => {
    const protocol = await vkb();
    for (const id of ['vkb-2-loopgang', 'vkb-3-aeroob', 'vkb-4-loopsnelheid', 'vkb-4-excentrisch']) {
      equal(evaluateCriterion(criterion(protocol, id), { patient: links, today, sessions: [] }).suggestion, SUGGESTION.JUDGEMENT, id);
    }
  },
  'Nieuwe tests: bereik en eenheid': async () => {
    const protocol = await vkb();
    const build = (entries) => buildSession({ date: '2026-10-20', entries }, { protocol, patient: links, today });
    equal(build({ 'run-speed-pct': { value: '100' } }).errors, {});
    ok(build({ 'run-speed-pct': { value: '101' } }).errors['run-speed-pct'], 'meer dan 100 %');
    ok(build({ 'coord-pct': { value: '-1' } }).errors['coord-pct'], 'negatief');
    equal(build({ 'vertical-hop': { left: '40,5', right: '42' } }).session.measurements['vertical-hop'].lsi, 96.4);
    ok(build({ 'vertical-hop': { left: '40', right: '' } }).errors['vertical-hop'], 'beide zijden nodig');
  },
  'De vertical hop heeft een doelzone en patiënttekst voor de grafiek': async () => {
    const protocol = await vkb();
    const test = protocol.testGroups.flatMap((g) => g.tests).find((t) => t.id === 'vertical-hop');
    ok(test.target > 0 && test.patientLabel && test.patientPhrase, 'target, patientLabel en patientPhrase');
  },
};
