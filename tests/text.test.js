import { criterionText, fillPlaceholders, milestoneText, placeholdersIn } from '../js/domain/text.js';
import { validateProtocol } from '../js/domain/protocol.js';
import { equal, ok } from './assert.js';

const load = async (id) => (await fetch(`../data/protocol-${id}.json`)).json();

export const tests = {
  'Placeholders: getal invullen, komma als decimaalteken, onbekende blijven staan': () => {
    equal(fillPlaceholders('LSI ≥ {threshold} %', { threshold: 80 }), 'LSI ≥ 80 %');
    equal(fillPlaceholders('verschil < {threshold} cm', { threshold: 2.5 }), 'verschil < 2,5 cm');
    equal(fillPlaceholders('{weeks} weken, {months} maanden', { weeks: 12 }), '12 weken, {months} maanden');
    equal(fillPlaceholders('geen placeholder', { threshold: 5 }), 'geen placeholder');
    equal(fillPlaceholders(undefined, {}), '');
    equal(placeholdersIn('{threshold} en {threshold} en {weeks}'), ['threshold', 'threshold', 'weeks']);
  },
  'Een aangepaste grens past de omschrijving automatisch aan': () => {
    const criterion = { id: 'c', label: 'Quadriceps LSI ≥ {threshold} %', note: 'Bij ≥ {threshold} % mag het.', threshold: 75 };
    equal(criterionText(criterion, 'label'), 'Quadriceps LSI ≥ 75 %');
    equal(criterionText(criterion, 'note'), 'Bij ≥ 75 % mag het.');
    equal(criterionText({ label: 'Minimum {weeks} weken', weeks: 10 }, 'label'), 'Minimum 10 weken');
    equal(milestoneText({ label: 'Kracht op {threshold} %', trigger: { type: 'lsi', threshold: 85 } }, 'label'), 'Kracht op 85 %');
  },
  'Protocollen: elke placeholder is ingevuld en de grens staat echt in de tekst': async () => {
    const seen = { criteria: 0, milestones: 0 };
    for (const id of ['vkb', 'enkel']) {
      const protocol = validateProtocol(await load(id), id);
      const unresolved = (text) => /\{[A-Za-z]+\}/.test(text);
      const asText = (number) => String(number).replace('.', ',');

      for (const criterion of protocol.levels.flatMap((l) => l.criteria)) {
        for (const field of ['label', 'patientLabel', 'note']) {
          if (!criterion[field]) continue;
          const shown = criterionText(criterion, field);
          ok(!unresolved(shown), `${criterion.id}.${field}: ${shown}`);
          for (const [placeholder, value] of [['threshold', criterion.threshold], ['weeks', criterion.weeks], ['months', criterion.months]]) {
            if (criterion[field].includes(`{${placeholder}}`)) {
              ok(shown.includes(asText(value)), `${criterion.id}.${field} moet ${asText(value)} bevatten: ${shown}`);
              seen.criteria += 1;
            }
          }
        }
      }
      for (const milestone of protocol.milestones) {
        for (const field of ['label', 'description']) {
          if (!milestone[field]) continue;
          const shown = milestoneText(milestone, field);
          ok(!unresolved(shown), `${milestone.id}.${field}: ${shown}`);
          if (milestone[field].includes('{threshold}')) { ok(shown.includes(asText(milestone.trigger.threshold)), shown); seen.milestones += 1; }
        }
      }
      if (protocol.prevention) {
        const shown = fillPlaceholders(protocol.prevention.patientText, protocol.prevention);
        ok(!unresolved(shown), shown);
      }
    }
    ok(seen.criteria > 10 && seen.milestones >= 2, `er zijn omschrijvingen die de grens overnemen (${seen.criteria} criteria, ${seen.milestones} mijlpalen)`);
  },
  'Protocol: een placeholder zonder bijhorend getal wordt geweigerd': async () => {
    const protocol = await load('vkb');
    const judgement = protocol.levels.flatMap((l) => l.criteria).find((c) => c.type === 'judgement');
    judgement.label = 'Vrij oordeel ≥ {threshold}';
    let message = '';
    try { validateProtocol(protocol, 'vkb'); } catch (error) { message = error.message; }
    ok(message.includes('{threshold} staat in de tekst'), message);

    const protocol2 = await load('vkb');
    protocol2.levels.flatMap((l) => l.criteria).find((c) => c.type === 'minTime').label = 'Minimum {months} maanden';
    let message2 = '';
    try { validateProtocol(protocol2, 'vkb'); } catch (error) { message2 = error.message; }
    ok(message2.includes('{months} staat in de tekst'), message2); // vkb-2-tijd heeft weken, geen maanden
  },
};
