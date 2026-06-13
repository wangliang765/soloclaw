import type { ActorRef, AuditEvent } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { RegisteredTool, ToolResult } from "../protocol/types.js";
import type { AgentStore } from "../store/agent-store.js";

export type ReplayApprovedToolInput = {
  approvalId: string;
  tools: RegisteredTool[];
  store: AgentStore;
  actor: ActorRef;
};

export async function replayApprovedTool(input: ReplayApprovedToolInput): Promise<ToolResult> {
  const pending = await input.store.getPendingToolCallByApproval(input.approvalId);
  if (!pending) {
    return failure("pending_tool_not_found", `No pending tool call for approval: ${input.approvalId}`);
  }
  if (pending.status !== "approved") {
    return failure("approval_not_approved", `Approval ${input.approvalId} is not approved. Current status: ${pending.status}`);
  }

  const tool = input.tools.find((candidate) => candidate.name === pending.toolName);
  if (!tool) {
    return failure("tool_not_found", `No tool registered named ${pending.toolName}`);
  }

  await audit(input.store, input.actor, "tool.approved", `Replaying approved tool ${pending.toolName}`, {
    approvalId: input.approvalId,
    pendingToolCallId: pending.id,
    tool: pending.toolName,
  });

  const rawResult = await tool.handler(pending.input);
  const result: ToolResult = {
    ...rawResult,
    callId: pending.toolCallId ?? rawResult.callId,
  };
  await input.store.updatePendingToolCallStatus(pending.id, result.ok ? "executed" : "failed", JSON.stringify(result));
  if (pending.sessionId) {
    await input.store.appendMessage({
      sessionId: pending.sessionId,
      message: {
        role: "tool",
        content: JSON.stringify(result),
        toolResult: result,
      },
    });
    await input.store.recordToolCall({ sessionId: pending.sessionId, result });
  }
  await appendReplayRoomEvent(input.store, input.actor, input.approvalId, {
    toolName: pending.toolName,
    ok: result.ok,
    error: result.error?.message,
  });
  await audit(input.store, input.actor, result.ok ? "tool.completed" : "tool.denied", `Replayed tool ${pending.toolName}`, {
    approvalId: input.approvalId,
    pendingToolCallId: pending.id,
    tool: pending.toolName,
    ok: result.ok,
    error: result.error,
  });
  return result;
}

async function appendReplayRoomEvent(
  store: AgentStore,
  actor: ActorRef,
  approvalId: string,
  result: { toolName: string; ok: boolean; error?: string },
): Promise<void> {
  const approval = (await store.listApprovalRequests()).find((candidate) => candidate.id === approvalId);
  if (!approval?.roomId) {
    return;
  }
  await store.appendRoomMessage({
    id: makeId<"MessageId">("msg"),
    roomId: approval.roomId as Parameters<AgentStore["appendRoomMessage"]>[0]["roomId"],
    sender: actor,
    kind: "approval",
    body: `Approved tool replay ${result.ok ? "completed" : "failed"}: ${approvalId}\nTool: ${result.toolName}${result.error ? `\nError: ${result.error}` : ""}`,
    createdAt: new Date().toISOString(),
    artifactRefs: [],
  });
}

function failure(code: string, message: string): ToolResult {
  return {
    callId: "replay",
    ok: false,
    error: {
      code,
      message,
    },
  };
}

async function audit(store: AgentStore, actor: ActorRef, type: AuditEvent["type"], summary: string, metadata: Record<string, unknown>) {
  await store.recordAuditEvent({
    id: makeId<"ArtifactId">("audit"),
    type,
    actor,
    summary,
    metadata,
    createdAt: new Date().toISOString(),
  });
}
