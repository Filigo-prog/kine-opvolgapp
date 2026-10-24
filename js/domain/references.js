// Referentiewaarden (cutoffs) uit het protocol, eventueel apart voor mannen en vrouwen.
// Ze worden getoond naast de metingen; de app beslist er niet mee. Pure functies, geen DOM.

/** De tekst die bij dit geslacht hoort ('M', 'V' of leeg). Zonder bekend geslacht staan beide naast elkaar. */
export function referenceText(row, sex) {
  if (sex === 'M' && row.men) return row.men;
  if (sex === 'V' && row.women) return row.women;
  if (row.text) return row.text;
  if (row.men && row.women) return `Mannen: ${row.men} · Vrouwen: ${row.women}`;
  if (row.men) return sex ? null : `Mannen: ${row.men}`;
  if (row.women) return sex ? null : `Vrouwen: ${row.women}`;
  return null;
}

/** Enkel de rijen met een referentie voor dit geslacht, gegroepeerd: [{ group, rows: [{ row, text }] }]. */
export function groupedReferences(protocol, sex) {
  const groups = [];
  for (const row of protocol.references ?? []) {
    const text = referenceText(row, sex);
    if (!text) continue;
    let group = groups.find((entry) => entry.group === row.group);
    if (!group) {
      group = { group: row.group, rows: [] };
      groups.push(group);
    }
    group.rows.push({ row, text });
  }
  return groups;
}

/** De referentie bij een test uit de app (voor onder het invoerveld), of null. */
export function referenceForTest(protocol, testId, sex) {
  const row = (protocol.references ?? []).find((entry) => entry.testId === testId);
  return row ? referenceText(row, sex) : null;
}
