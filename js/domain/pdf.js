// Minimale PDF-schrijver (A4, standaardlettertype Helvetica, geen externe bibliotheek).
// Gebouwd voor het patiëntoverzicht: titels, tekst met regelafbreking, lijsten, een voortgangsbalk en lijngrafieken.
// De uitvoer is zuiver ASCII (accenten staan als octale codes), zodat tekenlengte gelijk is aan bytelengte.

const PAGE = { width: 595, height: 842, margin: 50 };
const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin;
const COLORS = {
  text: [0.12, 0.15, 0.15],
  muted: [0.4, 0.45, 0.45],
  primary: [0.12, 0.44, 0.42],
  track: [0.9, 0.92, 0.91],
  zone: [0.82, 0.93, 0.85],
  line: [0.8, 0.83, 0.82],
};

// Helvetica-breedtes (1/1000 em) voor ASCII 32 tot 126.
const WIDTHS = {
  regular: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
    278, 278, 278, 469, 556, 333,
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
    334, 260, 334, 584],
  bold: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
    722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
    333, 278, 333, 584, 556, 333,
    556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
    389, 280, 389, 584],
};

// Tekens buiten ASCII die in WinAnsi (cp1252) bestaan.
const WIN_ANSI = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };
const REPLACEMENTS = { '≥': '>=', '≤': '<=', '→': '->', '✓': 'v', '≈': '~' };

/** Tekst → { codes, ascii } met enkel tekens die Helvetica in WinAnsi kent. */
function toWinAnsi(text) {
  const out = [];
  for (const raw of String(text)) {
    const char = REPLACEMENTS[raw] ?? raw;
    for (const c of char) {
      const code = c.codePointAt(0);
      if (code >= 32 && code < 127) out.push(code);
      else if (WIN_ANSI[c]) out.push(WIN_ANSI[c]);
      else if (code >= 0xa0 && code <= 0xff) out.push(code);
      else out.push(63); // ?
    }
  }
  return out;
}

function charWidth(code, bold) {
  const table = bold ? WIDTHS.bold : WIDTHS.regular;
  if (code >= 32 && code < 127) return table[code - 32];
  if (code >= 0xc0 && code <= 0xff) {
    // accent: breedte van de basisletter
    const base = String.fromCodePoint(code).normalize('NFD')[0].codePointAt(0);
    if (base >= 32 && base < 127) return table[base - 32];
  }
  return 556;
}

export function textWidth(text, size, bold = false) {
  return (toWinAnsi(text).reduce((sum, code) => sum + charWidth(code, bold), 0) * size) / 1000;
}

function pdfString(text) {
  let out = '(';
  for (const code of toWinAnsi(text)) {
    if (code === 40 || code === 41 || code === 92) out += `\\${String.fromCharCode(code)}`;
    else if (code < 127) out += String.fromCharCode(code);
    else out += `\\${code.toString(8).padStart(3, '0')}`;
  }
  return `${out})`;
}

/** Breekt tekst af op woorden zodat elke regel binnen maxWidth past. */
export function wrapText(text, size, maxWidth, bold = false) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && textWidth(candidate, size, bold) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

const num = (value) => String(Math.round(value * 100) / 100);
const color = (rgb, stroke = false) => `${rgb.map(num).join(' ')} ${stroke ? 'RG' : 'rg'}`;

class Layout {
  constructor() {
    this.pages = [];
    this.newPage();
  }

  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = PAGE.height - PAGE.margin; // y = bovenkant van de volgende regel
  }

  /** Zorgt dat er `height` ruimte is, anders een nieuwe pagina. */
  ensure(height) {
    if (this.y - height < PAGE.margin + 20) this.newPage();
  }

  space(height) {
    this.y -= height;
  }

  textLine(text, { x = PAGE.margin, size = 11, bold = false, rgb = COLORS.text } = {}) {
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color(rgb)} ${num(x)} ${num(this.y - size)} Td ${pdfString(text)} Tj ET`);
  }

  paragraph(text, { size = 11, bold = false, rgb = COLORS.text, indent = 0, gap = 6, leading = 1.35 } = {}) {
    const lines = wrapText(text, size, CONTENT_WIDTH - indent, bold);
    for (const line of lines) {
      this.ensure(size * leading);
      this.textLine(line, { x: PAGE.margin + indent, size, bold, rgb });
      this.y -= size * leading;
    }
    this.y -= gap;
  }

  heading(text, size = 15) {
    this.ensure(size * 3);
    this.y -= 8;
    this.paragraph(text, { size, bold: true, rgb: COLORS.primary, gap: 4 });
  }

  rule() {
    this.ensure(10);
    this.ops.push(`${color(COLORS.line, true)} 0.8 w ${PAGE.margin} ${num(this.y - 2)} m ${PAGE.width - PAGE.margin} ${num(this.y - 2)} l S`);
    this.y -= 10;
  }

  bullets(items, size = 11) {
    for (const item of items) {
      const lines = wrapText(item, size, CONTENT_WIDTH - 16);
      this.ensure(size * 1.35 * lines.length);
      this.ops.push(`${color(COLORS.primary)} ${num(PAGE.margin + 4)} ${num(this.y - size * 0.75)} 2.2 2.2 re f`);
      for (const line of lines) {
        this.textLine(line, { x: PAGE.margin + 16, size });
        this.y -= size * 1.35;
      }
      this.y -= 2;
    }
    this.y -= 4;
  }

  checklist(items, size = 11) {
    for (const { text, done } of items) {
      const lines = wrapText(text, size, CONTENT_WIDTH - 22);
      this.ensure(size * 1.35 * lines.length + 4);
      const top = this.y - 1;
      const box = 10;
      this.ops.push(`${color(done ? COLORS.primary : COLORS.muted, true)} 1 w ${PAGE.margin} ${num(top - box)} ${box} ${box} re S`);
      if (done) {
        this.ops.push(`${color(COLORS.primary, true)} 1.8 w ${num(PAGE.margin + 2)} ${num(top - 5.5)} m ${num(PAGE.margin + 4.3)} ${num(top - 8)} l ${num(PAGE.margin + 8.5)} ${num(top - 2.5)} l S`);
      }
      for (const line of lines) {
        this.textLine(line, { x: PAGE.margin + 22, size, rgb: done ? COLORS.muted : COLORS.text });
        this.y -= size * 1.35;
      }
      this.y -= 3;
    }
    this.y -= 4;
  }

  progress(met, total) {
    this.ensure(18);
    const height = 9;
    const share = total ? Math.min(1, met / total) : 1;
    this.ops.push(`${color(COLORS.track)} ${PAGE.margin} ${num(this.y - height)} ${CONTENT_WIDTH} ${height} re f`);
    if (share > 0) this.ops.push(`${color(COLORS.primary)} ${PAGE.margin} ${num(this.y - height)} ${num(CONTENT_WIDTH * share)} ${height} re f`);
    this.y -= height + 8;
  }

  table(header, rows, widths, size = 10) {
    const draw = (cells, bold) => {
      const wrapped = cells.map((cell, i) => wrapText(cell, size, widths[i] - 8, bold));
      const lineCount = Math.max(...wrapped.map((lines) => lines.length));
      this.ensure(size * 1.35 * lineCount + 6);
      let x = PAGE.margin;
      wrapped.forEach((lines, i) => {
        lines.forEach((line, row) => {
          this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color(COLORS.text)} ${num(x + 4)} ${num(this.y - size - row * size * 1.35)} Td ${pdfString(line)} Tj ET`);
        });
        x += widths[i];
      });
      this.y -= size * 1.35 * lineCount + 4;
      this.ops.push(`${color(COLORS.line, true)} 0.5 w ${PAGE.margin} ${num(this.y + 1)} m ${PAGE.margin + CONTENT_WIDTH} ${num(this.y + 1)} l S`);
    };
    draw(header, true);
    rows.forEach((row) => draw(row, false));
    this.y -= 6;
  }

  /**
   * Lijngrafiek met een doelzone (vanaf `target` tot de bovenkant).
   * points: [{ label, value }]; yMax afgerond op tientallen.
   */
  chart({ points, target, unit = '%' }) {
    const height = 120;
    const labelSpace = 22;
    this.ensure(height + labelSpace + 12);
    const left = PAGE.margin + 34;
    const right = PAGE.width - PAGE.margin - 10;
    const top = this.y - 6;
    const bottom = top - height;
    const yMax = Math.max(Math.ceil((Math.max(target, ...points.map((p) => p.value)) + 5) / 20) * 20, 20);
    const yOf = (value) => bottom + (value / yMax) * height;

    this.ops.push(`${color(COLORS.zone)} ${left} ${num(yOf(target))} ${num(right - left)} ${num(top - yOf(target))} re f`);
    for (let tick = 0; tick <= yMax; tick += 20) {
      this.ops.push(`${color(COLORS.line, true)} 0.5 w ${left} ${num(yOf(tick))} m ${right} ${num(yOf(tick))} l S`);
      const label = `${tick} ${unit}`;
      this.ops.push(`BT /F1 8 Tf ${color(COLORS.muted)} ${num(left - 6 - textWidth(label, 8))} ${num(yOf(tick) - 3)} Td ${pdfString(label)} Tj ET`);
    }

    const xOf = (index) => (points.length === 1 ? (left + right) / 2 : left + 14 + (index * (right - left - 28)) / (points.length - 1));
    if (points.length > 1) {
      const path = points.map((p, i) => `${num(xOf(i))} ${num(yOf(p.value))} ${i === 0 ? 'm' : 'l'}`).join(' ');
      this.ops.push(`${color(COLORS.primary, true)} 2 w ${path} S`);
    }
    const every = Math.max(1, Math.ceil(points.length / 8));
    points.forEach((p, i) => {
      this.ops.push(`${color(COLORS.primary)} ${num(xOf(i) - 3)} ${num(yOf(p.value) - 3)} 6 6 re f`);
      if (i % every === 0 || i === points.length - 1) {
        const value = `${Math.round(p.value)} ${unit}`;
        this.ops.push(`BT /F2 8 Tf ${color(COLORS.text)} ${num(xOf(i) - textWidth(value, 8, true) / 2)} ${num(yOf(p.value) + 6)} Td ${pdfString(value)} Tj ET`);
        this.ops.push(`BT /F1 8 Tf ${color(COLORS.muted)} ${num(xOf(i) - textWidth(p.label, 8) / 2)} ${num(bottom - 12)} Td ${pdfString(p.label)} Tj ET`);
      }
    });
    this.y = bottom - labelSpace;
  }
}

/** Zet de pagina's om in een volledig PDF-bestand (tekst, enkel ASCII). */
function assemble(pages, footer) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;

  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesRef = add(''); // wordt hieronder ingevuld
  const font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  pages.forEach((ops, index) => {
    const label = `${footer} · pagina ${index + 1} van ${pages.length}`;
    const footerOp = `BT /F1 8 Tf ${color(COLORS.muted)} ${PAGE.margin} 30 Td ${pdfString(label)} Tj ET`;
    const stream = [...ops, footerOp].join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const page = add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${content} 0 R >>`);
    kids.push(`${page} 0 R`);
  });
  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

/**
 * Bouwt een PDF uit blokken:
 *  { type: 'title'|'subtitle'|'heading'|'text'|'muted'|'bullets'|'checklist'|'progress'|'chart'|'table'|'rule'|'space', ... }
 * Geeft de PDF als tekenreeks (ASCII) terug.
 */
export function buildPdf(blocks, { footer = '' } = {}) {
  const layout = new Layout();
  for (const block of blocks) {
    switch (block.type) {
      case 'title': layout.paragraph(block.text, { size: 22, bold: true, rgb: COLORS.primary, gap: 2 }); break;
      case 'subtitle': layout.paragraph(block.text, { size: 11, rgb: COLORS.muted, gap: 8 }); break;
      case 'heading': layout.heading(block.text); break;
      case 'subheading': layout.paragraph(block.text, { size: 12, bold: true, gap: 3 }); break;
      case 'text': layout.paragraph(block.text); break;
      case 'muted': layout.paragraph(block.text, { size: 9.5, rgb: COLORS.muted }); break;
      case 'bullets': layout.bullets(block.items); break;
      case 'checklist': layout.checklist(block.items); break;
      case 'progress': layout.progress(block.met, block.total); break;
      case 'chart': layout.chart(block); break;
      case 'table': layout.table(block.header, block.rows, block.widths); break;
      case 'rule': layout.rule(); break;
      case 'space': layout.space(block.height ?? 8); break;
      case 'ensure': layout.ensure(block.height); break; // houdt wat volgt bij elkaar op één pagina
      default: throw new Error(`Onbekend PDF-blok "${block.type}".`);
    }
  }
  return assemble(layout.pages, footer);
}
