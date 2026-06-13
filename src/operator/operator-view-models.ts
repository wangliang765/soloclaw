import type { AgentHealthSummary } from "../agents/agent-health-service.js";
import type {
  ApprovalRequest,
  ArtifactRecord,
  AuditEvent,
  RetentionPolicy,
  Session,
  Specification,
  SpecificationClarification,
  SpecificationPlan,
  SpecificationTask,
  TaskAssignment,
} from "../domain/index.js";
import type { McpHealthCheckResult } from "../mcp/mcp-health-service.js";
import type { WorkerHealthSummary, WorkerHealthWorker } from "../workers/worker-health-service.js";

export type OperatorStatus =
  | "healthy"
  | "idle"
  | "running"
  | "queued"
  | "waiting_for_approval"
  | "paused"
  | "retry_delayed"
  | "draining"
  | "blocked"
  | "saturated"
  | "stale"
  | "failed"
  | "completed"
  | "offline"
  | "unknown";

export type OperatorSeverity = "ok" | "info" | "warning" | "critical";

export type OperatorItemKind =
  | "approval"
  | "assignment"
  | "worker"
  | "agent"
  | "session"
  | "queue"
  | "mcp"
  | "artifact"
  | "retention"
  | "spec"
  | "scheduler"
  | "audit";

export type OperatorItemView = {
  id: string;
  kind: OperatorItemKind;
  label: string;
  status: OperatorStatus;
  severity: OperatorSeverity;
  reason: string;
  nextAction?: string;
  updatedAt?: string;
  refs?: Record<string, string | undefined>;
  metadata?: Record<string, unknown>;
};

export type OperatorViewModel = {
  generatedAt: string;
  summary: {
    critical: number;
    warning: number;
    waitingForApproval: number;
    running: number;
    blocked: number;
    stale: number;
    queued: number;
  };
  approvals: OperatorItemView[];
  assignments: OperatorItemView[];
  workers: OperatorItemView[];
  agents: OperatorItemView[];
  sessions: OperatorItemView[];
  specs: OperatorItemView[];
  artifacts: OperatorItemView[];
  retention: OperatorItemView[];
  scheduler: OperatorItemView[];
  audit: OperatorItemView[];
  queue: OperatorItemView;
  mcp: OperatorItemView[];
};

export type BuildOperatorViewModelInput = {
  generatedAt?: string;
  approvals: ApprovalRequest[];
  assignments: TaskAssignment[];
  sessions: Session[];
  workerHealth: WorkerHealthSummary;
  agentHealth: AgentHealthSummary;
  specifications?: SpecificationProgressInput[];
  artifacts?: ArtifactRecord[];
  retentionPolicies?: RetentionPolicy[];
  auditEvents?: AuditEvent[];
  mcpHealth?: McpHealthCheckResult[];
};

export type SpecificationProgressInput = {
  specification: Specification;
  tasks: SpecificationTask[];
  plans?: SpecificationPlan[];
  clarifications?: SpecificationClarification[];
};

export function buildOperatorViewModel(input: BuildOperatorViewModelInput): OperatorViewModel {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const approvals = input.approvals.map((approval) => approvalView(approval, generatedAt));
  const assignments = input.assignments.map((assignment) => assignmentView(assignment, generatedAt));
  const workers = input.workerHealth.perWorker.map(workerView);
  const agents = input.agentHealth.perAgent.map((agent): OperatorItemView => {
    const status: OperatorStatus = agent.healthState === "online" ? "healthy" : agent.healthState === "error" ? "failed" : agent.healthState;
    return {
      id: agent.agentId,
      kind: "agent",
      label: agent.displayName,
      status,
      severity: agent.healthState === "error" || agent.healthState === "stale" ? "critical" : agent.healthState === "unknown" ? "warning" : "ok",
      reason: agent.lastError ?? `Agent is ${agent.healthState}.`,
      nextAction: agent.healthState === "stale" ? "Check agent daemon heartbeat or restart the remote runner." : undefined,
      updatedAt: agent.lastHeartbeatAt ?? agent.lastSeenAt,
      refs: { agentId: agent.agentId, roomId: agent.lastRoomId },
      metadata: { trustStatus: agent.trustStatus, machineId: agent.machineId, secondsSinceHeartbeat: agent.secondsSinceHeartbeat },
    };
  });
  const sessions = input.sessions.map((session) => sessionView(session, input.approvals));
  const specs = (input.specifications ?? []).map(specificationView);
  const artifacts = (input.artifacts ?? []).map(artifactView);
  const retention = (input.retentionPolicies ?? []).map(retentionPolicyView);
  const scheduler = (input.auditEvents ?? []).filter(isSchedulerTickAudit).slice(0, 5).map(schedulerTickAuditView);
  const audit = (input.auditEvents ?? []).slice(0, 8).map(auditEventView);
  const queue = queueView(input.workerHealth);
  const mcp = (input.mcpHealth ?? []).map(mcpHealthView);
  const all = [...approvals, ...assignments, ...workers, ...agents, ...sessions, ...specs, ...artifacts, ...retention, ...scheduler, ...audit, queue, ...mcp];
  return {
    generatedAt,
    summary: {
      critical: all.filter((item) => item.severity === "critical").length,
      warning: all.filter((item) => item.severity === "warning").length,
      waitingForApproval: all.filter((item) => item.status === "waiting_for_approval").length,
      running: all.filter((item) => item.status === "running").length,
      blocked: all.filter((item) => item.status === "blocked").length,
      stale: all.filter((item) => item.status === "stale").length,
      queued: all.filter((item) => item.status === "queued" || item.status === "retry_delayed").length,
    },
    approvals,
    assignments,
    workers,
    agents,
    sessions,
    specs,
    artifacts,
    retention,
    scheduler,
    audit,
    queue,
    mcp,
  };
}

function specificationView(input: SpecificationProgressInput): OperatorItemView {
  const spec = input.specification;
  const tasks = input.tasks;
  const openClarifications = (input.clarifications ?? []).filter((clarification) => clarification.status === "open").length;
  const activePlan = (input.plans ?? []).find((plan) => plan.status === "active");
  const completed = tasks.filter((task) => task.status === "completed").length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  const inProgress = tasks.filter((task) => task.status === "in_progress").length;
  const pending = tasks.filter((task) => task.status === "pending").length;
  const total = tasks.length;
  const status: OperatorStatus = spec.status === "completed"
    ? "completed"
    : spec.status === "blocked" || blocked > 0
      ? "blocked"
      : openClarifications > 0
        ? "waiting_for_approval"
        : spec.status === "in_progress" || inProgress > 0
          ? "running"
          : spec.status === "ready" || spec.status === "planned" || pending > 0
            ? "queued"
            : spec.status === "archived"
              ? "offline"
              : "paused";
  return {
    id: spec.id,
    kind: "spec",
    label: spec.title,
    status,
    severity: status === "blocked" ? "critical" : status === "waiting_for_approval" || status === "paused" ? "warning" : status === "completed" ? "ok" : "info",
    reason: specificationReason(spec, { total, completed, blocked, inProgress, pending, openClarifications, activePlanId: activePlan?.id }),
    nextAction: specificationNextAction(status, { openClarifications, activePlan: Boolean(activePlan), total }),
    updatedAt: spec.updatedAt,
    refs: { specId: spec.id, roomId: spec.roomId, projectId: spec.projectId },
    metadata: {
      specStatus: spec.status,
      totalTasks: total,
      completedTasks: completed,
      blockedTasks: blocked,
      inProgressTasks: inProgress,
      pendingTasks: pending,
      openClarifications,
      activePlanId: activePlan?.id,
      source: spec.source,
    },
  };
}

function specificationReason(
  spec: Specification,
  progress: { total: number; completed: number; blocked: number; inProgress: number; pending: number; openClarifications: number; activePlanId?: string },
): string {
  if (progress.blocked > 0 || spec.status === "blocked") {
    return `${progress.blocked} of ${progress.total} specification task(s) are blocked.`;
  }
  if (progress.openClarifications > 0) {
    return `${progress.openClarifications} open clarification(s) need an answer before progress is clear.`;
  }
  if (spec.status === "completed") {
    return `Specification completed with ${progress.completed}/${progress.total} task(s) done.`;
  }
  if (progress.inProgress > 0) {
    return `${progress.inProgress} task(s) in progress, ${progress.completed}/${progress.total} completed.`;
  }
  if (progress.activePlanId) {
    return `Active plan ${progress.activePlanId}; ${progress.pending} pending task(s).`;
  }
  return `Specification is ${spec.status}; ${progress.pending} pending task(s).`;
}

function specificationNextAction(status: OperatorStatus, input: { openClarifications: number; activePlan: boolean; total: number }): string | undefined {
  if (status === "blocked") {
    return "Inspect blocked spec tasks and verification evidence.";
  }
  if (status === "waiting_for_approval") {
    return input.openClarifications > 0 ? "Answer or resolve open clarifications." : "Review pending plan approval or operator decision.";
  }
  if (status === "queued" && !input.activePlan && input.total > 0) {
    return "Generate or activate a plan, then dispatch ready tasks.";
  }
  if (status === "paused" && input.total === 0) {
    return "Add specification tasks before dispatch.";
  }
  return undefined;
}

function artifactView(artifact: ArtifactRecord): OperatorItemView {
  const missingChecksum = artifact.status === "active" && !artifact.sha256;
  return {
    id: artifact.id,
    kind: "artifact",
    label: artifact.name,
    status: artifact.status === "deleted" ? "completed" : missingChecksum ? "unknown" : "healthy",
    severity: artifact.status === "deleted" ? "ok" : missingChecksum ? "warning" : "ok",
    reason: missingChecksum
      ? "Artifact is active but has no checksum recorded."
      : artifact.status === "deleted"
        ? `Artifact was deleted${artifact.deletedAt ? ` at ${artifact.deletedAt}` : ""}.`
        : `Active ${artifact.kind} artifact${artifact.sizeBytes !== undefined ? `, ${artifact.sizeBytes} byte(s)` : ""}.`,
    nextAction: missingChecksum ? "Register checksum metadata before export or retention processing." : undefined,
    updatedAt: artifact.deletedAt ?? artifact.createdAt,
    refs: { artifactId: artifact.id, sessionId: artifact.sessionId, roomId: artifact.roomId, projectId: artifact.projectId },
    metadata: { kind: artifact.kind, status: artifact.status, mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes, hasSha256: Boolean(artifact.sha256) },
  };
}

function retentionPolicyView(policy: RetentionPolicy): OperatorItemView {
  const exportBlocked = !policy.allowAuditExport;
  const summariesDisabled = !policy.enableAutoSummaries;
  const status: OperatorStatus = exportBlocked ? "blocked" : summariesDisabled ? "paused" : "healthy";
  return {
    id: policy.id,
    kind: "retention",
    label: policy.name,
    status,
    severity: exportBlocked || summariesDisabled ? "warning" : "ok",
    reason: exportBlocked
      ? "Audit export is disabled by this retention policy."
      : summariesDisabled
        ? "Automatic summaries are disabled by this retention policy."
        : `Hot transcripts ${policy.hotTranscriptDays}d, artifacts ${policy.artifactRetentionDays}d, audit ${policy.auditRetentionDays}d.`,
    nextAction: exportBlocked ? "Use force/admin export only where policy allows it." : summariesDisabled ? "Run manual compaction or enable summaries when ready." : undefined,
    refs: { retentionPolicyId: policy.id },
    metadata: {
      hotTranscriptDays: policy.hotTranscriptDays,
      artifactRetentionDays: policy.artifactRetentionDays,
      auditRetentionDays: policy.auditRetentionDays,
      allowUserDeletion: policy.allowUserDeletion,
      allowAuditExport: policy.allowAuditExport,
      enableAutoSummaries: policy.enableAutoSummaries,
    },
  };
}

function schedulerTickAuditView(event: AuditEvent): OperatorItemView {
  const metadata = event.metadata ?? {};
  const healthWarnings = Array.isArray(metadata.healthWarnings) ? metadata.healthWarnings : [];
  const criticalWarnings = healthWarnings.filter((warning) => isRecord(warning) && warning.severity === "critical").length;
  const warningCount = healthWarnings.length;
  const heartbeatRejections = Array.isArray(metadata.workerHeartbeatRejections) ? metadata.workerHeartbeatRejections.length : 0;
  const workersExpired = numberMetadata(metadata.workersExpired);
  const recoveredExpired = numberMetadata(metadata.recoveredExpired);
  const drainBlocked = Array.isArray(metadata.workerDrainBlocked) ? metadata.workerDrainBlocked.length : 0;
  const assignmentsCompleted = numberMetadata(metadata.assignmentsCompleted);
  const specTasksDispatched = numberMetadata(metadata.specTasksDispatched);
  const status: OperatorStatus = criticalWarnings > 0 || workersExpired > 0 || recoveredExpired > 0
    ? "stale"
    : heartbeatRejections > 0 || drainBlocked > 0
      ? "blocked"
      : warningCount > 0
        ? "saturated"
        : assignmentsCompleted > 0 || specTasksDispatched > 0
          ? "running"
          : "idle";
  return {
    id: `scheduler:${event.id}`,
    kind: "scheduler",
    label: "Scheduler tick",
    status,
    severity: status === "stale" || status === "blocked" ? "critical" : status === "saturated" ? "warning" : "ok",
    reason: schedulerReason({ warningCount, criticalWarnings, heartbeatRejections, workersExpired, recoveredExpired, drainBlocked, assignmentsCompleted, specTasksDispatched }),
    nextAction: schedulerNextAction(status),
    updatedAt: event.createdAt,
    refs: { auditId: event.id, sessionId: event.sessionId, roomId: event.roomId, projectId: event.projectId },
    metadata: {
      workersExpired,
      recoveredExpired,
      retriesScheduled: numberMetadata(metadata.retriesScheduled),
      specTasksDispatched,
      workersPolled: numberMetadata(metadata.workersPolled),
      assignmentsCompleted,
      healthWarningCount: warningCount,
      criticalWarningCount: criticalWarnings,
      heartbeatRejectionCount: heartbeatRejections,
      drainBlocked,
    },
  };
}

function auditEventView(event: AuditEvent): OperatorItemView {
  const status = auditStatus(event);
  return {
    id: `audit:${event.id}`,
    kind: "audit",
    label: event.type,
    status,
    severity: status === "failed" || status === "blocked" ? "critical" : status === "stale" || status === "paused" ? "warning" : "info",
    reason: event.summary,
    updatedAt: event.createdAt,
    refs: { auditId: event.id, sessionId: event.sessionId, roomId: event.roomId, projectId: event.projectId },
    metadata: {
      actorType: event.actor.type,
      actorId: event.actor.id,
      artifactRefCount: event.artifactRefs?.length ?? 0,
      metadataKeys: Object.keys(event.metadata ?? {}).sort(),
    },
  };
}

function isSchedulerTickAudit(event: AuditEvent): boolean {
  return event.type === "control_plane.action" && event.summary === "Scheduler tick from control plane";
}

function auditStatus(event: AuditEvent): OperatorStatus {
  if (event.type.endsWith(".failed") || event.type.endsWith(".denied") || event.type.endsWith("_rejected")) {
    return "failed";
  }
  if (event.type.endsWith(".expired") || event.type.endsWith("_warning")) {
    return "stale";
  }
  if (event.type.endsWith(".paused") || event.type.endsWith(".cancelled")) {
    return "paused";
  }
  if (event.type.endsWith(".completed") || event.type.endsWith(".approved") || event.type.endsWith(".created")) {
    return "completed";
  }
  return "running";
}

function schedulerReason(input: {
  warningCount: number;
  criticalWarnings: number;
  heartbeatRejections: number;
  workersExpired: number;
  recoveredExpired: number;
  drainBlocked: number;
  assignmentsCompleted: number;
  specTasksDispatched: number;
}): string {
  if (input.criticalWarnings > 0) {
    return `${input.criticalWarnings} critical scheduler health warning(s) were reported.`;
  }
  if (input.workersExpired > 0 || input.recoveredExpired > 0) {
    return `${input.workersExpired} worker(s) expired and ${input.recoveredExpired} assignment lease(s) were recovered.`;
  }
  if (input.heartbeatRejections > 0) {
    return `${input.heartbeatRejections} worker heartbeat(s) were rejected.`;
  }
  if (input.drainBlocked > 0) {
    return `${input.drainBlocked} draining worker(s) are still blocked.`;
  }
  if (input.warningCount > 0) {
    return `${input.warningCount} scheduler health warning(s) were reported.`;
  }
  if (input.assignmentsCompleted > 0 || input.specTasksDispatched > 0) {
    return `${input.specTasksDispatched} spec task(s) dispatched and ${input.assignmentsCompleted} assignment(s) completed.`;
  }
  return "Last scheduler tick was idle.";
}

function schedulerNextAction(status: OperatorStatus): string | undefined {
  if (status === "stale") {
    return "Inspect recovered leases, expired workers, and scheduler health warnings.";
  }
  if (status === "blocked") {
    return "Review heartbeat verification and drain blockers before the next tick.";
  }
  if (status === "saturated") {
    return "Add capacity, reduce queue pressure, or adjust scheduler thresholds.";
  }
  return undefined;
}

function numberMetadata(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function approvalView(approval: ApprovalRequest, now: string): OperatorItemView {
  const expired = approval.expiresAt !== undefined && approval.expiresAt <= now && approval.status === "pending";
  if (approval.status === "pending" && !expired) {
    return {
      id: approval.id,
      kind: "approval",
      label: approval.toolName ?? approval.action,
      status: "waiting_for_approval",
      severity: "warning",
      reason: approval.reason,
      nextAction: approval.approverHint === "quorum" ? "Collect the required approval quorum." : "Approve or deny the request.",
      updatedAt: approval.createdAt,
      refs: { sessionId: approval.sessionId, roomId: approval.roomId, projectId: approval.projectId },
      metadata: { action: approval.action, approverHint: approval.approverHint },
    };
  }
  return {
    id: approval.id,
    kind: "approval",
    label: approval.toolName ?? approval.action,
    status: expired || approval.status === "expired" ? "stale" : approval.status === "approved" ? "completed" : "blocked",
    severity: expired || approval.status === "expired" ? "warning" : approval.status === "approved" ? "ok" : "critical",
    reason: approval.decisionReason ?? approval.reason,
    updatedAt: approval.decidedAt ?? approval.createdAt,
    refs: { sessionId: approval.sessionId, roomId: approval.roomId, projectId: approval.projectId },
    metadata: { action: approval.action, approvalStatus: approval.status },
  };
}

function assignmentView(assignment: TaskAssignment, now: string): OperatorItemView {
  const retryNotBefore = typeof assignment.metadata?.retryNotBefore === "string" ? assignment.metadata.retryNotBefore : undefined;
  const delayed = assignment.status === "leased" && retryNotBefore !== undefined && retryNotBefore > now;
  const expired = (assignment.status === "leased" || assignment.status === "running") && assignment.leaseExpiresAt <= now;
  const status: OperatorStatus = expired
    ? "stale"
    : delayed
      ? "retry_delayed"
      : assignment.status === "leased"
        ? "queued"
        : assignment.status === "running"
          ? "running"
          : assignment.status === "paused"
            ? "paused"
            : assignment.status === "completed"
              ? "completed"
              : assignment.status === "expired"
                ? "stale"
                : "failed";
  return {
    id: assignment.id,
    kind: "assignment",
    label: assignment.sessionId ? `Session ${assignment.sessionId}` : `Subtask ${assignment.subtaskId ?? "-"}`,
    status,
    severity: status === "failed" || status === "stale" ? "critical" : status === "paused" || status === "retry_delayed" ? "warning" : status === "completed" ? "ok" : "info",
    reason: assignmentReason(assignment, status, retryNotBefore),
    nextAction: assignmentNextAction(status),
    updatedAt: assignment.updatedAt,
    refs: { assignmentId: assignment.id, workerId: assignment.workerId, sessionId: assignment.sessionId, subtaskId: assignment.subtaskId },
    metadata: { attempts: assignment.attempts, leaseExpiresAt: assignment.leaseExpiresAt, retryNotBefore },
  };
}

function workerView(worker: WorkerHealthWorker): OperatorItemView {
  const status: OperatorStatus = worker.heartbeatExpired
    ? "stale"
    : worker.drainingBlocked
      ? "blocked"
      : worker.status === "draining"
        ? "draining"
        : worker.status === "offline"
          ? "offline"
          : worker.status === "suspended"
            ? "blocked"
            : worker.loadRatio >= 1
              ? "saturated"
              : worker.activeAssignments > 0
                ? "running"
                : "idle";
  return {
    id: worker.workerId,
    kind: "worker",
    label: worker.displayName,
    status,
    severity: status === "stale" || status === "blocked" ? "critical" : status === "saturated" || status === "draining" ? "warning" : "ok",
    reason: workerReason(worker, status),
    nextAction: workerNextAction(status),
    updatedAt: worker.lastHeartbeatAt,
    refs: { workerId: worker.workerId, agentId: worker.agentId },
    metadata: { loadRatio: worker.loadRatio, activeAssignments: worker.activeAssignments, queuedAssignments: worker.queuedAssignments, delayedRetries: worker.delayedRetries },
  };
}

function queueView(health: WorkerHealthSummary): OperatorItemView {
  const activeExpired = health.assignments.activeExpired;
  const delayedRetries = health.assignments.delayedRetries;
  const dueRetries = health.assignments.dueRetries;
  const queued = health.assignments.byStatus.leased;
  const status: OperatorStatus = activeExpired > 0
    ? "stale"
    : health.workers.drainingBlocked > 0
      ? "blocked"
      : health.pressure.loadRatio >= 1 || health.pressure.queuedToCapacityRatio >= 2
        ? "saturated"
        : delayedRetries > 0
          ? "retry_delayed"
          : queued > 0 || dueRetries > 0
            ? "queued"
            : health.assignments.active > 0
              ? "running"
              : "idle";
  return {
    id: "queue:local",
    kind: "queue",
    label: "Local task queue",
    status,
    severity: status === "stale" || status === "blocked" ? "critical" : status === "saturated" || status === "retry_delayed" ? "warning" : status === "idle" ? "ok" : "info",
    reason: queueReason(health, status),
    nextAction: queueNextAction(status),
    updatedAt: health.generatedAt,
    metadata: {
      activeAssignments: health.assignments.active,
      activeExpired,
      delayedRetries,
      dueRetries,
      queuedAssignments: queued,
      onlineCapacity: health.workers.onlineCapacity,
      onlineAvailable: health.workers.onlineAvailable,
      loadRatio: health.pressure.loadRatio,
      queuedToCapacityRatio: health.pressure.queuedToCapacityRatio,
      schedulableWorkerCount: health.pressure.schedulableWorkerCount,
    },
  };
}

function mcpHealthView(health: McpHealthCheckResult): OperatorItemView {
  const status: OperatorStatus = health.status === "healthy"
    ? "healthy"
    : health.status === "disabled"
      ? "offline"
      : health.status === "blocked"
        ? "blocked"
        : health.status === "timeout"
          ? "stale"
          : "failed";
  return {
    id: `mcp:${health.serverId}`,
    kind: "mcp",
    label: health.serverId,
    status,
    severity: status === "failed" || status === "stale" ? "critical" : status === "blocked" || status === "offline" ? "warning" : "ok",
    reason: health.reason ?? `MCP server is ${health.status}.`,
    nextAction: mcpNextAction(status),
    updatedAt: health.generatedAt,
    refs: { serverId: health.serverId },
    metadata: {
      transport: health.transport,
      diagnostics: health.diagnostics,
      planStatus: health.plan?.status,
      declaredCapabilities: health.capabilities?.declared,
      tools: health.capabilities?.tools,
      resources: health.capabilities?.resources,
      prompts: health.capabilities?.prompts,
      sampling: health.capabilities?.sampling,
    },
  };
}

function sessionView(session: Session, approvals: ApprovalRequest[]): OperatorItemView {
  const pendingApproval = approvals.find((approval) => approval.sessionId === session.id && approval.status === "pending");
  const status: OperatorStatus = pendingApproval
    ? "waiting_for_approval"
    : session.status === "running"
      ? "running"
      : session.status === "paused"
        ? "paused"
        : session.status === "failed"
          ? "failed"
          : session.status === "completed"
            ? "completed"
            : session.status === "cancelled"
              ? "blocked"
              : "queued";
  return {
    id: session.id,
    kind: "session",
    label: session.objective,
    status,
    severity: status === "failed" || status === "blocked" ? "critical" : status === "waiting_for_approval" || status === "paused" ? "warning" : status === "completed" ? "ok" : "info",
    reason: pendingApproval ? `Waiting for approval ${pendingApproval.id}.` : `Session is ${session.status}.`,
    nextAction: pendingApproval ? "Approve or deny the pending request." : session.status === "paused" ? "Resume, cancel, or inspect blockers." : undefined,
    updatedAt: session.updatedAt,
    refs: { sessionId: session.id, roomId: session.roomId, projectId: session.projectId },
    metadata: { targetMode: session.targetMode, risk: session.risk },
  };
}

function queueReason(health: WorkerHealthSummary, status: OperatorStatus): string {
  if (status === "stale") {
    return `${health.assignments.activeExpired} active assignment lease(s) are expired.`;
  }
  if (status === "blocked") {
    return `${health.workers.drainingBlocked} draining worker(s) still have active assignments.`;
  }
  if (status === "saturated") {
    return `Queue pressure is high: load ratio ${health.pressure.loadRatio}, queued/capacity ratio ${health.pressure.queuedToCapacityRatio}.`;
  }
  if (status === "retry_delayed") {
    return `${health.assignments.delayedRetries} retry assignment(s) are waiting for retryNotBefore.`;
  }
  if (status === "queued") {
    return `${health.assignments.byStatus.leased} assignment(s) are queued and ${health.assignments.dueRetries} delayed retry assignment(s) are due.`;
  }
  if (status === "running") {
    return `${health.assignments.active} assignment(s) are active.`;
  }
  return "No active local queue pressure.";
}

function queueNextAction(status: OperatorStatus): string | undefined {
  if (status === "stale") {
    return "Run scheduler recovery or inspect expired assignment leases.";
  }
  if (status === "blocked") {
    return "Finish draining workers after active assignments complete.";
  }
  if (status === "saturated") {
    return "Add worker capacity, reduce queue pressure, or wait for active assignments.";
  }
  if (status === "retry_delayed") {
    return "Wait for retryNotBefore or adjust retry policy.";
  }
  return undefined;
}

function mcpNextAction(status: OperatorStatus): string | undefined {
  if (status === "blocked") {
    return "Review MCP policy, allowlists, and capability grants.";
  }
  if (status === "offline") {
    return "Enable MCP execution or the server registry entry.";
  }
  if (status === "stale") {
    return "Check MCP server timeout, transport, and startup latency.";
  }
  if (status === "failed") {
    return "Inspect MCP server transport diagnostics.";
  }
  return undefined;
}

function assignmentReason(assignment: TaskAssignment, status: OperatorStatus, retryNotBefore?: string): string {
  if (status === "retry_delayed") {
    return `Retry is delayed until ${retryNotBefore}.`;
  }
  if (status === "stale") {
    return `Lease expired at ${assignment.leaseExpiresAt}.`;
  }
  if (assignment.resultSummary) {
    return assignment.resultSummary;
  }
  return `Assignment is ${assignment.status}.`;
}

function assignmentNextAction(status: OperatorStatus): string | undefined {
  if (status === "stale") {
    return "Recover expired assignments or inspect worker health.";
  }
  if (status === "paused") {
    return "Resume or reschedule the target when ready.";
  }
  if (status === "retry_delayed") {
    return "Wait for retryNotBefore or adjust retry policy.";
  }
  return undefined;
}

function workerReason(worker: WorkerHealthWorker, status: OperatorStatus): string {
  if (status === "stale") {
    return `Worker heartbeat expired after ${worker.lastHeartbeatAt}.`;
  }
  if (status === "blocked") {
    return worker.drainingBlocked ? "Worker is draining but still has active assignments." : `Worker is ${worker.status}.`;
  }
  if (status === "saturated") {
    return `Worker is at capacity: ${worker.currentLoad}/${worker.maxConcurrentTasks}.`;
  }
  return `Worker is ${status}.`;
}

function workerNextAction(status: OperatorStatus): string | undefined {
  if (status === "stale") {
    return "Recover expired worker heartbeat or restart the worker.";
  }
  if (status === "blocked") {
    return "Complete active assignments or finish drain after load reaches zero.";
  }
  if (status === "saturated") {
    return "Add capacity or wait for assignments to finish.";
  }
  return undefined;
}
