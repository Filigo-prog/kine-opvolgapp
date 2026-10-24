// Laadt de klinische protocollen uit /data. De inhoud staat in JSON, niet in de code.

import { CRITERION_TYPES, METRICS, OPERATOR_NAMES } from './criteria.js';
import { TRIGGER_TYPES } from './milestones.js';

export const INJURIES = ['vkb', 'enkel'];

const cache = new Map();

export async function loadProtocol(injury) {
  if (!INJURIES.includes(injury)) throw new Error(`Onbekend letsel: ${injury}`);
  if (!cache.has(injury)) {
    const promise = fetch(`./data/protocol-${injury}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Protocol ${injury} niet gevonden (${response.status}).`);
        return response.json();
      })
      .then((protocol) => validateProtocol(protocol, injury));
    // Bij een fout niet in de cache houden, zodat een volgende poging opnieuw laadt.
    promise.catch(() => cache.delete(injury));
    cache.set(injury, promise);
  }
  return cache.get(injury);
}

export async function loadAllProtocols() {
  const protocols = await Promise.all(INJURIES.map(loadProtocol));
  return Object.fromEntries(protocols.map((protocol) => [protocol.id, protocol]));
}

export function validateProtocol(protocol, expectedId) {
  const problems = [];
  if (protocol?.id !== expectedId) problems.push(`id moet "${expectedId}" zijn`);
  for (const key of ['version', 'name', 'codePrefix', 'dateLabel', 'sinceLabel']) {
    if (typeof protocol?.[key] !== 'string' || !protocol[key]) problems.push(`"${key}" ontbreekt`);
  }
  if (!/^[A-Z]{2,5}$/.test(protocol?.codePrefix ?? '')) problems.push('"codePrefix" moet 2 tot 5 hoofdletters zijn');
  if (typeof protocol?.patientFields !== 'object') problems.push('"patientFields" ontbreekt');
  problems.push(...validateTestGroups(protocol?.testGroups));
  if (!problems.length) problems.push(...validateLevels(protocol));
  if (problems.length) throw new Error(`Protocol ${expectedId} is ongeldig: ${problems.join('; ')}.`);
  return protocol;
}

const TEST_TYPES = ['bilateral', 'single', 'choice'];
const COMPARE_TYPES = ['lsi', 'lsi-inverse', 'difference'];

function validateTestGroups(groups) {
  if (!Array.isArray(groups)) return ['"testGroups" ontbreekt'];
  const problems = [];
  const ids = new Set();
  for (const group of groups) {
    for (const test of group.tests ?? []) {
      const name = `test "${test.id}"`;
      if (!test.id || ids.has(test.id)) problems.push(`${name}: id ontbreekt of komt dubbel voor`);
      ids.add(test.id);
      if (!test.label) problems.push(`${name}: "label" ontbreekt`);
      if (!TEST_TYPES.includes(test.type)) problems.push(`${name}: onbekend type "${test.type}"`);
      if (test.type === 'bilateral' && !COMPARE_TYPES.includes(test.compare)) {
        problems.push(`${name}: "compare" moet ${COMPARE_TYPES.join(', ')} zijn`);
      }
      if (['bilateral', 'single'].includes(test.type)
        && !(Number.isFinite(test.min) && Number.isFinite(test.max) && test.min < test.max)) {
        problems.push(`${name}: "min" en "max" ontbreken of zijn ongeldig`);
      }
      if (test.type === 'choice' && !(Array.isArray(test.options) && test.options.length)) {
        problems.push(`${name}: "options" ontbreekt`);
      }
    }
  }
  return problems;
}

function validateLevels(protocol) {
  if (!Array.isArray(protocol.levels)) return ['"levels" ontbreekt'];
  const problems = [];
  const tests = new Map(protocol.testGroups.flatMap((group) => group.tests).map((test) => [test.id, test]));
  const ids = new Set();
  protocol.levels.forEach((level, index) => {
    if (level.number !== index + 1) problems.push(`level ${index + 1}: "number" moet ${index + 1} zijn`);
    if (!level.title) problems.push(`level ${index + 1}: "title" ontbreekt`);
    for (const criterion of level.criteria ?? []) {
      const name = `criterium "${criterion.id}"`;
      if (!criterion.id || ids.has(criterion.id)) problems.push(`${name}: id ontbreekt of komt dubbel voor`);
      ids.add(criterion.id);
      if (!criterion.label) problems.push(`${name}: "label" ontbreekt`);
      if (!CRITERION_TYPES.includes(criterion.type)) problems.push(`${name}: onbekend type "${criterion.type}"`);
      if (criterion.type === 'minTime' && !(criterion.weeks > 0 || criterion.months > 0)) {
        problems.push(`${name}: "weeks" of "months" ontbreekt`);
      }
      if (criterion.type === 'measurement') {
        const testIds = criterion.tests ?? [criterion.test];
        for (const testId of testIds) {
          if (!tests.has(testId)) problems.push(`${name}: test "${testId}" bestaat niet`);
        }
        if (!METRICS.includes(criterion.metric)) problems.push(`${name}: onbekende "metric" "${criterion.metric}"`);
        if (!OPERATOR_NAMES.includes(criterion.operator)) problems.push(`${name}: onbekende "operator" "${criterion.operator}"`);
        if (criterion.operator === 'in' ? !Array.isArray(criterion.values) : !Number.isFinite(criterion.threshold)) {
          problems.push(`${name}: "threshold" of "values" ontbreekt`);
        }
      }
    }
  });
  problems.push(...validateMilestones(protocol, ids, tests));
  return problems;
}

function validateMilestones(protocol, criterionIds, tests) {
  const problems = [];
  const ids = new Set();
  for (const milestone of protocol.milestones ?? []) {
    const name = `mijlpaal "${milestone.id}"`;
    if (!milestone.id || ids.has(milestone.id)) problems.push(`${name}: id ontbreekt of komt dubbel voor`);
    ids.add(milestone.id);
    if (!milestone.label) problems.push(`${name}: "label" ontbreekt`);
    const trigger = milestone.trigger;
    if (!TRIGGER_TYPES.includes(trigger?.type)) {
      problems.push(`${name}: onbekende trigger "${trigger?.type}"`);
    } else if (trigger.type === 'criterion' && !criterionIds.has(trigger.criterion)) {
      problems.push(`${name}: criterium "${trigger.criterion}" bestaat niet`);
    } else if (trigger.type === 'lsi' && !(tests.has(trigger.test) && Number.isFinite(trigger.threshold))) {
      problems.push(`${name}: "test" of "threshold" ontbreekt of is ongeldig`);
    }
  }
  return problems;
}

/** Het label van een optie, bv. graft "HT" → "Hamstrings (HT)". */
export function optionLabel(protocol, field, value) {
  const option = protocol.patientFields?.[field]?.options?.find((o) => o.value === value);
  return option ? option.label : value;
}
