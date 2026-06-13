import { createHash } from "node:crypto";
import type {
  ActorRef,
  ApprovalRequest,
  ArtifactRecord,
  ExecutionMode,
  Specification,
  SpecificationClarification,
  SpecificationClarificationStatus,
  SpecificationPlan,
  SpecificationPlanStatus,
  SpecificationPlanStep,
  SpecificationStatus,
  SpecificationTask,
  SpecificationTaskStatus,
  SpecificationVerification,
  SpecificationVerificationStatus,
  SpecificationVersion,
  RoomMessage,
  Subtask,
  TaskAssignment,
  TaskRisk,
  WorkerRegistration,
} from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore, ListSpecificationsInput } from "../store/agent-store.js";
import type { TaskAssignmentService } from "../tasks/task-assignment-service.js";

export type CreateSpecificationInput = {
  title?: string;
  objective: string;
  actor: ActorRef;
  orgId?: string;
  projectId?: string;
  roomId?: string;
  sourcePath?: string;
  metadata?: Record<string, unknown>;
};

export type CreateSpecificationTaskInput = {
  specId: string;
  title: string;
  actor: ActorRef;
  description?: string;
  parallelizable?: boolean;
  paths?: string[];
  dependsOn?: string[];
  verification?: string;
  order?: number;
  metadata?: Record<string, unknown>;
};

export type UpdateSpecificationTaskStatusInput = {
  taskId: string;
  specId: string;
  status: SpecificationTaskStatus;
  actor: ActorRef;
};

export type { SpecificationVerificationStatus } from "../domain/index.js";

export type RecordSpecificationTaskVerificationInput = {
  specId: string;
  taskId: string;
  status: SpecificationVerificationStatus;
  evidence: string;
  actor: ActorRef;
  artifactRefs?: string[];
  metadata?: Record<string, unknown>;
};

export type ListSpecificationTaskVerificationsInput = {
  specId: string;
  taskId?: string;
  status?: SpecificationVerificationStatus;
  limit?: number;
};

export type SpecificationDagValidationIssue = {
  type: "missing_dependency" | "self_dependency" | "duplicate_dependency" | "cycle";
  taskId: string;
  dependencyId?: string;
  cycle?: string[];
  message: string;
};

export type SpecificationDagValidationResult = {
  specId: string;
  valid: boolean;
  taskCount: number;
  issues: SpecificationDagValidationIssue[];
};

export type SpecificationEvidenceProvider = "github" | "gitlab" | "generic";
export type SpecificationEvidenceConclusion = "success" | "failure" | "cancelled" | "skipped" | "neutral" | "timed_out" | "action_required";

export type RecordSpecificationTaskProviderEvidenceInput = {
  specId: string;
  taskId: string;
  provider: SpecificationEvidenceProvider;
  conclusion: SpecificationEvidenceConclusion;
  actor: ActorRef;
  checkName?: string;
  runId?: string;
  runUrl?: string;
  commitSha?: string;
  branch?: string;
  externalId?: string;
  artifactRefs?: string[];
  metadata?: Record<string, unknown>;
};

export type CreateSpecificationVersionInput = {
  specId: string;
  actor: ActorRef;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type SpecificationVersionDiffSide = "current" | string;

export type SpecificationTaskDiff = {
  taskId: string;
  change: "added" | "removed" | "changed";
  title: string;
  fields: string[];
  before?: Partial<SpecificationTask>;
  after?: Partial<SpecificationTask>;
};

export type SpecificationVersionDiff = {
  specId: string;
  from: SpecificationVersionDiffSide;
  to: SpecificationVersionDiffSide;
  summary: {
    titleChanged: boolean;
    objectiveChanged: boolean;
    statusChanged: boolean;
    addedTasks: number;
    removedTasks: number;
    changedTasks: number;
  };
  specChanges: Array<{ field: "title" | "objective" | "status"; before: string; after: string }>;
  taskChanges: SpecificationTaskDiff[];
};

export type SpecificationVersionDiffArtifactResult = {
  diff: SpecificationVersionDiff;
  artifact: ArtifactRecord;
};

export type CreateSpecificationClarificationInput = {
  specId: string;
  question: string;
  actor: ActorRef;
  metadata?: Record<string, unknown>;
};

export type AnswerSpecificationClarificationInput = {
  specId: string;
  clarificationId: string;
  answer: string;
  actor: ActorRef;
  status?: Extract<SpecificationClarificationStatus, "answered" | "resolved">;
  metadata?: Record<string, unknown>;
};

export type ListSpecificationClarificationsInput = {
  specId: string;
  status?: SpecificationClarificationStatus;
  limit?: number;
};

export type GenerateSpecificationPlanInput = {
  specId: string;
  actor: ActorRef;
  versionId?: string;
  title?: string;
  summary?: string;
  status?: SpecificationPlanStatus;
  metadata?: Record<string, unknown>;
};

export type ListSpecificationPlansInput = {
  specId: string;
  status?: SpecificationPlanStatus;
  limit?: number;
};

export type RequestSpecificationPlanApprovalInput = {
  specId: string;
  planId: string;
  actor: ActorRef;
  reason?: string;
  approverHint?: ApprovalRequest["approverHint"];
};

export type CreateSpecificationDiffArtifactInput = {
  specId: string;
  actor: ActorRef;
  from?: string;
  to?: string;
  name?: string;
};

export type DelegateSpecificationTaskInput = {
  specId: string;
  taskId: string;
  actor: ActorRef;
  assignedAgentId?: string;
  roomId?: string;
  risk?: TaskRisk;
  executionMode?: ExecutionMode;
};

export type DelegateSpecificationTaskResult = {
  specification: Specification;
  task: SpecificationTask;
  subtask: Subtask;
};

export type ListReadySpecificationTasksInput = {
  specId: string;
  limit?: number;
};

export type DispatchReadySpecificationTasksInput = {
  specId: string;
  planId?: string;
  requirePlanApproval?: boolean;
  requiredPlanApprovals?: number;
  workerId?: string;
  autoSelectWorker?: boolean;
  maxDispatchLoadRatio?: number;
  maxQueuedAssignmentsPerWorker?: number;
  actor: ActorRef;
  limit?: number;
  roomId?: string;
  assignedAgentId?: string;
  risk?: TaskRisk;
  executionMode?: ExecutionMode;
  leaseTtlSeconds?: number;
  priority?: number;
};

export type DispatchReadySpecificationTaskResult = {
  task: SpecificationTask;
  subtask: Subtask;
  assignment: TaskAssignment;
};

type DispatchBackpressurePolicy = {
  maxDispatchLoadRatio?: number;
  maxQueuedAssignmentsPerWorker?: number;
};

type DispatchWorkerCandidate = {
  worker: WorkerRegistration;
  loadRatio: number;
  activeAssignments: number;
};

export type SpecificationServiceOptions = {
  signRoomMessage?: (message: Omit<RoomMessage, "signature">) => Promise<string | undefined> | string | undefined;
};

export class SpecificationService {
  constructor(
    private readonly store: AgentStore,
    private readonly assignments?: TaskAssignmentService,
    private readonly options: SpecificationServiceOptions = {},
  ) {}

  async create(input: CreateSpecificationInput): Promise<Specification> {
    const now = new Date().toISOString();
    const specification: Specification = {
      id: makeId<"SpecificationId">("spec"),
      orgId: input.orgId,
      projectId: input.projectId,
      roomId: input.roomId,
      title: input.title?.trim() || deriveTitle(input.objective),
      objective: input.objective.trim(),
      status: "draft",
      source: "native",
      sourcePath: input.sourcePath,
      createdBy: input.actor,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createSpecification(specification);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "spec.created",
      actor: input.actor,
      orgId: input.orgId,
      projectId: input.projectId,
      roomId: input.roomId,
      summary: `Specification created: ${specification.title}`,
      metadata: { specId: specification.id, source: specification.source },
      createdAt: now,
    });
    await this.emitSpecRoomEvent({
      spec: specification,
      actor: input.actor,
      kind: "task",
      title: "spec.created",
      lines: [`Spec: ${specification.id}`, `Title: ${specification.title}`, `Status: ${specification.status}`],
    });
    return specification;
  }

  async get(specId: string): Promise<Specification | undefined> {
    return this.store.getSpecification(specId);
  }

  async list(input: ListSpecificationsInput = {}): Promise<Specification[]> {
    return this.store.listSpecifications(input);
  }

  async addTask(input: CreateSpecificationTaskInput): Promise<SpecificationTask> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    const existing = await this.store.listSpecificationTasks(input.specId);
    const dependsOn = normalizeTaskIds(input.dependsOn);
    this.assertDependenciesExist(dependsOn, existing, input.specId);
    const now = new Date().toISOString();
    const task: SpecificationTask = {
      id: makeId<"SpecificationTaskId">("stask"),
      specId: spec.id,
      title: input.title.trim(),
      description: input.description,
      status: "pending",
      parallelizable: input.parallelizable ?? false,
      paths: input.paths ?? [],
      dependsOn: dependsOn as SpecificationTask["dependsOn"],
      verification: input.verification,
      order: input.order ?? existing.length + 1,
      createdBy: input.actor,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    assertValidTaskDag(spec.id, [...existing, task]);
    await this.store.createSpecificationTask(task);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "spec.task_created",
      actor: input.actor,
      orgId: spec.orgId,
      projectId: spec.projectId,
      roomId: spec.roomId,
      summary: `Specification task created: ${task.title}`,
      metadata: { specId: spec.id, taskId: task.id, paths: task.paths, dependsOn: task.dependsOn },
      createdAt: now,
    });
    await this.emitSpecRoomEvent({
      spec,
      actor: input.actor,
      kind: "task",
      title: "spec.task_created",
      lines: [`Task: ${task.title}`, `Task id: ${task.id}`, `Status: ${task.status}`, `Verification: ${task.verification ?? "-"}`],
    });
    return task;
  }

  async listTasks(specId: string): Promise<SpecificationTask[]> {
    const spec = await this.store.getSpecification(specId);
    if (!spec) {
      throw new Error(`Specification not found: ${specId}`);
    }
    return this.store.listSpecificationTasks(specId);
  }

  async listReadyTasks(input: ListReadySpecificationTasksInput): Promise<SpecificationTask[]> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    const tasks = await this.store.listSpecificationTasks(input.specId);
    assertValidTaskDag(input.specId, tasks);
    return tasks
      .filter((task) => task.status === "pending")
      .filter((task) => this.dependenciesAreCompleted(task, tasks))
      .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt))
      .slice(0, input.limit ?? tasks.length);
  }

  async updateTaskStatus(input: UpdateSpecificationTaskStatusInput): Promise<SpecificationTask> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    const task = (await this.store.listSpecificationTasks(input.specId)).find((candidate) => candidate.id === input.taskId);
    if (!task) {
      throw new Error(`Specification task not found: ${input.taskId}`);
    }
    const updated: SpecificationTask = {
      ...task,
      status: input.status,
      updatedAt: new Date().toISOString(),
    };
    await this.store.updateSpecificationTask(updated);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "spec.task_updated",
      actor: input.actor,
      orgId: spec.orgId,
      projectId: spec.projectId,
      roomId: spec.roomId,
      summary: `Specification task ${input.status}: ${updated.title}`,
      metadata: { specId: spec.id, taskId: updated.id, status: updated.status },
      createdAt: updated.updatedAt,
    });
    await this.emitSpecRoomEvent({
      spec,
      actor: input.actor,
      kind: "task",
      title: "spec.task_updated",
      lines: [`Task: ${updated.title}`, `Task id: ${updated.id}`, `Status: ${updated.status}`],
    });
    return updated;
  }

  async recordTaskVerification(input: RecordSpecificationTaskVerificationInput): Promise<SpecificationTask> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    const task = (await this.store.listSpecificationTasks(input.specId)).find((candidate) => candidate.id === input.taskId);
    if (!task) {
      throw new Error(`Specification task not found: ${input.taskId}`);
    }
    const now = new Date().toISOString();
    const verification: SpecificationVerification = {
      id: makeId<"SpecificationVerificationId">("sver"),
      specId: spec.id,
      taskId: task.id,
      status: input.status,
      evidence: input.evidence,
      artifactRefs: input.artifactRefs ?? [],
      createdBy: input.actor,
      metadata: input.metadata,
      createdAt: now,
    };
    await this.store.createSpecificationVerification(verification);
    const terminalAssignmentStatus = task.metadata?.terminalAssignmentStatus;
    const nextStatus =
      input.status === "passed" && task.status === "blocked" && terminalAssignmentStatus === "completed"
        ? "completed"
        : input.status === "failed" && task.status === "completed"
          ? "blocked"
          : task.status;
    const updated: SpecificationTask = {
      ...task,
      status: nextStatus,
      updatedAt: now,
      metadata: {
        ...(task.metadata ?? {}),
        latestVerification: {
          id: verification.id,
          status: input.status,
          evidence: input.evidence,
          verifiedBy: input.actor,
          verifiedAt: now,
          artifactRefs: input.artifactRefs ?? [],
        },
        verificationEvidence: {
          status: input.status,
          evidence: input.evidence,
          verifiedBy: input.actor,
          verifiedAt: now,
          artifactRefs: input.artifactRefs ?? [],
        },
      },
    };
    await this.store.updateSpecificationTask(updated);
    await this.store.recordAuditEvent({
      id: makeId<"AuditEventId">("audit"),
      type: "spec.task_verified",
      actor: input.actor,
      orgId: spec.orgId,
      projectId: spec.projectId,
      roomId: spec.roomId,
      summary: `Specification task verification ${input.status}: ${task.title}`,
      metadata: {
        specId: spec.id,
        taskId: task.id,
        verificationId: verification.id,
        status: input.status,
        evidence: input.evidence,
        artifactRefs: input.artifactRefs ?? [],
        resultingTaskStatus: updated.status,
      },
      artifactRefs: input.artifactRefs,
      createdAt: now,
    });
    if (updated.status !== task.status) {
      await this.store.recordAuditEvent({
        id: makeId<"AuditEventId">("audit"),
        type: "spec.task_updated",
        actor: input.actor,
        orgId: spec.orgId,
        projectId: spec.projectId,
        roomId: spec.roomId,
        summary: `Specification task ${updated.status}: ${task.title}`,
        metadata: { specId: spec.id, taskId: task.id, status: updated.status, reason: "verification_evidence" },
        createdAt: now,
      });
    }
    await this.emitSpecRoomEvent({
      spec,
      actor: input.actor,
      kind: "decision",
      title: "spec.task_verified",
      lines: [`Task: ${task.title}`, `Task id: ${task.id}`, `Verification: ${input.status}`, `Resulting status: ${updated.status}`, `Evidence: ${compactRoomEventValue(input.evidence)}`],
      artifactRefs: input.artifactRefs,
    });
    return updated;
  }

  async listTaskVerifications(input: ListSpecificationTaskVerificationsInput): Promise<SpecificationVerification[]> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    if (input.taskId) {
      const task = (await this.store.listSpecificationTasks(input.specId)).find((candidate) => candidate.id === input.taskId);
      if (!task) {
        throw new Error(`Specification task not found: ${input.taskId}`);
      }
    }
    return this.store.listSpecificationVerifications(input);
  }

  async recordProviderEvidence(input: RecordSpecificationTaskProviderEvidenceInput): Promise<SpecificationTask> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    const task = (await this.store.listSpecificationTasks(input.specId)).find((candidate) => candidate.id === input.taskId);
    if (!task) {
      throw new Error(`Specification task not found: ${input.taskId}`);
    }
    const now = new Date().toISOString();
    const providerMetadata = providerEvidenceMetadata(input);
    const artifactRefs = [...(input.artifactRefs ?? [])];
    if (input.runUrl) {
      const artifact: ArtifactRecord = {
        id: makeId<"ArtifactId">("artifact"),
        kind: "report",
        name: `${input.provider} evidence: ${input.checkName?.trim() || task.title}`,
        uri: input.runUrl,
        orgId: spec.orgId,
        projectId: spec.projectId,
        roomId: spec.roomId,
        createdBy: input.actor,
        status: "active",
        createdAt: now,
        metadata: providerMetadata,
      };
      await this.store.createArtifact(artifact);
      artifactRefs.push(artifact.id);
    }
    return this.recordTaskVerification({
      actor: input.actor,
      specId: input.specId,
      taskId: input.taskId,
      status: input.conclusion === "success" ? "passed" : "failed",
      evidence: formatProviderEvidence(input),
      artifactRefs,
      metadata: {
        evidenceSource: "provider",
        providerEvidence: providerMetadata,
        ...(input.metadata ?? {}),
      },
    });
  }

  async createVersion(input: CreateSpecificationVersionInput): Promise<SpecificationVersion> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    const tasks = await this.store.listSpecificationTasks(input.specId);
    assertValidTaskDag(input.specId, tasks);
    const latest = (await this.store.listSpecificationVersions({ specId: input.specId, limit: 1 }))[0];
    const now = new Date().toISOString();
    const version: SpecificationVersion = {
      id: makeId<"SpecificationVersionId">("specver"),
      specId: spec.id,
      version: (latest?.version ?? 0) + 1,
      title: spec.title,
      objective: spec.objective,
      status: spec.status,
      taskSnapshot: tasks.map((task) => ({ ...task })),
      reason: input.reason,
      createdBy: input.actor,
      metadata: input.metadata,
      createdAt: now,
    };
    await this.store.createSpecificationVersion(version);
    await this.store.recordAuditEvent({
      id: makeId<"AuditEventId">("audit"),
      type: "spec.version_created",
      actor: input.actor,
      orgId: spec.orgId,
      projectId: spec.projectId,
      roomId: spec.roomId,
      summary: `Specification version created: ${spec.title} v${version.version}`,
      metadata: {
        specId: spec.id,
        versionId: version.id,
        version: version.version,
        taskCount: version.taskSnapshot.length,
        reason: input.reason,
      },
      createdAt: now,
    });
    await this.emitSpecRoomEvent({
      spec,
      actor: input.actor,
      kind: "task",
      title: "spec.version_created",
      lines: [`Version: ${version.version}`, `Version id: ${version.id}`, `Tasks: ${version.taskSnapshot.length}`, `Reason: ${input.reason ?? "-"}`],
    });
    return version;
  }

  async listVersions(specId: string, limit?: number): Promise<SpecificationVersion[]> {
    const spec = await this.store.getSpecification(specId);
    if (!spec) {
      throw new Error(`Specification not found: ${specId}`);
    }
    return this.store.listSpecificationVersions({ specId, limit });
  }

  async diffVersions(input: { specId: string; from?: string; to?: string }): Promise<SpecificationVersionDiff> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    const versions = await this.store.listSpecificationVersions({ specId: input.specId, limit: 500 });
    const from = input.from ? findVersionOrThrow(versions, input.from, "from") : versions[1];
    const to = input.to ? (input.to === "current" ? undefined : findVersionOrThrow(versions, input.to, "to")) : versions[0];
    if (!from) {
      throw new Error("Specification version diff requires at least two versions, or an explicit --from version.");
    }
    const currentTasks = await this.store.listSpecificationTasks(input.specId);
    assertValidTaskDag(input.specId, currentTasks);
    const before = versionComparable(from);
    const after = to ? versionComparable(to) : currentComparable(spec, currentTasks);
    return buildVersionDiff(input.specId, before, after);
  }

  async createDiffArtifact(input: CreateSpecificationDiffArtifactInput): Promise<SpecificationVersionDiffArtifactResult> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    const diff = await this.diffVersions({ specId: input.specId, from: input.from, to: input.to });
    const now = new Date().toISOString();
    const payload = JSON.stringify(diff, null, 2);
    const artifact: ArtifactRecord = {
      id: makeId<"ArtifactId">("art"),
      kind: "report",
      name: input.name?.trim() || `Specification diff ${spec.title}: ${diff.from} -> ${diff.to}`,
      mimeType: "application/vnd.agent.spec-diff+json",
      sizeBytes: Buffer.byteLength(payload, "utf8"),
      sha256: createHash("sha256").update(payload).digest("hex"),
      orgId: spec.orgId,
      projectId: spec.projectId,
      roomId: spec.roomId,
      createdBy: input.actor,
      status: "active",
      createdAt: now,
      metadata: {
        type: "specification.version_diff",
        specId: spec.id,
        from: diff.from,
        to: diff.to,
        summary: diff.summary,
        diff,
      },
    };
    await this.store.createArtifact(artifact);
    await this.store.recordAuditEvent({
      id: makeId<"AuditEventId">("audit"),
      type: "spec.diff_artifact_created",
      actor: input.actor,
      orgId: spec.orgId,
      projectId: spec.projectId,
      roomId: spec.roomId,
      summary: `Specification diff artifact created: ${spec.title}`,
      metadata: {
        specId: spec.id,
        artifactId: artifact.id,
        from: diff.from,
        to: diff.to,
        summary: diff.summary,
        sha256: artifact.sha256,
      },
      artifactRefs: [artifact.id],
      createdAt: now,
    });
    await this.emitSpecRoomEvent({
      spec,
      actor: input.actor,
      kind: "task",
      title: "spec.diff_artifact_created",
      lines: [`Artifact: ${artifact.id}`, `From: ${diff.from}`, `To: ${diff.to}`, `Changed tasks: ${diff.summary.changedTasks}`],
      artifactRefs: [artifact.id],
    });
    return { diff, artifact };
  }

  async createClarification(input: CreateSpecificationClarificationInput): Promise<SpecificationClarification> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    const now = new Date().toISOString();
    const clarification: SpecificationClarification = {
      id: makeId<"SpecificationClarificationId">("sclar"),
      specId: spec.id,
      question: input.question.trim(),
      status: "open",
      createdBy: input.actor,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    if (!clarification.question) {
      throw new Error("Clarification question cannot be empty.");
    }
    await this.store.createSpecificationClarification(clarification);
    await this.store.recordAuditEvent({
      id: makeId<"AuditEventId">("audit"),
      type: "spec.clarification_created",
      actor: input.actor,
      orgId: spec.orgId,
      projectId: spec.projectId,
      roomId: spec.roomId,
      summary: `Specification clarification opened: ${spec.title}`,
      metadata: { specId: spec.id, clarificationId: clarification.id, status: clarification.status, question: clarification.question },
      createdAt: now,
    });
    await this.emitSpecRoomEvent({
      spec,
      actor: input.actor,
      kind: "task",
      title: "spec.clarification_created",
      lines: [`Clarification: ${clarification.id}`, `Status: ${clarification.status}`, `Question: ${clarification.question}`],
    });
    return clarification;
  }

  async answerClarification(input: AnswerSpecificationClarificationInput): Promise<SpecificationClarification> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    const clarification = (await this.store.listSpecificationClarifications({ specId: input.specId, limit: 500 })).find(
      (candidate) => candidate.id === input.clarificationId,
    );
    if (!clarification) {
      throw new Error(`Specification clarification not found: ${input.clarificationId}`);
    }
    const answer = input.answer.trim();
    if (!answer) {
      throw new Error("Clarification answer cannot be empty.");
    }
    const now = new Date().toISOString();
    const updated: SpecificationClarification = {
      ...clarification,
      answer,
      status: input.status ?? "answered",
      answeredBy: input.actor,
      metadata: {
        ...(clarification.metadata ?? {}),
        ...(input.metadata ?? {}),
      },
      updatedAt: now,
    };
    await this.store.updateSpecificationClarification(updated);
    await this.store.recordAuditEvent({
      id: makeId<"AuditEventId">("audit"),
      type: "spec.clarification_updated",
      actor: input.actor,
      orgId: spec.orgId,
      projectId: spec.projectId,
      roomId: spec.roomId,
      summary: `Specification clarification ${updated.status}: ${spec.title}`,
      metadata: { specId: spec.id, clarificationId: updated.id, status: updated.status },
      createdAt: now,
    });
    await this.emitSpecRoomEvent({
      spec,
      actor: input.actor,
      kind: "decision",
      title: "spec.clarification_updated",
      lines: [`Clarification: ${updated.id}`, `Status: ${updated.status}`, `Answer: ${compactRoomEventValue(answer)}`],
    });
    return updated;
  }

  async listClarifications(input: ListSpecificationClarificationsInput): Promise<SpecificationClarification[]> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    return this.store.listSpecificationClarifications(input);
  }

  async generatePlan(input: GenerateSpecificationPlanInput): Promise<SpecificationPlan> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    const tasks = await this.store.listSpecificationTasks(input.specId);
    const versions = await this.store.listSpecificationVersions({ specId: input.specId, limit: 100 });
    const version = input.versionId
      ? versions.find((candidate) => candidate.id === input.versionId)
      : versions[0];
    if (input.versionId && !version) {
      throw new Error(`Specification version not found: ${input.versionId}`);
    }
    assertValidTaskDag(input.specId, version?.taskSnapshot ?? tasks);
    const clarifications = await this.store.listSpecificationClarifications({ specId: input.specId, limit: 500 });
    const openClarifications = clarifications.filter((clarification) => clarification.status === "open");
    const orderedTasks = orderTasksForPlan(version?.taskSnapshot ?? tasks);
    const steps = orderedTasks.map((task, index) => planStepFromTask(task, index + 1, orderedTasks));
    const now = new Date().toISOString();
    const plan: SpecificationPlan = {
      id: makeId<"SpecificationPlanId">("splan"),
      specId: spec.id,
      versionId: version?.id,
      title: input.title?.trim() || `Plan for ${spec.title}`,
      status: input.status ?? (openClarifications.length > 0 ? "draft" : "active"),
      summary: input.summary?.trim() || summarizePlan(spec, steps, openClarifications.length, version?.version),
      steps,
      openClarificationIds: openClarifications.map((clarification) => clarification.id),
      generatedBy: input.actor,
      metadata: {
        generatedFrom: version ? "version" : "current_spec",
        versionNumber: version?.version,
        taskCount: steps.length,
        openClarificationCount: openClarifications.length,
        ...(input.metadata ?? {}),
      },
      createdAt: now,
    };
    await this.store.createSpecificationPlan(plan);
    await this.store.recordAuditEvent({
      id: makeId<"AuditEventId">("audit"),
      type: "spec.plan_created",
      actor: input.actor,
      orgId: spec.orgId,
      projectId: spec.projectId,
      roomId: spec.roomId,
      summary: `Specification plan created: ${plan.title}`,
      metadata: {
        specId: spec.id,
        planId: plan.id,
        status: plan.status,
        versionId: plan.versionId,
        stepCount: plan.steps.length,
        openClarificationCount: plan.openClarificationIds.length,
      },
      createdAt: now,
    });
    await this.emitSpecRoomEvent({
      spec,
      actor: input.actor,
      kind: "task",
      title: "spec.plan_created",
      lines: [`Plan: ${plan.id}`, `Status: ${plan.status}`, `Steps: ${plan.steps.length}`, `Open clarifications: ${plan.openClarificationIds.length}`, `Summary: ${plan.summary}`],
    });
    return plan;
  }

  async listPlans(input: ListSpecificationPlansInput): Promise<SpecificationPlan[]> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    return this.store.listSpecificationPlans(input);
  }

  async validateDag(specId: string): Promise<SpecificationDagValidationResult> {
    const spec = await this.store.getSpecification(specId);
    if (!spec) {
      throw new Error(`Specification not found: ${specId}`);
    }
    const tasks = await this.store.listSpecificationTasks(specId);
    const issues = validateTaskDag(tasks);
    return {
      specId,
      valid: issues.length === 0,
      taskCount: tasks.length,
      issues,
    };
  }

  async requestPlanApproval(input: RequestSpecificationPlanApprovalInput): Promise<ApprovalRequest> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    const plan = await this.requirePlan(input.specId, input.planId);
    const now = new Date().toISOString();
    const requiredApprovals = await this.requiredPlanApprovals(spec);
    const approval: ApprovalRequest = {
      id: makeId<"ArtifactId">("appr"),
      status: "pending",
      requestedBy: input.actor,
      action: "spec.plan.approve",
      reason: input.reason?.trim() || `Approve specification plan ${plan.id} for ${spec.title}.`,
      approverHint: input.approverHint ?? (requiredApprovals > 1 ? "quorum" : "human"),
      orgId: spec.orgId,
      projectId: spec.projectId,
      roomId: spec.roomId,
      toolName: "spec.plan",
      inputSummary: planApprovalSummary(spec.id, plan.id),
      createdAt: now,
    };
    await this.store.createApprovalRequest(approval);
    await this.store.recordAuditEvent({
      id: makeId<"AuditEventId">("audit"),
      type: "spec.plan_approval_requested",
      actor: input.actor,
      orgId: spec.orgId,
      projectId: spec.projectId,
      roomId: spec.roomId,
      summary: `Specification plan approval requested: ${plan.title}`,
      metadata: {
        specId: spec.id,
        planId: plan.id,
        approvalId: approval.id,
        planStatus: plan.status,
        requiredApprovals,
      },
      createdAt: now,
    });
    if (spec.roomId) {
      await this.store.appendRoomMessage({
        id: makeId<"MessageId">("msg"),
        roomId: spec.roomId as Parameters<AgentStore["appendRoomMessage"]>[0]["roomId"],
        sender: input.actor,
        kind: "approval",
        body: `Plan approval requested: ${approval.id}\nSpec: ${spec.id}\nPlan: ${plan.id}\nStatus: ${plan.status}\nRequired approvals: ${requiredApprovals}\nReason: ${approval.reason}`,
        createdAt: now,
        artifactRefs: [],
      });
    }
    return approval;
  }

  async delegateTask(input: DelegateSpecificationTaskInput): Promise<DelegateSpecificationTaskResult> {
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    const tasks = await this.store.listSpecificationTasks(input.specId);
    assertValidTaskDag(input.specId, tasks);
    const task = tasks.find((candidate) => candidate.id === input.taskId);
    if (!task) {
      throw new Error(`Specification task not found: ${input.taskId}`);
    }
    if (task.status === "completed") {
      throw new Error(`Cannot delegate a completed specification task: ${task.id}`);
    }
    this.assertDependenciesCompleted(task, tasks);

    const now = new Date().toISOString();
    const objective = formatDelegatedObjective(spec, task);
    const childSession = await this.store.createSession({
      orgId: spec.orgId,
      projectId: spec.projectId,
      roomId: input.roomId ?? spec.roomId,
      objective,
      targetMode: "goal",
      status: "paused",
      risk: input.risk ?? "medium",
      createdBy: input.actor,
    });
    await this.store.appendMessage({
      sessionId: childSession.id,
      message: {
        role: "system",
        content: "This child session was created from a specification task. Follow the active platform policy, cite the spec task in the result, and keep the work scoped to the task.",
      },
    });
    await this.store.appendMessage({
      sessionId: childSession.id,
      message: {
        role: "user",
        content: objective,
      },
    });

    const subtask: Subtask = {
      id: makeId<"SubtaskId">("subtask"),
      childSessionId: childSession.id,
      specId: spec.id,
      specTaskId: task.id,
      roomId: input.roomId ?? spec.roomId,
      assignedAgentId: input.assignedAgentId,
      objective,
      status: "created",
      risk: input.risk ?? "medium",
      executionMode: input.executionMode ?? "trusted",
      createdBy: input.actor,
      artifactRefs: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createSubtask(subtask);

    const updatedTask: SpecificationTask = {
      ...task,
      status: "in_progress",
      updatedAt: now,
      metadata: {
        ...(task.metadata ?? {}),
        delegatedSubtaskId: subtask.id,
        delegatedChildSessionId: childSession.id,
      },
    };
    await this.store.updateSpecificationTask(updatedTask);
    await this.store.recordAuditEvent({
      id: makeId<"AuditEventId">("audit"),
      type: "spec.task_delegated",
      actor: input.actor,
      orgId: spec.orgId,
      projectId: spec.projectId,
      sessionId: childSession.id,
      roomId: input.roomId ?? spec.roomId,
      summary: `Specification task delegated: ${task.title}`,
      metadata: {
        specId: spec.id,
        taskId: task.id,
        subtaskId: subtask.id,
        childSessionId: childSession.id,
        assignedAgentId: input.assignedAgentId,
      },
      createdAt: now,
    });
    await this.store.recordAuditEvent({
      id: makeId<"AuditEventId">("audit"),
      type: "spec.task_updated",
      actor: input.actor,
      orgId: spec.orgId,
      projectId: spec.projectId,
      sessionId: childSession.id,
      roomId: input.roomId ?? spec.roomId,
      summary: `Specification task in_progress: ${task.title}`,
      metadata: { specId: spec.id, taskId: task.id, status: "in_progress" },
      createdAt: now,
    });

    if (subtask.roomId) {
      await this.store.appendRoomMessage({
        id: makeId<"MessageId">("msg"),
        roomId: subtask.roomId as Parameters<AgentStore["appendRoomMessage"]>[0]["roomId"],
        sender: input.actor,
        kind: "task",
        body: `Specification task delegated: ${task.title}\nSpec: ${spec.id}\nTask: ${task.id}\nSubtask: ${subtask.id}\nChild session: ${childSession.id}`,
        createdAt: now,
        artifactRefs: [],
      });
    }

    return { specification: spec, task: updatedTask, subtask };
  }

  async dispatchReadyTasks(input: DispatchReadySpecificationTasksInput): Promise<DispatchReadySpecificationTaskResult[]> {
    if (!this.assignments) {
      throw new Error("Specification dispatch requires TaskAssignmentService.");
    }
    if ((input.workerId ? 1 : 0) + (input.autoSelectWorker ? 1 : 0) !== 1) {
      throw new Error("Provide exactly one of workerId or autoSelectWorker.");
    }
    const spec = await this.store.getSpecification(input.specId);
    if (!spec) {
      throw new Error(`Specification not found: ${input.specId}`);
    }
    if (input.requirePlanApproval || input.requiredPlanApprovals !== undefined) {
      if (!input.planId) {
        throw new Error("Specification dispatch requires an approved plan id.");
      }
      await this.assertPlanApprovedForDispatch(spec, input.planId, input.requiredPlanApprovals);
    }
    const ready = await this.listReadyTasks({ specId: input.specId, limit: input.limit });
    const results: DispatchReadySpecificationTaskResult[] = [];
    const dispatchPolicy = normalizeDispatchPolicy(input);
    for (const task of ready) {
      const worker = input.workerId
        ? await this.requireDispatchWorker(input.workerId, spec.projectId, dispatchPolicy)
        : await this.selectDispatchWorker(spec.projectId, dispatchPolicy);
      if (!worker) {
        if (results.length > 0) {
          break;
        }
        throw new Error(`No schedulable worker found for specification ${spec.id}${spec.projectId ? ` project=${spec.projectId}` : ""}.`);
      }
      const delegated = await this.delegateTask({
        specId: input.specId,
        taskId: task.id,
        actor: input.actor,
        assignedAgentId: input.assignedAgentId,
        roomId: input.roomId,
        risk: input.risk,
        executionMode: input.executionMode,
      });
      const assignment = await this.assignments.assign({
        actor: input.actor,
        workerId: worker.id,
        subtaskId: delegated.subtask.id,
        leaseTtlSeconds: input.leaseTtlSeconds,
        priority: input.priority,
        metadata: {
          specId: delegated.specification.id,
          specTaskId: delegated.task.id,
          planId: input.planId,
          subtaskId: delegated.subtask.id,
          dispatch: "spec.ready",
        },
      });
      results.push({
        task: delegated.task,
        subtask: delegated.subtask,
        assignment,
      });
    }
    return results;
  }

  private async requireDispatchWorker(workerId: string, projectId: string | undefined, policy: DispatchBackpressurePolicy): Promise<WorkerRegistration> {
    const worker = await this.store.getWorkerRegistration(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }
    const candidate = await this.toDispatchCandidate(worker, projectId, policy);
    if (!candidate) {
      throw new Error(`Worker is not schedulable for specification dispatch: ${worker.id}`);
    }
    return candidate.worker;
  }

  private async selectDispatchWorker(projectId: string | undefined, policy: DispatchBackpressurePolicy): Promise<WorkerRegistration | undefined> {
    const now = new Date().toISOString();
    const workers = await this.store.listWorkerRegistrations({ status: "online", limit: 100 });
    const candidates: DispatchWorkerCandidate[] = [];
    for (const worker of workers) {
      if (worker.expiresAt && worker.expiresAt <= now) {
        continue;
      }
      const candidate = await this.toDispatchCandidate(worker, projectId, policy);
      if (candidate) {
        candidates.push(candidate);
      }
    }
    return candidates
      .sort((left, right) => {
        if (left.loadRatio !== right.loadRatio) {
          return left.loadRatio - right.loadRatio;
        }
        if (left.activeAssignments !== right.activeAssignments) {
          return left.activeAssignments - right.activeAssignments;
        }
        if (left.worker.currentLoad !== right.worker.currentLoad) {
          return left.worker.currentLoad - right.worker.currentLoad;
        }
        return left.worker.registeredAt.localeCompare(right.worker.registeredAt);
      })[0]?.worker;
  }

  private async toDispatchCandidate(worker: WorkerRegistration, projectId: string | undefined, policy: DispatchBackpressurePolicy): Promise<DispatchWorkerCandidate | undefined> {
    if (worker.status !== "online") {
      return undefined;
    }
    if (worker.expiresAt && worker.expiresAt <= new Date().toISOString()) {
      return undefined;
    }
    if (projectId && worker.allowedProjects.length > 0 && !worker.allowedProjects.includes(projectId as WorkerRegistration["allowedProjects"][number])) {
      return undefined;
    }
    if (worker.currentLoad >= worker.maxConcurrentTasks) {
      return undefined;
    }
    const projectedLoadRatio = (worker.currentLoad + 1) / Math.max(1, worker.maxConcurrentTasks);
    if (policy.maxDispatchLoadRatio !== undefined && projectedLoadRatio > policy.maxDispatchLoadRatio) {
      return undefined;
    }
    const activeAssignments = await this.countActiveAssignments(worker.id);
    if (policy.maxQueuedAssignmentsPerWorker !== undefined && activeAssignments + 1 > policy.maxQueuedAssignmentsPerWorker) {
      return undefined;
    }
    return {
      worker,
      loadRatio: worker.currentLoad / Math.max(1, worker.maxConcurrentTasks),
      activeAssignments,
    };
  }

  private async countActiveAssignments(workerId: WorkerRegistration["id"]): Promise<number> {
    const leased = await this.store.listTaskAssignments({ workerId, status: "leased", limit: 1000 });
    const running = await this.store.listTaskAssignments({ workerId, status: "running", limit: 1000 });
    return leased.length + running.length;
  }

  private async requirePlan(specId: string, planId: string): Promise<SpecificationPlan> {
    const plan = (await this.store.listSpecificationPlans({ specId, limit: 500 })).find((candidate) => candidate.id === planId);
    if (!plan) {
      throw new Error(`Specification plan not found: ${planId}`);
    }
    return plan;
  }

  private async assertPlanApprovedForDispatch(spec: Specification, planId: string, requiredApprovalsOverride?: number): Promise<void> {
    const plan = await this.requirePlan(spec.id, planId);
    if (plan.status !== "active") {
      throw new Error(`Specification plan must be active before dispatch: ${plan.id} status=${plan.status}`);
    }
    if (plan.openClarificationIds.length > 0) {
      throw new Error(`Specification plan has open clarifications and cannot be dispatched: ${plan.id}`);
    }
    const requiredApprovals = await this.requiredPlanApprovals(spec, requiredApprovalsOverride);
    const summary = planApprovalSummary(spec.id, plan.id);
    const approvers = new Set(
      (await this.store.listApprovalRequests("approved"))
        .filter((approval) => approval.action === "spec.plan.approve" && approval.inputSummary === summary)
        .map((approval) => approval.decisionBy ? `${approval.decisionBy.type}:${approval.decisionBy.id}` : `approval:${approval.id}`),
    );
    if (approvers.size < requiredApprovals) {
      throw new Error(`Specification plan is not approved for dispatch: ${plan.id} approvals=${approvers.size}/${requiredApprovals}`);
    }
  }

  private async requiredPlanApprovals(spec: Specification, override?: number): Promise<number> {
    if (override !== undefined) {
      if (!Number.isInteger(override) || override < 1) {
        throw new Error("requiredPlanApprovals must be a positive integer.");
      }
      return override;
    }
    if (!spec.roomId) {
      return 1;
    }
    const room = await this.store.getRoom(spec.roomId);
    const required = room?.policy.requiredApprovals;
    return required && required > 1 ? required : 1;
  }

  private async emitSpecRoomEvent(input: {
    spec: Specification;
    actor: ActorRef;
    kind: "task" | "decision" | "approval";
    title: string;
    lines: string[];
    artifactRefs?: string[];
  }): Promise<void> {
    if (!input.spec.roomId || !(await this.store.getRoom(input.spec.roomId))) {
      return;
    }
    try {
      const createdAt = new Date().toISOString();
      const unsigned: Omit<RoomMessage, "signature"> = {
        id: makeId<"MessageId">("msg"),
        roomId: input.spec.roomId as Parameters<AgentStore["appendRoomMessage"]>[0]["roomId"],
        sender: input.actor,
        kind: input.kind,
        body: [`Spec event: ${input.title}`, `Spec: ${input.spec.id}`, ...input.lines].join("\n"),
        createdAt,
        artifactRefs: (input.artifactRefs ?? []) as Parameters<AgentStore["appendRoomMessage"]>[0]["artifactRefs"],
        metadata: {
          eventEnvelope: {
            type: input.title,
            specId: input.spec.id,
            orgId: input.spec.orgId,
            projectId: input.spec.projectId,
            roomId: input.spec.roomId,
            kind: input.kind,
            actor: input.actor,
            lines: input.lines,
            artifactRefs: input.artifactRefs ?? [],
            createdAt,
            schemaVersion: 1,
          },
        },
      };
      const signature = await this.options.signRoomMessage?.(unsigned);
      await this.store.appendRoomMessage(signature ? { ...unsigned, signature } : unsigned);
    } catch {
      // Room transcript projection is best-effort; domain rows and audit events remain authoritative.
    }
  }

  private assertDependenciesExist(dependsOn: string[], existing: SpecificationTask[], specId: string): void {
    if (dependsOn.length === 0) {
      return;
    }
    const known = new Set<string>(existing.map((task) => task.id));
    const missing = dependsOn.filter((taskId) => !known.has(taskId));
    if (missing.length > 0) {
      throw new Error(`Specification task dependencies not found in ${specId}: ${missing.join(", ")}`);
    }
  }

  private assertDependenciesCompleted(task: SpecificationTask, tasks: SpecificationTask[]): void {
    if (task.dependsOn.length === 0) {
      return;
    }
    const byId = new Map<string, SpecificationTask>(tasks.map((candidate) => [candidate.id, candidate]));
    const missing: string[] = [];
    const unmet: string[] = [];
    for (const taskId of task.dependsOn) {
      const dependency = byId.get(taskId);
      if (!dependency) {
        missing.push(taskId);
        continue;
      }
      if (dependency.status !== "completed") {
        unmet.push(`${dependency.id}:${dependency.status}`);
      }
    }
    if (missing.length > 0 || unmet.length > 0) {
      const parts = [];
      if (missing.length > 0) {
        parts.push(`missing=${missing.join(",")}`);
      }
      if (unmet.length > 0) {
        parts.push(`unmet=${unmet.join(",")}`);
      }
      throw new Error(`Specification task dependencies are not completed for ${task.id}: ${parts.join(" ")}`);
    }
  }

  private dependenciesAreCompleted(task: SpecificationTask, tasks: SpecificationTask[]): boolean {
    if (task.dependsOn.length === 0) {
      return true;
    }
    const byId = new Map<string, SpecificationTask>(tasks.map((candidate) => [candidate.id, candidate]));
    return task.dependsOn.every((taskId) => byId.get(taskId)?.status === "completed");
  }
}

function deriveTitle(objective: string): string {
  const title = objective.trim().replace(/\s+/g, " ");
  if (!title) {
    return "Untitled specification";
  }
  return title.length > 72 ? `${title.slice(0, 69)}...` : title;
}

function formatDelegatedObjective(spec: Specification, task: SpecificationTask): string {
  const lines = [
    `Specification: ${spec.title} (${spec.id})`,
    `Specification objective: ${spec.objective}`,
    `Task: ${task.title} (${task.id})`,
  ];
  if (task.description) {
    lines.push(`Task description: ${task.description}`);
  }
  if (task.paths.length > 0) {
    lines.push(`Relevant paths: ${task.paths.join(", ")}`);
  }
  if (task.dependsOn.length > 0) {
    lines.push(`Depends on: ${task.dependsOn.join(", ")}`);
  }
  if (task.verification) {
    lines.push(`Verification: ${task.verification}`);
  }
  lines.push("Complete only this task, report verification, and avoid unrelated changes.");
  return lines.join("\n");
}

function normalizeTaskIds(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])].map((value) => value.trim()).filter(Boolean);
}

function normalizeDispatchPolicy(input: DispatchReadySpecificationTasksInput): DispatchBackpressurePolicy {
  if (input.maxDispatchLoadRatio !== undefined && (input.maxDispatchLoadRatio < 0 || input.maxDispatchLoadRatio > 1 || Number.isNaN(input.maxDispatchLoadRatio))) {
    throw new Error("maxDispatchLoadRatio must be between 0 and 1.");
  }
  if (
    input.maxQueuedAssignmentsPerWorker !== undefined &&
    (!Number.isInteger(input.maxQueuedAssignmentsPerWorker) || input.maxQueuedAssignmentsPerWorker < 0)
  ) {
    throw new Error("maxQueuedAssignmentsPerWorker must be a non-negative integer.");
  }
  return {
    maxDispatchLoadRatio: input.maxDispatchLoadRatio,
    maxQueuedAssignmentsPerWorker: input.maxQueuedAssignmentsPerWorker,
  };
}

function assertValidTaskDag<T extends Pick<SpecificationTask, "id" | "dependsOn">>(specId: string, tasks: T[]): void {
  const issues = validateTaskDag(tasks);
  if (issues.length > 0) {
    const summary = issues.slice(0, 3).map((issue) => issue.message).join("; ");
    throw new Error(`Specification task graph is invalid for ${specId}: ${summary}`);
  }
}

function validateTaskDag<T extends Pick<SpecificationTask, "id" | "dependsOn">>(tasks: T[]): SpecificationDagValidationIssue[] {
  const issues: SpecificationDagValidationIssue[] = [];
  const byId = new Map<string, T>();
  for (const task of tasks) {
    byId.set(task.id, task);
  }

  for (const task of tasks) {
    const seenDependencies = new Set<string>();
    for (const dependencyId of task.dependsOn) {
      if (seenDependencies.has(dependencyId)) {
        issues.push({
          type: "duplicate_dependency",
          taskId: task.id,
          dependencyId,
          message: `Task ${task.id} repeats dependency ${dependencyId}.`,
        });
      }
      seenDependencies.add(dependencyId);
      if (dependencyId === task.id) {
        issues.push({
          type: "self_dependency",
          taskId: task.id,
          dependencyId,
          message: `Task ${task.id} depends on itself.`,
        });
      } else if (!byId.has(dependencyId)) {
        issues.push({
          type: "missing_dependency",
          taskId: task.id,
          dependencyId,
          message: `Task ${task.id} depends on missing task ${dependencyId}.`,
        });
      }
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const reportedCycles = new Set<string>();

  const visit = (task: T): void => {
    if (visited.has(task.id)) {
      return;
    }
    if (visiting.has(task.id)) {
      const start = stack.indexOf(task.id);
      const cycle = [...stack.slice(Math.max(0, start)), task.id];
      const key = normalizeCycleKey(cycle);
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        issues.push({
          type: "cycle",
          taskId: task.id,
          cycle,
          message: `Task dependency cycle detected: ${cycle.join(" -> ")}.`,
        });
      }
      return;
    }
    visiting.add(task.id);
    stack.push(task.id);
    for (const dependencyId of task.dependsOn) {
      const dependency = byId.get(dependencyId);
      if (dependency) {
        visit(dependency);
      }
    }
    stack.pop();
    visiting.delete(task.id);
    visited.add(task.id);
  };

  for (const task of tasks) {
    visit(task);
  }

  return issues;
}

function normalizeCycleKey(cycle: string[]): string {
  const unique = cycle.at(0) === cycle.at(-1) ? cycle.slice(0, -1) : [...cycle];
  if (unique.length === 0) {
    return "";
  }
  const rotations = unique.map((_, index) => [...unique.slice(index), ...unique.slice(0, index)].join(">"));
  rotations.sort();
  return rotations[0];
}

type ComparableSpecVersion = {
  label: string;
  title: string;
  objective: string;
  status: SpecificationStatus;
  tasks: Array<SpecificationTask | SpecificationVersion["taskSnapshot"][number]>;
};

function findVersionOrThrow(versions: SpecificationVersion[], idOrNumber: string, label: "from" | "to"): SpecificationVersion {
  const version = versions.find((candidate) => candidate.id === idOrNumber || String(candidate.version) === idOrNumber);
  if (!version) {
    throw new Error(`Specification ${label} version not found: ${idOrNumber}`);
  }
  return version;
}

function versionComparable(version: SpecificationVersion): ComparableSpecVersion {
  return {
    label: version.id,
    title: version.title,
    objective: version.objective,
    status: version.status,
    tasks: version.taskSnapshot,
  };
}

function currentComparable(spec: Specification, tasks: SpecificationTask[]): ComparableSpecVersion {
  return {
    label: "current",
    title: spec.title,
    objective: spec.objective,
    status: spec.status,
    tasks,
  };
}

function buildVersionDiff(specId: string, before: ComparableSpecVersion, after: ComparableSpecVersion): SpecificationVersionDiff {
  const specChanges: SpecificationVersionDiff["specChanges"] = [];
  for (const field of ["title", "objective", "status"] as const) {
    if (before[field] !== after[field]) {
      specChanges.push({ field, before: before[field], after: after[field] });
    }
  }

  const beforeTasks = new Map(before.tasks.map((task) => [task.id, task]));
  const afterTasks = new Map(after.tasks.map((task) => [task.id, task]));
  const taskChanges: SpecificationTaskDiff[] = [];
  const allTaskIds = [...new Set([...beforeTasks.keys(), ...afterTasks.keys()])].sort();
  for (const taskId of allTaskIds) {
    const left = beforeTasks.get(taskId);
    const right = afterTasks.get(taskId);
    if (!left && right) {
      taskChanges.push({
        taskId,
        change: "added",
        title: right.title,
        fields: ["task"],
        after: snapshotTaskForDiff(right),
      });
      continue;
    }
    if (left && !right) {
      taskChanges.push({
        taskId,
        change: "removed",
        title: left.title,
        fields: ["task"],
        before: snapshotTaskForDiff(left),
      });
      continue;
    }
    if (!left || !right) {
      continue;
    }
    const fields = changedTaskFields(left, right);
    if (fields.length > 0) {
      taskChanges.push({
        taskId,
        change: "changed",
        title: right.title,
        fields,
        before: snapshotTaskForDiff(left, fields),
        after: snapshotTaskForDiff(right, fields),
      });
    }
  }

  return {
    specId,
    from: before.label,
    to: after.label,
    summary: {
      titleChanged: specChanges.some((change) => change.field === "title"),
      objectiveChanged: specChanges.some((change) => change.field === "objective"),
      statusChanged: specChanges.some((change) => change.field === "status"),
      addedTasks: taskChanges.filter((change) => change.change === "added").length,
      removedTasks: taskChanges.filter((change) => change.change === "removed").length,
      changedTasks: taskChanges.filter((change) => change.change === "changed").length,
    },
    specChanges,
    taskChanges,
  };
}

function changedTaskFields(
  before: SpecificationTask | SpecificationVersion["taskSnapshot"][number],
  after: SpecificationTask | SpecificationVersion["taskSnapshot"][number],
): string[] {
  const fields: Array<keyof SpecificationTask> = ["title", "description", "status", "parallelizable", "verification", "order"];
  const changed = fields.filter((field) => before[field] !== after[field]).map(String);
  if (JSON.stringify(before.paths) !== JSON.stringify(after.paths)) {
    changed.push("paths");
  }
  if (JSON.stringify(before.dependsOn) !== JSON.stringify(after.dependsOn)) {
    changed.push("dependsOn");
  }
  return changed;
}

function snapshotTaskForDiff(
  task: SpecificationTask | SpecificationVersion["taskSnapshot"][number],
  fields?: string[],
): Partial<SpecificationTask> {
  const snapshot: Partial<SpecificationTask> = { id: task.id, title: task.title };
  const include = fields ? new Set(fields) : undefined;
  const maybe = <K extends keyof SpecificationTask>(field: K, value: SpecificationTask[K]): void => {
    if (!include || include.has(field)) {
      snapshot[field] = value;
    }
  };
  maybe("description", task.description);
  maybe("status", task.status);
  maybe("parallelizable", task.parallelizable);
  maybe("paths", task.paths);
  maybe("dependsOn", task.dependsOn);
  maybe("verification", task.verification);
  maybe("order", task.order);
  return snapshot;
}

function orderTasksForPlan<T extends Pick<SpecificationTask, "id" | "dependsOn" | "order" | "createdAt">>(tasks: T[]): T[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: T[] = [];
  const sorted = [...tasks].sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));

  const visit = (task: T): void => {
    if (visited.has(task.id)) {
      return;
    }
    if (visiting.has(task.id)) {
      throw new Error(`Specification task dependency cycle detected at ${task.id}`);
    }
    visiting.add(task.id);
    for (const dependencyId of task.dependsOn) {
      const dependency = byId.get(dependencyId);
      if (dependency) {
        visit(dependency);
      }
    }
    visiting.delete(task.id);
    visited.add(task.id);
    ordered.push(task);
  };

  for (const task of sorted) {
    visit(task);
  }
  return ordered;
}

function planStepFromTask(task: SpecificationTask | SpecificationVersion["taskSnapshot"][number], order: number, orderedTasks: Array<SpecificationTask | SpecificationVersion["taskSnapshot"][number]>): SpecificationPlanStep {
  const completed = new Set(orderedTasks.slice(0, order - 1).map((candidate) => candidate.id));
  const missingDependencies = task.dependsOn.filter((dependencyId) => !completed.has(dependencyId));
  return {
    id: `step_${order}`,
    taskId: task.id,
    title: task.title,
    description: task.description,
    order,
    dependsOn: task.dependsOn,
    paths: task.paths,
    verification: task.verification,
    parallelizable: task.parallelizable,
    risk: task.verification || task.paths.length > 3 ? "medium" : "low",
    status: missingDependencies.length > 0 ? "blocked" : "ready",
    metadata: {
      sourceTaskStatus: task.status,
      sourceTaskOrder: task.order,
    },
  };
}

function summarizePlan(spec: Specification, steps: SpecificationPlanStep[], openClarificationCount: number, versionNumber?: number): string {
  const parallelizable = steps.filter((step) => step.parallelizable).length;
  const gated = steps.filter((step) => step.verification).length;
  const source = versionNumber ? `version ${versionNumber}` : "current spec";
  return `${spec.title}: ${steps.length} planned steps from ${source}; ${parallelizable} parallelizable; ${gated} verification-gated; ${openClarificationCount} open clarifications.`;
}

function planApprovalSummary(specId: string, planId: string): string {
  return `specId=${specId};planId=${planId}`;
}

function providerEvidenceMetadata(input: RecordSpecificationTaskProviderEvidenceInput): Record<string, unknown> {
  return {
    provider: input.provider,
    conclusion: input.conclusion,
    checkName: input.checkName,
    runId: input.runId,
    runUrl: input.runUrl,
    commitSha: input.commitSha,
    branch: input.branch,
    externalId: input.externalId,
  };
}

function formatProviderEvidence(input: RecordSpecificationTaskProviderEvidenceInput): string {
  const label = input.checkName?.trim() || "provider check";
  const parts = [`${input.provider} ${label}: ${input.conclusion}`];
  if (input.runId) {
    parts.push(`run=${input.runId}`);
  }
  if (input.commitSha) {
    parts.push(`sha=${input.commitSha}`);
  }
  if (input.branch) {
    parts.push(`branch=${input.branch}`);
  }
  if (input.runUrl) {
    parts.push(`url=${input.runUrl}`);
  }
  return parts.join(" ");
}

function compactRoomEventValue(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}\n[truncated]` : value;
}

export function parseSpecificationStatus(value: string): SpecificationStatus {
  if (["draft", "planned", "ready", "in_progress", "completed", "blocked", "archived"].includes(value)) {
    return value as SpecificationStatus;
  }
  throw new Error(`Invalid specification status: ${value}`);
}

export function parseSpecificationTaskStatus(value: string): SpecificationTaskStatus {
  if (["pending", "in_progress", "completed", "blocked"].includes(value)) {
    return value as SpecificationTaskStatus;
  }
  throw new Error(`Invalid specification task status: ${value}`);
}

export function parseSpecificationClarificationStatus(value: string): SpecificationClarificationStatus {
  if (["open", "answered", "resolved"].includes(value)) {
    return value as SpecificationClarificationStatus;
  }
  throw new Error(`Invalid specification clarification status: ${value}`);
}
