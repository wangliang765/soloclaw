import type {
  ActorRef,
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
  Room,
  RoomDeliveryAckNonce,
  RoomDeliveryCursor,
  RoomInvite,
  RoomMember,
  RoomMessage,
  RoomMessageIntentNonce,
  Organization,
  Project,
  RetentionPolicy,
  Session,
  SessionLink,
  Skill,
  SkillUsageEvent,
  MemoryCandidate,
  MemoryRecord,
  MemoryReviewStatus,
  MemorySnapshotRecord,
  MemoryScope,
  MemorySource,
  MemoryUsageEvent,
  SessionTodo,
  PendingToolCall,
  PendingToolCallStatus,
  SessionSummary,
  Specification,
  SpecificationClarification,
  SpecificationPlan,
  SpecificationTask,
  SpecificationVerification,
  SpecificationVersion,
  Subtask,
  TaskAssignment,
  TaskAssignmentStatus,
  TaskLeaseNonce,
  WorkerRegistration,
  WorkerStatus,
  WorkerHeartbeatNonce,
} from "../domain/index.js";
import type { AgentMessage, ToolResult } from "../protocol/types.js";

export type CreateSessionInput = Omit<Session, "id" | "createdAt" | "updatedAt" | "targetMode"> & {
  targetMode?: Session["targetMode"];
};
export type AppendMessageInput = {
  sessionId: string;
  message: AgentMessage;
};
export type RecordToolCallInput = {
  sessionId: string;
  result: ToolResult;
};

export type DecideApprovalInput = {
  approvalId: string;
  status: Extract<ApprovalStatus, "approved" | "denied">;
  decidedBy: ActorRef;
  decisionReason?: string;
};

export type ListAuditEventsInput = {
  limit?: number;
  type?: AuditEvent["type"];
  actorId?: string;
  sessionId?: string;
  roomId?: string;
  projectId?: string;
  from?: string;
  to?: string;
};

export type ListArtifactsInput = {
  status?: ArtifactRecord["status"];
  orgId?: string;
  projectId?: string;
  roomId?: string;
  sessionId?: string;
  kind?: ArtifactRecord["kind"];
  limit?: number;
};

export type ListWorkersInput = {
  status?: WorkerStatus;
  agentId?: string;
  machineId?: string;
  orgId?: string;
  projectId?: string;
  limit?: number;
};

export type WorkerHeartbeatInput = {
  workerId: string;
  status?: WorkerStatus;
  currentLoad?: number;
  maxConcurrentTasks?: number;
  metadata?: Record<string, unknown>;
  ttlSeconds?: number;
};

export type RecordWorkerHeartbeatNonceInput = WorkerHeartbeatNonce;
export type RecordAgentHeartbeatNonceInput = AgentHeartbeatNonce;
export type RecordTaskLeaseNonceInput = TaskLeaseNonce;
export type RecordRoomDeliveryAckNonceInput = RoomDeliveryAckNonce;
export type RecordRoomMessageIntentNonceInput = RoomMessageIntentNonce;

export type ListTaskAssignmentsInput = {
  status?: TaskAssignmentStatus;
  workerId?: string;
  sessionId?: string;
  subtaskId?: string;
  projectId?: string;
  roomId?: string;
  limit?: number;
};

export type ListSpecificationsInput = {
  orgId?: string;
  projectId?: string;
  roomId?: string;
  status?: Specification["status"];
  limit?: number;
};

export type ListSpecificationVerificationsInput = {
  specId: string;
  taskId?: string;
  status?: SpecificationVerification["status"];
  limit?: number;
};

export type ListSpecificationVersionsInput = {
  specId: string;
  limit?: number;
};

export type ListSpecificationClarificationsInput = {
  specId: string;
  status?: SpecificationClarification["status"];
  limit?: number;
};

export type ListSpecificationPlansInput = {
  specId: string;
  status?: SpecificationPlan["status"];
  limit?: number;
};

export type ListKnowledgeEvalSetsInput = {
  scopeType?: KnowledgeEvalSet["scopeType"];
  scopeId?: string;
  sourceId?: string;
  limit?: number;
};

export type ListKnowledgeEvalRunsInput = {
  evalSetId?: string;
  scopeType?: KnowledgeEvalRun["scopeType"];
  scopeId?: string;
  sourceId?: string;
  limit?: number;
};

export type ListGoalRunsInput = {
  status?: GoalRun["status"];
  limit?: number;
};

export type ListMemoryCandidatesInput = {
  scopeType?: MemoryScope;
  scopeId?: string;
  status?: MemoryReviewStatus;
  sourceSessionId?: string;
  sourceSummaryId?: string;
  limit?: number;
};

export type CompactSessionResult = {
  sessionId: string;
  messagesDeleted: number;
  toolCallsDeleted: number;
};

export interface AgentStore {
  createSession(input: CreateSessionInput): Promise<Session>;
  getSession(sessionId: string): Promise<Session | undefined>;
  listSessions(limit?: number): Promise<Session[]>;
  getMessages(sessionId: string): Promise<AgentMessage[]>;
  getToolResults(sessionId: string): Promise<ToolResult[]>;
  replaceSessionTodos(sessionId: string, todos: SessionTodo[]): Promise<void>;
  listSessionTodos(sessionId: string): Promise<SessionTodo[]>;
  updateSessionStatus(sessionId: string, status: Session["status"]): Promise<void>;
  appendMessage(input: AppendMessageInput): Promise<void>;
  recordToolCall(input: RecordToolCallInput): Promise<void>;
  recordFileChange(change: FileChange): Promise<void>;
  listFileChanges(sessionId?: string): Promise<FileChange[]>;
  createGoalRun(goal: GoalRun): Promise<void>;
  updateGoalRun(goal: GoalRun): Promise<void>;
  getGoalRun(goalId: string): Promise<GoalRun | undefined>;
  getGoalRunBySession(sessionId: string): Promise<GoalRun | undefined>;
  listGoalRuns(input?: ListGoalRunsInput): Promise<GoalRun[]>;
  addGoalCheckpoint(checkpoint: GoalCheckpoint): Promise<void>;
  listGoalCheckpoints(goalId: string, limit?: number): Promise<GoalCheckpoint[]>;
  createKnowledgeSource(source: KnowledgeSource): Promise<void>;
  getKnowledgeSource(sourceId: string): Promise<KnowledgeSource | undefined>;
  listKnowledgeSources(input?: { scopeType?: KnowledgeSource["scopeType"]; scopeId?: string; kind?: KnowledgeSource["kind"]; limit?: number }): Promise<KnowledgeSource[]>;
  upsertKnowledgeChunk(chunk: KnowledgeChunk): Promise<void>;
  listKnowledgeChunks(input?: { scopeType?: KnowledgeChunk["scopeType"]; scopeId?: string; sourceId?: string; limit?: number }): Promise<KnowledgeChunk[]>;
  createKnowledgeEvalSet(evalSet: KnowledgeEvalSet): Promise<void>;
  getKnowledgeEvalSet(evalSetId: string): Promise<KnowledgeEvalSet | undefined>;
  listKnowledgeEvalSets(input?: ListKnowledgeEvalSetsInput): Promise<KnowledgeEvalSet[]>;
  createKnowledgeEvalRun(run: KnowledgeEvalRun): Promise<void>;
  getKnowledgeEvalRun(runId: string): Promise<KnowledgeEvalRun | undefined>;
  listKnowledgeEvalRuns(input?: ListKnowledgeEvalRunsInput): Promise<KnowledgeEvalRun[]>;
  createApprovalRequest(request: ApprovalRequest): Promise<void>;
  listApprovalRequests(status?: ApprovalStatus): Promise<ApprovalRequest[]>;
  decideApproval(input: DecideApprovalInput): Promise<ApprovalRequest | undefined>;
  createPendingToolCall(call: PendingToolCall): Promise<void>;
  getPendingToolCallByApproval(approvalId: string): Promise<PendingToolCall | undefined>;
  updatePendingToolCallStatus(id: string, status: PendingToolCallStatus, resultJson?: string): Promise<void>;
  recordAuditEvent(event: AuditEvent): Promise<void>;
  listAuditEvents(input?: ListAuditEventsInput): Promise<AuditEvent[]>;
  createOrganization(org: Organization): Promise<void>;
  getOrganization(orgId: string): Promise<Organization | undefined>;
  listOrganizations(limit?: number): Promise<Organization[]>;
  createProject(project: Project): Promise<void>;
  getProject(projectId: string): Promise<Project | undefined>;
  listProjects(orgId?: string, limit?: number): Promise<Project[]>;
  setProjectRetentionPolicy(projectId: string, retentionPolicyId: string): Promise<Project | undefined>;
  createRetentionPolicy(policy: RetentionPolicy): Promise<void>;
  getRetentionPolicy(policyId: string): Promise<RetentionPolicy | undefined>;
  listRetentionPolicies(limit?: number): Promise<RetentionPolicy[]>;
  grantCapability(grant: CapabilityGrant): Promise<void>;
  listCapabilityGrants(input?: { subjectType?: CapabilityGrant["subjectType"]; subjectId?: string; scopeType?: CapabilityGrant["scopeType"]; scopeId?: string }): Promise<CapabilityGrant[]>;
  registerAgent(agent: AgentIdentity): Promise<void>;
  getAgent(agentId: string): Promise<AgentIdentity | undefined>;
  listAgents(limit?: number): Promise<AgentIdentity[]>;
  updateAgentHeartbeat(agent: AgentIdentity): Promise<AgentIdentity | undefined>;
  recordAgentHeartbeatNonce(input: RecordAgentHeartbeatNonceInput): Promise<boolean>;
  getAgentHeartbeatNonce(agentId: string, nonce: string): Promise<AgentHeartbeatNonce | undefined>;
  deleteAgentHeartbeatNoncesBefore(input: { before: string; limit?: number }): Promise<number>;
  upsertWorkerRegistration(worker: WorkerRegistration): Promise<void>;
  getWorkerRegistration(workerId: string): Promise<WorkerRegistration | undefined>;
  listWorkerRegistrations(input?: ListWorkersInput): Promise<WorkerRegistration[]>;
  updateWorkerHeartbeat(input: WorkerHeartbeatInput): Promise<WorkerRegistration | undefined>;
  recordWorkerHeartbeatNonce(input: RecordWorkerHeartbeatNonceInput): Promise<boolean>;
  getWorkerHeartbeatNonce(agentId: string, nonce: string): Promise<WorkerHeartbeatNonce | undefined>;
  deleteWorkerHeartbeatNoncesBefore(input: { before: string; limit?: number }): Promise<number>;
  recordTaskLeaseNonce(input: RecordTaskLeaseNonceInput): Promise<boolean>;
  getTaskLeaseNonce(claimedById: string, nonce: string): Promise<TaskLeaseNonce | undefined>;
  deleteTaskLeaseNoncesBefore(input: { before: string; limit?: number }): Promise<number>;
  recordRoomDeliveryAckNonce(input: RecordRoomDeliveryAckNonceInput): Promise<boolean>;
  getRoomDeliveryAckNonce(agentId: string, nonce: string): Promise<RoomDeliveryAckNonce | undefined>;
  deleteRoomDeliveryAckNoncesBefore(input: { before: string; limit?: number }): Promise<number>;
  recordRoomMessageIntentNonce(input: RecordRoomMessageIntentNonceInput): Promise<boolean>;
  getRoomMessageIntentNonce(agentId: string, nonce: string): Promise<RoomMessageIntentNonce | undefined>;
  deleteRoomMessageIntentNoncesBefore(input: { before: string; limit?: number }): Promise<number>;
  createRoom(room: Room): Promise<void>;
  getRoom(roomId: string): Promise<Room | undefined>;
  listRooms(limit?: number): Promise<Room[]>;
  createRoomInvite(invite: RoomInvite): Promise<void>;
  getRoomInviteByTokenHash(tokenHash: string): Promise<RoomInvite | undefined>;
  listRoomInvites(roomId: string): Promise<RoomInvite[]>;
  updateRoomInvite(invite: RoomInvite): Promise<void>;
  addRoomMember(member: RoomMember): Promise<void>;
  updateRoomMember(member: RoomMember): Promise<void>;
  listRoomMembers(roomId: string): Promise<RoomMember[]>;
  appendRoomMessage(message: RoomMessage): Promise<void>;
  listRoomMessages(roomId: string, limit?: number): Promise<RoomMessage[]>;
  getRoomDeliveryCursor(roomId: string, agentId: string): Promise<RoomDeliveryCursor | undefined>;
  upsertRoomDeliveryCursor(cursor: RoomDeliveryCursor): Promise<void>;
  createArtifact(artifact: ArtifactRecord): Promise<void>;
  getArtifact(artifactId: string): Promise<ArtifactRecord | undefined>;
  listArtifacts(input?: ListArtifactsInput): Promise<ArtifactRecord[]>;
  markArtifactDeleted(artifactId: string, actor: ActorRef): Promise<ArtifactRecord | undefined>;
  createSpecification(specification: Specification): Promise<void>;
  getSpecification(specId: string): Promise<Specification | undefined>;
  listSpecifications(input?: ListSpecificationsInput): Promise<Specification[]>;
  createSpecificationTask(task: SpecificationTask): Promise<void>;
  updateSpecificationTask(task: SpecificationTask): Promise<void>;
  listSpecificationTasks(specId: string): Promise<SpecificationTask[]>;
  createSpecificationVerification(verification: SpecificationVerification): Promise<void>;
  listSpecificationVerifications(input: ListSpecificationVerificationsInput): Promise<SpecificationVerification[]>;
  createSpecificationVersion(version: SpecificationVersion): Promise<void>;
  listSpecificationVersions(input: ListSpecificationVersionsInput): Promise<SpecificationVersion[]>;
  createSpecificationClarification(clarification: SpecificationClarification): Promise<void>;
  updateSpecificationClarification(clarification: SpecificationClarification): Promise<void>;
  listSpecificationClarifications(input: ListSpecificationClarificationsInput): Promise<SpecificationClarification[]>;
  createSpecificationPlan(plan: SpecificationPlan): Promise<void>;
  listSpecificationPlans(input: ListSpecificationPlansInput): Promise<SpecificationPlan[]>;
  createSubtask(subtask: Subtask): Promise<void>;
  updateSubtask(subtask: Subtask): Promise<void>;
  listSubtasks(parentSessionId?: string): Promise<Subtask[]>;
  createTaskAssignment(assignment: TaskAssignment): Promise<void>;
  getTaskAssignment(assignmentId: string): Promise<TaskAssignment | undefined>;
  updateTaskAssignment(assignment: TaskAssignment): Promise<void>;
  listTaskAssignments(input?: ListTaskAssignmentsInput): Promise<TaskAssignment[]>;
  createSessionLink(link: SessionLink): Promise<void>;
  listSessionLinks(sessionId: string): Promise<SessionLink[]>;
  upsertSkill(skill: Skill): Promise<void>;
  listSkills(): Promise<Skill[]>;
  getSkill(name: string): Promise<Skill | undefined>;
  recordSkillUsage(event: SkillUsageEvent): Promise<void>;
  addMemory(memory: MemoryRecord): Promise<void>;
  listMemories(scopeType?: MemoryScope, scopeId?: string): Promise<MemoryRecord[]>;
  deleteMemory(memoryId: string): Promise<boolean>;
  createMemoryCandidate(candidate: MemoryCandidate): Promise<void>;
  updateMemoryCandidate(candidate: MemoryCandidate): Promise<void>;
  getMemoryCandidate(candidateId: string): Promise<MemoryCandidate | undefined>;
  listMemoryCandidates(input?: ListMemoryCandidatesInput): Promise<MemoryCandidate[]>;
  createMemorySource(source: MemorySource): Promise<void>;
  listMemorySources(memoryId: string): Promise<MemorySource[]>;
  recordMemoryUsage(event: MemoryUsageEvent): Promise<void>;
  listMemoryUsageEvents(memoryId: string): Promise<MemoryUsageEvent[]>;
  touchMemory(memoryId: string, lastUsedAt: string): Promise<boolean>;
  upsertMemorySnapshot(snapshot: MemorySnapshotRecord): Promise<void>;
  getMemorySnapshot(scopeType: MemoryScope, scopeId: string, filePath: string): Promise<MemorySnapshotRecord | undefined>;
  addSessionSummary(summary: SessionSummary): Promise<void>;
  getSessionSummaries(sessionId: string): Promise<SessionSummary[]>;
  compactSession(sessionId: string, summary: SessionSummary): Promise<CompactSessionResult>;
  deleteSession(sessionId: string): Promise<boolean>;
  deleteAuditEventsBefore(input: { projectId?: string; before: string }): Promise<number>;
  close?(): void;
}
