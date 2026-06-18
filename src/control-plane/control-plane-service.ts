import type { IncomingMessage } from "node:http";
import { createHash, createPublicKey, randomUUID } from "node:crypto";
import type { ActorRef, AgentHeartbeatEnvelope, AgentHeartbeatStatus, AgentIdentity, ApprovalRequest, ArtifactKind, McpServerRegistration, RoomDeliveryAckEnvelope, RoomMemberStatus, RoomRole, TaskAssignmentStatus, WorkerStatus } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { createLocalPlatform } from "../platform/local-platform.js";
import { buildRoomActivationContext, shouldActorRespondToRoomMessage } from "../rooms/message-routing.js";
import { buildRoomRoster } from "../rooms/room-roster.js";
import type { McpHealthCheckResult } from "../mcp/mcp-health-service.js";
import type { ListArtifactsInput, ListAuditEventsInput, ListTaskAssignmentsInput, ListWorkersInput } from "../store/agent-store.js";
import type { AgentStore } from "../store/agent-store.js";
import { buildOperatorViewModel } from "../operator/operator-view-models.js";
import type { OperatorRowsOptions } from "../operator/operator-rows.js";
import { collectOperatorRows } from "../operator/operator-rows.js";
import { buildOperatorDetail } from "../operator/operator-detail.js";
import { projectOperatorDetail, projectOperatorView, type OperatorProjectionMode } from "../operator/operator-access.js";
import { buildSessionBundleView, buildSessionDashboardView, buildSessionDiffView, buildSessionInspectView, buildSessionNextView, buildSessionReportView, buildSessionResultView, buildSessionReviewView, buildSessionStatusView, buildSessionVerificationView, type SessionBundleOptions, type SessionDashboardOptions, type SessionVerificationOptions } from "../sessions/session-inspection-view.js";
import { buildSessionTimelineView } from "../sessions/session-timeline-view.js";
import { replayApprovedTool } from "../tools/tool-replay.js";
import { createWorkspaceTools } from "../tools/workspace-tools.js";

export type LocalPlatform = Awaited<ReturnType<typeof createLocalPlatform>>;

export type ControlPlaneState = Awaited<ReturnType<ControlPlaneService["getState"]>>;

type CachedMcpHealth = {
  serverUpdatedAt: string;
  result: McpHealthCheckResult;
  expiresAtMs: number;
  consecutiveFailures: number;
};

export class ControlPlaneService {
  private readonly mcpHealthCache = new Map<string, CachedMcpHealth>();

  constructor(private readonly platform: LocalPlatform) {}

  async getHealth() {
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      localAgentId: this.platform.localAgent.id,
    };
  }

  async getState(options: { operatorProjection?: OperatorProjectionMode; operatorActor?: ActorRef } = {}) {
    const rooms = await this.platform.rooms.listRooms(50);
    const roomDetails = await Promise.all(
      rooms.map(async (room) => ({
        room,
        members: await this.platform.rooms.listMembers(room.id),
        messages: await this.platform.rooms.listMessages(room.id, 80),
        invites: await this.listSignedRoomInvites(room.id),
      })),
    );
    const projects = await this.platform.store.listProjects(undefined, 50);
    const artifacts = await this.platform.store.listArtifacts({ status: "active", limit: 30 });
    const retentionPolicies = await this.platform.store.listRetentionPolicies(30);
    const specifications = await this.platform.store.listSpecifications({ limit: 30 });
    const specificationProgress = await Promise.all(
      specifications.map(async (specification) => ({
        specification,
        tasks: await this.platform.store.listSpecificationTasks(specification.id),
        plans: await this.platform.store.listSpecificationPlans({ specId: specification.id, status: "active", limit: 5 }),
        clarifications: await this.platform.store.listSpecificationClarifications({ specId: specification.id, status: "open", limit: 20 }),
      })),
    );
    const workers = await this.platform.workers.list({ limit: 50 });
    const assignments = await this.platform.assignments.list({ limit: 50 });
    const agentHealth = await this.platform.agentHealth.getSummary({ limit: 1000 });
    const workerHealth = await this.platform.workerHealth.getSummary({ limit: 1000 });
    const approvals = (await this.platform.store.listApprovalRequests()).slice(0, 50);
    const sessions = await this.platform.store.listSessions(30);
    const auditEvents = await this.platform.store.listAuditEvents({ limit: 30 });
    const mcpHealth = await this.getOperatorMcpHealth();
    const generatedAt = new Date().toISOString();
    const operator = buildOperatorViewModel({
      generatedAt,
      approvals,
      assignments,
      sessions,
      workerHealth,
      agentHealth,
      specifications: specificationProgress,
      artifacts,
      retentionPolicies,
      auditEvents,
      mcpHealth,
    });
    const operatorProjection = await this.resolveOperatorProjection(options);
    return {
      generatedAt,
      localAgent: {
        id: this.platform.localAgent.id,
        displayName: this.platform.localAgent.displayName,
        fingerprint: this.platform.localAgent.fingerprint,
        trustStatus: this.platform.localAgent.trustStatus,
      },
      organizations: await this.platform.store.listOrganizations(50),
      projects,
      rooms: roomDetails,
      approvals,
      sessions,
      agents: await this.platform.store.listAgents(30),
      agentHealth,
      workers,
      workerHealth,
      assignments,
      operator: projectOperatorView(operator, { mode: operatorProjection }),
      retentionPolicies,
      artifacts,
      specifications: specificationProgress,
      auditEvents,
    };
  }

  async getOperatorDetail(itemId: string, options: { operatorProjection?: OperatorProjectionMode; operatorActor?: ActorRef } = {}) {
    const state = await this.getState();
    const detail = await buildOperatorDetail(itemId, state.operator, {
      getSession: (id) => this.platform.store.getSession(id),
      getSessionMessages: (id) => this.platform.store.getMessages(id),
      getSessionToolResults: (id) => this.platform.store.getToolResults(id),
      getSessionSummaries: (id) => this.platform.store.getSessionSummaries(id),
      getWorker: (id) => this.platform.workers.get(id),
      getAgent: (id) => this.platform.store.getAgent(id),
      getArtifact: (id) => this.platform.store.getArtifact(id),
      getRetentionPolicy: (id) => this.platform.store.getRetentionPolicy(id),
      getRoom: (id) => this.platform.rooms.getRoom(id),
      getAssignment: (id) => this.platform.assignments.get(id),
      getSpecification: (id) => this.platform.store.getSpecification(id),
      getSpecificationTasks: (id) => this.platform.store.listSpecificationTasks(id),
      getSpecificationPlans: (id) => this.platform.store.listSpecificationPlans({ specId: id, limit: 20 }),
      getSpecificationClarifications: (id) => this.platform.store.listSpecificationClarifications({ specId: id, limit: 50 }),
      getSpecificationVersions: (id) => this.platform.store.listSpecificationVersions({ specId: id, limit: 10 }),
      getSpecificationVerifications: (id) => this.platform.store.listSpecificationVerifications({ specId: id, limit: 50 }),
      getAuditEvent: async (id) => (await this.platform.store.listAuditEvents({ limit: 10000 })).find((event) => event.id === id),
      getMcpServer: (id) => this.platform.mcpRegistry.get(id),
      getMcpHealth: (id) => this.getMcpHealthForDetail(id),
    });
    const operatorProjection = await this.resolveOperatorProjection(options);
    return projectOperatorDetail(detail, { mode: operatorProjection });
  }

  async getOperatorRows(options: { operatorProjection?: OperatorProjectionMode; operatorActor?: ActorRef; rows?: OperatorRowsOptions } = {}) {
    const state = await this.getState(options);
    return {
      generatedAt: state.operator.generatedAt,
      rows: collectOperatorRows(state.operator, options.rows),
    };
  }

  async getOperatorRowDetail(ordinal: number, options: { operatorProjection?: OperatorProjectionMode; operatorActor?: ActorRef; rows?: OperatorRowsOptions } = {}) {
    const rowView = await this.getOperatorRows(options);
    const row = rowView.rows.find((candidate) => candidate.ordinal === ordinal);
    if (!row) {
      return undefined;
    }
    const detail = await this.getOperatorDetail(row.item.id, options);
    return {
      generatedAt: rowView.generatedAt,
      row,
      detail,
    };
  }

  async resolveOperatorProjection(options: { operatorProjection?: OperatorProjectionMode; operatorActor?: ActorRef } = {}): Promise<OperatorProjectionMode> {
    if (options.operatorProjection === "public") {
      return "public";
    }
    const actor = options.operatorActor;
    if (!actor || (actor.type === "user" && actor.id === "local-user")) {
      return "diagnostic";
    }
    if (actor.type !== "user" && actor.type !== "agent" && actor.type !== "service_account") {
      return "public";
    }
    const allowed = await this.platform.organizations.hasCapability({
      subjectType: actor.type,
      subjectId: actor.id,
      scopeType: "operator",
      scopeId: "local",
      capability: "operator.diagnostic",
    });
    return allowed ? "diagnostic" : "public";
  }

  private async getMcpHealthForDetail(serverId: string): Promise<McpHealthCheckResult | undefined> {
    const server = await this.platform.mcpRegistry.get(serverId);
    if (!server) {
      return undefined;
    }
    const actor: ActorRef = { type: "user", id: "local-user", displayName: "Local User" };
    return this.checkOperatorMcpHealthServer(server, actor, { timeoutMs: 750 });
  }

  async refreshMcpHealth(input: { serverId: string; actor: ActorRef; timeoutMs?: number }): Promise<McpHealthCheckResult | undefined> {
    const server = await this.platform.mcpRegistry.get(input.serverId);
    if (!server) {
      return undefined;
    }
    const result = await this.checkOperatorMcpHealthServer(server, input.actor, {
      force: true,
      timeoutMs: input.timeoutMs ?? 2_000,
    });
    await this.auditControlAction(input.actor, "Refreshed MCP health from control plane", {
      serverId: server.id,
      status: result.status,
      transport: result.transport,
      reason: result.reason,
      diagnostics: result.diagnostics,
      planStatus: result.plan?.status,
      cached: false,
    });
    return result;
  }

  private async getOperatorMcpHealth(): Promise<McpHealthCheckResult[]> {
    const servers = (await this.platform.mcpRegistry.list()).slice(0, 10);
    const actor: ActorRef = { type: "user", id: "local-user", displayName: "Local User" };
    const results = await Promise.all(servers.map((server) => this.checkOperatorMcpHealthServer(server, actor, { timeoutMs: 750 })));
    return results;
  }

  private async checkOperatorMcpHealthServer(
    server: McpServerRegistration,
    actor: ActorRef,
    options: { force?: boolean; timeoutMs: number },
  ): Promise<McpHealthCheckResult> {
    const cached = this.mcpHealthCache.get(server.id);
    if (!options.force && cached && cached.serverUpdatedAt === server.updatedAt && cached.expiresAtMs > Date.now()) {
      return cached.result;
    }
    try {
      const result = await this.platform.mcpHealth.check({
        serverId: server.id,
        actor,
        mode: "trusted",
        timeoutMs: options.timeoutMs,
      });
      this.cacheMcpHealth(server, result, cached?.consecutiveFailures ?? 0);
      return result;
    } catch (error) {
      const result: McpHealthCheckResult = {
        serverId: server.id,
        generatedAt: new Date().toISOString(),
        status: "failed",
        transport: server.transport,
        reason: error instanceof Error ? error.message : String(error),
        diagnostics: ["MCP health check failed while building operator state."],
      };
      this.cacheMcpHealth(server, result, cached?.consecutiveFailures ?? 0);
      return result;
    }
  }

  private cacheMcpHealth(server: McpServerRegistration, result: McpHealthCheckResult, previousFailures: number): void {
    const consecutiveFailures = result.status === "failed" || result.status === "timeout" ? previousFailures + 1 : 0;
    this.mcpHealthCache.set(server.id, {
      serverUpdatedAt: server.updatedAt,
      result,
      expiresAtMs: Date.now() + mcpHealthCacheTtlMs(result.status, consecutiveFailures),
      consecutiveFailures,
    });
  }

  async listAgents(limit = 50) {
    return this.platform.store.listAgents(limit);
  }

  async getAgent(agentId: string) {
    return this.platform.store.getAgent(agentId);
  }

  async getAgentHealth(input: { now?: string; limit?: number } = {}) {
    return this.platform.agentHealth.getSummary(input);
  }

  async heartbeatAgent(input: {
    actor: ActorRef;
    agentId: string;
    status: AgentHeartbeatStatus;
    roomId?: string;
    ttlSeconds?: number;
    lastPollStopReason?: string;
    messagesProcessed?: number;
    errorCount?: number;
    lastError?: string;
    metadata?: Record<string, unknown>;
    heartbeatEnvelope?: AgentHeartbeatEnvelope;
  }): Promise<AgentIdentity | undefined> {
    const agent = await this.platform.store.getAgent(input.agentId);
    if (!agent) {
      return undefined;
    }
    const now = new Date();
    const heartbeatAt = input.heartbeatEnvelope?.heartbeatAt ?? now.toISOString();
    const expiresAt = input.heartbeatEnvelope?.expiresAt ?? (input.ttlSeconds ? new Date(now.getTime() + input.ttlSeconds * 1000).toISOString() : undefined);
    if (input.heartbeatEnvelope) {
      await this.verifyAndRecordAgentHeartbeatEnvelope(input.heartbeatEnvelope, {
        agentId: input.agentId,
        status: input.status,
        roomId: input.roomId,
      });
    } else if (input.actor.type !== "agent" || input.actor.id !== input.agentId || input.agentId !== this.platform.localAgent.id) {
      throw new Error("Signed agent heartbeat envelope is required unless the local agent heartbeats itself.");
    }
    const updated: AgentIdentity = {
      ...agent,
      heartbeatStatus: input.status,
      lastSeenAt: heartbeatAt,
      lastHeartbeatAt: heartbeatAt,
      heartbeatExpiresAt: expiresAt,
      lastRoomId: (input.roomId ?? input.heartbeatEnvelope?.roomId ?? agent.lastRoomId) as AgentIdentity["lastRoomId"],
      lastError: input.lastError ?? input.heartbeatEnvelope?.lastError,
      heartbeatMetadata: {
        ...(agent.heartbeatMetadata ?? {}),
        ...(input.metadata ?? input.heartbeatEnvelope?.metadata ?? {}),
        lastPollStopReason: input.lastPollStopReason ?? input.heartbeatEnvelope?.lastPollStopReason,
        messagesProcessed: input.messagesProcessed ?? input.heartbeatEnvelope?.messagesProcessed,
        errorCount: input.errorCount ?? input.heartbeatEnvelope?.errorCount,
      },
    };
    const stored = await this.platform.store.updateAgentHeartbeat(updated);
    await this.auditControlAction(input.actor, "Agent heartbeat from control plane", {
      agentId: input.agentId,
      machineId: agent.machineId,
      status: updated.heartbeatStatus,
      roomId: updated.lastRoomId,
      lastPollStopReason: updated.heartbeatMetadata?.lastPollStopReason,
      messagesProcessed: updated.heartbeatMetadata?.messagesProcessed,
      errorCount: updated.heartbeatMetadata?.errorCount,
      hasLastError: Boolean(updated.lastError),
      signedHeartbeat: Boolean(input.heartbeatEnvelope?.signature),
      expiresAt: updated.heartbeatExpiresAt,
    }, { roomId: updated.lastRoomId });
    return stored;
  }

  async registerAgentIdentity(input: {
    actor: ActorRef;
    agentId: string;
    machineId: string;
    displayName?: string;
    publicKeyPem: string;
    fingerprint?: string;
    capabilities?: string[];
    allowedProjects?: string[];
    orgId?: string;
  }): Promise<AgentIdentity> {
    const normalizedPublicKey = normalizePublicKeyPem(input.publicKeyPem);
    const fingerprint = fingerprintPublicKey(normalizedPublicKey);
    if (input.fingerprint && normalizeFingerprint(input.fingerprint) !== normalizeFingerprint(fingerprint)) {
      throw new Error("Invalid agent identity: fingerprint does not match public key.");
    }
    const existing = await this.platform.store.getAgent(input.agentId);
    if (existing && existing.publicKeyPem !== normalizedPublicKey) {
      throw new Error(`Agent identity key conflict: ${input.agentId}`);
    }
    const now = new Date().toISOString();
    const agent: AgentIdentity = {
      id: input.agentId as AgentIdentity["id"],
      machineId: input.machineId as AgentIdentity["machineId"],
      orgId: (input.orgId ?? existing?.orgId) as AgentIdentity["orgId"],
      displayName: input.displayName ?? existing?.displayName ?? input.agentId,
      publicKeyPem: normalizedPublicKey,
      fingerprint,
      capabilities: input.capabilities ?? existing?.capabilities ?? [],
      allowedProjects: (input.allowedProjects ?? existing?.allowedProjects ?? []) as AgentIdentity["allowedProjects"],
      trustStatus: existing?.trustStatus ?? "pending",
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
    };
    await this.platform.store.registerAgent(agent);
    await this.auditControlAction(
      input.actor,
      "Registered agent identity from control plane",
      {
        agentId: agent.id,
        machineId: agent.machineId,
        displayName: agent.displayName,
        fingerprint: agent.fingerprint,
        trustStatus: agent.trustStatus,
        capabilities: agent.capabilities,
        allowedProjects: agent.allowedProjects,
      },
    );
    return agent;
  }

  async getRoom(roomId: string) {
    const room = await this.platform.rooms.getRoom(roomId);
    if (!room) {
      return undefined;
    }
    return {
      room,
      members: await this.platform.rooms.listMembers(roomId),
      messages: await this.platform.rooms.listMessages(roomId, 200),
      invites: await this.listSignedRoomInvites(roomId),
    };
  }

  async getRoomRoster(roomId: string) {
    const room = await this.platform.rooms.getRoom(roomId);
    if (!room) {
      return undefined;
    }
    return buildRoomRoster({
      room,
      members: await this.platform.rooms.listMembers(roomId),
      agents: await this.platform.store.listAgents(1000),
    });
  }

  private async listSignedRoomInvites(roomId: string) {
    const invites = await this.platform.rooms.listInvites(roomId);
    return Promise.all(
      invites.map(async (invite) => ({
        ...invite,
        signatureStatus: await this.platform.rooms.verifyInvite(invite),
      })),
    );
  }

  async getRoomAgentInbox(input: { roomId: string; agentId: string; limit?: number; includeDelivered?: boolean }) {
    const room = await this.platform.rooms.getRoom(input.roomId);
    if (!room) {
      return undefined;
    }
    const members = await this.platform.rooms.listMembers(input.roomId);
    const member = members.find((candidate) => candidate.actor.type === "agent" && candidate.actor.id === input.agentId);
    if (!member) {
      return undefined;
    }
    const limit = input.limit ?? 50;
    const transcriptLimit = Math.max(limit, Math.min(1000, limit * 10));
    const cursor = await this.platform.store.getRoomDeliveryCursor(input.roomId, input.agentId);
    const messages = await this.platform.rooms.listMessages(input.roomId, transcriptLimit);
    const undeliveredMessages = input.includeDelivered === true ? messages : messagesAfterCursor(messages, cursor?.lastDeliveredMessageId);
    const routedMessages = messages
      .filter((message) => undeliveredMessages.includes(message))
      .filter((message) => shouldActorRespondToRoomMessage(message, member))
      .slice(-limit);
    const enrichedMessages = await Promise.all(
      routedMessages.map(async (message) => ({
        ...message,
        signatureStatus: await this.platform.rooms.verifyMessage(message),
        activationContext: buildRoomActivationContext({
          message,
          member,
          transcript: messages,
          maxRecentMessages: 6,
        }),
      })),
    );
    return {
      room,
      member,
      cursor,
      generatedAt: new Date().toISOString(),
      consideredMessages: messages.length,
      messages: enrichedMessages,
    };
  }

  async ackRoomAgentInbox(input: { roomId: string; agentId: string; messageId?: string; actor: ActorRef; ackEnvelope?: RoomDeliveryAckEnvelope }) {
    const room = await this.platform.rooms.getRoom(input.roomId);
    if (!room) {
      return undefined;
    }
    const members = await this.platform.rooms.listMembers(input.roomId);
    const member = members.find((candidate) => candidate.actor.type === "agent" && candidate.actor.id === input.agentId);
    if (!member) {
      return undefined;
    }
    await this.assertRoomInboxAckAllowed(input.roomId, input.agentId, input.actor, input.ackEnvelope);
    const messages = await this.platform.rooms.listMessages(input.roomId, 1000);
    const messageId = input.messageId ?? messages.at(-1)?.id;
    if (!messageId) {
      throw new Error("Cannot acknowledge an empty room inbox.");
    }
    const message = messages.find((candidate) => candidate.id === messageId);
    if (!message) {
      throw new Error(`Room message not found: ${messageId}`);
    }
    const ackEnvelope = await this.resolveRoomDeliveryAckEnvelope({
      roomId: room.id,
      agentId: input.agentId,
      messageId: message.id,
      actor: input.actor,
      ackEnvelope: input.ackEnvelope,
    });
    const cursor = {
      roomId: room.id,
      agentId: input.agentId,
      lastDeliveredMessageId: message.id,
      lastAckEnvelope: ackEnvelope,
      updatedAt: new Date().toISOString(),
      updatedBy: input.actor,
    };
    await this.platform.store.upsertRoomDeliveryCursor(cursor);
    await this.auditControlAction(
      input.actor,
      "Acknowledged routed room inbox from control plane",
      { roomId: input.roomId, agentId: input.agentId, messageId: message.id, signedAck: Boolean(ackEnvelope?.signature) },
      { roomId: input.roomId },
    );
    return cursor;
  }

  private async assertRoomInboxAckAllowed(roomId: string, agentId: string, actor: ActorRef, ackEnvelope?: RoomDeliveryAckEnvelope): Promise<void> {
    if (actor.type === "agent" && actor.id === agentId) {
      const members = await this.platform.rooms.listMembers(roomId);
      const self = members.find((candidate) => candidate.actor.type === "agent" && candidate.actor.id === agentId);
      if (self?.status === "active") {
        if (agentId !== this.platform.localAgent.id && !ackEnvelope) {
          throw new Error("Signed room delivery ack envelope is required for remote agent self-ack.");
        }
        return;
      }
    }
    await this.platform.rooms.assertCapability(roomId, actor, "room.delivery.ack");
  }

  private async resolveRoomDeliveryAckEnvelope(input: {
    roomId: string;
    agentId: string;
    messageId: string;
    actor: ActorRef;
    ackEnvelope?: RoomDeliveryAckEnvelope;
  }): Promise<RoomDeliveryAckEnvelope | undefined> {
    const supplied = input.ackEnvelope;
    if (supplied) {
      await this.verifyAndRecordRoomDeliveryAckEnvelope(supplied, input);
      return supplied;
    }
    if (input.actor.type !== "agent" || input.actor.id !== input.agentId || input.agentId !== this.platform.localAgent.id) {
      return undefined;
    }
    const acknowledgedAt = new Date().toISOString();
    const unsigned: Omit<RoomDeliveryAckEnvelope, "signature"> = {
      version: 1,
      roomId: input.roomId as RoomDeliveryAckEnvelope["roomId"],
      agentId: input.agentId,
      messageId: input.messageId,
      acknowledgedAt,
      acknowledgedBy: input.actor,
      nonce: randomUUID(),
    };
    const signature = await this.platform.identity.signRoomDeliveryAckEnvelope(unsigned);
    if (!signature) {
      throw new Error("Failed to sign local room delivery ack envelope.");
    }
    const envelope = { ...unsigned, signature };
    await this.recordRoomDeliveryAckNonce(envelope);
    return envelope;
  }

  private async verifyAndRecordRoomDeliveryAckEnvelope(
    envelope: RoomDeliveryAckEnvelope,
    expected: { roomId: string; agentId: string; messageId: string },
  ): Promise<void> {
    if (envelope.version !== 1) {
      throw new Error(`Unsupported room delivery ack envelope version: ${envelope.version}`);
    }
    if (envelope.roomId !== expected.roomId || envelope.agentId !== expected.agentId || envelope.messageId !== expected.messageId) {
      throw new Error("Room delivery ack envelope does not match the acknowledged message.");
    }
    if (envelope.acknowledgedBy.type !== "agent" || envelope.acknowledgedBy.id !== envelope.agentId) {
      throw new Error("Room delivery ack envelope must be acknowledged by the target agent.");
    }
    const status = await this.platform.identity.verifyRoomDeliveryAckEnvelope(envelope);
    if (status !== "valid") {
      throw new Error(`Invalid room delivery ack envelope signature: ${status}`);
    }
    await this.recordRoomDeliveryAckNonce(envelope);
  }

  private async recordRoomDeliveryAckNonce(envelope: RoomDeliveryAckEnvelope): Promise<void> {
    const recorded = await this.platform.store.recordRoomDeliveryAckNonce({
      agentId: envelope.agentId,
      nonce: envelope.nonce,
      roomId: envelope.roomId,
      messageId: envelope.messageId,
      envelopeHash: roomDeliveryAckEnvelopeHash(envelope),
      firstSeenAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (!recorded) {
      throw new Error(`Room delivery ack nonce replay detected: ${envelope.nonce}`);
    }
  }

  private async verifyAndRecordAgentHeartbeatEnvelope(
    envelope: AgentHeartbeatEnvelope,
    expected: { agentId: string; status: AgentHeartbeatStatus; roomId?: string },
  ): Promise<void> {
    if (envelope.version !== 1) {
      throw new Error(`Unsupported agent heartbeat envelope version: ${envelope.version}`);
    }
    if (envelope.agentId !== expected.agentId || envelope.status !== expected.status) {
      throw new Error("Agent heartbeat envelope does not match the heartbeat request.");
    }
    if (expected.roomId && envelope.roomId !== expected.roomId) {
      throw new Error("Agent heartbeat envelope does not match the room.");
    }
    if (envelope.heartbeatBy.type !== "agent" || envelope.heartbeatBy.id !== envelope.agentId) {
      throw new Error("Agent heartbeat envelope must be signed by the heartbeat agent.");
    }
    const agent = await this.platform.store.getAgent(envelope.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${envelope.agentId}`);
    }
    if (envelope.machineId !== agent.machineId) {
      throw new Error("Agent heartbeat envelope machine does not match registered identity.");
    }
    const status = await this.platform.identity.verifyAgentHeartbeatEnvelope(envelope);
    if (status !== "valid") {
      throw new Error(`Invalid agent heartbeat envelope signature: ${status}`);
    }
    const recorded = await this.platform.store.recordAgentHeartbeatNonce({
      agentId: envelope.agentId,
      nonce: envelope.nonce,
      envelopeHash: agentHeartbeatEnvelopeHash(envelope),
      firstSeenAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (!recorded) {
      throw new Error(`Agent heartbeat nonce replay detected: ${envelope.nonce}`);
    }
  }

  async getSession(sessionId: string) {
    const session = await this.platform.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    return {
      session,
      messages: await this.platform.store.getMessages(sessionId),
      toolResults: await this.platform.store.getToolResults(sessionId),
      summaries: await this.platform.store.getSessionSummaries(sessionId),
      links: await this.platform.store.listSessionLinks(sessionId),
    };
  }

  async getSessionInspection(sessionId: string) {
    const session = await this.platform.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    return buildSessionInspectView(this.platform.store, sessionId);
  }

  async getSessionNext(sessionId: string) {
    const session = await this.platform.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    return buildSessionNextView(this.platform.store, sessionId);
  }

  async getSessionStatus(sessionId: string, options: { limit?: number } = {}) {
    const session = await this.platform.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    return buildSessionStatusView(this.platform.store, sessionId, options);
  }

  async getSessionResult(sessionId: string) {
    const session = await this.platform.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    return buildSessionResultView(this.platform.store, sessionId);
  }

  async getSessionDiff(sessionId: string) {
    const session = await this.platform.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    return buildSessionDiffView(this.platform.store, sessionId);
  }

  async getSessionReport(sessionId: string) {
    const session = await this.platform.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    return buildSessionReportView(this.platform.store, sessionId);
  }

  async getSessionVerification(sessionId: string, options: SessionVerificationOptions = {}) {
    const session = await this.platform.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    return buildSessionVerificationView(this.platform.store, sessionId, options);
  }

  async getSessionBundle(sessionId: string, options: SessionBundleOptions = {}) {
    const session = await this.platform.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    return buildSessionBundleView(this.platform.store, sessionId, options);
  }

  async getSessionTimeline(sessionId: string, options: { limit?: number } = {}) {
    const session = await this.platform.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    return buildSessionTimelineView(this.platform.store, sessionId, options);
  }

  async getSessionReview(sessionId: string, options: { limit?: number } = {}) {
    const session = await this.platform.store.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    return buildSessionReviewView(this.platform.store, sessionId, options);
  }

  async getSessionDashboard(options: SessionDashboardOptions = {}) {
    return buildSessionDashboardView(this.platform.store, options);
  }

  async pauseSession(input: { sessionId: string; actor: ActorRef; reason?: string }) {
    const session = await this.platform.tasks.pause(input);
    await this.auditControlAction(
      input.actor,
      "Paused session from control plane",
      { sessionId: session.id, reason: input.reason },
      { projectId: session.projectId, roomId: session.roomId, sessionId: session.id },
    );
    return session;
  }

  async cancelSession(input: { sessionId: string; actor: ActorRef; reason?: string }) {
    const session = await this.platform.tasks.cancel(input);
    await this.auditControlAction(
      input.actor,
      "Cancelled session from control plane",
      { sessionId: session.id, reason: input.reason },
      { projectId: session.projectId, roomId: session.roomId, sessionId: session.id },
    );
    return session;
  }

  async resumeSession(input: { sessionId: string; actor: ActorRef; reason?: string; autoRun?: boolean }) {
    if (input.autoRun === true) {
      const finalAnswer = await this.platform.agent.resume(input.sessionId);
      const session = await this.platform.store.getSession(input.sessionId);
      if (!session) {
        return undefined;
      }
      await this.auditControlAction(
        input.actor,
        "Resumed session from control plane",
        { sessionId: session.id, reason: input.reason, autoRun: true },
        { projectId: session.projectId, roomId: session.roomId, sessionId: session.id },
      );
      return { session, finalAnswer };
    }

    const session = await this.platform.tasks.markResumed(input);
    await this.auditControlAction(
      input.actor,
      "Resumed session from control plane",
      { sessionId: session.id, reason: input.reason, autoRun: false },
      { projectId: session.projectId, roomId: session.roomId, sessionId: session.id },
    );
    return { session };
  }

  async listArtifacts(input: ListArtifactsInput = {}) {
    return this.platform.store.listArtifacts(input);
  }

  async listRetentionPolicies(limit = 50) {
    return this.platform.store.listRetentionPolicies(limit);
  }

  async listAuditEvents(input: ListAuditEventsInput = {}) {
    await ensureAuditExportAllowed(this.platform.store, input);
    return this.platform.store.listAuditEvents(input);
  }

  async listWorkers(input: ListWorkersInput = {}) {
    return this.platform.workers.list(input);
  }

  async getWorkerHealth(input: { now?: string; limit?: number } = {}) {
    return this.platform.workerHealth.getSummary(input);
  }

  async registerWorker(input: {
    actor: ActorRef;
    agentId?: string;
    machineId?: string;
    orgId?: string;
    displayName?: string;
    endpoint?: string;
    capabilities?: string[];
    allowedProjects?: string[];
    maxConcurrentTasks?: number;
    metadata?: Record<string, unknown>;
    ttlSeconds?: number;
  }) {
    const worker = await this.platform.workers.register({
      actor: input.actor,
      agentId: input.agentId ?? this.platform.localAgent.id,
      machineId: input.machineId ?? this.platform.localAgent.machineId,
      orgId: input.orgId ?? this.platform.localAgent.orgId,
      displayName: input.displayName ?? this.platform.localAgent.displayName,
      endpoint: input.endpoint,
      capabilities: input.capabilities,
      allowedProjects: input.allowedProjects,
      maxConcurrentTasks: input.maxConcurrentTasks,
      metadata: input.metadata,
      ttlSeconds: input.ttlSeconds,
    });
    await this.auditControlAction(input.actor, "Registered worker from control plane", { workerId: worker.id }, { projectId: input.allowedProjects?.[0] });
    return worker;
  }

  async heartbeatWorker(input: {
    workerId: string;
    actor: ActorRef;
    status?: WorkerStatus;
    currentLoad?: number;
    maxConcurrentTasks?: number;
    metadata?: Record<string, unknown>;
    ttlSeconds?: number;
  }) {
    const worker = await this.platform.workers.heartbeat(input);
    await this.auditControlAction(input.actor, "Worker heartbeat from control plane", {
      workerId: worker.id,
      status: worker.status,
      currentLoad: worker.currentLoad,
    });
    return worker;
  }

  async drainWorker(input: { workerId: string; actor: ActorRef; reason?: string; ttlSeconds?: number }) {
    const worker = await this.platform.workers.drain(input);
    await this.auditControlAction(input.actor, "Drained worker from control plane", {
      workerId: worker.id,
      reason: input.reason,
      status: worker.status,
    });
    return worker;
  }

  async completeWorkerDrain(input: { workerId: string; actor: ActorRef; reason?: string }) {
    const worker = await this.platform.workers.completeDrain(input);
    await this.auditControlAction(input.actor, "Completed worker drain from control plane", {
      workerId: worker.id,
      reason: input.reason,
      status: worker.status,
    });
    return worker;
  }

  async recoverExpiredWorkers(input: { actor: ActorRef; limit?: number }) {
    const result = await this.platform.workers.recoverExpired(input);
    await this.auditControlAction(input.actor, "Recovered expired workers from control plane", {
      expiredCount: result.expired.length,
      workerIds: result.expired.map((worker) => worker.id),
    });
    return result;
  }

  async cleanupWorkerHeartbeatNonces(input: { actor: ActorRef; before?: string; limit?: number }) {
    const result = await this.platform.workers.cleanupHeartbeatNonces(input);
    await this.auditControlAction(input.actor, "Cleaned worker heartbeat nonce records from control plane", {
      deleted: result.deleted,
      before: result.before,
      limit: input.limit,
    });
    return result;
  }

  async runWorkerOnce(input: { workerId: string; actor: ActorRef; leaseTtlSeconds?: number; requireSignedLeaseEnvelope?: boolean }) {
    const result = await this.platform.workerRunner.runOnce({
      workerId: input.workerId,
      actor: input.actor,
      leaseTtlSeconds: input.leaseTtlSeconds,
      requireSignedLeaseEnvelope: input.requireSignedLeaseEnvelope,
    });
    await this.auditControlAction(input.actor, "Worker run-once from control plane", {
      workerId: input.workerId,
      ran: result.ran,
      assignmentId: result.ran ? result.assignment.id : undefined,
      completed: result.ran ? result.completed : undefined,
    });
    return result;
  }

  async pollWorker(input: {
    workerId: string;
    actor: ActorRef;
    leaseTtlSeconds?: number;
    maxRuns?: number;
    maxIdlePolls?: number;
    idleIntervalMs?: number;
    requireSignedLeaseEnvelope?: boolean;
  }) {
    const result = await this.platform.workerRunner.poll({
      workerId: input.workerId,
      actor: input.actor,
      leaseTtlSeconds: input.leaseTtlSeconds,
      maxRuns: input.maxRuns,
      maxIdlePolls: input.maxIdlePolls,
      idleIntervalMs: input.idleIntervalMs,
      requireSignedLeaseEnvelope: input.requireSignedLeaseEnvelope,
    });
    await this.auditControlAction(input.actor, "Worker poll from control plane", {
      workerId: input.workerId,
      stopReason: result.stopReason,
      runsAttempted: result.runsAttempted,
      assignmentsCompleted: result.assignmentsCompleted,
    });
    return result;
  }

  async listAssignments(input: ListTaskAssignmentsInput = {}) {
    return this.platform.assignments.list(input);
  }

  async assignTask(input: {
    actor: ActorRef;
    workerId: string;
    sessionId?: string;
    subtaskId?: string;
    leaseTtlSeconds?: number;
    priority?: number;
    metadata?: Record<string, unknown>;
  }) {
    const assignment = await this.platform.taskBroker.enqueue(input);
    await this.auditControlAction(input.actor, "Assigned task from control plane", {
      assignmentId: assignment.id,
      workerId: assignment.workerId,
      kind: assignment.kind,
    }, { projectId: assignment.projectId, roomId: assignment.roomId, sessionId: assignment.sessionId });
    return assignment;
  }

  async heartbeatAssignment(input: {
    actor: ActorRef;
    assignmentId: string;
    workerId: string;
    leaseTtlSeconds?: number;
    metadata?: Record<string, unknown>;
  }) {
    const assignment = await this.platform.assignments.heartbeat(input);
    await this.auditControlAction(input.actor, "Assignment heartbeat from control plane", {
      assignmentId: assignment.id,
      workerId: assignment.workerId,
      leaseExpiresAt: assignment.leaseExpiresAt,
    }, { projectId: assignment.projectId, roomId: assignment.roomId, sessionId: assignment.sessionId });
    return assignment;
  }

  async completeAssignment(input: {
    actor: ActorRef;
    assignmentId: string;
    workerId: string;
    status: Extract<TaskAssignmentStatus, "completed" | "failed" | "cancelled">;
    resultSummary?: string;
  }) {
    const assignment = await this.platform.assignments.complete(input);
    await this.auditControlAction(input.actor, `Assignment ${input.status} from control plane`, {
      assignmentId: assignment.id,
      workerId: assignment.workerId,
      resultSummary: input.resultSummary,
    }, { projectId: assignment.projectId, roomId: assignment.roomId, sessionId: assignment.sessionId });
    return assignment;
  }

  async recoverExpiredAssignments(input: {
    actor: ActorRef;
    retryWorkerId?: string;
    autoSelectRetryWorker?: boolean;
    leaseTtlSeconds?: number;
    maxAttempts?: number;
    baseBackoffMs?: number;
    maxBackoffMs?: number;
    jitterMs?: number;
    limit?: number;
    exhaustedTargetStatus?: "paused" | "failed";
    metadata?: Record<string, unknown>;
  }) {
    const result = await this.platform.taskBroker.recoverExpired(input);
    await this.auditControlAction(input.actor, "Recovered expired assignments from control plane", {
      expiredCount: result.expired.length,
      retryCount: result.retries.length,
      retryWorkerId: input.retryWorkerId,
      autoSelectRetryWorker: input.autoSelectRetryWorker,
    });
    return result;
  }

  async cleanupTaskLeaseNonces(input: { actor: ActorRef; before?: string; limit?: number }) {
    const result = await this.platform.assignments.cleanupLeaseNonces(input);
    await this.auditControlAction(input.actor, "Cleaned task lease nonce records from control plane", {
      deleted: result.deleted,
      before: result.before,
      limit: input.limit,
    });
    return result;
  }

  async runSchedulerTick(input: {
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
    completeDrainedWorkers?: boolean;
    warnLoadRatio?: number;
    warnQueueRatio?: number;
  }) {
    const result = await this.platform.scheduler.tick(input);
    await this.auditControlAction(input.actor, "Scheduler tick from control plane", {
      workersExpired: result.workersExpired,
      workerDrainCompletions: result.workerDrainCompletions.length,
      workerDrainBlocked: result.workerDrainBlocked,
      workerHeartbeatRejections: result.workerHeartbeatRejections,
      recoveredExpired: result.recoveredExpired,
      retriesScheduled: result.retriesScheduled,
      specTasksDispatched: result.specTasksDispatched,
      healthWarnings: result.healthWarnings,
      workersPolled: result.workersPolled,
      assignmentsCompleted: result.assignmentsCompleted,
    });
    return result;
  }

  async sendRoomMessage(input: {
    roomId: string;
    sender: ActorRef;
    kind: Parameters<LocalPlatform["rooms"]["sendMessage"]>[0]["kind"];
    body: string;
    routing?: Parameters<LocalPlatform["rooms"]["sendMessage"]>[0]["routing"];
  }) {
    const message = await this.platform.rooms.sendMessage({
      roomId: input.roomId as Parameters<LocalPlatform["rooms"]["sendMessage"]>[0]["roomId"],
      sender: input.sender,
      kind: input.kind,
      body: input.body,
      routing: input.routing,
    });
    await this.auditControlAction(input.sender, "Sent room message from control plane", {
      roomId: input.roomId,
      messageId: message.id,
      routing: message.routing,
    }, { roomId: input.roomId });
    return message;
  }

  async approveRoomMember(input: { roomId: string; actorId: string; approver: ActorRef }) {
    const member = await this.platform.rooms.approveJoin(input.roomId, input.actorId, input.approver);
    await this.auditControlAction(
      input.approver,
      "Approved room member from control plane",
      { roomId: input.roomId, actorId: input.actorId },
      { roomId: input.roomId },
    );
    return member;
  }

  async joinRoomWithInvite(input: { roomId: string; token: string; actor: ActorRef; aliases?: string[] }) {
    const member = await this.platform.rooms.joinWithInvite(input.roomId, input.token, input.actor, input.aliases ?? []);
    await this.auditControlAction(
      input.actor,
      "Joined room with invite token from control plane",
      {
        roomId: input.roomId,
        actorType: member.actor.type,
        actorId: member.actor.id,
        aliases: member.aliases ?? [],
        role: member.role,
        status: member.status,
      },
      { roomId: input.roomId },
    );
    return member;
  }

  async updateRoomMemberAliases(input: { roomId: string; actorId: string; aliases: string[]; updatedBy: ActorRef }) {
    const member = await this.platform.rooms.updateMemberAliases(input.roomId, input.actorId, input.aliases, input.updatedBy);
    await this.auditControlAction(
      input.updatedBy,
      "Updated room member aliases from control plane",
      { roomId: input.roomId, actorId: input.actorId, aliases: member.aliases ?? [] },
      { roomId: input.roomId },
    );
    return member;
  }

  async updateRoomMemberRole(input: { roomId: string; actorId: string; role: RoomRole; updatedBy: ActorRef }) {
    const member = await this.platform.rooms.updateMemberRole(input.roomId, input.actorId, input.role, input.updatedBy);
    await this.auditControlAction(
      input.updatedBy,
      "Updated room member role from control plane",
      { roomId: input.roomId, actorId: input.actorId, role: member.role },
      { roomId: input.roomId },
    );
    return member;
  }

  async updateRoomMemberStatus(input: { roomId: string; actorId: string; status: RoomMemberStatus; updatedBy: ActorRef }) {
    const member = await this.platform.rooms.updateMemberStatus(input.roomId, input.actorId, input.status, input.updatedBy);
    await this.auditControlAction(
      input.updatedBy,
      "Updated room member status from control plane",
      { roomId: input.roomId, actorId: input.actorId, status: member.status },
      { roomId: input.roomId },
    );
    return member;
  }

  async revokeRoomInvite(input: { roomId: string; inviteId: string; revokedBy: ActorRef }) {
    const invite = await this.platform.rooms.revokeInvite(input.roomId, input.inviteId, input.revokedBy);
    await this.auditControlAction(
      input.revokedBy,
      "Revoked room invite from control plane",
      { roomId: input.roomId, inviteId: input.inviteId, status: invite.status },
      { roomId: input.roomId },
    );
    return invite;
  }

  async decideApproval(input: {
    approvalId: string;
    status: "approved" | "denied";
    actor: ActorRef;
    reason?: string;
    autoReplay?: boolean;
    autoResume?: boolean;
  }) {
    const existing = (await this.platform.store.listApprovalRequests()).find((candidate) => candidate.id === input.approvalId);
    if (existing?.roomId) {
      await this.platform.rooms.assertCapability(existing.roomId, input.actor, "tool.approve");
    }
    const approval = await this.platform.store.decideApproval({
      approvalId: input.approvalId,
      status: input.status,
      decidedBy: input.actor,
      decisionReason: input.reason,
    });
    if (!approval) {
      return undefined;
    }

    await appendApprovalDecisionRoomMessage(this.platform.store, approval, input.actor);
    await this.auditControlAction(input.actor, `Approval ${input.status} from control plane`, {
      approvalId: input.approvalId,
      action: approval.action,
      toolName: approval.toolName,
    }, { roomId: approval.roomId, sessionId: approval.sessionId });

    const result: Record<string, unknown> = { approval };
    if (input.status === "approved" && (input.autoReplay === true || input.autoResume === true)) {
      const replay = await replayApprovedTool({
        approvalId: input.approvalId,
        store: this.platform.store,
        actor: input.actor,
        tools: createWorkspaceTools(this.platform.workspace, {
          store: this.platform.store,
          locks: this.platform.locks,
          actor: input.actor,
        }),
      });
      result.replay = replay;
      const pending = await this.platform.store.getPendingToolCallByApproval(input.approvalId);
      if (input.autoResume === true && pending?.sessionId && replay.ok) {
        result.finalAnswer = await this.platform.agent.resume(pending.sessionId);
      }
    }
    return result;
  }

  private async auditControlAction(
    actor: ActorRef,
    summary: string,
    metadata: Record<string, unknown>,
    scope: { roomId?: string; sessionId?: string; projectId?: string } = {},
  ): Promise<void> {
    await this.platform.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "control_plane.action",
      actor,
      roomId: scope.roomId as Parameters<AgentStore["recordAuditEvent"]>[0]["roomId"],
      sessionId: scope.sessionId as Parameters<AgentStore["recordAuditEvent"]>[0]["sessionId"],
      projectId: scope.projectId as Parameters<AgentStore["recordAuditEvent"]>[0]["projectId"],
      summary,
      metadata,
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
  }
}

function messagesAfterCursor<T extends { id: string }>(messages: T[], cursorMessageId?: string): T[] {
  if (!cursorMessageId) {
    return messages;
  }
  const index = messages.findIndex((message) => message.id === cursorMessageId);
  return index >= 0 ? messages.slice(index + 1) : messages;
}

function roomDeliveryAckEnvelopeHash(envelope: RoomDeliveryAckEnvelope): string {
  return createHash("sha256").update(JSON.stringify(envelope)).digest("hex");
}

function agentHeartbeatEnvelopeHash(envelope: AgentHeartbeatEnvelope): string {
  return createHash("sha256").update(JSON.stringify(envelope)).digest("hex");
}

function normalizePublicKeyPem(publicKeyPem: string): string {
  try {
    return createPublicKey(publicKeyPem).export({ type: "spki", format: "pem" }).toString();
  } catch {
    throw new Error("Invalid agent identity: publicKeyPem is not a valid public key.");
  }
}

function fingerprintPublicKey(publicKeyPem: string): string {
  const digest = createHash("sha256").update(publicKeyPem).digest("hex").toUpperCase();
  return `SHA256:${digest.match(/.{1,4}/g)?.join("-") ?? digest}`;
}

function normalizeFingerprint(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export async function appendApprovalDecisionRoomMessage(store: AgentStore, approval: ApprovalRequest, actor: ActorRef): Promise<void> {
  if (!approval.roomId) {
    return;
  }
  await store.appendRoomMessage({
    id: makeId<"MessageId">("msg"),
    roomId: approval.roomId as Parameters<AgentStore["appendRoomMessage"]>[0]["roomId"],
    sender: actor,
    kind: "approval",
    body: `Approval ${approval.status}: ${approval.id}\nAction: ${approval.action}\nTool: ${approval.toolName ?? "-"}\nReason: ${approval.decisionReason ?? approval.reason}`,
    createdAt: new Date().toISOString(),
    artifactRefs: [],
  });
}

export async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

export function actorFromBody(body: Record<string, unknown>): ActorRef {
  if (body.localAgent === true && typeof body.localAgentId === "string") {
    return { type: "agent", id: body.localAgentId, displayName: body.localAgentId };
  }
  if (typeof body.actor === "string") {
    const [type, id] = body.actor.includes(":") ? body.actor.split(":", 2) : ["user", body.actor];
    return { type: type as ActorRef["type"], id, displayName: id };
  }
  return { type: "user", id: "local-user", displayName: "Local User" };
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required string: ${field}`);
  }
  return value;
}

export function parseArtifactFilters(url: URL): ListArtifactsInput {
  return {
    status: optionalEnum(url, "status", ["active", "deleted"]),
    orgId: optionalString(url, "orgId"),
    projectId: optionalString(url, "projectId"),
    roomId: optionalString(url, "roomId"),
    sessionId: optionalString(url, "sessionId"),
    kind: optionalString(url, "kind") as ArtifactKind | undefined,
    limit: optionalInteger(url, "limit", 1, 1000),
  };
}

export function parseAuditFilters(url: URL): ListAuditEventsInput {
  return {
    limit: optionalInteger(url, "limit", 1, 10000) ?? 100,
    type: optionalString(url, "type") as ListAuditEventsInput["type"],
    actorId: optionalString(url, "actor"),
    sessionId: optionalString(url, "session"),
    roomId: optionalString(url, "room"),
    projectId: optionalString(url, "project"),
    from: optionalString(url, "from"),
    to: optionalString(url, "to"),
  };
}

export function parseWorkerFilters(url: URL): ListWorkersInput {
  return {
    status: optionalEnum(url, "status", ["online", "offline", "draining", "suspended"]),
    agentId: optionalString(url, "agent"),
    machineId: optionalString(url, "machine"),
    orgId: optionalString(url, "org"),
    projectId: optionalString(url, "project"),
    limit: optionalInteger(url, "limit", 1, 1000) ?? 100,
  };
}

export function parseAssignmentFilters(url: URL): ListTaskAssignmentsInput {
  return {
    status: optionalEnum(url, "status", ["leased", "running", "paused", "completed", "failed", "cancelled", "expired"]),
    workerId: optionalString(url, "worker"),
    sessionId: optionalString(url, "session"),
    subtaskId: optionalString(url, "subtask"),
    projectId: optionalString(url, "project"),
    roomId: optionalString(url, "room"),
    limit: optionalInteger(url, "limit", 1, 1000) ?? 100,
  };
}

async function ensureAuditExportAllowed(store: AgentStore, filters: ListAuditEventsInput): Promise<void> {
  if (!filters.projectId) {
    return;
  }
  const project = await store.getProject(filters.projectId);
  if (!project?.retentionPolicyId) {
    return;
  }
  const policy = await store.getRetentionPolicy(project.retentionPolicyId);
  if (policy && !policy.allowAuditExport) {
    throw new Error(`Retention policy ${policy.name} does not allow audit export for project ${filters.projectId}.`);
  }
}

function mcpHealthCacheTtlMs(status: McpHealthCheckResult["status"], consecutiveFailures: number): number {
  if (status === "failed" || status === "timeout") {
    return Math.min(60_000, 5_000 * 2 ** Math.max(0, consecutiveFailures - 1));
  }
  return 30_000;
}

function optionalString(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value && value.trim().length > 0 ? value : undefined;
}

function optionalEnum<T extends string>(url: URL, key: string, values: readonly T[]): T | undefined {
  const value = optionalString(url, key);
  if (!value) {
    return undefined;
  }
  if (!values.includes(value as T)) {
    throw new Error(`Invalid ${key}: ${value}`);
  }
  return value as T;
}

function optionalInteger(url: URL, key: string, min: number, max: number): number | undefined {
  const value = optionalString(url, key);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

