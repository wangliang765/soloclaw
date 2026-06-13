import { makeId } from "../domain/common.js";
import type { AcquireLockInput, WorkspaceLock, WorkspaceLockManager } from "./workspace-lock-manager.js";

export class MemoryWorkspaceLockManager implements WorkspaceLockManager {
  private readonly locks = new Map<string, WorkspaceLock>();

  async acquire(input: AcquireLockInput): Promise<WorkspaceLock> {
    this.dropExpired();
    const existing = [...this.locks.values()].find((lock) => lock.scope === input.scope && lock.resourceId === input.resourceId);
    if (existing) {
      throw new Error(`Resource is locked: ${input.scope}:${input.resourceId}`);
    }
    const lock: WorkspaceLock = {
      ...input,
      lockId: makeId<"WorkspaceId">("lock"),
      expiresAt: new Date(Date.now() + (input.ttlMs ?? 60_000)).toISOString(),
    };
    this.locks.set(lock.lockId, lock);
    return lock;
  }

  async release(lockId: string, ownerId: string): Promise<void> {
    const lock = this.locks.get(lockId);
    if (lock && lock.ownerId !== ownerId) {
      throw new Error("Only lock owner can release the lock.");
    }
    this.locks.delete(lockId);
  }

  async heartbeat(lockId: string, ownerId: string, ttlMs?: number): Promise<WorkspaceLock> {
    const lock = this.locks.get(lockId);
    if (!lock) {
      throw new Error(`Lock not found: ${lockId}`);
    }
    if (lock.ownerId !== ownerId) {
      throw new Error("Only lock owner can refresh the lock.");
    }
    const next = {
      ...lock,
      expiresAt: new Date(Date.now() + (ttlMs ?? 60_000)).toISOString(),
    };
    this.locks.set(lockId, next);
    return next;
  }

  private dropExpired() {
    const now = Date.now();
    for (const [lockId, lock] of this.locks) {
      if (Date.parse(lock.expiresAt) <= now) {
        this.locks.delete(lockId);
      }
    }
  }
}
