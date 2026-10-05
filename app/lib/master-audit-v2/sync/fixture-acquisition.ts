/** Offline fixture contract only. This is NOT a Zoho endpoint validator. */
import { isCanonicalDecimal } from '../decimal.ts';
import type { EvidenceValue } from '../types/schema.ts';
import type { Observation, Scope } from './planner.ts';
export const FIXTURE_RULE = 'offline-fixture-v1';
export interface FixtureLine { id: string; itemId: string | null; unit: string | null; quantity: EvidenceValue; amount: EvidenceValue }
export interface FixtureDetail extends Observation { documentDate: string; expectedLines: number; lines: FixtureLine[] }
function object(value: unknown): Record<string,unknown> {
 if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('INVALID_OBJECT');
 return value as Record<string,unknown>;
}
function text(value: unknown): string {
 if (typeof value!=='string' || !value.trim()) throw new Error('MISSING_TEXT');
 return value;
}
function nullableText(value: unknown): string | null { return value===null?null:text(value); }
function evidence(value: unknown): EvidenceValue {
 const v=object(value);
 if (v.value===null && v.scale===null) return {value:null,scale:null,missingReason:text(v.missingReason)};
 if (v.missingReason!==null || !isCanonicalDecimal(v.value,v.scale)) throw new Error('INVALID_DECIMAL_EVIDENCE');
 return {value:v.value as string,scale:v.scale as number,missingReason:null};
}
/** Parse and normalize from the same raw payload later preserved in history. */
export function parseFixture(raw: string, scope: Scope, expected: Observation): FixtureDetail {
 const v=object(JSON.parse(raw));
 for (const key of ['organizationId','fyId','documentType'] as const)
  if (v[key]!==scope[key] || expected[key]!==scope[key]) throw new Error('SCOPE_MISMATCH');
 const remoteId=text(v.remoteId); if(remoteId!==expected.remoteId) throw new Error('IDENTITY_MISMATCH');
 const revision=nullableText(v.revision);
 if(revision!==expected.revision) throw new Error('LIST_DETAIL_REVISION_MISMATCH');
 const documentDate=text(v.documentDate);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(documentDate)) throw new Error('INVALID_DOCUMENT_DATE');
 if(!Number.isSafeInteger(v.expectedLines) || (v.expectedLines as number)<0 || !Array.isArray(v.lines) || v.lines.length!==v.expectedLines) throw new Error('INCOMPLETE_LINES');
 const seen=new Set<string>();
 const lines=v.lines.map(value=>{
  const line=object(value), id=text(line.id);
  if(seen.has(id)) throw new Error('DUPLICATE_LINE'); seen.add(id);
  return {id,itemId:nullableText(line.itemId),unit:nullableText(line.unit),quantity:evidence(line.quantity),amount:evidence(line.amount)};
 });
 return {...scope,remoteId,revision,documentDate,expectedLines:v.expectedLines as number,lines};
}
