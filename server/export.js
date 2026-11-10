// Turns a report (headline figures + tables, as built in reports.js) into a branded PDF or an Excel workbook
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const COMPANY = () => process.env.COMPANY_NAME || 'MoveRight';
const LOGO = path.join(__dirname, 'assets', 'logo.png');
const NAVY = '#0a2b5e', ORANGE = '#ff6a00', GREY = '#5a6a85', LINE = '#dfe5ee', SOFT = '#f3f6fb', GREEN = '#1a8f4c', RED = '#c0392b';

const day = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Gaborone' });
const isoDay = d => new Date(+new Date(d) + 2 * 3600e3).toISOString().slice(0, 10);
const periodText = r => (r.from ? `${day(r.from)} to ${day(r.to || new Date())}` : 'All time');
const compareText = r => (r.prevFrom ? `Compared with ${day(r.prevFrom)} to ${day(r.prevTo)}` : 'No comparison (all time)');

// ---------- number formats (the same names the screens use) ----------
const n = (v, d = 2) => Math.abs(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = v => (v > 0 ? '+' : v < 0 ? '-' : '');
function fmt(v, f) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'number') return f === 'date' ? day(v) : String(v);
  switch (f) {
    case 'money': return (v < 0 ? '-' : '') + 'P ' + n(v);
    case 'smoney': return sign(v) + 'P ' + n(v);
    case 'pct': return (v < 0 ? '-' : '') + n(v, 1) + '%';
    case 'spct': return sign(v) + n(v, 1) + '%';
    case 'pts': return sign(v) + n(v, 1) + ' pts';
    case 'snum': return sign(v) + n(v, 0);
    case 'hours': return v < 1 ? Math.round(v * 60) + ' min' : n(v, 1) + ' h';
    default: return Number.isInteger(v) ? v.toLocaleString('en-US') : n(v);
  }
}
const cellFmt = (c, row) => (c.rowFmt ? row[c.rowFmt] : c.fmt);
const isNum = c => !!(c.fmt || c.rowFmt) && c.fmt !== 'date';

// Change against the previous period, written for a headline figure
function change(k) {
  if (k.prev === null || k.prev === undefined) return null;
  const d = k.value - k.prev;
  if (Math.abs(d) < 1e-9) return { text: 'No change vs previous period', good: null };
  const text = k.fmt === 'pct' ? fmt(d, 'pts') : k.prev ? fmt((d / Math.abs(k.prev)) * 100, 'spct') : 'new';
  return { text: `${text} vs previous period`, good: (d > 0) === (k.better === 'up') };
}

// The built-in PDF fonts only cover Western European characters
const safe = s => String(s ?? '').replace(/→/g, '->').replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x00-\xFF]/g, '');

// ---------- PDF ----------
function pdf(res, data) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true, info: { Title: `${data.title} ${periodText(data.range)}`, Author: COMPANY() } });
  doc.pipe(res);
  const L = 40, R = doc.page.width - 40, W = R - L, BOTTOM = doc.page.height - 50;
  let y = 40;

  // letterhead
  if (fs.existsSync(LOGO)) doc.image(LOGO, L, y, { fit: [52, 52] });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(COMPANY(), L + 64, y + 4);
  doc.fillColor(GREY).font('Helvetica').fontSize(9).text(process.env.COMPANY_ADDRESS || 'Gaborone, Botswana', L + 64, y + 24);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text(safe(data.title).toUpperCase(), L, y + 2, { width: W, align: 'right' });
  doc.fillColor(GREY).font('Helvetica').fontSize(9.5)
    .text(`Period: ${periodText(data.range)}`, L, y + 26, { width: W, align: 'right' })
    .text(`${compareText(data.range)} · Prepared ${day(data.generatedAt)} by ${safe(data.by)}`, L, y + 39, { width: W, align: 'right' });
  y += 62; doc.rect(L, y, W, 3).fill(ORANGE); y += 16;

  // headline figures, four to a row
  const per = 4, gap = 10, bw = (W - gap * (per - 1)) / per, bh = 58;
  data.kpis.forEach((k, i) => {
    const x = L + (i % per) * (bw + gap), by = y + Math.floor(i / per) * (bh + gap);
    doc.rect(x, by, bw, bh).fill(SOFT); doc.rect(x, by, 4, bh).fill(NAVY);
    doc.fillColor(GREY).font('Helvetica-Bold').fontSize(7.5).text(safe(k.label).toUpperCase(), x + 12, by + 8, { width: bw - 18 });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15).text(safe(fmt(k.value, k.fmt)), x + 12, by + 21, { width: bw - 18 });
    const c = change(k);
    if (c) doc.fillColor(c.good === null ? GREY : c.good ? GREEN : RED).font('Helvetica').fontSize(7.5).text(safe(c.text), x + 12, by + 42, { width: bw - 18 });
  });
  y += Math.ceil(data.kpis.length / per) * (bh + gap) + 8;

  // tables
  for (const t of data.tables) {
    const cols = t.cols, first = Math.min(W * 0.34, 260), rest = (W - first) / Math.max(1, cols.length - 1);
    const xs = cols.map((c, i) => (i === 0 ? L : L + first + (i - 1) * rest)), ws = cols.map((c, i) => (i === 0 ? first : rest));
    const size = cols.length > 7 ? 8 : 9, rh = size + 10;
    const numeric = cols.map((c, i) => i > 0 && (isNum(c) || t.rows.some(r => typeof r[c.key] === 'number')));
    // header row grows to fit headings that need two lines
    doc.font('Helvetica-Bold').fontSize(size - 0.5);
    const hh = Math.max(...cols.map((c, i) => doc.heightOfString(safe(c.label), { width: ws[i] - 12 }))) + 12;
    const head = () => {
      doc.rect(L, y, W, hh).fill(NAVY);
      cols.forEach((c, i) => doc.fillColor('#fff').font('Helvetica-Bold').fontSize(size - 0.5)
        .text(safe(c.label), xs[i] + 6, y + 6, { width: ws[i] - 12, align: numeric[i] ? 'right' : 'left' }));
      y += hh;
    };
    const room = h => { if (y + h > BOTTOM) { doc.addPage(); y = 40; return true; } return false; };
    // keep a table on one page when it fits on one; otherwise at least start it with a few rows
    const whole = 17 + hh + (t.rows.length + 1) * rh + (t.note ? 24 : 0);
    room(whole <= BOTTOM - 40 ? whole : hh + rh * 4 + 17);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(safe(t.title), L, y); y += 17;
    head();
    const rows = [...t.rows.map(r => ({ r })), ...(t.total && t.rows.length ? [{ r: t.total, total: true }] : [])];
    if (!t.rows.length) { doc.fillColor(GREY).font('Helvetica').fontSize(size).text('No data for this period.', L + 6, y + 5); y += rh; }
    rows.forEach(({ r, total }, i) => {
      if (room(rh)) head();
      const kind = total ? 'total' : r.kind;
      if (kind === 'header') doc.rect(L, y, W, rh).fill('#e7edf6');
      else if (i % 2) doc.rect(L, y, W, rh).fill('#fafbfd');
      const bold = ['header', 'subtotal', 'total'].includes(kind);
      cols.forEach((c, j) => {
        const v = kind === 'header' && j ? '' : fmt(r[c.key], cellFmt(c, r));
        doc.fillColor(kind === 'header' ? NAVY : '#1c2a44').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size)
          .text(safe(v), xs[j] + 6 + (j === 0 && !bold && t.rows.some(x => x.kind) ? 10 : 0), y + 5, { width: ws[j] - 12, align: numeric[j] ? 'right' : 'left', lineBreak: false, ellipsis: true });
      });
      y += rh;
      if (kind === 'subtotal') doc.moveTo(L, y - rh).lineTo(R, y - rh).lineWidth(0.8).strokeColor(NAVY).stroke();
      if (kind === 'total') { doc.moveTo(L, y - rh).lineTo(R, y - rh).lineWidth(1).strokeColor(NAVY).stroke(); doc.moveTo(L, y).lineTo(R, y).moveTo(L, y + 2).lineTo(R, y + 2).lineWidth(0.8).stroke(); }
      else doc.moveTo(L, y).lineTo(R, y).lineWidth(0.4).strokeColor(LINE).stroke();
    });
    if (t.note) { room(24); doc.fillColor(GREY).font('Helvetica-Oblique').fontSize(8).text(safe(t.note), L, y + 5, { width: W }); y += 14; }
    y += 18;
  }

  // footer on every page
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;                             // the footer sits below the margin; don't let it start a new page
    doc.fillColor(GREY).font('Helvetica').fontSize(7.5)
      .text(`${COMPANY()} · ${safe(data.title)} · ${periodText(data.range)} · Confidential`, L, doc.page.height - 32, { width: W / 2, lineBreak: false })
      .text(`Page ${i + 1} of ${pages.count}`, L + W / 2, doc.page.height - 32, { width: W / 2, align: 'right', lineBreak: false });
  }
  doc.end();
}

// ---------- Excel ----------
const XL = {
  money: '"P" #,##0.00;-"P" #,##0.00', smoney: '+"P" #,##0.00;-"P" #,##0.00;"P" 0.00', pct: '0.0"%"', spct: '+0.0"%";-0.0"%";0.0"%"',
  pts: '+0.0" pts";-0.0" pts";0.0" pts"', snum: '+#,##0;-#,##0;0', hours: '0.0" h"', date: 'dd mmm yyyy', num: 'General',
};
const sheetName = (s, used) => {
  let base = String(s).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet', name = base, i = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 28)} ${i++}`;
  used.add(name.toLowerCase());
  return name;
};
const headStyle = cell => {
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A2B5E' } };
  cell.alignment = { vertical: 'middle', wrapText: true };
};

async function xlsx(res, data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY(); wb.created = new Date(data.generatedAt);
  const used = new Set();

  // summary sheet: letterhead text and headline figures with comparison
  const s = wb.addWorksheet(sheetName('Summary', used), { views: [{ showGridLines: false }] });
  s.columns = [{ width: 42 }, { width: 20 }, { width: 20 }, { width: 18 }, { width: 14 }];
  s.addRow([`${COMPANY()} · ${data.title}`]).font = { bold: true, size: 16, color: { argb: 'FF0A2B5E' } };
  s.addRow([`Period: ${periodText(data.range)}`]);
  s.addRow([compareText(data.range)]);
  s.addRow([`Prepared ${day(data.generatedAt)} by ${data.by}`]).font = { color: { argb: 'FF5A6A85' } };
  s.addRow([]);
  const hr = s.addRow(['Measure', 'This period', 'Previous period', 'Change', 'Change %']);
  hr.eachCell(headStyle);
  for (const k of data.kpis) {
    const has = k.prev !== null && k.prev !== undefined, d = has ? k.value - k.prev : null;
    const row = s.addRow([k.label, k.value, has ? k.prev : null, d, has && k.fmt !== 'pct' && k.prev ? (d / Math.abs(k.prev)) * 100 : null]);
    row.getCell(2).numFmt = row.getCell(3).numFmt = XL[k.fmt] || XL.num;
    row.getCell(4).numFmt = k.fmt === 'pct' ? XL.pts : k.fmt === 'money' ? XL.smoney : XL.snum;
    row.getCell(5).numFmt = XL.spct;
  }

  // one sheet per table, numbers kept as numbers
  for (const t of data.tables) {
    const ws = wb.addWorksheet(sheetName(t.title, used), { views: [{ state: 'frozen', ySplit: 3 }] });
    ws.addRow([t.title]).font = { bold: true, size: 13, color: { argb: 'FF0A2B5E' } };
    ws.addRow([`Period: ${periodText(data.range)}`]).font = { color: { argb: 'FF5A6A85' } };
    ws.addRow(t.cols.map(c => c.label)).eachCell(headStyle);
    ws.columns = t.cols.map((c, i) => ({ width: i === 0 ? 40 : 18 }));
    const put = (r, total) => {
      const row = ws.addRow(t.cols.map((c, j) => {
        const v = r[c.key];
        if (r.kind === 'header' && j) return null;
        return cellFmt(c, r) === 'date' && v ? new Date(v) : v ?? null;
      }));
      t.cols.forEach((c, j) => { const f = cellFmt(c, r); if (f) row.getCell(j + 1).numFmt = XL[f] || XL.num; });
      const kind = total ? 'total' : r.kind;
      if (['header', 'subtotal', 'total'].includes(kind)) row.font = { bold: true, color: kind === 'header' ? { argb: 'FF0A2B5E' } : undefined };
      if (kind === 'header') row.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EDF6' } }; });
      if (kind === 'subtotal' || kind === 'total') row.eachCell({ includeEmpty: true }, c => { c.border = { top: { style: 'thin' }, ...(kind === 'total' && { bottom: { style: 'double' } }) }; });
    };
    t.rows.forEach(r => put(r));
    if (t.total && t.rows.length) put(t.total, true);
    if (t.note) { ws.addRow([]); ws.addRow([t.note]).font = { italic: true, color: { argb: 'FF5A6A85' } }; }
  }
  await wb.xlsx.write(res);
  res.end();
}

async function exportReport(res, format, data) {
  const file = `${data.name}-report-${data.range.from ? `${isoDay(data.range.from)}-to-${isoDay(data.range.to || new Date())}` : 'all-time'}.${format}`;
  res.set('Content-Disposition', `attachment; filename="${file}"`);
  if (format === 'xlsx') {
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return xlsx(res, data);
  }
  res.type('application/pdf');
  return pdf(res, data);
}

module.exports = { exportReport, fmt };
