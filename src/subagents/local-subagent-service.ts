import type { ActorRef, ExecutionMode, Session, SessionId, Subtask, TaskRisk } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentLoop } from "../core/agent-loop.js";
import type { LocalAgentIdentityService } from "../identity/local-agent-identity-service.js";
import type { AgentStore } from "../store/agent-store.js";

export type DelegateSubtaskInput = {
  objective: string;
  parentSessionId?: string;
  roomId?: string;
  assignedAgentId?: string;
  createdBy: ActorRef;
  risk?: TaskRisk;
  executionMode?: ExecutionMode;
};

export type DelegateSubtaskResult = {
  subtask: Subtask;
  childSession?: Session;
  summary: string;
};

export class LocalSubagentService {
  constructor(
    private readonly store: AgentStore,
    private readonly createAgent: () => AgentLoop | Promise<AgentLoop>,
    private readonly defaultAssignedAgentId = "local-child-agent",
    private readonly identity?: LocalAgentIdentityService,
  ) {}

  async delegate(input: DelegateSubtaskInput): Promise<DelegateSubtaskResult> {
    const now = new Date().toISOString();
    let subtask: Subtask = {
      id: makeId<"ArtifactId">("subtask"),
      parentSessionId: input.parentSessionId as Subtask["parentSessionId"],
      roomId: input.roomId,
      assignedAgentId: input.assignedAgentId ?? this.defaultAssignedAgentId,
      objective: input.objective,
      status: "running",
      risk: input.risk ?? "medium",
      executionMode: input.executionMode ?? "trusted",
      createdBy: input.createdBy,
      artifactRefs: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.store.createSubtask(subtask);
    if (input.roomId) {
      await this.ensureAssignedAgentRoomMember(input.roomId, subtask.assignedAgentId ?? this.defaultAssignedAgentId);
      await this.appendRoomEvent({
        roomId: input.roomId,
        sender: input.createdBy,
        kind: "task",
        body: `Subtask ${subtask.id} assigned to ${subtask.assignedAgentId}: ${subtask.objective}`,
      });
    }

    try {
      const agent = await this.createAgent();
      const child = await agent.runWithSession(input.objective);
      const completedAt = new Date().toISOString();
      subtask = {
        ...subtask,
        childSessionId: child.session?.id,
        status: "completed",
        resultSummary: compactSummary(child.finalAnswer),
        updatedAt: completedAt,
        completedAt,
      };
      await this.store.updateSubtask(subtask);
      if (input.roomId) {
        const assignedAgent = await this.agentActor(subtask.assignedAgentId ?? this.defaultAssignedAgentId);
        await this.appendRoomEvent({
          roomId: input.roomId,
          sender: assignedAgent,
          kind: "decision",
          body: `Subtask ${subtask.id} completed. Child session: ${child.session?.id ?? "none"}.\n\n${subtask.resultSummary ?? ""}`,
        });
      }

      if (input.parentSessionId && child.session) {
        await this.store.createSessionLink({
          id: makeId<"MessageId">("link"),
          type: "parent_child",
          fromSessionId: input.parentSessionId as SessionId,
          toSessionId: child.session.id,
          roomId: input.roomId,
          metadata: {
            subtaskId: subtask.id,
          },
          createdAt: completedAt,
        });
      }

      return {
        subtask,
        childSession: child.session,
        summary: subtask.resultSummary ?? "",
      };
    } catch (error) {
      const failedAt = new Date().toISOString();
      subtask = {
        ...subtask,
        status: "failed",
        resultSummary: error instanceof Error ? error.message : String(error),
        updatedAt: failedAt,
        completedAt: failedAt,
      };
      await this.store.updateSubtask(subtask);
      if (input.roomId) {
        const assignedAgent = await this.agentActor(subtask.assignedAgentId ?? this.defaultAssignedAgentId);
        await this.appendRoomEvent({
          roomId: input.roomId,
          sender: assignedAgent,
          kind: "system",
          body: `Subtask ${subtask.id} failed: ${subtask.resultSummary ?? ""}`,
        });
      }
      return {
        subtask,
        summary: subtask.resultSummary ?? "",
      };
    }
  }

  private async appendRoomEvent(input: {
    roomId: string;
    sender: ActorRef;
    kind: "task" | "decision" | "system";
    body: string;
  }): Promise<void> {
    const unsigned = {
      id: makeId<"MessageId">("msg"),
      roomId: input.roomId as Subtask["roomId"] & Parameters<AgentStore["appendRoomMessage"]>[0]["roomId"],
      sender: input.sender,
      kind: input.kind,
      body: input.body,
      createdAt: new Date().toISOString(),
      artifactRefs: [],
    };
    const signature = await this.identity?.signRoomMessage(unsigned);
    await this.store.appendRoomMessage(signature ? { ...unsigned, signature } : unsigned);
  }

  private async ensureAssignedAgentRoomMember(roomId: string, assignedAgentId: string): Promise<void> {
    const room = await this.store.getRoom(roomId);
    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }
    const members = await this.store.listRoomMembers(roomId);
    const existing = members.find((member) => member.actor.type === "agent" && member.actor.id === assignedAgentId);
    const registered = await this.store.getAgent(assignedAgentId);
    const joinedAt = existing?.joinedAt ?? new Date().toISOString();
    await this.store.updateRoomMember({
      roomId: room.id,
      actor: {
        type: "agent",
        id: assignedAgentId,
        displayName: registered?.displayName ?? assignedAgentId,
      },
      role: "executor",
      status: "active",
      joinedAt,
    });
  }

  private async agentActor(agentId: string): Promise<ActorRef> {
    const registered = await this.store.getAgent(agentId);
    return {
      type: "agent",
      id: agentId,
      displayName: registered?.displayName ?? agentId,
    };
  }
}

function compactSummary(value: string): string {
  return value.length > 2000 ? `${value.slice(0, 2000)}\n[truncated]` : value;
}
