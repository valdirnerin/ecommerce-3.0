const XLSX = require('xlsx');

function buildCsvContent(breakdown) {
  const lines = [['Concepto', 'Valor']];
  for (const [key, value] of Object.entries(breakdown)) {
    lines.push([key, value]);
  }
  return lines.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function buildCsvBuffer(breakdown) {
  return Buffer.from(buildCsvContent(breakdown), 'utf8');
}

function buildXlsxBuffer(breakdown) {
  const worksheetData = [['Concepto', 'Valor']];
  for (const [key, value] of Object.entries(breakdown)) {
    worksheetData.push([key, value]);
  }
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Calculo');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function defaultFilename(prefix, extension) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  return `${prefix}-${timestamp}.${extension}`;
}

module.exports = {
  buildCsvBuffer,
  buildXlsxBuffer,
  defaultFilename,
};
