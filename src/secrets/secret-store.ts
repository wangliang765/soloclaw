export type SecretRef = {
  id: string;
  name: string;
  class: "model_api_key" | "git_provider_token" | "ssh_key" | "environment_secret" | "deployment_secret" | "database_credential" | "webhook_secret" | "plugin_secret";
  scopeType: "user" | "organization" | "project" | "workspace" | "session";
  scopeId: string;
};

export type SecretLease = {
  ref: SecretRef;
  value: string;
  leaseId: string;
  expiresAt: string;
};

export type PutSecretInput = Omit<SecretRef, "id"> & {
  value: string;
};

export type GetSecretInput = {
  id: string;
  purpose: string;
};

export interface SecretStore {
  putSecret(input: PutSecretInput): Promise<SecretRef>;
  getSecret(input: GetSecretInput): Promise<SecretLease>;
  revokeLease(leaseId: string): Promise<void>;
  listSecrets?(): Promise<SecretRef[]>;
  deleteSecret?(id: string): Promise<boolean>;
}
