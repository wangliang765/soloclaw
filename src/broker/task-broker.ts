import type { ActorRef, TaskAssignment, TaskLeaseEnvelope } from "../domain/index.js";
import type {
  AssignTaskInput,
  CompleteAssignmentInput,
  RecoverExpiredAssignmentsInput,
  RecoverExpiredAssignmentsResult,
} from "../tasks/task-assignment-service.js";

export type TaskBrokerEnqueueInput = AssignTaskInput;

export type TaskBrokerClaimInput = {
  workerId: string;
  actor: ActorRef;
  leaseTtlSeconds?: number;
  signLeaseEnvelope?: (envelope: Omit<TaskLeaseEnvelope, "signature">) => Promise<string | undefined> | string | undefined;
  recordLeaseNonce?: (envelope: TaskLeaseEnvelope) => Promise<boolean> | boolean;
};

export type TaskBrokerCompleteInput = CompleteAssignmentInput;

export interface TaskBroker {
  enqueue(input: TaskBrokerEnqueueInput): Promise<TaskAssignment>;
  claimNext(input: TaskBrokerClaimInput): Promise<TaskAssignment | undefined>;
  complete(input: TaskBrokerCompleteInput): Promise<TaskAssignment>;
  recoverExpired(input: RecoverExpiredAssignmentsInput): Promise<RecoverExpiredAssignmentsResult>;
}
