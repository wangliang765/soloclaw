import type { ActorRef, WorkerHeartbeatEnvelope, WorkerRegistration } from "../domain/index.js";
import type { TaskBroker } from "../broker/task-broker.js";
import type { TaskAssignmentService } from "../tasks/task-assignment-service.js";
import type { SpecificationService } from "../specifications/specification-service.js";
import type { WorkerPollResult } from "../workers/local-worker-runner.js";
import type { LocalWorkerRunner } from "../workers/local-worker-runner.js";
import type { WorkerHealthSummary } from "../workers/worker-health-service.js";
import type { WorkerRegistryService } from "../workers/worker-registry-service.js";
import { DaemonLifecycleController } from "../daemon/daemon-lifecycle.js";
import type { DaemonLifecycleSnapshot, DaemonLoopMetrics } from "../daemon/daemon-lifecycle.js";

export type SchedulerTickInput = {
  actor: ActorRef;
  workerId?: string;
  requireSignedWorkerHeartbeat?: boolean;
  requireSignedLeaseEnvelope?: boolean;
  leaseTtlSeconds?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  jitterMs?: number;
  recoverLimit?: number;
  maxRunsPerWorker?: number;
  maxIdlePolls?: number;
  idleIntervalMs?: number;
  dispatchSpecId?: string;
  dispatchLimit?: number;
  dispatchWorkerId?: string;
  dispatchAutoSelectWorker?: boolean;
  dispatchPriority?: number;
  dispatchMaxLoadRatio?: number;
  dispatchMaxQueuedAssignmentsPerWorker?: number;
  completeDrainedWorkers?: boolean;
  warnLoadRatio?: number;
  warnQueueRatio?: number;
};

export type WorkerHeartbeatRejection = {
  workerId: string;
  status: "unsigned" | "unknown_agent" | "invalid" | "missing_verifier";
};

export type SchedulerTickResult = {
  generatedAt: string;
  durationMs: number;
  workersExpired: number;
  workerDrainCompletions: WorkerDrainCompletion[];
  workerDrainBlocked: WorkerDrainBlocker[];
  workerHeartbeatRejections: WorkerHeartbeatRejection[];
  recoveredExpired: number;
  retriesScheduled: number;
  specTasksDispatched: number;
  workersPolled: number;
  assignmentsCompleted: number;
  healthWarnings: SchedulerHealthWarning[];
  workerResults: WorkerPollResult[];
  metrics: SchedulerTickMetrics;
};

export type SchedulerTickMetrics = DaemonLoopMetrics & {
  idle: boolean;
  workersPolled: number;
  workerHeartbeatRejections: number;
  healthWarnings: number;
};

export type SchedulerHealthWarning = {
  code:
    | "worker_heartbeat_expired"
    | "assignment_lease_expired"
    | "worker_drain_blocked"
    | "worker_capacity_saturated"
    | "queue_pressure_high";
  severity: "info" | "warning" | "critical";
  message: string;
  metadata?: Record<string, unknown>;
};

export type WorkerDrainCompletion = {
  workerId: string;
  completedAt?: string;
};

export type WorkerDrainBlocker = {
  workerId: string;
  reason: string;
};

export type SchedulerRunInput = SchedulerTickInput & {
  intervalMs?: number;
  maxTicks?: number;
  stopWhenIdle?: boolean;
  idleTickLimit?: number;
  signal?: AbortSignal;
  lifecycle?: DaemonLifecycleController;
};

export type SchedulerRunResult = {
  startedAt: string;
  stoppedAt: string;
  stopReason: "max_ticks" | "idle" | "aborted" | "shutdown_requested";
  ticks: number;
  idleTicks: number;
  workersExpired: number;
  recoveredExpired: number;
  retriesScheduled: number;
  specTasksDispatched: number;
  workerDrainCompletions: number;
  workerDrainBlocked: WorkerDrainBlocker[];
  workersPolled: number;
  assignmentsCompleted: number;
  workerHeartbeatRejections: WorkerHeartbeatRejection[];
  healthWarnings: SchedulerHealthWarning[];
  tickResults: SchedulerTickResult[];
  lifecycle: DaemonLifecycleSnapshot;
  metrics: DaemonLoopMetrics;
};

export class LocalSchedulerService {
  constructor(
    private readonly input: {
      assignments: TaskAssignmentService;
      taskBroker?: TaskBroker;
      workers: WorkerRegistryService;
      workerRunner: LocalWorkerRunner;
      specifications?: SpecificationService;
      verifyWorkerHeartbeatEnvelope?: (envelope: WorkerHeartbeatEnvelope) => Promise<"valid" | "unsigned" | "unknown_agent" | "invalid">;
      getWorkerHealthSummary?: () => Promise<WorkerHealthSummary>;
    },
  ) {}

  async tick(input: SchedulerTickInput): Promise<SchedulerTickResult> {
    const startedAtMs = Date.now();
    const workerRecovery = await this.input.workers.recoverExpired({
      actor: input.actor,
      limit: input.recoverLimit,
    });
    const recovery = await (this.input.taskBroker ?? this.input.assignments).recoverExpired({
      actor: input.actor,
      retryWorkerId: input.workerId,
      autoSelectRetryWorker: !input.workerId,
      leaseTtlSeconds: input.leaseTtlSeconds,
      maxAttempts: input.maxAttempts,
      baseBackoffMs: input.baseBackoffMs,
      maxBackoffMs: input.maxBackoffMs,
      jitterMs: input.jitterMs,
      limit: input.recoverLimit,
    });

    const specDispatch = input.dispatchSpecId
      ? await this.dispatchSpecTasks(input)
      : [];

    const workers = input.workerId
      ? [await this.input.workers.get(input.workerId)]
      : await this.input.workers.list({ status: "online", limit: 100 });
    const workerResults: WorkerPollResult[] = [];
    const heartbeatRejections: WorkerHeartbeatRejection[] = [];

    for (const worker of workers) {
      if (!worker || worker.status !== "online") {
        continue;
      }
      const heartbeatStatus = await this.verifyHeartbeatIfRequired(worker, input.requireSignedWorkerHeartbeat === true);
      if (heartbeatStatus !== "valid") {
        heartbeatRejections.push({ workerId: worker.id, status: heartbeatStatus });
        continue;
      }
      const result = await this.input.workerRunner.poll({
        workerId: worker.id,
        actor: input.actor,
        leaseTtlSeconds: input.leaseTtlSeconds,
        maxRuns: input.maxRunsPerWorker ?? 1,
        maxIdlePolls: input.maxIdlePolls ?? 1,
        idleIntervalMs: input.idleIntervalMs ?? 0,
        requireSignedLeaseEnvelope: input.requireSignedLeaseEnvelope,
      });
      workerResults.push(result);
    }

    const drainResult = input.completeDrainedWorkers
      ? await this.completeDrainedWorkers(input)
      : { completions: [], blocked: [] };
    const health = this.input.getWorkerHealthSummary ? await this.input.getWorkerHealthSummary() : undefined;
    const healthWarnings = this.buildHealthWarnings(input, health, {
      workersExpired: workerRecovery.expired.length,
      assignmentsExpired: recovery.expired.length,
    });

    const resultWithoutMetrics = {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      workersExpired: workerRecovery.expired.length,
      workerDrainCompletions: drainResult.completions,
      workerDrainBlocked: drainResult.blocked,
      workerHeartbeatRejections: heartbeatRejections,
      recoveredExpired: recovery.expired.length,
      retriesScheduled: recovery.retries.length,
      specTasksDispatched: specDispatch.length,
      workersPolled: workerResults.length,
      assignmentsCompleted: workerResults.reduce((sum, result) => sum + result.assignmentsCompleted, 0),
      healthWarnings,
      workerResults,
    };
    const metrics = schedulerTickMetrics(resultWithoutMetrics, health);
    return {
      ...resultWithoutMetrics,
      metrics,
    };
  }

  private async verifyHeartbeatIfRequired(worker: WorkerRegistration, required: boolean): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid" | "missing_verifier"> {
    if (!required) {
      return "valid";
    }
    if (!this.input.verifyWorkerHeartbeatEnvelope) {
      return "missing_verifier";
    }
    const envelope = worker.metadata?.heartbeatEnvelope;
    if (!isWorkerHeartbeatEnvelope(envelope)) {
      return "unsigned";
    }
    return this.input.verifyWorkerHeartbeatEnvelope(envelope);
  }

  private async dispatchSpecTasks(input: SchedulerTickInput) {
    if (!input.dispatchSpecId) {
      return [];
    }
    if (!this.input.specifications) {
      throw new Error("Scheduler spec dispatch requires SpecificationService.");
    }
    return this.input.specifications.dispatchReadyTasks({
      actor: input.actor,
      specId: input.dispatchSpecId,
      workerId: input.dispatchWorkerId,
      autoSelectWorker: input.dispatchAutoSelectWorker ?? !input.dispatchWorkerId,
      limit: input.dispatchLimit,
      leaseTtlSeconds: input.leaseTtlSeconds,
      priority: input.dispatchPriority,
      maxDispatchLoadRatio: input.dispatchMaxLoadRatio,
      maxQueuedAssignmentsPerWorker: input.dispatchMaxQueuedAssignmentsPerWorker,
    });
  }

  private async completeDrainedWorkers(input: SchedulerTickInput): Promise<{ completions: WorkerDrainCompletion[]; blocked: WorkerDrainBlocker[] }> {
    const candidates = input.workerId
      ? [await this.input.workers.get(input.workerId)]
      : await this.input.workers.list({ status: "draining", limit: 100 });
    const completions: WorkerDrainCompletion[] = [];
    const blocked: WorkerDrainBlocker[] = [];
    for (const worker of candidates) {
      if (!worker || worker.status !== "draining") {
        continue;
      }
      try {
        const completed = await this.input.workers.completeDrain({
          workerId: worker.id,
          actor: input.actor,
          reason: "scheduler auto complete-drain",
        });
        completions.push({
          workerId: completed.id,
          completedAt: typeof completed.metadata?.drainCompletedAt === "string" ? completed.metadata.drainCompletedAt : undefined,
        });
      } catch (error) {
        blocked.push({
          workerId: worker.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { completions, blocked };
  }

  private buildHealthWarnings(input: SchedulerTickInput, health: WorkerHealthSummary | undefined, observed: { workersExpired: number; assignmentsExpired: number }): SchedulerHealthWarning[] {
    if (!health) {
      return [];
    }
    const loadThreshold = input.warnLoadRatio ?? 0.9;
    const queueThreshold = input.warnQueueRatio ?? 1;
    const warnings: SchedulerHealthWarning[] = [];
    const heartbeatExpired = Math.max(health.workers.heartbeatExpired, observed.workersExpired);
    const activeExpired = Math.max(health.assignments.activeExpired, observed.assignmentsExpired);
    if (heartbeatExpired > 0) {
      warnings.push({
        code: "worker_heartbeat_expired",
        severity: "critical",
        message: `${heartbeatExpired} worker heartbeat(s) are expired or were recovered this tick.`,
        metadata: { count: heartbeatExpired, recoveredThisTick: observed.workersExpired },
      });
    }
    if (activeExpired > 0) {
      warnings.push({
        code: "assignment_lease_expired",
        severity: "critical",
        message: `${activeExpired} active assignment lease(s) are expired or were recovered this tick.`,
        metadata: { count: activeExpired, recoveredThisTick: observed.assignmentsExpired },
      });
    }
    if (health.workers.drainingBlocked > 0) {
      warnings.push({
        code: "worker_drain_blocked",
        severity: "warning",
        message: `${health.workers.drainingBlocked} draining worker(s) still have active assignments.`,
        metadata: { count: health.workers.drainingBlocked },
      });
    }
    if (health.workers.onlineCapacity > 0 && health.pressure.loadRatio >= loadThreshold) {
      warnings.push({
        code: "worker_capacity_saturated",
        severity: health.pressure.loadRatio >= 1 ? "critical" : "warning",
        message: `Worker load ratio ${health.pressure.loadRatio} is at or above ${loadThreshold}.`,
        metadata: { loadRatio: health.pressure.loadRatio, threshold: loadThreshold, onlineLoad: health.workers.onlineLoad, onlineCapacity: health.workers.onlineCapacity },
      });
    }
    if (health.workers.onlineCapacity > 0 && health.pressure.queuedToCapacityRatio >= queueThreshold) {
      warnings.push({
        code: "queue_pressure_high",
        severity: health.pressure.queuedToCapacityRatio >= 2 ? "critical" : "warning",
        message: `Queued assignment ratio ${health.pressure.queuedToCapacityRatio} is at or above ${queueThreshold}.`,
        metadata: { queuedToCapacityRatio: health.pressure.queuedToCapacityRatio, threshold: queueThreshold },
      });
    }
    return warnings;
  }

  async run(input: SchedulerRunInput): Promise<SchedulerRunResult> {
    const startedAt = new Date().toISOString();
    const lifecycle = input.lifecycle ?? new DaemonLifecycleController("scheduler");
    await lifecycle.start(startedAt);
    const maxTicks = input.maxTicks ?? Number.POSITIVE_INFINITY;
    const intervalMs = input.intervalMs ?? 1000;
    const idleTickLimit = input.idleTickLimit ?? 1;
    const tickResults: SchedulerTickResult[] = [];
    let idleTicks = 0;

    while (tickResults.length < maxTicks) {
      if (lifecycle.isShutdownRequested) {
        await lifecycle.stop("shutdown_requested");
        return summarizeRun(startedAt, "shutdown_requested", tickResults, idleTicks, lifecycle);
      }
      if (input.signal?.aborted) {
        await lifecycle.stop("aborted");
        return summarizeRun(startedAt, "aborted", tickResults, idleTicks, lifecycle);
      }

      const result = await this.tick(input);
      tickResults.push(result);
      await lifecycle.recordTick(result.metrics, result.generatedAt);

      if (isIdleTick(result)) {
        idleTicks += 1;
        await lifecycle.recordIdle();
        if (input.stopWhenIdle && idleTicks >= idleTickLimit) {
          await lifecycle.stop("idle");
          return summarizeRun(startedAt, "idle", tickResults, idleTicks, lifecycle);
        }
      } else {
        idleTicks = 0;
      }

      if (tickResults.length >= maxTicks) {
        break;
      }
      await sleep(intervalMs, input.signal);
    }

    const stopReason = input.signal?.aborted ? "aborted" : "max_ticks";
    await lifecycle.stop(stopReason);
    return summarizeRun(startedAt, stopReason, tickResults, idleTicks, lifecycle);
  }
}

function schedulerTickMetrics(result: Omit<SchedulerTickResult, "metrics">, health?: WorkerHealthSummary): SchedulerTickMetrics {
  const idle = isIdleTick({ ...result, metrics: { tickCount: 0, idleCount: 0, idle: false, workersPolled: 0, workerHeartbeatRejections: 0, healthWarnings: 0 } });
  return {
    tickCount: 0,
    idleCount: idle ? 1 : 0,
    loopLatencyMs: result.durationMs,
    recoveredExpired: result.recoveredExpired,
    retriesScheduled: result.retriesScheduled,
    delayedRetries: health?.assignments.delayedRetries ?? result.retriesScheduled,
    activeLeases: health?.assignments.active,
    queueDepth: health?.assignments.byStatus.leased,
    heartbeatAgeMs: health ? maxHeartbeatAgeMs(health) : undefined,
    drainBlocked: result.workerDrainBlocked.length,
    assignmentsCompleted: result.assignmentsCompleted,
    failures: result.workerResults.flatMap((worker) => worker.results).filter((run) => run.ran && run.assignment.status === "failed").length,
    idle,
    workersPolled: result.workersPolled,
    workerHeartbeatRejections: result.workerHeartbeatRejections.length,
    healthWarnings: result.healthWarnings.length,
  };
}

function maxHeartbeatAgeMs(health: WorkerHealthSummary): number {
  const generatedAt = Date.parse(health.generatedAt);
  if (!Number.isFinite(generatedAt) || health.perWorker.length === 0) {
    return 0;
  }
  return health.perWorker.reduce((max, worker) => {
    const heartbeatAt = Date.parse(worker.lastHeartbeatAt);
    if (!Number.isFinite(heartbeatAt)) {
      return max;
    }
    return Math.max(max, Math.max(0, generatedAt - heartbeatAt));
  }, 0);
}

function isIdleTick(result: SchedulerTickResult): boolean {
  return (
    result.workersExpired === 0 &&
    result.workerDrainCompletions.length === 0 &&
    result.workerHeartbeatRejections.length === 0 &&
    result.recoveredExpired === 0 &&
    result.retriesScheduled === 0 &&
    result.specTasksDispatched === 0 &&
    result.assignmentsCompleted === 0 &&
    result.workerResults.every((worker) => worker.runsAttempted === 0)
  );
}

function isWorkerHeartbeatEnvelope(value: unknown): value is WorkerHeartbeatEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const envelope = value as WorkerHeartbeatEnvelope;
  return (
    envelope.version === 1 &&
    typeof envelope.workerId === "string" &&
    typeof envelope.agentId === "string" &&
    typeof envelope.machineId === "string" &&
    typeof envelope.status === "string" &&
    typeof envelope.currentLoad === "number" &&
    typeof envelope.maxConcurrentTasks === "number" &&
    typeof envelope.heartbeatAt === "string" &&
    typeof envelope.heartbeatBy === "object" &&
    typeof envelope.nonce === "string"
  );
}

function summarizeRun(
  startedAt: string,
  stopReason: SchedulerRunResult["stopReason"],
  tickResults: SchedulerTickResult[],
  idleTicks: number,
  lifecycle: DaemonLifecycleController,
): SchedulerRunResult {
  const metrics = summarizeMetrics(tickResults, idleTicks);
  return {
    startedAt,
    stoppedAt: new Date().toISOString(),
    stopReason,
    ticks: tickResults.length,
    idleTicks,
    workersExpired: tickResults.reduce((sum, tick) => sum + tick.workersExpired, 0),
    recoveredExpired: tickResults.reduce((sum, tick) => sum + tick.recoveredExpired, 0),
    retriesScheduled: tickResults.reduce((sum, tick) => sum + tick.retriesScheduled, 0),
    specTasksDispatched: tickResults.reduce((sum, tick) => sum + tick.specTasksDispatched, 0),
    workerDrainCompletions: tickResults.reduce((sum, tick) => sum + tick.workerDrainCompletions.length, 0),
    workerDrainBlocked: tickResults.flatMap((tick) => tick.workerDrainBlocked),
    workersPolled: tickResults.reduce((sum, tick) => sum + tick.workersPolled, 0),
    assignmentsCompleted: tickResults.reduce((sum, tick) => sum + tick.assignmentsCompleted, 0),
    workerHeartbeatRejections: tickResults.flatMap((tick) => tick.workerHeartbeatRejections),
    healthWarnings: tickResults.flatMap((tick) => tick.healthWarnings),
    tickResults,
    lifecycle: lifecycle.snapshot(),
    metrics,
  };
}

function summarizeMetrics(tickResults: SchedulerTickResult[], idleTicks: number): DaemonLoopMetrics {
  return {
    tickCount: tickResults.length,
    idleCount: idleTicks,
    loopLatencyMs: tickResults.reduce((sum, tick) => sum + tick.durationMs, 0),
    recoveredExpired: tickResults.reduce((sum, tick) => sum + tick.recoveredExpired, 0),
    retriesScheduled: tickResults.reduce((sum, tick) => sum + tick.retriesScheduled, 0),
    delayedRetries: tickResults.reduce((sum, tick) => sum + tick.retriesScheduled, 0),
    drainBlocked: tickResults.reduce((sum, tick) => sum + tick.workerDrainBlocked.length, 0),
    assignmentsCompleted: tickResults.reduce((sum, tick) => sum + tick.assignmentsCompleted, 0),
    failures: tickResults.reduce(
      (sum, tick) => sum + tick.workerResults.flatMap((worker) => worker.results).filter((run) => run.ran && run.assignment.status === "failed").length,
      0,
    ),
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
