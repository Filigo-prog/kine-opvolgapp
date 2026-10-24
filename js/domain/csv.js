// Minimale CSV-lezer (RFC 4180): aanhalingstekens, komma's en nieuwe regels in velden,
// CRLF of LF, BOM, en komma, puntkomma of tab als scheidingsteken. Pure functie, geen DOM.

function detectDelimiter(text) {
  let inQuotes = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char in counts) counts[char] += 1;
    else if (!inQuotes && (char === '\n' || char === '\r')) break;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** Tekst → lijst van rijen (lijsten van velden). Lege rijen worden overgeslagen. */
export function parseCsv(text) {
  const source = String(text).replace(/^﻿/, '');
  const delimiter = detectDelimiter(source);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const endRow = () => {
    row.push(field);
    field = '';
    if (row.length > 1 || row[0].trim() !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inQuotes) {
      if (char !== '"') field += char;
      else if (source[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
    } else if (char === '"' && field === '') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

/** Rijen → objecten met de eerste rij als kolomnamen. Geeft { columns, records } terug. */
export function toRecords(rows) {
  if (!rows.length) return { columns: [], records: [] };
  const columns = rows[0].map((name) => name.trim());
  const records = rows.slice(1).map((cells) => Object.fromEntries(columns.map((name, i) => [name, (cells[i] ?? '').trim()])));
  return { columns, records };
}
