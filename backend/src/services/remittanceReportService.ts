// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit');
import type { PayrollRunRecord, PayslipRecord } from './payrollService';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmt(n: number): string {
  return new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export interface RemittanceLineItem {
  employeeNumber: string;
  employeeName: string;
  grossSalary: number;
  payeWithheld: number;
  ssnitEmployee: number;
  ssnitEmployer: number;
  totalSsnit: number;
}

export interface RemittanceReport {
  runNumber: string;
  periodMonth: number;
  periodYear: number;
  periodLabel: string;
  companyName: string;
  lines: RemittanceLineItem[];
  totalGross: number;
  totalPaye: number;
  totalSsnitEmployee: number;
  totalSsnitEmployer: number;
  totalSsnit: number;
}

export function buildRemittanceReport(run: PayrollRunRecord, companyName: string): RemittanceReport {
  const payslips: PayslipRecord[] = run.payslips || [];
  const lines: RemittanceLineItem[] = payslips.map((slip) => ({
    employeeNumber: slip.employee?.employeeNumber ?? '—',
    employeeName: slip.employee ? `${slip.employee.firstName} ${slip.employee.lastName}` : slip.employeeId,
    grossSalary: slip.grossSalary,
    payeWithheld: slip.paye,
    ssnitEmployee: slip.ssnitEmployee,
    ssnitEmployer: slip.ssnitEmployer,
    totalSsnit: Math.round((slip.ssnitEmployee + slip.ssnitEmployer) * 100) / 100,
  }));

  return {
    runNumber: run.runNumber,
    periodMonth: run.periodMonth,
    periodYear: run.periodYear,
    periodLabel: `${MONTHS[run.periodMonth - 1]} ${run.periodYear}`,
    companyName,
    lines,
    totalGross: run.totalGross,
    totalPaye: run.totalPaye,
    totalSsnitEmployee: run.totalSsnitEmployee,
    totalSsnitEmployer: run.totalSsnitEmployer,
    totalSsnit: Math.round((run.totalSsnitEmployee + run.totalSsnitEmployer) * 100) / 100,
  };
}

/** Generates a GRA-formatted PAYE & SSNIT remittance PDF. */
export async function generateRemittancePdf(report: RemittanceReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Remittance Report - ${report.periodLabel}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const margin = 40;
    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    // Header
    doc.rect(margin, y, contentWidth, 48).fillColor('#003366').fill();
    doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold')
       .text('GHANA REVENUE AUTHORITY', margin + 10, y + 6, { width: contentWidth - 20 });
    doc.fillColor('#aaccff').fontSize(9).font('Helvetica')
       .text('PAYE & SSNIT Remittance Schedule', margin + 10, y + 22, { width: contentWidth - 20 });
    doc.fillColor('#ffffff').fontSize(8)
       .text(`Period: ${report.periodLabel}`, margin + 10, y + 34, { width: contentWidth - 20 });
    y += 58;

    // Employer info
    doc.fillColor('#333333').fontSize(9).font('Helvetica')
       .text(`Employer: ${report.companyName}`, margin, y)
       .text(`Run Ref: ${report.runNumber}`, margin + contentWidth / 2, y, { align: 'right', width: contentWidth / 2 });
    y += 20;

    // Table
    const cols = {
      no: margin,
      name: margin + 32,
      gross: margin + 200,
      paye: margin + 290,
      ssnitEmp: margin + 360,
      ssnitEr: margin + 430,
      totalSsnit: margin + 500,
    };

    // Table header
    doc.rect(margin, y, contentWidth, 18).fillColor('#003366').fill();
    doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold');
    doc.text('#', cols.no, y + 5, { width: 28 });
    doc.text('Employee', cols.name, y + 5, { width: 164 });
    doc.text('Gross (GHS)', cols.gross, y + 5, { width: 85, align: 'right' });
    doc.text('PAYE (GHS)', cols.paye, y + 5, { width: 65, align: 'right' });
    doc.text('SSNIT Emp (GHS)', cols.ssnitEmp, y + 5, { width: 65, align: 'right' });
    doc.text('SSNIT Er (GHS)', cols.ssnitEr, y + 5, { width: 65, align: 'right' });
    doc.text('Total SSNIT', cols.totalSsnit, y + 5, { width: pageWidth - cols.totalSsnit - margin, align: 'right' });
    y += 20;

    report.lines.forEach((line, idx) => {
      const rowBg = idx % 2 === 0 ? '#f9f9f9' : '#ffffff';
      doc.rect(margin, y, contentWidth, 16).fillColor(rowBg).fill();
      doc.fillColor('#222222').fontSize(7).font('Helvetica');
      doc.text(String(idx + 1), cols.no, y + 4, { width: 28 });
      doc.text(`${line.employeeName} (${line.employeeNumber})`, cols.name, y + 4, { width: 164 });
      doc.text(fmt(line.grossSalary), cols.gross, y + 4, { width: 85, align: 'right' });
      doc.text(fmt(line.payeWithheld), cols.paye, y + 4, { width: 65, align: 'right' });
      doc.text(fmt(line.ssnitEmployee), cols.ssnitEmp, y + 4, { width: 65, align: 'right' });
      doc.text(fmt(line.ssnitEmployer), cols.ssnitEr, y + 4, { width: 65, align: 'right' });
      doc.text(fmt(line.totalSsnit), cols.totalSsnit, y + 4, { width: pageWidth - cols.totalSsnit - margin, align: 'right' });
      y += 16;

      // Page break if needed
      if (y > doc.page.height - 80 && idx < report.lines.length - 1) {
        doc.addPage();
        y = margin;
      }
    });

    // Totals row
    doc.rect(margin, y, contentWidth, 18).fillColor('#003366').fill();
    doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold');
    doc.text('TOTALS', cols.no, y + 5, { width: 200 });
    doc.text(fmt(report.totalGross), cols.gross, y + 5, { width: 85, align: 'right' });
    doc.text(fmt(report.totalPaye), cols.paye, y + 5, { width: 65, align: 'right' });
    doc.text(fmt(report.totalSsnitEmployee), cols.ssnitEmp, y + 5, { width: 65, align: 'right' });
    doc.text(fmt(report.totalSsnitEmployer), cols.ssnitEr, y + 5, { width: 65, align: 'right' });
    doc.text(fmt(report.totalSsnit), cols.totalSsnit, y + 5, { width: pageWidth - cols.totalSsnit - margin, align: 'right' });
    y += 28;

    // Summary boxes
    const boxW = (contentWidth - 10) / 2;
    doc.rect(margin, y, boxW, 36).fillColor('#fff3cd').fill()
       .rect(margin + boxW + 10, y, boxW, 36).fillColor('#d4edda').fill();

    doc.fillColor('#7d5a00').fontSize(8).font('Helvetica-Bold')
       .text('Total PAYE to Remit to GRA', margin + 6, y + 5, { width: boxW - 10 });
    doc.fillColor('#333333').fontSize(12).font('Helvetica-Bold')
       .text(`GHS ${fmt(report.totalPaye)}`, margin + 6, y + 17, { width: boxW - 10 });

    doc.fillColor('#155724').fontSize(8).font('Helvetica-Bold')
       .text('Total SSNIT to Remit', margin + boxW + 16, y + 5, { width: boxW - 10 });
    doc.fillColor('#333333').fontSize(12).font('Helvetica-Bold')
       .text(`GHS ${fmt(report.totalSsnit)}`, margin + boxW + 16, y + 17, { width: boxW - 10 });

    y += 50;

    // Footer
    doc.fillColor('#888888').fontSize(7).font('Helvetica')
       .text(
         `Generated on ${new Date().toLocaleDateString('en-GH', { day: '2-digit', month: 'long', year: 'numeric' })}  ·  This schedule must be accompanied by the corresponding payment receipts.`,
         margin, y, { align: 'center', width: contentWidth }
       );

    doc.end();
  });
}
