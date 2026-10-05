export type QuantityKind = "SO" | "PO" | "Invoice" | "Bill";
export interface QuantityLine { id: string; itemId: string; name: string; description: string; unit: string; quantity: number | null; soLineId: string; poLineId: string; }
export interface QuantityDocument { id: string; kind: QuantityKind; number: string; party: string; status: string; date: string; lines: QuantityLine[]; multipleParents: boolean; }
export interface QuantityRow { key: string; name: string; description: string; unit: string; quantities: Record<QuantityKind, number | null>; differences: (number | null)[]; sources: { document: string; kind: QuantityKind; line: QuantityLine }[]; }
export interface UnmatchedLine { document: string; kind: QuantityKind; line: QuantityLine; reason: string; }
const normalized = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const signature = (line: QuantityLine) => [line.itemId, normalized(line.name), normalized(line.description), normalized(line.unit)].join("\u0000");
const round = (value: number) => Math.round((value + Number.EPSILON) * 1e6) / 1e6;

// Pure presentation arithmetic. Never creates reconciliation cases or approvals.
export function compareQuantities(documents: QuantityDocument[], complete: Record<QuantityKind, boolean>) {
  const rows: QuantityRow[] = [];
  const unmatched: UnmatchedLine[] = [];
  const uncertain = new Map<QuantityRow, Set<QuantityKind>>();
  const soLines = new Map<string, QuantityRow>();
  const poLines = new Map<string, QuantityRow>();
  const bySignature = new Map<string, QuantityRow>();
  for (const document of documents.filter(doc => doc.kind === "SO")) for (const line of document.lines) {
    const key = signature(line);
    let row = bySignature.get(key);
    if (!row) {
      row = { key, name: line.name || "Item name unavailable", description: line.description, unit: line.unit || "Unit unavailable", quantities: { SO: 0, PO: complete.PO ? 0 : null, Invoice: complete.Invoice ? 0 : null, Bill: complete.Bill ? 0 : null }, differences: [], sources: [] };
      rows.push(row); bySignature.set(key, row);
    }
    row.quantities.SO = line.quantity === null || row.quantities.SO === null ? null : round(row.quantities.SO + line.quantity);
    row.sources.push({ document: document.number, kind: document.kind, line });
    if (line.id) soLines.set(line.id, row);
  }
  for (const kind of ["PO", "Invoice", "Bill"] as const) for (const document of documents.filter(doc => doc.kind === kind)) for (const line of document.lines) {
    let row = line.soLineId ? soLines.get(line.soLineId) : undefined;
    if (!row && kind === "Bill" && line.poLineId) row = poLines.get(line.poLineId);
    let reason = "";
    if (row) {
      const source = row.sources.find(item => item.kind === "SO")!.line;
      if (normalized(source.name) !== normalized(line.name)) reason = "Linked line has a different item name";
      else if (!source.unit || !line.unit || normalized(source.unit) !== normalized(line.unit)) reason = "Unit differs or is missing; no conversion assumed";
      else if (source.itemId && line.itemId && source.itemId !== line.itemId) reason = "Item identity differs despite a linked line";
      else if (normalized(source.description) !== normalized(line.description)) reason = "Item specification / description differs";
    } else if (document.multipleParents || line.soLineId || (kind === "Bill" && line.poLineId)) {
      reason = "Line is not unambiguously linked to this SO / its PO lines";
    } else {
      row = line.itemId && line.name && line.unit ? bySignature.get(signature(line)) : undefined;
      if (!row) reason = "No exact item identity, name, specification and unit match";
    }
    if (!row || reason || line.quantity === null) {
      unmatched.push({ document: document.number, kind, line, reason: reason || "Quantity missing or invalid" });
      const affected = rows.filter(candidate => candidate === row || candidate.sources.some(source => source.kind === "SO" && ((line.itemId && source.line.itemId === line.itemId) || (line.name && normalized(source.line.name) === normalized(line.name)))) || (!line.itemId && !line.name));
      for (const candidate of affected) { if (!uncertain.has(candidate)) uncertain.set(candidate, new Set()); uncertain.get(candidate)!.add(kind); }
      continue;
    }
    if (row.quantities[kind] !== null) row.quantities[kind] = round(row.quantities[kind] + line.quantity);
    row.sources.push({ document: document.number, kind, line });
    if (kind === "PO" && line.id) poLines.set(line.id, row);
  }
  // Unallocated source lines can affect remaining quantities: never call these final zeros.
  for (const row of rows) {
    for (const kind of uncertain.get(row) || []) if (kind !== "SO") row.quantities[kind] = null;
    const q = row.quantities;
    row.differences = [[q.SO, q.PO], [q.SO, q.Invoice], [q.PO, q.Bill], [q.Bill, q.Invoice]].map(([a, b]) => a === null || b === null ? null : round(a - b));
  }
  return { rows, unmatched };
}
