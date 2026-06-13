import type { Timestamp } from "./common.js";

export type GitProvider = "github" | "gitlab";
export type GitCredentialMode = "pat" | "github_app" | "gitlab_oauth" | "scoped_project_token" | "short_lived_job_token";

export type GitProviderIntegration = {
  id: string;
  provider: GitProvider;
  orgId: string;
  credentialMode: GitCredentialMode;
  installationId?: string;
  tokenSecretRef?: string;
  createdAt: Timestamp;
};

export type PullRequestRef = {
  provider: GitProvider;
  repositoryId: string;
  branch: string;
  commitSha?: string;
  numberOrIid?: string;
  url?: string;
  ciStatus?: "unknown" | "pending" | "success" | "failed";
};
