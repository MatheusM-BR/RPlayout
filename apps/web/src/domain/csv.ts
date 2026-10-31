/** Quoting preserves separators/newlines; apostrophe prevents spreadsheet
 * formulas, including formulas preceded by whitespace or control chars. */
export function csvCell(value: unknown): string {
  const text = String(value ?? '')
  const protectedText = /^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text
  return '"' + protectedText.replaceAll('"', '""') + '"'
}

export function csvRows(rows: readonly (readonly unknown[])[], separator = ','): string {
  return rows.map(row => row.map(csvCell).join(separator)).join('\r\n')
}
