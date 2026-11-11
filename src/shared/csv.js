/** Rows to CSV (RFC 4180). Cells that a spreadsheet app would run as a
 *  formula are prefixed with ' (plain negative numbers are left alone). */
export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+@\t\r]/.test(s) || (s.startsWith("-") && !/^-\d+(\.\d+)?$/.test(s))) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\r\n");
}

/** Quotes a SQL identifier (table or column name). */
export function ident(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}
