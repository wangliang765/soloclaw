import {
  DEFAULT_ROOM_AGENT_RESPONSE_MODE,
  DEFAULT_ROOM_WIDE_MENTION_POLICY,
  type ActorRef,
  type RoomMemberStatus,
  type RoomMessageKind,
  type RoomRole,
  type RoomRoutingDiagnostic,
} from "../../domain/index.js";
import type { CommandModule } from "../command-router.js";

type RoomsCommandLocalAgent = {
  id: string;
  displayName: string;
  fingerprint: string;
};

type RoomsCommandStore = {
  getAgent(id: string): Promise<{ displayName?: string } | undefined>;
  close(): void;
};

type RoomsApi = {
  createRoom(input: unknown): Promise<any>;
  listRooms(limit?: number): Promise<any[]>;
  getRoom(roomId: string): Promise<any | undefined>;
  listMembers(roomId: string): Promise<any[]>;
  listMessages(roomId: string, limit: number): Promise<any[]>;
  verifyMessage(message: any): Promise<string>;
  createInvite(input: unknown): Promise<{ invite: any; token: string }>;
  verifyInvite(invite: any): Promise<string>;
  listInvites(roomId: string): Promise<any[]>;
  revokeInvite(roomId: string, inviteId: string, revokedBy: ActorRef): Promise<any>;
  joinWithInvite(roomId: string, token: string, actor: ActorRef, aliases?: string[]): Promise<any>;
  requestJoin(roomId: string, actor: ActorRef, role: RoomRole, aliases?: string[]): Promise<any>;
  approveJoin(roomId: string, actorId: string, approver: ActorRef): Promise<any>;
  updateMemberAliases(roomId: string, actorId: string, aliases: string[], updatedBy: ActorRef): Promise<any>;
  updateMemberRole(roomId: string, actorId: string, role: RoomRole, updatedBy: ActorRef): Promise<any>;
  updateMemberStatus(roomId: string, actorId: string, status: RoomMemberStatus, updatedBy: ActorRef): Promise<any>;
  sendMessage(input: { roomId: string; sender: ActorRef; kind: RoomMessageKind; body: string }): Promise<any>;
};

type RoomsCommandPlatform = {
  rooms: RoomsApi;
  store: RoomsCommandStore;
  localAgent: RoomsCommandLocalAgent;
  locks: { close(): void };
};

type RoomsControlPlane = {
  getRoomRoster(roomId: string): Promise<any | undefined>;
  getRoomAgentInbox(input: { roomId: string; agentId: string; limit?: number; includeDelivered?: boolean }): Promise<any | undefined>;
  ackRoomAgentInbox(input: { roomId: string; agentId: string; messageId?: string; actor: ActorRef }): Promise<any | undefined>;
  inviteRoomAgent(input: { roomId: string; agentId: string; invitedBy: ActorRef; role: RoomRole; aliases: string[] }): Promise<any>;
};

export type RoomsCommandDeps<TPlatform extends RoomsCommandPlatform> = {
  cwd(): string;
  env: NodeJS.ProcessEnv;
  createPlatform(cwd: string): Promise<TPlatform>;
  createControlPlane(platform: TPlatform): RoomsControlPlane;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createRoomsCommand<TPlatform extends RoomsCommandPlatform>(
  deps: RoomsCommandDeps<TPlatform>,
): CommandModule<void> {
  return {
    name: "rooms",
    summary: "Manage rooms, invitations, routed inboxes, and room messages",
    execute: async ({ args: rawArgs }) => {
      const subcommand = rawArgs[0] ?? "list";
      const args = rawArgs.slice(1);
      const platform = await deps.createPlatform(deps.cwd());
      const { rooms, store, localAgent, locks } = platform;
      try {
        if (subcommand === "create") {
          const parsed = parseRoomArgs(args);
          const name = parsed.positionals.join(" ").trim();
          if (!name) {
            return fail(deps, "Usage: agent rooms create [--local-agent] [--alias alias] [--agent-response broadcast|mentions_only] [--wide-mention-policy disabled|moderators|members] [--max-routed-agent-targets n] [--require-signed-invites] <name>");
          }
          const createdBy = parsed.options.localAgent ? agentActor(localAgent) : localUserActor();
          const room = await rooms.createRoom({
            name,
            projectId: parsed.options.projectId,
            createdBy,
            memberAliases: parsed.options.aliases,
            policy: {
              joinPolicy: parsed.options.joinPolicy ?? "manual",
              defaultCapabilities: ["room.message.send", "task.delegate", "tool.request"],
              agentResponseMode: parsed.options.agentResponseMode ?? DEFAULT_ROOM_AGENT_RESPONSE_MODE,
              wideMentionPolicy: parsed.options.wideMentionPolicy ?? DEFAULT_ROOM_WIDE_MENTION_POLICY,
              maxRoutedAgentTargets: parsed.options.maxRoutedAgentTargets,
              requireSignedInvites: parsed.options.requireSignedInvites,
              requiredApprovals: parsed.options.requiredApprovals,
              allowedFingerprints: parsed.options.allowLocalAgent
                ? [...(parsed.options.allowedFingerprints ?? []), localAgent.fingerprint]
                : parsed.options.allowedFingerprints,
              maxMembers: parsed.options.maxMembers,
              transcriptRetentionDays: parsed.options.transcriptRetentionDays,
            },
          });
          deps.writeText(`${room.id}\t${room.name}\t${room.policy.joinPolicy}\t${room.createdAt}`);
          return { matched: true };
        }

        if (subcommand === "list") {
          const parsed = parseRoomArgs(args);
          const all = await rooms.listRooms(parsed.options.limit);
          for (const room of all) {
            deps.writeText(`${room.id}\t${room.name}\t${room.policy.joinPolicy}\t${room.createdAt}`);
          }
          return { matched: true };
        }

        if (subcommand === "show") {
          const roomId = args[0];
          if (!roomId) {
            return fail(deps, "Usage: agent rooms show <room-id>");
          }
          const room = await rooms.getRoom(roomId);
          if (!room) {
            return fail(deps, `Room not found: ${roomId}`);
          }
          const members = await rooms.listMembers(roomId);
          const messages = await rooms.listMessages(roomId, 50);
          const verifiedMessages = await Promise.all(
            messages.map(async (message) => ({
              ...message,
              signatureStatus: await rooms.verifyMessage(message),
            })),
          );
          deps.writeJson({ room, members, messages: verifiedMessages });
          return { matched: true };
        }

        if (subcommand === "handles" || subcommand === "roster") {
          const parsed = parseRoomArgs(args);
          const roomId = parsed.positionals[0];
          if (!roomId) {
            return fail(deps, "Usage: agent rooms handles <room-id> [--json]");
          }
          const control = deps.createControlPlane(platform);
          const roster = await control.getRoomRoster(roomId);
          if (!roster) {
            return fail(deps, `Room not found: ${roomId}`);
          }
          if (parsed.options.json) {
            deps.writeJson(roster);
            return { matched: true };
          }
          deps.writeText(`${roster.room.id}\t${roster.room.name}\tagentResponse=${roster.room.policy.agentResponseMode ?? DEFAULT_ROOM_AGENT_RESPONSE_MODE}\twide=${roster.room.policy.wideMentionPolicy ?? DEFAULT_ROOM_WIDE_MENTION_POLICY}`);
          for (const entry of roster.entries) {
            const wake = entry.canWakeAgent ? "wakeable" : entry.wakeStatus;
            const aliases = entry.aliases.length > 0 ? entry.aliases.map((alias: string) => `@${alias}`).join(",") : "-";
            const stable = entry.mentionHandles.filter((handle: { stable: boolean }) => handle.stable).map((handle: { value: string }) => handle.value).join(",");
            const agent = entry.agent ? `fingerprint=${entry.agent.fingerprint}\tmachine=${entry.agent.machineId}\ttrust=${entry.agent.trustStatus}\theartbeat=${entry.agent.heartbeatStatus ?? "-"}` : "";
            deps.writeText(`${entry.actor.type}:${entry.actor.id}\t${entry.role}\t${entry.status}\t${wake}\tstable=${stable}\taliases=${aliases}${agent ? `\t${agent}` : ""}`);
          }
          if (roster.wideHandles.length > 0) {
            deps.writeText(`wide\t${roster.wideHandles.map((handle: { value: string; wakesAgent: boolean }) => `${handle.value}:${handle.wakesAgent ? "enabled" : "disabled"}`).join(",")}`);
          }
          return { matched: true };
        }

        if (subcommand === "inbox") {
          const parsed = parseRoomArgs(args);
          const roomId = parsed.positionals[0];
          if (!roomId) {
            return fail(deps, "Usage: agent rooms inbox <room-id> [--agent-id agent-id|--local-agent] [--limit n] [--json]");
          }
          const control = deps.createControlPlane(platform);
          const inbox = await control.getRoomAgentInbox({
            roomId,
            agentId: parsed.options.agentId ?? localAgent.id,
            limit: parsed.options.limit,
            includeDelivered: parsed.options.includeDelivered,
          });
          if (!inbox) {
            return fail(deps, `Room or agent member not found: ${roomId} / ${parsed.options.agentId ?? localAgent.id}`);
          }
          if (parsed.options.json) {
            deps.writeJson(inbox);
            return { matched: true };
          }
          deps.writeText(`${inbox.room.id}\tagent=${inbox.member.actor.id}\tconsidered=${inbox.consideredMessages}\twakeMessages=${inbox.messages.length}`);
          for (const message of inbox.messages) {
            deps.writeText(`${message.id}\t${message.signatureStatus}\t${message.activationContext.reason}\t${message.kind}\t${message.sender.type}:${message.sender.id}\t${message.body}`);
          }
          return { matched: true };
        }

        if (subcommand === "inbox-ack") {
          const parsed = parseRoomArgs(args);
          const roomId = parsed.positionals[0];
          if (!roomId) {
            return fail(deps, "Usage: agent rooms inbox-ack <room-id> [--agent-id agent-id|--local-agent] [--message-id message-id] [--json]");
          }
          const control = deps.createControlPlane(platform);
          const cursor = await control.ackRoomAgentInbox({
            roomId,
            agentId: parsed.options.agentId ?? localAgent.id,
            messageId: parsed.options.messageId,
            actor: parsed.options.localAgent ? agentActor(localAgent) : localUserActor(),
          });
          if (!cursor) {
            return fail(deps, `Room or agent member not found: ${roomId} / ${parsed.options.agentId ?? localAgent.id}`);
          }
          if (parsed.options.json) {
            deps.writeJson({ cursor });
            return { matched: true };
          }
          deps.writeText(`${cursor.roomId}\tagent=${cursor.agentId}\tlast=${cursor.lastDeliveredMessageId ?? "-"}\tupdated=${cursor.updatedAt}`);
          return { matched: true };
        }

        if (subcommand === "verify") {
          const roomId = args[0];
          if (!roomId) {
            return fail(deps, "Usage: agent rooms verify <room-id>");
          }
          const messages = await rooms.listMessages(roomId, 500);
          let invalid = 0;
          for (const message of messages) {
            const status = await rooms.verifyMessage(message);
            if (status === "invalid" || status === "unknown_agent") {
              invalid += 1;
            }
            deps.writeText(`${message.id}\t${status}\t${message.sender.type}:${message.sender.id}\t${message.kind}`);
          }
          if (invalid > 0) {
            deps.setExitCode(1);
          }
          return { matched: true };
        }

        if (subcommand === "invite") {
          const parsed = parseRoomArgs(args);
          const roomId = parsed.positionals[0];
          if (!roomId) {
            return fail(deps, "Usage: agent rooms invite <room-id> [--role participant|observer|executor|reviewer|approver] [--ttl-hours n] [--max-uses n]");
          }
          const actor = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
          const created = await rooms.createInvite({
            roomId,
            createdBy: actor,
            role: parsed.options.role ?? "participant",
            ttlHours: parsed.options.ttlHours,
            maxUses: parsed.options.maxUses,
          });
          const signatureStatus = await rooms.verifyInvite(created.invite);
          deps.writeJson({
            inviteId: created.invite.id,
            roomId: created.invite.roomId,
            role: created.invite.role,
            status: created.invite.status,
            signatureStatus,
            maxUses: created.invite.maxUses,
            expiresAt: created.invite.expiresAt,
            token: created.token,
          });
          return { matched: true };
        }

        if (subcommand === "invite-bundle") {
          const parsed = parseRoomArgs(args);
          const roomId = parsed.positionals[0];
          const controlToken = parsed.options.controlToken ?? deps.env.AGENT_CONTROL_TOKEN ?? deps.env.AGENT_WEB_TOKEN;
          if (!roomId || !parsed.options.controlUrl || !controlToken) {
            return fail(deps, "Usage: agent rooms invite-bundle <room-id> --control-url url --control-token token [--alias alias] [--display-name name] [--role role] [--ttl-hours n] [--max-uses n] [--json]");
          }
          const actor = parsed.options.localAgent === false ? await resolveActor(store, parseActorRef(parsed.options.actor)) : agentActor(localAgent);
          const created = await rooms.createInvite({
            roomId,
            createdBy: actor,
            role: parsed.options.role ?? "participant",
            ttlHours: parsed.options.ttlHours,
            maxUses: parsed.options.maxUses,
          });
          const signatureStatus = await rooms.verifyInvite(created.invite);
          const bundle = buildRemoteInviteBundle({
            controlUrl: parsed.options.controlUrl,
            controlToken,
            roomId,
            inviteToken: created.token,
            inviteId: created.invite.id,
            inviteSignatureStatus: signatureStatus,
            role: created.invite.role,
            aliases: parsed.options.aliases ?? [],
            displayName: parsed.options.displayName,
            expiresAt: created.invite.expiresAt,
            maxUses: created.invite.maxUses,
          });
          if (parsed.options.json) {
            deps.writeJson(bundle);
          } else {
            deps.writeText(formatRemoteInviteBundle(bundle));
          }
          return { matched: true };
        }

        if (subcommand === "invites") {
          const roomId = args[0];
          if (!roomId) {
            return fail(deps, "Usage: agent rooms invites <room-id>");
          }
          const invites = await rooms.listInvites(roomId);
          for (const invite of invites) {
            const signatureStatus = await rooms.verifyInvite(invite);
            deps.writeText(`${invite.id}\t${invite.status}\t${invite.role}\tsignature=${signatureStatus}\tuses=${invite.uses}/${invite.maxUses}\texpires=${invite.expiresAt}`);
          }
          return { matched: true };
        }

        if (subcommand === "revoke-invite") {
          const parsed = parseRoomArgs(args);
          const roomId = parsed.positionals[0];
          const inviteId = parsed.positionals[1];
          if (!roomId || !inviteId) {
            return fail(deps, "Usage: agent rooms revoke-invite <room-id> <invite-id> [--local-agent|--actor user:id|agent:id]");
          }
          const revokedBy = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
          const invite = await rooms.revokeInvite(roomId, inviteId, revokedBy);
          const signatureStatus = await rooms.verifyInvite(invite);
          deps.writeText(`${invite.id}\t${invite.status}\t${invite.role}\tsignature=${signatureStatus}\tuses=${invite.uses}/${invite.maxUses}\texpires=${invite.expiresAt}`);
          return { matched: true };
        }

        if (subcommand === "pull-agent" || subcommand === "invite-agent-member") {
          const parsed = parseRoomArgs(args);
          const roomId = parsed.positionals[0];
          const agentId = parsed.positionals[1] ?? parsed.options.agentId;
          if (!roomId || !agentId) {
            return fail(deps, "Usage: agent rooms pull-agent <room-id> <agent-id> [--alias alias] [--role participant|executor|reviewer|approver|observer] [--local-agent|--actor user:id|agent:id] [--json]");
          }
          const invitedBy = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
          const result = await deps.createControlPlane(platform).inviteRoomAgent({
            roomId,
            agentId,
            invitedBy,
            role: parsed.options.role ?? "participant",
            aliases: parsed.options.aliases ?? [],
          });
          if (parsed.options.json) {
            deps.writeJson(result);
          } else {
            deps.writeText(`${result.member.roomId}\t${result.member.actor.type}:${result.member.actor.id}\t${result.member.role}\t${result.member.status}\taliases=${result.member.aliases?.join(",") ?? ""}`);
          }
          return { matched: true };
        }

        if (subcommand === "join") {
          const parsed = parseRoomArgs(args);
          const roomId = parsed.positionals[0];
          if (!roomId) {
            return fail(deps, "Usage: agent rooms join <room-id> [--invite-token token] [--alias alias] [--local-agent|--actor user:id|agent:id] [--role participant|observer|executor|reviewer|approver]");
          }
          const actor = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
          const member = parsed.options.inviteToken
            ? await rooms.joinWithInvite(roomId, parsed.options.inviteToken, actor, parsed.options.aliases)
            : await rooms.requestJoin(roomId, actor, parsed.options.role ?? "participant", parsed.options.aliases);
          deps.writeText(`${member.roomId}\t${member.actor.type}:${member.actor.id}\t${member.role}\t${member.status}\taliases=${member.aliases?.join(",") ?? ""}`);
          return { matched: true };
        }

        if (subcommand === "approve") {
          const parsed = parseRoomArgs(args);
          const roomId = parsed.positionals[0];
          const actorId = parsed.positionals[1];
          if (!roomId || !actorId) {
            return fail(deps, "Usage: agent rooms approve <room-id> <actor-id> [--local-agent|--actor user:id|agent:id]");
          }
          const approver = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
          const member = await rooms.approveJoin(roomId, actorId, approver);
          deps.writeText(`${member.roomId}\t${member.actor.type}:${member.actor.id}\t${member.role}\t${member.status}`);
          return { matched: true };
        }

        if (subcommand === "alias") {
          const parsed = parseRoomArgs(args);
          const roomId = parsed.positionals[0];
          const actorId = parsed.positionals[1];
          if (!roomId || !actorId) {
            return fail(deps, "Usage: agent rooms alias <room-id> <actor-id> [--alias alias] [--local-agent|--actor user:id|agent:id]");
          }
          const updatedBy = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
          const member = await rooms.updateMemberAliases(roomId, actorId, parsed.options.aliases ?? [], updatedBy);
          deps.writeText(`${member.roomId}\t${member.actor.type}:${member.actor.id}\taliases=${member.aliases?.join(",") ?? ""}`);
          return { matched: true };
        }

        if (subcommand === "role") {
          const parsed = parseRoomArgs(args);
          const roomId = parsed.positionals[0];
          const actorId = parsed.positionals[1];
          const role = parsed.positionals[2] ? parseRoomRole(parsed.positionals[2]) : parsed.options.role;
          if (!roomId || !actorId || !role) {
            return fail(deps, "Usage: agent rooms role <room-id> <actor-id> <owner|moderator|participant|observer|executor|reviewer|approver> [--local-agent|--actor user:id|agent:id]");
          }
          const updatedBy = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
          const member = await rooms.updateMemberRole(roomId, actorId, role, updatedBy);
          deps.writeText(`${member.roomId}\t${member.actor.type}:${member.actor.id}\trole=${member.role}\tstatus=${member.status}`);
          return { matched: true };
        }

        if (subcommand === "status") {
          const parsed = parseRoomArgs(args);
          const roomId = parsed.positionals[0];
          const actorId = parsed.positionals[1];
          const status = parsed.positionals[2] ? parseRoomMemberStatus(parsed.positionals[2]) : parsed.options.status;
          if (!roomId || !actorId || !status) {
            return fail(deps, "Usage: agent rooms status <room-id> <actor-id> <invited|pending|active|suspended|left|removed|expired> [--local-agent|--actor user:id|agent:id]");
          }
          const updatedBy = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
          const member = await rooms.updateMemberStatus(roomId, actorId, status, updatedBy);
          deps.writeText(`${member.roomId}\t${member.actor.type}:${member.actor.id}\trole=${member.role}\tstatus=${member.status}`);
          return { matched: true };
        }

        if (subcommand === "say") {
          const parsed = parseRoomArgs(args);
          const roomId = parsed.positionals[0];
          const body = parsed.positionals.slice(1).join(" ").trim();
          if (!roomId || !body) {
            return fail(deps, "Usage: agent rooms say <room-id> [--local-agent|--actor user:id|agent:id] [--kind chat|task|decision|tool_request|approval|artifact|system] <message with optional @alias|@agent:id|@role:role|@all>");
          }
          const sender = parsed.options.localAgent ? agentActor(localAgent) : parseActorRef(parsed.options.actor);
          const message = await rooms.sendMessage({
            roomId,
            sender,
            kind: parsed.options.kind ?? "chat",
            body,
          });
          deps.writeText(`${message.id}\t${message.roomId}\t${message.sender.type}:${message.sender.id}\t${message.kind}\t${message.body}`);
          for (const diagnostic of roomRoutingDiagnostics(message.metadata)) {
            deps.writeText(`routing-warning\t${diagnostic.code}\t${diagnostic.raw}\t${diagnostic.message}`);
          }
          return { matched: true };
        }

        return fail(deps, `Unknown rooms command: ${subcommand}`);
      } catch (error) {
        handleError(deps, error);
      } finally {
        locks.close();
        store.close();
      }
      return { matched: true };
    },
  };
}

export function printRoomConvenienceHelp(writeText: (text: string) => void): void {
  writeText(`Soloclaw room shortcuts

Invite a remote agent:
  soloclaw room invite-agent <room-id> --control-url url --control-token token [--alias alias] [--display-name name] [--json]

Pull a registered remote agent into a room:
  soloclaw room pull-agent <room-id> <agent-id> [--alias alias] [--role executor] [--local-agent] [--json]

Accept a room invitation from the remote machine:
  agent remote invitations --control-url url --control-token token [--json]
  agent remote accept-room --control-url url --control-token token --room room-id [--run] [--status-file path] [--json]

Join and optionally run from a remote machine:
  soloclaw room join --invite-bundle room-invite.json [--run] [--status-file .agent/tmp/remote-room-status.json] [--stop-file .agent/tmp/remote-room.stop] [--reply-template text] [--json]

Inspect the metadata-only remote runner service plan:
  soloclaw room service --control-url url --room room-id [--status-file .agent/tmp/remote-room-status.json] [--stop-file .agent/tmp/remote-room.stop] [--json]

Lower-level equivalents:
  agent remote register --control-url url --control-token token [--display-name name] [--json]
  agent rooms pull-agent <room-id> <agent-id> [--alias alias] [--role role] [--json]
  agent rooms invite-bundle <room-id> --control-url url --control-token token [--json]
  agent remote join-bundle --invite-bundle room-invite.json [--run] [--status-file path] [--stop-file path] [--json]
  agent remote service --control-url url --room room-id [--status-file path] [--stop-file path] [--json]
`);
}

export function normalizeRoomConvenienceCommand(command: string, rest: string[]): { command: string; rest: string[] } {
  if (command !== "room") {
    return { command, rest };
  }
  const [subcommand, ...args] = rest;
  if (subcommand === "invite-agent" || subcommand === "invite-bundle") {
    return { command: "rooms", rest: ["invite-bundle", ...args] };
  }
  if (subcommand === "pull-agent") {
    return { command: "rooms", rest: ["pull-agent", ...args] };
  }
  if (subcommand === "join" || subcommand === "join-bundle") {
    return { command: "remote", rest: ["join-bundle", ...args] };
  }
  if (subcommand === "run") {
    return { command: "remote", rest: ["run", ...args] };
  }
  if (subcommand === "service" || subcommand === "daemon") {
    return { command: "remote", rest: ["service", ...args] };
  }
  if (subcommand === "remote-say") {
    return { command: "remote", rest: ["say", ...args] };
  }
  return { command: "rooms", rest };
}

type RemoteInviteBundle = {
  kind: "soloclaw.room_invite";
  version: 1;
  controlUrl: string;
  controlToken?: string;
  roomId: string;
  inviteToken: string;
  inviteId?: string;
  inviteSignatureStatus?: string;
  role?: RoomRole;
  aliases?: string[];
  displayName?: string;
  expiresAt?: string;
  maxUses?: number;
  sensitivity?: string;
  defaultRun?: {
    cycles?: number;
    limit?: number;
    idleLimit?: number;
    intervalMs?: number;
    loopIntervalMs?: number;
    stopWhenIdle?: boolean;
    idleCycles?: number;
    backoffMs?: number;
    maxBackoffMs?: number;
    maxErrors?: number;
    heartbeatTtlSeconds?: number;
  };
  commands?: {
    enroll: string;
    run: string;
  };
};

function buildRemoteInviteBundle(input: {
  controlUrl: string;
  controlToken: string;
  roomId: string;
  inviteToken: string;
  inviteId?: string;
  inviteSignatureStatus: string;
  role: RoomRole;
  aliases: string[];
  displayName?: string;
  expiresAt?: string;
  maxUses?: number;
}): RemoteInviteBundle {
  return {
    kind: "soloclaw.room_invite",
    version: 1,
    controlUrl: input.controlUrl,
    controlToken: input.controlToken,
    roomId: input.roomId,
    inviteToken: input.inviteToken,
    inviteId: input.inviteId,
    inviteSignatureStatus: input.inviteSignatureStatus,
    role: input.role,
    aliases: input.aliases,
    displayName: input.displayName,
    expiresAt: input.expiresAt,
    maxUses: input.maxUses,
    sensitivity: "contains_control_token_and_invite_token_do_not_commit",
    defaultRun: {
      cycles: 20,
      limit: 5,
      idleLimit: 1,
      intervalMs: 1000,
      loopIntervalMs: 1000,
      stopWhenIdle: true,
      idleCycles: 2,
      backoffMs: 1000,
      maxBackoffMs: 30000,
      maxErrors: 3,
      heartbeatTtlSeconds: 60,
    },
    commands: {
      enroll: "agent room join --invite-bundle room-invite.json --json",
      run: "agent room join --invite-bundle room-invite.json --run --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --reply-template \"@owner handled {messageId}\" --json",
    },
  };
}

function formatRemoteInviteBundle(bundle: RemoteInviteBundle): string {
  return [
    `room-bundle\t${bundle.roomId}\tsignature=${bundle.inviteSignatureStatus ?? "-"}\texpires=${bundle.expiresAt ?? "-"}`,
    "Save the JSON form as room-invite.json on the remote machine, then run:",
    bundle.commands?.enroll ?? "agent room join --invite-bundle room-invite.json --json",
    bundle.commands?.run ?? "agent room join --invite-bundle room-invite.json --run --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --reply-template \"@owner handled {messageId}\" --json",
    "Read .agent/tmp/remote-room-status.json for runner evidence; create .agent/tmp/remote-room.stop to request graceful shutdown.",
    "This bundle contains the control token and invite token. Do not commit or paste it into logs.",
  ].join("\n");
}

type RoomCliOptions = {
  actor?: string;
  agentId?: string;
  controlUrl?: string;
  controlToken?: string;
  displayName?: string;
  role?: RoomRole;
  status?: RoomMemberStatus;
  kind?: RoomMessageKind;
  joinPolicy?: "manual" | "invite_token" | "fingerprint_allowlist" | "quorum" | "same_org";
  agentResponseMode?: "broadcast" | "mentions_only";
  wideMentionPolicy?: "disabled" | "moderators" | "members";
  maxRoutedAgentTargets?: number;
  requireSignedInvites?: boolean;
  aliases?: string[];
  allowedFingerprints?: string[];
  allowLocalAgent?: boolean;
  localAgent?: boolean;
  inviteToken?: string;
  projectId?: string;
  limit?: number;
  requiredApprovals?: number;
  maxMembers?: number;
  maxUses?: number;
  transcriptRetentionDays?: number;
  ttlHours?: number;
  messageId?: string;
  includeDelivered?: boolean;
  json?: boolean;
};

function parseRoomArgs(args: string[]): { options: RoomCliOptions; positionals: string[] } {
  const options: RoomCliOptions = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--actor" && next) {
      options.actor = next;
      index += 1;
      continue;
    }
    if (arg === "--control-url" && next) {
      options.controlUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--control-token" && next) {
      options.controlToken = next;
      index += 1;
      continue;
    }
    if (arg === "--display-name" && next) {
      options.displayName = next;
      index += 1;
      continue;
    }
    if ((arg === "--agent-id" || arg === "--agent") && next) {
      options.agentId = next;
      index += 1;
      continue;
    }
    if (arg === "--role" && next) {
      options.role = parseRoomRole(next);
      index += 1;
      continue;
    }
    if (arg === "--status" && next) {
      options.status = parseRoomMemberStatus(next);
      index += 1;
      continue;
    }
    if (arg === "--kind" && next) {
      options.kind = next as RoomCliOptions["kind"];
      index += 1;
      continue;
    }
    if (arg === "--join-policy" && next) {
      options.joinPolicy = next as RoomCliOptions["joinPolicy"];
      index += 1;
      continue;
    }
    if (arg === "--agent-response" && next) {
      if (next !== "broadcast" && next !== "mentions_only") {
        throw new Error("--agent-response must be broadcast or mentions_only.");
      }
      options.agentResponseMode = next;
      index += 1;
      continue;
    }
    if (arg === "--wide-mention-policy" && next) {
      if (next !== "disabled" && next !== "moderators" && next !== "members") {
        throw new Error("--wide-mention-policy must be disabled, moderators, or members.");
      }
      options.wideMentionPolicy = next;
      index += 1;
      continue;
    }
    if (arg === "--max-routed-agent-targets" && next) {
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--max-routed-agent-targets must be a non-negative integer.");
      }
      options.maxRoutedAgentTargets = parsed;
      index += 1;
      continue;
    }
    if (arg === "--require-signed-invites") {
      options.requireSignedInvites = true;
      continue;
    }
    if (arg === "--alias" && next) {
      options.aliases = [...(options.aliases ?? []), next];
      index += 1;
      continue;
    }
    if (arg === "--allow-fingerprint" && next) {
      options.allowedFingerprints = [...(options.allowedFingerprints ?? []), next];
      index += 1;
      continue;
    }
    if (arg === "--allow-local-agent") {
      options.allowLocalAgent = true;
      continue;
    }
    if (arg === "--local-agent") {
      options.localAgent = true;
      continue;
    }
    if (arg === "--invite-token" && next) {
      options.inviteToken = next;
      index += 1;
      continue;
    }
    if (arg === "--project" && next) {
      options.projectId = next;
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      options.limit = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--required-approvals" && next) {
      options.requiredApprovals = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--max-members" && next) {
      options.maxMembers = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--max-uses" && next) {
      options.maxUses = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--retention-days" && next) {
      options.transcriptRetentionDays = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--ttl-hours" && next) {
      options.ttlHours = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--message-id" && next) {
      options.messageId = next;
      index += 1;
      continue;
    }
    if (arg === "--include-delivered") {
      options.includeDelivered = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    positionals.push(arg);
  }

  return { options, positionals };
}

function parseRoomRole(value: string): RoomRole {
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
  throw new Error(`Invalid room role: ${value}.`);
}

function parseRoomMemberStatus(value: string): RoomMemberStatus {
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
  throw new Error(`Invalid room member status: ${value}.`);
}

function localUserActor() {
  return { type: "user" as const, id: "local-user", displayName: "Local User" };
}

function parseActorRef(value?: string): ActorRef {
  if (!value) {
    return localUserActor();
  }
  const [type, id] = value.includes(":") ? value.split(":", 2) : ["user", value];
  if (!id) {
    throw new Error(`Invalid actor: ${value}`);
  }
  if (!["user", "agent", "service_account", "git_provider_bot", "system"].includes(type)) {
    throw new Error(`Invalid actor type: ${type}`);
  }
  return { type: type as ActorRef["type"], id, displayName: id };
}

function agentActor(agent: { id: string; displayName: string }) {
  return { type: "agent" as const, id: agent.id, displayName: agent.displayName };
}

function roomRoutingDiagnostics(metadata: Record<string, unknown> | undefined): RoomRoutingDiagnostic[] {
  const diagnostics = metadata?.routingDiagnostics;
  if (!Array.isArray(diagnostics)) {
    return [];
  }
  return diagnostics.filter(
    (diagnostic): diagnostic is RoomRoutingDiagnostic =>
      typeof diagnostic === "object" &&
      diagnostic !== null &&
      typeof (diagnostic as RoomRoutingDiagnostic).code === "string" &&
      typeof (diagnostic as RoomRoutingDiagnostic).raw === "string" &&
      typeof (diagnostic as RoomRoutingDiagnostic).message === "string",
  );
}

async function resolveActor(store: RoomsCommandStore, actor: ActorRef): Promise<ActorRef> {
  if (actor.type !== "agent") {
    return actor;
  }
  const agent = await store.getAgent(actor.id);
  return {
    ...actor,
    displayName: agent?.displayName ?? actor.displayName,
  };
}

function fail<TPlatform extends RoomsCommandPlatform>(
  deps: RoomsCommandDeps<TPlatform>,
  message: string,
) {
  deps.writeError(message);
  deps.setExitCode(1);
  return { matched: true };
}

function handleError<TPlatform extends RoomsCommandPlatform>(
  deps: RoomsCommandDeps<TPlatform>,
  error: unknown,
): void {
  deps.writeError(error instanceof Error ? error.message : String(error));
  deps.setExitCode(1);
}
