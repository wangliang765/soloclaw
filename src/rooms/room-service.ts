import type { ActorRef, Room, RoomInvite, RoomMember, RoomMemberStatus, RoomMessage, RoomPolicy, RoomRole } from "../domain/index.js";

export type CreateRoomInput = {
  name: string;
  projectId?: string;
  policy: RoomPolicy;
  createdBy: ActorRef;
  memberAliases?: string[];
};

export type CreateRoomInviteInput = {
  roomId: string;
  createdBy: ActorRef;
  role?: RoomMember["role"];
  ttlHours?: number;
  maxUses?: number;
};

export type CreatedRoomInvite = {
  invite: RoomInvite;
  token: string;
};

export interface RoomService {
  createRoom(input: CreateRoomInput): Promise<Room>;
  getRoom(roomId: string): Promise<Room | undefined>;
  listRooms(limit?: number): Promise<Room[]>;
  listMembers(roomId: string): Promise<RoomMember[]>;
  createInvite(input: CreateRoomInviteInput): Promise<CreatedRoomInvite>;
  listInvites(roomId: string): Promise<RoomInvite[]>;
  revokeInvite(roomId: string, inviteId: string, revokedBy: ActorRef): Promise<RoomInvite>;
  requestJoin(roomId: string, actor: ActorRef, role: RoomMember["role"], aliases?: string[]): Promise<RoomMember>;
  joinWithInvite(roomId: string, token: string, actor: ActorRef, aliases?: string[]): Promise<RoomMember>;
  verifyInvite(invite: RoomInvite): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid">;
  approveJoin(roomId: string, actorId: string, approvedBy: ActorRef): Promise<RoomMember>;
  updateMemberAliases(roomId: string, actorId: string, aliases: string[], updatedBy: ActorRef): Promise<RoomMember>;
  updateMemberRole(roomId: string, actorId: string, role: RoomRole, updatedBy: ActorRef): Promise<RoomMember>;
  updateMemberStatus(roomId: string, actorId: string, status: RoomMemberStatus, updatedBy: ActorRef): Promise<RoomMember>;
  assertCapability(roomId: string, actor: ActorRef, capability: import("./room-capabilities.js").RoomCapability): Promise<void>;
  sendMessage(input: Omit<RoomMessage, "id" | "createdAt">): Promise<RoomMessage>;
  listMessages(roomId: string, limit?: number): Promise<RoomMessage[]>;
  verifyMessage(message: RoomMessage): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid">;
}
