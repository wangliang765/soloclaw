import { DEFAULT_ROOM_AGENT_RESPONSE_MODE } from "../domain/index.js";
import type { ActorRef, RoomMember, RoomMessage, RoomMessageRouting, RoomMentionTarget, RoomPolicy, RoomRole, RoomRoutingDiagnostic } from "../domain/index.js";

const ACTOR_TYPES = new Set<ActorRef["type"]>(["user", "agent", "service_account", "git_provider_bot", "system"]);
const ROOM_ROLES = new Set<RoomRole>(["owner", "moderator", "participant", "observer", "executor", "reviewer", "approver"]);

export type RoomActivationReason =
  | "direct_mention"
  | "role_mention"
  | "all_mention"
  | "broadcast"
  | "legacy_broadcast"
  | "not_routed";

export type RoomActivationContext = {
  roomId: string;
  agentId: string;
  messageId: string;
  shouldWake: boolean;
  reason: RoomActivationReason;
  routingMode?: RoomMessageRouting["mode"];
  routingSource?: RoomMessageRouting["source"];
  triggeringTarget?: RoomMentionTarget;
  currentMessage: Pick<RoomMessage, "id" | "roomId" | "sender" | "kind" | "body" | "createdAt" | "parentMessageId" | "artifactRefs" | "routing" | "metadata">;
  recentMessages: Pick<RoomMessage, "id" | "sender" | "kind" | "body" | "createdAt" | "routing">[];
  contextPolicy: {
    maxRecentMessages: number;
    includesTranscriptOnlyMessages: boolean;
    requiresAcknowledgement: boolean;
  };
};

export type BuildRoomMessageRoutingInput = {
  body: string;
  members: RoomMember[];
  policy?: Pick<RoomPolicy, "agentResponseMode">;
  explicitRouting?: RoomMessageRouting;
};

export function buildRoomMessageRouting(input: BuildRoomMessageRoutingInput): RoomMessageRouting {
  if (input.explicitRouting) {
    return normalizeRouting(input.explicitRouting);
  }
  const targets = parseMentionTargets(input.body, input.members);
  if (targets.length > 0) {
    return {
      mode: "mentions_only",
      targets,
      source: "parsed",
    };
  }
  return {
    mode: (input.policy?.agentResponseMode ?? DEFAULT_ROOM_AGENT_RESPONSE_MODE) === "mentions_only" ? "silent" : "broadcast",
    targets: [],
    source: "default",
  };
}

export function parseMentionTargets(body: string, members: RoomMember[]): RoomMentionTarget[] {
  const seen = new Set<string>();
  const targets: RoomMentionTarget[] = [];
  const mentions = body.matchAll(/(^|[^\w])@([A-Za-z0-9_.:-]+)/g);
  for (const match of mentions) {
    const raw = `@${match[2]}`;
    const target = mentionTarget(raw, members);
    const key = routingTargetKey(target);
    if (!seen.has(key)) {
      targets.push(target);
      seen.add(key);
    }
  }
  return targets;
}

export function shouldActorRespondToRoomMessage(message: RoomMessage, member: RoomMember): boolean {
  if (member.status !== "active" || member.actor.type !== "agent") {
    return false;
  }
  const routing = message.routing;
  if (!routing) {
    return true;
  }
  if (routing.mode === "silent") {
    return false;
  }
  if (routing.mode === "broadcast") {
    return true;
  }
  return routing.targets.some((target) => targetMatchesMember(target, member));
}

export function buildRoomActivationContext(input: {
  message: RoomMessage;
  member: RoomMember;
  transcript?: RoomMessage[];
  maxRecentMessages?: number;
}): RoomActivationContext {
  const maxRecentMessages = Math.max(0, input.maxRecentMessages ?? 6);
  const { reason, target } = describeActivation(input.message, input.member);
  return {
    roomId: input.message.roomId,
    agentId: input.member.actor.id,
    messageId: input.message.id,
    shouldWake: shouldActorRespondToRoomMessage(input.message, input.member),
    reason,
    routingMode: input.message.routing?.mode,
    routingSource: input.message.routing?.source,
    triggeringTarget: target,
    currentMessage: pickActivationMessage(input.message),
    recentMessages: recentMessagesBefore(input.transcript ?? [], input.message.id, maxRecentMessages).map((message) => ({
      id: message.id,
      sender: message.sender,
      kind: message.kind,
      body: message.body,
      createdAt: message.createdAt,
      routing: message.routing,
    })),
    contextPolicy: {
      maxRecentMessages,
      includesTranscriptOnlyMessages: true,
      requiresAcknowledgement: true,
    },
  };
}

export function hasWideRoomRouting(routing: RoomMessageRouting): boolean {
  return (routing.mode === "broadcast" && routing.source === "explicit") || routing.targets.some((target) => target.type === "all" || target.type === "role");
}

export function buildRoomRoutingDiagnostics(routing: RoomMessageRouting, members: RoomMember[]): RoomRoutingDiagnostic[] {
  if (routing.mode === "silent") {
    return [];
  }
  const diagnostics: RoomRoutingDiagnostic[] = [];
  for (const target of routing.targets) {
    if (target.type === "unresolved") {
      diagnostics.push(diagnoseUnresolvedMention(target.raw, members));
      continue;
    }
    if (target.type === "actor") {
      const member = members.find((candidate) => candidate.actor.type === target.actor.type && candidate.actor.id === target.actor.id);
      if (!member) {
        diagnostics.push({
          code: "unknown_actor",
          severity: "warning",
          raw: target.raw,
          message: `No room member matches ${target.raw}.`,
          target,
        });
        continue;
      }
      if (member.actor.type === "agent" && member.status !== "active") {
        diagnostics.push({
          code: "inactive_target",
          severity: "warning",
          raw: target.raw,
          message: `Mention target ${target.raw} is ${member.status} and will not wake.`,
          target,
          matchedActors: [member.actor],
          activeAgentTargets: 0,
        });
      }
      continue;
    }
    if (target.type === "role") {
      const activeAgentTargets = members.filter(
        (member) => member.actor.type === "agent" && member.status === "active" && member.role === target.role,
      ).length;
      if (activeAgentTargets === 0) {
        diagnostics.push({
          code: "empty_role",
          severity: "warning",
          raw: target.raw,
          message: `Role mention ${target.raw} has no active agent targets.`,
          target,
          activeAgentTargets,
        });
      }
      continue;
    }
    if (target.type === "all") {
      const activeAgentTargets = members.filter((member) => member.actor.type === "agent" && member.status === "active").length;
      if (activeAgentTargets === 0) {
        diagnostics.push({
          code: "empty_all",
          severity: "info",
          raw: target.raw,
          message: "@all has no active agent targets.",
          target,
          activeAgentTargets,
        });
      }
    }
  }
  return diagnostics;
}

export function countRoutedAgentTargets(routing: RoomMessageRouting, members: RoomMember[]): number {
  const activeAgents = members.filter((member) => member.status === "active" && member.actor.type === "agent");
  if (routing.mode === "silent") {
    return 0;
  }
  if (routing.mode === "broadcast") {
    return activeAgents.length;
  }
  const ids = new Set<string>();
  for (const target of routing.targets) {
    if (target.type === "all") {
      for (const member of activeAgents) {
        ids.add(member.actor.id);
      }
      continue;
    }
    if (target.type === "role") {
      for (const member of activeAgents) {
        if (member.role === target.role) {
          ids.add(member.actor.id);
        }
      }
      continue;
    }
    if (target.type === "actor" && target.actor.type === "agent") {
      const member = activeAgents.find((candidate) => candidate.actor.id === target.actor.id);
      if (member) {
        ids.add(member.actor.id);
      }
    }
  }
  return ids.size;
}

function mentionTarget(raw: string, members: RoomMember[]): RoomMentionTarget {
  const token = raw.slice(1);
  if (token === "all") {
    return { type: "all", raw };
  }
  const separator = token.indexOf(":");
  if (separator > 0) {
    const prefix = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (prefix === "role" && ROOM_ROLES.has(value as RoomRole)) {
      return { type: "role", role: value as RoomRole, raw };
    }
    if (ACTOR_TYPES.has(prefix as ActorRef["type"]) && value) {
      const typed = members.find((member) => member.actor.type === prefix && member.actor.id === value);
      return {
        type: "actor",
        actor: typed?.actor ?? { type: prefix as ActorRef["type"], id: value },
        raw,
      };
    }
  }
  const matching = members.filter((member) => member.actor.id === token);
  if (matching.length === 1) {
    return { type: "actor", actor: matching[0].actor, raw };
  }
  const aliasMatching = members.filter((member) => (member.aliases ?? []).some((alias) => normalizeMentionAlias(alias) === normalizeMentionAlias(token)));
  if (aliasMatching.length === 1) {
    return { type: "actor", actor: aliasMatching[0].actor, raw };
  }
  return { type: "unresolved", raw };
}

export function normalizeMentionAlias(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function normalizeRouting(routing: RoomMessageRouting): RoomMessageRouting {
  const seen = new Set<string>();
  const targets = routing.targets.filter((target) => {
    const key = routingTargetKey(target);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return {
    mode: routing.mode,
    targets,
    source: "explicit",
  };
}

function targetMatchesMember(target: RoomMentionTarget, member: RoomMember): boolean {
  if (target.type === "all") {
    return true;
  }
  if (target.type === "role") {
    return target.role === member.role;
  }
  if (target.type === "actor") {
    return target.actor.type === member.actor.type && target.actor.id === member.actor.id;
  }
  return false;
}

function diagnoseUnresolvedMention(raw: string, members: RoomMember[]): RoomRoutingDiagnostic {
  const token = raw.slice(1);
  const separator = token.indexOf(":");
  if (separator > 0) {
    const prefix = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (prefix === "role") {
      return {
        code: "invalid_role",
        severity: "warning",
        raw,
        message: `Unknown room role in mention ${raw}.`,
        target: { type: "unresolved", raw },
      };
    }
    if (ACTOR_TYPES.has(prefix as ActorRef["type"]) && !value) {
      return {
        code: "unresolved_mention",
        severity: "warning",
        raw,
        message: `Mention ${raw} is missing an actor id.`,
        target: { type: "unresolved", raw },
      };
    }
  }
  const normalized = normalizeMentionAlias(token);
  const matches = members
    .filter(
      (member) =>
        normalizeMentionAlias(member.actor.id) === normalized ||
        (member.aliases ?? []).some((alias) => normalizeMentionAlias(alias) === normalized),
    )
    .map((member) => member.actor);
  if (matches.length > 1) {
    return {
      code: "ambiguous_mention",
      severity: "warning",
      raw,
      message: `Mention ${raw} matches multiple room members and will not wake anyone.`,
      target: { type: "unresolved", raw },
      matchedActors: matches,
    };
  }
  return {
    code: "unresolved_mention",
    severity: "warning",
    raw,
    message: `Mention ${raw} does not match a room member or alias.`,
    target: { type: "unresolved", raw },
  };
}

function describeActivation(message: RoomMessage, member: RoomMember): { reason: RoomActivationReason; target?: RoomMentionTarget } {
  if (member.status !== "active" || member.actor.type !== "agent") {
    return { reason: "not_routed" };
  }
  const routing = message.routing;
  if (!routing) {
    return { reason: "legacy_broadcast" };
  }
  if (routing.mode === "silent") {
    return { reason: "not_routed" };
  }
  if (routing.mode === "broadcast") {
    return { reason: "broadcast" };
  }
  const target = routing.targets.find((candidate) => targetMatchesMember(candidate, member));
  if (!target) {
    return { reason: "not_routed" };
  }
  if (target.type === "all") {
    return { reason: "all_mention", target };
  }
  if (target.type === "role") {
    return { reason: "role_mention", target };
  }
  return { reason: "direct_mention", target };
}

function recentMessagesBefore(messages: RoomMessage[], messageId: string, limit: number): RoomMessage[] {
  if (limit === 0) {
    return [];
  }
  const index = messages.findIndex((message) => message.id === messageId);
  const before = index >= 0 ? messages.slice(0, index) : messages;
  return before.slice(-limit);
}

function pickActivationMessage(message: RoomMessage): RoomActivationContext["currentMessage"] {
  return {
    id: message.id,
    roomId: message.roomId,
    sender: message.sender,
    kind: message.kind,
    body: message.body,
    createdAt: message.createdAt,
    parentMessageId: message.parentMessageId,
    artifactRefs: message.artifactRefs,
    routing: message.routing,
    metadata: message.metadata,
  };
}

function routingTargetKey(target: RoomMentionTarget): string {
  if (target.type === "all") {
    return "all";
  }
  if (target.type === "role") {
    return `role:${target.role}`;
  }
  if (target.type === "actor") {
    return `actor:${target.actor.type}:${target.actor.id}`;
  }
  return `unresolved:${target.raw}`;
}
