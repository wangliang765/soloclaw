import type { ActorRef, ExecutionMode, PolicyRequest, TaskRisk } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { PolicyEngine } from "../policy/policy-engine.js";
import type { AgentStore } from "../store/agent-store.js";
import type { GetSecretInput, SecretLease, SecretRef, SecretStore } from "./secret-store.js";

export type PolicySecretBrokerInput = GetSecretInput & {
  actor: ActorRef;
  mode: ExecutionMode;
  scope?: PolicyRequest["scope"];
  risk?: TaskRisk;
  metadata?: Record<string, unknown>;
};

export class PolicySecretBroker {
  constructor(
    private readonly secrets: SecretStore,
    private readonly policy: PolicyEngine,
    private readonly store: AgentStore,
  ) {}

  async getSecret(input: PolicySecretBrokerInput): Promise<SecretLease> {
    const scope = input.scope ?? {};
    const decision = await this.policy.evaluate({
      actor: input.actor,
      action: "secret.read",
      mode: input.mode,
      risk: input.risk ?? "high",
      scope,
      metadata: {
        secretId: input.id,
        purpose: input.purpose,
        ...sanitizeMetadata(input.metadata),
      },
      requestedAt: new Date().toISOString(),
    });

    if (decision.type !== "allow") {
      await this.audit("secret.denied", input, `Secret access denied: ${decision.reason}`, {
        decision,
      });
      throw new Error(`Secret access ${decision.type === "ask" ? "requires approval" : "denied"}: ${decision.reason}`);
    }

    try {
      const lease = await this.secrets.getSecret({ id: input.id, purpose: input.purpose });
      await this.audit("secret.accessed", input, `Secret accessed for ${input.purpose}`, {
        decision,
        ref: safeSecretRef(lease.ref),
        leaseId: lease.leaseId,
        expiresAt: lease.expiresAt,
      });
      return lease;
    } catch (error) {
      await this.audit("secret.denied", input, "Secret access failed after policy allow", {
        decision,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async revokeLease(leaseId: string): Promise<void> {
    await this.secrets.revokeLease(leaseId);
  }

  private async audit(
    type: "secret.accessed" | "secret.denied",
    input: PolicySecretBrokerInput,
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type,
      actor: input.actor,
      orgId: input.scope?.orgId,
      projectId: input.scope?.projectId,
      roomId: input.scope?.roomId,
      sessionId: input.scope?.sessionId,
      summary,
      metadata: {
        secretId: input.id,
        purpose: input.purpose,
        ...sanitizeMetadata(input.metadata),
        ...metadata,
      },
      artifactRefs: [],
      createdAt: now,
    });
  }
}

function safeSecretRef(ref: SecretRef): Omit<SecretRef, "id"> & { id: string } {
  return {
    id: ref.id,
    name: ref.name,
    class: ref.class,
    scopeType: ref.scopeType,
    scopeId: ref.scopeId,
  };
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    const lowered = key.toLowerCase();
    sanitized[key] = lowered.includes("secret") || lowered.includes("token") || lowered.includes("key") || lowered.includes("credential") ? "[REDACTED]" : value;
  }
  return sanitized;
}
