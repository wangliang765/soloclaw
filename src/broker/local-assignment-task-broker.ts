import { createHash, randomUUID } from "node:crypto";
import type { TaskAssignment, TaskLeaseEnvelope } from "../domain/index.js";
import type { TaskAssignmentService } from "../tasks/task-assignment-service.js";
import type { TaskBroker, TaskBrokerClaimInput, TaskBrokerCompleteInput, TaskBrokerEnqueueInput } from "./task-broker.js";
import type { RecoverExpiredAssignmentsInput, RecoverExpiredAssignmentsResult } from "../tasks/task-assignment-service.js";

export class LocalAssignmentTaskBroker implements TaskBroker {
  constructor(
    private readonly assignments: TaskAssignmentService,
    private readonly options: {
      signLeaseEnvelope?: (envelope: Omit<TaskLeaseEnvelope, "signature">) => Promise<string | undefined> | string | undefined;
      recordLeaseNonce?: (envelope: TaskLeaseEnvelope) => Promise<boolean> | boolean;
      createLeaseNonce?: () => string;
    } = {},
  ) {}

  async enqueue(input: TaskBrokerEnqueueInput): Promise<TaskAssignment> {
    return this.assignments.assign(input);
  }

  async claimNext(input: TaskBrokerClaimInput): Promise<TaskAssignment | undefined> {
    const assignment = await this.nextAssignment(input.workerId);
    if (!assignment) {
      return undefined;
    }
    return this.assignments.heartbeat({
      assignmentId: assignment.id,
      workerId: input.workerId,
      actor: input.actor,
      leaseTtlSeconds: input.leaseTtlSeconds,
      createLeaseEnvelope: async (running) => {
        const envelope: Omit<TaskLeaseEnvelope, "signature"> = {
          version: 1,
          assignmentId: running.id,
          workerId: running.workerId,
          leaseOwnerId: running.leaseOwnerId,
          leaseExpiresAt: running.leaseExpiresAt,
          claimedAt: running.updatedAt,
          claimedBy: input.actor,
          broker: "local_assignment",
          nonce: this.options.createLeaseNonce?.() ?? randomUUID(),
        };
        const signature = await (input.signLeaseEnvelope ?? this.options.signLeaseEnvelope)?.(envelope);
        const leaseEnvelope: TaskLeaseEnvelope = signature ? { ...envelope, signature } : envelope;
        if (leaseEnvelope.signature) {
          const recorded = await (input.recordLeaseNonce ?? this.options.recordLeaseNonce)?.(leaseEnvelope);
          if (recorded === false) {
            throw new Error(`Task lease nonce replay detected: ${leaseEnvelope.nonce}`);
          }
        }
        return leaseEnvelope;
      },
    });
  }

  async complete(input: TaskBrokerCompleteInput): Promise<TaskAssignment> {
    return this.assignments.complete(input);
  }

  async recoverExpired(input: RecoverExpiredAssignmentsInput): Promise<RecoverExpiredAssignmentsResult> {
    return this.assignments.recoverExpired(input);
  }

  private async nextAssignment(workerId: string): Promise<TaskAssignment | undefined> {
    const now = new Date().toISOString();
    const assignments = await this.assignments.list({ workerId, limit: 50 });
    return assignments
      .filter((assignment) => (assignment.status === "leased" || assignment.status === "running") && assignment.leaseExpiresAt > now)
      .filter((assignment) => isReadyToRun(assignment, now))
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return right.priority - left.priority;
        }
        return left.createdAt.localeCompare(right.createdAt);
      })[0];
  }
}

export function taskLeaseEnvelopeHash(envelope: TaskLeaseEnvelope): string {
  return createHash("sha256").update(JSON.stringify(envelope)).digest("hex");
}

function isReadyToRun(assignment: TaskAssignment, now: string): boolean {
  const notBefore = assignment.metadata?.retryNotBefore;
  return typeof notBefore !== "string" || notBefore <= now;
}
