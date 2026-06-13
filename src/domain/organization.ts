import type { LifecycleStatus, OrgId, ProjectId, RepositoryId, Timestamp, UserId, WorkspaceId } from "./common.js";

export type OrganizationRole = "owner" | "admin" | "member" | "viewer" | "service";

export type Organization = {
  id: OrgId;
  name: string;
  status: LifecycleStatus;
  createdAt: Timestamp;
};

export type User = {
  id: UserId;
  email?: string;
  displayName: string;
  status: LifecycleStatus;
  createdAt: Timestamp;
};

export type Project = {
  id: ProjectId;
  orgId: OrgId;
  name: string;
  status: LifecycleStatus;
  defaultRole?: OrganizationRole;
  retentionPolicyId?: string;
  createdAt: Timestamp;
};

export type Repository = {
  id: RepositoryId;
  projectId: ProjectId;
  provider: "local" | "github" | "gitlab";
  remoteUrl?: string;
  defaultBranch?: string;
  createdAt: Timestamp;
};

export type Workspace = {
  id: WorkspaceId;
  repositoryId: RepositoryId;
  localPath?: string;
  mode: "local" | "worktree" | "container" | "remote";
  createdAt: Timestamp;
};
