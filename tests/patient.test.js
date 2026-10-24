import { normalizePatient, suggestCode, validatePatient } from '../js/domain/patient.js';
import { equal, ok } from './assert.js';

const vkb = {
  id: 'vkb',
  patientFields: {
    graft: { options: [{ value: 'HT' }, { value: 'BPTB' }, { value: 'QT' }, { value: 'andere' }] },
    associatedInjuries: { options: [{ value: 'meniscushechting' }] },
    sportLevel: { options: [{ value: 'I' }, { value: 'II' }, { value: 'III' }, { value: 'IV' }] },
  },
};

const validRaw = {
  code: ' vkb-024 ',
  injury: 'vkb',
  side: 'L',
  injuryDate: '2026-08-01',
  graft: 'HT',
  associatedInjuries: ['meniscushechting'],
  sport: 'voetbal',
  sportLevel: 'I',
  goal: '',
  bodyWeightKg: '72,5',
};

const context = { protocol: vkb, existingCodes: [], isNew: true, today: '2026-10-24' };

export const tests = {
  'suggestCode begint bij 001': () => {
    equal(suggestCode('VKB', []), 'VKB-001');
  },
  'suggestCode neemt het hoogste nummer + 1 en negeert andere voorvoegsels': () => {
    equal(suggestCode('VKB', ['VKB-001', 'VKB-007', 'ENK-020']), 'VKB-008');
    equal(suggestCode('ENK', ['VKB-001', 'VKB-007', 'ENK-020']), 'ENK-021');
  },
  'normalizePatient: code in hoofdletters, gewicht met komma': () => {
    const patient = normalizePatient(validRaw);
    equal(patient.code, 'VKB-024');
    equal(patient.bodyWeightKg, 72.5);
  },
  'normalizePatient: geen transplantaat bij enkel': () => {
    const patient = normalizePatient({ ...validRaw, injury: 'enkel', graft: 'HT' });
    ok(!('graft' in patient), 'graft hoort niet bij enkel');
  },
  'validatePatient: geldige patiënt geeft geen fouten': () => {
    equal(validatePatient(normalizePatient(validRaw), context), {});
  },
  'validatePatient: weigert een naam als code': () => {
    const errors = validatePatient(normalizePatient({ ...validRaw, code: 'Jan Peeters' }), context);
    ok(errors.code, 'naam moet geweigerd worden');
  },
  'validatePatient: dubbele code enkel bij nieuwe patiënt': () => {
    const patient = normalizePatient(validRaw);
    ok(validatePatient(patient, { ...context, existingCodes: ['VKB-024'] }).code, 'dubbel bij nieuw');
    equal(validatePatient(patient, { ...context, existingCodes: ['VKB-024'], isNew: false }), {});
  },
  'validatePatient: datum in de toekomst en verplichte velden': () => {
    const errors = validatePatient(normalizePatient({ ...validRaw, injuryDate: '2026-12-01', side: '', graft: '' }), context);
    ok(errors.injuryDate && errors.side && errors.graft, JSON.stringify(errors));
  },
  'validatePatient: "andere" transplantaat vraagt een omschrijving': () => {
    const errors = validatePatient(normalizePatient({ ...validRaw, graft: 'andere' }), context);
    ok(errors.graftOther, 'omschrijving verplicht');
  },
  'validatePatient: onrealistisch gewicht': () => {
    const errors = validatePatient(normalizePatient({ ...validRaw, bodyWeightKg: '7' }), context);
    ok(errors.bodyWeightKg, 'gewicht te laag');
  },
};
