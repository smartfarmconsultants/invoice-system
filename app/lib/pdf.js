const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

const LETTERHEAD_PATH = path.join(__dirname, '..', 'assets', 'letterhead.png');

// Reads width/height straight from a PNG's IHDR chunk (bytes 16-23), so we
// can compute exactly how much vertical space a scaled image will occupy
// instead of guessing with moveDown(n) — that guesswork is what caused the
// letterhead to overlap the "Invoice #" text before.
function getPngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

// Streams a formatted invoice PDF straight to the HTTP response.
// invoice: row from `invoices` joined with customer fields
// items: rows from `invoice_items`
async function streamInvoicePdf(res, invoice, items, company) {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
  doc.pipe(res);

  // Header — use the company's real letterhead image if present, falling
  // back to a plain text header so a missing asset never breaks PDF export.
  if (fs.existsSync(LETTERHEAD_PATH)) {
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const { width: imgW, height: imgH } = getPngDimensions(LETTERHEAD_PATH);
    const renderedHeight = pageWidth * (imgH / imgW);
    const startY = doc.y;

    doc.image(LETTERHEAD_PATH, doc.page.margins.left, startY, { width: pageWidth });
    doc.y = startY + renderedHeight + 10; // exact space used by the image, plus a small gap

    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(1.2);
  } else {
    doc.fontSize(18).text(company.name, { continued: false });
    doc.fontSize(9).fillColor('#555')
      .text(company.address)
      .text(company.contact);
    doc.moveDown();
  }

  doc.fillColor('#000').fontSize(16).text(`Invoice ${invoice.invoice_number}`, { align: 'right' });
  doc.fontSize(10)
    .text(`Date: ${new Date(invoice.invoice_date).toLocaleDateString()}`, { align: 'right' })
    .text(`Due: ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : '-'}`, { align: 'right' });
  doc.moveDown(1.5);

  // Bill to
  doc.fontSize(11).text('Bill To:', { underline: true });
  doc.fontSize(10)
    .text(invoice.customer_name)
    .text(invoice.customer_address || '')
    .text(invoice.customer_email || '');
  doc.moveDown(1.5);

  // Item table header
  const tableTop = doc.y;
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('Description', 50, tableTop);
  doc.text('Qty', 300, tableTop, { width: 60, align: 'right' });
  doc.text('Unit Price', 360, tableTop, { width: 90, align: 'right' });
  doc.text('Amount', 460, tableTop, { width: 90, align: 'right' });
  doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
  doc.font('Helvetica');

  let y = tableTop + 22;
  items.forEach((item) => {
    doc.fontSize(10).text(item.description, 50, y, { width: 240 });
    doc.text(String(item.quantity), 300, y, { width: 60, align: 'right' });
    doc.text(Number(item.unit_price).toFixed(2), 360, y, { width: 90, align: 'right' });
    doc.text(Number(item.amount).toFixed(2), 460, y, { width: 90, align: 'right' });
    y += 20;
  });

  doc.moveTo(50, y + 5).lineTo(550, y + 5).stroke();
  y += 15;

  doc.text('Subtotal (excl. VAT):', 320, y, { width: 130, align: 'right' });
  doc.text(Number(invoice.subtotal).toFixed(2), 460, y, { width: 90, align: 'right' });
  y += 18;
  doc.text('VAT:', 320, y, { width: 130, align: 'right' });
  doc.text(Number(invoice.tax).toFixed(2), 460, y, { width: 90, align: 'right' });
  y += 18;
  doc.font('Helvetica-Bold');
  doc.text('Total (VAT inclusive):', 320, y, { width: 130, align: 'right' });
  doc.text(Number(invoice.total).toFixed(2), 460, y, { width: 90, align: 'right' });
  doc.font('Helvetica');

  doc.y = y + 45;
  doc.fontSize(9).fillColor('#555').text(
    'Payment instructions: ' + (company.paymentInstructions || 'Bank transfer — details on file.'),
    50,
    doc.y,
    { width: 500 }
  );

  doc.moveDown(2);
  doc.fillColor('#000').fontSize(10).text('Scan to verify invoice:', 50, doc.y);

  const qrText = `Invoice: ${invoice.invoice_number}\nTotal: ${Number(invoice.total).toFixed(2)}\n${company.name}`;
  const qrDataUrl = await QRCode.toDataURL(qrText, { margin: 1, width: 200 });
  const qrBase64 = qrDataUrl.split(',')[1];
  const qrBuffer = Buffer.from(qrBase64, 'base64');

  const qrSize = 60; // small on purpose — just enough to scan cleanly
  doc.image(qrBuffer, 200, doc.y - 12, { width: qrSize, height: qrSize });

  doc.end();
}

module.exports = { streamInvoicePdf };
