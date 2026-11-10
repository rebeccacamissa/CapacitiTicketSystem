'use strict';
/**
 * CSV and PDF export helpers.
 * CSV cells that start with = + - @ (or tab/CR) are prefixed with ' so spreadsheet apps
 * don't execute them as formulas (CSV injection).
 */
const PDFDocument = require('pdfkit');

const COLORS = { ink: '#1d2951', purple: '#6115d0', salmon: '#f25251', muted: '#6b7280', line: '#e5e7eb' };

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = Array.isArray(v) ? v.join('; ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  const head = columns.map(([, label]) => csvCell(label)).join(',');
  const body = rows.map((r) => columns.map(([key]) => csvCell(typeof key === 'function' ? key(r) : r[key])).join(','));
  return `﻿${[head, ...body].join('\r\n')}\r\n`; // BOM so Excel opens UTF-8 correctly
}

const stamp = () => new Date().toISOString().slice(0, 10);

function sendCsv(res, name, columns, rows) {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-${stamp()}.csv"`, 'Cache-Control': 'no-store' });
  res.send(toCsv(columns, rows));
}

/** Start a branded PDF streamed to the response. */
function startPdf(res, name, { title, subtitle, layout = 'landscape' }) {
  const doc = new PDFDocument({ size: 'A4', layout, margin: 36, info: { Title: title, Author: 'CAPACITI Support' } });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}-${stamp()}.pdf"`, 'Cache-Control': 'no-store' });
  doc.pipe(res);
  doc.rect(0, 0, doc.page.width, 54).fill(COLORS.ink);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14).text('CAPACITI', 36, 20, { characterSpacing: 2 });
  doc.fillColor(COLORS.ink).fontSize(18).text(title, 36, 72);
  if (subtitle) doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(`${subtitle} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  doc.moveDown(1);
  return doc;
}

/** A simple paginated table. widths: column widths in points (defaults to equal). */
function drawTable(doc, columns, rows, widths) {
  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const w = widths || columns.map(() => usable / columns.length);
  const scale = usable / w.reduce((a, b) => a + b, 0);
  const cw = w.map((x) => x * scale);
  const cell = (r, key) => { const v = typeof key === 'function' ? key(r) : r[key]; return v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v); };

  const header = () => {
    let x = left;
    const y = doc.y;
    doc.rect(left, y - 2, usable, 18).fill('#f4f2fb');
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(8);
    columns.forEach(([, label], i) => { doc.text(label, x + 3, y + 3, { width: cw[i] - 6, lineBreak: false, ellipsis: true }); x += cw[i]; });
    doc.y = y + 20;
  };
  header();
  doc.font('Helvetica').fontSize(8).fillColor('#111827');
  for (const r of rows) {
    const heights = columns.map(([key], i) => doc.heightOfString(cell(r, key), { width: cw[i] - 6 }));
    const h = Math.max(...heights, 10) + 6;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); header(); doc.font('Helvetica').fontSize(8).fillColor('#111827'); }
    const y = doc.y;
    let x = left;
    columns.forEach(([key], i) => { doc.text(cell(r, key), x + 3, y + 3, { width: cw[i] - 6 }); x += cw[i]; });
    doc.moveTo(left, y + h).lineTo(left + usable, y + h).strokeColor(COLORS.line).lineWidth(0.5).stroke();
    doc.y = y + h;
  }
  if (!rows.length) doc.fillColor(COLORS.muted).text('No records.', left, doc.y + 6);
}

function sendTablePdf(res, name, { title, subtitle, columns, rows, widths }) {
  const doc = startPdf(res, name, { title, subtitle });
  drawTable(doc, columns, rows, widths);
  doc.end();
}

module.exports = { toCsv, csvCell, sendCsv, startPdf, drawTable, sendTablePdf, COLORS };
