import type {
  ActorRef,
  SpecificationClarificationId,
  SpecificationId,
  SpecificationPlanId,
  SpecificationTaskId,
  SpecificationVerificationId,
  SpecificationVersionId,
  Timestamp,
} from "./common.js";

export type SpecificationStatus = "draft" | "planned" | "ready" | "in_progress" | "completed" | "blocked" | "archived";
export type SpecificationSource = "native" | "specify_import" | "plugin";

export type Specification = {
  id: SpecificationId;
  orgId?: string;
  projectId?: string;
  roomId?: string;
  title: string;
  objective: string;
  status: SpecificationStatus;
  source: SpecificationSource;
  sourcePath?: string;
  createdBy: ActorRef;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type SpecificationTaskStatus = "pending" | "in_progress" | "completed" | "blocked";

export type SpecificationTask = {
  id: SpecificationTaskId;
  specId: SpecificationId;
  title: string;
  description?: string;
  status: SpecificationTaskStatus;
  parallelizable: boolean;
  paths: string[];
  dependsOn: SpecificationTaskId[];
  verification?: string;
  order: number;
  createdBy: ActorRef;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type SpecificationVerificationStatus = "passed" | "failed";

export type SpecificationVerification = {
  id: SpecificationVerificationId;
  specId: SpecificationId;
  taskId: SpecificationTaskId;
  status: SpecificationVerificationStatus;
  evidence: string;
  artifactRefs: string[];
  createdBy: ActorRef;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
};

export type SpecificationTaskSnapshot = Omit<SpecificationTask, "metadata"> & {
  metadata?: Record<string, unknown>;
};

export type SpecificationVersion = {
  id: SpecificationVersionId;
  specId: SpecificationId;
  version: number;
  title: string;
  objective: string;
  status: SpecificationStatus;
  taskSnapshot: SpecificationTaskSnapshot[];
  reason?: string;
  createdBy: ActorRef;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
};

export type SpecificationClarificationStatus = "open" | "answered" | "resolved";

export type SpecificationClarification = {
  id: SpecificationClarificationId;
  specId: SpecificationId;
  question: string;
  answer?: string;
  status: SpecificationClarificationStatus;
  createdBy: ActorRef;
  answeredBy?: ActorRef;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type SpecificationPlanStatus = "draft" | "active" | "superseded" | "archived";

export type SpecificationPlanStep = {
  id: string;
  taskId?: SpecificationTaskId;
  title: string;
  description?: string;
  order: number;
  dependsOn: string[];
  paths: string[];
  verification?: string;
  parallelizable: boolean;
  risk: "low" | "medium" | "high";
  status: "pending" | "ready" | "blocked";
  metadata?: Record<string, unknown>;
};

export type SpecificationPlan = {
  id: SpecificationPlanId;
  specId: SpecificationId;
  versionId?: SpecificationVersionId;
  title: string;
  status: SpecificationPlanStatus;
  summary: string;
  steps: SpecificationPlanStep[];
  openClarificationIds: SpecificationClarificationId[];
  generatedBy: ActorRef;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
};
