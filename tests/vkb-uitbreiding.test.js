// VKB-protocol met negen poorten (levels), uit het Claude Doc "VKB-revalidatie — criteriumgestuurde poorten".
// De grenzen komen uit het protocol, zodat deze tests blijven kloppen als een grens in Excel verandert.

import { SUGGESTION, evaluateCriterion } from '../js/domain/criteria.js';
import { baselineProblems } from '../js/domain/patient.js';
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
const all = (protocol) => protocol.levels.flatMap((l) => l.criteria);
const criterion = (protocol, id) => all(protocol).find((c) => c.id === id);

function evaluate(protocol, id, patient, entries) {
  const sessions = [];
  if (entries) {
    const { session, errors } = buildSession({ date: '2026-10-20', entries }, { protocol, patient, today });
    equal(errors, {}, `invoer voor ${id}`);
    sessions.push(session);
  }
  return evaluateCriterion(criterion(protocol, id), { patient, today, sessions, protocol });
}

export const tests = {
  'Negen poorten, elk met titel, korte titel, doel en criteria': async () => {
    const protocol = await vkb();
    equal(protocol.levels.length, 9);
    for (const level of protocol.levels) {
      ok(level.title && level.shortTitle && level.patientGoal && level.focus, `level ${level.number}: teksten`);
      ok(level.criteria.length > 0, `level ${level.number}: criteria`);
    }
  },
  'Elk criterium heeft evidentieniveau en een advies voor als het niet gehaald wordt': async () => {
    const protocol = await vkb();
    for (const c of all(protocol)) {
      ok(c.evidence, `${c.id}: evidentieniveau`);
      ok(c.ifNotMet, `${c.id}: bij niet halen`);
    }
  },
  'Biologische ondergrens per poort loopt op (poort 1 heeft er geen)': async () => {
    const protocol = await vkb();
    const weeks = (c) => (c.months ? c.months * 4.345 : c.weeks);
    const floors = protocol.levels.map((l) => l.criteria.find((c) => c.type === 'minTime')).map((c) => (c ? weeks(c) : 0));
    equal(floors[0], 0);
    for (let i = 1; i < floors.length; i += 1) ok(floors[i] >= floors[i - 1], `poort ${i + 1} niet vroeger dan poort ${i}`);
  },
  'De quadricepsgrenzen (LSI en baseline) stijgen of blijven gelijk van poort 3 tot 8': async () => {
    const protocol = await vkb();
    for (const kind of ['quad', 'quad-base']) {
      const limits = [3, 4, 5, 6, 7, 8].map((n) => criterion(protocol, `vkb-${n}-${kind}`)).filter(Boolean).map((c) => c.threshold);
      ok(limits.length >= 4, `${kind}: genoeg poorten`);
      for (let i = 1; i < limits.length; i += 1) ok(limits[i] >= limits[i - 1], `${kind}: ${limits.join(', ')}`);
    }
  },
  'Flexie: de aangedane knie moet minstens de grens plooien, links of rechts': async () => {
    const protocol = await vkb();
    const limit = criterion(protocol, 'vkb-2-flexie').threshold;
    equal(evaluate(protocol, 'vkb-2-flexie', links, { flexie: { left: String(limit), right: '150' } }).suggestion, SUGGESTION.MET);
    equal(evaluate(protocol, 'vkb-2-flexie', links, { flexie: { left: String(limit - 1), right: '150' } }).suggestion, SUGGESTION.NOT_MET);
    equal(evaluate(protocol, 'vkb-2-flexie', rechts, { flexie: { left: '150', right: String(limit) } }).suggestion, SUGGESTION.MET);
  },
  'Effusie: poort 1 laat 1+ toe, latere poorten enkel spoor of minder': async () => {
    const protocol = await vkb();
    const run = (id, value) => evaluate(protocol, id, links, { 'stroke-test': { value } }).suggestion;
    equal(run('vkb-1-stroke', '1+'), SUGGESTION.MET);
    equal(run('vkb-1-stroke', '2+'), SUGGESTION.NOT_MET);
    equal(run('vkb-4-stroke', 'spoor'), SUGGESTION.MET);
    equal(run('vkb-4-stroke', '1+'), SUGGESTION.NOT_MET);
  },
  'Herhalingen op het aangedane been: op de grens voldoet, eronder niet; de kuitgrens stijgt per poort': async () => {
    const protocol = await vkb();
    const limit = criterion(protocol, 'vkb-4-squat').threshold;
    equal(evaluate(protocol, 'vkb-4-squat', links, { 'sl-squat-reps': { value: String(limit) } }).suggestion, SUGGESTION.MET);
    equal(evaluate(protocol, 'vkb-4-squat', links, { 'sl-squat-reps': { value: String(limit - 1) } }).suggestion, SUGGESTION.NOT_MET);
    const calf = ['vkb-3-kuit', 'vkb-4-kuit', 'vkb-5-kuit'].map((id) => criterion(protocol, id).threshold);
    ok(calf[0] <= calf[1] && calf[1] < calf[2], `kuit: ${calf.join(', ')}`);
  },
  'Soleuskracht gebruikt "groter dan": precies op de grens voldoet niet': async () => {
    const protocol = await vkb();
    const limit = criterion(protocol, 'vkb-4-soleus').threshold;
    equal(evaluate(protocol, 'vkb-4-soleus', links, { 'soleus-bw': { value: String(limit) } }).suggestion, SUGGESTION.NOT_MET);
    equal(evaluate(protocol, 'vkb-4-soleus', links, { 'soleus-bw': { value: String(limit + 0.1) } }).suggestion, SUGGESTION.MET);
  },
  'Baseline: zonder baseline geen suggestie, met baseline % van het aangedane been': async () => {
    const protocol = await vkb();
    const limit = criterion(protocol, 'vkb-8-quad-base').threshold;
    const entries = (injured) => ({ 'quad-iso': { left: String(injured), right: '400' } }); // aangedaan links
    equal(evaluate(protocol, 'vkb-8-quad-base', links, entries(380)).suggestion, SUGGESTION.NO_BASELINE, 'niets ingevuld');
    equal(evaluate(protocol, 'vkb-8-quad-base', { ...links, baselines: { 'quad-iso': { none: true } } }, entries(380)).suggestion, SUGGESTION.NO_BASELINE, 'expliciet geen baseline');
    const patient = { ...links, baselines: { 'quad-iso': { value: 400, unit: 'Nm' } } };
    equal(evaluate(protocol, 'vkb-8-quad-base', patient, entries((limit / 100) * 400)).suggestion, SUGGESTION.MET, 'op de grens');
    equal(evaluate(protocol, 'vkb-8-quad-base', patient, entries(((limit - 1) / 100) * 400)).suggestion, SUGGESTION.NOT_MET, 'eronder');
    const mismatch = evaluate(protocol, 'vkb-8-quad-base', patient, { 'quad-iso': { left: '2000', right: '2000', unit: 'N' } });
    equal(mismatch.details[0].unitMismatch, true, 'baseline in Nm, meting in N');
    equal(mismatch.suggestion, SUGGESTION.NO_DATA);
  },
  'Baseline-invoer wordt gecontroleerd': async () => {
    const protocol = await vkb();
    equal(baselineProblems(protocol, { 'quad-iso': { value: 300, unit: 'Nm' }, 'ham-iso': { none: true } }), []);
    ok(baselineProblems(protocol, { 'quad-iso': { value: 0, unit: 'Nm' } }).length, 'nul is ongeldig');
    ok(baselineProblems(protocol, { 'quad-iso': { value: 300, unit: 'kg' } }).length, 'onbekende eenheid');
    ok(baselineProblems(protocol, { flexie: { value: 100, unit: '°' } }).length, 'enkel tests met baseline');
  },
  'Asymmetrie: onder de grens voldoet, op de grens niet; geldt voor beide benen even': async () => {
    const protocol = await vkb();
    const limit = criterion(protocol, 'vkb-5-landing').threshold;
    const entries = (pct, side) => {
      const high = 1000;
      const low = String(high * (1 - pct / 100));
      return { 'dl-landing-pfa': side === 'L' ? { left: low, right: String(high) } : { left: String(high), right: low } };
    };
    equal(evaluate(protocol, 'vkb-5-landing', links, entries(limit - 1, 'L')).suggestion, SUGGESTION.MET);
    equal(evaluate(protocol, 'vkb-5-landing', links, entries(limit, 'L')).suggestion, SUGGESTION.NOT_MET);
    equal(evaluate(protocol, 'vkb-5-landing', rechts, entries(limit - 1, 'R')).suggestion, SUGGESTION.MET, 'aangedaan rechts');
    equal(evaluate(protocol, 'vkb-5-landing', links, entries(limit - 1, 'R')).suggestion, SUGGESTION.MET, 'zijde speelt geen rol');
  },
  'Landingskinetiek (poort 8): beide metingen moeten onder de grens liggen': async () => {
    const protocol = await vkb();
    const limit = criterion(protocol, 'vkb-8-landing').threshold;
    const good = (limit - 1) / 100;
    const bad = (limit + 1) / 100;
    const e = (a, b) => ({ 'sl-landing-pfa': { left: String(1000 * (1 - a)), right: '1000' }, 'sl-loading-rate': { left: String(50000 * (1 - b)), right: '50000' } });
    equal(evaluate(protocol, 'vkb-8-landing', links, e(good, good)).suggestion, SUGGESTION.MET);
    equal(evaluate(protocol, 'vkb-8-landing', links, e(good, bad)).suggestion, SUGGESTION.NOT_MET);
  },
  'Hoptestbatterij (poort 8): alle vijf de tests, ook de verticale': async () => {
    const protocol = await vkb();
    equal(criterion(protocol, 'vkb-8-hop').tests, ['single-hop', 'triple-hop', 'crossover-hop', 'timed-hop', 'vertical-hop']);
    const limit = criterion(protocol, 'vkb-8-hop').threshold;
    const hop = (lsi) => ({ left: String(lsi), right: '100' });
    const ok5 = { 'single-hop': hop(limit), 'triple-hop': hop(limit), 'crossover-hop': hop(limit), 'timed-hop': { left: '10', right: String(10 * limit / 100) }, 'vertical-hop': hop(limit) };
    equal(evaluate(protocol, 'vkb-8-hop', links, ok5).suggestion, SUGGESTION.MET);
    equal(evaluate(protocol, 'vkb-8-hop', links, { ...ok5, 'vertical-hop': hop(limit - 1) }).suggestion, SUGGESTION.NOT_MET);
  },
  'Zonder meting krijgt een meetcriterium nooit "lijkt voldaan"; oordeel-criteria krijgen geen suggestie': async () => {
    const protocol = await vkb();
    for (const c of all(protocol)) {
      const { suggestion } = evaluateCriterion(c, { patient: links, today: '2026-07-16', sessions: [], protocol });
      if (c.type === 'measurement') equal(suggestion, SUGGESTION.NO_DATA, c.id);
      if (c.type === 'judgement') equal(suggestion, SUGGESTION.JUDGEMENT, c.id);
    }
  },
  'Nieuwe tests: bereik en eenheid': async () => {
    const protocol = await vkb();
    const build = (entries) => buildSession({ date: '2026-10-20', entries }, { protocol, patient: links, today });
    equal(build({ 'sl-squat-reps': { value: '15' } }).errors, {});
    ok(build({ 'sl-squat-reps': { value: '-1' } }).errors['sl-squat-reps'], 'negatief');
    equal(build({ 'sl-landing-pfa': { left: '900', right: '1000' } }).session.measurements['sl-landing-pfa'].asymmetry, 10);
    ok(build({ 'sl-landing-pfa': { left: '900', right: '' } }).errors['sl-landing-pfa'], 'beide zijden nodig');
    equal(build({ 'vertical-hop': { left: '40,5', right: '42' } }).session.measurements['vertical-hop'].lsi, 96.4);
  },
  'Mijlpalen per afgerond level, stopregels, na terugkeer en uitleg zijn aanwezig': async () => {
    const protocol = await vkb();
    ok(protocol.milestones.filter((m) => m.trigger.type === 'level').length >= 6, 'level-mijlpalen');
    ok(protocol.stopRules.length >= 5 && protocol.stopRules.every((r) => r.finding && r.action), 'stopregels');
    ok(protocol.afterReturn.ongoing.length >= 3 && protocol.afterReturn.discharge, 'na terugkeer');
    ok(protocol.patientGuide.sections.length >= 4, 'patiëntuitleg');
    ok(protocol.testSchedule.moments.some((m) => m.week === 52) && protocol.testSchedule.moments.some((m) => m.week === 104), 'hertests op 12 en 24 maanden');
  },
};
