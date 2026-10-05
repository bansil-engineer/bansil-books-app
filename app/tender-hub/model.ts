/** Independently implemented from observed UI/report behavior; no external I/O. */
export const TASKS = [
    ['Document Intake & Register', 'Classify revisions, duplicates and missing tender files', 'Technical', 'Internal'],
    ['Complete Tender Audit', 'End-to-end technical and commercial gap analysis', 'Technical', 'Both'],
    ['SLD & Drawing Cross-check', 'BOQ, SLD, layouts, cable schedule and specs', 'Technical', 'Both'],
    ['Technical Compliance Sheet', 'Clause-wise comply, deviation and evidence register', 'Reports', 'Customer'],
    ['Customer Query Resolution', 'Create query, response, responsibility and closure log', 'Reports', 'Customer'],
    ['Quantity Reconciliation', 'Drawing take-off versus BOQ quantity variance', 'Technical', 'Internal'],
    ['Composite Item Split', 'Break bundled items into costable components', 'Commercial', 'Internal'],
    ['Individual Rate Analysis', 'Material, labour, tools, freight, wastage and overhead', 'Commercial', 'Internal'],
    ['Supplier Quote Comparison', 'Normalize makes, scope, taxes and landed cost', 'Commercial', 'Internal'],
    ['Commercial Compliance', 'Terms, LD, PBG, payment, tax and exclusion matrix', 'Reports', 'Internal'],
    ['Finance Management Sheet', 'Cash flow, exposure, margin and working capital view', 'Commercial', 'Internal'],
    ['Final Estimation & Bid QC', 'Bundle roll-up, LP discount, margin and Bid/No-Bid', 'Reports', 'Both'],
] as const;
export type Audience = 'Internal' | 'Customer' | 'Both';
export type Project = {
    id: string;
    pid: string;
    name: string;
    client: string;
    location: string;
    owner: string;
    tenderNumber: string;
    status: string;
    dueDate: string;
    estimatedValue: number;
    bidReadiness: number;
    priority: string;
    notes: string;
    archived?: boolean;
};
export type Document = {
    id: string;
    projectId: string;
    name: string;
    size: number;
    mime: string;
    sha256: string;
    revision: string;
    number: string;
    source: string;
    category: string;
    status: 'Ready' | 'Superseded';
    supersedes: string;
    queryId: string;
    createdAt: string;
    file: Blob;
    deleted?: boolean;
};
export type Query = {
    id: string;
    projectId: string;
    subject: string;
    requirement: string;
    source: string;
    direction: string;
    raisedBy: string;
    assignedTo: string;
    priority: string;
    dueDate: string;
    status: string;
    reply: string;
    draft: string;
    verified: boolean;
};
export type Suggestion = {
    id: string;
    title: string;
    type: string;
    priority: string;
    module: string;
    description: string;
    expected: string;
    impact: string;
    status: 'Pending Approval' | 'Approved' | 'Rejected' | 'Implemented';
    createdAt: string;
};
export type Table = {
    title: string;
    headers: string[];
    rows: string[][];
    confidential?: boolean;
};
export type Report = {
    id: string;
    projectId: string;
    title: string;
    audience: Audience;
    createdAt: string;
    status: string;
    tables: Table[];
    documentHashes: string[];
    rate?: {
        item: string;
        unit: string;
        evidence: string;
        input: RateInput;
    };
};
export type Workspace = {
    version: 1;
    projects: Project[];
    documents: Document[];
    queries: Query[];
    suggestions: Suggestion[];
    reports: Report[];
    activeId: string;
};
export const emptyWorkspace = (): Workspace => ({ version: 1, projects: [], documents: [], queries: [], suggestions: [], reports: [], activeId: '' });
export const STATUSES = ['Draft', 'Document intake', 'Audit in progress', 'Commercial review', 'Ready for approval', 'Submitted', 'Hold', 'No Bid'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
export const id = () => crypto.randomUUID();
export const money = (n: number | null) => n === null ? 'Not calculable' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
export function nextPid(projects: Project[], year: number) {
    const prefix = `PID${String(year).slice(-2)}`;
    const seq = projects.filter(p => p.pid.startsWith(prefix) && /^PID\d{7}$/.test(p.pid)).map(p => Number(p.pid.slice(5)));
    return `${prefix}${String(Math.max(0, ...seq) + 1).padStart(5, '0')}`;
}
export function projectErrors(p: Project, all: Project[]) {
    const errs: string[] = [];
    for (const k of ['pid', 'name', 'client', 'location'] as const)
        if (!p[k].trim())
            errs.push(`${k} is required`);
    if (all.some(x => x.id !== p.id && x.pid.trim().toLowerCase() === p.pid.trim().toLowerCase()))
        errs.push('PID already exists, including archived records');
    if (!Number.isFinite(p.estimatedValue) || p.estimatedValue < 0)
        errs.push('Estimated value must be finite and non-negative');
    if (!Number.isFinite(p.bidReadiness) || p.bidReadiness < 0 || p.bidReadiness > 100)
        errs.push('Readiness must be 0–100');
    return errs;
}
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export const ACCEPT = '.pdf,.xlsx,.xls,.csv,.doc,.docx,.zip,.dwg,.dxf,.txt';
export function fileError(name: string, size: number) {
    if (!ACCEPT.split(',').some(ext => name.toLowerCase().endsWith(ext)))
        return 'Unsupported file type';
    if (size <= 0)
        return 'Empty file';
    if (size > MAX_FILE_BYTES)
        return 'Maximum 30 MB per file';
    return null;
}
export function readyDocuments(w: Workspace, pid: string) { return w.documents.filter(d => d.projectId === pid && !d.deleted && d.status === 'Ready'); }
export function addRevision(w: Workspace, d: Document) {
    if (!w.projects.some(p => p.id === d.projectId && !p.archived))
        throw Error('Select an active PID');
    if (d.supersedes && !w.documents.some(x => x.id === d.supersedes && x.projectId === d.projectId && !x.deleted && x.status === 'Ready'))
        throw Error('Earlier file must be Ready in the same PID');
    if (d.queryId && !w.queries.some(q => q.id === d.queryId && q.projectId === d.projectId))
        throw Error('Query must belong to the same PID');
    if (w.documents.some(x => x.projectId === d.projectId && !x.deleted && x.sha256 === d.sha256))
        throw Error('Duplicate file content already registered under this PID');
    return { ...w, documents: [...w.documents.map(x => x.id === d.supersedes ? { ...x, status: 'Superseded' as const } : x), d] };
}
export const RATE_FIELDS = ['quantity', 'listPrice', 'discount', 'freight', 'insurance', 'packing', 'unloading', 'taxPercent', 'recoverablePercent', 'wastagePercent', 'labour', 'tools', 'plant', 'consumables', 'testing', 'overheadPercent', 'contingencyPercent', 'profitPercent'] as const;
export type RateField = typeof RATE_FIELDS[number];
export type RateInput = Record<RateField, number | null> & {
    profitBasis: 'MARKUP' | 'MARGIN';
    wastageBasis: 'NET' | 'LANDED';
    overheadBasis: 'DIRECT' | 'MATERIAL';
    contingencyBasis: 'DIRECT' | 'WITH_OVERHEAD';
};
export type RateResult = {
    errors: string[];
    missing: string[];
    values: Record<string, number | null>;
    excluded: boolean;
};
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Missing is distinct from zero. Monetary rounding is per displayed layer. */
export function calculateRate(i: RateInput): RateResult {
    const errors: string[] = [], missing: string[] = [];
    for (const k of RATE_FIELDS) {
        const n = i[k];
        if (n === null)
            missing.push(k);
        else if (!Number.isFinite(n) || n < 0)
            errors.push(`${k}: finite non-negative value required`);
    }
    for (const k of ['discount', 'recoverablePercent'] as const)
        if (i[k] !== null && i[k]! > 100)
            errors.push(`${k}: maximum 100%`);
    if (i.profitBasis === 'MARGIN' && i.profitPercent !== null && i.profitPercent >= 100)
        errors.push('Margin on sales must be below 100%');
    if (!['MARKUP', 'MARGIN'].includes(i.profitBasis) || !['NET', 'LANDED'].includes(i.wastageBasis) || !['DIRECT', 'MATERIAL'].includes(i.overheadBasis) || !['DIRECT', 'WITH_OVERHEAD'].includes(i.contingencyBasis))
        errors.push('Approved calculation basis required');
    const v: Record<string, number | null> = {};
    const calc = (key: string, inputs: (number | null)[], f: () => number) => { const n = errors.length || inputs.some(x => x === null) ? null : round(f()); v[key] = n !== null && Number.isFinite(n) ? n : null; if (n !== null && !Number.isFinite(n))
        errors.push('Calculation overflow'); return v[key]; };
    const discount = calc('Discount amount', [i.listPrice, i.discount], () => i.listPrice! * i.discount! / 100);
    const net = calc('Net purchase price', [i.listPrice, discount], () => i.listPrice! - discount!);
    const landed = calc('Landed pre-tax material', [net, i.freight, i.insurance, i.packing, i.unloading], () => net! + i.freight! + i.insurance! + i.packing! + i.unloading!);
    const tax = calc('Input GST', [landed, i.taxPercent], () => landed! * i.taxPercent! / 100);
    const recoverable = calc('Recoverable GST', [tax, i.recoverablePercent], () => tax! * i.recoverablePercent! / 100);
    const nonTax = calc('Non-creditable tax', [tax, recoverable], () => tax! - recoverable!);
    const wasteBase = i.wastageBasis === 'NET' ? net : landed;
    const waste = calc('Material wastage', [wasteBase, i.wastagePercent], () => wasteBase! * i.wastagePercent! / 100);
    const direct = calc('Direct unit cost', [landed, nonTax, waste, i.labour, i.tools, i.plant, i.consumables, i.testing], () => landed! + nonTax! + waste! + i.labour! + i.tools! + i.plant! + i.consumables! + i.testing!);
    const overheadBase = i.overheadBasis === 'DIRECT' ? direct : landed;
    const overhead = calc('Overhead', [overheadBase, i.overheadPercent], () => overheadBase! * i.overheadPercent! / 100);
    const contBase = i.contingencyBasis === 'DIRECT' ? direct : direct !== null && overhead !== null ? direct + overhead : null;
    const contingency = calc('Contingency', [contBase, i.contingencyPercent], () => contBase! * i.contingencyPercent! / 100);
    const cost = calc('Cost before margin', [direct, overhead, contingency], () => direct! + overhead! + contingency!);
    const selling = calc('Selling unit rate', [cost, i.profitPercent], () => i.profitBasis === 'MARKUP' ? cost! * (1 + i.profitPercent! / 100) : cost! / (1 - i.profitPercent! / 100));
    calc('BOQ amount', [selling, i.quantity], () => selling! * i.quantity!);
    if (i.quantity === 0 && !errors.length)
        v['BOQ amount'] = 0;
    return { errors, missing, values: v, excluded: i.quantity === 0 && !errors.length };
}
export function quantityVariance(baseline: number | null, boq: number | null) {
    if (baseline === null || boq === null)
        return { difference: null, percent: null, status: 'Not calculable' };
    if (!Number.isFinite(baseline) || !Number.isFinite(boq) || baseline < 0 || boq < 0)
        return { difference: null, percent: null, status: 'Invalid quantity' };
    const difference = round(boq - baseline);
    return { difference, percent: baseline === 0 ? null : round(difference / baseline * 100), status: difference === 0 ? 'Aligned' : baseline === 0 ? 'Mismatch — zero baseline' : 'Mismatch' };
}
export function electricalLoad(kw: number | null, pf: number | null, volts: number | null) {
    if (kw === null || pf === null || volts === null)
        return { kva: null, amps: null };
    if (!Number.isFinite(kw) || kw < 0 || !Number.isFinite(pf) || pf <= 0 || pf > 1 || !Number.isFinite(volts) || volts <= 0)
        throw Error('Use finite kW ≥ 0, 0 < PF ≤ 1 and voltage > 0');
    const kva = round(kw / pf), amps = round(kw * 1000 / (Math.sqrt(3) * volts * pf));
    if (!Number.isFinite(kva) || !Number.isFinite(amps))
        throw Error('Calculation overflow');
    return { kva, amps };
}
/** Confidential pricing is omitted completely from Customer output. */
export function outputTables(report: Report, audience: Audience = report.audience) { return report.tables.filter(t => audience !== 'Customer' || !t.confidential); }
export function transitionSuggestion(s: Suggestion, next: Suggestion['status']) {
    const legal: Record<Suggestion['status'], Suggestion['status'][]> = { 'Pending Approval': ['Approved', 'Rejected'], Approved: ['Implemented', 'Rejected'], Rejected: ['Pending Approval'], Implemented: ['Pending Approval'] };
    if (!legal[s.status].includes(next))
        throw Error('Invalid approval transition');
    return { ...s, status: next };
}
