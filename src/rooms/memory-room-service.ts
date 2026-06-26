import { createHash, randomBytes } from "node:crypto";
import { DEFAULT_ROOM_WIDE_MENTION_POLICY } from "../domain/index.js";
import type { ActorRef, Room, RoomInvite, RoomMember, RoomMemberStatus, RoomMessage, RoomRole } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { LocalAgentIdentityService } from "../identity/local-agent-identity-service.js";
import type { AgentStore } from "../store/agent-store.js";
import { assertRoomCapability, memberHasCapability, type RoomCapability } from "./room-capabilities.js";
import { buildRoomMessageRouting, buildRoomRoutingDiagnostics, countRoutedAgentTargets, hasWideRoomRouting, normalizeMentionAlias } from "./message-routing.js";
import type { AcceptRoomAgentInvitationInput, CreateRoomInput, CreateRoomInviteInput, CreatedRoomInvite, InviteRoomAgentInput, RoomService } from "./room-service.js";

export class MemoryRoomService implements RoomService {
  constructor(
    private readonly store: AgentStore,
    private readonly identity?: LocalAgentIdentityService,
  ) {}

  async createRoom(input: CreateRoomInput): Promise<Room> {
    const room: Room = {
      id: makeId<"RoomId">("room"),
      name: input.name,
      projectId: input.projectId,
      policy: input.policy,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };
    await this.store.createRoom(room);
    const owner: RoomMember = {
      roomId: room.id,
      actor: input.createdBy,
      aliases: this.normalizeMemberAliases(input.memberAliases ?? [], []),
      role: "owner",
      status: "active",
      joinedAt: room.createdAt,
    };
    await this.store.addRoomMember(owner);
    return room;
  }

  async getRoom(roomId: string): Promise<Room | undefined> {
    return this.store.getRoom(roomId);
  }

  async listRooms(limit?: number): Promise<Room[]> {
    return this.store.listRooms(limit);
  }

  async listMembers(roomId: string): Promise<RoomMember[]> {
    return this.store.listRoomMembers(roomId);
  }

  async createInvite(input: CreateRoomInviteInput): Promise<CreatedRoomInvite> {
    const room = await this.store.getRoom(input.roomId);
    if (!room) {
      throw new Error(`Room not found: ${input.roomId}`);
    }
    await this.assertCapability(input.roomId, input.createdBy, "room.member.invite");
    const now = new Date();
    const token = `rinv_${randomBytes(24).toString("base64url")}`;
    const invite = {
      id: makeId<"RoomInviteId">("rinv"),
      roomId: room.id,
      tokenHash: hashInviteToken(token),
      createdBy: input.createdBy,
      role: input.role ?? "participant",
      status: "active" as const,
      maxUses: input.maxUses ?? 1,
      uses: 0,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (input.ttlHours ?? 24) * 60 * 60 * 1000).toISOString(),
    };
    const envelope = await this.createSignedInviteEnvelope(invite);
    const signedInvite = envelope ? { ...invite, envelope } : invite;
    await this.store.createRoomInvite(signedInvite);
    return { invite: signedInvite, token };
  }

  async listInvites(roomId: string) {
    return this.store.listRoomInvites(roomId);
  }

  async revokeInvite(roomId: string, inviteId: string, revokedBy: ActorRef) {
    const room = await this.store.getRoom(roomId);
    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }
    await this.assertCapability(roomId, revokedBy, "room.member.invite");
    const invite = (await this.store.listRoomInvites(roomId)).find((candidate) => candidate.id === inviteId);
    if (!invite) {
      throw new Error(`Room invite not found: ${inviteId}`);
    }
    if (invite.status === "revoked") {
      return invite;
    }
    const previousStatus = invite.status;
    const revoked = { ...invite, status: "revoked" as const };
    await this.store.updateRoomInvite(revoked);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "room.invite.revoked",
      actor: revokedBy,
      roomId: room.id,
      summary: "Room invite revoked",
      metadata: {
        inviteId: invite.id,
        role: invite.role,
        previousStatus,
        uses: invite.uses,
        maxUses: invite.maxUses,
        expiresAt: invite.expiresAt,
      },
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
    return revoked;
  }

  async inviteAgent(input: InviteRoomAgentInput): Promise<RoomMember> {
    const room = await this.store.getRoom(input.roomId);
    if (!room) {
      throw new Error(`Room not found: ${input.roomId}`);
    }
    await this.assertCapability(input.roomId, input.invitedBy, "room.member.invite");
    const agent = await this.store.getAgent(input.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${input.agentId}`);
    }
    if (agent.trustStatus === "revoked" || agent.trustStatus === "suspended" || agent.trustStatus === "expired") {
      throw new Error(`Agent trust status ${agent.trustStatus} cannot be invited to a room.`);
    }
    const members = await this.store.listRoomMembers(input.roomId);
    const existing = members.find((member) => member.actor.type === "agent" && member.actor.id === input.agentId);
    const member: RoomMember = {
      roomId: room.id,
      actor: {
        type: "agent",
        id: agent.id,
        displayName: agent.displayName,
      },
      aliases: this.normalizeMemberAliases(input.aliases ?? existing?.aliases ?? [], members, input.agentId),
      role: input.role ?? existing?.role ?? "participant",
      status: existing?.status === "active" ? "active" : "invited",
      joinedAt: existing?.joinedAt,
      expiresAt: existing?.expiresAt,
    };
    if (existing) {
      await this.store.updateRoomMember(member);
    } else {
      await this.store.addRoomMember(member);
    }
    return member;
  }

  async acceptAgentInvitation(input: AcceptRoomAgentInvitationInput): Promise<RoomMember> {
    const room = await this.store.getRoom(input.roomId);
    if (!room) {
      throw new Error(`Room not found: ${input.roomId}`);
    }
    if (input.actor.type !== "agent") {
      throw new Error("Only an agent can accept a room agent invitation.");
    }
    const agent = await this.store.getAgent(input.actor.id);
    if (!agent) {
      throw new Error(`Agent not found: ${input.actor.id}`);
    }
    if (agent.trustStatus === "revoked" || agent.trustStatus === "suspended" || agent.trustStatus === "expired") {
      throw new Error(`Agent trust status ${agent.trustStatus} cannot accept a room invitation.`);
    }
    const members = await this.store.listRoomMembers(input.roomId);
    const member = members.find((candidate) => candidate.actor.type === "agent" && candidate.actor.id === input.actor.id);
    if (!member) {
      throw new Error(`Room agent invitation not found: ${input.actor.id}`);
    }
    if (member.status === "active") {
      return member;
    }
    if (member.status !== "invited" && member.status !== "pending") {
      throw new Error(`Room agent invitation is ${member.status}.`);
    }
    const accepted: RoomMember = {
      ...member,
      actor: await this.enrichActor(input.actor),
      aliases: this.normalizeMemberAliases(input.aliases ?? member.aliases ?? [], members, input.actor.id),
      status: "active",
      joinedAt: new Date().toISOString(),
    };
    await this.store.updateRoomMember(accepted);
    return accepted;
  }

  async requestJoin(roomId: string, actor: ActorRef, role: RoomMember["role"], aliases: string[] = []): Promise<RoomMember> {
    const room = await this.store.getRoom(roomId);
    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }
    const existing = (await this.store.listRoomMembers(roomId)).find((member) => member.actor.id === actor.id);
    const members = await this.store.listRoomMembers(roomId);
    const status = await this.initialJoinStatus(room, actor);
    const joinedAt = status === "active" ? new Date().toISOString() : undefined;
    const member: RoomMember = {
      roomId: roomId as Room["id"],
      actor: await this.enrichActor(actor),
      aliases: this.normalizeMemberAliases(aliases, members, actor.id),
      role,
      status,
      joinedAt: joinedAt ?? existing?.joinedAt,
    };
    if (existing) {
      await this.store.updateRoomMember(member);
    } else {
      await this.store.addRoomMember(member);
    }
    return member;
  }

  async joinWithInvite(roomId: string, token: string, actor: ActorRef, aliases: string[] = []): Promise<RoomMember> {
    const room = await this.store.getRoom(roomId);
    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }
    const invite = await this.store.getRoomInviteByTokenHash(hashInviteToken(token));
    if (!invite || invite.roomId !== room.id) {
      throw new Error("Invalid room invite token.");
    }
    const now = new Date().toISOString();
    if (invite.status !== "active" || invite.expiresAt <= now || invite.uses >= invite.maxUses) {
      const status = invite.expiresAt <= now ? "expired" : invite.uses >= invite.maxUses ? "used" : invite.status;
      await this.store.updateRoomInvite({ ...invite, status });
      throw new Error(`Room invite is ${status}.`);
    }
    if (room.policy.requireSignedInvites === true) {
      const signatureStatus = await this.verifyInvite(invite);
      if (signatureStatus !== "valid") {
        throw new Error(`Policy denied: room requires signed invites, but invite signature is ${signatureStatus}.`);
      }
    }
    const members = await this.store.listRoomMembers(roomId);
    const member: RoomMember = {
      roomId: room.id,
      actor: await this.enrichActor(actor),
      aliases: this.normalizeMemberAliases(aliases, members, actor.id),
      role: invite.role,
      status: "active",
      joinedAt: now,
    };
    const existing = members.find((candidate) => candidate.actor.id === actor.id);
    if (existing) {
      await this.store.updateRoomMember(member);
    } else {
      await this.store.addRoomMember(member);
    }
    const uses = invite.uses + 1;
    await this.store.updateRoomInvite({
      ...invite,
      uses,
      status: uses >= invite.maxUses ? "used" : "active",
      lastUsedAt: now,
    });
    return member;
  }

  async approveJoin(roomId: string, actorId: string, approvedBy: ActorRef): Promise<RoomMember> {
    await this.assertCapability(roomId, approvedBy, "room.member.approve");
    const members = await this.store.listRoomMembers(roomId);
    const member = members.find((candidate) => candidate.actor.id === actorId);
    if (!member) {
      throw new Error(`No pending member found: ${actorId}`);
    }
    const approved: RoomMember = { ...member, status: "active", joinedAt: new Date().toISOString() };
    await this.store.updateRoomMember(approved);
    return approved;
  }

  async updateMemberAliases(roomId: string, actorId: string, aliases: string[], updatedBy: ActorRef): Promise<RoomMember> {
    const room = await this.store.getRoom(roomId);
    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }
    await this.assertCapability(roomId, updatedBy, "room.member.alias");
    const members = await this.store.listRoomMembers(roomId);
    const member = members.find((candidate) => candidate.actor.id === actorId);
    if (!member) {
      throw new Error(`Room member not found: ${actorId}`);
    }
    const before = member.aliases ?? [];
    const after = this.normalizeMemberAliases(aliases, members, member.actor.id);
    const updated: RoomMember = { ...member, aliases: after };
    await this.store.updateRoomMember(updated);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "room.member.alias_updated",
      actor: updatedBy,
      roomId: room.id,
      summary: "Room member aliases updated",
      metadata: {
        targetActor: member.actor,
        before,
        after,
      },
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
    return updated;
  }

  async updateMemberRole(roomId: string, actorId: string, role: RoomRole, updatedBy: ActorRef): Promise<RoomMember> {
    const room = await this.store.getRoom(roomId);
    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }
    await this.assertCapability(roomId, updatedBy, "room.member.role");
    const members = await this.store.listRoomMembers(roomId);
    const member = members.find((candidate) => candidate.actor.id === actorId);
    if (!member) {
      throw new Error(`Room member not found: ${actorId}`);
    }
    this.assertOwnerContinuity(members, member, { role });
    const before = member.role;
    const updated: RoomMember = { ...member, role };
    await this.store.updateRoomMember(updated);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "room.member.role_updated",
      actor: updatedBy,
      roomId: room.id,
      summary: "Room member role updated",
      metadata: {
        targetActor: member.actor,
        before,
        after: role,
      },
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
    return updated;
  }

  async updateMemberStatus(roomId: string, actorId: string, status: RoomMemberStatus, updatedBy: ActorRef): Promise<RoomMember> {
    const room = await this.store.getRoom(roomId);
    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }
    await this.assertCapability(roomId, updatedBy, "room.member.status");
    const members = await this.store.listRoomMembers(roomId);
    const member = members.find((candidate) => candidate.actor.id === actorId);
    if (!member) {
      throw new Error(`Room member not found: ${actorId}`);
    }
    this.assertOwnerContinuity(members, member, { status });
    const before = member.status;
    const updated: RoomMember = {
      ...member,
      status,
      joinedAt: status === "active" && !member.joinedAt ? new Date().toISOString() : member.joinedAt,
    };
    await this.store.updateRoomMember(updated);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "room.member.status_updated",
      actor: updatedBy,
      roomId: room.id,
      summary: "Room member status updated",
      metadata: {
        targetActor: member.actor,
        before,
        after: status,
      },
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
    return updated;
  }

  async sendMessage(input: Omit<RoomMessage, "id" | "createdAt">): Promise<RoomMessage> {
    const room = await this.store.getRoom(input.roomId);
    if (!room) {
      throw new Error(`Room not found: ${input.roomId}`);
    }
    const members = await this.store.listRoomMembers(input.roomId);
    const sender = members.find((member) => member.actor.id === input.sender.id);
    assertRoomCapability(sender, input.sender, "room.message.send");
    const routing = buildRoomMessageRouting({
      body: input.body,
      members,
      policy: room.policy,
      explicitRouting: input.routing,
    });
    this.assertRoutingAllowed(room, members, sender, input.sender, routing);
    const routingDiagnostics = buildRoomRoutingDiagnostics(routing, members);
    const metadata = routingDiagnostics.length > 0 ? { ...(input.metadata ?? {}), routingDiagnostics } : input.metadata;
    const unsigned: Omit<RoomMessage, "signature"> = {
      ...input,
      id: makeId<"MessageId">("msg"),
      routing,
      metadata,
      createdAt: new Date().toISOString(),
    };
    const signature = await this.identity?.signRoomMessage(unsigned);
    const message: RoomMessage = signature ? { ...unsigned, signature } : unsigned;
    await this.store.appendRoomMessage(message);
    await this.auditRoutingDiagnosticsIfNeeded(room, input.sender, message, routingDiagnostics);
    await this.auditRoutingIfNeeded(room, input.sender, message, members);
    return message;
  }

  async listMessages(roomId: string, limit?: number): Promise<RoomMessage[]> {
    return this.store.listRoomMessages(roomId, limit);
  }

  async verifyMessage(message: RoomMessage): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid"> {
    return this.identity?.verifyRoomMessage(message) ?? "unsigned";
  }

  async verifyInvite(invite: RoomInvite): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid"> {
    if (!invite.envelope) {
      return "unsigned";
    }
    if (!inviteEnvelopeMatchesInvite(invite)) {
      return "invalid";
    }
    return this.identity?.verifyRoomInviteEnvelope(invite.envelope) ?? "unsigned";
  }

  async assertCapability(roomId: string, actor: ActorRef, capability: RoomCapability): Promise<void> {
    const members = await this.store.listRoomMembers(roomId);
    const member = members.find((candidate) => candidate.actor.type === actor.type && candidate.actor.id === actor.id);
    assertRoomCapability(member, actor, capability);
  }

  private async initialJoinStatus(room: Room, actor: ActorRef): Promise<RoomMember["status"]> {
    if (room.policy.joinPolicy !== "fingerprint_allowlist" || actor.type !== "agent") {
      return "pending";
    }
    const agent = await this.store.getAgent(actor.id);
    if (!agent) {
      return "pending";
    }
    const allowed = new Set((room.policy.allowedFingerprints ?? []).map(normalizeFingerprint));
    return allowed.has(normalizeFingerprint(agent.fingerprint)) ? "active" : "pending";
  }

  private async enrichActor(actor: ActorRef): Promise<ActorRef> {
    if (actor.type !== "agent") {
      return actor;
    }
    const agent = await this.store.getAgent(actor.id);
    return {
      ...actor,
      displayName: agent?.displayName ?? actor.displayName,
    };
  }

  private normalizeMemberAliases(aliases: string[], existingMembers: RoomMember[], currentActorId?: string): string[] {
    const normalized = aliases.map(normalizeMentionAlias).filter(Boolean);
    const unique = [...new Set(normalized)];
    for (const alias of unique) {
      assertValidRoomAlias(alias);
      const actorIdConflict = existingMembers.find(
        (member) => member.actor.id !== currentActorId && normalizeMentionAlias(member.actor.id) === alias,
      );
      if (actorIdConflict) {
        throw new Error(`Room alias conflicts with existing actor id: ${alias}`);
      }
      const aliasConflict = existingMembers.find(
        (member) => member.actor.id !== currentActorId && (member.aliases ?? []).some((existing) => normalizeMentionAlias(existing) === alias),
      );
      if (aliasConflict) {
        throw new Error(`Room alias already exists: ${alias}`);
      }
    }
    return unique;
  }

  private assertOwnerContinuity(
    members: RoomMember[],
    target: RoomMember,
    patch: { role?: RoomRole; status?: RoomMemberStatus },
  ): void {
    const activeOwnersAfter = members.filter((member) => {
      const role = member.actor.id === target.actor.id ? patch.role ?? member.role : member.role;
      const status = member.actor.id === target.actor.id ? patch.status ?? member.status : member.status;
      return role === "owner" && status === "active";
    });
    if (activeOwnersAfter.length === 0) {
      throw new Error("Room must keep at least one active owner.");
    }
  }

  private assertRoutingAllowed(
    room: Room,
    members: RoomMember[],
    sender: RoomMember | undefined,
    actor: ActorRef,
    routing: RoomMessage["routing"],
  ): void {
    if (!routing) {
      return;
    }
    const routedAgentTargets = countRoutedAgentTargets(routing, members);
    if (room.policy.maxRoutedAgentTargets !== undefined && routedAgentTargets > room.policy.maxRoutedAgentTargets) {
      throw new Error(
        `Room routing targets ${routedAgentTargets} agents, exceeding maxRoutedAgentTargets=${room.policy.maxRoutedAgentTargets}.`,
      );
    }
    if (!hasWideRoomRouting(routing)) {
      return;
    }
    const policy = room.policy.wideMentionPolicy ?? DEFAULT_ROOM_WIDE_MENTION_POLICY;
    if (policy === "disabled") {
      throw new Error("Wide room mentions are disabled by room policy.");
    }
    if (policy === "members") {
      return;
    }
    if (!memberHasCapability(sender, "room.route.broadcast")) {
      throw new Error(`Actor lacks room capability room.route.broadcast: ${actor.type}:${actor.id}`);
    }
  }

  private async auditRoutingIfNeeded(room: Room, actor: ActorRef, message: RoomMessage, members: RoomMember[]): Promise<void> {
    if (!message.routing || !hasWideRoomRouting(message.routing)) {
      return;
    }
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "room.routing.wide",
      actor,
      roomId: room.id,
      summary: "Wide room routing used",
      metadata: {
        messageId: message.id,
        mode: message.routing.mode,
        source: message.routing.source,
        targets: message.routing.targets.map((target) => target.raw),
        routedAgentTargets: countRoutedAgentTargets(message.routing, members),
      },
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
  }

  private async auditRoutingDiagnosticsIfNeeded(
    room: Room,
    actor: ActorRef,
    message: RoomMessage,
    diagnostics: ReturnType<typeof buildRoomRoutingDiagnostics>,
  ): Promise<void> {
    if (diagnostics.length === 0) {
      return;
    }
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "room.routing.warning",
      actor,
      roomId: room.id,
      summary: "Room routing diagnostics recorded",
      metadata: {
        messageId: message.id,
        diagnostics,
      },
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
  }

  private async createSignedInviteEnvelope(invite: RoomInvite) {
    const unsigned = {
      version: 1 as const,
      inviteId: invite.id,
      roomId: invite.roomId,
      tokenHash: invite.tokenHash,
      role: invite.role,
      maxUses: invite.maxUses,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      createdBy: invite.createdBy,
    };
    const signature = await this.identity?.signRoomInviteEnvelope(unsigned);
    return signature ? { ...unsigned, signature } : undefined;
  }
}

function inviteEnvelopeMatchesInvite(invite: RoomInvite): boolean {
  const envelope = invite.envelope;
  return Boolean(
    envelope &&
      envelope.inviteId === invite.id &&
      envelope.roomId === invite.roomId &&
      envelope.tokenHash === invite.tokenHash &&
      envelope.role === invite.role &&
      envelope.maxUses === invite.maxUses &&
      envelope.createdAt === invite.createdAt &&
      envelope.expiresAt === invite.expiresAt &&
      envelope.createdBy.type === invite.createdBy.type &&
      envelope.createdBy.id === invite.createdBy.id,
  );
}

function normalizeFingerprint(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const RESERVED_ALIASES = new Set<string>([
  "all",
  "user",
  "agent",
  "service_account",
  "git_provider_bot",
  "system",
  "role",
  ...(["owner", "moderator", "participant", "observer", "executor", "reviewer", "approver"] satisfies RoomRole[]),
]);

function assertValidRoomAlias(alias: string): void {
  if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(alias)) {
    throw new Error(`Invalid room alias: ${alias}`);
  }
  if (RESERVED_ALIASES.has(alias)) {
    throw new Error(`Room alias is reserved: ${alias}`);
  }
}
