import type { AgentRunEvent } from "../core/agent-events.js";
import type { PlatformEvent } from "./event-stream.js";

export type LocalEvent = AgentRunEvent | PlatformEvent;
export type LocalEventListener = (event: LocalEvent) => void;

export class LocalEventBus {
  private readonly listeners = new Set<LocalEventListener>();

  publish(event: LocalEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: LocalEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
