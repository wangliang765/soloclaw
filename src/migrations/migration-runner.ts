export type MigrationDirection = "up" | "down";

export type MigrationRecord = {
  id: string;
  description?: string;
  checksum?: string;
  appliedAt?: string;
};

export type MigrationPlan = {
  direction: MigrationDirection;
  pending: MigrationRecord[];
  applied: MigrationRecord[];
  currentVersion?: string;
  targetVersion?: string;
};

export type MigrationTarget = {
  kind: "sqlite" | "postgres";
  name: string;
  metadata?: Record<string, unknown>;
};

export type MigrationPlanInput = {
  target: MigrationTarget;
  targetVersion?: string;
  direction?: MigrationDirection;
};

export type MigrationApplyInput = MigrationPlanInput & {
  dryRun?: boolean;
};

export type MigrationApplyResult = {
  plan: MigrationPlan;
  applied: MigrationRecord[];
  dryRun: boolean;
};

export interface MigrationRunner {
  plan(input: MigrationPlanInput): Promise<MigrationPlan>;
  apply(input: MigrationApplyInput): Promise<MigrationApplyResult>;
}
