export function validatePilotDocumentDate(value:unknown):asserts value is string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||value<'2022-04-01')throw Error('DOCUMENT_DATE_OUTSIDE_PILOT_HISTORY');
}
