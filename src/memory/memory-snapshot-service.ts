import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ActorRef, MemoryScope } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";
import { MemoryExtractionService } from "./memory-extraction-service.js";
import { hasBlockingMemorySafetyFinding, scanMemorySafety } from "./memory-safety.js";

export type MemorySnapshotInput = {
  filePath: string;
  scopeType: MemoryScope;
  scopeId: string;
  actor: ActorRef;
};

export type MemorySnapshotStatus = {
  status: "clean" | "changed" | "missing";
  filePath: string;
  contentHash?: string;
  storedHash?: string;
};

export class MemorySnapshotService {
  constructor(private readonly store: AgentStore) {}

  async exportSnapshot(input: MemorySnapshotInput): Promise<void> {
    const memories = await this.store.listMemories(input.scopeType, input.scopeId);
    const body = [
      "# Soloclaw Memory Snapshot",
      "",
      `Scope: ${input.scopeType}:${input.scopeId}`,
      "",
      ...memories.map((memory) => `- [${memory.kind}] ${memory.summary} (id: ${memory.id}, confidence: ${memory.confidence.toFixed(2)})`),
      "",
    ].join("\n");
    await atomicWrite(input.filePath, body);
    const now = new Date().toISOString();
    await this.store.upsertMemorySnapshot({
      id: makeId<"ArtifactId">("msnap"),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      filePath: input.filePath,
      contentHash: sha256(body),
      exportedAt: now,
      updatedAt: now,
    });
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "memory.snapshot_exported",
      actor: input.actor,
      summary: `Memory snapshot exported: ${input.scopeType}:${input.scopeId}`,
      metadata: {
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        filePath: input.filePath,
        memoryCount: memories.length,
      },
      artifactRefs: [],
      createdAt: now,
    });
  }

  async importSnapshot(input: MemorySnapshotInput): Promise<{ candidateCount: number }> {
    const content = await fs.readFile(input.filePath, "utf8");
    const findings = scanMemorySafety(content);
    if (hasBlockingMemorySafetyFinding(findings)) {
      throw new Error("Snapshot has blocking safety findings.");
    }
    const extractor = new MemoryExtractionService(this.store);
    const result = await extractor.extractFromText({
      text: content,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      actor: input.actor,
    });
    const now = new Date().toISOString();
    await this.store.upsertMemorySnapshot({
      id: makeId<"ArtifactId">("msnap"),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      filePath: input.filePath,
      contentHash: sha256(content),
      importedAt: now,
      updatedAt: now,
    });
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "memory.snapshot_imported",
      actor: input.actor,
      summary: `Memory snapshot imported: ${input.scopeType}:${input.scopeId}`,
      metadata: {
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        filePath: input.filePath,
        candidateCount: result.createdCandidates.length,
        deniedCount: result.deniedCandidates.length,
      },
      artifactRefs: [],
      createdAt: now,
    });
    return { candidateCount: result.createdCandidates.length };
  }

  async status(input: Omit<MemorySnapshotInput, "actor">): Promise<MemorySnapshotStatus> {
    const snapshot = await this.store.getMemorySnapshot(input.scopeType, input.scopeId, input.filePath);
    const content = await fs.readFile(input.filePath, "utf8").catch(() => undefined);
    if (content === undefined) {
      return { status: "missing", filePath: input.filePath, storedHash: snapshot?.contentHash };
    }
    const contentHash = sha256(content);
    return {
      status: snapshot?.contentHash === contentHash ? "clean" : "changed",
      filePath: input.filePath,
      contentHash,
      storedHash: snapshot?.contentHash,
    };
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
