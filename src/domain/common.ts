export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type UserId = Brand<string, "UserId">;
export type OrgId = Brand<string, "OrgId">;
export type ProjectId = Brand<string, "ProjectId">;
export type RepositoryId = Brand<string, "RepositoryId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type SessionId = Brand<string, "SessionId">;
export type SubtaskId = Brand<string, "SubtaskId">;
export type MachineId = Brand<string, "MachineId">;
export type AgentId = Brand<string, "AgentId">;
export type WorkerId = Brand<string, "WorkerId">;
export type TaskAssignmentId = Brand<string, "TaskAssignmentId">;
export type RoomId = Brand<string, "RoomId">;
export type MessageId = Brand<string, "MessageId">;
export type ToolCallId = Brand<string, "ToolCallId">;
export type ArtifactId = Brand<string, "ArtifactId">;
export type SecretId = Brand<string, "SecretId">;
export type PluginId = Brand<string, "PluginId">;
export type SpecificationId = Brand<string, "SpecificationId">;
export type SpecificationTaskId = Brand<string, "SpecificationTaskId">;
export type SpecificationVerificationId = Brand<string, "SpecificationVerificationId">;
export type SpecificationVersionId = Brand<string, "SpecificationVersionId">;
export type SpecificationClarificationId = Brand<string, "SpecificationClarificationId">;
export type SpecificationPlanId = Brand<string, "SpecificationPlanId">;

export type Timestamp = string;

export type ActorType = "user" | "agent" | "service_account" | "git_provider_bot" | "system";

export type ActorRef = {
  type: ActorType;
  id: string;
  displayName?: string;
};

export type LifecycleStatus = "active" | "suspended" | "revoked" | "deleted";

export function makeId<T extends string>(prefix: string): Brand<string, T> {
  return `${prefix}_${cryptoRandom()}` as Brand<string, T>;
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 10);
}
