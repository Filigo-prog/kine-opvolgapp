// LSI (Limb Symmetry Index) en vergelijking links/rechts. Pure functies, geen DOM.
//
// LSI = aangedane zijde ÷ gezonde zijde × 100.
// Bij tijdtests (lager = beter, bv. 6 m timed hop) omgekeerd: gezonde ÷ aangedane × 100.
// Toon altijd de absolute waarden naast de LSI: 100 % kan ook betekenen dat beide zijden zwak zijn.

/** '12,5' of '12.5' → 12.5; leeg → null; ongeldig → NaN. */
export function parseNumber(text) {
  const value = String(text ?? '').trim().replace(',', '.');
  if (value === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(value)) return NaN;
  return Number(value);
}

export function round(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** teller ÷ noemer × 100, afgerond op 1 decimaal; null als het niet te berekenen is. */
export function ratioPercent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0 || numerator < 0) return null;
  return round((numerator / denominator) * 100, 1);
}

export function injuredAndHealthy(left, right, side) {
  return side === 'L'
    ? { injured: left, healthy: right }
    : { injured: right, healthy: left };
}

/**
 * Vergelijkt links en rechts volgens test.compare:
 * - 'lsi':          aangedaan ÷ gezond × 100
 * - 'lsi-inverse':  gezond ÷ aangedaan × 100 (tijdtests)
 * - 'difference':   gezond − aangedaan, in de eenheid van de test (bv. ROM, knie-tot-muur)
 * Geeft { lsi, difference } terug; wat niet van toepassing is, is null.
 */
export function compareSides(test, left, right, side) {
  const { injured, healthy } = injuredAndHealthy(left, right, side);
  switch (test.compare) {
    case 'lsi':
      return { lsi: ratioPercent(injured, healthy), difference: null };
    case 'lsi-inverse':
      return { lsi: ratioPercent(healthy, injured), difference: null };
    case 'difference':
      return {
        lsi: null,
        difference: Number.isFinite(injured) && Number.isFinite(healthy)
          ? round(healthy - injured, Math.max(test.decimals ?? 0, 1))
          : null,
      };
    default:
      throw new Error(`Onbekende vergelijking "${test.compare}" bij test ${test.id}.`);
  }
}

/** Relatieve waarde per kg lichaamsgewicht (bv. Nm/kg), of null. */
export function perKg(value, bodyWeightKg) {
  if (!Number.isFinite(value) || !Number.isFinite(bodyWeightKg) || bodyWeightKg <= 0) return null;
  return round(value / bodyWeightKg, 2);
}
