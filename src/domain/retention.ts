export type RetentionPolicy = {
  id: string;
  name: string;
  hotTranscriptDays: number;
  artifactRetentionDays: number;
  auditRetentionDays: number;
  enableAutoSummaries: boolean;
  allowUserDeletion: boolean;
  allowAuditExport: boolean;
};
