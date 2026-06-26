import type { CommandModule } from "../command-router.js";

type ParsedArgs = {
  options: Record<string, any>;
  positionals: string[];
};

type WorkerCommandPlatform = {
  workers: any;
  workerRunner: any;
  workerHealth: any;
  store?: { close(): void };
  localAgent: { id: string; machineId?: string; orgId?: string; displayName: string };
  identity: { verifyWorkerHeartbeatEnvelope(envelope: unknown): Promise<string> };
  close(): void;
};

export type WorkersCommandDeps = {
  createPlatform(): Promise<WorkerCommandPlatform>;
  parseArgs(args: string[]): ParsedArgs;
  parseActorRef(value?: string): any;
  agentActor(agent: { id: string; displayName: string }): any;
  isWorkerHeartbeatEnvelope(value: unknown): boolean;
  renderWorker(worker: unknown): void;
  renderRunOnce(result: unknown): void;
  renderPoll(result: unknown): void;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createWorkersCommand(deps: WorkersCommandDeps): CommandModule<void> {
  return {
    name: "workers",
    summary: "Manage worker registrations and polling",
    execute: async ({ args: rest }) => {
      const subcommand = rest[0] ?? "list";
      const args = rest.slice(1);
      const platform = await deps.createPlatform();
      try {
        const localActor = () => deps.agentActor(platform.localAgent);
        const actorFrom = (parsed: ParsedArgs) => parsed.options.localAgent ? localActor() : deps.parseActorRef(parsed.options.actor);
        if (subcommand === "register") {
          const parsed = deps.parseArgs(args);
          const worker = await platform.workers.register({
            actor: parsed.options.localAgent ? localActor() : deps.parseActorRef(parsed.options.actor),
            agentId: parsed.options.agentId ?? platform.localAgent.id,
            machineId: parsed.options.machineId ?? platform.localAgent.machineId,
            orgId: parsed.options.orgId ?? platform.localAgent.orgId,
            displayName: parsed.options.displayName ?? platform.localAgent.displayName,
            endpoint: parsed.options.endpoint,
            capabilities: parsed.options.capabilities,
            allowedProjects: parsed.options.allowedProjects,
            maxConcurrentTasks: parsed.options.maxConcurrentTasks,
            metadata: parsed.options.metadataJson ? JSON.parse(parsed.options.metadataJson) as Record<string, unknown> : undefined,
            ttlSeconds: parsed.options.ttlSeconds,
          });
          deps.renderWorker(worker);
          return { matched: true };
        }
        if (subcommand === "heartbeat") {
          const parsed = deps.parseArgs(args);
          const workerId = parsed.positionals[0];
          if (!workerId) {
            deps.writeError("Usage: agent workers heartbeat <worker-id> [--status online|offline|draining|suspended] [--load n] [--max-tasks n] [--ttl seconds]");
            deps.setExitCode(1);
            return { matched: true };
          }
          deps.renderWorker(await platform.workers.heartbeat({
            workerId,
            actor: actorFrom(parsed),
            status: parsed.options.status,
            currentLoad: parsed.options.currentLoad,
            maxConcurrentTasks: parsed.options.maxConcurrentTasks,
            metadata: parsed.options.metadataJson ? JSON.parse(parsed.options.metadataJson) as Record<string, unknown> : undefined,
            ttlSeconds: parsed.options.ttlSeconds,
          }));
          return { matched: true };
        }
        if (subcommand === "drain" || subcommand === "complete-drain") {
          const parsed = deps.parseArgs(args);
          const workerId = parsed.positionals[0];
          const reason = parsed.positionals.slice(1).join(" ").trim() || undefined;
          if (!workerId) {
            deps.writeError(`Usage: agent workers ${subcommand} <worker-id> [reason] [--local-agent|--actor user:id|agent:id]${subcommand === "drain" ? " [--ttl seconds]" : ""}`);
            deps.setExitCode(1);
            return { matched: true };
          }
          const input = {
            workerId,
            actor: actorFrom(parsed),
            reason,
            ttlSeconds: parsed.options.ttlSeconds,
          };
          deps.renderWorker(subcommand === "drain" ? await platform.workers.drain(input) : await platform.workers.completeDrain(input));
          return { matched: true };
        }
        if (subcommand === "verify-heartbeat") {
          const workerId = args[0];
          if (!workerId) {
            deps.writeError("Usage: agent workers verify-heartbeat <worker-id>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const worker = await platform.workers.get(workerId);
          if (!worker) {
            deps.writeError(`Worker not found: ${workerId}`);
            deps.setExitCode(1);
            return { matched: true };
          }
          const envelope = worker.metadata?.heartbeatEnvelope;
          if (!deps.isWorkerHeartbeatEnvelope(envelope)) {
            deps.writeText("unsigned");
            return { matched: true };
          }
          const status = await platform.identity.verifyWorkerHeartbeatEnvelope(envelope);
          deps.writeText(status);
          if (status !== "valid") {
            deps.setExitCode(2);
          }
          return { matched: true };
        }
        if (subcommand === "recover-expired") {
          const parsed = deps.parseArgs(args);
          const result = await platform.workers.recoverExpired({
            actor: actorFrom(parsed),
            limit: parsed.options.limit,
          });
          for (const worker of result.expired) {
            deps.writeText(`${worker.id}\t${worker.status}\texpiredAt=${worker.metadata?.expiredAt ?? "-"}\t${worker.displayName}`);
          }
          if (result.expired.length === 0) {
            deps.writeText("no expired workers");
          }
          return { matched: true };
        }
        if (subcommand === "cleanup-nonces") {
          const parsed = deps.parseArgs(args);
          const result = await platform.workers.cleanupHeartbeatNonces({
            actor: actorFrom(parsed),
            before: parsed.options.before,
            limit: parsed.options.limit,
          });
          deps.writeText(`deleted=${result.deleted}\tbefore=${result.before}`);
          return { matched: true };
        }
        if (subcommand === "health") {
          const parsed = deps.parseArgs(args);
          deps.writeJson(await platform.workerHealth.getSummary({
            now: parsed.options.now,
            limit: parsed.options.limit,
          }));
          return { matched: true };
        }
        if (subcommand === "run-once" || subcommand === "poll") {
          const parsed = deps.parseArgs(args);
          const workerId = parsed.positionals[0];
          if (!workerId) {
            deps.writeError(`Usage: agent workers ${subcommand} <worker-id> [--limit n] [--idle-limit n] [--interval-ms n] [--ttl seconds] [--require-signed-lease] [--local-agent|--actor user:id|agent:id]`);
            deps.setExitCode(1);
            return { matched: true };
          }
          const actor = parsed.options.actor ? deps.parseActorRef(parsed.options.actor) : localActor();
          if (subcommand === "run-once") {
            deps.renderRunOnce(await platform.workerRunner.runOnce({
              workerId,
              leaseTtlSeconds: parsed.options.ttlSeconds,
              actor,
              requireSignedLeaseEnvelope: parsed.options.requireSignedLeaseEnvelope,
            }));
          } else {
            deps.renderPoll(await platform.workerRunner.poll({
              workerId,
              leaseTtlSeconds: parsed.options.ttlSeconds,
              actor,
              maxRuns: parsed.options.limit,
              maxIdlePolls: parsed.options.maxIdlePolls,
              idleIntervalMs: parsed.options.idleIntervalMs,
              requireSignedLeaseEnvelope: parsed.options.requireSignedLeaseEnvelope,
            }));
          }
          return { matched: true };
        }
        if (subcommand === "list") {
          const parsed = deps.parseArgs(args);
          const workers = await platform.workers.list({
            status: parsed.options.status,
            agentId: parsed.options.agentId,
            machineId: parsed.options.machineId,
            orgId: parsed.options.orgId,
            projectId: parsed.options.projectId,
            limit: parsed.options.limit,
          });
          for (const worker of workers) {
            deps.renderWorker(worker);
          }
          return { matched: true };
        }
        deps.writeError(`Unknown workers command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform.close();
      }
      return { matched: true };
    },
  };
}

type SchedulerCommandPlatform = {
  scheduler: any;
  localAgent: { id: string; displayName: string };
  close(): void;
};

export type SchedulerCommandDeps = {
  createPlatform(): Promise<SchedulerCommandPlatform>;
  parseArgs(args: string[]): ParsedArgs;
  parseActorRef(value?: string): any;
  agentActor(agent: { id: string; displayName: string }): any;
  onSignal(signal: NodeJS.Signals, handler: () => void): void;
  offSignal(signal: NodeJS.Signals, handler: () => void): void;
  renderTick(result: unknown): void;
  renderRun(result: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

function schedulerInput(parsed: ParsedArgs, actor: unknown) {
  return {
    actor,
    workerId: parsed.options.workerId,
    requireSignedWorkerHeartbeat: parsed.options.requireSignedWorkerHeartbeat,
    requireSignedLeaseEnvelope: parsed.options.requireSignedLeaseEnvelope,
    leaseTtlSeconds: parsed.options.leaseTtlSeconds,
    maxAttempts: parsed.options.maxAttempts,
    baseBackoffMs: parsed.options.baseBackoffMs,
    maxBackoffMs: parsed.options.maxBackoffMs,
    jitterMs: parsed.options.jitterMs,
    recoverLimit: parsed.options.recoverLimit,
    maxRunsPerWorker: parsed.options.maxRunsPerWorker,
    maxIdlePolls: parsed.options.maxIdlePolls,
    idleIntervalMs: parsed.options.idleIntervalMs,
    dispatchSpecId: parsed.options.dispatchSpecId,
    dispatchLimit: parsed.options.dispatchLimit,
    dispatchWorkerId: parsed.options.dispatchWorkerId,
    dispatchAutoSelectWorker: parsed.options.dispatchAutoSelectWorker,
    dispatchPriority: parsed.options.dispatchPriority,
    dispatchMaxLoadRatio: parsed.options.dispatchMaxLoadRatio,
    dispatchMaxQueuedAssignmentsPerWorker: parsed.options.dispatchMaxQueuedAssignmentsPerWorker,
    completeDrainedWorkers: parsed.options.completeDrainedWorkers,
    warnLoadRatio: parsed.options.warnLoadRatio,
    warnQueueRatio: parsed.options.warnQueueRatio,
  };
}

export function createSchedulerCommand(deps: SchedulerCommandDeps): CommandModule<void> {
  return {
    name: "scheduler",
    summary: "Run scheduler ticks and loops",
    execute: async ({ args: rest }) => {
      const subcommand = rest[0] ?? "tick";
      const args = rest.slice(1);
      const platform = await deps.createPlatform();
      try {
        if (subcommand === "tick") {
          const parsed = deps.parseArgs(args);
          const actor = parsed.options.actor ? deps.parseActorRef(parsed.options.actor) : deps.agentActor(platform.localAgent);
          deps.renderTick(await platform.scheduler.tick(schedulerInput(parsed, actor)));
          return { matched: true };
        }
        if (subcommand === "run") {
          const parsed = deps.parseArgs(args);
          const actor = parsed.options.actor ? deps.parseActorRef(parsed.options.actor) : deps.agentActor(platform.localAgent);
          const controller = new AbortController();
          const stop = () => controller.abort();
          deps.onSignal("SIGINT", stop);
          deps.onSignal("SIGTERM", stop);
          try {
            deps.renderRun(await platform.scheduler.run({
              ...schedulerInput(parsed, actor),
              intervalMs: parsed.options.intervalMs,
              maxTicks: parsed.options.maxTicks,
              stopWhenIdle: parsed.options.stopWhenIdle,
              idleTickLimit: parsed.options.idleTickLimit,
              signal: controller.signal,
            }));
          } finally {
            deps.offSignal("SIGINT", stop);
            deps.offSignal("SIGTERM", stop);
          }
          return { matched: true };
        }
        deps.writeError(`Unknown scheduler command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform.close();
      }
      return { matched: true };
    },
  };
}

type AssignmentsCommandPlatform = {
  assignments: any;
  close(): void;
};

export type AssignmentsCommandDeps = {
  createPlatform(): Promise<AssignmentsCommandPlatform>;
  parseArgs(args: string[]): ParsedArgs;
  parseActorRef(value?: string): any;
  renderAssignment(assignment: unknown): void;
  renderRecovery(result: unknown): void;
  writeText(text: string): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createAssignmentsCommand(deps: AssignmentsCommandDeps): CommandModule<void> {
  return {
    name: "assignments",
    summary: "Manage task assignments",
    execute: async ({ args: rest }) => {
      const subcommand = rest[0] ?? "list";
      const args = rest.slice(1);
      const platform = await deps.createPlatform();
      try {
        if (subcommand === "assign-session" || subcommand === "assign-subtask") {
          const parsed = deps.parseArgs(args);
          const targetId = parsed.positionals[0];
          if (!targetId || !parsed.options.workerId) {
            deps.writeError(`Usage: agent assignments ${subcommand} <${subcommand === "assign-session" ? "session" : "subtask"}-id> --worker worker-id [--ttl seconds] [--priority n]`);
            deps.setExitCode(1);
            return { matched: true };
          }
          deps.renderAssignment(await platform.assignments.assign({
            actor: deps.parseActorRef(parsed.options.actor),
            workerId: parsed.options.workerId,
            sessionId: subcommand === "assign-session" ? targetId : undefined,
            subtaskId: subcommand === "assign-subtask" ? targetId : undefined,
            leaseTtlSeconds: parsed.options.leaseTtlSeconds,
            priority: parsed.options.priority,
            metadata: parsed.options.metadataJson ? JSON.parse(parsed.options.metadataJson) as Record<string, unknown> : undefined,
          }));
          return { matched: true };
        }
        if (subcommand === "heartbeat") {
          const parsed = deps.parseArgs(args);
          const assignmentId = parsed.positionals[0];
          if (!assignmentId || !parsed.options.workerId) {
            deps.writeError("Usage: agent assignments heartbeat <assignment-id> --worker worker-id [--ttl seconds]");
            deps.setExitCode(1);
            return { matched: true };
          }
          deps.renderAssignment(await platform.assignments.heartbeat({
            actor: deps.parseActorRef(parsed.options.actor),
            assignmentId,
            workerId: parsed.options.workerId,
            leaseTtlSeconds: parsed.options.leaseTtlSeconds,
            metadata: parsed.options.metadataJson ? JSON.parse(parsed.options.metadataJson) as Record<string, unknown> : undefined,
          }));
          return { matched: true };
        }
        if (subcommand === "complete" || subcommand === "fail" || subcommand === "cancel") {
          const parsed = deps.parseArgs(args);
          const assignmentId = parsed.positionals[0];
          const resultSummary = parsed.positionals.slice(1).join(" ").trim() || undefined;
          if (!assignmentId || !parsed.options.workerId) {
            deps.writeError(`Usage: agent assignments ${subcommand} <assignment-id> --worker worker-id [summary]`);
            deps.setExitCode(1);
            return { matched: true };
          }
          deps.renderAssignment(await platform.assignments.complete({
            actor: deps.parseActorRef(parsed.options.actor),
            assignmentId,
            workerId: parsed.options.workerId,
            status: subcommand === "complete" ? "completed" : subcommand === "fail" ? "failed" : "cancelled",
            resultSummary,
          }));
          return { matched: true };
        }
        if (subcommand === "list") {
          const parsed = deps.parseArgs(args);
          const assignments = await platform.assignments.list({
            status: parsed.options.status,
            workerId: parsed.options.workerId,
            sessionId: parsed.options.sessionId,
            subtaskId: parsed.options.subtaskId,
            projectId: parsed.options.projectId,
            roomId: parsed.options.roomId,
            limit: parsed.options.limit,
          });
          for (const assignment of assignments) {
            deps.renderAssignment(assignment);
          }
          return { matched: true };
        }
        if (subcommand === "recover-expired") {
          const parsed = deps.parseArgs(args);
          deps.renderRecovery(await platform.assignments.recoverExpired({
            actor: deps.parseActorRef(parsed.options.actor),
            retryWorkerId: parsed.options.retryWorkerId,
            autoSelectRetryWorker: parsed.options.autoSelectRetryWorker,
            leaseTtlSeconds: parsed.options.leaseTtlSeconds,
            maxAttempts: parsed.options.maxAttempts,
            baseBackoffMs: parsed.options.baseBackoffMs,
            maxBackoffMs: parsed.options.maxBackoffMs,
            jitterMs: parsed.options.jitterMs,
            limit: parsed.options.limit,
            exhaustedTargetStatus: parsed.options.exhaustedTargetStatus,
            metadata: parsed.options.metadataJson ? JSON.parse(parsed.options.metadataJson) as Record<string, unknown> : undefined,
          }));
          return { matched: true };
        }
        if (subcommand === "cleanup-nonces") {
          const parsed = deps.parseArgs(args);
          const result = await platform.assignments.cleanupLeaseNonces({
            actor: deps.parseActorRef(parsed.options.actor),
            before: parsed.options.before,
            limit: parsed.options.limit,
          });
          deps.writeText(`deleted=${result.deleted}\tbefore=${result.before}`);
          return { matched: true };
        }
        deps.writeError(`Unknown assignments command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform.close();
      }
      return { matched: true };
    },
  };
}

type OperatorCommandOptions = Record<string, any> & {
  publicView?: boolean;
  actor?: unknown;
  select?: number;
  id?: string;
  positionals: string[];
  json?: boolean;
};

export type OperatorCommandDeps = {
  createControl(): Promise<{ control: any; close(): void }>;
  parseArgs(args: string[]): OperatorCommandOptions;
  selectItem(operatorView: unknown, options: OperatorCommandOptions): { id?: string } | undefined;
  jsonView(operatorView: unknown, options: OperatorCommandOptions): unknown;
  renderView(operatorView: unknown, options: OperatorCommandOptions): void;
  renderDetail(detail: unknown): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createOperatorCommand(deps: OperatorCommandDeps): CommandModule<void> {
  return {
    name: "operator",
    summary: "Show operator control-plane status",
    execute: async ({ args: rest }) => {
      const subcommand = rest[0] ?? "status";
      const args = subcommand === "status" || subcommand === "view" || subcommand === "show" ? rest.slice(1) : rest;
      if (subcommand !== "status" && subcommand !== "view" && subcommand !== "show") {
        deps.writeError(`Unknown operator command: ${subcommand}`);
        deps.setExitCode(1);
        return { matched: true };
      }
      const options = deps.parseArgs(args);
      const opened = await deps.createControl();
      try {
        const projectionRequest = {
          operatorProjection: options.publicView ? "public" as const : "diagnostic" as const,
          operatorActor: options.actor,
        };
        const state = await opened.control.getState(projectionRequest);
        const operatorView = state.operator;
        if (subcommand === "show") {
          const selectedItem = options.select === undefined ? undefined : deps.selectItem(operatorView, options);
          const itemId = selectedItem?.id ?? options.id ?? options.positionals[0];
          if (!itemId) {
            deps.writeError("Usage: agent operator show <item-id-or-ref-id> [--select n] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const detail = await opened.control.getOperatorDetail(itemId, projectionRequest);
          if (!detail.item) {
            deps.writeError(`Operator item not found: ${itemId}`);
            deps.setExitCode(1);
            return { matched: true };
          }
          if (options.json) {
            deps.writeJson(detail);
          } else {
            deps.renderDetail(detail);
          }
          return { matched: true };
        }
        if (options.json) {
          deps.writeJson(deps.jsonView(operatorView, options));
        } else {
          deps.renderView(operatorView, options);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        opened.close();
      }
      return { matched: true };
    },
  };
}
