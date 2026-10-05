import { outputTables, type Audience, type Report } from './model';
function download(data: Blob, name: string) { const url = URL.createObjectURL(data), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
const safeName = (r: Report) => `${r.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${r.id.slice(0, 8)}`;
export async function downloadExcel(report: Report, audience: Audience) {
    const XLSX = await import('xlsx'), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Report ID', report.id], ['Title', report.title], ['Status', report.status], ['Audience', audience], ['Created', report.createdAt], ['Source SHA256', ...report.documentHashes]]), 'Report');
    outputTables(report, audience).forEach((t, index) => {
        // String cell values are intentional: user text is never interpreted as a formula.
        const sheet = XLSX.utils.aoa_to_sheet([t.headers, ...t.rows]);
        sheet['!cols'] = t.headers.map(() => ({ wch: 35 }));
        XLSX.utils.book_append_sheet(wb, sheet, `${index + 1} ${t.title}`.replace(/[\\/?*\[\]:]/g, '').slice(0, 31));
    });
    download(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeName(report)}-${audience.toLowerCase()}.xlsx`);
}
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const paragraph = (s: string) => `<w:p><w:r><w:t xml:space="preserve">${xml(s)}</w:t></w:r></w:p>`;
function crc32(bytes: Uint8Array) { let crc = 0xffffffff; for (const b of bytes) {
    crc ^= b;
    for (let j = 0; j < 8; j++)
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
} return (crc ^ 0xffffffff) >>> 0; }
/** Minimal standards-based OPC ZIP; no dependencies, macros or remote content. */
export function zipFiles(files: Record<string, string>): Uint8Array {
    const encoder = new TextEncoder(), chunks: Uint8Array[] = [], central: Uint8Array[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const n = encoder.encode(name), b = encoder.encode(content), crc = crc32(b), local = new Uint8Array(30 + n.length), l = new DataView(local.buffer);
        l.setUint32(0, 0x04034b50, true);
        l.setUint16(4, 20, true);
        l.setUint32(14, crc, true);
        l.setUint32(18, b.length, true);
        l.setUint32(22, b.length, true);
        l.setUint16(26, n.length, true);
        local.set(n, 30);
        const header = new Uint8Array(46 + n.length), h = new DataView(header.buffer);
        h.setUint32(0, 0x02014b50, true);
        h.setUint16(4, 20, true);
        h.setUint16(6, 20, true);
        h.setUint32(16, crc, true);
        h.setUint32(20, b.length, true);
        h.setUint32(24, b.length, true);
        h.setUint16(28, n.length, true);
        h.setUint32(42, offset, true);
        header.set(n, 46);
        chunks.push(local, b);
        central.push(header);
        offset += local.length + b.length;
    }
    const centralSize = central.reduce((n, b) => n + b.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, central.length, true);
    e.setUint16(10, central.length, true);
    e.setUint32(12, centralSize, true);
    e.setUint32(16, offset, true);
    const result = new Uint8Array(offset + centralSize + 22);
    let cursor = 0;
    for (const b of [...chunks, ...central, end]) {
        result.set(b, cursor);
        cursor += b.length;
    }
    return result;
}
export function wordBytes(report: Report, audience: Audience) {
    const tables = outputTables(report, audience).map(t => paragraph(t.title) + `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(x => `<w:${x} w:val="single" w:sz="4" w:color="D8E2EB"/>`).join('')}</w:tblBorders></w:tblPr>${[t.headers, ...t.rows].map(row => `<w:tr>${row.map(cell => `<w:tc>${paragraph(cell)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`).join('');
    return zipFiles({
        '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph(report.title)}${paragraph(`Report ${report.id} · ${audience} · ${report.status}`)}${paragraph(report.createdAt)}${tables}<w:sectPr><w:pgSz w:w="16838" w:h="11906"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`,
    });
}
export function downloadWord(report: Report, audience: Audience) { const bytes = wordBytes(report, audience); download(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${safeName(report)}-${audience.toLowerCase()}.docx`); }
