import type { ActorRef, CapabilityGrant, Organization, Project } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";

export type CreateOrganizationInput = {
  name: string;
  createdBy: ActorRef;
};

export type CreateProjectInput = {
  orgId: string;
  name: string;
  defaultRole?: Project["defaultRole"];
  retentionPolicyId?: string;
  createdBy: ActorRef;
};

export type GrantCapabilityInput = Omit<CapabilityGrant, "createdAt" | "grantedBy"> & {
  grantedBy: ActorRef;
  expiresAt?: string;
};

export class OrganizationService {
  constructor(private readonly store: AgentStore) {}

  async createOrganization(input: CreateOrganizationInput): Promise<Organization> {
    const now = new Date().toISOString();
    const org: Organization = {
      id: makeId<"OrgId">("org"),
      name: input.name,
      status: "active",
      createdAt: now,
    };
    await this.store.createOrganization(org);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "org.created",
      actor: input.createdBy,
      orgId: org.id,
      summary: `Created organization ${org.name}`,
      metadata: { orgId: org.id, name: org.name },
      artifactRefs: [],
      createdAt: now,
    });
    await this.grantCapability({
      subjectType: input.createdBy.type === "agent" ? "agent" : "user",
      subjectId: input.createdBy.id,
      scopeType: "organization",
      scopeId: org.id,
      capability: "org.admin",
      grantedBy: input.createdBy,
    });
    return org;
  }

  async listOrganizations(limit?: number): Promise<Organization[]> {
    return this.store.listOrganizations(limit);
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const org = await this.store.getOrganization(input.orgId);
    if (!org) {
      throw new Error(`Organization not found: ${input.orgId}`);
    }
    const now = new Date().toISOString();
    const project: Project = {
      id: makeId<"ProjectId">("proj"),
      orgId: input.orgId as Project["orgId"],
      name: input.name,
      status: "active",
      defaultRole: input.defaultRole,
      retentionPolicyId: input.retentionPolicyId,
      createdAt: now,
    };
    await this.store.createProject(project);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "project.created",
      actor: input.createdBy,
      orgId: project.orgId,
      projectId: project.id,
      summary: `Created project ${project.name}`,
      metadata: { orgId: project.orgId, projectId: project.id, name: project.name },
      artifactRefs: [],
      createdAt: now,
    });
    await this.grantCapability({
      subjectType: input.createdBy.type === "agent" ? "agent" : "user",
      subjectId: input.createdBy.id,
      scopeType: "project",
      scopeId: project.id,
      capability: "project.admin",
      grantedBy: input.createdBy,
    });
    return project;
  }

  async listProjects(orgId?: string, limit?: number): Promise<Project[]> {
    return this.store.listProjects(orgId, limit);
  }

  async grantCapability(input: GrantCapabilityInput): Promise<CapabilityGrant> {
    const now = new Date().toISOString();
    const grant: CapabilityGrant = {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      capability: input.capability,
      grantedBy: `${input.grantedBy.type}:${input.grantedBy.id}`,
      createdAt: now,
      expiresAt: input.expiresAt,
    };
    await this.store.grantCapability(grant);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "capability.granted",
      actor: input.grantedBy,
      orgId: input.scopeType === "organization" ? input.scopeId : undefined,
      projectId: input.scopeType === "project" ? input.scopeId : undefined,
      roomId: input.scopeType === "room" ? input.scopeId : undefined,
      sessionId: input.scopeType === "session" ? input.scopeId : undefined,
      summary: `Granted ${input.capability} to ${input.subjectType}:${input.subjectId}`,
      metadata: grant,
      artifactRefs: [],
      createdAt: now,
    });
    return grant;
  }

  async listCapabilityGrants(input: Parameters<AgentStore["listCapabilityGrants"]>[0] = {}): Promise<CapabilityGrant[]> {
    return this.store.listCapabilityGrants(input);
  }

  async hasCapability(input: {
    subjectType: CapabilityGrant["subjectType"];
    subjectId: string;
    scopeType: CapabilityGrant["scopeType"];
    scopeId: string;
    capability: string;
  }): Promise<boolean> {
    const grants = await this.store.listCapabilityGrants({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    });
    const project = input.scopeType === "project" ? await this.store.getProject(input.scopeId) : undefined;
    return grants.some((grant) => {
      if (grant.scopeType === input.scopeType && grant.scopeId === input.scopeId) {
        return capabilityMatches(grant.capability, input.capability, input.scopeType);
      }
      return grant.scopeType === "organization" && input.scopeType === "project" && project?.orgId === grant.scopeId && grant.capability === "org.admin";
    });
  }
}

function capabilityMatches(granted: string, requested: string, scopeType: CapabilityGrant["scopeType"]): boolean {
  if (granted === "*" || granted === requested) {
    return true;
  }
  if (scopeType === "organization" && granted === "org.admin") {
    return true;
  }
  return scopeType === "project" && granted === "project.admin";
}
