import type { ToolCall } from "../protocol/types.js";

export type DoomLoopHit = {
  toolName: string;
  fingerprint: string;
  count: number;
};

export class DoomLoopDetector {
  private lastFingerprint = "";
  private repeated = 0;

  constructor(private readonly threshold: number) {}

  record(calls: ToolCall[]): DoomLoopHit | undefined {
    if (this.threshold <= 0 || calls.length !== 1) {
      this.lastFingerprint = "";
      this.repeated = 0;
      return undefined;
    }

    const call = calls[0];
    const fingerprint = `${call.name}:${stableJson(call.input)}`;
    this.repeated = fingerprint === this.lastFingerprint ? this.repeated + 1 : 1;
    this.lastFingerprint = fingerprint;
    if (this.repeated >= this.threshold) {
      return { toolName: call.name, fingerprint, count: this.repeated };
    }
    return undefined;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
