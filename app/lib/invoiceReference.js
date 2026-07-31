// Builds a consistent "invoice reference" string — used both as visible
// text on the invoice and as the payload encoded into the QR code — so a
// scan and a glance always agree with each other.
//
// Dates/times are always rendered in Africa/Nairobi time regardless of
// what timezone the server itself is running in (e.g. Render's servers
// run in UTC), since this system serves a Kenyan business and its
// customers expect local time on their invoices.
const TIME_ZONE = 'Africa/Nairobi';

function getNairobiParts(date) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = {};
  formatter.formatToParts(date).forEach(({ type, value }) => {
    parts[type] = value;
  });
  return parts; // { year, month, day, hour, minute }
}

function buildInvoiceReference(invoice) {
  const invDate = new Date(invoice.invoice_date);
  const created = invoice.created_at ? new Date(invoice.created_at) : invDate;

  const dateParts = getNairobiParts(invDate);
  const timeParts = getNairobiParts(created);

  const yearMonth = `${dateParts.year}-${dateParts.month}`;
  const dateStr = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const timeStr = `${timeParts.hour}:${timeParts.minute} EAT`;

  const discount = Number(invoice.discount || 0);
  const amountDue = Math.max(0, Number(invoice.total) - discount);
  const amount = amountDue.toFixed(2);

  const displayText = `Ref: ${invoice.invoice_number}  ·  ${dateStr} ${timeStr}  ·  KES ${amount}`;
  const qrText =
    `Invoice: ${invoice.invoice_number}\n` +
    `Period: ${yearMonth}\n` +
    `Date: ${dateStr}\n` +
    `Time: ${timeStr}\n` +
    `Amount Due: KES ${amount}\n` +
    `Status: ${invoice.status}`;

  return { yearMonth, dateStr, timeStr, amount, amountDue, discount, displayText, qrText };
}

module.exports = { buildInvoiceReference };
