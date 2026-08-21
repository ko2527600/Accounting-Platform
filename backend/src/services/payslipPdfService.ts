// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit');
import type { PayrollRunRecord, PayslipRecord, EmployeeRecord } from './payrollService';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmt(n: number): string {
  return new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function drawHRule(doc: InstanceType<typeof PDFDocument>, y: number, margin: number): void {
  doc.moveTo(margin, y).lineTo(doc.page.width - margin, y).strokeColor('#cccccc').lineWidth(0.5).stroke();
}

/** Renders a single payslip page into an existing PDFDocument. */
function renderPayslip(
  doc: InstanceType<typeof PDFDocument>,
  run: PayrollRunRecord,
  slip: PayslipRecord,
  emp: EmployeeRecord,
  companyName: string,
  addPage: boolean
): void {
  if (addPage) doc.addPage();

  const margin = 50;
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Header bar
  doc.rect(margin, y, contentWidth, 36).fillColor('#1e3a5f').fill();
  doc.fillColor('#ffffff').fontSize(14).font('Helvetica-Bold')
     .text(companyName, margin + 10, y + 10, { width: contentWidth - 20 });
  doc.fillColor('#a0c4ff').fontSize(9).font('Helvetica')
     .text('EMPLOYEE PAYSLIP', margin + 10, y + 26, { width: contentWidth - 20 });
  y += 48;

  // Period and run number
  doc.fillColor('#444444').fontSize(9).font('Helvetica')
     .text(`Pay Period: ${MONTHS[run.periodMonth - 1]} ${run.periodYear}`, margin, y)
     .text(`Run No: ${run.runNumber}`, margin + contentWidth / 2, y, { align: 'right', width: contentWidth / 2 });
  y += 18;

  drawHRule(doc, y, margin);
  y += 10;

  // Employee info grid
  const col1 = margin;
  const col2 = margin + contentWidth / 2;
  const labelColor = '#888888';
  const valueColor = '#111111';

  function infoRow(label1: string, val1: string, label2: string, val2: string): void {
    doc.fillColor(labelColor).fontSize(8).font('Helvetica').text(label1, col1, y);
    doc.fillColor(valueColor).fontSize(9).font('Helvetica-Bold').text(val1, col1, y + 9, { width: contentWidth / 2 - 10 });
    doc.fillColor(labelColor).fontSize(8).font('Helvetica').text(label2, col2, y);
    doc.fillColor(valueColor).fontSize(9).font('Helvetica-Bold').text(val2, col2, y + 9, { width: contentWidth / 2 });
    y += 26;
  }

  infoRow('Employee Name', `${emp.firstName} ${emp.lastName}`, 'Employee No.', emp.employeeNumber);
  infoRow('Position', emp.position || '—', 'Department', emp.department || '—');
  infoRow('Email', emp.email || '—', 'Join Date', emp.dateOfJoining || '—');

  y += 4;
  drawHRule(doc, y, margin);
  y += 14;

  // Earnings / Deductions table
  doc.fillColor('#1e3a5f').fontSize(10).font('Helvetica-Bold').text('EARNINGS', col1, y);
  doc.fillColor('#1e3a5f').text('DEDUCTIONS', col2, y);
  y += 16;

  const rowH = 18;

  function tableRow(label: string, amount: number, col: number, bold = false): void {
    doc.fillColor(bold ? '#111111' : '#333333').fontSize(9)
       .font(bold ? 'Helvetica-Bold' : 'Helvetica')
       .text(label, col, y, { width: contentWidth / 2 - 10 });
    doc.text(`GHS ${fmt(amount)}`, col, y, { align: 'right', width: contentWidth / 2 - 10 });
  }

  const isMultiCurrency = slip.salaryCurrency && slip.salaryCurrency !== 'GHS';
  const basicLabel = isMultiCurrency
    ? `Basic Salary (${slip.salaryCurrency} ${fmt(slip.grossSalaryForeign)} @ ${slip.exchangeRate})`
    : 'Basic Salary';
  tableRow(basicLabel, slip.grossSalary, col1);
  if (slip.unpaidLeaveDeduction > 0) {
    tableRow('Unpaid Leave Deduction', slip.unpaidLeaveDeduction, col1);
    y += rowH;
  }
  tableRow('PAYE Income Tax', slip.paye, col2);
  y += rowH;
  if (slip.loanDeduction > 0) {
    tableRow('Loan / Salary Advance', slip.loanDeduction, col2);
    y += rowH;
  }
  tableRow('Employee SSNIT (5.5%)', slip.ssnitEmployee, col2);
  y += rowH;
  y += 4;
  drawHRule(doc, y, margin);
  y += 8;

  // Totals
  doc.fillColor('#444444').fontSize(8).font('Helvetica').text('Total Earnings', col1, y);
  doc.fillColor('#111111').fontSize(10).font('Helvetica-Bold')
     .text(`GHS ${fmt(slip.grossSalary)}`, col1, y + 1, { align: 'right', width: contentWidth / 2 - 10 });

  doc.fillColor('#444444').fontSize(8).font('Helvetica').text('Total Deductions', col2, y);
  const totalDed = slip.paye + slip.ssnitEmployee + slip.loanDeduction + slip.unpaidLeaveDeduction;
  doc.fillColor('#111111').fontSize(10).font('Helvetica-Bold')
     .text(`GHS ${fmt(totalDed)}`, col2, y + 1, { align: 'right', width: contentWidth / 2 - 10 });

  y += 24;
  drawHRule(doc, y, margin);
  y += 14;

  // Net pay highlight
  doc.rect(margin, y, contentWidth, 30).fillColor('#e8f4e8').fill();
  doc.fillColor('#1a5c1a').fontSize(11).font('Helvetica-Bold')
     .text('NET PAY', margin + 10, y + 9)
     .text(`GHS ${fmt(slip.netPay)}`, margin + 10, y + 9, { align: 'right', width: contentWidth - 20 });
  y += 44;

  // Employer SSNIT note
  doc.rect(margin, y, contentWidth, 24).fillColor('#f5f5f5').fill();
  doc.fillColor('#666666').fontSize(8).font('Helvetica')
     .text(`Employer SSNIT Contribution (13%): GHS ${fmt(slip.ssnitEmployer)}  — paid by employer, not deducted from salary`, margin + 8, y + 8, { width: contentWidth - 16 });
  y += 32;

  // Footer
  doc.fillColor('#aaaaaa').fontSize(7).font('Helvetica')
     .text('This is a computer-generated payslip. No signature required.', margin, y, { align: 'center', width: contentWidth });
}

/** Generates a PDF buffer for a single payslip. */
export async function generatePayslipPdf(
  run: PayrollRunRecord,
  slip: PayslipRecord,
  emp: EmployeeRecord,
  companyName: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Payslip - ${emp.firstName} ${emp.lastName} - ${MONTHS[run.periodMonth - 1]} ${run.periodYear}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    renderPayslip(doc, run, slip, emp, companyName, false);
    doc.end();
  });
}

/** Generates a single PDF containing all payslips in a run (one page each). */
export async function generatePayrollRunPdf(
  run: PayrollRunRecord,
  companyName: string
): Promise<Buffer> {
  const payslips = run.payslips || [];
  if (!payslips.length) throw new Error('No payslips in this run.');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Payroll Run ${run.runNumber}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    payslips.forEach((slip, idx) => {
      const emp = slip.employee;
      if (!emp) return;
      renderPayslip(doc, run, slip, emp, companyName, idx > 0);
    });

    doc.end();
  });
}
