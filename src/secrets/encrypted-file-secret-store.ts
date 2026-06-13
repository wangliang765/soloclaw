import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { makeId } from "../domain/common.js";
import type { GetSecretInput, PutSecretInput, SecretLease, SecretRef, SecretStore } from "./secret-store.js";

type VaultPayload = {
  refs: SecretRef[];
  values: Record<string, string>;
};

type EncryptedVaultFile = {
  version: 1;
  kdf: "scrypt";
  cipher: "aes-256-gcm";
  salt: string;
  nonce: string;
  tag: string;
  ciphertext: string;
};

export type EncryptedFileSecretStoreOptions = {
  passphraseEnv?: string;
};

export class EncryptedFileSecretStore implements SecretStore {
  private readonly passphraseEnv: string;
  private readonly leases = new Set<string>();

  constructor(
    private readonly vaultPath: string,
    options: EncryptedFileSecretStoreOptions = {},
  ) {
    this.passphraseEnv = options.passphraseEnv ?? "AGENT_SECRETS_PASSPHRASE";
  }

  async putSecret(input: PutSecretInput): Promise<SecretRef> {
    const vault = this.readVault();
    const ref: SecretRef = {
      id: makeId<"SecretId">("sec"),
      name: input.name,
      class: input.class,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
    };
    const replaced = vault.refs.filter((candidate) => candidate.name === ref.name && candidate.scopeType === ref.scopeType && candidate.scopeId === ref.scopeId);
    vault.refs = vault.refs.filter((candidate) => !replaced.some((old) => old.id === candidate.id));
    for (const old of replaced) {
      delete vault.values[old.id];
    }
    vault.refs.push(ref);
    vault.values[ref.id] = input.value;
    this.writeVault(vault);
    return ref;
  }

  async getSecret(input: GetSecretInput): Promise<SecretLease> {
    const vault = this.readVault();
    const ref = vault.refs.find((candidate) => candidate.id === input.id);
    const value = vault.values[input.id];
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

  async listSecrets(): Promise<SecretRef[]> {
    return this.readVault().refs.sort((left, right) => left.name.localeCompare(right.name));
  }

  async deleteSecret(id: string): Promise<boolean> {
    const vault = this.readVault();
    const before = vault.refs.length;
    vault.refs = vault.refs.filter((candidate) => candidate.id !== id);
    delete vault.values[id];
    if (vault.refs.length === before) {
      return false;
    }
    if (vault.refs.length === 0) {
      rmSync(this.vaultPath, { force: true });
      return true;
    }
    this.writeVault(vault);
    return true;
  }

  private readVault(): VaultPayload {
    if (!existsSync(this.vaultPath)) {
      return { refs: [], values: {} };
    }
    const encrypted = JSON.parse(readFileSync(this.vaultPath, "utf8")) as EncryptedVaultFile;
    if (encrypted.version !== 1 || encrypted.kdf !== "scrypt" || encrypted.cipher !== "aes-256-gcm") {
      throw new Error(`Unsupported secret vault format: ${this.vaultPath}`);
    }
    const key = this.deriveKey(Buffer.from(encrypted.salt, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.nonce, "base64"));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as VaultPayload;
  }

  private writeVault(payload: VaultPayload): void {
    mkdirSync(path.dirname(this.vaultPath), { recursive: true, mode: 0o700 });
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const key = this.deriveKey(salt);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    const encrypted: EncryptedVaultFile = {
      version: 1,
      kdf: "scrypt",
      cipher: "aes-256-gcm",
      salt: salt.toString("base64"),
      nonce: nonce.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    writeFileSync(this.vaultPath, `${JSON.stringify(encrypted, null, 2)}\n`, { mode: 0o600 });
  }

  private deriveKey(salt: Buffer): Buffer {
    const passphrase = process.env[this.passphraseEnv];
    if (!passphrase) {
      throw new Error(`Missing ${this.passphraseEnv}; refusing to open encrypted secret vault.`);
    }
    if (passphrase.length < 12) {
      throw new Error(`${this.passphraseEnv} must be at least 12 characters.`);
    }
    return scryptSync(passphrase, salt, 32);
  }
}
