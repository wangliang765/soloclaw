import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ActorRef, ArtifactKind, ArtifactRecord, RetentionPolicy, Session, SessionSummary } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";

export type RegisterArtifactInput = {
  kind: ArtifactKind;
  name?: string;
  path?: string;
  uri?: string;
  mimeType?: string;
  orgId?: string;
  projectId?: string;
  roomId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  actor: ActorRef;
};

export type RetentionSweepResult = {
  policy: RetentionPolicy;
  projectId: string;
  sessionsCompacted: number;
  artifactsDeleted: number;
  auditEventsDeleted: number;
};

export class LifecycleService {
  constructor(
    private readonly store: AgentStore,
    private readonly cwd: string,
  ) {}

  async createRetentionPolicy(input: Omit<RetentionPolicy, "id">, actor: ActorRef): Promise<RetentionPolicy> {
    const policy: RetentionPolicy = {
      ...input,
      id: makeId<"ArtifactId">("ret"),
    };
    await this.store.createRetentionPolicy(policy);
    await this.audit("retention.policy_created", actor, `Created retention policy ${policy.name}`, { policy });
    return policy;
  }

  async assignProjectPolicy(projectId: string, policyId: string, actor: ActorRef) {
    const policy = await this.store.getRetentionPolicy(policyId);
    if (!policy) {
      throw new Error(`Retention policy not found: ${policyId}`);
    }
    const project = await this.store.setProjectRetentionPolicy(projectId, policyId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    await this.audit(
      "retention.policy_applied",
      actor,
      `Assigned retention policy ${policy.name} to project ${projectId}`,
      { projectId, policyId },
      { orgId: project.orgId, projectId },
    );
    return project;
  }

  async registerArtifact(input: RegisterArtifactInput): Promise<ArtifactRecord> {
    const fileInfo = input.path ? await inspectFile(this.cwd, input.path) : {};
    const artifact: ArtifactRecord = {
      id: makeId<"ArtifactId">("art"),
      kind: input.kind,
      name: input.name ?? inferArtifactName(input),
      path: input.path,
      uri: input.uri,
      mimeType: input.mimeType,
      sizeBytes: fileInfo.sizeBytes,
      sha256: fileInfo.sha256,
      orgId: input.orgId,
      projectId: input.projectId,
      roomId: input.roomId,
      sessionId: input.sessionId,
      createdBy: input.actor,
      status: "active",
      createdAt: new Date().toISOString(),
      metadata: input.metadata,
    };
    await this.store.createArtifact(artifact);
    await this.audit("artifact.created", input.actor, `Registered artifact ${artifact.name}`, {
      artifactId: artifact.id,
      kind: artifact.kind,
      path: artifact.path,
      uri: artifact.uri,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
    }, { ...artifact, artifactId: artifact.id });
    return artifact;
  }

  async deleteArtifact(input: { artifactId: string; actor: ActorRef; deleteFile?: boolean; force?: boolean }): Promise<ArtifactRecord> {
    const artifact = await this.store.getArtifact(input.artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${input.artifactId}`);
    }
    if (input.deleteFile && artifact.path) {
      await deleteArtifactFile(this.cwd, artifact.path, input.force ?? false);
    }
    const deleted = await this.store.markArtifactDeleted(input.artifactId, input.actor);
    if (!deleted) {
      throw new Error(`Artifact not found: ${input.artifactId}`);
    }
    await this.audit("artifact.deleted", input.actor, `Deleted artifact ${artifact.name}`, {
      artifactId: artifact.id,
      deleteFile: input.deleteFile ?? false,
    }, { ...artifact, artifactId: artifact.id });
    return deleted;
  }

  async deleteSession(input: { sessionId: string; actor: ActorRef; force?: boolean }): Promise<void> {
    const session = await this.requireSession(input.sessionId);
    await this.assertUserDeletionAllowed(session, input.force ?? false);
    const deleted = await this.store.deleteSession(input.sessionId);
    if (!deleted) {
      throw new Error(`Session not found: ${input.sessionId}`);
    }
    await this.audit("session.deleted", input.actor, `Deleted session ${input.sessionId}`, {
      sessionId: input.sessionId,
      projectId: session.projectId,
      forced: input.force ?? false,
    }, session);
  }

  async compactSession(input: { sessionId: string; actor: ActorRef; force?: boolean; summary?: string }): Promise<import("../store/agent-store.js").CompactSessionResult> {
    const session = await this.requireSession(input.sessionId);
    if (!input.force && session.status === "running") {
      throw new Error("Refusing to compact a running session without --force.");
    }
    const summary: SessionSummary = {
      id: makeId<"ArtifactId">("sum"),
      sessionId: input.sessionId,
      summary: input.summary ?? (await this.buildSessionSummary(session)),
      createdAt: new Date().toISOString(),
    };
    const result = await this.store.compactSession(input.sessionId, summary);
    await this.audit("session.compacted", input.actor, `Compacted session ${input.sessionId}`, {
      sessionId: input.sessionId,
      messagesDeleted: result.messagesDeleted,
      toolCallsDeleted: result.toolCallsDeleted,
      summaryId: summary.id,
    }, session);
    return result;
  }

  async applyProjectRetention(projectId: string, actor: ActorRef): Promise<RetentionSweepResult> {
    const project = await this.store.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    if (!project.retentionPolicyId) {
      throw new Error(`Project has no retention policy: ${projectId}`);
    }
    const policy = await this.store.getRetentionPolicy(project.retentionPolicyId);
    if (!policy) {
      throw new Error(`Retention policy not found: ${project.retentionPolicyId}`);
    }

    let sessionsCompacted = 0;
    if (policy.enableAutoSummaries) {
      const sessionCutoff = cutoffIso(policy.hotTranscriptDays);
      const sessions = (await this.store.listSessions(10_000)).filter(
        (session) => session.projectId === projectId && session.createdAt < sessionCutoff && session.status !== "running",
      );
      for (const session of sessions) {
        const messages = await this.store.getMessages(session.id);
        const tools = await this.store.getToolResults(session.id);
        if (messages.length === 0 && tools.length === 0) {
          continue;
        }
        await this.compactSession({ sessionId: session.id, actor, force: true });
        sessionsCompacted += 1;
      }
    }

    let artifactsDeleted = 0;
    const artifactCutoff = cutoffIso(policy.artifactRetentionDays);
    const artifacts = await this.store.listArtifacts({ projectId, status: "active", limit: 10_000 });
    for (const artifact of artifacts) {
      if (artifact.createdAt >= artifactCutoff) {
        continue;
      }
      await this.deleteArtifact({ artifactId: artifact.id, actor });
      artifactsDeleted += 1;
    }

    const auditEventsDeleted = await this.store.deleteAuditEventsBefore({
      projectId,
      before: cutoffIso(policy.auditRetentionDays),
    });

    const result = { policy, projectId, sessionsCompacted, artifactsDeleted, auditEventsDeleted };
    await this.audit("retention.policy_applied", actor, `Applied retention policy ${policy.name} to project ${projectId}`, result, {
      orgId: project.orgId,
      projectId,
    });
    return result;
  }

  private async requireSession(sessionId: string): Promise<Session> {
    const session = await this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  private async assertUserDeletionAllowed(session: Session, force: boolean): Promise<void> {
    if (force || !session.projectId) {
      return;
    }
    const project = await this.store.getProject(session.projectId);
    const policy = project?.retentionPolicyId ? await this.store.getRetentionPolicy(project.retentionPolicyId) : undefined;
    if (policy && !policy.allowUserDeletion) {
      throw new Error(`Retention policy ${policy.name} does not allow user deletion. Use --force for local admin override.`);
    }
  }

  private async buildSessionSummary(session: Session): Promise<string> {
    const messages = await this.store.getMessages(session.id);
    const tools = await this.store.getToolResults(session.id);
    const messagePreview = messages
      .slice(-6)
      .map((message) => `${message.role}: ${message.content.slice(0, 240)}`)
      .join("\n");
    const toolPreview = tools
      .slice(-6)
      .map((tool) => `${tool.callId}: ${tool.ok ? "ok" : tool.error?.code ?? "error"}`)
      .join("\n");
    return [
      `Session: ${session.id}`,
      `Objective: ${session.objective}`,
      `Status: ${session.status}`,
      `Messages compacted: ${messages.length}`,
      `Tool calls compacted: ${tools.length}`,
      messagePreview ? `Recent messages:\n${messagePreview}` : undefined,
      toolPreview ? `Recent tool calls:\n${toolPreview}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private async audit(
    type: Parameters<AgentStore["recordAuditEvent"]>[0]["type"],
    actor: ActorRef,
    summary: string,
    metadata: Record<string, unknown>,
    scope?: Pick<ArtifactRecord, "orgId" | "projectId" | "sessionId" | "roomId"> & { artifactId?: string },
  ): Promise<void> {
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type,
      actor,
      orgId: scope?.orgId,
      projectId: scope?.projectId,
      sessionId: scope?.sessionId,
      roomId: scope?.roomId,
      summary,
      metadata,
      artifactRefs: scope?.artifactId ? [scope.artifactId] : [],
      createdAt: new Date().toISOString(),
    });
  }
}

async function inspectFile(cwd: string, inputPath: string): Promise<{ sizeBytes?: number; sha256?: string }> {
  const resolved = resolveWorkspacePath(cwd, inputPath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    throw new Error(`Artifact path is not a file: ${inputPath}`);
  }
  const bytes = await fs.readFile(resolved);
  return {
    sizeBytes: stat.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function deleteArtifactFile(cwd: string, inputPath: string, force: boolean): Promise<void> {
  const resolved = resolveWorkspacePath(cwd, inputPath);
  if (!force && path.normalize(inputPath).startsWith(`.agent${path.sep}`)) {
    throw new Error("Refusing to delete files under .agent without --force.");
  }
  await fs.rm(resolved, { force: true });
}

function resolveWorkspacePath(cwd: string, inputPath: string): string {
  const resolved = path.resolve(cwd, inputPath);
  const root = path.resolve(cwd);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }
  return resolved;
}

function inferArtifactName(input: RegisterArtifactInput): string {
  if (input.path) {
    return path.basename(input.path);
  }
  if (input.uri) {
    return input.uri;
  }
  return `${input.kind} artifact`;
}

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
