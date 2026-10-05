export type ConnectorId = 'zoho' | 'openai' | 'claude' | 'gemini' | 'sharepoint' | 'email' | 'web';
export type ConnectionPolicy = { version: number; revision: number; enabled: Record<ConnectorId, boolean>; updatedAt: string | null };
export const CONNECTORS: readonly {id:ConnectorId;name:string;available:boolean;permissions:string}[];
export function policyPath(): string;
export function readPolicy(file?:string):ConnectionPolicy;
export function writePolicy(action:string,id:string,revision:number,file?:string):ConnectionPolicy;
export function assertConnectionAllowed(id:string,file?:string):void;
export function connectionFetch(id:string,input:RequestInfo|URL,init?:RequestInit):Promise<Response>;
export function localControlRequest(request:Request):void;
