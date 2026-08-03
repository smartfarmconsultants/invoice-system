// Minimal CSV writer — good enough for exporting invoice/customer tables,
// opens directly in Excel/Google Sheets/Numbers without any extra library.

function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Quote any field containing a comma, quote, or newline, doubling
  // internal quotes per the CSV spec.
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCsv(columns, rows) {
  const header = columns.map((c) => escapeCsvField(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvField(typeof c.value === 'function' ? c.value(row) : row[c.value])).join(',')
  );
  return [header, ...lines].join('\r\n');
}

module.exports = { toCsv };
