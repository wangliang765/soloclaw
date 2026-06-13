import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makeId } from "../domain/common.js";
import type { AcquireLockInput, WorkspaceLock, WorkspaceLockManager, WorkspaceLockScope } from "./workspace-lock-manager.js";

export class SqliteWorkspaceLockManager implements WorkspaceLockManager {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  async acquire(input: AcquireLockInput): Promise<WorkspaceLock> {
    this.dropExpired();
    const now = new Date().toISOString();
    const lock: WorkspaceLock = {
      ...input,
      lockId: makeId<"WorkspaceId">("lock"),
      expiresAt: new Date(Date.now() + (input.ttlMs ?? 60_000)).toISOString(),
    };

    try {
      this.db
        .prepare(
          `INSERT INTO workspace_locks (
            id, scope, resource_id, owner_id, acquired_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(lock.lockId, lock.scope, lock.resourceId, lock.ownerId, now, lock.expiresAt);
      return lock;
    } catch (error) {
      const existing = this.findActiveByResource(input.scope, input.resourceId);
      if (existing) {
        throw new Error(`Resource is locked: ${input.scope}:${input.resourceId}`);
      }
      throw error;
    }
  }

  async release(lockId: string, ownerId: string): Promise<void> {
    const row = this.getActiveRow(lockId);
    if (!row) {
      return;
    }
    if (row.owner_id !== ownerId) {
      throw new Error("Only lock owner can release the lock.");
    }
    this.db.prepare("DELETE FROM workspace_locks WHERE id = ?").run(lockId);
  }

  async heartbeat(lockId: string, ownerId: string, ttlMs?: number): Promise<WorkspaceLock> {
    this.dropExpired();
    const row = this.getActiveRow(lockId);
    if (!row) {
      throw new Error(`Lock not found: ${lockId}`);
    }
    if (row.owner_id !== ownerId) {
      throw new Error("Only lock owner can refresh the lock.");
    }

    const expiresAt = new Date(Date.now() + (ttlMs ?? 60_000)).toISOString();
    this.db.prepare("UPDATE workspace_locks SET expires_at = ? WHERE id = ?").run(expiresAt, lockId);
    return lockFromRow({ ...row, expires_at: expiresAt });
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_locks (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_locks_resource
        ON workspace_locks(scope, resource_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_locks_expires
        ON workspace_locks(expires_at);
    `);
  }

  private dropExpired(): void {
    this.db.prepare("DELETE FROM workspace_locks WHERE expires_at <= ?").run(new Date().toISOString());
  }

  private getActiveRow(lockId: string): WorkspaceLockRow | undefined {
    return this.db
      .prepare("SELECT * FROM workspace_locks WHERE id = ? AND expires_at > ?")
      .get(lockId, new Date().toISOString()) as WorkspaceLockRow | undefined;
  }

  private findActiveByResource(scope: WorkspaceLockScope, resourceId: string): WorkspaceLockRow | undefined {
    return this.db
      .prepare("SELECT * FROM workspace_locks WHERE scope = ? AND resource_id = ? AND expires_at > ?")
      .get(scope, resourceId, new Date().toISOString()) as WorkspaceLockRow | undefined;
  }
}

type WorkspaceLockRow = {
  id: string;
  scope: WorkspaceLockScope;
  resource_id: string;
  owner_id: string;
  acquired_at: string;
  expires_at: string;
};

function lockFromRow(row: WorkspaceLockRow): WorkspaceLock {
  return {
    lockId: row.id,
    scope: row.scope,
    resourceId: row.resource_id,
    ownerId: row.owner_id,
    expiresAt: row.expires_at,
  };
}
