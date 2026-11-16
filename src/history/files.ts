import { NOTES, type Column, type Row, type Sheet } from './sheets';

/** CSV (one file per sheet) and .xlsx (all sheets in one workbook). */

function localStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function csvCell(v: Row[string], c: Column): string {
  if (v === null || v === undefined || v === '') return '';
  let s: string;
  if (v instanceof Date) s = localStamp(v);
  else if (typeof v === 'boolean') s = v ? 'Yes' : 'No';
  else if (c.type === 'pct' && typeof v === 'number') s = (v * 100).toFixed(1);
  else s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(sheet: Sheet): string {
  const header = sheet.columns.map((c) => csvCell(c.type === 'pct' ? `${c.header} (%)` : c.header, { ...c, type: 'text' })).join(',');
  const body = sheet.rows.map((r) => sheet.columns.map((c) => csvCell(r[c.key], c)).join(','));
  return [header, ...body].join('\r\n') + '\r\n';
}

const NUM_FMT: Partial<Record<Column['type'], string>> = {
  money: '"$"#,##0;[Red]-"$"#,##0',
  bb: '0.00',
  pct: '0.0%',
  datetime: 'yyyy-mm-dd hh:mm:ss',
  int: '0',
};

/** Builds the .xlsx workbook. ExcelJS is loaded only when you export. */
export async function toXlsx(sheets: Sheet[]): Promise<ArrayBuffer> {
  const mod = await import('exceljs');
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Poker Practice';
  wb.created = new Date();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = sheet.columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    for (const r of sheet.rows) {
      const values: Record<string, unknown> = {};
      for (const c of sheet.columns) {
        const v = r[c.key];
        if (v === null || v === undefined || v === '') continue;
        if (v instanceof Date) {
          // Excel has no time zones: store the local wall-clock time.
          values[c.key] = new Date(v.getTime() - v.getTimezoneOffset() * 60_000);
        } else if (typeof v === 'boolean') values[c.key] = v ? 'Yes' : 'No';
        else values[c.key] = v;
      }
      ws.addRow(values);
    }
    sheet.columns.forEach((c, i) => {
      const fmt = NUM_FMT[c.type];
      if (fmt) ws.getColumn(i + 1).numFmt = fmt;
    });
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle', wrapText: true };
    header.height = 32;
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }
  const notes = wb.addWorksheet('Notes');
  notes.columns = [{ width: 30 }, { width: 110 }];
  for (const r of NOTES) notes.addRow(r);
  notes.getRow(1).font = { bold: true };
  notes.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Saves a file in the browser's downloads. */
export function downloadFile(name: string, data: BlobPart, type: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers that block the clipboard API.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
