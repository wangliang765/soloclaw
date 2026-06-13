import type { AgentIdentity, Room, RoomMember } from "../domain/index.js";

export type RoomMentionHandle = {
  value: string;
  kind: "typed_actor" | "actor_id" | "alias" | "role" | "wide";
  wakesAgent: boolean;
  stable: boolean;
};

export type RoomRosterEntry = {
  actor: RoomMember["actor"];
  role: RoomMember["role"];
  status: RoomMember["status"];
  aliases: string[];
  mentionHandles: RoomMentionHandle[];
  canWakeAgent: boolean;
  wakeStatus: "wakeable" | "not_agent" | "inactive";
  agent?: Pick<
    AgentIdentity,
    "id" | "machineId" | "displayName" | "fingerprint" | "trustStatus" | "heartbeatStatus" | "lastHeartbeatAt" | "heartbeatExpiresAt" | "lastRoomId"
  >;
};

export type RoomRoster = {
  room: Pick<Room, "id" | "name" | "policy">;
  generatedAt: string;
  entries: RoomRosterEntry[];
  wideHandles: RoomMentionHandle[];
};

export function buildRoomRoster(input: { room: Room; members: RoomMember[]; agents?: AgentIdentity[]; generatedAt?: string }): RoomRoster {
  const agentsById = new Map((input.agents ?? []).map((agent) => [agent.id as string, agent]));
  return {
    room: {
      id: input.room.id,
      name: input.room.name,
      policy: input.room.policy,
    },
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    entries: input.members.map((member) => buildRoomRosterEntry(member, agentsById.get(member.actor.id))),
    wideHandles: buildWideHandles(input.room.policy.wideMentionPolicy ?? "moderators"),
  };
}

function buildRoomRosterEntry(member: RoomMember, agent?: AgentIdentity): RoomRosterEntry {
  const aliases = member.aliases ?? [];
  const wakesAgent = member.actor.type === "agent" && member.status === "active";
  return {
    actor: member.actor,
    role: member.role,
    status: member.status,
    aliases,
    mentionHandles: [
      {
        value: `@${member.actor.type}:${member.actor.id}`,
        kind: "typed_actor",
        wakesAgent,
        stable: true,
      },
      {
        value: `@${member.actor.id}`,
        kind: "actor_id",
        wakesAgent,
        stable: true,
      },
      ...aliases.map((alias) => ({
        value: `@${alias}`,
        kind: "alias" as const,
        wakesAgent,
        stable: false,
      })),
      {
        value: `@role:${member.role}`,
        kind: "role",
        wakesAgent,
        stable: false,
      },
    ],
    canWakeAgent: wakesAgent,
    wakeStatus: member.actor.type !== "agent" ? "not_agent" : member.status === "active" ? "wakeable" : "inactive",
    agent: agent
      ? {
          id: agent.id,
          machineId: agent.machineId,
          displayName: agent.displayName,
          fingerprint: agent.fingerprint,
          trustStatus: agent.trustStatus,
          heartbeatStatus: agent.heartbeatStatus,
          lastHeartbeatAt: agent.lastHeartbeatAt,
          heartbeatExpiresAt: agent.heartbeatExpiresAt,
          lastRoomId: agent.lastRoomId,
        }
      : undefined,
  };
}

function buildWideHandles(policy: "disabled" | "moderators" | "members"): RoomMentionHandle[] {
  return [
    {
      value: "@all",
      kind: "wide",
      wakesAgent: policy !== "disabled",
      stable: false,
    },
  ];
}
