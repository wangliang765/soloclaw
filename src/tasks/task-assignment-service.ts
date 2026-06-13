import type { ActorRef, AuditEvent, Session, Subtask, TaskAssignment, TaskAssignmentStatus, TaskLeaseEnvelope, WorkerRegistration } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore, ListTaskAssignmentsInput } from "../store/agent-store.js";

export type AssignTaskInput = {
  workerId: string;
  sessionId?: string;
  subtaskId?: string;
  actor: ActorRef;
  leaseTtlSeconds?: number;
  priority?: number;
  metadata?: Record<string, unknown>;
};

export type AssignmentHeartbeatInput = {
  assignmentId: string;
  workerId: string;
  actor: ActorRef;
  leaseTtlSeconds?: number;
  metadata?: Record<string, unknown>;
  createLeaseEnvelope?: (assignment: TaskAssignment) => Promise<TaskLeaseEnvelope> | TaskLeaseEnvelope;
};

export type CompleteAssignmentInput = {
  assignmentId: string;
  workerId: string;
  actor: ActorRef;
  status: Extract<TaskAssignmentStatus, "completed" | "failed" | "cancelled">;
  resultSummary?: string;
};

export type ReleaseSessionAssignmentsInput = {
  sessionId: string;
  actor: ActorRef;
  status: Extract<TaskAssignmentStatus, "paused" | "cancelled" | "failed">;
  resultSummary?: string;
};

export type PauseAssignmentInput = {
  assignmentId: string;
  workerId: string;
  actor: ActorRef;
  resultSummary?: string;
  pauseTarget?: boolean;
};

export type RecoverExpiredAssignmentsInput = {
  actor: ActorRef;
  now?: string;
  limit?: number;
  maxAttempts?: number;
  retryWorkerId?: string;
  autoSelectRetryWorker?: boolean;
  leaseTtlSeconds?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  jitterMs?: number;
  exhaustedTargetStatus?: "paused" | "failed";
  metadata?: Record<string, unknown>;
};

export type RecoverExpiredAssignmentsResult = {
  expired: TaskAssignment[];
  retries: TaskAssignment[];
};

export type CleanupTaskLeaseNoncesInput = {
  actor: ActorRef;
  before?: string;
  limit?: number;
};

export type CleanupTaskLeaseNoncesResult = {
  deleted: number;
  before: string;
};

export class TaskAssignmentService {
  constructor(private readonly store: AgentStore) {}

  async assign(input: AssignTaskInput): Promise<TaskAssignment> {
    const target = await this.resolveTarget(input);
    const worker = await this.requireSchedulableWorker(input.workerId, target.projectId);
    await this.assertNoActiveAssignment(target);

    const now = new Date();
    const assignment: TaskAssignment = {
      id: makeId<"TaskAssignmentId">("assign"),
      kind: target.kind,
      sessionId: target.session?.id,
      subtaskId: target.subtask?.id as TaskAssignment["subtaskId"],
      workerId: worker.id,
      projectId: target.projectId as TaskAssignment["projectId"],
      roomId: target.roomId as TaskAssignment["roomId"],
      status: "leased",
      priority: input.priority ?? 0,
      attempts: 1,
      leaseOwnerId: worker.id,
      leaseExpiresAt: leaseExpiresAt(now, input.leaseTtlSeconds),
      assignedBy: input.actor,
      metadata: input.metadata,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await this.store.createTaskAssignment(assignment);
    await this.markTargetAssigned(target, worker);
    await this.bumpWorkerLoad(worker, 1);
    await this.audit("task.assigned", input.actor, `Assigned ${target.kind} to worker ${worker.id}`, assignment, {
      targetKind: target.kind,
      workerId: worker.id,
    });
    await this.emitRoomEvent(input.actor, assignment, "task.assigned", {
      workerId: worker.id,
      targetKind: target.kind,
    });
    return assignment;
  }

  async heartbeat(input: AssignmentHeartbeatInput): Promise<TaskAssignment> {
    const assignment = await this.requireAssignment(input.assignmentId);
    this.assertWorkerOwnsAssignment(assignment, input.workerId);
    this.assertActiveAssignment(assignment);
    const now = new Date();
    let updated: TaskAssignment = {
      ...assignment,
      status: "running",
      leaseExpiresAt: leaseExpiresAt(now, input.leaseTtlSeconds),
      metadata: input.metadata ?? assignment.metadata,
      updatedAt: now.toISOString(),
    };
    if (input.createLeaseEnvelope) {
      updated = {
        ...updated,
        metadata: {
          ...(updated.metadata ?? {}),
          leaseEnvelope: await input.createLeaseEnvelope(updated),
        },
      };
    }
    await this.store.updateTaskAssignment(updated);
    await this.audit("task.lease_heartbeat", input.actor, `Heartbeat for assignment ${updated.id}`, updated, {
      workerId: updated.workerId,
      leaseExpiresAt: updated.leaseExpiresAt,
    });
    return updated;
  }

  async complete(input: CompleteAssignmentInput): Promise<TaskAssignment> {
    const assignment = await this.requireAssignment(input.assignmentId);
    this.assertWorkerOwnsAssignment(assignment, input.workerId);
    if (isTerminal(assignment.status)) {
      return assignment;
    }
    const now = new Date().toISOString();
    const updated: TaskAssignment = {
      ...assignment,
      status: input.status,
      resultSummary: input.resultSummary,
      updatedAt: now,
      completedAt: now,
    };
    await this.store.updateTaskAssignment(updated);
    await this.markTargetCompleted(updated, input.status, input.resultSummary);
    const worker = await this.store.getWorkerRegistration(input.workerId);
    if (worker) {
      await this.bumpWorkerLoad(worker, -1);
    }
    await this.audit(auditTypeForCompletion(input.status), input.actor, `Assignment ${input.status}: ${updated.id}`, updated, {
      workerId: updated.workerId,
      resultSummary: input.resultSummary,
    });
    await this.emitRoomEvent(input.actor, updated, auditTypeForCompletion(input.status), {
      workerId: updated.workerId,
      resultSummary: input.resultSummary,
    });
    return updated;
  }

  async releaseActiveForSession(input: ReleaseSessionAssignmentsInput): Promise<TaskAssignment[]> {
    const active = (await this.store.listTaskAssignments({ sessionId: input.sessionId, limit: 50 }))
      .filter((assignment) => isActive(assignment.status));
    const released: TaskAssignment[] = [];
    for (const assignment of active) {
      if (input.status === "paused") {
        released.push(await this.pauseAssignment(assignment, input.actor, input.resultSummary));
        continue;
      }
      released.push(
        await this.complete({
          assignmentId: assignment.id,
          workerId: assignment.workerId,
          actor: input.actor,
          status: input.status,
          resultSummary: input.resultSummary,
        }),
      );
    }
    return released;
  }

  async pause(input: PauseAssignmentInput): Promise<TaskAssignment> {
    const assignment = await this.requireAssignment(input.assignmentId);
    this.assertWorkerOwnsAssignment(assignment, input.workerId);
    if (isTerminal(assignment.status)) {
      return assignment;
    }
    const paused = await this.pauseAssignment(assignment, input.actor, input.resultSummary);
    if (input.pauseTarget) {
      await this.markTargetPaused(paused, input.resultSummary);
    }
    return paused;
  }

  async list(input: ListTaskAssignmentsInput = {}): Promise<TaskAssignment[]> {
    return this.store.listTaskAssignments(input);
  }

  async get(assignmentId: string): Promise<TaskAssignment | undefined> {
    return this.store.getTaskAssignment(assignmentId);
  }

  async cleanupLeaseNonces(input: CleanupTaskLeaseNoncesInput): Promise<CleanupTaskLeaseNoncesResult> {
    const before = input.before ?? new Date().toISOString();
    const deleted = await this.store.deleteTaskLeaseNoncesBefore({
      before,
      limit: input.limit,
    });
    await this.auditRaw("task.lease_nonce_cleaned", input.actor, `Cleaned ${deleted} expired task lease nonce records`, {
      deleted,
      before,
      limit: input.limit,
    });
    return { deleted, before };
  }

  async recoverExpired(input: RecoverExpiredAssignmentsInput): Promise<RecoverExpiredAssignmentsResult> {
    const now = input.now ?? new Date().toISOString();
    const maxAttempts = input.maxAttempts ?? 3;
    const candidates = (await this.store.listTaskAssignments({ limit: input.limit ?? 100 }))
      .filter((assignment) => isActive(assignment.status) && assignment.leaseExpiresAt <= now)
      .sort((left, right) => left.leaseExpiresAt.localeCompare(right.leaseExpiresAt));
    const expired: TaskAssignment[] = [];
    const retries: TaskAssignment[] = [];

    for (const assignment of candidates) {
      const expiredAssignment: TaskAssignment = {
        ...assignment,
        status: "expired",
        resultSummary: `Lease expired at ${assignment.leaseExpiresAt}`,
        updatedAt: now,
        completedAt: now,
      };
      await this.store.updateTaskAssignment(expiredAssignment);
      expired.push(expiredAssignment);

      const oldWorker = await this.store.getWorkerRegistration(assignment.workerId);
      if (oldWorker) {
        await this.bumpWorkerLoad(oldWorker, -1);
      }

      await this.audit("task.expired", input.actor, `Assignment lease expired: ${assignment.id}`, expiredAssignment, {
        workerId: assignment.workerId,
        leaseExpiresAt: assignment.leaseExpiresAt,
        attempts: assignment.attempts,
      });
      await this.emitRoomEvent(input.actor, expiredAssignment, "task.expired", {
        workerId: assignment.workerId,
        leaseExpiresAt: assignment.leaseExpiresAt,
        attempts: assignment.attempts,
      });

      const retryWorker = input.retryWorkerId
        ? await this.requireSchedulableWorker(input.retryWorkerId, assignment.projectId)
        : input.autoSelectRetryWorker
          ? await this.selectRetryWorker(assignment)
          : undefined;

      if (retryWorker && assignment.attempts < maxAttempts) {
        const retryDelayMs = retryDelay({
          attempts: assignment.attempts,
          baseBackoffMs: input.baseBackoffMs,
          maxBackoffMs: input.maxBackoffMs,
          jitterMs: input.jitterMs,
        });
        const retryNotBefore = new Date(new Date(now).getTime() + retryDelayMs).toISOString();
        const retry = await this.scheduleRetry({
          expiredAssignment,
          retryWorker,
          actor: input.actor,
          now,
          leaseTtlSeconds: input.leaseTtlSeconds,
          retryDelayMs,
          retryNotBefore,
          metadata: input.metadata,
        });
        retries.push(retry);
        continue;
      }

      await this.markTargetExpired(expiredAssignment, input.exhaustedTargetStatus ?? "paused");
    }

    return { expired, retries };
  }

  private async resolveTarget(input: AssignTaskInput): Promise<{ kind: "session"; session: Session; subtask?: undefined; projectId?: string; roomId?: string } | { kind: "subtask"; session?: undefined; subtask: Subtask; projectId?: string; roomId?: string }> {
    if ((input.sessionId ? 1 : 0) + (input.subtaskId ? 1 : 0) !== 1) {
      throw new Error("Provide exactly one of sessionId or subtaskId.");
    }
    if (input.sessionId) {
      const session = await this.store.getSession(input.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${input.sessionId}`);
      }
      if (session.status === "completed" || session.status === "cancelled") {
        throw new Error(`Cannot assign a ${session.status} session: ${session.id}`);
      }
      return { kind: "session", session, projectId: session.projectId, roomId: session.roomId };
    }
    const subtask = (await this.store.listSubtasks()).find((candidate) => candidate.id === input.subtaskId);
    if (!subtask) {
      throw new Error(`Subtask not found: ${input.subtaskId}`);
    }
    if (subtask.status === "completed" || subtask.status === "cancelled") {
      throw new Error(`Cannot assign a ${subtask.status} subtask: ${subtask.id}`);
    }
    const spec = subtask.specId ? await this.store.getSpecification(subtask.specId) : undefined;
    return { kind: "subtask", subtask, projectId: spec?.projectId, roomId: subtask.roomId ?? spec?.roomId };
  }

  private async requireSchedulableWorker(workerId: string, projectId?: string): Promise<WorkerRegistration> {
    const worker = await this.store.getWorkerRegistration(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }
    if (worker.status !== "online") {
      throw new Error(`Worker is not schedulable: ${worker.id} status=${worker.status}`);
    }
    if (worker.expiresAt && worker.expiresAt <= new Date().toISOString()) {
      throw new Error(`Worker heartbeat is expired: ${worker.id}`);
    }
    if (worker.currentLoad >= worker.maxConcurrentTasks) {
      throw new Error(`Worker is at capacity: ${worker.id}`);
    }
    if (projectId && worker.allowedProjects.length > 0 && !worker.allowedProjects.includes(projectId as WorkerRegistration["allowedProjects"][number])) {
      throw new Error(`Worker ${worker.id} is not allowed for project ${projectId}`);
    }
    return worker;
  }

  private async assertNoActiveAssignment(target: { kind: "session" | "subtask"; session?: Session; subtask?: Subtask }): Promise<void> {
    const existing = await this.store.listTaskAssignments({
      sessionId: target.session?.id,
      subtaskId: target.subtask?.id,
      limit: 20,
    });
    const now = new Date().toISOString();
    for (const assignment of existing) {
      if (!isActive(assignment.status)) {
        continue;
      }
      if (assignment.leaseExpiresAt <= now) {
        await this.store.updateTaskAssignment({ ...assignment, status: "expired", updatedAt: now, completedAt: now });
        continue;
      }
      throw new Error(`Active assignment already exists for ${target.kind}: ${assignment.id}`);
    }
  }

  private async markTargetAssigned(target: { kind: "session" | "subtask"; session?: Session; subtask?: Subtask }, worker: WorkerRegistration): Promise<void> {
    if (target.session) {
      await this.store.updateSessionStatus(target.session.id, "running");
      return;
    }
    if (target.subtask) {
      await this.store.updateSubtask({
        ...target.subtask,
        assignedAgentId: worker.agentId,
        status: "assigned",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private async markTargetCompleted(
    assignment: TaskAssignment,
    status: Extract<TaskAssignmentStatus, "completed" | "failed" | "cancelled">,
    resultSummary?: string,
  ): Promise<void> {
    if (assignment.sessionId) {
      await this.store.updateSessionStatus(assignment.sessionId, status === "completed" ? "completed" : status);
      return;
    }
    if (assignment.subtaskId) {
      const subtask = (await this.store.listSubtasks()).find((candidate) => candidate.id === assignment.subtaskId);
      if (subtask) {
        const updated: Subtask = {
          ...subtask,
          status,
          resultSummary,
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
        await this.store.updateSubtask(updated);
        await this.updateLinkedSpecTask(updated, status, resultSummary, assignment);
      }
    }
  }

  private async pauseAssignment(assignment: TaskAssignment, actor: ActorRef, resultSummary?: string): Promise<TaskAssignment> {
    const now = new Date().toISOString();
    const updated: TaskAssignment = {
      ...assignment,
      status: "paused",
      resultSummary,
      updatedAt: now,
      completedAt: now,
    };
    await this.store.updateTaskAssignment(updated);
    const worker = await this.store.getWorkerRegistration(assignment.workerId);
    if (worker) {
      await this.bumpWorkerLoad(worker, -1);
    }
    await this.audit("task.paused", actor, `Assignment paused: ${updated.id}`, updated, {
      workerId: updated.workerId,
      resultSummary,
    });
    await this.emitRoomEvent(actor, updated, "task.paused", {
      workerId: updated.workerId,
      resultSummary,
    });
    return updated;
  }


  private async markTargetExpired(assignment: TaskAssignment, targetStatus: "paused" | "failed"): Promise<void> {
    if (assignment.sessionId) {
      await this.store.updateSessionStatus(assignment.sessionId, targetStatus);
      return;
    }
    if (assignment.subtaskId) {
      const subtask = (await this.store.listSubtasks()).find((candidate) => candidate.id === assignment.subtaskId);
      if (subtask) {
        const updated: Subtask = {
          ...subtask,
          status: targetStatus === "paused" ? "failed" : targetStatus,
          resultSummary: targetStatus === "paused" ? "Assignment lease expired; waiting for reschedule." : "Assignment lease expired.",
          updatedAt: new Date().toISOString(),
          completedAt: targetStatus === "failed" ? new Date().toISOString() : subtask.completedAt,
        };
        await this.store.updateSubtask(updated);
        if (targetStatus === "failed") {
          await this.updateLinkedSpecTask(updated, "failed", updated.resultSummary, assignment);
        }
      }
    }
  }

  private async markTargetPaused(assignment: TaskAssignment, resultSummary?: string): Promise<void> {
    if (assignment.sessionId) {
      await this.store.updateSessionStatus(assignment.sessionId, "paused");
      return;
    }
    if (assignment.subtaskId) {
      const subtask = (await this.store.listSubtasks()).find((candidate) => candidate.id === assignment.subtaskId);
      if (subtask) {
        const updated: Subtask = {
          ...subtask,
          status: "failed",
          resultSummary: resultSummary ?? "Assignment paused by worker shutdown.",
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
        await this.store.updateSubtask(updated);
        if (subtask.specId && subtask.specTaskId) {
          await this.updateLinkedSpecTask(updated, "failed", updated.resultSummary, assignment);
        }
      }
    }
  }

  private async updateLinkedSpecTask(
    subtask: Subtask,
    status: Extract<TaskAssignmentStatus, "completed" | "failed" | "cancelled">,
    resultSummary: string | undefined,
    assignment: TaskAssignment,
  ): Promise<void> {
    if (!subtask.specId || !subtask.specTaskId) {
      return;
    }
    const task = (await this.store.listSpecificationTasks(subtask.specId)).find((candidate) => candidate.id === subtask.specTaskId);
    if (!task) {
      return;
    }
    const verificationRequired = Boolean(task.verification);
    const verificationPassed =
      !verificationRequired ||
      (await this.store.listSpecificationVerifications({
        specId: subtask.specId,
        taskId: subtask.specTaskId,
        status: "passed",
        limit: 1,
      })).length > 0;
    const nextStatus = status === "completed" && (!verificationRequired || verificationPassed) ? "completed" : "blocked";
    const now = new Date().toISOString();
    await this.store.updateSpecificationTask({
      ...task,
      status: nextStatus,
      updatedAt: now,
      metadata: {
        ...(task.metadata ?? {}),
        terminalAssignmentId: assignment.id,
        terminalAssignmentStatus: status,
        resultSummary,
        verificationRequired,
        verificationGate: verificationRequired && !verificationPassed && status === "completed" ? "missing_passed_evidence" : undefined,
      },
    });
    await this.store.recordAuditEvent({
      id: makeId<"AuditEventId">("audit"),
      type: "spec.task_updated",
      actor: assignment.assignedBy,
      projectId: assignment.projectId,
      roomId: assignment.roomId,
      summary: `Specification task ${nextStatus}: ${task.title}`,
      metadata: {
        specId: subtask.specId,
        taskId: task.id,
        subtaskId: subtask.id,
        assignmentId: assignment.id,
        status: nextStatus,
        resultSummary,
        verificationRequired,
        verificationGate: verificationRequired && !verificationPassed && status === "completed" ? "missing_passed_evidence" : undefined,
      },
      createdAt: now,
    });
  }

  private async scheduleRetry(input: {
    expiredAssignment: TaskAssignment;
    retryWorker: WorkerRegistration;
    actor: ActorRef;
    now: string;
    leaseTtlSeconds?: number;
    retryDelayMs: number;
    retryNotBefore: string;
    metadata?: Record<string, unknown>;
  }): Promise<TaskAssignment> {
    const worker = input.retryWorker;
    const retry: TaskAssignment = {
      ...input.expiredAssignment,
      id: makeId<"TaskAssignmentId">("assign"),
      workerId: worker.id,
      status: "leased",
      attempts: input.expiredAssignment.attempts + 1,
      leaseOwnerId: worker.id,
      leaseExpiresAt: leaseExpiresAt(new Date(input.now), input.leaseTtlSeconds),
      assignedBy: input.actor,
      resultSummary: undefined,
      metadata: {
        ...(input.expiredAssignment.metadata ?? {}),
        ...(input.metadata ?? {}),
        retryOfAssignmentId: input.expiredAssignment.id,
        retryDelayMs: input.retryDelayMs,
        retryNotBefore: input.retryNotBefore,
      },
      createdAt: input.now,
      updatedAt: input.now,
      completedAt: undefined,
    };
    await this.store.createTaskAssignment(retry);
    await this.markAssignmentTargetRetried(retry, worker);
    await this.bumpWorkerLoad(worker, 1);
    await this.audit("task.retry_scheduled", input.actor, `Retry scheduled for assignment ${input.expiredAssignment.id}`, retry, {
      retryOfAssignmentId: input.expiredAssignment.id,
      workerId: worker.id,
      attempts: retry.attempts,
      retryDelayMs: input.retryDelayMs,
      retryNotBefore: input.retryNotBefore,
    });
    await this.emitRoomEvent(input.actor, retry, "task.retry_scheduled", {
      retryOfAssignmentId: input.expiredAssignment.id,
      workerId: worker.id,
      attempts: retry.attempts,
      retryDelayMs: input.retryDelayMs,
      retryNotBefore: input.retryNotBefore,
    });
    return retry;
  }

  private async selectRetryWorker(assignment: TaskAssignment): Promise<WorkerRegistration | undefined> {
    const now = new Date().toISOString();
    const workers = await this.store.listWorkerRegistrations({ status: "online", projectId: assignment.projectId, limit: 100 });
    return workers
      .filter((worker) => worker.id !== assignment.workerId)
      .filter((worker) => !worker.expiresAt || worker.expiresAt > now)
      .filter((worker) => worker.currentLoad < worker.maxConcurrentTasks)
      .filter((worker) => !assignment.projectId || worker.allowedProjects.length === 0 || worker.allowedProjects.includes(assignment.projectId))
      .sort((left, right) => {
        const leftRatio = left.currentLoad / Math.max(1, left.maxConcurrentTasks);
        const rightRatio = right.currentLoad / Math.max(1, right.maxConcurrentTasks);
        if (leftRatio !== rightRatio) {
          return leftRatio - rightRatio;
        }
        if (left.currentLoad !== right.currentLoad) {
          return left.currentLoad - right.currentLoad;
        }
        return left.registeredAt.localeCompare(right.registeredAt);
      })[0];
  }

  private async markAssignmentTargetRetried(assignment: TaskAssignment, worker: WorkerRegistration): Promise<void> {
    if (assignment.sessionId) {
      await this.store.updateSessionStatus(assignment.sessionId, "running");
      return;
    }
    if (assignment.subtaskId) {
      const subtask = (await this.store.listSubtasks()).find((candidate) => candidate.id === assignment.subtaskId);
      if (subtask) {
        await this.store.updateSubtask({
          ...subtask,
          assignedAgentId: worker.agentId,
          status: "assigned",
          updatedAt: new Date().toISOString(),
          completedAt: undefined,
        });
      }
    }
  }

  private async bumpWorkerLoad(worker: WorkerRegistration, delta: number): Promise<void> {
    await this.store.updateWorkerHeartbeat({
      workerId: worker.id,
      currentLoad: Math.max(0, worker.currentLoad + delta),
    });
  }

  private async requireAssignment(assignmentId: string): Promise<TaskAssignment> {
    const assignment = await this.store.getTaskAssignment(assignmentId);
    if (!assignment) {
      throw new Error(`Assignment not found: ${assignmentId}`);
    }
    return assignment;
  }

  private assertWorkerOwnsAssignment(assignment: TaskAssignment, workerId: string): void {
    if (assignment.workerId !== workerId || assignment.leaseOwnerId !== workerId) {
      throw new Error(`Worker ${workerId} does not own assignment ${assignment.id}`);
    }
  }

  private assertActiveAssignment(assignment: TaskAssignment): void {
    if (!isActive(assignment.status)) {
      throw new Error(`Assignment is not active: ${assignment.id} status=${assignment.status}`);
    }
    if (assignment.leaseExpiresAt <= new Date().toISOString()) {
      throw new Error(`Assignment lease expired: ${assignment.id}`);
    }
  }

  private async audit(
    type: AuditEvent["type"],
    actor: ActorRef,
    summary: string,
    assignment: TaskAssignment,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.store.recordAuditEvent({
      id: makeId<"AuditEventId">("audit"),
      type,
      actor,
      projectId: assignment.projectId,
      roomId: assignment.roomId,
      sessionId: assignment.sessionId,
      summary,
      metadata: {
        assignmentId: assignment.id,
        subtaskId: assignment.subtaskId,
        status: assignment.status,
        ...metadata,
      },
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
  }

  private async auditRaw(type: AuditEvent["type"], actor: ActorRef, summary: string, metadata: Record<string, unknown>): Promise<void> {
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

  private async emitRoomEvent(
    actor: ActorRef,
    assignment: TaskAssignment,
    type: Extract<AuditEvent["type"], "task.assigned" | "task.paused" | "task.completed" | "task.failed" | "task.cancelled" | "task.expired" | "task.retry_scheduled">,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!assignment.roomId || !(await this.store.getRoom(assignment.roomId))) {
      return;
    }

    try {
      await this.store.appendRoomMessage({
        id: makeId<"MessageId">("msg"),
        roomId: assignment.roomId,
        sender: actor,
        kind: type === "task.completed" || type === "task.failed" || type === "task.cancelled" ? "decision" : "task",
        body: roomEventBody(type, assignment, metadata),
        createdAt: new Date().toISOString(),
        artifactRefs: [],
      });
    } catch {
      // Local room visibility is best-effort; assignment rows and audit events remain authoritative.
    }
  }
}

function leaseExpiresAt(now: Date, leaseTtlSeconds = 300): string {
  return new Date(now.getTime() + leaseTtlSeconds * 1000).toISOString();
}

function retryDelay(input: { attempts: number; baseBackoffMs?: number; maxBackoffMs?: number; jitterMs?: number }): number {
  const base = input.baseBackoffMs ?? 0;
  const max = input.maxBackoffMs ?? Math.max(base, 0);
  const capped = Math.min(max, base * 2 ** Math.max(0, input.attempts - 1));
  const jitter = input.jitterMs ? Math.floor(Math.random() * (input.jitterMs + 1)) : 0;
  return Math.max(0, capped + jitter);
}

function isActive(status: TaskAssignmentStatus): boolean {
  return status === "leased" || status === "running";
}

function isTerminal(status: TaskAssignmentStatus): boolean {
  return status === "paused" || status === "completed" || status === "failed" || status === "cancelled" || status === "expired";
}

function auditTypeForCompletion(
  status: Extract<TaskAssignmentStatus, "completed" | "failed" | "cancelled">,
): Extract<AuditEvent["type"], "task.completed" | "task.failed" | "task.cancelled"> {
  switch (status) {
    case "completed":
      return "task.completed";
    case "failed":
      return "task.failed";
    case "cancelled":
      return "task.cancelled";
  }
}

function roomEventBody(type: AuditEvent["type"], assignment: TaskAssignment, metadata: Record<string, unknown>): string {
  const target = assignment.sessionId ? `session ${assignment.sessionId}` : `subtask ${assignment.subtaskId ?? "-"}`;
  const lines = [
    `Task event: ${type}`,
    `Assignment: ${assignment.id}`,
    `Target: ${target}`,
    `Worker: ${metadata.workerId ?? assignment.workerId}`,
    `Status: ${assignment.status}`,
    `Attempt: ${assignment.attempts}`,
  ];
  if (metadata.retryOfAssignmentId) {
    lines.push(`Retry of: ${metadata.retryOfAssignmentId}`);
  }
  if (metadata.retryNotBefore) {
    lines.push(`Retry not before: ${metadata.retryNotBefore}`);
  }
  if (metadata.leaseExpiresAt) {
    lines.push(`Lease expired at: ${metadata.leaseExpiresAt}`);
  }
  if (metadata.resultSummary) {
    lines.push(`Result: ${compactRoomEventValue(String(metadata.resultSummary))}`);
  }
  return lines.join("\n");
}

function compactRoomEventValue(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}\n[truncated]` : value;
}
