import { createHash } from "node:crypto";
import type { ActorRef, TaskAssignmentStatus, WorkerHeartbeatEnvelope, WorkerRegistration, WorkerStatus } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore, ListWorkersInput } from "../store/agent-store.js";

export type RegisterWorkerInput = {
  agentId: string;
  machineId: string;
  orgId?: string;
  displayName?: string;
  endpoint?: string;
  capabilities?: string[];
  allowedProjects?: string[];
  maxConcurrentTasks?: number;
  metadata?: Record<string, unknown>;
  ttlSeconds?: number;
  actor: ActorRef;
};

export type RecoverExpiredWorkersInput = {
  actor: ActorRef;
  now?: string;
  limit?: number;
};

export type RecoverExpiredWorkersResult = {
  expired: WorkerRegistration[];
};

export type CleanupWorkerHeartbeatNoncesInput = {
  actor: ActorRef;
  before?: string;
  limit?: number;
};

export type CleanupWorkerHeartbeatNoncesResult = {
  deleted: number;
  before: string;
};

export type DrainWorkerInput = {
  workerId: string;
  actor: ActorRef;
  reason?: string;
  ttlSeconds?: number;
};

export type CompleteDrainWorkerInput = {
  workerId: string;
  actor: ActorRef;
  reason?: string;
};

export class WorkerRegistryService {
  constructor(
    private readonly store: AgentStore,
    private readonly options: {
      signHeartbeatEnvelope?: (envelope: Omit<WorkerHeartbeatEnvelope, "signature">) => Promise<string | undefined> | string | undefined;
      createHeartbeatNonce?: () => string;
    } = {},
  ) {}

  async register(input: RegisterWorkerInput): Promise<WorkerRegistration> {
    const now = new Date();
    const worker: WorkerRegistration = {
      id: makeId<"WorkerId">("worker"),
      agentId: input.agentId as WorkerRegistration["agentId"],
      machineId: input.machineId as WorkerRegistration["machineId"],
      orgId: input.orgId as WorkerRegistration["orgId"],
      displayName: input.displayName ?? input.agentId,
      endpoint: input.endpoint,
      capabilities: input.capabilities ?? [],
      allowedProjects: (input.allowedProjects ?? []) as WorkerRegistration["allowedProjects"],
      status: "online",
      currentLoad: 0,
      maxConcurrentTasks: input.maxConcurrentTasks ?? 1,
      metadata: input.metadata,
      registeredAt: now.toISOString(),
      lastHeartbeatAt: now.toISOString(),
      expiresAt: expiresAt(now, input.ttlSeconds),
    };
    await this.store.upsertWorkerRegistration(worker);
    await this.audit("worker.registered", input.actor, `Registered worker ${worker.id}`, { workerId: worker.id, agentId: worker.agentId, machineId: worker.machineId });
    return worker;
  }

  async heartbeat(input: {
    workerId: string;
    status?: WorkerStatus;
    currentLoad?: number;
    maxConcurrentTasks?: number;
    metadata?: Record<string, unknown>;
    ttlSeconds?: number;
    signHeartbeatEnvelope?: (envelope: Omit<WorkerHeartbeatEnvelope, "signature">) => Promise<string | undefined> | string | undefined;
    actor: ActorRef;
  }): Promise<WorkerRegistration> {
    const existing = await this.store.getWorkerRegistration(input.workerId);
    if (!existing) {
      throw new Error(`Worker not found: ${input.workerId}`);
    }
    const now = new Date();
    const envelope: Omit<WorkerHeartbeatEnvelope, "signature"> = {
      version: 1,
      workerId: existing.id,
      agentId: existing.agentId,
      machineId: existing.machineId,
      status: input.status ?? existing.status,
      currentLoad: input.currentLoad ?? existing.currentLoad,
      maxConcurrentTasks: input.maxConcurrentTasks ?? existing.maxConcurrentTasks,
      heartbeatAt: now.toISOString(),
      expiresAt: input.ttlSeconds ? expiresAt(now, input.ttlSeconds) : existing.expiresAt,
      heartbeatBy: input.actor,
      nonce: this.options.createHeartbeatNonce?.() ?? makeId<"ArtifactId">("hbnonce"),
    };
    const signature = await (input.signHeartbeatEnvelope ?? this.options.signHeartbeatEnvelope)?.(envelope);
    const heartbeatEnvelope: WorkerHeartbeatEnvelope = { ...envelope, signature };
    if (signature) {
      const recorded = await this.store.recordWorkerHeartbeatNonce({
        agentId: heartbeatEnvelope.agentId,
        nonce: heartbeatEnvelope.nonce,
        workerId: heartbeatEnvelope.workerId,
        envelopeHash: sha256(JSON.stringify(heartbeatEnvelope)),
        firstSeenAt: heartbeatEnvelope.heartbeatAt,
        expiresAt: heartbeatEnvelope.expiresAt,
      });
      if (!recorded) {
        await this.audit("worker.heartbeat", input.actor, `Rejected replayed worker heartbeat ${existing.id}`, {
          workerId: existing.id,
          signatureStatus: "replay",
          nonce: heartbeatEnvelope.nonce,
          heartbeatEnvelope,
        });
        throw new Error(`Worker heartbeat nonce replay detected: ${heartbeatEnvelope.nonce}`);
      }
    }
    const worker = await this.store.updateWorkerHeartbeat({
      ...input,
      metadata: {
        ...(existing.metadata ?? {}),
        ...(input.metadata ?? {}),
        heartbeatEnvelope,
      },
    });
    if (!worker) {
      throw new Error(`Worker not found: ${input.workerId}`);
    }
    await this.audit("worker.heartbeat", input.actor, `Worker heartbeat ${worker.id}`, {
      workerId: worker.id,
      status: worker.status,
      currentLoad: worker.currentLoad,
      maxConcurrentTasks: worker.maxConcurrentTasks,
      signatureStatus: signature ? "signed" : "unsigned",
      heartbeatEnvelope,
    });
    return worker;
  }

  async list(input: ListWorkersInput = {}): Promise<WorkerRegistration[]> {
    return this.store.listWorkerRegistrations(input);
  }

  async get(workerId: string): Promise<WorkerRegistration | undefined> {
    return this.store.getWorkerRegistration(workerId);
  }

  async drain(input: DrainWorkerInput): Promise<WorkerRegistration> {
    const drainedAt = new Date().toISOString();
    const worker = await this.heartbeat({
      workerId: input.workerId,
      actor: input.actor,
      status: "draining",
      ttlSeconds: input.ttlSeconds,
      metadata: {
        drainingAt: drainedAt,
        drainReason: input.reason,
      },
    });
    await this.audit("worker.drained", input.actor, `Worker draining: ${worker.id}`, {
      workerId: worker.id,
      agentId: worker.agentId,
      machineId: worker.machineId,
      drainingAt: drainedAt,
      reason: input.reason,
    });
    return worker;
  }

  async completeDrain(input: CompleteDrainWorkerInput): Promise<WorkerRegistration> {
    const existing = await this.store.getWorkerRegistration(input.workerId);
    if (!existing) {
      throw new Error(`Worker not found: ${input.workerId}`);
    }
    if (existing.status !== "draining") {
      throw new Error(`Worker is not draining: ${existing.id} status=${existing.status}`);
    }
    const activeAssignments = (await this.store.listTaskAssignments({ workerId: existing.id, limit: 100 }))
      .filter((assignment) => isActiveAssignment(assignment.status));
    if (activeAssignments.length > 0) {
      throw new Error(`Worker still has active assignments: ${existing.id} count=${activeAssignments.length}`);
    }
    const completedAt = new Date().toISOString();
    const worker: WorkerRegistration = {
      ...existing,
      status: "offline",
      currentLoad: 0,
      metadata: {
        ...(existing.metadata ?? {}),
        drainCompletedAt: completedAt,
        drainCompletionReason: input.reason,
      },
    };
    await this.store.upsertWorkerRegistration(worker);
    await this.audit("worker.drain_completed", input.actor, `Worker drain completed: ${worker.id}`, {
      workerId: worker.id,
      agentId: worker.agentId,
      machineId: worker.machineId,
      drainCompletedAt: completedAt,
      reason: input.reason,
    });
    return worker;
  }

  async recoverExpired(input: RecoverExpiredWorkersInput): Promise<RecoverExpiredWorkersResult> {
    const now = input.now ?? new Date().toISOString();
    const candidates = (await this.store.listWorkerRegistrations({ limit: input.limit ?? 100 }))
      .filter((worker) => (worker.status === "online" || worker.status === "draining") && Boolean(worker.expiresAt) && worker.expiresAt! <= now)
      .sort((left, right) => (left.expiresAt ?? "").localeCompare(right.expiresAt ?? ""));
    const expired: WorkerRegistration[] = [];
    for (const worker of candidates) {
      const updated: WorkerRegistration = {
        ...worker,
        status: "offline",
        currentLoad: 0,
        metadata: {
          ...(worker.metadata ?? {}),
          expiredAt: now,
          statusBeforeExpiry: worker.status,
          loadBeforeExpiry: worker.currentLoad,
        },
      };
      await this.store.upsertWorkerRegistration(updated);
      expired.push(updated);
      await this.audit("worker.expired", input.actor, `Worker heartbeat expired: ${worker.id}`, {
        workerId: worker.id,
        agentId: worker.agentId,
        machineId: worker.machineId,
        expiredAt: now,
        heartbeatExpiresAt: worker.expiresAt,
        statusBeforeExpiry: worker.status,
        loadBeforeExpiry: worker.currentLoad,
      });
    }
    return { expired };
  }

  async cleanupHeartbeatNonces(input: CleanupWorkerHeartbeatNoncesInput): Promise<CleanupWorkerHeartbeatNoncesResult> {
    const before = input.before ?? new Date().toISOString();
    const deleted = await this.store.deleteWorkerHeartbeatNoncesBefore({
      before,
      limit: input.limit,
    });
    await this.audit("worker.heartbeat_nonce_cleaned", input.actor, `Cleaned ${deleted} expired worker heartbeat nonce records`, {
      deleted,
      before,
      limit: input.limit,
    });
    return { deleted, before };
  }

  private async audit(
    type: Parameters<AgentStore["recordAuditEvent"]>[0]["type"],
    actor: ActorRef,
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type,
      actor,
      summary,
      metadata,
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
  }
}

function expiresAt(now: Date, ttlSeconds: number | undefined): string | undefined {
  if (!ttlSeconds) {
    return undefined;
  }
  return new Date(now.getTime() + ttlSeconds * 1000).toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isActiveAssignment(status: TaskAssignmentStatus): boolean {
  return status === "leased" || status === "running" || status === "paused";
}
