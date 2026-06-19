import type { ApprovalRequest, AuditEvent, FileChange } from "../domain/index.js";
import type { AgentStore } from "../store/agent-store.js";

export type SessionTimelineItemKind = "audit" | "file_change" | "approval" | "approval_decision";

export type SessionTimelineItem = {
  ordinal: number;
  kind: SessionTimelineItemKind;
  createdAt: string;
  sourceId: string;
  actor?: string;
  title: string;
  summary: string;
  status?: string;
  action?: string;
  toolName?: string;
  command?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number;
  executionProfile?: string;
  path?: string;
  metadata?: Record<string, unknown>;
};

export async function buildSessionTimelineView(store: AgentStore, sessionId: string, options: { limit?: number } = {}) {
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const messages = await store.getMessages(sessionId);
  const toolResults = await store.getToolResults(sessionId);
  const fileChanges = await store.listFileChanges(sessionId);
  const auditEvents = await store.listAuditEvents({ sessionId, limit: 1000 });
  const approvals = (await store.listApprovalRequests())
    .filter((approval) => approval.sessionId === sessionId);

  const unnumbered: Omit<SessionTimelineItem, "ordinal">[] = [];
  for (const event of auditEvents) {
    unnumbered.push(timelineItemFromAudit(event));
  }
  for (const change of fileChanges) {
    unnumbered.push(timelineItemFromFileChange(change));
  }
  for (const approval of approvals) {
    unnumbered.push(timelineItemFromApproval(approval));
    if (approval.decidedAt) {
      unnumbered.push(timelineItemFromApprovalDecision(approval));
    }
  }

  const allItems = unnumbered
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || timelineKindOrder(left.kind) - timelineKindOrder(right.kind) || left.sourceId.localeCompare(right.sourceId))
    .map((item, index) => ({ ordinal: index + 1, ...item }));
  const limit = options.limit ?? allItems.length;
  const items = allItems.slice(Math.max(0, allItems.length - limit));
  const byKind = countTimelineKinds(allItems);

  return {
    generatedAt: new Date().toISOString(),
    session,
    summary: {
      totalItems: allItems.length,
      returnedItems: items.length,
      messages: messages.length,
      toolResults: toolResults.length,
      auditEvents: auditEvents.length,
      fileChanges: fileChanges.length,
      approvals: approvals.length,
      byKind,
      earliestAt: allItems.at(0)?.createdAt,
      latestAt: allItems.at(-1)?.createdAt,
    },
    items,
  };
}

export function timelineItemFromAudit(event: AuditEvent): Omit<SessionTimelineItem, "ordinal"> {
  const agentEventType = typeof event.metadata?.eventType === "string" ? event.metadata.eventType : undefined;
  return {
    kind: "audit",
    createdAt: event.createdAt,
    sourceId: event.id,
    actor: actorLabel(event.actor),
    title: event.type === "agent.event" && agentEventType ? `agent.event.${agentEventType}` : event.type,
    summary: event.summary,
    action: typeof event.metadata?.action === "string" ? event.metadata.action : undefined,
    toolName: typeof event.metadata?.toolName === "string" ? event.metadata.toolName : typeof event.metadata?.tool === "string" ? event.metadata.tool : undefined,
    command: typeof event.metadata?.command === "string" ? event.metadata.command : undefined,
    exitCode: commandExitCode(event.metadata),
    timedOut: commandTimedOut(event.metadata),
    durationMs: commandDurationMs(event.metadata),
    executionProfile: commandExecutionProfileName(event.metadata),
    metadata: safeTimelineMetadata(event.metadata),
  };
}

export function timelineItemFromFileChange(change: FileChange): Omit<SessionTimelineItem, "ordinal"> {
  return {
    kind: "file_change",
    createdAt: change.createdAt,
    sourceId: change.id,
    actor: actorLabel(change.actor),
    title: `${change.kind} ${change.path}`,
    summary: change.summary,
    path: change.path,
    metadata: {
      beforeHash: change.beforeHash,
      afterHash: change.afterHash,
    },
  };
}

export function timelineItemFromApproval(approval: ApprovalRequest): Omit<SessionTimelineItem, "ordinal"> {
  return {
    kind: "approval",
    createdAt: approval.createdAt,
    sourceId: approval.id,
    actor: actorLabel(approval.requestedBy),
    title: `approval requested ${approval.action}`,
    summary: approval.reason,
    status: approval.status,
    action: approval.action,
    toolName: approval.toolName,
    metadata: {
      approverHint: approval.approverHint,
    },
  };
}

export function timelineItemFromApprovalDecision(approval: ApprovalRequest): Omit<SessionTimelineItem, "ordinal"> {
  return {
    kind: "approval_decision",
    createdAt: approval.decidedAt ?? approval.createdAt,
    sourceId: `${approval.id}:decision`,
    actor: approval.decisionBy ? actorLabel(approval.decisionBy) : undefined,
    title: `approval ${approval.status} ${approval.action}`,
    summary: approval.decisionReason ?? approval.reason,
    status: approval.status,
    action: approval.action,
    toolName: approval.toolName,
  };
}

export function timelineKindOrder(kind: SessionTimelineItemKind): number {
  switch (kind) {
    case "audit":
      return 0;
    case "approval":
      return 1;
    case "approval_decision":
      return 2;
    case "file_change":
      return 3;
  }
}

export function countTimelineKinds(items: Array<{ kind: SessionTimelineItemKind }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  }
  return counts;
}

function safeTimelineMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }
  const safe: Record<string, unknown> = {};
  for (const key of [
    "action",
    "tool",
    "toolName",
    "eventType",
    "runId",
    "sessionId",
    "step",
    "title",
    "status",
    "detailsHidden",
    "paths",
    "path",
    "change",
    "ok",
    "errorCode",
    "exitCode",
    "timedOut",
    "durationMs",
    "responseType",
    "toolCallCount",
    "maxSteps",
    "provider",
    "model",
    "executionProfile",
    "stdoutBytes",
    "stderrBytes",
    "approvalId",
  ]) {
    const value = metadata[key];
    if (value !== undefined) {
      safe[key] = value;
    }
  }
  const error = metadata.error;
  if (typeof error === "object" && error !== null) {
    const maybe = error as { code?: unknown; message?: unknown };
    safe.error = {
      code: typeof maybe.code === "string" ? maybe.code : undefined,
      message: typeof maybe.message === "string" ? singleLine(maybe.message) : undefined,
    };
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function actorLabel(actor: { type: string; id: string }): string {
  return `${actor.type}:${actor.id}`;
}

function commandExitCode(metadata: Record<string, unknown> | undefined): number | null | undefined {
  const value = metadata?.exitCode;
  if (typeof value === "number" || value === null) {
    return value;
  }
  return undefined;
}

function commandTimedOut(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.timedOut === true;
}

function commandDurationMs(metadata: Record<string, unknown> | undefined): number | undefined {
  return typeof metadata?.durationMs === "number" ? metadata.durationMs : undefined;
}

function commandExecutionProfileName(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.executionProfile === "string" ? metadata.executionProfile : undefined;
}

function singleLine(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 160)} [truncated]` : compact;
}
