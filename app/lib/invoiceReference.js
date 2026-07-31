// Builds a consistent "invoice reference" string — used both as visible
// text on the invoice and as the payload encoded into the QR code — so a
// scan and a glance always agree with each other.
function buildInvoiceReference(invoice) {
  const pad = (n) => String(n).padStart(2, '0');

  const invDate = new Date(invoice.invoice_date);
  const created = invoice.created_at ? new Date(invoice.created_at) : invDate;

  const yearMonth = `${invDate.getFullYear()}-${pad(invDate.getMonth() + 1)}`;
  const dateStr = `${invDate.getFullYear()}-${pad(invDate.getMonth() + 1)}-${pad(invDate.getDate())}`;
  const timeStr = `${pad(created.getHours())}:${pad(created.getMinutes())}`;
  const amount = Number(invoice.total).toFixed(2);

  const displayText = `Ref: ${invoice.invoice_number}  ·  ${dateStr} ${timeStr}  ·  KES ${amount}`;
  const qrText =
    `Invoice: ${invoice.invoice_number}\n` +
    `Period: ${yearMonth}\n` +
    `Date: ${dateStr}\n` +
    `Time: ${timeStr}\n` +
    `Amount: KES ${amount}\n` +
    `Status: ${invoice.status}`;

  return { yearMonth, dateStr, timeStr, amount, displayText, qrText };
}

module.exports = { buildInvoiceReference };
