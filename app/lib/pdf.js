const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { buildInvoiceReference } = require('./invoiceReference');

const LETTERHEAD_PATH = path.join(__dirname, '..', 'assets', 'letterhead.png');

// Reads width/height straight from a PNG's IHDR chunk (bytes 16-23), so we
// can compute exactly how much vertical space a scaled image will occupy
// instead of guessing with moveDown(n).
function getPngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

// PDFKit's standard 14 fonts (Helvetica etc.) use WinAnsiEncoding, which
// does not include the ∞ (U+221E) glyph — asking for it silently falls
// back to an unrelated character (a stray quote mark in practice). Rather
// than embed a whole extra Unicode font just for one symbol, we draw a
// small infinity glyph as a vector shape (two touching circles), which
// renders identically in every PDF viewer with no font dependency at all.
function drawInfinityIcon(doc, x, y, size, color) {
  const r = size / 4;
  doc.save();
  doc.lineWidth(0.9).strokeColor(color);
  doc.circle(x + r, y, r).stroke();
  doc.circle(x + size - r, y, r).stroke();
  doc.restore();
}

// Streams a formatted invoice PDF straight to the HTTP response.
// invoice: row from `invoices` joined with customer fields
// items: rows from `invoice_items`
async function streamInvoicePdf(res, invoice, items, company) {
  const doc = new PDFDocument({ margin: 50, autoFirstPage: true, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
  doc.pipe(res);

  // Reserve a fixed-height footer band at the very bottom of every page so
  // nothing else can ever grow into the credit line.
  const footerHeight = 30;
  const footerTopY = doc.page.height - doc.page.margins.bottom - footerHeight;
  // Anything drawn below this line risks colliding with the reserved
  // footer band — used to decide when to start a fresh page.
  const contentBottomLimit = footerTopY - 10;

  function drawFooter() {
    const prefix = 'Designed by STAS  ·  Powered by ';
    const suffix = ' Infinity Champ';
    const fontSize = 8;
    const color = '#999';
    doc.fontSize(fontSize).fillColor(color);

    const prefixWidth = doc.widthOfString(prefix);
    const suffixWidth = doc.widthOfString(suffix);
    const iconSize = 8;
    const iconGap = 3;
    const totalWidth = prefixWidth + iconGap + iconSize + iconGap + suffixWidth;
    const contentAreaWidth = 500;
    const startX = 50 + (contentAreaWidth - totalWidth) / 2;
    const textY = footerTopY + 10;

    doc.text(prefix, startX, textY, { lineBreak: false });
    const iconX = startX + prefixWidth + iconGap;
    const iconY = textY + fontSize / 2 - 1;
    drawInfinityIcon(doc, iconX, iconY, iconSize, color);
    doc.text(suffix, iconX + iconSize + iconGap, textY, { lineBreak: false });
  }

  function drawTableHeader(topY) {
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000');
    doc.text('Description', 50, topY);
    doc.text('Qty', 300, topY, { width: 60, align: 'right' });
    doc.text('Unit Price', 360, topY, { width: 90, align: 'right' });
    doc.text('Amount', 460, topY, { width: 90, align: 'right' });
    doc.moveTo(50, topY + 15).lineTo(550, topY + 15).stroke();
    doc.font('Helvetica');
    return topY + 22;
  }

  // Header — use the company's real letterhead image if present, falling
  // back to a plain text header so a missing asset never breaks PDF export.
  if (fs.existsSync(LETTERHEAD_PATH)) {
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const { width: imgW, height: imgH } = getPngDimensions(LETTERHEAD_PATH);
    const renderedHeight = pageWidth * (imgH / imgW);
    const startY = doc.y;

    doc.image(LETTERHEAD_PATH, doc.page.margins.left, startY, { width: pageWidth });
    doc.y = startY + renderedHeight + 10;

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
    .text(`Due: ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : '-'}`, { align: 'right' })
    .text(`Status: ${invoice.status.toUpperCase()}`, { align: 'right' });
  doc.moveDown(1.5);

  // Bill to
  doc.fontSize(11).text('Bill To:', { underline: true });
  doc.fontSize(10)
    .text(invoice.customer_name)
    .text(invoice.customer_address || '')
    .text(invoice.customer_email || '');
  doc.moveDown(1.5);

  // Item table — explicitly paginated ourselves rather than relying on
  // PDFKit's implicit auto-pagination, which behaves erratically once
  // absolute-positioned content runs past a page's bottom margin (this
  // was the actual cause of invoices with many line items generating a
  // dozen near-blank, overlapping-text pages instead of a clean layout).
  const rowHeight = 20;
  let y = drawTableHeader(doc.y);

  items.forEach((item) => {
    if (y + rowHeight > contentBottomLimit) {
      doc.addPage();
      y = drawTableHeader(doc.page.margins.top);
    }
    doc.fontSize(10).fillColor('#000').text(item.description, 50, y, { width: 240 });
    doc.text(String(item.quantity), 300, y, { width: 60, align: 'right' });
    doc.text(Number(item.unit_price).toFixed(2), 360, y, { width: 90, align: 'right' });
    doc.text(Number(item.amount).toFixed(2), 460, y, { width: 90, align: 'right' });
    y += rowHeight;
  });

  const reference = buildInvoiceReference(invoice);
  const hasDiscount = reference.discount > 0;

  // Totals block: 3 lines normally, +2 more if there's a discount to show.
  const totalsBlockHeight = hasDiscount ? 106 : 70;
  if (y + totalsBlockHeight > contentBottomLimit) {
    doc.addPage();
    y = doc.page.margins.top;
  }

  doc.moveTo(50, y + 5).lineTo(550, y + 5).stroke();
  y += 15;

  doc.fillColor('#000');
  doc.text('Subtotal (excl. VAT):', 320, y, { width: 130, align: 'right' });
  doc.text(Number(invoice.subtotal).toFixed(2), 460, y, { width: 90, align: 'right' });
  y += 18;
  doc.text('VAT:', 320, y, { width: 130, align: 'right' });
  doc.text(Number(invoice.tax).toFixed(2), 460, y, { width: 90, align: 'right' });
  y += 18;

  if (hasDiscount) {
    doc.text('Total (VAT inclusive):', 320, y, { width: 130, align: 'right' });
    doc.text(Number(invoice.total).toFixed(2), 460, y, { width: 90, align: 'right' });
    y += 18;
    doc.text('Discount:', 320, y, { width: 130, align: 'right' });
    doc.text('-' + Number(reference.discount).toFixed(2), 460, y, { width: 90, align: 'right' });
    y += 18;
    doc.font('Helvetica-Bold');
    doc.text('Amount Due:', 320, y, { width: 130, align: 'right' });
    doc.text(reference.amount, 460, y, { width: 90, align: 'right' });
    doc.font('Helvetica');
  } else {
    doc.font('Helvetica-Bold');
    doc.text('Total (VAT inclusive):', 320, y, { width: 130, align: 'right' });
    doc.text(Number(invoice.total).toFixed(2), 460, y, { width: 90, align: 'right' });
    doc.font('Helvetica');
  }

  // Reserve room for the whole trailing block (payment instructions +
  // reference line + QR label + QR code + gap). If what's left on this
  // page isn't enough, start a fresh page for this section — pushing
  // forward onto a new page rather than ever clamping backward into
  // content already drawn above it.
  const trailingBlockHeight = 175;
  if (y + 45 + trailingBlockHeight > footerTopY) {
    doc.addPage();
    doc.y = doc.page.margins.top;
  } else {
    doc.y = y + 45;
  }

  doc.fontSize(9).fillColor('#555').text(
    'Payment instructions: ' + (company.paymentInstructions || 'Bank transfer — details on file.'),
    50,
    doc.y,
    { width: 500 }
  );

  doc.moveDown(2);
  doc.fillColor('#000').fontSize(9).text(reference.displayText, 50, doc.y);

  doc.moveDown(1);
  doc.fontSize(10).text('Scan to verify invoice:', 50, doc.y);

  const qrDataUrl = await QRCode.toDataURL(reference.qrText, { margin: 1, width: 200 });
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  const qrSize = 60; // small on purpose — just enough to scan cleanly
  let qrY = doc.y - 12;

  // Final safety net for the rare case where payment instructions wrapped
  // to more lines than estimated: push to a new page rather than ever
  // overlapping. Never moves backward into already-drawn content.
  if (qrY + qrSize + 10 > footerTopY) {
    doc.addPage();
    doc.fontSize(10).fillColor('#000').text('Scan to verify invoice:', 50, doc.page.margins.top);
    qrY = doc.page.margins.top + 14;
  }

  doc.image(qrBuffer, 200, qrY, { width: qrSize, height: qrSize });

  // Draw the footer credit on every page that was generated, not just the
  // last one.
  const pageRange = doc.bufferedPageRange();
  for (let i = 0; i < pageRange.count; i++) {
    doc.switchToPage(pageRange.start + i);
    drawFooter();
  }

  doc.end();
}

module.exports = { streamInvoicePdf };
