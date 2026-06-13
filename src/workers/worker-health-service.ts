import type { TaskAssignment, TaskAssignmentStatus, WorkerRegistration, WorkerStatus } from "../domain/index.js";
import type { AgentStore } from "../store/agent-store.js";

export type WorkerHealthSummary = {
  generatedAt: string;
  workers: {
    total: number;
    byStatus: Record<WorkerStatus, number>;
    onlineCapacity: number;
    onlineLoad: number;
    onlineAvailable: number;
    heartbeatExpired: number;
    drainingBlocked: number;
  };
  assignments: {
    total: number;
    byStatus: Record<TaskAssignmentStatus, number>;
    active: number;
    activeExpired: number;
    delayedRetries: number;
    dueRetries: number;
    maxAttemptsSeen: number;
  };
  pressure: {
    loadRatio: number;
    queuedToCapacityRatio: number;
    schedulableWorkerCount: number;
  };
  perWorker: WorkerHealthWorker[];
};

export type WorkerHealthWorker = {
  workerId: string;
  agentId: string;
  machineId: string;
  displayName: string;
  status: WorkerStatus;
  currentLoad: number;
  maxConcurrentTasks: number;
  availableSlots: number;
  loadRatio: number;
  heartbeatExpired: boolean;
  drainingBlocked: boolean;
  assignmentCounts: Record<TaskAssignmentStatus, number>;
  activeAssignments: number;
  queuedAssignments: number;
  delayedRetries: number;
  dueRetries: number;
  lastHeartbeatAt: string;
  expiresAt?: string;
};

export class WorkerHealthService {
  constructor(private readonly store: AgentStore) {}

  async getSummary(input: { now?: string; limit?: number } = {}): Promise<WorkerHealthSummary> {
    const now = input.now ?? new Date().toISOString();
    const limit = input.limit ?? 1000;
    const workers = await this.store.listWorkerRegistrations({ limit });
    const assignments = await this.store.listTaskAssignments({ limit });
    const byWorker = groupAssignmentsByWorker(assignments);

    const workerSummaries = workers.map((worker) => summarizeWorker(worker, byWorker.get(worker.id) ?? [], now));
    const workerStatusCounts = countWorkerStatuses(workers);
    const assignmentStatusCounts = countAssignmentStatuses(assignments);
    const activeAssignments = assignments.filter((assignment) => isActiveAssignment(assignment.status));
    const delayedRetries = assignments.filter((assignment) => isDelayedRetry(assignment, now));
    const dueRetries = assignments.filter((assignment) => isDueRetry(assignment, now));
    const onlineWorkers = workers.filter((worker) => worker.status === "online" && !isHeartbeatExpired(worker, now));
    const onlineCapacity = onlineWorkers.reduce((sum, worker) => sum + worker.maxConcurrentTasks, 0);
    const onlineLoad = onlineWorkers.reduce((sum, worker) => sum + worker.currentLoad, 0);
    const queuedAssignments = assignments.filter((assignment) => assignment.status === "leased" && !isDelayedRetry(assignment, now));

    return {
      generatedAt: now,
      workers: {
        total: workers.length,
        byStatus: workerStatusCounts,
        onlineCapacity,
        onlineLoad,
        onlineAvailable: Math.max(0, onlineCapacity - onlineLoad),
        heartbeatExpired: workers.filter((worker) => isHeartbeatExpired(worker, now)).length,
        drainingBlocked: workerSummaries.filter((worker) => worker.drainingBlocked).length,
      },
      assignments: {
        total: assignments.length,
        byStatus: assignmentStatusCounts,
        active: activeAssignments.length,
        activeExpired: activeAssignments.filter((assignment) => assignment.leaseExpiresAt <= now).length,
        delayedRetries: delayedRetries.length,
        dueRetries: dueRetries.length,
        maxAttemptsSeen: assignments.reduce((max, assignment) => Math.max(max, assignment.attempts), 0),
      },
      pressure: {
        loadRatio: ratio(onlineLoad, onlineCapacity),
        queuedToCapacityRatio: ratio(queuedAssignments.length, onlineCapacity),
        schedulableWorkerCount: onlineWorkers.filter((worker) => worker.currentLoad < worker.maxConcurrentTasks).length,
      },
      perWorker: workerSummaries,
    };
  }
}

function summarizeWorker(worker: WorkerRegistration, assignments: TaskAssignment[], now: string): WorkerHealthWorker {
  const assignmentCounts = countAssignmentStatuses(assignments);
  const activeAssignments = assignments.filter((assignment) => isActiveAssignment(assignment.status));
  const delayedRetries = assignments.filter((assignment) => isDelayedRetry(assignment, now));
  const dueRetries = assignments.filter((assignment) => isDueRetry(assignment, now));
  const availableSlots = worker.status === "online" && !isHeartbeatExpired(worker, now)
    ? Math.max(0, worker.maxConcurrentTasks - worker.currentLoad)
    : 0;
  return {
    workerId: worker.id,
    agentId: worker.agentId,
    machineId: worker.machineId,
    displayName: worker.displayName,
    status: worker.status,
    currentLoad: worker.currentLoad,
    maxConcurrentTasks: worker.maxConcurrentTasks,
    availableSlots,
    loadRatio: ratio(worker.currentLoad, worker.maxConcurrentTasks),
    heartbeatExpired: isHeartbeatExpired(worker, now),
    drainingBlocked: worker.status === "draining" && activeAssignments.length > 0,
    assignmentCounts,
    activeAssignments: activeAssignments.length,
    queuedAssignments: assignments.filter((assignment) => assignment.status === "leased" && !isDelayedRetry(assignment, now)).length,
    delayedRetries: delayedRetries.length,
    dueRetries: dueRetries.length,
    lastHeartbeatAt: worker.lastHeartbeatAt,
    expiresAt: worker.expiresAt,
  };
}

function groupAssignmentsByWorker(assignments: TaskAssignment[]): Map<string, TaskAssignment[]> {
  const byWorker = new Map<string, TaskAssignment[]>();
  for (const assignment of assignments) {
    const existing = byWorker.get(assignment.workerId) ?? [];
    existing.push(assignment);
    byWorker.set(assignment.workerId, existing);
  }
  return byWorker;
}

function countWorkerStatuses(workers: WorkerRegistration[]): Record<WorkerStatus, number> {
  return {
    online: workers.filter((worker) => worker.status === "online").length,
    offline: workers.filter((worker) => worker.status === "offline").length,
    draining: workers.filter((worker) => worker.status === "draining").length,
    suspended: workers.filter((worker) => worker.status === "suspended").length,
  };
}

function countAssignmentStatuses(assignments: TaskAssignment[]): Record<TaskAssignmentStatus, number> {
  return {
    leased: assignments.filter((assignment) => assignment.status === "leased").length,
    running: assignments.filter((assignment) => assignment.status === "running").length,
    paused: assignments.filter((assignment) => assignment.status === "paused").length,
    completed: assignments.filter((assignment) => assignment.status === "completed").length,
    failed: assignments.filter((assignment) => assignment.status === "failed").length,
    cancelled: assignments.filter((assignment) => assignment.status === "cancelled").length,
    expired: assignments.filter((assignment) => assignment.status === "expired").length,
  };
}

function isActiveAssignment(status: TaskAssignmentStatus): boolean {
  return status === "leased" || status === "running" || status === "paused";
}

function isHeartbeatExpired(worker: WorkerRegistration, now: string): boolean {
  return Boolean(worker.expiresAt && worker.expiresAt <= now && (worker.status === "online" || worker.status === "draining"));
}

function isDelayedRetry(assignment: TaskAssignment, now: string): boolean {
  const retryNotBefore = typeof assignment.metadata?.retryNotBefore === "string" ? assignment.metadata.retryNotBefore : undefined;
  return assignment.status === "leased" && Boolean(retryNotBefore && retryNotBefore > now);
}

function isDueRetry(assignment: TaskAssignment, now: string): boolean {
  const retryNotBefore = typeof assignment.metadata?.retryNotBefore === "string" ? assignment.metadata.retryNotBefore : undefined;
  return assignment.status === "leased" && Boolean(retryNotBefore && retryNotBefore <= now);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}
