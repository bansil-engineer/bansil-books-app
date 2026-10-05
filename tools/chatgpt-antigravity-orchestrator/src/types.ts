export type State = 'QUEUED'|'PLANNING'|'AWAITING_APPROVAL'|'PAUSED'|'RUNNING'|'REVIEWING'|'COMPLETED'|'REJECTED'|'FAILED';
export type Decision = 'ACCEPT'|'ACCEPT_ALL'|'REJECT'|'UNTOUCH';
export type Gate = 'PLAN'|'TOOL'|'REVIEW';
export interface Plan { prompt:string; risk:'LOW'|'HIGH'; reason:string }
export interface Review { verdict:'DONE'|'CONTINUE'|'HUMAN'; summary:string; nextPrompt:string; audit?:string }
export interface Task { id:string; request:string; state:State; auto:boolean; acceptAllReadOnly:boolean; maxRounds:number; round:number; plan:Plan|null; report:string|null; review:Review|null; error:string|null; createdAt:string; updatedAt:string; version:number }
export interface Approval { id:string; taskId:string; kind:Gate; details:string; decision:'ACCEPT'|'ACCEPT_ALL'|'REJECT'|null; createdAt:string }
export class WorkflowError extends Error {
  status:number;
  constructor(message:string,status=409){super(message);this.status=status}
}
export const terminal=(s:State)=>['COMPLETED','REJECTED','FAILED'].includes(s);
