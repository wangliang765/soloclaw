import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  AgentHeartbeatNonce,
  AgentIdentity,
  ApprovalRequest,
  ApprovalStatus,
  ArtifactRecord,
  AuditEvent,
  CapabilityGrant,
  FileChange,
  KnowledgeChunk,
  KnowledgeEvalRun,
  KnowledgeEvalSet,
  KnowledgeSource,
  MemoryRecord,
  MemoryScope,
  Organization,
  PendingToolCall,
  PendingToolCallStatus,
  Project,
  RetentionPolicy,
  Room,
  RoomDeliveryAckNonce,
  RoomDeliveryCursor,
  RoomInvite,
  RoomMember,
  RoomMessage,
  Session,
  SessionLink,
  SessionSummary,
  Skill,
  SkillUsageEvent,
  Specification,
  SpecificationClarification,
  SpecificationPlan,
  SpecificationTask,
  SpecificationVerification,
  SpecificationVersion,
  Subtask,
  TaskAssignment,
  TaskLeaseNonce,
  WorkerHeartbeatNonce,
  WorkerRegistration,
} from "../domain/index.js";
import type { AgentMessage, ToolResult } from "../protocol/types.js";
import { makeId } from "../domain/common.js";
import type {
  AgentStore,
  AppendMessageInput,
  CreateSessionInput,
  ListAuditEventsInput,
  ListKnowledgeEvalRunsInput,
  ListKnowledgeEvalSetsInput,
  ListSpecificationsInput,
  ListSpecificationClarificationsInput,
  ListSpecificationPlansInput,
  ListSpecificationVersionsInput,
  ListSpecificationVerificationsInput,
  ListTaskAssignmentsInput,
  ListWorkersInput,
  RecordAgentHeartbeatNonceInput,
  RecordTaskLeaseNonceInput,
  RecordRoomDeliveryAckNonceInput,
  RecordWorkerHeartbeatNonceInput,
  RecordToolCallInput,
  WorkerHeartbeatInput,
} from "./agent-store.js";
import type { DecideApprovalInput } from "./agent-store.js";

export class SqliteAgentStore implements AgentStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const now = new Date().toISOString();
    const session: Session = {
      ...input,
      targetMode: input.targetMode ?? "build",
      id: makeId<"SessionId">("sess"),
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, org_id, project_id, room_id, objective, target_mode, status, risk, created_by_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.orgId ?? null,
        session.projectId ?? null,
        session.roomId ?? null,
        session.objective,
        session.targetMode,
        session.status,
        session.risk,
        JSON.stringify(session.createdBy),
        session.createdAt,
        session.updatedAt,
      );
    return session;
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
    return row ? sessionFromRow(row) : undefined;
  }

  async updateSessionStatus(sessionId: string, status: Session["status"]): Promise<void> {
    this.db.prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), sessionId);
  }

  async appendMessage(input: AppendMessageInput): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO messages (
          id, session_id, role, content, message_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(makeId<"MessageId">("msg"), input.sessionId, input.message.role, input.message.content, JSON.stringify(input.message), new Date().toISOString());
  }

  async recordToolCall(input: RecordToolCallInput): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO tool_calls (
          id, session_id, call_id, ok, output, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        makeId<"ToolCallId">("tool"),
        input.sessionId,
        input.result.callId,
        input.result.ok ? 1 : 0,
        input.result.output ?? null,
        JSON.stringify(input.result),
        new Date().toISOString(),
      );
  }

  async recordFileChange(change: FileChange): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO file_changes (
          id, session_id, actor_json, kind, path, before_hash, after_hash, summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        change.id,
        change.sessionId ?? null,
        JSON.stringify(change.actor),
        change.kind,
        change.path,
        change.beforeHash ?? null,
        change.afterHash ?? null,
        change.summary,
        change.createdAt,
      );
  }

  async listFileChanges(sessionId?: string): Promise<FileChange[]> {
    const rows = sessionId
      ? (this.db.prepare("SELECT * FROM file_changes WHERE session_id = ? ORDER BY created_at DESC").all(sessionId) as FileChangeRow[])
      : (this.db.prepare("SELECT * FROM file_changes ORDER BY created_at DESC").all() as FileChangeRow[]);
    return rows.map(fileChangeFromRow);
  }

  async createKnowledgeSource(source: KnowledgeSource): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO knowledge_sources (
          id, scope_type, scope_id, kind, name, uri, description, trust_level, created_by_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        source.id,
        source.scopeType,
        source.scopeId,
        source.kind,
        source.name,
        source.uri ?? null,
        source.description ?? null,
        source.trustLevel,
        JSON.stringify(source.createdBy),
        JSON.stringify(source.metadata ?? {}),
        source.createdAt,
        source.updatedAt,
      );
  }

  async getKnowledgeSource(sourceId: string): Promise<KnowledgeSource | undefined> {
    const row = this.db.prepare("SELECT * FROM knowledge_sources WHERE id = ?").get(sourceId) as KnowledgeSourceRow | undefined;
    return row ? knowledgeSourceFromRow(row) : undefined;
  }

  async listKnowledgeSources(input: { scopeType?: KnowledgeSource["scopeType"]; scopeId?: string; kind?: KnowledgeSource["kind"]; limit?: number } = {}): Promise<KnowledgeSource[]> {
    const conditions: string[] = [];
    const values: SQLInputValue[] = [];
    if (input.scopeType) {
      conditions.push("scope_type = ?");
      values.push(input.scopeType);
    }
    if (input.scopeId) {
      conditions.push("scope_id = ?");
      values.push(input.scopeId);
    }
    if (input.kind) {
      conditions.push("kind = ?");
      values.push(input.kind);
    }
    values.push(input.limit ?? 100);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM knowledge_sources ${where} ORDER BY updated_at DESC LIMIT ?`).all(...values) as KnowledgeSourceRow[];
    return rows.map(knowledgeSourceFromRow);
  }

  async upsertKnowledgeChunk(chunk: KnowledgeChunk): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO knowledge_chunks (
          id, source_id, scope_type, scope_id, content, summary, ordinal, token_count, content_hash, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content,
          summary = excluded.summary,
          token_count = excluded.token_count,
          content_hash = excluded.content_hash,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        chunk.id,
        chunk.sourceId,
        chunk.scopeType,
        chunk.scopeId,
        chunk.content,
        chunk.summary,
        chunk.ordinal,
        chunk.tokenCount,
        chunk.contentHash,
        JSON.stringify(chunk.metadata ?? {}),
        chunk.createdAt,
        chunk.updatedAt,
      );
  }

  async listKnowledgeChunks(input: { scopeType?: KnowledgeChunk["scopeType"]; scopeId?: string; sourceId?: string; limit?: number } = {}): Promise<KnowledgeChunk[]> {
    const conditions: string[] = [];
    const values: SQLInputValue[] = [];
    if (input.scopeType) {
      conditions.push("scope_type = ?");
      values.push(input.scopeType);
    }
    if (input.scopeId) {
      conditions.push("scope_id = ?");
      values.push(input.scopeId);
    }
    if (input.sourceId) {
      conditions.push("source_id = ?");
      values.push(input.sourceId);
    }
    values.push(input.limit ?? 1000);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM knowledge_chunks ${where} ORDER BY source_id ASC, ordinal ASC LIMIT ?`).all(...values) as KnowledgeChunkRow[];
    return rows.map(knowledgeChunkFromRow);
  }

  async createKnowledgeEvalSet(evalSet: KnowledgeEvalSet): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO knowledge_eval_sets (
          id, name, description, scope_type, scope_id, source_id, cases_json, thresholds_json, created_by_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        evalSet.id,
        evalSet.name,
        evalSet.description ?? null,
        evalSet.scopeType ?? null,
        evalSet.scopeId ?? null,
        evalSet.sourceId ?? null,
        JSON.stringify(evalSet.cases),
        JSON.stringify(evalSet.thresholds ?? {}),
        JSON.stringify(evalSet.createdBy),
        JSON.stringify(evalSet.metadata ?? {}),
        evalSet.createdAt,
        evalSet.updatedAt,
      );
  }

  async getKnowledgeEvalSet(evalSetId: string): Promise<KnowledgeEvalSet | undefined> {
    const row = this.db.prepare("SELECT * FROM knowledge_eval_sets WHERE id = ?").get(evalSetId) as KnowledgeEvalSetRow | undefined;
    return row ? knowledgeEvalSetFromRow(row) : undefined;
  }

  async listKnowledgeEvalSets(input: ListKnowledgeEvalSetsInput = {}): Promise<KnowledgeEvalSet[]> {
    const conditions: string[] = [];
    const values: SQLInputValue[] = [];
    if (input.scopeType) {
      conditions.push("scope_type = ?");
      values.push(input.scopeType);
    }
    if (input.scopeId) {
      conditions.push("scope_id = ?");
      values.push(input.scopeId);
    }
    if (input.sourceId) {
      conditions.push("source_id = ?");
      values.push(input.sourceId);
    }
    values.push(input.limit ?? 100);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM knowledge_eval_sets ${where} ORDER BY updated_at DESC LIMIT ?`).all(...values) as KnowledgeEvalSetRow[];
    return rows.map(knowledgeEvalSetFromRow);
  }

  async createKnowledgeEvalRun(run: KnowledgeEvalRun): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO knowledge_eval_runs (
          id, eval_set_id, scope_type, scope_id, source_id, case_count, run_limit, metrics_json, gate_json,
          cases_json, enforce_access, safety_mode, artifact_id, created_by_json, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.evalSetId ?? null,
        run.scopeType ?? null,
        run.scopeId ?? null,
        run.sourceId ?? null,
        run.caseCount,
        run.limit,
        JSON.stringify(run.metrics),
        JSON.stringify(run.gate),
        JSON.stringify(run.cases),
        run.enforceAccess ? 1 : 0,
        run.safetyMode,
        run.artifactId ?? null,
        run.createdBy ? JSON.stringify(run.createdBy) : null,
        JSON.stringify(run.metadata ?? {}),
        run.createdAt,
      );
  }

  async getKnowledgeEvalRun(runId: string): Promise<KnowledgeEvalRun | undefined> {
    const row = this.db.prepare("SELECT * FROM knowledge_eval_runs WHERE id = ?").get(runId) as KnowledgeEvalRunRow | undefined;
    return row ? knowledgeEvalRunFromRow(row) : undefined;
  }

  async listKnowledgeEvalRuns(input: ListKnowledgeEvalRunsInput = {}): Promise<KnowledgeEvalRun[]> {
    const conditions: string[] = [];
    const values: SQLInputValue[] = [];
    if (input.evalSetId) {
      conditions.push("eval_set_id = ?");
      values.push(input.evalSetId);
    }
    if (input.scopeType) {
      conditions.push("scope_type = ?");
      values.push(input.scopeType);
    }
    if (input.scopeId) {
      conditions.push("scope_id = ?");
      values.push(input.scopeId);
    }
    if (input.sourceId) {
      conditions.push("source_id = ?");
      values.push(input.sourceId);
    }
    values.push(input.limit ?? 100);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM knowledge_eval_runs ${where} ORDER BY created_at DESC LIMIT ?`).all(...values) as KnowledgeEvalRunRow[];
    return rows.map(knowledgeEvalRunFromRow);
  }

  async createApprovalRequest(request: ApprovalRequest): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO approval_requests (
          id, status, requested_by_json, action, reason, approver_hint, org_id, project_id, room_id,
          session_id, tool_name, input_summary, decision_by_json, decision_reason, created_at, decided_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        request.id,
        request.status,
        JSON.stringify(request.requestedBy),
        request.action,
        request.reason,
        request.approverHint ?? null,
        request.orgId ?? null,
        request.projectId ?? null,
        request.roomId ?? null,
        request.sessionId ?? null,
        request.toolName ?? null,
        request.inputSummary ?? null,
        request.decisionBy ? JSON.stringify(request.decisionBy) : null,
        request.decisionReason ?? null,
        request.createdAt,
        request.decidedAt ?? null,
        request.expiresAt ?? null,
      );
  }

  async listApprovalRequests(status?: ApprovalStatus): Promise<ApprovalRequest[]> {
    const rows = status
      ? (this.db.prepare("SELECT * FROM approval_requests WHERE status = ? ORDER BY created_at DESC").all(status) as ApprovalRow[])
      : (this.db.prepare("SELECT * FROM approval_requests ORDER BY created_at DESC").all() as ApprovalRow[]);
    return rows.map(approvalFromRow);
  }

  async decideApproval(input: DecideApprovalInput): Promise<ApprovalRequest | undefined> {
    const row = this.db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(input.approvalId) as ApprovalRow | undefined;
    if (!row) {
      return undefined;
    }
    const decidedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE approval_requests
         SET status = ?, decision_by_json = ?, decision_reason = ?, decided_at = ?
         WHERE id = ?`,
      )
      .run(input.status, JSON.stringify(input.decidedBy), input.decisionReason ?? null, decidedAt, input.approvalId);
    this.db
      .prepare("UPDATE pending_tool_calls SET status = ?, updated_at = ? WHERE approval_id = ?")
      .run(input.status === "approved" ? "approved" : "denied", decidedAt, input.approvalId);
    return approvalFromRow({
      ...row,
      status: input.status,
      decision_by_json: JSON.stringify(input.decidedBy),
      decision_reason: input.decisionReason ?? null,
      decided_at: decidedAt,
    });
  }

  async createPendingToolCall(call: PendingToolCall): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO pending_tool_calls (
          id, approval_id, tool_call_id, session_id, tool_name, input_json, requested_by_json, status, result_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        call.id,
        call.approvalId,
        call.toolCallId ?? null,
        call.sessionId ?? null,
        call.toolName,
        JSON.stringify(call.input),
        JSON.stringify(call.requestedBy),
        call.status,
        call.resultJson ?? null,
        call.createdAt,
        call.updatedAt,
      );
  }

  async getPendingToolCallByApproval(approvalId: string): Promise<PendingToolCall | undefined> {
    const row = this.db.prepare("SELECT * FROM pending_tool_calls WHERE approval_id = ?").get(approvalId) as PendingToolCallRow | undefined;
    return row ? pendingToolCallFromRow(row) : undefined;
  }

  async updatePendingToolCallStatus(id: string, status: PendingToolCallStatus, resultJson?: string): Promise<void> {
    this.db
      .prepare("UPDATE pending_tool_calls SET status = ?, result_json = ?, updated_at = ? WHERE id = ?")
      .run(status, resultJson ?? null, new Date().toISOString(), id);
  }

  async recordAuditEvent(event: AuditEvent): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO audit_events (
          id, type, actor_json, org_id, project_id, session_id, room_id, summary, metadata_json, artifact_refs_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.type,
        JSON.stringify(event.actor),
        event.orgId ?? null,
        event.projectId ?? null,
        event.sessionId ?? null,
        event.roomId ?? null,
        event.summary,
        JSON.stringify(event.metadata ?? {}),
        JSON.stringify(event.artifactRefs ?? []),
        event.createdAt,
      );
  }

  async listAuditEvents(input: ListAuditEventsInput = {}): Promise<AuditEvent[]> {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (input.type) {
      clauses.push("type = ?");
      params.push(input.type);
    }
    if (input.actorId) {
      clauses.push("json_extract(actor_json, '$.id') = ?");
      params.push(input.actorId);
    }
    if (input.sessionId) {
      clauses.push("session_id = ?");
      params.push(input.sessionId);
    }
    if (input.roomId) {
      clauses.push("room_id = ?");
      params.push(input.roomId);
    }
    if (input.projectId) {
      clauses.push("project_id = ?");
      params.push(input.projectId);
    }
    if (input.from) {
      clauses.push("created_at >= ?");
      params.push(input.from);
    }
    if (input.to) {
      clauses.push("created_at <= ?");
      params.push(input.to);
    }
    params.push(input.limit ?? 100);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM audit_events ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as AuditRow[];
    return rows.map(auditFromRow);
  }

  async createOrganization(org: Organization): Promise<void> {
    this.db
      .prepare("INSERT OR REPLACE INTO organizations (id, name, status, created_at) VALUES (?, ?, ?, ?)")
      .run(org.id, org.name, org.status, org.createdAt);
  }

  async getOrganization(orgId: string): Promise<Organization | undefined> {
    const row = this.db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId) as OrganizationRow | undefined;
    return row ? organizationFromRow(row) : undefined;
  }

  async listOrganizations(limit = 50): Promise<Organization[]> {
    const rows = this.db.prepare("SELECT * FROM organizations ORDER BY created_at DESC LIMIT ?").all(limit) as OrganizationRow[];
    return rows.map(organizationFromRow);
  }

  async createProject(project: Project): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO projects (
          id, org_id, name, status, default_role, retention_policy_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(project.id, project.orgId, project.name, project.status, project.defaultRole ?? null, project.retentionPolicyId ?? null, project.createdAt);
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
    return row ? projectFromRow(row) : undefined;
  }

  async listProjects(orgId?: string, limit = 50): Promise<Project[]> {
    const rows = orgId
      ? (this.db.prepare("SELECT * FROM projects WHERE org_id = ? ORDER BY created_at DESC LIMIT ?").all(orgId, limit) as ProjectRow[])
      : (this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC LIMIT ?").all(limit) as ProjectRow[]);
    return rows.map(projectFromRow);
  }

  async setProjectRetentionPolicy(projectId: string, retentionPolicyId: string): Promise<Project | undefined> {
    const result = this.db.prepare("UPDATE projects SET retention_policy_id = ? WHERE id = ?").run(retentionPolicyId, projectId);
    if (result.changes === 0) {
      return undefined;
    }
    return this.getProject(projectId);
  }

  async createRetentionPolicy(policy: RetentionPolicy): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO retention_policies (
          id, name, hot_transcript_days, artifact_retention_days, audit_retention_days,
          enable_auto_summaries, allow_user_deletion, allow_audit_export
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        policy.id,
        policy.name,
        policy.hotTranscriptDays,
        policy.artifactRetentionDays,
        policy.auditRetentionDays,
        policy.enableAutoSummaries ? 1 : 0,
        policy.allowUserDeletion ? 1 : 0,
        policy.allowAuditExport ? 1 : 0,
      );
  }

  async getRetentionPolicy(policyId: string): Promise<RetentionPolicy | undefined> {
    const row = this.db.prepare("SELECT * FROM retention_policies WHERE id = ?").get(policyId) as RetentionPolicyRow | undefined;
    return row ? retentionPolicyFromRow(row) : undefined;
  }

  async listRetentionPolicies(limit = 50): Promise<RetentionPolicy[]> {
    const rows = this.db.prepare("SELECT * FROM retention_policies ORDER BY rowid DESC LIMIT ?").all(limit) as RetentionPolicyRow[];
    return rows.map(retentionPolicyFromRow);
  }

  async grantCapability(grant: CapabilityGrant): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO capability_grants (
          subject_type, subject_id, scope_type, scope_id, capability, granted_by, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        grant.subjectType,
        grant.subjectId,
        grant.scopeType,
        grant.scopeId,
        grant.capability,
        grant.grantedBy,
        grant.createdAt,
        grant.expiresAt ?? null,
      );
  }

  async listCapabilityGrants(input: {
    subjectType?: CapabilityGrant["subjectType"];
    subjectId?: string;
    scopeType?: CapabilityGrant["scopeType"];
    scopeId?: string;
  } = {}): Promise<CapabilityGrant[]> {
    const clauses = ["(expires_at IS NULL OR expires_at > ?)"];
    const params: SQLInputValue[] = [new Date().toISOString()];
    if (input.subjectType) {
      clauses.push("subject_type = ?");
      params.push(input.subjectType);
    }
    if (input.subjectId) {
      clauses.push("subject_id = ?");
      params.push(input.subjectId);
    }
    if (input.scopeType) {
      clauses.push("scope_type = ?");
      params.push(input.scopeType);
    }
    if (input.scopeId) {
      clauses.push("scope_id = ?");
      params.push(input.scopeId);
    }
    const rows = this.db
      .prepare(`SELECT * FROM capability_grants WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`)
      .all(...params) as CapabilityGrantRow[];
    return rows.map(capabilityGrantFromRow);
  }

  async registerAgent(agent: AgentIdentity): Promise<void> {
    const existing = await this.getAgent(agent.id);
    this.db
      .prepare(
        `INSERT INTO agents (
          id, machine_id, org_id, display_name, public_key_pem, fingerprint, capabilities_json,
          allowed_projects_json, trust_status, created_at, last_seen_at, heartbeat_status,
          last_heartbeat_at, heartbeat_expires_at, last_room_id, last_error, heartbeat_metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          machine_id = excluded.machine_id,
          org_id = excluded.org_id,
          display_name = excluded.display_name,
          public_key_pem = excluded.public_key_pem,
          fingerprint = excluded.fingerprint,
          capabilities_json = excluded.capabilities_json,
          allowed_projects_json = excluded.allowed_projects_json,
          trust_status = excluded.trust_status,
          created_at = excluded.created_at,
          last_seen_at = excluded.last_seen_at`,
      )
      .run(
        agent.id,
        agent.machineId,
        agent.orgId ?? null,
        agent.displayName,
        agent.publicKeyPem,
        agent.fingerprint,
        JSON.stringify(agent.capabilities),
        JSON.stringify(agent.allowedProjects),
        agent.trustStatus,
        agent.createdAt,
        agent.lastSeenAt ?? null,
        agent.heartbeatStatus ?? existing?.heartbeatStatus ?? null,
        agent.lastHeartbeatAt ?? existing?.lastHeartbeatAt ?? null,
        agent.heartbeatExpiresAt ?? existing?.heartbeatExpiresAt ?? null,
        agent.lastRoomId ?? existing?.lastRoomId ?? null,
        agent.lastError ?? existing?.lastError ?? null,
        JSON.stringify(agent.heartbeatMetadata ?? existing?.heartbeatMetadata ?? {}),
      );
  }

  async getAgent(agentId: string): Promise<AgentIdentity | undefined> {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as AgentRow | undefined;
    return row ? agentFromRow(row) : undefined;
  }

  async listAgents(limit = 20): Promise<AgentIdentity[]> {
    const rows = this.db
      .prepare("SELECT * FROM agents ORDER BY COALESCE(last_seen_at, created_at) DESC LIMIT ?")
      .all(limit) as AgentRow[];
    return rows.map(agentFromRow);
  }

  async updateAgentHeartbeat(agent: AgentIdentity): Promise<AgentIdentity | undefined> {
    const result = this.db
      .prepare(
        `UPDATE agents
         SET last_seen_at = ?, heartbeat_status = ?, last_heartbeat_at = ?, heartbeat_expires_at = ?,
             last_room_id = ?, last_error = ?, heartbeat_metadata_json = ?
         WHERE id = ?`,
      )
      .run(
        agent.lastSeenAt ?? null,
        agent.heartbeatStatus ?? null,
        agent.lastHeartbeatAt ?? null,
        agent.heartbeatExpiresAt ?? null,
        agent.lastRoomId ?? null,
        agent.lastError ?? null,
        JSON.stringify(agent.heartbeatMetadata ?? {}),
        agent.id,
      );
    if (Number(result.changes ?? 0) === 0) {
      return undefined;
    }
    return this.getAgent(agent.id);
  }

  async recordAgentHeartbeatNonce(input: RecordAgentHeartbeatNonceInput): Promise<boolean> {
    try {
      this.db
        .prepare(
          `INSERT INTO agent_heartbeat_nonces (
            agent_id, nonce, envelope_hash, first_seen_at, expires_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(input.agentId, input.nonce, input.envelopeHash, input.firstSeenAt, input.expiresAt ?? null);
      return true;
    } catch (error) {
      if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
        return false;
      }
      throw error;
    }
  }

  async getAgentHeartbeatNonce(agentId: string, nonce: string): Promise<AgentHeartbeatNonce | undefined> {
    const row = this.db
      .prepare("SELECT * FROM agent_heartbeat_nonces WHERE agent_id = ? AND nonce = ?")
      .get(agentId, nonce) as AgentHeartbeatNonceRow | undefined;
    return row ? agentHeartbeatNonceFromRow(row) : undefined;
  }

  async deleteAgentHeartbeatNoncesBefore(input: { before: string; limit?: number }): Promise<number> {
    const limit = input.limit ?? 1000;
    const result = this.db
      .prepare(
        `DELETE FROM agent_heartbeat_nonces
         WHERE rowid IN (
           SELECT rowid
           FROM agent_heartbeat_nonces
           WHERE expires_at IS NOT NULL AND expires_at <= ?
           ORDER BY expires_at ASC
           LIMIT ?
         )`,
      )
      .run(input.before, limit);
    return Number(result.changes ?? 0);
  }

  async upsertWorkerRegistration(worker: WorkerRegistration): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO worker_registrations (
          id, agent_id, machine_id, org_id, display_name, endpoint, capabilities_json, allowed_projects_json,
          status, current_load, max_concurrent_tasks, metadata_json, registered_at, last_heartbeat_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          agent_id = excluded.agent_id,
          machine_id = excluded.machine_id,
          org_id = excluded.org_id,
          display_name = excluded.display_name,
          endpoint = excluded.endpoint,
          capabilities_json = excluded.capabilities_json,
          allowed_projects_json = excluded.allowed_projects_json,
          status = excluded.status,
          current_load = excluded.current_load,
          max_concurrent_tasks = excluded.max_concurrent_tasks,
          metadata_json = excluded.metadata_json,
          last_heartbeat_at = excluded.last_heartbeat_at,
          expires_at = excluded.expires_at`,
      )
      .run(
        worker.id,
        worker.agentId,
        worker.machineId,
        worker.orgId ?? null,
        worker.displayName,
        worker.endpoint ?? null,
        JSON.stringify(worker.capabilities),
        JSON.stringify(worker.allowedProjects),
        worker.status,
        worker.currentLoad,
        worker.maxConcurrentTasks,
        JSON.stringify(worker.metadata ?? {}),
        worker.registeredAt,
        worker.lastHeartbeatAt,
        worker.expiresAt ?? null,
      );
  }

  async getWorkerRegistration(workerId: string): Promise<WorkerRegistration | undefined> {
    const row = this.db.prepare("SELECT * FROM worker_registrations WHERE id = ?").get(workerId) as WorkerRegistrationRow | undefined;
    return row ? workerRegistrationFromRow(row) : undefined;
  }

  async listWorkerRegistrations(input: ListWorkersInput = {}): Promise<WorkerRegistration[]> {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (input.status) {
      clauses.push("status = ?");
      params.push(input.status);
    }
    if (input.agentId) {
      clauses.push("agent_id = ?");
      params.push(input.agentId);
    }
    if (input.machineId) {
      clauses.push("machine_id = ?");
      params.push(input.machineId);
    }
    if (input.orgId) {
      clauses.push("org_id = ?");
      params.push(input.orgId);
    }
    if (input.projectId) {
      clauses.push("allowed_projects_json LIKE ?");
      params.push(`%"${input.projectId}"%`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = input.limit ?? 20;
    const rows = this.db
      .prepare(`SELECT * FROM worker_registrations ${where} ORDER BY last_heartbeat_at DESC LIMIT ?`)
      .all(...params, limit) as WorkerRegistrationRow[];
    return rows.map(workerRegistrationFromRow);
  }

  async updateWorkerHeartbeat(input: WorkerHeartbeatInput): Promise<WorkerRegistration | undefined> {
    const existing = await this.getWorkerRegistration(input.workerId);
    if (!existing) {
      return undefined;
    }
    const now = new Date();
    const updated: WorkerRegistration = {
      ...existing,
      status: input.status ?? existing.status,
      currentLoad: input.currentLoad ?? existing.currentLoad,
      maxConcurrentTasks: input.maxConcurrentTasks ?? existing.maxConcurrentTasks,
      metadata: input.metadata ?? existing.metadata,
      lastHeartbeatAt: now.toISOString(),
      expiresAt: input.ttlSeconds ? new Date(now.getTime() + input.ttlSeconds * 1000).toISOString() : existing.expiresAt,
    };
    await this.upsertWorkerRegistration(updated);
    return updated;
  }

  async recordWorkerHeartbeatNonce(input: RecordWorkerHeartbeatNonceInput): Promise<boolean> {
    try {
      this.db
        .prepare(
          `INSERT INTO worker_heartbeat_nonces (
            agent_id, nonce, worker_id, envelope_hash, first_seen_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.agentId, input.nonce, input.workerId, input.envelopeHash, input.firstSeenAt, input.expiresAt ?? null);
      return true;
    } catch (error) {
      if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
        return false;
      }
      throw error;
    }
  }

  async getWorkerHeartbeatNonce(agentId: string, nonce: string): Promise<WorkerHeartbeatNonce | undefined> {
    const row = this.db
      .prepare("SELECT * FROM worker_heartbeat_nonces WHERE agent_id = ? AND nonce = ?")
      .get(agentId, nonce) as WorkerHeartbeatNonceRow | undefined;
    return row ? workerHeartbeatNonceFromRow(row) : undefined;
  }

  async deleteWorkerHeartbeatNoncesBefore(input: { before: string; limit?: number }): Promise<number> {
    const limit = input.limit ?? 1000;
    const result = this.db
      .prepare(
        `DELETE FROM worker_heartbeat_nonces
         WHERE rowid IN (
           SELECT rowid
           FROM worker_heartbeat_nonces
           WHERE expires_at IS NOT NULL AND expires_at <= ?
           ORDER BY expires_at ASC
           LIMIT ?
         )`,
      )
      .run(input.before, limit);
    return Number(result.changes ?? 0);
  }

  async recordTaskLeaseNonce(input: RecordTaskLeaseNonceInput): Promise<boolean> {
    try {
      this.db
        .prepare(
          `INSERT INTO task_lease_nonces (
            claimed_by_id, nonce, assignment_id, worker_id, envelope_hash, first_seen_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.claimedById, input.nonce, input.assignmentId, input.workerId, input.envelopeHash, input.firstSeenAt, input.expiresAt ?? null);
      return true;
    } catch (error) {
      if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
        return false;
      }
      throw error;
    }
  }

  async getTaskLeaseNonce(claimedById: string, nonce: string): Promise<TaskLeaseNonce | undefined> {
    const row = this.db
      .prepare("SELECT * FROM task_lease_nonces WHERE claimed_by_id = ? AND nonce = ?")
      .get(claimedById, nonce) as TaskLeaseNonceRow | undefined;
    return row ? taskLeaseNonceFromRow(row) : undefined;
  }

  async deleteTaskLeaseNoncesBefore(input: { before: string; limit?: number }): Promise<number> {
    const limit = input.limit ?? 1000;
    const result = this.db
      .prepare(
        `DELETE FROM task_lease_nonces
         WHERE rowid IN (
           SELECT rowid
           FROM task_lease_nonces
           WHERE expires_at IS NOT NULL AND expires_at <= ?
           ORDER BY expires_at ASC
           LIMIT ?
         )`,
      )
      .run(input.before, limit);
    return Number(result.changes ?? 0);
  }

  async recordRoomDeliveryAckNonce(input: RecordRoomDeliveryAckNonceInput): Promise<boolean> {
    try {
      this.db
        .prepare(
          `INSERT INTO room_delivery_ack_nonces (
            agent_id, nonce, room_id, message_id, envelope_hash, first_seen_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.agentId, input.nonce, input.roomId, input.messageId, input.envelopeHash, input.firstSeenAt, input.expiresAt ?? null);
      return true;
    } catch {
      return false;
    }
  }

  async getRoomDeliveryAckNonce(agentId: string, nonce: string): Promise<RoomDeliveryAckNonce | undefined> {
    const row = this.db
      .prepare("SELECT * FROM room_delivery_ack_nonces WHERE agent_id = ? AND nonce = ?")
      .get(agentId, nonce) as RoomDeliveryAckNonceRow | undefined;
    return row ? roomDeliveryAckNonceFromRow(row) : undefined;
  }

  async deleteRoomDeliveryAckNoncesBefore(input: { before: string; limit?: number }): Promise<number> {
    const limit = input.limit ?? 1000;
    const result = this.db
      .prepare(
        `DELETE FROM room_delivery_ack_nonces
         WHERE rowid IN (
           SELECT rowid
           FROM room_delivery_ack_nonces
           WHERE expires_at IS NOT NULL AND expires_at <= ?
           ORDER BY first_seen_at ASC
           LIMIT ?
         )`,
      )
      .run(input.before, limit);
    return Number(result.changes ?? 0);
  }

  async createRoom(room: Room): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO rooms (
          id, project_id, name, policy_json, created_by_json, created_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(room.id, room.projectId ?? null, room.name, JSON.stringify(room.policy), JSON.stringify(room.createdBy), room.createdAt, room.closedAt ?? null);
  }

  async getRoom(roomId: string): Promise<Room | undefined> {
    const row = this.db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId) as RoomRow | undefined;
    return row ? roomFromRow(row) : undefined;
  }

  async listRooms(limit = 20): Promise<Room[]> {
    const rows = this.db.prepare("SELECT * FROM rooms ORDER BY created_at DESC LIMIT ?").all(limit) as RoomRow[];
    return rows.map(roomFromRow);
  }

  async createRoomInvite(invite: RoomInvite): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO room_invites (
          id, room_id, token_hash, created_by_json, role, status, max_uses, uses, created_at, expires_at, last_used_at, envelope_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        invite.id,
        invite.roomId,
        invite.tokenHash,
        JSON.stringify(invite.createdBy),
        invite.role,
        invite.status,
        invite.maxUses,
        invite.uses,
        invite.createdAt,
        invite.expiresAt,
        invite.lastUsedAt ?? null,
        invite.envelope ? JSON.stringify(invite.envelope) : null,
      );
  }

  async getRoomInviteByTokenHash(tokenHash: string): Promise<RoomInvite | undefined> {
    const row = this.db.prepare("SELECT * FROM room_invites WHERE token_hash = ?").get(tokenHash) as RoomInviteRow | undefined;
    return row ? roomInviteFromRow(row) : undefined;
  }

  async listRoomInvites(roomId: string): Promise<RoomInvite[]> {
    const rows = this.db
      .prepare("SELECT * FROM room_invites WHERE room_id = ? ORDER BY created_at DESC")
      .all(roomId) as RoomInviteRow[];
    return rows.map(roomInviteFromRow);
  }

  async updateRoomInvite(invite: RoomInvite): Promise<void> {
    this.db
      .prepare(
        `UPDATE room_invites
         SET status = ?, uses = ?, last_used_at = ?
         WHERE id = ?`,
      )
      .run(invite.status, invite.uses, invite.lastUsedAt ?? null, invite.id);
  }

  async addRoomMember(member: RoomMember): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO room_members (
          id, room_id, actor_json, actor_id, aliases_json, role, status, joined_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        makeId<"MessageId">("mem"),
        member.roomId,
        JSON.stringify(member.actor),
        member.actor.id,
        JSON.stringify(member.aliases ?? []),
        member.role,
        member.status,
        member.joinedAt ?? null,
        member.expiresAt ?? null,
      );
  }

  async updateRoomMember(member: RoomMember): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE room_members
         SET actor_json = ?, aliases_json = ?, role = ?, status = ?, joined_at = ?, expires_at = ?
         WHERE room_id = ? AND actor_id = ?`,
      )
      .run(
        JSON.stringify(member.actor),
        JSON.stringify(member.aliases ?? []),
        member.role,
        member.status,
        member.joinedAt ?? null,
        member.expiresAt ?? null,
        member.roomId,
        member.actor.id,
      );
    if (result.changes === 0) {
      await this.addRoomMember(member);
    }
  }

  async listRoomMembers(roomId: string): Promise<RoomMember[]> {
    const rows = this.db.prepare("SELECT * FROM room_members WHERE room_id = ? ORDER BY rowid ASC").all(roomId) as RoomMemberRow[];
    return rows.map(roomMemberFromRow);
  }

  async appendRoomMessage(message: RoomMessage): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO room_messages (
          id, room_id, sender_json, kind, body, signature, created_at, parent_message_id, artifact_refs_json, routing_json, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.roomId,
        JSON.stringify(message.sender),
        message.kind,
        message.body,
        message.signature ?? null,
        message.createdAt,
        message.parentMessageId ?? null,
        JSON.stringify(message.artifactRefs ?? []),
        JSON.stringify(message.routing ?? null),
        JSON.stringify(message.metadata ?? {}),
      );
  }

  async listRoomMessages(roomId: string, limit = 50): Promise<RoomMessage[]> {
    const rows = this.db
      .prepare("SELECT * FROM room_messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(roomId, limit) as RoomMessageRow[];
    return rows.map(roomMessageFromRow).reverse();
  }

  async getRoomDeliveryCursor(roomId: string, agentId: string): Promise<RoomDeliveryCursor | undefined> {
    const row = this.db
      .prepare("SELECT * FROM room_delivery_cursors WHERE room_id = ? AND agent_id = ?")
      .get(roomId, agentId) as RoomDeliveryCursorRow | undefined;
    return row ? roomDeliveryCursorFromRow(row) : undefined;
  }

  async upsertRoomDeliveryCursor(cursor: RoomDeliveryCursor): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO room_delivery_cursors (
          room_id, agent_id, last_delivered_message_id, last_ack_envelope_json, updated_at, updated_by_json
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(room_id, agent_id) DO UPDATE SET
          last_delivered_message_id = excluded.last_delivered_message_id,
          last_ack_envelope_json = excluded.last_ack_envelope_json,
          updated_at = excluded.updated_at,
          updated_by_json = excluded.updated_by_json`,
      )
      .run(
        cursor.roomId,
        cursor.agentId,
        cursor.lastDeliveredMessageId ?? null,
        cursor.lastAckEnvelope ? JSON.stringify(cursor.lastAckEnvelope) : null,
        cursor.updatedAt,
        JSON.stringify(cursor.updatedBy),
      );
  }

  async createArtifact(artifact: ArtifactRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO artifacts (
          id, kind, name, path, uri, mime_type, size_bytes, sha256, org_id, project_id, room_id,
          session_id, created_by_json, status, created_at, deleted_at, deleted_by_json, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.id,
        artifact.kind,
        artifact.name,
        artifact.path ?? null,
        artifact.uri ?? null,
        artifact.mimeType ?? null,
        artifact.sizeBytes ?? null,
        artifact.sha256 ?? null,
        artifact.orgId ?? null,
        artifact.projectId ?? null,
        artifact.roomId ?? null,
        artifact.sessionId ?? null,
        JSON.stringify(artifact.createdBy),
        artifact.status,
        artifact.createdAt,
        artifact.deletedAt ?? null,
        artifact.deletedBy ? JSON.stringify(artifact.deletedBy) : null,
        JSON.stringify(artifact.metadata ?? {}),
      );
  }

  async getArtifact(artifactId: string): Promise<ArtifactRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(artifactId) as ArtifactRow | undefined;
    return row ? artifactFromRow(row) : undefined;
  }

  async listArtifacts(input: import("./agent-store.js").ListArtifactsInput = {}): Promise<ArtifactRecord[]> {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (input.status) {
      clauses.push("status = ?");
      params.push(input.status);
    }
    if (input.orgId) {
      clauses.push("org_id = ?");
      params.push(input.orgId);
    }
    if (input.projectId) {
      clauses.push("project_id = ?");
      params.push(input.projectId);
    }
    if (input.roomId) {
      clauses.push("room_id = ?");
      params.push(input.roomId);
    }
    if (input.sessionId) {
      clauses.push("session_id = ?");
      params.push(input.sessionId);
    }
    if (input.kind) {
      clauses.push("kind = ?");
      params.push(input.kind);
    }
    params.push(input.limit ?? 100);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM artifacts ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as ArtifactRow[];
    return rows.map(artifactFromRow);
  }

  async markArtifactDeleted(artifactId: string, actor: ArtifactRecord["createdBy"]): Promise<ArtifactRecord | undefined> {
    const artifact = await this.getArtifact(artifactId);
    if (!artifact) {
      return undefined;
    }
    const deletedAt = new Date().toISOString();
    this.db
      .prepare("UPDATE artifacts SET status = ?, deleted_at = ?, deleted_by_json = ? WHERE id = ?")
      .run("deleted", deletedAt, JSON.stringify(actor), artifactId);
    return {
      ...artifact,
      status: "deleted",
      deletedAt,
      deletedBy: actor,
    };
  }

  async createSpecification(specification: Specification): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO specifications (
          id, org_id, project_id, room_id, title, objective, status, source, source_path,
          created_by_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        specification.id,
        specification.orgId ?? null,
        specification.projectId ?? null,
        specification.roomId ?? null,
        specification.title,
        specification.objective,
        specification.status,
        specification.source,
        specification.sourcePath ?? null,
        JSON.stringify(specification.createdBy),
        JSON.stringify(specification.metadata ?? {}),
        specification.createdAt,
        specification.updatedAt,
      );
  }

  async getSpecification(specId: string): Promise<Specification | undefined> {
    const row = this.db.prepare("SELECT * FROM specifications WHERE id = ?").get(specId) as SpecificationRow | undefined;
    return row ? specificationFromRow(row) : undefined;
  }

  async listSpecifications(input: ListSpecificationsInput = {}): Promise<Specification[]> {
    const conditions: string[] = [];
    const values: SQLInputValue[] = [];
    if (input.orgId) {
      conditions.push("org_id = ?");
      values.push(input.orgId);
    }
    if (input.projectId) {
      conditions.push("project_id = ?");
      values.push(input.projectId);
    }
    if (input.roomId) {
      conditions.push("room_id = ?");
      values.push(input.roomId);
    }
    if (input.status) {
      conditions.push("status = ?");
      values.push(input.status);
    }
    values.push(input.limit ?? 50);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM specifications ${where} ORDER BY updated_at DESC LIMIT ?`).all(...values) as SpecificationRow[];
    return rows.map(specificationFromRow);
  }

  async createSpecificationTask(task: SpecificationTask): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO specification_tasks (
          id, spec_id, title, description, status, parallelizable, paths_json, depends_on_json,
          verification, task_order, created_by_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.specId,
        task.title,
        task.description ?? null,
        task.status,
        task.parallelizable ? 1 : 0,
        JSON.stringify(task.paths),
        JSON.stringify(task.dependsOn),
        task.verification ?? null,
        task.order,
        JSON.stringify(task.createdBy),
        JSON.stringify(task.metadata ?? {}),
        task.createdAt,
        task.updatedAt,
      );
  }

  async updateSpecificationTask(task: SpecificationTask): Promise<void> {
    this.db
      .prepare(
        `UPDATE specification_tasks
         SET title = ?, description = ?, status = ?, parallelizable = ?, paths_json = ?, depends_on_json = ?,
             verification = ?, task_order = ?, created_by_json = ?, metadata_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        task.title,
        task.description ?? null,
        task.status,
        task.parallelizable ? 1 : 0,
        JSON.stringify(task.paths),
        JSON.stringify(task.dependsOn),
        task.verification ?? null,
        task.order,
        JSON.stringify(task.createdBy),
        JSON.stringify(task.metadata ?? {}),
        task.updatedAt,
        task.id,
      );
  }

  async listSpecificationTasks(specId: string): Promise<SpecificationTask[]> {
    const rows = this.db.prepare("SELECT * FROM specification_tasks WHERE spec_id = ? ORDER BY task_order ASC, created_at ASC").all(specId) as SpecificationTaskRow[];
    return rows.map(specificationTaskFromRow);
  }

  async createSpecificationVerification(verification: SpecificationVerification): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO specification_verifications (
          id, spec_id, task_id, status, evidence, artifact_refs_json, created_by_json, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        verification.id,
        verification.specId,
        verification.taskId,
        verification.status,
        verification.evidence,
        JSON.stringify(verification.artifactRefs),
        JSON.stringify(verification.createdBy),
        JSON.stringify(verification.metadata ?? {}),
        verification.createdAt,
      );
  }

  async listSpecificationVerifications(input: ListSpecificationVerificationsInput): Promise<SpecificationVerification[]> {
    const conditions = ["spec_id = ?"];
    const values: SQLInputValue[] = [input.specId];
    if (input.taskId) {
      conditions.push("task_id = ?");
      values.push(input.taskId);
    }
    if (input.status) {
      conditions.push("status = ?");
      values.push(input.status);
    }
    values.push(input.limit ?? 100);
    const rows = this.db
      .prepare(`SELECT * FROM specification_verifications WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
      .all(...values) as SpecificationVerificationRow[];
    return rows.map(specificationVerificationFromRow);
  }

  async createSpecificationVersion(version: SpecificationVersion): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO specification_versions (
          id, spec_id, version_number, title, objective, status, task_snapshot_json,
          reason, created_by_json, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        version.id,
        version.specId,
        version.version,
        version.title,
        version.objective,
        version.status,
        JSON.stringify(version.taskSnapshot),
        version.reason ?? null,
        JSON.stringify(version.createdBy),
        JSON.stringify(version.metadata ?? {}),
        version.createdAt,
      );
  }

  async listSpecificationVersions(input: ListSpecificationVersionsInput): Promise<SpecificationVersion[]> {
    const rows = this.db
      .prepare("SELECT * FROM specification_versions WHERE spec_id = ? ORDER BY version_number DESC, created_at DESC LIMIT ?")
      .all(input.specId, input.limit ?? 50) as SpecificationVersionRow[];
    return rows.map(specificationVersionFromRow);
  }

  async createSpecificationClarification(clarification: SpecificationClarification): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO specification_clarifications (
          id, spec_id, question, answer, status, created_by_json, answered_by_json,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        clarification.id,
        clarification.specId,
        clarification.question,
        clarification.answer ?? null,
        clarification.status,
        JSON.stringify(clarification.createdBy),
        clarification.answeredBy ? JSON.stringify(clarification.answeredBy) : null,
        JSON.stringify(clarification.metadata ?? {}),
        clarification.createdAt,
        clarification.updatedAt,
      );
  }

  async updateSpecificationClarification(clarification: SpecificationClarification): Promise<void> {
    this.db
      .prepare(
        `UPDATE specification_clarifications
         SET question = ?, answer = ?, status = ?, created_by_json = ?, answered_by_json = ?,
             metadata_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        clarification.question,
        clarification.answer ?? null,
        clarification.status,
        JSON.stringify(clarification.createdBy),
        clarification.answeredBy ? JSON.stringify(clarification.answeredBy) : null,
        JSON.stringify(clarification.metadata ?? {}),
        clarification.updatedAt,
        clarification.id,
      );
  }

  async listSpecificationClarifications(input: ListSpecificationClarificationsInput): Promise<SpecificationClarification[]> {
    const conditions = ["spec_id = ?"];
    const values: SQLInputValue[] = [input.specId];
    if (input.status) {
      conditions.push("status = ?");
      values.push(input.status);
    }
    values.push(input.limit ?? 100);
    const rows = this.db
      .prepare(`SELECT * FROM specification_clarifications WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`)
      .all(...values) as SpecificationClarificationRow[];
    return rows.map(specificationClarificationFromRow);
  }

  async createSpecificationPlan(plan: SpecificationPlan): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO specification_plans (
          id, spec_id, version_id, title, status, summary, steps_json,
          open_clarification_ids_json, generated_by_json, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.id,
        plan.specId,
        plan.versionId ?? null,
        plan.title,
        plan.status,
        plan.summary,
        JSON.stringify(plan.steps),
        JSON.stringify(plan.openClarificationIds),
        JSON.stringify(plan.generatedBy),
        JSON.stringify(plan.metadata ?? {}),
        plan.createdAt,
      );
  }

  async listSpecificationPlans(input: ListSpecificationPlansInput): Promise<SpecificationPlan[]> {
    const conditions = ["spec_id = ?"];
    const values: SQLInputValue[] = [input.specId];
    if (input.status) {
      conditions.push("status = ?");
      values.push(input.status);
    }
    values.push(input.limit ?? 50);
    const rows = this.db
      .prepare(`SELECT * FROM specification_plans WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
      .all(...values) as SpecificationPlanRow[];
    return rows.map(specificationPlanFromRow);
  }

  async createSubtask(subtask: Subtask): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO subtasks (
          id, parent_session_id, child_session_id, spec_id, spec_task_id, room_id, assigned_agent_id, objective, status, risk,
          execution_mode, created_by_json, result_summary, artifact_refs_json, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        subtask.id,
        subtask.parentSessionId ?? null,
        subtask.childSessionId ?? null,
        subtask.specId ?? null,
        subtask.specTaskId ?? null,
        subtask.roomId ?? null,
        subtask.assignedAgentId ?? null,
        subtask.objective,
        subtask.status,
        subtask.risk,
        subtask.executionMode,
        JSON.stringify(subtask.createdBy),
        subtask.resultSummary ?? null,
        JSON.stringify(subtask.artifactRefs ?? []),
        subtask.createdAt,
        subtask.updatedAt,
        subtask.completedAt ?? null,
      );
  }

  async updateSubtask(subtask: Subtask): Promise<void> {
    this.db
      .prepare(
        `UPDATE subtasks
         SET parent_session_id = ?, child_session_id = ?, spec_id = ?, spec_task_id = ?, room_id = ?, assigned_agent_id = ?, objective = ?,
             status = ?, risk = ?, execution_mode = ?, created_by_json = ?, result_summary = ?,
             artifact_refs_json = ?, updated_at = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(
        subtask.parentSessionId ?? null,
        subtask.childSessionId ?? null,
        subtask.specId ?? null,
        subtask.specTaskId ?? null,
        subtask.roomId ?? null,
        subtask.assignedAgentId ?? null,
        subtask.objective,
        subtask.status,
        subtask.risk,
        subtask.executionMode,
        JSON.stringify(subtask.createdBy),
        subtask.resultSummary ?? null,
        JSON.stringify(subtask.artifactRefs ?? []),
        subtask.updatedAt,
        subtask.completedAt ?? null,
        subtask.id,
      );
  }

  async listSubtasks(parentSessionId?: string): Promise<Subtask[]> {
    const rows = parentSessionId
      ? (this.db.prepare("SELECT * FROM subtasks WHERE parent_session_id = ? ORDER BY created_at DESC").all(parentSessionId) as SubtaskRow[])
      : (this.db.prepare("SELECT * FROM subtasks ORDER BY created_at DESC").all() as SubtaskRow[]);
    return rows.map(subtaskFromRow);
  }

  async createTaskAssignment(assignment: TaskAssignment): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO task_assignments (
          id, kind, session_id, subtask_id, worker_id, project_id, room_id, status, priority, attempts,
          lease_owner_id, lease_expires_at, assigned_by_json, result_summary, metadata_json, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        assignment.id,
        assignment.kind,
        assignment.sessionId ?? null,
        assignment.subtaskId ?? null,
        assignment.workerId,
        assignment.projectId ?? null,
        assignment.roomId ?? null,
        assignment.status,
        assignment.priority,
        assignment.attempts,
        assignment.leaseOwnerId,
        assignment.leaseExpiresAt,
        JSON.stringify(assignment.assignedBy),
        assignment.resultSummary ?? null,
        JSON.stringify(assignment.metadata ?? {}),
        assignment.createdAt,
        assignment.updatedAt,
        assignment.completedAt ?? null,
      );
  }

  async getTaskAssignment(assignmentId: string): Promise<TaskAssignment | undefined> {
    const row = this.db.prepare("SELECT * FROM task_assignments WHERE id = ?").get(assignmentId) as TaskAssignmentRow | undefined;
    return row ? taskAssignmentFromRow(row) : undefined;
  }

  async updateTaskAssignment(assignment: TaskAssignment): Promise<void> {
    this.db
      .prepare(
        `UPDATE task_assignments
         SET kind = ?, session_id = ?, subtask_id = ?, worker_id = ?, project_id = ?, room_id = ?,
             status = ?, priority = ?, attempts = ?, lease_owner_id = ?, lease_expires_at = ?,
             assigned_by_json = ?, result_summary = ?, metadata_json = ?, updated_at = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(
        assignment.kind,
        assignment.sessionId ?? null,
        assignment.subtaskId ?? null,
        assignment.workerId,
        assignment.projectId ?? null,
        assignment.roomId ?? null,
        assignment.status,
        assignment.priority,
        assignment.attempts,
        assignment.leaseOwnerId,
        assignment.leaseExpiresAt,
        JSON.stringify(assignment.assignedBy),
        assignment.resultSummary ?? null,
        JSON.stringify(assignment.metadata ?? {}),
        assignment.updatedAt,
        assignment.completedAt ?? null,
        assignment.id,
      );
  }

  async listTaskAssignments(input: ListTaskAssignmentsInput = {}): Promise<TaskAssignment[]> {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (input.status) {
      clauses.push("status = ?");
      params.push(input.status);
    }
    if (input.workerId) {
      clauses.push("worker_id = ?");
      params.push(input.workerId);
    }
    if (input.sessionId) {
      clauses.push("session_id = ?");
      params.push(input.sessionId);
    }
    if (input.subtaskId) {
      clauses.push("subtask_id = ?");
      params.push(input.subtaskId);
    }
    if (input.projectId) {
      clauses.push("project_id = ?");
      params.push(input.projectId);
    }
    if (input.roomId) {
      clauses.push("room_id = ?");
      params.push(input.roomId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM task_assignments ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params, input.limit ?? 50) as TaskAssignmentRow[];
    return rows.map(taskAssignmentFromRow);
  }

  async createSessionLink(link: SessionLink): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO session_links (
          id, type, from_session_id, to_session_id, room_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(link.id, link.type, link.fromSessionId, link.toSessionId, link.roomId ?? null, JSON.stringify(link.metadata ?? {}), link.createdAt);
  }

  async listSessionLinks(sessionId: string): Promise<SessionLink[]> {
    const rows = this.db
      .prepare("SELECT * FROM session_links WHERE from_session_id = ? OR to_session_id = ? ORDER BY created_at DESC")
      .all(sessionId, sessionId) as SessionLinkRow[];
    return rows.map(sessionLinkFromRow);
  }

  async upsertSkill(skill: Skill): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO skills (
          id, scope, source_path, name, version, description, permissions_json, tools_json,
          summary, body, checksum, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        skill.id,
        skill.scope,
        skill.sourcePath ?? null,
        skill.manifest.name,
        skill.manifest.version,
        skill.manifest.description,
        JSON.stringify(skill.manifest.permissions),
        JSON.stringify(skill.manifest.tools),
        skill.summary,
        skill.body,
        skill.checksum ?? null,
        skill.createdAt,
        skill.updatedAt,
      );
  }

  async listSkills(): Promise<Skill[]> {
    const rows = this.db.prepare("SELECT * FROM skills ORDER BY name ASC").all() as SkillRow[];
    return rows.map(skillFromRow);
  }

  async getSkill(name: string): Promise<Skill | undefined> {
    const row = this.db.prepare("SELECT * FROM skills WHERE name = ?").get(name) as SkillRow | undefined;
    return row ? skillFromRow(row) : undefined;
  }

  async recordSkillUsage(event: SkillUsageEvent): Promise<void> {
    this.db
      .prepare("INSERT INTO skill_usage_events (id, skill_id, session_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(event.id, event.skillId, event.sessionId ?? null, event.actorId ?? null, event.createdAt);
  }

  async addMemory(memory: MemoryRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO memories (
          id, scope_type, scope_id, kind, content, summary, source_session_id, confidence,
          created_at, updated_at, expires_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        memory.id,
        memory.scopeType,
        memory.scopeId,
        memory.kind,
        memory.content,
        memory.summary,
        memory.sourceSessionId ?? null,
        memory.confidence,
        memory.createdAt,
        memory.updatedAt,
        memory.expiresAt ?? null,
        memory.lastUsedAt ?? null,
      );
  }

  async listMemories(scopeType?: MemoryScope, scopeId?: string): Promise<MemoryRecord[]> {
    const rows =
      scopeType && scopeId
        ? (this.db.prepare("SELECT * FROM memories WHERE scope_type = ? AND scope_id = ? ORDER BY updated_at DESC").all(scopeType, scopeId) as MemoryRow[])
        : scopeType
          ? (this.db.prepare("SELECT * FROM memories WHERE scope_type = ? ORDER BY updated_at DESC").all(scopeType) as MemoryRow[])
          : (this.db.prepare("SELECT * FROM memories ORDER BY updated_at DESC").all() as MemoryRow[]);
    return rows.map(memoryFromRow);
  }

  async deleteMemory(memoryId: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM memories WHERE id = ?").run(memoryId);
    return result.changes > 0;
  }

  async addSessionSummary(summary: SessionSummary): Promise<void> {
    this.db
      .prepare("INSERT INTO session_summaries (id, session_id, summary, created_at) VALUES (?, ?, ?, ?)")
      .run(summary.id, summary.sessionId, summary.summary, summary.createdAt);
  }

  async getSessionSummaries(sessionId: string): Promise<SessionSummary[]> {
    const rows = this.db.prepare("SELECT * FROM session_summaries WHERE session_id = ? ORDER BY created_at DESC").all(sessionId) as SessionSummaryRow[];
    return rows.map(sessionSummaryFromRow);
  }

  async compactSession(sessionId: string, summary: SessionSummary): Promise<import("./agent-store.js").CompactSessionResult> {
    const messages = this.db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
    const toolCalls = this.db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
    await this.addSessionSummary(summary);
    return {
      sessionId,
      messagesDeleted: Number(messages.changes),
      toolCallsDeleted: Number(toolCalls.changes),
    };
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    this.db.prepare("DELETE FROM pending_tool_calls WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM session_summaries WHERE session_id = ?").run(sessionId);
    this.db.prepare("UPDATE artifacts SET status = 'deleted', deleted_at = COALESCE(deleted_at, ?) WHERE session_id = ?").run(new Date().toISOString(), sessionId);
    this.db.prepare("UPDATE subtasks SET child_session_id = NULL WHERE child_session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM session_links WHERE from_session_id = ? OR to_session_id = ?").run(sessionId, sessionId);
    const result = this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    return result.changes > 0;
  }

  async deleteAuditEventsBefore(input: { projectId?: string; before: string }): Promise<number> {
    const result = input.projectId
      ? this.db.prepare("DELETE FROM audit_events WHERE project_id = ? AND created_at < ?").run(input.projectId, input.before)
      : this.db.prepare("DELETE FROM audit_events WHERE created_at < ?").run(input.before);
    return Number(result.changes);
  }

  async listSessions(limit = 20): Promise<Session[]> {
    const rows = this.db.prepare("SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?").all(limit) as SessionRow[];
    return rows.map(sessionFromRow);
  }

  async getMessages(sessionId: string): Promise<AgentMessage[]> {
    const rows = this.db.prepare("SELECT message_json FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as Array<{ message_json: string }>;
    return rows.map((row) => JSON.parse(row.message_json) as AgentMessage);
  }

  async getToolResults(sessionId: string): Promise<ToolResult[]> {
    const rows = this.db.prepare("SELECT result_json FROM tool_calls WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as Array<{ result_json: string }>;
    return rows.map((row) => JSON.parse(row.result_json) as ToolResult);
  }

  close(): void {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        project_id TEXT,
        room_id TEXT,
        objective TEXT NOT NULL,
        target_mode TEXT NOT NULL DEFAULT 'build',
        status TEXT NOT NULL,
        risk TEXT NOT NULL,
        created_by_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        message_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        call_id TEXT NOT NULL,
        ok INTEGER NOT NULL,
        output TEXT,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS file_changes (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        actor_json TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        before_hash TEXT,
        after_hash TEXT,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        actor_json TEXT NOT NULL,
        org_id TEXT,
        project_id TEXT,
        session_id TEXT,
        room_id TEXT,
        summary TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        artifact_refs_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        default_role TEXT,
        retention_policy_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS retention_policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hot_transcript_days INTEGER NOT NULL,
        artifact_retention_days INTEGER NOT NULL,
        audit_retention_days INTEGER NOT NULL,
        enable_auto_summaries INTEGER NOT NULL,
        allow_user_deletion INTEGER NOT NULL,
        allow_audit_export INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS capability_grants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        granted_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );

      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        requested_by_json TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT NOT NULL,
        approver_hint TEXT,
        org_id TEXT,
        project_id TEXT,
        room_id TEXT,
        session_id TEXT,
        tool_name TEXT,
        input_summary TEXT,
        decision_by_json TEXT,
        decision_reason TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        expires_at TEXT
      );

      CREATE TABLE IF NOT EXISTS pending_tool_calls (
        id TEXT PRIMARY KEY,
        approval_id TEXT NOT NULL UNIQUE,
        tool_call_id TEXT,
        session_id TEXT,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        requested_by_json TEXT NOT NULL,
        status TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        org_id TEXT,
        display_name TEXT NOT NULL,
        public_key_pem TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        allowed_projects_json TEXT NOT NULL,
        trust_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT,
        heartbeat_status TEXT,
        last_heartbeat_at TEXT,
        heartbeat_expires_at TEXT,
        last_room_id TEXT,
        last_error TEXT,
        heartbeat_metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS agent_heartbeat_nonces (
        agent_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        envelope_hash TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (agent_id, nonce)
      );

      CREATE TABLE IF NOT EXISTS worker_registrations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        machine_id TEXT NOT NULL,
        org_id TEXT,
        display_name TEXT NOT NULL,
        endpoint TEXT,
        capabilities_json TEXT NOT NULL,
        allowed_projects_json TEXT NOT NULL,
        status TEXT NOT NULL,
        current_load INTEGER NOT NULL,
        max_concurrent_tasks INTEGER NOT NULL,
        metadata_json TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        last_heartbeat_at TEXT NOT NULL,
        expires_at TEXT
      );

      CREATE TABLE IF NOT EXISTS worker_heartbeat_nonces (
        agent_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        envelope_hash TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (agent_id, nonce)
      );

      CREATE TABLE IF NOT EXISTS task_lease_nonces (
        claimed_by_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        envelope_hash TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (claimed_by_id, nonce)
      );

      CREATE TABLE IF NOT EXISTS room_delivery_ack_nonces (
        agent_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        room_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        envelope_hash TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (agent_id, nonce)
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        created_by_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        closed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS room_members (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        actor_json TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        joined_at TEXT,
        expires_at TEXT,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS room_invites (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_by_json TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        max_uses INTEGER NOT NULL,
        uses INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_used_at TEXT,
        envelope_json TEXT,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS room_messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        sender_json TEXT NOT NULL,
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        signature TEXT,
        created_at TEXT NOT NULL,
        parent_message_id TEXT,
        artifact_refs_json TEXT NOT NULL,
        routing_json TEXT,
        metadata_json TEXT NOT NULL,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS room_delivery_cursors (
        room_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        last_delivered_message_id TEXT,
        last_ack_envelope_json TEXT,
        updated_at TEXT NOT NULL,
        updated_by_json TEXT NOT NULL,
        PRIMARY KEY (room_id, agent_id),
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT,
        uri TEXT,
        mime_type TEXT,
        size_bytes INTEGER,
        sha256 TEXT,
        org_id TEXT,
        project_id TEXT,
        room_id TEXT,
        session_id TEXT,
        created_by_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_by_json TEXT,
        metadata_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS specifications (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        project_id TEXT,
        room_id TEXT,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        source_path TEXT,
        created_by_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS specification_tasks (
        id TEXT PRIMARY KEY,
        spec_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        parallelizable INTEGER NOT NULL,
        paths_json TEXT NOT NULL,
        depends_on_json TEXT NOT NULL,
        verification TEXT,
        task_order INTEGER NOT NULL,
        created_by_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (spec_id) REFERENCES specifications(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS specification_verifications (
        id TEXT PRIMARY KEY,
        spec_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence TEXT NOT NULL,
        artifact_refs_json TEXT NOT NULL,
        created_by_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (spec_id) REFERENCES specifications(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES specification_tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS specification_versions (
        id TEXT PRIMARY KEY,
        spec_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        task_snapshot_json TEXT NOT NULL,
        reason TEXT,
        created_by_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (spec_id) REFERENCES specifications(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS specification_clarifications (
        id TEXT PRIMARY KEY,
        spec_id TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT,
        status TEXT NOT NULL,
        created_by_json TEXT NOT NULL,
        answered_by_json TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (spec_id) REFERENCES specifications(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS specification_plans (
        id TEXT PRIMARY KEY,
        spec_id TEXT NOT NULL,
        version_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        open_clarification_ids_json TEXT NOT NULL,
        generated_by_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (spec_id) REFERENCES specifications(id) ON DELETE CASCADE,
        FOREIGN KEY (version_id) REFERENCES specification_versions(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS subtasks (
        id TEXT PRIMARY KEY,
        parent_session_id TEXT,
        child_session_id TEXT,
        spec_id TEXT,
        spec_task_id TEXT,
        room_id TEXT,
        assigned_agent_id TEXT,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        risk TEXT NOT NULL,
        execution_mode TEXT NOT NULL,
        created_by_json TEXT NOT NULL,
        result_summary TEXT,
        artifact_refs_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS task_assignments (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        session_id TEXT,
        subtask_id TEXT,
        worker_id TEXT NOT NULL,
        project_id TEXT,
        room_id TEXT,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        attempts INTEGER NOT NULL,
        lease_owner_id TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        assigned_by_json TEXT NOT NULL,
        result_summary TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS session_links (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        from_session_id TEXT NOT NULL,
        to_session_id TEXT NOT NULL,
        room_id TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        source_path TEXT,
        name TEXT NOT NULL UNIQUE,
        version TEXT NOT NULL,
        description TEXT NOT NULL,
        permissions_json TEXT NOT NULL,
        tools_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT NOT NULL,
        checksum TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skill_usage_events (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        session_id TEXT,
        actor_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_sources (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        uri TEXT,
        description TEXT,
        trust_level TEXT NOT NULL,
        created_by_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        token_count INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_eval_sets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        scope_type TEXT,
        scope_id TEXT,
        source_id TEXT,
        cases_json TEXT NOT NULL,
        thresholds_json TEXT NOT NULL,
        created_by_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_eval_runs (
        id TEXT PRIMARY KEY,
        eval_set_id TEXT,
        scope_type TEXT,
        scope_id TEXT,
        source_id TEXT,
        case_count INTEGER NOT NULL,
        run_limit INTEGER NOT NULL,
        metrics_json TEXT NOT NULL,
        gate_json TEXT NOT NULL,
        cases_json TEXT NOT NULL,
        enforce_access INTEGER NOT NULL,
        safety_mode TEXT NOT NULL,
        artifact_id TEXT,
        created_by_json TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (eval_set_id) REFERENCES knowledge_eval_sets(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_session_id TEXT,
        confidence REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT
      );

      CREATE TABLE IF NOT EXISTS session_summaries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_file_changes_session ON file_changes(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_retention_policies_name ON retention_policies(name);
      CREATE INDEX IF NOT EXISTS idx_capability_grants_subject ON capability_grants(subject_type, subject_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_capability_grants_scope ON capability_grants(scope_type, scope_id, capability);
      CREATE INDEX IF NOT EXISTS idx_approvals_status_created ON approval_requests(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_pending_tool_calls_approval ON pending_tool_calls(approval_id);
      CREATE INDEX IF NOT EXISTS idx_agent_heartbeat_nonces_seen ON agent_heartbeat_nonces(first_seen_at);
      CREATE INDEX IF NOT EXISTS idx_workers_status_heartbeat ON worker_registrations(status, last_heartbeat_at);
      CREATE INDEX IF NOT EXISTS idx_workers_agent ON worker_registrations(agent_id, last_heartbeat_at);
      CREATE INDEX IF NOT EXISTS idx_workers_machine ON worker_registrations(machine_id, last_heartbeat_at);
      CREATE INDEX IF NOT EXISTS idx_worker_heartbeat_nonces_worker ON worker_heartbeat_nonces(worker_id, first_seen_at);
      CREATE INDEX IF NOT EXISTS idx_task_lease_nonces_assignment ON task_lease_nonces(assignment_id, first_seen_at);
      CREATE INDEX IF NOT EXISTS idx_task_lease_nonces_worker ON task_lease_nonces(worker_id, first_seen_at);
      CREATE INDEX IF NOT EXISTS idx_room_delivery_ack_nonces_room ON room_delivery_ack_nonces(room_id, first_seen_at);
      CREATE INDEX IF NOT EXISTS idx_room_invites_room ON room_invites(room_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_room_invites_token_hash ON room_invites(token_hash);
      CREATE INDEX IF NOT EXISTS idx_room_messages_room ON room_messages(room_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_artifacts_scope ON artifacts(project_id, session_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_artifacts_status ON artifacts(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_specifications_scope ON specifications(project_id, room_id, status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_specifications_org ON specifications(org_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_specification_tasks_spec ON specification_tasks(spec_id, task_order);
      CREATE INDEX IF NOT EXISTS idx_specification_tasks_status ON specification_tasks(spec_id, status);
      CREATE INDEX IF NOT EXISTS idx_specification_verifications_task ON specification_verifications(spec_id, task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_specification_verifications_status ON specification_verifications(spec_id, task_id, status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_specification_versions_unique ON specification_versions(spec_id, version_number);
      CREATE INDEX IF NOT EXISTS idx_specification_versions_spec ON specification_versions(spec_id, version_number);
      CREATE INDEX IF NOT EXISTS idx_specification_clarifications_spec ON specification_clarifications(spec_id, status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_specification_plans_spec ON specification_plans(spec_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_subtasks_parent ON subtasks(parent_session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_task_assignments_worker_status ON task_assignments(worker_id, status, lease_expires_at);
      CREATE INDEX IF NOT EXISTS idx_task_assignments_session ON task_assignments(session_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_task_assignments_subtask ON task_assignments(subtask_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_task_assignments_scope ON task_assignments(project_id, room_id, status);
      CREATE INDEX IF NOT EXISTS idx_session_links_from ON session_links(from_session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_session_links_to ON session_links(to_session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_knowledge_sources_scope ON knowledge_sources(scope_type, scope_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_knowledge_sources_kind ON knowledge_sources(kind, updated_at);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_scope ON knowledge_chunks(scope_type, scope_id, source_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source ON knowledge_chunks(source_id, ordinal);
      CREATE INDEX IF NOT EXISTS idx_knowledge_eval_sets_scope ON knowledge_eval_sets(scope_type, scope_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_knowledge_eval_sets_source ON knowledge_eval_sets(source_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_knowledge_eval_runs_eval_set ON knowledge_eval_runs(eval_set_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_knowledge_eval_runs_scope ON knowledge_eval_runs(scope_type, scope_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope_type, scope_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_session ON session_summaries(session_id, created_at);
    `);
    this.addColumnIfMissing("sessions", "target_mode", "TEXT NOT NULL DEFAULT 'build'");
    this.addColumnIfMissing("pending_tool_calls", "tool_call_id", "TEXT");
    this.addColumnIfMissing("subtasks", "spec_id", "TEXT");
    this.addColumnIfMissing("subtasks", "spec_task_id", "TEXT");
    this.addColumnIfMissing("room_messages", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
    this.addColumnIfMissing("room_messages", "routing_json", "TEXT");
    this.addColumnIfMissing("room_members", "aliases_json", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumnIfMissing("room_invites", "envelope_json", "TEXT");
    this.addColumnIfMissing("room_delivery_cursors", "last_ack_envelope_json", "TEXT");
    this.addColumnIfMissing("agents", "heartbeat_status", "TEXT");
    this.addColumnIfMissing("agents", "last_heartbeat_at", "TEXT");
    this.addColumnIfMissing("agents", "heartbeat_expires_at", "TEXT");
    this.addColumnIfMissing("agents", "last_room_id", "TEXT");
    this.addColumnIfMissing("agents", "last_error", "TEXT");
    this.addColumnIfMissing("agents", "heartbeat_metadata_json", "TEXT NOT NULL DEFAULT '{}'");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_agents_heartbeat ON agents(heartbeat_status, last_heartbeat_at)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_subtasks_spec_task ON subtasks(spec_task_id, created_at)");
  }

  private addColumnIfMissing(tableName: string, columnName: string, columnType: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!rows.some((row) => row.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
    }
  }
}

type ApprovalRow = {
  id: string;
  status: ApprovalStatus;
  requested_by_json: string;
  action: ApprovalRequest["action"];
  reason: string;
  approver_hint: ApprovalRequest["approverHint"] | null;
  org_id: string | null;
  project_id: string | null;
  room_id: string | null;
  session_id: string | null;
  tool_name: string | null;
  input_summary: string | null;
  decision_by_json: string | null;
  decision_reason: string | null;
  created_at: string;
  decided_at: string | null;
  expires_at: string | null;
};

type FileChangeRow = {
  id: string;
  session_id: string | null;
  actor_json: string;
  kind: FileChange["kind"];
  path: string;
  before_hash: string | null;
  after_hash: string | null;
  summary: string;
  created_at: string;
};

type KnowledgeSourceRow = {
  id: string;
  scope_type: KnowledgeSource["scopeType"];
  scope_id: string;
  kind: KnowledgeSource["kind"];
  name: string;
  uri: string | null;
  description: string | null;
  trust_level: KnowledgeSource["trustLevel"];
  created_by_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type KnowledgeChunkRow = {
  id: string;
  source_id: string;
  scope_type: KnowledgeChunk["scopeType"];
  scope_id: string;
  content: string;
  summary: string;
  ordinal: number;
  token_count: number;
  content_hash: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type KnowledgeEvalSetRow = {
  id: string;
  name: string;
  description: string | null;
  scope_type: KnowledgeEvalSet["scopeType"] | null;
  scope_id: string | null;
  source_id: string | null;
  cases_json: string;
  thresholds_json: string;
  created_by_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type KnowledgeEvalRunRow = {
  id: string;
  eval_set_id: string | null;
  scope_type: KnowledgeEvalRun["scopeType"] | null;
  scope_id: string | null;
  source_id: string | null;
  case_count: number;
  run_limit: number;
  metrics_json: string;
  gate_json: string;
  cases_json: string;
  enforce_access: number;
  safety_mode: string;
  artifact_id: string | null;
  created_by_json: string | null;
  metadata_json: string;
  created_at: string;
};

type AuditRow = {
  id: string;
  type: AuditEvent["type"];
  actor_json: string;
  org_id: string | null;
  project_id: string | null;
  session_id: string | null;
  room_id: string | null;
  summary: string;
  metadata_json: string;
  artifact_refs_json: string;
  created_at: string;
};

type OrganizationRow = {
  id: string;
  name: string;
  status: Organization["status"];
  created_at: string;
};

type ProjectRow = {
  id: string;
  org_id: string;
  name: string;
  status: Project["status"];
  default_role: Project["defaultRole"] | null;
  retention_policy_id: string | null;
  created_at: string;
};

type RetentionPolicyRow = {
  id: string;
  name: string;
  hot_transcript_days: number;
  artifact_retention_days: number;
  audit_retention_days: number;
  enable_auto_summaries: number;
  allow_user_deletion: number;
  allow_audit_export: number;
};

type CapabilityGrantRow = {
  subject_type: CapabilityGrant["subjectType"];
  subject_id: string;
  scope_type: CapabilityGrant["scopeType"];
  scope_id: string;
  capability: string;
  granted_by: string;
  created_at: string;
  expires_at: string | null;
};

type PendingToolCallRow = {
  id: string;
  approval_id: string;
  tool_call_id: string | null;
  session_id: string | null;
  tool_name: string;
  input_json: string;
  requested_by_json: string;
  status: PendingToolCallStatus;
  result_json: string | null;
  created_at: string;
  updated_at: string;
};

type AgentRow = {
  id: string;
  machine_id: string;
  org_id: string | null;
  display_name: string;
  public_key_pem: string;
  fingerprint: string;
  capabilities_json: string;
  allowed_projects_json: string;
  trust_status: AgentIdentity["trustStatus"];
  created_at: string;
  last_seen_at: string | null;
  heartbeat_status: AgentIdentity["heartbeatStatus"] | null;
  last_heartbeat_at: string | null;
  heartbeat_expires_at: string | null;
  last_room_id: string | null;
  last_error: string | null;
  heartbeat_metadata_json: string | null;
};

type AgentHeartbeatNonceRow = {
  agent_id: string;
  nonce: string;
  envelope_hash: string;
  first_seen_at: string;
  expires_at: string | null;
};

type WorkerRegistrationRow = {
  id: string;
  agent_id: string;
  machine_id: string;
  org_id: string | null;
  display_name: string;
  endpoint: string | null;
  capabilities_json: string;
  allowed_projects_json: string;
  status: WorkerRegistration["status"];
  current_load: number;
  max_concurrent_tasks: number;
  metadata_json: string;
  registered_at: string;
  last_heartbeat_at: string;
  expires_at: string | null;
};

type WorkerHeartbeatNonceRow = {
  agent_id: string;
  nonce: string;
  worker_id: string;
  envelope_hash: string;
  first_seen_at: string;
  expires_at: string | null;
};

type TaskLeaseNonceRow = {
  claimed_by_id: string;
  nonce: string;
  assignment_id: string;
  worker_id: string;
  envelope_hash: string;
  first_seen_at: string;
  expires_at: string | null;
};

type RoomDeliveryAckNonceRow = {
  agent_id: string;
  nonce: string;
  room_id: string;
  message_id: string;
  envelope_hash: string;
  first_seen_at: string;
  expires_at: string | null;
};

function agentFromRow(row: AgentRow): AgentIdentity {
  return {
    id: row.id as AgentIdentity["id"],
    machineId: row.machine_id as AgentIdentity["machineId"],
    orgId: row.org_id as AgentIdentity["orgId"],
    displayName: row.display_name,
    publicKeyPem: row.public_key_pem,
    fingerprint: row.fingerprint,
    capabilities: JSON.parse(row.capabilities_json) as string[],
    allowedProjects: JSON.parse(row.allowed_projects_json) as AgentIdentity["allowedProjects"],
    trustStatus: row.trust_status,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at ?? undefined,
    heartbeatStatus: row.heartbeat_status ?? undefined,
    lastHeartbeatAt: row.last_heartbeat_at ?? undefined,
    heartbeatExpiresAt: row.heartbeat_expires_at ?? undefined,
    lastRoomId: row.last_room_id ? row.last_room_id as AgentIdentity["lastRoomId"] : undefined,
    lastError: row.last_error ?? undefined,
    heartbeatMetadata: row.heartbeat_metadata_json ? JSON.parse(row.heartbeat_metadata_json) as Record<string, unknown> : undefined,
  };
}

function agentHeartbeatNonceFromRow(row: AgentHeartbeatNonceRow): AgentHeartbeatNonce {
  return {
    agentId: row.agent_id as AgentHeartbeatNonce["agentId"],
    nonce: row.nonce,
    envelopeHash: row.envelope_hash,
    firstSeenAt: row.first_seen_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

function workerRegistrationFromRow(row: WorkerRegistrationRow): WorkerRegistration {
  return {
    id: row.id as WorkerRegistration["id"],
    agentId: row.agent_id as WorkerRegistration["agentId"],
    machineId: row.machine_id as WorkerRegistration["machineId"],
    orgId: row.org_id as WorkerRegistration["orgId"],
    displayName: row.display_name,
    endpoint: row.endpoint ?? undefined,
    capabilities: JSON.parse(row.capabilities_json) as string[],
    allowedProjects: JSON.parse(row.allowed_projects_json) as WorkerRegistration["allowedProjects"],
    status: row.status,
    currentLoad: row.current_load,
    maxConcurrentTasks: row.max_concurrent_tasks,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    registeredAt: row.registered_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

function workerHeartbeatNonceFromRow(row: WorkerHeartbeatNonceRow): WorkerHeartbeatNonce {
  return {
    agentId: row.agent_id as WorkerHeartbeatNonce["agentId"],
    nonce: row.nonce,
    workerId: row.worker_id as WorkerHeartbeatNonce["workerId"],
    envelopeHash: row.envelope_hash,
    firstSeenAt: row.first_seen_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

function taskLeaseNonceFromRow(row: TaskLeaseNonceRow): TaskLeaseNonce {
  return {
    claimedById: row.claimed_by_id,
    nonce: row.nonce,
    assignmentId: row.assignment_id as TaskLeaseNonce["assignmentId"],
    workerId: row.worker_id as TaskLeaseNonce["workerId"],
    envelopeHash: row.envelope_hash,
    firstSeenAt: row.first_seen_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

function roomDeliveryAckNonceFromRow(row: RoomDeliveryAckNonceRow): RoomDeliveryAckNonce {
  return {
    agentId: row.agent_id,
    nonce: row.nonce,
    roomId: row.room_id as RoomDeliveryAckNonce["roomId"],
    messageId: row.message_id,
    envelopeHash: row.envelope_hash,
    firstSeenAt: row.first_seen_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

type RoomRow = {
  id: string;
  project_id: string | null;
  name: string;
  policy_json: string;
  created_by_json: string;
  created_at: string;
  closed_at: string | null;
};

type RoomInviteRow = {
  id: string;
  room_id: string;
  token_hash: string;
  created_by_json: string;
  role: RoomInvite["role"];
  status: RoomInvite["status"];
  max_uses: number;
  uses: number;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  envelope_json: string | null;
};

type RoomMemberRow = {
  room_id: string;
  actor_json: string;
  aliases_json: string | null;
  role: RoomMember["role"];
  status: RoomMember["status"];
  joined_at: string | null;
  expires_at: string | null;
};

type RoomMessageRow = {
  id: string;
  room_id: string;
  sender_json: string;
  kind: RoomMessage["kind"];
  body: string;
  signature: string | null;
  created_at: string;
  parent_message_id: string | null;
  artifact_refs_json: string;
  routing_json: string | null;
  metadata_json: string;
};

type RoomDeliveryCursorRow = {
  room_id: string;
  agent_id: string;
  last_delivered_message_id: string | null;
  last_ack_envelope_json: string | null;
  updated_at: string;
  updated_by_json: string;
};

type ArtifactRow = {
  id: string;
  kind: ArtifactRecord["kind"];
  name: string;
  path: string | null;
  uri: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  org_id: string | null;
  project_id: string | null;
  room_id: string | null;
  session_id: string | null;
  created_by_json: string;
  status: ArtifactRecord["status"];
  created_at: string;
  deleted_at: string | null;
  deleted_by_json: string | null;
  metadata_json: string;
};

type SpecificationRow = {
  id: string;
  org_id: string | null;
  project_id: string | null;
  room_id: string | null;
  title: string;
  objective: string;
  status: Specification["status"];
  source: Specification["source"];
  source_path: string | null;
  created_by_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type SpecificationTaskRow = {
  id: string;
  spec_id: string;
  title: string;
  description: string | null;
  status: SpecificationTask["status"];
  parallelizable: number;
  paths_json: string;
  depends_on_json: string;
  verification: string | null;
  task_order: number;
  created_by_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type SpecificationVerificationRow = {
  id: string;
  spec_id: string;
  task_id: string;
  status: SpecificationVerification["status"];
  evidence: string;
  artifact_refs_json: string;
  created_by_json: string;
  metadata_json: string;
  created_at: string;
};

type SpecificationVersionRow = {
  id: string;
  spec_id: string;
  version_number: number;
  title: string;
  objective: string;
  status: SpecificationVersion["status"];
  task_snapshot_json: string;
  reason: string | null;
  created_by_json: string;
  metadata_json: string;
  created_at: string;
};

type SpecificationClarificationRow = {
  id: string;
  spec_id: string;
  question: string;
  answer: string | null;
  status: SpecificationClarification["status"];
  created_by_json: string;
  answered_by_json: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type SpecificationPlanRow = {
  id: string;
  spec_id: string;
  version_id: string | null;
  title: string;
  status: SpecificationPlan["status"];
  summary: string;
  steps_json: string;
  open_clarification_ids_json: string;
  generated_by_json: string;
  metadata_json: string;
  created_at: string;
};

function roomFromRow(row: RoomRow): Room {
  return {
    id: row.id as Room["id"],
    projectId: row.project_id ?? undefined,
    name: row.name,
    policy: JSON.parse(row.policy_json) as Room["policy"],
    createdBy: JSON.parse(row.created_by_json) as Room["createdBy"],
    createdAt: row.created_at,
    closedAt: row.closed_at ?? undefined,
  };
}

function roomInviteFromRow(row: RoomInviteRow): RoomInvite {
  return {
    id: row.id,
    roomId: row.room_id as RoomInvite["roomId"],
    tokenHash: row.token_hash,
    createdBy: JSON.parse(row.created_by_json) as RoomInvite["createdBy"],
    role: row.role,
    status: row.status,
    maxUses: row.max_uses,
    uses: row.uses,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at ?? undefined,
    envelope: row.envelope_json ? JSON.parse(row.envelope_json) as RoomInvite["envelope"] : undefined,
  };
}

function roomMemberFromRow(row: RoomMemberRow): RoomMember {
  return {
    roomId: row.room_id as RoomMember["roomId"],
    actor: JSON.parse(row.actor_json) as RoomMember["actor"],
    aliases: JSON.parse(row.aliases_json ?? "[]") as string[],
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
  };
}

function roomMessageFromRow(row: RoomMessageRow): RoomMessage {
  return {
    id: row.id,
    roomId: row.room_id as RoomMessage["roomId"],
    sender: JSON.parse(row.sender_json) as RoomMessage["sender"],
    kind: row.kind,
    body: row.body,
    signature: row.signature ?? undefined,
    createdAt: row.created_at,
    parentMessageId: row.parent_message_id ?? undefined,
    artifactRefs: JSON.parse(row.artifact_refs_json) as RoomMessage["artifactRefs"],
    routing: row.routing_json ? JSON.parse(row.routing_json) as RoomMessage["routing"] : undefined,
    metadata: JSON.parse(row.metadata_json ?? "{}") as RoomMessage["metadata"],
  };
}

function roomDeliveryCursorFromRow(row: RoomDeliveryCursorRow): RoomDeliveryCursor {
  return {
    roomId: row.room_id as RoomDeliveryCursor["roomId"],
    agentId: row.agent_id,
    lastDeliveredMessageId: row.last_delivered_message_id ?? undefined,
    lastAckEnvelope: row.last_ack_envelope_json ? JSON.parse(row.last_ack_envelope_json) as RoomDeliveryCursor["lastAckEnvelope"] : undefined,
    updatedAt: row.updated_at,
    updatedBy: JSON.parse(row.updated_by_json) as RoomDeliveryCursor["updatedBy"],
  };
}

function pendingToolCallFromRow(row: PendingToolCallRow): PendingToolCall {
  return {
    id: row.id,
    approvalId: row.approval_id,
    toolCallId: row.tool_call_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    toolName: row.tool_name,
    input: JSON.parse(row.input_json) as PendingToolCall["input"],
    requestedBy: JSON.parse(row.requested_by_json) as PendingToolCall["requestedBy"],
    status: row.status,
    resultJson: row.result_json ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fileChangeFromRow(row: FileChangeRow): FileChange {
  return {
    id: row.id,
    sessionId: row.session_id ?? undefined,
    actor: JSON.parse(row.actor_json) as FileChange["actor"],
    kind: row.kind,
    path: row.path,
    beforeHash: row.before_hash ?? undefined,
    afterHash: row.after_hash ?? undefined,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function auditFromRow(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    type: row.type,
    actor: JSON.parse(row.actor_json) as AuditEvent["actor"],
    orgId: row.org_id ?? undefined,
    projectId: row.project_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    roomId: row.room_id ?? undefined,
    summary: row.summary,
    metadata: JSON.parse(row.metadata_json) as AuditEvent["metadata"],
    artifactRefs: JSON.parse(row.artifact_refs_json) as AuditEvent["artifactRefs"],
    createdAt: row.created_at,
  };
}

function knowledgeSourceFromRow(row: KnowledgeSourceRow): KnowledgeSource {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    kind: row.kind,
    name: row.name,
    uri: row.uri ?? undefined,
    description: row.description ?? undefined,
    trustLevel: row.trust_level,
    createdBy: JSON.parse(row.created_by_json) as KnowledgeSource["createdBy"],
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function knowledgeChunkFromRow(row: KnowledgeChunkRow): KnowledgeChunk {
  return {
    id: row.id,
    sourceId: row.source_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    content: row.content,
    summary: row.summary,
    ordinal: row.ordinal,
    tokenCount: row.token_count,
    contentHash: row.content_hash,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function knowledgeEvalSetFromRow(row: KnowledgeEvalSetRow): KnowledgeEvalSet {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    scopeType: row.scope_type ?? undefined,
    scopeId: row.scope_id ?? undefined,
    sourceId: row.source_id ?? undefined,
    cases: JSON.parse(row.cases_json) as KnowledgeEvalSet["cases"],
    thresholds: JSON.parse(row.thresholds_json) as KnowledgeEvalSet["thresholds"],
    createdBy: JSON.parse(row.created_by_json) as KnowledgeEvalSet["createdBy"],
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function knowledgeEvalRunFromRow(row: KnowledgeEvalRunRow): KnowledgeEvalRun {
  return {
    id: row.id,
    evalSetId: row.eval_set_id ?? undefined,
    scopeType: row.scope_type ?? undefined,
    scopeId: row.scope_id ?? undefined,
    sourceId: row.source_id ?? undefined,
    caseCount: row.case_count,
    limit: row.run_limit,
    metrics: JSON.parse(row.metrics_json) as KnowledgeEvalRun["metrics"],
    gate: JSON.parse(row.gate_json) as KnowledgeEvalRun["gate"],
    cases: JSON.parse(row.cases_json) as KnowledgeEvalRun["cases"],
    enforceAccess: Boolean(row.enforce_access),
    safetyMode: row.safety_mode,
    artifactId: row.artifact_id ?? undefined,
    createdBy: row.created_by_json ? (JSON.parse(row.created_by_json) as KnowledgeEvalRun["createdBy"]) : undefined,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

function organizationFromRow(row: OrganizationRow): Organization {
  return {
    id: row.id as Organization["id"],
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
  };
}

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id as Project["id"],
    orgId: row.org_id as Project["orgId"],
    name: row.name,
    status: row.status,
    defaultRole: row.default_role ?? undefined,
    retentionPolicyId: row.retention_policy_id ?? undefined,
    createdAt: row.created_at,
  };
}

function retentionPolicyFromRow(row: RetentionPolicyRow): RetentionPolicy {
  return {
    id: row.id,
    name: row.name,
    hotTranscriptDays: row.hot_transcript_days,
    artifactRetentionDays: row.artifact_retention_days,
    auditRetentionDays: row.audit_retention_days,
    enableAutoSummaries: row.enable_auto_summaries === 1,
    allowUserDeletion: row.allow_user_deletion === 1,
    allowAuditExport: row.allow_audit_export === 1,
  };
}

function capabilityGrantFromRow(row: CapabilityGrantRow): CapabilityGrant {
  return {
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    capability: row.capability,
    grantedBy: row.granted_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

function artifactFromRow(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    path: row.path ?? undefined,
    uri: row.uri ?? undefined,
    mimeType: row.mime_type ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    sha256: row.sha256 ?? undefined,
    orgId: row.org_id ?? undefined,
    projectId: row.project_id ?? undefined,
    roomId: row.room_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    createdBy: JSON.parse(row.created_by_json) as ArtifactRecord["createdBy"],
    status: row.status,
    createdAt: row.created_at,
    deletedAt: row.deleted_at ?? undefined,
    deletedBy: row.deleted_by_json ? (JSON.parse(row.deleted_by_json) as ArtifactRecord["deletedBy"]) : undefined,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  };
}

function specificationFromRow(row: SpecificationRow): Specification {
  return {
    id: row.id as Specification["id"],
    orgId: row.org_id ?? undefined,
    projectId: row.project_id ?? undefined,
    roomId: row.room_id ?? undefined,
    title: row.title,
    objective: row.objective,
    status: row.status,
    source: row.source,
    sourcePath: row.source_path ?? undefined,
    createdBy: JSON.parse(row.created_by_json) as Specification["createdBy"],
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function specificationTaskFromRow(row: SpecificationTaskRow): SpecificationTask {
  return {
    id: row.id as SpecificationTask["id"],
    specId: row.spec_id as SpecificationTask["specId"],
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    parallelizable: Boolean(row.parallelizable),
    paths: JSON.parse(row.paths_json) as string[],
    dependsOn: JSON.parse(row.depends_on_json) as SpecificationTask["dependsOn"],
    verification: row.verification ?? undefined,
    order: row.task_order,
    createdBy: JSON.parse(row.created_by_json) as SpecificationTask["createdBy"],
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function specificationVerificationFromRow(row: SpecificationVerificationRow): SpecificationVerification {
  return {
    id: row.id as SpecificationVerification["id"],
    specId: row.spec_id as SpecificationVerification["specId"],
    taskId: row.task_id as SpecificationVerification["taskId"],
    status: row.status,
    evidence: row.evidence,
    artifactRefs: JSON.parse(row.artifact_refs_json) as string[],
    createdBy: JSON.parse(row.created_by_json) as SpecificationVerification["createdBy"],
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

function specificationVersionFromRow(row: SpecificationVersionRow): SpecificationVersion {
  return {
    id: row.id as SpecificationVersion["id"],
    specId: row.spec_id as SpecificationVersion["specId"],
    version: row.version_number,
    title: row.title,
    objective: row.objective,
    status: row.status,
    taskSnapshot: JSON.parse(row.task_snapshot_json) as SpecificationVersion["taskSnapshot"],
    reason: row.reason ?? undefined,
    createdBy: JSON.parse(row.created_by_json) as SpecificationVersion["createdBy"],
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

function specificationClarificationFromRow(row: SpecificationClarificationRow): SpecificationClarification {
  return {
    id: row.id as SpecificationClarification["id"],
    specId: row.spec_id as SpecificationClarification["specId"],
    question: row.question,
    answer: row.answer ?? undefined,
    status: row.status,
    createdBy: JSON.parse(row.created_by_json) as SpecificationClarification["createdBy"],
    answeredBy: row.answered_by_json ? (JSON.parse(row.answered_by_json) as SpecificationClarification["answeredBy"]) : undefined,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function specificationPlanFromRow(row: SpecificationPlanRow): SpecificationPlan {
  return {
    id: row.id as SpecificationPlan["id"],
    specId: row.spec_id as SpecificationPlan["specId"],
    versionId: (row.version_id ?? undefined) as SpecificationPlan["versionId"],
    title: row.title,
    status: row.status,
    summary: row.summary,
    steps: JSON.parse(row.steps_json) as SpecificationPlan["steps"],
    openClarificationIds: JSON.parse(row.open_clarification_ids_json) as SpecificationPlan["openClarificationIds"],
    generatedBy: JSON.parse(row.generated_by_json) as SpecificationPlan["generatedBy"],
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

function approvalFromRow(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    status: row.status,
    requestedBy: JSON.parse(row.requested_by_json) as ApprovalRequest["requestedBy"],
    action: row.action,
    reason: row.reason,
    approverHint: row.approver_hint ?? undefined,
    orgId: row.org_id ?? undefined,
    projectId: row.project_id ?? undefined,
    roomId: row.room_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    toolName: row.tool_name ?? undefined,
    inputSummary: row.input_summary ?? undefined,
    decisionBy: row.decision_by_json ? (JSON.parse(row.decision_by_json) as ApprovalRequest["decisionBy"]) : undefined,
    decisionReason: row.decision_reason ?? undefined,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
  };
}

type SubtaskRow = {
  id: string;
  parent_session_id: string | null;
  child_session_id: string | null;
  spec_id: string | null;
  spec_task_id: string | null;
  room_id: string | null;
  assigned_agent_id: string | null;
  objective: string;
  status: Subtask["status"];
  risk: Subtask["risk"];
  execution_mode: Subtask["executionMode"];
  created_by_json: string;
  result_summary: string | null;
  artifact_refs_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type TaskAssignmentRow = {
  id: string;
  kind: TaskAssignment["kind"];
  session_id: string | null;
  subtask_id: string | null;
  worker_id: string;
  project_id: string | null;
  room_id: string | null;
  status: TaskAssignment["status"];
  priority: number;
  attempts: number;
  lease_owner_id: string;
  lease_expires_at: string;
  assigned_by_json: string;
  result_summary: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type SessionLinkRow = {
  id: string;
  type: SessionLink["type"];
  from_session_id: string;
  to_session_id: string;
  room_id: string | null;
  metadata_json: string;
  created_at: string;
};

function subtaskFromRow(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    parentSessionId: row.parent_session_id as Subtask["parentSessionId"],
    childSessionId: row.child_session_id as Subtask["childSessionId"],
    specId: (row.spec_id ?? undefined) as Subtask["specId"],
    specTaskId: (row.spec_task_id ?? undefined) as Subtask["specTaskId"],
    roomId: row.room_id ?? undefined,
    assignedAgentId: row.assigned_agent_id ?? undefined,
    objective: row.objective,
    status: row.status,
    risk: row.risk,
    executionMode: row.execution_mode,
    createdBy: JSON.parse(row.created_by_json) as Subtask["createdBy"],
    resultSummary: row.result_summary ?? undefined,
    artifactRefs: JSON.parse(row.artifact_refs_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function taskAssignmentFromRow(row: TaskAssignmentRow): TaskAssignment {
  return {
    id: row.id as TaskAssignment["id"],
    kind: row.kind,
    sessionId: (row.session_id ?? undefined) as TaskAssignment["sessionId"],
    subtaskId: (row.subtask_id ?? undefined) as TaskAssignment["subtaskId"],
    workerId: row.worker_id as TaskAssignment["workerId"],
    projectId: (row.project_id ?? undefined) as TaskAssignment["projectId"],
    roomId: (row.room_id ?? undefined) as TaskAssignment["roomId"],
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    leaseOwnerId: row.lease_owner_id,
    leaseExpiresAt: row.lease_expires_at,
    assignedBy: JSON.parse(row.assigned_by_json) as TaskAssignment["assignedBy"],
    resultSummary: row.result_summary ?? undefined,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function sessionLinkFromRow(row: SessionLinkRow): SessionLink {
  return {
    id: row.id,
    type: row.type,
    fromSessionId: row.from_session_id as SessionLink["fromSessionId"],
    toSessionId: row.to_session_id as SessionLink["toSessionId"],
    roomId: row.room_id ?? undefined,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

type SkillRow = {
  id: string;
  scope: Skill["scope"];
  source_path: string | null;
  name: string;
  version: string;
  description: string;
  permissions_json: string;
  tools_json: string;
  summary: string;
  body: string;
  checksum: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryRow = {
  id: string;
  scope_type: MemoryRecord["scopeType"];
  scope_id: string;
  kind: MemoryRecord["kind"];
  content: string;
  summary: string;
  source_session_id: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  last_used_at: string | null;
};

type SessionSummaryRow = {
  id: string;
  session_id: string;
  summary: string;
  created_at: string;
};

function skillFromRow(row: SkillRow): Skill {
  return {
    id: row.id,
    scope: row.scope,
    sourcePath: row.source_path ?? undefined,
    manifest: {
      name: row.name,
      version: row.version,
      description: row.description,
      permissions: JSON.parse(row.permissions_json) as string[],
      tools: JSON.parse(row.tools_json) as string[],
    },
    summary: row.summary,
    body: row.body,
    checksum: row.checksum ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function memoryFromRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    kind: row.kind,
    content: row.content,
    summary: row.summary,
    sourceSessionId: row.source_session_id ?? undefined,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at ?? undefined,
    lastUsedAt: row.last_used_at ?? undefined,
  };
}

function sessionSummaryFromRow(row: SessionSummaryRow): SessionSummary {
  return {
    id: row.id,
    sessionId: row.session_id,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

type SessionRow = {
  id: string;
  org_id: string | null;
  project_id: string | null;
  room_id: string | null;
  objective: string;
  target_mode: Session["targetMode"] | null;
  status: Session["status"];
  risk: Session["risk"];
  created_by_json: string;
  created_at: string;
  updated_at: string;
};

function sessionFromRow(row: SessionRow): Session {
  return {
    id: row.id as Session["id"],
    orgId: row.org_id ?? undefined,
    projectId: row.project_id ?? undefined,
    roomId: row.room_id ?? undefined,
    objective: row.objective,
    targetMode: row.target_mode ?? "build",
    status: row.status,
    risk: row.risk,
    createdBy: JSON.parse(row.created_by_json) as Session["createdBy"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
