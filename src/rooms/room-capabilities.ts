import type { ActorRef, RoomMember } from "../domain/index.js";

export type RoomCapability =
  | "room.message.send"
  | "room.route.broadcast"
  | "room.member.invite"
  | "room.member.approve"
  | "room.member.alias"
  | "room.member.role"
  | "room.member.status"
  | "room.delivery.ack"
  | "task.delegate"
  | "tool.request"
  | "tool.approve";

const ROLE_CAPABILITIES: Record<RoomMember["role"], RoomCapability[]> = {
  owner: ["room.message.send", "room.route.broadcast", "room.member.invite", "room.member.approve", "room.member.alias", "room.member.role", "room.member.status", "room.delivery.ack", "task.delegate", "tool.request", "tool.approve"],
  moderator: ["room.message.send", "room.route.broadcast", "room.member.invite", "room.member.approve", "room.member.alias", "room.member.status", "room.delivery.ack", "task.delegate", "tool.request"],
  approver: ["room.message.send", "tool.approve"],
  reviewer: ["room.message.send", "tool.request"],
  executor: ["room.message.send", "task.delegate", "tool.request"],
  participant: ["room.message.send", "tool.request"],
  observer: [],
};

export function memberHasCapability(member: RoomMember | undefined, capability: RoomCapability): boolean {
  if (!member || member.status !== "active") {
    return false;
  }
  return ROLE_CAPABILITIES[member.role].includes(capability);
}

export function assertRoomCapability(member: RoomMember | undefined, actor: ActorRef, capability: RoomCapability): void {
  if (!memberHasCapability(member, capability)) {
    throw new Error(`Actor lacks room capability ${capability}: ${actor.type}:${actor.id}`);
  }
}

export function roleCapabilities(role: RoomMember["role"]): RoomCapability[] {
  return ROLE_CAPABILITIES[role];
}
