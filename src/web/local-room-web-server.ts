import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import {
  actorFromBody,
  ControlPlaneService,
  parseAssignmentFilters,
  parseArtifactFilters,
  parseAuditFilters,
  parseWorkerFilters,
  readJson,
  requiredString,
} from "../control-plane/control-plane-service.js";
import type { AgentHeartbeatEnvelope, AgentHeartbeatStatus, RoomDeliveryAckEnvelope, RoomMemberStatus, RoomRole } from "../domain/index.js";
import type { OperatorItemKind, OperatorSeverity, OperatorStatus } from "../operator/operator-view-models.js";
import { createLocalPlatform } from "../platform/local-platform.js";

export type LocalRoomWebServerOptions = {
  host?: string;
  port?: number;
  token?: string;
};

export async function startLocalRoomWebServer(cwd: string, options: LocalRoomWebServerOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4317;
  const token = options.token ?? process.env.AGENT_WEB_TOKEN ?? randomBytes(24).toString("base64url");
  const platform = await createLocalPlatform(cwd);
  const control = new ControlPlaneService(platform);

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${host}:${port}`);
      if (!isAuthorized(request, url, token)) {
        sendJson(response, { error: "Unauthorized" }, 401);
        return;
      }

      if (request.method === "GET" && url.pathname === "/") {
        sendHtml(response, renderAppHtml());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, await control.getHealth());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        sendJson(response, await control.getState(operatorProjectionRequestFromUrl(url)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/operator/rows") {
        sendJson(response, await control.getOperatorRows({
          ...operatorProjectionRequestFromUrl(url),
          rows: operatorRowsFromUrl(url),
        }));
        return;
      }
      const operatorRowDetailMatch = url.pathname.match(/^\/api\/operator\/rows\/(\d+)\/detail$/);
      if (request.method === "GET" && operatorRowDetailMatch) {
        const ordinal = requiredPositiveInteger(operatorRowDetailMatch[1], "ordinal");
        const result = await control.getOperatorRowDetail(ordinal, {
          ...operatorProjectionRequestFromUrl(url),
          rows: operatorRowsFromUrl(url),
        });
        if (!result) {
          sendJson(response, { error: `Operator row not found: ${ordinal}` }, 404);
          return;
        }
        sendJson(response, result);
        return;
      }
      const operatorMcpRefreshMatch = url.pathname.match(/^\/api\/operator\/mcp\/([^/]+)\/refresh$/);
      if (request.method === "POST" && operatorMcpRefreshMatch) {
        const body = await readJson(request);
        const serverId = decodeURIComponent(operatorMcpRefreshMatch[1]);
        const result = await control.refreshMcpHealth({
          serverId,
          actor: actorFromBody(body),
          timeoutMs: optionalBodyInteger(body.timeoutMs),
        });
        if (!result) {
          sendJson(response, { error: `MCP server not found: ${serverId}` }, 404);
          return;
        }
        sendJson(response, { result });
        return;
      }
      const operatorDetailMatch = url.pathname.match(/^\/api\/operator\/items\/([^/]+)$/);
      if (request.method === "GET" && operatorDetailMatch) {
        const itemId = decodeURIComponent(operatorDetailMatch[1]);
        const detail = await control.getOperatorDetail(itemId, operatorProjectionRequestFromUrl(url));
        if (!detail.item) {
          sendJson(response, { error: `Operator item not found: ${itemId}` }, 404);
          return;
        }
        sendJson(response, { detail });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/artifacts") {
        sendJson(response, { artifacts: await control.listArtifacts(parseArtifactFilters(url)) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/retention/policies") {
        sendJson(response, { policies: await control.listRetentionPolicies() });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/audit") {
        sendJson(response, { events: await control.listAuditEvents(parseAuditFilters(url)) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/workers") {
        sendJson(response, { workers: await control.listWorkers(parseWorkerFilters(url)) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/workers/health") {
        sendJson(response, { health: await control.getWorkerHealth({ now: optionalUrlString(url, "now"), limit: optionalUrlInteger(url, "limit") }) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/assignments") {
        sendJson(response, { assignments: await control.listAssignments(parseAssignmentFilters(url)) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/agents") {
        sendJson(response, { agents: await control.listAgents(optionalUrlInteger(url, "limit") ?? 50) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/agents/health") {
        sendJson(response, { health: await control.getAgentHealth({ now: optionalUrlString(url, "now"), limit: optionalUrlInteger(url, "limit") }) });
        return;
      }
      const agentMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
      if (request.method === "GET" && agentMatch) {
        const agentId = decodeURIComponent(agentMatch[1]);
        const agent = await control.getAgent(agentId);
        if (!agent) {
          sendJson(response, { error: `Agent not found: ${agentId}` }, 404);
          return;
        }
        sendJson(response, { agent });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/agents/register") {
        const body = await readJson(request);
        const agent = await control.registerAgentIdentity({
          actor: actorFromBody(body),
          agentId: requiredString(body.agentId, "agentId"),
          machineId: requiredString(body.machineId, "machineId"),
          displayName: optionalBodyString(body.displayName),
          publicKeyPem: requiredString(body.publicKeyPem, "publicKeyPem"),
          fingerprint: optionalBodyString(body.fingerprint),
          capabilities: optionalBodyStringArray(body.capabilities),
          allowedProjects: optionalBodyStringArray(body.allowedProjects),
          orgId: optionalBodyString(body.orgId),
        });
        sendJson(response, { agent });
        return;
      }
      const agentHeartbeatMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/heartbeat$/);
      if (request.method === "POST" && agentHeartbeatMatch) {
        const body = await readJson(request);
        const agentId = decodeURIComponent(agentHeartbeatMatch[1]);
        const agent = await control.heartbeatAgent({
          actor: actorFromBody(body),
          agentId,
          status: requiredAgentHeartbeatStatus(body.status),
          roomId: optionalBodyString(body.roomId),
          ttlSeconds: optionalBodyInteger(body.ttlSeconds),
          lastPollStopReason: optionalBodyString(body.lastPollStopReason),
          messagesProcessed: optionalBodyInteger(body.messagesProcessed),
          errorCount: optionalBodyInteger(body.errorCount),
          lastError: optionalBodyString(body.lastError),
          metadata: optionalBodyRecord(body.metadata),
          heartbeatEnvelope: optionalAgentHeartbeatEnvelope(body.heartbeatEnvelope),
        });
        if (!agent) {
          sendJson(response, { error: `Agent not found: ${agentId}` }, 404);
          return;
        }
        sendJson(response, { agent });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/scheduler/tick") {
        const body = await readJson(request);
        const result = await control.runSchedulerTick({
          actor: actorFromBody(body),
          workerId: optionalBodyString(body.workerId),
          requireSignedWorkerHeartbeat: body.requireSignedWorkerHeartbeat === true,
          requireSignedLeaseEnvelope: body.requireSignedLeaseEnvelope === true,
          leaseTtlSeconds: optionalBodyInteger(body.leaseTtlSeconds),
          maxAttempts: optionalBodyInteger(body.maxAttempts),
          baseBackoffMs: optionalBodyInteger(body.baseBackoffMs),
          maxBackoffMs: optionalBodyInteger(body.maxBackoffMs),
          jitterMs: optionalBodyInteger(body.jitterMs),
          recoverLimit: optionalBodyInteger(body.recoverLimit),
          maxRunsPerWorker: optionalBodyInteger(body.maxRunsPerWorker),
          maxIdlePolls: optionalBodyInteger(body.maxIdlePolls),
          idleIntervalMs: optionalBodyInteger(body.idleIntervalMs),
          completeDrainedWorkers: body.completeDrainedWorkers === true,
          warnLoadRatio: optionalBodyRatio(body.warnLoadRatio, "warnLoadRatio"),
          warnQueueRatio: optionalBodyNonNegativeNumber(body.warnQueueRatio, "warnQueueRatio"),
        });
        sendJson(response, { result });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/workers/register") {
        const body = await readJson(request);
        const worker = await control.registerWorker({
          actor: actorFromBody(body),
          agentId: optionalBodyString(body.agentId),
          machineId: optionalBodyString(body.machineId),
          orgId: optionalBodyString(body.orgId),
          displayName: optionalBodyString(body.displayName),
          endpoint: optionalBodyString(body.endpoint),
          capabilities: optionalBodyStringArray(body.capabilities),
          allowedProjects: optionalBodyStringArray(body.allowedProjects),
          maxConcurrentTasks: optionalBodyInteger(body.maxConcurrentTasks),
          metadata: optionalBodyRecord(body.metadata),
          ttlSeconds: optionalBodyInteger(body.ttlSeconds),
        });
        sendJson(response, { worker });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/workers/recover-expired") {
        const body = await readJson(request);
        const result = await control.recoverExpiredWorkers({
          actor: actorFromBody(body),
          limit: optionalBodyInteger(body.limit),
        });
        sendJson(response, { result });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/workers/cleanup-nonces") {
        const body = await readJson(request);
        const result = await control.cleanupWorkerHeartbeatNonces({
          actor: actorFromBody(body),
          before: optionalBodyString(body.before),
          limit: optionalBodyInteger(body.limit),
        });
        sendJson(response, { result });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/assignments/assign") {
        const body = await readJson(request);
        const assignment = await control.assignTask({
          actor: actorFromBody(body),
          workerId: requiredString(body.workerId, "workerId"),
          sessionId: optionalBodyString(body.sessionId),
          subtaskId: optionalBodyString(body.subtaskId),
          leaseTtlSeconds: optionalBodyInteger(body.leaseTtlSeconds),
          priority: optionalBodyInteger(body.priority),
          metadata: optionalBodyRecord(body.metadata),
        });
        sendJson(response, { assignment });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/assignments/recover-expired") {
        const body = await readJson(request);
        const result = await control.recoverExpiredAssignments({
          actor: actorFromBody(body),
          retryWorkerId: optionalBodyString(body.retryWorkerId),
          autoSelectRetryWorker: body.autoSelectRetryWorker === true,
          leaseTtlSeconds: optionalBodyInteger(body.leaseTtlSeconds),
          maxAttempts: optionalBodyInteger(body.maxAttempts),
          baseBackoffMs: optionalBodyInteger(body.baseBackoffMs),
          maxBackoffMs: optionalBodyInteger(body.maxBackoffMs),
          jitterMs: optionalBodyInteger(body.jitterMs),
          limit: optionalBodyInteger(body.limit),
          exhaustedTargetStatus: optionalExhaustedStatus(body.exhaustedTargetStatus),
          metadata: optionalBodyRecord(body.metadata),
        });
        sendJson(response, { result });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/assignments/cleanup-nonces") {
        const body = await readJson(request);
        const result = await control.cleanupTaskLeaseNonces({
          actor: actorFromBody(body),
          before: optionalBodyString(body.before),
          limit: optionalBodyInteger(body.limit),
        });
        sendJson(response, { result });
        return;
      }

      const assignmentHeartbeatMatch = url.pathname.match(/^\/api\/assignments\/([^/]+)\/heartbeat$/);
      if (request.method === "POST" && assignmentHeartbeatMatch) {
        const body = await readJson(request);
        const assignment = await control.heartbeatAssignment({
          actor: actorFromBody(body),
          assignmentId: decodeURIComponent(assignmentHeartbeatMatch[1]),
          workerId: requiredString(body.workerId, "workerId"),
          leaseTtlSeconds: optionalBodyInteger(body.leaseTtlSeconds),
          metadata: optionalBodyRecord(body.metadata),
        });
        sendJson(response, { assignment });
        return;
      }

      const assignmentCompletionMatch = url.pathname.match(/^\/api\/assignments\/([^/]+)\/(complete|fail|cancel)$/);
      if (request.method === "POST" && assignmentCompletionMatch) {
        const body = await readJson(request);
        const assignment = await control.completeAssignment({
          actor: actorFromBody(body),
          assignmentId: decodeURIComponent(assignmentCompletionMatch[1]),
          workerId: requiredString(body.workerId, "workerId"),
          status: assignmentCompletionMatch[2] === "complete" ? "completed" : assignmentCompletionMatch[2] === "fail" ? "failed" : "cancelled",
          resultSummary: optionalBodyString(body.resultSummary),
        });
        sendJson(response, { assignment });
        return;
      }

      const workerHeartbeatMatch = url.pathname.match(/^\/api\/workers\/([^/]+)\/heartbeat$/);
      if (request.method === "POST" && workerHeartbeatMatch) {
        const body = await readJson(request);
        const worker = await control.heartbeatWorker({
          workerId: decodeURIComponent(workerHeartbeatMatch[1]),
          actor: actorFromBody(body),
          status: optionalWorkerStatus(body.status),
          currentLoad: optionalBodyInteger(body.currentLoad),
          maxConcurrentTasks: optionalBodyInteger(body.maxConcurrentTasks),
          metadata: optionalBodyRecord(body.metadata),
          ttlSeconds: optionalBodyInteger(body.ttlSeconds),
        });
        sendJson(response, { worker });
        return;
      }

      const workerDrainMatch = url.pathname.match(/^\/api\/workers\/([^/]+)\/drain$/);
      if (request.method === "POST" && workerDrainMatch) {
        const body = await readJson(request);
        const worker = await control.drainWorker({
          workerId: decodeURIComponent(workerDrainMatch[1]),
          actor: actorFromBody(body),
          reason: optionalBodyString(body.reason),
          ttlSeconds: optionalBodyInteger(body.ttlSeconds),
        });
        sendJson(response, { worker });
        return;
      }

      const workerCompleteDrainMatch = url.pathname.match(/^\/api\/workers\/([^/]+)\/complete-drain$/);
      if (request.method === "POST" && workerCompleteDrainMatch) {
        const body = await readJson(request);
        const worker = await control.completeWorkerDrain({
          workerId: decodeURIComponent(workerCompleteDrainMatch[1]),
          actor: actorFromBody(body),
          reason: optionalBodyString(body.reason),
        });
        sendJson(response, { worker });
        return;
      }

      const workerRunOnceMatch = url.pathname.match(/^\/api\/workers\/([^/]+)\/run-once$/);
      if (request.method === "POST" && workerRunOnceMatch) {
        const body = await readJson(request);
        const result = await control.runWorkerOnce({
          workerId: decodeURIComponent(workerRunOnceMatch[1]),
          actor: actorFromBody(body),
          leaseTtlSeconds: optionalBodyInteger(body.leaseTtlSeconds),
          requireSignedLeaseEnvelope: body.requireSignedLeaseEnvelope === true,
        });
        sendJson(response, { result });
        return;
      }

      const workerPollMatch = url.pathname.match(/^\/api\/workers\/([^/]+)\/poll$/);
      if (request.method === "POST" && workerPollMatch) {
        const body = await readJson(request);
        const result = await control.pollWorker({
          workerId: decodeURIComponent(workerPollMatch[1]),
          actor: actorFromBody(body),
          leaseTtlSeconds: optionalBodyInteger(body.leaseTtlSeconds),
          maxRuns: optionalBodyInteger(body.maxRuns),
          maxIdlePolls: optionalBodyInteger(body.maxIdlePolls),
          idleIntervalMs: optionalBodyInteger(body.idleIntervalMs),
          requireSignedLeaseEnvelope: body.requireSignedLeaseEnvelope === true,
        });
        sendJson(response, { result });
        return;
      }

      const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
      if (request.method === "GET" && roomMatch) {
        const room = await control.getRoom(decodeURIComponent(roomMatch[1]));
        if (!room) {
          sendJson(response, { error: `Room not found: ${decodeURIComponent(roomMatch[1])}` }, 404);
          return;
        }
        sendJson(response, room);
        return;
      }

      const roomHandlesMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/handles$/);
      if (request.method === "GET" && roomHandlesMatch) {
        const roster = await control.getRoomRoster(decodeURIComponent(roomHandlesMatch[1]));
        if (!roster) {
          sendJson(response, { error: `Room not found: ${decodeURIComponent(roomHandlesMatch[1])}` }, 404);
          return;
        }
        sendJson(response, roster);
        return;
      }

      const roomInboxMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/agent-inbox$/);
      if (request.method === "GET" && roomInboxMatch) {
        const agentId = optionalUrlString(url, "agentId") ?? platform.localAgent.id;
        const inbox = await control.getRoomAgentInbox({
          roomId: decodeURIComponent(roomInboxMatch[1]),
          agentId,
          limit: optionalUrlInteger(url, "limit"),
          includeDelivered: url.searchParams.get("includeDelivered") === "true",
        });
        if (!inbox) {
          sendJson(response, { error: `Room or agent member not found: ${decodeURIComponent(roomInboxMatch[1])} / ${agentId}` }, 404);
          return;
        }
        sendJson(response, inbox);
        return;
      }

      const roomInboxAckMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/agent-inbox\/ack$/);
      if (request.method === "POST" && roomInboxAckMatch) {
        const body = await readJson(request);
        const agentId = optionalBodyString(body.agentId) ?? platform.localAgent.id;
        const cursor = await control.ackRoomAgentInbox({
          roomId: decodeURIComponent(roomInboxAckMatch[1]),
          agentId,
          messageId: optionalBodyString(body.messageId),
          actor: actorFromBody(body),
          ackEnvelope: optionalRoomDeliveryAckEnvelope(body.ackEnvelope),
        });
        if (!cursor) {
          sendJson(response, { error: `Room or agent member not found: ${decodeURIComponent(roomInboxAckMatch[1])} / ${agentId}` }, 404);
          return;
        }
        sendJson(response, { cursor });
        return;
      }

      const roomJoinInviteMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/join-invite$/);
      if (request.method === "POST" && roomJoinInviteMatch) {
        const body = await readJson(request);
        const member = await control.joinRoomWithInvite({
          roomId: decodeURIComponent(roomJoinInviteMatch[1]),
          token: requiredString(body.token, "token"),
          actor: actorFromBody(body),
          aliases: optionalBodyStringArray(body.aliases),
        });
        sendJson(response, { member });
        return;
      }

      const sessionInspectionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/inspect$/);
      if (request.method === "GET" && sessionInspectionMatch) {
        const sessionId = decodeURIComponent(sessionInspectionMatch[1]);
        const inspection = await control.getSessionInspection(sessionId);
        if (!inspection) {
          sendJson(response, { error: `Session not found: ${sessionId}` }, 404);
          return;
        }
        sendJson(response, inspection);
        return;
      }

      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (request.method === "GET" && sessionMatch) {
        const session = await control.getSession(decodeURIComponent(sessionMatch[1]));
        if (!session) {
          sendJson(response, { error: `Session not found: ${decodeURIComponent(sessionMatch[1])}` }, 404);
          return;
        }
        sendJson(response, session);
        return;
      }

      const sessionLifecycleMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(pause|cancel|resume)$/);
      if (request.method === "POST" && sessionLifecycleMatch) {
        const body = await readJson(request);
        const sessionId = decodeURIComponent(sessionLifecycleMatch[1]);
        const action = sessionLifecycleMatch[2];
        const actor = actorFromBody(body);
        const reason = optionalBodyString(body.reason);
        if (action === "pause") {
          const session = await control.pauseSession({ sessionId, actor, reason });
          sendJson(response, { session });
          return;
        }
        if (action === "cancel") {
          const session = await control.cancelSession({ sessionId, actor, reason });
          sendJson(response, { session });
          return;
        }
        const result = await control.resumeSession({ sessionId, actor, reason, autoRun: body.autoRun === true });
        if (!result) {
          sendJson(response, { error: `Session not found: ${sessionId}` }, 404);
          return;
        }
        sendJson(response, result);
        return;
      }

      const roomMessageMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/messages$/);
      if (request.method === "POST" && roomMessageMatch) {
        const body = await readJson(request);
        const sender = actorFromBody(body);
        const message = await control.sendRoomMessage({
          roomId: decodeURIComponent(roomMessageMatch[1]),
          sender,
          kind: typeof body.kind === "string" ? (body.kind as Parameters<typeof control.sendRoomMessage>[0]["kind"]) : "chat",
          body: requiredString(body.body, "body"),
        });
        sendJson(response, { message });
        return;
      }

      const memberApprovalMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/members\/([^/]+)\/approve$/);
      if (request.method === "POST" && memberApprovalMatch) {
        const body = await readJson(request);
        const approver = actorFromBody(body);
        const member = await control.approveRoomMember({
          roomId: decodeURIComponent(memberApprovalMatch[1]),
          actorId: decodeURIComponent(memberApprovalMatch[2]),
          approver,
        });
        sendJson(response, { member });
        return;
      }

      const memberAliasesMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/members\/([^/]+)\/aliases$/);
      if (request.method === "POST" && memberAliasesMatch) {
        const body = await readJson(request);
        const member = await control.updateRoomMemberAliases({
          roomId: decodeURIComponent(memberAliasesMatch[1]),
          actorId: decodeURIComponent(memberAliasesMatch[2]),
          aliases: requiredBodyStringArray(body.aliases, "aliases"),
          updatedBy: actorFromBody(body),
        });
        sendJson(response, { member });
        return;
      }

      const memberRoleMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/members\/([^/]+)\/role$/);
      if (request.method === "POST" && memberRoleMatch) {
        const body = await readJson(request);
        const member = await control.updateRoomMemberRole({
          roomId: decodeURIComponent(memberRoleMatch[1]),
          actorId: decodeURIComponent(memberRoleMatch[2]),
          role: requiredRoomRole(body.role),
          updatedBy: actorFromBody(body),
        });
        sendJson(response, { member });
        return;
      }

      const memberStatusMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/members\/([^/]+)\/status$/);
      if (request.method === "POST" && memberStatusMatch) {
        const body = await readJson(request);
        const member = await control.updateRoomMemberStatus({
          roomId: decodeURIComponent(memberStatusMatch[1]),
          actorId: decodeURIComponent(memberStatusMatch[2]),
          status: requiredRoomMemberStatus(body.status),
          updatedBy: actorFromBody(body),
        });
        sendJson(response, { member });
        return;
      }

      const inviteRevokeMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/invites\/([^/]+)\/revoke$/);
      if (request.method === "POST" && inviteRevokeMatch) {
        const body = await readJson(request);
        const invite = await control.revokeRoomInvite({
          roomId: decodeURIComponent(inviteRevokeMatch[1]),
          inviteId: decodeURIComponent(inviteRevokeMatch[2]),
          revokedBy: actorFromBody(body),
        });
        sendJson(response, { invite });
        return;
      }

      const approvalDecisionMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/);
      if (request.method === "POST" && approvalDecisionMatch) {
        const body = await readJson(request);
        const approvalId = approvalDecisionMatch[1];
        const status = approvalDecisionMatch[2] === "approve" ? "approved" : "denied";
        const actor = actorFromBody(body);
        const result = await control.decideApproval({
          approvalId,
          status,
          actor,
          reason: typeof body.reason === "string" ? body.reason : undefined,
          autoReplay: body.autoReplay === true,
          autoResume: body.autoResume === true,
        });
        if (!result) {
          sendJson(response, { error: `Approval not found: ${approvalId}` }, 404);
          return;
        }
        sendJson(response, result);
        return;
      }

      sendJson(response, { error: "Not found" }, 404);
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, httpErrorStatus(error));
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });

  const address = server.address() as AddressInfo;
  const actualPort = address.port;
  const baseUrl = `http://${host}:${actualPort}`;
  const close = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    platform.locks.close?.();
    platform.store.close?.();
  };

  return {
    url: `${baseUrl}/?token=${encodeURIComponent(token)}`,
    baseUrl,
    token,
    close,
  };
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
}

function httpErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (/Actor lacks room capability|lacks capability|Policy denied/i.test(message)) {
    return 403;
  }
  if (/not found|No pending member found/i.test(message)) {
    return 404;
  }
  if (/nonce replay|at least one active owner|Room invite is|Agent identity key conflict/i.test(message)) {
    return 409;
  }
  if (
    /Missing required|Invalid room|Invalid agent identity|Invalid worker status|Invalid exhausted target status|Expected non-negative|must be a number|alias already exists|alias conflicts|alias is reserved|exceeding maxRoutedAgentTargets|Wide room mentions are disabled|Signed .* envelope is required/i.test(
      message,
    )
  ) {
    return 400;
  }
  return 500;
}

function isAuthorized(request: IncomingMessage, url: URL, token: string): boolean {
  const presented = request.headers["x-agent-control-token"] ?? url.searchParams.get("token");
  if (Array.isArray(presented) || typeof presented !== "string") {
    return false;
  }
  const expectedBytes = Buffer.from(token);
  const presentedBytes = Buffer.from(presented);
  return expectedBytes.length === presentedBytes.length && timingSafeEqual(expectedBytes, presentedBytes);
}

function optionalBodyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalBodyStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function requiredBodyStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Missing required string array: ${field}`);
  }
  return value.filter((item) => item.trim().length > 0);
}

function requiredRoomRole(value: unknown): RoomRole {
  if (
    value === "owner" ||
    value === "moderator" ||
    value === "participant" ||
    value === "observer" ||
    value === "executor" ||
    value === "reviewer" ||
    value === "approver"
  ) {
    return value;
  }
  throw new Error(`Invalid room role: ${String(value)}`);
}

function requiredRoomMemberStatus(value: unknown): RoomMemberStatus {
  if (
    value === "invited" ||
    value === "pending" ||
    value === "active" ||
    value === "suspended" ||
    value === "left" ||
    value === "removed" ||
    value === "expired"
  ) {
    return value;
  }
  throw new Error(`Invalid room member status: ${String(value)}`);
}

function optionalBodyInteger(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected non-negative integer, got: ${String(value)}`);
  }
  return parsed;
}

function requiredPositiveInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return parsed;
}

function operatorProjectionRequestFromUrl(url: URL) {
  return {
    operatorProjection: url.searchParams.get("operatorView") === "public" ? "public" as const : url.searchParams.get("operatorView") === "diagnostic" ? "diagnostic" as const : undefined,
    operatorActor: actorFromQuery(url.searchParams.get("operatorActor")),
  };
}

function operatorRowsFromUrl(url: URL) {
  return {
    limit: optionalOperatorUrlInteger(url, "limit", 1, 100),
    kind: optionalOperatorUrlEnum(url, "kind", ["approval", "assignment", "worker", "agent", "session", "queue", "mcp", "artifact", "retention", "spec", "scheduler", "audit"] satisfies OperatorItemKind[]),
    status: optionalOperatorUrlEnum(url, "status", ["healthy", "idle", "running", "queued", "waiting_for_approval", "paused", "retry_delayed", "draining", "blocked", "saturated", "stale", "failed", "completed", "offline", "unknown"] satisfies OperatorStatus[]),
    severity: optionalOperatorUrlEnum(url, "severity", ["ok", "info", "warning", "critical"] satisfies OperatorSeverity[]),
    id: optionalUrlString(url, "id"),
  };
}

function optionalOperatorUrlEnum<T extends string>(url: URL, key: string, values: readonly T[]): T | undefined {
  const value = optionalUrlString(url, key);
  if (!value) {
    return undefined;
  }
  if ((values as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`Invalid ${key}: ${value}`);
}

function optionalOperatorUrlInteger(url: URL, key: string, min: number, max: number): number | undefined {
  const value = optionalUrlString(url, key);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function actorFromQuery(value: string | null) {
  if (!value) {
    return undefined;
  }
  const [type, id] = value.includes(":") ? value.split(":", 2) : ["user", value];
  return { type: type as ReturnType<typeof actorFromBody>["type"], id, displayName: id };
}

function optionalBodyRatio(value: unknown, field: string): number | undefined {
  const parsed = optionalBodyNonNegativeNumber(value, field);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed > 1) {
    throw new Error(`${field} must be a number between 0 and 1.`);
  }
  return parsed;
}

function optionalBodyNonNegativeNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return parsed;
}

function optionalUrlString(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value && value.trim().length > 0 ? value : undefined;
}

function optionalUrlInteger(url: URL, key: string): number | undefined {
  const value = optionalUrlString(url, key);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected non-negative integer for ${key}, got: ${value}`);
  }
  return parsed;
}

function optionalBodyRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function optionalRoomDeliveryAckEnvelope(value: unknown): RoomDeliveryAckEnvelope | undefined {
  const record = optionalBodyRecord(value);
  if (!record) {
    return undefined;
  }
  return record as RoomDeliveryAckEnvelope;
}

function optionalAgentHeartbeatEnvelope(value: unknown): AgentHeartbeatEnvelope | undefined {
  const record = optionalBodyRecord(value);
  if (!record) {
    return undefined;
  }
  return record as AgentHeartbeatEnvelope;
}

function requiredAgentHeartbeatStatus(value: unknown): AgentHeartbeatStatus {
  if (value === "online" || value === "idle" || value === "running" || value === "error" || value === "offline") {
    return value;
  }
  throw new Error(`Invalid agent heartbeat status: ${String(value)}`);
}

function optionalWorkerStatus(value: unknown): "online" | "offline" | "draining" | "suspended" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "online" || value === "offline" || value === "draining" || value === "suspended") {
    return value;
  }
  throw new Error(`Invalid worker status: ${String(value)}`);
}

function optionalExhaustedStatus(value: unknown): "paused" | "failed" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "paused" || value === "failed") {
    return value;
  }
  throw new Error(`Invalid exhausted target status: ${String(value)}`);
}

function renderAppHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Rooms</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f8;
      --panel: #ffffff;
      --line: #d7dde2;
      --text: #172026;
      --muted: #5f6b73;
      --accent: #0f766e;
      --accent-strong: #0b5d56;
      --warn: #a16207;
      --danger: #b42318;
      --good: #19723a;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-size: 14px; }
    button, input, select, textarea { font: inherit; }
    button { border: 1px solid var(--line); background: #fff; color: var(--text); border-radius: 6px; padding: 7px 10px; cursor: pointer; }
    button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    button.danger { color: var(--danger); }
    button:hover { border-color: var(--accent); }
    .shell { min-height: 100vh; display: grid; grid-template-columns: 280px minmax(0, 1fr) 340px; }
    header { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 54px; padding: 8px 16px; border-bottom: 1px solid var(--line); background: #fff; }
    h1, h2, h3 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 18px; font-weight: 700; }
    h2 { font-size: 13px; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; }
    h3 { font-size: 15px; }
    .meta { color: var(--muted); font-size: 12px; }
    .header-tools { display: grid; grid-template-columns: minmax(160px, 220px) minmax(0, 1fr); align-items: center; gap: 10px; max-width: 620px; }
    .header-tools input { padding: 6px 8px; }
    aside, main { min-height: calc(100vh - 54px); overflow: auto; }
    aside { border-right: 1px solid var(--line); background: #fbfcfc; padding: 14px; }
    aside.right { border-left: 1px solid var(--line); border-right: 0; }
    main { padding: 16px; }
    .room-list { display: grid; gap: 8px; }
    .room-item { width: 100%; text-align: left; padding: 10px; display: grid; gap: 4px; }
    .room-item.active { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
    .section { margin-bottom: 18px; }
    .members { display: grid; gap: 8px; margin: 12px 0; }
    .member-row { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(260px, 1.35fr); align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 8px; }
    .member-main { display: grid; gap: 3px; min-width: 0; }
    .member-title { font-weight: 700; overflow-wrap: anywhere; }
    .member-meta { color: var(--muted); font-size: 12px; }
    .member-status { font-size: 12px; font-weight: 700; }
    .member-status.pending { color: var(--warn); }
    .member-status.active { color: var(--good); }
    .member-controls { display: grid; gap: 6px; min-width: 0; }
    .member-control-line { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; }
    .member-selects { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 6px; }
    .member-controls input, .member-controls select { min-width: 0; }
    .invites { display: grid; gap: 8px; margin: 0 0 14px; }
    .invite-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 8px; }
    .invite-title { font-weight: 700; overflow-wrap: anywhere; }
    .transcript { display: grid; gap: 8px; }
    .message { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
    .message-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; color: var(--muted); font-size: 12px; }
    .message-body { white-space: pre-wrap; line-height: 1.45; overflow-wrap: anywhere; }
    .routing-warning { margin-top: 7px; border: 1px solid #e8c873; background: #fff9e8; color: #725600; border-radius: 6px; padding: 6px 8px; font-size: 12px; overflow-wrap: anywhere; }
    .composer { display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; gap: 8px; margin-top: 14px; }
    textarea, input, select { border: 1px solid var(--line); border-radius: 6px; padding: 8px; background: #fff; color: var(--text); width: 100%; }
    textarea { min-height: 42px; resize: vertical; }
    .queue { display: grid; gap: 8px; }
    .operator-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 8px; }
    .operator-card { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 10px; display: grid; gap: 6px; }
    .operator-card.warning { border-color: #e8c873; background: #fffdf4; }
    .operator-card.critical { border-color: #efb4ad; background: #fff8f7; }
    .operator-detail { margin-top: 8px; border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 10px; display: grid; gap: 7px; }
    .operator-detail-head { display: grid; gap: 4px; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
    .operator-detail-title { font-weight: 700; overflow-wrap: anywhere; }
    .operator-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .operator-detail-section { border: 1px solid var(--line); border-radius: 8px; background: #fbfcfc; padding: 8px; display: grid; gap: 5px; min-width: 0; }
    .operator-detail-section.priority { border-color: #b9d2c1; background: #f6fbf7; }
    .operator-detail-section h4 { margin: 0; font-size: 13px; }
    .operator-detail-row { display: grid; grid-template-columns: minmax(90px, 0.42fr) minmax(0, 1fr); gap: 8px; font-size: 12px; }
    .operator-detail-row span:first-child { color: var(--muted); }
    .operator-detail-row span:last-child { overflow-wrap: anywhere; }
    .operator-source-list { display: grid; gap: 6px; }
    .operator-source-row { border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 7px; display: grid; gap: 3px; }
    .operator-raw-sources { border: 1px solid var(--line); border-radius: 8px; padding: 8px; background: #fff; }
    .operator-raw-sources summary { cursor: pointer; font-weight: 700; }
    .operator-detail pre { margin: 0; max-height: 280px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.35; color: var(--muted); }
    .operator-stat { border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 8px; min-width: 0; }
    .operator-stat strong { display: block; font-size: 16px; line-height: 1.2; }
    .approval, .session { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 10px; display: grid; gap: 7px; }
    .session-inspection { display: grid; gap: 8px; }
    .session-inspection-head { display: grid; gap: 4px; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
    .session-inspection-section { display: grid; gap: 5px; }
    .session-inspection-list { display: grid; gap: 6px; }
    .session-inspection-item { border-left: 3px solid var(--line); padding: 4px 0 4px 8px; display: grid; gap: 3px; min-width: 0; }
    .health-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-bottom: 8px; }
    .health-stat { border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 8px; min-width: 0; }
    .health-stat strong { display: block; font-size: 16px; line-height: 1.2; }
    .health-list { display: grid; gap: 8px; }
    .agent-health { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 8px; display: grid; gap: 4px; }
    .agent-health-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
    .agent-health-title { font-weight: 700; overflow-wrap: anywhere; }
    .health-state { border-radius: 999px; border: 1px solid var(--line); padding: 2px 7px; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .health-state.online, .health-state.idle, .health-state.running { color: var(--good); border-color: #9ac7a9; background: #f1f8f3; }
    .health-state.error, .health-state.stale { color: var(--danger); border-color: #efb4ad; background: #fff5f3; }
    .health-state.offline, .health-state.unknown { color: var(--muted); background: #f7f8f8; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
    .actions button { padding: 5px 8px; font-size: 12px; }
    .status { font-size: 12px; font-weight: 700; }
    .status.pending, .status.paused, .status.waiting_for_approval, .status.retry_delayed, .status.draining, .status.saturated { color: var(--warn); }
    .status.approved, .status.completed, .status.running, .status.healthy, .status.idle, .status.queued { color: var(--good); }
    .status.denied, .status.failed, .status.cancelled, .status.blocked, .status.stale, .status.offline { color: var(--danger); }
    .empty { color: var(--muted); border: 1px dashed var(--line); border-radius: 8px; padding: 14px; background: #fff; }
    @media (max-width: 980px) {
      .shell { grid-template-columns: 1fr; }
      header, aside, main { grid-column: 1; min-height: auto; }
      header { align-items: flex-start; flex-direction: column; }
      .header-tools { width: 100%; grid-template-columns: 1fr; }
      aside, aside.right { border: 0; border-bottom: 1px solid var(--line); }
      .composer { grid-template-columns: 1fr; }
      .member-row { grid-template-columns: 1fr; }
      .invite-row { grid-template-columns: 1fr; }
      .operator-detail-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <h1>Agent Rooms</h1>
      <div class="header-tools">
        <input id="control-actor" value="user:local-user" aria-label="Control actor">
        <div class="meta" id="identity"></div>
      </div>
    </header>
    <aside>
      <div class="toolbar">
        <h2>Rooms</h2>
        <button id="refresh">Refresh</button>
      </div>
      <div class="room-list" id="rooms"></div>
    </aside>
    <main>
      <div class="toolbar">
        <div>
          <h3 id="room-title">No room selected</h3>
          <div class="meta" id="room-meta"></div>
        </div>
      </div>
      <div class="members" id="members"></div>
      <div class="invites" id="invites"></div>
      <div class="transcript" id="messages"></div>
      <form class="composer" id="composer">
        <select id="message-kind">
          <option value="chat">chat</option>
          <option value="task">task</option>
          <option value="decision">decision</option>
          <option value="approval">approval</option>
        </select>
        <textarea id="message-body" placeholder="Message"></textarea>
        <button class="primary" type="submit">Send</button>
      </form>
    </main>
    <aside class="right">
      <section class="section">
        <h2>Operator</h2>
        <div id="operator"></div>
        <div id="operator-detail"></div>
      </section>
      <section class="section">
        <h2>Agent Health</h2>
        <div id="agent-health"></div>
      </section>
      <section class="section">
        <h2>Workers</h2>
        <div class="queue" id="workers"></div>
      </section>
      <section class="section">
        <h2>Assignments</h2>
        <div class="queue" id="assignments"></div>
      </section>
      <section class="section">
        <h2>Specs</h2>
        <div class="queue" id="specs"></div>
      </section>
      <section class="section">
        <h2>Scheduler</h2>
        <div class="queue" id="scheduler"></div>
      </section>
      <section class="section">
        <h2>Artifacts</h2>
        <div class="queue" id="artifacts"></div>
      </section>
      <section class="section">
        <h2>Retention</h2>
        <div class="queue" id="retention"></div>
      </section>
      <section class="section">
        <h2>Audit</h2>
        <div class="queue" id="audit"></div>
      </section>
      <section class="section">
        <h2>Approvals</h2>
        <div class="queue" id="approvals"></div>
      </section>
      <section class="section">
        <h2>Sessions</h2>
        <div class="queue" id="sessions"></div>
      </section>
      <section class="section">
        <h2>Session Inspect</h2>
        <div id="session-inspection"></div>
      </section>
    </aside>
  </div>
  <script>
    let state = null;
    let selectedRoomId = null;
    let selectedOperatorDetail = null;
    let selectedOperatorItemId = null;
    let selectedSessionInspection = null;
    let selectedSessionInspectionId = null;
    const controlToken = new URLSearchParams(window.location.search).get('token') || '';

    function apiFetch(path, options = {}) {
      const headers = Object.assign({}, options.headers || {}, controlToken ? { 'x-agent-control-token': controlToken } : {});
      return fetch(path, Object.assign({}, options, { headers }));
    }

    async function loadState() {
      const response = await apiFetch('/api/state');
      state = await response.json();
      selectedRoomId = selectedRoomId || state.rooms[0]?.room.id || null;
      render();
    }

    function render() {
      document.getElementById('identity').textContent = state.localAgent.displayName + ' | ' + state.localAgent.fingerprint;
      renderRooms();
      renderRoom();
      renderOperator();
      renderOperatorDetail();
      renderAgentHealth();
      renderWorkers();
      renderAssignments();
      renderSpecs();
      renderScheduler();
      renderArtifacts();
      renderRetention();
      renderAudit();
      renderApprovals();
      renderSessions();
      renderSessionInspection();
    }

    function renderRooms() {
      const root = document.getElementById('rooms');
      root.textContent = '';
      if (state.rooms.length === 0) {
        root.append(empty('No rooms'));
        return;
      }
      for (const item of state.rooms) {
        const button = document.createElement('button');
        button.className = 'room-item' + (item.room.id === selectedRoomId ? ' active' : '');
        button.type = 'button';
        button.onclick = () => { selectedRoomId = item.room.id; render(); };
        button.append(text('strong', item.room.name));
        button.append(text('span', item.room.id + ' | ' + item.members.length + ' members', 'meta'));
        root.append(button);
      }
    }

    function renderRoom() {
      const selected = state.rooms.find((item) => item.room.id === selectedRoomId);
      document.getElementById('composer').style.display = selected ? 'grid' : 'none';
      if (!selected) {
        document.getElementById('room-title').textContent = 'No room selected';
        document.getElementById('room-meta').textContent = '';
        document.getElementById('members').textContent = '';
        document.getElementById('invites').textContent = '';
        document.getElementById('messages').replaceChildren(empty('No transcript'));
        return;
      }
      document.getElementById('room-title').textContent = selected.room.name;
      document.getElementById('room-meta').textContent = selected.room.id + ' | ' + selected.room.policy.joinPolicy + ' | ' + selected.room.createdAt;
      const members = document.getElementById('members');
      members.textContent = '';
      for (const member of selected.members) {
        members.append(memberRow(selected.room.id, member));
      }
      const invites = document.getElementById('invites');
      invites.textContent = '';
      for (const invite of selected.invites || []) {
        invites.append(inviteRow(selected.room.id, invite));
      }
      const messages = document.getElementById('messages');
      messages.textContent = '';
      if (selected.messages.length === 0) {
        messages.append(empty('No messages'));
        return;
      }
      for (const message of selected.messages) {
        const box = document.createElement('article');
        box.className = 'message';
        const head = document.createElement('div');
        head.className = 'message-head';
        head.append(text('span', message.sender.type + ':' + message.sender.id + ' | ' + message.kind));
        head.append(text('span', message.createdAt));
        box.append(head);
        box.append(text('div', message.body, 'message-body'));
        for (const diagnostic of message.metadata?.routingDiagnostics || []) {
          box.append(text('div', diagnostic.message || diagnostic.code || 'Routing warning', 'routing-warning'));
        }
        messages.append(box);
      }
    }

    function memberRow(roomId, member) {
      const wrapper = document.createElement('div');
      wrapper.className = 'member-row';

      const main = document.createElement('div');
      main.className = 'member-main';
      main.append(text('div', member.actor.type + ':' + member.actor.id, 'member-title'));
      main.append(text('div', member.role + ' | ' + member.status, 'member-status ' + member.status));
      if (member.actor.displayName) {
        main.append(text('div', member.actor.displayName, 'member-meta'));
      }

      const controls = document.createElement('div');
      controls.className = 'member-controls';
      const aliasBox = document.createElement('div');
      aliasBox.className = 'member-control-line';
      const aliasInput = document.createElement('input');
      aliasInput.value = (member.aliases || []).join(', ');
      aliasInput.placeholder = 'aliases';
      aliasInput.setAttribute('aria-label', 'Aliases for ' + member.actor.id);
      aliasInput.dataset.roomId = roomId;
      aliasInput.dataset.actorId = member.actor.id;
      const saveAliases = document.createElement('button');
      saveAliases.type = 'button';
      saveAliases.textContent = 'Aliases';
      saveAliases.onclick = () => updateMemberAliases(roomId, member.actor.id, aliasInput.value);
      aliasBox.append(aliasInput, saveAliases);

      const selectBox = document.createElement('div');
      selectBox.className = 'member-selects';
      const roleSelect = select(['owner', 'moderator', 'participant', 'observer', 'executor', 'reviewer', 'approver'], member.role, 'Role for ' + member.actor.id);
      const statusSelect = select(['invited', 'pending', 'active', 'suspended', 'left', 'removed', 'expired'], member.status, 'Status for ' + member.actor.id);
      selectBox.append(roleSelect, statusSelect);

      const actionBox = document.createElement('div');
      actionBox.className = 'actions';
      const saveRole = document.createElement('button');
      saveRole.type = 'button';
      saveRole.textContent = 'Role';
      saveRole.onclick = () => updateMemberRole(roomId, member.actor.id, roleSelect.value);
      const saveStatus = document.createElement('button');
      saveStatus.type = 'button';
      saveStatus.textContent = 'Status';
      saveStatus.onclick = () => updateMemberStatus(roomId, member.actor.id, statusSelect.value);
      actionBox.append(saveRole, saveStatus);
      controls.append(aliasBox, selectBox, actionBox);

      wrapper.append(main, controls);
      return wrapper;
    }

    function inviteRow(roomId, invite) {
      const wrapper = document.createElement('div');
      wrapper.className = 'invite-row';
      const main = document.createElement('div');
      main.append(text('div', invite.id, 'invite-title'));
      main.append(text('div', invite.status + ' | ' + invite.role + ' | signature=' + (invite.signatureStatus || 'unknown') + ' | uses=' + invite.uses + '/' + invite.maxUses + ' | expires=' + invite.expiresAt, 'meta'));
      const controls = document.createElement('div');
      controls.className = 'actions';
      if (invite.status === 'active') {
        const revoke = document.createElement('button');
        revoke.type = 'button';
        revoke.className = 'danger';
        revoke.textContent = 'Revoke';
        revoke.onclick = () => revokeInvite(roomId, invite.id);
        controls.append(revoke);
      }
      wrapper.append(main, controls);
      return wrapper;
    }

    async function updateMemberAliases(roomId, actorId, rawAliases) {
      const aliases = rawAliases.split(',').map((value) => value.trim()).filter(Boolean);
      const response = await apiFetch('/api/rooms/' + encodeURIComponent(roomId) + '/members/' + encodeURIComponent(actorId) + '/aliases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: controlActor(), aliases })
      });
      if (!response.ok) {
        alert((await response.json()).error || 'Request failed');
        return;
      }
      await loadState();
    }

    async function updateMemberRole(roomId, actorId, role) {
      const response = await apiFetch('/api/rooms/' + encodeURIComponent(roomId) + '/members/' + encodeURIComponent(actorId) + '/role', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: controlActor(), role })
      });
      if (!response.ok) {
        alert((await response.json()).error || 'Request failed');
        return;
      }
      await loadState();
    }

    async function updateMemberStatus(roomId, actorId, status) {
      const response = await apiFetch('/api/rooms/' + encodeURIComponent(roomId) + '/members/' + encodeURIComponent(actorId) + '/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: controlActor(), status })
      });
      if (!response.ok) {
        alert((await response.json()).error || 'Request failed');
        return;
      }
      await loadState();
    }

    async function revokeInvite(roomId, inviteId) {
      const response = await apiFetch('/api/rooms/' + encodeURIComponent(roomId) + '/invites/' + encodeURIComponent(inviteId) + '/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: controlActor() })
      });
      if (!response.ok) {
        alert((await response.json()).error || 'Request failed');
        return;
      }
      await loadState();
    }

    function renderAgentHealth() {
      const root = document.getElementById('agent-health');
      root.textContent = '';
      const health = state.agentHealth;
      const operatorAgents = state.operator?.agents || [];
      if (!health || !health.agents) {
        root.append(empty('No agent health'));
        return;
      }
      const summary = document.createElement('div');
      summary.className = 'health-summary';
      summary.append(healthStat('Total', health.agents.total));
      summary.append(healthStat('Ready', health.agents.responsive));
      summary.append(healthStat('Failing', health.agents.failing));
      root.append(summary);

      const list = document.createElement('div');
      list.className = 'health-list';
      const agents = operatorAgents.slice(0, 8);
      if (agents.length === 0) {
        list.append(empty('No agents'));
      }
      for (const agent of agents) {
        list.append(operatorItem(agent));
      }
      root.append(list);
    }

    function healthStat(label, value) {
      const item = document.createElement('div');
      item.className = 'health-stat';
      item.append(text('strong', String(value ?? 0)));
      item.append(text('span', label, 'meta'));
      return item;
    }

    function renderWorkers() {
      const root = document.getElementById('workers');
      root.textContent = '';
      const workers = state.operator?.workers || [];
      if (workers.length === 0) {
        root.append(empty('No workers'));
        return;
      }
      for (const worker of workers.slice(0, 8)) {
        root.append(operatorItem(worker));
      }
    }

    function renderAssignments() {
      const root = document.getElementById('assignments');
      root.textContent = '';
      const assignments = state.operator?.assignments || [];
      if (assignments.length === 0) {
        root.append(empty('No assignments'));
        return;
      }
      for (const assignment of assignments.slice(0, 8)) {
        root.append(operatorItem(assignment));
      }
    }

    function renderSpecs() {
      const root = document.getElementById('specs');
      root.textContent = '';
      const specs = state.operator?.specs || [];
      if (specs.length === 0) {
        root.append(empty('No specs'));
        return;
      }
      for (const spec of specs.slice(0, 8)) {
        root.append(operatorItem(spec));
      }
    }

    function renderScheduler() {
      const root = document.getElementById('scheduler');
      root.textContent = '';
      const ticks = state.operator?.scheduler || [];
      if (ticks.length === 0) {
        root.append(empty('No scheduler ticks'));
        return;
      }
      for (const tick of ticks.slice(0, 5)) {
        root.append(operatorItem(tick));
      }
    }

    function renderArtifacts() {
      const root = document.getElementById('artifacts');
      root.textContent = '';
      const artifacts = state.operator?.artifacts || [];
      if (artifacts.length === 0) {
        root.append(empty('No artifacts'));
        return;
      }
      for (const artifact of artifacts.slice(0, 8)) {
        root.append(operatorItem(artifact));
      }
    }

    function renderRetention() {
      const root = document.getElementById('retention');
      root.textContent = '';
      const policies = state.operator?.retention || [];
      if (policies.length === 0) {
        root.append(empty('No retention policies'));
        return;
      }
      for (const policy of policies.slice(0, 8)) {
        root.append(operatorItem(policy));
      }
    }

    function renderAudit() {
      const root = document.getElementById('audit');
      root.textContent = '';
      const events = state.operator?.audit || [];
      if (events.length === 0) {
        root.append(empty('No audit events'));
        return;
      }
      for (const event of events.slice(0, 8)) {
        root.append(operatorItem(event));
      }
    }

    function renderOperator() {
      const root = document.getElementById('operator');
      root.textContent = '';
      const operator = state.operator;
      if (!operator) {
        root.append(empty('No operator model'));
        return;
      }
      const summary = document.createElement('div');
      summary.className = 'operator-summary';
      summary.append(operatorStat('Critical', operator.summary?.critical));
      summary.append(operatorStat('Warning', operator.summary?.warning));
      summary.append(operatorStat('Waiting', operator.summary?.waitingForApproval));
      summary.append(operatorStat('Queued', operator.summary?.queued));
      root.append(summary);
      if (operator.queue) {
        root.append(operatorItem(operator.queue));
      }
    }

    function operatorStat(label, value) {
      const item = document.createElement('div');
      item.className = 'operator-stat';
      item.append(text('strong', String(value ?? 0)));
      item.append(text('span', label, 'meta'));
      return item;
    }

    function operatorItem(item) {
      const card = document.createElement('div');
      card.className = 'operator-card ' + (item.severity || 'info');
      card.append(row(item.label || item.id, item.status, 'status ' + item.status));
      card.append(text('div', item.reason || '', 'meta'));
      if (item.nextAction) {
        card.append(text('div', item.nextAction, 'meta'));
      }
      const actions = document.createElement('div');
      actions.className = 'actions';
      const detail = document.createElement('button');
      detail.type = 'button';
      detail.textContent = 'Detail';
      detail.onclick = () => loadOperatorDetail(item.id);
      actions.append(detail);
      if (item.kind === 'mcp' && item.refs?.serverId) {
        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.textContent = 'Refresh MCP';
        refresh.onclick = () => refreshMcpHealth(item.refs.serverId);
        actions.append(refresh);
      }
      card.append(actions);
      return card;
    }

    async function refreshMcpHealth(serverId) {
      const response = await apiFetch('/api/operator/mcp/' + encodeURIComponent(serverId) + '/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: controlActor(), timeoutMs: 2000 })
      });
      if (!response.ok) {
        alert((await response.json()).error || 'Request failed');
        return;
      }
      const payload = await response.json();
      await loadState();
      await loadOperatorDetail('mcp:' + payload.result.serverId);
    }

    async function loadOperatorDetail(itemId) {
      selectedOperatorItemId = itemId;
      selectedOperatorDetail = { loading: true, itemId };
      renderOperatorDetail();
      const response = await apiFetch('/api/operator/items/' + encodeURIComponent(itemId));
      if (!response.ok) {
        selectedOperatorDetail = { error: (await response.json()).error || 'Request failed', itemId };
        renderOperatorDetail();
        return;
      }
      selectedOperatorDetail = (await response.json()).detail;
      renderOperatorDetail();
    }

    function renderOperatorDetail() {
      const root = document.getElementById('operator-detail');
      root.textContent = '';
      if (!selectedOperatorDetail) {
        return;
      }
      const panel = document.createElement('div');
      panel.className = 'operator-detail';
      if (selectedOperatorDetail.loading) {
        panel.append(row(selectedOperatorDetail.itemId, 'loading', 'status running'));
        root.append(panel);
        return;
      }
      if (selectedOperatorDetail.error) {
        panel.append(row(selectedOperatorDetail.itemId, 'failed', 'status failed'));
        panel.append(text('div', selectedOperatorDetail.error, 'meta'));
        root.append(panel);
        return;
      }
      const item = selectedOperatorDetail.item;
      const head = document.createElement('div');
      head.className = 'operator-detail-head';
      head.append(row(item?.label || item?.id || selectedOperatorItemId || 'operator item', item?.status || 'unknown', 'status ' + (item?.status || 'unknown')));
      head.append(text('div', (item?.kind || 'operator') + ' | ' + (item?.id || selectedOperatorItemId || '-') + ' | matchedBy=' + (selectedOperatorDetail.matchedBy || '-'), 'meta'));
      if (item?.reason) {
        head.append(text('div', item.reason, 'meta'));
      }
      if (item?.nextAction) {
        head.append(text('div', item.nextAction, 'meta'));
      }
      panel.append(head);
      const sourceNames = Object.keys(selectedOperatorDetail.sources || {});
      if (sourceNames.length > 0) {
        panel.append(text('div', 'sources=' + sourceNames.join(', '), 'meta'));
      }
      if ((selectedOperatorDetail.missingRefs || []).length > 0) {
        panel.append(text('div', 'missing=' + selectedOperatorDetail.missingRefs.join(', '), 'meta'));
      }
      const detailSections = selectedOperatorDetail.detailSections || [];
      const sectionGrid = document.createElement('div');
      sectionGrid.className = 'operator-detail-grid';
      for (const section of detailSections) {
        const sectionNode = operatorDetailSection(section);
        sectionGrid.append(sectionNode);
      }
      if (detailSections.length > 0) {
        panel.append(sectionGrid);
      }
      const summaries = selectedOperatorDetail.sourceSummaries || [];
      if (summaries.length > 0) {
        const list = document.createElement('div');
        list.className = 'operator-source-list';
        list.append(text('strong', 'Sources'));
        for (const summary of summaries) {
          list.append(operatorSourceSummary(summary));
        }
        panel.append(list);
      }
      const raw = document.createElement('details');
      raw.className = 'operator-raw-sources';
      raw.append(text('summary', 'Raw source records'));
      raw.append(text('pre', JSON.stringify(selectedOperatorDetail.sources || {}, null, 2)));
      panel.append(raw);
      root.append(panel);
    }

    function operatorDetailSection(section) {
      const sectionNode = document.createElement('div');
      const important = section.title === 'Overview' || section.title === 'Worker' || section.title === 'Agent' || section.title === 'Assignment' || section.title === 'Specification' || section.title === 'MCP';
      sectionNode.className = 'operator-detail-section' + (important ? ' priority' : '');
      sectionNode.append(text('h4', section.title || 'Detail'));
      for (const rowItem of section.rows || []) {
        const line = document.createElement('div');
        line.className = 'operator-detail-row';
        line.append(text('span', rowItem.label || '-'));
        line.append(text('span', rowItem.value || '-'));
        sectionNode.append(line);
      }
      return sectionNode;
    }

    function operatorSourceSummary(summary) {
      const line = document.createElement('div');
      line.className = 'operator-source-row';
      line.append(row(summary.source || 'source', summary.status || summary.kind || '-', 'status ' + (summary.status || summary.kind || 'unknown')));
      const parts = [];
      if (summary.id) parts.push(summary.id);
      if (summary.count !== undefined) parts.push('count=' + summary.count);
      if (summary.updatedAt) parts.push(summary.updatedAt);
      if (summary.label) parts.push(summary.label);
      line.append(text('div', parts.join(' | '), 'meta'));
      return line;
    }

    function renderApprovals() {
      const root = document.getElementById('approvals');
      root.textContent = '';
      const operatorApprovals = state.operator?.approvals || [];
      const approvals = state.approvals.filter((approval) => approval.status === 'pending');
      if (approvals.length === 0) {
        root.append(empty('No pending approvals'));
        return;
      }
      for (const approval of approvals) {
        const view = operatorApprovals.find((item) => item.id === approval.id);
        const item = document.createElement('div');
        item.className = 'approval';
        item.append(row(approval.id, view?.status || approval.status, 'status ' + (view?.status || approval.status)));
        item.append(text('div', view?.label || approval.toolName || approval.action));
        item.append(text('div', view?.reason || approval.reason, 'meta'));
        if (view?.nextAction) {
          item.append(text('div', view.nextAction, 'meta'));
        }
        const controls = document.createElement('div');
        controls.className = 'row';
        const approve = document.createElement('button');
        approve.className = 'primary';
        approve.type = 'button';
        approve.textContent = 'Approve';
        approve.onclick = () => decideApproval(approval.id, 'approve', true);
        const deny = document.createElement('button');
        deny.className = 'danger';
        deny.type = 'button';
        deny.textContent = 'Deny';
        deny.onclick = () => decideApproval(approval.id, 'deny', false);
        controls.append(approve, deny);
        item.append(controls);
        root.append(item);
      }
    }

    function renderSessions() {
      const root = document.getElementById('sessions');
      root.textContent = '';
      const operatorSessions = state.operator?.sessions || [];
      const visibleSessionIds = new Set(state.sessions.map((session) => session.id));
      if (selectedSessionInspectionId && !visibleSessionIds.has(selectedSessionInspectionId)) {
        selectedSessionInspection = null;
        selectedSessionInspectionId = null;
      }
      if (state.sessions.length === 0) {
        root.append(empty('No sessions'));
        return;
      }
      for (const session of state.sessions.slice(0, 12)) {
        const view = operatorSessions.find((item) => item.id === session.id);
        const item = document.createElement('div');
        item.className = 'session';
        item.append(row(session.id, view?.status || session.status, 'status ' + (view?.status || session.status)));
        item.append(text('div', view?.label || session.objective));
        item.append(text('div', view?.reason || session.updatedAt, 'meta'));
        if (view?.nextAction) {
          item.append(text('div', view.nextAction, 'meta'));
        }
        const controls = sessionActions(session);
        if (controls.childElementCount > 0) {
          item.append(controls);
        }
        root.append(item);
      }
    }

    function sessionActions(session) {
      const controls = document.createElement('div');
      controls.className = 'actions';
      const inspect = document.createElement('button');
      inspect.type = 'button';
      inspect.textContent = 'Inspect';
      inspect.onclick = () => loadSessionInspection(session.id);
      controls.append(inspect);
      if (session.status === 'created' || session.status === 'running' || session.status === 'failed') {
        controls.append(sessionActionButton(session.id, 'pause', 'Pause'));
      }
      if (session.status === 'paused' || session.status === 'failed') {
        controls.append(sessionActionButton(session.id, 'resume', 'Resume', 'primary'));
      }
      if (session.status !== 'completed' && session.status !== 'cancelled') {
        controls.append(sessionActionButton(session.id, 'cancel', 'Cancel', 'danger'));
      }
      return controls;
    }

    function sessionActionButton(sessionId, action, label, className) {
      const button = document.createElement('button');
      button.type = 'button';
      if (className) button.className = className;
      button.textContent = label;
      button.onclick = () => changeSessionState(sessionId, action);
      return button;
    }

    async function loadSessionInspection(sessionId) {
      const response = await apiFetch('/api/sessions/' + encodeURIComponent(sessionId) + '/inspect');
      if (!response.ok) {
        alert((await response.json()).error || 'Request failed');
        return;
      }
      selectedSessionInspection = await response.json();
      selectedSessionInspectionId = sessionId;
      renderSessionInspection();
    }

    function renderSessionInspection() {
      const root = document.getElementById('session-inspection');
      root.textContent = '';
      if (!selectedSessionInspection) {
        root.append(empty('No session inspected'));
        return;
      }
      const view = selectedSessionInspection;
      const panel = document.createElement('div');
      panel.className = 'session-inspection';
      const head = document.createElement('div');
      head.className = 'session-inspection-head';
      head.append(row(view.session?.id || selectedSessionInspectionId || 'session', view.summary?.inspectionState || 'unknown', 'status ' + (view.summary?.inspectionState || 'unknown')));
      head.append(text('div', (view.summary?.outcome || '-') + ' | ' + (view.summary?.status || '-') + ' | target=' + (view.summary?.targetMode || '-'), 'meta'));
      if (view.session?.objective) {
        head.append(text('div', view.session.objective, 'meta'));
      }
      panel.append(head);
      panel.append(text('div', view.summary?.inspectionSummary || view.inspection?.summary || '-', 'meta'));
      const focusPaths = view.summary?.inspectionFocusPaths || view.inspection?.focusPaths || [];
      panel.append(text('div', 'focus=' + (focusPaths.length > 0 ? focusPaths.join(', ') : '-'), 'meta'));

      const issues = view.inspection?.issues || [];
      const issuesSection = document.createElement('div');
      issuesSection.className = 'session-inspection-section';
      issuesSection.append(text('strong', 'Issues'));
      const issueList = document.createElement('div');
      issueList.className = 'session-inspection-list';
      if (issues.length === 0) {
        issueList.append(empty('No inspection issues'));
      } else {
        for (const issue of issues) {
          issueList.append(sessionInspectionItem(issue.label || issue.id || 'issue', issue.severity || 'info', issue.summary || '-', issue.command));
        }
      }
      issuesSection.append(issueList);
      panel.append(issuesSection);

      const actions = view.nextActions || [];
      const actionsSection = document.createElement('div');
      actionsSection.className = 'session-inspection-section';
      actionsSection.append(text('strong', 'Next actions'));
      const actionList = document.createElement('div');
      actionList.className = 'session-inspection-list';
      if (actions.length === 0) {
        actionList.append(empty('No next actions'));
      } else {
        for (const action of actions) {
          actionList.append(sessionInspectionItem(action.label || action.id || 'action', action.status || 'optional', action.reason || '-', action.command));
        }
      }
      actionsSection.append(actionList);
      panel.append(actionsSection);
      root.append(panel);
    }

    function sessionInspectionItem(label, status, summary, command) {
      const item = document.createElement('div');
      item.className = 'session-inspection-item';
      item.append(row(label, status, 'status ' + status));
      item.append(text('div', summary, 'meta'));
      if (command) {
        item.append(text('div', command, 'meta'));
      }
      return item;
    }

    async function changeSessionState(sessionId, action) {
      const response = await apiFetch('/api/sessions/' + encodeURIComponent(sessionId) + '/' + action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: controlActor(), reason: 'web ' + action })
      });
      if (!response.ok) {
        alert((await response.json()).error || 'Request failed');
        return;
      }
      await loadState();
    }

    async function decideApproval(id, decision, autoResume) {
      const response = await apiFetch('/api/approvals/' + encodeURIComponent(id) + '/' + decision, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: controlActor(), reason: 'web decision', autoReplay: autoResume, autoResume })
      });
      if (!response.ok) {
        alert((await response.json()).error || 'Request failed');
      }
      await loadState();
    }

    document.getElementById('composer').addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = document.getElementById('message-body').value.trim();
      if (!selectedRoomId || !body) return;
      const response = await apiFetch('/api/rooms/' + encodeURIComponent(selectedRoomId) + '/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: controlActor(), kind: document.getElementById('message-kind').value, body })
      });
      if (!response.ok) {
        alert((await response.json()).error || 'Request failed');
      }
      document.getElementById('message-body').value = '';
      await loadState();
    });

    document.getElementById('refresh').onclick = loadState;
    setInterval(loadState, 5000);
    loadState();

    function row(left, right, className) {
      const wrapper = document.createElement('div');
      wrapper.className = 'row';
      wrapper.append(text('strong', left));
      wrapper.append(text('span', right, className));
      return wrapper;
    }

    function text(tag, value, className) {
      const el = document.createElement(tag);
      if (className) el.className = className;
      el.textContent = value || '';
      return el;
    }

    function select(values, selected, label) {
      const node = document.createElement('select');
      node.setAttribute('aria-label', label);
      for (const value of values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = value === selected;
        node.append(option);
      }
      return node;
    }

    function controlActor() {
      return document.getElementById('control-actor').value.trim() || 'user:local-user';
    }

    function empty(value) {
      return text('div', value, 'empty');
    }
  </script>
</body>
</html>`;
}

