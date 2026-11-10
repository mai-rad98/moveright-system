const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const M = require('./models');

// ---------- Botswana PAYE (residents) ----------
// Annual bands from BURS. Check these each tax year (July) and update here if they change.
const PAYE_BANDS = [            // [from, tax at `from`, rate above `from`]
  [0, 0, 0],
  [48000, 0, 0.05],
  [84000, 1800, 0.125],
  [120000, 6300, 0.1875],
  [156000, 13050, 0.25],
];
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const sum = a => (a || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);

// Monthly PAYE on monthly taxable pay: work out the annual tax, then take a twelfth
function paye(monthly) {
  const year = Math.max(0, Number(monthly) || 0) * 12;
  const [from, base, rate] = [...PAYE_BANDS].reverse().find(([f]) => year > f) || PAYE_BANDS[0];
  return r2((base + (year - from) * rate) / 12);
}

// Fill in gross, PAYE, deductions and net on a payslip
function recalc(p) {
  p.gross = r2((Number(p.basic) || 0) + sum(p.allowances));
  p.paye = p.payeOverride === null || p.payeOverride === undefined ? paye(p.gross) : r2(p.payeOverride);
  p.totalDeductions = r2(p.paye + sum(p.deductions));
  p.net = r2(p.gross - p.totalDeductions);
  return p;
}

async function updateTotals(runId) {
  const slips = await M.Payslip.find({ run: runId }).lean();
  const t = k => r2(slips.reduce((s, x) => s + (x[k] || 0), 0));
  const totals = { employees: slips.length, gross: t('gross'), paye: t('paye'), deductions: r2(t('totalDeductions') - t('paye')), net: t('net') };
  return M.PayrollRun.findByIdAndUpdate(runId, { totals }, { new: true });
}

// ---------- dates (Gaborone is UTC+2) ----------
const gaborone = () => new Date(Date.now() + 2 * 3600e3);
const thisPeriod = () => gaborone().toISOString().slice(0, 7);
const payDateOf = period => new Date(period + '-28T12:00:00+02:00');

// One payslip per active employee who had started by pay day
async function addPayslips(run) {
  const staff = await M.Employee.find({ status: 'active', salary: { $gt: 0 }, $or: [{ startDate: null }, { startDate: { $lte: run.payDate } }] }).lean();
  await M.Payslip.insertMany(staff.map(e => recalc({
    run: run._id, employee: e._id, period: run.period, payDate: run.payDate,
    name: `${e.firstName} ${e.surname}`, jobTitle: e.jobTitle, idNumber: e.idNumber, email: e.email, bankName: e.bankName, bankAccount: e.bankAccount,
    basic: e.salary || 0, allowances: [], deductions: (e.deductions || []).map(({ name, amount }) => ({ name, amount })), payeOverride: null,
  })));
  return updateTotals(run._id);
}

// Draft the payroll for a month (once: the period is unique)
async function draftRun(period) {
  const run = await M.PayrollRun.create({ period, payDate: payDateOf(period) });
  return addPayslips(run);
}

// From the 28th, make sure this month's payroll exists as a draft. Safe to call often.
async function ensureDraft() {
  if (gaborone().getUTCDate() < 28) return null;
  const period = thisPeriod();
  if (await M.PayrollRun.exists({ period })) return null;
  try { return await draftRun(period); } catch (e) { if (e.code === 11000) return null; throw e; }
}

// ---------- payslip PDF ----------
const LOGO = path.join(__dirname, 'assets', 'logo.png');      // small copy of client/public/logo.png, keeps PDFs light
const NAVY = '#0a2b5e', ORANGE = '#ff6a00', GREY = '#5a6a85', LINE = '#dfe5ee';
const P = n => 'P ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthName = period => new Date(period + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const day = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Gaborone' }) : '');

function payslipPdf(slip, run, res, download) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Payslip ${slip.name} ${slip.period}`, Author: process.env.COMPANY_NAME || 'MoveRight' } });
  const file = `payslip-${slip.period}-${slip.name.replace(/[^\w]+/g, '-').toLowerCase()}.pdf`;
  res.type('application/pdf').set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${file}"`);
  doc.pipe(res);
  const L = 50, R = 545, W = R - L;

  // header: logo, company, title
  if (fs.existsSync(LOGO)) doc.image(LOGO, L, 45, { fit: [64, 64] });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text(process.env.COMPANY_NAME || 'MoveRight', L + 78, 52);
  doc.fillColor(GREY).font('Helvetica').fontSize(9).text(process.env.COMPANY_ADDRESS || 'Gaborone, Botswana', L + 78, 75, { width: 250 });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20).text('PAYSLIP', L, 52, { width: W, align: 'right' });
  doc.fillColor(GREY).font('Helvetica').fontSize(10).text(monthName(slip.period), L, 78, { width: W, align: 'right' });
  doc.rect(L, 118, W, 3).fill(ORANGE);
  if (run.status !== 'final') {
    doc.save().rotate(-30, { origin: [300, 420] }).fillColor('#c0392b').opacity(0.12).font('Helvetica-Bold').fontSize(110).text('DRAFT', 90, 360).restore();
    doc.opacity(1);
  }

  // employee and pay details, two columns
  const info = (label, value, x, y) => {
    doc.fillColor(GREY).font('Helvetica').fontSize(8).text(label.toUpperCase(), x, y);
    doc.fillColor('#1c2a44').font('Helvetica-Bold').fontSize(10.5).text(value || '-', x, y + 11, { width: 230 });
  };
  info('Employee', slip.name, L, 138); info('Pay period', monthName(slip.period), 310, 138);
  info('Job title', slip.jobTitle, L, 172); info('Pay date', day(slip.payDate), 310, 172);
  info('Omang / passport', slip.idNumber, L, 206); info('Bank', [slip.bankName, slip.bankAccount].filter(Boolean).join(' · '), 310, 206);

  // a ledger-style table with a heading row and a bold total
  const table = (title, rows, totalLabel, total, y) => {
    doc.rect(L, y, W, 22).fill('#eef2f8');
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text(title, L + 10, y + 7).text('Amount', L, y + 7, { width: W - 10, align: 'right' });
    y += 22;
    for (const [label, amount] of rows) {
      doc.fillColor('#1c2a44').font('Helvetica').fontSize(10).text(label, L + 10, y + 7, { width: W - 140 }).text(P(amount), L, y + 7, { width: W - 10, align: 'right' });
      y += 22; doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINE).stroke();
    }
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text(totalLabel, L + 10, y + 7).text(P(total), L, y + 7, { width: W - 10, align: 'right' });
    y += 22; doc.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(NAVY).stroke();
    return y + 18;
  };
  let y = table('Earnings', [['Basic salary', slip.basic], ...(slip.allowances || []).map(a => [a.name, a.amount])], 'Total earnings (gross)', slip.gross, 250);
  y = table('Deductions', [[slip.payeOverride === null || slip.payeOverride === undefined ? 'PAYE (income tax)' : 'PAYE (income tax, adjusted)', slip.paye],
    ...(slip.deductions || []).map(d => [d.name, d.amount])], 'Total deductions', slip.totalDeductions, y);

  // net pay
  doc.rect(L, y, W, 44).fill(NAVY);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(13).text('NET PAY', L + 14, y + 15).fontSize(16).text(P(slip.net), L, y + 13, { width: W - 14, align: 'right' });

  doc.fillColor(GREY).font('Helvetica').fontSize(8)
    .text(`Computer-generated payslip${run.status !== 'final' ? ' (DRAFT, not yet approved)' : ''}. Generated ${day(new Date())}. Please report any errors to the administrator.`, L, 770, { width: W, align: 'center' });
  doc.end();
}

module.exports = { paye, recalc, updateTotals, draftRun, ensureDraft, addPayslips, payslipPdf, thisPeriod, PAYE_BANDS };
