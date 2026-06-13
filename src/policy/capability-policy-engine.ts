import type { ActorRef, CapabilityGrant, PolicyDecision, PolicyRequest } from "../domain/index.js";
import { OrganizationService } from "../organizations/organization-service.js";
import type { AgentStore } from "../store/agent-store.js";
import { DefaultPolicyEngine } from "./default-policy-engine.js";
import type { PolicyEngine } from "./policy-engine.js";

type CapabilityScope = {
  orgId?: string;
  projectId?: string;
  roomId?: string;
  sessionId?: string;
};

export class CapabilityPolicyEngine implements PolicyEngine {
  private readonly base: PolicyEngine;
  private readonly organizations: OrganizationService;

  constructor(
    private readonly store: AgentStore,
    base: PolicyEngine = new DefaultPolicyEngine(),
  ) {
    this.base = base;
    this.organizations = new OrganizationService(store);
  }

  async evaluate(request: PolicyRequest): Promise<PolicyDecision> {
    const baseDecision = await this.base.evaluate(request);
    if (baseDecision.type === "allow" || request.mode === "strict") {
      return baseDecision;
    }

    const subject = subjectForActor(request.actor);
    if (!subject) {
      return baseDecision;
    }

    const scope = await this.expandScope(request.scope);
    const superGranted = await this.hasCapability(subject, scope, "agent.super_approve");
    if (superGranted) {
      return {
        type: "allow",
        reason: `Allowed by agent.super_approve grant for ${request.actor.type}:${request.actor.id}.`,
      };
    }

    if (request.risk === "critical") {
      if (baseDecision.type === "ask") {
        return {
          ...baseDecision,
          approverHint: "agent_super_approval",
        };
      }
      return baseDecision;
    }

    const actionGranted = await this.hasCapability(subject, scope, request.action);
    if (actionGranted) {
      return {
        type: "allow",
        reason: `Allowed by ${request.action} grant for ${request.actor.type}:${request.actor.id}.`,
      };
    }

    return baseDecision;
  }

  private async expandScope(scope: CapabilityScope): Promise<CapabilityScope> {
    const expanded: CapabilityScope = { ...scope };

    if (expanded.sessionId) {
      const session = await this.store.getSession(expanded.sessionId);
      expanded.roomId ??= session?.roomId;
      expanded.projectId ??= session?.projectId;
      expanded.orgId ??= session?.orgId;
    }

    if (expanded.roomId) {
      const room = await this.store.getRoom(expanded.roomId);
      expanded.projectId ??= room?.projectId;
    }

    if (expanded.projectId) {
      const project = await this.store.getProject(expanded.projectId);
      expanded.orgId ??= project?.orgId;
    }

    return expanded;
  }

  private async hasCapability(
    subject: Pick<CapabilityGrant, "subjectType" | "subjectId">,
    scope: CapabilityScope,
    capability: string,
  ): Promise<boolean> {
    const checks: Array<{ scopeType: CapabilityGrant["scopeType"]; scopeId?: string }> = [
      { scopeType: "session", scopeId: scope.sessionId },
      { scopeType: "room", scopeId: scope.roomId },
      { scopeType: "project", scopeId: scope.projectId },
      { scopeType: "organization", scopeId: scope.orgId },
    ];

    for (const check of checks) {
      if (!check.scopeId) {
        continue;
      }
      const allowed = await this.organizations.hasCapability({
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        scopeType: check.scopeType,
        scopeId: check.scopeId,
        capability,
      });
      if (allowed) {
        return true;
      }
    }

    return false;
  }
}

function subjectForActor(actor: ActorRef): Pick<CapabilityGrant, "subjectType" | "subjectId"> | undefined {
  if (actor.type === "user" || actor.type === "agent" || actor.type === "service_account") {
    return { subjectType: actor.type, subjectId: actor.id };
  }
  return undefined;
}
