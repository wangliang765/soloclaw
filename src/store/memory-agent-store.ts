import type {
  AgentHeartbeatNonce,
  AgentIdentity,
  ApprovalRequest,
  ApprovalStatus,
  ArtifactRecord,
  AuditEvent,
  CapabilityGrant,
  FileChange,
  GoalCheckpoint,
  GoalRun,
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
  Room,
  RoomDeliveryAckNonce,
  RoomDeliveryCursor,
  RoomInvite,
  RoomMember,
  RoomMessage,
  RoomMessageIntentNonce,
  RetentionPolicy,
  Session,
  SessionLink,
  SessionTodo,
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
import type { AgentStore, AppendMessageInput, CreateSessionInput, RecordToolCallInput } from "./agent-store.js";

export class MemoryAgentStore implements AgentStore {
  readonly sessions = new Map<string, Session>();
  readonly messages = new Map<string, AgentMessage[]>();
  readonly toolResults = new Map<string, ToolResult[]>();
  readonly sessionTodos = new Map<string, SessionTodo[]>();
  readonly auditEvents: AuditEvent[] = [];
  readonly organizations = new Map<string, Organization>();
  readonly projects = new Map<string, Project>();
  readonly retentionPolicies = new Map<string, RetentionPolicy>();
  readonly capabilityGrants: CapabilityGrant[] = [];
  readonly artifacts = new Map<string, ArtifactRecord>();
  readonly fileChanges: FileChange[] = [];
  readonly goalRuns = new Map<string, GoalRun>();
  readonly goalCheckpoints = new Map<string, GoalCheckpoint[]>();
  readonly knowledgeSources = new Map<string, KnowledgeSource>();
  readonly knowledgeChunks = new Map<string, KnowledgeChunk>();
  readonly knowledgeEvalSets = new Map<string, KnowledgeEvalSet>();
  readonly knowledgeEvalRuns = new Map<string, KnowledgeEvalRun>();
  readonly approvals = new Map<string, ApprovalRequest>();
  readonly pendingToolCalls = new Map<string, PendingToolCall>();
  readonly agents = new Map<string, AgentIdentity>();
  readonly agentHeartbeatNonces = new Map<string, AgentHeartbeatNonce>();
  readonly workers = new Map<string, WorkerRegistration>();
  readonly workerHeartbeatNonces = new Map<string, WorkerHeartbeatNonce>();
  readonly taskLeaseNonces = new Map<string, TaskLeaseNonce>();
  readonly roomDeliveryAckNonces = new Map<string, RoomDeliveryAckNonce>();
  readonly roomMessageIntentNonces = new Map<string, RoomMessageIntentNonce>();
  readonly rooms = new Map<string, Room>();
  readonly roomMembers = new Map<string, RoomMember[]>();
  readonly roomMessages = new Map<string, RoomMessage[]>();
  readonly roomDeliveryCursors = new Map<string, RoomDeliveryCursor>();
  readonly roomInvites = new Map<string, RoomInvite>();
  readonly specifications = new Map<string, Specification>();
  readonly specificationTasks = new Map<string, SpecificationTask>();
  readonly specificationVerifications = new Map<string, SpecificationVerification>();
  readonly specificationVersions = new Map<string, SpecificationVersion>();
  readonly specificationClarifications = new Map<string, SpecificationClarification>();
  readonly specificationPlans = new Map<string, SpecificationPlan>();
  readonly subtasks = new Map<string, Subtask>();
  readonly taskAssignments = new Map<string, TaskAssignment>();
  readonly sessionLinks: SessionLink[] = [];
  readonly skills = new Map<string, Skill>();
  readonly skillUsage: SkillUsageEvent[] = [];
  readonly memories = new Map<string, MemoryRecord>();
  readonly sessionSummaries = new Map<string, SessionSummary[]>();

  async createSession(input: CreateSessionInput): Promise<Session> {
    const now = new Date().toISOString();
    const session: Session = {
      ...input,
      targetMode: input.targetMode ?? "build",
      id: makeId<"SessionId">("sess"),
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    this.messages.set(session.id, []);
    this.toolResults.set(session.id, []);
    return session;
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    return this.sessions.get(sessionId);
  }

  async listSessions(limit = 20): Promise<Session[]> {
    return [...this.sessions.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async getMessages(sessionId: string): Promise<AgentMessage[]> {
    return [...(this.messages.get(sessionId) ?? [])];
  }

  async getToolResults(sessionId: string): Promise<ToolResult[]> {
    return [...(this.toolResults.get(sessionId) ?? [])];
  }

  async replaceSessionTodos(sessionId: string, todos: SessionTodo[]): Promise<void> {
    this.sessionTodos.set(sessionId, todos.map((todo) => ({ ...todo })));
  }

  async listSessionTodos(sessionId: string): Promise<SessionTodo[]> {
    return (this.sessionTodos.get(sessionId) ?? []).map((todo) => ({ ...todo }));
  }

  async updateSessionStatus(sessionId: string, status: Session["status"]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, { ...session, status, updatedAt: new Date().toISOString() });
    }
  }

  async appendMessage(input: AppendMessageInput): Promise<void> {
    const messages = this.messages.get(input.sessionId) ?? [];
    messages.push(input.message);
    this.messages.set(input.sessionId, messages);
  }

  async recordToolCall(input: RecordToolCallInput): Promise<void> {
    const results = this.toolResults.get(input.sessionId) ?? [];
    results.push(input.result);
    this.toolResults.set(input.sessionId, results);
  }

  async recordFileChange(change: FileChange): Promise<void> {
    this.fileChanges.push(change);
  }

  async listFileChanges(sessionId?: string): Promise<FileChange[]> {
    return this.fileChanges
      .filter((change) => !sessionId || change.sessionId === sessionId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createGoalRun(goal: GoalRun): Promise<void> {
    this.goalRuns.set(goal.id, goal);
  }

  async updateGoalRun(goal: GoalRun): Promise<void> {
    this.goalRuns.set(goal.id, goal);
  }

  async getGoalRun(goalId: string): Promise<GoalRun | undefined> {
    return this.goalRuns.get(goalId);
  }

  async getGoalRunBySession(sessionId: string): Promise<GoalRun | undefined> {
    return [...this.goalRuns.values()].find((goal) => goal.sessionId === sessionId);
  }

  async listGoalRuns(input: import("./agent-store.js").ListGoalRunsInput = {}): Promise<GoalRun[]> {
    return [...this.goalRuns.values()]
      .filter((goal) => !input.status || goal.status === input.status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit ?? 50);
  }

  async addGoalCheckpoint(checkpoint: GoalCheckpoint): Promise<void> {
    const checkpoints = this.goalCheckpoints.get(checkpoint.goalId) ?? [];
    checkpoints.push(checkpoint);
    this.goalCheckpoints.set(checkpoint.goalId, checkpoints);
  }

  async listGoalCheckpoints(goalId: string, limit = 50): Promise<GoalCheckpoint[]> {
    return [...(this.goalCheckpoints.get(goalId) ?? [])]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async createKnowledgeSource(source: KnowledgeSource): Promise<void> {
    this.knowledgeSources.set(source.id, source);
  }

  async getKnowledgeSource(sourceId: string): Promise<KnowledgeSource | undefined> {
    return this.knowledgeSources.get(sourceId);
  }

  async listKnowledgeSources(input: { scopeType?: KnowledgeSource["scopeType"]; scopeId?: string; kind?: KnowledgeSource["kind"]; limit?: number } = {}): Promise<KnowledgeSource[]> {
    return [...this.knowledgeSources.values()]
      .filter((source) => !input.scopeType || source.scopeType === input.scopeType)
      .filter((source) => !input.scopeId || source.scopeId === input.scopeId)
      .filter((source) => !input.kind || source.kind === input.kind)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit ?? 100);
  }

  async upsertKnowledgeChunk(chunk: KnowledgeChunk): Promise<void> {
    this.knowledgeChunks.set(chunk.id, chunk);
  }

  async listKnowledgeChunks(input: { scopeType?: KnowledgeChunk["scopeType"]; scopeId?: string; sourceId?: string; limit?: number } = {}): Promise<KnowledgeChunk[]> {
    return [...this.knowledgeChunks.values()]
      .filter((chunk) => !input.scopeType || chunk.scopeType === input.scopeType)
      .filter((chunk) => !input.scopeId || chunk.scopeId === input.scopeId)
      .filter((chunk) => !input.sourceId || chunk.sourceId === input.sourceId)
      .sort((left, right) => left.ordinal - right.ordinal)
      .slice(0, input.limit ?? 1000);
  }

  async createKnowledgeEvalSet(evalSet: KnowledgeEvalSet): Promise<void> {
    this.knowledgeEvalSets.set(evalSet.id, evalSet);
  }

  async getKnowledgeEvalSet(evalSetId: string): Promise<KnowledgeEvalSet | undefined> {
    return this.knowledgeEvalSets.get(evalSetId);
  }

  async listKnowledgeEvalSets(input: import("./agent-store.js").ListKnowledgeEvalSetsInput = {}): Promise<KnowledgeEvalSet[]> {
    return [...this.knowledgeEvalSets.values()]
      .filter((evalSet) => !input.scopeType || evalSet.scopeType === input.scopeType)
      .filter((evalSet) => !input.scopeId || evalSet.scopeId === input.scopeId)
      .filter((evalSet) => !input.sourceId || evalSet.sourceId === input.sourceId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit ?? 100);
  }

  async createKnowledgeEvalRun(run: KnowledgeEvalRun): Promise<void> {
    this.knowledgeEvalRuns.set(run.id, run);
  }

  async getKnowledgeEvalRun(runId: string): Promise<KnowledgeEvalRun | undefined> {
    return this.knowledgeEvalRuns.get(runId);
  }

  async listKnowledgeEvalRuns(input: import("./agent-store.js").ListKnowledgeEvalRunsInput = {}): Promise<KnowledgeEvalRun[]> {
    return [...this.knowledgeEvalRuns.values()]
      .filter((run) => !input.evalSetId || run.evalSetId === input.evalSetId)
      .filter((run) => !input.scopeType || run.scopeType === input.scopeType)
      .filter((run) => !input.scopeId || run.scopeId === input.scopeId)
      .filter((run) => !input.sourceId || run.sourceId === input.sourceId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit ?? 100);
  }

  async createApprovalRequest(request: ApprovalRequest): Promise<void> {
    this.approvals.set(request.id, request);
  }

  async listApprovalRequests(status?: ApprovalStatus): Promise<ApprovalRequest[]> {
    return [...this.approvals.values()]
      .filter((request) => !status || request.status === status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async decideApproval(input: import("./agent-store.js").DecideApprovalInput): Promise<ApprovalRequest | undefined> {
    const request = this.approvals.get(input.approvalId);
    if (!request) {
      return undefined;
    }
    const decided: ApprovalRequest = {
      ...request,
      status: input.status,
      decisionBy: input.decidedBy,
      decisionReason: input.decisionReason,
      decidedAt: new Date().toISOString(),
    };
    this.approvals.set(input.approvalId, decided);
    const pending = [...this.pendingToolCalls.values()].find((call) => call.approvalId === input.approvalId);
    if (pending) {
      this.pendingToolCalls.set(pending.id, {
        ...pending,
        status: input.status === "approved" ? "approved" : "denied",
        updatedAt: new Date().toISOString(),
      });
    }
    return decided;
  }

  async createPendingToolCall(call: PendingToolCall): Promise<void> {
    this.pendingToolCalls.set(call.id, call);
  }

  async getPendingToolCallByApproval(approvalId: string): Promise<PendingToolCall | undefined> {
    return [...this.pendingToolCalls.values()].find((call) => call.approvalId === approvalId);
  }

  async updatePendingToolCallStatus(id: string, status: PendingToolCallStatus, resultJson?: string): Promise<void> {
    const call = this.pendingToolCalls.get(id);
    if (!call) {
      return;
    }
    this.pendingToolCalls.set(id, {
      ...call,
      status,
      resultJson,
      updatedAt: new Date().toISOString(),
    });
  }

  async recordAuditEvent(event: AuditEvent): Promise<void> {
    this.auditEvents.push(event);
  }

  async listAuditEvents(input: import("./agent-store.js").ListAuditEventsInput = {}): Promise<AuditEvent[]> {
    const limit = input.limit ?? 100;
    return this.auditEvents
      .filter((event) => !input.type || event.type === input.type)
      .filter((event) => !input.actorId || event.actor.id === input.actorId)
      .filter((event) => !input.sessionId || event.sessionId === input.sessionId)
      .filter((event) => !input.roomId || event.roomId === input.roomId)
      .filter((event) => !input.projectId || event.projectId === input.projectId)
      .filter((event) => !input.from || event.createdAt >= input.from)
      .filter((event) => !input.to || event.createdAt <= input.to)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async createOrganization(org: Organization): Promise<void> {
    this.organizations.set(org.id, org);
  }

  async getOrganization(orgId: string): Promise<Organization | undefined> {
    return this.organizations.get(orgId);
  }

  async listOrganizations(limit = 50): Promise<Organization[]> {
    return [...this.organizations.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async createProject(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    return this.projects.get(projectId);
  }

  async listProjects(orgId?: string, limit = 50): Promise<Project[]> {
    return [...this.projects.values()]
      .filter((project) => !orgId || project.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async setProjectRetentionPolicy(projectId: string, retentionPolicyId: string): Promise<Project | undefined> {
    const project = this.projects.get(projectId);
    if (!project) {
      return undefined;
    }
    const next = { ...project, retentionPolicyId };
    this.projects.set(projectId, next);
    return next;
  }

  async createRetentionPolicy(policy: RetentionPolicy): Promise<void> {
    this.retentionPolicies.set(policy.id, policy);
  }

  async getRetentionPolicy(policyId: string): Promise<RetentionPolicy | undefined> {
    return this.retentionPolicies.get(policyId);
  }

  async listRetentionPolicies(limit = 50): Promise<RetentionPolicy[]> {
    return [...this.retentionPolicies.values()].slice(0, limit);
  }

  async grantCapability(grant: CapabilityGrant): Promise<void> {
    this.capabilityGrants.push(grant);
  }

  async listCapabilityGrants(input: {
    subjectType?: CapabilityGrant["subjectType"];
    subjectId?: string;
    scopeType?: CapabilityGrant["scopeType"];
    scopeId?: string;
  } = {}): Promise<CapabilityGrant[]> {
    const now = new Date().toISOString();
    return this.capabilityGrants
      .filter((grant) => !grant.expiresAt || grant.expiresAt > now)
      .filter((grant) => !input.subjectType || grant.subjectType === input.subjectType)
      .filter((grant) => !input.subjectId || grant.subjectId === input.subjectId)
      .filter((grant) => !input.scopeType || grant.scopeType === input.scopeType)
      .filter((grant) => !input.scopeId || grant.scopeId === input.scopeId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async registerAgent(agent: AgentIdentity): Promise<void> {
    this.agents.set(agent.id, agent);
  }

  async getAgent(agentId: string): Promise<AgentIdentity | undefined> {
    return this.agents.get(agentId);
  }

  async listAgents(limit = 20): Promise<AgentIdentity[]> {
    return [...this.agents.values()]
      .sort((left, right) => (right.lastSeenAt ?? right.createdAt).localeCompare(left.lastSeenAt ?? left.createdAt))
      .slice(0, limit);
  }

  async updateAgentHeartbeat(agent: AgentIdentity): Promise<AgentIdentity | undefined> {
    if (!this.agents.has(agent.id)) {
      return undefined;
    }
    this.agents.set(agent.id, agent);
    return agent;
  }

  async recordAgentHeartbeatNonce(input: import("./agent-store.js").RecordAgentHeartbeatNonceInput): Promise<boolean> {
    const key = agentHeartbeatNonceKey(input.agentId, input.nonce);
    if (this.agentHeartbeatNonces.has(key)) {
      return false;
    }
    this.agentHeartbeatNonces.set(key, input);
    return true;
  }

  async getAgentHeartbeatNonce(agentId: string, nonce: string): Promise<AgentHeartbeatNonce | undefined> {
    return this.agentHeartbeatNonces.get(agentHeartbeatNonceKey(agentId, nonce));
  }

  async deleteAgentHeartbeatNoncesBefore(input: { before: string; limit?: number }): Promise<number> {
    const expired = [...this.agentHeartbeatNonces.entries()]
      .filter(([, nonce]) => Boolean(nonce.expiresAt) && nonce.expiresAt! <= input.before)
      .sort((left, right) => (left[1].expiresAt ?? "").localeCompare(right[1].expiresAt ?? ""))
      .slice(0, input.limit ?? Number.POSITIVE_INFINITY);
    for (const [key] of expired) {
      this.agentHeartbeatNonces.delete(key);
    }
    return expired.length;
  }

  async upsertWorkerRegistration(worker: WorkerRegistration): Promise<void> {
    this.workers.set(worker.id, worker);
  }

  async getWorkerRegistration(workerId: string): Promise<WorkerRegistration | undefined> {
    return this.workers.get(workerId);
  }

  async listWorkerRegistrations(input: import("./agent-store.js").ListWorkersInput = {}): Promise<WorkerRegistration[]> {
    return [...this.workers.values()]
      .filter((worker) => !input.status || worker.status === input.status)
      .filter((worker) => !input.agentId || worker.agentId === input.agentId)
      .filter((worker) => !input.machineId || worker.machineId === input.machineId)
      .filter((worker) => !input.orgId || worker.orgId === input.orgId)
      .filter((worker) => !input.projectId || worker.allowedProjects.includes(input.projectId as WorkerRegistration["allowedProjects"][number]))
      .sort((left, right) => right.lastHeartbeatAt.localeCompare(left.lastHeartbeatAt))
      .slice(0, input.limit ?? 20);
  }

  async updateWorkerHeartbeat(input: import("./agent-store.js").WorkerHeartbeatInput): Promise<WorkerRegistration | undefined> {
    const worker = this.workers.get(input.workerId);
    if (!worker) {
      return undefined;
    }
    const now = new Date();
    const updated: WorkerRegistration = {
      ...worker,
      status: input.status ?? worker.status,
      currentLoad: input.currentLoad ?? worker.currentLoad,
      maxConcurrentTasks: input.maxConcurrentTasks ?? worker.maxConcurrentTasks,
      metadata: input.metadata ?? worker.metadata,
      lastHeartbeatAt: now.toISOString(),
      expiresAt: input.ttlSeconds ? new Date(now.getTime() + input.ttlSeconds * 1000).toISOString() : worker.expiresAt,
    };
    this.workers.set(input.workerId, updated);
    return updated;
  }

  async recordWorkerHeartbeatNonce(input: import("./agent-store.js").RecordWorkerHeartbeatNonceInput): Promise<boolean> {
    const key = workerHeartbeatNonceKey(input.agentId, input.nonce);
    if (this.workerHeartbeatNonces.has(key)) {
      return false;
    }
    this.workerHeartbeatNonces.set(key, input);
    return true;
  }

  async getWorkerHeartbeatNonce(agentId: string, nonce: string): Promise<WorkerHeartbeatNonce | undefined> {
    return this.workerHeartbeatNonces.get(workerHeartbeatNonceKey(agentId, nonce));
  }

  async deleteWorkerHeartbeatNoncesBefore(input: { before: string; limit?: number }): Promise<number> {
    const expired = [...this.workerHeartbeatNonces.entries()]
      .filter(([, nonce]) => Boolean(nonce.expiresAt) && nonce.expiresAt! <= input.before)
      .sort((left, right) => (left[1].expiresAt ?? "").localeCompare(right[1].expiresAt ?? ""))
      .slice(0, input.limit ?? Number.POSITIVE_INFINITY);
    for (const [key] of expired) {
      this.workerHeartbeatNonces.delete(key);
    }
    return expired.length;
  }

  async recordTaskLeaseNonce(input: import("./agent-store.js").RecordTaskLeaseNonceInput): Promise<boolean> {
    const key = taskLeaseNonceKey(input.claimedById, input.nonce);
    if (this.taskLeaseNonces.has(key)) {
      return false;
    }
    this.taskLeaseNonces.set(key, input);
    return true;
  }

  async getTaskLeaseNonce(claimedById: string, nonce: string): Promise<TaskLeaseNonce | undefined> {
    return this.taskLeaseNonces.get(taskLeaseNonceKey(claimedById, nonce));
  }

  async deleteTaskLeaseNoncesBefore(input: { before: string; limit?: number }): Promise<number> {
    const expired = [...this.taskLeaseNonces.entries()]
      .filter(([, nonce]) => Boolean(nonce.expiresAt) && nonce.expiresAt! <= input.before)
      .sort((left, right) => (left[1].expiresAt ?? "").localeCompare(right[1].expiresAt ?? ""))
      .slice(0, input.limit ?? Number.POSITIVE_INFINITY);
    for (const [key] of expired) {
      this.taskLeaseNonces.delete(key);
    }
    return expired.length;
  }

  async recordRoomDeliveryAckNonce(input: import("./agent-store.js").RecordRoomDeliveryAckNonceInput): Promise<boolean> {
    const key = roomDeliveryAckNonceKey(input.agentId, input.nonce);
    if (this.roomDeliveryAckNonces.has(key)) {
      return false;
    }
    this.roomDeliveryAckNonces.set(key, input);
    return true;
  }

  async getRoomDeliveryAckNonce(agentId: string, nonce: string): Promise<RoomDeliveryAckNonce | undefined> {
    return this.roomDeliveryAckNonces.get(roomDeliveryAckNonceKey(agentId, nonce));
  }

  async deleteRoomDeliveryAckNoncesBefore(input: { before: string; limit?: number }): Promise<number> {
    const expired = [...this.roomDeliveryAckNonces.entries()]
      .filter(([, nonce]) => Boolean(nonce.expiresAt) && nonce.expiresAt! <= input.before)
      .slice(0, input.limit ?? Number.POSITIVE_INFINITY);
    for (const [key] of expired) {
      this.roomDeliveryAckNonces.delete(key);
    }
    return expired.length;
  }

  async recordRoomMessageIntentNonce(input: import("./agent-store.js").RecordRoomMessageIntentNonceInput): Promise<boolean> {
    const key = roomMessageIntentNonceKey(input.agentId, input.nonce);
    if (this.roomMessageIntentNonces.has(key)) {
      return false;
    }
    this.roomMessageIntentNonces.set(key, input);
    return true;
  }

  async getRoomMessageIntentNonce(agentId: string, nonce: string): Promise<RoomMessageIntentNonce | undefined> {
    return this.roomMessageIntentNonces.get(roomMessageIntentNonceKey(agentId, nonce));
  }

  async deleteRoomMessageIntentNoncesBefore(input: { before: string; limit?: number }): Promise<number> {
    const expired = [...this.roomMessageIntentNonces.entries()]
      .filter(([, nonce]) => Boolean(nonce.expiresAt) && nonce.expiresAt! <= input.before)
      .slice(0, input.limit ?? Number.POSITIVE_INFINITY);
    for (const [key] of expired) {
      this.roomMessageIntentNonces.delete(key);
    }
    return expired.length;
  }

  async createRoom(room: Room): Promise<void> {
    this.rooms.set(room.id, room);
  }

  async getRoom(roomId: string): Promise<Room | undefined> {
    return this.rooms.get(roomId);
  }

  async listRooms(limit = 20): Promise<Room[]> {
    return [...this.rooms.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async createRoomInvite(invite: RoomInvite): Promise<void> {
    this.roomInvites.set(invite.id, invite);
  }

  async getRoomInviteByTokenHash(tokenHash: string): Promise<RoomInvite | undefined> {
    return [...this.roomInvites.values()].find((invite) => invite.tokenHash === tokenHash);
  }

  async listRoomInvites(roomId: string): Promise<RoomInvite[]> {
    return [...this.roomInvites.values()]
      .filter((invite) => invite.roomId === roomId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async updateRoomInvite(invite: RoomInvite): Promise<void> {
    this.roomInvites.set(invite.id, invite);
  }

  async addRoomMember(member: RoomMember): Promise<void> {
    const members = this.roomMembers.get(member.roomId) ?? [];
    members.push(member);
    this.roomMembers.set(member.roomId, members);
  }

  async updateRoomMember(member: RoomMember): Promise<void> {
    const members = this.roomMembers.get(member.roomId) ?? [];
    const next = members.some((candidate) => candidate.actor.id === member.actor.id)
      ? members.map((candidate) => (candidate.actor.id === member.actor.id ? member : candidate))
      : [...members, member];
    this.roomMembers.set(member.roomId, next);
  }

  async listRoomMembers(roomId: string): Promise<RoomMember[]> {
    return [...(this.roomMembers.get(roomId) ?? [])];
  }

  async appendRoomMessage(message: RoomMessage): Promise<void> {
    const messages = this.roomMessages.get(message.roomId) ?? [];
    messages.push(message);
    this.roomMessages.set(message.roomId, messages);
  }

  async listRoomMessages(roomId: string, limit = 50): Promise<RoomMessage[]> {
    return [...(this.roomMessages.get(roomId) ?? [])]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-limit);
  }

  async getRoomDeliveryCursor(roomId: string, agentId: string): Promise<RoomDeliveryCursor | undefined> {
    return this.roomDeliveryCursors.get(roomDeliveryCursorKey(roomId, agentId));
  }

  async upsertRoomDeliveryCursor(cursor: RoomDeliveryCursor): Promise<void> {
    this.roomDeliveryCursors.set(roomDeliveryCursorKey(cursor.roomId, cursor.agentId), cursor);
  }

  async createArtifact(artifact: ArtifactRecord): Promise<void> {
    this.artifacts.set(artifact.id, artifact);
  }

  async getArtifact(artifactId: string): Promise<ArtifactRecord | undefined> {
    return this.artifacts.get(artifactId);
  }

  async listArtifacts(input: import("./agent-store.js").ListArtifactsInput = {}): Promise<ArtifactRecord[]> {
    return [...this.artifacts.values()]
      .filter((artifact) => !input.status || artifact.status === input.status)
      .filter((artifact) => !input.orgId || artifact.orgId === input.orgId)
      .filter((artifact) => !input.projectId || artifact.projectId === input.projectId)
      .filter((artifact) => !input.roomId || artifact.roomId === input.roomId)
      .filter((artifact) => !input.sessionId || artifact.sessionId === input.sessionId)
      .filter((artifact) => !input.kind || artifact.kind === input.kind)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit ?? 100);
  }

  async markArtifactDeleted(artifactId: string, actor: import("../domain/index.js").ActorRef): Promise<ArtifactRecord | undefined> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return undefined;
    }
    const deleted: ArtifactRecord = {
      ...artifact,
      status: "deleted",
      deletedAt: new Date().toISOString(),
      deletedBy: actor,
    };
    this.artifacts.set(artifactId, deleted);
    return deleted;
  }

  async createSpecification(specification: Specification): Promise<void> {
    this.specifications.set(specification.id, specification);
  }

  async getSpecification(specId: string): Promise<Specification | undefined> {
    return this.specifications.get(specId);
  }

  async listSpecifications(input: import("./agent-store.js").ListSpecificationsInput = {}): Promise<Specification[]> {
    return [...this.specifications.values()]
      .filter((specification) => !input.orgId || specification.orgId === input.orgId)
      .filter((specification) => !input.projectId || specification.projectId === input.projectId)
      .filter((specification) => !input.roomId || specification.roomId === input.roomId)
      .filter((specification) => !input.status || specification.status === input.status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit ?? 50);
  }

  async createSpecificationTask(task: SpecificationTask): Promise<void> {
    this.specificationTasks.set(task.id, task);
  }

  async updateSpecificationTask(task: SpecificationTask): Promise<void> {
    this.specificationTasks.set(task.id, task);
  }

  async listSpecificationTasks(specId: string): Promise<SpecificationTask[]> {
    return [...this.specificationTasks.values()]
      .filter((task) => task.specId === specId)
      .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));
  }

  async createSpecificationVerification(verification: SpecificationVerification): Promise<void> {
    this.specificationVerifications.set(verification.id, verification);
  }

  async listSpecificationVerifications(input: import("./agent-store.js").ListSpecificationVerificationsInput): Promise<SpecificationVerification[]> {
    return [...this.specificationVerifications.values()]
      .filter((verification) => verification.specId === input.specId)
      .filter((verification) => !input.taskId || verification.taskId === input.taskId)
      .filter((verification) => !input.status || verification.status === input.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit ?? 100);
  }

  async createSpecificationVersion(version: SpecificationVersion): Promise<void> {
    this.specificationVersions.set(version.id, version);
  }

  async listSpecificationVersions(input: import("./agent-store.js").ListSpecificationVersionsInput): Promise<SpecificationVersion[]> {
    return [...this.specificationVersions.values()]
      .filter((version) => version.specId === input.specId)
      .sort((left, right) => right.version - left.version || right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit ?? 50);
  }

  async createSpecificationClarification(clarification: SpecificationClarification): Promise<void> {
    this.specificationClarifications.set(clarification.id, clarification);
  }

  async updateSpecificationClarification(clarification: SpecificationClarification): Promise<void> {
    this.specificationClarifications.set(clarification.id, clarification);
  }

  async listSpecificationClarifications(input: import("./agent-store.js").ListSpecificationClarificationsInput): Promise<SpecificationClarification[]> {
    return [...this.specificationClarifications.values()]
      .filter((clarification) => clarification.specId === input.specId)
      .filter((clarification) => !input.status || clarification.status === input.status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit ?? 100);
  }

  async createSpecificationPlan(plan: SpecificationPlan): Promise<void> {
    this.specificationPlans.set(plan.id, plan);
  }

  async listSpecificationPlans(input: import("./agent-store.js").ListSpecificationPlansInput): Promise<SpecificationPlan[]> {
    return [...this.specificationPlans.values()]
      .filter((plan) => plan.specId === input.specId)
      .filter((plan) => !input.status || plan.status === input.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit ?? 50);
  }

  async createSubtask(subtask: Subtask): Promise<void> {
    this.subtasks.set(subtask.id, subtask);
  }

  async updateSubtask(subtask: Subtask): Promise<void> {
    this.subtasks.set(subtask.id, subtask);
  }

  async listSubtasks(parentSessionId?: string): Promise<Subtask[]> {
    return [...this.subtasks.values()]
      .filter((subtask) => !parentSessionId || subtask.parentSessionId === parentSessionId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createTaskAssignment(assignment: TaskAssignment): Promise<void> {
    this.taskAssignments.set(assignment.id, assignment);
  }

  async getTaskAssignment(assignmentId: string): Promise<TaskAssignment | undefined> {
    return this.taskAssignments.get(assignmentId);
  }

  async updateTaskAssignment(assignment: TaskAssignment): Promise<void> {
    this.taskAssignments.set(assignment.id, assignment);
  }

  async listTaskAssignments(input: import("./agent-store.js").ListTaskAssignmentsInput = {}): Promise<TaskAssignment[]> {
    return [...this.taskAssignments.values()]
      .filter((assignment) => !input.status || assignment.status === input.status)
      .filter((assignment) => !input.workerId || assignment.workerId === input.workerId)
      .filter((assignment) => !input.sessionId || assignment.sessionId === input.sessionId)
      .filter((assignment) => !input.subtaskId || assignment.subtaskId === input.subtaskId)
      .filter((assignment) => !input.projectId || assignment.projectId === input.projectId)
      .filter((assignment) => !input.roomId || assignment.roomId === input.roomId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit ?? 50);
  }

  async createSessionLink(link: SessionLink): Promise<void> {
    this.sessionLinks.push(link);
  }

  async listSessionLinks(sessionId: string): Promise<SessionLink[]> {
    return this.sessionLinks.filter((link) => link.fromSessionId === sessionId || link.toSessionId === sessionId);
  }

  async upsertSkill(skill: Skill): Promise<void> {
    this.skills.set(skill.manifest.name, skill);
  }

  async listSkills(): Promise<Skill[]> {
    return [...this.skills.values()].sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
  }

  async getSkill(name: string): Promise<Skill | undefined> {
    return this.skills.get(name);
  }

  async recordSkillUsage(event: SkillUsageEvent): Promise<void> {
    this.skillUsage.push(event);
  }

  async addMemory(memory: MemoryRecord): Promise<void> {
    this.memories.set(memory.id, memory);
  }

  async listMemories(scopeType?: MemoryScope, scopeId?: string): Promise<MemoryRecord[]> {
    return [...this.memories.values()]
      .filter((memory) => !scopeType || memory.scopeType === scopeType)
      .filter((memory) => !scopeId || memory.scopeId === scopeId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async deleteMemory(memoryId: string): Promise<boolean> {
    return this.memories.delete(memoryId);
  }

  async addSessionSummary(summary: SessionSummary): Promise<void> {
    const summaries = this.sessionSummaries.get(summary.sessionId) ?? [];
    summaries.push(summary);
    this.sessionSummaries.set(summary.sessionId, summaries);
  }

  async getSessionSummaries(sessionId: string): Promise<SessionSummary[]> {
    return [...(this.sessionSummaries.get(sessionId) ?? [])];
  }

  async compactSession(sessionId: string, summary: SessionSummary): Promise<import("./agent-store.js").CompactSessionResult> {
    await this.addSessionSummary(summary);
    const messagesDeleted = this.messages.get(sessionId)?.length ?? 0;
    const toolCallsDeleted = this.toolResults.get(sessionId)?.length ?? 0;
    this.messages.set(sessionId, []);
    this.toolResults.set(sessionId, []);
    return { sessionId, messagesDeleted, toolCallsDeleted };
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const existed = this.sessions.delete(sessionId);
    this.messages.delete(sessionId);
    this.toolResults.delete(sessionId);
    this.sessionTodos.delete(sessionId);
    this.sessionSummaries.delete(sessionId);
    this.pendingToolCalls.forEach((call, id) => {
      if (call.sessionId === sessionId) {
        this.pendingToolCalls.delete(id);
      }
    });
    for (const [id, artifact] of this.artifacts) {
      if (artifact.sessionId === sessionId) {
        this.artifacts.set(id, { ...artifact, status: "deleted", deletedAt: new Date().toISOString() });
      }
    }
    return existed;
  }

  async deleteAuditEventsBefore(input: { projectId?: string; before: string }): Promise<number> {
    const before = this.auditEvents.length;
    const kept = this.auditEvents.filter((event) => {
      if (event.createdAt >= input.before) {
        return true;
      }
      return input.projectId ? event.projectId !== input.projectId : false;
    });
    this.auditEvents.splice(0, this.auditEvents.length, ...kept);
    return before - kept.length;
  }
}

function roomDeliveryCursorKey(roomId: string, agentId: string): string {
  return `${roomId}\0${agentId}`;
}

function workerHeartbeatNonceKey(agentId: string, nonce: string): string {
  return `${agentId}:${nonce}`;
}

function agentHeartbeatNonceKey(agentId: string, nonce: string): string {
  return `${agentId}:${nonce}`;
}

function taskLeaseNonceKey(claimedById: string, nonce: string): string {
  return `${claimedById}:${nonce}`;
}

function roomDeliveryAckNonceKey(agentId: string, nonce: string): string {
  return `${agentId}:${nonce}`;
}

function roomMessageIntentNonceKey(agentId: string, nonce: string): string {
  return `${agentId}:${nonce}`;
}
