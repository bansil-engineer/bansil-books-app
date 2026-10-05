// Ambient type declarations for Node 22+ built-in node:sqlite module
declare module "node:sqlite" {
  export interface StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }

  export class DatabaseSync {
    constructor(location: string, options?: { open?: boolean; readOnly?: boolean });
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }

  export function backup(
    source: DatabaseSync,
    destination: string,
    options?: { source?: string; target?: string; rate?: number; progress?: (info: { totalPages: number; remainingPages: number }) => void }
  ): Promise<number>;
}
