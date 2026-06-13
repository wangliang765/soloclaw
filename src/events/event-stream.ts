import type { ActorRef, AuditEvent } from "../domain/index.js";

export type PlatformEventScope = {
  orgId?: string;
  projectId?: string;
  roomId?: string;
  sessionId?: string;
  workerId?: string;
  agentId?: string;
};

export type PlatformEvent = {
  id: string;
  type: string;
  actor?: ActorRef;
  scope?: PlatformEventScope;
  payload?: Record<string, unknown>;
  auditEvent?: AuditEvent;
  createdAt: string;
};

export type PublishEventInput = {
  event: PlatformEvent;
};

export type EventSubscriptionFilter = {
  type?: string;
  scope?: PlatformEventScope;
};

export type EventSubscription = {
  close(): Promise<void> | void;
};

export interface EventStream {
  publish(input: PublishEventInput): Promise<void>;
  subscribe(filter: EventSubscriptionFilter, handler: (event: PlatformEvent) => Promise<void> | void): Promise<EventSubscription>;
}
