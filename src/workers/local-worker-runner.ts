import type { AgentLoop } from "../core/agent-loop.js";
import type { TaskBroker } from "../broker/task-broker.js";
import type { ActorRef, TaskAssignment, TaskLeaseEnvelope } from "../domain/index.js";
import type { AgentStore } from "../store/agent-store.js";
import type { TaskAssignmentService } from "../tasks/task-assignment-service.js";
import type { WorkerRegistryService } from "./worker-registry-service.js";
import { DaemonLifecycleController } from "../daemon/daemon-lifecycle.js";
import type { DaemonLifecycleSnapshot, DaemonLoopMetrics, DaemonStopReason } from "../daemon/daemon-lifecycle.js";

export type WorkerRunOnceResult =
  | {
      ran: false;
      workerId: string;
      reason: "no_assignment";
    }
  | {
      ran: true;
      workerId: string;
      assignment: TaskAssignment;
      finalAnswer: string;
      completed: boolean;
    };

export type WorkerPollResult = {
  workerId: string;
  stopReason: "limit_reached" | "idle" | "paused_assignment" | "worker_not_runnable" | "aborted" | "shutdown_requested";
  runsAttempted: number;
  assignmentsCompleted: number;
  idlePolls: number;
  results: WorkerRunOnceResult[];
  lifecycle: DaemonLifecycleSnapshot;
  metrics: WorkerPollMetrics;
};

export type WorkerPollMetrics = DaemonLoopMetrics & {
  runsAttempted: number;
  idlePolls: number;
  assignmentsCompleted: number;
};

export type WorkerInFlightShutdownPolicy = "preserve_lease" | "release_lease" | "mark_paused";

export class LocalWorkerRunner {
  constructor(
    private readonly input: {
      store: AgentStore;
      assignments: TaskAssignmentService;
      taskBroker?: TaskBroker;
      workers: WorkerRegistryService;
      createAgent: () => AgentLoop | Promise<AgentLoop>;
      verifyTaskLeaseEnvelope?: (envelope: TaskLeaseEnvelope) => Promise<"valid" | "unsigned" | "unknown_agent" | "invalid">;
    },
  ) {}

  async poll(input: {
    workerId: string;
    leaseTtlSeconds?: number;
    actor?: ActorRef;
    maxRuns?: number;
    idleIntervalMs?: number;
    maxIdlePolls?: number;
    requireSignedLeaseEnvelope?: boolean;
    signal?: AbortSignal;
    lifecycle?: DaemonLifecycleController;
    inFlightShutdownPolicy?: WorkerInFlightShutdownPolicy;
  }): Promise<WorkerPollResult> {
    const lifecycle = input.lifecycle ?? new DaemonLifecycleController("worker");
    await lifecycle.start();
    const maxRuns = input.maxRuns ?? Number.POSITIVE_INFINITY;
    const maxIdlePolls = input.maxIdlePolls ?? 1;
    const idleIntervalMs = input.idleIntervalMs ?? 1000;
    const results: WorkerRunOnceResult[] = [];
    let runsAttempted = 0;
    let assignmentsCompleted = 0;
    let idlePolls = 0;

    while (runsAttempted < maxRuns) {
      if (lifecycle.isShutdownRequested) {
        await lifecycle.stop("shutdown_requested");
        return workerPollResult(input.workerId, "shutdown_requested", runsAttempted, assignmentsCompleted, idlePolls, results, lifecycle);
      }
      if (input.signal?.aborted) {
        await lifecycle.stop("aborted");
        return workerPollResult(input.workerId, "aborted", runsAttempted, assignmentsCompleted, idlePolls, results, lifecycle);
      }

      const worker = await this.input.store.getWorkerRegistration(input.workerId);
      if (!worker || worker.status !== "online") {
        await lifecycle.stop("worker_not_runnable");
        return workerPollResult(input.workerId, "worker_not_runnable", runsAttempted, assignmentsCompleted, idlePolls, results, lifecycle);
      }

      const runStartedAtMs = Date.now();
      const result = await this.runOnce({
        workerId: input.workerId,
        leaseTtlSeconds: input.leaseTtlSeconds,
        actor: input.actor,
        requireSignedLeaseEnvelope: input.requireSignedLeaseEnvelope,
        lifecycle,
        manageLifecycle: false,
        inFlightShutdownPolicy: input.inFlightShutdownPolicy,
      });
      results.push(result);
      await lifecycle.recordTick(workerRunMetrics(result, Date.now() - runStartedAtMs));

      if (!result.ran) {
        idlePolls += 1;
        if (idlePolls >= maxIdlePolls) {
          await lifecycle.recordIdle();
          await lifecycle.stop("idle");
          return workerPollResult(input.workerId, "idle", runsAttempted, assignmentsCompleted, idlePolls, results, lifecycle);
        }
        await sleep(idleIntervalMs, input.signal);
        continue;
      }

      runsAttempted += 1;
      idlePolls = 0;
      if (result.completed) {
        assignmentsCompleted += 1;
        if (lifecycle.isShutdownRequested) {
          await lifecycle.stop("shutdown_requested");
          return workerPollResult(input.workerId, "shutdown_requested", runsAttempted, assignmentsCompleted, idlePolls, results, lifecycle);
        }
        continue;
      }
      if (lifecycle.isShutdownRequested) {
        await lifecycle.stop("shutdown_requested");
        return workerPollResult(input.workerId, "shutdown_requested", runsAttempted, assignmentsCompleted, idlePolls, results, lifecycle);
      }
      await lifecycle.stop("paused_assignment");
      return workerPollResult(input.workerId, "paused_assignment", runsAttempted, assignmentsCompleted, idlePolls, results, lifecycle);
    }

    await lifecycle.stop("limit_reached");
    return workerPollResult(input.workerId, "limit_reached", runsAttempted, assignmentsCompleted, idlePolls, results, lifecycle);
  }

  async runOnce(input: {
    workerId: string;
    leaseTtlSeconds?: number;
    actor?: ActorRef;
    requireSignedLeaseEnvelope?: boolean;
    lifecycle?: DaemonLifecycleController;
    manageLifecycle?: boolean;
    inFlightShutdownPolicy?: WorkerInFlightShutdownPolicy;
  }): Promise<WorkerRunOnceResult> {
    const lifecycle = input.lifecycle;
    const manageLifecycle = lifecycle !== undefined && input.manageLifecycle !== false;
    if (manageLifecycle) {
      await lifecycle.start();
    }
    const startedAtMs = Date.now();
    const actor = input.actor ?? { type: "agent", id: input.workerId, displayName: input.workerId };
    let result: WorkerRunOnceResult | undefined;
    try {
      await this.input.workers.heartbeat({
        workerId: input.workerId,
        actor,
        status: "online",
        ttlSeconds: input.leaseTtlSeconds ?? 300,
      });

      const assignment = await this.claimNextAssignment(input.workerId, actor, input.leaseTtlSeconds ?? 300);
      if (!assignment) {
        result = { ran: false, workerId: input.workerId, reason: "no_assignment" };
        return result;
      }

      const leaseStatus = await this.verifyLeaseIfRequired(assignment, input.requireSignedLeaseEnvelope === true);
      if (leaseStatus !== "valid") {
        const failed = await this.completeAssignment({
          assignmentId: assignment.id,
          workerId: input.workerId,
          actor,
          status: "failed",
          resultSummary: `Task lease signature rejected: ${leaseStatus}`,
        });
        result = {
          ran: true,
          workerId: input.workerId,
          assignment: failed,
          finalAnswer: `Task lease signature rejected: ${leaseStatus}`,
          completed: true,
        };
        return result;
      }

      const finalAnswer = await this.executeAssignment(assignment);
      if (lifecycle?.isShutdownRequested) {
        result = await this.handleInFlightShutdown({
          assignment,
          workerId: input.workerId,
          actor,
          finalAnswer,
          policy: input.inFlightShutdownPolicy ?? "preserve_lease",
        });
        return result;
      }
      const latestStatus = await this.targetStatus(assignment);
      if (latestStatus === "paused") {
        result = {
          ran: true,
          workerId: input.workerId,
          assignment,
          finalAnswer,
          completed: false,
        };
        return result;
      }
      const completionStatus = latestStatus === "failed" ? "failed" : latestStatus === "cancelled" ? "cancelled" : "completed";
      const completed = await this.completeAssignment({
        assignmentId: assignment.id,
        workerId: input.workerId,
        actor,
        status: completionStatus,
        resultSummary: compactSummary(finalAnswer),
      });
      result = {
        ran: true,
        workerId: input.workerId,
        assignment: completed,
        finalAnswer,
        completed: true,
      };
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const assignment = await this.nextAssignment(input.workerId);
      if (!assignment) {
        throw error;
      }
      const failed = await this.completeAssignment({
        assignmentId: assignment.id,
        workerId: input.workerId,
        actor,
        status: "failed",
        resultSummary: message,
      });
      result = {
        ran: true,
        workerId: input.workerId,
        assignment: failed,
        finalAnswer: message,
        completed: true,
      };
      return result;
    } finally {
      if (manageLifecycle) {
        const finalResult = result;
        await lifecycle.recordTick(workerRunMetrics(finalResult ?? { ran: false, workerId: input.workerId, reason: "no_assignment" }, Date.now() - startedAtMs));
        if (finalResult && !finalResult.ran) {
          await lifecycle.recordIdle();
          await lifecycle.stop("idle");
        } else if (finalResult && !finalResult.completed) {
          await lifecycle.stop(lifecycle.isShutdownRequested ? "shutdown_requested" : "paused_assignment");
        } else if (lifecycle.isShutdownRequested) {
          await lifecycle.stop("shutdown_requested");
        } else {
          await lifecycle.stop(finalResult ? workerRunStopReason(finalResult) : "completed");
        }
      }
    }
  }

  private async handleInFlightShutdown(input: {
    assignment: TaskAssignment;
    workerId: string;
    actor: ActorRef;
    finalAnswer: string;
    policy: WorkerInFlightShutdownPolicy;
  }): Promise<WorkerRunOnceResult> {
    const summary = compactSummary(`Worker shutdown requested during assignment. Policy: ${input.policy}.`);
    if (input.policy === "preserve_lease") {
      return {
        ran: true,
        workerId: input.workerId,
        assignment: input.assignment,
        finalAnswer: `${input.finalAnswer}\n${summary}`,
        completed: false,
      };
    }
    const paused = await this.input.assignments.pause({
      assignmentId: input.assignment.id,
      workerId: input.workerId,
      actor: input.actor,
      resultSummary: summary,
      pauseTarget: input.policy === "mark_paused",
    });
    return {
      ran: true,
      workerId: input.workerId,
      assignment: paused,
      finalAnswer: `${input.finalAnswer}\n${summary}`,
      completed: true,
    };
  }

  private async claimNextAssignment(workerId: string, actor: ActorRef, leaseTtlSeconds: number): Promise<TaskAssignment | undefined> {
    if (this.input.taskBroker) {
      return this.input.taskBroker.claimNext({ workerId, actor, leaseTtlSeconds });
    }
    const assignment = await this.nextAssignment(workerId);
    if (!assignment) {
      return undefined;
    }
    return this.input.assignments.heartbeat({
      assignmentId: assignment.id,
      workerId,
      actor,
      leaseTtlSeconds,
    });
  }

  private async verifyLeaseIfRequired(assignment: TaskAssignment, required: boolean): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid" | "missing_verifier"> {
    if (!required) {
      return "valid";
    }
    if (!this.input.verifyTaskLeaseEnvelope) {
      return "missing_verifier";
    }
    const envelope = assignment.metadata?.leaseEnvelope;
    if (!isTaskLeaseEnvelope(envelope)) {
      return "unsigned";
    }
    return this.input.verifyTaskLeaseEnvelope(envelope);
  }

  private async completeAssignment(input: {
    assignmentId: string;
    workerId: string;
    actor: ActorRef;
    status: "completed" | "failed" | "cancelled";
    resultSummary?: string;
  }): Promise<TaskAssignment> {
    if (this.input.taskBroker) {
      return this.input.taskBroker.complete(input);
    }
    return this.input.assignments.complete(input);
  }

  private async nextAssignment(workerId: string): Promise<TaskAssignment | undefined> {
    const now = new Date().toISOString();
    const assignments = await this.input.assignments.list({ workerId, limit: 50 });
    return assignments
      .filter((assignment) => (assignment.status === "leased" || assignment.status === "running") && assignment.leaseExpiresAt > now)
      .filter((assignment) => isReadyToRun(assignment, now))
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return right.priority - left.priority;
        }
        return left.createdAt.localeCompare(right.createdAt);
      })[0];
  }

  private async executeAssignment(assignment: TaskAssignment): Promise<string> {
    const agent = await this.input.createAgent();
    const sessionId = await this.resolveSessionId(assignment);
    return agent.resume(sessionId);
  }

  private async resolveSessionId(assignment: TaskAssignment): Promise<string> {
    if (assignment.sessionId) {
      return assignment.sessionId;
    }
    if (!assignment.subtaskId) {
      throw new Error(`Assignment has no executable target: ${assignment.id}`);
    }
    const subtask = (await this.input.store.listSubtasks()).find((candidate) => candidate.id === assignment.subtaskId);
    if (!subtask?.childSessionId) {
      throw new Error(`Subtask has no child session to resume: ${assignment.subtaskId}`);
    }
    return subtask.childSessionId;
  }

  private async targetStatus(assignment: TaskAssignment): Promise<"paused" | "failed" | "cancelled" | "completed"> {
    const sessionId = await this.resolveSessionId(assignment);
    const session = await this.input.store.getSession(sessionId);
    if (session?.status === "paused" || session?.status === "failed" || session?.status === "cancelled") {
      return session.status;
    }
    return "completed";
  }
}

function compactSummary(value: string): string {
  return value.length > 2000 ? `${value.slice(0, 2000)}\n[truncated]` : value;
}

function isReadyToRun(assignment: TaskAssignment, now: string): boolean {
  const notBefore = assignment.metadata?.retryNotBefore;
  return typeof notBefore !== "string" || notBefore <= now;
}

function isTaskLeaseEnvelope(value: unknown): value is TaskLeaseEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const envelope = value as TaskLeaseEnvelope;
  return (
    envelope.version === 1 &&
    typeof envelope.assignmentId === "string" &&
    typeof envelope.workerId === "string" &&
    typeof envelope.leaseOwnerId === "string" &&
    typeof envelope.leaseExpiresAt === "string" &&
    typeof envelope.claimedAt === "string" &&
    typeof envelope.claimedBy === "object" &&
    typeof envelope.broker === "string" &&
    typeof envelope.nonce === "string"
  );
}

function workerRunMetrics(result: WorkerRunOnceResult, durationMs: number): Partial<DaemonLoopMetrics> {
  return {
    loopLatencyMs: durationMs,
    assignmentsCompleted: result.ran && result.completed ? 1 : 0,
    activeLeases: result.ran && !result.completed ? 1 : 0,
    failures: result.ran && result.assignment.status === "failed" ? 1 : 0,
  };
}

function workerRunStopReason(result: WorkerRunOnceResult): DaemonStopReason {
  if (!result.ran) {
    return "idle";
  }
  if (!result.completed) {
    return "paused_assignment";
  }
  return result.assignment.status === "completed" ? "completed" : result.assignment.status === "failed" ? "completed" : "completed";
}

function workerPollResult(
  workerId: string,
  stopReason: WorkerPollResult["stopReason"],
  runsAttempted: number,
  assignmentsCompleted: number,
  idlePolls: number,
  results: WorkerRunOnceResult[],
  lifecycle: DaemonLifecycleController,
): WorkerPollResult {
  return {
    workerId,
    stopReason,
    runsAttempted,
    assignmentsCompleted,
    idlePolls,
    results,
    lifecycle: lifecycle.snapshot(),
    metrics: {
      tickCount: results.length,
      idleCount: idlePolls,
      runsAttempted,
      idlePolls,
      assignmentsCompleted,
      loopLatencyMs: lifecycle.snapshot().metrics.loopLatencyMs,
      activeLeases: results.filter((result) => result.ran && !result.completed).length,
      failures: results.filter((result) => result.ran && result.assignment.status === "failed").length,
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
