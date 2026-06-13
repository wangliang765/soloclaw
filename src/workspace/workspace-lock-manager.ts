export type WorkspaceLockScope = "repository" | "file" | "git_state";

export type AcquireLockInput = {
  scope: WorkspaceLockScope;
  resourceId: string;
  ownerId: string;
  ttlMs?: number;
};

export type WorkspaceLock = AcquireLockInput & {
  lockId: string;
  expiresAt: string;
};

export interface WorkspaceLockManager {
  acquire(input: AcquireLockInput): Promise<WorkspaceLock>;
  release(lockId: string, ownerId: string): Promise<void>;
  heartbeat(lockId: string, ownerId: string, ttlMs?: number): Promise<WorkspaceLock>;
}
