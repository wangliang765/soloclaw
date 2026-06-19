import type { ActorRef, Timestamp } from "./common.js";

export type AuditEventType =
  | "session.created"
  | "session.paused"
  | "session.cancelled"
  | "session.resumed"
  | "model.called"
  | "agent.event"
  | "tool.requested"
  | "tool.approved"
  | "tool.denied"
  | "tool.completed"
  | "file.changed"
  | "command.started"
  | "command.finished"
  | "pr.created"
  | "pr.updated"
  | "policy.denied"
  | "secret.accessed"
  | "secret.denied"
  | "secret.redacted"
  | "org.created"
  | "project.created"
  | "capability.granted"
  | "retention.policy_created"
  | "retention.policy_applied"
  | "session.compacted"
  | "session.deleted"
  | "artifact.created"
  | "artifact.deleted"
  | "control_plane.action"
  | "task.assigned"
  | "task.lease_heartbeat"
  | "task.paused"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "task.expired"
  | "task.retry_scheduled"
  | "task.lease_replay_rejected"
  | "task.lease_nonce_cleaned"
  | "worker.registered"
  | "worker.heartbeat"
  | "worker.drained"
  | "worker.drain_completed"
  | "worker.expired"
  | "worker.heartbeat_nonce_cleaned"
  | "agent.message_sent"
  | "agent.message_received"
  | "room.created"
  | "room.join_requested"
  | "room.join_approved"
  | "room.invite.revoked"
  | "room.member.alias_updated"
  | "room.member.role_updated"
  | "room.member.status_updated"
  | "room.routing.warning"
  | "room.routing.wide"
  | "mcp.server_registered"
  | "mcp.server_removed"
  | "mcp.connection_planned"
  | "mcp.executed"
  | "plugin.executed"
  | "knowledge.source_added"
  | "knowledge.chunk_indexed"
  | "knowledge.searched"
  | "knowledge.eval_set_created"
  | "knowledge.eval_run"
  | "knowledge.eval_trend_report_created"
  | "spec.created"
  | "spec.task_created"
  | "spec.task_delegated"
  | "spec.task_verified"
  | "spec.task_updated"
  | "spec.version_created"
  | "spec.clarification_created"
  | "spec.clarification_updated"
  | "spec.diff_artifact_created"
  | "spec.plan_created"
  | "spec.plan_approval_requested";

export type AuditEvent = {
  id: string;
  type: AuditEventType;
  actor: ActorRef;
  orgId?: string;
  projectId?: string;
  sessionId?: string;
  roomId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  artifactRefs?: string[];
  createdAt: Timestamp;
};

export type AuditExportFilterSnapshot = {
  limit?: number;
  type?: AuditEventType;
  actorId?: string;
  sessionId?: string;
  roomId?: string;
  projectId?: string;
  from?: string;
  to?: string;
};

export type AuditExportBundle = {
  version: 1;
  exportId: string;
  createdAt: Timestamp;
  createdBy: ActorRef;
  filters: AuditExportFilterSnapshot;
  eventCount: number;
  eventsSha256: string;
  format: "agent.audit.bundle+json";
  events: AuditEvent[];
  signature?: string;
};

export function auditExportBundleSigningPayload(bundle: Omit<AuditExportBundle, "events" | "signature">): string {
  return JSON.stringify({
    version: bundle.version,
    exportId: bundle.exportId,
    createdAt: bundle.createdAt,
    createdByType: bundle.createdBy.type,
    createdById: bundle.createdBy.id,
    filters: bundle.filters,
    eventCount: bundle.eventCount,
    eventsSha256: bundle.eventsSha256,
    format: bundle.format,
  });
}
