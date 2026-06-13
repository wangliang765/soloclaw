import type { ActorRef, AuditEvent, Session } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";
import type { TaskAssignmentService } from "./task-assignment-service.js";

export class TaskOperationError extends Error {
  constructor(
    message: string,
    readonly code: "session_not_found" | "invalid_transition",
  ) {
    super(message);
    this.name = "TaskOperationError";
  }
}

export type TaskOperationInput = {
  sessionId: string;
  actor: ActorRef;
  reason?: string;
};

export class TaskOperationsService {
  constructor(
    private readonly store: AgentStore,
    private readonly assignments?: TaskAssignmentService,
  ) {}

  async pause(input: TaskOperationInput): Promise<Session> {
    const session = await this.requireSession(input.sessionId);
    if (session.status === "cancelled" || session.status === "completed") {
      throw new TaskOperationError(`Cannot pause a ${session.status} session: ${session.id}`, "invalid_transition");
    }
    if (session.status !== "paused") {
      await this.store.updateSessionStatus(session.id, "paused");
      await this.audit(session, input.actor, "session.paused", `Paused session ${session.id}.`, input.reason);
      await this.assignments?.releaseActiveForSession({
        sessionId: session.id,
        actor: input.actor,
        status: "paused",
        resultSummary: input.reason ?? "Session paused.",
      });
    }
    return { ...session, status: "paused", updatedAt: new Date().toISOString() };
  }

  async cancel(input: TaskOperationInput): Promise<Session> {
    const session = await this.requireSession(input.sessionId);
    if (session.status === "completed") {
      throw new TaskOperationError(`Cannot cancel a completed session: ${session.id}`, "invalid_transition");
    }
    if (session.status !== "cancelled") {
      await this.store.updateSessionStatus(session.id, "cancelled");
      await this.audit(session, input.actor, "session.cancelled", `Cancelled session ${session.id}.`, input.reason);
      await this.assignments?.releaseActiveForSession({
        sessionId: session.id,
        actor: input.actor,
        status: "cancelled",
        resultSummary: input.reason ?? "Session cancelled.",
      });
    }
    return { ...session, status: "cancelled", updatedAt: new Date().toISOString() };
  }

  async markResumed(input: TaskOperationInput): Promise<Session> {
    const session = await this.requireSession(input.sessionId);
    this.assertResumable(session);
    await this.store.updateSessionStatus(session.id, "running");
    await this.audit(session, input.actor, "session.resumed", `Resumed session ${session.id}.`, input.reason);
    return { ...session, status: "running", updatedAt: new Date().toISOString() };
  }

  assertResumable(session: Session): void {
    if (session.status === "cancelled" || session.status === "completed") {
      throw new TaskOperationError(`Cannot resume a ${session.status} session: ${session.id}`, "invalid_transition");
    }
  }

  private async requireSession(sessionId: string): Promise<Session> {
    const session = await this.store.getSession(sessionId);
    if (!session) {
      throw new TaskOperationError(`Session not found: ${sessionId}`, "session_not_found");
    }
    return session;
  }

  private async audit(session: Session, actor: ActorRef, type: AuditEvent["type"], summary: string, reason?: string): Promise<void> {
    await this.store.recordAuditEvent({
      id: makeId<"AuditEventId">("audit"),
      type,
      actor,
      orgId: session.orgId,
      projectId: session.projectId,
      sessionId: session.id,
      roomId: session.roomId,
      summary,
      metadata: {
        previousStatus: session.status,
        reason,
      },
      createdAt: new Date().toISOString(),
    });
  }
}
