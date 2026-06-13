import { makeId } from "../domain/common.js";
import type { GetSecretInput, PutSecretInput, SecretLease, SecretRef, SecretStore } from "./secret-store.js";

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();
  private readonly refs = new Map<string, SecretRef>();
  private readonly leases = new Set<string>();

  async putSecret(input: PutSecretInput): Promise<SecretRef> {
    const ref: SecretRef = {
      id: makeId<"SecretId">("sec"),
      name: input.name,
      class: input.class,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
    };
    this.refs.set(ref.id, ref);
    this.values.set(ref.id, input.value);
    return ref;
  }

  async getSecret(input: GetSecretInput): Promise<SecretLease> {
    const ref = this.refs.get(input.id);
    const value = this.values.get(input.id);
    if (!ref || value === undefined) {
      throw new Error(`Secret not found for purpose: ${input.purpose}`);
    }
    const leaseId = makeId<"SecretId">("lease");
    this.leases.add(leaseId);
    return {
      ref,
      value,
      leaseId,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  async revokeLease(leaseId: string): Promise<void> {
    this.leases.delete(leaseId);
  }
}
